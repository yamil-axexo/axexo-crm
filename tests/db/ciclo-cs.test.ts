import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, ctxFor, owner, personaId, systemContext } from './helpers'
import { withUser } from '@/server/db'
import { createAccount } from '@/domain/accounts'
import { createDeal } from '@/domain/deals'
import { ingestMetricsFile } from '@/domain/integrations'
import {
  ackHandoff, checkHandoffItem, closeAlert, createHandoff, ingestCareSignals, lifecycleBacktest, publishHealth, pullSignals, runAlerts, runHealthNow, runLifecycleNow, runTiersNow,
  saveCareSettings, saveHealthWeights, savePlaybook, saveTierRules, setLifecycleWindow, setProductLine, setStageByHand, validateHealth,
} from '@/domain/care'
import {
  addFeedback, addReview, closeOpportunity, feedbackDigest, pullAcademy, recordCompletion, recordManagerChange, reviewDraft, runExpansionNow, saveExpansionRule, savePlan, saveRelationship,
  setFeedbackStatus, takeOpportunity,
} from '@/domain/care-accounts'
import { getAccountCare, getCareAdmin, getCareBoard } from '@/dal/care'
import { careAdapterStatus } from '@/server/adapters/care'
import { cicloCsJobs } from '@/server/jobs/ciclo-cs'
import { JOBS } from '@/server/jobs/registry'
import { addDays, isoDay } from '@/lib/format'
import type { Ctx } from '@/server/context'

// Paquete ciclo-cs (13-nov-2026): cuidado del comercio después de la venta, catálogo CS-01 a CS-08.
// Cada punto del campo "falta" de la auditoría tiene una prueba que falla sin su cambio. Las pruebas crean sus propios registros.
const admin = owner()
const tag = () => Math.random().toString(36).slice(2, 8)
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const today = isoDay(new Date(), 'America/Mexico_City')
const uid = (k: string) => personaId(k)
const days = (n: number) => new Date(Date.now() - n * 86400000).toISOString()

afterAll(async () => {
  await admin.end()
})

/** Una tienda de México a nombre de marco.pena, en la etapa y con la antigüedad en la etapa que pida la prueba. */
async function store(lifecycle = 'active', stageDays = 10, kind: 'store' | 'chain' = 'store', as = 'marco.pena'): Promise<{ id: string; ctx: Ctx }> {
  const ctx = await ctxFor(as)
  const acc = await createAccount(ctx, { market: 'MX', kind, name: `${kind === 'store' ? 'Abarrotes' : 'Cadena'} Cuidado ${tag()}`, segment: kind === 'store' ? 'd2d' : 'b2b', force: true, reason: 'Comercio de prueba distinto' })
  const id = acc.id!
  await admin`update crm.accounts set lifecycle = ${lifecycle} where id = ${id}`
  await admin`update crm.accounts set lifecycle_at = now() - make_interval(days => ${stageDays}) where id = ${id}`
  await admin`update crm.account_care set stage = ${lifecycle}, stage_at = now() - make_interval(days => ${stageDays}), stage_source = 'import' where account_id = ${id}`
  await admin`delete from crm.lifecycle_events where account_id = ${id}`
  return { id, ctx }
}
/** Un corte del archivo de ventas para el comercio, `ago` días atrás. */
async function metrics(id: string, m: { d: number; txn: number; ago?: number; firstDays?: number; lastDays?: number; volume?: number; status?: string | null }) {
  await admin`insert into crm.merchant_metrics_daily (account_id, as_of, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d, status)
              values (${id}, ${addDays(today, -(m.ago ?? 0))}, 'MX', ${days(m.firstDays ?? 100)}, ${days(m.lastDays ?? (m.txn > 0 ? 1 : 40))}, ${m.txn}, ${m.volume ?? m.txn * 6500}, 'MXN', ${m.d}, ${m.status ?? null})
              on conflict (account_id, as_of) do update set txn_count_30d = excluded.txn_count_30d, active_days_30d = excluded.active_days_30d, last_txn_at = excluded.last_txn_at, volume_minor_30d = excluded.volume_minor_30d, status = excluded.status`
}
const recalc = async (id: string) => {
  const sys = await systemContext()
  return (await withUser(sys.user.id, (tx) => tx<{ n: number }[]>`select app.lifecycle_recalc('MX', ${id}) as n`))[0]!.n
}
const stageOf = async (id: string) => one(admin<{ stage: string; lifecycle: string; stage_source: string; stage_reason: string | null }[]>`
  select c.stage, a.lifecycle, c.stage_source, c.stage_reason from crm.accounts a join crm.account_care c on c.account_id = a.id where a.id = ${id}`)
const settle = (id: string, n = 10) => admin`update crm.account_care set stage_at = now() - make_interval(days => ${n}) where account_id = ${id}`
const alertsFor = async (id: string) => {
  const sys = await systemContext()
  return withUser(sys.user.id, (tx) => runAlerts(tx, sys, { accountId: id }))
}
const SETTINGS = { alertsOn: true, ownRulesOn: false, noFirstSaleDays: 7, dropPct: 40, lowBalance: '' as const, holdoutPct: 0, escalateDays: 7, whatsappCap: 20 }

