import { afterAll, describe, expect, it } from 'vitest'
import { attempt, asPersona, ctxFor, owner, personaId, systemContext } from './helpers'
import { withSystem, withUser } from '@/server/db'
import { can, type Membership, type Role } from '@/domain/policy'
import { METRICS, METRIC_KEYS, metricOwner } from '@/lib/metric-defs'
import { REPORTS, VIEW_FILTERS, viewHref } from '@/lib/report-catalog'
import { JOBS } from '@/server/jobs/registry'
import { marketPeriods, getClosedDeals } from '@/dal/reports'
import {
  getAgencyReport, getCarry, getFieldKpis, getFinanceReport, getForecast, getHistory, getKamBoard, getLeadsReport, getNodeReport, getReconciliation, getStagesReport, getUsage,
  listDeliveries, listSavedReports, listViews, metricOwners, pinnedQueues, salesCutoff, stageRate, wideScope, USAGE_WEEKS,
} from '@/dal/reportes'
import {
  deleteReport, deleteView, deliverScheduled, exportReport, pinView, reportHeadline, runReconciliation, saveReport, saveView, scheduleReport, setAgencyLabels, setMetricOwner, takeSnapshot,
} from '@/domain/reportes'
import { ingestMetricsFile } from '@/domain/integrations'
import { listAccounts } from '@/dal/accounts'
import { channelMode } from '@/server/adapters/report-channels'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const year = (ctx: Awaited<ReturnType<typeof ctxFor>>) => marketPeriods(ctx, 'rango', '2026-01-01', '2026-12-31')
const m = (role: Role, market: string | null = 'MX'): Membership[] => [{ role, market, teamId: null }]

