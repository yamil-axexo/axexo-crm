import 'server-only'
import { makeAdapter, type ChannelAdapter } from './channel'

/** Slack: canal apagado. `SLACK_ADAPTER=simulated` solo vale en pruebas (APP_ENV=test); cualquier otro valor lo deja apagado. */
export const slackAdapter = (): ChannelAdapter => makeAdapter('slack', 'SLACK_ADAPTER')
