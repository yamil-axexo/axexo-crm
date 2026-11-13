import 'server-only'
import type { Tx } from '@/server/db'
import type postgres from 'postgres'

/**
 * Canales de salida de Reportes. Los dos están APAGADOS por defecto: nada sale de CONTIGO sin aprobación de
 * Tech Implementation Review. `off` deja lo que habría salido en una cola a la vista (crm.report_outbox) con estado
 * "Canal apagado"; `simulated` (solo APP_ENV=test) hace lo mismo y lo marca como simulado, para las pruebas.
 * Encender un canal es escribir aquí su implementación real, con sus credenciales en variables de entorno, y aprobarla.
 * No hay llamadas de red en este archivo.
 */
export type ChannelMode = 'off' | 'simulated'
export type ChannelKey = 'report_mail' | 'snapshot_file'

export const REPORT_ADAPTERS: { key: ChannelKey; env: string; name: [string, string]; what: [string, string]; needs: [string, string] }[] = [
  {
    key: 'report_mail', env: 'REPORT_MAIL_ADAPTER', name: ['Correo de reportes programados', 'Scheduled report email'],
    what: ['Manda por correo el resumen de un reporte programado. Hoy el resumen llega dentro de CONTIGO, en Reportes.', 'Emails the summary of a scheduled report. Today the summary arrives inside CONTIGO, in Reports.'],
    needs: ['Un proveedor de correo aprobado por Tech Implementation Review, sus credenciales en el ambiente y la variable REPORT_MAIL_ADAPTER.', 'An email provider approved by Tech Implementation Review, its credentials in the environment and the REPORT_MAIL_ADAPTER variable.'],
  },
  {
    key: 'snapshot_file', env: 'SNAPSHOT_FILE_ADAPTER', name: ['Archivo de la foto diaria para Data y Reportería', 'Daily snapshot file for Data & Reporting'],
    what: ['Entrega la foto diaria de negocios y cartera como archivo al lakehouse. Hoy la foto se guarda y se consulta dentro de CONTIGO.', 'Delivers the daily snapshot of deals and merchants as a file to the lakehouse. Today the snapshot is stored and read inside CONTIGO.'],
    needs: ['El destino y el formato acordados con Data y Reportería, la aprobación de Tech Implementation Review y la variable SNAPSHOT_FILE_ADAPTER.', 'The destination and format agreed with Data & Reporting, approval from Tech Implementation Review and the SNAPSHOT_FILE_ADAPTER variable.'],
  },
]

export function channelMode(key: ChannelKey): ChannelMode {
  const def = REPORT_ADAPTERS.find((a) => a.key === key)!
  return process.env[def.env] === 'simulated' && process.env.APP_ENV === 'test' ? 'simulated' : 'off'
}

/** Deja en la cola lo que habría salido. Nunca envía. Devuelve el estado con el que quedó. */
export async function queueOutbound(tx: Tx, key: ChannelKey, item: { ref: string; title: string; rows: number; detail?: Record<string, unknown> }): Promise<'channel_off' | 'simulated'> {
  const status = channelMode(key) === 'simulated' ? 'simulated' : 'channel_off'
  await tx`insert into crm.report_outbox (channel, ref, title, row_count, status, detail)
           values (${key === 'report_mail' ? 'email' : 'snapshot_file'}, ${item.ref}, ${item.title.slice(0, 200)}, ${item.rows}, ${status}, ${tx.json((item.detail ?? {}) as postgres.JSONValue)})
           on conflict (channel, ref) do nothing`
  return status
}
