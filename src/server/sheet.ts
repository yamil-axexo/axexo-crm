import 'server-only'
import type { Ctx } from '@/server/context'
import { NEXTS, OPS_RESULTS, VISIT_RESULTS, type OpsResult, type Result, type VisitResult } from '@/domain/queue'
import { NEXT_SETS, opsVoice } from '@/domain/followup'
import { BACKDATE_DAYS } from '@/domain/activities'
import { addDays, isoDay, weekday } from '@/lib/format'
import type { MessageKey } from '@/lib/messages'
import type { SheetConfig, SheetItem } from '@/ui/complete'
import type { LogConfig } from '@/ui/log'

// Quien es de Operaciones y no vende: la hoja le habla de documentos, proveedores y capacitación, no de llamadas y propuestas.
// La regla vive en el dominio (followup.ts), que valida la misma lista al guardar.
export { opsVoice }

/** Textos y opciones de la hoja "Completar" en el idioma y la zona horaria de quien la abre. */
export function sheetConfig(ctx: Ctx, now = new Date()): SheetConfig {
  const { m, locale } = ctx
  const today = isoDay(now, ctx.markets[0]?.timezone ?? 'UTC')
  const tomorrow = addDays(today, 1)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const monday = addDays(today, (8 - dow) % 7 || 7)
  return {
    labels: {
      complete: m('complete.title'), result: m('complete.result'), next: m('complete.next'), when: m('complete.when'), save: m('complete.save'),
      saveClose: m('complete.saveClose'), cancel: m('action.cancel'), missingNext: m('complete.missingNext'), other: m('complete.when.other'), markDone: m('action.markDone'),
      completeOf: m('action.completeOf', { title: '%s' }), afterCall: m('complete.afterCall', { name: '%s' }),
      note: ctx.t('Nota (opcional)', 'Note (optional)'), nextText: ctx.t('¿Qué sigue? Escríbelo', 'What comes next? Write it'),
      visitedBy: ctx.t('¿Quién visitó? (opcional)', 'Who visited? (optional)'), visitedByHint: ctx.t('Si no fuiste tú, escribe su nombre', 'If it was not you, write their name'),
    },
    // Una sola hoja: todas las opciones con su texto, y la lista que toca la decide quién completa (Operaciones) o el tipo de venta.
    nextOptions: NEXTS.map((n) => ({ value: n, label: m(`complete.next.${n}` as MessageKey) })),
    nextSets: { default: [...NEXT_SETS.default], b2b: [...NEXT_SETS.b2b], ops: [...NEXT_SETS.ops] },
    voice: opsVoice(ctx) ? 'ops' : 'sales',
    whenOptions: [
      { value: today, label: m('complete.when.today') },
      { value: tomorrow, label: m('complete.when.tomorrow') },
      // Atajos seguidos (hoy, mañana, pasado mañana) y el lunes siguiente. El domingo no se propone: se elige con "Otra fecha".
      ...(dow !== 5 ? [{ value: addDays(today, 2), label: weekday(addDays(today, 2), locale) }] : []),
      ...(monday !== tomorrow && monday !== addDays(today, 2) ? [{ value: monday, label: weekday(monday, locale) }] : []),
    ],
    defaultWhen: tomorrow,
    minDate: today,
  }
}

export const resultOptions = (ctx: Ctx, keys: readonly (Result | VisitResult | OpsResult)[]) => keys.map((k) => ({ value: k, label: ctx.m(`complete.result.${k}` as MessageKey) }))

/**
 * Cómo se completa una tarea según lo que es: una visita por hacer pregunta cómo terminó la visita (hubo venta o alta,
 * no hubo, volver con quien decide) y no trae respuesta elegida; lo demás conserva los resultados de siempre.
 */
export const taskResults = (ctx: Ctx, kind: string): Pick<SheetItem, 'results' | 'defaultResult' | 'visit'> =>
  kind === 'visit'
    ? { results: resultOptions(ctx, VISIT_RESULTS), defaultResult: null, visit: true }
    : opsVoice(ctx)
      ? { results: resultOptions(ctx, OPS_RESULTS), defaultResult: null }
      : { results: resultOptions(ctx, ['done', 'reached', 'no_answer', 'later']), defaultResult: 'done' }

/** Una tarea abierta como registro que la hoja puede completar. */
export const taskItem = (ctx: Ctx, task: { id: string; subject: string; kind?: string }, name: string, motor?: string | null): SheetItem => ({
  type: 'task', id: task.id, title: task.subject, name, motor, ...taskResults(ctx, task.kind ?? 'task'),
})

/** Textos y opciones de la hoja "Registrar actividad" (dock, ficha y al volver de una llamada). */
export function logConfig(ctx: Ctx, now = new Date()): LogConfig {
  const { t } = ctx
  const sheet = sheetConfig(ctx, now)
  return {
    sheet,
    labels: {
      title: t('Registrar actividad', 'Log activity'),
      kind: t('¿Qué registras?', 'What are you logging?'),
      kinds: { visit: t('Visita', 'Visit'), call: t('Llamada', 'Call'), note: t('Nota', 'Note') },
      merchant: t('¿Con qué comercio?', 'Which merchant?'),
      search: t('Nombre o teléfono', 'Name or phone'),
      recent: t('Tus últimos comercios', 'Your latest merchants'),
      results: t('Resultados', 'Results'),
      searching: t('Buscando…', 'Searching…'),
      noResults: t('No aparece entre tus comercios. Prueba con menos letras o con el teléfono.', 'It is not among your merchants. Try fewer letters or the phone number.'),
      change: t('Cambiar', 'Change'),
      on: t('¿Cuándo fue?', 'When was it?'),
      yesterday: t('Ayer', 'Yesterday'),
      what: t('¿Qué pasó?', 'What happened?'),
      missingMerchant: t('Elige el comercio para poder guardar.', 'Choose the merchant to save.'),
      missingResult: t('Elige cómo te fue para poder guardar.', 'Choose how it went to save.'),
      missingDay: t('Elige el día de la visita para poder guardar.', 'Choose the day of the visit to save.'),
      notify: t('Avisar a (opcional): le aparece en Hoy', 'Notify (optional): it shows in their Today'),
      notifyNone: t('Nadie', 'Nobody'),
    },
    visitResults: resultOptions(ctx, VISIT_RESULTS),
    callResults: resultOptions(ctx, ['reached', 'no_answer']),
    today: sheet.minDate,
    yesterday: addDays(sheet.minDate, -1),
    earliest: addDays(sheet.minDate, -BACKDATE_DAYS),
  }
}
