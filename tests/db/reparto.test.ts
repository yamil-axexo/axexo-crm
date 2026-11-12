import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId } from './helpers'
import { REPARTO, cleanReparto, seedReparto } from '../support/reparto-fixture'
import { previewAccounts, previewOpen, reassignAccounts, reassignByFilter, reassignDeals, reassignLeads, setTerritory, setTerritoryByFilter } from '@/domain/reparto'
import { archiveTerritory, createTerritory, renameTerritory, setUserTerritories, territoryCode } from '@/domain/territories'
import { endMembership } from '@/domain/admin'
import { listAccounts } from '@/dal/accounts'
import { getHolders, getPlaceOptions, getRepartoSources, getTargets, getTerritoryAdmin } from '@/dal/reparto'
import { can, type Membership, type Role } from '@/domain/policy'

// Reparto de cartera (0011_distribution): quién ve y quién mueve lo que no tiene dueño vigente, por rol y por mercado.
// 42501 = la base rechazó la operación. '0 rows' = la fila no existe para esa persona.
const DENIED = '42501'
const admin = owner()
let casa = ''
let salio = ''
let exmx = ''

beforeAll(async () => {
  ;({ casa, salio, exmx } = await seedReparto(admin))
  // Un lead sin dueño: lo sigue viendo quien vende en ese mercado (0008).
  await admin`insert into crm.leads (market_code, source, motor, business_name, contact_name, email, status)
              values ('MX', 'import', 'd2d', 'Reparto Lead Libre', 'Contacto de prueba', 'reparto.libre@contigo.test', 'new')`
})
afterAll(async () => {
  await cleanReparto(admin)
  await admin.end()
})

const one = async <T>(q: Promise<T[]>) => (await q)[0]!
type Seen = { accounts: number; deals: number; tasks: number; leads: number; libre: number }
/** Lo que una persona alcanza a ver del caso de reparto, por mercado. */
const seen = (key: string, market: 'MX' | 'US') =>
  asPersona(key, async (tx) =>
    one(tx<Seen[]>`
      select (select count(*)::int from crm.accounts a where a.name like 'Reparto %' and a.market_code = ${market}) as accounts,
             (select count(*)::int from crm.deals d where d.title like '%Reparto %' and d.market_code = ${market}) as deals,
             (select count(*)::int from crm.activities x join crm.deals d on d.id = x.deal_id where d.title like '%Reparto %' and x.market_code = ${market}) as tasks,
             (select count(*)::int from crm.leads l where l.business_name like 'Reparto Lead %' and l.owner_id is not null and l.market_code = ${market}) as leads,
             (select count(*)::int from crm.leads l where l.business_name = 'Reparto Lead Libre' and l.market_code = ${market}) as libre`))

const MX_ALL = { accounts: REPARTO.casaMx + REPARTO.exMx, deals: REPARTO.casaDeals, tasks: REPARTO.casaDeals, leads: REPARTO.casaLeads, libre: 1 }
const US_ALL = { accounts: REPARTO.salioUs, deals: REPARTO.salioUs, tasks: REPARTO.salioUs, leads: REPARTO.salioLeads, libre: 0 }
const NOTHING = { accounts: 0, deals: 0, tasks: 0, leads: 0, libre: 0 }

describe('quién es dueño vigente hoy en un mercado (app.owner_keys)', () => {
  it('cuenta a quien tiene un rol de ventas vigente y está activo; no a la cuenta de servicio, a la persona inactiva ni a quien ya salió del mercado', async () => {
    const marco = await personaId('marco.pena')
    await asPersona('ana.robles', async (tx) => {
      const { keys } = await one(tx<{ keys: string[] }[]>`select app.owner_keys(array['MX','US']) as keys`)
      expect(keys).toContain(`MX:${marco}`)
      expect(keys).not.toContain(`MX:${casa}`)
      expect(keys).not.toContain(`MX:${exmx}`)
      // Ana no tiene rol en US: no puede preguntar quién vende allá, ni siquiera a alguien que sí vende.
      expect(keys.filter((k) => k.startsWith('US:'))).toEqual([])
    })
    await asPersona('robert.hale', async (tx) => {
      const { keys } = await one(tx<{ keys: string[] }[]>`select app.owner_keys(array['US']) as keys`)
      expect(keys).toContain(`US:${exmx}`) // sigue vendiendo en US
      expect(keys).not.toContain(`US:${salio}`) // su rol sigue abierto, pero la persona está inactiva
    })
  })
  it('Operaciones cuenta como dueño vigente en su mercado (después del alta el comercio puede quedar a su nombre); Leadership y Administración no', async () => {
    const valeria = await personaId('valeria.soto')
    const luis = await personaId('luis.tovar')
    const nora = await personaId('nora.salas')
    await asPersona('nora.salas', async (tx) => {
      const { keys, roles } = await one(tx<{ keys: string[]; roles: string[] }[]>`select app.owner_keys(array['MX','US']) as keys, app.owner_roles() as roles`)
      expect(roles).toEqual(['rep', 'supervisor', 'market_lead', 'ops'])
      expect(keys).toContain(`MX:${valeria}`)
      expect(keys).not.toContain(`US:${valeria}`) // opera en México, no en Estados Unidos
      expect(keys.some((k) => k.endsWith(luis))).toBe(false)
      expect(keys.some((k) => k.endsWith(nora))).toBe(false)
    })
  })
})