// Va primero: aquí todos los comercios son todavía los de los datos de ejemplo.
describe('tareas programadas y permisos del paquete', () => {
  it('los seis jobs están en el registro, corren dos veces sin duplicar y no crean tareas con las alertas apagadas', async () => {
    expect(cicloCsJobs.map((j) => j.key)).toEqual(['ciclo-cs.signals', 'ciclo-cs.lifecycle', 'ciclo-cs.health', 'ciclo-cs.alerts', 'ciclo-cs.expansion', 'ciclo-cs.feedback_digest'])
    for (const j of cicloCsJobs) expect(JOBS.some((x) => x.key === j.key)).toBe(true)
    const sys = await systemContext()
    const tasksBefore = (await one(admin<{ n: number }[]>`select count(*)::int as n from crm.activities where kind = 'task'`)).n
    const coarseBefore = await admin<{ lifecycle: string; n: number }[]>`select lifecycle, count(*)::int as n from crm.accounts group by 1 order by 1`
    for (const j of cicloCsJobs) {
      const out = await withUser(sys.user.id, (tx) => j.run(tx))
      expect(out.done).toBeGreaterThanOrEqual(0)
    }
    for (const j of cicloCsJobs.filter((x) => x.key !== 'ciclo-cs.health' && x.key !== 'ciclo-cs.feedback_digest')) {
      expect((await withUser(sys.user.id, (tx) => j.run(tx))).done, j.key).toBe(0)
    }
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.activities where kind = 'task'`)).n).toBe(tasksBefore)
    // en los datos de ejemplo, la etapa resumida de cada comercio no cambia al correr las reglas: solo aparece el detalle (hábito)
    expect(await admin`select lifecycle, count(*)::int as n from crm.accounts group by 1 order by 1`).toEqual(coarseBefore)
    // una persona no puede llamar las funciones de recálculo por su cuenta
    await expect(asPersona('marco.pena', (tx) => tx`select app.lifecycle_recalc(null, null)`)).rejects.toMatchObject({ code: '42501' })
    await expect(asPersona('ana.robles', (tx) => tx`select app.health_snapshot_run(null)`)).rejects.toMatchObject({ code: '42501' })
    // "recalcular ahora" es de quien lidera el mercado, en su mercado
    await expect(runLifecycleNow(await ctxFor('marco.pena'), 'MX')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(runLifecycleNow(await ctxFor('ana.robles'), 'US')).rejects.toMatchObject({ code: 'forbidden' })
    expect(await runLifecycleNow(await ctxFor('ana.robles'), 'MX')).toBeGreaterThanOrEqual(0)
  })
})

describe('CS-01 · ciclo de vida completo, con histéresis, ventanas por producto e historial', () => {
  it('toda tabla nueva tiene RLS forzado y cada comercio nace con su fila de cuidado', async () => {
    const tables = ['account_care', 'lifecycle_events', 'lifecycle_windows', 'care_signals', 'handoffs', 'cs_settings', 'playbooks', 'cs_alerts', 'cs_messages', 'health_config', 'health_snapshots',
      'health_validations', 'service_tier_events', 'training_completions', 'manager_changes', 'expansion_rules', 'expansion_opportunities', 'account_plans', 'account_relationships', 'account_reviews',
      'feedback_topics', 'product_feedback', 'feedback_digests']
    const rows = await admin<{ relname: string; ok: boolean }[]>`select relname, relrowsecurity and relforcerowsecurity as ok from pg_class where relnamespace = 'crm'::regnamespace and relname = any(${tables})`
    expect(rows).toHaveLength(tables.length)
    expect(rows.filter((r) => !r.ok)).toEqual([])
    const a = await store('prospect')
    expect((await stageOf(a.id)).stage).toBe('prospect')
    // la etapa resumida del comercio conserva sus seis valores: los reportes y filtros que ya la leen no cambian
    await expect(admin`update crm.accounts set lifecycle = 'habit' where id = ${a.id}`).rejects.toMatchObject({ code: '23514' })
  })

  it('hábito: se alcanza con los días de la ventana y cuenta como activo; se pierde solo por debajo de otro umbral', async () => {
    const a = await store('active')
    await metrics(a.id, { d: 22, txn: 80 })
    expect(await recalc(a.id)).toBe(1)
    expect(await stageOf(a.id)).toMatchObject({ stage: 'habit', lifecycle: 'active', stage_source: 'sales_file', stage_reason: 'habit_at' })
    // 17 días: ya no alcanzaría el hábito (20), pero todavía lo sostiene (15). No brinca.
    await settle(a.id)
    await metrics(a.id, { d: 17, txn: 60 })
    expect(await recalc(a.id)).toBe(0)
    expect((await stageOf(a.id)).stage).toBe('habit')
    await metrics(a.id, { d: 12, txn: 30 })
    expect(await recalc(a.id)).toBe(1)
    expect(await stageOf(a.id)).toMatchObject({ stage: 'active', lifecycle: 'active', stage_reason: 'habit_below' })
  })

  it('histéresis: entra a riesgo con menos de 5 días y no sale con 6; sale con 8. Y un cambio reciente no se mueve al día siguiente', async () => {
    const a = await store('active')
    await metrics(a.id, { d: 3, txn: 4 })
    expect(await recalc(a.id)).toBe(1)
    expect(await stageOf(a.id)).toMatchObject({ stage: 'at_risk', lifecycle: 'at_risk', stage_reason: 'risk_below' })
    // acaba de entrar a riesgo: aunque hoy el archivo traiga 9 días, no brinca de vuelta sin llevar los días mínimos en la etapa
    await metrics(a.id, { d: 9, txn: 20 })
    expect(await recalc(a.id)).toBe(0)
    await settle(a.id)
    // con 6 días ya no entraría a riesgo, pero tampoco sale: el umbral de salida es 8
    await metrics(a.id, { d: 6, txn: 9 })
    expect(await recalc(a.id)).toBe(0)
    expect((await stageOf(a.id)).stage).toBe('at_risk')
    await metrics(a.id, { d: 8, txn: 14 })
    expect(await recalc(a.id)).toBe(1)
    expect(await stageOf(a.id)).toMatchObject({ stage: 'active', stage_reason: 'recover_at' })
    // la carga del archivo de ventas usa los mismos dos umbrales (antes entraba y salía con 5)
    const b = await store('at_risk')
    const ref = `MID-H${tag()}`
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${b.id}, 'MX', 's5', ${ref})`
    const row = { merchant_ref: ref, first_txn_at: days(100), last_txn_at: days(1), currency: 'MXN', volume_minor_30d: 50000 }
    await ingestMetricsFile(await systemContext(), { as_of: addDays(today, -1), file_name: `h-${tag()}.json`, mode: 'delta', rows: [{ ...row, txn_count_30d: 9, active_days_30d: 6 }] })
    expect((await stageOf(b.id)).lifecycle).toBe('at_risk')
    await ingestMetricsFile(await systemContext(), { as_of: today, file_name: `h-${tag()}.json`, mode: 'delta', rows: [{ ...row, txn_count_30d: 15, active_days_30d: 8 }] })
    expect(await stageOf(b.id)).toMatchObject({ lifecycle: 'active', stage: 'active', stage_source: 'sales_file' })
  })

  it('inactivo, reactivado y perdido se derivan solos, y cada cambio queda en el historial con su origen', async () => {
    const a = await store('at_risk')
    await metrics(a.id, { d: 0, txn: 0, lastDays: 35 })
    await recalc(a.id)
    expect((await stageOf(a.id)).stage).toBe('inactive')
    // vuelve a vender: no es un activo cualquiera, es un reactivado (y cuenta como activo en los reportes)
    await settle(a.id)
    await metrics(a.id, { d: 9, txn: 18 })
    await recalc(a.id)
    expect(await stageOf(a.id)).toMatchObject({ stage: 'reactivated', lifecycle: 'active' })
    // a los 30 días vendiendo se asienta como activo
    await settle(a.id, 31)
    await recalc(a.id)
    expect((await stageOf(a.id)).stage).toBe('active')
    // perdido: 90 días sin vender
    const b = await store('inactive', 60)
    await metrics(b.id, { d: 0, txn: 0, lastDays: 95 })
    await recalc(b.id)
    expect(await stageOf(b.id)).toMatchObject({ stage: 'churned', lifecycle: 'churned', stage_reason: 'churn_after_days' })
    const c = await store('inactive', 60)
    await metrics(c.id, { d: 0, txn: 0, lastDays: 80 })
    expect(await recalc(c.id)).toBe(0)
    const hist = await admin<{ from_stage: string; to_stage: string; source: string }[]>`select from_stage, to_stage, source from crm.lifecycle_events where account_id = ${a.id} order by at`
    expect(hist).toEqual([
      { from_stage: 'at_risk', to_stage: 'inactive', source: 'sales_file' },
      { from_stage: 'inactive', to_stage: 'reactivated', source: 'sales_file' },
      { from_stage: 'reactivated', to_stage: 'active', source: 'sales_file' },
    ])
    // la pantalla lee el historial y dice de dónde salió la etapa
    const care = (await getAccountCare(a.ctx, a.id))!
    expect(care.history).toHaveLength(3)
    expect(care.care).toMatchObject({ stage: 'active', stage_source: 'sales_file' })
  })

  it('sin archivo de ventas, la etapa se mueve con reglas internas solo si el mercado lo enciende, y dice que salió de las reglas', async () => {
    const ana = await ctxFor('ana.robles')
    const a = await store('onboarding')
    await admin`insert into crm.visits (market_code, account_id, external_visit_id, salesperson_ref, business_date, checked_in_at, outcome) values ('MX', ${a.id}, ${'v-' + tag()}, 'sp-1', ${addDays(today, -1)}, ${days(1)}, 'sale')`
    expect(await recalc(a.id)).toBe(0)
    await saveCareSettings(ana, 'MX', { ...SETTINGS, alertsOn: false, ownRulesOn: true })
    try {
      expect(await recalc(a.id)).toBe(1)
      expect(await stageOf(a.id)).toMatchObject({ stage: 'active', lifecycle: 'active', stage_source: 'rules', stage_reason: 'first_sale' })
    } finally {
      await saveCareSettings(ana, 'MX', { ...SETTINGS, alertsOn: false })
    }
    // el archivo trae el estado: manda el archivo y el historial lo dice
    const b = await store('active')
    const ref = `MID-S${tag()}`
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${b.id}, 'MX', 's5', ${ref})`
    await ingestMetricsFile(await systemContext(), { as_of: today, file_name: `s-${tag()}.json`, mode: 'delta', rows: [{ merchant_ref: ref, first_txn_at: days(100), last_txn_at: days(3), txn_count_30d: 30, volume_minor_30d: 1, currency: 'MXN', active_days_30d: 12, status: 'at_risk' }] })
    expect(await stageOf(b.id)).toMatchObject({ lifecycle: 'at_risk', stage: 'at_risk', stage_source: 'sales_file' })
    await settle(b.id)
    expect(await recalc(b.id)).toBe(0) // las reglas no le llevan la contraria al archivo
  })

  it('ventanas por línea de producto: se cambian por mercado, se validan y cada comercio usa la de su línea', async () => {
    const ana = await ctxFor('ana.robles')
    await expect(setLifecycleWindow(await ctxFor('marco.pena'), 'MX', 'remittances', { riskBelow: 2, recoverAt: 4, habitAt: 10, habitBelow: 6, churnAfterDays: 120, minDaysInStage: 0 })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setLifecycleWindow(ana, 'MX', 'remittances', { riskBelow: 5, recoverAt: 5, habitAt: 20, habitBelow: 15, churnAfterDays: 90, minDaysInStage: 3 })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setLifecycleWindow(await ctxFor('robert.hale'), 'MX', 'remittances', { riskBelow: 2, recoverAt: 4, habitAt: 10, habitBelow: 6, churnAfterDays: 120, minDaysInStage: 0 })).rejects.toMatchObject({ code: 'forbidden' })
    await setLifecycleWindow(ana, 'MX', 'remittances', { riskBelow: 2, recoverAt: 4, habitAt: 10, habitBelow: 6, churnAfterDays: 120, minDaysInStage: 0 })
    const a = await store('active')
    const b = await store('active')
    await setProductLine(a.ctx, a.id, 'remittances')
    for (const x of [a, b]) await metrics(x.id, { d: 3, txn: 5 })
    await recalc(a.id)
    await recalc(b.id)
    // con 3 días, remesas (riesgo con menos de 2) sigue activo; la ventana general (menos de 5) lo manda a riesgo
    expect((await stageOf(a.id)).stage).toBe('active')
    expect((await stageOf(b.id)).stage).toBe('at_risk')
    expect((await getCareAdmin(ana, 'MX')).windows.find((w) => w.product_line === 'remittances')).toMatchObject({ risk_below: 2, recover_at: 4, calibrated_from: 'manual' })
    expect((await one(admin`select action from crm.audit_events where action = 'care.window_set' order by at desc limit 1`)).action).toBe('care.window_set')
  })

  it('calibración con datos propios: sin muestra no sugiere nada; con historia, sugiere el umbral que mejor anticipó a los que dejaron de vender', async () => {
    const robert = await ctxFor('robert.hale')
    expect((await lifecycleBacktest(robert, 'US', 'bill_pay')).best).toBeNull()
    // 40 comercios de recargas en US con dos cortes: los de pocos días con venta dejaron de vender, los demás no
    const sam = await uid('sam.ortiz')
    for (let i = 0; i < 40; i++) {
      const acc = await one(admin<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id) values ('US', 'store', ${'Backtest ' + i + tag()}, 'dealer', 'active', ${sam}) returning id`)
      await admin`update crm.account_care set product_line = 'topups' where account_id = ${acc.id}`
      const low = i < 12
      await admin`insert into crm.merchant_metrics_daily (account_id, as_of, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d)
                  values (${acc.id}, ${addDays(today, -40)}, 'US', ${days(200)}, ${days(41)}, ${low ? 3 : 60}, 1000, 'USD', ${low ? 2 + (i % 2) : 15 + (i % 10)}),
                         (${acc.id}, ${addDays(today, -5)}, 'US', ${days(200)}, ${days(low ? 38 : 6)}, ${low ? 0 : 55}, 1000, 'USD', ${low ? 0 : 14})`
    }
    const out = await lifecycleBacktest(robert, 'US', 'topups')
    expect(out.best).toMatchObject({ threshold: 4, sample: 40, positives: 12 })
    expect(Number(out.best!.hit_precision)).toBe(1)
    expect(Number(out.best!.hit_recall)).toBe(1)
    // quien lidera otro mercado no ve la calibración de este
    await expect(lifecycleBacktest(await ctxFor('ana.robles'), 'US', 'topups')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('una persona puede marcar al comercio como perdido con motivo; queda en el historial a su nombre', async () => {
    const a = await store('inactive')
    await expect(setStageByHand(a.ctx, a.id, 'churned', 'Cerró el local')).rejects.toMatchObject({ code: 'forbidden' }) // ventas no
    const fer = await ctxFor('fernando.ibarra')
    await expect(setStageByHand(fer, a.id, 'churned', '')).rejects.toMatchObject({ code: 'invalid' })
    await setStageByHand(fer, a.id, 'churned', 'Cerró el local')
    expect(await stageOf(a.id)).toMatchObject({ stage: 'churned', lifecycle: 'churned', stage_source: 'manual', stage_reason: 'Cerró el local' })
    const ev = await one(admin<{ source: string; actor_id: string }[]>`select source, actor_id from crm.lifecycle_events where account_id = ${a.id} order by at desc limit 1`)
    expect(ev).toEqual({ source: 'manual', actor_id: await uid('fernando.ibarra') })
  })
})

