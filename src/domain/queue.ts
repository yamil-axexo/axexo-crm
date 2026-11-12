import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import { assertOwned } from '@/domain/leads'
import type { MessageKey } from '@/lib/messages'
import { NEXTS, OPS_RESULTS, RESULTS, VISIT_RESULTS, applyVisitOutcome, assertNextDate, isOneOf, nextText, scheduleNext, shortNote, visitorName } from '@/domain/followup'

export { NEXTS, OPS_NEXTS, OPS_RESULTS, RESULTS, SALES_NEXTS, VISIT_RESULTS, type Next, type OpsResult, type Result, type VisitResult } from '@/domain/followup'
export const ITEM_TYPES = ['task', 'lead', 'suggestion'] as const
export type ItemType = (typeof ITEM_TYPES)[number]

/** `note`: nota corta de cómo fue. `nextText`: qué es "Otra tarea". `visitedBy`: quién visitó, al completar una visita. */
export type CompleteInput = { type: string; id: string; result: string; next: string; when: string; note?: string; nextText?: string; visitedBy?: string }
export type Completed = { next: string | null; due: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Completar un registro de la cola de Hoy (handoff, sección 6): guarda cómo fue y siempre pide el próximo paso.
 * No se puede guardar sin "¿Qué sigue?", salvo que la persona elija cerrar ("none").
 *
 * - task: la actividad queda hecha con su resultado. Una visita por hacer se completa con el resultado de la visita.
 * - lead: queda el intento de primer contacto en el hilo y se detiene el reloj; pasa a "contactado" solo si hubo contacto.
 * - suggestion: la sugerencia de CONTIGO se cierra como atendida y no reaparece en 7 días.
 *
 * Todo ocurre en una transacción: completar y programar lo siguiente no pueden quedar a medias.
 */
export async function completeItem(ctx: Ctx, raw: CompleteInput): Promise<Completed> {
  if (!isOneOf(ITEM_TYPES, raw.type) || !UUID.test(raw.id)) throw notFound()
  if (!isOneOf(RESULTS, raw.result) && !isOneOf(VISIT_RESULTS, raw.result) && !isOneOf(OPS_RESULTS, raw.result)) throw invalid('Elige cómo te fue.', 'Choose how it went.')
  // Los resultados de visita son solo de una visita: un lead o una sugerencia se cierran con los de siempre.
  if (raw.type !== 'task' && !isOneOf(RESULTS, raw.result)) throw invalid('Elige cómo te fue.', 'Choose how it went.')
  if (!isOneOf(NEXTS, raw.next)) throw invalid('Elige qué sigue. Si ya no hay nada más que hacer, elige cerrar.', 'Choose what comes next. If there is nothing left to do, choose close.')
  const { type, id, result, next } = raw
  // Un lead solo tiene dos resultados: hubo contacto o se intentó y no contestó. "Llamar después" no es un intento.
  if (type === 'lead' && result !== 'reached' && result !== 'no_answer') throw invalid('Elige si hubo contacto o no contestó.', 'Choose whether you reached them or there was no answer.')
  // Sin contacto, el lead no se puede cerrar sin programar el siguiente intento: si no, saldría de la cola sin seguimiento.
  if (type === 'lead' && result === 'no_answer' && next === 'none') throw invalid('Si no contestó, programa el siguiente intento.', 'If there was no answer, schedule the next attempt.')
  // Una sugerencia de CONTIGO no se apaga con "cerrar": se atiende con un próximo paso con fecha, o se corrige en el registro.
  if (type === 'suggestion' && next === 'none') throw invalid('Una sugerencia se atiende con un próximo paso con fecha.', 'A suggestion is handled with a dated next step.')
  const note = shortNote(raw.note)
  const text = next === 'task' ? nextText(raw.nextText) : null
  const visitor = visitorName(raw.visitedBy)
  const tz = ctx.markets[0]?.timezone ?? 'UTC'

  return withUser(ctx.user.id, async (tx) => {
    const when = next === 'none' ? null : await assertNextDate(tx, tz, raw.when)
    let market: string
    let accountId: string | null = null
    let dealId: string | null = null
    let leadId: string | null = null
    let name = ''
    let lane: 'sales' | 'ops' | null = null

    if (type === 'task') {
      const rows = await tx<{ market_code: string; done_at: Date | null; kind: string; subject: string; account_id: string | null; deal_id: string | null; lead_id: string | null; deal_step: 'sales' | 'ops' | null }[]>`
        select market_code, done_at, kind, subject, account_id, deal_id, lead_id, deal_step from crm.activities where id = ${id} for update`
      const a = rows[0]
      if (!a) throw notFound()
      ctx.assert('activity.write', a.market_code)
      if (a.done_at) return { next: null, due: null }
      ;({ market_code: market, account_id: accountId, deal_id: dealId, lead_id: leadId } = a)
      lane = a.deal_step
      // Una visita por hacer se completa diciendo cómo terminó la visita; lo demás, con los resultados de siempre.
      const visit = a.kind === 'visit'
      // Operaciones cierra sus tareas con sus propios resultados (documentos recibidos, enviado al proveedor, aprobado...).
      if (visit ? !isOneOf(VISIT_RESULTS, result) : !(isOneOf(RESULTS, result) || (isOneOf(OPS_RESULTS, result) && ctx.can('deal.ops', a.market_code)))) {
        throw visit ? invalid('Elige cómo terminó la visita.', 'Choose how the visit ended.') : invalid('Elige cómo te fue.', 'Choose how it went.')
      }
      await tx`update crm.activities set done_at = now(), outcome = ${result}, visited_by = ${visit ? visitor : null},
                body = ${note ? tx`nullif(concat_ws(E'\n', body, ${note}::text), '')` : tx`body`} where id = ${id}`
      await audit(tx, ctx, 'activity.completed', 'activity', id, market, null, { kind: a.kind, outcome: result, next, ...(visit ? { origin: 'manual' } : {}) })
      if (visit && isOneOf(VISIT_RESULTS, result)) await applyVisitOutcome(tx, ctx, { market, accountId, outcome: result, day: null, returnOn: when })
      const names = await tx<{ name: string | null }[]>`
        select coalesce((select name from crm.accounts where id = ${accountId}), (select business_name from crm.leads where id = ${leadId})) as name`
      name = names[0]?.name ?? a.subject
    } else if (type === 'lead') {
      const rows = await tx<{ market_code: string; status: string; business_name: string; first_touch_at: Date | null; owner_id: string | null }[]>`
        select market_code, status, business_name, first_touch_at, owner_id from crm.leads where id = ${id} for update`
      const l = rows[0]
      if (!l) throw notFound()
      ctx.assert('lead.work', l.market_code)
      assertOwned(ctx, l)
      if (!['new', 'contacted'].includes(l.status)) throw invalid('Este lead ya se trabajó.', 'This lead was already worked.')
      market = l.market_code
      leadId = id
      name = l.business_name
      const reached = result === 'reached'
      const subject = ctx.m('complete.firstContact', { result: ctx.m(`complete.result.${result}` as MessageKey) })
      await tx`insert into crm.activities (market_code, lead_id, kind, subject, body, done_at, outcome, owner_id, created_by)
               values (${market}, ${id}, 'call', ${subject}, ${note}, now(), ${result}, ${ctx.user.id}, ${ctx.user.id})`
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
      const resolution = 'scheduled'
      await tx`update crm.exceptions set resolved_at = now(), resolved_by = ${ctx.user.id}, resolution = ${resolution},
                detail = detail || ${tx.json({ outcome: result })} where id = ${id}`
      // El mismo negocio o comercio puede tener más de un aviso abierto (sin próximo paso y estancado): el próximo paso
      // con fecha los atiende a todos; si no, el registro reaparecería al instante con otro nombre.
      if (dealId || accountId) {
        await tx`update crm.exceptions set resolved_at = now(), resolved_by = ${ctx.user.id}, resolution = ${resolution},
                  detail = detail || ${tx.json({ outcome: result, with: id })}
                  where resolved_at is null and id <> ${id} and owner_id = ${ctx.user.id} and kind <> 'lead_sla'
                    and ${dealId ? tx`deal_id = ${dealId}` : tx`account_id = ${accountId} and deal_id is null`}`
      }
      // Lo atendido queda en el hilo del comercio, deal o lead; un aviso sin registro ligado solo se cierra.
      if (accountId || dealId || leadId) {
        ctx.assert('activity.write', market)
        await tx`insert into crm.activities (market_code, account_id, deal_id, lead_id, kind, subject, body, done_at, outcome, owner_id, created_by, source)
                 values (${market}, ${accountId}, ${dealId}, ${leadId}, 'task', ${ctx.m(`suggest.${e.kind}` as MessageKey, { name })}, ${note}, now(), ${result}, ${ctx.user.id}, ${ctx.user.id}, 'rule')`
      }
      await audit(tx, ctx, `exception.${resolution}`, 'exception', id, market, null, { kind: e.kind, outcome: result, next })
    }

    if (next === 'none' || !when) return { next: null, due: null }

    const subject = await scheduleNext(tx, ctx, { market, accountId, dealId, leadId, name, next, when, text, follows: id, lane })
    return { next: subject, due: when }
  })
}
