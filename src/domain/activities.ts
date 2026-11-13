import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId, clean } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import { assertNoProhibited } from '@/domain/guard'
import { notifyFromNote } from '@/domain/ops'
import { NEXTS, VISIT_RESULTS, applyVisitOutcome, assertNextDate, assertNoSaleReason, assertVisitReason, closePlannedVisits, isOneOf, nextText, scheduleNext, visitorName } from '@/domain/followup'

const input = z.object({
  accountId: z.guid().optional(),
  dealId: z.guid().optional(),
  leadId: z.guid().optional(),
  kind: z.enum(['note', 'call', 'meeting', 'task', 'visit']),
  subject: z.string().trim().max(200).optional().default(''),
  body: z.string().trim().max(4000).optional().default(''),
  dueAt: z.string().optional().default(''),
  /** Cómo terminó: de una visita (sale, no_sale, revisit) o de una llamada (reached, no_answer). */
  outcome: z.string().optional().default(''),
  /** Día en que pasó (AAAA-MM-DD), cuando se captura después. Vacío es ahora. */
  on: z.string().optional().default(''),
  visitedBy: z.string().optional().default(''),
  /** Por qué no hubo venta (código del catálogo de motivos de calle). Lo pide toda visita que termina sin venta. */
  noSaleReason: z.string().optional().default(''),
  /** Propósito de la visita (código de la lista del mercado). Lo pide toda visita hecha en un mercado que tiene lista. */
  visitReason: z.string().optional().default(''),
  /** Próximo paso: vacío es "no se preguntó". */
  next: z.string().optional().default(''),
  nextWhen: z.string().optional().default(''),
  nextText: z.string().optional().default(''),
  /** Una visita o una llamada registradas piden el próximo paso, igual que completar una tarea. */
  askNext: z.boolean().optional().default(false),
  /** "Avisar a": persona con acceso al registro a quien le aparece el aviso en Hoy. Solo en notas. */
  notify: z.guid().or(z.literal('')).optional().default(''),
})
export type ActivityInput = z.input<typeof input>
export type Recorded = { id: string; kind: string; name: string; next: string | null; due: string | null }

/** Hasta cuántos días atrás se puede fechar una visita o una llamada que se captura después. */
export const BACKDATE_DAYS = 31
const CALL_RESULTS = ['reached', 'no_answer'] as const

/** ACT-01: notas, llamadas, reuniones, tareas y visitas son registros de primera clase en un solo hilo. */
export async function addActivity(ctx: Ctx, raw: ActivityInput): Promise<string> {
  return (await recordActivity(ctx, raw)).id
}

/**
 * Registra una actividad y, si se pide, su próximo paso, en una sola transacción.
 *
 * - Una visita con resultado es una visita hecha (E12.F1, E17.F1): lleva cómo terminó, el día en que fue y, opcional,
 *   quién visitó. Sin resultado y con fecha es una visita por hacer.
 * - Una llamada puede llevar su resultado (contactado o no contestó).
 * - Una visita o una llamada sobre un comercio con un solo negocio abierto quedan en ese negocio: así el negocio no
 *   sigue marcado "sin próximo paso" cuando el seguimiento se dejó desde la ficha.
 */
