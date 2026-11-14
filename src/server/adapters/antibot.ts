import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { turnstileVerify } from './live/providers'

/**
 * SEG-10: verificación anti-bot de los formularios públicos. Adaptador APAGADO por defecto: no llama a ningún
 * servicio y deja pasar (las otras defensas siguen: límite por IP, tiempo mínimo, campo trampa, llave de la página).
 * `simulated` solo existe en pruebas. `live`: Cloudflare Turnstile (proveedor de referencia) con CONTIGO_ANTIBOT=live,
 * TURNSTILE_SECRET_KEY y TURNSTILE_SITE_KEY, y CONTIGO_ANTIBOT_APPROVAL con la referencia del sign-off.
 * Si el servicio no contesta, se deja pasar (las otras defensas siguen) y queda anotado como no revisado.
 */
export type AntibotMode = ConnectorMode
export type AntibotResult = { ok: boolean; checked: boolean }
export interface AntibotAdapter {
  mode: AntibotMode
  verify(token: string | null, ipHash: string): Promise<AntibotResult>
}
export const ANTIBOT_GATE = { envVar: 'CONTIGO_ANTIBOT', credentials: ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY'] } as const

const off: AntibotAdapter = { mode: 'off', verify: async () => ({ ok: true, checked: false }) }
// En pruebas: el token "bot" no pasa; cualquier otro (o ninguno) sí.
const simulated: AntibotAdapter = { mode: 'simulated', verify: async (token) => ({ ok: token !== 'bot', checked: true }) }
const live: AntibotAdapter = {
  mode: 'live',
  verify: async (token) => {
    if (!token) return { ok: false, checked: true }
    try {
      return { ok: await turnstileVerify(token.slice(0, 2048)), checked: true }
    } catch {
      return { ok: true, checked: false }
    }
  },
}

export function antibotMode(): AntibotMode {
  return gate(ANTIBOT_GATE).mode
}
/** La llave pública del desafío para el navegador; solo cuando el adaptador está encendido. */
export const antibotSiteKey = (): string | null => (antibotMode() === 'live' ? (process.env.TURNSTILE_SITE_KEY ?? null) : null)
export const antibot = (): AntibotAdapter => {
  const m = antibotMode()
  return m === 'live' ? live : m === 'simulated' ? simulated : off
}
