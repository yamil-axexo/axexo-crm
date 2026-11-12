import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { addActivity, recordActivity, BACKDATE_DAYS } from '@/domain/activities'
import { completeItem } from '@/domain/queue'
import { reassignAccounts } from '@/domain/accounts'
import { evaluateRules } from '@/domain/rules'
import { ingestSalesAppEvent } from '@/domain/integrations'
import { getAccount } from '@/dal/accounts'
import { getDeal } from '@/dal/pipelines'
import { getQueue } from '@/dal/queue'
import { getSupervisorBoard } from '@/dal/boards'
import { accountPhone, findAccounts, visitorNames } from '@/dal/field'
import { logConfig, sheetConfig, taskItem } from '@/server/sheet'
import { withUser } from '@/server/db'
import { addDays, isoDay } from '@/lib/format'

// Paquete "campo": trabajo en la calle. Cada regla nueva queda con una prueba que falla sin ella.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const TZ = 'America/Mexico_City'
const today = isoDay(new Date(), TZ)
const tomorrow = addDays(today, 1)
const yesterday = addDays(today, -1)

type Store = { id: string; name: string; phone: string | null }
/** Un comercio de Marco (MX, D2D) sin negocio abierto y otro con exactamente un negocio abierto en etapa abierta. */
const marcoStore = async (withDeal: boolean, skip = 0) => one(admin<(Store & { deal_id: string | null })[]>`
  select a.id, a.name, a.phone, (select d.id from crm.deals d where d.account_id = a.id and d.status = 'open' limit 1) as deal_id
    from crm.accounts a join crm.users u on u.id = a.owner_id
   where u.full_name = 'Marco Peña' and a.archived_at is null and a.kind = 'store'
     and (select count(*) from crm.deals d join crm.stages s on s.id = d.stage_id where d.account_id = a.id and d.status = 'open' and s.kind = 'open') = ${withDeal ? 1 : 0}
     and (select count(*) from crm.deals d where d.account_id = a.id and d.status = 'open') = ${withDeal ? 1 : 0}
     and not exists (select 1 from crm.visits v where v.account_id = a.id and v.business_date >= ${yesterday}::date - 40)
     and not exists (select 1 from crm.activities x where x.account_id = a.id and x.kind = 'visit')
   order by a.id offset ${skip} limit 1`)
const activity = (id: string) => one(admin<{ kind: string; outcome: string | null; visited_by: string | null; done_at: Date | null; due_at: Date | null; body: string | null; subject: string; deal_id: string | null; owner_id: string; day: string | null }[]>`
  select kind, outcome, visited_by, done_at, due_at, body, subject, deal_id, owner_id, (done_at at time zone ${TZ})::date::text as day from crm.activities where id = ${id}`)
const repRow = async (supervisor: string, rep: string) => {
  const board = await getSupervisorBoard(await ctxFor(supervisor), {})
  return board.reps.find((r) => r.full_name === rep)!
}

