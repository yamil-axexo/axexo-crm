import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { scrub } from '@/domain/pipedrive/mapping'
import { forbidden, invalid } from '@/lib/errors'
import { toCsv } from '@/lib/periods'
import { closedDealsForExport, fieldReportForExport, marketPeriods, reportScope, scopeMarkets, type ClosedFilters, type FieldFilters, type MarketPeriods } from '@/dal/reports'

/** Tope de filas por archivo. Si el filtro trae más, el archivo lo dice en el evento y la pantalla pide acotar. */
export const EXPORT_MAX = 10000

/** ¿Puede exportar en algún mercado de su alcance? Supervisión exporta lo de su equipo; ventas y operaciones no exportan. */
function assertExport(ctx: Ctx, market?: string): string[] {
  const markets = scopeMarkets(reportScope(ctx)).filter((c) => ctx.can('report.export', c))
  if (markets.length === 0 || (market && !markets.includes(market))) throw forbidden()
  return markets
}

const money = (minor: string | null) => (minor === null ? '' : (Number(minor) / 100).toFixed(2))
/** Texto libre que sale en un archivo: si alguna vez se coló un número de tarjeta, de cuenta o un SSN, no sale. */
const safe = (s: string | null) => (s === null ? '' : scrub(s))

export type ExportResult = { csv: string; rows: number; truncated: boolean; fileName: string }

/**
 * Exporta los negocios cerrados que la pantalla muestra con esos filtros. Solo lleva las columnas de la tabla:
 * ni teléfonos, ni correos, ni contactos. Deja un evento en la bitácora con los filtros y el número de filas.
 */
export async function exportClosedDeals(ctx: Ctx, p: MarketPeriods, f: ClosedFilters): Promise<ExportResult> {
  const markets = assertExport(ctx, f.market)
  const t = ctx.t
  return withUser(ctx.user.id, async (tx) => {
    const all = await closedDealsForExport(tx, ctx, p, f, EXPORT_MAX + 1)
    const rows = all.slice(0, EXPORT_MAX)
    const csv = toCsv(
      [t('Comercio', 'Merchant'), t('Negocio', 'Deal'), t('Mercado', 'Market'), t('Embudo', 'Pipeline'), t('Equipo', 'Team'), t('Quién', 'Owner'), t('Resultado', 'Result'),
        t('Fecha de cierre', 'Close date'), t('Monto', 'Amount'), t('Moneda', 'Currency'), t('Motivo de pérdida', 'Loss reason')],
      rows.map((r) => [safe(r.account_name), safe(r.title), r.market_code, r.pipeline_name, r.team_name ?? '', r.owner_name ?? '', r.status === 'won' ? t('Ganado', 'Won') : t('Perdido', 'Lost'),
        r.closed_on, money(r.amount_minor), r.amount_minor === null ? '' : r.currency.trim(), r.status === 'lost' ? (t(r.reason_es ?? '', r.reason_en ?? '')) : '']),
    )
    await audit(tx, ctx, 'report.exported', 'report', null, f.market ?? (markets.length === 1 ? markets[0]! : null), null, {
      report: 'closed_deals', rows: rows.length, truncated: all.length > EXPORT_MAX,
      filters: { period: p.key, from: p.first.from, to: p.first.to, market: f.market ?? null, pipeline: f.pipeline ?? null, team: f.team ?? null, owner: f.owner ?? null, result: f.result ?? null },
    })
    return { csv, rows: rows.length, truncated: all.length > EXPORT_MAX, fileName: `contigo-negocios-cerrados-${p.first.from}-a-${p.first.to}.csv` }
  })
}

