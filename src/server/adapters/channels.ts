import 'server-only'
import type { Channel } from '@/lib/notice-kinds'
import type { ChannelAdapter } from './channel'
import { emailAdapter } from './email'
import { slackAdapter } from './slack'
import { whatsappAdapter } from './whatsapp'

export function channelAdapter(channel: Exclude<Channel, 'in_app'>): ChannelAdapter {
  return channel === 'email' ? emailAdapter() : channel === 'slack' ? slackAdapter() : whatsappAdapter()
}

/** Para "Estado de CONTIGO": cada canal, si está apagado y qué falta para encenderlo. */
export function channelStatus(): { channel: ChannelAdapter['channel']; mode: ChannelAdapter['mode']; envVar: string; needs: [es: string, en: string] }[] {
  const needs: Record<ChannelAdapter['channel'], [string, string]> = {
    email: ['Falta: proveedor de correo aprobado en la revisión de tecnología, dirección de salida por mercado y revisar el texto de las plantillas.', 'Missing: an email provider approved in the technology review, a sender address per market and a review of the template texts.'],
    slack: ['Falta: aprobación en la revisión de tecnología y la aplicación de Slack del espacio de trabajo.', 'Missing: approval in the technology review and the workspace’s Slack app.'],
    whatsapp: ['Falta: cuenta de WhatsApp Business aprobada, plantillas aprobadas por Meta, límite diario por mercado y teléfono de cada destinatario.', 'Missing: an approved WhatsApp Business account, templates approved by Meta, a daily limit per market and each recipient’s phone.'],
  }
  return [emailAdapter(), slackAdapter(), whatsappAdapter()].map((a) => ({ channel: a.channel, mode: a.mode, envVar: a.envVar, needs: needs[a.channel] }))
}
