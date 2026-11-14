import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { routeToolPush } from './live/providers'

/**
 * Herramienta de rutas (E12.F8, E5.F6): es un sistema externo. CONTIGO prepara la lista de tiendas de cada persona
 * (`src/dal/routes.ts`) y este adaptador es la puerta hacia afuera. Tiene dos implementaciones:
 * `off` (por defecto): no llama a nada; la lista queda lista para leerse por la API de lectura cuando se conecte.
 * `simulated` (solo con APP_ENV=test y ROUTE_TOOL=simulated): anota lo que habría salido, para las pruebas.
 * No hay implementación real: conectar la herramienta pasa primero por la revisión de tecnología.
 */
export type RouteStore = {
  account_id: string
  name: string
  address: string | null
  locality: string | null
  region: string | null
  postal_code: string | null
  phone: string | null
  contact: string | null
  merchant_ref: string | null
  /** Productos que la tienda ya tiene aprobados (los de sus negocios ganados). */
  approved_products: string[]
  /** Transacciones de los últimos 30 días según el archivo de ventas más reciente; null si no hay archivo. */
  txn_count_30d: number | null
  /** E5.F1: activaciones del mes a la fecha y del mes anterior (suma de carriers), del último archivo de cifras por tienda. Null: sin actividad. */
  activations_mtd?: number | null
  activations_prev_month?: number | null
  sales_as_of?: string | null
  last_visit_on: string | null
}
export type RouteSync = { owner_id: string; market: string; stores: RouteStore[] }
export type RoutesAdapter = {
  mode: ConnectorMode
  /** La variable de entorno que lo enciende. */
  envVar: 'ROUTE_TOOL'
  /** Entrega la lista de tiendas de una persona a la herramienta de rutas. Apagado: no sale nada. */
  pushStores: (sync: RouteSync) => Promise<{ status: 'off' | 'simulated' | 'sent' | 'failed'; stores: number }>
}

const g = globalThis as unknown as { __contigoSimulatedRoutes?: RouteSync[] }
/** Lo que el adaptador simulado habría mandado en este proceso (solo pruebas). */
export const simulatedRouteSyncs = () => (g.__contigoSimulatedRoutes ??= [])

/** `live`: ROUTE_TOOL=live, ROUTE_TOOL_URL (https), ROUTE_TOOL_TOKEN y la aprobación. Contrato: docs/contracts/route-tool.md. */
export const ROUTES_GATE = { envVar: 'ROUTE_TOOL', credentials: ['ROUTE_TOOL_URL', 'ROUTE_TOOL_TOKEN'] } as const
export function routesAdapter(): RoutesAdapter {
  const mode = gate(ROUTES_GATE).mode
  const simulated = mode === 'simulated'
  return {
    envVar: 'ROUTE_TOOL',
    mode,
    pushStores: async (sync) => {
      if (mode === 'live') {
        try {
          await routeToolPush({ contract: 'route_stores v1', ...sync })
          return { status: 'sent', stores: sync.stores.length }
        } catch {
          return { status: 'failed', stores: 0 }
        }
      }
      if (!simulated) return { status: 'off', stores: 0 }
      simulatedRouteSyncs().push(sync)
      return { status: 'simulated', stores: sync.stores.length }
    },
  }
}
