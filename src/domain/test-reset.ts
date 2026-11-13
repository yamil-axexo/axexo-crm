import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { DomainError, invalid } from '@/lib/errors'

/**
 * E6.F8: "borrar y recargar un mercado" para probar la migración las veces que haga falta. Solo fuera de producción.
 * Decisión por defecto: staging tiene datos reales, así que ahí tampoco corre salvo que el ambiente lo permita a propósito
 * (TEST_RESET_ON_STAGING=1). Pide escribir la confirmación exacta ("BORRAR MX" o "WIPE MX"). Borra los datos de negocio
 * del mercado (no la configuración, los accesos, la bitácora ni las bajas de contacto) y deja el espejo de Pipedrive listo
 * para volver a cargarse con "aplicar el mapeo de nuevo"; un mercado que vino de hojas se recarga importando sus hojas.
 */
export function resetAllowed(env: { APP_ENV?: string; TEST_RESET_ON_STAGING?: string } = process.env): boolean {
  const app = env.APP_ENV ?? 'development'
  if (app === 'production') return false
  if (app === 'staging') return env.TEST_RESET_ON_STAGING === '1'
  return true
}
export const confirmationFor = (market: string) => [`BORRAR ${market}`, `WIPE ${market}`]

export async function resetTestMarket(ctx: Ctx, market: string, confirmation: string): Promise<Record<string, number>> {
  ctx.assert('market.reset_test')
  if (!resetAllowed()) throw new DomainError('forbidden', 'En este ambiente no se puede borrar un mercado.', 'A market cannot be wiped in this environment.', 403)
  ctx.market(market)
  if (!confirmationFor(market).includes(confirmation.trim().toUpperCase().replace(/\s+/g, ' ')))
    throw invalid(`Para confirmar escribe exactamente: BORRAR ${market}`, `To confirm, type exactly: WIPE ${market}`)
  return withUser(ctx.user.id, async (tx) => {
    const running = await tx`select 1 from crm.load_runs where status = 'running'`
    if (running[0]) throw invalid('Hay una carga de datos corriendo. Espera a que termine.', 'A data load is running. Wait for it to finish.')
    let counts: Record<string, number>
    try {
      counts = ((await tx<{ c: Record<string, number> }[]>`select app.reset_test_market(${market}) as c`)[0]?.c) ?? {}
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? '')
      if (msg.startsWith('could not wipe')) throw invalid(`No se borró nada: hay datos que dependen del mercado en ${msg.slice(16)}.`, `Nothing was wiped: data depends on the market in ${msg.slice(16)}.`)
      throw e
    }
    await audit(tx, ctx, 'market.reset_test', 'market', null, market, null, { counts })
    return counts
  })
}
