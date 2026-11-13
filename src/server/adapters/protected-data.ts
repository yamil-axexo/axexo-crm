import 'server-only'
import { protectedDataAdapter as vault } from '@/server/adapters/markets'

/**
 * Resguardo de datos protegidos (E9.F13 y MULTI-03): el Tax ID completo de una tienda NO se guarda en CONTIGO (estándar DATA-06);
 * CONTIGO guarda los últimos 4 y la huella para encontrar repetidos. Hay UN solo adaptador, el del paquete de mercados
 * (`src/server/adapters/markets.ts`, variable PROTECTED_DATA_ADAPTER): esta es la vista que usa la ficha de dealer.
 * `off` (por defecto): no guarda ni manda nada; el número completo se descarta en memoria.
 * `simulated` (solo con APP_ENV=test y PROTECTED_DATA_ADAPTER=simulated): anota que habría salido un valor (largo y últimos 4,
 * nunca el valor), para las pruebas.
 * No hay implementación real: encenderlo pasa por la revisión de tecnología (Michael Essiet o Dan Mulligan) y por una
 * excepción escrita al estándar de datos.
 */
export type ProtectedDataAdapter = {
  mode: 'off' | 'simulated'
  /** La variable de entorno que lo enciende. */
  envVar: string
  /** Recibe el Tax ID completo ya normalizado. Apagado: no sale ni se guarda nada. */
  storeTaxId: (accountId: string, full: string) => Promise<{ status: 'off' | 'simulated' }>
  /** El Tax ID completo para un documento. Apagado y simulado: nunca lo devuelve; los documentos llevan los últimos 4. */
  readTaxId: (accountId: string) => Promise<null>
}

export type SimulatedVaultEntry = { account_id: string; length: number; last4: string }
const g = globalThis as unknown as { __contigoSimulatedVault?: SimulatedVaultEntry[] }
/** Lo que el adaptador simulado habría resguardado en este proceso (solo pruebas): nunca el valor completo. */
export const simulatedVault = () => (g.__contigoSimulatedVault ??= [])

export function protectedDataAdapter(): ProtectedDataAdapter {
  const v = vault()
  return {
    envVar: v.envVar,
    mode: v.mode,
    storeTaxId: async (accountId, full) => {
      const out = await v.store({ kind: 'tax_id', accountId, value: full })
      if (!out.stored) return { status: 'off' }
      simulatedVault().push({ account_id: accountId, length: full.length, last4: full.slice(-4) })
      return { status: 'simulated' }
    },
    readTaxId: async () => null,
  }
}
