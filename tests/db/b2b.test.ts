import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ctxFor, owner, personaId, systemContext } from './helpers'
import { withUser } from '@/server/db'
import { addContact, createAccount, setParent } from '@/domain/accounts'
import {
  archiveStage, createAccountType, createField, createLossReason, createPipeline, createStage, moveStage, pauseDeal, resumeDeal,
  setAccountType, setFieldActive, setPrimaryContact, updateForm, updateLossReason,
} from '@/domain/b2b'
import { createDeal, moveDeal } from '@/domain/deals'
import { configurePipeline, updateCustom } from '@/domain/custom'
import { createTeam } from '@/domain/admin'
import { intakeFromForm } from '@/domain/leads'
import { evaluateRules } from '@/domain/rules'
import { NEXT_SETS } from '@/domain/followup'
import { fieldApplies, fieldDefs } from '@/dal/fields'
import { accountTypes, closeRuleChanges, getB2bConfig, intakeFields, lossReasonsFor, parentChoices, teamsWithoutSupervisor } from '@/dal/b2b'
import { getAccount } from '@/dal/accounts'
import { getBoard, getDeal } from '@/dal/pipelines'
import { getQueue } from '@/dal/queue'

// Paquete b2b (0016_b2b): tipo de cuenta, jerarquía, campos por tipo de venta, etapas administrables, pausa,
// motivos de pérdida por embudo, contactos corporativos y lo que administración crea desde la pantalla.
const admin = owner()
// Número de tarjeta de prueba, armado por partes para que el escáner de datos prohibidos no lo confunda con uno real.
const CARD = ['4111', '1111', '1111', '1111'].join(' ')
const tag = () => Math.random().toString(36).slice(2, 8)
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
const audits = (action: string, id: string) => admin<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null }[]>`
  select before, after from crm.audit_events where action = ${action} and object_id = ${id} order by at desc`

let b2bPipe = ''
let testPipe = ''
const created = { fields: [] as string[], types: [] as string[] }

