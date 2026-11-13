import { afterAll, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { asPersona, ctxFor, owner, personaId, systemContext } from './helpers'
import { withSystem, withUser } from '@/server/db'
import { simulateFunding } from '@/domain/campo-canal/canal'
import { computePriorityTx, evaluateFieldExceptionsTx } from '@/domain/campo-canal/campo'
import { runAlerts } from '@/domain/care'
import { createAgency } from '@/domain/store-record'
import * as security from '@/domain/security'
import { peopleWithRole } from '@/domain/notify'
import { peopleWithRole as automationPeople } from '@/domain/automation/people'
import { careAdapterStatus, aiReviewDraftMode } from '@/server/adapters/care'
import { aiAdapter } from '@/server/adapters/ai'
import { withLoad } from '@/domain/loads'
import { documentVault } from '@/server/adapters/document-vault'

// Integración 95-4 (ciclo-cs, campo-canal, partners-contratos, ia): lo que cruza paquetes. Un solo saldo y una sola regla de
// saldo bajo, un solo adaptador de AI, una sola alta de agencias, un solo escritor del límite por entidad, una sola
// app.people_with_role, y el usuario de partner sin acceso al cuidado de comercios fuera de su subárbol.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('una tienda de MX con saldo bajo (campo-canal, ciclo-cs, ia)', () => {
  it('el saldo del fondeo abre UNA alerta de Cuidado de comercios, la prioridad de visita lo dice, y campo-canal no abre otra', async () => {
    const nora = await ctxFor('nora.salas')
    const store = await one(admin<{ id: string; lifecycle: string }[]>`
      select a.id, a.lifecycle from crm.accounts a where a.owner_id = md5('contigo:marco.pena')::uuid and a.archived_at is null order by a.id desc limit 1`)
    await simulateFunding(nora, { accountId: store.id, method: 'prepaid', balance: '50' })
    await admin`update crm.accounts set lifecycle = 'active' where id = ${store.id}`
    await admin`update crm.cs_settings set alerts_on = true, low_balance_minor = 100000 where market_code = 'MX'`
    try {
      const sys = await systemContext()
      await withUser(sys.user.id, (tx) => runAlerts(tx, sys, { accountId: store.id }))
      await withSystem((tx) => evaluateFieldExceptionsTx(tx))
      await withSystem((tx) => computePriorityTx(tx))
      expect((await admin`select 1 from crm.cs_alerts where account_id = ${store.id} and kind = 'low_balance' and status = 'open'`).length).toBe(1)
      expect((await admin`select 1 from crm.exceptions where account_id = ${store.id} and kind = 'low_balance'`).length).toBe(0)
      const pr = await one(admin<{ reasons: { code: string }[] }[]>`select reasons from crm.store_priority where account_id = ${store.id} order by day desc limit 1`)
      expect(pr.reasons.map((r) => r.code)).toContain('low_balance')
      // el puntaje de salud lee el mismo saldo (el grupo "saldo" deja de estar vacío)
      await withUser(sys.user.id, (tx) => tx`select app.health_snapshot_run('MX')`)
      const snap = await admin<{ groups: { grp: string; raw: number | null }[] }[]>`select groups from crm.health_snapshots where account_id = ${store.id} order by as_of desc limit 1`
      if (snap[0]) expect(snap[0].groups.find((g) => g.grp === 'balance')?.raw).toBe(5000)
      // el usuario de partner (subárbol del ISO de US) no ve la alerta de una tienda de MX
      expect((await asPersona('iso.partner', (tx) => tx`select 1 from crm.cs_alerts where account_id = ${store.id}`)).length).toBe(0)
    } finally {
      await admin`update crm.cs_alerts set status = 'closed', close_reason = 'dismissed', closed_at = now() where account_id = ${store.id} and status = 'open'`
      await admin`update crm.cs_settings set alerts_on = false, low_balance_minor = null where market_code = 'MX'`
      await admin`update crm.accounts set lifecycle = ${store.lifecycle} where id = ${store.id}`
    }
  })
})

