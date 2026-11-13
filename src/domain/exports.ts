import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { scrub } from '@/domain/pipedrive/mapping'
import type { Role } from '@/domain/policy'
import { listAccounts, type AccountFilters } from '@/dal/accounts'
import { listLeads, type LeadFilters } from '@/dal/leads'
import { forbidden, invalid } from '@/lib/errors'
import { toCsv } from '@/lib/periods'
import { isoDay } from '@/lib/format'
import { LEAD_STATUS, LIFECYCLE, MOTOR, SOURCE, lab } from '@/lib/labels'

// AUT-07: toda exportación pide motivo, tiene tope de filas según el rol, queda anotada con filtros y conteo, y avisa a
// administración cuando una persona pasa el umbral diario. Vale para las exportaciones que ya existían y para las nuevas.
/** Tope de filas por archivo, por rol. Quien tiene varios roles usa el más alto de los que le dejan exportar ahí. */
export const EXPORT_CAPS: Partial<Record<Role, number>> = { admin: 10000, lt: 10000, market_lead: 5000, supervisor: 2000 }
/** Umbral diario por persona (últimas 24 horas): pasado cualquiera de los dos, la exportación se marca y avisa. */
export const EXPORT_DAILY = { rows: 20000, files: 20 } as const
export type ExportWhat = 'closed_deals' | 'field_stores' | 'field_visits' | 'accounts' | 'leads'

export function exportCap(ctx: Ctx, market?: string | null): number {
  const caps = ctx.memberships.filter((m) => m.market === null || !market || m.market === market).map((m) => EXPORT_CAPS[m.role] ?? 0)
  return Math.max(0, ...caps)
}

/** El motivo: entre 8 y 300 caracteres, sin datos prohibidos. Se guarda tal cual con la exportación. */
export function exportReason(raw: string | null | undefined): string {
  const reason = (raw ?? '').trim()
  if (reason.length < 8 || reason.length > 300) throw invalid('Escribe para qué necesitas el archivo (entre 8 y 300 caracteres).', 'Say what you need the file for (between 8 and 300 characters).')
  assertNoProhibited(reason)
  return reason
}

/** Anota la exportación y revisa el umbral diario de la persona. Corre en la misma transacción que la lectura. */
export async function governExport(tx: Tx, ctx: Ctx, e: { what: ExportWhat; reason: string; rows: number; cap: number; truncated: boolean; market: string | null; filters: Record<string, unknown> }): Promise<{ alert: boolean }> {
  const day = await tx<{ rows: number; files: number }[]>`
    select coalesce(sum(rows), 0)::int as rows, count(*)::int as files from crm.export_log where user_id = ${ctx.user.id} and created_at > now() - interval '24 hours'`
  const totals = { rows: (day[0]?.rows ?? 0) + e.rows, files: (day[0]?.files ?? 0) + 1 }
  const alert = totals.rows > EXPORT_DAILY.rows || totals.files > EXPORT_DAILY.files
  await tx`insert into crm.export_log (user_id, market_code, what, reason, rows, row_cap, truncated, filters, alert)
           values (${ctx.user.id}, ${e.market}, ${e.what}, ${e.reason}, ${e.rows}, ${e.cap}, ${e.truncated}, ${tx.json(e.filters as never)}, ${alert})`
  if (alert) await audit(tx, ctx, 'export.alert', 'user', ctx.user.id, e.market, null, { what: e.what, rows_24h: totals.rows, files_24h: totals.files, limit_rows: EXPORT_DAILY.rows, limit_files: EXPORT_DAILY.files })
  return { alert }
}

export type ListExport = { csv: string; rows: number; truncated: boolean; fileName: string }
const safe = (s: string | null | undefined) => (s ? scrub(s) : '')
/** El día del archivo es el del mercado del filtro (o el primero del alcance), no el del servidor. */
const today = (ctx: Ctx, market?: string) => isoDay(new Date(), ctx.markets.find((m) => m.code === market)?.timezone ?? ctx.markets[0]?.timezone ?? 'UTC')

