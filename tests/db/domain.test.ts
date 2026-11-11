import { afterAll, describe, expect, it } from 'vitest'
import { ctxFor, owner, personaId, systemContext } from './helpers'
import { convertLead, createLead, intakeFromForm, qualifyLead } from '@/domain/leads'
import { createDeal, moveDeal, updateDeal } from '@/domain/deals'
import { createAccount, mergeAccounts, reassignAccounts } from '@/domain/accounts'
import { ingestMetricsFile, ingestSalesAppEvent } from '@/domain/integrations'
import { evaluateRules } from '@/domain/rules'
import { withUser } from '@/server/db'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const phone = () => `55 6${Math.floor(1000000 + Math.random() * 8999999)}`

describe('leads (LEAD-01, LEAD-03, REL-07)', () => {
  it('un lead no se convierte sin calificar; al convertir nace cuenta, contacto, atribución, deal y tarea', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Tienda Dominio ${tag()}`, contactName: 'Rosa Luna', phone: phone() })
    await expect(convertLead(marco, id)).rejects.toMatchObject({ code: 'invalid' })
    await qualifyLead(marco, id)
    const out = await convertLead(marco, id)
    const acc = await one(admin`select lifecycle, owner_id, segment from crm.accounts where id = ${out.accountId}`)
    expect(acc).toMatchObject({ lifecycle: 'prospect', owner_id: marco.user.id, segment: 'd2d' })
    const layers = await admin`select layer from crm.account_attributions where account_id = ${out.accountId} order by layer`
    expect(layers.map((l) => l.layer)).toEqual(['channel', 'origin', 'owner'])
    const deal = await one(admin`select next_step, next_step_due, status from crm.deals where id = ${out.dealId}`)
    expect(deal.next_step).toBeTruthy()
    expect(deal.next_step_due).toBeTruthy()
    expect((await admin`select 1 from crm.activities where deal_id = ${out.dealId} and kind = 'task' and done_at is null`).length).toBe(1)
    expect((await admin`select 1 from crm.outbox_events where aggregate_id = ${id} and event_type = 'lead.converted'`).length).toBe(1)
    await expect(convertLead(marco, id)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('el formulario web reparte por turno y es idempotente', async () => {
    const sys = await systemContext()
    const owners: string[] = []
    for (let i = 0; i < 4; i++) {
      const out = await intakeFromForm(sys, 'contacto-mx', { business_name: `Cadena Web ${tag()}`, contact_name: 'Ana Web', phone: phone() }, `t-${tag()}`)
      owners.push((await one(admin`select owner_id from crm.leads where id = ${out.leadId}`)).owner_id)
    }
    expect(new Set(owners).size).toBe(2)
    expect(owners[0]).toBe(owners[2])
    expect(owners[1]).toBe(owners[3])
    expect(owners[0]).not.toBe(owners[1])

    const key = `t-${tag()}`
    const body = { business_name: `Cadena Repetida ${tag()}`, contact_name: 'Ana Web', phone: phone() }
    const first = await intakeFromForm(sys, 'contacto-mx', body, key)
    const second = await intakeFromForm(sys, 'contacto-mx', body, key)
    expect(second).toEqual({ leadId: first.leadId, duplicate: true })
    expect((await admin`select 1 from crm.leads where business_name = ${body.business_name}`).length).toBe(1)
  })

  it('el formulario rechaza bots (campo trampa) y formularios apagados', async () => {
    const sys = await systemContext()
    await expect(intakeFromForm(sys, 'contacto-mx', { business_name: 'Bot SA', contact_name: 'Bot', phone: phone(), website: 'http://spam' }, `t-${tag()}`)).rejects.toMatchObject({ code: 'invalid' })
    await expect(intakeFromForm(sys, 'no-existe', { business_name: 'Algo', contact_name: 'Alguien', phone: phone() }, `t-${tag()}`)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('un vendedor de otro mercado no captura leads aquí', async () => {
    const sam = await ctxFor('sam.ortiz')
    await expect(createLead(sam, { market: 'MX', motor: 'd2d', businessName: 'Fuera de mercado', contactName: 'X Y', phone: phone() })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('embudo (PIPE-01, PIPE-04, PIPE-06, ACT-02)', () => {
  async function freshDeal() {
    const diana = await ctxFor('diana.cruz')
    const acc = await createAccount(diana, { market: 'MX', kind: 'chain', name: `Cadena Dominio ${tag()}`, segment: 'b2b' })
    const pipe = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'b2b'`)
    const dealId = await createDeal(diana, { accountId: acc.id!, pipelineId: pipe.id, title: 'Deal de prueba', nextStep: 'Llamar', nextStepDue: '2030-01-10' })
    const stages = await admin<{ id: string; code: string }[]>`select id, code from crm.stages where pipeline_id = ${pipe.id} order by position`
    const stage = (code: string) => stages.find((s) => s.code === code)!.id
    return { diana, dealId, accountId: acc.id!, stage }
  }

  it('nadie gana un deal a mano: ni ventas ni administración', async () => {
    const { diana, dealId, stage } = await freshDeal()
    await expect(moveDeal(diana, dealId, stage('ganada'))).rejects.toMatchObject({ code: 'won_by_transaction' })
    await expect(moveDeal(await ctxFor('nora.salas'), dealId, stage('ganada'))).rejects.toMatchObject({ code: 'won_by_transaction' })
    expect((await one(admin`select status from crm.deals where id = ${dealId}`)).status).toBe('open')
  })

  it('la etapa exige sus campos y perder exige motivo codificado', async () => {
    const { diana, dealId, stage } = await freshDeal()
    await expect(moveDeal(diana, dealId, stage('propuesta'))).rejects.toMatchObject({ code: 'stage_gate' })
    await updateDeal(diana, dealId, { amount: 1500.5 })
    expect(Number((await one(admin`select amount_minor from crm.deals where id = ${dealId}`)).amount_minor)).toBe(150050)
    await moveDeal(diana, dealId, stage('propuesta'))
    await expect(moveDeal(diana, dealId, stage('negociacion'))).rejects.toMatchObject({ code: 'stage_gate' })
    await expect(moveDeal(diana, dealId, stage('perdida'))).rejects.toMatchObject({ code: 'invalid' })
    await expect(moveDeal(diana, dealId, stage('perdida'), { reasonCode: 'owner_absent' })).rejects.toMatchObject({ code: 'invalid' })
    await moveDeal(diana, dealId, stage('perdida'), { reasonCode: 'price', note: 'Pidió más comisión' })
    const d = await one(admin`select status, loss_reason_code, closed_by from crm.deals where id = ${dealId}`)
    expect(d).toMatchObject({ status: 'lost', loss_reason_code: 'price', closed_by: 'manual' })
    await expect(updateDeal(diana, dealId, { nextStep: 'x', nextStepDue: '2030-01-01' })).rejects.toMatchObject({ code: 'invalid' })
    expect((await admin`select 1 from crm.deal_stage_events where deal_id = ${dealId}`).length).toBe(3)
  })

  it('un próximo paso sin fecha no se guarda, y el decisor tiene que ser contacto del comercio', async () => {
    const { diana, dealId } = await freshDeal()
    await expect(updateDeal(diana, dealId, { nextStep: 'Llamar', nextStepDue: '' })).rejects.toMatchObject({ code: 'invalid' })
    const stranger = await one(admin<{ id: string }[]>`select id from crm.contacts limit 1`)
    await expect(updateDeal(diana, dealId, { decisionMakerId: stranger.id, decisionMakerMet: true })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('la primera transacción gana el deal con la fecha de la transacción, una sola vez', async () => {
    const sys = await systemContext()
    const { diana, dealId, accountId } = await freshDeal()
    const ref = `MID-T${tag()}`
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${accountId}, 'MX', 's5', ${ref})`
    const first = '2026-11-03T15:00:00+00:00'
    const file = { as_of: '2026-11-04', file_name: `t-${tag()}.json`, mode: 'delta', rows: [{ merchant_ref: ref, first_txn_at: first, last_txn_at: first, txn_count_30d: 3, volume_minor_30d: 90000, currency: 'MXN', active_days_30d: 2 }, { merchant_ref: 'MID-NO-EXISTE', txn_count_30d: 1, volume_minor_30d: 1, currency: 'MXN', active_days_30d: 1 }] }
    const out = await ingestMetricsFile(sys, file)
    expect(out).toMatchObject({ status: 'loaded', rows: 2, matched: 1, unmatched: 1, dealsWon: 1 })
    const d = await one(admin`select status, closed_by, won_at from crm.deals where id = ${dealId}`)
    expect(d.status).toBe('won')
    expect(d.closed_by).toBe('transaction')
    expect(new Date(d.won_at).toISOString()).toBe(new Date(first).toISOString())
    expect((await one(admin`select lifecycle from crm.accounts where id = ${accountId}`)).lifecycle).toBe('active')
    const handoff = await one(admin`select owner_id from crm.activities where deal_id = ${dealId} and kind = 'handoff'`)
    expect(handoff.owner_id).toBe(await personaId('valeria.soto'))
    expect((await admin`select 1 from crm.deal_stage_events where deal_id = ${dealId} and cause = 'transaction'`).length).toBe(1)
    expect((await admin`select 1 from crm.outbox_events where aggregate_id = ${dealId} and event_type = 'deal.won'`).length).toBe(1)

    expect(await ingestMetricsFile(sys, file)).toMatchObject({ status: 'duplicate', dealsWon: 0 })
    expect((await admin`select 1 from crm.activities where deal_id = ${dealId} and kind = 'handoff'`).length).toBe(1)
    await expect(moveDeal(diana, dealId, (await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${dealId}`)).stage_id)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('un archivo completo que cambia más de 20% de tamaño queda en cuarentena y no aplica nada (REL-10)', async () => {
    const sys = await systemContext()
    const row = { merchant_ref: `MID-Q${tag()}`, txn_count_30d: 1, volume_minor_30d: 100, currency: 'MXN', active_days_30d: 1 }
    await expect(ingestMetricsFile(sys, { as_of: '2026-11-05', file_name: `q-${tag()}.json`, rows: [row] })).rejects.toMatchObject({ code: 'quarantined' })
    expect((await admin`select 1 from crm.ingest_batches where status = 'rejected' and reject_reason = 'row_delta'`).length).toBeGreaterThan(0)
    expect((await admin`select 1 from crm.merchant_metrics_daily where as_of = '2026-11-05'`).length).toBe(0)
    await expect(ingestMetricsFile(sys, { as_of: '2026-11-05', file_name: 'dup.json', mode: 'delta', rows: [row, row] })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('el archivo de S5 con formato inválido se rechaza completo', async () => {
    const sys = await systemContext()
    await expect(ingestMetricsFile(sys, { as_of: '04/11/2026', file_name: 'x.json', rows: [] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(ingestMetricsFile(sys, { as_of: '2026-11-04', file_name: 'x.json', rows: [{ merchant_ref: 'A', txn_count_30d: -1, volume_minor_30d: 0, currency: 'MXN', active_days_30d: 0 }] })).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('Sales App (CAMPO-01, PIPE-05)', () => {
  const visit = (customer: string, over: Record<string, unknown> = {}) => ({
    event_id: `ev-${tag()}${tag()}`, type: 'visit.checked_out', version: 1, occurred_at: '2026-11-10T18:00:00Z',
    data: { visit_id: `v-${tag()}${tag()}`, customer_id: customer, salesperson_id: 'SC-U-9', business_date: '2026-11-10', checked_in_at: '2026-11-10T17:45:00Z',
      checked_out_at: '2026-11-10T18:00:00Z', duration_seconds: 900, sale: false, rejection_reason: 'owner_absent', revisit: true, revisit_reason: 'owner_absent', decision_maker_present: false, auto_closed: false, ...over },
  })

  it('la revisita queda en el deal, la visita con decisor la limpia, y repetir el evento no duplica', async () => {
    const sys = await systemContext()
    const row = await one(admin<{ id: string; account_id: string; external_id: string }[]>`
      select d.id, d.account_id, al.external_id from crm.deals d join crm.account_aliases al on al.account_id = d.account_id and al.system = 'sales_core'
       where d.status = 'open' and not d.revisit_needed limit 1`)
    const ev = visit(row.external_id)
    expect(await ingestSalesAppEvent(sys, ev)).toMatchObject({ status: 'processed', accountId: row.account_id })
    const d1 = await one(admin`select revisit_needed, revisit_due::text from crm.deals where id = ${row.id}`)
    expect(d1).toMatchObject({ revisit_needed: true, revisit_due: '2026-11-12' })
    expect(await ingestSalesAppEvent(sys, ev)).toMatchObject({ status: 'duplicate' })
    expect((await admin`select 1 from crm.visits where external_visit_id = ${ev.data.visit_id}`).length).toBe(1)
    await ingestSalesAppEvent(sys, visit(row.external_id, { sale: true, rejection_reason: null, revisit: false, revisit_reason: null, decision_maker_present: true }))
    expect((await one(admin`select revisit_needed from crm.deals where id = ${row.id}`)).revisit_needed).toBe(false)
  })

  it('un evento fuera de contrato se rechaza y uno con cliente desconocido abre una excepción', async () => {
    const sys = await systemContext()
    await expect(ingestSalesAppEvent(sys, { ...visit('X'), version: 2 })).rejects.toMatchObject({ code: 'invalid' })
    await expect(ingestSalesAppEvent(sys, { type: 'visit.deleted' })).rejects.toMatchObject({ code: 'invalid' })
    const ev = visit(`SC-ZZ-${tag()}`)
    expect(await ingestSalesAppEvent(sys, ev)).toMatchObject({ status: 'unmatched' })
    expect((await admin`select 1 from crm.exceptions where dedupe_key = ${'unmatched:' + ev.event_id} and resolved_at is null`).length).toBe(1)
  })

  it('un PDV nuevo se liga al prospecto que ya existía con ese teléfono: un solo creador, cero duplicados', async () => {
    const sys = await systemContext()
    const marco = await ctxFor('marco.pena')
    const tel = phone()
    const acc = await createAccount(marco, { market: 'MX', kind: 'store', name: `Prospecto Previo ${tag()}`, segment: 'd2d', phone: tel })
    const customer = `SC-MX-T${tag()}`
    const ev = { event_id: `ev-${tag()}${tag()}`, type: 'store.created', version: 1, occurred_at: '2026-11-10T18:00:00Z', data: { customer_id: customer, market: 'MX', name: 'Nombre distinto en la app', phone: tel } }
    expect(await ingestSalesAppEvent(sys, ev)).toMatchObject({ status: 'processed', accountId: acc.id })
    expect((await one(admin`select lifecycle from crm.accounts where id = ${acc.id!}`)).lifecycle).toBe('onboarding')
    expect((await admin`select 1 from crm.outbox_events where event_type = 'account.alias_issued' and aggregate_id = ${acc.id!}`).length).toBe(1)
    const again = { ...ev, event_id: `ev-${tag()}${tag()}` }
    expect(await ingestSalesAppEvent(sys, again)).toMatchObject({ status: 'processed', accountId: acc.id })
    expect((await admin`select 1 from crm.account_aliases where external_id = ${customer}`).length).toBe(1)
  })
})

describe('cuentas (DAT-04, CAMPO-03, CANAL-03)', () => {
  it('crear avisa del duplicado por teléfono en todo el mercado, aunque el otro comercio no sea visible', async () => {
    const lucia = await ctxFor('lucia.vega')
    const marco = await ctxFor('marco.pena')
    const tel = phone()
    const a = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Miscelánea Única ${tag()}`, segment: 'd2d', phone: tel })
    const dup = await createAccount(marco, { market: 'MX', kind: 'store', name: 'Otro nombre', segment: 'd2d', phone: tel })
    expect(dup.id).toBeUndefined()
    expect(dup.duplicates?.[0]).toMatchObject({ id: a.id, match: 'phone', owner_name: 'Lucía Vega' })
    const forced = await createAccount(marco, { market: 'MX', kind: 'store', name: 'Otro nombre', segment: 'd2d', phone: tel, force: true })
    expect(forced.id).toBeTruthy()
  })

  it('reasignar mueve deals y tareas abiertas y fecha la atribución; un vendedor no puede', async () => {
    const marco = await ctxFor('marco.pena')
    const fernando = await ctxFor('fernando.ibarra')
    const lucia = await personaId('lucia.vega')
    const row = await one(admin<{ account_id: string; id: string }[]>`select d.account_id, d.id from crm.deals d where d.owner_id = ${marco.user.id} and d.status = 'open' limit 1`)
    await expect(reassignAccounts(marco, [row.account_id], lucia)).rejects.toMatchObject({ code: 'forbidden' })
    expect(await reassignAccounts(fernando, [row.account_id], lucia)).toBe(1)
    expect((await one(admin`select owner_id from crm.deals where id = ${row.id}`)).owner_id).toBe(lucia)
    const attr = await admin`select party_ref, effective_to from crm.account_attributions where account_id = ${row.account_id} and layer = 'owner' order by effective_from`
    expect(attr.length).toBe(2)
    expect(attr[0]!.effective_to).not.toBeNull()
    expect(attr[1]).toMatchObject({ party_ref: lucia, effective_to: null })
    await expect(reassignAccounts(fernando, [row.account_id], await personaId('sam.ortiz'))).rejects.toMatchObject({ code: 'invalid' })
    expect(await reassignAccounts(fernando, [row.account_id], lucia)).toBe(0)
  })

  it('fusionar es solo de administración y archiva en vez de borrar', async () => {
    const nora = await ctxFor('nora.salas')
    const ana = await ctxFor('ana.robles')
    const [a, b] = await admin<{ id: string }[]>`select id from crm.accounts where market_code = 'MX' and kind = 'store' and lifecycle = 'prospect' and parent_id is null and archived_at is null order by created_at limit 2`
    await expect(mergeAccounts(ana, b!.id, a!.id)).rejects.toMatchObject({ code: 'forbidden' })
    const before = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts`)
    await mergeAccounts(nora, b!.id, a!.id)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts`)).n).toBe(before.n)
    expect(await one(admin`select merged_into, archived_at is not null as archived from crm.accounts where id = ${b!.id}`)).toMatchObject({ merged_into: a!.id, archived: true })
    expect((await admin`select 1 from crm.deals where account_id = ${b!.id}`).length).toBe(0)
  })
})

describe('reglas (CAMPO-04, CS-03)', () => {
  it('abren la excepción cuando existe el problema y la cierran solas cuando se corrige', async () => {
    const sys = await systemContext()
    const diana = await ctxFor('diana.cruz')
    const acc = await createAccount(diana, { market: 'MX', kind: 'chain', name: `Cadena Reglas ${tag()}`, segment: 'b2b' })
    const pipe = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'b2b'`)
    const dealId = await createDeal(diana, { accountId: acc.id!, pipelineId: pipe.id, title: 'Deal reglas', nextStep: 'Llamar', nextStepDue: '2030-01-10' })
    await admin`update crm.deals set next_step = null, next_step_due = null, stage_entered_at = now() - interval '40 days' where id = ${dealId}`
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    const open = await admin`select kind from crm.exceptions where deal_id = ${dealId} and resolved_at is null order by kind`
    expect(open.map((e) => e.kind)).toEqual(['no_next_step', 'stalled_deal'])
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    expect((await admin`select 1 from crm.exceptions where deal_id = ${dealId} and resolved_at is null`).length).toBe(2)
    await updateDeal(diana, dealId, { nextStep: 'Visitar', nextStepDue: '2030-02-01' })
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    const after = await admin`select kind, resolution from crm.exceptions where deal_id = ${dealId} order by kind`
    expect(after.find((e) => e.kind === 'no_next_step')).toMatchObject({ resolution: 'auto' })
    expect(after.find((e) => e.kind === 'stalled_deal')!.resolution).toBeNull()
  })
})