describe('un solo modelo por concepto', () => {
  it('AI: el borrador de revisión de cuenta usa el adaptador único; no hay otro interruptor', () => {
    expect(careAdapterStatus().map((s) => s.key)).not.toContain('ai_draft')
    expect(aiReviewDraftMode()).toBe(aiAdapter().mode)
    const prev = process.env.AI_ADAPTER
    process.env.AI_ADAPTER = 'simulated'
    try {
      expect(aiReviewDraftMode()).toBe('simulated')
    } finally {
      if (prev === undefined) delete process.env.AI_ADAPTER
      else process.env.AI_ADAPTER = prev
    }
  })

  it('agencias: una sola alta (Datos > Catálogos) con embudo; Seguridad solo da acceso', async () => {
    expect('createAgency' in security).toBe(false)
    const nora = await ctxFor('nora.salas')
    const pipeline = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' order by name limit 1`)
    const id = await createAgency(nora, { market: 'MX', kind: 'agency', name: `Agencia Integra ${tag()}`, pipelineId: pipeline.id })
    expect(await one(admin<{ pipeline_id: string; kind: string }[]>`select pipeline_id, kind from crm.agencies where id = ${id}`)).toEqual({ pipeline_id: pipeline.id, kind: 'agency' })
    const user = await security.grantAgencyAccess(nora, { email: `integra.${tag()}@axexo.com`, fullName: 'Persona de Agencia Integra', agencyId: id }, ['axexo.com'])
    expect(await one(admin<{ agency_id: string }[]>`select agency_id from crm.memberships where user_id = ${user}`)).toEqual({ agency_id: id })
    const us = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'US' limit 1`)
    await expect(createAgency(nora, { market: 'MX', kind: 'agency', name: `Otra ${tag()}`, pipelineId: us.id })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('el límite por entidad legal de un rol solo lo escribe Seguridad', () => {
    const writers = files('src').filter((f) => /update crm\.memberships set[^`]*legal_entity_id/.test(readFileSync(f, 'utf8')))
    expect(writers).toEqual(['src/domain/security.ts'])
  })

  it('una sola app.people_with_role, con supervisión primero para avisos y automatizaciones', async () => {
    const fns = await admin<{ args: string }[]>`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'people_with_role'`
    expect(fns.map((f) => f.args)).toEqual(['p_market text, p_roles text[], p_for uuid'])
    const marco = await personaId('marco.pena')
    const sys = await systemContext()
    const [a, b] = await withUser(sys.user.id, async (tx) => [await peopleWithRole(tx, 'MX', ['supervisor'], marco), await automationPeople(tx, 'MX', 'supervisor', marco)])
    expect(a.sort()).toEqual(b.sort())
    expect(a.length).toBeGreaterThan(0)
    const leads = await withUser(sys.user.id, (tx) => peopleWithRole(tx, 'MX', ['market_lead', 'ops']))
    expect(leads.length).toBeGreaterThan(0)
  })

  it('market_comms ya no tiene las columnas de WhatsApp que nadie leía', async () => {
    const cols = await admin<{ c: string }[]>`select column_name as c from information_schema.columns where table_schema = 'crm' and table_name = 'market_comms'`
    expect(cols.map((r) => r.c)).not.toContain('whatsapp_daily_limit')
    expect(cols.map((r) => r.c)).not.toContain('whatsapp_unit_cost')
  })

  it('una sola bitácora de corridas: una carga es una corrida del corredor y crm.load_runs solo la muestra', async () => {
    await admin`delete from crm.job_runs where status = 'running'`
    const sys = await systemContext()
    const out = await withLoad('imports', 'manual', sys.user.id, async () => ({ done: 3, note: 'integración 95-4' }))
    expect(out).toMatchObject({ done: 3 })
    const run = await one(admin<{ job_key: string; status: string; done: number; finished: boolean }[]>`
      select job_key, status, done, finished_at is not null as finished from crm.job_runs where load_key = 'imports' order by started_at desc limit 1`)
    expect(run).toEqual({ job_key: 'load.imports', status: 'ok', done: 3, finished: true })
    const kinds = await admin<{ relkind: string }[]>`select relkind from pg_class where oid = 'crm.load_runs'::regclass`
    expect(kinds[0]!.relkind).toBe('v')
  })

  it('una sola bóveda de documentos para el alta y los documentos generados', () => {
    const v = documentVault()
    expect(v.envVar).toBe('CONTIGO_DOCUMENT_VAULT')
    expect(typeof v.signedUrl).toBe('function')
    expect(typeof v.store).toBe('function')
  })
})
