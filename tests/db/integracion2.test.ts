import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { convertLead, createLead, disqualifyLead, intakeFromForm, qualifyLead, updateLeadDetails } from '@/domain/leads'
import { createDeal, moveDeal } from '@/domain/deals'
import { addDealItem, bulkCloseLost, takeDeal } from '@/domain/ops'
import { pauseDeal, updateForm } from '@/domain/b2b'
import { createAccount, CONTACT_ROLES } from '@/domain/accounts'
import { CONTACT_ROLES as LEAD_CONTACT_ROLES } from '@/domain/leads'
import { NEXT_SETS, NEXTS } from '@/domain/followup'
import { homePath } from '@/domain/policy'
import { firstStop } from '@/server/first-stop'
import { sheetConfig } from '@/server/sheet'
import { nextFor } from '@/ui/complete'
import { getQueue, getTeamQueue } from '@/dal/queue'
import { getOpsQueue, opsWaiting, staleDeals } from '@/dal/ops'
import { getClosedDeals, getLeadershipPanel, marketPeriods } from '@/dal/reports'
import { exportClosedDeals } from '@/domain/reports'
import { accountTypes, lossReasonsFor } from '@/dal/b2b'
import { listLeads } from '@/dal/leads'
import { evaluateRules } from '@/domain/rules'
import { withUser } from '@/server/db'
import { addDays, isoDay } from '@/lib/format'

