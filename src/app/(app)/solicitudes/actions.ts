'use server'

import { runAction, str } from '@/server/action'
import { createConfigRequest } from '@/domain/gobierno'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function createRequestAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createConfigRequest(ctx, { kind: str(fd, 'kind') as 'field', title: str(fd, 'title'), purpose: str(fd, 'purpose'), market: str(fd, 'market'), options: str(fd, 'options') })
    return { message: ['Recibida. Administración la revisa y su decisión te aparece aquí abajo.', 'Received. Administration reviews it and the decision will show below.'], revalidate: ['/solicitudes', '/admin/gobierno'] }
  })
}
