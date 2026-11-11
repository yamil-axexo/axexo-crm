import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, owner, personaId } from './helpers'

// AUTHZ-08: permitido y denegado por rol × objeto × acción, contra la base real y con el rol de la aplicación.
// 42501 = la base rechazó la operación (RLS o privilegio). '0 rows' = la fila no existe para esa persona.
const DENIED = '42501'
const admin = owner()
afterAll(() => admin.end())

const one = async <T>(q: Promise<T[]>) => (await q)[0]!

describe('RLS forzado en todo el esquema (AUTHZ-03, AUTHZ-05)', () => {
  it('todas las tablas de crm tienen RLS habilitado y forzado', async () => {
    const rows = await admin`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'crm' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`
    expect(rows.map((r) => r.relname)).toEqual([])
  })
  it('el rol de la aplicación no puede saltarse RLS, ni es dueño, ni superusuario', async () => {
    const r = await one(admin`select rolbypassrls, rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = 'contigo_app'`)
    expect(r).toMatchObject({ rolbypassrls: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false })
    const owned = await admin`select 1 from pg_tables where schemaname = 'crm' and tableowner = 'contigo_app'`
    expect(owned.length).toBe(0)
  })
  it('sin identidad en la sesión no se lee ninguna tabla de negocio', async () => {
    const sql = (await import('@/server/db')).withoutUser
    for (const t of ['accounts', 'leads', 'deals', 'contacts', 'activities', 'visits', 'audit_events', 'users', 'memberships', 'markets']) {
      const rows = await sql((tx) => tx.unsafe(`select count(*)::int as n from crm.${t}`))
      expect(rows[0]!.n, t).toBe(0)
    }
  })
  it('la tabla de sesiones y las llaves de API no se leen directo ni siendo admin', async () => {
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`select * from crm.sessions`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`update crm.audit_events set action = 'x'`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`delete from crm.audit_events`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`delete from crm.accounts`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`delete from crm.deals`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`truncate crm.leads`)).toBe(DENIED)
    })
  })
})

