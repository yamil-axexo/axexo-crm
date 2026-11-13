import { afterAll, describe, expect, it } from 'vitest'
import { ctxFor, owner, personaId, systemContext } from './helpers'
import { convertLead, createLead, intakeFromForm, qualifyLead, disqualifyLead } from '@/domain/leads'
import { createDeal, moveDeal, updateDeal } from '@/domain/deals'
import { createAccount } from '@/domain/accounts'
import { ingestMetricsFile, ingestSalesAppEvent } from '@/domain/integrations'
import { withUser } from '@/server/db'
import { recordStageGaps, setStageCondition } from '@/domain/embudo/stage-conditions'
import { correctMilestone } from '@/domain/embudo/closing'
import { changeAssignmentRule, createAssignmentRule, simulateAssignment } from '@/domain/embudo/routing'
import { flushConversions } from '@/domain/embudo/attribution'
import { ensureReferralCode } from '@/domain/embudo/referrals'
import { createLeadLabel, linkLeadToAccount, setLeadLabels } from '@/domain/embudo/lead-links'
import { addTicketRef, setTicketStatus } from '@/domain/embudo/tickets'
import { holdForRetry, retryHeldIntake } from '@/domain/embudo/intake-retry'
import { embudoJobs } from '@/server/jobs/embudo'
import { qrMatrix, qrSvg } from '@/lib/qr'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const phone = () => `55 6${Math.floor(1000000 + Math.random() * 8999999)}`

async function freshDeal(motor: 'b2b' | 'd2d' = 'b2b') {
  const diana = await ctxFor('diana.cruz')
  const acc = await createAccount(diana, { market: 'MX', kind: motor === 'b2b' ? 'chain' : 'store', name: `Comercio Embudo ${tag()}`, segment: motor })
  const pipe = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = ${motor}`)
  const dealId = await createDeal(diana, { accountId: acc.id!, pipelineId: pipe.id, title: 'Negocio de prueba', nextStep: 'Llamar', nextStepDue: '2030-01-10' })
  const stages = await admin<{ id: string; code: string }[]>`select id, code from crm.stages where pipeline_id = ${pipe.id} order by position`
  const stage = (code: string) => stages.find((s) => s.code === code)!.id
  return { diana, dealId, accountId: acc.id!, stage, pipelineId: pipe.id }
}
const alias = async (accountId: string) => {
  const ref = `MID-E${tag()}${tag()}`
  await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${accountId}, 'MX', 's5', ${ref})`
  return ref
}
const row = (ref: string, over: Record<string, unknown> = {}) => ({ merchant_ref: ref, txn_count_30d: 0, volume_minor_30d: 0, currency: 'MXN', active_days_30d: 0, ...over })
const file = (asOf: string, rows: unknown[], over: Record<string, unknown> = {}) => ({ as_of: asOf, file_name: `e-${tag()}.json`, mode: 'delta', rows, ...over })

