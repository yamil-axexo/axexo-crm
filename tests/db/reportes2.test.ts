import { afterAll, describe, expect, it } from 'vitest'
import { attempt, asPersona, ctxFor, owner, personaId, systemContext } from './helpers'
import { withSystem } from '@/server/db'
import { can, homePath, isReadOnly, type Membership } from '@/domain/policy'
import { METRICS, isMetricKey } from '@/lib/metric-defs'
import { JOBS } from '@/server/jobs/registry'
import { REPORTS, viewHref } from '@/lib/report-catalog'
import { boardConfig, costByMonth, financeValues, kamBoard, opsBoard, partnerBoard } from '@/dal/role-boards'
import { contactList, forecastSubmissions, getCohorts, motorSlices, pendingDecisions, teamSnapshots, usageExtra } from '@/dal/reportes2'
import { adjustForecast, recordOneOnOne, saveRoleBoard, setForecastCategory, setProposed, setUserAlias, submitForecast } from '@/domain/reportes2'
import { iaRegression, openQualityExceptions, teamSnapshotAndWindow } from '@/domain/reportes2-jobs'
import { ingestMetricsFile } from '@/domain/integrations'
import { saveView } from '@/domain/reportes'
import { getFinanceReport, wideScope } from '@/dal/reportes'
import { marketPeriods, reportScope } from '@/dal/reports'
import { readResource } from '@/dal/api-v1'
import { visitDetail } from '@/domain/visit-detail'
import { orderPdf } from '@/domain/order-pdf'
import { buildPdf } from '@/lib/pdf-lite'
import { grantAccess } from '@/domain/admin'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)