describe('lectura: quién ve lo que no tiene dueño vigente', () => {
  it('supervisión lo ve en su mercado, con sus negocios, tareas y leads, aunque no sea de su equipo', async () => {
    expect(await seen('fernando.ibarra', 'MX')).toEqual(MX_ALL)
    expect(await seen('paula.mendez', 'MX')).toEqual(MX_ALL)
    expect(await seen('kira.dunn', 'US')).toEqual(US_ALL)
  })
  it('supervisión de otro mercado no ve nada', async () => {
    expect(await seen('kira.dunn', 'MX')).toEqual(NOTHING)
    expect(await seen('fernando.ibarra', 'US')).toEqual(NOTHING)
  })
  it('quien vende no ve esos comercios, negocios, tareas ni leads; sí el lead sin dueño de su mercado', async () => {
    for (const k of ['marco.pena', 'lucia.vega', 'diana.cruz']) expect(await seen(k, 'MX'), k).toEqual({ ...NOTHING, libre: 1 })
    for (const k of ['sam.ortiz', 'jade.kim']) {
      expect(await seen(k, 'US'), k).toEqual(NOTHING)
      expect(await seen(k, 'MX'), k).toEqual(NOTHING)
    }
  })
  it('líder de mercado, operaciones, leadership y administración lo siguen viendo; el líder del otro mercado no', async () => {
    for (const k of ['ana.robles', 'valeria.soto', 'luis.tovar', 'nora.salas']) expect(await seen(k, 'MX'), k).toEqual(MX_ALL)
    for (const k of ['robert.hale', 'tom.reyes', 'luis.tovar', 'nora.salas']) expect(await seen(k, 'US'), k).toEqual(US_ALL)
    expect(await seen('robert.hale', 'MX')).toEqual(NOTHING)
    expect(await seen('ana.robles', 'US')).toEqual(NOTHING)
  })
  it('supervisión sigue sin ver lo de otro equipo cuando su dueño sí está vigente', async () => {
    const diana = await personaId('diana.cruz')
    const marco = await personaId('marco.pena')
    await asPersona('fernando.ibarra', async (tx) => {
      const r = await one(tx<{ other: number; team: number }[]>`
        select count(*) filter (where owner_id = ${diana})::int as other, count(*) filter (where owner_id = ${marco})::int as team from crm.accounts`)
      expect(r.other).toBe(0)
      expect(r.team).toBeGreaterThan(50)
    })
  })
  it('quien ya no vende en México conserva la vista de lo que sigue a su nombre, pero no puede escribir ahí', async () => {
    await asPersona('reparto.exmx', async (tx) => {
      const r = await one(tx<{ n: number }[]>`select count(*)::int as n from crm.accounts where name like 'Reparto Exvendedora %'`)
      expect(r.n).toBe(REPARTO.exMx)
      expect(await attempt(tx, (sp) => sp`update crm.accounts set locality = 'Otra' where name like 'Reparto Exvendedora %'`)).toBe(DENIED)
    })
  })
})