// Integración de la ola 2: lo que cada paquete hizo bien por separado tiene que seguir siendo cierto cuando se juntan.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const uid = (k: string) => one(admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`).then((r) => r.id)
const stage = async (pipe: string, code: string) => (await one(admin<{ id: string }[]>`select s.id from crm.stages s where s.pipeline_id = md5(${'contigo:' + pipe})::uuid and s.code = ${code}`)).id
const mxPhone = () => `55${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const todayIn = (tz: string) => isoDay(new Date(), tz)

describe('leads y b2b: un solo catálogo de tipos de cuenta, de roles y de motivos', () => {
  it('un lead B2B convertido nace con el tipo del catálogo, conserva su historia y lleva lo que contestó a la ficha', async () => {
    const diana = await ctxFor('diana.cruz')
    const id = await createLead(diana, { market: 'MX', motor: 'b2b', businessName: `Integradora Norte ${tag()}`, contactName: 'Raúl Peña', phone: mxPhone(), contactRole: 'legal' })
    // el tipo de cuenta del lead es un código del catálogo de la ficha (ISO no era un nivel del lead antes de integrar)
    const types = (await accountTypes(diana, 'MX')).map((t) => t.code)
    expect(types).toEqual(expect.arrayContaining(['store', 'chain', 'corporate', 'distributor', 'iso', 'aggregator']))
    await updateLeadDetails(diana, id, { accountType: 'iso' })
    await expect(updateLeadDetails(diana, id, { accountType: 'organization' })).rejects.toMatchObject({ code: 'invalid' }) // nivel, no tipo
    // lo que el formulario pidió para calificar y una nota del lead
    await admin`update crm.leads set custom = ${admin.json({ b2b_points_of_sale: 40, b2b_integration: 'API', llave_que_no_es_campo: 'x' })} where id = ${id}`
    await admin`insert into crm.activities (market_code, lead_id, kind, subject, body, done_at, owner_id, created_by) values ('MX', ${id}, 'note', 'Nota del lead', 'Pide demo con su equipo técnico', now(), ${diana.user.id}, ${diana.user.id})`
    await admin`insert into crm.activities (market_code, lead_id, kind, subject, due_at, owner_id, created_by) values ('MX', ${id}, 'task', 'Mandar la presentación', now() + interval '1 day', ${diana.user.id}, ${diana.user.id})`
    await qualifyLead(diana, id)
    const out = await convertLead(diana, id)

    const acc = await one(admin<{ kind: string; account_type: string; segment: string; custom: Record<string, unknown> }[]>`select kind, account_type, segment, custom from crm.accounts where id = ${out.accountId}`)
    expect(acc).toMatchObject({ account_type: 'iso', kind: 'distributor', segment: 'b2b' })
    // solo pasan las llaves que también son un campo del comercio para ese tipo de venta
    expect(acc.custom).toEqual({ b2b_points_of_sale: 40, b2b_integration: 'API' })
    expect((await one(admin<{ role: string }[]>`select role from crm.account_contacts where account_id = ${out.accountId}`)).role).toBe('legal')
    // la historia sigue al comercio y al negocio
    const moved = await admin<{ kind: string; account_id: string; deal_id: string }[]>`select kind, account_id, deal_id from crm.activities where lead_id = ${id}`
    expect(moved.length).toBeGreaterThanOrEqual(2)
    expect(moved.every((a) => a.account_id === out.accountId && a.deal_id === out.dealId)).toBe(true)
    // una sola tarea abierta, la que traía el lead, y es el próximo paso de quien vende (carril de operaciones)
    const open = await admin<{ subject: string; deal_step: string | null }[]>`select subject, deal_step from crm.activities where deal_id = ${out.dealId} and done_at is null and kind = 'task'`
    expect(open).toEqual([{ subject: 'Mandar la presentación', deal_step: 'sales' }])
    expect((await one(admin<{ next_step: string }[]>`select next_step from crm.deals where id = ${out.dealId}`)).next_step).toBe('Mandar la presentación')
    expect((await one(admin<{ owner_id: string }[]>`select owner_id from crm.activities where deal_id = ${out.dealId} and done_at is null and kind = 'task'`)).owner_id).toBe(diana.user.id)
  })

  it('sin tipo en el lead vale el del tipo de venta, y la base no acepta un tipo fuera del catálogo', async () => {
    const diana = await ctxFor('diana.cruz')
    const id = await createLead(diana, { market: 'MX', motor: 'b2b', businessName: `Cadena Centro ${tag()}`, contactName: 'Mara Gil', phone: mxPhone() })
    await qualifyLead(diana, id)
    const out = await convertLead(diana, id)
    expect(await one(admin`select account_type, kind from crm.accounts where id = ${out.accountId}`)).toEqual({ account_type: 'chain', kind: 'chain' })
    const code = await asPersona('diana.cruz', (tx) => attempt(tx, (sp) => sp`update crm.leads set account_type = 'no_existe' where id = ${id}`))
    expect(code).toBe('23514')
  })

  it('el formulario web B2B decide con qué tipo de cuenta nacen sus leads, y lo elige administración', async () => {
    const nora = await ctxFor('nora.salas')
    const formId = await uid('f-mx-b2b')
    const before = await one(admin<{ name: string; ask_fields: string[] }[]>`select name, ask_fields from crm.web_forms where id = ${formId}`)
    await expect(updateForm(nora, formId, { name: before.name, askFields: before.ask_fields, accountType: 'no_existe' })).rejects.toMatchObject({ code: 'invalid' })
    await updateForm(nora, formId, { name: before.name, askFields: before.ask_fields, accountType: 'corporate' })
    try {
      const sys = await systemContext()
      const lead = await intakeFromForm(sys, 'contacto-mx', { business_name: `Corporativo Web ${tag()}`, contact_name: 'Ana Web', email: `ana.${tag()}@corporativo-prueba.test`, x_b2b_points_of_sale: '12' }, `i2:${tag()}`)
      expect(await one(admin`select account_type, custom from crm.leads where id = ${lead.leadId}`)).toEqual({ account_type: 'corporate', custom: { b2b_points_of_sale: 12 } })
      // sin tocar el tipo, editar el formulario no lo borra
      await updateForm(nora, formId, { name: before.name, askFields: before.ask_fields })
      expect((await one(admin`select account_type from crm.web_forms where id = ${formId}`)).account_type).toBe('corporate')
    } finally {
      await admin`update crm.web_forms set account_type = null where id = ${formId}`
    }
  })

  it('un solo catálogo de roles de contacto, y los motivos para descartar un lead son los de su tipo de venta', async () => {
    expect(LEAD_CONTACT_ROLES).toBe(CONTACT_ROLES)
    const diana = await ctxFor('diana.cruz')
    const b2b = (await lossReasonsFor(diana, 'MX', 'b2b')).map((r) => r.code)
    const d2d = (await lossReasonsFor(diana, 'MX', 'd2d')).map((r) => r.code)
    expect(b2b).toContain('b2b_integration')
    expect(b2b).not.toContain('store_closed_down')
    expect(d2d).toContain('store_closed_down')
    const id = await createLead(diana, { market: 'MX', motor: 'b2b', businessName: `Descartar ${tag()}`, contactName: 'Luz Mora', phone: mxPhone() })
    await expect(disqualifyLead(diana, id, 'store_closed_down')).rejects.toMatchObject({ code: 'invalid' })
    await disqualifyLead(diana, id, 'b2b_volume')
    expect((await one(admin`select status, disqualify_code from crm.leads where id = ${id}`))).toEqual({ status: 'disqualified', disqualify_code: 'b2b_volume' })
  })
})

describe('próximo paso: una regla y una hoja', () => {
  it('las tres listas salen de un solo lugar y la hoja elige por quién completa y por tipo de venta', async () => {
    expect(Object.keys(NEXT_SETS).sort()).toEqual(['b2b', 'default', 'ops'])
    for (const set of Object.values(NEXT_SETS)) {
      for (const n of set) expect(NEXTS).toContain(n)
      expect(set).toContain('task') // "Otra tarea" está en las tres
    }
    expect(NEXT_SETS.default).toContain('visit') // la visita de campo (ola 1) sigue en la venta a tiendas
    expect(NEXT_SETS.b2b).not.toContain('visit')
    const values = (ctx: Awaited<ReturnType<typeof ctxFor>>, motor: string | null) => nextFor(sheetConfig(ctx), motor).map((o) => o.value)
    const marco = await ctxFor('marco.pena')
    const tom = await ctxFor('tom.reyes')
    expect(values(marco, 'd2d')).toEqual(['call', 'visit', 'proposal', 'meeting', 'task', 'none'])
    expect(values(marco, 'b2b')).toEqual(['call', 'proposal', 'meeting', 'contract', 'kickoff', 'testing', 'certification', 'task', 'none'])
    // Operaciones ve sus opciones aunque el negocio sea de B2B
    expect(values(tom, 'b2b')).toEqual(['docs', 'provider', 'training', 'task', 'none'])
    expect(values(tom, null)).toEqual(['docs', 'provider', 'training', 'task', 'none'])
    // cada opción tiene texto en los dos idiomas (no la llave del mensaje)
    for (const o of sheetConfig(marco).nextOptions) expect(o.label, o.value).not.toMatch(/^complete\./)
    for (const o of sheetConfig(tom).nextOptions) expect(o.label, o.value).not.toMatch(/^complete\./)
  })
})

describe('entrega a Operaciones, devolución y ganado a mano en los reportes', () => {
  it('el pedido entra a la cola, quien vende no lo avanza, devuelto llega a su Hoy y ganado con fecha de ayer sale en Negocios cerrados y en el CSV', async () => {
    const jade = await ctxFor('jade.kim')
    const tom = await ctxFor('tom.reyes')
    const robert = await ctxFor('robert.hale')
    const tz = 'America/New_York'
    const today = todayIn(tz)
    const name = `Ola dos pedidos ${tag()}` // no empieza con "Integra ": ese prefijo lo limpia la prueba de integración de la ola 1
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name, segment: 'orders', force: true, reason: 'Prueba: es otro comercio' })
    const orders = await uid('p-us-orders')
    const review = await stage('p-us-orders', 'review')
    const captured = await stage('p-us-orders', 'captured')
    const won = await stage('p-us-orders', 'fulfilled')
    // dos pedidos abiertos del mismo comercio: el embudo de pedidos lo admite
    const a = await createDeal(jade, { accountId: acc.id!, pipelineId: orders, title: `Pedido A ${tag()}`, nextStep: 'Confirmar pedido', nextStepDue: today })
    const b = await createDeal(jade, { accountId: acc.id!, pipelineId: orders, title: `Pedido B ${tag()}`, nextStep: 'Confirmar pedido', nextStepDue: today })
    for (const d of [a, b]) await addDealItem(jade, d, { productId: await uid('prod-us-sim'), quantity: 10 })

    // entra a la cola de Operaciones al pasar a la etapa de Operaciones
    await moveDeal(jade, a, review)
    expect((await getOpsQueue(tom, { view: 'unassigned' })).rows.some((r) => r.id === a)).toBe(true)
    // la vendedora no lo avanza: ni por el dominio ni directo en la base
    await expect(moveDeal(jade, a, won)).rejects.toMatchObject({ code: 'ops_only' })
    const direct = await asPersona('jade.kim', (tx) => attempt(tx, (sp) => sp`update crm.deals set stage_id = ${won} where id = ${a}`))
    expect(direct).toBe('42501')

    // Operaciones lo devuelve con motivo: a la vendedora le llega a Hoy
    await takeDeal(tom, a)
    await expect(moveDeal(tom, a, captured)).rejects.toMatchObject({ code: 'return_reason_required' })
    await moveDeal(tom, a, captured, undefined, undefined, { ret: { reasonCode: 'docs_missing', note: 'Falta el permiso' } })
    const row = (await getQueue(jade)).rows.find((r) => r.dealId === a)
    // ola 4: el motivo se guarda por código y el texto se compone en el idioma de quien lee (aquí, Jade en español)
    expect(row?.subject).toMatch(/^Operaciones devolvió Pedido A .*: Faltan documentos\. Falta el permiso$/)
    expect(row?.group).toBe('today')
    expect((await getOpsQueue(tom, { view: 'all' })).rows.some((r) => r.id === a)).toBe(false)

    // vuelve a entregarlo y Operaciones lo gana a mano con la fecha real: ayer
    await moveDeal(jade, a, review)
    const yesterday = addDays(today, -1)
    await expect(moveDeal(tom, a, won, undefined, undefined, { wonOn: addDays(today, 1) })).rejects.toMatchObject({ code: 'invalid' })
    await moveDeal(tom, a, won, undefined, undefined, { wonOn: yesterday })
    // el segundo pedido del mismo comercio se gana hoy: los dos cuentan, cada uno con su fecha
    await moveDeal(jade, b, review)
    await moveDeal(tom, b, won)

    const period = marketPeriods(robert, 'rango', addDays(today, -2), today)
    const closed = await getClosedDeals(robert, period, { market: 'US', pipeline: orders, result: 'won' }, 500)
    const mine = closed.rows.filter((r) => r.account_name === name).sort((x, y) => x.closed_on.localeCompare(y.closed_on))
    expect(mine.map((r) => r.closed_on)).toEqual([yesterday, today])
    expect(mine.every((r) => r.status === 'won' && r.owner_name === 'Jade Kim')).toBe(true)
    // con el periodo de solo hoy, el ganado de ayer no entra: la fecha que cuenta es la real
    const onlyToday = await getClosedDeals(robert, marketPeriods(robert, 'rango', today, today), { market: 'US', pipeline: orders, result: 'won' }, 500)
    expect(onlyToday.rows.filter((r) => r.account_name === name).map((r) => r.closed_on)).toEqual([today])

    const file = await exportClosedDeals(robert, period, { market: 'US', pipeline: orders, result: 'won' }, 'Revisión de prueba del reporte')
    const lines = file.csv.split(/\r?\n/).filter((l) => l.includes(name))
    expect(lines.length).toBe(2)
    expect(lines.some((l) => l.includes(yesterday))).toBe(true)
    expect(file.csv).not.toMatch(/@|\+1\d{10}/) // ni correos ni teléfonos
    const event = await one(admin<{ after: { report: string; rows: number } }[]>`select after from crm.audit_events where action = 'report.exported' and actor_id = ${robert.user.id} order by at desc limit 1`)
    expect(event.after).toMatchObject({ report: 'closed_deals', rows: file.rows })
    // quien vende no exporta
    await expect(exportClosedDeals(jade, period, { market: 'US' }, 'Revisión de prueba del reporte')).rejects.toMatchObject({ code: 'forbidden' })
    // el panel del LT cuenta los dos ganados en el periodo
    const panel = await getLeadershipPanel(robert, period, 'US')
    expect(panel.pipelines.find((p) => p.id === orders)!.won).toBeGreaterThanOrEqual(2)
  })
})

describe('en pausa no es un negocio frío', () => {
  it('sale de los negocios quietos, del cierre en bloque, de Mi equipo y de los avisos; en la cola de Operaciones no cuenta como pendiente', async () => {
    const diana = await ctxFor('diana.cruz')
    const ana = await ctxFor('ana.robles')
    const paula = await ctxFor('paula.mendez')
    const sys = await systemContext()
    const b2bPipe = await uid('p-mx-b2b')
    const acc = await createAccount(diana, { market: 'MX', kind: 'chain', name: `Pausa integrada ${tag()}`, segment: 'b2b', force: true, reason: 'Prueba: es otro comercio' })
    const today = todayIn('America/Mexico_City')
    const deal = await createDeal(diana, { accountId: acc.id!, pipelineId: b2bPipe, title: `Pausa ${tag()}`, nextStep: 'Enviar propuesta', nextStepDue: addDays(today, 1) })
    // 90 días sin movimiento
    await admin`update crm.deals set created_at = now() - interval '90 days', stage_entered_at = now() - interval '90 days' where id = ${deal}`
    await admin`update crm.activities set created_at = now() - interval '90 days' where deal_id = ${deal}`
    const cold = async () => (await getTeamQueue(paula)).find((r) => r.id === diana.user.id)?.cold ?? 0
    const quiet = async () => (await staleDeals(ana, b2bPipe, 30)).some((d) => d.id === deal)
    const coldBefore = await cold()
    expect(await quiet()).toBe(true)
    expect(coldBefore).toBeGreaterThan(0)

    await pauseDeal(diana, deal, { reason: 'Cierra presupuesto en enero', reviewOn: addDays(today, 20) })
    expect(await quiet()).toBe(false)
    expect(await cold()).toBe(coldBefore - 1)
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    expect((await admin`select 1 from crm.exceptions where deal_id = ${deal} and resolved_at is null and kind in ('stalled_deal', 'no_next_step')`).length).toBe(0)
    // la revisión es el próximo paso de quien vende: una sola tarea abierta, en su carril
    const open = await admin<{ deal_step: string | null; custom: Record<string, unknown> }[]>`select deal_step, custom from crm.activities where deal_id = ${deal} and done_at is null`
    expect(open).toEqual([{ deal_step: 'sales', custom: { pause_review: true } }])
    // el cierre en bloque lo omite aunque alguien lo mande marcado
    expect(await bulkCloseLost(ana, [deal], 'b2b_postponed', '')).toEqual({ closed: 0, skipped: 1 })
    expect((await one(admin`select status from crm.deals where id = ${deal}`)).status).toBe('open')
    // y el motivo del cierre en bloque tiene que ser del embudo
    const other = await createDeal(diana, { accountId: (await createAccount(diana, { market: 'MX', kind: 'chain', name: `Quieto ${tag()}`, segment: 'b2b', force: true, reason: 'Prueba: es otro comercio' })).id!, pipelineId: b2bPipe, title: `Quieto ${tag()}`, nextStep: 'Llamar', nextStepDue: today })
    await expect(bulkCloseLost(ana, [other], 'store_closed_down', '')).rejects.toMatchObject({ code: 'invalid' })
    expect(await bulkCloseLost(ana, [other], 'b2b_postponed', '')).toEqual({ closed: 1, skipped: 0 })
  })

  it('en la cola de Operaciones un negocio en pausa se ve, pero no cuenta como sin tomar ni como pendiente', async () => {
    const jade = await ctxFor('jade.kim')
    const tom = await ctxFor('tom.reyes')
    const today = todayIn('America/New_York')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Pausa en cola ${tag()}`, segment: 'orders', force: true, reason: 'Prueba: es otro comercio' })
    const deal = await createDeal(jade, { accountId: acc.id!, pipelineId: await uid('p-us-orders'), title: `Pedido en pausa ${tag()}`, nextStep: 'Confirmar', nextStepDue: today })
    await addDealItem(jade, deal, { productId: await uid('prod-us-sim'), quantity: 5 })
    await moveDeal(jade, deal, await stage('p-us-orders', 'review'))
    const waiting = await opsWaiting(tom)
    const before = (await getOpsQueue(tom, { view: 'all' })).counts
    await pauseDeal(jade, deal, { reason: 'El dealer pidió esperar al cierre de mes', reviewOn: addDays(today, 10) })
    expect(await opsWaiting(tom)).toBe(waiting - 1)
    const q = await getOpsQueue(tom, { view: 'all' })
    const row = q.rows.find((r) => r.id === deal)
    expect(row?.paused_at).toBeTruthy()
    expect(row?.pause_review_on).toBe(addDays(today, 10))
    // Un pedido no lleva la lista de alta (0018, ola 4): no contaba como capacitación pendiente ni antes ni después de la pausa.
    expect(q.counts.training).toBe(before.training)
    expect(q.counts.all).toBe(before.all) // sigue en la cola
    expect((await getOpsQueue(tom, { focus: 'training' })).rows.some((r) => r.id === deal)).toBe(false)
  })
})