describe('una sola capa de métricas (REP-01, REP-04)', () => {
  it('cada indicador tiene definición, ventana, fuente y dueño, en español y en inglés', () => {
    for (const k of METRIC_KEYS) {
      const d = METRICS[k]
      for (const pair of [d.label, d.what, d.window, d.source, d.owner]) {
        expect(pair[0].length, `${k} es`).toBeGreaterThan(1)
        expect(pair[1].length, `${k} en`).toBeGreaterThan(1)
      }
      // Vocabulario: en español no se nombra el sistema interno ni se usa "deal" o "pipeline".
      expect(`${d.label[0]} ${d.what[0]} ${d.window[0]} ${d.source[0]} ${d.owner[0]}`).not.toMatch(/\bS5\b|\bdeals?\b|pipeline|—|–/i)
    }
  })
  it('activo y en riesgo se definen por el estado que manda el archivo de ventas, no por una regla propia', () => {
    expect(METRICS.active.what[0]).toContain('lo manda el archivo diario de ventas')
    expect(METRICS.risk.source[0]).toContain('archivo diario de ventas')
  })
  it('el dueño lo cambia administración; los demás no; el cambio queda en la bitácora y manda sobre el dueño por defecto', async () => {
    const nora = await ctxFor('nora.salas')
    const ana = await ctxFor('ana.robles')
    await expect(setMetricOwner(ana, { key: 'won', owner: 'Ana' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setMetricOwner(nora, { key: 'no_existe', owner: 'Alguien' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(setMetricOwner(nora, { key: 'won', owner: 'x' })).rejects.toMatchObject({ code: 'invalid' })
    expect(metricOwner('won', await metricOwners(ana), ana.t)).toBe('Ventas')
    await setMetricOwner(nora, { key: 'won', owner: 'Dirección comercial' })
    expect(metricOwner('won', await metricOwners(ana), ana.t)).toBe('Dirección comercial')
    const ev = await one(admin`select after from crm.audit_events where action = 'metric.owner_set' order by at desc limit 1`)
    expect(ev.after).toMatchObject({ metric: 'won', owner: 'Dirección comercial' })
    expect(await asPersona('ana.robles', (tx) => attempt(tx, (sp) => sp`update crm.metric_owners set owner_label = 'Otra' where metric_key = 'won'`))).toBe('0 rows')
  })
})

describe('permisos del paquete reportes', () => {
  it('la página Reportes es de todos; Finanzas y conciliación, de leadership, quien lidera y administración', () => {
    for (const role of ['admin', 'lt'] as Role[]) expect(can(m(role, null), 'report.gallery')).toBe(true)
    for (const role of ['market_lead', 'supervisor', 'rep', 'ops'] as Role[]) expect(can(m(role), 'report.gallery', 'MX'), role).toBe(true)
    for (const role of ['supervisor', 'rep', 'ops'] as Role[]) {
      expect(can(m(role), 'report.finance', 'MX'), role).toBe(false)
      expect(can(m(role), 'report.reconcile', 'MX'), role).toBe(false)
    }
    expect(can(m('market_lead'), 'report.finance', 'MX')).toBe(true)
  })
  it('supervisión ve la adopción de su equipo; ventas y operaciones no. Compartir es de quien dirige', () => {
    expect(can(m('supervisor'), 'adoption.team', 'MX')).toBe(true)
    for (const role of ['rep', 'ops'] as Role[]) expect(can(m(role), 'adoption.team', 'MX'), role).toBe(false)
    for (const role of ['rep', 'ops'] as Role[]) {
      expect(can(m(role), 'report.share', 'MX'), role).toBe(false)
      expect(can(m(role), 'view.share', 'MX'), role).toBe(false)
      expect(can(m(role), 'view.save', 'MX'), role).toBe(true)
    }
    expect(can(m('lt', null), 'report.share')).toBe(false)
    expect(can(m('supervisor'), 'view.share', 'MX')).toBe(true)
  })
  it('cada reporte de la galería tiene ruta, textos en dos idiomas y un permiso que existe', () => {
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(REPORTS.length)
    for (const r of REPORTS) {
      expect(r.path.startsWith('/')).toBe(true)
      expect(r.title[0] && r.title[1] && r.desc[0] && r.desc[1]).toBeTruthy()
      expect(can(m('admin', null), r.cap), r.key).toBe(true)
    }
  })
})

describe('reportes de E8', () => {
  it('E8.F1: leads por mes, fuente y mercado suman lo que hay, y los convertidos nunca pasan de los leads', async () => {
    const nora = await ctxFor('nora.salas')
    const rows = await getLeadsReport(nora, year(nora), {})
    const total = (await one(admin`select count(*)::int as n from crm.leads l join crm.markets mk on mk.code = l.market_code where mk.status = 'live' and (l.created_at at time zone mk.timezone)::date between '2026-01-01' and '2026-12-31'`)).n
    expect(rows.reduce((n, r) => n + r.leads, 0)).toBe(total)
    for (const r of rows) expect(r.converted).toBeLessThanOrEqual(r.leads)
    const mx = await getLeadsReport(nora, year(nora), { market: 'MX', source: 'web_form' })
    expect(mx.every((r) => r.market_code === 'MX' && r.source === 'web_form')).toBe(true)
  })
  it('E8.F1: quien vende solo ve sus leads; la líder de México no ve los de US', async () => {
    const marco = await ctxFor('marco.pena')
    const mine = (await one(admin`select count(*)::int as n from crm.leads where owner_id = ${marco.user.id} and created_at >= '2026-01-01'`)).n
    expect((await getLeadsReport(marco, year(marco), {})).reduce((n, r) => n + r.leads, 0)).toBe(mine)
    const ana = await ctxFor('ana.robles')
    expect((await getLeadsReport(ana, year(ana), {})).some((r) => r.market_code === 'US')).toBe(false)
  })
  it('E8.F2: negocios por etapa cuenta todos los abiertos, con días en la etapa y los que no tienen próximo paso', async () => {
    const nora = await ctxFor('nora.salas')
    const rows = await getStagesReport(nora, {})
    const open = (await one(admin`select count(*)::int as n from crm.deals d join crm.markets mk on mk.code = d.market_code where d.status = 'open' and mk.status = 'live'`)).n
    expect(rows.reduce((n, r) => n + r.deals, 0)).toBe(open)
    for (const r of rows) {
      expect(r.no_step).toBeLessThanOrEqual(r.deals)
      if (r.deals > 0) expect(r.median_days).not.toBeNull()
      else expect(r.median_days).toBeNull()
    }
    const fer = await ctxFor('fernando.ibarra')
    const team = await getStagesReport(fer, {})
    expect(team.reduce((n, r) => n + r.deals, 0)).toBeLessThan(open)
    expect(team.every((r) => r.market_code === 'MX')).toBe(true)
  })
  it('E8.F3: un comercio con origen a nombre de un aliado cuenta como agencia; administración puede marcar otros nombres', async () => {
    const nora = await ctxFor('nora.salas')
    const before = await getAgencyReport(nora, year(nora), {})
    expect(before.filter((r) => r.grp === 'agency').length).toBe(0)
    const deal = await one(admin`select d.account_id from crm.deals d where d.market_code = 'MX' and d.created_at >= '2026-01-01' limit 1`)
    await admin`delete from crm.account_attributions where account_id = ${deal.account_id} and layer = 'origin'`
    await admin`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label) values (${deal.account_id}, 'MX', 'origin', 'partner', 'ag-1', 'Agencia Ruta Norte')`
    const after = await getAgencyReport(nora, year(nora), {})
    const ag = after.filter((r) => r.grp === 'agency')
    expect(ag.length).toBe(1)
    expect(ag[0]!.label).toBe('Agencia Ruta Norte')
    expect(after.reduce((n, r) => n + r.deals, 0)).toBe(before.reduce((n, r) => n + r.deals, 0))
    await expect(setAgencyLabels(await ctxFor('ana.robles'), 'Carga inicial')).rejects.toMatchObject({ code: 'forbidden' })
    await setAgencyLabels(nora, 'Carga inicial, Formulario web')
    const marked = await getAgencyReport(nora, year(nora), {})
    expect(marked.filter((r) => r.grp === 'agency').reduce((n, r) => n + r.deals, 0)).toBeGreaterThan(ag[0]!.deals)
  })
  it('E8.F5: Finanzas suma ganados por moneda y entidad legal igual que Negocios cerrados, y consolida solo con tasa', async () => {
    const nora = await ctxFor('nora.salas')
    const fin = await getFinanceReport(nora, year(nora), {})
    const closed = await getClosedDeals(nora, year(nora), { result: 'won' })
    expect(fin.totals.reduce((n, x) => n + x.n, 0)).toBe(closed.won)
    for (const a of closed.amounts.filter((x) => x.status === 'won')) expect(fin.totals.find((x) => x.currency === a.currency)!.amount).toBe(Number(a.amount))
    expect(fin.rows.some((r) => r.entity)).toBe(true)
    const needs = fin.totals.filter((x) => x.amount > 0 && x.currency !== 'USD')
    if (needs.every((x) => fin.rates.some((r) => r.currency === x.currency))) expect(fin.usd).not.toBeNull()
    await admin`delete from crm.fx_rates`
    const noRate = await getFinanceReport(nora, year(nora), {})
    if (needs.length) { expect(noRate.usd).toBeNull(); expect(noRate.missing).toContain(needs[0]!.currency) }
    // Supervisión no tiene mercados completos: el reporte no le devuelve nada.
    expect((await getFinanceReport(await ctxFor('fernando.ibarra'), year(nora), {})).rows.length).toBe(0)
  })
})

describe('agrupación por nodo del árbol y cuentas clave (REP-01)', () => {
  it('cada cadena suma todas sus tiendas, a cualquier profundidad', async () => {
    const nora = await ctxFor('nora.salas')
    const nodes = await getNodeReport(nora, year(nora), {})
    expect(nodes.length).toBeGreaterThan(0)
    for (const n of nodes.slice(0, 5)) {
      const real = (await one(admin`select count(*)::int as n from crm.accounts c where c.ancestor_ids @> array[${n.id}::uuid] and c.kind = 'store' and c.archived_at is null`)).n
      expect(n.stores, n.name).toBe(real)
      expect(n.active + n.at_risk + n.inactive).toBeLessThanOrEqual(n.stores)
    }
    const all = await getNodeReport(nora, year(nora), { level: 'todos' })
    expect(all.length).toBeGreaterThanOrEqual(nodes.length)
  })
  it('"Mis cuentas" deja solo lo que lleva la persona; etapas largas y próximos hitos salen de sus negocios', async () => {
    const diana = await ctxFor('diana.cruz')
    const mine = await getNodeReport(diana, year(diana), { mine: true, level: 'todos' })
    const owned = (await one(admin`select count(*)::int as n from crm.accounts where owner_id = ${diana.user.id} and kind <> 'store' and archived_at is null`)).n
    expect(mine.length).toBe(Math.min(owned, 200))
    const kam = await getKamBoard(diana, { mine: true })
    for (const d of kam.long) expect(d.days).toBeGreaterThan(d.rot_days)
    for (const d of kam.milestones) expect(d.next_step_due).not.toBeNull()
  })
})

describe('histórico: foto diaria, cohortes y velocidad (REP-02)', () => {
  it('la foto la toma la tarea con identidad propia, cuenta todo el mercado y se puede repetir el mismo día', async () => {
    await admin`delete from crm.pipeline_snapshots where snapshot_date >= (now() at time zone 'America/Mexico_City')::date - 1`
    const out = await withSystem((tx) => takeSnapshot(tx))
    expect(out.done).toBeGreaterThan(0)
    const open = (await one(admin`select count(*)::int as n from crm.deals d join crm.stages s on s.id = d.stage_id where d.market_code = 'MX' and d.status = 'open' and s.kind in ('open','awaiting_txn')`)).n
    const snap = (await one(admin`select sum(deals)::int as n from crm.pipeline_snapshots where market_code = 'MX' and snapshot_date = (now() at time zone 'America/Mexico_City')::date`)).n
    expect(snap).toBe(open)
    const rows = (await one(admin`select count(*)::int as n from crm.pipeline_snapshots`)).n
    await withSystem((tx) => takeSnapshot(tx))
    expect((await one(admin`select count(*)::int as n from crm.pipeline_snapshots`)).n).toBe(rows)
    const cartera = (await one(admin`select sum(accounts)::int as n from crm.portfolio_snapshots where market_code = 'MX' and snapshot_date = (now() at time zone 'America/Mexico_City')::date`)).n
    expect(cartera).toBe((await one(admin`select count(*)::int as n from crm.accounts where market_code = 'MX' and kind = 'store' and archived_at is null`)).n)
  })
  it('quien vende no puede tomar la foto ni escribir en ella; el archivo de salida queda en la cola con el canal apagado', async () => {
    expect(await asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`select app.take_report_snapshots()`))).toBe('42501')
    expect(await asPersona('ana.robles', (tx) => attempt(tx, (sp) => sp`insert into crm.pipeline_snapshots (snapshot_date, market_code, pipeline_id, stage_id, deals, no_next_step, currency) select '2020-01-01', 'MX', pipeline_id, id, 1, 0, 'MXN' from crm.stages limit 1`))).toBe('42501')
    expect(channelMode('snapshot_file')).toBe('off')
    const q = await admin`select status, title from crm.report_outbox where channel = 'snapshot_file'`
    expect(q.length).toBeGreaterThan(0)
    expect(q.every((r) => r.status === 'channel_off')).toBe(true)
  })
  it('la foto diaria es del mercado completo: supervisión no la ve; cohortes y velocidad sí son de su alcance', async () => {
    const nora = await ctxFor('nora.salas')
    const h = await getHistory(nora, {})
    expect(h.pipeline.length).toBeGreaterThan(0)
    expect(h.snapshotScope).toBe(true)
    for (const c of h.leads) { expect(c.c30).toBeLessThanOrEqual(c.c60); expect(c.c60).toBeLessThanOrEqual(c.c90); expect(c.c90).toBeLessThanOrEqual(c.leads) }
    for (const c of h.stores) expect(c.first_sale).toBeLessThanOrEqual(c.stores)
    for (const v of h.velocity) expect(v.p50).toBeLessThanOrEqual(v.p90)
    const fer = await getHistory(await ctxFor('fernando.ibarra'), {})
    expect(fer.pipeline.length).toBe(0)
    expect(fer.snapshotScope).toBe(false)
  })
  it('la velocidad por etapa mide lo que tarda un negocio en salir de una etapa', async () => {
    const d = await one(admin`select d.id, d.market_code, d.pipeline_id from crm.deals d where d.market_code = 'MX' and d.status = 'open' limit 1`)
    const st = await admin`select id from crm.stages where pipeline_id = ${d.pipeline_id} and kind = 'open' order by position limit 2`
    await admin`delete from crm.deal_stage_events where deal_id = ${d.id}`
    await admin`insert into crm.deal_stage_events (deal_id, market_code, to_stage_id, at) values (${d.id}, 'MX', ${st[0]!.id}, now() - interval '10 days'), (${d.id}, 'MX', ${st[1]!.id}, now() - interval '4 days')`
    const nora = await ctxFor('nora.salas')
    const v = (await getHistory(nora, {})).velocity.find((x) => x.stage_id === st[0]!.id)
    expect(v).toBeDefined()
    expect(v!.n).toBeGreaterThanOrEqual(1)
  })
})

describe('conciliación con el archivo de ventas (REP-04)', () => {
  it('cuando el archivo trae el estado del comercio, manda el archivo; sin estado se usa la regla de respaldo', async () => {
    const sys = await systemContext()
    const acc = await one(admin`select a.id from crm.accounts a where a.market_code = 'MX' and a.lifecycle = 'active' and a.kind = 'store' limit 1`)
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${acc.id}, 'MX', 's5', 'MID-REP-1')`
    const row = { merchant_ref: 'MID-REP-1', first_txn_at: '2026-06-01T15:00:00+00:00', last_txn_at: '2026-11-10T15:00:00+00:00', txn_count_30d: 90, volume_minor_30d: 900000, currency: 'MXN', active_days_30d: 28 }
    // Con 28 días de venta la regla propia diría "activo": el archivo dice "en riesgo" y eso queda.
    await ingestMetricsFile(sys, { as_of: '2026-11-11', file_name: 'rep-1.json', mode: 'delta', rows: [{ ...row, status: 'at_risk' }] })
    expect((await one(admin`select lifecycle from crm.accounts where id = ${acc.id}`)).lifecycle).toBe('at_risk')
    expect((await one(admin`select status from crm.merchant_metrics_daily where account_id = ${acc.id} and as_of = '2026-11-11'`)).status).toBe('at_risk')
    // Sin estado en el archivo: regla de respaldo (28 días de venta: vuelve a activo).
    await ingestMetricsFile(sys, { as_of: '2026-11-12', file_name: 'rep-2.json', mode: 'delta', rows: [row] })
    expect((await one(admin`select lifecycle from crm.accounts where id = ${acc.id}`)).lifecycle).toBe('active')
    await expect(ingestMetricsFile(sys, { as_of: '2026-11-13', file_name: 'rep-3.json', mode: 'delta', rows: [{ ...row, status: 'feliz' }] })).rejects.toBeTruthy()
  })
  it('lista los ganados sin primera venta en el archivo y las primeras ventas con negocio abierto, y guarda la corrida con su umbral', async () => {
    const nora = await ctxFor('nora.salas')
    const before = await getReconciliation(nora, { market: 'MX' })
    const base = before.counts.filter((c) => c.kind === 'won_without_txn').reduce((n, c) => n + c.n, 0)
    const won = await one(admin`select d.id, d.account_id from crm.deals d join crm.pipelines p on p.id = d.pipeline_id and p.close_by_transaction
       where d.market_code = 'MX' and d.status = 'won' and d.closed_by = 'transaction' and exists (select 1 from crm.merchant_metrics_daily mm where mm.account_id = d.account_id and mm.first_txn_at is not null) limit 1`)
    await admin`update crm.merchant_metrics_daily set first_txn_at = null where account_id = ${won.account_id}`
    const after = await getReconciliation(nora, { market: 'MX' })
    expect(after.counts.filter((c) => c.kind === 'won_without_txn').reduce((n, c) => n + c.n, 0)).toBe(base + 1)
    expect(after.diffs.some((d) => d.deal_id === won.id && d.kind === 'won_without_txn')).toBe(true)
    expect((await getReconciliation(nora, { market: 'MX', kind: 'txn_without_won' })).diffs.every((d) => d.kind === 'txn_without_won')).toBe(true)
    const out = await withSystem((tx) => runReconciliation(tx))
    expect(out.done).toBeGreaterThan(0)
    const run = (await getReconciliation(nora, { market: 'MX' })).runs[0]!
    expect(run.won_without_txn).toBe(base + 1)
    expect(Number(run.threshold_pct)).toBe(2)
    expect(await asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`select app.run_reconciliation(2)`))).toBe('42501')
    // Solo mercados completos: supervisión no ve la conciliación.
    expect((await getReconciliation(await ctxFor('fernando.ibarra'), {})).totals.length).toBe(0)
    expect(await salesCutoff(nora, 'MX')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('lo que llevo (CANAL-05) e indicadores de campo (CAMPO-05)', () => {
  it('altas, primeras ventas y activos a 30, 60 y 90 días salen de la cartera de la persona y del archivo de ventas', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await one(admin`select a.id from crm.accounts a where a.owner_id = ${marco.user.id} and a.kind = 'store' and a.archived_at is null limit 1`)
    await admin`delete from crm.merchant_metrics_daily where account_id = ${store.id}`
    await admin`insert into crm.merchant_metrics_daily (account_id, as_of, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d) values
      (${store.id}, '2026-03-02', 'MX', '2026-02-01T18:00:00Z', '2026-03-01T18:00:00Z', 12, 1000, 'MXN', 9),
      (${store.id}, '2026-04-03', 'MX', '2026-02-01T18:00:00Z', '2026-03-05T18:00:00Z', 0, 0, 'MXN', 0)`
    const feb = marketPeriods(marco, 'rango', '2026-02-01', '2026-02-28')
    const c = await getCarry(marco, feb, marco.user.id)
    expect(c.first_sales).toBeGreaterThanOrEqual(1)
    const w = Object.fromEntries(c.windows.map((x) => [x.days, x]))
    expect(w[30]!.judged).toBeGreaterThanOrEqual(1)
    expect(w[30]!.active).toBeGreaterThanOrEqual(1)
    expect(w[60]!.judged).toBeGreaterThanOrEqual(1)
    expect(w[60]!.active).toBeLessThan(w[60]!.judged + 1)
    // A 90 días todavía no hay archivo de esa fecha para esta tienda: no entra en la cuenta.
    const only = await getCarry(marco, marketPeriods(marco, 'rango', '2026-02-01', '2026-02-01'), marco.user.id)
    expect(only.windows.find((x) => x.days === 90)!.judged).toBe(0)
    expect(only.windows.find((x) => x.days === 60)!.active).toBe(0)
    for (const x of c.windows) expect(x.active).toBeLessThanOrEqual(x.judged)
  })
  it('los indicadores de campo separan visitas confirmadas por la Sales App de las registradas a mano y dejan fuera las de señal baja', async () => {
    const nora = await ctxFor('nora.salas')
    const p = marketPeriods(nora, '30d')
    const rows = await getFieldKpis(nora, p, { market: 'MX' })
    const visits = rows.reduce((n, r) => n + r.visits, 0)
    expect(visits).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.confirmed + r.manual).toBe(r.visits)
      expect(r.sales).toBeLessThanOrEqual(r.visits)
    }
    const v = await one(admin`select v.id from crm.visits v join crm.markets mk on mk.code = v.market_code where v.market_code = 'MX' and v.business_date >= (now() at time zone mk.timezone)::date - 20 limit 1`)
    await admin`update crm.visits set trust_score = 10, trust_flags = '{mock_location}' where id = ${v.id}`
    const after = await getFieldKpis(nora, p, { market: 'MX' })
    expect(after.reduce((n, r) => n + r.visits, 0)).toBe(visits - 1)
    expect(after.reduce((n, r) => n + r.low, 0)).toBe(1)
    await expect(admin`update crm.visits set trust_score = 140 where id = ${v.id}`).rejects.toBeTruthy()
    // Supervisión: solo su equipo.
    const fer = await getFieldKpis(await ctxFor('fernando.ibarra'), p, {})
    expect(fer.every((r) => r.market_code === 'MX')).toBe(true)
    expect(fer.some((r) => r.owner_name === 'Diana Cruz')).toBe(false)
  })
})

describe('pronóstico (REP-03) y uso real (GOB-03)', () => {
  it('la tasa de una etapa sale de la historia cuando hay muestra, con un rango; si no, de la etapa con margen', () => {
    const hist = stageRate({ won: 30, closed: 60, probability: 10 })
    expect(hist.historical).toBe(true)
    expect(hist.rate).toBe(0.5)
    expect(hist.low).toBeLessThan(0.5)
    expect(hist.high).toBeGreaterThan(0.5)
    const conf = stageRate({ won: 1, closed: 2, probability: 40 })
    expect(conf).toMatchObject({ historical: false, rate: 0.4 })
    expect(conf.low).toBeCloseTo(0.25)
    expect(conf.high).toBeCloseTo(0.55)
    expect(stageRate({ won: 0, closed: 0, probability: 5 }).low).toBe(0)
  })
  it('el pronóstico cuenta los negocios abiertos de cada etapa dentro del alcance de quien mira', async () => {
    const nora = await ctxFor('nora.salas')
    const rows = await getForecast(nora, {})
    const open = (await one(admin`select count(*)::int as n from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.markets mk on mk.code = d.market_code where d.status = 'open' and p.is_active and mk.status = 'live'`)).n
    expect(rows.reduce((n, r) => n + r.open, 0)).toBe(open)
    for (const r of rows) expect(r.won).toBeLessThanOrEqual(r.closed)
    expect(await reportHeadline(nora, 'pronostico', {})).toMatch(/Se esperan \d+ negocios ganados \(entre \d+ y \d+\)/)
  })
  it('adopción mide uso real por persona con tendencia semanal; supervisión solo ve a su equipo', async () => {
    const nora = await ctxFor('nora.salas')
    const all = await getUsage(nora, {})
    expect(all.rows.length).toBeGreaterThan(0)
    for (const r of all.rows) {
      expect(r.weeks.length).toBe(USAGE_WEEKS)
      expect(r.step_ok).toBeLessThanOrEqual(r.open_deals)
      expect(r.leads_on_time).toBeLessThanOrEqual(r.leads_judged)
      expect(Object.keys(r)).not.toContain('logins')
    }
    const fer = await getUsage(await ctxFor('fernando.ibarra'), {})
    const names = fer.rows.map((r) => r.full_name)
    expect(names).toContain('Marco Peña')
    expect(names).not.toContain('Diana Cruz')
    expect(names).not.toContain('Sam Ortiz')
    // Una actividad registrada hoy sube la última semana de la persona.
    const marco = await ctxFor('marco.pena')
    const before = all.rows.find((r) => r.user_id === marco.user.id)!.weeks[USAGE_WEEKS - 1]!
    const store = await one(admin`select id from crm.accounts where owner_id = ${marco.user.id} and market_code = 'MX' and archived_at is null limit 1`)
    await admin`insert into crm.activities (market_code, account_id, kind, subject, owner_id, created_by, source) values ('MX', ${store.id}, 'note', 'Nota de prueba de uso', ${marco.user.id}, ${marco.user.id}, 'user')`
    expect((await getUsage(nora, {})).rows.find((r) => r.user_id === marco.user.id)!.weeks[USAGE_WEEKS - 1]).toBe(before + 1)
    // La señal de equipo: quien supervisa abrió su tablero esta semana.
    await admin`insert into crm.usage_events (user_id, event) values (${(await ctxFor('fernando.ibarra')).user.id}, 'view.supervisor')`
    const views = (await getUsage(nora, {})).views
    expect(views.find((v) => v.views > 0)).toBeDefined()
  })
})

describe('reportes guardados y programados (E8.F4)', () => {
  it('un reporte guardado es privado; compartido lo ve su mercado y no otro; quien vende no comparte', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const marco = await ctxFor('marco.pena')
    const sam = await ctxFor('sam.ortiz')
    const priv = await saveReport(fer, { report: 'etapas', name: 'Mis etapas', params: { mercado: 'MX', sql: 'drop table' }, shared: false, schedule: '' })
    expect((await listSavedReports(marco)).some((r) => r.id === priv)).toBe(false)
    const shared = await saveReport(fer, { report: 'leads', name: 'Leads del equipo', params: { periodo: 'mes', mercado: 'MX' }, shared: true, schedule: '' })
    expect((await listSavedReports(marco)).some((r) => r.id === shared)).toBe(true)
    expect((await listSavedReports(sam)).some((r) => r.id === shared)).toBe(false)
    // Solo viajan los parámetros de la lista blanca.
    expect((await one(admin`select params from crm.saved_reports where id = ${priv}`)).params).toEqual({ mercado: 'MX' })
    await expect(saveReport(marco, { report: 'leads', name: 'Compartido', params: {}, shared: true, schedule: '' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveReport(marco, { report: 'finanzas', name: 'Finanzas', params: {}, shared: false, schedule: '' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveReport(marco, { report: 'leads', name: ' ', params: {}, shared: false, schedule: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(deleteReport(marco, shared)).rejects.toMatchObject({ code: 'not_found' })
    await deleteReport(fer, priv)
    expect((await admin`select 1 from crm.saved_reports where id = ${priv}`).length).toBe(0)
  })
  it('un reporte programado llega a su dueño dentro de CONTIGO con el alcance del dueño; el correo queda en cola con el canal apagado', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await saveReport(marco, { report: 'etapas', name: 'Mis negocios por etapa', params: {}, shared: false, schedule: 'daily' })
    const out = await withSystem((tx) => deliverScheduled(tx))
    expect(out.done).toBeGreaterThanOrEqual(1)
    const mine = await listDeliveries(marco)
    expect(mine.length).toBe(1)
    const open = (await one(admin`select count(*)::int as n from crm.deals where owner_id = ${marco.user.id} and status = 'open'`)).n
    expect(mine[0]!.body).toContain(`${open} negocios abiertos`)
    expect(mine[0]!.href).toBe('/reportes/etapas')
    expect((await listDeliveries(await ctxFor('lucia.vega'))).length).toBe(0)
    const mail = await admin`select status from crm.report_outbox where channel = 'email' and ref like ${'report:' + id + ':%'}`
    expect(mail.length).toBe(1)
    expect(mail[0]!.status).toBe('channel_off')
    // No se repite antes de tiempo.
    expect((await withSystem((tx) => deliverScheduled(tx))).done).toBe(0)
    await scheduleReport(marco, id, '')
    expect((await one(admin`select schedule from crm.saved_reports where id = ${id}`)).schedule).toBeNull()
    // Nadie más que el sistema escribe una entrega.
    expect(await asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`insert into crm.report_deliveries (saved_report_id, user_id, title, body, href) values (${id}, ${marco.user.id}, 'x', 'y', '/reportes')`))).toBe('42501')
  })
  it('las tres tareas están en el registro único de tareas programadas', () => {
    const keys = JOBS.map((j) => j.key)
    for (const k of ['reportes.snapshot', 'reportes.reconcile', 'reportes.scheduled']) expect(keys).toContain(k)
    for (const j of JOBS.filter((x) => x.key.startsWith('reportes.'))) expect(j.description.es && j.description.en && j.everyMinutes > 0).toBeTruthy()
  })
})

describe('exportación gobernada de los reportes nuevos', () => {
  it('supervisión exporta lo de su equipo y queda el evento; ventas no exporta; Finanzas no es de supervisión', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const out = await exportReport(fer, 'etapas', year(fer), {})
    expect(out.csv.split('\r\n')[0]).toContain('Etapa')
    expect(out.rows).toBeGreaterThan(0)
    const ev = await one(admin`select actor_id, after from crm.audit_events where action = 'report.exported' order by at desc, id desc limit 1`)
    expect(ev.actor_id).toBe(fer.user.id)
    expect(ev.after).toMatchObject({ report: 'etapas', rows: out.rows })
    await expect(exportReport(await ctxFor('marco.pena'), 'etapas', year(fer), {})).rejects.toMatchObject({ code: 'forbidden' })
    await expect(exportReport(fer, 'finanzas', year(fer), {})).rejects.toMatchObject({ code: 'forbidden' })
    await expect(exportReport(fer, 'etapas', year(fer), { market: 'US' })).rejects.toMatchObject({ code: 'forbidden' })
    const nora = await ctxFor('nora.salas')
    for (const key of REPORTS.filter((r) => r.exportable).map((r) => r.key)) {
      const file = await exportReport(nora, key, year(nora), {})
      expect(file.csv.charCodeAt(0), key).toBe(0xfeff)
      expect(file.csv, key).not.toMatch(/\+\d{10,}|@contigo\.test/)
    }
  })
})

describe('vistas guardadas como colas (UX-03)', () => {
  it('cualquier persona guarda su filtro como vista, la fija y la borra; solo viajan los filtros de la lista blanca', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await saveView(marco, { object: 'account', name: 'Mis tiendas en riesgo', filters: { owner: 'me', lifecycle: 'at_risk', orden: 'x; drop', nada: '1' }, shared: false, pin: true })
    expect((await one(admin`select filters from crm.saved_views where id = ${id}`)).filters).toEqual({ owner: 'me', lifecycle: 'at_risk' })
    const queues = await pinnedQueues(marco)
    expect(queues.length).toBe(1)
    expect(queues[0]!.count).toBe((await listAccounts(marco, { owner: 'me', lifecycle: 'at_risk' })).total)
    expect(viewHref(queues[0]!)).toContain('/comercios?')
    expect(viewHref(queues[0]!)).toContain(`cola=${id}`)
    // Privada: nadie más la ve.
    expect((await listViews(await ctxFor('lucia.vega'), 'account')).some((v) => v.id === id)).toBe(false)
    await expect(saveView(marco, { object: 'account', name: 'mis tiendas en riesgo', filters: {}, shared: false, pin: false })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveView(marco, { object: 'account', name: 'Compartida', filters: {}, shared: true, pin: false })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveView(marco, { object: 'tabla', name: 'Otra', filters: {}, shared: false, pin: false })).rejects.toMatchObject({ code: 'invalid' })
    await pinView(marco, id, false)
    expect((await pinnedQueues(marco)).length).toBe(0)
    await expect(deleteView(await ctxFor('lucia.vega'), id)).rejects.toMatchObject({ code: 'not_found' })
    await deleteView(marco, id)
    expect((await admin`select 1 from crm.saved_views where id = ${id}`).length).toBe(0)
  })
  it('supervisión comparte una vista con su equipo: su equipo la ve y la fija, el otro equipo no; quien lidera sí', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const id = await saveView(fer, { object: 'lead', name: 'Leads sin tocar del equipo', filters: { status: 'overdue' }, shared: true, pin: false })
    expect((await one(admin`select team_id from crm.saved_views where id = ${id}`)).team_id).not.toBeNull()
    const marco = await ctxFor('marco.pena')
    expect((await listViews(marco, 'lead')).some((v) => v.id === id)).toBe(true)
    expect((await listViews(await ctxFor('diana.cruz'), 'lead')).some((v) => v.id === id)).toBe(false)
    expect((await listViews(await ctxFor('sam.ortiz'), 'lead')).some((v) => v.id === id)).toBe(false)
    expect((await listViews(await ctxFor('ana.robles'), 'lead')).some((v) => v.id === id)).toBe(true)
    await pinView(marco, id, true)
    const q = (await pinnedQueues(marco)).find((x) => x.id === id)!
    expect(q.count).not.toBeNull()
    // Quien no es dueño no la borra ni la cambia, aunque la vea.
    await expect(deleteView(marco, id)).rejects.toMatchObject({ code: 'not_found' })
    expect(await asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`update crm.saved_views set name = 'Otra' where id = ${id}`))).toBe('0 rows')
    expect(await asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`insert into crm.saved_view_pins (user_id, view_id) values (${fer.user.id}, ${id})`))).toBe('42501')
  })
  it('las vistas de fábrica reconstruyen los filtros de Pipedrive que tienen campo en CONTIGO, para Comercios, Leads, Negocios y Actividades', async () => {
    const sam = await ctxFor('sam.ortiz')
    const byObject = async (o: 'account' | 'lead' | 'deal' | 'activity') => (await listViews(sam, o)).map((v) => v.name)
    expect(await byObject('deal')).toEqual(expect.arrayContaining(['Negocios sin persona asignada', 'Negocios abiertos sin próximo paso']))
    expect(await byObject('account')).toContain('Organizaciones de US')
    expect(await byObject('lead')).toContain('Leads sin persona asignada')
    expect(await byObject('activity')).toContain('Tareas del equipo')
    const deal = (await listViews(sam, 'deal')).find((v) => v.name === 'Negocios sin persona asignada')!
    expect(viewHref(deal)).toMatch(/^\/pipelines\/[0-9a-f-]{36}\?owner=none&vista=lista&cola=/)
    for (const o of Object.keys(VIEW_FILTERS)) expect(VIEW_FILTERS[o as 'account'].length).toBeGreaterThan(0)
    expect(wideScope(sam)).toEqual({ full: [], team: ['US'] })
  })
})