describe('escritura en la base: quién puede mover lo que no tiene dueño vigente', () => {
  it('supervisión lo pasa a alguien de su equipo; no a alguien de otro equipo', async () => {
    const marco = await personaId('marco.pena')
    const diana = await personaId('diana.cruz')
    await asPersona('fernando.ibarra', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.accounts set owner_id = ${marco} where name = 'Reparto Abarrotes 01'`)).toBe('ok')
      expect(await attempt(tx, (sp) => sp`update crm.accounts set owner_id = ${diana} where name = 'Reparto Abarrotes 02'`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`update crm.leads set owner_id = ${marco} where business_name = 'Reparto Lead Tienda 01'`)).toBe('ok')
      expect(await attempt(tx, (sp) => sp`update crm.leads set owner_id = ${diana} where business_name = 'Reparto Lead Tienda 02'`)).toBe(DENIED)
      // Editar un dato sin cambiar el dueño deja el comercio donde estaba.
      expect(await attempt(tx, (sp) => sp`update crm.accounts set locality = 'Monterrey' where name = 'Reparto Abarrotes 03'`)).toBe('ok')
      expect(await attempt(tx, (sp) => sp`update crm.deals set owner_id = ${marco} where title = 'Alta: Reparto Abarrotes 01'`)).toBe('ok')
    })
  })
  it('quien vende y supervisión de otro mercado no encuentran la fila', async () => {
    const marco = await personaId('marco.pena')
    for (const k of ['marco.pena', 'kira.dunn', 'robert.hale']) {
      await asPersona(k, async (tx) => {
        expect(await attempt(tx, (sp) => sp`update crm.accounts set owner_id = ${marco} where name = 'Reparto Abarrotes 01'`), k).toBe('0 rows')
        expect(await attempt(tx, (sp) => sp`update crm.leads set owner_id = ${marco} where business_name = 'Reparto Lead Tienda 01'`), k).toBe('0 rows')
        expect(await attempt(tx, (sp) => sp`update crm.deals set owner_id = ${marco} where title = 'Alta: Reparto Abarrotes 01'`), k).toBe('0 rows')
      })
    }
  })
  it('leadership ve todo y no mueve nada', async () => {
    const marco = await personaId('marco.pena')
    await asPersona('luis.tovar', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.accounts set owner_id = ${marco} where name = 'Reparto Abarrotes 01'`)).toBe(DENIED)
    })
  })
})

describe('permisos de reparto por rol (policy.ts)', () => {
  const m = (role: Role, market: string | null = 'MX'): Membership[] => [{ market, role, teamId: null }]
  it('reparten supervisión, líder de mercado y administración, en su mercado; ventas, operaciones y leadership no', () => {
    for (const cap of ['account.reassign', 'lead.assign', 'deal.reassign', 'account.territory'] as const) {
      expect(can(m('supervisor'), cap, 'MX'), cap).toBe(true)
      expect(can(m('market_lead'), cap, 'MX'), cap).toBe(true)
      expect(can(m('admin', null), cap, 'MX'), cap).toBe(true)
      expect(can(m('supervisor'), cap, 'US'), cap).toBe(false)
      expect(can(m('rep'), cap, 'MX'), cap).toBe(false)
      expect(can(m('ops'), cap, 'MX'), cap).toBe(false)
      expect(can(m('lt', null), cap, 'MX'), cap).toBe(false)
    }
  })
})

describe('buscar y filtrar por plaza y por dueño', () => {
  it('la búsqueda encuentra por ciudad y por estado, con o sin acentos', async () => {
    const ana = await ctxFor('ana.robles')
    expect((await listAccounts(ana, { q: 'torreon' })).total).toBe(REPARTO.casaTorreon)
    expect((await listAccounts(ana, { q: 'Torreón' })).total).toBe(REPARTO.casaTorreon)
    expect((await listAccounts(ana, { q: 'coahuila' })).total).toBe(REPARTO.casaTorreon + REPARTO.exMx)
    expect((await listAccounts(ana, { q: 'Monterrey' })).total).toBeGreaterThanOrEqual(REPARTO.casaMonterrey)
  })
  it('filtra por dueño (una persona, sin dueño, sin dueño vigente), región, ciudad y territorio, y dice cuántos son', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const byCasa = await listAccounts(fernando, { owner: casa })
    expect(byCasa.total).toBe(REPARTO.casaMx)
    expect(byCasa.items.every((a) => a.owner_current === false && a.owner_name === 'Cuenta de servicio (sintética)')).toBe(true)
    const none = (await listAccounts(fernando, { owner: 'none' })).total
    expect(none).toBeGreaterThan(0)
    expect((await listAccounts(fernando, { owner: 'vacant' })).total).toBe(none + REPARTO.casaMx + REPARTO.exMx)
    expect((await listAccounts(fernando, { owner: casa, region: 'Nuevo León' })).total).toBe(REPARTO.casaMonterrey)
    expect((await listAccounts(fernando, { owner: 'vacant', city: 'saltillo' })).total).toBe(REPARTO.exMx)
    expect((await listAccounts(fernando, { owner: casa, territory: 'none' })).total).toBe(REPARTO.casaMx)
    const mine = await listAccounts(await ctxFor('marco.pena'), { owner: 'vacant' })
    expect(mine.items.every((a) => a.owner_id === null)).toBe(true) // quien vende solo ve ahí lo que no tiene dueño en su territorio
  })
  it('Mi equipo sabe quién tiene qué sin dueño vigente, y supervisión solo ofrece a su equipo como destino', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const holders = await getHolders(fernando, ['MX'])
    expect(holders.find((h) => h.owner_id === casa)).toMatchObject({ current: false, is_active: true, accounts: REPARTO.casaMx, deals: REPARTO.casaDeals, leads: REPARTO.casaLeads })
    expect(holders.find((h) => h.owner_id === exmx)).toMatchObject({ current: false, accounts: REPARTO.exMx })
    expect(holders.find((h) => h.owner_id === null && h.market_code === 'MX')?.accounts).toBeGreaterThan(0)
    const marco = await personaId('marco.pena')
    expect(holders.find((h) => h.owner_id === marco)).toMatchObject({ current: true })
    expect(holders.some((h) => h.full_name === 'Diana Cruz')).toBe(false)
    const kira = await getHolders(await ctxFor('kira.dunn'), ['US'])
    expect(kira.find((h) => h.owner_id === salio)).toMatchObject({ current: false, is_active: false, accounts: REPARTO.salioUs, deals: REPARTO.salioUs, leads: REPARTO.salioLeads })

    const team = await getTargets(fernando, ['MX'])
    expect(team.map((p) => p.full_name).sort()).toEqual(['Fernando Ibarra', 'Lucía Vega', 'Marco Peña'])
    const all = await getTargets(await ctxFor('ana.robles'), ['MX'])
    expect(all.map((p) => p.full_name)).toEqual(expect.arrayContaining(['Diana Cruz', 'Marco Peña', 'Paula Méndez']))
    expect((await getRepartoSources(await ctxFor('marco.pena'))).markets).toEqual([])
    expect((await getRepartoSources(await ctxFor('valeria.soto'))).markets).toEqual([])
  })
})