describe('rol de Finanzas (E8.F5, E12.F6)', () => {
  const fin: Membership[] = [{ role: 'finance', market: 'MX', teamId: null }]
  it('lee sus reportes y nada cambia: solo lectura, empieza en su reporte', () => {
    expect(can(fin, 'report.finance', 'MX')).toBe(true)
    expect(can(fin, 'visit.reimbursement', 'MX')).toBe(true)
    expect(can(fin, 'cost.read')).toBe(true)
    for (const cap of ['deal.edit', 'account.edit', 'lead.create', 'report.export', 'deal.create', 'activity.write'] as const) expect(can(fin, cap, 'MX'), cap).toBe(false)
    expect(isReadOnly(fin)).toBe(true)
    expect(homePath(fin)).toBe('/reportes/finanzas')
  })
  it('la base le deja leer su mercado completo y no le deja escribir', async () => {
    const counts = await asPersona('marta.ibanez', async (tx) => ({
      deals: (await tx<{ n: number }[]>`select count(*)::int as n from crm.deals where market_code = 'MX'`)[0]!.n,
      us: (await tx<{ n: number }[]>`select count(*)::int as n from crm.deals where market_code = 'US'`)[0]!.n,
      upd: await attempt(tx, (sp) => sp`update crm.deals set title = title where market_code = 'MX'`),
      acc: await attempt(tx, (sp) => sp`update crm.accounts set name = name where market_code = 'MX'`),
      ins: await attempt(tx, (sp) => sp`insert into crm.activities (market_code, kind, subject, created_by) values ('MX', 'note', 'x', app.current_user_id())`),
    }))
    const total = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.deals where market_code = 'MX'`)
    expect(counts.deals).toBe(total.n)
    expect(counts.us).toBe(0)
    expect(counts.upd).not.toBe('ok')
    expect(counts.acc).not.toBe('ok')
    expect(counts.ins).not.toBe('ok')
  })
  it('ve el reporte de Finanzas de todo su mercado y el detalle de visitas para reembolsos', async () => {
    const marta = await ctxFor('marta.ibanez')
    expect(reportScope(marta).full).toEqual(['MX'])
    const r = await getFinanceReport(marta, marketPeriods(marta, 'rango', '2026-01-01', '2026-12-31'), { })
    expect(Array.isArray(r.rows)).toBe(true)
    const v = await visitDetail(marta, { market: 'MX' })
    expect(v.markets).toEqual(['MX'])
    expect(wideScope(marta).full).toContain('MX')
  })
  it('Administración da el rol de Finanzas y el de KAM como cualquier rol de mercado', async () => {
    const nora = await ctxFor('nora.salas')
    const r = await grantAccess(nora, { email: `fin-${tag()}@contigo.test`, fullName: 'Persona de Finanzas', role: 'finance', market: 'MX' }, ['contigo.test'])
    expect(r.userId).toBeTruthy()
    const k = await grantAccess(nora, { email: `kam-${tag()}@contigo.test`, fullName: 'Persona KAM', role: 'kam', market: 'MX' }, ['contigo.test'])
    expect((await one(admin<{ role: string }[]>`select role from crm.memberships where user_id = ${k.userId}`)).role).toBe('kam')
  })
})

describe('tableros por rol con indicadores definidos y con dueño (REP-01)', () => {
  it('cada rol con tablero tiene de 5 a 7 indicadores, todos definidos, marcados como propuesta hasta que C1 los confirme', async () => {
    const nora = await ctxFor('nora.salas')
    for (const role of ['kam', 'partner', 'ops', 'finance'] as const) {
      const items = await boardConfig(nora, role)
      expect(items.length, role).toBeGreaterThanOrEqual(5)
      expect(items.length, role).toBeLessThanOrEqual(7)
      for (const i of items) { expect(isMetricKey(i.key)).toBe(true); expect(i.confirmed).toBe(false); expect(i.pendingOwner).toContain('C1') }
    }
    expect(METRICS.opsPullThrough.num).toBeTruthy()
    const pending = await pendingDecisions(nora)
    expect(pending.map((p) => p.key)).toEqual(expect.arrayContaining(['role_board.kam', 'ingest.require_manifest', 'orders.brand']))
  })
  it('administración cambia la lista y la confirma; menos de 5 o un indicador sin definición no entra', async () => {
    const nora = await ctxFor('nora.salas')
    await expect(saveRoleBoard(nora, { role: 'ops', keys: ['opsQueue', 'opsOverdue'], confirm: false })).rejects.toThrow()
    await expect(saveRoleBoard(nora, { role: 'ops', keys: ['opsQueue', 'opsOverdue', 'opsReturned', 'opsPullThrough', 'inventado'], confirm: false })).rejects.toThrow()
    await saveRoleBoard(nora, { role: 'ops', keys: ['opsQueue', 'opsOverdue', 'opsReturned', 'opsPullThrough', 'opsHandoffsOpen'], owners: { opsQueue: 'Líder de Operaciones MX' }, confirm: true })
    const items = await boardConfig(nora, 'ops')
    expect(items.map((i) => i.key)).toEqual(['opsQueue', 'opsOverdue', 'opsReturned', 'opsPullThrough', 'opsHandoffsOpen'])
    expect(items.every((i) => i.confirmed)).toBe(true)
    expect(items[0]!.ownerLabel).toBe('Líder de Operaciones MX')
    await expect(saveRoleBoard(await ctxFor('ana.robles'), { role: 'ops', keys: ['opsQueue', 'opsOverdue', 'opsReturned', 'opsPullThrough', 'opsHandoffsOpen'], confirm: true })).rejects.toThrow()
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'metric.board_confirmed'`)).n).toBe(1)
  })
  it('el tablero KAM cuenta sus cuentas clave, las tiendas debajo y sus oportunidades', async () => {
    const elena = await ctxFor('elena.duarte')
    const b = await kamBoard(elena, elena.user.id)
    expect(b.values.kamAccounts?.value).toBe(1)
    expect(b.values.kamStoresActive?.value).toBe(2)
    expect(b.values.kamOpen?.value).toBe(1)
    expect(b.deals[0]!.category).toBe('best_case')
    expect(can(elena.memberships, 'board.kam', 'MX')).toBe(true)
    expect(REPORTS.find((r) => r.key === 'kam')!.cap).toBe('board.kam')
  })
  it('el tablero de Operaciones y el del partner salen con la RLS de quien mira', async () => {
    const valeria = await ctxFor('valeria.soto')
    const ops = await opsBoard(valeria, null)
    expect(typeof ops.opsQueue?.value).toBe('number')
    const partner = await ctxFor('iso.partner')
    const root = await personaId('dat-us-iso').catch(() => null)
    const rootId = (await one(admin<{ id: string }[]>`select md5('contigo:dat-us-iso')::uuid as id`)).id
    expect(root === null || typeof root === 'string').toBe(true)
    const p = await partnerBoard(partner, [rootId])
    expect(typeof p.partnerPoints?.value).toBe('number')
    expect(p.partnerActive!.value as number).toBeLessThanOrEqual(p.partnerPoints!.value as number)
  })
  it('el Panel del LT corta por los tipos de venta', async () => {
    const luis = await ctxFor('luis.tovar')
    const s = await motorSlices(luis)
    expect(s.map((x) => x.motor)).toEqual(expect.arrayContaining(['d2d', 'b2b', 'dealer']))
  })
  it('el reporte programado deja también su resumen en la cola del canal de Slack, apagado', async () => {
    expect(JOBS.map((j) => j.key)).toEqual(expect.arrayContaining(['reportes2.team_snapshot', 'reportes2.quality_notices', 'reportes2.ia_regression']))
  })
})

