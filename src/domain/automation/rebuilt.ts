import 'server-only'
import { marketToday, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit } from '@/domain/common'
import { updateCustomTx } from '@/domain/custom'
import { notifyOutside } from '@/domain/notify'
import { DomainError } from '@/lib/errors'
import type { Action, Source } from '@/domain/automation/catalog'

/**
 * Las acciones que nacieron al reconstruir en CONTIGO las automatizaciones que el equipo tenía en Pipedrive (GOB-05):
 * llenar un campo adicional, dejar listo un correo al contacto, pasar el negocio a Operaciones y repartir por turno.
 * Todas pasan por la capa de dominio (permisos, bitácora) y explican en los dos idiomas por qué no se hicieron.
 */
export type RebuiltAction = Extract<Action, { type: 'set_custom' | 'send_email' | 'ops_handoff' | 'assign_turn' }>
type Rec = { id: string; market_code: string; account_id: string | null; deal_id: string | null; owner_id: string | null; label: string | null }

const skip = (code: string, es: string, en: string) => new DomainError(code, es, en)

export async function runRebuiltAction(tx: Tx, sys: Ctx, a: { id: string; source: Source }, action: RebuiltAction, rec: Rec): Promise<Record<string, unknown>> {
  if (action.type === 'set_custom') {
    const object = a.source === 'account' ? 'account' : 'deal'
    const id = object === 'account' ? rec.account_id! : rec.deal_id!
    const def = await tx<{ key: string }[]>`select key from crm.field_definitions where object = ${object} and key = ${action.field} and is_active
                                             and (market_code is null or market_code = ${rec.market_code}) limit 1`
    if (!def[0]) throw skip('no_field', `No existe el campo "${action.field}" en este mercado.`, `The "${action.field}" field does not exist in this market.`)
    const cur = object === 'account'
      ? await tx<{ v: string | null }[]>`select nullif(btrim(custom ->> ${action.field}), '') as v from crm.accounts where id = ${id}`
      : await tx<{ v: string | null }[]>`select nullif(btrim(custom ->> ${action.field}), '') as v from crm.deals where id = ${id}`
    if (action.keep && cur[0]?.v) throw skip('kept', 'El campo ya tenía valor: no se cambia.', 'The field already had a value: it is not changed.')
    let value: string
    if (action.from === 'owner') {
      if (!rec.owner_id) throw skip('no_owner', 'Nadie lleva el registro.', 'Nobody owns the record.')
      value = (await tx<{ full_name: string }[]>`select full_name from crm.users where id = ${rec.owner_id}`)[0]?.full_name ?? ''
    } else if (action.from === 'today') {
      value = (await tx<{ d: string }[]>`select (${marketToday(tx, rec.market_code)})::text as d`)[0]!.d
    } else value = action.value ?? ''
    if (!value) throw skip('no_value', 'No hay con qué llenar el campo.', 'There is nothing to fill the field with.')
    if (cur[0]?.v === value) throw skip('same_value', 'El campo ya tiene ese valor.', 'The field already has that value.')
    const changed = await updateCustomTx(tx, sys, object, id, { [action.field]: value })
    if (!changed) throw skip('not_editable', 'Ese campo no se puede llenar con ese valor.', 'That field cannot be filled with that value.')
    return { action: 'set_custom', field: action.field }
  }

  if (action.type === 'send_email') {
    if (!rec.deal_id) throw skip('no_deal', 'El correo sale de un negocio.', 'The email comes from a deal.')
    const rows = await tx<{ contact: string | null; email: string | null; account: string | null; owner: string | null; title: string; locale: 'es' | 'en'; account_id: string }[]>`
      select c.full_name as contact, c.email, ac.name as account, u.full_name as owner, d.title, m.default_locale as locale, d.account_id
        from crm.deals d join crm.markets m on m.code = d.market_code
        left join crm.accounts ac on ac.id = d.account_id
        left join crm.users u on u.id = d.owner_id
        left join lateral (select x.full_name, x.email from crm.contacts x
                            where x.id = d.decision_maker_id
                               or x.id in (select k.contact_id from crm.account_contacts k where k.account_id = d.account_id and k.valid_to is null)
                            order by (x.id = d.decision_maker_id) desc, (x.email is not null) desc limit 1) c on true
       where d.id = ${rec.deal_id}`
    const d = rows[0]
    if (!d) throw skip('no_deal', 'No encontramos el negocio.', 'We could not find the deal.')
    const status = await notifyOutside(tx, sys, {
      kind: 'automation', template: action.template, market: rec.market_code, recipient: 'lead', address: d.email, locale: d.locale === 'en' ? 'en' : 'es',
      vars: { contacto: d.contact ?? '', comercio: d.account ?? '', quien: d.owner ?? '', negocio: d.title },
      dealId: rec.deal_id, accountId: d.account_id,
    })
    if (!status) throw skip('no_template', `La plantilla "${action.template}" no existe o está apagada.`, `The "${action.template}" template does not exist or is off.`)
    return { action: 'send_email', template: action.template, status }
  }

  if (action.type === 'ops_handoff') {
    if (!rec.deal_id) throw skip('no_deal', 'Solo un negocio pasa a Operaciones.', 'Only a deal goes to Operations.')
    const rows = await tx<{ ops_owner_id: string | null; ops_lead_id: string | null }[]>`
      select d.ops_owner_id, p.ops_lead_id from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where d.id = ${rec.deal_id} for update of d`
    const d = rows[0]!
    let to: string | null
    if (action.to === 'queue') {
      // La entrega de siempre: el negocio queda en la cola de Operaciones con quien lidera Operaciones del embudo, si lo hay.
      if (d.ops_owner_id) throw skip('already_with_ops', 'Operaciones ya tiene a alguien a cargo del negocio.', 'Operations already has someone in charge of the deal.')
      to = d.ops_lead_id
      if (!to) return { action: 'ops_handoff', to: 'queue' }
    } else {
      to = action.to.slice(5)
      const ok = await tx<{ ok: boolean }[]>`select exists (select 1 from crm.memberships m join crm.users u on u.id = m.user_id where m.user_id = ${to} and u.is_active
        and m.role in ('ops', 'admin') and (m.market_code is null or m.market_code = ${rec.market_code}) and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())) as ok`
      if (!ok[0]?.ok) throw skip('not_ops', 'Esa persona no está en Operaciones de este mercado.', 'That person is not in Operations for this market.')
      if (d.ops_owner_id === to) throw skip('same_owner', 'Ya lo tiene esa persona.', 'That person already has it.')
    }
    await tx`update crm.deals set ops_owner_id = ${to} where id = ${rec.deal_id}`
    await audit(tx, sys, 'deal.ops_assigned', 'deal', rec.deal_id, rec.market_code, { ops_owner_id: d.ops_owner_id }, { ops_owner_id: to, by: 'automation', automation_id: a.id })
    return { action: 'ops_handoff', to }
  }

  // assign_turn: la siguiente persona del turno pasa a llevar el negocio; el turno avanza.
  if (!rec.deal_id) throw skip('no_deal', 'El turno reparte negocios.', 'The turn assigns deals.')
  const rules = await tx<{ member_ids: string[]; cursor: number; is_active: boolean }[]>`select member_ids, cursor, is_active from crm.routing_rules where id = ${action.rule_id} for update`
  const rule = rules[0]
  if (!rule || !rule.is_active) throw skip('no_turn', 'El turno no existe o está apagado.', 'The turn does not exist or is off.')
  const active = await tx<{ id: string }[]>`select u.id from crm.users u where u.id = any(${rule.member_ids}::uuid[]) and u.is_active
    and exists (select 1 from crm.memberships m where m.user_id = u.id and m.market_code = ${rec.market_code} and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))`
  const ok = new Set(active.map((x) => x.id))
  const n = rule.member_ids.length
  let pick: string | null = null
  let next = rule.cursor
  for (let i = 0; i < n; i++) {
    const cand = rule.member_ids[(rule.cursor + i) % n]!
    if (ok.has(cand)) {
      pick = cand
      next = (rule.cursor + i + 1) % n
      break
    }
  }
  if (!pick) throw skip('empty_turn', 'No hay nadie activo en el turno.', 'There is nobody active in the turn.')
  if (rec.owner_id === pick) {
    await tx`update crm.routing_rules set cursor = ${next} where id = ${action.rule_id}`
    throw skip('same_owner', 'Ya lo lleva la persona del turno.', 'The person in turn already owns it.')
  }
  await tx`update crm.deals set owner_id = ${pick} where id = ${rec.deal_id}`
  await tx`update crm.routing_rules set cursor = ${next} where id = ${action.rule_id}`
  await audit(tx, sys, 'deal.turn_assigned', 'deal', rec.deal_id, rec.market_code, { owner_id: rec.owner_id }, { owner_id: pick, rule_id: action.rule_id, automation_id: a.id })
  await emit(tx, 'deal.owner_changed', 'deal', rec.deal_id, rec.market_code, { owner_id: pick })
  return { action: 'assign_turn', to: pick }
}
