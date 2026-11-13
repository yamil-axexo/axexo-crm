import 'server-only'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getReportOptions, marketPeriods } from '@/dal/reports'
import { metricOwners, wideScope } from '@/dal/reportes'
import { reportByKey, type ReportDef } from '@/lib/report-catalog'
import { track } from '@/dal/boards'
import { flat } from '@/server/params'
import { qs } from '@/lib/labels'
import type { PeriodKey } from '@/lib/periods'
import { reportFilters, reportSelects, type ReportParams } from './params'

export type ReportSp = ReportParams & { fuente?: string; ver?: string; nivel?: string; tipo?: string }

/**
 * Lo común de cada reporte nuevo: quién mira, si puede verlo, el periodo en la zona de cada mercado, los filtros que puede
 * elegir dentro de su alcance y los dueños de los indicadores. Un valor de filtro fuera de su alcance se ignora.
 */
export async function loadReport(key: string, searchParams: Promise<ReportSp>, fallback: PeriodKey = 'mes') {
  const ctx = await requireCtx()
  const def = reportByKey(key) as ReportDef
  if (!ctx.can(def.cap)) notFound()
  const sp = flat(await searchParams)
  const period = marketPeriods(ctx, sp.periodo, sp.desde, sp.hasta, fallback)
  const options = await getReportOptions(ctx, wideScope(ctx))
  const f = reportFilters(sp, options)
  const owners = await metricOwners(ctx)
  await track(ctx, `view.report.${key}`)
  const params: Record<string, string | undefined> = {
    periodo: period.key, desde: period.key === 'rango' ? period.first.from : undefined, hasta: period.key === 'rango' ? period.first.to : undefined,
    mercado: f.market, embudo: f.pipeline, equipo: f.team, persona: f.owner,
  }
  const sel = reportSelects(ctx.t, options, f)
  const canExport = def.exportable && ctx.can('report.export', f.market)
  const exportHref = (extra: Record<string, string | undefined> = {}) => qs('/reportes/exportar', { reporte: key, ...params, ...extra })
  return { ctx, def, sp, period, options, f, owners, params, sel, canExport, exportHref, multi: options.markets.length > 1 }
}