export async function recordActivity(ctx: Ctx, raw: ActivityInput): Promise<Recorded> {
  const parsed = input.safeParse(raw)
  if (!parsed.success) throw invalid('Escribe de qué se trata.', 'Say what this is about.')
  const v = parsed.data
  const logged = v.kind === 'visit' || v.kind === 'call'
  if (!logged && v.subject.length < 2) throw invalid('Escribe de qué se trata.', 'Say what this is about.')
  if (v.kind === 'task' && !v.dueAt) throw invalid('Una tarea necesita fecha.', 'A task needs a date.')
  if (!v.accountId && !v.dealId && !v.leadId) throw invalid('Liga la actividad a un comercio, negocio o lead.', 'Link the activity to a merchant, deal or lead.')
  if (v.outcome && !logged) throw invalid('Solo una visita o una llamada llevan resultado.', 'Only a visit or a call carries an outcome.')
  if (v.kind === 'visit' && v.outcome && !isOneOf(VISIT_RESULTS, v.outcome)) throw invalid('Elige cómo terminó la visita.', 'Choose how the visit ended.')
  if (v.kind === 'call' && v.outcome && !isOneOf(CALL_RESULTS, v.outcome)) throw invalid('Elige si hubo contacto o no contestó.', 'Choose whether you reached them or there was no answer.')
  // Una visita sin resultado todavía no pasa: necesita fecha, como cualquier cosa por hacer.
  const planned = v.kind === 'visit' && !v.outcome
  if (planned && !v.dueAt) throw invalid('Una visita por hacer necesita fecha. Si ya fuiste, regístrala con el botón Visita.', 'A planned visit needs a date. If you already went, log it with the Visit button.')
  if (v.on && (planned || !logged)) throw invalid('Solo una visita o una llamada ya hechas llevan el día en que pasaron.', 'Only a visit or a call already made carries the day it happened.')
  if (v.on && !/^\d{4}-\d{2}-\d{2}$/.test(v.on)) throw invalid('Elige el día en que pasó.', 'Choose the day it happened.')
  if (v.next && !isOneOf(NEXTS, v.next)) throw invalid('Elige qué sigue. Si ya no hay nada más que hacer, elige cerrar.', 'Choose what comes next. If there is nothing left to do, choose close.')
  if (v.askNext && logged && !planned && !v.next) throw invalid('Elige qué sigue. Si ya no hay nada más que hacer, elige cerrar.', 'Choose what comes next. If there is nothing left to do, choose close.')
  const next = isOneOf(NEXTS, v.next) && v.next !== 'none' ? v.next : null
  const text = next === 'task' ? nextText(v.nextText) : null
  const visitor = v.kind === 'visit' && !planned ? visitorName(v.visitedBy) : null
  assertNoProhibited(v.subject, v.body)

  return withUser(ctx.user.id, async (tx) => {
    // Cada registro al que se liga la actividad tiene que ser visible para la persona (RLS) y del mismo mercado.
    // Validar solo uno dejaba escribir en el lead o el negocio de otro mercado con solo conocer su id.
    let market: string | undefined
    let accountId = v.accountId ?? null
    let dealId = v.dealId ?? null
    let name = ''
    const same = (m: string) => {
      if (market && market !== m) throw notFound()
      market = m
    }
    if (dealId) {
      const d = await tx<{ market_code: string; account_id: string }[]>`select market_code, account_id from crm.deals where id = ${dealId}`
      if (!d[0]) throw notFound()
      if (accountId && accountId !== d[0].account_id) throw notFound()
      same(d[0].market_code)
      accountId = d[0].account_id
    }
    if (accountId) {
      const a = await tx<{ market_code: string; name: string }[]>`select market_code, name from crm.accounts where id = ${accountId}`
      if (!a[0]) throw notFound()
      same(a[0].market_code)
      name = a[0].name
    }
    if (v.leadId) {
      const l = await tx<{ market_code: string; business_name: string }[]>`select market_code, business_name from crm.leads where id = ${v.leadId}`
      if (!l[0]) throw notFound()
      same(l[0].market_code)
      name = name || l[0].business_name
    }
    ctx.assert('activity.write', market)
    const tz = ctx.market(market!).timezone
    if (logged && accountId && !dealId) {
      const open = await tx<{ id: string }[]>`select id from crm.deals where account_id = ${accountId} and status = 'open' limit 2`
      if (open.length === 1) dealId = open[0]!.id
    }
    if (v.on) {
      const ok = await tx<{ ok: boolean }[]>`
        select ${v.on}::date <= (now() at time zone ${tz})::date and ${v.on}::date >= (now() at time zone ${tz})::date - ${BACKDATE_DAYS}::int as ok`
      if (!ok[0]?.ok) throw invalid(`El día tiene que ser de hoy hacia atrás, hasta ${BACKDATE_DAYS} días.`, `The day must be today or earlier, up to ${BACKDATE_DAYS} days back.`)
    }
    const when = next ? await assertNextDate(tx, tz, v.nextWhen) : null
    const noSale = v.kind === 'visit' && v.outcome === 'no_sale' ? await assertNoSaleReason(tx, market!, v.noSaleReason) : null
    const purpose = v.kind === 'visit' && !planned ? await assertVisitReason(tx, market!, v.visitReason) : null

    const id = await newId(tx)
    const subject = v.subject || ctx.m(v.kind === 'visit' ? (planned ? 'complete.nextTitle.visit' : 'log.subject.visit') : 'log.subject.call', { name })
    const due = v.dueAt ? (v.dueAt.length === 10 ? `${v.dueAt}T15:00:00Z` : v.dueAt) : null
    // Lo que ya pasó queda con su fecha: ahora, o el mediodía del día elegido en la zona del mercado (no tiene hora).
    const done = v.kind === 'task' || planned ? null : v.on ? tx`case when ${v.on}::date = (now() at time zone ${tz})::date then now() else (${v.on}::date + time '12:00') at time zone ${tz} end` : tx`now()`
    await tx`insert into crm.activities (id, market_code, account_id, deal_id, lead_id, kind, subject, body, due_at, done_at, outcome, visited_by, no_sale_code, visit_reason, owner_id, created_by)
             values (${id}, ${market!}, ${accountId}, ${dealId}, ${v.leadId ?? null}, ${v.kind}, ${subject}, ${clean(v.body)},
                     ${due}, ${done}, ${v.outcome || null}, ${visitor}, ${noSale}, ${purpose}, ${ctx.user.id}, ${ctx.user.id})`
    if (v.kind === 'visit' && !planned) await closePlannedVisits(tx, accountId, ctx.user.id, id)
    await audit(tx, ctx, 'activity.added', 'activity', id, market!, null, {
      kind: v.kind, account_id: accountId, ...(v.outcome ? { outcome: v.outcome } : {}), ...(v.kind === 'visit' && !planned ? { origin: 'manual', on: v.on || null, visited_by: visitor, ...(noSale ? { no_sale_reason: noSale } : {}), ...(purpose ? { visit_reason: purpose } : {}) } : {}),
    })
    if (v.kind === 'visit' && isOneOf(VISIT_RESULTS, v.outcome)) await applyVisitOutcome(tx, ctx, { market: market!, accountId, outcome: v.outcome, day: v.on || null, returnOn: when })
    if (v.notify) {
      if (v.kind !== 'note' || !accountId) throw invalid('Solo se avisa desde una nota de un comercio o de un negocio.', 'You can only notify from a note on a merchant or a deal.')
      await notifyFromNote(tx, ctx, { market: market!, userId: v.notify, accountId, dealId, activityId: id, body: [subject, clean(v.body)].filter(Boolean).join('. ') })
    }

    if (!next || !when) return { id, kind: v.kind, name, next: null, due: null }
    const step = await scheduleNext(tx, ctx, { market: market!, accountId, dealId, leadId: v.leadId ?? null, name, next, when, text, follows: id })
    return { id, kind: v.kind, name, next: step, due: when }
  })
}
