import 'server-only'

/**
 * SEG-10: verificación anti-bot de los formularios públicos. Adaptador APAGADO por defecto: no llama a ningún
 * servicio y deja pasar (las otras defensas siguen: límite por IP, tiempo mínimo, campo trampa, llave de la página).
 * `simulated` solo existe en pruebas. El servicio real (por ejemplo un desafío en el navegador) necesita aprobación
 * de Tech Implementation Review y se enciende con CONTIGO_ANTIBOT.
 */
export type AntibotMode = 'off' | 'simulated'
export type AntibotResult = { ok: boolean; checked: boolean }
export interface AntibotAdapter {
  mode: AntibotMode
  verify(token: string | null, ipHash: string): Promise<AntibotResult>
}

const off: AntibotAdapter = { mode: 'off', verify: async () => ({ ok: true, checked: false }) }
// En pruebas: el token "bot" no pasa; cualquier otro (o ninguno) sí.
const simulated: AntibotAdapter = { mode: 'simulated', verify: async (token) => ({ ok: token !== 'bot', checked: true }) }

export function antibotMode(): AntibotMode {
  return process.env.CONTIGO_ANTIBOT === 'simulated' && process.env.APP_ENV === 'test' ? 'simulated' : 'off'
}
export const antibot = (): AntibotAdapter => (antibotMode() === 'simulated' ? simulated : off)
