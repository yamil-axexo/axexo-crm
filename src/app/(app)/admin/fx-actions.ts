'use server'

import { runAction, str } from '@/server/action'
import { setFxRate } from '@/domain/reports'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function setFxRateAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setFxRate(ctx, { currency: str(fd, 'currency'), asOf: str(fd, 'as_of'), rate: str(fd, 'rate'), source: str(fd, 'source') })
    return { message: ['Tasa guardada. El Panel del LT ya la usa si es la de fecha más reciente.', 'Rate saved. The leadership panel already uses it if it is the most recently dated one.'] }
  })
}
