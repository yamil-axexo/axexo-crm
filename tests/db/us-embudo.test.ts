import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId } from './helpers'
import { createDeal, missingForStage, moveDeal, pendingHighlights, updateDeal } from '@/domain/deals'
import { addDealItem, saveOrderDetails, saveVisitReason, setPipelineFlags, takeDeal } from '@/domain/ops'
import { createAccount } from '@/domain/accounts'
import { updateCustom } from '@/domain/custom'
import { updateStage } from '@/domain/admin'
import { createField } from '@/domain/b2b'
import { recordActivity, addActivity } from '@/domain/activities'
import { completeItem } from '@/domain/queue'
import { reassignDeals } from '@/domain/reparto'
import { getDeal } from '@/dal/pipelines'
import { getDealOps, getOpsQueue, gateInfo } from '@/dal/ops'
import { stageFieldMarks } from '@/dal/fields'
import { accountOrders } from '@/dal/order-history'
import { visitReasons } from '@/dal/field'
import { routeStores } from '@/dal/routes'
import { storeProviders } from '@/dal/store-providers'
import { exportVisitDetail, visitDetail } from '@/domain/visit-detail'
import { setOpsCheck } from '@/domain/ops'
import { addDays, isoDay } from '@/lib/format'
import { DOCS, PRESENTED, SALES_QUALIFIED, fillEnrollment } from '../support/us-enrollment'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const today = isoDay(new Date(), 'America/New_York')
const uid = (k: string) => one(admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`).then((r) => r.id)
const stage = async (code: string, pipe = 'p-us-dealer') => (await one(admin<{ id: string }[]>`select s.id from crm.stages s where s.pipeline_id = md5(${'contigo:' + pipe})::uuid and s.code = ${code}`)).id
const stageOf = async (dealId: string) => (await one(admin<{ code: string }[]>`select s.code from crm.deals d join crm.stages s on s.id = d.stage_id where d.id = ${dealId}`)).code

/** Una tienda nueva de Jade con su negocio de alta en Lead y un contacto que decide. */
async function enrollment() {
  const jade = await ctxFor('jade.kim')
  const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Embudo US ${tag()}`, segment: 'dealer', force: true })
  const id = await createDeal(jade, { accountId: acc.id!, pipelineId: await uid('p-us-dealer'), title: `Alta ${tag()}`, nextStep: 'Call the owner', nextStepDue: today })
  const contact = await one(admin<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('US', 'Persona de prueba') returning id`)
  await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${acc.id!}, ${contact.id}, 'US', 'decision_maker')`
  return { jade, id, accountId: acc.id!, contactId: contact.id }
}

describe('E10.F1 y F2: nueve etapas, sin etapa de proveedor', () => {
  it('el alta de dealers de US trae las nueve etapas del documento, en orden, y gana por primera transacción', async () => {
    const rows = await admin<{ name_en: string; kind: string; is_ops: boolean }[]>`
      select name_en, kind, is_ops from crm.stages where pipeline_id = ${await uid('p-us-dealer')} and archived_at is null and kind <> 'lost' order by position`
    expect(rows.map((r) => r.name_en)).toEqual(['Lead', 'Contacted', 'Presented', 'Sales Qualified', 'Docs & Contract', 'Approvals', 'Provisioned & Settlement Ready', 'Onboarding & Training', 'Won (first transaction)'])
    expect(rows.filter((r) => r.is_ops).map((r) => r.name_en)).toEqual(['Approvals', 'Provisioned & Settlement Ready', 'Onboarding & Training'])
    expect(rows.at(-1)!.kind).toBe('won')
    expect(rows.at(-2)!.kind).toBe('awaiting_txn')
    expect((await one(admin<{ close_by_transaction: boolean }[]>`select close_by_transaction from crm.pipelines where id = ${await uid('p-us-dealer')}`)).close_by_transaction).toBe(true)
    // la aprobación por proveedor no es etapa: ninguna se llama carrier
    expect(rows.some((r) => /carrier/i.test(r.name_en))).toBe(false)
    // un negocio nuevo nace en Lead
    const { id } = await enrollment()
    expect(await stageOf(id)).toBe('lead')
  })
})