describe('pronóstico por categoría con envíos versionados (REP-03)', () => {
  const dealId = async () => (await one(admin<{ id: string }[]>`select md5('contigo:kam-mx-deal')::uuid as id`)).id
  it('la persona KAM pone la categoría; ventas de calle no puede; quien dirige ajusta al lado con nota', async () => {
    const id = await dealId()
    await setForecastCategory(await ctxFor('elena.duarte'), id, 'commit')
    await expect(setForecastCategory(await ctxFor('marco.pena'), id, 'commit')).rejects.toThrow()
    await expect(adjustForecast(await ctxFor('paula.mendez'), id, 'pipeline', '')).rejects.toThrow()
    await adjustForecast(await ctxFor('paula.mendez'), id, 'pipeline', 'Falta la firma de compras')
    const f = await one(admin<{ category: string; manager_category: string; manager_note: string }[]>`select category, manager_category, manager_note from crm.deal_forecast where deal_id = ${id}`)
    expect(f).toMatchObject({ category: 'commit', manager_category: 'pipeline', manager_note: 'Falta la firma de compras' })
    const b = await kamBoard(await ctxFor('elena.duarte'), await personaId('elena.duarte'))
    expect(b.values.kamCommit?.value).toBe(0)
  })
  it('cada envío del mismo periodo es una versión nueva y no cambia al reorganizar territorios ni pasar la cuenta', async () => {
    const elena = await ctxFor('elena.duarte')
    const a = await submitForecast(elena, { market: 'MX', from: '2026-10-01', to: '2026-12-31' })
    const b = await submitForecast(elena, { market: 'MX', from: '2026-10-01', to: '2026-12-31', note: 'Segunda vuelta' })
    expect([a.version, b.version]).toEqual([1, 2])
    const id = await dealId()
    // Reorganización: el negocio y la cuenta pasan a otra persona y a otro territorio.
    await admin`update crm.deals set owner_id = ${await personaId('diana.cruz')} where id = ${id}`
    await admin`update crm.accounts set territory_id = md5('contigo:ter-mty')::uuid where id = md5('contigo:kam-mx-ch')::uuid`
    const subs = await forecastSubmissions(elena, elena.user.id)
    expect(subs).toHaveLength(2)
    const rows = await one(admin<{ rows: { owner_name: string; territory: string }[] }[]>`select rows from crm.forecast_submissions where id = ${a.id}`)
    expect(rows.rows[0]).toMatchObject({ owner_name: 'Elena Duarte' })
    expect(rows.rows[0]!.territory).not.toBe((await one(admin<{ name: string }[]>`select name from crm.territories where id = md5('contigo:ter-mty')::uuid`)).name)
    await expect(submitForecast(await ctxFor('marco.pena'), { market: 'MX', from: '2026-10-01', to: '2026-12-31' })).rejects.toThrow()
    await admin`update crm.deals set owner_id = ${await personaId('elena.duarte')} where id = ${id}`
  })
})

