import 'server-only'

/**
 * Resguardo de datos protegidos (E9.F13): el Tax ID completo de una tienda NO se guarda en CONTIGO (estándar DATA-06);
 * CONTIGO guarda los últimos 4. Si algún día se aprueba guardar el número completo, vive en un resguardo cifrado fuera de
 * la base de CONTIGO y este adaptador es la única puerta. Tiene dos implementaciones:
 * `off` (por defecto): no guarda ni manda nada; el número completo se descarta en memoria.
 * `simulated` (solo con APP_ENV=test y PROTECTED_DATA_VAULT=simulated): anota que habría salido un valor (largo y últimos 4,
 * nunca el valor), para las pruebas.
 * No hay implementación real: encenderlo pasa por la revisión de tecnología (Michael Essiet o Dan Mulligan) y por una
 * excepción escrita al estándar de datos.
 */
export type ProtectedDataAdapter = {
  mode: 'off' | 'simulated'
  /** La variable de entorno que lo enciende. */
  envVar: 'PROTECTED_DATA_VAULT'
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
  const simulated = process.env.APP_ENV === 'test' && process.env.PROTECTED_DATA_VAULT === 'simulated'
  return {
    envVar: 'PROTECTED_DATA_VAULT',
    mode: simulated ? 'simulated' : 'off',
    storeTaxId: async (accountId, full) => {
      if (!simulated) return { status: 'off' }
      simulatedVault().push({ account_id: accountId, length: full.length, last4: full.slice(-4) })
      return { status: 'simulated' }
    },
    readTaxId: async () => null,
  }
}
