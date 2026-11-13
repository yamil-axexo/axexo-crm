import 'server-only'

/**
 * Fondeo, saldo y límite de crédito por comercio (CANAL-07). El dato viene del archivo de ventas (o del core): hoy el
 * contrato del archivo diario no lo trae. Este adaptador es la puerta para leerlo.
 * `off` (por defecto): no lee nada; la ficha dice "Sin dato del archivo de ventas" con la fecha del último corte, si hay.
 * `simulated` (solo con APP_ENV=test y CONTIGO_FUNDING_FEED=simulated): entrega las filas que la prueba le pase.
 * Encenderlo pide: que el archivo de ventas (o el core) exponga método de fondeo, saldo y límite, el contrato acordado
 * y la aprobación de tecnología. Mientras tanto, Administración puede cargar datos simulados (marcados como tales) fuera de producción.
 */
export type FundingRow = { account_id: string; method: 'prepaid' | 'ach_credit'; balance_minor: number; credit_limit_minor: number | null; as_of: string }
export type FundingFeed = {
  mode: 'off' | 'simulated'
  envVar: 'CONTIGO_FUNDING_FEED'
  pull: () => Promise<FundingRow[]>
}

const g = globalThis as unknown as { __contigoFundingRows?: FundingRow[] }
/** Filas que el adaptador simulado entregará en la próxima lectura (solo pruebas). */
export const simulatedFundingRows = () => (g.__contigoFundingRows ??= [])

export function fundingFeed(): FundingFeed {
  const simulated = process.env.APP_ENV === 'test' && process.env.CONTIGO_FUNDING_FEED === 'simulated'
  return {
    mode: simulated ? 'simulated' : 'off',
    envVar: 'CONTIGO_FUNDING_FEED',
    pull: async () => {
      if (!simulated) return []
      return simulatedFundingRows().splice(0)
    },
  }
}