beforeAll(async () => {
  b2bPipe = (await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'b2b'`)).id
})
afterAll(async () => {
  // Lo que estas pruebas crearon en catálogos se apaga, para no cambiar lo que ven las demás.
  if (testPipe) await admin`update crm.pipelines set is_active = false where id = ${testPipe}`
  await admin`update crm.field_definitions set is_active = false where key like 'prueba_b2b_%' or label_es like 'Prueba b2b %'`
  await admin`update crm.account_types set is_active = false where label_es like 'Prueba b2b %'`
  await admin`update crm.loss_reasons set is_active = false where label_es like 'Prueba b2b %'`
  await admin.end()
})

const b2bAccount = async (who: string, type = 'chain') => {
  const ctx = await ctxFor(who)
  const out = await createAccount(ctx, { market: 'MX', accountType: type, name: `Cuenta B2B ${tag()}`, segment: 'b2b' })
  return out.id!
}

describe('tipo de cuenta', () => {
  it('el catálogo trae ISO, distribuidor, cadena, corporativo y agregador, y lo sembrado quedó con su tipo', async () => {
    const diana = await ctxFor('diana.cruz')
    const codes = (await accountTypes(diana, 'MX')).map((x) => x.code)
    expect(codes).toEqual(expect.arrayContaining(['store', 'branch', 'chain', 'corporate', 'distributor', 'iso', 'aggregator']))
    const bad = await one(admin<{ n: number }[]>`
      select count(*)::int as n from crm.accounts a where not exists (select 1 from crm.account_types t where t.code = a.account_type and t.kind = a.kind)`)
    expect(bad.n).toBe(0)
  })

  it('quien vende cambia el tipo de su cuenta; el nivel sale del tipo y queda en la bitácora', async () => {
    const diana = await ctxFor('diana.cruz')
    const id = await b2bAccount('diana.cruz', 'iso')
    expect(await one(admin`select kind, account_type from crm.accounts where id = ${id}`)).toMatchObject({ kind: 'distributor', account_type: 'iso' })
    await setAccountType(diana, id, 'corporate')
    expect(await one(admin`select kind, account_type from crm.accounts where id = ${id}`)).toMatchObject({ kind: 'organization', account_type: 'corporate' })
    expect((await audits('account.type_changed', id))[0]).toMatchObject({ before: { account_type: 'iso' }, after: { account_type: 'corporate', kind: 'organization' } })
    const data = await getAccount(diana, id)
    expect(data?.account).toMatchObject({ type_es: 'Corporativo', type_en: 'Corporate account' })
  })

  it('un tipo que no existe no entra, ni por el dominio ni directo en la base; solo lectura no lo cambia', async () => {
    const diana = await ctxFor('diana.cruz')
    const id = await b2bAccount('diana.cruz')
    await expect(setAccountType(diana, id, 'no_existe')).rejects.toMatchObject({ code: 'invalid' })
    await expect(admin`update crm.accounts set account_type = 'no_existe' where id = ${id}`).rejects.toMatchObject({ code: '23514' })
    await expect(setAccountType(await ctxFor('luis.tovar'), id, 'iso')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('el camino anterior (solo nivel) sigue dando un tipo, y una cuenta con sub-cuentas no pasa a ser tienda', async () => {
    const diana = await ctxFor('diana.cruz')
    const legacy = (await createAccount(diana, { market: 'MX', kind: 'chain', name: `Cadena Nivel ${tag()}`, segment: 'b2b' })).id!
    expect(await one(admin`select account_type from crm.accounts where id = ${legacy}`)).toMatchObject({ account_type: 'chain' })
    const child = (await createAccount(diana, { market: 'MX', accountType: 'branch', name: `Sucursal ${tag()}`, segment: 'b2b', parentId: legacy })).id!
    expect(await one(admin`select kind, account_type from crm.accounts where id = ${child}`)).toMatchObject({ kind: 'store', account_type: 'branch' })
    await expect(setAccountType(diana, legacy, 'store')).rejects.toMatchObject({ code: 'invalid' })
  })

  it('administración agrega un tipo al catálogo de un mercado; nadie más', async () => {
    const nora = await ctxFor('nora.salas')
    const code = await createAccountType(nora, { market: 'MX', labelEs: `Prueba b2b ${tag()}`, labelEn: `B2b test ${tag()}`, level: 'distributor' })
    created.types.push(code)
    expect((await accountTypes(await ctxFor('diana.cruz'), 'MX')).map((x) => x.code)).toContain(code)
    expect((await accountTypes(await ctxFor('sam.ortiz'), 'US')).map((x) => x.code)).not.toContain(code)
    await expect(createAccountType(await ctxFor('ana.robles'), { market: 'MX', labelEs: 'Prueba b2b no', labelEn: 'B2b test no', level: 'store' })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('jerarquía de cuentas', () => {
  it('quien vende arma el árbol de SUS cuentas, no con la matriz de otra persona', async () => {
    const diana = await ctxFor('diana.cruz')
    const iso = await b2bAccount('diana.cruz', 'iso')
    const sub = await b2bAccount('diana.cruz', 'chain')
    const ajena = await b2bAccount('ivan.rios', 'distributor')
    await setParent(diana, sub, iso)
    expect(await one(admin`select parent_id, ancestor_ids from crm.accounts where id = ${sub}`)).toMatchObject({ parent_id: iso, ancestor_ids: [iso] })
    expect((await parentChoices(diana, 'MX', true)).map((x) => x.id)).toEqual(expect.arrayContaining([iso]))
    expect((await parentChoices(diana, 'MX', true)).map((x) => x.id)).not.toContain(ajena)
    await expect(setParent(diana, sub, ajena)).rejects.toMatchObject({ code: 'invalid' })
    await expect(setParent(await ctxFor('ivan.rios'), sub, null)).rejects.toMatchObject({ code: expect.stringMatching(/invalid|not_found/) })
    // quien supervisa sí mueve entre personas de su equipo
    await setParent(await ctxFor('paula.mendez'), sub, ajena, { reason: 'La subagencia pasó a otra matriz' })
    expect(await one(admin`select parent_id from crm.accounts where id = ${sub}`)).toMatchObject({ parent_id: ajena })
  })

  it('sin ciclos: el dominio lo explica y la base lo impide', async () => {
    const diana = await ctxFor('diana.cruz')
    const top = await b2bAccount('diana.cruz', 'iso')
    const mid = await b2bAccount('diana.cruz', 'distributor')
    await setParent(diana, mid, top)
    await expect(setParent(diana, top, mid)).rejects.toMatchObject({ code: 'invalid' })
    await expect(setParent(diana, top, top)).rejects.toMatchObject({ code: 'invalid' })
    await expect(admin`update crm.accounts set parent_id = ${mid} where id = ${top}`).rejects.toMatchObject({ code: '23514' })
  })
})

describe('campos B2B', () => {
  it('salen solo en cuentas B2B de México, con el expediente según el tipo de persona', async () => {
    const diana = await ctxFor('diana.cruz')
    const b2b = (await fieldDefs(diana, 'account', 'MX', 'b2b')).map((d) => d.key)
    expect(b2b).toEqual(expect.arrayContaining(['b2b_points_of_sale', 'b2b_monthly_volume', 'b2b_integration', 'b2b_commission', 'b2b_settlement', 'b2b_entity_type', 'b2b_doc_acta', 'b2b_doc_id']))
    expect((await fieldDefs(diana, 'account', 'MX', 'd2d')).some((d) => d.key.startsWith('b2b_'))).toBe(false)
    expect((await fieldDefs(diana, 'account', 'MX')).some((d) => d.key.startsWith('b2b_'))).toBe(false)
    expect((await fieldDefs(await ctxFor('sam.ortiz'), 'account', 'US', 'b2b')).some((d) => d.key.startsWith('b2b_'))).toBe(false)
    const defs = await fieldDefs(diana, 'account', 'MX', 'b2b')
    const docs = (values: Record<string, unknown>) => defs.filter((d) => d.applies_when && fieldApplies(d, values)).map((d) => d.key).sort()
    expect(docs({ b2b_entity_type: 'Persona moral' })).toEqual(['b2b_doc_acta', 'b2b_doc_csf_moral', 'b2b_doc_poder'])
    expect(docs({ b2b_entity_type: 'Persona física' })).toEqual(['b2b_doc_csf_fisica', 'b2b_doc_domicilio', 'b2b_doc_id'])
    expect(docs({})).toEqual([])
  })

  it('se guardan en la cuenta B2B con bitácora; el expediente es un estado, y un dato prohibido no entra', async () => {
    const diana = await ctxFor('diana.cruz')
    const id = await b2bAccount('diana.cruz', 'corporate')
    const n = await updateCustom(diana, 'account', id, { b2b_points_of_sale: '42', b2b_entity_type: 'Persona moral', b2b_doc_acta: 'Recibido', b2b_commission: '3% sobre recargas', b2b_settlement: 'Factura en los primeros diez días, pago el 15' })
    expect(n).toBe(5)
    expect((await one(admin<{ custom: Record<string, unknown> }[]>`select custom from crm.accounts where id = ${id}`)).custom).toMatchObject({ b2b_points_of_sale: 42, b2b_doc_acta: 'Recibido' })
    expect((await audits('account.custom_updated', id))[0]?.after).toMatchObject({ b2b_doc_acta: 'Recibido' })
    await expect(updateCustom(diana, 'account', id, { b2b_doc_acta: 'INE 1234567890123' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateCustom(diana, 'account', id, { b2b_commission: `Depositar a la tarjeta ${CARD}` })).rejects.toMatchObject({ code: 'invalid' })
    // en una tienda D2D los campos B2B no existen: no se guardan
    const tienda = (await createAccount(await ctxFor('marco.pena'), { market: 'MX', accountType: 'store', name: `Abarrotes Prueba ${tag()}`, segment: 'd2d' })).id!
    expect(await updateCustom(await ctxFor('marco.pena'), 'account', tienda, { b2b_points_of_sale: '3' })).toBe(0)
  })

  it('el alta manual pide lo mínimo para calificar', async () => {
    const keys = (await intakeFields(await ctxFor('diana.cruz'))).filter((d) => d.motor === 'b2b' && d.market_code === 'MX').map((d) => d.key)
    expect(keys).toEqual(expect.arrayContaining(['b2b_points_of_sale', 'b2b_monthly_volume', 'b2b_integration', 'b2b_entity_type']))
  })

  it('administración crea un campo y aparece en la ficha de su mercado y tipo de venta; no puede pedir datos que no se guardan', async () => {
    const nora = await ctxFor('nora.salas')
    const name = `Prueba b2b ${tag()}`
    const id = await createField(nora, { object: 'account', market: 'MX', motor: 'event', labelEs: name, labelEn: `${name} en`, dataType: 'select', options: ['Uno', 'Dos'], decision: 'Decide a qué evento se invita a la cuenta' })
    created.fields.push(id)
    const defs = await fieldDefs(nora, 'account', 'MX', 'event')
    expect(defs.find((d) => d.label_es === name)).toMatchObject({ data_type: 'select', options: ['Uno', 'Dos'], motor: 'event' })
    expect((await fieldDefs(nora, 'account', 'MX', 'd2d')).some((d) => d.label_es === name)).toBe(false)
    expect((await audits('field.created', id)).length).toBe(1)
    await setFieldActive(nora, id, false)
    expect((await fieldDefs(nora, 'account', 'MX', 'event')).some((d) => d.label_es === name)).toBe(false)
    for (const label of ['CLABE del comercio', 'Número de tarjeta', 'Contraseña del portal', 'Cuenta bancaria']) {
      await expect(createField(nora, { object: 'account', market: 'MX', motor: 'b2b', labelEs: label, labelEn: 'Prueba b2b x', dataType: 'text', decision: 'Decide una prueba del registro' })).rejects.toMatchObject({ code: 'invalid' })
    }
    await expect(createField(nora, { object: 'deal', market: '', motor: '', labelEs: 'Prueba b2b lista', labelEn: 'B2b test list', purpose: 'Prueba b2b: para segmentar la cartera', dataType: 'select', options: ['Sola'] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createField(await ctxFor('ana.robles'), { object: 'deal', market: 'MX', motor: '', labelEs: 'Prueba b2b no', labelEn: 'B2b test no', purpose: 'Prueba b2b: para segmentar la cartera', dataType: 'text' })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('etapas y embudos administrables', () => {
  it('el embudo B2B de México sembrado ya trae integración, pruebas, certificación y alta y capacitación', async () => {
    const names = (await admin<{ name_es: string }[]>`select name_es from crm.stages where pipeline_id = ${b2bPipe} and archived_at is null order by position`).map((s) => s.name_es)
    // (paquete mx: el NDA y el contrato son etapas, como en el documento de requerimientos, E14.F5)
    expect(names).toEqual(['Calificación', 'Propuesta', 'Acuerdo de confidencialidad (NDA)', 'Negociación', 'Integración', 'Pruebas', 'Contrato', 'Certificación', 'Alta y capacitación', 'Contrato firmado, esperando primera venta', 'Ganada', 'Perdida'])
  })

  it('administración crea un embudo con sus etapas, agrega, reordena y archiva; una etapa con negocios pide a dónde moverlos', async () => {
    const nora = await ctxFor('nora.salas')
    const diana = await ctxFor('diana.cruz')
    await expect(createPipeline(diana, { market: 'MX', motor: 'event', name: 'No', stages: [{ es: 'Uno', en: 'One' }] })).rejects.toMatchObject({ code: 'forbidden' })
    testPipe = await createPipeline(nora, { market: 'MX', motor: 'event', name: `Prueba b2b ${tag()}`, stages: [{ es: 'Contacto', en: 'Contact' }, { es: 'Propuesta', en: 'Proposal' }] })
    const order = async () => (await admin<{ name_es: string }[]>`select name_es from crm.stages where pipeline_id = ${testPipe} and archived_at is null order by position`).map((s) => s.name_es)
    const stage = async (name: string) => (await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${testPipe} and name_es = ${name}`)).id
    expect(await order()).toEqual(['Contacto', 'Propuesta', 'Ganado', 'Perdido'])
    expect((await one(admin<{ close_by_transaction: boolean }[]>`select close_by_transaction from crm.pipelines where id = ${testPipe}`)).close_by_transaction).toBe(false)

    await createStage(nora, testPipe, { nameEs: 'Integración', nameEn: 'Integration' })
    expect(await order()).toEqual(['Contacto', 'Propuesta', 'Integración', 'Ganado', 'Perdido'])
    await expect(createStage(nora, testPipe, { nameEs: 'integración', nameEn: 'Other' })).rejects.toMatchObject({ code: 'invalid' })
    await moveStage(nora, await stage('Integración'), 'up')
    expect(await order()).toEqual(['Contacto', 'Integración', 'Propuesta', 'Ganado', 'Perdido'])
    await expect(moveStage(nora, await stage('Propuesta'), 'down')).rejects.toMatchObject({ code: 'invalid' })
    await expect(moveStage(nora, await stage('Ganado'), 'up')).rejects.toMatchObject({ code: 'invalid' })
    await expect(moveStage(diana, await stage('Propuesta'), 'up')).rejects.toMatchObject({ code: 'forbidden' })

    // un negocio en la etapa que se va a archivar
    const account = await b2bAccount('diana.cruz')
    const deal = await createDeal(diana, { accountId: account, pipelineId: testPipe, title: `Negocio ${tag()}`, nextStep: 'Reunión inicial', nextStepDue: day(2) })
    const contacto = await stage('Contacto')
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${deal}`)).stage_id).toBe(contacto)
    await expect(archiveStage(nora, contacto, null)).rejects.toMatchObject({ code: 'invalid' })
    await expect(archiveStage(nora, contacto, await stage('Ganado'))).rejects.toMatchObject({ code: 'invalid' })
    await expect(archiveStage(diana, contacto, await stage('Propuesta'))).rejects.toMatchObject({ code: 'forbidden' })
    const out = await archiveStage(nora, contacto, await stage('Propuesta'))
    expect(out.moved).toBe(1)
    expect(await order()).toEqual(['Integración', 'Propuesta', 'Ganado', 'Perdido'])
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${deal}`)).stage_id).toBe(await stage('Propuesta'))
    expect(await one(admin`select cause, from_stage_id from crm.deal_stage_events where deal_id = ${deal} order by at desc limit 1`)).toMatchObject({ cause: 'admin', from_stage_id: contacto })
    expect((await audits('stage.archived', contacto))[0]?.after).toMatchObject({ moved_deals: 1 })
    // la etapa archivada no se borra, sale del tablero y ya no recibe negocios
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.stages where id = ${contacto} and archived_at is not null`)).n).toBe(1)
    const board = await getBoard(diana, testPipe, {})
    expect(board?.stages.map((s) => s.name_es)).toEqual(['Integración', 'Propuesta', 'Ganado', 'Perdido'])
    await expect(moveDeal(diana, deal, contacto)).rejects.toMatchObject({ code: 'invalid' })
    // un negocio nuevo nace en la primera etapa vigente
    const other = await createDeal(diana, { accountId: await b2bAccount('diana.cruz'), pipelineId: testPipe, title: `Negocio ${tag()}`, nextStep: 'Llamar', nextStepDue: day(1) })
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${other}`)).stage_id).toBe(await stage('Integración'))
    // no se archiva la última etapa de trabajo
    await archiveStage(nora, await stage('Integración'), await stage('Propuesta'))
    await expect(archiveStage(nora, await stage('Propuesta'), null)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('cambiar cómo se gana un embudo con negocios abiertos pide confirmación y deja cuántos tocó', async () => {
    const nora = await ctxFor('nora.salas')
    const open = (await one(admin<{ n: number }[]>`select count(*)::int as n from crm.deals where pipeline_id = ${testPipe} and status = 'open'`)).n
    expect(open).toBeGreaterThan(0)
    await expect(configurePipeline(nora, testPipe, { closeByTransaction: true, awaitingStageId: null, confirmed: false })).rejects.toMatchObject({ code: 'confirm_required' })
    await configurePipeline(nora, testPipe, { closeByTransaction: true, awaitingStageId: null, confirmed: true })
    expect((await audits('pipeline.configured', testPipe))[0]?.after).toMatchObject({ close_by_transaction: true, open_deals: open })
    const changes = await closeRuleChanges(nora)
    expect(changes[0]).toMatchObject({ by_transaction: true, open_deals: open, actor: 'Nora Salas' })
    // sin cambiar la regla no hay nada que confirmar
    await configurePipeline(nora, testPipe, { closeByTransaction: true, awaitingStageId: null, confirmed: false })
    await configurePipeline(nora, testPipe, { closeByTransaction: false, awaitingStageId: null, confirmed: true })
  })
})