function assertListExport(ctx: Ctx, market?: string): number {
  if (!ctx.can('report.export', market)) throw forbidden()
  const cap = exportCap(ctx, market)
  if (cap < 1) throw forbidden()
  return cap
}

/** Exporta los comercios que la lista muestra con esos filtros. Sin teléfonos, correos ni contactos. */
export async function exportAccounts(ctx: Ctx, f: AccountFilters, rawReason: string): Promise<ListExport> {
  const reason = exportReason(rawReason)
  const cap = assertListExport(ctx, f.market)
  const { t } = ctx
  const data = await listAccounts(ctx, { ...f, after: undefined }, cap)
  const csv = toCsv(
    [t('Comercio', 'Merchant'), t('Mercado', 'Market'), t('Tipo', 'Type'), t('Canal', 'Channel'), t('Etapa de vida', 'Lifecycle'), t('Ciudad', 'City'), t('Estado', 'State'), t('Territorio', 'Territory'), t('Quién lo lleva', 'Owner'), t('Cadena', 'Parent')],
    data.items.map((a) => [safe(a.name), a.market_code, t(a.type_es ?? a.kind, a.type_en ?? a.kind), a.segment ?? '', lab(t, LIFECYCLE[a.lifecycle]?.label, a.lifecycle), safe(a.locality), safe(a.region), a.territory ?? '', a.owner_name ?? '', safe(a.parent_name)]),
  )
  const truncated = data.next !== null
  await withUser(ctx.user.id, async (tx) => {
    const filters = Object.fromEntries(Object.entries(f).filter(([k, v]) => v && !['after', 'ficha', 'vista', 'repartir', 'motivo'].includes(k)).map(([k, v]) => [k, String(v).slice(0, 80)]))
    await audit(tx, ctx, 'report.exported', 'report', null, f.market ?? null, null, { report: 'accounts', rows: data.items.length, truncated, reason, filters })
    await governExport(tx, ctx, { what: 'accounts', reason, rows: data.items.length, cap, truncated, market: f.market ?? null, filters })
  })
  return { csv, rows: data.items.length, truncated, fileName: `contigo-comercios-${today(ctx, f.market)}.csv` }
}

/** Exporta los leads que la lista muestra con esos filtros. Sin nombre, teléfono ni correo de la persona. */
export async function exportLeads(ctx: Ctx, f: LeadFilters, rawReason: string): Promise<ListExport> {
  const reason = exportReason(rawReason)
  const cap = assertListExport(ctx, f.market)
  const { t } = ctx
  const data = await listLeads(ctx, { ...f, before: undefined }, cap)
  const stamp = (d: Date | string | null) => (d ? new Date(d).toISOString() : '')
  const csv = toCsv(
    [t('Negocio', 'Business'), t('Mercado', 'Market'), t('Ciudad', 'City'), t('Tipo de venta', 'Sale type'), t('Fuente', 'Source'), t('Estado', 'Status'), t('Quién lo lleva', 'Owner'), t('Llegó (UTC)', 'Arrived (UTC)'), t('Primer contacto (UTC)', 'First contact (UTC)')],
    data.items.map((l) => [safe(l.business_name), l.market_code, safe(l.locality), lab(t, MOTOR[l.motor], l.motor), lab(t, SOURCE[l.source], l.source), lab(t, LEAD_STATUS[l.status]?.label, l.status), l.owner_name ?? t('Sin asignar', 'No owner'), stamp(l.created_at), stamp(l.first_touch_at)]),
  )
  const truncated = data.next !== null
  await withUser(ctx.user.id, async (tx) => {
    const filters = Object.fromEntries(Object.entries(f).filter(([k, v]) => v && !['before', 'motivo'].includes(k)).map(([k, v]) => [k, String(v).slice(0, 80)]))
    await audit(tx, ctx, 'report.exported', 'report', null, f.market ?? null, null, { report: 'leads', rows: data.items.length, truncated, reason, filters })
    await governExport(tx, ctx, { what: 'leads', reason, rows: data.items.length, cap, truncated, market: f.market ?? null, filters })
  })
  return { csv, rows: data.items.length, truncated, fileName: `contigo-leads-${today(ctx, f.market)}.csv` }
}
