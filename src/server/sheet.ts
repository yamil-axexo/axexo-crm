import 'server-only'
import type { Ctx } from '@/server/context'
import { NEXTS, type Result } from '@/domain/queue'
import { addDays, isoDay, weekday } from '@/lib/format'
import type { MessageKey } from '@/lib/messages'
import type { SheetConfig, SheetItem } from '@/ui/complete'

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
    },
    nextOptions: NEXTS.map((n) => ({ value: n, label: m(`complete.next.${n}` as MessageKey) })),
    whenOptions: [
      { value: today, label: m('complete.when.today') },
      { value: tomorrow, label: m('complete.when.tomorrow') },
      { value: addDays(today, 3), label: weekday(addDays(today, 3), locale) },
      ...(monday !== tomorrow && monday !== addDays(today, 3) ? [{ value: monday, label: weekday(monday, locale) }] : []),
    ],
    defaultWhen: tomorrow,
    minDate: today,
  }
}

export const resultOptions = (ctx: Ctx, keys: Result[]) => keys.map((k) => ({ value: k, label: ctx.m(`complete.result.${k}` as MessageKey) }))

/** Una tarea abierta como registro que la hoja puede completar. */
export const taskItem = (ctx: Ctx, task: { id: string; subject: string }, name: string): SheetItem => ({
  type: 'task', id: task.id, title: task.subject, name, results: resultOptions(ctx, ['done', 'reached', 'no_answer', 'later']), defaultResult: 'done',
})
