import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { ingestMetricsFile } from '@/domain/integrations'
import { createAccount } from '@/domain/accounts'
import { createDeal, moveDeal, updateDeal } from '@/domain/deals'
import { updateCustom } from '@/domain/custom'
import { addDealItem, setOpsCheck } from '@/domain/ops'
import { receiveOrder, sendOrderToOps } from '@/domain/orders'
import { orderPrint, pendingOrders } from '@/dal/orders'
import { resolveTraining, scheduleTraining } from '@/domain/training'
import { trainingFor } from '@/dal/training'
import { markAnnouncement, publishAnnouncement, withdrawAnnouncement } from '@/domain/announcements'
import { audienceOf, liveAnnouncements, pendingAnnouncements, publishedBy } from '@/dal/announcements'
import { answerReport, createReport, takeReport } from '@/domain/problem-reports'
import { allReports, myReports } from '@/dal/problem-reports'
import { saveComms, saveLesson } from '@/domain/notices'
import { helpLessons, myCenter, unreadNotices } from '@/dal/notices'
import { myNotices } from '@/dal/ops'
import { getQueue } from '@/dal/queue'
import { addDays, isoDay } from '@/lib/format'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const today = isoDay(new Date(), 'America/New_York')
const uid = (k: string) => one(admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`).then((r) => r.id)
const stage = async (pipe: string, code: string) => (await one(admin<{ id: string }[]>`select s.id from crm.stages s where s.pipeline_id = md5(${'contigo:' + pipe})::uuid and s.code = ${code}`)).id
const alwaysOpen = () => admin`update crm.market_hours set days = '{1,2,3,4,5,6,7}', opens = '00:00', closes = '23:59:59'`
const comms = (over: Record<string, string>) => ({ market: 'US', orderHeader: '', ordersMailbox: '', senderAddress: '', walkthroughUrl: '', supportWhatsapp: '', whatsappDailyLimit: '', emailUnitCost: '', whatsappUnitCost: '', supportHoursHigh: '', supportHoursNormal: '', supportHoursLow: '', ...over })

async function jadeAccount(segment: 'dealer' | 'orders' = 'dealer') {
  const jade = await ctxFor('jade.kim')
  const out = await createAccount(jade, { market: 'US', kind: 'store', name: `Avisos dos ${tag()}`, segment, force: true })
  return { jade, accountId: out.id! }
}
/** Un negocio de alta de Jade en Solicitud, listo para entregar a Operaciones. */
async function ready() {
  const { jade, accountId } = await jadeAccount()
  const id = await createDeal(jade, { accountId, pipelineId: await uid('p-us-dealer'), title: `Alta ${tag()}`, nextStep: 'Reunir documentos', nextStepDue: today })
  const contact = await one(admin<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('US', 'Persona de prueba') returning id`)
  await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${accountId}, ${contact.id}, 'US', 'decision_maker')`
  await updateDeal(jade, id, { decisionMakerId: contact.id, decisionMakerMet: true, amount: 1200 })
  await updateCustom(jade, 'deal', id, { account_funding: 'ACH' })
  await moveDeal(jade, id, await stage('p-us-dealer', 'application'))
  return { jade, id, accountId }
}

describe('E13.F1 y E13.F2: Operaciones y quien vende se enteran sin revisar la herramienta', () => {
  it('al entregar un negocio, Operaciones del mercado recibe el aviso con su correo en la cola; la devolución y la aprobación avisan a quien vendió', async () => {
    await alwaysOpen()
    const { jade, id, accountId } = await ready()
    const tom = await ctxFor('tom.reyes')
    await moveDeal(jade, id, await stage('p-us-dealer', 'carrier'))
    const n = (await myCenter(tom, 'unread')).find((x) => x.deal_id === id && x.kind === 'handoff')
    expect(n).toMatchObject({ link: `/deals/${id}`, from_name: 'Jade Kim' })
    const mail = await one(admin<{ status: string; template_key: string; subject: string; body: string }[]>`select status, template_key, subject, body from crm.notifications where notice_id = ${n!.id} and channel = 'email'`)
    expect(mail).toMatchObject({ status: 'queued_off', template_key: 'ops_handoff' })
    expect(mail.subject).toContain('Deal handed over to Operations')
    expect(mail.body).toContain(`/deals/${id}`)
    // Operaciones de otro mercado no recibe nada.
    expect((await myCenter(await ctxFor('valeria.soto'), 'all')).some((x) => x.deal_id === id)).toBe(false)

    // Aprobación de un proveedor: aviso a quien vendió y tarea de visita en su Hoy.
    const provider = await one(admin<{ id: string }[]>`
      insert into crm.ops_catalog (market_code, kind, code, label_es, label_en) values ('US', 'provider', ${'prov_' + tag()}, 'Proveedor de prueba', 'Test provider') returning id`)
    await setOpsCheck(tom, id, provider.id, { status: 'approved', onDate: '', link: '' })
    const approval = (await myCenter(jade, 'unread')).find((x) => x.deal_id === id && x.kind === 'lifecycle')
    expect(approval!.title).toBe('Test provider approved ' + (await one(admin<{ name: string }[]>`select name from crm.accounts where id = ${accountId}`)).name)
    expect(await admin`select 1 from crm.activities where deal_id = ${id} and owner_id = ${jade.user.id} and kind = 'task' and done_at is null and subject like 'Visit %Test provider approved it'`).toHaveLength(1)
    expect(await one(admin<{ template_key: string }[]>`select template_key from crm.notifications where notice_id = ${approval!.id} and channel = 'email'`)).toEqual({ template_key: 'approval_visit' })
    await setOpsCheck(tom, id, provider.id, { status: 'approved', onDate: '', link: '' }) // repetirlo no duplica
    expect((await myCenter(jade, 'unread')).filter((x) => x.deal_id === id && x.kind === 'lifecycle')).toHaveLength(1)

    // Ganado por Operaciones: quien vendió lo ve en Hoy (pide acción) y el correo usa la plantilla de dealer activo.
    await moveDeal(tom, id, await stage('p-us-dealer', 'awaiting'))
    await admin`update crm.pipelines set close_by_transaction = false where id = ${await uid('p-us-dealer')}` // este embudo se gana a mano en la prueba
    await moveDeal(tom, id, await stage('p-us-dealer', 'won'))
    const won = (await myNotices(jade)).find((x) => x.deal_id === id)
    expect(won?.body).toContain('marked')
    expect(await one(admin<{ kind: string; template_key: string }[]>`select kind, template_key from crm.notifications where notice_id = ${won!.id} and channel = 'email'`)).toEqual({ kind: 'deal_won', template_key: 'dealer_active' })
  })
})

describe('E13.F2: los datos de ventas también avisan (dealer activo y dealer sin ventas)', () => {
  it('la primera transacción gana el negocio y avisa a quien lo vendió; 30 días sin ventas avisa a quien lleva el comercio', async () => {
    await alwaysOpen()
    const sys = await systemContext()
    await admin`update crm.pipelines set close_by_transaction = true where id = ${await uid('p-us-dealer')}` // la prueba anterior lo dejó en ganar a mano
    const { jade, accountId } = await jadeAccount()
    const dealId = await createDeal(jade, { accountId, pipelineId: await uid('p-us-dealer'), title: `Primera venta ${tag()}`, nextStep: 'Reunir documentos', nextStepDue: today })
    const ref = `MID-A${tag()}`
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${accountId}, 'US', 's5', ${ref})`
    const first = new Date(Date.now() - 40 * 86400000).toISOString()
    const day = (n: number) => isoDay(new Date(Date.now() - n * 86400000), 'UTC')
    const row = { merchant_ref: ref, first_txn_at: first, last_txn_at: first, currency: 'USD' }
    const out = await ingestMetricsFile(sys, { as_of: day(2), file_name: `a-${tag()}.json`, mode: 'delta', rows: [{ ...row, txn_count_30d: 12, volume_minor_30d: 90000, active_days_30d: 9 }] })
    expect(out).toMatchObject({ status: 'loaded', dealsWon: 1 })
    const won = (await myCenter(jade, 'unread')).find((n) => n.deal_id === dealId && n.kind === 'deal_won')
    expect(won!.title).toContain('is selling: deal won')
    expect(await one(admin<{ template_key: string; status: string }[]>`select template_key, status from crm.notifications where notice_id = ${won!.id} and channel = 'email'`)).toEqual({ template_key: 'dealer_active', status: 'queued_off' })
    // Al día siguiente el archivo dice que ya no vende: el comercio pasa a inactivo y quien lo lleva recibe el aviso, una vez.
    await ingestMetricsFile(sys, { as_of: day(1), file_name: `b-${tag()}.json`, mode: 'delta', rows: [{ ...row, txn_count_30d: 0, volume_minor_30d: 0, active_days_30d: 0 }] })
    expect((await one(admin<{ lifecycle: string }[]>`select lifecycle from crm.accounts where id = ${accountId}`)).lifecycle).toBe('inactive')
    const churn = (await myCenter(jade, 'unread')).filter((n) => n.account_id === accountId && n.title?.includes('stopped selling'))
    expect(churn).toHaveLength(1)
    expect(await one(admin<{ template_key: string }[]>`select template_key from crm.notifications where notice_id = ${churn[0]!.id} and channel = 'email'`)).toEqual({ template_key: 'dealer_churned' })
    await ingestMetricsFile(sys, { as_of: day(0), file_name: `c-${tag()}.json`, mode: 'delta', rows: [{ ...row, txn_count_30d: 0, volume_minor_30d: 0, active_days_30d: 0 }] })
    expect((await myCenter(jade, 'unread')).filter((n) => n.account_id === accountId && n.title?.includes('stopped selling'))).toHaveLength(1)
  })
})

