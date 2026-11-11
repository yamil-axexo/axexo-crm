'use server'

import { runAction, str } from '@/server/action'
import { systemCtx } from '@/server/context'
import { resolveException, runRulesNow } from '@/domain/rules'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function resolveExceptionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await resolveException(ctx, str(fd, 'id'), str(fd, 'note'))
    return { message: ['Descartada. No reaparece por 7 días.', 'Dismissed. It will not reappear for 7 days.'] }
  })
}

export async function runRulesAction(_: R | null, _fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await runRulesNow(ctx, await systemCtx())
    return { message: [`Reglas evaluadas: ${out.opened} nuevas, ${out.closed} resueltas solas.`, `Rules evaluated: ${out.opened} new, ${out.closed} cleared on their own.`] }
  })
}