describe('repartir comercios', () => {
  it('quien vende no reparte; supervisión no reparte a otro equipo ni en otro mercado', async () => {
    const marco = await ctxFor('marco.pena')
    const fernando = await ctxFor('fernando.ibarra')
    const kira = await ctxFor('kira.dunn')
    const lucia = await personaId('lucia.vega')
    const diana = await personaId('diana.cruz')
    const f = { market: 'MX', owner: casa }
    await expect(reassignByFilter(marco, f, lucia)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(previewAccounts(marco, f)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(reassignByFilter(await ctxFor('valeria.soto'), f, lucia)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(reassignByFilter(await ctxFor('luis.tovar'), f, lucia)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(reassignByFilter(kira, f, lucia)).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignByFilter(await ctxFor('robert.hale'), f, lucia)).rejects.toMatchObject({ code: 'invalid' })
    const other = reassignByFilter(fernando, f, diana)
    await expect(other).rejects.toMatchObject({ code: 'invalid' })
    await expect(other).rejects.toThrow(/your team/)
    const id = (await one(admin<{ id: string }[]>`select id from crm.accounts where name = 'Reparto Abarrotes 01'`)).id
    await expect(reassignAccounts(fernando, [id], diana)).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignAccounts(marco, [id], lucia)).rejects.toMatchObject({ code: 'not_found' }) // ni siquiera lo ve
    await expect(reassignAccounts(kira, [id], await personaId('jade.kim'))).rejects.toMatchObject({ code: 'not_found' })
    // Nada se movió.
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where owner_id = ${casa}`)).n).toBe(REPARTO.casaMx)
  })
  it('sin un filtro que acote no se mueve el mercado completo, y a una persona que no vende ahí tampoco', async () => {
    const ana = await ctxFor('ana.robles')
    await expect(reassignByFilter(ana, { market: 'MX' }, await personaId('lucia.vega'))).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignByFilter(ana, { owner: casa }, await personaId('lucia.vega'))).rejects.toMatchObject({ code: 'invalid' }) // falta el mercado
    await expect(reassignByFilter(ana, { market: 'MX', owner: casa }, await personaId('sam.ortiz'))).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignByFilter(ana, { market: 'MX', owner: casa }, casa)).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignByFilter(ana, { market: 'MX', owner: casa }, await personaId('valeria.soto'))).rejects.toMatchObject({ code: 'invalid' })
  })
  it('supervisión reparte por ciudad lo que no tiene dueño vigente, por lotes, y dice cuántos quedan', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const lucia = await personaId('lucia.vega')
    const f = { market: 'MX', owner: 'vacant', city: 'Torreón' }
    expect(await previewAccounts(fernando, f, lucia)).toEqual({ accounts: REPARTO.casaTorreon, deals: 0, tasks: 0 })
    const audits = async () => (await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'account.reassigned' and after ->> 'to_user_id' = ${lucia} and actor_id = ${fernando.user.id}`)).n
    const before = await audits()
    expect(await reassignByFilter(fernando, f, lucia, 4)).toEqual({ moved: 4, left: 6 })
    expect(await reassignByFilter(fernando, f, lucia, 4)).toEqual({ moved: 4, left: 2 })
    expect(await reassignByFilter(fernando, f, lucia, 4)).toEqual({ moved: 2, left: 0 })
    expect(await reassignByFilter(fernando, f, lucia, 4)).toEqual({ moved: 0, left: 0 })
    expect(await audits()).toBe(before + 3) // un evento por lote
    const rows = await admin<{ owner_id: string; n: number }[]>`select owner_id, count(*)::int as n from crm.accounts where name like 'Reparto Abarrotes %' and locality = 'Torreón' group by 1`
    expect(rows).toEqual([{ owner_id: lucia, n: REPARTO.casaTorreon }])
    const ev = await one(admin<{ before: { count: number; from_user_ids: string[] }; after: { to_name: string; account_ids: string[] } }[]>`
      select before, after from crm.audit_events where action = 'account.reassigned' and actor_id = ${fernando.user.id} order by at desc limit 1`)
    expect(ev.before).toMatchObject({ count: 2, from_user_ids: [casa] })
    expect(ev.after.to_name).toBe('Lucía Vega')
    // Ahora son de Lucía: ella los ve; Marco no.
    expect((await seen('lucia.vega', 'MX')).accounts).toBe(REPARTO.casaTorreon)
    expect((await seen('marco.pena', 'MX')).accounts).toBe(0)
  })
  it('el comercio se va con sus negocios, sus tareas y sus pendientes abiertos, y la atribución anterior queda con fecha', async () => {
    const ana = await ctxFor('ana.robles')
    const marco = await personaId('marco.pena')
    const f = { market: 'MX', owner: casa, region: 'Nuevo León' }
    await admin`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label)
                select id, 'MX', 'owner', 'user', ${casa}, 'Cuenta de servicio (sintética)' from crm.accounts where name = 'Reparto Abarrotes 01'`
    await admin`insert into crm.exceptions (market_code, kind, severity, account_id, deal_id, owner_id, detail, dedupe_key)
                select d.market_code, 'stalled_deal', 'medium', d.account_id, d.id, d.owner_id, '{}'::jsonb, 'reparto-test:' || d.id from crm.deals d where d.title = 'Alta: Reparto Abarrotes 01'`
    expect(await previewAccounts(ana, f)).toEqual({ accounts: REPARTO.casaMonterrey, deals: REPARTO.casaDeals, tasks: REPARTO.casaDeals })
    expect(await reassignByFilter(ana, f, marco)).toEqual({ moved: REPARTO.casaMonterrey, left: 0 })
    const r = await one(admin<{ deals: number; tasks: number; exc: number; casa: number }[]>`
      select (select count(*)::int from crm.deals d where d.title like 'Alta: Reparto %' and d.owner_id = ${marco} and d.status = 'open') as deals,
             (select count(*)::int from crm.activities x join crm.deals d on d.id = x.deal_id where d.title like 'Alta: Reparto %' and x.owner_id = ${marco}) as tasks,
             (select count(*)::int from crm.exceptions e where e.dedupe_key like 'reparto-test:%' and e.owner_id = ${marco}) as exc,
             (select count(*)::int from crm.accounts a where a.owner_id = ${casa}) as casa`)
    expect(r).toEqual({ deals: REPARTO.casaDeals, tasks: REPARTO.casaDeals, exc: 1, casa: 0 })
    const attr = await admin<{ party_ref: string; effective_to: Date | null }[]>`
      select x.party_ref, x.effective_to from crm.account_attributions x join crm.accounts a on a.id = x.account_id
       where a.name = 'Reparto Abarrotes 01' and x.layer = 'owner' order by x.effective_from, x.effective_to nulls last`
    expect(attr.length).toBe(2)
    expect(attr[0]).toMatchObject({ party_ref: casa })
    expect(attr[0]!.effective_to).not.toBeNull()
    expect(attr[1]).toMatchObject({ party_ref: marco, effective_to: null })
    const ev = await one(admin<{ after: { deals: number; tasks: number } }[]>`
      select after from crm.audit_events where action = 'account.reassigned' and actor_id = ${ana.user.id} order by at desc limit 1`)
    expect(ev.after).toMatchObject({ deals: REPARTO.casaDeals, tasks: REPARTO.casaDeals })
  })
  it('una selección de la lista se reasigna igual, y supervisión de otro equipo no mueve lo que ya tiene dueño vigente', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const paula = await ctxFor('paula.mendez')
    const lucia = await personaId('lucia.vega')
    const ids = (await admin<{ id: string }[]>`select id from crm.accounts where name like 'Reparto Exvendedora %' order by name`).map((r) => r.id)
    expect(await reassignAccounts(fernando, ids.slice(0, 2), lucia)).toBe(2)
    expect(await reassignAccounts(fernando, ids.slice(0, 2), lucia)).toBe(0)
    // Paula supervisa B2B: lo de Lucía (D2D) ya no está a su alcance; lo que sigue sin dueño vigente sí.
    await expect(reassignAccounts(paula, ids.slice(0, 2), await personaId('diana.cruz'))).rejects.toMatchObject({ code: 'not_found' })
    expect(await reassignByFilter(paula, { market: 'MX', owner: lucia }, await personaId('diana.cruz'))).toEqual({ moved: 0, left: 0 })
    expect(await reassignAccounts(paula, ids.slice(2), await personaId('diana.cruz'))).toBe(2)
  })
})