describe('E11.F3 y E11.F4: el pedido se imprime y llega a Operaciones', () => {
  it('pedido con líneas: hoja imprimible, envío a la cola de Operaciones, correo al buzón en la cola apagada, quién y cuándo', async () => {
    await alwaysOpen()
    const { jade, accountId } = await jadeAccount('orders')
    const tom = await ctxFor('tom.reyes')
    const nora = await ctxFor('nora.salas')
    const id = await createDeal(jade, { accountId, pipelineId: await uid('p-us-orders'), title: `Pedido ${tag()}`, nextStep: 'Confirmar pedido', nextStepDue: today })
    await expect(sendOrderToOps(jade, id)).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('línea') })
    await addDealItem(jade, id, { productId: await uid('prod-us-sim'), quantity: 10 })
    await addDealItem(jade, id, { productId: await uid('prod-us-topup'), quantity: 2, unitPrice: 40 })
    const sheet = (await orderPrint(jade, id))!
    expect(sheet.items).toHaveLength(2)
    expect(sheet).toMatchObject({ created_by_name: 'Jade Kim', header: null, dispatches: [] })
    expect(sheet.account.name).toContain('Avisos dos')

    // Sin buzón configurado: Operaciones lo recibe dentro de CONTIGO y el correo queda como "falta la dirección".
    const first = await sendOrderToOps(jade, id)
    expect(first.mailbox).toBeNull()
    expect((await pendingOrders(tom)).find((o) => o.deal_id === id)).toMatchObject({ sent_by_name: 'Jade Kim', lines: 2 })
    expect((await myNotices(tom)).find((n) => n.deal_id === id)).toBeTruthy() // pide acción: sale en su Hoy
    expect((await myCenter(tom, 'unread')).find((n) => n.deal_id === id && n.kind === 'order_sent')!.link).toBe(`/deals/${id}/pedido`)
    expect(await one(admin<{ status: string }[]>`select status from crm.notifications where deal_id = ${id} and recipient_kind = 'mailbox'`)).toEqual({ status: 'skipped_no_address' })
    await expect(sendOrderToOps(jade, id)).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('ya está en la cola') })
    await expect(receiveOrder(jade, (await pendingOrders(tom)).find((o) => o.deal_id === id)!.id)).rejects.toMatchObject({ name: 'DomainError' }) // quien vende no recibe pedidos
    await receiveOrder(tom, (await pendingOrders(tom)).find((o) => o.deal_id === id)!.id)
    expect((await pendingOrders(tom)).some((o) => o.deal_id === id)).toBe(false)
    expect((await myNotices(tom)).some((n) => n.deal_id === id)).toBe(false)

    // Con buzón y encabezado configurados por administración: el correo queda listo para enviar y no sale.
    await saveComms(nora, comms({ orderHeader: 'Marca de prueba', ordersMailbox: 'pedidos@ejemplo.test' }))
    await sendOrderToOps(jade, id)
    const mail = await one(admin<{ status: string; recipient_address: string; subject: string; body: string }[]>`
      select status, recipient_address, subject, body from crm.notifications where deal_id = ${id} and recipient_kind = 'mailbox' order by created_at desc limit 1`)
    expect(mail).toMatchObject({ status: 'queued_off', recipient_address: 'pedidos@ejemplo.test' })
    expect(mail.body).toContain('Total: ')
    const after = (await orderPrint(tom, id))!
    expect(after.header).toBe('Marca de prueba')
    expect(after.dispatches).toHaveLength(2)
    expect(after.dispatches[1]).toMatchObject({ sent_by_name: 'Jade Kim', received_by_name: 'Tom Reyes' })
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action in ('order.sent_to_ops', 'order.received')`).length).toBe(3)
    // Quien no ve el negocio no ve el pedido.
    expect(await orderPrint(await ctxFor('marco.pena'), id)).toBeNull()
    await asPersona('sam.ortiz', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.order_dispatches set received_by = ${tom.user.id}, received_at = now() where deal_id = ${id}`)).toBe('0 rows')
    })
  })
})

