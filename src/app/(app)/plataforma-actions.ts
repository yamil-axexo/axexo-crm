'use server'
import { runAction, str } from '@/server/action'
import type { ActionResult } from '@/lib/errors'
import { revealReserved, setReserved, type RecordObject } from '@/domain/plataforma/sensitive'

type R = ActionResult<unknown>
const object = (fd: FormData): RecordObject => (str(fd, 'object') === 'contact' ? 'contact' : 'deal')

/** SEG-02: datos reservados de un negocio o un contacto. */
export async function setReservedAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setReserved(ctx, object(fd), str(fd, 'id'), str(fd, 'key'), str(fd, 'value'))
    return { message: ['Guardado. Queda tapado; verlo pide motivo y queda en la bitácora.', 'Saved. It stays masked; seeing it asks for a reason and is logged.'] }
  })
}

export async function revealReservedAction(_: R | null, fd: FormData): Promise<R> {
  return runAction<string>(async (ctx) => {
    const value = await revealReserved(ctx, object(fd), str(fd, 'id'), str(fd, 'key'), str(fd, 'reason'))
    return { data: value ?? ctx.t('Sin dato', 'No value'), revalidate: [] }
  })
}
