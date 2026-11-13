import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { DomainError, invalid, notFound } from '@/lib/errors'

/**
 * Configuración de México (épicas E14 a E16 del documento de requerimientos). Todo lo de este archivo lo cambia
 * administración ('config.manage') y queda en la bitácora:
 *  - el embudo de campaña, el canal y el tipo de empresa de cada formulario web (E15.F1 a F3),
 *  - la meta de respuesta de cada turno, en minutos, horas o días hábiles (E15.F9),
 *  - el gerente de cada territorio, que es el dueño de sus tiendas de venta puerta a puerta (E16.F2),
 *  - la regla para ganar de cada embudo (E14.F8).
 */

const campaign = z.object({
  funnel: z.string().trim().max(20).regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,19})?$/),
  channelId: z.string().trim().toLowerCase().max(60).regex(/^([a-z0-9][a-z0-9_.-]{1,59})?$/),
  isCampaign: z.boolean(),
  offerTypes: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/)).max(8),
})

/** Un formulario de campaña: a qué embudo de campaña pertenece, su identificador de canal y qué tipos de empresa ofrece. */
export async function setFormCampaign(ctx: Ctx, formId: string, input: z.input<typeof campaign>): Promise<void> {
  ctx.assert('config.manage')
  const parsed = campaign.safeParse(input)
  if (!parsed.success) {
    throw invalid('El embudo lleva hasta 20 letras o números (por ejemplo F1) y el canal, minúsculas, números, puntos y guiones (por ejemplo mx-web-tiendas).',
      'The funnel takes up to 20 letters or digits (for example F1) and the channel takes lowercase letters, digits, dots and dashes (for example mx-web-stores).')
  }
  const v = parsed.data
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; funnel: string | null; channel_id: string | null; is_campaign: boolean; offer_types: string[] }[]>`
      select market_code, funnel, channel_id, is_campaign, offer_types from crm.web_forms where id = ${formId} for update`
    const f = rows[0]
    if (!f) throw notFound('No encontramos ese formulario.', 'We could not find that form.')
    // Los tipos de empresa salen del catálogo de tipos de cuenta del mercado: uno que no existe no se ofrece.
    const known = v.offerTypes.length
      ? await tx<{ code: string }[]>`select distinct code from crm.account_types where code = any(${v.offerTypes}::text[]) and is_active and (market_code is null or market_code = ${f.market_code})`
      : []
    const offer = v.offerTypes.filter((c, i) => known.some((k) => k.code === c) && v.offerTypes.indexOf(c) === i)
    if (offer.length !== new Set(v.offerTypes).size) throw invalid('Elige tipos de empresa del catálogo de este mercado.', 'Pick company types from this market’s catalog.')
    const before = { funnel: f.funnel, channel_id: f.channel_id, is_campaign: f.is_campaign, offer_types: f.offer_types }
    const after = { funnel: v.funnel || null, channel_id: v.channelId || null, is_campaign: v.isCampaign, offer_types: offer }
    if (JSON.stringify(before) === JSON.stringify(after)) return
    await tx`update crm.web_forms set funnel = ${after.funnel}, channel_id = ${after.channel_id}, is_campaign = ${after.is_campaign}, offer_types = ${offer}::text[] where id = ${formId}`
    await audit(tx, ctx, 'form.campaign_set', 'form', formId, f.market_code, before, after)
  })
}

export const TARGET_UNITS = ['minutes', 'hours', 'days'] as const
export type TargetUnit = (typeof TARGET_UNITS)[number]

/**
 * Meta de respuesta de un turno. En minutos u horas hábiles se guarda en minutos; en días hábiles, la base la convierte con
 * el horario del mercado (un día hábil de 9:00 a 18:00 son 540 minutos hábiles) y la recalcula si el horario cambia.
 * Aplica a los leads que lleguen desde ese momento: el reloj de los que ya llegaron no se mueve.
 */