describe('E10.F5 y F6: candados de Presented y Sales Qualified', () => {
  it('Presented pide sus cuatro campos; "None/Unknown" cuenta como respuesta', async () => {
    const { jade, id } = await enrollment()
    await moveDeal(jade, id, await stage('contacted'))
    const gate = await moveDeal(jade, id, await stage('presented')).catch((e) => e)
    expect(gate).toMatchObject({ code: 'stage_gate' })
    for (const name of ['Interest Level', 'Services Offered Today', 'Competitor Portals Used', 'Remittance Brands Offered']) expect(gate.en).toContain(name)
    // la hoja del candado ofrece los cuatro, con sus opciones
    const info = (await gateInfo(jade, id, await stage('presented')))!
    expect(info.fields!.map((f) => f.key).sort()).toEqual(['competitor_portals_used', 'interest_level', 'remittance_brands_offered', 'services_offered_today'])
    for (const f of info.fields!) expect(f.options).toContain('None/Unknown')
    await updateCustom(jade, 'deal', id, { interest_level: 'None/Unknown', services_offered_today: ['None/Unknown'], competitor_portals_used: ['None/Unknown'] })
    await expect(moveDeal(jade, id, await stage('presented'))).rejects.toMatchObject({ code: 'stage_gate', en: expect.stringContaining('Remittance Brands Offered') })
    await updateCustom(jade, 'deal', id, { remittance_brands_offered: ['None/Unknown'] })
    await moveDeal(jade, id, await stage('presented'))
    expect(await stageOf(id)).toBe('presented')
  })

  it('Sales Qualified pide sus seis campos, y saltarse etapas no evita los candados de en medio', async () => {
    const { jade, id } = await enrollment()
    // de Lead directo a Sales Qualified: se exige la suma (4 + 6)
    const jump = await moveDeal(jade, id, await stage('qualified')).catch((e) => e)
    expect(jump).toMatchObject({ code: 'stage_gate' })
    expect(jump.en).toContain('Interest Level')
    expect(jump.en).toContain('Primary Remittance Corridor')
    await updateCustom(jade, 'deal', id, PRESENTED)
    await moveDeal(jade, id, await stage('presented'))
    const gate = await moveDeal(jade, id, await stage('qualified')).catch((e) => e)
    for (const name of ['Primary Remittance Corridor', 'Top-Up Destinations Served', 'Primary Remittance Provider', 'Remittance Frequency', 'Business Bank Account', 'Top Carriers by Volume']) expect(gate.en).toContain(name)
    const { business_bank_account: _b, ...five } = SALES_QUALIFIED
    await updateCustom(jade, 'deal', id, five)
    await expect(moveDeal(jade, id, await stage('qualified'))).rejects.toMatchObject({ en: expect.stringContaining('Business Bank Account') })
    // una opción fuera de la lista no entra
    await expect(updateCustom(jade, 'deal', id, { business_bank_account: '021000021 123456789' })).rejects.toMatchObject({ code: 'invalid' })
    await updateCustom(jade, 'deal', id, { business_bank_account: 'Yes' })
    await moveDeal(jade, id, await stage('qualified'))
    expect(await stageOf(id)).toBe('qualified')
  })
})

