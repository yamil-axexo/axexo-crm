'use server'

import { revalidatePath } from 'next/cache'
import { systemCtx } from '@/server/context'
import { onboardingLinkReceive, onboardingLinkSubmit } from '@/domain/campo-canal/expediente'
import { DomainError, type ActionResult } from '@/lib/errors'
import { translator } from '@/lib/format'

type R = ActionResult<unknown>
const tr = (fd: FormData) => translator(fd.get('locale') === 'en' ? 'en' : 'es')
const fail = (fd: FormData, e: unknown): R => {
  const t = tr(fd)
  if (e instanceof DomainError) return { ok: false, code: e.code, error: t(e.es, e.en) }
  return { ok: false, code: 'error', error: t('No pudimos guardar. Intenta otra vez.', 'We could not save. Try again.') }
}

/** Enlace de captura: sin sesión, la llave es el código del enlace. Corre como sistema y solo toca ese expediente. */
export async function linkReceiveAction(_: R | null, fd: FormData): Promise<R> {
  const token = String(fd.get('token') ?? '')
  try {
    await onboardingLinkReceive(await systemCtx(), token, String(fd.get('doc') ?? ''), String(fd.get('link') ?? ''))
    revalidatePath(`/e/${token}`)
    return { ok: true, message: tr(fd)('Guardado.', 'Saved.') }
  } catch (e) {
    return fail(fd, e)
  }
}
export async function linkSubmitAction(_: R | null, fd: FormData): Promise<R> {
  const token = String(fd.get('token') ?? '')
  try {
    await onboardingLinkSubmit(await systemCtx(), token)
    revalidatePath(`/e/${token}`)
    return { ok: true, message: tr(fd)('Enviado. Te avisamos si falta algo.', 'Sent. We will let you know if anything is missing.') }
  } catch (e) {
    return fail(fd, e)
  }
}
