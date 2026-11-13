import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid } from '@/lib/errors'
import { peopleWithRole } from '@/domain/automation/people'
import { notify } from '@/domain/notify'

// LEAD-04: escalamiento del primer contacto. Al vencer la meta sin ningún intento, se le avisa a supervisión; si pasan
// N horas hábiles más sin intento, a quien lidera el mercado. Cada mercado lo enciende y fija sus horas; nace apagado,
// porque la meta se fija con la línea base del propio mercado. El aviso sale por el servicio único de avisos
// (src/domain/notify.ts): campana, centro de avisos y Hoy hasta que se atiende el lead; correo o Slack según la preferencia.

export const LEVEL_LABEL: Record<number, { es: string; en: string }> = {
  1: { es: 'Avisado a supervisión', en: 'Supervisor notified' },
  2: { es: 'Avisado a quien lidera', en: 'Market lead notified' },
}

type Due = { id: string; market_code: string; business_name: string; owner_id: string | null; owner_name: string | null; escalation_level: number; level2_hours: number }

async function escalationNotice(tx: Tx, sys: Ctx, l: Due, level: number, userId: string): Promise<void> {
  const who: [string, string] = [l.owner_name ?? 'nadie', l.owner_name ?? 'nobody']
  await notify(tx, sys, {
    to: userId, kind: 'lead_escalated', market: l.market_code, link: `/leads/${l.id}`, leadId: l.id, needsAction: true,
    title: level === 1
      ? [`Lead sin primer contacto: ${l.business_name}`, `Lead with no first contact: ${l.business_name}`]
      : [`Lead sigue sin primer contacto: ${l.business_name}`, `Lead still with no first contact: ${l.business_name}`],
    body: level === 1
      ? [`Venció la meta de primer contacto y nadie lo ha intentado. Lo lleva ${who[0]}.`, `The first-contact goal ran out and nobody has tried. Owner: ${who[1]}.`]
      : [`Pasaron ${l.level2_hours} horas hábiles más sin ningún intento. Lo lleva ${who[0]}.`, `${l.level2_hours} more business hours went by with no attempt. Owner: ${who[1]}.`],
  })
}

/** Corre por horario, como sistema. Devuelve cuántos leads subieron de nivel. Correrla dos veces no avisa dos veces. */
export async function escalateLeads(tx: Tx, sys: Ctx): Promise<number> {
  // Lo que ya se atendió (o se cerró) deja de estar escalado: sus avisos pendientes se cierran solos.
  // (función de la base: el aviso es de quien lo recibió, y solo el sistema puede retirarlo así)
  await tx`select app.close_lead_escalation_notices()`
  const due = await tx<Due[]>`
    select l.id, l.market_code, l.business_name, l.owner_id, u.full_name as owner_name, l.escalation_level, e.level2_hours
      from crm.leads l
      join crm.lead_escalation e on e.market_code = l.market_code and e.is_active
      left join crm.users u on u.id = l.owner_id
     where l.status = 'new' and l.sla_due_at < now()
       -- LEAD-04: el reloj se cierra con el contacto efectivo; un mercado puede decidir cerrarlo con el primer intento.
       and (case when coalesce(app.funnel_setting(l.market_code, 'lead_sla_clock') #>> '{}', 'contact') = 'attempt' then l.first_touch_at else l.first_contact_at end) is null
       and (l.escalation_level = 0 or (l.escalation_level = 1 and app.business_due_tz(l.market_code, l.sla_due_at, e.level2_hours * 60, l.timezone) < now()))
     order by l.sla_due_at limit 200 for update of l skip locked`
  for (const l of due) {
    const level = l.escalation_level + 1
    let people = await peopleWithRole(tx, l.market_code, level === 1 ? 'supervisor' : 'market_lead', l.owner_id)
    // Un mercado sin supervisión no deja el lead en el aire: el primer aviso sube directo a quien lidera.
    if (people.length === 0 && level === 1) people = await peopleWithRole(tx, l.market_code, 'market_lead', null)
    for (const p of people.filter((x) => x !== l.owner_id)) await escalationNotice(tx, sys, l, level, p)
    await tx`update crm.leads set escalation_level = ${level}, escalated_at = now() where id = ${l.id}`
    await audit(tx, sys, 'lead.escalated', 'lead', l.id, l.market_code, { level: l.escalation_level }, { level, people: people.length })
  }
  return due.length
}

/** Encender, apagar o cambiar las horas del segundo aviso de un mercado. */
export async function saveLeadEscalation(ctx: Ctx, market: string, input: { active: boolean; hours: number }): Promise<void> {
  ctx.assert('config.manage')
  ctx.market(market)
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > 72) throw invalid('El segundo aviso va de 1 a 72 horas hábiles después del primero.', 'The second notice goes from 1 to 72 business hours after the first.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ is_active: boolean; level2_hours: number }[]>`select is_active, level2_hours from crm.lead_escalation where market_code = ${market} for update`
    await tx`insert into crm.lead_escalation (market_code, is_active, level2_hours, updated_by) values (${market}, ${input.active}, ${input.hours}, ${ctx.user.id})
             on conflict (market_code) do update set is_active = excluded.is_active, level2_hours = excluded.level2_hours, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'routing.escalation_updated', 'routing_rule', null, market, before[0] ? { active: before[0].is_active, hours: before[0].level2_hours } : null, { active: input.active, hours: input.hours })
  })
}