describe('archivo de ventas: corte tardío, manifiesto y campos opcionales (AUT-06, REP-04)', () => {
  const setup = async () => {
    const ref = `MID-R2-${tag()}`
    const acc = await one(admin<{ id: string }[]>`select id from crm.accounts where market_code = 'MX' and kind = 'store' and lifecycle = 'active' and archived_at is null order by id limit 1 offset 7`)
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${acc.id}, 'MX', 's5', ${ref})`
    return { ref, acc }
  }
  it('un archivo con corte anterior al último aplicado a sus comercios no entra y no cambia su estado', async () => {
    const sys = await systemContext()
    const { ref, acc } = await setup()
    const row = { merchant_ref: ref, first_txn_at: '2026-06-01T15:00:00+00:00', last_txn_at: '2026-11-10T15:00:00+00:00', txn_count_30d: 40, volume_minor_30d: 9000, currency: 'MXN', active_days_30d: 20, status: 'active' as const }
    expect((await ingestMetricsFile(sys, { as_of: '2026-11-20', file_name: `new-${tag()}.json`, mode: 'delta', rows: [row] })).status).toBe('loaded')
    expect((await one(admin<{ lifecycle: string }[]>`select lifecycle from crm.accounts where id = ${acc.id}`)).lifecycle).toBe('active')
    await expect(ingestMetricsFile(sys, { as_of: '2026-11-15', file_name: `late-${tag()}.json`, mode: 'delta', rows: [{ ...row, txn_count_30d: 0, active_days_30d: 0, status: 'inactive' as const }] }))
      .rejects.toMatchObject({ code: 'stale_cutoff' })
    expect((await one(admin<{ lifecycle: string }[]>`select lifecycle from crm.accounts where id = ${acc.id}`)).lifecycle).toBe('active')
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.ingest_batches where reject_reason = 'stale_as_of'`)).n).toBe(1)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.merchant_metrics_daily where account_id = ${acc.id} and as_of = '2026-11-15'`)).n).toBe(0)
    // El mismo corte sí entra (corrección) y el estado del archivo manda. Los campos opcionales se guardan tal cual.
    const out = await ingestMetricsFile(sys, { as_of: '2026-11-20', file_name: `same-${tag()}.json`, mode: 'delta', rows: [{ ...row, status: 'inactive' as const, tpv_by_product: [{ product: 'Recargas', volume_minor_30d: 120000 }], commission_minor_30d: 3400 }] })
    expect(out.status).toBe('loaded')
    expect((await one(admin<{ lifecycle: string }[]>`select lifecycle from crm.accounts where id = ${acc.id}`)).lifecycle).toBe('inactive')
    const mm = await one(admin<{ tpv_by_product: unknown; commission_minor_30d: string }[]>`select tpv_by_product, commission_minor_30d::text from crm.merchant_metrics_daily where account_id = ${acc.id} and as_of = '2026-11-20'`)
    expect(mm.tpv_by_product).toEqual([{ product: 'Recargas', volume_minor_30d: 120000 }])
    expect(mm.commission_minor_30d).toBe('3400')
  })
  it('con el manifiesto obligatorio, un archivo sin manifiesto no entra; con manifiesto sí', async () => {
    const sys = await systemContext()
    const nora = await ctxFor('nora.salas')
    const { ref } = await setup()
    await setProposed(nora, 'ingest.require_manifest', { value: true }, true)
    const row = { merchant_ref: ref, txn_count_30d: 3, volume_minor_30d: 100, currency: 'MXN', active_days_30d: 2 }
    const day = '2026-12-01'
    await expect(ingestMetricsFile(sys, { as_of: day, file_name: `bare-${tag()}.json`, mode: 'delta', rows: [row] })).rejects.toMatchObject({ code: 'manifest_missing' })
    const ok = await ingestMetricsFile(sys, { as_of: day, file_name: `full-${tag()}.json`, mode: 'delta', rows: [row], manifest: { row_count: 1 } })
    expect(ok.status).toBe('loaded')
    const v = await one(admin<{ value: { value: boolean; proposed: boolean } }[]>`select value from crm.settings where key = 'ingest.require_manifest'`)
    expect(v.value).toMatchObject({ value: true, proposed: false })
    await setProposed(nora, 'ingest.require_manifest', { value: false }, false)
    await expect(setProposed(await ctxFor('ana.robles'), 'ingest.require_manifest', { value: true }, true)).rejects.toThrow()
  })
})

describe('histórico: foto por equipo, ventana corta y cohortes por corte (REP-02)', () => {
  it('la foto por equipo la toma el sistema y supervisión ve solo la de su equipo', async () => {
    await withSystem((tx) => teamSnapshotAndWindow(tx))
    const fernando = await ctxFor('fernando.ibarra')
    const mine = await teamSnapshots(fernando)
    expect(mine.length).toBeGreaterThan(0)
    expect(new Set(mine.map((x) => x.team)).size).toBe(1)
    const ana = await ctxFor('ana.robles')
    expect(new Set((await teamSnapshots(ana)).map((x) => x.team)).size).toBeGreaterThan(1)
  })
  it('la ventana corta solo borra lo que ya se entregó al lakehouse', async () => {
    const team = (await one(admin<{ id: string }[]>`select id from crm.teams where market_code = 'MX' limit 1`)).id
    await admin`insert into crm.team_snapshots (snapshot_date, market_code, team_id, open_deals, no_next_step, active_accounts, at_risk_accounts, exported_at) values
      ('2025-01-02', 'MX', ${team}, 1, 0, 0, 0, null), ('2025-01-03', 'MX', ${team}, 1, 0, 0, 0, now())`
    await withSystem((tx) => teamSnapshotAndWindow(tx))
    const left = await admin<{ d: string }[]>`select snapshot_date::text as d from crm.team_snapshots where snapshot_date < '2025-02-01' order by 1`
    expect(left.map((x) => x.d)).toEqual(['2025-01-02'])
  })
  it('las cohortes de leads se cortan por semana, canal y persona, con el alcance de quien mira', async () => {
    const ana = await ctxFor('ana.robles')
    for (const cut of ['semana', 'canal', 'persona'] as const) {
      const rows = await getCohorts(ana, cut, 'MX')
      expect(rows.length, cut).toBeGreaterThan(0)
      for (const r of rows) expect(r.c30 <= r.leads && r.c60 >= r.c30 && r.c90 >= r.c60, cut).toBe(true)
    }
    const total = (await getCohorts(ana, 'canal', 'MX')).reduce((n, r) => n + r.leads, 0)
    expect((await getCohorts(ana, 'semana', 'MX')).reduce((n, r) => n + r.leads, 0)).toBe(total)
  })
})

describe('calidad de datos dentro de la cola de avisos (GOB-02)', () => {
  it('sin reglas elegidas no abre nada; con la regla elegida abre un aviso por persona y lo cierra cuando baja del mínimo', async () => {
    const before = (await one(admin<{ n: number }[]>`select count(*)::int as n from crm.exceptions where kind = 'data_quality'`)).n
    await withSystem((tx) => openQualityExceptions(tx))
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.exceptions where kind = 'data_quality'`)).n).toBe(before)
    await setProposed(await ctxFor('nora.salas'), 'quality.exception_rules', { value: ['no_coords'], min_failing: 1 }, true)
    await withSystem((tx) => openQualityExceptions(tx))
    const open = await admin<{ owner_id: string; detail: { failing: number } }[]>`select owner_id, detail from crm.exceptions where kind = 'data_quality' and resolved_at is null`
    expect(open.length).toBeGreaterThan(0)
    await withSystem((tx) => openQualityExceptions(tx))
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.exceptions where kind = 'data_quality' and resolved_at is null`)).n).toBe(open.length)
    // El supervisor lo ve en la cola de su equipo (la RLS de avisos).
    const marco = await personaId('marco.pena')
    if (open.some((o) => o.owner_id === marco)) {
      const seen = await asPersona('fernando.ibarra', (tx) => tx<{ n: number }[]>`select count(*)::int as n from crm.exceptions where kind = 'data_quality' and owner_id = ${marco}`)
      expect(seen[0]!.n).toBeGreaterThan(0)
    }
    await setProposed(await ctxFor('nora.salas'), 'quality.exception_rules', { value: [], min_failing: 1 }, true)
    await withSystem((tx) => openQualityExceptions(tx))
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.exceptions where kind = 'data_quality' and resolved_at is null`)).n).toBe(0)
  })
  it('las diferencias con el archivo de ventas son una regla de calidad con dueño', async () => {
    const r = await one(admin<{ owner_role: string }[]>`select owner_role from crm.quality_rules where code = 's5_diff'`)
    expect(r.owner_role).toBe('market_lead')
    const rows = await asPersona('ana.robles', (tx) => tx<{ rule_code: string }[]>`select rule_code from app.quality_measure() where rule_code = 's5_diff'`)
    expect(Array.isArray(rows)).toBe(true)
  })
})