describe('CS-01 · entregas con dueño, fecha, lista y acuse', () => {
  it('Ventas entrega a Operaciones: nace con quién recibe, para cuándo y su lista; el acuse define quién cuida, sin cambiar el dueño ni el origen', async () => {
    const a = await store('active')
    const valeria = await ctxFor('valeria.soto')
    const due = addDays(today, 2)
    await expect(createHandoff(a.ctx, { accountId: a.id, toRole: 'ops', toUserId: await uid('tom.reyes'), dueOn: due })).rejects.toMatchObject({ code: 'invalid' }) // otra persona de otro mercado
    await expect(createHandoff(a.ctx, { accountId: a.id, toRole: 'ops', toUserId: valeria.user.id, dueOn: addDays(today, -1) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createHandoff(a.ctx, { accountId: a.id, toRole: 'sales', toUserId: valeria.user.id, dueOn: due })).rejects.toMatchObject({ code: 'invalid' }) // mismo equipo
    const attributions = () => admin`select layer, party_ref, effective_to from crm.account_attributions where account_id = ${a.id} order by layer, effective_from`
    const before = await attributions()
    const id = await createHandoff(a.ctx, { accountId: a.id, toRole: 'ops', toUserId: valeria.user.id, dueOn: due, note: 'Prometimos visita de arranque' })
    const h = await one(admin<{ from_role: string; to_role: string; status: string; due_on: string; n: number; activity_id: string }[]>`select from_role, to_role, status, due_on::text, jsonb_array_length(checklist) as n, activity_id from crm.handoffs where id = ${id}`)
    expect(h).toMatchObject({ from_role: 'sales', to_role: 'ops', status: 'pending', due_on: due, n: 3 })
    // quien recibe tiene tarea con fecha y aviso; no puede haber dos entregas del mismo tramo esperando acuse
    expect(await one(admin`select kind, owner_id, done_at from crm.activities where id = ${h.activity_id}`)).toMatchObject({ kind: 'handoff', owner_id: valeria.user.id, done_at: null })
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.notices where user_id = ${valeria.user.id} and account_id = ${a.id} and kind = 'handoff'`)).n).toBe(1)
    await expect(createHandoff(a.ctx, { accountId: a.id, toRole: 'ops', toUserId: valeria.user.id, dueOn: due })).rejects.toMatchObject({ code: 'conflict' })
    // el acuse lo da quien recibe; con puntos sin marcar hay que decir qué falta
    await expect(ackHandoff(a.ctx, id, { accept: true })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(ackHandoff(valeria, id, { accept: true })).rejects.toMatchObject({ code: 'invalid' })
    await checkHandoffItem(a.ctx, id, 'contact', true)
    await checkHandoffItem(valeria, id, 'docs', true)
    await ackHandoff(valeria, id, { accept: true, note: 'Falta anotar lo prometido' })
    expect(await one(admin`select status, ack_by, ack_note from crm.handoffs where id = ${id}`)).toEqual({ status: 'acknowledged', ack_by: valeria.user.id, ack_note: 'Falta anotar lo prometido' })
    expect((await one(admin<{ done: boolean }[]>`select done_at is not null as done from crm.activities where id = ${h.activity_id}`)).done).toBe(true)
    expect(await one(admin`select care_owner_id, care_role from crm.account_care where account_id = ${a.id}`)).toEqual({ care_owner_id: valeria.user.id, care_role: 'ops' })
    // no es una reasignación: el dueño de ventas y la atribución de origen siguen igual
    expect((await one(admin<{ owner_id: string }[]>`select owner_id from crm.accounts where id = ${a.id}`)).owner_id).toBe(a.ctx.user.id)
    expect(await attributions()).toEqual(before)
    await expect(ackHandoff(valeria, id, { accept: true })).rejects.toMatchObject({ code: 'invalid' }) // ya tiene acuse

    // Operaciones entrega a quien cuida la cuenta (segundo tramo): sale como "ops" y lleva otra lista
    const ana = await ctxFor('ana.robles')
    const second = await createHandoff(valeria, { accountId: a.id, toRole: 'am', toUserId: ana.user.id, dueOn: due })
    expect(await one(admin`select from_role, to_role, jsonb_array_length(checklist) as n from crm.handoffs where id = ${second}`)).toEqual({ from_role: 'ops', to_role: 'am', n: 4 })
    // devolverla pide motivo; devuelta, quien cuida sigue siendo Operaciones
    await expect(ackHandoff(ana, second, { accept: false })).rejects.toMatchObject({ code: 'invalid' })
    await ackHandoff(ana, second, { accept: false, note: 'Todavía no hace su primera venta' })
    expect((await one(admin`select status from crm.handoffs where id = ${second}`)).status).toBe('returned')
    expect((await one(admin`select care_role from crm.account_care where account_id = ${a.id}`)).care_role).toBe('ops')
    // la mesa de trabajo y la bitácora
    const board = await getCareBoard(valeria, 'MX')
    expect(board.handoffs.find((x) => x.account_id === a.id)).toBeUndefined()
    const actions = (await admin<{ action: string }[]>`select action from crm.audit_events where object_id = ${a.id} and action like 'care.handoff%' order by at`).map((r) => r.action)
    expect(actions).toEqual(['care.handoff_created', 'care.handoff_checked', 'care.handoff_checked', 'care.handoff_acknowledged', 'care.handoff_created', 'care.handoff_returned'])
  })

  it('la entrega a Operaciones nace sola cuando el negocio se gana con la primera transacción, y solo la ve quien ve el comercio', async () => {
    const diana = await ctxFor('diana.cruz')
    const acc = await createAccount(diana, { market: 'MX', kind: 'chain', name: `Cadena Entrega ${tag()}`, segment: 'b2b', force: true, reason: 'Comercio de prueba distinto' })
    const pipe = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'b2b'`)
    const dealId = await createDeal(diana, { accountId: acc.id!, pipelineId: pipe.id, title: 'Negocio con entrega', nextStep: 'Llamar', nextStepDue: '2030-01-10' })
    const ref = `MID-E${tag()}`
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${acc.id!}, 'MX', 's5', ${ref})`
    const out = await ingestMetricsFile(await systemContext(), { as_of: addDays(today, -1), file_name: `e-${tag()}.json`, mode: 'delta', rows: [{ merchant_ref: ref, first_txn_at: days(1), last_txn_at: days(1), txn_count_30d: 3, volume_minor_30d: 90000, currency: 'MXN', active_days_30d: 2 }] })
    expect(out.dealsWon).toBe(1)
    const h = await one(admin<{ from_role: string; to_role: string; to_user_id: string; status: string; source: string; deal_id: string; from_user_id: string }[]>`select from_role, to_role, to_user_id, status, source, deal_id, from_user_id from crm.handoffs where account_id = ${acc.id!}`)
    expect(h).toEqual({ from_role: 'sales', to_role: 'ops', to_user_id: await uid('valeria.soto'), status: 'pending', source: 'rule', deal_id: dealId, from_user_id: diana.user.id })
    // la activación quedó en el historial con su origen
    expect(await stageOf(acc.id!)).toMatchObject({ stage: 'active', stage_source: 'sales_file' })
    // RLS: una vendedora de otro mercado no ve la entrega; tampoco un vendedor de México que no ve ese comercio
    expect((await asPersona('jade.kim', (tx) => tx`select 1 from crm.handoffs where account_id = ${acc.id!}`)).length).toBe(0)
    expect((await asPersona('marco.pena', (tx) => tx`select 1 from crm.handoffs where account_id = ${acc.id!}`)).length).toBe(0)
    expect((await asPersona('valeria.soto', (tx) => tx`select 1 from crm.handoffs where account_id = ${acc.id!}`)).length).toBe(1)
    // leadership lee y no cambia nada
    await expect(createHandoff(await ctxFor('luis.tovar'), { accountId: acc.id!, toRole: 'cs', toUserId: await uid('ana.robles'), dueOn: addDays(today, 1) })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('CS-03 · alertas tempranas que crean tarea con guía de acción', () => {
  it('apagadas por defecto: nada crea tareas. Encendidas: alta sin primera venta a N días crea la tarea al dueño, con los pasos de la guía', async () => {
    const ana = await ctxFor('ana.robles')
    const a = await store('onboarding', 9)
    expect(await alertsFor(a.id)).toMatchObject({ opened: 0, tasks: 0 })
    await expect(saveCareSettings(a.ctx, 'MX', SETTINGS)).rejects.toMatchObject({ code: 'forbidden' })
    await saveCareSettings(ana, 'MX', { ...SETTINGS, noFirstSaleDays: 12 })
    try {
      expect(await alertsFor(a.id)).toMatchObject({ opened: 0 }) // N es del mercado: con 12 días todavía no toca
      await saveCareSettings(ana, 'MX', SETTINGS)
      expect(await alertsFor(a.id)).toMatchObject({ opened: 1, tasks: 1 })
      const al = await one(admin<{ id: string; kind: string; owner_id: string; in_holdout: boolean; activity_id: string; playbook_id: string }[]>`select id, kind, owner_id, in_holdout, activity_id, playbook_id from crm.cs_alerts where account_id = ${a.id}`)
      expect(al).toMatchObject({ kind: 'no_first_sale', owner_id: a.ctx.user.id, in_holdout: false })
      const task = await one(admin<{ kind: string; owner_id: string; subject: string; body: string; source: string; due: boolean }[]>`select kind, owner_id, subject, body, source, due_at > now() as due from crm.activities where id = ${al.activity_id}`)
      expect(task).toMatchObject({ kind: 'task', owner_id: a.ctx.user.id, source: 'rule', due: true })
      expect(task.subject).toContain('Ayudar a hacer la primera venta')
      expect(task.body).toContain('1. Llama o visita al encargado')
      // correrlo otra vez no abre otra alerta ni otra tarea
      expect(await alertsFor(a.id)).toMatchObject({ opened: 0, tasks: 0 })
      // el comercio hace su primera venta: la alerta se cierra sola y su tarea también
      await admin`update crm.accounts set lifecycle = 'active' where id = ${a.id}`
      expect(await alertsFor(a.id)).toMatchObject({ closed: 1 })
      expect(await one(admin`select status, close_reason from crm.cs_alerts where id = ${al.id}`)).toEqual({ status: 'closed', close_reason: 'recovered' })
      expect((await one(admin<{ done: boolean }[]>`select done_at is not null as done from crm.activities where id = ${al.activity_id}`)).done).toBe(true)
    } finally {
      await saveCareSettings(ana, 'MX', { ...SETTINGS, alertsOn: false })
    }
  })

  it('caída contra su línea base, comercio inactivo y saldo bajo abren alerta; descartar pide motivo y no reaparece', async () => {
    const ana = await ctxFor('ana.robles')
    await saveCareSettings(ana, 'MX', { ...SETTINGS, lowBalance: 500 })
    try {
      // caída: vendía 100 y ahora 40 (umbral 40%)
      const a = await store('active')
      await metrics(a.id, { d: 20, txn: 100, ago: 60 })
      await metrics(a.id, { d: 20, txn: 100, ago: 35 })
      await metrics(a.id, { d: 9, txn: 40 })
      // caída chica: vendía 100 y ahora 80, no alerta
      const b = await store('active')
      await metrics(b.id, { d: 20, txn: 100, ago: 40 })
      await metrics(b.id, { d: 18, txn: 80 })
      // inactivo
      const c = await store('inactive')
      // saldo bajo
      const d = await store('active')
      await metrics(d.id, { d: 15, txn: 50 })
      const sys = await systemContext()
      await withUser(sys.user.id, (tx) => ingestCareSignals(tx, { as_of: today, source: 'manual', rows: [{ account_id: d.id, balance_minor: 20000 }, { account_id: a.id, balance_minor: 900000 }] }))
      for (const x of [a, b, c, d]) await alertsFor(x.id)
      const kinds = async (id: string) => (await admin<{ kind: string }[]>`select kind from crm.cs_alerts where account_id = ${id} and status = 'open' order by kind`).map((r) => r.kind)
      expect(await kinds(a.id)).toEqual(['drop_vs_baseline'])
      expect(await kinds(b.id)).toEqual([])
      expect(await kinds(c.id)).toEqual(['inactive'])
      expect(await kinds(d.id)).toEqual(['low_balance'])
      const drop = await one(admin<{ id: string; detail: { baseline: number; now: number } }[]>`select id, detail from crm.cs_alerts where account_id = ${a.id}`)
      expect(drop.detail).toMatchObject({ baseline: 100, now: 40 })
      // descartar pide motivo; descartada, no reaparece al volver a evaluar
      await expect(closeAlert(a.ctx, drop.id, 'dismissed', '')).rejects.toMatchObject({ code: 'invalid' })
      await expect(closeAlert(await ctxFor('luis.tovar'), drop.id, 'done', '')).rejects.toMatchObject({ code: 'forbidden' })
      await closeAlert(a.ctx, drop.id, 'dismissed', 'Cerró dos semanas por remodelación')
      expect(await alertsFor(a.id)).toMatchObject({ opened: 0 })
      expect(await kinds(a.id)).toEqual([])
      // recarga: la alerta de saldo se cierra sola con el siguiente corte
      await withUser(sys.user.id, (tx) => ingestCareSignals(tx, { as_of: addDays(today, 2), source: 'manual', rows: [{ account_id: d.id, balance_minor: 300000 }] }))
      expect(await alertsFor(d.id)).toMatchObject({ closed: 1 })
    } finally {
      await saveCareSettings(ana, 'MX', { ...SETTINGS, alertsOn: false })
    }
  })

  it('grupo de control sin tarea, dueño según modelo de atención, mensaje solo con permiso y canal apagado, y medición a 14 días', async () => {
    const ana = await ctxFor('ana.robles')
    await saveCareSettings(ana, 'MX', { ...SETTINGS, holdoutPct: 50 })
    try {
      // con 50% de control, se crean comercios hasta tener uno de cada lado
      let control: string | null = null, treated: string | null = null
      for (let i = 0; i < 30 && !(control && treated); i++) {
        const s = await store('onboarding', 9)
        const inC = (await one(admin<{ c: boolean }[]>`select app.in_holdout(${s.id}, 50) as c`)).c
        if (inC && !control) control = s.id
        if (!inC && !treated) treated = s.id
      }
      expect(control && treated).toBeTruthy()
      // el tratado dio permiso de mensajes; lo cuida Operaciones (atención en equipo)
      // (el permiso vive en el registro único de consentimientos, por contacto)
      const contact = await one(admin<{ id: string }[]>`insert into crm.contacts (market_code, full_name, phone) values ('MX', 'Encargada Con Permiso', ${'+5255' + String(Math.floor(10000000 + Math.random() * 89999999))}) returning id`)
      await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${treated!}, ${contact.id}, 'MX', 'manager')`
      await admin`insert into crm.consents (market_code, contact_id, channel, category, source, evidence) values ('MX', ${contact.id}, 'whatsapp', 'service', 'verbal', 'Dijo que sí en la visita')`
      await admin`update crm.account_care set service_tier = 'pooled', care_owner_id = ${await uid('valeria.soto')}, care_role = 'ops' where account_id = ${treated!}`
      await alertsFor(control!)
      await alertsFor(treated!)
      const c = await one(admin<{ in_holdout: boolean; activity_id: string | null; id: string }[]>`select id, in_holdout, activity_id from crm.cs_alerts where account_id = ${control!}`)
      expect(c).toMatchObject({ in_holdout: true, activity_id: null })
      expect((await admin`select 1 from crm.cs_messages where account_id = ${control!}`).length).toBe(0)
      const t = await one(admin<{ id: string; in_holdout: boolean; owner_id: string; activity_id: string | null; digital_only: boolean }[]>`select id, in_holdout, owner_id, activity_id, digital_only from crm.cs_alerts where account_id = ${treated!}`)
      expect(t).toMatchObject({ in_holdout: false, owner_id: await uid('valeria.soto'), digital_only: false })
      expect(t.activity_id).not.toBeNull()
      // WhatsApp apagado: el mensaje queda en la cola y no sale; aun así la tarea va a una persona
      expect(await one(admin`select status, channel from crm.cs_messages where alert_id = ${t.id}`)).toEqual({ status: 'queued_off', channel: 'whatsapp' })
      // sin permiso no hay mensaje: queda anotado por qué
      const noConsent = await store('onboarding', 9)
      await admin`update crm.cs_settings set holdout_pct = 0 where market_code = 'MX'`
      await alertsFor(noConsent.id)
      expect((await one(admin`select status from crm.cs_messages where account_id = ${noConsent.id}`)).status).toBe('skipped_consent')
      // con el permiso retirado tampoco sale
      const revoked = await store('onboarding', 9)
      const c2 = await one(admin<{ id: string }[]>`insert into crm.contacts (market_code, full_name, phone) values ('MX', 'Encargado Sin Permiso', ${'+5255' + String(Math.floor(10000000 + Math.random() * 89999999))}) returning id`)
      await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${revoked.id}, ${c2.id}, 'MX', 'manager')`
      await admin`insert into crm.consents (market_code, contact_id, channel, category, source, evidence, revoked_at, revoked_reason) values ('MX', ${c2.id}, 'whatsapp', 'service', 'verbal', 'Dijo que sí', now(), 'lo pidió')`
      await alertsFor(revoked.id)
      expect((await one(admin`select status from crm.cs_messages where account_id = ${revoked.id}`)).status).toBe('skipped_consent')
      // medición: a los 14 días se anota si volvió a vender, también para el grupo de control
      await admin`update crm.cs_alerts set opened_at = now() - interval '15 days' where id in (${c.id}, ${t.id})`
      await metrics(treated!, { d: 6, txn: 9, lastDays: 3 })
      await alertsFor(control!)
      await alertsFor(treated!)
      expect((await one(admin`select returned_14d from crm.cs_alerts where id = ${t.id}`)).returned_14d).toBe(true)
      expect((await one(admin`select returned_14d from crm.cs_alerts where id = ${c.id}`)).returned_14d).toBe(false)
      const board = await getCareBoard(ana, 'MX')
      expect(board.measure.find((m) => m.kind === 'no_first_sale' && m.in_holdout)).toMatchObject({ n14: 1, back14: 0 })
      expect(board.measure.find((m) => m.kind === 'no_first_sale' && !m.in_holdout)).toMatchObject({ n14: 1, back14: 1 })
    } finally {
      await saveCareSettings(ana, 'MX', { ...SETTINGS, alertsOn: false })
    }
  })

  it('la guía de acción es un dato editable por mercado y por modelo de atención; la general la cambia administración', async () => {
    const ana = await ctxFor('ana.robles')
    const base = { market: 'MX', kind: 'inactive' as const, tier: 'any' as const, titleEs: 'Recuperar en México', titleEn: 'Win back in Mexico', stepsEs: 'Paso uno de México\nPaso dos de México', stepsEn: 'Mexico step one\nMexico step two', dueDays: 1, isActive: true }
    await expect(savePlaybook(await ctxFor('marco.pena'), base)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(savePlaybook(ana, { ...base, market: '' })).rejects.toMatchObject({ code: 'forbidden' }) // la general no
    await expect(savePlaybook(ana, { ...base, stepsEs: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(savePlaybook(ana, { ...base, messageEs: 'Solo en un idioma' })).rejects.toMatchObject({ code: 'invalid' })
    await savePlaybook(ana, base)
    await savePlaybook(ana, { ...base, tier: 'high', titleEs: 'Recuperar una cuenta dedicada', titleEn: 'Win back a dedicated account', stepsEs: 'Llamar a dirección', stepsEn: 'Call the executive' })
    await saveCareSettings(ana, 'MX', SETTINGS)
    try {
      const a = await store('inactive')
      const b = await store('inactive')
      await admin`update crm.account_care set service_tier = 'high' where account_id = ${b.id}`
      await alertsFor(a.id)
      await alertsFor(b.id)
      const subj = async (id: string) => (await one(admin<{ subject: string; body: string }[]>`select t.subject, t.body from crm.cs_alerts al join crm.activities t on t.id = al.activity_id where al.account_id = ${id}`))
      expect(await subj(a.id)).toMatchObject({ body: '1. Paso uno de México\n2. Paso dos de México' })
      expect((await subj(a.id)).subject).toContain('Recuperar en México')
      expect((await subj(b.id)).subject).toContain('Recuperar una cuenta dedicada')
      // la de US sigue con la guía general
      expect((await getCareAdmin(await ctxFor('robert.hale'), 'US')).playbooks.find((p) => p.alert_kind === 'inactive')).toMatchObject({ market_code: null, title_es: 'Recuperar a un comercio que dejó de vender' })
    } finally {
      await saveCareSettings(ana, 'MX', { ...SETTINGS, alertsOn: false })
    }
  })
})

describe('CS-02 · puntaje de salud explicable y validado', () => {
  it('el puntaje guarda de qué se compone: cada grupo aporta como mucho su peso, un grupo sin dato no cuenta y un dato viejo pesa menos', async () => {
    const ana = await ctxFor('ana.robles')
    const a = await store('active')
    await metrics(a.id, { d: 20, txn: 100, ago: 40 })
    await metrics(a.id, { d: 10, txn: 50 })
    await runHealthNow(ana, 'MX')
    const snap = async (id: string) => one(admin<{ score: number; band: string; lowest: string; groups: { grp: string; weight: number; points: number | null; basis: string; baseline: number | null }[] }[]>`select score, band, lowest, groups from crm.health_snapshots where account_id = ${id} order by as_of desc limit 1`)
    let s = await snap(a.id)
    // solo hay dato de ventas: 50 contra 100 de línea base = la mitad de su peso; los otros grupos dicen que no cuentan
    expect(s.score).toBe(50)
    expect(s.groups.find((g) => g.grp === 'transactions')).toMatchObject({ weight: 50, points: 25, basis: 'vs_baseline', baseline: 100 })
    // campo2: el punto de venta perfecto es un grupo más; sin puntaje de la Sales App tampoco cuenta.
    expect(s.groups.filter((g) => g.points === null).map((g) => g.grp).sort()).toEqual(['balance', 'mix', 'perfect_store', 'tickets'])
    // llegan saldo, productos y solicitudes (la conexión real está apagada; aquí entran por la entrada única)
    await admin`update crm.cs_settings set low_balance_minor = 10000 where market_code = 'MX'`
    const sys = await systemContext()
    await withUser(sys.user.id, (tx) => ingestCareSignals(tx, { as_of: today, source: 'manual', rows: [{ account_id: a.id, balance_minor: 20000, product_count_30d: 3, open_tickets: 5, urgent_tickets: 0 }] }))
    await runHealthNow(ana, 'MX')
    s = await snap(a.id)
    // ventas 25 de 50, productos 15 de 15, solicitudes 0 de 15, saldo 20 de 20 = 60 de 100
    expect(s.score).toBe(60)
    expect(s.lowest).toBe('tickets')
    expect(s.groups.find((g) => g.grp === 'tickets')).toMatchObject({ points: 0, weight: 15 })
    // tope por grupo: aunque venda el triple de su línea base, ventas no pasa de su peso
    await metrics(a.id, { d: 28, txn: 300 })
    await runHealthNow(ana, 'MX')
    expect((await snap(a.id)).groups.find((g) => g.grp === 'transactions')).toMatchObject({ points: 50 })
    // decay: el mismo dato con 9 días de viejo pesa la mitad (14 días de decay, 2 de gracia)
    const b = await store('active')
    await metrics(b.id, { d: 20, txn: 100, ago: 49 })
    await metrics(b.id, { d: 20, txn: 100, ago: 9 })
    await runHealthNow(ana, 'MX')
    expect((await snap(b.id)).groups.find((g) => g.grp === 'transactions')).toMatchObject({ points: 25 })
    await admin`update crm.cs_settings set low_balance_minor = null where market_code = 'MX'`
  })

  it('los pesos se editan por mercado y cambian el puntaje; no hay modelo, solo reglas', async () => {
    const ana = await ctxFor('ana.robles')
    const a = await store('active')
    await metrics(a.id, { d: 20, txn: 100, ago: 40 })
    await metrics(a.id, { d: 20, txn: 100 })
    const sys = await systemContext()
    await withUser(sys.user.id, (tx) => ingestCareSignals(tx, { as_of: today, source: 'manual', rows: [{ account_id: a.id, open_tickets: 5 }] }))
    await runHealthNow(ana, 'MX')
    const score = async () => (await one(admin<{ score: number }[]>`select score from crm.health_snapshots where account_id = ${a.id} order by as_of desc limit 1`)).score
    expect(await score()).toBe(77) // 50 de 50 en ventas, 0 de 15 en solicitudes
    await expect(saveHealthWeights(a.ctx, 'MX', {})).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveHealthWeights(ana, null, {})).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveHealthWeights(ana, 'MX', { transactions: { weight: 0, active: true }, mix: { weight: 0, active: true }, tickets: { weight: 0, active: true }, balance: { weight: 0, active: true } })).rejects.toMatchObject({ code: 'invalid' })
    await saveHealthWeights(ana, 'MX', { transactions: { weight: 50, active: true }, mix: { weight: 15, active: true }, tickets: { weight: 50, active: true }, balance: { weight: 20, active: true } })
    await runHealthNow(ana, 'MX')
    expect(await score()).toBe(50)
    // US conserva los pesos generales
    expect((await getCareAdmin(await ctxFor('robert.hale'), 'US')).weights.find((w) => w.grp === 'tickets')).toMatchObject({ weight: 15, market_code: null })
    await saveHealthWeights(ana, 'MX', { transactions: { weight: 50, active: true }, mix: { weight: 15, active: true }, tickets: { weight: 15, active: true }, balance: { weight: 20, active: true } })
  })

  it('validación contra lo que pasó: precisión y recall por modelo de atención, y no se publica sin ella', async () => {
    const ana = await ctxFor('ana.robles')
    const nora = await ctxFor('nora.salas')
    await expect(publishHealth(ana, 'MX', true)).rejects.toMatchObject({ code: 'forbidden' })
    await admin`delete from crm.health_validations where market_code = 'MX'`
    await expect(publishHealth(nora, 'MX', true)).rejects.toMatchObject({ code: 'not_validated' })
    // 36 comercios con puntaje de hace 35 días: 12 con puntaje bajo, de los que 9 dejaron de vender; de los 24 con puntaje alto, 3 también
    await admin`delete from crm.health_snapshots where market_code = 'MX'`
    const marco = await uid('marco.pena')
    for (let i = 0; i < 36; i++) {
      const low = i < 12
      const dark = low ? i < 9 : i < 15
      const acc = await one(admin<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id) values ('MX', 'store', ${'Validación ' + i + tag()}, 'd2d', ${dark ? 'inactive' : 'active'}, ${marco}) returning id`)
      await admin`insert into crm.health_snapshots (account_id, as_of, market_code, score, band, groups, tier) values (${acc.id}, ${addDays(today, -35)}, 'MX', ${low ? 30 : 85}, ${low ? 'risk' : 'good'}, '[]'::jsonb, ${i % 2 === 0 ? 'low' : 'tech'})`
    }
    const rows = await validateHealth(ana, 'MX', 30)
    const all = rows.find((r) => r.tier === 'all')!
    expect(all).toMatchObject({ sample: 36, positives: 12, threshold: 50 })
    expect(Number(all.hit_precision)).toBe(0.75)
    expect(Number(all.hit_recall)).toBe(0.75)
    expect(rows.map((r) => r.tier).sort()).toEqual(['all', 'low', 'tech'])
    // con la validación guardada, administración sí puede publicarlo; la pantalla de cada comercio lo sabe
    await publishHealth(nora, 'MX', true)
    expect((await getCareBoard(ana, 'MX')).settings.health_published).toBe(true)
    expect((await getCareAdmin(ana, 'MX')).validations.find((v) => v.tier === 'all')).toMatchObject({ sample: 36, horizon_days: 30 })
    await publishHealth(nora, 'MX', false)
    expect((await getCareBoard(ana, 'MX')).settings.health_published).toBe(false)
  })

  it('Zendesk y las demás conexiones están apagadas: no traen nada y cada una dice qué falta para encenderla', async () => {
    const st = careAdapterStatus()
    expect(st.map((s) => s.key).sort()).toEqual(['care_signals', 'kore_academy', 'zendesk_counts'])
    expect(st.every((s) => s.mode === 'off' && s.needs[0].length > 20 && s.needs[1].length > 20)).toBe(true)
    const sys = await systemContext()
    const before = (await one(admin<{ n: number }[]>`select count(*)::int as n from crm.care_signals`)).n
    expect(await withUser(sys.user.id, (tx) => pullSignals(tx))).toEqual({ done: 0, note: 'adapters off' })
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.care_signals`)).n).toBe(before)
    // simulada (solo pruebas): llegan conteos, nunca texto
    process.env.ZENDESK_COUNTS_ADAPTER = 'simulated'
    try {
      const out = await withUser(sys.user.id, (tx) => pullSignals(tx))
      expect(out.done).toBeGreaterThan(0)
      const cols = (await admin<{ column_name: string }[]>`select column_name from information_schema.columns where table_schema = 'crm' and table_name = 'care_signals'`).map((c) => c.column_name)
      expect(cols.filter((c) => /text|subject|body|comment/.test(c))).toEqual([])
      expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.care_signals where open_tickets is not null and source = 'simulated'`)).n).toBeGreaterThan(0)
    } finally {
      delete process.env.ZENDESK_COUNTS_ADAPTER
    }
  })
})