describe('alcance de lectura por rol', () => {
  const visible = (key: string) =>
    asPersona(key, async (tx) =>
      one(tx<{ mx: number; us: number; mine: number; others: number; unowned: number }[]>`
        select count(*) filter (where market_code = 'MX')::int as mx, count(*) filter (where market_code = 'US')::int as us,
               count(*) filter (where owner_id = app.current_user_id())::int as mine,
               count(*) filter (where owner_id is not null and owner_id <> app.current_user_id() and parent_id is null)::int as others,
               count(*) filter (where owner_id is null)::int as unowned
          from crm.accounts`))

  it('admin y LT ven los dos mercados completos', async () => {
    const total = await one(admin<{ mx: number; us: number }[]>`select count(*) filter (where market_code = 'MX')::int as mx, count(*) filter (where market_code = 'US')::int as us from crm.accounts`)
    for (const k of ['nora.salas', 'luis.tovar']) expect(await visible(k)).toMatchObject(total)
  })
  it('una líder de mercado ve todo su mercado y nada del otro', async () => {
    const ana = await visible('ana.robles')
    expect(ana.mx).toBeGreaterThan(300)
    expect(ana.us).toBe(0)
    const robert = await visible('robert.hale')
    expect(robert.us).toBeGreaterThan(100)
    expect(robert.mx).toBe(0)
  })
  it('un vendedor ve lo suyo y lo que no tiene dueño en su territorio; nunca lo de otro vendedor', async () => {
    const marco = await visible('marco.pena')
    expect(marco.mine).toBeGreaterThan(50)
    expect(marco.others).toBe(0)
    expect(marco.us).toBe(0)
  })
  it('un supervisor ve a su equipo, no a los otros equipos de su mercado', async () => {
    const diana = await personaId('diana.cruz')
    const marco = await personaId('marco.pena')
    await asPersona('fernando.ibarra', async (tx) => {
      const r = await one(tx<{ team: number; other_team: number; us: number }[]>`
        select count(*) filter (where owner_id = ${marco})::int as team, count(*) filter (where owner_id = ${diana})::int as other_team,
               count(*) filter (where market_code = 'US')::int as us from crm.accounts`)
      expect(r.team).toBeGreaterThan(50)
      expect(r.other_team).toBe(0)
      expect(r.us).toBe(0)
    })
  })
  it('quien lleva una cadena ve todas sus tiendas, a cualquier profundidad', async () => {
    await asPersona('diana.cruz', async (tx) => {
      const r = await one(tx<{ n: number }[]>`select count(*)::int as n from crm.accounts where ancestor_ids @> array[md5('contigo:mx-ch-1')::uuid]`)
      expect(r.n).toBe(14)
      const other = await one(tx<{ n: number }[]>`select count(*)::int as n from crm.accounts where ancestor_ids @> array[md5('contigo:mx-ch-2')::uuid]`)
      expect(other.n).toBe(0)
    })
  })
  it('lo que cuelga de la cuenta hereda su alcance: deals, contactos, visitas, métricas y alias', async () => {
    const usStore = await one(admin<{ id: string }[]>`select id from crm.accounts where market_code = 'US' and kind = 'store' and owner_id is not null limit 1`)
    await asPersona('marco.pena', async (tx) => {
      for (const t of ['deals', 'account_contacts', 'visits', 'merchant_metrics_daily', 'account_aliases', 'account_attributions']) {
        const r = await tx.unsafe(`select count(*)::int as n from crm.${t} where account_id = '${usStore.id}'`)
        expect(r[0]!.n, t).toBe(0)
      }
      const contacts = await one(tx<{ n: number }[]>`select count(*)::int as n from crm.contacts where market_code = 'US'`)
      expect(contacts.n).toBe(0)
    })
  })
  it('la bitácora la lee quien gobierna el mercado; un vendedor no', async () => {
    await admin`insert into crm.audit_events (actor_id, action, object, market_code) values (${await personaId('nora.salas')}, 'test.event', 'test', 'MX')`
    expect((await asPersona('marco.pena', (tx) => one(tx<{ n: number }[]>`select count(*)::int as n from crm.audit_events`))).n).toBe(0)
    expect((await asPersona('ana.robles', (tx) => one(tx<{ n: number }[]>`select count(*)::int as n from crm.audit_events where market_code = 'MX'`))).n).toBeGreaterThan(0)
    expect((await asPersona('robert.hale', (tx) => one(tx<{ n: number }[]>`select count(*)::int as n from crm.audit_events where market_code = 'MX'`))).n).toBe(0)
  })
})

