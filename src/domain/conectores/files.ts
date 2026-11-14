import type { Tx } from '@/server/db'
import type { ManifestFile } from '@/server/adapters/live/supabase'

/**
 * Archivos de S5 ya cargados por un conector `live` (crm.connector_files): ruta, huella SHA-256 y fecha de corte.
 * Así una tarea que corre dos veces no carga el mismo archivo dos veces.
 */
export async function loadedPaths(tx: Tx, connector: string): Promise<Set<string>> {
  const rows = await tx<{ path: string }[]>`select path from crm.connector_files where connector = ${connector}`
  return new Set(rows.map((r) => r.path))
}
export async function markLoaded(tx: Tx, connector: string, f: ManifestFile, rows: number): Promise<void> {
  await tx`insert into crm.connector_files (connector, path, sha256, as_of, row_count) values (${connector}, ${f.path}, ${f.sha256}, ${f.as_of}::date, ${rows})
           on conflict (connector, path) do nothing`
}
