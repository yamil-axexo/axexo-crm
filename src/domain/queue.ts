import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import type { MessageKey } from '@/lib/messages'

export const RESULTS = ['reached', 'no_answer', 'later', 'done'] as const
export const NEXTS = ['call', 'proposal', 'meeting', 'task', 'none'] as const
export const ITEM_TYPES = ['task', 'lead', 'suggestion'] as const
export type Result = (typeof RESULTS)[number]
export type Next = (typeof NEXTS)[number]
export type ItemType = (typeof ITEM_TYPES)[number]

export type CompleteInput = { type: string; id: string; result: string; next: string; when: string }
export type Completed = { next: string | null; due: string | null }

const isOneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Completar un registro de la cola de Hoy (handoff, sección 6): guarda cómo fue y siempre pide el próximo paso.
 * No se puede guardar sin "¿Qué sigue?", salvo que la persona elija cerrar ("none").
 *
 * - task: la actividad queda hecha con su resultado.
 * - lead: queda el intento de primer contacto en el hilo y se detiene el reloj; pasa a "contactado" solo si hubo contacto.
 * - suggestion: la sugerencia de CONTIGO se cierra como atendida y no reaparece en 7 días.
 *
 * Todo ocurre en una transacción: completar y programar lo siguiente no pueden quedar a medias.
 */