describe('E10.F7: campos destacados por etapa, sin exigirlos', () => {
  it('Contacted destaca cinco y Presented catorce; no frenan el avance y la lectura dice cuáles faltan', async () => {
    const rows = await admin<{ code: string; n: number; req: string[]; hi: string[] }[]>`
      select code, cardinality(highlight_fields) as n, required_fields as req, highlight_fields as hi from crm.stages where pipeline_id = ${await uid('p-us-dealer')} and code in ('contacted', 'presented')`
    const by = Object.fromEntries(rows.map((r) => [r.code, r]))
    expect(by.contacted!.n).toBe(5)
    expect(by.presented!.n).toBe(14)
    // destacado no es requisito: nada de lo destacado está en lo que la misma etapa pide
    for (const r of rows) expect(r.hi.filter((h) => r.req.includes(h))).toEqual([])
    const { jade, id } = await enrollment()
    await moveDeal(jade, id, await stage('contacted')) // entra sin llenar ninguno de los cinco
    let d = (await getDeal(jade, id))!
    expect(d.highlights).toHaveLength(5)
    expect(d.highlights.every((h) => h.pending)).toBe(true)
    await updateCustom(jade, 'deal', id, { interest_level: 'Medium' })
    d = (await getDeal(jade, id))!
    expect(d.highlights.find((h) => h.token === 'field:interest_level')).toMatchObject({ pending: false })
    expect(d.highlights.filter((h) => h.pending)).toHaveLength(4)
    // la pantalla de campos sabe qué destaca la etapa y qué pide la siguiente
    const marks = (await stageFieldMarks(jade, id))!
    expect(marks.highlight).toContain('interest_level')
    expect(marks.next.sort()).toEqual(['competitor_portals_used', 'interest_level', 'remittance_brands_offered', 'services_offered_today'])
    expect(marks.next_en).toBe('Presented')
    // función pura
    expect(pendingHighlights({ amount_minor: null, next_step: 'x', next_step_due: today, decision_maker_id: null, decision_maker_met: false, custom: { a: 'x' } }, { highlight_fields: ['amount', 'field:a', 'field:b'] })).toEqual(['amount', 'field:b'])
    expect(missingForStage({ amount_minor: null, next_step: 'x', next_step_due: today, decision_maker_id: null, decision_maker_met: false, custom: { a: [] } }, { kind: 'open', required_fields: ['field:a'] })).toEqual(['field:a'])
  })

  it('administración hace requisito o destacado cualquier campo definido del embudo, y un campo ajeno no entra', async () => {
    const nora = await ctxFor('nora.salas')
    const contacted = await stage('contacted')
    const before = await one(admin<{ name_es: string; name_en: string; rot_days: number }[]>`select name_es, name_en, rot_days from crm.stages where id = ${contacted}`)
    const base = { nameEs: before.name_es, nameEn: before.name_en, rotDays: before.rot_days, requiredFields: [] as never[] }
    // un campo nuevo de opción múltiple, creado desde la pantalla
    const fieldId = await createField(nora, { object: 'deal', market: 'US', motor: 'dealer', labelEs: `Idiomas ${tag()}`, labelEn: `Languages ${tag()}`, dataType: 'multiselect', options: ['English', 'Spanish'] })
    const key = (await one(admin<{ key: string; data_type: string }[]>`select key, data_type from crm.field_definitions where id = ${fieldId}`))
    expect(key.data_type).toBe('multiselect')
    await updateStage(nora, contacted, { ...base, requiredCustom: [key.key], highlight: ['decision_maker', 'field:store_hours', `field:${key.key}`] })
    let s = await one(admin<{ required_fields: string[]; highlight_fields: string[] }[]>`select required_fields, highlight_fields from crm.stages where id = ${contacted}`)
    expect(s.required_fields).toContain(`field:${key.key}`)
    // lo que es requisito no se repite como destacado
    expect(s.highlight_fields.sort()).toEqual(['decision_maker', 'field:store_hours'])
    const ev = await one(admin<{ after: { highlight_fields: string[] } }[]>`select after from crm.audit_events where object_id = ${contacted} and action = 'stage.updated' order by at desc limit 1`)
    expect(ev.after.highlight_fields).toEqual(['decision_maker', 'field:store_hours'])
    // un campo que no es de este embudo (de México) o que no existe no se puede pedir
    await expect(updateStage(nora, contacted, { ...base, requiredCustom: ['expected_stores'] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateStage(nora, contacted, { ...base, highlight: ['field:no_existe'] })).rejects.toMatchObject({ code: 'invalid' })
    // sin mandar campos (la forma anterior de llamar), los requisitos de campo se conservan
    await updateStage(nora, contacted, { ...base, rotDays: before.rot_days + 1 })
    s = await one(admin<{ required_fields: string[]; highlight_fields: string[] }[]>`select required_fields, highlight_fields from crm.stages where id = ${contacted}`)
    expect(s.required_fields).toContain(`field:${key.key}`)
    expect(s.highlight_fields.sort()).toEqual(['decision_maker', 'field:store_hours'])
    // quien no administra no cambia etapas
    await expect(updateStage(await ctxFor('jade.kim'), contacted, { ...base, requiredCustom: [] })).rejects.toMatchObject({ code: 'forbidden' })
    // se regresa a como estaba para no afectar otras pruebas del archivo
    await admin`update crm.stages set required_fields = '{}', rot_days = ${before.rot_days},
      highlight_fields = '{decision_maker,field:interest_level,field:services_offered_today,field:competitor_portals_used,field:remittance_brands_offered}' where id = ${contacted}`
  })
})

describe('E10.F8 a F11: de Docs & Contract a Operaciones', () => {
  /** Un negocio de Jade en Sales Qualified, con quien decide ya contactado. */
  async function qualified() {
    const e = await enrollment()
    await updateDeal(e.jade, e.id, { decisionMakerId: e.contactId, decisionMakerMet: true })
    await updateCustom(e.jade, 'deal', e.id, { ...PRESENTED, ...SALES_QUALIFIED })
    await moveDeal(e.jade, e.id, await stage('qualified'))
    return e
  }

  it('Docs & Contract pide Products Requested (opción múltiple, siete opciones) y tipo de cuenta', async () => {
    const def = await one(admin<{ data_type: string; options: string[] }[]>`select data_type, options from crm.field_definitions where object = 'deal' and key = 'products_requested' and market_code = 'US'`)
    expect(def.data_type).toBe('multiselect')
    expect(def.options).toEqual(['Cash on-ramp', 'Domestic top-up', 'International top-up', 'SIM activation', 'Gift cards', 'Bill pay', 'Handset financing'])
    expect((await one(admin<{ options: string[] }[]>`select options from crm.field_definitions where object = 'deal' and key = 'account_funding' and market_code = 'US'`)).options).toEqual(['ACH', 'Prepaid/Wallet'])
    const { jade, id } = await qualified()
    const gate = await moveDeal(jade, id, await stage('application')).catch((e) => e)
    expect(gate).toMatchObject({ code: 'stage_gate' })
    expect(gate.en).toContain('Products requested')
    expect(gate.en).toContain('ACH or prepaid account')
    await expect(updateCustom(jade, 'deal', id, { products_requested: ['Lottery'] })).rejects.toMatchObject({ code: 'invalid' })
    await updateCustom(jade, 'deal', id, { products_requested: ['Domestic top-up', 'Bill pay'], account_funding: 'Prepaid/Wallet' })
    await moveDeal(jade, id, await stage('application'))
    expect(await stageOf(id)).toBe('application')
    // solo en este embudo: el de pedidos y los de México no los piden
    const others = await admin<{ n: number }[]>`select count(*)::int as n from crm.stages where pipeline_id <> ${await uid('p-us-dealer')} and required_fields && array['field:products_requested','field:account_funding']`
    expect(others[0]!.n).toBe(0)
  })

  it('no entra a Approvals sin la fecha de contrato firmado y enviado; al entrar queda con quien lidera Operaciones y quien lo vendió queda fijo', async () => {
    const { jade, id } = await qualified()
    await updateCustom(jade, 'deal', id, DOCS)
    await moveDeal(jade, id, await stage('application'))
    await updateDeal(jade, id, { amount: 900 })
    const approvals = await stage('carrier')
    await expect(moveDeal(jade, id, approvals)).rejects.toMatchObject({ code: 'stage_gate', en: expect.stringContaining('Contract signed & submitted') })
    await expect(updateCustom(jade, 'deal', id, { contract_signed_on: '11/01/2026' })).rejects.toMatchObject({ code: 'invalid' })
    await updateCustom(jade, 'deal', id, { contract_signed_on: today })
    // antes de entregar: quien lo vendió sigue a quien lleva el negocio y no está fijo
    let ops = (await getDealOps(jade, id))!
    expect(ops).toMatchObject({ sales_rep: 'Jade Kim', sales_rep_frozen: false })
    await moveDeal(jade, id, approvals)
    const tom = await personaId('tom.reyes')
    const jadeId = await personaId('jade.kim')
    let d = await one(admin<{ owner_id: string; ops_owner_id: string | null; sales_rep_id: string | null; frozen: boolean }[]>`select owner_id, ops_owner_id, sales_rep_id, sales_rep_frozen_at is not null as frozen from crm.deals where id = ${id}`)
    expect(d).toEqual({ owner_id: jadeId, ops_owner_id: tom, sales_rep_id: jadeId, frozen: true })
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action = 'deal.ops_assigned'`).length).toBe(1)
    // quien vendió lo sigue viendo
    expect((await getDeal(jade, id))!.deal.id).toBe(id)
    // supervisión reasigna los negocios de Jade a Sam: cambia quién lo lleva, no quién lo vendió
    await reassignDeals(await ctxFor('kira.dunn'), { market: 'US', from: jadeId, to: await personaId('sam.ortiz') })
    d = await one(admin<{ owner_id: string; ops_owner_id: string | null; sales_rep_id: string | null; frozen: boolean }[]>`select owner_id, ops_owner_id, sales_rep_id, sales_rep_frozen_at is not null as frozen from crm.deals where id = ${id}`)
    expect(d.owner_id).toBe(await personaId('sam.ortiz'))
    expect(d.sales_rep_id).toBe(jadeId)
    ops = (await getDealOps(await ctxFor('tom.reyes'), id))!
    expect(ops).toMatchObject({ sales_rep: 'Jade Kim', sales_rep_frozen: true })
    // la cola de Operaciones sigue diciendo quién lo vendió, no a quién se le reasignó
    expect((await getOpsQueue(await ctxFor('tom.reyes'), { view: 'mine' })).rows.find((r) => r.id === id)).toMatchObject({ seller: 'Jade Kim', ops_owner: 'Tom Reyes' })
    // la base no deja cambiarlo, tampoco a Operaciones
    const code = await asPersona('tom.reyes', (tx) => attempt(tx, (sp) => sp`update crm.deals set sales_rep_id = ${tom} where id = ${id}`))
    expect(code).toBe('42501')
  })

  it('un negocio devuelto que vuelve a entrar a Approvals regresa a Operaciones; la devolución usa los seis motivos de US', async () => {
    const { jade, id } = await qualified()
    await fillEnrollment(admin, id)
    await updateDeal(jade, id, { amount: 500 })
    await moveDeal(jade, id, await stage('application'))
    await moveDeal(jade, id, await stage('carrier'))
    const tom = await ctxFor('tom.reyes')
    const ops = (await getDealOps(tom, id))!
    expect(ops.reasons.map((r) => r.label_en)).toEqual(['Documents missing', 'Contract not signed', 'Entity details mismatch', 'Duplicate merchant', 'Merchant withdrew', 'Documents expired'])
    // los motivos generales que US no usa no se aceptan ahí
    await expect(moveDeal(tom, id, await stage('application'), undefined, undefined, { ret: { reasonCode: 'other' } })).rejects.toMatchObject({ code: 'return_reason_required' })
    await moveDeal(tom, id, await stage('application'), undefined, undefined, { ret: { reasonCode: 'entity_mismatch', note: 'The legal name differs' } })
    const back = await one(admin<{ next_step: string; ops_owner_id: string }[]>`select next_step, ops_owner_id from crm.deals where id = ${id}`)
    expect(back.next_step).toContain('Entity details mismatch. The legal name differs')
    // en México siguen los cuatro generales
    const mx = await admin<{ code: string }[]>`
      select r.code from (select distinct on (code) code, is_active from crm.ops_catalog where kind = 'return_reason' and (market_code is null or market_code = 'MX') order by code, market_code nulls last) r where r.is_active`
    expect(mx.map((r) => r.code).sort()).toEqual(['data_incomplete', 'docs_missing', 'not_signed', 'other'])
    // vuelve a entrar: sigue a nombre de Operaciones
    await moveDeal(jade, id, await stage('carrier'))
    expect((await one(admin<{ ops_owner_id: string }[]>`select ops_owner_id from crm.deals where id = ${id}`)).ops_owner_id).toBe(await personaId('tom.reyes'))
    // sin líder configurado, el negocio entra sin tomar (comportamiento anterior) y alguien lo toma
    const nora = await ctxFor('nora.salas')
    const opsStages = (await admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${await uid('p-us-dealer')} and is_ops`).map((r) => r.id)
    await setPipelineFlags(nora, await uid('p-us-dealer'), { multiOpen: true, hasItems: false, opsStageIds: opsStages, opsLeadId: '' })
    const other = await qualified()
    await fillEnrollment(admin, other.id)
    await updateDeal(other.jade, other.id, { amount: 500 })
    await moveDeal(other.jade, other.id, await stage('carrier'))
    expect((await one(admin<{ ops_owner_id: string | null }[]>`select ops_owner_id from crm.deals where id = ${other.id}`)).ops_owner_id).toBeNull()
    await takeDeal(tom, other.id)
    // quien lidera tiene que ser de Operaciones de ese mercado
    await expect(setPipelineFlags(nora, await uid('p-us-dealer'), { multiOpen: true, hasItems: false, opsStageIds: opsStages, opsLeadId: await personaId('valeria.soto') })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setPipelineFlags(nora, await uid('p-us-dealer'), { multiOpen: true, hasItems: false, opsStageIds: opsStages, opsLeadId: await personaId('jade.kim') })).rejects.toMatchObject({ code: 'invalid' })
    await setPipelineFlags(nora, await uid('p-us-dealer'), { multiOpen: true, hasItems: false, opsStageIds: opsStages, opsLeadId: await personaId('tom.reyes') })
    expect((await one(admin<{ ops_lead_id: string }[]>`select ops_lead_id from crm.pipelines where id = ${await uid('p-us-dealer')}`)).ops_lead_id).toBe(await personaId('tom.reyes'))
  })
})

describe('E10.F3, F4 y F14', () => {
  it('cada servicio nuevo es su propio negocio; una tienda que ya opera empieza en Docs & Contract y una nueva no se salta la investigación', async () => {
    const jade = await ctxFor('jade.kim')
    const dealer = await uid('p-us-dealer')
    const store = await one(admin<{ id: string }[]>`select id from crm.accounts where market_code = 'US' and kind = 'store' and lifecycle = 'active' and owner_id = ${await personaId('jade.kim')} and archived_at is null order by name limit 1`)
    const contact = await one(admin<{ contact_id: string }[]>`select contact_id from crm.account_contacts where account_id = ${store.id} and valid_to is null limit 1`).catch(() => null)
    expect(contact).toBeTruthy()
    // dos negocios abiertos de alta para la misma tienda: uno por servicio
    const a = await createDeal(jade, { accountId: store.id, pipelineId: dealer, title: `Bill pay ${tag()}`, nextStep: 'Send the form', nextStepDue: today })
    const b = await createDeal(jade, { accountId: store.id, pipelineId: dealer, title: `Gift cards ${tag()}`, nextStep: 'Send the form', nextStepDue: today })
    expect(a).not.toBe(b)
    // empezar en Docs & Contract pide lo de siempre (quien decide), pero no los campos de investigación
    await expect(createDeal(jade, { accountId: store.id, pipelineId: dealer, title: 'Directo', nextStep: 'Sign', nextStepDue: today, stageId: await stage('application') })).rejects.toMatchObject({ code: 'stage_gate', en: expect.stringContaining('decision-maker') })
    // una tienda nueva no puede empezar ahí
    const fresh = await createAccount(jade, { market: 'US', kind: 'store', name: `Nueva ${tag()}`, segment: 'dealer', force: true })
    await expect(createDeal(jade, { accountId: fresh.id!, pipelineId: dealer, title: 'Directo', nextStep: 'Sign', nextStepDue: today, stageId: await stage('presented') })).rejects.toMatchObject({ code: 'stage_gate', en: expect.stringContaining('already operating') })
    // una visita queda en el negocio que se indica cuando la tienda tiene varios abiertos
    const out = await recordActivity(jade, { dealId: b, kind: 'visit', outcome: 'sale', visitReason: 'follow_up', next: 'none', askNext: true })
    expect((await one(admin<{ deal_id: string }[]>`select deal_id from crm.activities where id = ${out.id}`)).deal_id).toBe(b)
  })

  it('la lista de documentos legales de US y los campos de Operaciones existen, se destacan en Approvals y nunca son requisito', async () => {
    const docs = await admin<{ code: string }[]>`select code from crm.ops_catalog where market_code = 'US' and kind = 'document' and is_active order by position`
    for (const c of ['sellers_permit', 'drivers_license', 'voided_check', 'premises_photo']) expect(docs.map((d) => d.code)).toContain(c)
    const approvals = await one(admin<{ required_fields: string[]; highlight_fields: string[] }[]>`select required_fields, highlight_fields from crm.stages where id = ${await stage('carrier')}`)
    expect(approvals.highlight_fields.sort()).toEqual(['field:ops_daily_limit', 'field:ops_requested_credit_line'])
    const all = await admin<{ n: number }[]>`select count(*)::int as n from crm.stages where required_fields && array['field:ops_daily_limit','field:ops_requested_credit_line']`
    expect(all[0]!.n).toBe(0)
    const { jade, id } = await enrollment()
    await updateCustom(jade, 'deal', id, { ops_daily_limit: '2500', ops_requested_credit_line: '10000' })
    expect((await one(admin<{ custom: Record<string, unknown> }[]>`select custom from crm.deals where id = ${id}`)).custom).toMatchObject({ ops_daily_limit: 2500, ops_requested_credit_line: 10000 })
  })
})

describe('E11.F1 y F5: pedido con sus datos de envío, descuento por línea e historial', () => {
  it('el pedido guarda paquetería (FedEx por defecto), número de cliente, entrega, PO, dirección, términos y descripción', async () => {
    const jade = await ctxFor('jade.kim')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Pedidos ${tag()}`, segment: 'orders', force: true })
    const id = await createDeal(jade, { accountId: acc.id!, pipelineId: await uid('p-us-orders'), title: `Order ${tag()}`, nextStep: 'Confirm', nextStepDue: today })
    await addDealItem(jade, id, { productId: await uid('prod-us-sim'), quantity: 100, discountPct: 10 })
    await addDealItem(jade, id, { productId: await uid('prod-us-topup'), quantity: 2 })
    const lines = await admin<{ discount_pct: string; sum_minor: string }[]>`select discount_pct::text, sum_minor::text from crm.deal_items where deal_id = ${id} order by position`
    expect(lines.map((l) => [Number(l.discount_pct), Number(l.sum_minor)])).toEqual([[10, 22500], [0, 9000]])
    expect(Number((await one(admin<{ amount_minor: string }[]>`select amount_minor from crm.deals where id = ${id}`)).amount_minor)).toBe(31500)
    await expect(addDealItem(jade, id, { productId: await uid('prod-us-sim'), quantity: 1, discountPct: 120 })).rejects.toMatchObject({ code: 'invalid', en: expect.stringContaining('discount') })
    const due = addDays(today, 5)
    await saveOrderDetails(jade, id, { customerNumber: 'C-10293', dueOn: due, poNumber: 'PO-7781', shipTo: '100 Main Street, Baltimore', terms: 'Net 15', description: 'Restock for the weekend' })
    expect(await one(admin`select carrier, customer_number, due_on::text, po_number, ship_to, terms, description from crm.deal_orders where deal_id = ${id}`))
      .toEqual({ carrier: 'FedEx', customer_number: 'C-10293', due_on: due, po_number: 'PO-7781', ship_to: '100 Main Street, Baltimore', terms: 'Net 15', description: 'Restock for the weekend' })
    await saveOrderDetails(jade, id, { carrier: 'UPS', customerNumber: 'C-10293', dueOn: due, poNumber: 'PO-7781', shipTo: '100 Main Street, Baltimore', terms: 'Net 15', description: 'Restock for the weekend' })
    expect((await getDealOps(jade, id))!.order).toMatchObject({ carrier: 'UPS', po_number: 'PO-7781' })
    const events = await admin<{ before: unknown; after: { carrier: string } }[]>`select before, after from crm.audit_events where object_id = ${id} and action = 'deal.order_updated' order by at`
    expect(events).toHaveLength(2)
    expect(events[1]!.after.carrier).toBe('UPS')
    // reglas: fecha de hoy en adelante, sin números de tarjeta en texto libre, solo en embudos de pedidos, y con permiso
    await expect(saveOrderDetails(jade, id, { dueOn: addDays(today, -1) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveOrderDetails(jade, id, { description: `Card ${['4111', '1111', '1111', '1111'].join(' ')}` })).rejects.toMatchObject({ code: 'invalid' })
    const alta = await createDeal(jade, { accountId: acc.id!, pipelineId: await uid('p-us-dealer'), title: 'Alta', nextStep: 'Call', nextStepDue: today })
    await expect(saveOrderDetails(jade, alta, { poNumber: 'x' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveOrderDetails(await ctxFor('marco.pena'), id, { poNumber: 'x' })).rejects.toMatchObject({ code: expect.stringMatching(/not_found|forbidden/) })
    // la base repite el límite: alguien de otro mercado no ve ni escribe los datos del pedido
    expect(await asPersona('marco.pena', (tx) => tx`select 1 from crm.deal_orders where deal_id = ${id}`)).toHaveLength(0)
    expect(await asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`update crm.deal_orders set carrier = 'X' where deal_id = ${id}`))).toBe('0 rows')
    // historial en la ficha: fecha del último pedido y los pedidos, del más reciente al más antiguo
    const h = await accountOrders(jade, acc.id!)
    expect(h.total).toBe(1)
    expect(isoDay(h.last!, 'America/New_York')).toBe(today)
    expect(h.orders[0]).toMatchObject({ id, lines: 2, carrier: 'UPS', po_number: 'PO-7781' })
  })

  it('los pedidos históricos (cargados con su fecha original) dicen cuándo fue el último', async () => {
    const jade = await ctxFor('jade.kim')
    const acc = await one(admin<{ account_id: string; n: number; last: Date }[]>`
      select d.account_id, count(*)::int as n, max(d.created_at) as last from crm.deals d join crm.accounts a on a.id = d.account_id
       where d.pipeline_id = ${await uid('p-us-orders')} and a.owner_id = ${await personaId('jade.kim')} group by d.account_id order by d.account_id limit 1`)
    const h = await accountOrders(jade, acc.account_id)
    expect(h.total).toBe(acc.n)
    expect(h.last!.getTime()).toBe(new Date(acc.last).getTime())
    expect(h.orders).toHaveLength(acc.n)
    expect(h.orders[0]!.ordered_at.getTime()).toBeGreaterThanOrEqual(h.orders.at(-1)!.ordered_at.getTime())
    // un pedido cancelado no cuenta como último pedido
    const lost = await stage('lost', 'p-us-orders')
    await admin`update crm.deals set status = 'lost', stage_id = ${lost}, lost_at = now(), won_at = null, loss_reason_code = 'duplicate', closed_by = 'manual' where id = ${h.orders[0]!.id}`
    const after = await accountOrders(jade, acc.account_id)
    expect(after.total).toBe(acc.n)
    if (acc.n > 1) expect(after.last!.getTime()).toBe(h.orders[1]!.ordered_at.getTime())
    else expect(after.last).toBeNull()
  })
})

describe('E12.F1, F2 y F4: toda visita lleva su propósito, elegido de una lista', () => {
  it('US tiene su lista (con uno de campaña) y la pide en toda visita hecha; México no tiene lista y no la pide', async () => {
    const jade = await ctxFor('jade.kim')
    const list = await visitReasons(jade, { market: 'US' })
    expect(list).toHaveLength(8)
    expect(list.filter((r) => r.is_campaign).map((r) => r.code)).toEqual(['campaign'])
    expect(await visitReasons(await ctxFor('marco.pena'), { market: 'MX' })).toEqual([])
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Visitas ${tag()}`, segment: 'dealer', force: true })
    await expect(recordActivity(jade, { accountId: acc.id!, kind: 'visit', outcome: 'sale', next: 'none', askNext: true })).rejects.toMatchObject({ code: 'invalid', en: expect.stringContaining('purpose') })
    await expect(recordActivity(jade, { accountId: acc.id!, kind: 'visit', outcome: 'sale', visitReason: 'inventado', next: 'none', askNext: true })).rejects.toMatchObject({ code: 'invalid' })
    const out = await recordActivity(jade, { accountId: acc.id!, kind: 'visit', outcome: 'sale', visitReason: 'campaign', next: 'none', askNext: true })
    const a = await one(admin<{ visit_reason: string; kind: string; done: boolean; account_id: string }[]>`select visit_reason, kind, done_at is not null as done, account_id from crm.activities where id = ${out.id}`)
    expect(a).toEqual({ visit_reason: 'campaign', kind: 'visit', done: true, account_id: acc.id })
    expect((await one(admin<{ after: { visit_reason: string } }[]>`select after from crm.audit_events where object_id = ${out.id} and action = 'activity.added'`)).after.visit_reason).toBe('campaign')
    // una visita por hacer no lo pide al planearla, y sí al completarla
    const planned = await addActivity(jade, { accountId: acc.id!, kind: 'visit', dueAt: addDays(today, 1) })
    expect(await visitReasons(jade, { activityId: planned })).toHaveLength(8)
    await expect(completeItem(jade, { type: 'task', id: planned, result: 'sale', next: 'none', when: '' })).rejects.toMatchObject({ code: 'invalid', en: expect.stringContaining('purpose') })
    await completeItem(jade, { type: 'task', id: planned, result: 'sale', next: 'none', when: '', visitReason: 'training' })
    expect((await one(admin<{ visit_reason: string }[]>`select visit_reason from crm.activities where id = ${planned}`)).visit_reason).toBe('training')
    // México: sin lista, la visita se guarda como siempre
    const marco = await ctxFor('marco.pena')
    const store = await one(admin<{ id: string }[]>`select id from crm.accounts where market_code = 'MX' and kind = 'store' and owner_id = ${await personaId('marco.pena')} and archived_at is null limit 1`)
    const mx = await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'sale', next: 'none', askNext: true })
    expect((await one(admin<{ visit_reason: string | null }[]>`select visit_reason from crm.activities where id = ${mx.id}`)).visit_reason).toBeNull()
  })

  it('administración mantiene la lista por mercado; un propósito retirado deja de ofrecerse y nadie más la cambia', async () => {
    const nora = await ctxFor('nora.salas')
    const name = `Fall promo ${tag()}`
    await saveVisitReason(nora, { market: 'US', labelEs: `Promo de otoño ${tag()}`, labelEn: name, campaign: true })
    const row = await one(admin<{ id: string; code: string; is_campaign: boolean }[]>`select id, code, is_campaign from crm.visit_reasons where label_en = ${name}`)
    expect(row.is_campaign).toBe(true)
    const jade = await ctxFor('jade.kim')
    expect((await visitReasons(jade, { market: 'US' })).map((r) => r.code)).toContain(row.code)
    await expect(saveVisitReason(nora, { market: 'US', labelEs: 'Otra', labelEn: name })).rejects.toMatchObject({ code: 'invalid' })
    await saveVisitReason(nora, { id: row.id, labelEs: 'Promo retirada', labelEn: name, campaign: true, active: false })
    expect((await visitReasons(jade, { market: 'US' })).map((r) => r.code)).not.toContain(row.code)
    await expect(saveVisitReason(jade, { market: 'US', labelEs: 'Mío', labelEn: 'Mine' })).rejects.toMatchObject({ code: 'forbidden' })
    expect(await asPersona('jade.kim', (tx) => attempt(tx, (sp) => sp`insert into crm.visit_reasons (market_code, code, label_es, label_en) values ('US', 'mio', 'Mío', 'Mine')`))).toBe('42501')
    expect((await admin`select 1 from crm.audit_events where object_id = ${row.id} and action in ('pipeline.visit_reason_created', 'pipeline.visit_reason_updated')`).length).toBe(2)
  })
})

