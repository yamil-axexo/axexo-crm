import { describe, it, expect, beforeAll } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { withUser, withoutUser } from '@/server/db'
import { updateAccount, createAccount } from '@/domain/accounts'
import { createSubscriber, publishDue, resendDelivery, rotateSubscriberSecret, setSubscriberStatus, sign, subscriberSecret, MAX_ATTEMPTS } from '@/domain/publisher'
import { simulatedDeliveries } from '@/server/adapters/event-delivery'
import { publishEventsJob, rateCleanupJob } from '@/server/jobs/eventos-api'
import { JOBS } from '@/server/jobs/registry'
import { createApiKey, rotateApiKey } from '@/domain/api-keys'
import { hashKey, revokeApiClient } from '@/domain/admin'
import { readCatalogs, readResource, type ApiKey } from '@/dal/api-v1'
import { rateHit } from '@/server/protect'

const sql = <T>(fn: (db: ReturnType<typeof owner>) => Promise<T>) => {
  const db = owner()
  return fn(db).finally(() => db.end())
}
const keyOf = async (raw: string): Promise<ApiKey> => {
  const rows = await withoutUser((tx) => tx<{ id: string; scopes: string[]; market_code: string | null; mode: 'live' | 'test'; rate_per_minute: number; created_by: string | null }[]>`select * from app.api_key(${hashKey(raw)})`)
  const c = rows[0]!
  return { id: c.id, scopes: c.scopes, market: c.market_code, mode: c.mode, ratePerMinute: c.rate_per_minute, createdBy: c.created_by }
}