describe('en pausa y motivos de pérdida por embudo', () => {
  it('un negocio en pausa sale de los avisos de sin movimiento, se filtra en el tablero y vuelve a Hoy el día de la revisión', async () => {
    const diana = await ctxFor('diana.cruz')
    const sys = await systemContext()
    const account = await b2bAccount('diana.cruz', 'corporate')
    const deal = await createDeal(diana, { accountId: account, pipelineId: b2bPipe, title: `Pausa ${tag()}`, nextStep: 'Enviar propuesta', nextStepDue: day(1) })
    // estancado y con el próximo paso vencido
    await admin`update crm.deals set stage_entered_at = now() - interval '90 days', next_step_due = ${day(-10)} where id = ${deal}`
    await admin`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id) values ('MX', ${account}, ${deal}, 'task', 'Enviar propuesta', now() - interval '10 days', ${diana.user.id})`
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    const openAlerts = async () => (await admin<{ kind: string }[]>`select kind from crm.exceptions where deal_id = ${deal} and resolved_at is null order by kind`).map((e) => e.kind)
    expect(await openAlerts()).toEqual(['no_next_step', 'stalled_deal'])

    await expect(pauseDeal(diana, deal, { reason: '', reviewOn: day(20) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(pauseDeal(diana, deal, { reason: 'Cliente pidió esperar', reviewOn: day(0) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(pauseDeal(diana, deal, { reason: `Pagar a la cuenta ${CARD}`, reviewOn: day(20) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(pauseDeal(await ctxFor('luis.tovar'), deal, { reason: 'No', reviewOn: day(20) })).rejects.toMatchObject({ code: 'forbidden' })
    await pauseDeal(diana, deal, { reason: 'El cliente cierra presupuesto en enero', reviewOn: day(20) })
    expect(await openAlerts()).toEqual([])
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    expect(await openAlerts()).toEqual([])
    // Dos tareas cerradas: la que se insertó arriba y la del próximo paso, que desde el paquete operaciones es una tarea del carril de quien vende.
    expect((await audits('deal.paused', deal))[0]?.after).toMatchObject({ paused: true, review_on: day(20), tasks_closed: 2 })

    const paused = await getBoard(diana, b2bPipe, { paused: true })
    expect(paused?.deals.map((d) => d.id)).toContain(deal)
    expect(paused?.deals.every((d) => d.paused_at !== null)).toBe(true)
    expect((await getDeal(diana, deal))?.deal).toMatchObject({ pause_reason: 'El cliente cierra presupuesto en enero', pause_review_on: day(20) })

    // hoy no está en la lista; el día de la revisión, sí
    const inQueue = async () => (await getQueue(diana)).rows.some((r) => r.dealId === deal && r.type === 'task')
    expect(await inQueue()).toBe(false)
    await admin`update crm.activities set due_at = now() - interval '1 hour' where deal_id = ${deal} and done_at is null and custom ? 'pause_review'`
    expect(await inQueue()).toBe(true)

    await resumeDeal(diana, deal)
    expect(await one(admin`select paused_at, pause_reason, pause_review_on from crm.deals where id = ${deal}`)).toMatchObject({ paused_at: null, pause_reason: null, pause_review_on: null })
    expect((await audits('deal.resumed', deal)).length).toBe(1)
    expect(await inQueue()).toBe(false)
  })

  it('un negocio que se cierra sale de la pausa', async () => {
    const diana = await ctxFor('diana.cruz')
    const deal = await createDeal(diana, { accountId: await b2bAccount('diana.cruz'), pipelineId: b2bPipe, title: `Pausa ${tag()}`, nextStep: 'Reunión', nextStepDue: day(1) })
    await pauseDeal(diana, deal, { reason: 'Esperan a su área legal', reviewOn: day(30) })
    const lost = (await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${b2bPipe} and kind = 'lost'`)).id
    await moveDeal(diana, deal, lost, { reasonCode: 'b2b_postponed' })
    expect(await one(admin`select status, paused_at, pause_reason from crm.deals where id = ${deal}`)).toMatchObject({ status: 'lost', paused_at: null, pause_reason: null })
  })

  it('cada embudo ofrece los motivos de su tipo de venta y el dominio no acepta los de otro', async () => {
    const diana = await ctxFor('diana.cruz')
    const b2b = (await lossReasonsFor(diana, 'MX', 'b2b')).map((r) => r.code)
    const d2d = (await lossReasonsFor(diana, 'MX', 'd2d')).map((r) => r.code)
    expect(b2b).toEqual(expect.arrayContaining(['b2b_integration', 'b2b_certification', 'b2b_volume', 'b2b_integrator', 'b2b_postponed', 'price']))
    expect(b2b).not.toContain('store_closed_down')
    expect(d2d).toEqual(expect.arrayContaining(['store_closed_down', 'store_no_interest', 'signup_blocked', 'other_provider', 'no_cash_handling', 'landline_only', 'price']))
    expect(d2d).not.toContain('b2b_integration')
    // Los motivos de calle son de México (0018, ola 4): US conserva los generales hasta que defina los suyos.
    const usDealer = (await lossReasonsFor(await ctxFor('sam.ortiz'), 'US', 'dealer')).map((r) => r.code)
    expect(usDealer).toEqual(expect.arrayContaining(['price', 'competitor', 'no_response']))
    for (const code of ['no_cash_handling', 'landline_only', 'product_not_offered', 'owner_unavailable']) expect(usDealer, code).not.toContain(code)
    const deal = await createDeal(diana, { accountId: await b2bAccount('diana.cruz'), pipelineId: b2bPipe, title: `Motivo ${tag()}`, nextStep: 'Reunión', nextStepDue: day(1) })
    const lost = (await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${b2bPipe} and kind = 'lost'`)).id
    await expect(moveDeal(diana, deal, lost, { reasonCode: 'store_closed_down' })).rejects.toMatchObject({ code: 'invalid' })
    await moveDeal(diana, deal, lost, { reasonCode: 'b2b_integration' })
    expect(await one(admin`select status, loss_reason_code from crm.deals where id = ${deal}`)).toMatchObject({ status: 'lost', loss_reason_code: 'b2b_integration' })
  })

  it('administración agrega un motivo y decide en qué embudos se ofrece', async () => {
    const nora = await ctxFor('nora.salas')
    const code = await createLossReason(nora, { labelEs: `Prueba b2b ${tag()}`, labelEn: `B2b test ${tag()}`, market: '', motors: ['event'] })
    expect((await lossReasonsFor(nora, 'MX', 'event')).map((r) => r.code)).toContain(code)
    expect((await lossReasonsFor(nora, 'MX', 'b2b')).map((r) => r.code)).not.toContain(code)
    await updateLossReason(nora, code, { motors: ['event', 'b2b'], active: true })
    expect((await lossReasonsFor(nora, 'MX', 'b2b')).map((r) => r.code)).toContain(code)
    await updateLossReason(nora, code, { motors: [], active: false })
    expect((await lossReasonsFor(nora, 'MX', 'b2b')).map((r) => r.code)).not.toContain(code)
    await expect(createLossReason(await ctxFor('paula.mendez'), { labelEs: 'Prueba b2b no', labelEn: 'B2b test no', market: '', motors: [] })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('contactos de una cuenta corporativa', () => {
  it('varios contactos con rol corporativo, uno principal, idioma preferido y móvil que recibe SMS', async () => {
    const diana = await ctxFor('diana.cruz')
    const id = await b2bAccount('diana.cruz', 'corporate')
    const first = await addContact(diana, id, { fullName: 'Compras De Prueba', role: 'purchasing', phone: '5512345678', locale: 'es', sms: true })
    const second = await addContact(diana, id, { fullName: 'Integración De Prueba', role: 'technology', email: 'integracion@prueba.test', locale: 'en', sms: true })
    const links = async () => admin<{ contact_id: string; role: string; is_primary: boolean; preferred_locale: string | null; sms_capable: boolean | null }[]>`
      select ac.contact_id, ac.role, ac.is_primary, c.preferred_locale, c.sms_capable from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${id} and ac.valid_to is null order by c.full_name`
    expect(await links()).toEqual([
      { contact_id: first, role: 'purchasing', is_primary: true, preferred_locale: 'es', sms_capable: true },
      // sin teléfono no se sabe si recibe SMS
      { contact_id: second, role: 'technology', is_primary: false, preferred_locale: 'en', sms_capable: null },
    ])
    await setPrimaryContact(diana, id, second)
    expect((await links()).map((l) => l.is_primary)).toEqual([false, true])
    const third = await addContact(diana, id, { fullName: 'Legal De Prueba', role: 'legal', primary: true })
    expect((await links()).filter((l) => l.is_primary).map((l) => l.contact_id)).toEqual([third])
    await expect(admin`update crm.account_contacts set is_primary = true where account_id = ${id}`).rejects.toMatchObject({ code: '23505' })
    for (const role of ['executive', 'finance', 'operations'] as const) await addContact(diana, id, { fullName: `Contacto ${role}`, role })
    expect((await getAccount(diana, id))?.contacts[0]).toMatchObject({ id: third, is_primary: true })
  })
})

describe('próximos pasos por tipo de venta', () => {
  it('B2B ofrece reunión, propuesta, contrato, arranque de integración, pruebas y certificación; no visitar', () => {
    expect(NEXT_SETS.b2b).toEqual(expect.arrayContaining(['meeting', 'proposal', 'contract', 'kickoff', 'testing', 'certification', 'task', 'none']))
    expect(NEXT_SETS.b2b).not.toContain('visit')
    expect(NEXT_SETS.default).toEqual(['call', 'visit', 'proposal', 'meeting', 'task', 'none'])
  })

  it('las tareas de Hoy traen el tipo de venta de su negocio', async () => {
    const diana = await ctxFor('diana.cruz')
    const deal = await createDeal(diana, { accountId: await b2bAccount('diana.cruz'), pipelineId: b2bPipe, title: `Hoy ${tag()}`, nextStep: 'Reunión', nextStepDue: day(0) })
    await admin`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id)
                select market_code, account_id, id, 'task', 'Reunión de arranque', now() - interval '1 hour', owner_id from crm.deals where id = ${deal}`
    const row = (await getQueue(diana)).rows.find((r) => r.dealId === deal)
    expect(row?.motor).toBe('b2b')
  })
})

describe('formularios web y equipos sin supervisión', () => {
  it('el formulario B2B pide lo mínimo para calificar y la respuesta queda en el lead; administración decide qué pide', async () => {
    const nora = await ctxFor('nora.salas')
    const sys = await systemContext()
    const form = await one(admin<{ id: string; ask_fields: string[] }[]>`select id, ask_fields from crm.web_forms where slug = 'contacto-mx'`)
    expect(form.ask_fields).toEqual(['b2b_points_of_sale', 'b2b_monthly_volume', 'b2b_integration'])
    const fields = await admin<{ key: string }[]>`select key from app.form_fields('contacto-mx')`
    expect(fields.map((f) => f.key)).toEqual(['b2b_points_of_sale', 'b2b_monthly_volume', 'b2b_integration'])
    const { leadId } = await intakeFromForm(sys, 'contacto-mx', {
      business_name: `Cadena Formulario ${tag()}`, contact_name: 'Contacto De Prueba', phone: '5587654321',
      x_b2b_points_of_sale: '35', x_b2b_integration: 'API', x_b2b_monthly_volume: 'mucho', x_otro: 'no se guarda',
    }, `prueba-b2b-${tag()}`)
    expect((await one(admin<{ custom: Record<string, unknown> }[]>`select custom from crm.leads where id = ${leadId}`)).custom).toEqual({ b2b_points_of_sale: 35, b2b_integration: 'API' })

    await updateForm(nora, form.id, { name: 'Contacto comercial México', askFields: ['b2b_points_of_sale', 'no_existe'] })
    expect((await one(admin<{ ask_fields: string[] }[]>`select ask_fields from crm.web_forms where id = ${form.id}`)).ask_fields).toEqual(['b2b_points_of_sale'])
    expect((await audits('form.updated', form.id)).length).toBe(1)
    await expect(updateForm(await ctxFor('ana.robles'), form.id, { name: 'No', askFields: [] })).rejects.toMatchObject({ code: 'forbidden' })
    await updateForm(nora, form.id, { name: 'Contacto comercial México', askFields: form.ask_fields })
    expect((await getB2bConfig(nora)).forms.find((f) => f.id === form.id)?.ask_fields).toEqual(form.ask_fields)
  })

  it('un equipo sin nadie en supervisión aparece con quien lidera el mercado', async () => {
    const nora = await ctxFor('nora.salas')
    const name = `Prueba b2b ${tag()}`
    await createTeam(nora, { market: 'MX', name, motor: 'b2b' })
    const rows = await teamsWithoutSupervisor(nora)
    expect(rows.find((r) => r.name === name)).toMatchObject({ market_code: 'MX', lead: 'Ana Robles', members: 0 })
    // el equipo B2B sembrado sí tiene supervisión
    expect(rows.some((r) => r.name === 'B2B México')).toBe(false)
    expect(await personaId('paula.mendez')).toBeTruthy()
  })
})
