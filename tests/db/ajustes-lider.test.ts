import { describe, expect, it } from 'vitest'
import { ctxFor, owner, personaId, systemContext } from './helpers'
import { assignLead, convertLead, createLead, intakeFromForm, qualifyLead } from '@/domain/leads'
import { createDeal } from '@/domain/deals'
import { pauseDeal, resumeDeal } from '@/domain/b2b'
import { grantAccess } from '@/domain/admin'
import { exportClosedDeals } from '@/domain/reports'
import { dockCounts, getLeadWatch, getSupervisorBoard, teamPeople } from '@/dal/boards'
import { listLeads } from '@/dal/leads'
import { getBoard } from '@/dal/pipelines'
import { getAccount } from '@/dal/accounts'
import { getQueue } from '@/dal/queue'
import { getUsers } from '@/dal/admin'
import { getB2bConfig } from '@/dal/b2b'
import { closeRules, getClosedDeals, getReportOptions, marketPeriods } from '@/dal/reports'
import { diffRows } from '@/lib/audit'
import { withUser } from '@/server/db'
import { evaluateRules } from '@/domain/rules'
import { HELP, LANDING, STEPS } from '@/content/guide'

// Ola 4, paquete ajustes-lider: lo que la ronda de aceptación dejó abierto para liderazgo de México B2B y para administración y LT.
const admin = owner()
const tag = () => Math.random().toString(36).slice(2, 8)
const mxPhone = () => `55${Math.floor(10_000_000 + Math.random() * 89_999_999)}`
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
const outbox = (type: string, id: string) => admin<{ payload: Record<string, unknown> }[]>`
  select payload from crm.outbox_events where event_type = ${type} and aggregate_id = ${id} order by created_at`
const DOMAINS = ['axexo.com', 'emida.com', 'emida.net']
/** Una cuenta corporativa nueva, sin negocios, a nombre de la persona. */
const b2bAccount = async (ownerId: string) => (await one(admin<{ id: string }[]>`
  insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, account_type, country)
  values ('MX', 'chain', ${`Cadena de Prueba ${tag()}`}, 'b2b', 'prospect', ${ownerId}, 'chain', 'MX') returning id`)).id

