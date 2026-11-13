import 'server-only'

/**
 * Canal de salida de Reportes (el archivo de la foto diaria; el correo de un reporte programado sale por el servicio de avisos). Está APAGADO por defecto: nada sale de CONTIGO sin aprobación de
 * Tech Implementation Review. `off` deja lo que habría salido en una cola a la vista (crm.report_outbox) con estado
 * "Canal apagado"; `simulated` (solo APP_ENV=test) hace lo mismo y lo marca como simulado, para las pruebas.
 * Encender un canal es escribir aquí su implementación real, con sus credenciales en variables de entorno, y aprobarla.
 * No hay llamadas de red en este archivo.
 */
import { gate, type ConnectorMode } from './live/gate'
import { SUPABASE_ADMIN, storagePut } from './live/supabase'

export type ChannelMode = ConnectorMode
export type ChannelKey = 'snapshot_file'

export const REPORT_ADAPTERS: { key: ChannelKey; env: string; name: [string, string]; what: [string, string]; needs: [string, string] }[] = [
  {
    key: 'snapshot_file', env: 'SNAPSHOT_FILE_ADAPTER', name: ['Archivo de la foto diaria para Data y Reportería', 'Daily snapshot file for Data & Reporting'],
    what: ['Entrega la foto diaria de negocios y cartera como archivo al lakehouse. Hoy la foto se guarda y se consulta dentro de CONTIGO.', 'Delivers the daily snapshot of deals and merchants as a file to the lakehouse. Today the snapshot is stored and read inside CONTIGO.'],
    needs: ['El destino y el formato acordados con Data y Reportería, la aprobación de Tech Implementation Review y la variable SNAPSHOT_FILE_ADAPTER.', 'The destination and format agreed with Data & Reporting, approval from Tech Implementation Review and the SNAPSHOT_FILE_ADAPTER variable.'],
  },
]

/** `live`: SNAPSHOT_FILE_ADAPTER=live, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, S5_BUCKET y la aprobación. El archivo va a
 * la carpeta from-contigo/ del bucket de S5, con su huella SHA-256. */
export const SNAPSHOT_GATE = { envVar: 'SNAPSHOT_FILE_ADAPTER', credentials: [...SUPABASE_ADMIN, 'S5_BUCKET'] } as const
export function channelMode(key: ChannelKey): ChannelMode {
  void key
  return gate(SNAPSHOT_GATE).mode
}

/** Encendido: la foto diaria sale al bucket de S5 al tomarla. */
export const snapshotLive = (): boolean => channelMode('snapshot_file') === 'live'

/** Sube el archivo de la foto diaria al bucket de S5. */
export async function uploadSnapshotFile(name: string, csv: string): Promise<{ ref: string; sha256: string }> {
  const out = await storagePut('snapshot_file', process.env.S5_BUCKET ?? '', `from-contigo/${name}`, csv, 'text/csv; charset=utf-8')
  return { ref: out.ref, sha256: out.sha256 }
}

/** Con qué estado queda en la cola lo que habría salido. El adaptador nunca envía ni escribe: la cola la lleva el dominio (src/domain/reportes.ts). */
export function outboundStatus(key: ChannelKey): 'channel_off' | 'simulated' {
  return channelMode(key) === 'simulated' ? 'simulated' : 'channel_off'
}
