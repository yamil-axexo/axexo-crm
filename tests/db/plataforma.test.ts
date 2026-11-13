import { afterAll, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { withUser } from '@/server/db'
import { loadCtx } from '@/server/context'
import { takeEvents } from '@/domain/plataforma/outbox'
import { liveSignals, noticesFromOutbox } from '@/domain/plataforma/feed'
import { simulatedBroadcasts } from '@/server/adapters/realtime'
import { apiCreateActivity, apiCreateLead, apiMoveDeal, apiUpdateAccount } from '@/domain/plataforma/api-write'
import { createApiKey } from '@/domain/api-keys'
import { phoneCandidates, textQuery } from '@/lib/search-terms'
import { searchAll, listAccounts } from '@/dal/accounts'
import { reservedFields, revealReserved, setReserved } from '@/domain/plataforma/sensitive'
import { dlpMask, hasCardNumber } from '@/domain/guard'
import { recordActivity } from '@/domain/activities'
import { flagApplies, flagOn, recordRedteam, REDTEAM_CHECKLIST, rotationReminders, setFlag, setPlatformValue, setSecretBackup, agentsWithoutRedteam } from '@/domain/plataforma/admin'
import { approveAuthorization, authorizeRequest, createMcpClient, exchangeCode, revokeMcpClient, tokenUser } from '@/domain/plataforma/mcp-oauth'
import { egressCheck, egressFetch, EgressBlocked } from '@/server/net/egress'
import { JOBS } from '@/server/jobs/registry'
import { AUDIT_ACTION } from '@/lib/audit'
import { decide } from '@/domain/events/catalog'
import { plan } from '../../scripts/synthetic-lib.mjs'
import { restoreTest } from '../../scripts/restore-test.mjs'
import { createHash, randomBytes } from 'node:crypto'

// Paquete plataforma (0045): AUT-02, AUT-05, AUT-04, UX-02, UX-04, SEG-02, SEG-03, SEG-04, SEG-08, GOB-04, GOB-07, GOB-08,
// IA-06, IA-07, E9.F13. 42501 = la base rechazó la operación.
const DENIED = '42501'
const admin = owner()
const URL_ = process.env.UNIT_MIGRATION_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/contigo_unit'
const NEW_TABLES = ['outbox_consumers', 'outbox_consumed', 'live_signals', 'event_notice_rules', 'record_sensitive', 'feature_flags', 'platform_values', 'mcp_oauth_clients', 'mcp_oauth_codes', 'mcp_oauth_tokens', 'agent_redteam_reviews']
const one = async <T,>(p: Promise<readonly T[]>) => (await p)[0]!
const sys = async () => (await systemContext()).user.id
const asSystem = async <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => withUser(await sys(), fn as never) as Promise<T>
const emitRaw = (type: string, aggregate: string, id: string, market: string | null, actor: string | null = null) =>
  admin`insert into crm.outbox_events (event_type, aggregate, aggregate_id, market_code, payload) values (${type}, ${aggregate}, ${id}, ${market}, ${admin.json({ changed: [], actor_id: actor })})`

afterAll(async () => {
  await admin.end()
})

describe('base: tablas nuevas con RLS forzado; lo reservado sin acceso directo', () => {
  it('RLS forzado en las tablas nuevas', async () => {
    const rows = await admin<{ relname: string; ok: boolean }[]>`select relname, relrowsecurity and relforcerowsecurity as ok from pg_class where relnamespace = 'crm'::regnamespace and relname = any(${NEW_TABLES})`
    expect(rows.map((r) => r.relname).sort()).toEqual([...NEW_TABLES].sort())
    for (const r of rows) expect(r.ok, r.relname).toBe(true)
  })

  it('la app no lee ni escribe datos reservados, anotaciones de la cola ni tokens directo', async () => {
    await asPersona('nora.salas', async (tx) => {
      for (const t of ['record_sensitive', 'outbox_consumed', 'mcp_oauth_codes']) expect(await attempt(tx, (sp) => sp.unsafe(`select 1 from crm.${t}`) as never), t).toBe(DENIED)
    })
    await asPersona('lucia.vega', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.feature_flags set enabled = false where key = 'live_updates'`)).toBe('0 rows')
      expect(await attempt(tx, (sp) => sp`select * from app.outbox_take('automations', 10)`)).toBe(DENIED)
      expect((await tx`select 1 from crm.event_notice_rules`).length).toBe(0)
    })
  })
})

describe('AUT-02: la cola se lee por transacción confirmada', () => {
  it('una transacción larga que confirma tarde no queda saltada, y lo de un consumidor que falla vuelve a estar disponible', async () => {
    await asSystem((tx) => takeEvents(tx, 'automations', 500)) // fija desde dónde lee
    while ((await asSystem((tx) => takeEvents(tx, 'automations', 500))).length > 0) { /* vacía lo pendiente */ }
    const late = postgres(URL_, { max: 1, onnotice: () => {} })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const lateId = '01a1d6de-0000-7000-8000-00000000a001'
    const fastId = '01a1d6de-0000-7000-8000-00000000a002'
    let started!: () => void
    const inside = new Promise<void>((r) => (started = r))
    const longTx = late.begin(async (tx) => {
      await tx`insert into crm.outbox_events (event_type, aggregate, aggregate_id, market_code, payload) values ('lead.created', 'lead', ${lateId}, 'MX', '{}'::jsonb)`
      started()
      await gate
    })
    await inside
    await emitRaw('lead.created', 'lead', fastId, 'MX')
    // Mientras la larga sigue abierta, nada de lo posterior se entrega (con el cursor viejo, la rápida pasaba y la larga se perdía).
    const first = await asSystem((tx) => takeEvents(tx, 'automations', 500))
    expect(first.map((e) => e.aggregate_id)).not.toContain(lateId)
    release()
    await longTx
    await late.end()
    const second = await asSystem((tx) => takeEvents(tx, 'automations', 500))
    const ids = [...first, ...second].map((e) => e.aggregate_id)
    expect(ids).toContain(lateId)
    expect(ids).toContain(fastId)
    expect(ids.filter((x) => x === lateId)).toHaveLength(1)
    // Un consumidor que falla: su transacción se revierte y los eventos vuelven a estar disponibles.
    await emitRaw('lead.created', 'lead', '01a1d6de-0000-7000-8000-00000000a003', 'MX')
    await expect(asSystem(async (tx) => {
      const got = await takeEvents(tx, 'automations', 500)
      expect(got.length).toBeGreaterThan(0)
      throw new Error('falla el consumidor')
    })).rejects.toThrow('falla el consumidor')
    const again = await asSystem((tx) => takeEvents(tx, 'automations', 500))
    expect(again.map((e) => e.aggregate_id)).toContain('01a1d6de-0000-7000-8000-00000000a003')
  }, 30_000)

  it('las señales en vivo marcan el tema del mercado; Broadcast simulado manda solo tema y tipo, sin datos', async () => {
    process.env.REALTIME_ADAPTER = 'simulated'
    await asSystem((tx) => liveSignals(tx))
    const deal = await one(admin<{ id: string }[]>`select id from crm.deals where market_code = 'MX' limit 1`)
    await emitRaw('deal.stage_changed', 'deal', deal.id, 'MX')
    const out = await asSystem((tx) => liveSignals(tx))
    expect(out.events).toBeGreaterThan(0)
    expect((await admin`select 1 from crm.live_signals where topic = 'MX:deal'`).length).toBe(1)
    const sent = simulatedBroadcasts().find((s) => s.topic === 'MX:deal')
    expect(sent).toMatchObject({ topic: 'MX:deal', event: 'deal.stage_changed' })
    expect(JSON.stringify(sent)).not.toContain(deal.id)
    delete process.env.REALTIME_ADAPTER
    // Quien vende en MX ve la marca de su mercado; la de US no.
    await admin`insert into crm.live_signals (topic, market_code) values ('US:deal', 'US') on conflict do nothing`
    await asPersona('lucia.vega', async (tx) => {
      const topics = (await tx<{ topic: string }[]>`select topic from crm.live_signals`).map((r) => r.topic)
      expect(topics).toContain('MX:deal')
      expect(topics).not.toContain('US:deal')
    })
  })

  it('las tres tareas del paquete están en el registro', () => {
    expect(JOBS.map((j) => j.key)).toEqual(expect.arrayContaining(['plataforma.en_vivo', 'plataforma.avisos_eventos', 'plataforma.rotacion', 'plataforma.lecturas']))
  })
})

describe('AUT-05: el servicio de avisos se alimenta de la cola', () => {
  it('una regla encendida avisa a quien lleva el negocio; nunca a quien hizo el cambio; apagada no avisa', async () => {
    const ctxSys = await systemContext()
    await asSystem((tx) => noticesFromOutbox(tx, ctxSys))
    const marco = await personaId('marco.pena')
    const deal = await one(admin<{ id: string }[]>`select id from crm.deals where owner_id = ${marco} limit 1`)
    // Apagada (así nace): nada.
    await emitRaw('deal.reassigned', 'deal', deal.id, 'MX', await personaId('ana.robles'))
    await asSystem((tx) => noticesFromOutbox(tx, ctxSys))
    expect(await admin`select 1 from crm.notices where user_id = ${marco} and deal_id = ${deal.id} and title = 'Te pasaron un negocio'`).toHaveLength(0)
    // Encendida por administración: avisa al dueño, por el servicio único (queda en crm.notifications).
    const nora = await ctxFor('nora.salas')
    const rule = await one(admin<{ id: string }[]>`select id from crm.event_notice_rules where event_type = 'deal.reassigned'`)
    const { setNoticeRule } = await import('@/domain/plataforma/feed')
    await withUser(nora.user.id, (tx) => setNoticeRule(nora, tx, rule.id, true))
    await emitRaw('deal.reassigned', 'deal', deal.id, 'MX', await personaId('ana.robles'))
    const out = await asSystem((tx) => noticesFromOutbox(tx, ctxSys))
    expect(out.notices).toBeGreaterThan(0)
    expect(await admin`select 1 from crm.notices where user_id = ${marco} and deal_id = ${deal.id} and title = 'Te pasaron un negocio'`).toHaveLength(1)
    expect(await admin`select 1 from crm.notifications where recipient_user_id = ${marco} and deal_id = ${deal.id} and channel = 'in_app' and status = 'delivered'`).not.toHaveLength(0)
    // Si el cambio lo hizo el propio dueño, no se avisa a sí mismo.
    await emitRaw('deal.reassigned', 'deal', deal.id, 'MX', marco)
    await asSystem((tx) => noticesFromOutbox(tx, ctxSys))
    expect(await admin`select 1 from crm.notices where user_id = ${marco} and deal_id = ${deal.id} and title = 'Te pasaron un negocio'`).toHaveLength(1)
    // Solo administración enciende reglas.
    const lucia = await ctxFor('lucia.vega')
    await expect(withUser(lucia.user.id, (tx) => setNoticeRule(lucia, tx, rule.id, false))).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('AUT-04: API de escritura sobre el dominio', () => {
  it('las llaves de escritura son de un mercado y nunca de prueba', async () => {
    const nora = await ctxFor('nora.salas')
    await expect(createApiKey(nora, { name: 'Escritura sin mercado', scopes: ['activities:write'] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createApiKey(nora, { name: 'Escritura de prueba', scopes: ['activities:write'], market: 'MX', mode: 'test' })).rejects.toMatchObject({ code: 'invalid' })
    const k = await createApiKey(nora, { name: 'Escritura MX', scopes: ['activities:write', 'leads:write'], market: 'MX' })
    expect(k.key).toMatch(/^ctg_/)
  })

  it('mismas reglas, permisos y bitácora que la pantalla; otro mercado responde como si no existiera', async () => {
    const marco = await ctxFor('marco.pena')
    const acc = await one(admin<{ id: string }[]>`select id from crm.accounts where owner_id = ${marco.user.id} and archived_at is null limit 1`)
    const r = await apiCreateActivity(marco, 'MX', { account_id: acc.id, kind: 'note', subject: 'Nota desde la API', body: 'Pidió la lista de precios' })
    const ev = await one(admin<{ action: string; actor_id: string }[]>`select action, actor_id from crm.audit_events where object_id = ${r.id} order by at limit 1`)
    expect(ev.actor_id).toBe(marco.user.id)
    // Validación del dominio: una tarea sin fecha no entra, igual que en pantalla.
    await expect(apiCreateActivity(marco, 'MX', { account_id: acc.id, kind: 'task', subject: 'Llamar' })).rejects.toMatchObject({ code: 'invalid' })
    // Campos desconocidos: rechazo (contrato estricto).
    await expect(apiCreateActivity(marco, 'MX', { account_id: acc.id, kind: 'note', subject: 'x', amount: 1 })).rejects.toThrow()
    // Registro de otro mercado: 404.
    const us = await one(admin<{ id: string }[]>`select id from crm.accounts where market_code = 'US' and archived_at is null limit 1`)
    const nora = await ctxFor('nora.salas')
    await expect(apiUpdateAccount(nora, 'MX', us.id, { locality: 'Otra' })).rejects.toMatchObject({ code: 'not_found' })
    // Mover de etapa usa moveDeal: quien solo lee no puede.
    const deal = await one(admin<{ id: string; pipeline_id: string }[]>`select id, pipeline_id from crm.deals where owner_id = ${marco.user.id} and status = 'open' limit 1`)
    const stage = await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${deal.pipeline_id} and kind = 'open' order by position limit 1`)
    const lt = await ctxFor('luis.tovar')
    await expect(apiMoveDeal(lt, 'MX', deal.id, { stage_id: stage.id })).rejects.toMatchObject({ code: 'forbidden' })
    // Corregir un comercio deja el cambio en la bitácora con quien es dueño de la llave.
    await apiUpdateAccount(marco, 'MX', acc.id, { locality: 'Coyoacán' })
    expect((await one(admin<{ locality: string }[]>`select locality from crm.accounts where id = ${acc.id}`)).locality).toBe('Coyoacán')
  })
})

describe('GOB-08: el generador sintético alimenta las pruebas de contrato', () => {
  it('leads sintéticos de MX, US y SV (acentos, nombres largos, sin teléfono) pasan el contrato de escritura y entran por el dominio', async () => {
    const ctxs = { MX: await ctxFor('ana.robles'), US: await ctxFor('robert.hale'), SV: await ctxFor('nora.salas') } as const
    for (const market of ['MX', 'US', 'SV'] as const) {
      const motor = await one(admin<{ motor: string }[]>`select motor from crm.pipelines where market_code = ${market} order by position limit 1`)
      const rows = plan({ market, seed: 7, accounts: 30, depth: 2 }).filter((r: { edge: string | null }) => r.edge !== null).slice(0, 4)
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows as { name: string; phone: string | null; locality: string | null }[]) {
        const out = await apiCreateLead(ctxs[market], market, { sale_type: motor.motor, business_name: r.name.slice(0, 120), contact_name: 'Persona Sintética', phone: r.phone ?? undefined, locality: r.locality ?? undefined })
        const lead = await one(admin<{ market_code: string; phone: string | null }[]>`select market_code, phone from crm.leads where id = ${out.id}`)
        expect(lead.market_code).toBe(market)
        if (r.phone) expect(lead.phone).toMatch(/^\+[1-9]\d{6,14}$/)
      }
    }
  }, 60_000)
})

