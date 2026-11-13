import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import { loadCtx, type Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { scrub } from '@/domain/pipedrive/mapping'
import { forbidden, invalid, notFound } from '@/lib/errors'
import { toCsv } from '@/lib/periods'
import { isoDay } from '@/lib/format'
import { isMetricKey } from '@/lib/metric-defs'
import { REPORT_PARAMS, VIEW_FILTERS, reportByKey, type ViewObject } from '@/lib/report-catalog'
import { marketPeriods, type MarketPeriods } from '@/dal/reports'
import { getAgencyReport, getFieldKpis, getFinanceReport, getForecast, getHistory, getLeadsReport, getNodeReport, getReconciliation, getStagesReport, stageRate, wideScope, type Filters } from '@/dal/reportes'
import { queueOutbound } from '@/server/adapters/report-channels'
import { exportCap, exportReason, governExport } from '@/domain/exports'
import { notify } from '@/domain/notify'
import { SOURCE } from '@/lib/labels'

/** Tope de filas por archivo, el mismo de los demás reportes. */
const EXPORT_MAX = 10000
/** Diferencias que la conciliación tolera, en porcentaje de los ganados por primera venta. Arriba de esto, la corrida queda marcada. */
export const RECONCILE_THRESHOLD_PCT = 2

const safe = (s: string | null | undefined) => (s ? scrub(s) : '')
const major = (minor: string | number) => (Number(minor) / 100).toFixed(2)

// ------------------------------------------------------------------ dueño de un indicador
export async function setMetricOwner(ctx: Ctx, input: { key: string; owner: string }): Promise<void> {
  ctx.assert('metric.owner')
  const owner = input.owner.trim()
  if (!isMetricKey(input.key)) throw notFound()
  if (owner.length < 2 || owner.length > 80) throw invalid('Escribe quién responde por este número: un área o una persona, de 2 a 80 letras.', 'Write who answers for this number: an area or a person, 2 to 80 characters.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ owner_label: string }[]>`select owner_label from crm.metric_owners where metric_key = ${input.key}`
    await tx`insert into crm.metric_owners (metric_key, owner_label, updated_by) values (${input.key}, ${owner}, ${ctx.user.id})
             on conflict (metric_key) do update set owner_label = excluded.owner_label, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'metric.owner_set', 'metric', null, null, before[0] ? { metric: input.key, owner: before[0].owner_label } : null, { metric: input.key, owner })
  })
}

// ------------------------------------------------------------------ reportes guardados y programados
const paramsOf = (raw: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const k of REPORT_PARAMS) {
    const v = raw[k]
    if (typeof v === 'string' && v && v.length <= 80) out[k] = v
  }
  return out
}
const saved = z.object({ report: z.string(), name: z.string().trim().min(2).max(80), shared: z.boolean(), schedule: z.enum(['', 'daily', 'weekly']) })

/** Guarda un reporte con sus filtros: privado, o compartido con las personas de su mercado (solo quien dirige). Programarlo es opcional. */
export async function saveReport(ctx: Ctx, input: { report: string; name: string; params: Record<string, unknown>; shared: boolean; schedule: string }): Promise<string> {
  ctx.assert('report.save')
  const v = saved.safeParse(input)
  if (!v.success) throw invalid('Ponle un nombre al reporte, de 2 a 80 letras.', 'Give the report a name, 2 to 80 characters.')
  const def = reportByKey(v.data.report)
  if (!def || !ctx.can(def.cap)) throw forbidden()
  if (v.data.shared && !ctx.can('report.share')) throw forbidden()
  const params = paramsOf(input.params)
  const market = params.mercado && ctx.markets.some((m) => m.code === params.mercado) ? params.mercado : ctx.isGlobal ? null : (ctx.memberships.find((m) => m.market)?.market ?? null)
  return withUser(ctx.user.id, async (tx) => {
    const count = await tx<{ n: number }[]>`select count(*)::int as n from crm.saved_reports where user_id = ${ctx.user.id}`
    if ((count[0]?.n ?? 0) >= 30) throw invalid('Ya tienes 30 reportes guardados. Borra uno que no uses antes de guardar otro.', 'You already have 30 saved reports. Delete one you no longer use before saving another.')
    const rows = await tx<{ id: string }[]>`
      insert into crm.saved_reports (user_id, report, name, params, is_shared, market_code, schedule)
      values (${ctx.user.id}, ${def.key}, ${v.data.name}, ${tx.json(params)}, ${v.data.shared}, ${v.data.shared ? market : null}, ${v.data.schedule || null}) returning id`
    await audit(tx, ctx, 'saved_report.saved', 'saved_report', rows[0]!.id, market, null, { report: def.key, name: v.data.name, shared: v.data.shared, schedule: v.data.schedule || null })
    return rows[0]!.id
  })
}
export async function deleteReport(ctx: Ctx, id: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ report: string; name: string }[]>`delete from crm.saved_reports where id = ${id} and user_id = ${ctx.user.id} returning report, name`
    if (!rows[0]) throw notFound()
    await audit(tx, ctx, 'saved_report.deleted', 'saved_report', id, null, { report: rows[0].report, name: rows[0].name }, null)
  })
}
export async function scheduleReport(ctx: Ctx, id: string, schedule: string): Promise<void> {
  const s = schedule === 'daily' || schedule === 'weekly' ? schedule : null
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ name: string }[]>`update crm.saved_reports set schedule = ${s} where id = ${id} and user_id = ${ctx.user.id} returning name`
    if (!rows[0]) throw notFound()
    await audit(tx, ctx, 'saved_report.scheduled', 'saved_report', id, null, null, { name: rows[0].name, schedule: s })
  })
}
export async function markDeliveriesSeen(ctx: Ctx): Promise<void> {
  await withUser(ctx.user.id, (tx) => tx`update crm.report_deliveries set seen_at = now() where user_id = ${ctx.user.id} and seen_at is null`)
}

/** Quién cuenta como agencia además de los orígenes a nombre de un aliado: lo escribe administración. */
export async function setAgencyLabels(ctx: Ctx, raw: string): Promise<void> {
  ctx.assert('config.manage')
  const labels = [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 80))].slice(0, 40)
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ value: unknown }[]>`select value from crm.settings where key = 'reports.agency_labels'`
    await tx`insert into crm.settings (key, value) values ('reports.agency_labels', ${tx.json(labels)}) on conflict (key) do update set value = excluded.value`
    await audit(tx, ctx, 'agency.labels_set', 'setting', null, null, { labels: before[0]?.value ?? [] }, { labels })
  })
}

// ------------------------------------------------------------------ resumen de un reporte (lo que entrega un reporte programado)
const filtersOf = (ctx: Ctx, params: Record<string, string>): Filters => ({
  market: ctx.markets.some((m) => m.code === params.mercado) ? params.mercado : undefined,
  pipeline: params.embudo, team: params.equipo, owner: params.persona, source: params.fuente,
})
/** Dos o tres números del reporte, con el alcance de su dueño. Es texto corto: el detalle está en la pantalla. */
export async function reportHeadline(ctx: Ctx, key: string, params: Record<string, string>): Promise<string> {
  const t = ctx.t
  const p = marketPeriods(ctx, params.periodo, params.desde, params.hasta, 'mes')
  const f = filtersOf(ctx, params)
  if (key === 'leads') {
    const rows = await getLeadsReport(ctx, p, f)
    const leads = rows.reduce((n, r) => n + r.leads, 0), conv = rows.reduce((n, r) => n + r.converted, 0)
    return t(`${leads} leads, ${conv} convertidos (${leads ? Math.round((conv / leads) * 100) : 0}%).`, `${leads} leads, ${conv} converted (${leads ? Math.round((conv / leads) * 100) : 0}%).`)
  }
  if (key === 'etapas') {
    const rows = await getStagesReport(ctx, f)
    const open = rows.reduce((n, r) => n + r.deals, 0), no = rows.reduce((n, r) => n + r.no_step, 0)
    return t(`${open} negocios abiertos, ${no} sin próximo paso.`, `${open} open deals, ${no} with no next step.`)
  }
  if (key === 'pronostico') {
    const rows = await getForecast(ctx, f)
    const exp = rows.reduce((n, r) => n + r.open * stageRate(r).rate, 0), lo = rows.reduce((n, r) => n + r.open * stageRate(r).low, 0), hi = rows.reduce((n, r) => n + r.open * stageRate(r).high, 0)
    return t(`Se esperan ${Math.round(exp)} negocios ganados (entre ${Math.round(lo)} y ${Math.round(hi)}).`, `${Math.round(exp)} wins expected (between ${Math.round(lo)} and ${Math.round(hi)}).`)
  }
  if (key === 'finanzas' && ctx.can('report.finance')) {
    const d = await getFinanceReport(ctx, p, f)
    return t(`${d.totals.reduce((n, x) => n + x.n, 0)} negocios ganados. ${d.totals.map((x) => `${major(x.amount)} ${x.currency}`).join(', ')}`, `${d.totals.reduce((n, x) => n + x.n, 0)} deals won. ${d.totals.map((x) => `${major(x.amount)} ${x.currency}`).join(', ')}`).trim()
  }
  if (key === 'conciliacion' && ctx.can('report.reconcile')) {
    const d = await getReconciliation(ctx, f)
    const n = d.counts.filter((c) => c.kind !== 'status_mismatch').reduce((s, c) => s + c.n, 0)
    return t(`${n} diferencias entre CONTIGO y el archivo de ventas.`, `${n} differences between CONTIGO and the sales file.`)
  }
  return t('Tu reporte está listo. Ábrelo para ver el detalle.', 'Your report is ready. Open it to see the detail.')
}

// ------------------------------------------------------------------ exportación gobernada
export type ExportResult = { csv: string; rows: number; truncated: boolean; fileName: string }
/**
 * Exporta lo que el reporte muestra con esos filtros. Mismo gobierno que los demás archivos: permiso `report.export`,
 * tope de filas, sin teléfonos, correos ni contactos, y un evento en la bitácora con los filtros y el número de filas.
 */
export async function exportReport(ctx: Ctx, key: string, p: MarketPeriods, f: Filters & { mine?: boolean; level?: string; kind?: string }, rawReason: string): Promise<ExportResult> {
  const def = reportByKey(key)
  const scope = wideScope(ctx)
  const markets = [...scope.full, ...scope.team].filter((c) => ctx.can('report.export', c))
  if (!def || !def.exportable || !ctx.can(def.cap) || markets.length === 0 || (f.market && !markets.includes(f.market))) throw forbidden()
  // AUT-07: el mismo gobierno que toda exportación: sin motivo no hay archivo y el tope de filas es el del rol.
  const reason = exportReason(rawReason)
  const cap = Math.min(EXPORT_MAX, exportCap(ctx, f.market))
  if (cap < 1) throw forbidden()
  const t = ctx.t
  let head: string[] = []
  let rows: (string | number | null)[][] = []
  if (key === 'leads') {
    head = [t('Mes', 'Month'), t('Mercado', 'Market'), t('Fuente', 'Source'), t('Leads', 'Leads'), t('Convertidos', 'Converted'), t('Tasa de conversión (%)', 'Conversion rate (%)')]
    rows = (await getLeadsReport(ctx, p, f)).map((r) => [r.month, r.market_code, SOURCE[r.source] ? t(SOURCE[r.source]![0], SOURCE[r.source]![1]) : r.source, r.leads, r.converted, r.leads ? Math.round((r.converted / r.leads) * 100) : 0])
  } else if (key === 'etapas') {
    head = [t('Mercado', 'Market'), t('Embudo', 'Pipeline'), t('Etapa', 'Stage'), t('Negocios abiertos', 'Open deals'), t('Sin próximo paso', 'No next step'), t('Mediana de días en la etapa', 'Median days in stage'), t('Días del más antiguo', 'Days of the oldest'), t('Etapa larga', 'Long in stage'), t('Monto', 'Amount'), t('Moneda', 'Currency')]
    rows = (await getStagesReport(ctx, f)).map((r) => [r.market_code, safe(r.pipeline_name), t(r.name_es, r.name_en), r.deals, r.no_step, r.median_days ?? '', r.max_days ?? '', r.long, major(r.amount), r.currency])
  } else if (key === 'agencias') {
    head = [t('Mercado', 'Market'), t('Quién lo trajo', 'Brought in by'), t('Agencia', 'Agency'), t('Negocios', 'Deals'), t('Ganados', 'Won'), t('Perdidos', 'Lost'), t('Abiertos', 'Open')]
    rows = (await getAgencyReport(ctx, p, f)).map((r) => [r.market_code, r.grp === 'agency' ? t('Agencia', 'Agency') : t('Equipo interno', 'In-house team'), safe(r.label), r.deals, r.won, r.lost, r.open])
  } else if (key === 'finanzas') {
    const d = await getFinanceReport(ctx, p, f)
    head = [t('Mes', 'Month'), t('Mercado', 'Market'), t('Entidad legal', 'Legal entity'), t('Moneda', 'Currency'), t('Negocios ganados', 'Deals won'), t('Con monto', 'With an amount'), t('Monto', 'Amount')]
    rows = d.rows.map((r) => [r.month, r.market_code, safe(r.entity), r.currency, r.n, r.with_amount, major(r.amount)])
  } else if (key === 'cuentas') {
    head = [t('Mercado', 'Market'), t('Cuenta', 'Account'), t('Tipo', 'Type'), t('Quién la lleva', 'Owner'), t('Tiendas', 'Stores'), t('Activas', 'Active'), t('En riesgo', 'At risk'), t('Inactivas', 'Inactive'), t('Negocios abiertos', 'Open deals'), t('Ganados en el periodo', 'Won in the period'), t('Volumen, 30 días', 'Volume, 30 days'), t('Moneda', 'Currency')]
    rows = (await getNodeReport(ctx, p, f)).map((r) => [r.market_code, safe(r.name), r.kind, safe(r.owner_name), r.stores, r.active, r.at_risk, r.inactive, r.open_deals, r.won, major(r.volume), r.currency])
  } else if (key === 'pronostico') {
    head = [t('Mercado', 'Market'), t('Embudo', 'Pipeline'), t('Etapa', 'Stage'), t('Negocios abiertos', 'Open deals'), t('Tasa de avance (%)', 'Advance rate (%)'), t('De dónde sale la tasa', 'Where the rate comes from'), t('Esperado', 'Expected'), t('Mínimo', 'Low'), t('Máximo', 'High')]
    rows = (await getForecast(ctx, f)).map((r) => { const s = stageRate(r); return [r.market_code, safe(r.pipeline_name), t(r.name_es, r.name_en), r.open, Math.round(s.rate * 100), s.historical ? t(`Histórica: ${r.won} de ${r.closed}`, `Historical: ${r.won} of ${r.closed}`) : t('Configurada en la etapa', 'Set on the stage'), (r.open * s.rate).toFixed(1), (r.open * s.low).toFixed(1), (r.open * s.high).toFixed(1)] })
  } else if (key === 'indicadores-campo') {
    head = [t('Mercado', 'Market'), t('Equipo', 'Team'), t('Persona', 'Person'), t('Visitas', 'Visits'), t('Con venta', 'With a sale'), t('Tiendas visitadas', 'Stores visited'), t('Tiendas en cartera', 'Stores in the book'), t('Altas', 'Enrolled'), t('Confirmadas por la Sales App', 'Confirmed by the Sales App'), t('Registradas a mano', 'Logged by hand'), t('Excluidas por señal baja', 'Left out for a low signal')]
    rows = (await getFieldKpis(ctx, p, f)).map((r) => [r.market_code, safe(r.team_name), safe(r.owner_name) || t('Sin asignar', 'No owner'), r.visits, r.sales, r.visited, r.book, r.enrolled, r.confirmed, r.manual, r.low])
  } else if (key === 'historico') {
    const d = await getHistory(ctx, f)
    head = [t('Día', 'Day'), t('Mercado', 'Market'), t('Negocios abiertos', 'Open deals'), t('Sin próximo paso', 'No next step')]
    rows = d.pipeline.map((r) => [r.day, r.market_code, r.deals, r.no_step])
  } else if (key === 'conciliacion') {
    const d = await getReconciliation(ctx, f)
    head = [t('Mercado', 'Market'), t('Comercio', 'Merchant'), t('Diferencia', 'Difference'), t('Corte del archivo', 'File cutoff'), t('Primera venta en el archivo', 'First sale in the file'), t('Ganado en CONTIGO', 'Won in CONTIGO')]
    rows = d.diffs.map((r) => [r.market_code, safe(r.name), r.kind, r.as_of ?? '', r.first_txn_at ? isoDay(r.first_txn_at, ctx.market(r.market_code).timezone) : '', r.won_at ? isoDay(r.won_at, ctx.market(r.market_code).timezone) : ''])
  } else throw forbidden()
  const out = rows.slice(0, cap)
  const truncated = rows.length > cap
  const market = f.market ?? (markets.length === 1 ? markets[0]! : null)
  const filters = { period: p.key, from: p.first.from, to: p.first.to, pipeline: f.pipeline ?? null, team: f.team ?? null, owner: f.owner ?? null }
  await withUser(ctx.user.id, async (tx) => {
    await audit(tx, ctx, 'report.exported', 'report', null, market, null, { report: key, rows: out.length, truncated, reason, filters: { ...filters, market: f.market ?? null } })
    await governExport(tx, ctx, { what: `report_${key}`, reason, rows: out.length, cap, truncated, market, filters })
  })
  return { csv: toCsv(head, out), rows: out.length, truncated, fileName: `contigo-${key}-${p.first.from}-a-${p.first.to}.csv` }
}

// ------------------------------------------------------------------ vistas guardadas como colas (UX-03)
const filtersFor = (object: ViewObject, raw: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const k of VIEW_FILTERS[object]) {
    const v = raw[k]
    if (typeof v === 'string' && v && v.length <= 80) out[k] = v
  }
  return out
}
const isObject = (o: string): o is ViewObject => o === 'account' || o === 'lead' || o === 'deal' || o === 'activity'

/** Guarda el filtro actual de una lista como vista con nombre. Compartirla con el equipo es de quien dirige. */
export async function saveView(ctx: Ctx, input: { object: string; name: string; filters: Record<string, unknown>; shared: boolean; pin: boolean }): Promise<string> {
  ctx.assert('view.save')
  if (!isObject(input.object)) throw invalid('No se puede guardar una vista de esta lista.', 'A view of this list cannot be saved.')
  const name = input.name.trim()
  if (name.length < 2 || name.length > 60) throw invalid('Ponle un nombre a la vista, de 2 a 60 letras.', 'Give the view a name, 2 to 60 characters.')
  if (input.shared && !ctx.can('view.share')) throw forbidden()
  const filters = filtersFor(input.object, input.filters)
  // Con quién se comparte: el equipo de quien supervisa; quien lidera o administra la comparte con todos.
  const team = input.shared ? (ctx.memberships.find((m) => m.role === 'supervisor' && m.teamId)?.teamId ?? null) : null
  const wide = ctx.memberships.some((m) => m.role === 'admin' || m.role === 'market_lead')
  return withUser(ctx.user.id, async (tx) => {
    const mine = await tx<{ n: number; same: number }[]>`select count(*)::int as n, count(*) filter (where lower(name) = lower(${name}))::int as same from crm.saved_views where user_id = ${ctx.user.id} and object = ${input.object}`
    if ((mine[0]?.same ?? 0) > 0) throw invalid('Ya tienes una vista con ese nombre en esta lista. Usa otro nombre o borra la anterior.', 'You already have a view with that name on this list. Use another name or delete the old one.')
    if ((mine[0]?.n ?? 0) >= 12) throw invalid('Ya tienes 12 vistas en esta lista. Borra una que no uses antes de guardar otra.', 'You already have 12 views on this list. Delete one you no longer use before saving another.')
    const rows = await tx<{ id: string }[]>`
      insert into crm.saved_views (user_id, object, name, filters, is_shared, team_id)
      values (${ctx.user.id}, ${input.object}, ${name}, ${tx.json(filters)}, ${input.shared}, ${wide ? null : team}) returning id`
    const id = rows[0]!.id
    if (input.pin) await tx`insert into crm.saved_view_pins (user_id, view_id) values (${ctx.user.id}, ${id}) on conflict do nothing`
    await audit(tx, ctx, 'saved_view.saved', 'saved_view', id, null, null, { object: input.object, name, shared: input.shared, filters })
    return id
  })
}
export async function deleteView(ctx: Ctx, id: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ object: string; name: string }[]>`delete from crm.saved_views where id = ${id} and user_id = ${ctx.user.id} returning object, name`
    if (!rows[0]) throw notFound('Solo puedes borrar las vistas que guardaste tú.', 'You can only delete the views you saved yourself.')
    await audit(tx, ctx, 'saved_view.deleted', 'saved_view', id, null, { object: rows[0].object, name: rows[0].name }, null)
  })
}
/** Fija o quita una vista del menú de la persona. Fijar una vista compartida no la cambia para nadie más. */
export async function pinView(ctx: Ctx, id: string, on: boolean): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const v = await tx<{ name: string }[]>`select name from crm.saved_views where id = ${id}`
    if (!v[0]) throw notFound()
    if (on) {
      const n = await tx<{ n: number }[]>`select count(*)::int as n from crm.saved_view_pins where user_id = ${ctx.user.id}`
      if ((n[0]?.n ?? 0) >= 5) throw invalid('Puedes fijar hasta 5 colas en tu menú. Quita una antes de fijar otra.', 'You can pin up to 5 queues in your menu. Remove one before pinning another.')
      await tx`insert into crm.saved_view_pins (user_id, view_id) values (${ctx.user.id}, ${id}) on conflict do nothing`
    } else await tx`delete from crm.saved_view_pins where user_id = ${ctx.user.id} and view_id = ${id}`
    await audit(tx, ctx, on ? 'saved_view.pinned' : 'saved_view.unpinned', 'saved_view', id, null, null, { name: v[0].name })
  })
}

// ------------------------------------------------------------------ tareas programadas (las llama src/server/jobs/reportes.ts)
/** Foto diaria: la toma la función de la base con identidad propia, y deja el archivo de salida en la cola del canal (apagado). */
export async function takeSnapshot(tx: Tx): Promise<{ done: number; note?: string }> {
  const rows = await tx<{ n: number }[]>`select app.take_report_snapshots() as n`
  const days = await tx<{ day: string; n: number }[]>`select snapshot_date::text as day, count(*)::int as n from crm.pipeline_snapshots where taken_at >= now() - interval '1 minute' group by 1`
  let status = ''
  for (const d of days) status = await queueOutbound(tx, 'snapshot_file', { ref: `snapshot:${d.day}`, title: `pipeline_snapshot_${d.day}.csv`, rows: d.n, detail: { day: d.day } })
  await tx`insert into crm.audit_events (actor_id, action, object, after) values (app.system_user_id(), 'snapshot.taken', 'snapshot', ${tx.json({ rows: rows[0]?.n ?? 0, file: status || 'none' })})`
  return { done: rows[0]?.n ?? 0, note: status === 'simulated' ? 'file simulated' : 'file channel off' }
}
/** Conciliación con el archivo de ventas: guarda el conteo de diferencias por mercado y marca la corrida si pasa del umbral. */
export async function runReconciliation(tx: Tx): Promise<{ done: number; note?: string }> {
  const rows = await tx<{ n: number }[]>`select app.run_reconciliation(${RECONCILE_THRESHOLD_PCT}) as n`
  const breached = await tx<{ n: number }[]>`select count(*)::int as n from crm.reconciliation_runs where ran_at >= now() - interval '1 minute' and breached`
  await tx`insert into crm.audit_events (actor_id, action, object, after) values (app.system_user_id(), 'reconciliation.ran', 'reconciliation', ${tx.json({ markets: rows[0]?.n ?? 0, breached: breached[0]?.n ?? 0 })})`
  return { done: rows[0]?.n ?? 0, note: `${breached[0]?.n ?? 0} over threshold` }
}
/**
 * Reportes programados: para cada reporte que toca (diario, o semanal en lunes), calcula su resumen con el alcance de su
 * dueño y se lo deja dentro de CONTIGO (Reportes y centro de avisos). El correo sale por el servicio de avisos, con el canal apagado.
 */
export async function deliverScheduled(tx: Tx, now = new Date()): Promise<{ done: number; note?: string }> {
  const due = await tx<{ id: string; user_id: string; report: string; name: string; params: Record<string, string>; schedule: string }[]>`
    select r.id, r.user_id, r.report, r.name, r.params, r.schedule from crm.saved_reports r join crm.users u on u.id = r.user_id and u.is_active
     where r.schedule is not null
       and (r.last_run_at is null or r.last_run_at < ${now}::timestamptz - case r.schedule when 'daily' then interval '20 hours' else interval '6 days 20 hours' end)
     order by r.created_at limit 200`
  let done = 0
  const sysId = (await tx<{ id: string }[]>`select app.system_user_id() as id`)[0]!.id
  const sys = { user: { id: sysId } }
  for (const r of due) {
    const def = reportByKey(r.report)
    const owner = await loadCtx(r.user_id)
    if (!def || !owner || !owner.can(def.cap)) continue
    const sp = new URLSearchParams(r.params)
    const body = await reportHeadline(owner, r.report, r.params)
    const href = sp.size ? `${def.path}?${sp.toString()}` : def.path
    await tx`insert into crm.report_deliveries (saved_report_id, user_id, title, body, href) values (${r.id}, ${r.user_id}, ${r.name}, ${body.slice(0, 1200)}, ${href})`
    // El aviso sale por el servicio único: campana y centro de avisos al momento; el correo, por la preferencia de la persona (canal apagado).
    await notify(tx, sys, {
      to: r.user_id, kind: 'scheduled_report', market: owner.memberships.find((m) => m.market)?.market ?? null, link: href,
      title: [`Reporte programado: ${r.name}`, `Scheduled report: ${r.name}`], body: [body.slice(0, 600), body.slice(0, 600)],
    })
    await tx`update crm.saved_reports set last_run_at = ${now} where id = ${r.id}`
    await tx`insert into crm.audit_events (actor_id, action, object, object_id, after) values (app.system_user_id(), 'saved_report.delivered', 'saved_report', ${r.id}, ${tx.json({ report: r.report, schedule: r.schedule })})`
    done++
  }
  return { done }
}
