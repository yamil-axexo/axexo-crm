import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId } from './helpers'
import { createDeal, moveDeal, updateDeal, missingForStage, winMissingText } from '@/domain/deals'
import { setMerchantRef } from '@/domain/ops'
import { createAccount } from '@/domain/accounts'
import { updateCustom } from '@/domain/custom'
import { recordActivity } from '@/domain/activities'
import { addStreetSeller, updateStreetSeller } from '@/domain/street'
import { exportFieldReport } from '@/domain/reports'
import { createLead } from '@/domain/leads'
import { getFieldReport } from '@/dal/reports'
import { listAccounts } from '@/dal/accounts'
import { visitorNames, noSaleReasons } from '@/dal/field'
import { streetSellers, streetSummary } from '@/dal/street'
import { gateInfo, getDealOps, getOpsQueue, myNotices } from '@/dal/ops'
import { lossReasonsFor } from '@/dal/b2b'
import { getDeal } from '@/dal/pipelines'
import { getAccount } from '@/dal/accounts'
import { addDays, isoDay } from '@/lib/format'

// Ola 4, paquete ajustes-campo: lo que la ronda de aceptación dejó abierto en campo y Operaciones. Cada regla con su prueba.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x')
const todayMX = isoDay(new Date(), 'America/Mexico_City')
const todayUS = isoDay(new Date(), 'America/New_York')
const uid = (k: string) => one(admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`).then((r) => r.id)
const stage = async (pipe: string, code: string) => (await one(admin<{ id: string }[]>`select s.id from crm.stages s where s.pipeline_id = md5(${'contigo:' + pipe})::uuid and s.code = ${code}`)).id
const DENIED = '42501'

/** Una tienda de Marco (MX, tiendas) sin negocio abierto. */
const marcoStore = (skip = 0) => one(admin<{ id: string; name: string }[]>`
  select a.id, a.name from crm.accounts a where a.owner_id = md5('contigo:marco.pena')::uuid and a.kind = 'store' and a.archived_at is null
     and not exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open')
     and not exists (select 1 from crm.activities x where x.account_id = a.id and x.kind = 'visit')
   order by a.id offset ${skip} limit 1`)

describe('catálogo de vendedores de calle (P1 parcial de Carlos y Beatriz)', () => {
  it('supervisión da de alta en su equipo, el nombre sale primero en "¿Quién visitó?", y quien vende no puede mantenerlo', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const marcoId = await personaId('marco.pena')
    const name = `Vendedora Catálogo ${tag()}`
    const id = await addStreetSeller(fer, { market: 'MX', name: `  ${name} `, reportsTo: marcoId })
    const row = await one(admin<{ name: string; team_id: string | null; reports_to: string; is_active: boolean }[]>`select name, team_id, reports_to, is_active from crm.street_sellers where id = ${id}`)
    expect(row).toMatchObject({ name, reports_to: marcoId, is_active: true })
    expect(row.team_id).toBe(await uid('t-d2d'))
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action = 'street_seller.added'`).length).toBe(1)
    // el mismo nombre no entra dos veces, y un nombre con números no es de persona
    await expect(addStreetSeller(fer, { market: 'MX', name: name.toUpperCase() })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addStreetSeller(fer, { market: 'MX', name: 'Vendedor 12' })).rejects.toMatchObject({ code: 'invalid' })
    // quien vende lo ve sugerido primero, aunque nunca haya visitado, y no lo puede mantener (dominio y base)
    const marco = await ctxFor('marco.pena')
    expect((await visitorNames(marco, 'MX'))[0]).toBe(name)
    await expect(addStreetSeller(marco, { market: 'MX', name: 'Otra Persona' })).rejects.toMatchObject({ code: 'forbidden' })
    await asPersona('marco.pena', async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into crm.street_sellers (market_code, name, created_by) values ('MX', 'Persona Colada', ${marcoId})`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`update crm.street_sellers set is_active = false, ended_at = now() where id = ${id}`)).toBe('0 rows')
    })
    // supervisión de otro mercado no la ve; la de US no puede dar de alta en MX
    expect(await asPersona('kira.dunn', async (tx) => (await tx`select 1 from crm.street_sellers where id = ${id}`).length)).toBe(0)
    await expect(addStreetSeller(await ctxFor('kira.dunn'), { market: 'MX', name: 'Persona Ajena' })).rejects.toMatchObject({ code: 'forbidden' })
    // a quién responde tiene que vender en ese mercado
    await expect(addStreetSeller(fer, { market: 'MX', name: 'Persona Sin Jefe', reportsTo: await personaId('jade.kim') })).rejects.toMatchObject({ code: 'invalid' })
    // baja: deja de sugerirse entre los del catálogo, el registro se conserva y no se puede dar de baja dos veces
    await updateStreetSeller(fer, id, { end: true })
    expect((await streetSellers(fer, 'MX')).some((s) => s.id === id)).toBe(false)
    expect((await visitorNames(marco, 'MX')).includes(name)).toBe(false)
    expect((await one(admin<{ ended_at: Date | null }[]>`select ended_at from crm.street_sellers where id = ${id}`)).ended_at).not.toBeNull()
    await expect(updateStreetSeller(fer, id, { end: true })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('las visitas se cuentan también por quien visitó: reporte de campo, CSV con la columna, filtro en Comercios y resumen en Mi equipo', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const marco = await ctxFor('marco.pena')
    const who = `Visitador Reporte ${tag()}`
    await addStreetSeller(fer, { market: 'MX', name: who, reportsTo: await personaId('marco.pena') })
    const a = await marcoStore(0)
    const b = await marcoStore(1)
    await recordActivity(marco, { accountId: a.id, kind: 'visit', outcome: 'sale', visitedBy: who, next: 'none', askNext: true })
    await recordActivity(marco, { accountId: b.id, kind: 'visit', outcome: 'no_sale', noSaleReason: 'not_interested', visitedBy: who.toLowerCase(), next: 'none', askNext: true })
    const report = await getFieldReport(fer, {})
    const rows = report.visitors.filter((r) => r.week === report.weeks[0] && r.visited_by?.toLowerCase() === who.toLowerCase())
    expect(rows.reduce((n, r) => n + r.visits, 0)).toBe(2)
    expect(rows.reduce((n, r) => n + r.sales, 0)).toBe(1)
    expect(rows.every((r) => r.owner_name === 'Marco Peña')).toBe(true)
    // por quien visitó suma lo mismo que por persona: no se pierde ni se duplica ninguna visita
    const total = (list: { week: string; visits: number }[]) => list.filter((r) => r.week === report.weeks[0]).reduce((n, r) => n + r.visits, 0)
    expect(total(report.visitors)).toBe(total(report.visits))
    const csv = (await exportFieldReport(fer, {}, 'visitas')).csv.replace(/^﻿/, '').split('\r\n')
    expect(csv[0]).toBe('Semana (lunes),Mercado,Equipo,Persona,Quién visitó,Visitas,Visitas con venta')
    expect(csv.some((l) => l.includes(who) && l.includes('Marco Peña'))).toBe(true)
    // filtro "Visitado por" en Comercios
    const list = await listAccounts(fer, { visito: who })
    expect(list.items.map((x) => x.id).sort()).toEqual([a.id, b.id].sort())
    expect((await listAccounts(fer, { visito: 'Nadie Con Ese Nombre' })).total).toBe(0)
    // resumen en Mi equipo, bajo quien lleva la cartera
    const sum = (await streetSummary(fer)).filter((r) => r.name.toLowerCase() === who.toLowerCase())
    expect(sum.length).toBe(1)
    expect(sum[0]).toMatchObject({ owner_name: 'Marco Peña', listed: true, visits_7d: 2, sales_7d: 1, stores_30d: 2 })
    // quien vende solo ve lo suyo: Lucía no ve las visitas de las tiendas de Marco
    expect((await streetSummary(await ctxFor('lucia.vega'))).some((r) => r.name.toLowerCase() === who.toLowerCase() && r.visits_7d > 0)).toBe(false)
  })
})

describe('ganar a mano no se queda a medias', () => {
  /** Un negocio de Marco en "Tienda visitada" (primera etapa), en el embudo de tiendas de MX puesto a ganar a mano. */
  async function d2dDeal() {
    await admin`update crm.pipelines set close_by_transaction = false where id = ${await uid('p-mx-d2d')}`
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(3)
    const id = await createDeal(marco, { accountId: store.id, pipelineId: await uid('p-mx-d2d'), title: `Ganar ${tag()}`, nextStep: 'Volver cuando esté el dueño', nextStepDue: addDays(todayMX, 3) })
    const won = (await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${await uid('p-mx-d2d')} and kind = 'won'`)).id
    return { marco, store, id, won }
  }

  it('si falta quien decide lo dice en lenguaje llano, la hoja trae con qué completarlo, y al ganar se cierra lo pendiente', async () => {
    const { marco, store, id, won } = await d2dDeal()
    const err = await moveDeal(marco, id, won, undefined, undefined, { wonOn: todayMX }).catch((e) => e)
    expect(err).toMatchObject({ code: 'stage_gate' })
    expect(err.es).toBe('Para ganarlo falta decir quién decide y marcar que ya hablaste con esa persona.')
    expect(err.en).toBe('To win it you still need to say who decides and mark that you have spoken with that person.')
    expect(err.es).not.toContain('Activa')
    // la hoja de ganar recibe lo que falta y los contactos para elegir, igual que el cambio de etapa
    const info = (await gateInfo(marco, id, won))!
    expect(info.missing).toEqual(['decision_maker'])
    const data = (await getDeal(marco, id))!
    expect(data.missingWin).toEqual(['decision_maker'])
    // una visita por hacer y una tarea suelta del mismo negocio
    await recordActivity(marco, { dealId: id, kind: 'visit', dueAt: addDays(todayMX, 2) })
    await recordActivity(marco, { dealId: id, kind: 'task', subject: 'Llevar material', dueAt: addDays(todayMX, 4) })
    const contact = await one(admin<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('MX', 'Persona Que Decide') returning id`)
    await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${store.id}, ${contact.id}, 'MX', 'owner')`
    await updateDeal(marco, id, { decisionMakerId: contact.id, decisionMakerMet: true })
    const closeOn = addDays(todayMX, -5)
    await moveDeal(marco, id, won, undefined, undefined, { wonOn: closeOn })
    const d = await one(admin<{ status: string; next_step: string | null; day: string }[]>`select status, next_step, (won_at at time zone 'America/Mexico_City')::date::text as day from crm.deals where id = ${id}`)
    expect(d).toEqual({ status: 'won', next_step: null, day: closeOn })
    // nada queda abierto, y la visita por hacer no se cuenta como visita hecha
    expect((await admin`select 1 from crm.activities where deal_id = ${id} and done_at is null and kind <> 'note'`).length).toBe(0)
    expect((await admin`select 1 from crm.visit_log where account_id = ${store.id} and origin = 'manual'`).length).toBe(0)
    // el hilo de la tienda dice la fecha de cierre elegida, no "Pasó a Activa"
    const thread = (await getAccount(marco, store.id))!.timeline.find((x) => x.kind === 'stage' && (x.meta as { kind?: string }).kind === 'won')!
    expect((thread.meta as { won_on?: string }).won_on).toBe(closeOn)
    // quien gana su propio negocio no se avisa a sí mismo
    expect((await myNotices(marco)).some((n) => n.deal_id === id)).toBe(false)
  })

  it('el texto llano junta dos faltantes con "y"', () => {
    expect(winMissingText(['amount', 'decision_maker'])[0]).toBe('Para ganarlo falta poner el monto esperado y decir quién decide y marcar que ya hablaste con esa persona.')
  })

  it('Operaciones no gana un negocio que Ventas no ha entregado; cuando gana uno entregado, a quien vendió le llega un aviso a Hoy', async () => {
    const jade = await ctxFor('jade.kim')
    const tom = await ctxFor('tom.reyes')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Ajustes entrega ${tag()}`, segment: 'dealer', force: true })
    const id = await createDeal(jade, { accountId: acc.id!, pipelineId: await uid('p-us-dealer'), title: `Alta ${tag()}`, nextStep: 'Reunir documentos', nextStepDue: todayUS })
    const won = await stage('p-us-dealer', 'won')
    const carrier = await stage('p-us-dealer', 'carrier')
    await admin`update crm.pipelines set close_by_transaction = false where id = ${await uid('p-us-dealer')}`
    await expect(moveDeal(tom, id, won, undefined, undefined, { wonOn: todayUS })).rejects.toMatchObject({ code: 'not_handed_over', status: 403 })
    // la entrega pide lo que la primera etapa de Operaciones tiene como requerido: monto y "Cuenta ACH o prepago", además de lo anterior
    const contact = await one(admin<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('US', 'Test Decider') returning id`)
    await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${acc.id!}, ${contact.id}, 'US', 'decision_maker')`
    await updateDeal(jade, id, { decisionMakerId: contact.id, decisionMakerMet: true })
    const gate = await moveDeal(jade, id, carrier).catch((e) => e)
    expect(gate).toMatchObject({ code: 'stage_gate' })
    expect(gate.en).toContain('expected amount')
    expect(gate.en).toContain('ACH or prepaid account')
    expect(gate.es).toContain('Cuenta ACH o prepago')
    const info = (await gateInfo(jade, id, carrier))!
    expect(info.missing).toEqual(['amount', 'field:account_funding'])
    expect(info.fields).toEqual([{ ref: 'field:account_funding', key: 'account_funding', label_es: 'Cuenta ACH o prepago', label_en: 'ACH or prepaid account', data_type: 'select', options: ['ACH', 'Prepaid'] }])
    await updateDeal(jade, id, { amount: 900 })
    await updateCustom(jade, 'deal', id, { account_funding: 'Prepaid' })
    await moveDeal(jade, id, carrier)
    // ya entregado, Operaciones lo gana y a Jade le llega el aviso, en su idioma
    await moveDeal(tom, id, won, undefined, undefined, { wonOn: todayUS })
    const notice = (await myNotices(jade)).find((n) => n.deal_id === id)
    expect(notice).toBeDefined()
    expect(notice!.body).toMatch(/^Tom Reyes marked .+ as won, with close date /)
  })

  it('una etapa puede pedir un campo adicional del negocio, y la regla es la misma función que usa la pantalla', () => {
    const base = { amount_minor: 100, next_step: 'x', next_step_due: '2026-01-01', decision_maker_id: null, decision_maker_met: false }
    expect(missingForStage({ ...base, custom: {} }, { kind: 'open', required_fields: ['field:account_funding'] })).toEqual(['field:account_funding'])
    expect(missingForStage({ ...base, custom: { account_funding: 'ACH' } }, { kind: 'open', required_fields: ['field:account_funding'] })).toEqual([])
  })
})

describe('Operaciones: lista de alta por embudo y Merchant ID duplicado', () => {
  it('un pedido en la cola no trae documentos, proveedores ni capacitación del alta de un dealer', async () => {
    const jade = await ctxFor('jade.kim')
    const tom = await ctxFor('tom.reyes')
    const orders = await one(admin<{ id: string; ops_checklist: boolean }[]>`select id, ops_checklist from crm.pipelines where market_code = 'US' and multi_open and is_active order by position limit 1`)
    expect(orders.ops_checklist).toBe(false)
    expect((await one(admin<{ ops_checklist: boolean }[]>`select ops_checklist from crm.pipelines where id = ${await uid('p-us-dealer')}`)).ops_checklist).toBe(true)
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Ajustes pedido ${tag()}`, segment: 'orders', force: true })
    const first = await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${orders.id} and kind = 'open' order by position limit 1`)
    const before = (await getOpsQueue(tom, { view: 'all' })).counts
    // el pedido entra directo a una etapa de Operaciones (como dueño del esquema: aquí se prueba la cola, no la entrega)
    const deal = await one(admin<{ id: string }[]>`
      insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due, created_by)
      values ('US', ${orders.id}, ${first.id}, ${acc.id!}, ${jade.user.id}, ${`Pedido ${tag()}`}, 'USD', 'Surtir', ${todayUS}, ${jade.user.id}) returning id`)
    await admin`update crm.stages set is_ops = true where id = ${first.id}`
    try {
      const q = await getOpsQueue(tom, { view: 'all' })
      const row = q.rows.find((r) => r.id === deal.id)!
      expect(row).toMatchObject({ docs_missing: 0, providers_pending: 0, checklist: false })
      expect(q.counts.all).toBe(before.all + 1)
      expect(q.counts.approval).toBe(before.approval)
      expect(q.counts.training).toBe(before.training)
      const ops = (await getDealOps(tom, deal.id))!
      expect(ops.checklist).toBe(false)
      expect(ops.checks).toEqual([])
    } finally {
      await admin`update crm.stages set is_ops = false where id = ${first.id}`
    }
  })

  it('el Merchant ID repetido en el mercado avisa cuál comercio lo tiene y pide confirmar; queda en la bitácora', async () => {
    const jade = await ctxFor('jade.kim')
    const tom = await ctxFor('tom.reyes')
    const a = await createAccount(jade, { market: 'US', kind: 'store', name: `Ajustes MID Uno ${tag()}`, segment: 'dealer', force: true })
    const b = await createAccount(jade, { market: 'US', kind: 'store', name: `Ajustes MID Dos ${tag()}`, segment: 'dealer', force: true })
    const ref = `MID-${tag().toUpperCase()}`
    await setMerchantRef(tom, a.id!, ref)
    const err = await setMerchantRef(tom, b.id!, ` ${ref.toLowerCase()} `).catch((e) => e)
    expect(err).toMatchObject({ code: 'merchant_ref_duplicate' })
    expect(err.es).toContain('Ajustes MID Uno')
    expect((await one(admin<{ merchant_ref: string | null }[]>`select merchant_ref from crm.accounts where id = ${b.id!}`)).merchant_ref).toBeNull()
    // guardar el mismo valor en el mismo comercio no es duplicado
    await setMerchantRef(tom, a.id!, ref)
    await setMerchantRef(tom, b.id!, ref, true)
    const ev = await one(admin<{ after: { duplicate_confirmed?: boolean } }[]>`select after from crm.audit_events where object_id = ${b.id!} and action = 'account.merchant_ref' order by at desc limit 1`)
    expect(ev.after.duplicate_confirmed).toBe(true)
    // el índice existe para buscarlo
    expect((await admin`select 1 from pg_indexes where schemaname = 'crm' and indexname = 'accounts_merchant_ref_idx'`).length).toBe(1)
  })
})

describe('visitas: motivo de la visita sin venta, la tarea que ya estaba y el primer contacto en persona', () => {
  it('una visita sin venta pide motivo del catálogo de calle y lo guarda', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(5)
    await expect(recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'no_sale', next: 'none', askNext: true })).rejects.toMatchObject({ code: 'invalid' })
    // un motivo de pérdida de negocio no es un motivo de visita
    await expect(recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'no_sale', noSaleReason: 'price', next: 'none', askNext: true })).rejects.toMatchObject({ code: 'invalid' })
    expect((await noSaleReasons(marco, ['MX'])).map((r) => r.code)).toContain('no_cash')
    const out = await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'no_sale', noSaleReason: 'no_cash', next: 'none', askNext: true })
    expect((await one(admin<{ no_sale_code: string }[]>`select no_sale_code from crm.activities where id = ${out.id}`)).no_sale_code).toBe('no_cash')
    const row = (await getAccount(marco, store.id))!.timeline.find((x) => x.kind === 'visit')!
    expect(row.meta).toMatchObject({ rejection: 'no_cash', rejection_es: 'Sin efectivo hoy' })
    // la base no deja poner motivo a una visita con venta
    expect(await admin`update crm.activities set no_sale_code = 'no_cash' where id = ${out.id} and outcome = 'sale'`.then((r) => r.count)).toBe(0)
    await expect(admin`insert into crm.activities (market_code, account_id, kind, subject, done_at, outcome, no_sale_code) values ('MX', ${store.id}, 'visit', 'x', now(), 'sale', 'no_cash')`).rejects.toMatchObject({ code: '23514' })
  })

  it('registrar una visita cierra la visita por hacer que ya estaba, sin contarla dos veces', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(6)
    const planned = await recordActivity(marco, { accountId: store.id, kind: 'visit', dueAt: addDays(todayMX, 3) })
    const done = await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'revisit', next: 'visit', nextWhen: addDays(todayMX, 2), askNext: true })
    const old = await one(admin<{ kind: string; done_at: Date | null }[]>`select kind, done_at from crm.activities where id = ${planned.id}`)
    expect(old.kind).toBe('task')
    expect(old.done_at).not.toBeNull()
    // queda un solo "Próximo": la visita nueva que se dejó programada
    const open = await admin<{ id: string; kind: string }[]>`select id, kind from crm.activities where account_id = ${store.id} and done_at is null`
    expect(open.length).toBe(1)
    expect(open[0]!.kind).toBe('visit')
    expect(open[0]!.id).not.toBe(done.id)
    expect((await admin`select 1 from crm.activities where account_id = ${store.id} and kind = 'visit' and done_at is not null`).length).toBe(1)
  })

  it('"Ya hablé con esta persona" deja el primer contacto como En persona, no como llamada', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await createLead(marco, { market: 'MX', businessName: `Abarrotes Ajustes ${tag()}`, contactName: 'Persona De Prueba', phone: '5512345678', motor: 'd2d', alreadyContacted: true })
    const a = await one(admin<{ kind: string; type_label: string | null; outcome: string }[]>`select kind, type_label, outcome from crm.activities where lead_id = ${id}`)
    expect(a).toEqual({ kind: 'meeting', type_label: 'in_person', outcome: 'reached' })
  })
})

describe('motivos de pérdida de calle: de México', () => {
  it('US conserva los generales; México ofrece los de calle en su embudo de tiendas', async () => {
    const us = (await lossReasonsFor(await ctxFor('jade.kim'), 'US', 'dealer')).map((r) => r.code)
    for (const code of ['no_cash_handling', 'landline_only', 'product_not_offered', 'owner_unavailable', 'store_closed_down']) expect(us, code).not.toContain(code)
    for (const code of ['price', 'competitor', 'no_response']) expect(us, code).toContain(code)
    const mx = (await lossReasonsFor(await ctxFor('marco.pena'), 'MX', 'd2d')).map((r) => r.code)
    for (const code of ['no_cash_handling', 'landline_only', 'store_closed_down', 'store_no_interest', 'price']) expect(mx, code).toContain(code)
    // y el dominio repite el límite: un negocio de US no se pierde con un motivo de calle de México
    const jade = await ctxFor('jade.kim')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Ajustes motivo ${tag()}`, segment: 'dealer', force: true })
    const id = await createDeal(jade, { accountId: acc.id!, pipelineId: await uid('p-us-dealer'), title: `Motivo ${tag()}`, nextStep: 'Llamar', nextStepDue: todayUS })
    const lost = await stage('p-us-dealer', 'lost')
    await expect(moveDeal(jade, id, lost, { reasonCode: 'landline_only' })).rejects.toMatchObject({ code: 'invalid' })
    await moveDeal(jade, id, lost, { reasonCode: 'no_response' })
    expect((await one(admin<{ status: string }[]>`select status from crm.deals where id = ${id}`)).status).toBe('lost')
  })
})
