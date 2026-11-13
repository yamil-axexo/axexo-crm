import 'server-only'

/**
 * PIPE-06: de dónde llega el archivo diario de ventas (merchant_metrics_daily, con fondeo, hábito y correcciones).
 * Hoy CONTIGO lo recibe cuando alguien lo entrega por la API (POST /api/v1/metrics/daily). Este adaptador es la otra
 * mitad: ir a buscarlo. `off` (por defecto): no va a ningún lado; la tarea programada lo dice ("Canal apagado").
 * `simulated` (solo con APP_ENV=test y SALES_FILE=simulated): entrega el archivo que la prueba dejó preparado.
 * No hay implementación real: falta que Data y Reportería confirme el contrato con fondeo y método, y dónde deja el archivo.
 */
export type SalesFileAdapter = {
  mode: 'off' | 'simulated'
  envVar: 'SALES_FILE'
  /** El siguiente archivo por cargar, o null si no hay (o si está apagado). */
  next: () => Promise<unknown | null>
}

const g = globalThis as unknown as { __contigoSimulatedSalesFiles?: unknown[] }
/** Archivos que una prueba deja listos para que el adaptador simulado los entregue. */
export const simulatedSalesFiles = () => (g.__contigoSimulatedSalesFiles ??= [])

export function salesFileAdapter(): SalesFileAdapter {
  const simulated = process.env.APP_ENV === 'test' && process.env.SALES_FILE === 'simulated'
  return {
    envVar: 'SALES_FILE',
    mode: simulated ? 'simulated' : 'off',
    next: async () => (simulated ? (simulatedSalesFiles().shift() ?? null) : null),
  }
}
