import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { SUPABASE_ADMIN, storagePut } from './live/supabase'

/**
 * SEG-03: copia diaria de la bitácora fuera de la base (Supabase Storage, bucket privado).
 * Apagado por defecto: no llama a nada y el lote queda en la cola con estado "Canal apagado".
 * `simulated` solo existe en pruebas (APP_ENV=test): marca el lote como si hubiera salido.
 * `live`: AUDIT_ARCHIVE_ADAPTER=live, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUDIT_ARCHIVE_BUCKET y la aprobación.
 * Cada lote se sube como JSON con su huella SHA-256; la huella del archivo subido tiene que ser la del lote.
 */
export type ArchiveMode = ConnectorMode
export const AUDIT_ARCHIVE_ENV = 'AUDIT_ARCHIVE_ADAPTER'
export const AUDIT_ARCHIVE_GATE = { envVar: AUDIT_ARCHIVE_ENV, credentials: [...SUPABASE_ADMIN, 'AUDIT_ARCHIVE_BUCKET'] } as const

export function auditArchiveMode(): ArchiveMode {
  return gate(AUDIT_ARCHIVE_GATE).mode
}

/** Estado con el que nace un lote según el adaptador. Encendido, nace en cola y la tarea lo sube enseguida. */
export const archiveBatchStatus = (): 'channel_off' | 'simulated' => (auditArchiveMode() === 'simulated' ? 'simulated' : 'channel_off')

/** Sube un lote ya armado. Devuelve la huella del archivo subido. */
export async function uploadArchiveBatch(batch: { id: number; log_name: string; content: string }): Promise<{ ref: string; sha256: string }> {
  const out = await storagePut('audit_archive', process.env.AUDIT_ARCHIVE_BUCKET ?? '', `${batch.log_name}/${String(batch.id).padStart(10, '0')}.json`, batch.content, 'application/json')
  return { ref: out.ref, sha256: out.sha256 }
}