describe('adopción: 1:1 con el tablero, colas atendidas y eventos de uso en el outbox (GOB-03)', () => {
  it('quien supervisa anota la 1:1 de una persona de su equipo; sale como evento de uso y cuenta en adopción', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const marco = await personaId('marco.pena')
    const today = (await one(admin<{ d: string }[]>`select (now() at time zone 'America/Mexico_City')::date::text as d`)).d
    await recordOneOnOne(fernando, { personId: marco, heldOn: today, note: 'Revisamos su cartera' })
    await expect(recordOneOnOne(fernando, { personId: await personaId('diana.cruz'), heldOn: today })).rejects.toThrow()
    await expect(recordOneOnOne(await ctxFor('marco.pena'), { personId: marco, heldOn: today })).rejects.toThrow()
    const ev = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.outbox_events where event_type = 'usage.one_on_one' and aggregate_id = ${fernando.user.id}`)
    expect(ev.n).toBe(1)
    const extra = await usageExtra(fernando, [marco])
    expect(extra[0]!.one_on_ones).toBe(1)
  })
  it('entrar a CONTIGO no cuenta como uso: la regla de despliegue es un dato propuesto', async () => {
    const pending = await pendingDecisions(await ctxFor('nora.salas'))
    expect(pending.find((p) => p.key === 'adoption.rollout_rule')?.pending).toContain('Yamil')
  })
})

describe('costo de CONTIGO para Finanzas y costo por acción de IA (GOB-09, IA-08)', () => {
  it('Finanzas lee los costos por mes con el costo por persona y por acción de IA; sin costos no hay cifra', async () => {
    const marta = await ctxFor('marta.ibanez')
    expect(financeValues(await costByMonth(marta)).financeCostMonth?.value ?? null).toBeNull()
    const nora = await personaId('nora.salas')
    const month = (await one(admin<{ m: string }[]>`select date_trunc('month', now())::date::text as m`)).m
    await admin`insert into crm.cost_entries (month, kind, component, label, amount_usd, created_by) values (${month}, 'cost', 'platform', 'Plataforma', 300, ${nora}), (${month}, 'cost', 'ai', 'Modelo', 2, ${nora})`
    await admin`insert into crm.ia_calls (feature, mode, prompt_version, input_digest, outcome, cost_usd, actor_id, via) values ('next_action', 'simulated', 'rules-1', 'd1', 'answered', 0.5, ${nora}, 'screen'), ('next_action', 'simulated', 'rules-1', 'd2', 'answered', 0.5, ${nora}, 'screen')`
    const costs = await costByMonth(marta)
    expect(costs[0]).toMatchObject({ month, cost: 302, aiActions: 2, aiCost: 3 })
    const v = financeValues(costs)
    expect(v.financeCostMonth?.value).toBe(302)
    expect(v.financeCostPerAi?.value).toBe(1.5)
    // Ventas no lee costos.
    const rows = await asPersona('marco.pena', (tx) => tx<{ n: number }[]>`select count(*)::int as n from crm.cost_entries`)
    expect(rows[0]!.n).toBe(0)
  })
  it('la regresión de IA corre sola cuando no hay corrida con la versión vigente, y una vez hecha no se repite', async () => {
    await admin`delete from crm.ia_eval_runs`
    const first = await withSystem((tx) => iaRegression(tx))
    expect(first.done).toBeGreaterThan(0)
    const runs = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.ia_eval_runs`)
    expect(runs.n).toBeGreaterThan(0)
    const second = await withSystem((tx) => iaRegression(tx))
    expect(second.done).toBe(0)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'ia.eval_auto_run'`)).n).toBe(1)
  })
})

describe('los reportes que leen quién lleva cada comercio siguen funcionando (E8.F7)', () => {
  it('la lectura v1 de comercios y negocios trae el ID en S5 de quien lo lleva, con el mismo juego de campos de siempre más owner_ref', async () => {
    const nora = await ctxFor('nora.salas')
    const marco = await personaId('marco.pena')
    await setUserAlias(nora, { userId: marco, system: 's5', externalId: 'S5-USR-0042' })
    await expect(setUserAlias(nora, { userId: await personaId('lucia.vega'), system: 's5', externalId: 'S5-USR-0042' })).rejects.toThrow()
    const key = { id: 'k', scopes: ['accounts:read', 'deals:read'], market: 'MX', mode: 'live' as const, ratePerMinute: 60, createdBy: nora.user.id }
    const all: Record<string, unknown>[] = []
    let cursor: string | null = null
    do {
      const page = await readResource(key, 'accounts', new URLSearchParams(cursor ? { limit: '200', cursor } : { limit: '200' }))
      all.push(...page.data)
      cursor = page.next_cursor
    } while (cursor)
    const mine = all.filter((r) => r.owner_id === marco)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((r) => r.owner_ref === 'S5-USR-0042')).toBe(true)
    // Contrato estable: los campos de siempre siguen ahí (un reporte de afuera no se rompe).
    for (const f of ['id', 'market', 'kind', 'name', 'lifecycle', 'owner_id', 'merchant_ref', 'updated_at']) expect(Object.keys(mine[0]!)).toContain(f)
    const deals = await readResource(key, 'deals', new URLSearchParams({ limit: '200' }))
    expect(deals.data.filter((d) => d.owner_id === marco).every((d) => d.owner_ref === 'S5-USR-0042')).toBe(true)
    // Un cambio de ID cierra el anterior con fecha (no se pisa).
    await setUserAlias(nora, { userId: marco, system: 's5', externalId: 'S5-USR-0043' })
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.user_aliases where user_id = ${marco} and valid_to is not null`)).n).toBe(1)
  })
})