describe('el lead nuevo avisa dentro de CONTIGO', () => {
  it('cada asignación deja lead.assigned en los avisos para otros sistemas', async () => {
    const diana = await ctxFor('diana.cruz')
    const ana = await ctxFor('ana.robles')
    const id = await createLead(diana, { market: 'MX', motor: 'b2b', businessName: `Cadena Aviso ${tag()}`, contactName: 'Laura Meza', phone: mxPhone() })
    expect((await outbox('lead.assigned', id)).map((e) => e.payload)).toMatchObject([{ owner_id: diana.user.id, by: 'creation' }])
    const ivan = await personaId('ivan.rios')
    await assignLead(ana, id, ivan)
    const events = await outbox('lead.assigned', id)
    expect(events).toHaveLength(2)
    expect(events[1]!.payload).toMatchObject({ owner_id: ivan, previous_owner_id: diana.user.id, by: 'assignment' })
  })

  it('el contador del dock dice cuándo llegó el más reciente, y la guardia de Mi equipo trae los minutos hábiles que quedan', async () => {
    const diana = await ctxFor('diana.cruz')
    const ana = await ctxFor('ana.robles')
    const before = await dockCounts(diana)
    const name = `Guardia ${tag()}`
    const id = await createLead(diana, { market: 'MX', motor: 'b2b', businessName: name, contactName: 'Pedro Sol', phone: mxPhone() })
    const after = await dockCounts(diana)
    expect(after.leadsWaiting).toBe(before.leadsWaiting + 1)
    expect(after.latestName).toBe(name)
    expect(!before.latest || after.latest! > before.latest).toBe(true)

    // Meta a 45 minutos dentro de un horario que hoy está abierto todo el día: quedan entre 43 y 45 minutos hábiles.
    await admin`update crm.market_hours set days = '{1,2,3,4,5,6,7}', opens = '00:00', closes = '23:59' where market_code = 'MX'`
    await admin`update crm.leads set sla_due_at = now() + interval '45 minutes' where id = ${id}`
    const row = (await getLeadWatch(ana, { market: 'MX' })).find((l) => l.id === id)!
    expect(row).toMatchObject({ late: false, owner_id: diana.user.id })
    expect(row.minutes_left).toBeGreaterThanOrEqual(43)
    expect(row.minutes_left).toBeLessThanOrEqual(45)
    // Fuera del horario hábil no corre: con el mercado cerrado hoy, no queda ningún minuto antes del vencimiento.
    await admin`update crm.market_hours set opens = '00:00', closes = '00:01' where market_code = 'MX'`
    expect((await getLeadWatch(ana, { market: 'MX' })).find((l) => l.id === id)!.minutes_left).toBeLessThanOrEqual(1)
    await admin`update crm.leads set sla_due_at = now() - interval '5 minutes' where id = ${id}`
    expect((await getLeadWatch(ana, { market: 'MX' })).find((l) => l.id === id)).toMatchObject({ late: true, minutes_left: 0 })
    // Con un intento ya no está en la guardia.
    await admin`update crm.leads set first_touch_at = now() where id = ${id}`
    expect((await getLeadWatch(ana, { market: 'MX' })).some((l) => l.id === id)).toBe(false)
    await admin`update crm.market_hours set days = '{1,2,3,4,5}', opens = '09:00', closes = '18:00' where market_code = 'MX'`
  })

  it('la segunda solicitud web deja una tarea para hoy a quien lleva el lead', async () => {
    const sys = await systemContext()
    const phone = mxPhone()
    const name = `Abarrotes Repite ${tag()}`
    const first = await intakeFromForm(sys, 'tiendas-mx', { business_name: name, contact_name: 'Rosa Luna', phone }, `a1:${tag()}`)
    const holder = (await one(admin<{ owner_id: string | null }[]>`select owner_id from crm.leads where id = ${first.leadId}`)).owner_id
    expect(holder).toBeTruthy()
    const second = await intakeFromForm(sys, 'tiendas-mx', { business_name: name, contact_name: 'Pedro Luna', phone, message: 'Necesito 20 terminales para diciembre.' }, `a2:${tag()}`)
    expect(second).toMatchObject({ leadId: first.leadId, merged: true })
    const task = await one(admin<{ subject: string; body: string; owner_id: string; due: string; done_at: Date | null }[]>`
      select subject, body, owner_id, (due_at at time zone 'America/Mexico_City')::date::text as due, done_at from crm.activities
       where lead_id = ${first.leadId} and kind = 'task' order by created_at desc limit 1`)
    expect(task).toMatchObject({ subject: `Responder segunda solicitud web: ${name}`, owner_id: holder, done_at: null })
    expect(task.body).toContain('20 terminales')
    const audit = await one(admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'lead.repeat_request' and object_id = ${first.leadId}`)
    expect(audit.after).toMatchObject({ task_for: holder })
  })
})

describe('filtros que faltaban', () => {
  it('Leads filtra por tipo de venta y por equipo', async () => {
    const ana = await ctxFor('ana.robles')
    const diana = await ctxFor('diana.cruz')
    const id = await createLead(diana, { market: 'MX', motor: 'b2b', businessName: `Filtro B2B ${tag()}`, contactName: 'Lía Paz', phone: mxPhone() })
    const b2b = await listLeads(ana, { market: 'MX', motor: 'b2b' })
    expect(b2b.items.length).toBeGreaterThan(0)
    expect(b2b.items.every((l) => l.motor === 'b2b')).toBe(true)
    expect(b2b.items.some((l) => l.id === id)).toBe(true)
    expect((await listLeads(ana, { market: 'MX', motor: 'd2d' })).items.some((l) => l.id === id)).toBe(false)

    const teams = (await getReportOptions(ana)).teams.filter((x) => x.market_code === 'MX')
    const mine = await one(admin<{ team_id: string | null }[]>`select team_id from crm.memberships where user_id = ${diana.user.id} and market_code = 'MX' and (valid_to is null or valid_to > now()) limit 1`)
    expect(mine.team_id).toBeTruthy()
    const other = teams.find((x) => x.id !== mine.team_id)!
    expect((await listLeads(ana, { market: 'MX', team: mine.team_id! })).items.some((l) => l.id === id)).toBe(true)
    const others = await listLeads(ana, { market: 'MX', team: other.id })
    expect(others.items.some((l) => l.id === id)).toBe(false)
    expect(others.counts.open ?? 0).toBeLessThan((await listLeads(ana, { market: 'MX' })).counts.open ?? 0)
  })

  it('el equipo elegido en Mi equipo también filtra los pendientes y lo por repartir', async () => {
    const ana = await ctxFor('ana.robles')
    const sys = await systemContext()
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    const all = await getSupervisorBoard(ana, { market: 'MX' })
    expect(Object.values(all.byKind).reduce((n, x) => n + x, 0)).toBeGreaterThan(0)
    const teams = (await getReportOptions(ana)).teams.filter((x) => x.market_code === 'MX')
    const b2b = teams.find((x) => /b2b/i.test(x.name))!
    const people = await teamPeople(ana, b2b.id)
    const board = await getSupervisorBoard(ana, { market: 'MX', team: b2b.id })
    expect(board.queue.every((e) => e.owner_id !== null && people.has(e.owner_id))).toBe(true)
    const total = (b: typeof all) => Object.values(b.byKind).reduce((n, x) => n + x, 0)
    expect(total(board)).toBeLessThan(total(all))
    expect(total(board)).toBe((await admin<{ n: number }[]>`
      select count(*)::int as n from crm.exceptions e where e.resolved_at is null and e.market_code = 'MX' and e.owner_id = any(${[...people]}::uuid[])`)[0]!.n)
  })

  it('con "En pausa" cada columna del tablero cuenta y suma solo lo que se ve', async () => {
    const diana = await ctxFor('diana.cruz')
    const pipe = (await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'b2b'`)).id
    const account = await b2bAccount(diana.user.id)
    const deal = await createDeal(diana, { accountId: account, pipelineId: pipe, title: `Pausa contador ${tag()}`, nextStep: 'Enviar propuesta', nextStepDue: day(1) })
    await pauseDeal(diana, deal, { reason: 'Presupuesto en enero', reviewOn: day(15) })
    const paused = await getBoard(diana, pipe, { paused: true })
    const seen = paused!.deals.length
    expect(paused!.shown!.reduce((n, x) => n + x.n, 0)).toBe(seen)
    expect(paused!.totals.reduce((n, x) => n + x.n, 0)).toBeGreaterThanOrEqual(seen)
    expect((await getBoard(diana, pipe, {}))!.shown).toBeNull()

    // Mientras está en pausa, el próximo paso dice cuándo se revisa; al retomarlo deja de ser "Revisar negocio en pausa".
    const onHold = await one(admin<{ next_step: string; next_step_due: string }[]>`select next_step, next_step_due::text from crm.deals where id = ${deal}`)
    expect(onHold.next_step).toContain('Revisar negocio en pausa')
    expect(onHold.next_step_due).toBe(day(15))
    // El día de la revisión vuelve a Hoy.
    const inToday = async () => (await getQueue(diana)).rows.some((r) => r.dealId === deal && r.type === 'task')
    expect(await inToday()).toBe(false)
    await admin`update crm.activities set due_at = now() - interval '1 hour' where deal_id = ${deal} and done_at is null and custom ? 'pause_review'`
    expect(await inToday()).toBe(true)
    await resumeDeal(diana, deal)
    expect(await one(admin`select next_step, next_step_due, paused_at from crm.deals where id = ${deal}`)).toMatchObject({ next_step: null, next_step_due: null, paused_at: null })
  })
})