describe('E13.F4: agenda de capacitación', () => {
  it('agenda con fecha y quién la da; si no se presentó se reagenda con tarea de seguimiento; hecha cierra la capacitación', async () => {
    await alwaysOpen()
    const { jade, id } = await ready()
    const tom = await ctxFor('tom.reyes')
    const nora = await ctxFor('nora.salas')
    await saveComms(nora, comms({ walkthroughUrl: 'https://ejemplo.test/recorrido' }))
    const d1 = addDays(today, 2)
    const d2 = addDays(today, 6)
    await expect(scheduleTraining(jade, id, { on: d1, at: '10:00', trainerId: tom.user.id })).rejects.toMatchObject({ code: 'forbidden' }) // la agenda es de Operaciones
    await expect(scheduleTraining(tom, id, { on: addDays(today, -1), at: '', trainerId: tom.user.id })).rejects.toMatchObject({ code: 'invalid' })
    await expect(scheduleTraining(tom, id, { on: d1, at: '', trainerId: await personaId('valeria.soto') })).rejects.toMatchObject({ code: 'invalid' }) // persona de otro mercado
    await scheduleTraining(tom, id, { on: d1, at: '10:00', trainerId: tom.user.id })
    expect(await one(admin<{ training_status: string; training_on: string }[]>`select training_status, training_on::text from crm.deals where id = ${id}`)).toEqual({ training_status: 'scheduled', training_on: d1 })
    let agenda = await trainingFor(jade, id, 'US')
    expect(agenda.video).toBe('https://ejemplo.test/recorrido')
    expect(agenda.sessions[0]).toMatchObject({ on_date: d1, at_time: '10:00', trainer_name: 'Tom Reyes', status: 'scheduled' })
    expect(agenda.trainers.map((p) => p.full_name)).toEqual(expect.arrayContaining(['Tom Reyes', 'Jade Kim']))
    // Quien vendió se entera, con el enlace al video.
    const notice = (await myCenter(jade, 'unread')).find((n) => n.deal_id === id && n.kind === 'training')
    expect(notice!.body).toContain('https://ejemplo.test/recorrido')

    await expect(resolveTraining(tom, agenda.sessions[0]!.id, { result: 'no_show' })).rejects.toMatchObject({ es: expect.stringContaining('nueva fecha') })
    await resolveTraining(tom, agenda.sessions[0]!.id, { result: 'no_show', nextOn: d2 })
    agenda = await trainingFor(jade, id, 'US')
    expect(agenda.sessions.map((s) => [s.on_date, s.status])).toEqual([[d2, 'scheduled'], [d1, 'no_show']])
    expect(agenda.sessions[0]!.rescheduled_from).toBe(agenda.sessions[1]!.id)
    expect((await getQueue(jade)).rows.some((r) => r.dealId === id && r.subject.includes('new training date'))).toBe(true) // seguimiento en su Hoy
    await expect(resolveTraining(tom, agenda.sessions[1]!.id, { result: 'done' })).rejects.toMatchObject({ code: 'invalid' }) // ya tiene resultado

    await resolveTraining(tom, agenda.sessions[0]!.id, { result: 'done' })
    expect(await one(admin<{ training_status: string; training_on: string }[]>`select training_status, training_on::text from crm.deals where id = ${id}`)).toEqual({ training_status: 'done', training_on: d2 })
    const actions = (await admin<{ action: string }[]>`select action from crm.audit_events where object_id = ${id} and action like 'training.%' order by at`).map((r) => r.action)
    expect(actions).toEqual(['training.scheduled', 'training.no_show', 'training.done'])
  })
})

