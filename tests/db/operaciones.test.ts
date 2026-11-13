import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId } from './helpers'
import { createDeal, moveDeal, updateDeal } from '@/domain/deals'
import { addDealItem, bulkCloseLost, markNoticeSeen, removeDealItem, saveOpsCatalog, saveProduct, setMerchantRef, setOpsCheck, setOpsStep, setPipelineFlags, setTraining, takeDeal } from '@/domain/ops'
import { createAccount } from '@/domain/accounts'
import { updateCustom } from '@/domain/custom'
import { addActivity } from '@/domain/activities'
import { completeItem } from '@/domain/queue'
import { getQueue } from '@/dal/queue'
import { getOpsQueue, myNotices, staleDeals } from '@/dal/ops'
import { addDays, isoDay } from '@/lib/format'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const today = isoDay(new Date(), 'America/New_York')
const tomorrow = addDays(today, 1)
const uid = (k: string) => one(admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`).then((r) => r.id)
const stage = async (pipe: string, code: string) => (await one(admin<{ id: string }[]>`select s.id from crm.stages s where s.pipeline_id = md5(${'contigo:' + pipe})::uuid and s.code = ${code}`)).id

/** Un comercio nuevo de Jade (ventas US), con su id. */
async function jadeAccount(segment: 'dealer' | 'orders' | 'event' | 'other' = 'dealer') {
  const jade = await ctxFor('jade.kim')
  const out = await createAccount(jade, { market: 'US', kind: 'store', name: `Operaciones prueba ${tag()}`, segment, force: true, reason: 'Prueba: es otro comercio' })
  return { jade, accountId: out.id! }
}

describe('pedidos: varios negocios abiertos, líneas de producto y canales del formulario', () => {
  it('los canales Orders, Events y Other guardan, y un error dice qué campo falla', async () => {
    for (const s of ['orders', 'event', 'other'] as const) expect((await jadeAccount(s)).accountId).toBeTruthy()
    const jade = await ctxFor('jade.kim')
    await expect(createAccount(jade, { market: 'US', kind: 'store', name: 'x', segment: 'orders' })).rejects.toMatchObject({ code: 'invalid', en: expect.stringContaining('Name') })
    await expect(createAccount(jade, { market: 'US', kind: 'store', name: 'Canal raro', segment: 'nope' as 'orders' })).rejects.toMatchObject({ en: expect.stringContaining('Channel') })
  })

  it('en el embudo de pedidos un comercio lleva dos negocios abiertos; en el de alta, uno', async () => {
    const { jade, accountId } = await jadeAccount('orders')
    const orders = await uid('p-us-orders')
    const dealer = await uid('p-us-dealer')
    const a = await createDeal(jade, { accountId, pipelineId: orders, title: 'Pedido uno', nextStep: 'Confirmar pedido', nextStepDue: today })
    const b = await createDeal(jade, { accountId, pipelineId: orders, title: 'Pedido dos', nextStep: 'Confirmar pedido', nextStepDue: today })
    expect(a).not.toBe(b)
    await createDeal(jade, { accountId, pipelineId: dealer, title: 'Alta', nextStep: 'Llamar', nextStepDue: today })
    await expect(createDeal(jade, { accountId, pipelineId: dealer, title: 'Alta dos', nextStep: 'Llamar', nextStepDue: today })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('el monto del negocio es la suma de sus líneas; sin líneas no entra a revisión de Operaciones', async () => {
    const { jade, accountId } = await jadeAccount('orders')
    const id = await createDeal(jade, { accountId, pipelineId: await uid('p-us-orders'), title: `Pedido ${tag()}`, nextStep: 'Confirmar', nextStepDue: today })
    const review = await stage('p-us-orders', 'review')
    await expect(moveDeal(jade, id, review)).rejects.toMatchObject({ code: 'stage_gate', en: expect.stringContaining('product line') })
    await addDealItem(jade, id, { productId: await uid('prod-us-sim'), quantity: 300 })
    await addDealItem(jade, id, { productId: await uid('prod-us-topup'), quantity: 2, unitPrice: 40 })
    const d = await one(admin<{ amount_minor: string }[]>`select amount_minor from crm.deals where id = ${id}`)
    expect(Number(d.amount_minor)).toBe(300 * 250 + 2 * 4000)
    const items = await admin<{ id: string; sum_minor: string }[]>`select id, sum_minor from crm.deal_items where deal_id = ${id} order by position`
    await removeDealItem(jade, id, items[1]!.id)
    expect(Number((await one(admin<{ amount_minor: string }[]>`select amount_minor from crm.deals where id = ${id}`)).amount_minor)).toBe(75000)
    await expect(addDealItem(jade, id, { productId: await uid('prod-mx-chip'), quantity: 1 })).rejects.toMatchObject({ code: 'invalid' }) // producto de otro mercado
    await expect(addDealItem(jade, id, { productId: await uid('prod-us-sim'), quantity: 0 })).rejects.toMatchObject({ es: expect.stringContaining('cantidad') })
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action in ('deal.item_added', 'deal.item_removed')`).length).toBe(3)
    // un embudo sin líneas no las acepta
    const alta = await createDeal(jade, { accountId, pipelineId: await uid('p-us-dealer'), title: 'Alta', nextStep: 'Llamar', nextStepDue: today })
    await expect(addDealItem(jade, alta, { productId: await uid('prod-us-sim'), quantity: 1 })).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('el próximo paso de un negocio llega a Hoy, con un carril para Ventas y otro para Operaciones', () => {
  it('crear y editar el próximo paso deja una sola tarea de quien vende, y completarla programa la siguiente', async () => {
    const { jade, accountId } = await jadeAccount()
    const id = await createDeal(jade, { accountId, pipelineId: await uid('p-us-dealer'), title: `Paso ${tag()}`, nextStep: 'Llamar al dueño', nextStepDue: today })
    const tasks = () => admin<{ id: string; subject: string; owner_id: string; done_at: Date | null; deal_step: string }[]>`select id, subject, owner_id, done_at, deal_step from crm.activities where deal_id = ${id} and deal_step is not null order by created_at`
    expect(await tasks()).toMatchObject([{ subject: 'Llamar al dueño', owner_id: jade.user.id, deal_step: 'sales', done_at: null }])
    expect((await getQueue(jade)).rows.some((r) => r.type === 'task' && r.dealId === id)).toBe(true)
    await updateDeal(jade, id, { nextStep: 'Enviar solicitud', nextStepDue: tomorrow })
    expect(await tasks()).toMatchObject([{ subject: 'Enviar solicitud', done_at: null }])
    const t = (await tasks())[0]!
    const out = await completeItem(jade, { type: 'task', id: t.id, result: 'reached', next: 'call', when: tomorrow })
    expect(out.due).toBe(tomorrow)
    const after = await tasks()
    expect(after.filter((x) => !x.done_at).length).toBe(1)
    expect((await one(admin<{ next_step: string }[]>`select next_step from crm.deals where id = ${id}`)).next_step).toBe(after.find((x) => !x.done_at)!.subject)
  })

  it('el próximo paso de Operaciones no pisa el de la vendedora: dos responsables, dos pendientes', async () => {
    const { jade, accountId } = await jadeAccount()
    const tom = await ctxFor('tom.reyes')
    const id = await createDeal(jade, { accountId, pipelineId: await uid('p-us-dealer'), title: `Dos carriles ${tag()}`, nextStep: 'Llamar al dueño', nextStepDue: tomorrow })
    await setOpsStep(tom, id, 'Revisar documentos', today)
    const d = await one(admin<{ next_step: string; ops_next_step: string; ops_owner_id: string }[]>`select next_step, ops_next_step, ops_owner_id from crm.deals where id = ${id}`)
    expect(d).toMatchObject({ next_step: 'Llamar al dueño', ops_next_step: 'Revisar documentos', ops_owner_id: tom.user.id })
    const mine = (await getQueue(tom)).rows.find((r) => r.dealId === id)
    expect(mine?.subject).toBe('Revisar documentos')
    // Operaciones completa con sus resultados y programa lo suyo: el paso de ventas sigue igual
    await expect(completeItem(jade, { type: 'task', id: mine!.id, result: 'docs_received', next: 'none', when: '' })).rejects.toBeTruthy()
    const out = await completeItem(tom, { type: 'task', id: mine!.id, result: 'docs_received', next: 'provider', when: tomorrow })
    expect(out.next).toContain('proveedor')
    expect(await one(admin`select outcome, ops_outcome from crm.activities where id = ${mine!.id}`)).toMatchObject({ outcome: 'done', ops_outcome: 'docs_received' })
    const d2 = await one(admin<{ next_step: string; ops_next_step: string }[]>`select next_step, ops_next_step from crm.deals where id = ${id}`)
    expect(d2.next_step).toBe('Llamar al dueño')
    expect(d2.ops_next_step).toBe(out.next)
    await expect(setOpsStep(jade, id, 'No me toca', today)).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('entrega de Ventas a Operaciones, cola y devolución', () => {
  /** Un negocio de Jade en Solicitud, listo para entregar. */
  async function ready() {
    const { jade, accountId } = await jadeAccount()
    const id = await createDeal(jade, { accountId, pipelineId: await uid('p-us-dealer'), title: `Entrega ${tag()}`, nextStep: 'Reunir documentos', nextStepDue: today })
    const contact = await one(admin<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('US', 'Persona de prueba') returning id`)
    await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${accountId}, ${contact.id}, 'US', 'decision_maker')`
    // La entrega a Operaciones pide monto y "Cuenta ACH o prepago" (ola 4, ajustes-campo): un negocio listo para entregar ya los trae.
    await updateDeal(jade, id, { decisionMakerId: contact.id, decisionMakerMet: true, amount: 1200 })
    await updateCustom(jade, 'deal', id, { account_funding: 'ACH' })
    await moveDeal(jade, id, await stage('p-us-dealer', 'application'))
    return { jade, id, accountId }
  }

  it('al entrar a una etapa de Operaciones el negocio pasa a su cola, y quien vende ya no lo avanza (dominio y base)', async () => {
    const { jade, id } = await ready()
    const tom = await ctxFor('tom.reyes')
    const carrier = await stage('p-us-dealer', 'carrier')
    const awaiting = await stage('p-us-dealer', 'awaiting')
    // saltarse la etapa de Operaciones tampoco se puede
    await expect(moveDeal(jade, id, awaiting)).rejects.toMatchObject({ code: 'ops_only' })
    await moveDeal(jade, id, carrier)
    const d = await one(admin<{ ops_entered_at: Date | null }[]>`select ops_entered_at from crm.deals where id = ${id}`)
    expect(d.ops_entered_at).not.toBeNull()
    // sale de la cancha de quien vende: su tarea de próximo paso queda cumplida
    expect((await admin`select 1 from crm.activities where deal_id = ${id} and deal_step = 'sales' and done_at is null`).length).toBe(0)
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action = 'deal.handed_to_ops'`).length).toBe(1)
    const q = await getOpsQueue(tom, { view: 'unassigned' })
    expect(q.rows.find((r) => r.id === id)).toMatchObject({ market_code: 'US', seller: 'Jade Kim', ops_owner: null })
    expect((await getOpsQueue(await ctxFor('valeria.soto'), { view: 'all' })).rows.some((r) => r.id === id)).toBe(false) // Operaciones de MX no ve US
    // quien vende no avanza ni aprueba su negocio dentro de Operaciones
    await expect(moveDeal(jade, id, awaiting)).rejects.toMatchObject({ code: 'ops_only' })
    await expect(moveDeal(await ctxFor('kira.dunn'), id, awaiting)).rejects.toMatchObject({ code: 'ops_only' })
    const code = await asPersona('jade.kim', (tx) => attempt(tx, (sp) => sp`update crm.deals set stage_id = ${awaiting} where id = ${id}`))
    expect(code).toBe('42501')
    await expect(takeDeal(jade, id)).rejects.toMatchObject({ code: 'forbidden' })
    await takeDeal(tom, id)
    expect((await getOpsQueue(tom, { view: 'mine' })).rows.some((r) => r.id === id)).toBe(true)
    expect((await getOpsQueue(tom, { view: 'unassigned' })).rows.some((r) => r.id === id)).toBe(false)
    await moveDeal(tom, id, awaiting)
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${id}`)).stage_id).toBe(awaiting)
  })

  it('devolver a Ventas pide motivo, regresa a la etapa de Ventas y le deja a la vendedora una tarea para hoy', async () => {
    const { jade, id } = await ready()
    const tom = await ctxFor('tom.reyes')
    const application = await stage('p-us-dealer', 'application')
    await moveDeal(jade, id, await stage('p-us-dealer', 'carrier'))
    await expect(moveDeal(tom, id, application)).rejects.toMatchObject({ code: 'return_reason_required' })
    await expect(moveDeal(tom, id, application, undefined, undefined, { ret: { reasonCode: 'inventado' } })).rejects.toMatchObject({ code: 'return_reason_required' })
    await moveDeal(tom, id, application, undefined, undefined, { ret: { reasonCode: 'docs_missing', note: 'Falta el permiso' } })
    const d = await one(admin<{ stage_id: string; title: string; next_step: string }[]>`select stage_id, title, next_step from crm.deals where id = ${id}`)
    expect(d.stage_id).toBe(application)
    expect(d.next_step).toBe(`Operations sent back ${d.title}: Documents are missing. Falta el permiso`)
    const row = (await getQueue(jade)).rows.find((r) => r.dealId === id)
    expect(row?.subject).toContain('Operaciones devolvió') // quien lee en español lo ve en español (ola 4); el texto guardado sigue en el idioma de la vendedora
    expect((await one(admin<{ after: { reason: string } }[]>`select after from crm.audit_events where object_id = ${id} and action = 'deal.returned_to_sales'`)).after.reason).toBe('docs_missing')
  })

  it('Operaciones mantiene Merchant ID, proveedores, documentos y capacitación; ventas no, y no se guardan datos prohibidos', async () => {
    const { jade, id, accountId } = await ready()
    const tom = await ctxFor('tom.reyes')
    const cat = async (code: string) => (await one(admin<{ id: string }[]>`select id from crm.ops_catalog where market_code = 'US' and code = ${code}`)).id
    await setMerchantRef(tom, accountId, 'M-204518')
    await expect(setMerchantRef(jade, accountId, 'M-1')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setMerchantRef(tom, accountId, ['4111', '1111', '1111', '1111'].join(' '))).rejects.toMatchObject({ code: 'invalid' })
    await setOpsCheck(tom, id, await cat('carrier_north'), { status: 'sent', onDate: today })
    await setOpsCheck(tom, id, await cat('carrier_north'), { status: 'approved', onDate: today })
    await setOpsCheck(tom, id, await cat('application'), { status: 'received', link: 'https://drive.example.test/folder/abc' })
    await expect(setOpsCheck(tom, id, await cat('application'), { status: 'approved' })).rejects.toMatchObject({ code: 'invalid' }) // estado de proveedor en un documento
    await expect(setOpsCheck(tom, id, await cat('application'), { status: 'received', link: 'file:///tmp/id.png' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setOpsCheck(jade, id, await cat('application'), { status: 'validated' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setTraining(tom, id, 'scheduled', '')).rejects.toMatchObject({ code: 'invalid' })
    await setTraining(tom, id, 'scheduled', tomorrow)
    const checks = await admin<{ status: string }[]>`select status from crm.deal_ops_checks where deal_id = ${id} order by status`
    expect(checks.map((c) => c.status)).toEqual(['approved', 'received'])
    expect((await one(admin<{ merchant_ref: string }[]>`select merchant_ref from crm.accounts where id = ${accountId}`)).merchant_ref).toBe('M-204518')
    // la base repite el límite: ventas no escribe estados de Operaciones
    const proof = await cat('address_proof')
    const code = await asPersona('jade.kim', async (tx) => attempt(tx, (sp) => sp`insert into crm.deal_ops_checks (deal_id, market_code, catalog_id, status) values (${id}, 'US', ${proof}, 'received')`))
    expect(code).toBe('42501')
  })
})

describe('avisos, cierre en bloque, ganar a mano y etapa inicial', () => {
  it('avisar a alguien desde una nota: le aparece a esa persona, la marca vista y nadie más la ve', async () => {
    const { jade, accountId } = await jadeAccount()
    const tom = await ctxFor('tom.reyes')
    const subject = `Revisar domicilio ${tag()}`
    await addActivity(jade, { accountId, kind: 'note', subject, notify: tom.user.id })
    const mine = await myNotices(tom)
    const n = mine.find((x) => x.body.includes(subject))
    expect(n).toMatchObject({ from_name: 'Jade Kim', account_id: accountId })
    expect((await myNotices(await ctxFor('sam.ortiz'))).some((x) => x.body.includes(subject))).toBe(false)
    await markNoticeSeen(await ctxFor('sam.ortiz'), n!.id) // no es suya: no cambia nada
    expect((await myNotices(tom)).some((x) => x.id === n!.id)).toBe(true)
    await markNoticeSeen(tom, n!.id)
    expect((await myNotices(tom)).some((x) => x.id === n!.id)).toBe(false)
    // solo a quien ve el registro, y solo desde una nota
    await expect(addActivity(jade, { accountId, kind: 'note', subject: 'Otra', notify: await personaId('marco.pena') })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addActivity(jade, { accountId, kind: 'call', notify: tom.user.id })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('cerrar en bloque los negocios sin movimiento: con motivo, auditado por negocio, y no para ventas', async () => {
    const { jade, accountId } = await jadeAccount('orders')
    const orders = await uid('p-us-orders')
    const ids = [await createDeal(jade, { accountId, pipelineId: orders, title: `Viejo ${tag()}`, nextStep: 'Confirmar', nextStepDue: today }),
      await createDeal(jade, { accountId, pipelineId: orders, title: `Viejo ${tag()}`, nextStep: 'Confirmar', nextStepDue: today })]
    await admin`update crm.deals set stage_entered_at = now() - interval '40 days', created_at = now() - interval '40 days' where id = any(${ids}::uuid[])`
    await admin`update crm.activities set created_at = now() - interval '40 days' where deal_id = any(${ids}::uuid[])`
    const tom = await ctxFor('tom.reyes')
    const stale = await staleDeals(tom, orders, 30)
    expect(ids.every((id) => stale.some((s) => s.id === id))).toBe(true)
    expect((await staleDeals(tom, orders, 60)).some((s) => ids.includes(s.id))).toBe(false)
    await expect(bulkCloseLost(jade, ids, 'no_response', '')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(bulkCloseLost(tom, ids, '', '')).rejects.toMatchObject({ code: 'invalid' })
    expect(await bulkCloseLost(tom, ids, 'no_response', 'Sin respuesta en un mes')).toEqual({ closed: 2, skipped: 0 })
    expect((await admin`select 1 from crm.deals where id = any(${ids}::uuid[]) and status = 'lost' and loss_reason_code = 'no_response'`).length).toBe(2)
    expect((await admin`select 1 from crm.audit_events where object_id = any(${ids}::uuid[]) and action = 'deal.stage_changed' and after ->> 'bulk' = 'true'`).length).toBe(2)
  })

  it('ganar a mano con la fecha real de cierre: hoy o anterior, nunca futura', async () => {
    const { jade, accountId } = await jadeAccount('orders')
    const orders = await uid('p-us-orders')
    const tom = await ctxFor('tom.reyes')
    const id = await createDeal(jade, { accountId, pipelineId: orders, title: `Ganar ${tag()}`, nextStep: 'Confirmar', nextStepDue: today })
    await addDealItem(jade, id, { productId: await uid('prod-us-sim'), quantity: 10 })
    await moveDeal(jade, id, await stage('p-us-orders', 'review'))
    const won = await stage('p-us-orders', 'fulfilled')
    await expect(moveDeal(jade, id, won)).rejects.toMatchObject({ code: 'ops_only' })
    await expect(moveDeal(tom, id, won, undefined, undefined, { wonOn: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    const on = addDays(today, -3)
    await moveDeal(tom, id, won, undefined, undefined, { wonOn: on })
    const d = await one(admin<{ status: string; day: string; closed_by: string }[]>`select status, (won_at at time zone 'America/New_York')::date::text as day, closed_by from crm.deals where id = ${id}`)
    expect(d).toEqual({ status: 'won', day: on, closed_by: 'manual' })
    expect((await admin`select 1 from crm.activities where deal_id = ${id} and deal_step is not null and done_at is null`).length).toBe(0)
  })

  it('un negocio nuevo puede nacer en la etapa que le corresponde, con las mismas validaciones, y sin monto', async () => {
    const { jade, accountId } = await jadeAccount()
    const dealer = await uid('p-us-dealer')
    // Solicitud pide decisor contactado: un negocio nuevo no lo trae
    await expect(createDeal(jade, { accountId, pipelineId: dealer, title: 'Directo', nextStep: 'Llamar', nextStepDue: today, stageId: await stage('p-us-dealer', 'application') })).rejects.toMatchObject({ code: 'stage_gate' })
    await expect(createDeal(jade, { accountId, pipelineId: dealer, title: 'Directo', nextStep: 'Llamar', nextStepDue: today, stageId: await stage('p-us-dealer', 'carrier') })).rejects.toMatchObject({ code: 'invalid' })
    const marco = await ctxFor('marco.pena')
    const acc = await createAccount(marco, { market: 'MX', kind: 'store', name: `Abarrotes prueba ${tag()}`, segment: 'd2d', force: true, reason: 'Prueba: es otro comercio' })
    const b2b = await uid('p-mx-b2b')
    const diana = await ctxFor('diana.cruz')
    const acc2 = await createAccount(diana, { market: 'MX', kind: 'chain', name: `Cadena prueba ${tag()}`, segment: 'b2b', force: true, reason: 'Prueba: es otro comercio' })
    const mxToday = isoDay(new Date(), 'America/Mexico_City')
    await expect(createDeal(diana, { accountId: acc2.id!, pipelineId: b2b, title: 'Con propuesta', nextStep: 'Enviar', nextStepDue: mxToday, stageId: await stage('p-mx-b2b', 'propuesta') })).rejects.toMatchObject({ code: 'stage_gate' })
    const id = await createDeal(diana, { accountId: acc2.id!, pipelineId: b2b, title: 'Con propuesta', amount: 5000, nextStep: 'Enviar', nextStepDue: mxToday, stageId: await stage('p-mx-b2b', 'propuesta') })
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${id}`)).stage_id).toBe(await stage('p-mx-b2b', 'propuesta'))
    // el negocio de alta nace sin monto
    const alta = await createDeal(marco, { accountId: acc.id!, pipelineId: await uid('p-mx-d2d'), title: 'Alta', nextStep: 'Visitar', nextStepDue: mxToday })
    expect((await one(admin<{ amount_minor: string | null }[]>`select amount_minor from crm.deals where id = ${alta}`)).amount_minor).toBeNull()
  })

  it('administración mantiene catálogos, productos y las propiedades de embudo y etapa; nadie más', async () => {
    const nora = await ctxFor('nora.salas')
    const tom = await ctxFor('tom.reyes')
    const name = `Carrier ${tag()}`
    await saveOpsCatalog(nora, { market: 'US', kind: 'provider', labelEs: name, labelEn: name })
    await expect(saveOpsCatalog(nora, { market: 'US', kind: 'provider', labelEs: name, labelEn: name })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveOpsCatalog(tom, { market: 'US', kind: 'provider', labelEs: 'No', labelEn: 'No' })).rejects.toMatchObject({ code: 'forbidden' })
    await saveProduct(nora, { market: 'US', name: `Producto ${tag()}`, price: 12.5 })
    await expect(saveProduct(nora, { market: 'US', name: 'Sin precio', price: -1 })).rejects.toMatchObject({ en: expect.stringContaining('price') })
    const sv = await uid('p-sv-b2b')
    const st = await stage('p-sv-b2b', 'propuesta')
    await setPipelineFlags(nora, sv, { multiOpen: true, hasItems: true, opsStageIds: [st] })
    expect(await one(admin`select p.multi_open, p.has_items, (select is_ops from crm.stages where id = ${st}) as is_ops from crm.pipelines p where p.id = ${sv}`)).toMatchObject({ multi_open: true, has_items: true, is_ops: true })
    await setPipelineFlags(nora, sv, { multiOpen: false, hasItems: false, opsStageIds: [] })
    await expect(setPipelineFlags(tom, sv, { multiOpen: true, hasItems: true, opsStageIds: [] })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await admin`select 1 from crm.audit_events where action = 'pipeline.ops_configured' and object_id = ${sv}`).length).toBe(2)
  })
})
