import 'server-only'
import { gate, type ConnectorMode } from './live/gate'
import { SUPABASE_ADMIN, s5Manifest, s5Read } from './live/supabase'

/**
 * Fondeo, saldo y límite de crédito por comercio (CANAL-07). El dato viene de los archivos de S5 (bucket con manifiesto).
 * `off` (por defecto): no lee nada; la ficha dice "Sin dato del archivo de ventas" con la fecha del último corte, si hay.
 * `simulated` (solo con APP_ENV=test y CONTIGO_FUNDING_FEED=simulated): entrega las filas que la prueba le pase.
 * `live`: CONTIGO_FUNDING_FEED=live, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, S5_BUCKET y la aprobación. Lee los archivos
 * "funding" del manifiesto que todavía no se cargaron (`since`: el último corte cargado).
 */
export type FundingRow = { account_id: string; method: 'prepaid' | 'ach_credit'; balance_minor: number; credit_limit_minor: number | null; as_of: string }
export type FundingFeed = {
  mode: ConnectorMode
  envVar: 'CONTIGO_FUNDING_FEED'
  pull: (since?: string | null) => Promise<FundingRow[]>
}
export const FUNDING_GATE = { envVar: 'CONTIGO_FUNDING_FEED', credentials: [...SUPABASE_ADMIN, 'S5_BUCKET'] } as const

const g = globalThis as unknown as { __contigoFundingRows?: FundingRow[] }
/** Filas que el adaptador simulado entregará en la próxima lectura (solo pruebas). */
export const simulatedFundingRows = () => (g.__contigoFundingRows ??= [])

const validRow = (r: Record<string, unknown>): r is FundingRow =>
  typeof r.account_id === 'string' && (r.method === 'prepaid' || r.method === 'ach_credit') && Number.isInteger(r.balance_minor) &&
  (r.credit_limit_minor === null || r.credit_limit_minor === undefined || Number.isInteger(r.credit_limit_minor)) && typeof r.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.as_of as string)

export function fundingFeed(): FundingFeed {
  const mode = gate(FUNDING_GATE).mode
  return {
    mode,
    envVar: 'CONTIGO_FUNDING_FEED',
    pull: async (since) => {
      if (mode === 'live') {
        const files = (await s5Manifest('funding_feed')).filter((f) => f.kind === 'funding' && (!since || f.as_of > since)).sort((a, b) => a.as_of.localeCompare(b.as_of))
        const out: FundingRow[] = []
        for (const f of files) {
          const body = (await s5Read('funding_feed', f)) as { rows?: Record<string, unknown>[] }
          for (const r of body.rows ?? []) if (validRow(r)) out.push({ ...r, credit_limit_minor: r.credit_limit_minor ?? null })
        }
        return out
      }
      if (mode !== 'simulated') return []
      return simulatedFundingRows().splice(0)
    },
  }
}