describe('UX-02: teléfono exacto, texto completo y tiempo medido', () => {
  it('el teléfono se normaliza a E.164 por mercado; un pedazo de número no es teléfono', () => {
    expect(phoneCandidates('55 1234 5678', ['MX'])).toEqual(['+525512345678'])
    expect(phoneCandidates('+1 (702) 555-0142', ['MX', 'US'])).toEqual(['+17025550142'])
    expect(phoneCandidates('12345', ['MX'])).toEqual([])
    expect(phoneCandidates('Abarrotes 5512345678', ['MX'])).toEqual([])
    expect(textQuery('Ñandú y Hijos', false)).toBe('nandu:* & hijos:*')
  })

  it('busca por teléfono exacto y por palabra; la búsqueda queda medida', async () => {
    const lucia = await ctxFor('lucia.vega')
    const acc = await one(admin<{ id: string; name: string; phone: string }[]>`select id, name, phone from crm.accounts where owner_id = ${lucia.user.id} and phone like '+52%' and archived_at is null limit 1`)
    const local = acc.phone.slice(3)
    expect((await searchAll(lucia, local)).accounts.map((a) => a.id)).toContain(acc.id)
    // Los últimos 7 dígitos ya no encuentran nada: no se busca por pedazo.
    expect((await searchAll(lucia, acc.phone.slice(-7))).accounts.map((a) => a.id)).not.toContain(acc.id)
    // Por palabras (texto completo con prefijo): el nombre escrito sin acentos y con la última palabra a medias.
    const words = acc.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter((w) => w.length >= 3)
    const typed = [...words.slice(0, -1), words.at(-1)!.slice(0, Math.max(3, words.at(-1)!.length - 1))].join(' ')
    expect((await searchAll(lucia, typed)).accounts.map((a) => a.id)).toContain(acc.id)
    const plan_ = await admin<{ plan: string }[]>`explain select 1 from crm.accounts where search_tsv @@ to_tsquery('simple', 'abarrotes:*')`
    expect(plan_.length).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 200))
    expect(await admin`select 1 from crm.request_metrics where screen = 'buscar' and n > 0`).not.toHaveLength(0)
  })
})

