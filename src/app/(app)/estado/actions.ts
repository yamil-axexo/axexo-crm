'use server'

import { runAction, str } from '@/server/action'
import { configureLoad, setLoadWindow } from '@/domain/data-loads'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

/** E5.F3: responsable y hora esperada de una carga. */
export async function configureLoadAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await configureLoad(ctx, {
      key: str(fd, 'key') as 'pipedrive',
      owner: str(fd, 'owner') || null,
      expectedBy: str(fd, 'expected_by') || null,
      clockMarket: str(fd, 'clock_market') || null,
    })
    return { message: ['Carga guardada.', 'Load saved.'], revalidate: ['/estado'] }
  })
}

/** E5.F4: ventana diaria sin cargas de un mercado. */
export async function setLoadWindowAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setLoadWindow(ctx, { market: str(fd, 'market'), starts: str(fd, 'starts'), ends: str(fd, 'ends'), active: fd.get('active') === 'on' })
    return { revalidate: ['/estado'], message: ['Ventana guardada. Mientras dure no corre ninguna carga del mercado.', 'Window saved. While it lasts no load of the market runs.'] }
  })
}
