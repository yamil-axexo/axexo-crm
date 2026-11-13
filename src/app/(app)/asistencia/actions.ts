'use server'

import { runAction, str } from '@/server/action'
import { acceptRecommendation, confirmLeadClass, decideDraft, dismissRecommendation } from '@/domain/ia/commands'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>
const PATHS = ['/asistencia', '/hoy', '/comercios', '/leads']

export async function acceptRecommendationAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await acceptRecommendation(ctx, str(fd, 'id'), str(fd, 'due_on'))
    return { message: ['Listo: quedó la tarea con su fecha en Hoy.', 'Done: the task is in Today with its date.'], revalidate: [...PATHS, `/comercios/${str(fd, 'account_id')}`] }
  })
}

export async function dismissRecommendationAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await dismissRecommendation(ctx, str(fd, 'id'), { code: str(fd, 'code') as never, note: str(fd, 'note') })
    return { message: ['Sugerencia descartada. El motivo queda para medir qué tan útiles son.', 'Suggestion dismissed. The reason is kept to measure how useful they are.'], revalidate: [...PATHS, `/comercios/${str(fd, 'account_id')}`] }
  })
}

export async function decideDraftAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const approve = str(fd, 'decision') === 'approve'
    await decideDraft(ctx, str(fd, 'id'), { approve, subject: str(fd, 'subject'), dueOn: str(fd, 'due_on'), note: str(fd, 'note') })
    return { message: approve ? ['Aprobado: la tarea ya está en Hoy.', 'Approved: the task is now in Today.'] : ['Borrador rechazado, con su motivo.', 'Draft rejected, with its reason.'], revalidate: PATHS }
  })
}

export async function confirmLeadClassAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await confirmLeadClass(ctx, str(fd, 'lead_id'), str(fd, 'cls'))
    return { message: ['Clasificación confirmada.', 'Classification confirmed.'], revalidate: [`/leads/${str(fd, 'lead_id')}`, '/leads'] }
  })
}
