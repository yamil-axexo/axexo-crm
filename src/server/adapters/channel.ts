import 'server-only'
import type { Channel } from '@/lib/notice-kinds'
import { gate, type ConnectorMode, type GateSpec } from './live/gate'
import { GOOGLE_SA, gmailSend } from './live/google'
import { slackLookupAndPost } from './live/messaging'
import { whatsappSendTemplate, type WaTemplate } from './live/messaging'
import { errorCode } from './live/http'

/**
 * Canal de salida hacia afuera de CONTIGO (correo, Slack, WhatsApp). Cada canal tiene tres implementaciones:
 * `off` (por defecto): no llama a nada; el mensaje queda en la cola con estado "Canal apagado".
 * `simulated` (solo con APP_ENV=test): anota lo que habría salido, para las pruebas.
 * `live`: el conector real (Gmail API, Slack chat.postMessage, WhatsApp Cloud API). Solo con `<VARIABLE>=live`, las
 * credenciales del proveedor y `<VARIABLE>_APPROVAL` con la referencia del sign-off (ver live/gate.ts).
 */
export type OutboundMessage = {
  to: string
  subject: string
  body: string
  /** WhatsApp: solo salen plantillas aprobadas. Sin plantilla el mensaje no sale ("blocked_template"). */
  template?: WaTemplate | null
  /** WhatsApp: el número de la cuenta del mercado (crm.whatsapp_accounts.external_ref). */
  phoneNumberId?: string | null
}
export type SendResult = { status: 'queued_off' | 'simulated' | 'sent' | 'failed' | 'blocked_template'; providerId?: string; error?: string }
export type ChannelAdapter = {
  channel: Exclude<Channel, 'in_app'>
  mode: ConnectorMode
  /** La variable de entorno que lo enciende. */
  envVar: string
  send: (msg: OutboundMessage) => Promise<SendResult>
}

const g = globalThis as unknown as { __contigoSimulatedSends?: (OutboundMessage & { channel: string })[] }
/** Lo que los canales simulados habrían mandado en este proceso (solo pruebas). */
export const simulatedSends = () => (g.__contigoSimulatedSends ??= [])

export const CHANNEL_GATES: Record<ChannelAdapter['channel'], GateSpec> = {
  email: { envVar: 'EMAIL_ADAPTER', credentials: [...GOOGLE_SA, 'EMAIL_SENDER'] },
  slack: { envVar: 'SLACK_ADAPTER', credentials: ['SLACK_BOT_TOKEN'] },
  whatsapp: { envVar: 'WHATSAPP_ADAPTER', credentials: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'] },
}

async function liveSend(channel: ChannelAdapter['channel'], msg: OutboundMessage): Promise<SendResult> {
  try {
    if (channel === 'email') return { status: 'sent', providerId: (await gmailSend(msg)).id }
    if (channel === 'slack') return { status: 'sent', providerId: (await slackLookupAndPost(msg.to, `*${msg.subject}*\n${msg.body}`)).ts }
    if (!msg.template) return { status: 'blocked_template' }
    const id = (await whatsappSendTemplate({ phoneNumberId: msg.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '', to: msg.to, template: msg.template })).id
    return { status: 'sent', providerId: id }
  } catch (e) {
    return { status: 'failed', error: errorCode(e) }
  }
}

export function makeAdapter(channel: ChannelAdapter['channel'], envVar: string): ChannelAdapter {
  const mode = gate({ ...CHANNEL_GATES[channel], envVar }).mode
  return {
    channel,
    envVar,
    mode,
    send: async (msg) => {
      if (mode === 'live') return liveSend(channel, msg)
      if (mode !== 'simulated') return { status: 'queued_off' }
      simulatedSends().push({ ...msg, channel })
      return { status: 'simulated' }
    },
  }
}