describe('SEG-02: datos reservados en negocio y contacto', () => {
  it('el reparto de comisión no lo ve quien vende aunque lleve el negocio; quien lidera lo carga y lo revela con motivo; el valor no entra a la bitácora', async () => {
    const marco = await ctxFor('marco.pena')
    const ana = await ctxFor('ana.robles')
    const deal = await one(admin<{ id: string }[]>`select id from crm.deals where owner_id = ${marco.user.id} and market_code = 'MX' limit 1`)
    const mine = await reservedFields(marco, 'deal', deal.id)
    expect(mine.map((f) => f.field_key)).not.toContain('deal_commission_split')
    expect(mine.find((f) => f.field_key === 'deal_special_terms')).toMatchObject({ can_view: true, can_edit: false })
    await expect(setReserved(marco, 'deal', deal.id, 'deal_commission_split', '60/40')).rejects.toBeTruthy()
    await setReserved(ana, 'deal', deal.id, 'deal_commission_split', 'ISO 60 / dealer 40')
    await expect(revealReserved(ana, 'deal', deal.id, 'deal_commission_split', 'corto')).rejects.toMatchObject({ code: 'invalid' })
    expect(await revealReserved(ana, 'deal', deal.id, 'deal_commission_split', 'Revisión de la liquidación del mes')).toBe('ISO 60 / dealer 40')
    const log = await admin<{ before: unknown; after: unknown }[]>`select before, after from crm.audit_events where object_id = ${deal.id} and action in ('sensitive.updated', 'sensitive.revealed')`
    expect(log.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(log)).not.toContain('dealer 40')
    expect(await admin`select 1 from audit.read_log where kind = 'reveal' and object = 'deal' and actor_id = ${ana.user.id}`).not.toHaveLength(0)
    // Un dato prohibido tampoco entra aquí.
    await expect(setReserved(ana, 'deal', deal.id, 'deal_special_terms', 'Tarjeta 4111 1111 1111 1111')).rejects.toMatchObject({ code: 'invalid' })
  })

  it('la nota reservada de un contacto la ve supervisión, no quien vende', async () => {
    const c = await one(admin<{ id: string }[]>`select ac.contact_id as id from crm.account_contacts ac join crm.accounts a on a.id = ac.account_id where a.market_code = 'MX' and ac.valid_to is null limit 1`)
    const ana = await ctxFor('ana.robles')
    await setReserved(ana, 'contact', c.id, 'contact_private_note', 'Prefiere que le llamen por la tarde')
    expect((await reservedFields(await ctxFor('marco.pena'), 'contact', c.id)).map((f) => f.field_key)).not.toContain('contact_private_note')
  })
})