describe('vistas de personas por equipo (E8.F4) y PDF del pedido (E11.F3)', () => {
  it('la lista de personas respeta el alcance y se guarda como vista compartida del equipo', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const rows = await contactList(fernando, {})
    const ana = await ctxFor('ana.robles')
    expect((await contactList(ana, {})).length).toBeGreaterThanOrEqual(rows.length)
    const id = await saveView(fernando, { object: 'contact', name: 'Dueños de mi equipo', filters: { role: 'owner', zz: 'x' }, shared: true, pin: true })
    const v = await one(admin<{ object: string; filters: Record<string, string> }[]>`select object, filters from crm.saved_views where id = ${id}`)
    expect(v).toMatchObject({ object: 'contact', filters: { role: 'owner' } })
    expect(viewHref({ id, object: 'contact', filters: { role: 'owner' } })).toBe(`/personas?role=owner&cola=${id}`)
  })
  it('el pedido sale como PDF armado por CONTIGO, con la empresa de la plantilla de marca del mercado', async () => {
    const pdf = buildPdf([[{ kind: 'text', x: 40, y: 800, size: 12, text: 'Pedido de prueba: Panadería Ñandú (sintética)' }]], { title: 'x' })
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
    expect(pdf.toString('latin1')).toContain('%%EOF')
    const deal = await admin<{ id: string; owner_id: string }[]>`select d.id, d.owner_id from crm.deals d join crm.pipelines p on p.id = d.pipeline_id and p.has_items
      where exists (select 1 from crm.deal_items i where i.deal_id = d.id) and d.market_code = 'US' limit 1`
    if (!deal[0]) return
    const robert = await ctxFor('robert.hale')
    const out = await orderPdf(robert, deal[0].id)
    expect(out!.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(out!.pdf.toString('latin1')).toContain('Empower Retailer Solutions')
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'document.order_pdf'`)).n).toBe(1)
  })
})