describe('escritura por rol', () => {
  const marcoStore = () => one(admin<{ id: string }[]>`select id from crm.accounts where owner_id = md5('contigo:marco.pena')::uuid and kind = 'store' limit 1`)
  const luciaStore = () => one(admin<{ id: string }[]>`select id from crm.accounts where owner_id = md5('contigo:lucia.vega')::uuid and kind = 'store' limit 1`)

  it('un vendedor edita su comercio, no el de otro, y no puede regalarlo ni cambiarlo de mercado', async () => {
    const mine = (await marcoStore()).id
    const theirs = (await luciaStore()).id
    await asPersona('marco.pena', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.accounts set locality = 'X' where id = ${mine}`)).toBe('ok')
      expect(await attempt(tx, (sp) => sp`update crm.accounts set locality = 'X' where id = ${theirs}`)).toBe('0 rows')
      expect(await attempt(tx, (sp) => sp`update crm.accounts set owner_id = md5('contigo:lucia.vega')::uuid where id = ${mine}`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`update crm.accounts set market_code = 'US' where id = ${mine}`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`insert into crm.accounts (market_code, kind, name, owner_id) values ('US', 'store', 'Fuera de mercado', app.current_user_id())`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`insert into crm.accounts (market_code, kind, name, owner_id) values ('MX', 'store', 'En mi mercado', app.current_user_id())`)).toBe('ok')
    })
  })
  it('un supervisor reasigna dentro de su equipo, no hacia otro equipo', async () => {
    const mine = (await marcoStore()).id
    await asPersona('fernando.ibarra', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.accounts set owner_id = md5('contigo:lucia.vega')::uuid where id = ${mine}`)).toBe('ok')
      expect(await attempt(tx, (sp) => sp`update crm.accounts set owner_id = md5('contigo:diana.cruz')::uuid where id = ${mine}`)).toBe(DENIED)
    })
  })
  it('el LT lee todo y la base no le deja escribir en ninguna tabla de negocio', async () => {
    const acc = (await marcoStore()).id
    await asPersona('luis.tovar', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.accounts set locality = 'X' where id = ${acc}`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`insert into crm.leads (market_code, source, motor, business_name, contact_name) values ('MX', 'manual', 'd2d', 'x', 'y')`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`update crm.deals set title = 'x' where account_id = ${acc}`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`insert into crm.activities (market_code, account_id, kind, subject) values ('MX', ${acc}, 'note', 'x')`)).toBe(DENIED)
    })
  })
  it('solo administración toca configuración, membresías y lo que escribe la integración', async () => {
    const acc = (await marcoStore()).id
    for (const key of ['ana.robles', 'fernando.ibarra', 'marco.pena', 'valeria.soto', 'luis.tovar']) {
      await asPersona(key, async (tx) => {
        expect(await attempt(tx, (sp) => sp`update crm.stages set rot_days = 1`), `${key} stages`).toBe('0 rows')
        expect(await attempt(tx, (sp) => sp`insert into crm.memberships (user_id, market_code, role) values (app.current_user_id(), null, 'admin')`), `${key} memberships`).toBe(DENIED)
        expect(await attempt(tx, (sp) => sp`update crm.routing_rules set cursor = 0`), `${key} routing`).toBe('0 rows')
        expect(await attempt(tx, (sp) => sp`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${acc}, 'MX', 'sales_core', 'X-1')`), `${key} alias`).toBe(DENIED)
        expect(await attempt(tx, (sp) => sp`insert into crm.visits (market_code, account_id, external_visit_id, salesperson_ref, business_date, checked_in_at, outcome) values ('MX', ${acc}, 'x', 'y', current_date, now(), 'sale')`), `${key} visit`).toBe(DENIED)
        expect(await attempt(tx, (sp) => sp`insert into crm.merchant_metrics_daily (account_id, as_of, market_code, currency) values (${acc}, current_date, 'MX', 'MXN')`), `${key} metrics`).toBe(DENIED)
        expect((await tx`select 1 from crm.api_clients`).length, `${key} api`).toBe(0)
        expect((await tx`select 1 from crm.inbound_events`).length, `${key} inbound`).toBe(0)
      })
    }
  })
  it('nadie firma un evento de auditoría a nombre de otra persona', async () => {
    await asPersona('marco.pena', async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into crm.audit_events (actor_id, action, object) values (md5('contigo:nora.salas')::uuid, 'fake', 'x')`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`insert into crm.audit_events (actor_id, action, object) values (app.current_user_id(), 'mine', 'x')`)).toBe('ok')
    })
  })
  it('una persona sintética no entra si el modo de personas está apagado, y nunca se abre sesión de sistema', async () => {
    const sys = await one(admin<{ id: string }[]>`select id from crm.users where is_system`)
    const { withoutUser } = await import('@/server/db')
    await expect(withoutUser((tx) => tx`select app.session_create(${sys.id}, 'h-sys', 'persona', 1)`)).rejects.toMatchObject({ code: DENIED })
    await admin`update crm.settings set value = 'false' where key = 'demo_personas'`
    try {
      await expect(withoutUser(async (tx) => tx`select app.session_create(${await personaId('nora.salas')}, 'h-off', 'persona', 1)`)).rejects.toMatchObject({ code: DENIED })
      expect((await withoutUser((tx) => tx`select * from app.persona_list()`)).length).toBe(0)
    } finally {
      await admin`update crm.settings set value = 'true' where key = 'demo_personas'`
    }
  })
})

