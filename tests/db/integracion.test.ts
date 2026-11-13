import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asPersona, ctxFor, owner, personaId } from './helpers'
import { endMembership, grantAccess } from '@/domain/admin'
import { recordActivity } from '@/domain/activities'
import { previewAccounts, reassignAccounts } from '@/domain/reparto'
import { getUsers } from '@/dal/admin'
import { listAccounts } from '@/dal/accounts'
import { getHolders } from '@/dal/reparto'

// Reglas que cruzan paquetes (administración, reparto y campo). Cada una falla si los paquetes dejan de coincidir:
// - Operaciones cuenta como dueño vigente en su mercado (0011_distribution, app.owner_roles).
// - Quitar un acceso y el bloque "Sin dueño vigente" de Mi equipo cuentan lo mismo.
// - La visita registrada a mano respeta "sin dueño vigente" y la visita por hacer se va con el comercio al repartir.
const admin = owner()
const DOMAINS = ['axexo.com']
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const counts = (h: { accounts: number; deals: number; leads: number } | undefined) => h && { accounts: h.accounts, deals: h.deals, leads: h.leads }

let ops = ''
let opsMembership = ''
let ex = ''
let store = ''
let planned = ''
let done = ''

async function clean() {
  await admin.begin(async (tx) => {
    await tx`create temp table _i_acc on commit drop as select id from crm.accounts where name like 'Integra %'`
    await tx`create temp table _i_lead on commit drop as select id from crm.leads where business_name like 'Integra %'`
    await tx`create temp table _i_deal on commit drop as select id from crm.deals where account_id in (select id from _i_acc)`
    await tx`create temp table _i_user on commit drop as select id from crm.users where email like 'integra.%@contigo.test'`
    await tx`delete from crm.exceptions where account_id in (select id from _i_acc) or deal_id in (select id from _i_deal) or lead_id in (select id from _i_lead)`
    await tx`delete from crm.activities where account_id in (select id from _i_acc) or deal_id in (select id from _i_deal) or lead_id in (select id from _i_lead)`
    await tx`delete from crm.deal_stage_events where deal_id in (select id from _i_deal)`
    await tx`delete from crm.deals where id in (select id from _i_deal)`
    await tx`delete from crm.leads where id in (select id from _i_lead)`
    await tx`delete from crm.account_attributions where account_id in (select id from _i_acc)`
    await tx`delete from crm.accounts where id in (select id from _i_acc)`
    await tx`delete from crm.memberships where user_id in (select id from _i_user)`
    await tx`delete from crm.user_onboarding where user_id in (select id from _i_user)`
    await tx`delete from crm.users where id in (select id from _i_user)`
  })
}

