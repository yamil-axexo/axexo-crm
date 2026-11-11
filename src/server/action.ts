import 'server-only'
import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import { requireCtx, type Ctx } from '@/server/context'
import { DomainError, type ActionResult } from '@/lib/errors'

type Outcome<T> = { data?: T; message?: [es: string, en: string]; revalidate?: string[] } | void

/**
 * SEC-02: toda acción de servidor pasa por aquí: autentica, deja que el dominio autorice y valide,
 * y traduce los errores a un mensaje para la persona, sin filtrar detalles internos (OBS-01).
 */
export async function runAction<T = undefined>(fn: (ctx: Ctx) => Promise<Outcome<T>>): Promise<ActionResult<T>> {
  const ctx = await requireCtx()
  try {
    const out = (await fn(ctx)) ?? {}
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
    console.error(JSON.stringify({ level: 'error', msg: 'action_failed', code: pg?.code ?? null, name: pg?.name ?? 'Error' }))
    return { ok: false, code: 'error', error: ctx.t('Algo falló de nuestro lado. Intenta otra vez.', 'Something failed on our side. Try again.') }
  }
}

export const str = (fd: FormData, key: string): string => {
  const v = fd.get(key)
  return typeof v === 'string' ? v : ''
}