describe('CS-04 · modelo de atención derivado, con histéresis', () => {
  it('se asigna por comisión (o por volumen si no hay ese dato), no baja de nivel por caer un poco, y el tipo de cuenta manda', async () => {
    const ana = await ctxFor('ana.robles')
    await expect(saveTierRules(await ctxFor('marco.pena'), 'MX', { high: 500, pooled: 100, low: 20, rateBp: 100, hysteresisPct: 20 })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveTierRules(ana, 'MX', { high: 100, pooled: 500, low: 20, rateBp: 100, hysteresisPct: 20 })).rejects.toMatchObject({ code: 'invalid' })
    await saveTierRules(ana, 'MX', { high: 500, pooled: 100, low: 20, rateBp: 100, hysteresisPct: 20 })
    const tier = async (id: string) => one(admin<{ service_tier: string | null; service_tier_basis: string | null }[]>`select service_tier, service_tier_basis from crm.account_care where account_id = ${id}`)
    // sin dato de comisión: se estima con el volumen (1%). 1,500,000 centavos de volumen = 15,000 de comisión = en equipo (desde 10,000)
    const a = await store('active')
    await metrics(a.id, { d: 15, txn: 50, volume: 1500000 })
    // con comisión real, manda la comisión aunque el volumen diga otra cosa
    const b = await store('active')
    await metrics(b.id, { d: 15, txn: 50, volume: 1500000 })
    const sys = await systemContext()
    await withUser(sys.user.id, (tx) => ingestCareSignals(tx, { as_of: today, source: 'manual', rows: [{ account_id: b.id, commission_minor_30d: 60000 }] }))
    // una cadena es de atención dedicada por tipo de cuenta
    const c = await store('active', 10, 'chain', 'diana.cruz')
    // sin ventas en el archivo no hay modelo
    const d = await store('onboarding')
    await runTiersNow(ana, 'MX')
    expect(await tier(a.id)).toEqual({ service_tier: 'pooled', service_tier_basis: 'volume' })
    expect(await tier(b.id)).toEqual({ service_tier: 'high', service_tier_basis: 'commission' })
    expect(await tier(c.id)).toEqual({ service_tier: 'high', service_tier_basis: 'account_type' })
    expect(await tier(d.id)).toEqual({ service_tier: null, service_tier_basis: null })
    // histéresis: la comisión de b cae a 45,000 (10% bajo el umbral de 50,000): se queda en dedicada
    await withUser(sys.user.id, (tx) => ingestCareSignals(tx, { as_of: addDays(today, 2), source: 'manual', rows: [{ account_id: b.id, commission_minor_30d: 45000 }] }))
    await runTiersNow(ana, 'MX')
    expect((await tier(b.id)).service_tier).toBe('high')
    // cae a 30,000 (40% bajo el umbral): baja a en equipo, y queda en el historial
    await withUser(sys.user.id, (tx) => ingestCareSignals(tx, { as_of: addDays(today, 3), source: 'manual', rows: [{ account_id: b.id, commission_minor_30d: 30000 }] }))
    await runTiersNow(ana, 'MX')
    expect((await tier(b.id)).service_tier).toBe('pooled')
    // para subir basta alcanzar el umbral
    await withUser(sys.user.id, (tx) => ingestCareSignals(tx, { as_of: addDays(today, 4), source: 'manual', rows: [{ account_id: b.id, commission_minor_30d: 50000 }] }))
    await runTiersNow(ana, 'MX')
    expect((await tier(b.id)).service_tier).toBe('high')
    const hist = (await admin<{ from_tier: string | null; to_tier: string }[]>`select from_tier, to_tier from crm.service_tier_events where account_id = ${b.id} order by at`).map((r) => `${r.from_tier}>${r.to_tier}`)
    expect(hist).toEqual(['null>high', 'high>pooled', 'pooled>high'])
    // la misma capa de datos para todos los niveles: la mesa de trabajo los cuenta juntos
    expect((await getCareBoard(ana, 'MX')).tiers.find((t) => t.tier === 'high')!.n).toBeGreaterThanOrEqual(2)
  })
})