describe('GOB-06: anuncios a la red con acuse', () => {
  it('publicar con audiencia, verlo al entrar, leer o dar acuse, ver quién falta, versión nueva y retiro', async () => {
    await alwaysOpen()
    const robert = await ctxFor('robert.hale') // líder de US
    const jade = await ctxFor('jade.kim')
    const sam = await ctxFor('sam.ortiz')
    const marco = await ctxFor('marco.pena') // México
    const ends = addDays(today, 10)
    const title = `Cambio de comisión ${tag()}`
    const base = { topic: 'commission' as const, title, body: 'Desde el mes que viene cambia la tabla de comisiones.', market: 'US', endsOn: ends, requiresAck: false }
    // Un cambio de comisiones se anuncia antes y con fecha de entrada en vigor.
    await expect(publishAnnouncement(robert, base)).rejects.toMatchObject({ es: expect.stringContaining('desde qué fecha') })
    await expect(publishAnnouncement(robert, { ...base, effectiveOn: today })).rejects.toMatchObject({ es: expect.stringContaining('antes de que entre en vigor') })
    await expect(publishAnnouncement(robert, { ...base, effectiveOn: addDays(today, 5), market: 'MX' })).rejects.toMatchObject({ code: 'invalid' }) // no es su mercado
    await expect(publishAnnouncement(jade, { ...base, effectiveOn: addDays(today, 5) })).rejects.toMatchObject({ code: 'forbidden' })
    const out = await publishAnnouncement(robert, { ...base, effectiveOn: addDays(today, 5) })
    expect(out.version).toBe(1)
    expect(out.audience).toBeGreaterThanOrEqual(4)
    // El acuse quedó obligatorio aunque quien publicó no lo marcó.
    const mine = (await pendingAnnouncements(jade)).find((a) => a.id === out.id)
    expect(mine).toMatchObject({ requires_ack: true, topic: 'commission', author: 'Robert Hale', read_at: null })
    expect((await liveAnnouncements(marco)).some((a) => a.id === out.id)).toBe(false) // otro mercado no lo ve
    expect((await liveAnnouncements(robert)).some((a) => a.id === out.id)).toBe(false) // quien publica no se lo anuncia a sí mismo
    expect((await myNotices(jade)).some((n) => n.body.includes('tabla de comisiones'))).toBe(true) // pide acción: sale en Hoy
    const unread = await unreadNotices(jade)

    await markAnnouncement(jade, out.id, false) // leerlo no es dar acuse
    expect((await pendingAnnouncements(jade)).some((a) => a.id === out.id)).toBe(true)
    await markAnnouncement(jade, out.id, true)
    expect((await pendingAnnouncements(jade)).some((a) => a.id === out.id)).toBe(false)
    expect(await unreadNotices(jade)).toBe(unread - 1)
    await expect(markAnnouncement(marco, out.id, true)).rejects.toMatchObject({ code: 'not_found' })

    const who = await audienceOf(robert, out.id)
    expect(who.find((p) => p.full_name === 'Jade Kim')!.ack_at).toBeInstanceOf(Date)
    expect(who.find((p) => p.full_name === 'Sam Ortiz')).toMatchObject({ read_at: null, ack_at: null })
    expect(who.some((p) => p.full_name === 'Marco Peña')).toBe(false)
    const row = (await publishedBy(robert)).find((p) => p.id === out.id)!
    expect(row.acked).toBe(1)
    expect(row.audience).toBe(who.length)
    await expect(audienceOf(sam, out.id)).rejects.toMatchObject({ code: 'forbidden' })
    await asPersona('sam.ortiz', async (tx) => {
      expect(await tx`select * from app.announcement_audience(${out.id})`).toHaveLength(0)
      expect(await tx`select 1 from crm.announcement_receipts where announcement_id = ${out.id}`).toHaveLength(0) // no ve el acuse de Jade
      expect(await attempt(tx, (sp) => sp`insert into crm.announcements (series_id, title, body, market_code, ends_at, created_by) values (${out.id}, 'Anuncio falso', 'Texto del anuncio', 'MX', now() + interval '2 days', ${sam.user.id})`)).toBe('42501')
    })

    // Versión nueva: la anterior deja de mostrarse y el acuse vuelve a empezar.
    const series = (await publishedBy(robert)).find((p) => p.id === out.id)!.series_id
    const v2 = await publishAnnouncement(robert, { ...base, seriesId: series, effectiveOn: addDays(today, 7), body: 'La tabla de comisiones cambia una semana después de lo anunciado.' })
    expect(v2.version).toBe(2)
    expect((await pendingAnnouncements(jade)).map((a) => a.id)).toContain(v2.id)
    expect((await liveAnnouncements(jade)).some((a) => a.id === out.id)).toBe(false)
    await withdrawAnnouncement(robert, v2.id)
    expect((await liveAnnouncements(jade)).some((a) => a.id === v2.id)).toBe(false)
    const log = (await admin<{ action: string }[]>`select action from crm.audit_events where object = 'announcement' and object_id in (${out.id}, ${v2.id}) order by at`).map((r) => r.action)
    expect(log).toEqual(['announcement.published', 'announcement.read', 'announcement.acknowledged', 'announcement.updated', 'announcement.withdrawn'])
  })

  it('supervisión anuncia a su equipo; las novedades de versión las publica administración para todos', async () => {
    await alwaysOpen()
    const kira = await ctxFor('kira.dunn')
    const nora = await ctxFor('nora.salas')
    const ends = addDays(today, 5)
    const team = await uid('t-us')
    await expect(publishAnnouncement(kira, { topic: 'general', title: 'Junta de equipo', body: 'El lunes hay junta de equipo.', market: 'US', endsOn: ends, requiresAck: false })).rejects.toMatchObject({ es: expect.stringContaining('tu equipo') })
    const a = await publishAnnouncement(kira, { topic: 'general', title: 'Junta de equipo', body: 'El lunes hay junta de equipo.', market: 'US', teamId: team, endsOn: ends, requiresAck: false })
    expect((await audienceOf(kira, a.id)).map((p) => p.full_name).sort()).toEqual(['Jade Kim', 'Nora Salas', 'Sam Ortiz'].filter((n) => n !== 'Nora Salas').sort())
    await expect(publishAnnouncement(kira, { topic: 'release', title: 'Novedades', body: 'Texto de novedades.', market: 'US', teamId: team, endsOn: ends, requiresAck: false })).rejects.toMatchObject({ code: 'forbidden' })
    const r = await publishAnnouncement(nora, { topic: 'release', title: 'Novedades de noviembre', body: 'Ahora hay campana de avisos.', titleOther: 'November news', bodyOther: 'There is now a notice bell.', market: '', endsOn: ends, requiresAck: false })
    const marco = (await pendingAnnouncements(await ctxFor('marco.pena'))).find((x) => x.id === r.id)
    expect(marco).toMatchObject({ topic: 'release', title: 'Novedades de noviembre', title_other: 'November news' })
    // Leerlo basta: no pide acuse, y deja de salir al entrar.
    await markAnnouncement(await ctxFor('marco.pena'), r.id, false)
    expect((await pendingAnnouncements(await ctxFor('marco.pena'))).some((x) => x.id === r.id)).toBe(false)
    // Quien solo lee (Leadership) también puede marcarlo: el acuse es suyo.
    await markAnnouncement(await ctxFor('luis.tovar'), r.id, false)
  })
})

