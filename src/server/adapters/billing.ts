import 'server-only'

/**
 * GOB-09: lectura automática de la facturación de los proveedores (plataforma, base de datos, terceros). Adaptador APAGADO.
 * `off` (por defecto): no llama a nada; los costos se cargan a mano en Administración.
 * `simulated` (solo con APP_ENV=test y BILLING_ADAPTER=simulated): devuelve renglones de prueba que la prueba misma le dio.
 * No hay implementación real ni credenciales: leer la facturación de un proveedor pasa primero por la revisión de tecnología.
 */
export type BillingLine = { month: string; component: 'platform' | 'database' | 'third_party' | 'ai' | 'support' | 'other'; label: string; amountUsd: number }
export type BillingAdapter = { mode: 'off' | 'simulated'; envVar: string; fetchMonth: (month: string) => Promise<{ status: 'off' | 'simulated'; lines: BillingLine[] }> }

const g = globalThis as unknown as { __contigoSimulatedBilling?: BillingLine[] }
/** Renglones que el adaptador simulado entrega (solo pruebas). */
export const simulatedBilling = () => (g.__contigoSimulatedBilling ??= [])

export function billingAdapter(): BillingAdapter {
  const simulated = process.env.APP_ENV === 'test' && process.env.BILLING_ADAPTER === 'simulated'
  return {
    mode: simulated ? 'simulated' : 'off',
    envVar: 'BILLING_ADAPTER',
    fetchMonth: async (month) => (simulated ? { status: 'simulated', lines: simulatedBilling().filter((l) => l.month === month) } : { status: 'off', lines: [] }),
  }
}