describe('CS-06 · capacitación del comercio y cambio de encargado', () => {
  it('el cambio de encargado visto en la visita es señal de riesgo: abre alerta con tarea, y la constancia de capacitación la cierra', async () => {
    const ana = await ctxFor('ana.robles')
    await saveCareSettings(ana, 'MX', SETTINGS)
    try {
      const a = await store('active')
      await expect(recordManagerChange(await ctxFor('luis.tovar'), { accountId: a.id, changedOn: today, newName: 'Rosa Nueva' })).rejects.toMatchObject({ code: 'forbidden' })
      await expect(recordManagerChange(a.ctx, { accountId: a.id, changedOn: addDays(today, 2), newName: 'Rosa Nueva' })).rejects.toMatchObject({ code: 'invalid' })
      await recordManagerChange(a.ctx, { accountId: a.id, changedOn: today, newName: 'Rosa Nueva', note: 'El dueño le dejó la tienda a su sobrina', source: 'visit' })
      // queda en el hilo del comercio y abre la alerta con su guía, en el mismo momento
      expect((await one(admin<{ subject: string }[]>`select subject from crm.activities where account_id = ${a.id} and kind = 'note' order by created_at desc limit 1`)).subject).toBe('Cambió el encargado: Rosa Nueva')
      const al = await one(admin<{ id: string; kind: string; status: string; activity_id: string }[]>`select id, kind, status, activity_id from crm.cs_alerts where account_id = ${a.id}`)
      expect(al).toMatchObject({ kind: 'manager_change', status: 'open' })
      expect((await one(admin<{ subject: string }[]>`select subject from crm.activities where id = ${al.activity_id}`)).subject).toContain('Encargado nuevo: capacitarlo')
      // la constancia (fuente Kore Academy; aquí a mano porque la conexión está apagada) guarda curso, quién y cuándo, nunca contenido
      await expect(recordCompletion(a.ctx, { accountId: a.id, personName: 'Rosa Nueva', courseKey: 'Con Espacios', courseTitle: 'Primeros pasos', completedOn: today })).rejects.toMatchObject({ code: 'invalid' })
      await recordCompletion(a.ctx, { accountId: a.id, personName: 'Rosa Nueva', courseKey: 'intro-ventas', courseTitle: 'Primeros pasos para vender', completedOn: today })
      expect(await one(admin`select source, course_key from crm.training_completions where account_id = ${a.id}`)).toEqual({ source: 'manual', course_key: 'intro-ventas' })
      expect((await one(admin<{ trained: boolean }[]>`select trained_at is not null as trained from crm.manager_changes where account_id = ${a.id}`)).trained).toBe(true)
      expect(await one(admin`select status, close_reason from crm.cs_alerts where id = ${al.id}`)).toEqual({ status: 'closed', close_reason: 'recovered' })
      const care = (await getAccountCare(a.ctx, a.id))!
      expect(care.completions).toHaveLength(1)
      expect(care.managerChanges[0]).toMatchObject({ new_name: 'Rosa Nueva', source: 'visit' })
    } finally {
      await saveCareSettings(ana, 'MX', { ...SETTINGS, alertsOn: false })
    }
  })

  it('Kore Academy apagada no trae nada; simulada, el curso terminado entra una sola vez y marca al encargado como capacitado', async () => {
    const a = await store('active')
    await admin`update crm.accounts set merchant_ref = ${'MID-KA' + tag()} where id = ${a.id}`
    await recordManagerChange(a.ctx, { accountId: a.id, changedOn: today, newName: 'Luis Nuevo' })
    const sys = await systemContext()
    expect(await withUser(sys.user.id, (tx) => pullAcademy(tx, sys))).toEqual({ done: 0, note: 'adapter off' })
    process.env.KORE_ACADEMY_ADAPTER = 'simulated'
    try {
      expect((await withUser(sys.user.id, (tx) => pullAcademy(tx, sys))).done).toBeGreaterThanOrEqual(1)
      expect(await one(admin`select source, course_key from crm.training_completions where account_id = ${a.id}`)).toEqual({ source: 'kore_academy', course_key: 'intro-ventas' })
      expect((await one(admin<{ trained: boolean }[]>`select trained_at is not null as trained from crm.manager_changes where account_id = ${a.id}`)).trained).toBe(true)
      // otro cambio de encargado y el mismo aviso repetido: no se duplica la constancia
      await admin`update crm.manager_changes set trained_at = null where account_id = ${a.id}`
      await withUser(sys.user.id, (tx) => pullAcademy(tx, sys))
      expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.training_completions where account_id = ${a.id}`)).n).toBe(1)
    } finally {
      delete process.env.KORE_ACADEMY_ADAPTER
    }
  })
})

describe('CS-07 · expansión sobre comercio activo', () => {
  it('la oportunidad se abre solo para comercios activos que cumplen la regla con su actividad real, y sigue su embudo hasta cerrarse', async () => {
    const ana = await ctxFor('ana.robles')
    const label = `Remesas ${tag()}`
    await expect(saveExpansionRule(await ctxFor('marco.pena'), { market: 'MX', productLabel: label, minActiveDays: 12, minDaysSinceFirst: 60, minTxn30d: 30, isActive: true })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveExpansionRule(ana, { market: 'MX', productLabel: label, minActiveDays: 12, minDaysSinceFirst: 60, minTxn30d: 0, isActive: true })).rejects.toMatchObject({ code: 'invalid' })
    await saveExpansionRule(ana, { market: 'MX', productLabel: label, minActiveDays: 12, minDaysSinceFirst: 60, minTxn30d: 30, isActive: true })
    const rule = await one(admin<{ id: string }[]>`select id from crm.expansion_rules where product_label = ${label}`)
    const ok = await store('active')
    await metrics(ok.id, { d: 18, txn: 70, firstDays: 120 })
    const few = await store('active') // vende pocos días
    await metrics(few.id, { d: 6, txn: 70, firstDays: 120 })
    const young = await store('active') // muy nuevo
    await metrics(young.id, { d: 18, txn: 70, firstDays: 20 })
    const dark = await store('inactive') // no transacciona: nunca
    await metrics(dark.id, { d: 18, txn: 70, firstDays: 120 })
    const none = await store('active') // sin datos de ventas: nunca
    await runExpansionNow(ana, 'MX')
    const opp = async (id: string) => admin<{ id: string; status: string; owner_id: string; evidence: { active_days_30d: number } }[]>`select id, status, owner_id, evidence from crm.expansion_opportunities where account_id = ${id} and rule_id = ${rule.id}`
    expect(await opp(ok.id)).toMatchObject([{ status: 'open', owner_id: ok.ctx.user.id, evidence: { active_days_30d: 18 } }])
    for (const x of [few, young, dark, none]) expect(await opp(x.id)).toHaveLength(0)
    // correrlo otra vez no duplica
    expect(await runExpansionNow(ana, 'MX')).toBe(0)
    // tomarla deja tarea; si el comercio dejó de vender, no se ofrece
    const o = (await opp(ok.id))[0]!
    await admin`update crm.accounts set lifecycle = 'inactive' where id = ${ok.id}`
    await expect(takeOpportunity(ok.ctx, o.id)).rejects.toMatchObject({ code: 'not_active' })
    await admin`update crm.accounts set lifecycle = 'active' where id = ${ok.id}`
    await takeOpportunity(ok.ctx, o.id)
    const taken = await one(admin<{ status: string; activity_id: string }[]>`select status, activity_id from crm.expansion_opportunities where id = ${o.id}`)
    expect(taken.status).toBe('working')
    expect((await one(admin<{ subject: string }[]>`select subject from crm.activities where id = ${taken.activity_id}`)).subject).toContain(`Ofrecer ${label}`)
    await expect(closeOpportunity(ok.ctx, o.id, 'lost', '')).rejects.toMatchObject({ code: 'invalid' })
    await closeOpportunity(ok.ctx, o.id, 'lost', 'Ya lo tiene con otro proveedor')
    // perdida: no se vuelve a abrir en 90 días
    expect(await runExpansionNow(ana, 'MX')).toBe(0)
    expect((await getCareBoard(ana, 'MX')).opportunities.find((x) => x.id === o.id)).toMatchObject({ status: 'lost' })
  })
})

describe('CS-05 · cuentas corporativas: plan, relaciones y revisiones', () => {
  it('el plan de cuenta es para cadenas y cuentas dedicadas; la relación se ve por producto y en conjunto; la revisión deja minuta y fecha de la siguiente', async () => {
    const tienda = await store('active')
    await expect(savePlan(tienda.ctx, tienda.id, { goals: 'x', risks: '', nextSteps: '', reviewEveryDays: 90, nextReviewOn: '' })).rejects.toMatchObject({ code: 'invalid' })
    const c = await store('active', 10, 'chain', 'diana.cruz')
    await expect(savePlan(await ctxFor('luis.tovar'), c.id, { goals: 'x', risks: '', nextSteps: '', reviewEveryDays: 90, nextReviewOn: '' })).rejects.toMatchObject({ code: 'forbidden' })
    await savePlan(c.ctx, c.id, { goals: 'Llevar recargas a sus 40 tiendas', risks: 'Cambio de director de compras', nextSteps: 'Piloto en 5 tiendas', reviewEveryDays: 60, nextReviewOn: '' })
    await saveRelationship(c.ctx, c.id, { productLabel: 'Recargas', health: 'good' })
    await saveRelationship(c.ctx, c.id, { productLabel: 'Pago de servicios', health: 'risk', note: 'Fallas en conciliación' })
    await saveRelationship(c.ctx, c.id, { productLabel: 'recargas', health: 'watch' }) // el mismo producto se actualiza, no se duplica
    const rels = await admin<{ product_label: string; health: string }[]>`select product_label, health from crm.account_relationships where account_id = ${c.id} order by product_label`
    expect(rels).toEqual([{ product_label: 'Pago de servicios', health: 'risk' }, { product_label: 'Recargas', health: 'watch' }])
    // borrador con datos: hechos, sin AI (la conexión de AI está apagada)
    const draft = await reviewDraft(c.ctx, c.id)
    expect(draft.ai).toBeNull()
    expect(draft.text).toContain('Relación por producto: Pago de servicios (en riesgo), Recargas (para vigilar).')
    expect(draft.text).toContain('Alertas abiertas: 0.')
    await expect(addReview(c.ctx, c.id, { heldOn: addDays(today, 3), minutes: 'Futuro' })).rejects.toMatchObject({ code: 'invalid' })
    await addReview(c.ctx, c.id, { heldOn: today, attendees: 'Dirección de compras', minutes: draft.text, agreements: 'Piloto en enero', draftSource: 'data' })
    const plan = await one(admin<{ next_review_on: string; review_every_days: number }[]>`select next_review_on::text, review_every_days from crm.account_plans where account_id = ${c.id}`)
    expect(plan).toEqual({ next_review_on: addDays(today, 60), review_every_days: 60 })
    const care = (await getAccountCare(c.ctx, c.id))!
    expect(care.reviews[0]).toMatchObject({ held_on: today, draft_source: 'data', agreements: 'Piloto en enero' })
    expect(care.plan).toMatchObject({ goals: 'Llevar recargas a sus 40 tiendas' })
    // quien cuida la cuenta se nombra por entrega con acuse, no es quien vendió por defecto
    expect(care.care.care_owner_id).toBeNull()
    const paula = await ctxFor('paula.mendez')
    const h = await createHandoff(c.ctx, { accountId: c.id, toRole: 'am', toUserId: paula.user.id, dueOn: addDays(today, 1) })
    await ackHandoff(paula, h, { accept: true, note: 'La recibo con pendientes' })
    const after = (await getAccountCare(c.ctx, c.id))!
    expect(after.care).toMatchObject({ care_owner_id: paula.user.id, care_role: 'am' })
    expect(after.account.owner_id).toBe(c.ctx.user.id) // la comisión de origen sigue con ventas
  })
})

describe('CS-08 · comentarios de producto desde campo', () => {
  it('siempre con tema de la lista; quedan en el hilo, los responde quien lidera el mercado y se cuentan por tema y mercado', async () => {
    const a = await store('active')
    const ana = await ctxFor('ana.robles')
    await expect(addFeedback(a.ctx, { accountId: a.id, topic: 'cualquier_cosa', kind: 'friction', note: 'Texto libre sin tema' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addFeedback(a.ctx, { accountId: a.id, topic: '', kind: 'friction', note: 'Sin tema' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addFeedback(await ctxFor('luis.tovar'), { accountId: a.id, topic: 'app', kind: 'friction' })).rejects.toMatchObject({ code: 'forbidden' })
    const before = (await getCareBoard(ana, 'MX')).byTopic.find((t) => t.topic === 'app')?.n ?? 0
    const id = await addFeedback(a.ctx, { accountId: a.id, topic: 'app', kind: 'friction', note: 'La app se cierra al cobrar un servicio' })
    await addFeedback(a.ctx, { accountId: a.id, topic: 'app', kind: 'request', note: 'Pide ver su corte del día' })
    await addFeedback(a.ctx, { accountId: a.id, topic: 'missing_product', kind: 'request' })
    expect((await one(admin<{ subject: string }[]>`select subject from crm.activities where account_id = ${a.id} and kind = 'note' order by created_at limit 1`)).subject).toBe('Comentario de producto: App o plataforma')
    const board = await getCareBoard(ana, 'MX')
    expect(board.byTopic.find((t) => t.topic === 'app')).toMatchObject({ n: before + 2 })
    expect(board.topics.length).toBeLessThanOrEqual(8) // taxonomía corta
    // responder: quien lidera el mercado; "no se hará" pide por qué
    await expect(setFeedbackStatus(a.ctx, id, 'planned', '')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setFeedbackStatus(ana, id, 'declined', '')).rejects.toMatchObject({ code: 'invalid' })
    await setFeedbackStatus(ana, id, 'planned', 'Entra en la versión de diciembre')
    expect((await getAccountCare(a.ctx, a.id))!.feedback.find((f) => f.id === id)).toMatchObject({ status: 'planned', response: 'Entra en la versión de diciembre' })
    // resumen semanal para Producto y Tecnología: conteo por tema y mercado de la semana que terminó; correrlo dos veces no duplica
    await admin`update crm.product_feedback set created_at = date_trunc('week', now()) - interval '3 days' where account_id = ${a.id}`
    const sys = await systemContext()
    const d1 = await withUser(sys.user.id, (tx) => feedbackDigest(tx))
    await withUser(sys.user.id, (tx) => feedbackDigest(tx))
    expect(d1.done).toBeGreaterThanOrEqual(3)
    const dg = await admin<{ total: number; counts: { market: string; topic: string; kind: string; count: number }[] }[]>`select total, counts from crm.feedback_digests`
    expect(dg).toHaveLength(1)
    expect(dg[0]!.counts.find((c) => c.market === 'MX' && c.topic === 'app' && c.kind === 'friction')!.count).toBeGreaterThanOrEqual(1)
    // una vendedora de otro mercado no ve estos comentarios
    expect((await asPersona('jade.kim', (tx) => tx`select 1 from crm.product_feedback where account_id = ${a.id}`)).length).toBe(0)
  })
})

