'use server'

import { runAction, str } from '@/server/action'
import { setMarketHours } from '@/domain/lead-hours'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

/** Horario hábil de un mercado: dentro de él corre el reloj de primer contacto de los leads. */
export async function setMarketHoursAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setMarketHours(ctx, {
      market: str(fd, 'market'),
      days: fd.getAll('day').map((d) => Number(d)).filter((d) => Number.isInteger(d)),
      opens: str(fd, 'opens'),
      closes: str(fd, 'closes'),
    })
    return { message: ['Horario guardado. Vale para los leads que entren desde ahora.', 'Hours saved. They apply to leads that come in from now on.'] }
  })
}