describe('SEG-03: lecturas de listas en pantalla y alerta por volumen', () => {
  it('ver la lista de comercios queda en el registro de lecturas y pasar el umbral abre una alerta', async () => {
    const lucia = await ctxFor('lucia.vega')
    await listAccounts(lucia, {})
    expect(await admin`select 1 from audit.read_log where kind = 'list' and object = 'accounts' and actor_id = ${lucia.user.id}`).not.toHaveLength(0)
    await admin`update crm.settings set value = value || '{"list_rows_per_day": 1}'::jsonb where key = 'security.thresholds'`
    const n = await asSystem((tx) => tx<{ n: number }[]>`select app.security_scan_lists() as n`)
    expect(n[0]!.n).toBeGreaterThan(0)
    expect(await admin`select 1 from crm.security_alerts where kind = 'list_rows_per_day' and actor_id = ${lucia.user.id}`).toHaveLength(1)
  })

  it('toda tabla de crm tiene su trigger de bitácora (también las de 0045)', async () => {
    const missing = await admin<{ relname: string }[]>`
      select c.relname from pg_class c where c.relnamespace = 'crm'::regnamespace and c.relkind = 'r' and not c.relispartition
         and c.relname not in (select table_name from audit.excluded_tables)
         and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'zz_audit_capture')`
    expect(missing.map((m) => m.relname)).toEqual([])
  })
})

