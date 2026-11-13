'use server'

import { runAction, str } from '@/server/action'
import { setDecision } from '@/domain/decisions'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function setDecisionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const confirmed = str(fd, 'confirmed') === 'yes'
    await setDecision(ctx, { key: str(fd, 'key'), market: str(fd, 'market') || null, value: str(fd, 'value'), confirmed, note: str(fd, 'note') })
    return { message: confirmed ? ['Guardado como decidido.', 'Saved as decided.'] : ['Guardado. Sigue como valor propuesto hasta que su dueño lo confirme.', 'Saved. It stays a proposed value until its owner confirms it.'] }
  })
}
