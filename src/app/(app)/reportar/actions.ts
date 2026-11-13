'use server'

import { runAction, str } from '@/server/action'
import { answerReport, createReport, takeReport } from '@/domain/problem-reports'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function createReportAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createReport(ctx, { kind: str(fd, 'kind'), urgency: str(fd, 'urgency'), body: str(fd, 'body'), screen: str(fd, 'screen') })
    return { message: ['Recibido. Lo ve administración y su respuesta te aparece aquí abajo, en tus reportes, y en tu campana de avisos.', 'Received. Administration sees it and the answer will show below, in your reports, and in your notice bell.'], revalidate: ['/reportar', '/admin'] }
  })
}

export async function takeReportAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await takeReport(ctx, str(fd, 'id'))
    return { message: ['Quedó en revisión. Quien reportó ya lo ve.', 'It is now under review. The person who reported can see it.'], revalidate: ['/reportar', '/admin'] }
  })
}

export async function answerReportAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await answerReport(ctx, str(fd, 'id'), str(fd, 'answer'))
    return { message: ['Respondido y marcado como atendido. Quien reportó ya ve tu respuesta.', 'Answered and marked as handled. The person who reported can see your answer now.'], revalidate: ['/reportar', '/admin'] }
  })
}
