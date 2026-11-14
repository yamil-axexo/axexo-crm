import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { SUPABASE_ADMIN, s5Manifest, s5Read, type ManifestFile } from './live/supabase'

/**
 * PIPE-06: de dónde llega el archivo diario de ventas (merchant_metrics_daily, con fondeo, hábito y correcciones).
 * Hoy CONTIGO lo recibe cuando alguien lo entrega por la API (POST /api/v1/metrics/daily). Este adaptador es la otra
 * mitad: ir a buscarlo. `off` (por defecto): no va a ningún lado; la tarea programada lo dice ("Canal apagado").
 * `simulated` (solo con APP_ENV=test y SALES_FILE=simulated): entrega el archivo que la prueba dejó preparado.
 * No hay implementación real: falta que Data y Reportería confirme el contrato con fondeo y método, y dónde deja el archivo.
 */
export type SalesFileAdapter = {
  mode: ConnectorMode
  envVar: 'SALES_FILE'
  /** `live`: los archivos del manifiesto de S5 de ese tipo que todavía no se cargaron (por ruta), del más viejo al más nuevo. */
  pending: (kind: 'merchant_metrics_daily' | 'store_sales_daily', loaded: Set<string>) => Promise<ManifestFile[]>
  /** `live`: el contenido de un archivo, con su huella revisada. */
  read: (file: ManifestFile) => Promise<unknown>
  /** El siguiente archivo por cargar, o null si no hay (o si está apagado). */
  next: () => Promise<unknown | null>
  /** E5.F1: el siguiente archivo de cifras por tienda (store_sales_daily v1), o null si no hay (o si está apagado). */
  nextStoreSales: () => Promise<unknown | null>
}

const g = globalThis as unknown as { __contigoSimulatedSalesFiles?: unknown[]; __contigoSimulatedStoreSales?: unknown[] }
/** Archivos que una prueba deja listos para que el adaptador simulado los entregue. */
export const simulatedSalesFiles = () => (g.__contigoSimulatedSalesFiles ??= [])
/** E5.F1: archivos de cifras por tienda que una prueba deja listos. */
export const simulatedStoreSalesFiles = () => (g.__contigoSimulatedStoreSales ??= [])

/** `live`: SALES_FILE=live, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, S5_BUCKET y la aprobación. */
export const SALES_FILE_GATE = { envVar: 'SALES_FILE', credentials: [...SUPABASE_ADMIN, 'S5_BUCKET'] } as const
export function salesFileAdapter(): SalesFileAdapter {
  const mode = gate(SALES_FILE_GATE).mode
  const simulated = mode === 'simulated'
  return {
    envVar: 'SALES_FILE',
    mode,
    pending: async (kind, loaded) => (mode === 'live' ? (await s5Manifest('sales_file')).filter((f) => f.kind === kind && !loaded.has(f.path)).sort((a, b) => a.as_of.localeCompare(b.as_of) || a.path.localeCompare(b.path)) : []),
    read: (file) => s5Read('sales_file', file),
    next: async () => (simulated ? (simulatedSalesFiles().shift() ?? null) : null),
    nextStoreSales: async () => (simulated ? (simulatedStoreSalesFiles().shift() ?? null) : null),
  }
}