/** Exporta el reporte semanal de campo: altas y ganados por semana y lugar, o visitas por semana y persona. */
export async function exportFieldReport(ctx: Ctx, f: FieldFilters, what: 'comercios' | 'visitas'): Promise<ExportResult> {
  const markets = assertExport(ctx, f.market)
  const t = ctx.t
  return withUser(ctx.user.id, async (tx) => {
    const data = await fieldReportForExport(tx, ctx, f)
    const none = t('Sin dato', 'Not set')
    const csv = what === 'visitas'
      ? toCsv([t('Semana (lunes)', 'Week (Monday)'), t('Mercado', 'Market'), t('Equipo', 'Team'), t('Persona', 'Person'), t('Visitas', 'Visits'), t('Visitas con venta', 'Visits with a sale')],
          data.visits.map((r) => [r.week, r.market_code, r.team_name ?? '', r.owner_name ?? t('Sin asignar', 'No owner'), r.visits, r.sales]))
      : toCsv([t('Semana (lunes)', 'Week (Monday)'), t('Mercado', 'Market'), f.by === 'plaza' ? t('Plaza', 'City') : t('Territorio', 'Territory'), t('Puntos de venta dados de alta', 'Stores enrolled'), t('Negocios ganados', 'Deals won')],
          data.places.map((r) => [r.week, r.market_code, r.place ?? none, r.stores, r.won]))
    const rows = what === 'visitas' ? data.visits.length : data.places.length
    await audit(tx, ctx, 'report.exported', 'report', null, f.market ?? (markets.length === 1 ? markets[0]! : null), null, {
      report: what === 'visitas' ? 'field_visits' : 'field_stores', rows, truncated: false,
      filters: { weeks: data.weeks.length, from: data.weeks[data.weeks.length - 1]!, market: f.market ?? null, team: f.team ?? null, owner: f.owner ?? null, by: f.by === 'plaza' ? 'plaza' : 'territorio' },
    })
    return { csv, rows, truncated: false, fileName: `contigo-campo-${what}-desde-${data.weeks[data.weeks.length - 1]!}.csv` }
  })
}

export { marketPeriods }

const fx = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.coerce.number().positive().max(1000),
  source: z.string().trim().min(3).max(120),
})

/**
 * Carga la tasa de una moneda a USD, con su fecha y de dónde sale. La tasa no se inventa ni se trae sola: la escribe administración.
 * Una fecha ya cargada se corrige (queda el antes y el después en la bitácora). USD no lleva tasa.
 */
export async function setFxRate(ctx: Ctx, input: { currency: string; asOf: string; rate: string; source: string }): Promise<void> {
  ctx.assert('config.manage')
  const v = fx.safeParse(input)
  if (!v.success) throw invalid('Revisa la tasa: moneda de tres letras, fecha, un número mayor que cero y de dónde sale.', 'Check the rate: three-letter currency, date, a number above zero and where it comes from.')
  if (v.data.currency === 'USD') throw invalid('USD no lleva tasa: ya es la moneda del consolidado.', 'USD needs no rate: it is already the consolidated currency.')
  const known = ctx.markets.some((m) => m.currency === v.data.currency)
  if (!known) throw invalid('Esa moneda no es la de ningún mercado.', 'That currency does not belong to any market.')
  await withUser(ctx.user.id, async (tx) => {
    const future = await tx<{ ok: boolean }[]>`select ${v.data.asOf}::date <= (now() at time zone 'UTC')::date + 1 as ok`
    if (!future[0]?.ok) throw invalid('La fecha de la tasa no puede ser futura.', 'The rate date cannot be in the future.')
    const before = await tx<{ usd_rate: string; source: string }[]>`select usd_rate::text, source from crm.fx_rates where currency = ${v.data.currency} and as_of = ${v.data.asOf}::date`
    if (before[0]) {
      await tx`update crm.fx_rates set usd_rate = ${v.data.rate}, source = ${v.data.source}, loaded_by = ${ctx.user.id}, loaded_at = now() where currency = ${v.data.currency} and as_of = ${v.data.asOf}::date`
    } else {
      await tx`insert into crm.fx_rates (currency, as_of, usd_rate, source, loaded_by) values (${v.data.currency}, ${v.data.asOf}::date, ${v.data.rate}, ${v.data.source}, ${ctx.user.id})`
    }
    await audit(tx, ctx, 'fx.rate_set', 'fx_rate', null, null, before[0] ? { currency: v.data.currency, as_of: v.data.asOf, usd_rate: Number(before[0].usd_rate), source: before[0].source } : null,
      { currency: v.data.currency, as_of: v.data.asOf, usd_rate: v.data.rate, source: v.data.source })
  })
}