describe('pantalla de inicio por rol: una sola función', () => {
  it('los seis roles aterrizan donde les toca, y el primer ingreso pasa antes por la bienvenida', async () => {
    const want: Record<string, string> = {
      'nora.salas': '/admin', // administración
      'luis.tovar': '/panel-lt', // leadership
      'ana.robles': '/supervisor', // quien lidera el mercado
      'fernando.ibarra': '/hoy', // supervisión
      'marco.pena': '/hoy', // ventas
      'tom.reyes': '/operaciones', // operaciones
    }
    for (const [persona, home] of Object.entries(want)) {
      const ctx = await ctxFor(persona)
      expect(homePath(ctx.memberships), persona).toBe(home)
      const id = await personaId(persona)
      const had = await admin`delete from crm.user_onboarding where user_id = ${id} returning *`
      try {
        expect(await firstStop(id), `${persona} primer ingreso`).toBe('/bienvenida')
        expect(await firstStop(id), `${persona} después`).toBe(home)
      } finally {
        if (had[0]) await admin`update crm.user_onboarding set ${admin(had[0] as Record<string, unknown>)} where user_id = ${id}`
      }
    }
  })
})

describe('leads por periodo desde el Panel del LT', () => {
  it('la lista de leads filtra por el día en que llegó el lead, en la zona del mercado', async () => {
    const ana = await ctxFor('ana.robles')
    const today = todayIn('America/Mexico_City')
    const period = marketPeriods(ana, 'rango', addDays(today, -6), today)
    const panel = await getLeadershipPanel(ana, period, 'MX')
    const counts = (await listLeads(ana, { market: 'MX', from: period.first.from, to: period.first.to })).counts
    const total = ['new', 'contacted', 'qualified', 'converted', 'disqualified'].reduce((n, k) => n + (counts[k] ?? 0), 0)
    expect(total).toBe(panel.markets.find((m) => m.code === 'MX')!.leads)
    expect(total).toBeGreaterThan(0)
  })
})