describe('integridad', () => {
  it('la bitácora es de solo inserción incluso para el dueño del esquema', async () => {
    await expect(admin`update crm.audit_events set action = 'tampered'`).rejects.toMatchObject({ code: '42501' })
    await expect(admin`delete from crm.audit_events`).rejects.toMatchObject({ code: '42501' })
    await expect(admin`truncate crm.audit_events`).rejects.toMatchObject({ code: '42501' })
  })
  it('el árbol de cuentas rechaza ciclos y recalcula los ancestros al mover una rama', async () => {
    await admin.begin(async (tx) => {
      const [a] = await tx<{ id: string }[]>`insert into crm.accounts (market_code, kind, name) values ('MX', 'organization', 'Raíz') returning id`
      const [b] = await tx<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, parent_id) values ('MX', 'chain', 'Rama', ${a!.id}) returning id`
      const [c] = await tx<{ id: string; ancestor_ids: string[] }[]>`insert into crm.accounts (market_code, kind, name, parent_id) values ('MX', 'store', 'Hoja', ${b!.id}) returning id, ancestor_ids`
      expect(c!.ancestor_ids).toEqual([a!.id, b!.id])
      await expect(tx.savepoint((sp) => sp`update crm.accounts set parent_id = ${c!.id} where id = ${a!.id}`)).rejects.toMatchObject({ code: '23514' })
      await expect(tx.savepoint((sp) => sp`update crm.accounts set parent_id = ${a!.id} where id = ${a!.id}`)).rejects.toBeTruthy()
      const [r2] = await tx<{ id: string }[]>`insert into crm.accounts (market_code, kind, name) values ('MX', 'organization', 'Otra raíz') returning id`
      await tx`update crm.accounts set parent_id = ${r2!.id} where id = ${b!.id}`
      const [leaf] = await tx<{ ancestor_ids: string[] }[]>`select ancestor_ids from crm.accounts where id = ${c!.id}`
      expect(leaf!.ancestor_ids).toEqual([r2!.id, b!.id])
      throw new Error('rollback')
    }).catch((e) => {
      if ((e as Error).message !== 'rollback') throw e
    })
  })
  it('las restricciones de datos se cumplen en la base: E.164, dinero no negativo, motivo al perder', async () => {
    const acc = await one(admin<{ id: string }[]>`select id from crm.accounts limit 1`)
    await expect(admin`update crm.accounts set phone = '5512345678' where id = ${acc.id}`).rejects.toMatchObject({ code: '23514' })
    const d = await one(admin<{ id: string }[]>`select id from crm.deals where status = 'open' limit 1`)
    await expect(admin`update crm.deals set amount_minor = -1 where id = ${d.id}`).rejects.toMatchObject({ code: '23514' })
    await expect(admin`update crm.deals set status = 'lost', loss_reason_code = null where id = ${d.id}`).rejects.toMatchObject({ code: '23514' })
  })
  it('los UUID nuevos son versión 7 y salen ordenados en el tiempo', async () => {
    const rows = await admin<{ id: string }[]>`select app.uuid_v7() as id from generate_series(1, 5)`
    for (const r of rows) expect(r.id[14]).toBe('7')
    const a = (await one(admin<{ id: string }[]>`select app.uuid_v7() as id`)).id
    await new Promise((r) => setTimeout(r, 5))
    const b = (await one(admin<{ id: string }[]>`select app.uuid_v7() as id`)).id
    expect(a < b).toBe(true)
  })
})
