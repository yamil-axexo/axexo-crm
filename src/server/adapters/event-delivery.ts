import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { deliverEvent } from './live/providers'
import { errorCode } from './live/http'

/**
 * AUT-02: entrega de eventos a suscriptores. Adaptador APAGADO por defecto: no llama a nada y el evento queda
 * "listo para publicar". `simulated` solo existe en pruebas (APP_ENV=test): anota lo que habría salido.
 * La entrega real por HTTP no está escrita a propósito: se agrega aquí cuando P&T apruebe el transporte
 * (Tech Implementation Review) y se enciende con CONTIGO_EVENT_DELIVERY.
 */
export type DeliveryRequest = { destination: string; body: string; headers: Record<string, string> }
export type DeliveryResult = { kind: 'off' } | { kind: 'ok'; status: number } | { kind: 'failed'; error: string }
export type DeliveryMode = ConnectorMode
/** `live`: CONTIGO_EVENT_DELIVERY=live, la llave de firma (CONTIGO_EVENT_SIGNING_KEY) y la aprobación. Solo sale por HTTPS a
 * direcciones públicas (nunca a una IP, a localhost ni a una red interna). */
export const EVENT_DELIVERY_GATE = { envVar: 'CONTIGO_EVENT_DELIVERY', credentials: ['CONTIGO_EVENT_SIGNING_KEY'] } as const
export interface EventDeliveryAdapter {
  mode: DeliveryMode
  deliver(req: DeliveryRequest): Promise<DeliveryResult>
}

/** Lo que el adaptador simulado habría mandado, para que las pruebas lo revisen. */
export const simulatedDeliveries: DeliveryRequest[] = []

const off: EventDeliveryAdapter = { mode: 'off', deliver: async () => ({ kind: 'off' }) }
const simulated: EventDeliveryAdapter = {
  mode: 'simulated',
  deliver: async (req) => {
    simulatedDeliveries.push(req)
    // Un destino cuyo nombre empieza con "fail." simula a un suscriptor caído.
    if (new URL(req.destination).hostname.startsWith('fail.')) return { kind: 'failed', error: 'simulated: 503' }
    return { kind: 'ok', status: 200 }
  },
}

const live: EventDeliveryAdapter = {
  mode: 'live',
  deliver: async (req) => {
    try {
      return { kind: 'ok', status: await deliverEvent(req.destination, req.body, req.headers) }
    } catch (e) {
      return { kind: 'failed', error: errorCode(e) }
    }
  },
}

export function deliveryMode(): DeliveryMode {
  return gate(EVENT_DELIVERY_GATE).mode
}
export const eventDelivery = (): EventDeliveryAdapter => {
  const m = deliveryMode()
  return m === 'live' ? live : m === 'simulated' ? simulated : off
}

/** Llave del servidor para firmar. Sin ella no se firma ni se muestra ningún secreto. En pruebas hay una fija. */
export function signingKey(): string | null {
  const k = process.env.CONTIGO_EVENT_SIGNING_KEY
  if (k && k.length >= 32) return k
  return process.env.APP_ENV === 'test' ? 'test-only-signing-key-not-a-secret-000' : null
}