describe('registrar una visita mientras la Sales App no está conectada (E12.F1, E16.F3, E17.F1)', () => {
  it('la visita es una actividad del comercio con resultado, día y, opcional, quién visitó; queda en el hilo y en la bitácora', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false)
    const who = `Julia Prueba ${tag().replace(/\d/g, 'x')}`
    const out = await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'sale', visitedBy: `  ${who}  `, body: 'Dejé el material', next: 'none', askNext: true })
    expect(out).toMatchObject({ kind: 'visit', name: store.name, next: null, due: null })
    const a = await activity(out.id)
    expect(a).toMatchObject({ kind: 'visit', outcome: 'sale', visited_by: who, body: 'Dejé el material', subject: `Visita a ${store.name}`, day: today })
    expect(a.done_at).not.toBeNull()

    const data = (await getAccount(marco, store.id))!
    const row = data.timeline.find((t) => t.kind === 'visit' && t.meta.origin === 'manual')!
    expect(row.meta).toMatchObject({ origin: 'manual', outcome: 'sale', visited_by: who })
    expect(row.actor).toBe('Marco Peña')
    const ev = await one(admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'activity.added' and object_id = ${out.id}`)
    expect(ev.after).toMatchObject({ kind: 'visit', outcome: 'sale', origin: 'manual', visited_by: who })
  })

  it('pide cómo terminó, no acepta resultados de llamada, y una visita sin resultado necesita fecha (es una visita por hacer)', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false)
    await expect(recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'reached', next: 'none' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(recordActivity(marco, { accountId: store.id, kind: 'visit' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(recordActivity(marco, { accountId: store.id, kind: 'note', subject: 'Nota con resultado', outcome: 'sale' })).rejects.toMatchObject({ code: 'invalid' })
    // registrada desde la hoja, una visita hecha pide el próximo paso (o cerrar), como cualquier cosa que se completa
    await expect(recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'no_sale', askNext: true })).rejects.toMatchObject({ code: 'invalid' })
    const planned = await addActivity(marco, { accountId: store.id, kind: 'visit', dueAt: tomorrow })
    expect(await activity(planned)).toMatchObject({ kind: 'visit', outcome: null, done_at: null, subject: `Visitar a ${store.name}` })
  })

  it('se puede capturar después con el día en que fue: hasta un mes atrás, nunca en el futuro', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false)
    const past = addDays(today, -3)
    const id = await addActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'no_sale', on: past })
    expect(await activity(id)).toMatchObject({ day: past })
    // el hilo la fecha y la ordena por ese día, no por el momento de la captura
    const data = (await getAccount(marco, store.id))!
    expect(isoDay(data.timeline.find((t) => t.kind === 'visit' && t.meta.origin === 'manual')!.at, TZ)).toBe(past)
    await expect(addActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'sale', on: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'sale', on: addDays(today, -(BACKDATE_DAYS + 1)) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'sale', on: '11/11/2026' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addActivity(marco, { accountId: store.id, kind: 'note', subject: 'Nota con día', on: past })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('quién visitó es un nombre: sin números ni datos que no se guardan, y solo en una visita hecha', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false)
    for (const bad of ['J', 'Vendedor 5512345678', 'x'.repeat(81)]) {
      await expect(recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'sale', visitedBy: bad })).rejects.toMatchObject({ code: 'invalid' })
    }
    // la base repite el límite: el nombre solo vive en una visita, y un resultado de visita solo en una visita
    const me = await personaId('marco.pena')
    const insert = (kind: string, outcome: string | null, visitedBy: string | null, done: boolean) => asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`
      insert into crm.activities (market_code, account_id, kind, subject, done_at, outcome, visited_by, owner_id, created_by)
      values ('MX', ${store.id}, ${kind}, 'Prueba de límites', ${done ? sp`now()` : null}, ${outcome}, ${visitedBy}, ${me}, ${me})`))
    expect(await insert('note', null, 'Juan Prueba', true)).toBe('23514')
    expect(await insert('call', 'sale', null, true)).toBe('23514')
    expect(await insert('visit', 'reached', null, true)).toBe('23514')
    expect(await insert('visit', null, null, true)).toBe('23514') // una visita hecha siempre dice cómo terminó
    expect(await insert('visit', 'sale', 'Juan Prueba', true)).toBe('ok')
    expect(await insert('visit', null, null, false)).toBe('ok') // por hacer
    expect(await insert('visit', 'sale', null, false)).toBe('23514') // una visita por hacer todavía no tiene resultado
  })

  it('sugiere los nombres ya usados en ese mercado, también a quien lleva otra cartera, y no a otro mercado', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false)
    const who = `Rosa Sugerida ${tag().replace(/\d/g, 'x')}`
    await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'no_sale', visitedBy: who })
    expect((await visitorNames(marco, 'MX'))[0]).toBe(who)
    // Diana vende B2B en México: no ve ese comercio, pero sí el nombre del vendedor de calle para no escribirlo distinto
    const diana = await ctxFor('diana.cruz')
    expect(await getAccount(diana, store.id)).toBeNull()
    expect(await visitorNames(diana, 'MX')).toContain(who)
    const jade = await ctxFor('jade.kim')
    expect(await visitorNames(jade, 'US')).not.toContain(who)
    expect(await visitorNames(jade, 'MX')).toEqual([])
    // ni llamando a la función de la base directamente con otro mercado
    expect(await asPersona('jade.kim', (tx) => tx`select name from app.visitor_names('MX')`)).toHaveLength(0)
  })

  it('una persona de otro mercado o de otra cartera no puede dejar una visita en un comercio que no ve', async () => {
    const store = await marcoStore(false)
    await expect(recordActivity(await ctxFor('jade.kim'), { accountId: store.id, kind: 'visit', outcome: 'sale' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(recordActivity(await ctxFor('diana.cruz'), { accountId: store.id, kind: 'visit', outcome: 'sale' })).rejects.toMatchObject({ code: 'not_found' })
    // leadership ve el comercio pero no escribe
    await expect(recordActivity(await ctxFor('luis.tovar'), { accountId: store.id, kind: 'visit', outcome: 'sale' })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('las visitas cuentan en Mi equipo con su origen y sin duplicar', () => {
  it('la visita a mano suma al dueño del comercio; si la Sales App trae la misma (comercio y día), cuenta una sola vez', async () => {
    const marco = await ctxFor('marco.pena')
    const sys = await systemContext()
    const store = await one(admin<(Store & { alias: string })[]>`
      select a.id, a.name, a.phone, al.external_id as alias from crm.accounts a join crm.users u on u.id = a.owner_id
        join crm.account_aliases al on al.account_id = a.id and al.system = 'sales_core' and al.valid_to is null
       where u.full_name = 'Marco Peña' and a.archived_at is null
         and not exists (select 1 from crm.visits v where v.account_id = a.id and v.business_date >= ${yesterday}::date - 10)
         and not exists (select 1 from crm.activities x where x.account_id = a.id and x.kind = 'visit')
         and not exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open')
       order by a.id limit 1`)
    const before = await repRow('fernando.ibarra', 'Marco Peña')

    // quien visitó no es usuario: la visita cuenta para quien lleva el comercio
    await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'sale', visitedBy: 'Vendedor De Calle' })
    await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'revisit', on: yesterday })
    const manual = await repRow('fernando.ibarra', 'Marco Peña')
    expect(manual.visits_7d).toBe(before.visits_7d + 2)
    expect(manual.sales_7d).toBe(before.sales_7d + 1)
    const log = await admin<{ origin: string; outcome: string; revisit: boolean; visited_by: string | null; day: string }[]>`
      select origin, outcome, revisit, visited_by, business_date::text as day from crm.visit_log where account_id = ${store.id} and business_date >= ${yesterday} order by business_date desc`
    expect(log).toEqual([
      { origin: 'manual', outcome: 'sale', revisit: false, visited_by: 'Vendedor De Calle', day: today },
      { origin: 'manual', outcome: 'no_sale', revisit: true, visited_by: null, day: yesterday },
    ])

    // llega de la Sales App la visita de hoy a ese comercio: la de hoy capturada a mano deja de contar; la de ayer sigue
    const noon = new Date(`${today}T18:00:00Z`).toISOString()
    const res = await ingestSalesAppEvent(sys, {
      event_id: `ev-campo-${tag()}${tag()}`, type: 'visit.checked_out', version: 1, occurred_at: noon,
      data: { visit_id: `v-campo-${tag()}${tag()}`, customer_id: store.alias, salesperson_id: 'SC-U-CAMPO', business_date: today, checked_in_at: noon, checked_out_at: noon,
        duration_seconds: 600, sale: true, rejection_reason: null, revisit: false, revisit_reason: null, decision_maker_present: true, auto_closed: false },
    })
    expect(res).toMatchObject({ status: 'processed' })
    const after = await repRow('fernando.ibarra', 'Marco Peña')
    expect(after.visits_7d).toBe(before.visits_7d + 2)
    expect(after.sales_7d).toBe(before.sales_7d + 1)
    const origins = await admin<{ origin: string; day: string }[]>`select origin, business_date::text as day from crm.visit_log where account_id = ${store.id} and business_date >= ${yesterday} order by business_date desc`
    expect(origins).toEqual([{ origin: 'sales_app', day: today }, { origin: 'manual', day: yesterday }])
    // en el hilo se ven las dos de hoy, cada una con su origen: lo que la persona escribió no se pierde
    const data = (await getAccount(marco, store.id))!
    expect(data.timeline.filter((t) => t.kind === 'visit' && isoDay(t.at, TZ) >= yesterday).map((t) => t.meta.origin).sort()).toEqual(['manual', 'manual', 'sales_app'])
  })

  it('la lista de visitas respeta lo que cada persona ve: una vendedora no cuenta las visitas de otra cartera', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false, 1)
    await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'sale' })
    const seen = (key: string) => asPersona(key, (tx) => tx<{ n: number }[]>`select count(*)::int as n from crm.visit_log where account_id = ${store.id} and origin = 'manual'`)
    expect((await seen('marco.pena'))[0]!.n).toBe(1)
    expect((await seen('fernando.ibarra'))[0]!.n).toBe(1)
    expect((await seen('diana.cruz'))[0]!.n).toBe(0)
    expect((await seen('jade.kim'))[0]!.n).toBe(0)
  })
})

describe('volver con quien decide y la visita por hacer', () => {
  it('"volver con quien decide" marca la revisita en el negocio y "Visitar" deja una visita por hacer que entra a Hoy; con ella no se avisa dos veces', async () => {
    const marco = await ctxFor('marco.pena')
    const sys = await systemContext()
    const store = await marcoStore(true)
    const when = addDays(today, 2)
    // desde la ficha: la visita queda en el único negocio abierto del comercio, y su próximo paso también
    const out = await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'revisit', next: 'visit', nextWhen: when, askNext: true })
    expect(out).toMatchObject({ next: `Visitar a ${store.name}`, due: when })
    expect(await activity(out.id)).toMatchObject({ deal_id: store.deal_id })
    const deal = await one(admin<{ revisit_needed: boolean; revisit_due: string; next_step: string; next_step_due: string }[]>`
      select revisit_needed, revisit_due::text, next_step, next_step_due::text from crm.deals where id = ${store.deal_id}`)
    expect(deal).toEqual({ revisit_needed: true, revisit_due: when, next_step: `Visitar a ${store.name}`, next_step_due: when })
    const planned = await one(admin<{ id: string; kind: string; done_at: Date | null }[]>`
      select id, kind, done_at from crm.activities where account_id = ${store.id} and kind = 'visit' and done_at is null`)

    // la visita por hacer es un pendiente: entra a la cola de Hoy cuando llega su día
    await admin`update crm.activities set due_at = now() where id = ${planned.id}`
    await admin`update crm.deals set revisit_due = ${today} where id = ${store.deal_id}`
    const row = (await getQueue(marco)).rows.find((r) => r.type === 'task' && r.id === planned.id)!
    expect(row).toMatchObject({ kind: 'visit', accountId: store.id })
    // y la hoja la completa con los resultados de una visita, sin respuesta elegida de antemano
    const item = taskItem(marco, { id: planned.id, subject: row.subject, kind: row.kind }, store.name)
    expect(item).toMatchObject({ visit: true, defaultResult: null })
    expect(item.results.map((r) => r.value)).toEqual(['sale', 'no_sale', 'revisit'])

    // la revisita ya está en su lista como visita por hacer: la regla no la sugiere además
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    expect(await admin`select 1 from crm.exceptions where deal_id = ${store.deal_id} and kind = 'revisit_due' and resolved_at is null`).toHaveLength(0)

    // se completa diciendo cómo terminó la visita; un resultado de llamada no vale
    await expect(completeItem(marco, { type: 'task', id: planned.id, result: 'reached', next: 'none', when: '' })).rejects.toMatchObject({ code: 'invalid' })
    await completeItem(marco, { type: 'task', id: planned.id, result: 'sale', next: 'none', when: '', visitedBy: 'Pedro Prueba', note: 'Ya estaba la dueña' })
    expect(await activity(planned.id)).toMatchObject({ kind: 'visit', outcome: 'sale', visited_by: 'Pedro Prueba', body: 'Ya estaba la dueña', day: today })
    expect(await one(admin`select revisit_needed from crm.deals where id = ${store.deal_id}`)).toMatchObject({ revisit_needed: false })
    expect((await repRow('fernando.ibarra', 'Marco Peña')).visits_7d).toBeGreaterThanOrEqual(2)
  })

  it('sin visita programada, la revisita capturada a mano sí llega como sugerencia, y la siguiente visita la cierra', async () => {
    const marco = await ctxFor('marco.pena')
    const sys = await systemContext()
    const store = await marcoStore(true, 1)
    await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'revisit', on: addDays(today, -2), next: 'call', nextWhen: tomorrow, askNext: true })
    expect(await one(admin`select revisit_needed, revisit_due::text from crm.deals where id = ${store.deal_id}`)).toMatchObject({ revisit_needed: true, revisit_due: tomorrow })
    await admin`update crm.deals set revisit_due = ${today} where id = ${store.deal_id}`
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    expect(await admin`select 1 from crm.exceptions where deal_id = ${store.deal_id} and kind = 'revisit_due' and resolved_at is null`).toHaveLength(1)
    await recordActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'no_sale', next: 'none', askNext: true })
    expect(await one(admin`select revisit_needed from crm.deals where id = ${store.deal_id}`)).toMatchObject({ revisit_needed: false })
    expect(await admin`select 1 from crm.exceptions where deal_id = ${store.deal_id} and kind = 'revisit_due' and resolved_at is null`).toHaveLength(0)
  })

  it('un resultado de visita no completa una tarea que no es visita, ni un lead ni una sugerencia', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false)
    const task = await addActivity(marco, { accountId: store.id, kind: 'task', subject: `Llevar material ${tag()}`, dueAt: today })
    await expect(completeItem(marco, { type: 'task', id: task, result: 'sale', next: 'none', when: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'lead', id: task, result: 'sale', next: 'none', when: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'suggestion', id: task, result: 'revisit', next: 'visit', when: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    expect(await activity(task)).toMatchObject({ done_at: null })
  })

  it('al reasignar el comercio, la visita por hacer se va con él', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false, 2)
    const planned = await addActivity(marco, { accountId: store.id, kind: 'visit', dueAt: tomorrow })
    const lucia = await personaId('lucia.vega')
    await reassignAccounts(await ctxFor('fernando.ibarra'), [store.id], lucia)
    expect(await activity(planned)).toMatchObject({ owner_id: lucia })
    await reassignAccounts(await ctxFor('fernando.ibarra'), [store.id], await personaId('marco.pena'))
  })
})

describe('la hoja de completar, pensada para la calle', () => {
  it('"Otra tarea" deja escribir qué es y la nota corta queda con lo que se completó', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(true, 2)
    const task = await addActivity(marco, { dealId: store.deal_id!, kind: 'task', subject: `Confirmar documentos ${tag()}`, dueAt: today })
    const out = await completeItem(marco, { type: 'task', id: task, result: 'reached', next: 'task', when: tomorrow, nextText: '  Capacitar al encargado en recargas ', note: 'Pidió volver por la tarde' })
    expect(out).toEqual({ next: 'Capacitar al encargado en recargas', due: tomorrow })
    expect(await activity(task)).toMatchObject({ outcome: 'reached', body: 'Pidió volver por la tarde' })
    expect(await one(admin`select next_step from crm.deals where id = ${store.deal_id}`)).toMatchObject({ next_step: 'Capacitar al encargado en recargas' })
    // sin texto, "Otra tarea" conserva el título de siempre
    const other = await addActivity(marco, { accountId: store.id, kind: 'task', subject: `Otra ${tag()}`, dueAt: today })
    // "Otra tarea" sin texto ya no guarda un seguimiento genérico: pide decir cuál (paquete b2b, 12-nov-2026).
    await expect(completeItem(marco, { type: 'task', id: other, result: 'done', next: 'task', when: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    // el texto solo aplica a "Otra tarea"
    const third = await addActivity(marco, { accountId: store.id, kind: 'task', subject: `Tercera ${tag()}`, dueAt: today })
    expect((await completeItem(marco, { type: 'task', id: third, result: 'done', next: 'call', when: tomorrow, nextText: 'No aplica' })).next).toBe(`Llamar a ${store.name}`)
  })

  it('la nota y el texto de la tarea no aceptan datos que no se guardan, ni textos fuera de tamaño', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false)
    const task = await addActivity(marco, { accountId: store.id, kind: 'task', subject: `Revisar ${tag()}`, dueAt: today })
    const card = ['4111', '1111', '1111', '1111'].join(' ')
    await expect(completeItem(marco, { type: 'task', id: task, result: 'done', next: 'none', when: '', note: `Pagó con ${card}` })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'task', id: task, result: 'done', next: 'task', when: tomorrow, nextText: `Cobrar a la tarjeta ${card}` })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'task', id: task, result: 'done', next: 'none', when: '', note: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'task', id: task, result: 'done', next: 'task', when: tomorrow, nextText: 'x'.repeat(121) })).rejects.toMatchObject({ code: 'invalid' })
    expect(await activity(task)).toMatchObject({ done_at: null })
  })

  it('las opciones de próximo paso incluyen "Visitar"; los atajos de fecha van seguidos y no proponen domingo', async () => {
    const marco = await ctxFor('marco.pena')
    const config = sheetConfig(marco, new Date('2026-11-11T18:00:00Z')) // miércoles
    expect(config.nextOptions.map((o) => o.value)).toEqual(['call', 'visit', 'proposal', 'meeting', 'task', 'none'])
    expect(config.nextOptions.find((o) => o.value === 'visit')!.label).toBe('Visitar')
    expect(config.whenOptions.map((o) => o.value)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16'])
    // viernes: pasado mañana es domingo y no se ofrece
    expect(sheetConfig(marco, new Date('2026-11-13T18:00:00Z')).whenOptions.map((o) => o.value)).toEqual(['2026-11-13', '2026-11-14', '2026-11-16'])
    const en = logConfig(await ctxFor('jade.kim'), new Date('2026-11-11T18:00:00Z'))
    expect(en.visitResults.map((r) => r.value)).toEqual(['sale', 'no_sale', 'revisit'])
    expect(en.yesterday).toBe('2026-11-10')
  })

  it('un lead puede dejar "Visitar" como próximo paso: queda una visita por hacer ligada al lead', async () => {
    const marco = await ctxFor('marco.pena')
    const lead = await one(admin<{ id: string; business_name: string }[]>`
      select l.id, l.business_name from crm.leads l join crm.users u on u.id = l.owner_id
       where u.full_name = 'Marco Peña' and l.status = 'new' and l.first_touch_at is null order by l.id limit 1`)
    const out = await completeItem(marco, { type: 'lead', id: lead.id, result: 'reached', next: 'visit', when: tomorrow, note: 'Quiere ver el equipo' })
    expect(out.next).toBe(`Visitar a ${lead.business_name}`)
    const rows = await admin<{ kind: string; body: string | null; done: boolean }[]>`
      select kind, body, done_at is not null as done from crm.activities where lead_id = ${lead.id} order by created_at, done_at nulls last`
    expect(rows).toContainEqual({ kind: 'call', body: 'Quiere ver el equipo', done: true })
    expect(rows).toContainEqual({ kind: 'visit', body: null, done: false })
  })
})

describe('llamar desde la ficha o desde el negocio: al volver queda en el hilo', () => {
  it('la llamada registrada lleva su resultado, pide el próximo paso y queda en el negocio abierto del comercio', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(true, 3)
    await expect(recordActivity(marco, { accountId: store.id, kind: 'call', outcome: 'reached', askNext: true })).rejects.toMatchObject({ code: 'invalid' })
    await expect(recordActivity(marco, { accountId: store.id, kind: 'call', outcome: 'sale', next: 'none', askNext: true })).rejects.toMatchObject({ code: 'invalid' })
    const out = await recordActivity(marco, { accountId: store.id, kind: 'call', outcome: 'no_answer', body: 'Buzón', next: 'call', nextWhen: tomorrow, askNext: true })
    expect(out).toMatchObject({ kind: 'call', next: `Llamar a ${store.name}`, due: tomorrow })
    expect(await activity(out.id)).toMatchObject({ kind: 'call', outcome: 'no_answer', subject: `Llamada a ${store.name}`, body: 'Buzón', deal_id: store.deal_id, day: today })
    const data = (await getAccount(marco, store.id))!
    expect(data.timeline.find((t) => t.kind === 'call')!.meta).toMatchObject({ outcome: 'no_answer' })
    expect(data.tasks.map((t) => t.subject)).toContain(`Llamar a ${store.name}`)
    // en el detalle del negocio aparece con su resultado
    const deal = (await getDeal(marco, store.deal_id!))!
    expect(deal.activities.find((a) => a.id === out.id)).toMatchObject({ kind: 'call', outcome: 'no_answer' })
    expect(deal.deal.next_step).toBe(`Llamar a ${store.name}`)
  })

  it('el teléfono para llamar es el del comercio y, si no tiene, el de su contacto', async () => {
    const marco = await ctxFor('marco.pena')
    const withPhone = await one(admin<Store[]>`select a.id, a.name, a.phone from crm.accounts a join crm.users u on u.id = a.owner_id where u.full_name = 'Marco Peña' and a.phone is not null and a.archived_at is null limit 1`)
    expect(await accountPhone(marco, withPhone.id)).toEqual({ phone: withPhone.phone, who: null })
    const viaContact = await admin<{ id: string; phone: string; full_name: string }[]>`
      select a.id, c.phone, c.full_name from crm.accounts a join crm.users u on u.id = a.owner_id
        join crm.account_contacts ac on ac.account_id = a.id and ac.valid_to is null join crm.contacts c on c.id = ac.contact_id and c.phone is not null
       where u.full_name = 'Marco Peña' and a.phone is null and a.archived_at is null
         and (select count(*) from crm.account_contacts x join crm.contacts y on y.id = x.contact_id where x.account_id = a.id and x.valid_to is null and y.phone is not null) = 1 limit 1`
    if (viaContact[0]) expect(await accountPhone(marco, viaContact[0].id)).toEqual({ phone: viaContact[0].phone, who: viaContact[0].full_name })
    expect(await accountPhone(await ctxFor('jade.kim'), withPhone.id)).toBeNull()
  })
})

describe('fecha correcta en el hilo', () => {
  it('una tarea completada aparece con el día en que se completó, no con el día en que se creó, y con su resultado', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(true, 4)
    const subject = `Llamar para confirmar documentos ${tag()}`
    const task = await addActivity(marco, { dealId: store.deal_id!, kind: 'task', subject, dueAt: today })
    await admin`update crm.activities set created_at = now() - interval '3 days' where id = ${task}`
    const note = await addActivity(marco, { accountId: store.id, kind: 'note', subject: `Nota de ayer ${tag()}` })
    await admin`update crm.activities set created_at = now() - interval '1 day', done_at = now() - interval '1 day' where id = ${note}`
    await completeItem(marco, { type: 'task', id: task, result: 'reached', next: 'none', when: '' })

    const data = (await getAccount(marco, store.id))!
    const done = data.timeline.find((t) => t.title === subject)!
    expect(isoDay(done.at, TZ)).toBe(today)
    expect(done.meta).toMatchObject({ outcome: 'reached', done: true })
    // y queda arriba de la nota de ayer, aunque la tarea se creó antes
    const titles = data.timeline.map((t) => t.title)
    expect(titles.indexOf(subject)).toBeLessThan(titles.findIndex((t) => t.startsWith('Nota de ayer')))
    // igual en el detalle del negocio
    const deal = (await getDeal(marco, store.deal_id!))!
    expect(deal.activities[0]).toMatchObject({ id: task, outcome: 'reached' })
  })
})

describe('empezar por la actividad: buscar el comercio en la hoja', () => {
  it('encuentra por nombre y por teléfono (los últimos cuatro dígitos bastan), solo entre lo que la persona ve', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await one(admin<Store[]>`select a.id, a.name, a.phone from crm.accounts a join crm.users u on u.id = a.owner_id
      where u.full_name = 'Marco Peña' and a.phone is not null and a.archived_at is null order by a.id limit 1`)
    expect((await findAccounts(marco, store.name)).map((a) => a.id)).toContain(store.id)
    expect((await findAccounts(marco, store.name.toLowerCase().slice(0, 6))).length).toBeGreaterThan(0)
    expect((await findAccounts(marco, store.phone!.slice(-4))).map((a) => a.id)).toContain(store.id)
    expect((await findAccounts(marco, `(${store.phone!.slice(3, 5)}) ${store.phone!.slice(5, 9)}-${store.phone!.slice(9)}`)).map((a) => a.id)).toContain(store.id)
    // Diana (B2B) y Jade (US) no ven ese comercio: no aparece en su búsqueda
    expect((await findAccounts(await ctxFor('diana.cruz'), store.name)).map((a) => a.id)).not.toContain(store.id)
    expect((await findAccounts(await ctxFor('jade.kim'), store.phone!.slice(-4))).map((a) => a.id)).not.toContain(store.id)
    // leadership no registra actividades: la búsqueda de la hoja no le devuelve nada
    expect(await findAccounts(await ctxFor('luis.tovar'), store.name)).toEqual([])
  })

  it('sin escribir, ofrece los comercios con los que la persona trabajó más recientemente', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false, 3)
    await addActivity(marco, { accountId: store.id, kind: 'note', subject: `Pasé a saludar ${tag()}` })
    const recent = await findAccounts(marco, '')
    expect(recent[0]).toMatchObject({ id: store.id, name: store.name, market: 'MX' })
    expect(recent.length).toBeLessThanOrEqual(6)
  })
})

describe('migración 0010_field_work', () => {
  it('se puede bajar y volver a subir con visitas capturadas: nada se borra', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(false, 4)
    const done = await addActivity(marco, { accountId: store.id, kind: 'visit', outcome: 'revisit', visitedBy: 'Ana Prueba' })
    const planned = await addActivity(marco, { accountId: store.id, kind: 'visit', dueAt: tomorrow })
    const sql = (name: string) => readFileSync(`db/migrations/0010_field_work.${name}.sql`, 'utf8')
    class Rollback extends Error {}
    await admin.begin(async (tx) => {
      await tx.unsafe(sql('down'))
      const rows = await tx<{ id: string; kind: string; body: string | null; type_label: string | null }[]>`select id, kind, body, type_label from crm.activities where id in (${done}, ${planned})`
      expect(rows.find((r) => r.id === done)).toMatchObject({ kind: 'meeting', type_label: 'Visit', body: 'Visita: volver con quien decide\nVisitó: Ana Prueba' })
      expect(rows.find((r) => r.id === planned)).toMatchObject({ kind: 'task' })
      expect(await tx`select 1 from information_schema.columns where table_schema = 'crm' and table_name = 'activities' and column_name = 'visited_by'`).toHaveLength(0)
      expect(await tx`select 1 from pg_views where schemaname = 'crm' and viewname = 'visit_log'`).toHaveLength(0)
      await tx.unsafe(sql('up'))
      expect(await tx`select 1 from pg_views where schemaname = 'crm' and viewname = 'visit_log'`).toHaveLength(1)
      throw new Rollback()
    }).catch((e) => {
      if (!(e instanceof Rollback)) throw e
    })
    expect(await activity(done)).toMatchObject({ kind: 'visit', outcome: 'revisit', visited_by: 'Ana Prueba' })
  })

  it('la lista de visitas corre con los permisos de quien consulta y la app solo la lee', async () => {
    const view = await one(admin<{ options: string[] | null }[]>`select reloptions as options from pg_class where oid = 'crm.visit_log'::regclass`)
    expect(view.options).toContain('security_invoker=true')
    const grants = await admin<{ privilege_type: string }[]>`
      select privilege_type from information_schema.role_table_grants where table_schema = 'crm' and table_name = 'visit_log' and grantee = 'contigo_app'`
    expect(grants.map((g) => g.privilege_type)).toEqual(['SELECT'])
  })
})