describe('PIPE-01: los requisitos de etapa también los impone la base', () => {
  it('una escritura directa que se salta el dominio no deja al negocio en una etapa sin lo que pide', async () => {
    const { diana, dealId, stage } = await freshDeal()
    // Propuesta pide monto. El dominio lo rechaza con su mensaje; la base rechaza a quien no pase por el dominio.
    await expect(moveDeal(diana, dealId, stage('propuesta'))).rejects.toMatchObject({ code: 'stage_gate' })
    await expect(withUser(diana.user.id, (tx) => tx`update crm.deals set stage_id = ${stage('propuesta')} where id = ${dealId}`)).rejects.toMatchObject({ code: '23514' })
    expect((await one(admin`select stage_id from crm.deals where id = ${dealId}`)).stage_id).toBe(stage('calificacion'))
    // Tampoco se puede dejar un negocio abierto sin próximo paso entrando por la base.
    await admin`update crm.deals set next_step = null, next_step_due = null where id = ${dealId}`
    await updateDeal(diana, dealId, { amount: 900 })
    await expect(withUser(diana.user.id, (tx) => tx`update crm.deals set stage_id = ${stage('propuesta')} where id = ${dealId}`)).rejects.toMatchObject({ code: '23514' })
    // Con lo que pide, pasa.
    await admin`update crm.deals set next_step = 'Llamar', next_step_due = '2030-01-10' where id = ${dealId}`
    await withUser(diana.user.id, (tx) => tx`update crm.deals set stage_id = ${stage('propuesta')} where id = ${dealId}`)
    expect((await one(admin`select stage_id from crm.deals where id = ${dealId}`)).stage_id).toBe(stage('propuesta'))
  })

  it('una carga histórica no se rechaza, pero lo que falta queda anotado y se borra cuando el negocio cumple', async () => {
    const { diana, dealId, stage } = await freshDeal()
    await withUser(diana.user.id, async (tx) => {
      await recordStageGaps(tx)
      await tx`update crm.deals set stage_id = ${stage('negociacion')} where id = ${dealId}`
    })
    const gap = await one(admin<{ missing: string[]; source: string }[]>`select missing, source from crm.deal_stage_gaps where deal_id = ${dealId}`)
    expect(gap.missing.sort()).toEqual(['amount', 'decision_maker'])
    // La marca solo vale dentro de esa transacción: la siguiente escritura vuelve a estar bajo el candado.
    await expect(withUser(diana.user.id, (tx) => tx`update crm.deals set stage_id = ${stage('integracion')} where id = ${dealId}`)).rejects.toMatchObject({ code: '23514' })
    await withUser(diana.user.id, (tx) => tx`update crm.deals set stage_id = ${stage('calificacion')} where id = ${dealId}`)
    expect((await admin`select 1 from crm.deal_stage_gaps where deal_id = ${dealId}`).length).toBe(0)
  })

  it('un requisito con condición solo se exige cuando aplica (variante por mercado, tipo de cuenta o monto), en el dominio y en la base', async () => {
    const { diana, dealId, stage } = await freshDeal()
    const nora = await ctxFor('nora.salas')
    await expect(setStageCondition(diana, stage('propuesta'), { token: 'amount', markets: [], accountTypes: ['store'], minAmount: null })).rejects.toMatchObject({ code: 'forbidden' })
    try {
      // El monto en Propuesta se pide solo a tiendas: esta cuenta es una cadena, así que pasa sin monto.
      await setStageCondition(nora, stage('propuesta'), { token: 'amount', markets: [], accountTypes: ['store'], minAmount: null })
      await moveDeal(diana, dealId, stage('propuesta'))
      expect((await one(admin`select stage_id from crm.deals where id = ${dealId}`)).stage_id).toBe(stage('propuesta'))
      // Y si la condición es de otro mercado, tampoco aplica aquí; si es de este, sí.
      await moveDeal(diana, dealId, stage('calificacion'))
      await setStageCondition(nora, stage('propuesta'), { token: 'amount', markets: ['MX'], accountTypes: [], minAmount: null })
      await expect(moveDeal(diana, dealId, stage('propuesta'))).rejects.toMatchObject({ code: 'stage_gate' })
      await expect(withUser(diana.user.id, (tx) => tx`update crm.deals set stage_id = ${stage('propuesta')} where id = ${dealId}`)).rejects.toMatchObject({ code: '23514' })
      expect((await admin`select 1 from crm.audit_events where action = 'stage.condition_set' and object_id = ${stage('propuesta')}`).length).toBe(2)
    } finally {
      await setStageCondition(nora, stage('propuesta'), { token: 'amount', markets: [], accountTypes: [], minAmount: null })
    }
    expect((await one(admin<{ conditions: object }[]>`select conditions from crm.stages where id = ${stage('propuesta')}`)).conditions).toEqual({})
  })
})