describe('SEG-04: el DLP tapa y avisa; solo una tarjeta válida bloquea', () => {
  it('cuenta CLABE y SSN quedan tapadas con los últimos 4; la tarjeta sigue bloqueando', async () => {
    expect(dlpMask('Su SSN es 123-45-6789, ok')).toEqual({ text: 'Su SSN es [SSN ••6789], ok', masked: true })
    expect(dlpMask('CLABE 002010077777777771').masked).toBe(true)
    expect(dlpMask('Pedido 12345').masked).toBe(false)
    expect(hasCardNumber('4111 1111 1111 1111')).toBe(true)
    const marco = await ctxFor('marco.pena')
    const acc = await one(admin<{ id: string }[]>`select id from crm.accounts where owner_id = ${marco.user.id} and archived_at is null limit 1`)
    const r = await recordActivity(marco, { accountId: acc.id, kind: 'note', subject: 'Datos de pago', body: 'Me dio su SSN 123-45-6789 para el alta' })
    expect(r.masked).toBe(true)
    const saved = await one(admin<{ body: string }[]>`select body from crm.activities where id = ${r.id}`)
    expect(saved.body).toContain('[SSN ••6789]')
    expect(saved.body).not.toContain('123-45-6789')
    await expect(recordActivity(marco, { accountId: acc.id, kind: 'note', subject: 'Pago', body: 'Tarjeta 4111 1111 1111 1111' })).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('SEG-08: suplente y rotación programada', () => {
  it('el suplente es otra persona; la rotación vencida avisa una vez al día al responsable', async () => {
    const nora = await ctxFor('nora.salas')
    const ana = await personaId('ana.robles')
    await admin`update crm.secret_inventory set owner_id = ${ana}, rotate_every_days = 30, last_rotated_on = (now() at time zone 'UTC')::date - 45, rotation_alerted_on = null where key = 'PIPEDRIVE_API_TOKEN'`
    await expect(setSecretBackup(nora, 'PIPEDRIVE_API_TOKEN', ana)).rejects.toMatchObject({ code: 'invalid' })
    await setSecretBackup(nora, 'PIPEDRIVE_API_TOKEN', await personaId('robert.hale'))
    await expect(setSecretBackup(await ctxFor('lucia.vega'), 'PIPEDRIVE_API_TOKEN', null)).rejects.toMatchObject({ code: 'forbidden' })
    const ctxSys = await systemContext()
    expect(await asSystem((tx) => rotationReminders(tx, ctxSys))).toBe(1)
    expect(await asSystem((tx) => rotationReminders(tx, ctxSys))).toBe(0)
    expect(await admin`select 1 from crm.notices where user_id = ${ana} and kind = 'security_alert' and link = '/admin/seguridad?s=llaves'`).toHaveLength(1)
  })
})

describe('GOB-04: funciones por rol y mercado', () => {
  it('una función acotada a un rol solo aplica a ese rol; cambiarla es de administración y queda en la bitácora', async () => {
    const nora = await ctxFor('nora.salas')
    const marco = await ctxFor('marco.pena')
    const ana = await ctxFor('ana.robles')
    expect(await flagOn(marco, 'live_updates')).toBe(true)
    await setFlag(nora, 'live_updates', { enabled: true, roles: ['market_lead'], markets: ['MX'] })
    expect(await flagOn(marco, 'live_updates')).toBe(false)
    expect(await flagOn(ana, 'live_updates')).toBe(true)
    expect(flagApplies({ enabled: true, roles: [], markets: ['US'] }, ana, 'MX')).toBe(false)
    await expect(setFlag(marco, 'live_updates', { enabled: false, roles: [], markets: [] })).rejects.toMatchObject({ code: 'forbidden' })
    expect(await admin`select 1 from crm.audit_events where action = 'flag.changed' and actor_id = ${nora.user.id}`).toHaveLength(1)
    await setFlag(nora, 'live_updates', { enabled: true, roles: [], markets: [] })
  })

  it('un valor propuesto queda como propuesta hasta que su dueño lo confirma', async () => {
    const nora = await ctxFor('nora.salas')
    await setPlatformValue(nora, 'audit_retention_days', '400', false)
    expect(await one(admin<{ value: number; proposed: boolean }[]>`select value, proposed from crm.platform_values where key = 'audit_retention_days'`)).toEqual({ value: 400, proposed: true })
    await expect(setPlatformValue(nora, 'audit_retention_days', '5', true)).rejects.toMatchObject({ code: 'invalid' })
    await setPlatformValue(nora, 'staging_has_real_data', true, true)
    expect(await one(admin<{ value: boolean; proposed: boolean }[]>`select value, proposed from crm.platform_values where key = 'staging_has_real_data'`)).toEqual({ value: true, proposed: false })
  })
})

describe('GOB-07: prueba de restauración automatizada', () => {
  it('pg_dump y pg_restore de la base de prueba, con los conteos comparados y la prueba registrada', async () => {
    const out = await restoreTest(URL_, { by: 'tests/db/plataforma' })
    expect(out.error).toBeNull()
    expect(out.ok).toBe(true)
    expect(out.after.accounts).toBe(out.before.accounts)
    const row = await one(admin<{ environment: string; result: string; counts: { before: Record<string, number> } }[]>`select environment, result, counts from crm.restore_tests where tested_by = 'tests/db/plataforma'`)
    expect(row).toMatchObject({ environment: 'local', result: 'ok' })
    expect(row.counts.before.accounts).toBeGreaterThan(0)
    await expect(restoreTest('postgres://postgres@db.example.com:5432/contigo_x')).rejects.toThrow(/local/)
  }, 120_000)
})

describe('IA-06: OAuth 2.1 con PKCE para el servidor MCP', () => {
  it('registrar, autorizar como la persona, canjear con el verificador; código de un solo uso; retirar corta el acceso', async () => {
    const nora = await ctxFor('nora.salas')
    const marco = await ctxFor('marco.pena')
    await expect(createMcpClient(marco, 'Agente', 'https://agente.example.com/cb')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createMcpClient(nora, 'Agente', 'http://agente.example.com/cb')).rejects.toMatchObject({ code: 'invalid' })
    const clientId = await createMcpClient(nora, 'Agente de prueba', 'https://agente.example.com/cb')
    const verifier = randomBytes(40).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const req = { client_id: clientId, redirect_uri: 'https://agente.example.com/cb', code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code', state: 'xyz' }
    expect(await authorizeRequest(marco, { ...req, redirect_uri: 'https://otro.example.com/cb' })).toBeNull()
    expect(await authorizeRequest(marco, { ...req, code_challenge_method: 'plain' })).toBeNull()
    expect(await authorizeRequest(marco, req)).toEqual({ name: 'Agente de prueba' })
    const back = new URL(await approveAuthorization(marco, req))
    expect(back.searchParams.get('state')).toBe('xyz')
    const code = back.searchParams.get('code')!
    const form = (v: string) => new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: req.redirect_uri, code_verifier: v })
    // Verificador equivocado: invalid_grant, y el código queda quemado.
    expect(await exchangeCode(form(randomBytes(40).toString('base64url')))).toEqual({ error: 'invalid_grant' })
    expect(await exchangeCode(form(verifier))).toEqual({ error: 'invalid_grant' })
    // Otro código, verificador correcto: token que representa a Marco.
    const code2 = new URL(await approveAuthorization(marco, req)).searchParams.get('code')!
    const ok = await exchangeCode(new URLSearchParams({ grant_type: 'authorization_code', code: code2, client_id: clientId, redirect_uri: req.redirect_uri, code_verifier: verifier }))
    expect(ok).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'crm:read' })
    const token = (ok as { access_token: string }).access_token
    expect(await tokenUser(token)).toEqual({ userId: marco.user.id, clientId })
    expect(await admin`select 1 from crm.mcp_oauth_tokens where token_hash = ${token}`).toHaveLength(0) // solo la huella
    expect(await admin`select 1 from crm.audit_events where action = 'mcp_oauth.authorized' and actor_id = ${marco.user.id}`).not.toHaveLength(0)
    await revokeMcpClient(nora, clientId)
    expect(await tokenUser(token)).toBeNull()
    void loadCtx
  })
})

describe('IA-07: salida a internet por un solo cliente y red-team antes de encender', () => {
  it('solo https a hosts de la lista; lo demás se bloquea sin llamar', async () => {
    expect(egressCheck('https://api.pipedrive.com/v1/users', 'pipedrive').ok).toBe(true)
    expect(egressCheck('https://evil.example.com/x', 'pipedrive').ok).toBe(false)
    expect(egressCheck('http://api.pipedrive.com/v1', 'pipedrive').ok).toBe(false)
    expect(egressCheck('https://api.anthropic.com/v1/messages', 'pipedrive', ['api.pipedrive.com']).ok).toBe(false)
    expect(egressCheck('https://api.pipedrive.com.evil.io/', 'pipedrive').ok).toBe(false)
    await expect(egressFetch('https://evil.example.com/', {}, { purpose: 'test' })).rejects.toBeInstanceOf(EgressBlocked)
  })

  it('ningún fetch del servidor fuera del cliente único', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(f)) {
          const src = readFileSync(p, 'utf8')
          if (src.startsWith("'use client'")) {
            // En el navegador solo se llama a la propia app.
            for (const m of src.matchAll(/fetch\(\s*([`'"])([^`'"]*)/g)) if (!m[2]!.startsWith('/')) offenders.push(`${p} (navegador)`)
            continue
          }
          if (p.endsWith(join('server', 'net', 'egress.ts'))) continue
          if (/(^|[^.\w])fetch\(/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) offenders.push(p)
        }
      }
    }
    walk(join(process.cwd(), 'src'))
    expect(offenders).toEqual([])
  })

  it('la revisión de red-team pide la lista completa y una nota; sin ella no se puede encender un agente que actúa', async () => {
    const nora = await ctxFor('nora.salas')
    await expect(recordRedteam(nora, 'rules_next_action', [], 'corto')).rejects.toMatchObject({ code: 'invalid' })
    expect(await recordRedteam(nora, 'rules_next_action', ['injection_notes'], 'Probé dos notas con instrucciones escondidas.')).toEqual({ passed: false })
    expect(await asSystem((tx) => agentsWithoutRedteam(tx, ['rules_next_action']))).toEqual(['rules_next_action'])
    expect(await recordRedteam(nora, 'rules_next_action', REDTEAM_CHECKLIST.map((c) => c.key), 'Probé notas de engaño y la persona de menor alcance.')).toEqual({ passed: true })
    expect(await asSystem((tx) => agentsWithoutRedteam(tx, ['rules_next_action']))).toEqual([])
    await expect(recordRedteam(await ctxFor('ana.robles'), 'rules_next_action', [], 'x'.repeat(20))).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('E9.F13: el identificador fiscal completo no se guarda', () => {
  it('ninguna columna de la base guarda el identificador completo: solo últimos 4 y huella', async () => {
    const cols = await admin<{ c: string }[]>`
      select table_name || '.' || column_name as c from information_schema.columns
       where table_schema = 'crm' and (column_name ~ '(^|_)(tax_id|rfc|ein|nit|tin)$' or column_name in ('tax_id_full', 'tax_number', 'rfc_full'))`
    expect(cols.map((r) => r.c)).toEqual([])
    const last4 = await admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where tax_id_last4 is not null and length(tax_id_last4) <> 4`
    expect(last4[0]!.n).toBe(0)
  })
})

describe('bitácora y eventos: cada acción nueva tiene nombre y está clasificada', () => {
  it('nombre en los dos idiomas y decisión de evento', () => {
    for (const a of ['flag.changed', 'platform_value.changed', 'notice_rule.changed', 'redteam.reviewed', 'mcp_oauth.client_created', 'mcp_oauth.authorized', 'mcp_oauth.revoked', 'secret.backup_set']) {
      expect(AUDIT_ACTION[a], a).toBeDefined()
      const d = decide(a)
      expect('unclassified' in d && d.unclassified, a).toBeFalsy()
    }
  })
})