describe('B2B', () => {
  it('la ficha propone primero el embudo del tipo de venta de la cuenta y el árbol dice el tipo real de cada cuenta', async () => {
    const ana = await ctxFor('ana.robles')
    const iso = await one(admin<{ id: string }[]>`
      insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, account_type, country)
      values ('MX', 'distributor', ${`ISO Prueba ${tag()}`}, 'b2b', 'prospect', ${ana.user.id}, 'iso', 'MX') returning id`)
    const agent = await one(admin<{ id: string }[]>`
      insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, account_type, country, parent_id, ancestor_ids)
      values ('MX', 'distributor', ${`Agente Prueba ${tag()}`}, 'b2b', 'prospect', ${ana.user.id}, 'iso_agent', 'MX', ${iso.id}, ${[iso.id]}::uuid[]) returning id`)
    const data = (await getAccount(ana, iso.id))!
    const offered = data.pipelines.filter((p) => p.stages.length > 0).sort((x, y) => Number(y.motor === data.account.segment) - Number(x.motor === data.account.segment))
    expect(offered[0]!.motor).toBe('b2b')
    expect(data.children.find((c) => c.id === agent.id)).toMatchObject({ type_es: 'Agente de ISO' })
    expect(data.account.type_es).toBe('ISO')
    expect(data.rollup).toMatchObject({ accounts: 1, stores: 0 })
    const child = (await getAccount(ana, agent.id))!
    expect(child.ancestors[0]).toMatchObject({ id: iso.id, type_es: 'ISO' })
  })

  it('al convertir, el mensaje del formulario pasa al hilo del comercio y del negocio', async () => {
    const sys = await systemContext()
    const msg = `Quiero poner recargas en mis 3 locales ${tag()}`
    const res = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Miscelánea Mensaje ${tag()}`, contact_name: 'Eva Ríos', phone: mxPhone(), message: msg }, `m1:${tag()}`)
    const lead = await one(admin<{ owner_id: string }[]>`select owner_id from crm.leads where id = ${res.leadId}`)
    const key = (await one(admin<{ key: string }[]>`select split_part(email, '@', 1) as key from crm.users where id = ${lead.owner_id}`)).key
    const rep = await ctxFor(key)
    await qualifyLead(rep, res.leadId)
    const out = await convertLead(rep, res.leadId)
    const note = await one(admin<{ subject: string; body: string; kind: string }[]>`
      select subject, body, kind from crm.activities where account_id = ${out.accountId} and deal_id = ${out.dealId} and body = ${msg}`)
    expect(note).toMatchObject({ kind: 'note', subject: 'Mensaje del formulario' })
  })
})

describe('leadership y administración', () => {
  it('Negocios cerrados y su CSV dicen cómo se ganó y quién lo marcó', async () => {
    const ana = await ctxFor('ana.robles')
    const diana = await ctxFor('diana.cruz')
    const pipe = await one(admin<{ id: string; won: string }[]>`
      select p.id, (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'won' and s.archived_at is null limit 1) as won
        from crm.pipelines p where p.market_code = 'MX' and p.motor = 'b2b'`)
    await admin`update crm.pipelines set close_by_transaction = false where id = ${pipe.id}`
    const account = await b2bAccount(diana.user.id)
    const title = `Ganado a mano ${tag()}`
    const deal = await createDeal(diana, { accountId: account, pipelineId: pipe.id, title, nextStep: 'Firmar', nextStepDue: day(1) })
    // Se gana a mano saltando los requisitos de etapa en la base: aquí importa el reporte, no el paso por cada etapa.
    await admin`update crm.deals set status = 'won', stage_id = ${pipe.won}, won_at = now(), closed_by = 'manual' where id = ${deal}`
    await admin`insert into crm.deal_stage_events (deal_id, market_code, to_stage_id, actor_id, cause) values (${deal}, 'MX', ${pipe.won}, ${diana.user.id}, 'user')`
    const period = marketPeriods(ana, 'mes')
    const row = (await getClosedDeals(ana, period, { market: 'MX', result: 'won' })).rows.find((r) => r.id === deal)!
    expect(row).toMatchObject({ closed_by: 'manual', closed_by_name: diana.user.name })
    const file = await exportClosedDeals(ana, period, { market: 'MX', result: 'won' })
    const [head, ...lines] = file.csv.replace(/^﻿/, '').split(/\r?\n/)
    expect(head).toContain('Cómo se ganó')
    expect(head).toContain('Quién lo marcó')
    const line = lines.find((l) => l.includes(title))!
    expect(line).toContain('A mano')
    expect(line).toContain(diana.user.name)
  })

  it('el texto de cómo se gana sale de la configuración de cada embudo', async () => {
    const luis = await ctxFor('luis.tovar')
    const now = await closeRules(luis, ['MX', 'US'])
    const real = await one(admin<{ t: number; h: number }[]>`
      select count(*) filter (where close_by_transaction)::int as t, count(*) filter (where not close_by_transaction)::int as h from crm.pipelines where is_active and market_code in ('MX', 'US')`)
    expect(now).toEqual({ byTransaction: real.t, byHand: real.h })
    await admin`update crm.pipelines set close_by_transaction = false where market_code = 'MX'`
    expect(await closeRules(luis, ['MX'])).toMatchObject({ byTransaction: 0 })
  })

  it('el antes y el después de la bitácora no muestra claves internas', () => {
    const t = (es: string) => es
    const rows = diffRows(t, 'es', null, { code: 'carrier_north', kind: 'provider', link: false, status: 'sent', zz_internal: 'x' }, {})
    expect(rows.map((r) => r.key)).toEqual(['kind', 'link', 'status'])
    expect(rows.map((r) => r.label)).toEqual(['Tipo', 'Enlace', 'Estado'])
    expect(rows.find((r) => r.key === 'kind')!.after).toBe('Proveedor')
    expect(rows.find((r) => r.key === 'status')!.after).toBe('Enviado')
  })

  it('los dos campos con el mismo nombre se distinguen por cuándo aplican', async () => {
    const nora = await ctxFor('nora.salas')
    const same = (await getB2bConfig(nora)).fields.filter((f) => f.label_es === 'Constancia de situación fiscal')
    expect(same.map((f) => f.only_when).sort()).toEqual(['Persona física', 'Persona moral'])
  })

  it('Personas y acceso lee el último ingreso de la misma fuente que Adopción', async () => {
    const nora = await ctxFor('nora.salas')
    const kira = await personaId('kira.dunn')
    await admin`delete from crm.usage_events where user_id = ${kira}`
    await admin`insert into crm.audit_events (actor_id, action, object, object_id, after) values (${kira}, 'session.started', 'session', null, '{"kind":"persona"}'::jsonb)`
    const row = (await getUsers(nora)).users.find((u) => u.id === kira)!
    expect(row.last_seen).not.toBeNull()
    expect(Date.now() - new Date(row.last_seen!).getTime()).toBeLessThan(60_000)
  })

  it('dar Administración pide la confirmación, la deja en bitácora con su alcance, y un dominio no admitido dice a quién pedirlo', async () => {
    const nora = await ctxFor('nora.salas')
    const email = `admin.${tag()}@emida.com`
    await expect(grantAccess(nora, { email, fullName: 'Persona Externa', role: 'admin', market: '' }, DOMAINS))
      .rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('ve y cambia todo, en todos los mercados'), en: expect.stringContaining('sees and changes everything, in every market') })
    const out = await grantAccess(nora, { email, fullName: 'Persona Externa', role: 'admin', market: '', expires: day(30), confirmAdmin: true }, DOMAINS)
    const audit = await one(admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'membership.granted' and object_id = ${out.userId} order by at desc limit 1`)
    expect(audit.after).toMatchObject({ role: 'admin', scope: 'all_markets', confirmed: true, external: !nora.user.email.endsWith('@emida.com'), expires: day(30) })
    // Un rol que no es Administración no lleva esas marcas.
    const rep = await grantAccess(nora, { email: `rep.${tag()}@axexo.com`, fullName: 'Persona Ventas', role: 'rep', market: 'MX' }, DOMAINS)
    const plain = await one(admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'membership.granted' and object_id = ${rep.userId}`)
    expect(plain.after).not.toHaveProperty('scope')

    await expect(grantAccess(nora, { email: `alguien.${tag()}@empowerretailers.com`, fullName: 'Otra Persona', role: 'rep', market: 'US' }, DOMAINS)).rejects.toMatchObject({
      code: 'invalid',
      es: expect.stringMatching(/necesita una cuenta de axexo\.com, emida\.com o emida\.net.*quien administra las cuentas de Google de la empresa/),
      en: expect.stringMatching(/axexo\.com, emida\.com or emida\.net account.*manages the company’s Google accounts/),
    })
  })
})

describe('contenido que coincide con la pantalla', () => {
  const text = (v: { es: string; en: string }) => `${v.es} ${v.en}`
  it('primeros pasos de Ventas, Supervisión y Administración', () => {
    const rep = STEPS.rep.map((s) => `${text(s.title)} ${text(s.why)}`).join(' ')
    expect(rep).toContain('Registra una visita o una reunión, o deja una nota')
    expect(rep).toContain('avisa hoy a tu supervisión o a quien lidera tu mercado')
    expect(rep).not.toContain('avisa a tu supervisor hoy')
    expect(rep).toContain('el mensaje que la persona escribió en el formulario')
    expect(STEPS.supervisor.map((s) => text(s.why)).join(' ')).toContain('se reparte por quién lo lleva o por región')
    const adminSteps = STEPS.admin.map((s) => s.key)
    expect(adminSteps).toContain('pipedriveTab')
    expect(STEPS.admin.find((s) => s.key === 'pipedriveTab')).toMatchObject({ href: '/admin?tab=pipedrive' })
  })

  it('la Ayuda dice qué avisa y qué no, y dónde ve cada rol el equipo sin supervisión', () => {
    const alert = HELP.find((h) => h.id === 'lead-alert')!
    expect(alert.a.es).toContain('Avisarme cuando llegue un lead')
    expect(alert.a.es).toContain('no llega por correo ni por Slack')
    expect(alert.a.en).toContain('Tell me when a lead arrives')
    const sup = HELP.find((h) => h.q.es.startsWith('Mi equipo no tiene supervisión'))!
    expect(sup.a.es).toContain('Lo ve en Mi equipo')
    expect(sup.a.es).not.toMatch(/^Quien lidera el mercado\. En Administración/)
    expect(LANDING.status.rows.some((r) => r.state === 'on' && r.label.es.includes('Aviso de lead nuevo con CONTIGO abierto'))).toBe(true)
    // Sin guiones largos en lo que se agregó.
    expect(`${alert.a.es}${alert.a.en}${sup.a.es}${sup.a.en}`).not.toMatch(/[—–]/)
  })
})
