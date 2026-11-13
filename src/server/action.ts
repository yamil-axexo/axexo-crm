import 'server-only'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { ZodError } from 'zod'
import { requireCtx, type Ctx } from '@/server/context'
import { runVia } from '@/server/db'
import { DomainError, type ActionResult } from '@/lib/errors'
import { cleanRequestId, shortRef, withRequestId } from '@/server/request-id'
import { recordError, recordRequest } from '@/server/telemetry'
import { screenKey } from '@/lib/screen-key'

type Outcome<T> = { data?: T; message?: [es: string, en: string]; revalidate?: string[] } | void

/**
 * SEC-02: toda acción de servidor pasa por aquí: autentica, deja que el dominio autorice y valide,
 * y traduce los errores a un mensaje para la persona, sin filtrar detalles internos (OBS-01).
 */
export async function runAction<T = undefined>(fn: (ctx: Ctx) => Promise<Outcome<T>>): Promise<ActionResult<T>> {
  const ctx = await requireCtx()
  // SEG-07: quien está viendo como otra persona mira, no cambia. Toda acción pasa por aquí, así que aquí se corta.
  if (ctx.viewAs) {
    return { ok: false, code: 'forbidden', error: ctx.t('Estás viendo CONTIGO como otra persona: desde aquí no se cambia nada. Termina "Ver como" para volver a tu cuenta.', 'You are viewing CONTIGO as someone else: nothing can be changed from here. End "View as" to go back to your account.') }
  }
  // GOB-07: la acción corre con el identificador de su petición (queda en la bitácora) y suma a la medición de su pantalla.
  const h = await headers()
  const requestId = cleanRequestId(h.get('x-request-id'))
  const screen = screenKey(h.get('referer'))
  const started = Date.now()
  let failed = false
  try {
    const out = (await withRequestId(requestId, () => runVia('screen', () => fn(ctx)))) ?? {}
    for (const p of out.revalidate ?? ['/', 'layout']) {
      if (p === 'layout') revalidatePath('/', 'layout')
      else revalidatePath(p)
    }
    return { ok: true, data: out.data, message: out.message ? ctx.t(out.message[0], out.message[1]) : undefined }
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, code: e.code, error: ctx.t(e.es, e.en) }
    if (e instanceof ZodError) return { ok: false, code: 'invalid', error: ctx.t('Revisa los datos e intenta de nuevo.', 'Check the fields and try again.') }
    const pg = e as { code?: string; name?: string }
    if (pg?.code === '42501') return { ok: false, code: 'forbidden', error: ctx.t('No tienes permiso para hacer esto.', 'You do not have permission to do this.') }
    if (pg?.code === '23505') return { ok: false, code: 'conflict', error: ctx.t('Ese registro ya existe.', 'That record already exists.') }
    failed = true
    console.error(JSON.stringify({ level: 'error', msg: 'action_failed', code: pg?.code ?? null, name: pg?.name ?? 'Error', request_id: requestId, screen }))
    await recordError('action', screen, requestId, pg?.name ?? 'Error', pg?.code ?? null)
    // La referencia es el inicio del identificador de la petición: con ella administración encuentra el error en Estado de CONTIGO.
    return { ok: false, code: 'error', error: ctx.t(`Algo falló de nuestro lado. Intenta otra vez. Referencia: ${shortRef(requestId)}`, `Something failed on our side. Try again. Reference: ${shortRef(requestId)}`) }
  } finally {
    await recordRequest('action', screen, Date.now() - started, failed, requestId)
  }
}

export const str = (fd: FormData, key: string): string => {
  const v = fd.get(key)
  return typeof v === 'string' ? v : ''
}