export async function setResponseTarget(ctx: Ctx, ruleId: string, input: { amount: number; unit: string }): Promise<void> {
  ctx.assert('config.manage')
  const unit = z.enum(TARGET_UNITS).safeParse(input.unit)
  const amount = Number(input.amount)
  const max = unit.success ? { minutes: 600, hours: 48, days: 10 }[unit.data] : 0
  if (!unit.success || !Number.isInteger(amount) || amount < 1 || amount > max || (unit.data === 'minutes' && amount < 5)) {
    throw invalid('La meta va de 5 a 600 minutos hábiles, de 1 a 48 horas hábiles o de 1 a 10 días hábiles.', 'The target goes from 5 to 600 business minutes, 1 to 48 business hours or 1 to 10 business days.')
  }
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; sla_minutes: number; sla_business_days: number | null }[]>`
      select market_code, sla_minutes, sla_business_days from crm.routing_rules where id = ${ruleId} for update`
    const r = rows[0]
    if (!r) throw notFound('No encontramos ese turno.', 'We could not find that rotation.')
    const days = unit.data === 'days' ? amount : null
    const minutes = unit.data === 'hours' ? amount * 60 : unit.data === 'minutes' ? amount : r.sla_minutes
    const done = await tx<{ sla_minutes: number; sla_business_days: number | null }[]>`
      update crm.routing_rules set sla_business_days = ${days}, sla_minutes = ${minutes} where id = ${ruleId} returning sla_minutes, sla_business_days`
    const after = done[0]!
    if (after.sla_minutes === r.sla_minutes && after.sla_business_days === r.sla_business_days) return
    await audit(tx, ctx, 'routing.target_set', 'routing_rule', ruleId, r.market_code,
      { sla_minutes: r.sla_minutes, sla_business_days: r.sla_business_days }, { sla_minutes: after.sla_minutes, sla_business_days: after.sla_business_days })
  })
}

/**
 * Gerente de un territorio. Las tiendas de venta puerta a puerta de ese territorio que hoy no lleva nadie, o que llevaba
 * el gerente anterior, pasan al nuevo; las que ya lleva otra persona no se mueven solas (se reasignan desde Comercios).
 * De ahí en adelante, toda tienda D2D que entra a ese territorio nace con el gerente como dueño.
 */
export async function setTerritoryManager(ctx: Ctx, territoryId: string, managerId: string | null): Promise<{ moved: number }> {
  ctx.assert('config.manage')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; name: string; manager_id: string | null; archived_at: Date | null }[]>`
      select market_code, name, manager_id, archived_at from crm.territories where id = ${territoryId} for update`
    const ter = rows[0]
    if (!ter) throw notFound('No encontramos ese territorio.', 'We could not find that territory.')
    if (ter.archived_at) throw invalid('Ese territorio está archivado.', 'That territory is archived.')
    const next = managerId || null
    if (next === ter.manager_id) return { moved: 0 }
    if (next) {
      const ok = await tx<{ ok: boolean }[]>`select app.can_sell_in(${next}::uuid, ${ter.market_code}) as ok`
      if (!ok[0]?.ok) throw invalid('Esa persona no vende en este mercado.', 'That person does not sell in this market.')
    }
    await tx`update crm.territories set manager_id = ${next} where id = ${territoryId}`
    let moved = 0
    if (next) {
      const stores = await tx<{ id: string }[]>`
        select id from crm.accounts
         where territory_id = ${territoryId} and kind = 'store' and segment = 'd2d' and archived_at is null and merged_into is null
           and (owner_id is null ${ter.manager_id ? tx`or owner_id = ${ter.manager_id}` : tx``})
         order by id limit 5000`
      moved = await applyTerritoryOwners(tx, stores.map((s) => s.id))
    }
    await audit(tx, ctx, 'territory.manager_set', 'territory', territoryId, ter.market_code, { manager_id: ter.manager_id }, { manager_id: next, stores_moved: moved })
    return { moved }
  })
}

/**
 * Aplica la regla "la tienda D2D es del gerente de su territorio" a unos comercios (alta, lead convertido, cambio de
 * territorio). La regla, el movimiento de negocios y pendientes y el evento de bitácora viven en la base
 * (app.apply_territory_owner): así vale igual para una carga o una importación. Devuelve cuántos cambiaron de dueño.
 */
export async function applyTerritoryOwners(tx: Tx, accountIds: string[]): Promise<number> {
  if (accountIds.length === 0) return 0
  const rows = await tx<{ n: number }[]>`
    select count(*) filter (where app.apply_territory_owner(x.id) is not null)::int as n from unnest(${accountIds}::uuid[]) as x(id)`
  return rows[0]?.n ?? 0
}

export const WIN_RULES = ['transaction', 'contract_or_transaction', 'manual'] as const
export type WinRule = (typeof WIN_RULES)[number]
export const CONTRACT_FIELD = 'b2b_contract_signed_on'

