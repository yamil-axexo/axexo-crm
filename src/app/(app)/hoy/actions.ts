'use server'

import { runAction, str } from '@/server/action'
import { completeItem } from '@/domain/queue'
import { weekday } from '@/lib/format'
import type { ActionResult } from '@/lib/errors'

type Done = { toast: string }

/** Completar un registro de la cola: guarda el resultado y, salvo que se cierre, programa el próximo paso. */
export async function completeItemAction(_: ActionResult<Done> | null, fd: FormData): Promise<ActionResult<Done>> {
  return runAction<Done>(async (ctx) => {
    const done = await completeItem(ctx, {
      type: str(fd, 'type'), id: str(fd, 'id'), result: str(fd, 'result'), next: str(fd, 'next'), when: str(fd, 'when'),
      note: str(fd, 'note'), nextText: str(fd, 'next_text'), visitedBy: str(fd, 'visited_by'),
    })
    const toast = done.next ? ctx.m('complete.toast', { next: done.next, when: weekday(done.due, ctx.locale) }) : ctx.m('complete.toastClosed')
    return { data: { toast } }
  })
}
