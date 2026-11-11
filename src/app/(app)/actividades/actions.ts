'use server'

import { runAction, str } from '@/server/action'
import { addActivity, completeTask } from '@/domain/activities'
import type { ActionResult } from '@/lib/errors'

export async function completeTaskAction(_: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await completeTask(ctx, str(fd, 'id'))
  })
}

export async function addActivityAction(_: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    const kind = str(fd, 'kind') as 'note' | 'call' | 'meeting' | 'task'
    await addActivity(ctx, {
      accountId: str(fd, 'account_id') || undefined,
      dealId: str(fd, 'deal_id') || undefined,
      leadId: str(fd, 'lead_id') || undefined,
      kind,
      subject: str(fd, 'subject'),
      body: str(fd, 'body'),
      dueAt: str(fd, 'due_at'),
    })
    return { message: ['Guardado en el timeline.', 'Saved to the timeline.'] }
  })
}