/** La regla para ganar de un embudo, a partir de sus dos propiedades. */
export const winRuleOf = (p: { close_by_transaction: boolean; txn_also_wins: boolean }): WinRule =>
  p.close_by_transaction ? 'transaction' : p.txn_also_wins ? 'contract_or_transaction' : 'manual'

/**
 * Una sola regla para ganar por embudo (E14.F8):
 *  - 'transaction': se gana solo, con la primera transacción del comercio (la recomendación del documento para todos los mercados).
 *  - 'contract_or_transaction': contrato firmado, o prepago y transaccionando. Se gana a mano con la fecha del contrato
 *    firmado (la pide la etapa de certificación o, si el embudo no la tiene, la última etapa abierta) y también se gana solo
 *    con la primera transacción.
 *  - 'manual': se gana a mano, sin más condición que lo que pidan sus etapas.
 * El cambio aplica desde ese momento a los negocios abiertos: la pantalla dice a cuántos y pide confirmarlo.
 */
export async function setWinRule(ctx: Ctx, pipelineId: string, rule: string, confirmed: boolean): Promise<void> {
  ctx.assert('config.manage')
  const parsed = z.enum(WIN_RULES).safeParse(rule)
  if (!parsed.success) throw invalid('Elige una regla de la lista.', 'Pick a rule from the list.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; motor: string; close_by_transaction: boolean; txn_also_wins: boolean }[]>`
      select market_code, motor, close_by_transaction, txn_also_wins from crm.pipelines where id = ${pipelineId} for update`
    const p = rows[0]
    if (!p) throw notFound('No encontramos ese embudo.', 'We could not find that pipeline.')
    const before = winRuleOf(p)
    if (before === parsed.data) return
    const open = await tx<{ n: number }[]>`select count(*)::int as n from crm.deals where pipeline_id = ${pipelineId} and status = 'open'`
    const openDeals = open[0]?.n ?? 0
    if (openDeals > 0 && !confirmed) {
      throw new DomainError('confirm_required',
        `Este cambio aplica a ${openDeals === 1 ? '1 negocio abierto' : `${openDeals} negocios abiertos`} de este embudo. Marca la casilla de confirmación y guarda de nuevo.`,
        `This change applies to ${openDeals === 1 ? '1 open deal' : `${openDeals} open deals`} in this pipeline. Tick the confirmation box and save again.`)
    }
    let asked: string | null = null
    if (parsed.data === 'contract_or_transaction') {
      const def = await tx`select 1 from crm.field_definitions where object = 'deal' and key = ${CONTRACT_FIELD} and is_active
                            and (market_code is null or market_code = ${p.market_code}) and (motor is null or motor = ${p.motor})`
      if (!def[0]) {
        throw invalid('Este embudo no tiene el campo "Contrato firmado el". Créalo en Embudos y campos (llave b2b_contract_signed_on, tipo fecha) y vuelve a elegir la regla.',
          'This pipeline has no "Contract signed on" field. Create it under Pipelines and fields (key b2b_contract_signed_on, date type) and pick the rule again.')
      }
      // La fecha del contrato la pide una etapa abierta del camino: quien gana a mano desde antes tiene que traerla.
      const token = `field:${CONTRACT_FIELD}`
      const has = await tx`select 1 from crm.stages where pipeline_id = ${pipelineId} and archived_at is null and kind in ('open', 'awaiting_txn') and ${token} = any(required_fields)`
      if (!has[0]) {
        const target = await tx<{ id: string }[]>`
          select id from crm.stages where pipeline_id = ${pipelineId} and archived_at is null and kind in ('open', 'awaiting_txn')
           order by (code = 'certificacion') desc, position desc limit 1`
        if (!target[0]) throw invalid('Este embudo no tiene etapas abiertas.', 'This pipeline has no open stages.')
        await tx`update crm.stages set required_fields = required_fields || ${[token]}::text[] where id = ${target[0].id}`
        asked = target[0].id
      }
    }
    await tx`update crm.pipelines set close_by_transaction = ${parsed.data === 'transaction'}, txn_also_wins = ${parsed.data === 'contract_or_transaction'} where id = ${pipelineId}`
    await audit(tx, ctx, 'pipeline.win_rule_set', 'pipeline', pipelineId, p.market_code, { win_rule: before },
      { win_rule: parsed.data, open_deals: openDeals, ...(asked ? { contract_asked_in_stage: asked } : {}) })
  })
}
