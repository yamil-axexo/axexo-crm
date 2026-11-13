import 'server-only'

/**
 * Canal de salida de Reportes (el archivo de la foto diaria; el correo de un reporte programado sale por el servicio de avisos). Está APAGADO por defecto: nada sale de CONTIGO sin aprobación de
 * Tech Implementation Review. `off` deja lo que habría salido en una cola a la vista (crm.report_outbox) con estado
 * "Canal apagado"; `simulated` (solo APP_ENV=test) hace lo mismo y lo marca como simulado, para las pruebas.
 * Encender un canal es escribir aquí su implementación real, con sus credenciales en variables de entorno, y aprobarla.
 * No hay llamadas de red en este archivo.
 */
export type ChannelMode = 'off' | 'simulated'
export type ChannelKey = 'snapshot_file' | 'scheduled_slack'

export const REPORT_ADAPTERS: { key: ChannelKey; env: string; name: [string, string]; what: [string, string]; needs: [string, string] }[] = [
  {
    key: 'snapshot_file', env: 'SNAPSHOT_FILE_ADAPTER', name: ['Archivo de la foto diaria para Data y Reportería', 'Daily snapshot file for Data & Reporting'],
    what: ['Entrega la foto diaria de negocios y cartera como archivo al lakehouse. Hoy la foto se guarda y se consulta dentro de CONTIGO.', 'Delivers the daily snapshot of deals and merchants as a file to the lakehouse. Today the snapshot is stored and read inside CONTIGO.'],
    needs: ['El destino y el formato acordados con Data y Reportería, la aprobación de Tech Implementation Review y la variable SNAPSHOT_FILE_ADAPTER.', 'The destination and format agreed with Data & Reporting, approval from Tech Implementation Review and the SNAPSHOT_FILE_ADAPTER variable.'],
  },
  // reportes2 (REP-01): el reporte programado también puede ir a un canal de Slack. Hoy queda en la cola con "Canal apagado".
  {
    key: 'scheduled_slack', env: 'REPORT_SLACK_ADAPTER', name: ['Reportes programados a Slack', 'Scheduled reports to Slack'],
    what: ['Publica el resumen de cada reporte programado en el canal de Slack del equipo. Hoy el resumen llega dentro de CONTIGO (Reportes y avisos).', 'Posts each scheduled report summary in the team’s Slack channel. Today the summary arrives inside CONTIGO (Reports and notices).'],
    needs: ['El canal de Slack de cada equipo, la aprobación de Tech Implementation Review y la variable REPORT_SLACK_ADAPTER.', 'Each team’s Slack channel, approval from Tech Implementation Review and the REPORT_SLACK_ADAPTER variable.'],
  },
]

export function channelMode(key: ChannelKey): ChannelMode {
  const def = REPORT_ADAPTERS.find((a) => a.key === key)!
  return process.env[def.env] === 'simulated' && process.env.APP_ENV === 'test' ? 'simulated' : 'off'
}

/** Con qué estado queda en la cola lo que habría salido. El adaptador nunca envía ni escribe: la cola la lleva el dominio (src/domain/reportes.ts). */
export function outboundStatus(key: ChannelKey): 'channel_off' | 'simulated' {
  return channelMode(key) === 'simulated' ? 'simulated' : 'channel_off'
}