describe('GOB-10: estado de un reporte con tiempos, y lección por pantalla', () => {
  it('recibido, en revisión y respondido, con aviso a quien reportó y plazo cuando administración lo define', async () => {
    const jade = await ctxFor('jade.kim')
    const nora = await ctxFor('nora.salas')
    const id = await createReport(jade, { kind: 'problem', urgency: 'high', body: `No puedo guardar un pedido ${tag()}`, screen: '/deals' })
    expect((await myReports(jade)).find((r) => r.id === id)).toMatchObject({ status: 'open', taken_at: null, target_hours: null })
    expect((await myCenter(nora, 'unread')).some((n) => n.kind === 'report' && n.link === '/admin?tab=reportes')).toBe(true)
    await expect(takeReport(jade, id)).rejects.toMatchObject({ code: 'forbidden' })
    await takeReport(nora, id)
    expect((await myReports(jade)).find((r) => r.id === id)).toMatchObject({ status: 'open', taken_by_name: 'Nora Salas' })
    expect((await myCenter(jade, 'unread')).some((n) => n.kind === 'report' && n.title === 'Your report is being reviewed')).toBe(true)
    await saveComms(nora, comms({ supportHoursHigh: '4', supportHoursNormal: '24' }))
    expect((await allReports(nora, 'open')).rows.find((r) => r.id === id)!.target_hours).toBe(4)
    await answerReport(nora, id, 'Ya quedó: vuelve a intentarlo.')
    const done = (await myReports(jade)).find((r) => r.id === id)!
    expect(done).toMatchObject({ status: 'answered', target_hours: 4 })
    expect(done.answered_at!.getTime()).toBeGreaterThanOrEqual(done.taken_at!.getTime())
    expect((await myNotices(jade)).some((n) => n.body.includes('answered it'))).toBe(true) // la respuesta pide acción: sale en Hoy
    await asPersona('sam.ortiz', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.problem_reports set taken_by = ${jade.user.id}, taken_at = now() where id = ${id}`)).toBe('0 rows')
    })
  })

  it('lección de Kore Academy por pantalla: la pone administración, con enlace https, y se puede quitar', async () => {
    const nora = await ctxFor('nora.salas')
    await expect(saveLesson(await ctxFor('robert.hale'), { screen: '/hoy', url: 'https://ejemplo.test/leccion-hoy' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveLesson(nora, { screen: '/hoy', url: 'http://ejemplo.test/x' })).rejects.toMatchObject({ code: 'invalid' })
    await saveLesson(nora, { screen: '/hoy', url: 'https://ejemplo.test/leccion-hoy' })
    expect(await helpLessons(await ctxFor('jade.kim'))).toEqual({ '/hoy': 'https://ejemplo.test/leccion-hoy' })
    await saveLesson(nora, { screen: '/hoy', url: '' })
    expect(await helpLessons(nora)).toEqual({})
  })
})
