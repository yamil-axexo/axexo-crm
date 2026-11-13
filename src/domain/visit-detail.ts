import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { scrub } from '@/domain/pipedrive/mapping'
import { forbidden, invalid } from '@/lib/errors'
import { toCsv } from '@/lib/periods'
import { addDays, isoDay } from '@/lib/format'
import { reportScope, scopeMarkets } from '@/dal/reports'
import { exportCap, exportReason, governExport } from '@/domain/exports'

export const VISIT_DETAIL_MAX_DAYS = 92
export const VISIT_DETAIL_MAX_ROWS = 10000
export type VisitDetailRow = {
  day: string; market_code: string; owner_name: string | null; visited_by: string | null; account_name: string; address_line: string | null; locality: string | null
  region: string | null; postal_code: string | null; purpose_es: string | null; purpose_en: string | null; outcome: string; origin: string
}

const safe = (s: string | null) => (s === null ? '' : scrub(s))

/**
 * E12.F6: detalle de visitas para cruzarlas con los reembolsos de millas. Una fila por visita: día (en la zona del mercado),
 * quién lleva la tienda, quién visitó, tienda con su dirección, propósito y resultado. Es una lectura que sale de CONTIGO:
 * pide el permiso de exportar, respeta el alcance de quien la pide (supervisión, solo su equipo) y deja evento en la bitácora.
 */
export async function visitDetail(ctx: Ctx, f: { market?: string; from?: string; to?: string }): Promise<{ rows: VisitDetailRow[]; from: string; to: string; truncated: boolean; markets: string[] }> {
  const scope = reportScope(ctx)
  // reportes2 (E12.F6): Finanzas lo descarga con su propio permiso, sin tener la exportación de los demás reportes.
  const markets = scopeMarkets(scope).filter((c) => ctx.can('report.export', c) || ctx.can('visit.reimbursement', c))
  if (markets.length === 0 || (f.market && !markets.includes(f.market))) throw forbidden()
  const iso = /^\d{4}-\d{2}-\d{2}$/
  const today = isoDay(new Date(), ctx.market(f.market ?? markets[0]!).timezone)
  const to = f.to && iso.test(f.to) ? f.to : today
  const from = f.from && iso.test(f.from) ? f.from : addDays(to, -30)
  if (from > to) throw invalid('El periodo empieza después de terminar. Revisa las fechas.', 'The period starts after it ends. Check the dates.')
  if (addDays(from, VISIT_DETAIL_MAX_DAYS) < to) throw invalid(`El periodo es de hasta ${VISIT_DETAIL_MAX_DAYS} días. Acorta las fechas.`, `The period can be up to ${VISIT_DETAIL_MAX_DAYS} days. Shorten the dates.`)
  return withUser(ctx.user.id, async (tx) => {
    const all = await tx<VisitDetailRow[]>`
      select v.business_date::text as day, v.market_code, u.full_name as owner_name, nullif(btrim(v.visited_by), '') as visited_by, a.name as account_name,
             a.address_line, a.locality, a.region, a.postal_code, vr.label_es as purpose_es, vr.label_en as purpose_en, v.outcome, v.origin
        from crm.visit_log v join crm.accounts a on a.id = v.account_id left join crm.users u on u.id = v.owner_id
        left join crm.activities x on x.id = v.id and v.origin = 'manual'
        left join lateral (select r.label_es, r.label_en from crm.visit_reasons r where r.code = x.visit_reason and (r.market_code is null or r.market_code = v.market_code) order by r.market_code nulls last limit 1) vr on true
       where v.business_date between ${from}::date and ${to}::date
         and (v.market_code = any(${scope.full}::text[]) or (v.market_code = any(${scope.team}::text[]) and v.owner_id = any((select app.supervised_user_ids())::uuid[])))
         and v.market_code = any(${f.market ? [f.market] : markets}::text[])
       order by v.business_date desc, u.full_name nulls last, a.name limit ${VISIT_DETAIL_MAX_ROWS + 1}`
    return { rows: all.slice(0, VISIT_DETAIL_MAX_ROWS), from, to, truncated: all.length > VISIT_DETAIL_MAX_ROWS, markets }
  })
}

export async function exportVisitDetail(ctx: Ctx, f: { market?: string; from?: string; to?: string }, rawReason: string): Promise<{ csv: string; rows: number; truncated: boolean; fileName: string }> {
  const t = ctx.t
  // AUT-07: el mismo gobierno que toda exportación: sin motivo no hay archivo y el tope de filas es el del rol.
  const reason = exportReason(rawReason)
  const cap = Math.min(VISIT_DETAIL_MAX_ROWS, exportCap(ctx, f.market))
  if (cap < 1) throw forbidden()
  const all = await visitDetail(ctx, f)
  const data = { ...all, rows: all.rows.slice(0, cap), truncated: all.truncated || all.rows.length > cap }
  const csv = toCsv(
    [t('Fecha', 'Date'), t('Mercado', 'Market'), t('Quién lleva la tienda', 'Store owner in axexo'), t('Quién visitó', 'Visited by'), t('Tienda', 'Store'), t('Dirección', 'Address'), t('Ciudad', 'City'),
      t('Estado', 'State'), t('Código postal', 'ZIP code'), t('Propósito', 'Purpose'), t('Resultado', 'Result'), t('Origen', 'Source')],
    data.rows.map((r) => [r.day, r.market_code, r.owner_name ?? '', safe(r.visited_by) || (r.owner_name ?? ''), safe(r.account_name), safe(r.address_line), safe(r.locality), safe(r.region), safe(r.postal_code),
      r.purpose_es ? t(r.purpose_es, r.purpose_en ?? r.purpose_es) : t('Sin propósito', 'No purpose'), r.outcome === 'sale' ? t('Con venta', 'Sale') : t('Sin venta', 'No sale'),
      r.origin === 'manual' ? 'CONTIGO' : 'Sales App']),
  )
  const market = f.market ?? (data.markets.length === 1 ? data.markets[0]! : null)
  await withUser(ctx.user.id, async (tx) => {
    await audit(tx, ctx, 'report.exported', 'report', null, market, null, { report: 'visit_detail', rows: data.rows.length, truncated: data.truncated, reason, filters: { from: data.from, to: data.to, market: f.market ?? null } })
    await governExport(tx, ctx, { what: 'visit_detail', reason, rows: data.rows.length, cap, truncated: data.truncated, market, filters: { from: data.from, to: data.to } })
  })
  return { csv, rows: data.rows.length, truncated: data.truncated, fileName: `contigo-visitas-detalle-${data.from}-a-${data.to}.csv` }
}