beforeAll(async () => {
  await clean()
  const ids = await one(admin<{ ops: string; ex: string }[]>`select md5('contigo:integra.ops')::uuid as ops, md5('contigo:integra.ex')::uuid as ex`)
  ;({ ops, ex } = ids)
  await admin`insert into crm.users (id, email, full_name, locale, is_active, is_synthetic) values
    (${ops}, 'integra.ops@contigo.test', 'Operaciones Integra (sintética)', 'es', true, true),
    (${ex}, 'integra.ex@contigo.test', 'Exvendedor Integra (sintético)', 'es', true, true)`
  opsMembership = (await one(admin<{ id: string }[]>`insert into crm.memberships (user_id, market_code, role, valid_from) values (${ops}, 'MX', 'ops', now() - interval '60 days') returning id`)).id
  // Después del alta, Operaciones se queda con el comercio, su negocio y un lead (requerimientos E10.F12).
  await admin`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, locality, region, country)
    select 'MX', 'store', 'Integra Alta ' || lpad(n::text, 2, '0'), 'd2d', 'onboarding', ${ops}, 'Puebla', 'Puebla', 'MX' from generate_series(1, 3) n`
  await admin`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due, created_by)
    select a.market_code, md5('contigo:p-mx-d2d')::uuid, md5('contigo:s-mx-d2d-visitada')::uuid, a.id, a.owner_id, 'Alta: ' || a.name, 'MXN', 'Completar el alta',
           (now() at time zone 'America/Mexico_City')::date + 5, a.owner_id from crm.accounts a where a.name = 'Integra Alta 01'`
  await admin`insert into crm.leads (market_code, source, motor, business_name, contact_name, email, locality, status, owner_id, assigned_at)
    values ('MX', 'import', 'd2d', 'Integra Lead 01', 'Contacto de prueba', 'integra.lead1@contigo.test', 'Puebla', 'new', ${ops}, now() - interval '3 days')`
  // Un comercio a nombre de alguien que ya no tiene rol en México, con una visita hecha y otra por hacer.
  store = (await one(admin<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, locality, region, country)
    values ('MX', 'store', 'Integra Visita 01', 'd2d', 'prospect', ${ex}, 'Puebla', 'Puebla', 'MX') returning id`)).id
  done = (await one(admin<{ id: string }[]>`insert into crm.activities (market_code, account_id, kind, subject, done_at, outcome, no_sale_code, visited_by, owner_id, created_by)
    values ('MX', ${store}, 'visit', 'Visita a Integra Visita 01', now() - interval '1 day', 'no_sale', 'owner_absent', 'Persona De Calle', ${ex}, ${ex}) returning id`)).id
  planned = (await one(admin<{ id: string }[]>`insert into crm.activities (market_code, account_id, kind, subject, due_at, owner_id, created_by)
    values ('MX', ${store}, 'visit', 'Visitar a Integra Visita 01', now() + interval '2 days', ${ex}, ${ex}) returning id`)).id
})

afterAll(async () => {
  await clean()
  await admin.end()
})

describe('Operaciones es dueño vigente en su mercado', () => {
  it('lo que lleva Operaciones no aparece como "sin dueño vigente" ni lo ve supervisión de otro equipo', async () => {
    const seen = await asPersona('fernando.ibarra', async (tx) =>
      one(tx<{ accounts: number; leads: number }[]>`
        select (select count(*)::int from crm.accounts where name like 'Integra Alta %') as accounts,
               (select count(*)::int from crm.leads where business_name like 'Integra Lead %') as leads`))
    expect(seen).toEqual({ accounts: 0, leads: 0 })
    const fernando = await ctxFor('fernando.ibarra')
    expect((await getHolders(fernando, ['MX'])).some((h) => h.owner_id === ops)).toBe(false)

    const ana = await ctxFor('ana.robles')
    expect((await getHolders(ana, ['MX'])).find((h) => h.owner_id === ops)).toMatchObject({ current: true, accounts: 3, deals: 1, leads: 1 })
    expect((await listAccounts(ana, { market: 'MX', owner: 'vacant', q: 'Integra Alta' })).total).toBe(0)
    expect((await listAccounts(ana, { market: 'MX', owner: ops })).items.every((a) => a.owner_current)).toBe(true)
  })

  it('quitar el acceso y "Sin dueño vigente" de Mi equipo cuentan lo mismo', async () => {
    const nora = await ctxFor('nora.salas')
    // La confirmación, antes de quitar: cuántos tiene y que van a quedar sin dueño vigente.
    const before = (await getUsers(nora)).memberships.find((m) => m.id === opsMembership)!
    expect(before).toMatchObject({ accounts: 3, deals: 1, leads: 1, vacates: true, leaves_rules: [] })

    const out = await endMembership(nora, opsMembership)
    expect(out).toMatchObject({ userId: ops, market: 'MX', accounts: 3, deals: 1, leads: 1, vacant: true })

    // Mi equipo, después: la misma cuenta, ahora visible para supervisión del mercado.
    const fernando = await ctxFor('fernando.ibarra')
    const holder = (await getHolders(fernando, ['MX'])).find((h) => h.owner_id === ops)
    expect(holder).toMatchObject({ current: false })
    expect(counts(holder)).toEqual(counts(before))
    expect(counts(holder)).toEqual(counts(out))
    expect((await listAccounts(fernando, { market: 'MX', owner: 'vacant', q: 'Integra Alta' })).total).toBe(3)

    const ev = await one(admin<{ after: Record<string, unknown> }[]>`
      select after from crm.audit_events where action = 'membership.ended' and object_id = ${ops} order by at desc limit 1`)
    expect(ev.after).toMatchObject({ accounts: 3, deals: 1, leads: 1, no_current_owner: true })
  })

  it('quien conserva otro rol con el que lleva cartera no deja nada sin dueño vigente; un rol global tampoco', async () => {
    const nora = await ctxFor('nora.salas')
    const email = 'integra.dos@contigo.test'
    const rep = await grantAccess(nora, { email, fullName: 'Dos Roles Integra (sintética)', role: 'rep', market: 'MX' }, DOMAINS)
    await grantAccess(nora, { email, fullName: 'Dos Roles Integra (sintética)', role: 'ops', market: 'MX' }, DOMAINS)
    await grantAccess(nora, { email, fullName: 'Dos Roles Integra (sintética)', role: 'lt', market: '' }, DOMAINS)
    await admin`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, country) values ('MX', 'store', 'Integra Dos 01', 'd2d', 'prospect', ${rep.userId}, 'MX')`
    const rows = (await getUsers(nora)).memberships.filter((m) => m.user_id === rep.userId)
    expect(rows.map((m) => [m.role, m.vacates]).sort()).toEqual([['lt', false], ['ops', false], ['rep', false]])

    const lt = await endMembership(nora, rows.find((m) => m.role === 'lt')!.id)
    expect(lt).toMatchObject({ market: null, vacant: false })
    const first = await endMembership(nora, rows.find((m) => m.role === 'rep')!.id)
    expect(first).toMatchObject({ market: 'MX', accounts: 1, vacant: false }) // sigue con Operaciones: sigue siendo dueño vigente
    const last = (await getUsers(nora)).memberships.find((m) => m.user_id === rep.userId)!
    expect(last).toMatchObject({ role: 'ops', vacates: true })
    expect(await endMembership(nora, last.id)).toMatchObject({ market: 'MX', accounts: 1, vacant: true })
  })
})

describe('la visita registrada a mano y "sin dueño vigente"', () => {
  const visible = (key: string) =>
    asPersona(key, async (tx) =>
      one(tx<{ activities: number; counted: number }[]>`
        select (select count(*)::int from crm.activities where account_id = ${store} and kind = 'visit') as activities,
               (select count(*)::int from crm.visit_log where account_id = ${store}) as counted`))

  it('la ve supervisión del mercado, junto con el comercio; quien vende y no lo lleva, no', async () => {
    expect(await visible('fernando.ibarra')).toEqual({ activities: 2, counted: 1 })
    expect(await visible('paula.mendez')).toEqual({ activities: 2, counted: 1 }) // no tiene equipo todavía: lo ve toda supervisión del mercado
    expect(await visible('marco.pena')).toEqual({ activities: 0, counted: 0 })
    expect(await visible('kira.dunn')).toEqual({ activities: 0, counted: 0 }) // supervisa en otro mercado

    // Supervisión puede registrar su propia visita a ese comercio; quien no lo ve, no.
    const fernando = await ctxFor('fernando.ibarra')
    const out = await recordActivity(fernando, { accountId: store, kind: 'visit', outcome: 'revisit', next: 'none', askNext: true })
    expect(out.kind).toBe('visit')
    await expect(recordActivity(await ctxFor('marco.pena'), { accountId: store, kind: 'visit', outcome: 'no_sale', next: 'none', askNext: true })).rejects.toMatchObject({ code: 'not_found' })
    // Las visitas se cuentan para quien lleva el comercio, que hoy es alguien sin rol vigente: no suman a nadie del equipo.
    const log = await asPersona('fernando.ibarra', (tx) => tx<{ owner_id: string }[]>`select owner_id from crm.visit_log where account_id = ${store}`)
    expect(log.map((v) => v.owner_id)).toEqual([ex, ex])
  })

  it('la visita por hacer se va con el comercio al repartir; la visita hecha queda con quien la hizo y cuenta para el nuevo dueño', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const marco = await personaId('marco.pena')
    expect(await previewAccounts(fernando, { market: 'MX', owner: ex })).toEqual({ accounts: 1, deals: 0, tasks: 1 })
    expect(await reassignAccounts(fernando, [store], marco)).toBe(1)

    const rows = await admin<{ id: string; owner_id: string }[]>`select id, owner_id from crm.activities where id = any(${[planned, done]}::uuid[])`
    expect(rows.find((r) => r.id === planned)!.owner_id).toBe(marco)
    expect(rows.find((r) => r.id === done)!.owner_id).toBe(ex)
    // Marco ya ve el comercio con su historia, y las visitas cuentan para él.
    expect(await visible('marco.pena')).toEqual({ activities: 3, counted: 2 })
    const log = await asPersona('marco.pena', (tx) => tx<{ owner_id: string }[]>`select owner_id from crm.visit_log where account_id = ${store}`)
    expect(log.every((v) => v.owner_id === marco)).toBe(true)
    // Paula supervisa otro equipo: el comercio ya tiene dueño vigente y sale de su alcance, con sus visitas.
    expect(await visible('paula.mendez')).toEqual({ activities: 0, counted: 0 })

    const ev = await one(admin<{ after: Record<string, unknown> }[]>`
      select after from crm.audit_events where action = 'account.reassigned' and actor_id = ${fernando.user.id} order by at desc limit 1`)
    expect(ev.after).toMatchObject({ to_user_id: marco, tasks: 1 })
  })
})