describe('AUT-02 · eventos de dominio', () => {
  beforeAll(() => {
    process.env.CONTIGO_EVENT_DELIVERY = 'simulated'
  })

  it('un cambio que antes solo quedaba en la bitácora ahora emite su evento en la misma transacción, con versión y sin valores', async () => {
    const ctx = await ctxFor('ana.robles')
    const acc = await sql((db) => db<{ id: string }[]>`select id from crm.accounts where market_code = 'MX' and archived_at is null and owner_id is not null order by created_at limit 1`)
    const id = acc[0]!.id
    const before = await sql((db) => db<{ n: number }[]>`select count(*)::int as n from crm.outbox_events where event_type = 'account.updated'`)
    const row = await sql((db) => db<{ name: string }[]>`select name from crm.accounts where id = ${id}`)
    await updateAccount(ctx, id, { name: row[0]!.name, locality: 'Ciudad Nueva' })
    const ev = await sql((db) => db<{ version: number; aggregate: string; aggregate_id: string; payload: { changed: string[]; actor_id: string }; market_code: string }[]>`
      select version, aggregate, aggregate_id, payload, market_code from crm.outbox_events where event_type = 'account.updated' order by created_at desc limit 1`)
    const after = await sql((db) => db<{ n: number }[]>`select count(*)::int as n from crm.outbox_events where event_type = 'account.updated'`)
    expect(after[0]!.n).toBe(before[0]!.n + 1)
    expect(ev[0]).toMatchObject({ version: 1, aggregate: 'account', aggregate_id: id, market_code: 'MX' })
    expect(ev[0]!.payload.actor_id).toBe(ctx.user.id)
    expect(Array.isArray(ev[0]!.payload.changed)).toBe(true)
    // Nunca valores: el nombre de la ciudad no viaja en el evento.
    expect(JSON.stringify(ev[0]!.payload)).not.toContain('Ciudad Nueva')
  })

  it('si la transacción se revierte, el evento no queda', async () => {
    const before = await sql((db) => db<{ n: number }[]>`select count(*)::int as n from crm.outbox_events`)
    await asPersona('ana.robles', async (tx) => {
      await tx`insert into crm.outbox_events (event_type, aggregate, aggregate_id, market_code, payload) values ('account.updated', 'account', app.uuid_v7(), 'MX', '{}'::jsonb)`
    })
    const after = await sql((db) => db<{ n: number }[]>`select count(*)::int as n from crm.outbox_events`)
    expect(after[0]!.n).toBe(before[0]!.n)
  })

  it('la bandeja es de solo inserción: ni administración puede cambiar un evento', async () => {
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.outbox_events set payload = '{}'::jsonb`)).toBe('42501')
    })
  })

  it('una acción con evento propio no emite dos veces', async () => {
    const ctx = await ctxFor('ana.robles')
    const out = await createAccount(ctx, { market: 'MX', name: 'Abarrotes Evento Único', segment: 'd2d', phone: '5512340987' })
    const evs = await sql((db) => db<{ event_type: string }[]>`select event_type from crm.outbox_events where aggregate_id = ${out.id!}`)
    expect(evs.map((e) => e.event_type)).toEqual(['account.created'])
  })

  it('solo administración da de alta suscriptores, con destino https público y eventos del catálogo', async () => {
    const admin = await ctxFor('nora.salas')
    await expect(createSubscriber(await ctxFor('ana.robles'), { name: 'Sales Core', destination: 'https://ok.example.invalid/hook', eventTypes: ['*'] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createSubscriber(admin, { name: 'Interno', destination: 'https://localhost/hook', eventTypes: ['*'] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createSubscriber(admin, { name: 'Sin https', destination: 'http://ok.example.invalid/hook', eventTypes: ['*'] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createSubscriber(admin, { name: 'Evento raro', destination: 'https://ok.example.invalid/hook', eventTypes: ['no.existe'] })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('el publicador reparte, entrega firmado, reintenta con espera creciente, deja muertos y se reenvía a mano', async () => {
    const admin = await ctxFor('nora.salas')
    const ok = await createSubscriber(admin, { name: 'Sales Core pruebas', destination: 'https://ok.example.invalid/hook', eventTypes: ['account.created'], market: 'MX' })
    const down = await createSubscriber(admin, { name: 'Suscriptor caído', destination: 'https://fail.example.invalid/hook', eventTypes: ['account.created'] })
    expect(ok.secret).toMatch(/^whsec_[0-9a-f]{64}$/)
    // El secreto no está en la base: no hay columna que lo guarde.
    const cols = await sql((db) => db<{ column_name: string }[]>`select column_name from information_schema.columns where table_schema = 'crm' and table_name = 'event_subscribers'`)
    expect(cols.map((c) => c.column_name).some((c) => /secret$|secret_hash|token/.test(c))).toBe(false)

    const created = await createAccount(await ctxFor('ana.robles'), { market: 'MX', name: 'Miscelánea Publicada', segment: 'd2d', phone: '5512340988' })
    simulatedDeliveries.length = 0
    // El job corre sin persona: toma la identidad de sistema dentro de la transacción que le dan.
    const first = await withoutUser((tx) => publishEventsJob.run(tx))
    expect(first.note).toContain('mode=simulated')
    const rows = () => sql((db) => db<{ subscriber_id: string; status: string; attempts: number; next_attempt_at: Date; id: string }[]>`
      select d.subscriber_id, d.status, d.attempts, d.next_attempt_at, d.id from crm.event_deliveries d where d.event_id in (select id from crm.outbox_events where aggregate_id = ${created.id!})`)
    let r = await rows()
    expect(r.find((x) => x.subscriber_id === ok.id)).toMatchObject({ status: 'delivered', attempts: 1 })
    expect(r.find((x) => x.subscriber_id === down.id)).toMatchObject({ status: 'retrying', attempts: 1 })
    expect(r.find((x) => x.subscriber_id === down.id)!.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 30_000)

    // Lo que salió: sobre con id, tipo, versión y registro; firma verificable con el secreto del suscriptor.
    const sent = simulatedDeliveries.find((d) => d.destination.includes('ok.example'))!
    const body = JSON.parse(sent.body)
    expect(body).toMatchObject({ type: 'account.created', version: 1, market: 'MX', aggregate: { type: 'account', id: created.id }, data: { kind: 'store' } })
    const [t, v1] = sent.headers['x-contigo-signature']!.split(',')
    expect(`${t},${v1}`).toBe(sign(ok.secret!, Number(t!.slice(2)), sent.body))

    // Correr otra vez no vuelve a entregar lo entregado ni adelanta el reintento.
    simulatedDeliveries.length = 0
    await withoutUser((tx) => publishEventsJob.run(tx))
    expect(simulatedDeliveries.filter((d) => JSON.parse(d.body).aggregate.id === created.id)).toHaveLength(0)

    // Se agotan los intentos: queda en mensajes muertos.
    const dead = r.find((x) => x.subscriber_id === down.id)!
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await sql((db) => db`update crm.event_deliveries set next_attempt_at = now() - interval '1 second' where id = ${dead.id}`)
      await withoutUser((tx) => publishEventsJob.run(tx))
    }
    r = await rows()
    expect(r.find((x) => x.id === dead.id)).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS })

    // Reenvío manual: vuelve a la fila con los intentos en cero y queda en la bitácora.
    await expect(resendDelivery(await ctxFor('ana.robles'), dead.id)).rejects.toMatchObject({ code: 'forbidden' })
    await resendDelivery(admin, dead.id)
    r = await rows()
    expect(r.find((x) => x.id === dead.id)).toMatchObject({ status: 'ready', attempts: 0 })
    const log = await sql((db) => db`select 1 from crm.audit_events where action = 'event_delivery.resent' and object_id = ${dead.id}`)
    expect(log).toHaveLength(1)

    // Pausado no recibe; rotar cambia el secreto.
    await setSubscriberStatus(admin, down.id, 'paused')
    simulatedDeliveries.length = 0
    await withUser(admin.user.id, (tx) => publishDue(tx))
    expect(simulatedDeliveries.filter((d) => d.destination.includes('fail.'))).toHaveLength(0)
    const rotated = await rotateSubscriberSecret(admin, ok.id)
    expect(rotated).toBe(subscriberSecret(ok.id, 2))
    expect(rotated).not.toBe(ok.secret)
  })

  it('con el canal apagado nada sale: el evento queda listo para publicar', async () => {
    process.env.CONTIGO_EVENT_DELIVERY = ''
    const admin = await ctxFor('nora.salas')
    const sub = await createSubscriber(admin, { name: 'Canal apagado', destination: 'https://ok.example.invalid/off', eventTypes: ['account.created'] })
    await createAccount(await ctxFor('ana.robles'), { market: 'MX', name: 'Tienda Lista Para Publicar', segment: 'd2d', phone: '5512340989' })
    simulatedDeliveries.length = 0
    const out = await withoutUser((tx) => publishEventsJob.run(tx))
    expect(out.note).toContain('mode=off')
    expect(simulatedDeliveries).toHaveLength(0)
    const r = await sql((db) => db<{ status: string; attempts: number }[]>`select status, attempts from crm.event_deliveries where subscriber_id = ${sub.id}`)
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((x) => x.status === 'ready' && x.attempts === 0)).toBe(true)
    process.env.CONTIGO_EVENT_DELIVERY = 'simulated'
  })

  it('los jobs están en el registro con llave propia', () => {
    expect(JOBS.map((j) => j.key)).toEqual(expect.arrayContaining(['eventos-api.publish', 'eventos-api.rate-cleanup']))
    expect(rateCleanupJob.everyMinutes).toBeGreaterThan(0)
  })

  it('quien no administra no lee suscriptores ni entregas', async () => {
    await asPersona('ana.robles', async (tx) => {
      expect((await tx`select 1 from crm.event_subscribers`).length).toBe(0)
      expect((await tx`select 1 from crm.event_deliveries`).length).toBe(0)
    })
  })
})

describe('AUT-04 · API de lectura', () => {
  it('una llave de lectura es de un mercado, con permisos mínimos, y lee solo ese mercado', async () => {
    const admin = await ctxFor('nora.salas')
    await expect(createApiKey(admin, { name: 'Lector sin mercado', scopes: ['accounts:read'] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createApiKey(await ctxFor('ana.robles'), { name: 'No admin', scopes: ['accounts:read'], market: 'MX' })).rejects.toMatchObject({ code: 'forbidden' })
    const made = await createApiKey(admin, { name: 'Lector MX', scopes: ['accounts:read', 'deals:read', 'leads:read', 'activities:read', 'catalogs:read'], market: 'MX' })
    expect(made.key).toMatch(/^ctg_[A-Za-z0-9_-]{40}$/)
    const key = await keyOf(made.key)
    expect(key).toMatchObject({ market: 'MX', mode: 'live', ratePerMinute: 120 })

    const p1 = await readResource(key, 'accounts', new URLSearchParams({ limit: '5' }))
    expect(p1.data).toHaveLength(5)
    expect(p1.next_cursor).toBeTruthy()
    expect(p1.data.every((a) => a.market === 'MX')).toBe(true)
    // Sin teléfonos ni correos.
    expect(Object.keys(p1.data[0]!)).not.toEqual(expect.arrayContaining(['phone']))
    expect(Object.keys(p1.data[0]!)).not.toEqual(expect.arrayContaining(['email']))
    const p2 = await readResource(key, 'accounts', new URLSearchParams({ limit: '5', cursor: p1.next_cursor! }))
    expect(p2.data.map((a) => a.id)).not.toEqual(expect.arrayContaining(p1.data.map((a) => a.id)))
    expect(String(p2.data[0]!.id) > String(p1.data[4]!.id)).toBe(true)

    // Recorrer todas las páginas da exactamente los comercios vivos del mercado.
    let cursor: string | null = null
    let total = 0
    do {
      const page: Awaited<ReturnType<typeof readResource>> = await readResource(key, 'accounts', new URLSearchParams({ limit: '200', ...(cursor ? { cursor } : {}) }))
      total += page.data.length
      cursor = page.next_cursor
    } while (cursor)
    const expected = await sql((db) => db<{ n: number }[]>`select count(*)::int as n from crm.accounts where market_code = 'MX' and archived_at is null`)
    expect(total).toBe(expected[0]!.n)

    const won = await readResource(key, 'deals', new URLSearchParams({ status: 'won', limit: '200' }))
    expect(won.data.length).toBeGreaterThan(0)
    expect(won.data.every((d) => d.status === 'won' && d.market === 'MX')).toBe(true)
    const leads = await readResource(key, 'leads', new URLSearchParams({ limit: '3' }))
    expect(Object.keys(leads.data[0]!)).not.toEqual(expect.arrayContaining(['contact_name']))
    const acts = await readResource(key, 'activities', new URLSearchParams({ limit: '3' }))
    expect(Object.keys(acts.data[0]!)).not.toEqual(expect.arrayContaining(['subject']))
    const cat = await readCatalogs(key) as { pipelines: { stages: unknown[] }[] }
    expect(cat.pipelines.length).toBeGreaterThan(0)
    expect(cat.pipelines[0]!.stages.length).toBeGreaterThan(0)

    await expect(readResource(key, 'accounts', new URLSearchParams({ limit: '500' }))).rejects.toMatchObject({ code: 'invalid_filter', status: 400 })
    await expect(readResource(key, 'accounts', new URLSearchParams({ lifecycle: 'x' }))).rejects.toMatchObject({ code: 'invalid_filter' })
    await expect(readResource(key, 'accounts', new URLSearchParams({ sql: '1' }))).rejects.toMatchObject({ code: 'invalid_filter' })
    await expect(readResource(key, 'accounts', new URLSearchParams({ cursor: 'zzz' }))).rejects.toMatchObject({ code: 'invalid_filter' })
  })

  it('la llave nunca ve más que quien la creó: si esa persona pierde el acceso, la llave deja de leer', async () => {
    const admin = await ctxFor('nora.salas')
    const made = await createApiKey(admin, { name: 'Lector atado', scopes: ['accounts:read'], market: 'MX' })
    // La llave queda a nombre de alguien que solo ve su cartera: la API devuelve lo mismo que su pantalla.
    const rep = await personaId('ivan.rios')
    await sql((db) => db`update crm.api_clients set created_by = ${rep} where id = ${made.id}`)
    const key = await keyOf(made.key)
    const mine = await withUser(rep, (tx) => tx<{ n: number }[]>`select count(*)::int as n from crm.accounts where market_code = 'MX' and archived_at is null`)
    const all = await sql((db) => db<{ n: number }[]>`select count(*)::int as n from crm.accounts where market_code = 'MX' and archived_at is null`)
    let total = 0
    let cursor: string | null = null
    do {
      const page: Awaited<ReturnType<typeof readResource>> = await readResource(key, 'accounts', new URLSearchParams({ limit: '200', ...(cursor ? { cursor } : {}) }))
      total += page.data.length
      cursor = page.next_cursor
    } while (cursor)
    expect(total).toBe(mine[0]!.n)
    expect(total).toBeLessThan(all[0]!.n)
    await sql((db) => db`update crm.users set is_active = false where id = ${rep}`)
    await expect(readResource(key, 'accounts', new URLSearchParams())).rejects.toMatchObject({ status: 403 })
    await sql((db) => db`update crm.users set is_active = true where id = ${rep}`)
  })

  it('una llave de prueba solo lee el juego sintético, nunca las tablas del negocio', async () => {
    const admin = await ctxFor('nora.salas')
    await expect(createApiKey(admin, { name: 'Prueba que escribe', scopes: ['events:write'], mode: 'test' })).rejects.toMatchObject({ code: 'invalid' })
    const made = await createApiKey(admin, { name: 'Sandbox MX', scopes: ['accounts:read', 'deals:read', 'catalogs:read'], market: 'MX', mode: 'test' })
    expect(made.key.startsWith('ctg_test_')).toBe(true)
    const key = await keyOf(made.key)
    const page = await readResource(key, 'accounts', new URLSearchParams({ limit: '5' }))
    expect(page.data).toHaveLength(5)
    expect(page.next_cursor).toBeTruthy()
    const real = await sql((db) => db<{ id: string }[]>`select id from crm.accounts`)
    const ids = new Set(real.map((r) => r.id))
    expect(page.data.some((a) => ids.has(String(a.id)))).toBe(false)
    expect(page.data.every((a) => String(a.id).startsWith('00000000-'))).toBe(true)
    const filtered = await readResource(key, 'accounts', new URLSearchParams({ lifecycle: 'active' }))
    expect(filtered.data.length).toBeGreaterThan(0)
    expect(filtered.data.every((a) => a.lifecycle === 'active')).toBe(true)
    expect((await readCatalogs(key) as { market: string }).market).toBe('MX')
  })

  it('rotar deja dos llaves vigentes; la anterior vence sola en su fecha de retiro; revocar corta de inmediato', async () => {
    const admin = await ctxFor('nora.salas')
    const made = await createApiKey(admin, { name: 'Rotación', scopes: ['accounts:read'], market: 'MX', ratePerMinute: 30 })
    await expect(rotateApiKey(admin, made.id, 45)).rejects.toMatchObject({ code: 'invalid' })
    const next = await rotateApiKey(admin, made.id, 7)
    expect(next.key).not.toBe(made.key)
    expect(Math.round((next.retireAt.getTime() - Date.now()) / 86_400_000)).toBe(7)
    expect((await keyOf(made.key)).id).toBe(made.id)
    expect(await keyOf(next.key)).toMatchObject({ id: next.id, market: 'MX', ratePerMinute: 30 })
    await expect(rotateApiKey(admin, made.id, 7)).rejects.toMatchObject({ code: 'invalid' })
    // Último uso visible.
    const used = await sql((db) => db<{ last_used_at: Date | null }[]>`select last_used_at from crm.api_clients where id = ${next.id}`)
    expect(used[0]!.last_used_at).toBeInstanceOf(Date)
    // Llega la fecha de retiro: la anterior deja de valer sin que nadie haga nada.
    await sql((db) => db`update crm.api_clients set retire_at = now() - interval '1 minute' where id = ${made.id}`)
    const gone = await withoutUser((tx) => tx`select * from app.api_key(${hashKey(made.key)})`)
    expect(gone).toHaveLength(0)
    expect(await withoutUser((tx) => tx`select * from app.api_client(${hashKey(made.key)})`)).toHaveLength(0)
    await revokeApiClient(admin, next.id)
    expect(await withoutUser((tx) => tx`select * from app.api_key(${hashKey(next.key)})`)).toHaveLength(0)
  })

  it('el límite de frecuencia vive en la base: pasa hasta el tope y después dice cuánto esperar', async () => {
    const bucket = `test:${Date.now()}`
    for (let i = 0; i < 5; i++) expect((await rateHit(bucket, 5, 60)).allowed).toBe(true)
    const blocked = await rateHit(bucket, 5, 60)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1)
    expect(blocked.retryAfter).toBeLessThanOrEqual(60)
    expect((await rateHit(`${bucket}:otra`, 5, 60)).allowed).toBe(true)
    // Nadie lee ni escribe los contadores directo.
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`select 1 from crm.rate_counters`)).toBe('42501')
    })
    // La ventana anterior todavía pesa: no se reinicia de golpe al cambiar el minuto.
    await sql((db) => db`update crm.rate_counters set window_start = window_start - interval '60 seconds' where bucket = ${bucket}`)
    const slid = await withoutUser((tx) => tx<{ allowed: boolean; used: number }[]>`select allowed, used from app.rate_hit(${bucket}, 5, 60)`)
    expect(slid[0]!.used).toBe(1)
    const cleaned = await withoutUser((tx) => rateCleanupJob.run(tx))
    expect(cleaned.done).toBeGreaterThanOrEqual(0)
  })
})

void systemContext
