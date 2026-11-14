import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { sendPush, type PushSubscription } from './live/providers'
import { errorCode } from './live/http'

/**
 * AUT-05 (canal): push web con VAPID (sin servicio intermedio). La persona activa el aviso en su navegador desde Avisos,
 * Preferencias; CONTIGO guarda la suscripción (crm.push_subscriptions) y manda el aviso cifrado de punta a punta.
 * `off` (por defecto): no manda nada y el botón para activar no aparece. `simulated` (solo pruebas): anota lo que habría salido.
 * `live`: WEB_PUSH_ADAPTER=live, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: de quien opera) y la aprobación.
 */
export const WEB_PUSH_GATE = { envVar: 'WEB_PUSH_ADAPTER', credentials: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] } as const
export type PushResult = 'off' | 'simulated' | 'sent' | 'gone' | 'failed'
const g = globalThis as unknown as { __contigoSimulatedPush?: { endpoint: string; title: string }[] }
export const simulatedPushes = () => (g.__contigoSimulatedPush ??= [])

export const webPushMode = (): ConnectorMode => gate(WEB_PUSH_GATE).mode
/** La llave pública para que el navegador se suscriba; solo cuando el canal está encendido. */
export const vapidPublicKey = (): string | null => (webPushMode() === 'live' ? (process.env.VAPID_PUBLIC_KEY ?? null) : null)

export async function pushTo(sub: PushSubscription, msg: { title: string; body: string; link: string | null }): Promise<{ result: PushResult; error?: string }> {
  const mode = webPushMode()
  if (mode === 'off') return { result: 'off' }
  if (mode === 'simulated') {
    simulatedPushes().push({ endpoint: sub.endpoint, title: msg.title })
    return { result: 'simulated' }
  }
  try {
    return { result: await sendPush(sub, msg) }
  } catch (e) {
    return { result: 'failed', error: errorCode(e) }
  }
}
