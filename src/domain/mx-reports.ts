import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { exportCap, exportReason, governExport } from '@/domain/exports'
import { scrub } from '@/domain/pipedrive/mapping'
import { forbidden } from '@/lib/errors'
import { toCsv } from '@/lib/periods'
import { SOURCE } from '@/lib/labels'
import { deadLeadsForMailing, getMarketReport, type MarketReport } from '@/dal/mx'

export const MARKET_EXPORTS = ['mensual', 'etapas', 'tipos'] as const
export type MarketExport = (typeof MARKET_EXPORTS)[number]
const MAILING_MAX = 10000
const safe = (s: string | null) => (s === null ? '' : scrub(s))

type Out = { csv: string; rows: number; truncated: boolean; fileName: string }

/**
 * Exporta una de las tablas del reporte del mercado. Son conteos: no lleva personas ni datos de contacto.
 * Como toda exportación (AUT-07): pide motivo, respeta el tope de filas del rol y queda anotada.
 */
export async function exportMarketReport(ctx: Ctx, market: string, months: number, what: MarketExport, rawReason: string): Promise<Out> {
  if (!ctx.can('report.export', market)) throw forbidden()
  const reason = exportReason(rawReason)
  const cap = exportCap(ctx, market)
  if (cap < 1) throw forbidden()
  const t = ctx.t
  const data: MarketReport = await getMarketReport(ctx, market, months)
  const none = t('Sin dato', 'Not set')
  const [head, all]: [string[], (string | number)[][]] =
    what === 'mensual'
      ? [[t('Mes', 'Month'), t('Leads capturados', 'Leads captured'), t('Leads convertidos', 'Leads converted'), t('Negocios creados', 'Deals created'), t('Negocios ganados', 'Deals won'), t('Negocios perdidos', 'Deals lost')],
          data.monthly.map((r) => [r.month, r.leads, r.converted, r.deals_created, r.won, r.lost])]
      : what === 'etapas'
        ? [[t('Embudo', 'Pipeline'), t('Etapa', 'Stage'), t('Negocios abiertos', 'Open deals'), t('Monto', 'Amount'), t('Moneda', 'Currency')],
            data.stages.map((r) => [r.pipeline, t(r.stage_es, r.stage_en), r.deals, r.amount === null ? '' : (Number(r.amount) / 100).toFixed(2), r.amount === null ? '' : r.currency])]
        : [[t('Embudo de campaña', 'Campaign group'), t('Tipo de empresa', 'Company type'), t('Número de tiendas', 'Number of stores'), t('Leads', 'Leads'), t('Convertidos', 'Converted'), t('Tiendas (suma)', 'Stores (sum)')],
            data.types.map((r) => [r.funnel ?? none, r.type_es ? t(r.type_es, r.type_en ?? r.type_es) : none, r.bucket === 'none' ? none : r.bucket, r.leads, r.converted, r.stores ?? ''])]
  const rows = all.slice(0, cap)
  const truncated = all.length > cap
  const filters = { market, months: data.months, from: data.from }
  await withUser(ctx.user.id, async (tx) => {
    await audit(tx, ctx, 'report.exported', 'report', null, market, null, { report: `market_${what}`, rows: rows.length, truncated, reason, filters })
    await governExport(tx, ctx, { what: `market_${what}`, reason, rows: rows.length, cap, truncated, market, filters })
  })
  return { csv: toCsv(head, rows), rows: rows.length, truncated, fileName: `contigo-${market.toLowerCase()}-${what}-desde-${data.from}.csv` }
}

/**
 * Base de correo de leads descartados (E18.F9). Sale con correo: por eso lleva permiso propio (quien lidera el mercado y
 * administración), solo incluye a quien dio su consentimiento y deja el evento en la bitácora con el número de filas.
 */
export async function exportDeadLeads(ctx: Ctx, market: string, rawReason: string): Promise<Out> {
  if (!ctx.can('lead.mailing_export', market)) throw forbidden()
  // Es la exportación más sensible (sale con correo): mismo motivo, mismo tope por rol y misma bitácora que las demás.
  const reason = exportReason(rawReason)
  const cap = Math.min(MAILING_MAX, exportCap(ctx, market))
  if (cap < 1) throw forbidden()
  const mk = ctx.market(market)
  const t = ctx.t
  return withUser(ctx.user.id, async (tx) => {
    const all = await deadLeadsForMailing(tx, market, mk.timezone, cap + 1)
    const rows = all.slice(0, cap)
    const truncated = all.length > cap
    const csv = toCsv(
      [t('Negocio', 'Business'), t('Persona', 'Person'), t('Correo', 'Email'), t('Ciudad', 'City'), t('Motivo del descarte', 'Reason it was closed'), t('Origen', 'Source'), t('Embudo de campaña', 'Campaign group'), t('Aceptó recibir correos el', 'Agreed to emails on'), t('Llegó el', 'Arrived on')],
      rows.map((r) => [safe(r.business_name), safe(r.contact_name), r.email, safe(r.locality), r.reason_es ? t(r.reason_es, r.reason_en ?? r.reason_es) : '', SOURCE[r.source] ? t(...SOURCE[r.source]!) : r.source, r.funnel ?? '', r.consent_on, r.created_on]))
    await audit(tx, ctx, 'report.exported', 'report', null, market, null, { report: 'dead_leads_mailing', rows: rows.length, truncated, reason, filters: { market, consent: true } })
    await governExport(tx, ctx, { what: 'market_dead_leads_mailing', reason, rows: rows.length, cap, truncated, market, filters: { market, consent: true } })
    return { csv, rows: rows.length, truncated, fileName: `contigo-${market.toLowerCase()}-leads-descartados-base-de-correo.csv` }
  })
}
