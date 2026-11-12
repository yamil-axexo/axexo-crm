import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'

/**
 * Reportar un problema o pedir algo (0017_problem_reports). Cualquier persona con acceso puede reportar, también quien
 * solo lee: el reporte es suyo, igual que su lista de primeros pasos, y no cambia ningún dato del negocio.
 * Responder es de administración ('report.manage'). La base repite los dos límites con RLS.
 */
export const REPORT_KINDS = ['problem', 'request'] as const
export const REPORT_URGENCIES = ['low', 'normal', 'high'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
export type ReportUrgency = (typeof REPORT_URGENCIES)[number]

const input = z.object({
  kind: z.enum(REPORT_KINDS),
  urgency: z.enum(REPORT_URGENCIES),
  body: z.string().trim().min(5).max(2000),
})

/** La pantalla donde estaba la persona: solo una ruta de la app, sin lo que venga después del "?" (puede traer búsquedas). */
export function screenPath(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().split(/[?#]/)[0] ?? ''
  if (!/^\/[A-Za-z0-9/_-]{0,180}$/.test(v) || v.startsWith('//')) return null
  // Los identificadores no dicen nada a quien lee el reporte: /deals/<id> queda como /deals.
  return v.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}$/i, '') || '/'
}

export async function createReport(ctx: Ctx, raw: { kind: string; urgency: string; body: string; screen?: string | null }): Promise<string> {
  const parsed = input.safeParse(raw)
  if (!parsed.success) throw invalid('Cuéntanos qué pasó con al menos unas palabras y elige qué tan urgente es.', 'Tell us what happened in at least a few words and choose how urgent it is.')
  const { kind, urgency, body } = parsed.data
  assertNoProhibited(body)
  const screen = screenPath(raw.screen)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into crm.problem_reports (user_id, kind, body, screen, urgency)
      values (${ctx.user.id}, ${kind}, ${body}, ${screen}, ${urgency}) returning id`
    const id = rows[0]!.id
    // El texto del reporte no se copia a la bitácora: ahí queda quién, qué tipo, desde dónde y con qué urgencia.
    await audit(tx, ctx, 'report.created', 'problem_report', id, null, null, { kind, urgency, screen })
    return id
  })
}

export async function answerReport(ctx: Ctx, id: string, rawAnswer: string): Promise<void> {
  ctx.assert('report.manage')
  const answer = clean(rawAnswer)
  if (!answer || answer.length < 2 || answer.length > 2000) throw invalid('Escribe la respuesta para quien reportó.', 'Write the answer for the person who reported.')
  assertNoProhibited(answer)
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No encontramos ese reporte.', 'We could not find that report.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ status: string; user_id: string }[]>`select status, user_id from crm.problem_reports where id = ${id} for update`
    const r = rows[0]
    if (!r) throw notFound('No encontramos ese reporte.', 'We could not find that report.')
    await tx`update crm.problem_reports set status = 'answered', answer = ${answer}, answered_by = ${ctx.user.id}, answered_at = now() where id = ${id}`
    await audit(tx, ctx, 'report.answered', 'problem_report', id, null, { status: r.status }, { status: 'answered', reporter: r.user_id })
  })
}
