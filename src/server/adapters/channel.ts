import 'server-only'
import type { Channel } from '@/lib/notice-kinds'

/**
 * Canal de salida hacia afuera de CONTIGO (correo, Slack, WhatsApp). Cada canal tiene dos implementaciones:
 * `off` (por defecto): no llama a nada; el mensaje queda en la cola con estado "Canal apagado".
 * `simulated` (solo con APP_ENV=test): anota lo que habría salido, para las pruebas.
 * No hay implementación real: conectar un proveedor pasa primero por la revisión de tecnología.
 */
export type OutboundMessage = { to: string; subject: string; body: string }
export type SendResult = { status: 'queued_off' | 'simulated' }
export type ChannelAdapter = {
  channel: Exclude<Channel, 'in_app'>
  mode: 'off' | 'simulated'
  /** La variable de entorno que lo enciende. */
  envVar: string
  send: (msg: OutboundMessage) => Promise<SendResult>
}

const g = globalThis as unknown as { __contigoSimulatedSends?: (OutboundMessage & { channel: string })[] }
/** Lo que los canales simulados habrían mandado en este proceso (solo pruebas). */
export const simulatedSends = () => (g.__contigoSimulatedSends ??= [])

export function makeAdapter(channel: ChannelAdapter['channel'], envVar: string): ChannelAdapter {
  const simulated = process.env.APP_ENV === 'test' && process.env[envVar] === 'simulated'
  return {
    channel,
    envVar,
    mode: simulated ? 'simulated' : 'off',
    send: async (msg) => {
      if (!simulated) return { status: 'queued_off' }
      simulatedSends().push({ ...msg, channel })
      return { status: 'simulated' }
    },
  }
}
