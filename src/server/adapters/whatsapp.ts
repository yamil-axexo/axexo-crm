import 'server-only'
import { makeAdapter, type ChannelAdapter } from './channel'

/** WhatsApp Business: canal apagado. `WHATSAPP_ADAPTER=simulated` solo vale en pruebas (APP_ENV=test); cualquier otro valor lo deja apagado. */
export const whatsappAdapter = (): ChannelAdapter => makeAdapter('whatsapp', 'WHATSAPP_ADAPTER')