describe('E12.F3: lo escrito en la nota de una visita pasa a los campos del negocio', () => {
  it('los renglones "Campo: valor" llenan el negocio, quedan en la bitácora y salen de la nota; el propósito también se lee de la nota', async () => {
    const { jade, id, accountId } = await enrollment()
    const out = await recordActivity(jade, { accountId, kind: 'visit', outcome: 'revisit', next: 'none', askNext: true,
      body: 'Purpose: Follow-up\nSpoke with the manager\nInterest Level: High\nServices offered today: Top-ups, Bill pay\nOwner cousin: Dana' })
    expect(out.moved!.map((m) => m.key)).toEqual(['interest_level', 'services_offered_today'])
    const a = await one(admin<{ body: string; visit_reason: string; deal_id: string }[]>`select body, visit_reason, deal_id from crm.activities where id = ${out.id}`)
    expect(a).toEqual({ body: 'Spoke with the manager\nOwner cousin: Dana', visit_reason: 'follow_up', deal_id: id })
    expect((await one(admin<{ custom: Record<string, unknown> }[]>`select custom from crm.deals where id = ${id}`)).custom).toMatchObject({ interest_level: 'High', services_offered_today: ['Top-ups', 'Bill pay'] })
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action = 'deal.custom_updated'`).length).toBe(1)
    expect((await one(admin<{ after: { note_to_fields: string[] } }[]>`select after from crm.audit_events where object_id = ${out.id} and action = 'activity.added'`)).after.note_to_fields).toEqual(['interest_level', 'services_offered_today'])
    // una nota sin datos con nombre de campo se guarda tal cual
    const plain = await recordActivity(jade, { accountId, kind: 'visit', outcome: 'revisit', visitReason: 'training', next: 'none', askNext: true, body: 'Walked the clerk through the portal' })
    expect(plain.moved).toEqual([])
    expect((await one(admin<{ body: string }[]>`select body from crm.activities where id = ${plain.id}`)).body).toBe('Walked the clerk through the portal')
  })
})

describe('E10.F2: la aprobación por proveedor se ve en la tienda', () => {
  it('lo que Operaciones anota por proveedor en el negocio aparece en la tienda; sin movimiento no aparece nada', async () => {
    const { jade, id, accountId } = await enrollment()
    expect(await storeProviders(jade, accountId)).toEqual([])
    const tom = await ctxFor('tom.reyes')
    const north = (await one(admin<{ id: string }[]>`select id from crm.ops_catalog where market_code = 'US' and kind = 'provider' and code = 'carrier_north'`)).id
    await setOpsCheck(tom, id, north, { status: 'sent', onDate: today })
    await setOpsCheck(tom, id, north, { status: 'approved', onDate: today })
    const rows = await storeProviders(jade, accountId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label_en: 'North carrier', status: 'approved', on_date: today, deal_id: id })
    // alguien de otro mercado no la ve
    expect(await storeProviders(await ctxFor('marco.pena'), accountId)).toEqual([])
  })
})

describe('E12.F6 y rutas: lecturas para Finanzas y para la herramienta de rutas', () => {
  it('el detalle de visitas trae una fila por visita con tienda, dirección y propósito; respeta permiso y alcance y deja evento', async () => {
    const jade = await ctxFor('jade.kim')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Reembolso ${tag()}`, segment: 'dealer', force: true })
    await admin`update crm.accounts set address_line = '200 Test Avenue', locality = 'Baltimore', region = 'MD', postal_code = '21201' where id = ${acc.id!}`
    await recordActivity(jade, { accountId: acc.id!, kind: 'visit', outcome: 'sale', visitReason: 'delivery', next: 'none', askNext: true })
    const robert = await ctxFor('robert.hale')
    const data = await visitDetail(robert, { market: 'US' })
    const row = data.rows.find((r) => r.account_name.startsWith('Reembolso'))!
    expect(row).toMatchObject({ day: today, market_code: 'US', owner_name: 'Jade Kim', address_line: '200 Test Avenue', locality: 'Baltimore', region: 'MD', postal_code: '21201', purpose_en: 'Material or product drop-off', outcome: 'sale', origin: 'manual' })
    expect(data.rows.every((r) => r.market_code === 'US')).toBe(true)
    const out = await exportVisitDetail(await ctxFor('robert.hale'), { market: 'US' })
    expect(out.csv.split('\n')[0]).toContain('Fecha')
    expect(out.csv).toContain('200 Test Avenue')
    expect(out.rows).toBe(data.rows.length)
    const ev = await one(admin<{ after: { report: string; rows: number } }[]>`select after from crm.audit_events where action = 'report.exported' and after ->> 'report' = 'visit_detail' order by at desc limit 1`)
    expect(ev.after).toMatchObject({ report: 'visit_detail', rows: out.rows })
    // quien vende y Operaciones no exportan; el líder de México no ve US; el periodo tiene tope
    await expect(visitDetail(jade, { market: 'US' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(visitDetail(await ctxFor('tom.reyes'), { market: 'US' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(visitDetail(await ctxFor('ana.robles'), { market: 'US' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(visitDetail(robert, { market: 'US', from: addDays(today, -200), to: today })).rejects.toMatchObject({ code: 'invalid' })
    // supervisión: solo las visitas de su equipo
    const kira = await visitDetail(await ctxFor('kira.dunn'), { market: 'US' })
    expect(kira.rows.some((r) => r.account_name.startsWith('Reembolso'))).toBe(true)
  })

  it('la lista para la ruta trae solo las tiendas que la persona lleva, con dirección, contacto y desempeño', async () => {
    const jade = await ctxFor('jade.kim')
    const mine = await routeStores(jade, 'US')
    const expected = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where market_code = 'US' and kind = 'store' and archived_at is null and owner_id = ${await personaId('jade.kim')}`)
    expect(mine).toHaveLength(Math.min(expected.n, 500))
    const owners = await admin<{ owner_id: string }[]>`select distinct owner_id from crm.accounts where id = any(${mine.map((s) => s.account_id)}::uuid[])`
    expect(owners.map((o) => o.owner_id)).toEqual([await personaId('jade.kim')])
    expect(mine.some((s) => s.txn_count_30d !== null)).toBe(true)
    expect(Object.keys(mine[0]!).sort()).toEqual(['account_id', 'address', 'approved_products', 'contact', 'last_visit_on', 'locality', 'merchant_ref', 'name', 'phone', 'postal_code', 'region', 'txn_count_30d'])
    // otro mercado: no es el suyo
    await expect(routeStores(jade, 'MX')).rejects.toBeTruthy()
  })
})