export async function completeItem(ctx: Ctx, raw: CompleteInput): Promise<Completed> {
  if (!isOneOf(ITEM_TYPES, raw.type) || !UUID.test(raw.id)) throw notFound()
  if (!isOneOf(RESULTS, raw.result)) throw invalid('Elige cómo te fue.', 'Choose how it went.')
  if (!isOneOf(NEXTS, raw.next)) throw invalid('Elige qué sigue. Si ya no hay nada más que hacer, elige cerrar.', 'Choose what comes next. If there is nothing left to do, choose close.')
  const { type, id, result, next } = raw
  const when = next === 'none' ? null : raw.when
  if (next !== 'none' && !/^\d{4}-\d{2}-\d{2}$/.test(when ?? '')) throw invalid('Elige cuándo es el próximo paso.', 'Choose when the next step is.')
  const tz = ctx.markets[0]?.timezone ?? 'UTC'

  return withUser(ctx.user.id, async (tx) => {
    if (when) {
      const ok = await tx<{ ok: boolean }[]>`select ${when}::date >= (now() at time zone ${tz})::date and ${when}::date <= (now() at time zone ${tz})::date + 366 as ok`
      if (!ok[0]?.ok) throw invalid('El próximo paso no puede quedar en el pasado.', 'The next step cannot be in the past.')
    }
    let market: string
    let accountId: string | null = null
    let dealId: string | null = null
    let leadId: string | null = null
    let name = ''

    if (type === 'task') {
      const rows = await tx<{ market_code: string; done_at: Date | null; kind: string; subject: string; account_id: string | null; deal_id: string | null; lead_id: string | null }[]>`
        select market_code, done_at, kind, subject, account_id, deal_id, lead_id from crm.activities where id = ${id} for update`
      const a = rows[0]
      if (!a) throw notFound()
      ctx.assert('activity.write', a.market_code)
      if (a.done_at) return { next: null, due: null }
      ;({ market_code: market, account_id: accountId, deal_id: dealId, lead_id: leadId } = a)
      await tx`update crm.activities set done_at = now(), outcome = ${result} where id = ${id}`
      await audit(tx, ctx, 'activity.completed', 'activity', id, market, null, { kind: a.kind, outcome: result, next })
      const names = await tx<{ name: string | null }[]>`
        select coalesce((select name from crm.accounts where id = ${accountId}), (select business_name from crm.leads where id = ${leadId})) as name`
      name = names[0]?.name ?? a.subject
    } else if (type === 'lead') {
      const rows = await tx<{ market_code: string; status: string; business_name: string; first_touch_at: Date | null }[]>`
        select market_code, status, business_name, first_touch_at from crm.leads where id = ${id} for update`
      const l = rows[0]
      if (!l) throw notFound()
      ctx.assert('lead.work', l.market_code)
      if (!['new', 'contacted'].includes(l.status)) throw invalid('Este lead ya se trabajó.', 'This lead was already worked.')
      market = l.market_code
      leadId = id
      name = l.business_name
      const reached = result === 'reached' || result === 'done'
      const subject = ctx.m('complete.firstContact', { result: ctx.m(`complete.result.${result}` as MessageKey) })
      await tx`insert into crm.activities (market_code, lead_id, kind, subject, done_at, outcome, owner_id, created_by)
               values (${market}, ${id}, 'call', ${subject}, now(), ${result}, ${ctx.user.id}, ${ctx.user.id})`
      // El reloj de primer contacto mide la respuesta de quien atiende: se detiene con el primer intento registrado.
      await tx`update crm.leads set first_touch_at = coalesce(first_touch_at, now()), status = ${reached ? 'contacted' : l.status} where id = ${id}`
      await audit(tx, ctx, reached ? 'lead.contacted' : 'lead.attempted', 'lead', id, market, { status: l.status }, { status: reached ? 'contacted' : l.status, outcome: result })
    } else {
      const rows = await tx<{ market_code: string; kind: string; resolved_at: Date | null; account_id: string | null; deal_id: string | null; lead_id: string | null; detail: Record<string, unknown> }[]>`
        select market_code, kind, resolved_at, account_id, deal_id, lead_id, detail from crm.exceptions where id = ${id} for update`
      const e = rows[0]
      if (!e) throw notFound()
      ctx.assert('exception.resolve', e.market_code)
      if (e.resolved_at) return { next: null, due: null }
      ;({ market_code: market, account_id: accountId, deal_id: dealId, lead_id: leadId } = e)
      const names = await tx<{ name: string | null }[]>`
        select coalesce((select name from crm.accounts where id = ${accountId}), (select business_name from crm.leads where id = ${leadId})) as name`
      name = names[0]?.name ?? String(e.detail.name ?? e.detail.title ?? '')
      const resolution = next === 'none' ? 'dismissed' : 'scheduled'
      await tx`update crm.exceptions set resolved_at = now(), resolved_by = ${ctx.user.id}, resolution = ${resolution},
                detail = detail || ${tx.json({ outcome: result })} where id = ${id}`
      // Lo atendido queda en el hilo del comercio, deal o lead; un aviso sin registro ligado solo se cierra.
      if (accountId || dealId || leadId) {
        ctx.assert('activity.write', market)
        await tx`insert into crm.activities (market_code, account_id, deal_id, lead_id, kind, subject, done_at, outcome, owner_id, created_by, source)
                 values (${market}, ${accountId}, ${dealId}, ${leadId}, 'task', ${ctx.m(`suggest.${e.kind}` as MessageKey, { name })}, now(), ${result}, ${ctx.user.id}, ${ctx.user.id}, 'rule')`
      }
      await audit(tx, ctx, `exception.${resolution}`, 'exception', id, market, null, { kind: e.kind, outcome: result, next })
    }

    if (next === 'none' || !when) return { next: null, due: null }

    ctx.assert('activity.write', market)
    const subject = ctx.m(`complete.nextTitle.${next}` as MessageKey, { name })
    const nextId = await newId(tx)
    await tx`insert into crm.activities (id, market_code, account_id, deal_id, lead_id, kind, subject, due_at, owner_id, created_by)
             values (${nextId}, ${market}, ${accountId}, ${dealId}, ${leadId}, 'task', ${subject}, ${`${when}T15:00:00Z`}, ${ctx.user.id}, ${ctx.user.id})`
    await audit(tx, ctx, 'activity.added', 'activity', nextId, market, null, { kind: 'task', account_id: accountId, follows: id })
    if (dealId && ctx.can('deal.edit', market)) {
      const d = await tx<{ next_step: string | null }[]>`
        update crm.deals set next_step = ${subject}, next_step_due = ${when} where id = ${dealId} and status = 'open' returning next_step`
      if (d[0]) await audit(tx, ctx, 'deal.updated', 'deal', dealId, market, null, { next_step: subject, next_step_due: when })
    }
    return { next: subject, due: when }
  })
}
