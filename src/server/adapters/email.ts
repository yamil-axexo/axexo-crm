import 'server-only'
import { makeAdapter, type ChannelAdapter } from './channel'

/** Correo transaccional: canal apagado. `EMAIL_ADAPTER=simulated` solo vale en pruebas (APP_ENV=test); cualquier otro valor lo deja apagado. */
export const emailAdapter = (): ChannelAdapter => makeAdapter('email', 'EMAIL_ADAPTER')
