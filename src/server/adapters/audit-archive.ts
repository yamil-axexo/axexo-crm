import 'server-only'

/**
 * SEG-03: copia diaria de la bitácora fuera de la base (almacenamiento de objetos o lakehouse).
 * Apagado por defecto: no llama a nada y el lote queda en la cola con estado "Canal apagado".
 * `simulated` solo existe en pruebas (APP_ENV=test): marca el lote como si hubiera salido.
 * Para encenderlo hace falta un destino aprobado en la revisión técnica y una implementación `live` aquí.
 */
export type ArchiveMode = 'off' | 'simulated'
export const AUDIT_ARCHIVE_ENV = 'AUDIT_ARCHIVE_ADAPTER'

export function auditArchiveMode(): ArchiveMode {
  return process.env[AUDIT_ARCHIVE_ENV] === 'simulated' && process.env.APP_ENV === 'test' ? 'simulated' : 'off'
}

/** Estado con el que nace un lote según el adaptador. */
export const archiveBatchStatus = (): 'channel_off' | 'simulated' => (auditArchiveMode() === 'simulated' ? 'simulated' : 'channel_off')
