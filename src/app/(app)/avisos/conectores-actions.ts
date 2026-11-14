'use server'

import { runAction } from '@/server/action'
import { removePushSubscriptions, savePushSubscription } from '@/domain/conectores/push'
import { setMyCapture } from '@/domain/conectores/capture'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

/** AUT-05: guarda la suscripción de push de este navegador. */
export async function savePushAction(sub: { endpoint: string; p256dh: string; auth: string }): Promise<R> {
  return runAction(async (ctx) => {
    await savePushSubscription(ctx, sub)
    return { message: ['Avisos del navegador activados.', 'Browser notices turned on.'], revalidate: ['/avisos/preferencias'] }
  })
}
export async function removePushAction(): Promise<R> {
  return runAction(async (ctx) => {
    await removePushSubscriptions(ctx)
    return { message: ['Avisos del navegador apagados.', 'Browser notices turned off.'], revalidate: ['/avisos/preferencias'] }
  })
}
/** ACT-03: encender o apagar la captura de mi correo y mi calendario. */
export async function saveCaptureAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setMyCapture(ctx, { gmail: fd.get('gmail') === 'on', calendar: fd.get('calendar') === 'on' })
    return { message: ['Captura guardada.', 'Capture saved.'], revalidate: ['/avisos/preferencias'] }
  })
}
