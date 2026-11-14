import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { vercelCharges } from './live/providers'
import { errorCode } from './live/http'

/**
 * GOB-09: lectura automática de la facturación de la plataforma (Vercel). Adaptador APAGADO por defecto.
 * `off`: no llama a nada; los costos se cargan a mano en Administración.
 * `simulated` (solo con APP_ENV=test y BILLING_ADAPTER=simulated): devuelve renglones de prueba que la prueba misma le dio.
 * `live`: BILLING_ADAPTER=live, VERCEL_BILLING_TOKEN (solo lectura de facturación), VERCEL_TEAM_ID y la aprobación.
 */
export type BillingLine = { month: string; component: 'platform' | 'database' | 'third_party' | 'ai' | 'support' | 'other'; label: string; amountUsd: number }
export type BillingAdapter = { mode: ConnectorMode; envVar: string; fetchMonth: (month: string) => Promise<{ status: 'off' | 'simulated' | 'live' | 'failed'; lines: BillingLine[]; error?: string }> }
export const BILLING_GATE = { envVar: 'BILLING_ADAPTER', credentials: ['VERCEL_BILLING_TOKEN', 'VERCEL_TEAM_ID'] } as const

const g = globalThis as unknown as { __contigoSimulatedBilling?: BillingLine[] }
/** Renglones que el adaptador simulado entrega (solo pruebas). */
export const simulatedBilling = () => (g.__contigoSimulatedBilling ??= [])

export function billingAdapter(): BillingAdapter {
  const mode = gate(BILLING_GATE).mode
  return {
    mode,
    envVar: 'BILLING_ADAPTER',
    fetchMonth: async (month) => {
      if (mode === 'live') {
        try {
          return { status: 'live', lines: (await vercelCharges(month)).map((l) => ({ month, component: 'platform' as const, label: l.label, amountUsd: l.amountUsd })) }
        } catch (e) {
          return { status: 'failed', lines: [], error: errorCode(e) }
        }
      }
      return mode === 'simulated' ? { status: 'simulated', lines: simulatedBilling().filter((l) => l.month === month) } : { status: 'off', lines: [] }
    },
  }
}