describe('PIPE-06: cierre por evento transaccional', () => {
  it('el primer fondeo (con su método) pasa el negocio a esperar la primera venta; la primera transacción lo gana; el hábito queda aparte', async () => {
    const sys = await systemContext()
    const { dealId, accountId, stage } = await freshDeal('d2d')
    const ref = await alias(accountId)
    const funded = '2026-11-02T16:00:00+00:00'
    const a = await ingestMetricsFile(sys, file('2026-11-03', [row(ref, { first_funding_at: funded, funding_method: 'spei' })], { manifest: { row_count: 1 } }))
    expect(a).toMatchObject({ status: 'loaded', dealsWon: 0, funded: 1 })
    expect(await one(admin`select status, stage_id from crm.deals where id = ${dealId}`)).toMatchObject({ status: 'open', stage_id: stage('espera') })
    const ms = await one(admin`select first_funding_at, funding_method, first_txn_at, habit_at from crm.account_milestones where account_id = ${accountId}`)
    expect(ms).toMatchObject({ funding_method: 'spei', first_txn_at: null, habit_at: null })
    expect(new Date(ms.first_funding_at).toISOString()).toBe(new Date(funded).toISOString())
    expect((await admin`select 1 from crm.audit_events where action = 'deal.funded' and object_id = ${dealId}`).length).toBe(1)

    const first = '2026-11-04T15:00:00+00:00'
    const b = await ingestMetricsFile(sys, file('2026-11-05', [row(ref, { first_txn_at: first, last_txn_at: first, txn_count_30d: 2, volume_minor_30d: 5000, active_days_30d: 1, first_funding_at: '2026-11-04T00:00:00+00:00', funding_method: 'cash' })]))
    expect(b).toMatchObject({ dealsWon: 1, funded: 0 })
    // El fondeo ya puesto no se pisa con el del archivo siguiente.
    expect(await one(admin`select funding_method from crm.account_milestones where account_id = ${accountId}`)).toMatchObject({ funding_method: 'spei' })
    const c = await ingestMetricsFile(sys, file('2026-11-20', [row(ref, { first_txn_at: first, last_txn_at: first, txn_count_30d: 30, volume_minor_30d: 90000, active_days_30d: 12, habit_at: '2026-11-19T00:00:00+00:00' })]))
    expect(c.status).toBe('loaded')
    const after = await one(admin`select habit_at, first_txn_at from crm.account_milestones where account_id = ${accountId}`)
    expect(after.habit_at).toBeTruthy()
    const kinds = await admin<{ kind: string; action: string }[]>`select kind, action from crm.milestone_events where account_id = ${accountId} order by created_at, kind`
    expect(kinds.map((k) => `${k.kind}:${k.action}`).sort()).toEqual(['first_funding:set', 'first_txn:set', 'habit:set'])
  })

  it('un manifiesto que no cuadra rechaza el archivo completo, y un corte recargado con otras cifras deja el antes y el después', async () => {
    const sys = await systemContext()
    const { accountId } = await freshDeal('d2d')
    const ref = await alias(accountId)
    await expect(ingestMetricsFile(sys, file('2026-10-01', [row(ref)], { manifest: { row_count: 2 } }))).rejects.toMatchObject({ code: 'manifest_mismatch' })
    expect((await admin`select 1 from crm.ingest_batches where reject_reason = 'manifest_mismatch'`).length).toBe(1)
    expect((await admin`select 1 from crm.merchant_metrics_daily where account_id = ${accountId}`).length).toBe(0)
    await ingestMetricsFile(sys, file('2026-10-02', [row(ref, { txn_count_30d: 5, volume_minor_30d: 1000, active_days_30d: 3 })]))
    const again = await ingestMetricsFile(sys, file('2026-10-02', [row(ref, { txn_count_30d: 7, volume_minor_30d: 1400, active_days_30d: 3 })]))
    expect(again.restatedRows).toBe(1)
    const r = await one(admin<{ before: { txn_count_30d: number }; after: { txn_count_30d: number } }[]>`select before, after from crm.metric_restatements where account_id = ${accountId}`)
    expect([r.before.txn_count_30d, r.after.txn_count_30d]).toEqual([5, 7])
  })

  it('un ganado que resultó no serlo se corrige con un evento: el negocio vuelve a abrirse y nada se edita en silencio', async () => {
    const sys = await systemContext()
    const { diana, dealId, accountId } = await freshDeal('d2d')
    const ref = await alias(accountId)
    const first = '2026-11-06T15:00:00+00:00'
    await ingestMetricsFile(sys, file('2026-11-07', [row(ref, { first_txn_at: first, last_txn_at: first, txn_count_30d: 1, volume_minor_30d: 100, active_days_30d: 1 })]))
    const won = await one(admin`select status, stage_id from crm.deals where id = ${dealId}`)
    expect(won.status).toBe('won')
    // Quien vende no corrige; quien lidera el mercado sí, con motivo.
    await expect(correctMilestone(diana, accountId, { kind: 'first_txn', action: 'void', reason: 'La transacción era de prueba' })).rejects.toMatchObject({ code: 'forbidden' })
    const ana = await ctxFor('ana.robles')
    await expect(correctMilestone(ana, accountId, { kind: 'first_txn', action: 'void', reason: 'no' })).rejects.toMatchObject({ code: 'invalid' })
    await correctMilestone(ana, accountId, { kind: 'first_txn', action: 'void', reason: 'La transacción era de prueba' })
    const d = await one(admin`select status, won_at, closed_by, next_step, stage_id from crm.deals where id = ${dealId}`)
    expect(d).toMatchObject({ status: 'open', won_at: null, closed_by: null })
    expect(d.next_step).toContain('primera venta se corrigió')
    expect(d.stage_id).not.toBe(won.stage_id)
    expect((await admin`select 1 from crm.deal_stage_events where deal_id = ${dealId} and cause = 'correction'`).length).toBe(1)
    const ev = await one(admin`select action, previous_at, reason, source from crm.milestone_events where account_id = ${accountId} and action = 'void'`)
    expect(ev).toMatchObject({ action: 'void', source: 'user', reason: 'La transacción era de prueba' })
    expect(new Date(ev.previous_at).toISOString()).toBe(new Date(first).toISOString())
    expect((await one(admin`select lifecycle from crm.accounts where id = ${accountId}`)).lifecycle).toBe('onboarding')
    expect((await admin`select 1 from crm.audit_events where action = 'deal.win_corrected' and object_id = ${dealId}`).length).toBe(1)
    expect((await admin`select 1 from crm.activities where deal_id = ${dealId} and deal_step = 'sales' and done_at is null`).length).toBe(1)
    // Repetir la corrección no hace nada; y la historia de hitos no se puede editar ni borrar desde la aplicación.
    await expect(correctMilestone(ana, accountId, { kind: 'first_txn', action: 'void', reason: 'La transacción era de prueba' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(withUser(ana.user.id, (tx) => tx`update crm.milestone_events set reason = 'otra' where account_id = ${accountId}`)).rejects.toMatchObject({ code: '42501' })
    await expect(withUser(ana.user.id, (tx) => tx`delete from crm.milestone_events where account_id = ${accountId}`)).rejects.toMatchObject({ code: '42501' })
  })

  it('la corrección también llega en el archivo: cambia la fecha del ganado dejando la anterior en la historia', async () => {
    const sys = await systemContext()
    const { dealId, accountId } = await freshDeal('d2d')
    const ref = await alias(accountId)
    const first = '2026-11-08T15:00:00+00:00'
    const real = '2026-11-06T10:00:00+00:00'
    await ingestMetricsFile(sys, file('2026-11-09', [row(ref, { first_txn_at: first, txn_count_30d: 1, volume_minor_30d: 100, active_days_30d: 1 })]))
    const out = await ingestMetricsFile(sys, file('2026-11-10', [row(ref, { txn_count_30d: 2, volume_minor_30d: 200, active_days_30d: 2 })],
      { corrections: [{ merchant_ref: ref, kind: 'first_txn', action: 'restate', at: real, reason: 'Fecha corregida por Data y Reportería' }] }))
    expect(out.corrections).toBe(1)
    const d = await one(admin`select status, won_at from crm.deals where id = ${dealId}`)
    expect(d.status).toBe('won')
    expect(new Date(d.won_at).toISOString()).toBe(new Date(real).toISOString())
    const audit = await one(admin<{ before: { won_at: string }; after: { won_at: string } }[]>`select before, after from crm.audit_events where action = 'deal.win_redated' and object_id = ${dealId}`)
    expect(new Date(audit.before.won_at).toISOString()).toBe(new Date(first).toISOString())
  })

  it('la conexión con el archivo de ventas está apagada: la tarea programada no va a ningún lado y lo dice', async () => {
    const job = embudoJobs.find((j) => j.key === 'embudo.sales_file_pull')!
    const out = await withUser((await systemContext()).user.id, (tx) => job.run(tx))
    expect(out).toEqual({ done: 0, note: 'Canal apagado' })
  })
})

describe('PIPE-05 y PIPE-04: revisita y motivos', () => {
  const visit = (customer: string, over: Record<string, unknown> = {}) => ({
    event_id: `ev-${tag()}${tag()}`, type: 'visit.checked_out', version: 1, occurred_at: '2026-11-10T18:00:00Z',
    data: { visit_id: `v-${tag()}${tag()}`, customer_id: customer, salesperson_id: 'SC-U-9', business_date: '2026-11-10', checked_in_at: '2026-11-10T17:45:00Z',
      checked_out_at: '2026-11-10T18:00:00Z', duration_seconds: 900, sale: false, rejection_reason: 'owner_absent', revisit: true, revisit_reason: 'owner_absent', decision_maker_present: false, auto_closed: false, ...over },
  })

  it('la visita sin quien decide deja el contacto con su mejor horario y una tarea de revisita con dueño, sin duplicar', async () => {
    const sys = await systemContext()
    const r = await one(admin<{ id: string; account_id: string; external_id: string; owner_id: string }[]>`
      select d.id, d.account_id, al.external_id, d.owner_id from crm.deals d join crm.account_aliases al on al.account_id = d.account_id and al.system = 'sales_core'
       where d.status = 'open' and not d.revisit_needed and d.owner_id is not null
         and not exists (select 1 from crm.activities x where x.account_id = d.account_id and x.kind = 'visit' and x.done_at is null) limit 1`)
    const ev = visit(r.external_id, { revisit_due: '2026-11-14', decision_maker_contact: { name: 'Julia Paredes', role: 'owner', phone: '55 6123 4567', best_time: 'Martes y jueves por la tarde' } })
    expect(await ingestSalesAppEvent(sys, ev)).toMatchObject({ status: 'processed' })
    const c = await one(admin`select c.full_name, c.phone, c.best_time, ac.role from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id where ac.account_id = ${r.account_id} and c.full_name = 'Julia Paredes'`)
    expect(c).toMatchObject({ role: 'owner', best_time: 'Martes y jueves por la tarde', phone: '+525561234567' })
    const task = await one(admin`select owner_id, kind, done_at, (due_at at time zone 'UTC')::date::text as due from crm.activities where account_id = ${r.account_id} and custom ->> 'revisit_of' = ${ev.data.visit_id}`)
    expect(task).toMatchObject({ owner_id: r.owner_id, kind: 'visit', done_at: null, due: '2026-11-14' })
    expect((await one(admin`select revisit_due::text from crm.deals where id = ${r.id}`)).revisit_due).toBe('2026-11-14')
    // Otra visita igual (otro evento) con la misma persona no la duplica.
    await ingestSalesAppEvent(sys, visit(r.external_id, { decision_maker_contact: { name: 'Julia Paredes', phone: '55 6123 4567' } }))
    expect((await admin`select 1 from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id where ac.account_id = ${r.account_id} and c.full_name = 'Julia Paredes'`).length).toBe(1)
    expect((await admin`select 1 from crm.activities where account_id = ${r.account_id} and kind = 'visit' and done_at is null`).length).toBe(1)
  })

  it('si el comercio no tiene negocio abierto, la revisita no se pierde: queda como tarea de quien lleva el comercio', async () => {
    const sys = await systemContext()
    const r = await one(admin<{ id: string; external_id: string; owner_id: string }[]>`
      select a.id, al.external_id, a.owner_id from crm.accounts a join crm.account_aliases al on al.account_id = a.id and al.system = 'sales_core' and al.valid_to is null
       where a.owner_id is not null and a.archived_at is null and not exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open')
         and not exists (select 1 from crm.activities x where x.account_id = a.id and x.kind = 'visit' and x.done_at is null) limit 1`)
    const ev = visit(r.external_id)
    await ingestSalesAppEvent(sys, ev)
    const task = await one(admin`select owner_id, deal_id from crm.activities where account_id = ${r.id} and custom ->> 'revisit_of' = ${ev.data.visit_id}`)
    expect(task).toMatchObject({ owner_id: r.owner_id, deal_id: null })
  })

  it('un código de motivo desconocido queda contado, el catálogo lleva versión y la base exige el motivo', async () => {
    const sys = await systemContext()
    const acc = await one(admin<{ external_id: string }[]>`select al.external_id from crm.account_aliases al join crm.accounts a on a.id = al.account_id where al.system = 'sales_core' and al.valid_to is null and a.archived_at is null limit 1`)
    const code = `raro_${tag()}`
    await ingestSalesAppEvent(sys, visit(acc.external_id, { rejection_reason: code, revisit: false, revisit_reason: null }))
    await ingestSalesAppEvent(sys, visit(acc.external_id, { rejection_reason: code, revisit: false, revisit_reason: null }))
    expect(await one(admin`select hits, source from crm.unknown_reason_codes where code = ${code}`)).toMatchObject({ hits: 2, source: 'sales_app' })
    const v1 = (await one(admin<{ version: number }[]>`select version from crm.catalog_versions where catalog = 'reason_codes'`)).version
    await admin`update crm.loss_reasons set label_en = label_en where code = 'owner_absent'`
    expect((await one(admin<{ version: number }[]>`select version from crm.catalog_versions where catalog = 'reason_codes'`)).version).toBe(v1 + 1)
    // Sin código no hay visita sin venta ni lead descartado, ni entrando directo por la base.
    const marco = await ctxFor('marco.pena')
    const leadId = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Tienda Motivo ${tag()}`, contactName: 'Rosa Luna', phone: phone() })
    await expect(withUser(marco.user.id, (tx) => tx`update crm.leads set status = 'disqualified' where id = ${leadId}`)).rejects.toMatchObject({ code: '23514' })
    await expect(withUser(marco.user.id, (tx) => tx`insert into crm.activities (market_code, lead_id, kind, subject, done_at, outcome, owner_id, created_by) values ('MX', ${leadId}, 'visit', 'Visita', now(), 'no_sale', ${marco.user.id}, ${marco.user.id})`)).rejects.toMatchObject({ code: '23514' })
    const reason = await one(admin<{ code: string }[]>`select code from crm.loss_reasons where kind = 'lost' and is_active and market_code is null and (motors is null or 'd2d' = any(motors)) limit 1`)
    await disqualifyLead(marco, leadId, reason.code)
  })
})

describe('LEAD-03 y E3.F10: reglas de asignación', () => {
  const lead = async (id: string) => one(admin<{ owner_id: string | null }[]>`select owner_id from crm.leads where id = ${id}`)
  const send = async (sys: Awaited<ReturnType<typeof systemContext>>, slug: string, over: Record<string, unknown> = {}) =>
    (await intakeFromForm(sys, slug, { business_name: `Comercio Ruteo ${tag()}`, contact_name: 'Ana Web', phone: phone(), ...over }, `t-${tag()}${tag()}`)).leadId

  it('la primera regla que coincide decide; el tope salta a la siguiente; el simulador no gasta el turno; todo queda en bitácora', async () => {
    const sys = await systemContext()
    const nora = await ctxFor('nora.salas')
    const marco = await personaId('marco.pena')
    const lucia = await personaId('lucia.vega')
    await expect(createAssignmentRule(await ctxFor('ana.robles'), { market: 'MX', name: 'No puede', action: 'user', userId: marco, match: {} })).rejects.toMatchObject({ code: 'forbidden' })
    const form = await one(admin<{ id: string; routing_rule_id: string }[]>`select id, routing_rule_id from crm.web_forms where slug = 'tiendas-mx'`)
    // Regla 1: lo que entra por el formulario de tiendas con 10 puntos de venta o más va a Marco, hasta que tenga 1 lead abierto más de los que ya lleva.
    const open = (await one(admin<{ n: number }[]>`select app.open_leads_of(${marco}, 'MX') as n`)).n
    const r1 = await createAssignmentRule(nora, { market: 'MX', name: 'Tiendas grandes a Marco', action: 'user', userId: marco, capOpen: open + 1, slaMinutes: 30, match: { formIds: [form.id], sizeMin: 10 } })
    // Regla 2: el resto de ese formulario, a Lucía.
    const r2 = await createAssignmentRule(nora, { market: 'MX', name: 'Tiendas a Lucía', action: 'user', userId: lucia, match: { formIds: [form.id] } })
    try {
      const cursor = (await one(admin<{ cursor: number }[]>`select cursor from crm.routing_rules where id = ${form.routing_rule_id}`)).cursor
      const sim = await simulateAssignment(nora, { market: 'MX', source: 'web_form', motor: 'd2d', formId: form.id, sizeUnits: 12 })
      expect(sim).toMatchObject({ ownerId: marco, by: 'rule', ruleName: 'Tiendas grandes a Marco', slaMinutes: 30 })
      const small = await simulateAssignment(nora, { market: 'MX', source: 'web_form', motor: 'd2d', formId: form.id, sizeUnits: 2 })
      expect(small).toMatchObject({ ownerId: lucia, ruleName: 'Tiendas a Lucía' })
      expect(small.steps[0]).toMatchObject({ rule: 'Tiendas grandes a Marco', outcome: 'no_match' })
      expect((await admin`select 1 from crm.assignment_log`).length).toBe(0)

      const a = await send(sys, 'tiendas-mx', { store_count: '12' })
      expect((await lead(a)).owner_id).toBe(marco)
      // Marco llegó a su tope: el siguiente grande pasa a la regla 2.
      const b = await send(sys, 'tiendas-mx', { store_count: '15' })
      expect((await lead(b)).owner_id).toBe(lucia)
      const log = await one(admin<{ rule_name: string; detail: { steps: { rule: string; outcome: string }[] } }[]>`select rule_name, detail from crm.assignment_log where lead_id = ${b}`)
      expect(log.rule_name).toBe('Tiendas a Lucía')
      expect(log.detail.steps[0]).toMatchObject({ rule: 'Tiendas grandes a Marco', outcome: 'capped' })
      // El turno del formulario no se gastó: ninguna de estas entradas pasó por él.
      expect((await one(admin<{ cursor: number }[]>`select cursor from crm.routing_rules where id = ${form.routing_rule_id}`)).cursor).toBe(cursor)
      // El orden manda: al subir la regla 2, decide ella.
      await changeAssignmentRule(nora, r2, { move: 'up' })
      expect((await simulateAssignment(nora, { market: 'MX', source: 'web_form', motor: 'd2d', formId: form.id, sizeUnits: 12 })).ownerId).toBe(lucia)
      expect((await admin`select 1 from crm.audit_events where action like 'routing.assignment_rule_%' and object_id in (${r1}, ${r2})`).length).toBe(3)
    } finally {
      await changeAssignmentRule(nora, r1, { active: false })
      await changeAssignmentRule(nora, r2, { active: false })
    }
    // Sin reglas activas vuelve a decidir el turno del formulario, como siempre.
    const c = await send(sys, 'tiendas-mx')
    expect((await one(admin<{ action: string }[]>`select action from crm.assignment_log where lead_id = ${c}`)).action).toBe('form_rotation')
  })

  it('el turno rotativo es una regla más, y hereda de quien ya lleva el comercio antes que del turno', async () => {
    const sys = await systemContext()
    const nora = await ctxFor('nora.salas')
    const diana = await ctxFor('diana.cruz')
    const form = await one(admin<{ id: string; routing_rule_id: string }[]>`select id, routing_rule_id from crm.web_forms where slug = 'contacto-mx'`)
    const name = `Cadena Heredada ${tag()}`
    const tel = phone()
    await createAccount(diana, { market: 'MX', kind: 'chain', name, segment: 'b2b', phone: tel })
    const r1 = await createAssignmentRule(nora, { market: 'MX', name: 'Quien ya lleva el comercio', action: 'inherit_account', match: { motors: ['b2b'] } })
    const r2 = await createAssignmentRule(nora, { market: 'MX', name: 'Turno B2B', action: 'rotation', rotationId: form.routing_rule_id, match: { motors: ['b2b'] } })
    try {
      const a = await send(sys, 'contacto-mx', { business_name: name, phone: tel })
      expect((await lead(a)).owner_id).toBe(diana.user.id)
      expect((await one(admin<{ rule_name: string }[]>`select rule_name from crm.assignment_log where lead_id = ${a}`)).rule_name).toBe('Quien ya lleva el comercio')
      const b = await send(sys, 'contacto-mx')
      const c = await send(sys, 'contacto-mx')
      expect((await lead(b)).owner_id).not.toBe((await lead(c)).owner_id)
      expect((await one(admin<{ rule_name: string; detail: { steps: { outcome: string }[] } }[]>`select rule_name, detail from crm.assignment_log where lead_id = ${b}`))).toMatchObject({ rule_name: 'Turno B2B' })
    } finally {
      await changeAssignmentRule(nora, r1, { active: false })
      await changeAssignmentRule(nora, r2, { active: false })
    }
  })

  it('ningún lead entra sin dueño: si el turno se queda sin gente, le toca a quien lidera el mercado', async () => {
    const sys = await systemContext()
    const form = await one(admin<{ routing_rule_id: string }[]>`select routing_rule_id from crm.web_forms where slug = 'tiendas-mx'`)
    const before = await one(admin<{ member_ids: string[]; fallback_id: string | null }[]>`select member_ids, fallback_id from crm.routing_rules where id = ${form.routing_rule_id}`)
    await admin`update crm.routing_rules set member_ids = '{}', fallback_id = null where id = ${form.routing_rule_id}`
    try {
      const a = await send(sys, 'tiendas-mx')
      expect((await lead(a)).owner_id).toBe(await personaId('ana.robles'))
      expect((await one(admin<{ action: string }[]>`select action from crm.assignment_log where lead_id = ${a}`)).action).toBe('market_lead')
    } finally {
      await admin`update crm.routing_rules set member_ids = ${before.member_ids}, fallback_id = ${before.fallback_id} where id = ${form.routing_rule_id}`
    }
  })
})

describe('LEAD-02, LEAD-01, LEAD-05, E3.F3, E3.F8 y ACT-01', () => {
  it('la atribución completa se guarda, el primer toque no se pisa, viaja al negocio al convertir y deja la conversión en cola', async () => {
    const sys = await systemContext()
    const tel = phone()
    const body = { business_name: `Cadena Campaña ${tag()}`, contact_name: 'Ana Web', phone: tel, utm_source: 'tiktok', utm_campaign: 'otoño', ttclid: 'TT-123', li_fat_id: 'LI-9', twclid: 'TW-7',
      landing_page: 'https://axexo.example/landing/tiendas?email=persona@example.com', referrer: 'https://buscador.example/resultados?q=recargas' }
    const first = await intakeFromForm(sys, 'contacto-mx', body, `t-${tag()}${tag()}`)
    const l = await one(admin`select owner_id, ttclid, li_fat_id, twclid, landing_page, referrer, utm_source from crm.leads where id = ${first.leadId}`)
    // De la página se guarda dónde, nunca lo que venía después del signo de pregunta.
    expect(l).toMatchObject({ ttclid: 'TT-123', li_fat_id: 'LI-9', twclid: 'TW-7', landing_page: 'https://axexo.example/landing/tiendas', referrer: 'https://buscador.example/resultados', utm_source: 'tiktok' })
    // Segunda llegada de la misma empresa por otra campaña: último toque; el primero queda intacto.
    const again = await intakeFromForm(sys, 'contacto-mx', { ...body, contact_name: 'Luis Web', utm_source: 'google', gclid: 'G-55', ttclid: '' }, `t-${tag()}${tag()}`)
    expect(again).toMatchObject({ leadId: first.leadId, merged: true })
    const touches = await admin<{ touch: string; utm_source: string; platform: string }[]>`select touch, utm_source, platform from crm.source_touches where lead_id = ${first.leadId} order by created_at`
    expect(touches.map((t) => `${t.touch}:${t.utm_source}:${t.platform}`)).toEqual(['first:tiktok:tiktok', 'last:google:google'])
    expect((await one(admin`select utm_source, ttclid from crm.leads where id = ${first.leadId}`))).toMatchObject({ utm_source: 'tiktok', ttclid: 'TT-123' })
    await expect(withUser(sys.user.id, (tx) => tx`update crm.source_touches set utm_source = 'otro' where lead_id = ${first.leadId}`)).rejects.toMatchObject({ code: '42501' })

    const owner = await (async () => { const u = await one(admin<{ email: string }[]>`select email::text from crm.users where id = ${l.owner_id}`); return ctxFor(u.email.split('@')[0]!) })()
    await qualifyLead(owner, first.leadId)
    const queued = await admin<{ platform: string; event_name: string; status: string }[]>`select platform, event_name, status from crm.conversion_events where lead_id = ${first.leadId} order by platform`
    expect(queued.map((q) => `${q.platform}:${q.event_name}:${q.status}`)).toEqual(['linkedin:qualified_lead:queued', 'tiktok:qualified_lead:queued', 'x:qualified_lead:queued'])
    const out = await convertLead(owner, first.leadId)
    const carried = await admin<{ touch: string; platform: string }[]>`select touch, platform from crm.source_touches where deal_id = ${out.dealId} and account_id = ${out.accountId} order by created_at`
    expect(carried.map((t) => `${t.touch}:${t.platform}`)).toEqual(['first:tiktok', 'last:google'])
    // El envío a las plataformas está apagado: la tarea marca cada conversión como "canal apagado" y no sale nada.
    const flushed = await withUser(sys.user.id, (tx) => flushConversions(tx))
    expect(flushed.done).toBeGreaterThanOrEqual(3)
    expect((await admin`select 1 from crm.conversion_events where lead_id = ${first.leadId} and status = 'channel_off'`).length).toBe(3)
    // La primera transacción deja la conversión "compra" en cola, una sola vez.
    const ref = await alias(out.accountId)
    await admin`update crm.pipelines set close_by_transaction = true where id = (select pipeline_id from crm.deals where id = ${out.dealId})`
    const t0 = '2026-11-11T15:00:00+00:00'
    await ingestMetricsFile(sys, file('2026-11-12', [row(ref, { first_txn_at: t0, txn_count_30d: 1, volume_minor_30d: 100, active_days_30d: 1 })]))
    expect((await admin`select 1 from crm.conversion_events where deal_id = ${out.dealId} and event_name = 'purchase'`).length).toBe(3)
  })

  it('un lead ligado a un comercio existente se convierte dentro de ese comercio, y el comercio conserva la historia', async () => {
    const marco = await ctxFor('marco.pena')
    const acc = await createAccount(marco, { market: 'MX', kind: 'store', name: `Tienda Existente ${tag()}`, segment: 'd2d' })
    const leadId = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Tienda Existente sucursal ${tag()}`, contactName: 'Rosa Luna', phone: phone(), message: 'Quiere abrir otra caja' })
    // Otra persona que vende no ve ese lead (es de Marco): no lo puede ligar.
    await expect(linkLeadToAccount(await ctxFor('lucia.vega'), leadId, acc.id!)).rejects.toMatchObject({ code: 'not_found' })
    await linkLeadToAccount(marco, leadId, acc.id!)
    expect((await one(admin`select account_id, status from crm.leads where id = ${leadId}`))).toMatchObject({ account_id: acc.id, status: 'new' })
    await qualifyLead(marco, leadId)
    const out = await convertLead(marco, leadId)
    expect(out.accountId).toBe(acc.id)
    expect((await admin`select 1 from crm.activities where account_id = ${acc.id!} and lead_id = ${leadId}`).length).toBeGreaterThan(0)
    expect((await admin`select 1 from crm.audit_events where action = 'lead.linked_to_account' and object_id = ${leadId}`).length).toBe(1)
  })

  it('el enlace de referido de un comercio atribuye el lead a ese comercio; el código QR es propio', async () => {
    const sys = await systemContext()
    const marco = await ctxFor('marco.pena')
    const acc = await createAccount(marco, { market: 'MX', kind: 'store', name: `Tienda que Refiere ${tag()}`, segment: 'd2d' })
    const { code, created } = await ensureReferralCode(marco, acc.id!)
    expect(created).toBe(true)
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect((await ensureReferralCode(marco, acc.id!))).toEqual({ code, created: false })
    const target = await withUser(sys.user.id, (tx) => tx<{ slug: string }[]>`select slug from app.referral_public(${code.toLowerCase()})`)
    expect(target[0]!.slug).toBe('tiendas-mx')
    const out = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Tienda Referida ${tag()}`, contact_name: 'Pedro Sol', phone: phone(), ref: code }, `t-${tag()}${tag()}`)
    const l = await one(admin`select referred_by_account_id, labels from crm.leads where id = ${out.leadId}`)
    expect(l.referred_by_account_id).toBe(acc.id)
    expect(l.labels).toContain('referido')
    expect((await admin`select 1 from crm.source_touches where lead_id = ${out.leadId} and referral_account_id = ${acc.id!}`).length).toBe(1)
    // Un código que no existe o de otro mercado no atribuye nada y no tumba el formulario.
    const other = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Tienda Sin Ref ${tag()}`, contact_name: 'Pedro Sol', phone: phone(), ref: 'ZZZZZZZZ' }, `t-${tag()}${tag()}`)
    expect((await one(admin`select referred_by_account_id from crm.leads where id = ${other.leadId}`)).referred_by_account_id).toBeNull()
    const m = qrMatrix(`https://contigo.example/r/${code}`)
    expect(m.length).toBe(29)
    expect(m[0]!.slice(0, 7).every(Boolean)).toBe(true)
    expect(qrSvg(`https://contigo.example/r/${code}`, 'Código de referido')).toContain('<svg')
  })

  it('etiquetas de lead, tickets de soporte como referencia y envíos retenidos que se reintentan solos', async () => {
    const sys = await systemContext()
    const marco = await ctxFor('marco.pena')
    const nora = await ctxFor('nora.salas')
    const leadId = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Tienda Etiquetas ${tag()}`, contactName: 'Rosa Luna', phone: phone() })
    await expect(setLeadLabels(marco, leadId, ['no_existe'])).rejects.toMatchObject({ code: 'invalid' })
    await setLeadLabels(marco, leadId, ['prioridad', 'volver_a_llamar'])
    expect((await one(admin`select labels from crm.leads where id = ${leadId}`)).labels).toEqual(['prioridad', 'volver_a_llamar'])
    await expect(createLeadLabel(marco, { labelEs: 'Cadena grande', labelEn: 'Large chain' })).rejects.toMatchObject({ code: 'forbidden' })
    expect(await createLeadLabel(nora, { labelEs: `Feria ${tag()}`, labelEn: 'Trade show' })).toMatch(/^feria_/)

    const acc = await createAccount(marco, { market: 'MX', kind: 'store', name: `Tienda Ticket ${tag()}`, segment: 'd2d' })
    const t = await addTicketRef(marco, acc.id!, { system: 'zendesk', ref: '#48213', subject: 'No le llegan los comprobantes', status: 'open' })
    await expect(addTicketRef(marco, acc.id!, { system: 'zendesk', ref: '#48213', subject: 'Repetido' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addTicketRef(marco, acc.id!, { system: 'zendesk', ref: 'con espacios', subject: 'Mal' })).rejects.toMatchObject({ code: 'invalid' })
    await setTicketStatus(marco, t, 'solved')
    expect((await one(admin`select status from crm.ticket_refs where id = ${t}`)).status).toBe('solved')

    const key = `form:${tag()}${tag()}`
    const name = `Tienda Retenida ${tag()}`
    await holdForRetry('tiendas-mx', key, { business_name: name, contact_name: 'Pedro Sol', phone: phone(), website: '' }, new Error('boom'))
    await holdForRetry('tiendas-mx', key, { business_name: name, contact_name: 'Pedro Sol' }, new Error('boom'))
    expect((await admin`select 1 from crm.intake_retries where idempotency_key = ${key}`).length).toBe(1)
    const bad = `form:${tag()}${tag()}`
    await holdForRetry('no-existe', bad, { business_name: 'Algo', contact_name: 'Alguien', phone: phone() }, new Error('boom'))
    const out = await withUser(sys.user.id, (tx) => retryHeldIntake(tx))
    expect(out.done).toBeGreaterThanOrEqual(1)
    const held = await one(admin`select status, lead_id from crm.intake_retries where idempotency_key = ${key}`)
    expect(held.status).toBe('done')
    expect((await one(admin`select business_name, owner_id from crm.leads where id = ${held.lead_id}`))).toMatchObject({ business_name: name })
    // Lo que no se arregla reintentando (formulario apagado) queda fallido y a la vista, no en un ciclo sin fin.
    expect((await one(admin`select status, error from crm.intake_retries where idempotency_key = ${bad}`))).toMatchObject({ status: 'failed', error: 'not_found' })
  })
})