describe('leads y negocios en bloque', () => {
  it('los leads abiertos de una persona pasan a otra, con los mismos límites', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const lucia = await personaId('lucia.vega')
    const diana = await personaId('diana.cruz')
    const s = { market: 'MX', from: casa, to: lucia }
    await expect(reassignLeads(await ctxFor('marco.pena'), s)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(reassignLeads(await ctxFor('valeria.soto'), s)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(reassignLeads(await ctxFor('kira.dunn'), s)).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignLeads(fernando, { ...s, to: diana })).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignLeads(fernando, { ...s, to: casa })).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignLeads(fernando, { ...s, from: 'cualquiera' })).rejects.toMatchObject({ code: 'invalid' })
    // Paula (otro equipo) no alcanza los leads de Marco: no mueve ninguno.
    expect(await reassignLeads(await ctxFor('paula.mendez'), { market: 'MX', from: await personaId('marco.pena'), to: diana })).toEqual({ moved: 0, left: 0 })
    expect(await previewOpen(fernando, 'leads', s)).toBe(REPARTO.casaLeads)
    await admin`update crm.leads set status = 'disqualified', disqualify_code = 'no_response' where business_name = 'Reparto Lead Tienda 05'`
    expect(await reassignLeads(fernando, s, 3)).toEqual({ moved: 3, left: 1 })
    expect(await reassignLeads(fernando, s, 3)).toEqual({ moved: 1, left: 0 })
    const rows = await admin<{ status: string; owner_id: string; n: number }[]>`
      select status, owner_id, count(*)::int as n from crm.leads where business_name like 'Reparto Lead Tienda %' group by 1, 2 order by 1`
    expect(rows).toEqual([{ status: 'disqualified', owner_id: casa, n: 1 }, { status: 'new', owner_id: lucia, n: 4 }]) // lo cerrado no se mueve
    const ev = await one(admin<{ before: { count: number }; after: { to_user_id: string } }[]>`
      select before, after from crm.audit_events where action = 'lead.reassigned' and actor_id = ${fernando.user.id} order by at desc limit 1`)
    expect(ev).toMatchObject({ before: { count: 1 }, after: { to_user_id: lucia } })
    expect((await seen('lucia.vega', 'MX')).leads).toBe(4)
  })
  it('lo que no tiene dueño vigente se cuenta junto, y lo de una persona inactiva se pasa igual', async () => {
    const kira = await ctxFor('kira.dunn')
    const jade = await personaId('jade.kim')
    const open = (await one(admin<{ n: number }[]>`select count(*)::int as n from crm.leads where market_code = 'US' and status in ('new','contacted','qualified') and (owner_id is null or owner_id = ${salio})`)).n
    expect(open).toBeGreaterThanOrEqual(REPARTO.salioLeads)
    expect(await previewOpen(kira, 'leads', { market: 'US', from: 'vacant' })).toBe(open)
    expect(await reassignLeads(kira, { market: 'US', from: salio, to: jade })).toEqual({ moved: REPARTO.salioLeads, left: 0 })
    expect(await previewOpen(kira, 'leads', { market: 'US', from: 'vacant' })).toBe(open - REPARTO.salioLeads)
  })
  it('los negocios abiertos de una persona pasan a otra y el comercio se queda con su dueño', async () => {
    const kira = await ctxFor('kira.dunn')
    const jade = await personaId('jade.kim')
    const s = { market: 'US', from: salio, to: jade }
    await expect(reassignDeals(await ctxFor('sam.ortiz'), s)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(reassignDeals(await ctxFor('tom.reyes'), s)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(reassignDeals(await ctxFor('fernando.ibarra'), s)).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignDeals(await ctxFor('ana.robles'), s)).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignDeals(kira, { ...s, to: await personaId('marco.pena') })).rejects.toMatchObject({ code: 'invalid' })
    await expect(reassignDeals(kira, { ...s, to: salio })).rejects.toMatchObject({ code: 'invalid' })
    expect(await previewOpen(kira, 'deals', s)).toBe(REPARTO.salioUs)
    expect(await reassignDeals(kira, s, 5)).toEqual({ moved: 5, left: 4 })
    expect(await reassignDeals(kira, s, 5)).toEqual({ moved: 4, left: 0 })
    const r = await one(admin<{ deals: number; tasks: number; accounts: number }[]>`
      select (select count(*)::int from crm.deals d where d.title like 'Onboarding: Reparto %' and d.owner_id = ${jade}) as deals,
             (select count(*)::int from crm.activities x join crm.deals d on d.id = x.deal_id where d.title like 'Onboarding: Reparto %' and x.owner_id = ${jade}) as tasks,
             (select count(*)::int from crm.accounts a where a.name like 'Reparto Wireless %' and a.owner_id = ${salio}) as accounts`)
    expect(r).toEqual({ deals: REPARTO.salioUs, tasks: REPARTO.salioUs, accounts: REPARTO.salioUs })
    const ev = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'deal.reassigned' and actor_id = ${kira.user.id}`)
    expect(ev.n).toBe(2)
    // Jade lleva el negocio aunque el comercio no sea suyo.
    await asPersona('jade.kim', async (tx) => {
      expect((await one(tx<{ n: number }[]>`select count(*)::int as n from crm.deals where title like 'Onboarding: Reparto %'`)).n).toBe(REPARTO.salioUs)
    })
  })
})

describe('territorios', () => {
  let norte = ''
  let tampa = ''
  it('solo administración crea, renombra y archiva territorios; cada cambio queda en la bitácora', async () => {
    const nora = await ctxFor('nora.salas')
    for (const k of ['ana.robles', 'fernando.ibarra', 'marco.pena', 'luis.tovar']) {
      await expect(createTerritory(await ctxFor(k), { market: 'MX', name: 'Reparto Bajío' }), k).rejects.toMatchObject({ code: 'forbidden' })
    }
    expect(territoryCode('  Nuevo León / Norte ')).toBe('NUEVO-LEON-NORTE')
    norte = await createTerritory(nora, { market: 'MX', name: 'Reparto Norte' })
    tampa = await createTerritory(nora, { market: 'US', name: 'Reparto Tampa' })
    await expect(createTerritory(nora, { market: 'MX', name: 'reparto norte' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createTerritory(nora, { market: 'MX', name: 'x' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createTerritory(nora, { market: 'ZZ', name: 'Reparto Nada' })).rejects.toMatchObject({ code: 'invalid' })
    await renameTerritory(nora, norte, 'Reparto Norte y Laguna')
    await expect(renameTerritory(await ctxFor('ana.robles'), norte, 'Reparto Otro')).rejects.toMatchObject({ code: 'forbidden' })
    await archiveTerritory(nora, norte, true)
    expect((await getPlaceOptions(nora)).territories.some((t) => t.id === norte)).toBe(false) // archivado: ya no se ofrece
    // Crear uno con el mismo nombre de uno archivado lo recupera en lugar de duplicarlo.
    expect(await createTerritory(nora, { market: 'MX', name: 'Reparto Norte y Laguna' })).toBe(norte)
    const t = await one(admin<{ name: string; archived_at: Date | null }[]>`select name, archived_at from crm.territories where id = ${norte}`)
    expect(t).toEqual({ name: 'Reparto Norte y Laguna', archived_at: null })
    const acts = await admin<{ action: string }[]>`select action from crm.audit_events where object = 'territory' and object_id = ${norte} order by at`
    expect(acts.map((a) => a.action)).toEqual(['territory.created', 'territory.renamed', 'territory.archived', 'territory.restored'])
    await asPersona('ana.robles', async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into crm.territories (market_code, code, name) values ('MX', 'REPARTO-X', 'Reparto X')`)).toBe(DENIED)
    })
  })
  it('se asignan a personas que venden en ese mercado', async () => {
    const nora = await ctxFor('nora.salas')
    await expect(setUserTerritories(await ctxFor('ana.robles'), exmx, 'US', [tampa])).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setUserTerritories(nora, exmx, 'US', [norte])).rejects.toMatchObject({ code: 'invalid' }) // territorio de otro mercado
    await expect(setUserTerritories(nora, casa, 'MX', [norte])).rejects.toMatchObject({ code: 'invalid' }) // no vende ahí
    await setUserTerritories(nora, exmx, 'US', [tampa])
    const adminView = await getTerritoryAdmin(nora)
    expect(adminView.people.find((p) => p.id === exmx && p.market_code === 'US')?.territory_ids).toEqual([tampa])
    expect(adminView.territories.find((t) => t.id === tampa)).toMatchObject({ people: 1, accounts: 0 })
  })
  it('un comercio nuevo nace con el territorio de su dueño cuando el dueño tiene uno solo en ese mercado', async () => {
    const nora = await ctxFor('nora.salas')
    const ins = (name: string) => admin<{ territory_id: string | null }[]>`
      insert into crm.accounts (market_code, kind, name, segment, owner_id, country) values ('US', 'store', ${name}, 'dealer', ${exmx}, 'US') returning territory_id`
    expect((await one(ins('Reparto Nueva 01'))).territory_id).toBe(tampa)
    const otro = await createTerritory(nora, { market: 'US', name: 'Reparto Orlando' })
    await setUserTerritories(nora, exmx, 'US', [tampa, otro])
    expect((await one(ins('Reparto Nueva 02'))).territory_id).toBeNull() // con dos, no se adivina
    // Y un comercio no puede llevar un territorio de otro mercado.
    await expect(admin`update crm.accounts set territory_id = ${norte} where name = 'Reparto Nueva 01'`).rejects.toMatchObject({ code: '23514' })
  })
  it('se pone en bloque a una selección o a todo un filtro, y después se filtra por él', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const f = { market: 'MX', q: 'Reparto', city: 'torreon' }
    await expect(setTerritoryByFilter(await ctxFor('marco.pena'), f, norte)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setTerritoryByFilter(await ctxFor('valeria.soto'), f, norte)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setTerritoryByFilter(await ctxFor('kira.dunn'), f, norte)).rejects.toMatchObject({ code: 'invalid' })
    await expect(setTerritoryByFilter(fernando, f, tampa)).rejects.toMatchObject({ code: 'invalid' }) // territorio de US
    await expect(setTerritoryByFilter(fernando, { market: 'MX' }, norte)).rejects.toMatchObject({ code: 'invalid' })
    expect(await setTerritoryByFilter(fernando, f, norte, 6)).toEqual({ moved: 6, left: 4 })
    expect(await setTerritoryByFilter(fernando, f, norte, 6)).toEqual({ moved: 4, left: 0 })
    expect((await listAccounts(fernando, { territory: norte })).total).toBe(REPARTO.casaTorreon)
    expect((await listAccounts(fernando, { territory: norte })).items[0]!.territory).toBe('Reparto Norte y Laguna')
    const two = (await admin<{ id: string }[]>`select id from crm.accounts where territory_id = ${norte} order by name limit 2`).map((r) => r.id)
    expect(await setTerritory(fernando, two, null)).toBe(2)
    expect(await setTerritory(fernando, two, null)).toBe(0)
    await expect(setTerritory(await ctxFor('marco.pena'), two, norte)).rejects.toMatchObject({ code: 'not_found' })
    expect((await listAccounts(fernando, { territory: norte })).total).toBe(REPARTO.casaTorreon - 2)
    const ev = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'account.territory_set' and actor_id = ${fernando.user.id}`)
    expect(ev.n).toBe(3)
  })
})

describe('quitar un acceso', () => {
  it('dice lo que esa persona deja sin dueño vigente en ese mercado', async () => {
    const nora = await ctxFor('nora.salas')
    const m = await one(admin<{ id: string }[]>`select id from crm.memberships where user_id = ${exmx} and market_code = 'US' and valid_to is null`)
    await expect(endMembership(await ctxFor('ana.robles'), m.id)).rejects.toMatchObject({ code: 'forbidden' })
    expect(await endMembership(nora, m.id)).toMatchObject({ userId: exmx, name: 'Exvendedora MX (sintética)', market: 'US', accounts: 2, deals: 0, leads: 0, vacant: true })
    // Desde ese momento supervisión de US ve esos comercios para repartirlos.
    await asPersona('kira.dunn', async (tx) => {
      expect((await one(tx<{ n: number }[]>`select count(*)::int as n from crm.accounts where name like 'Reparto Nueva %'`)).n).toBe(2)
    })
  })
})
