import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId } from './helpers'
import { withoutUser } from '@/server/db'
import { withRequestId, cleanRequestId, shortRef } from '@/server/request-id'
import { screenKey } from '@/lib/screen-key'
import {
  addCost, annotateChange, announceRelease, checkReleaseItem, createConfigRequest, createRelease, decideConfigRequest, markReleased, missingItems, openIncident,
  recordChampionReview, recordDeployment, recordRestoreTest, saveMaterial, scheduleMaintenance, setChampion, setComponentOwners, setObjective, updateIncident, voidCost,
} from '@/domain/gobierno-ops'
import {
  allConfigRequests, approvedFieldRequests, components, configChanges, costBoard, deployments, incidents, maintenance, materials, myChampions, myConfigRequests,
  p95, releases, restoreTests, serviceBoard, teamChampions, testData,
} from '@/dal/gobierno'
import { createField } from '@/domain/b2b'
import { RELEASE_CHECKLIST } from '@/content/release-checklist'
import { deployWatch, gobiernoJobs, healthProbe, sloWatch } from '@/server/jobs/gobierno'
import { JOBS } from '@/server/jobs/registry'
import { tracesAdapter, simulatedSpans } from '@/server/adapters/traces'
import { billingAdapter, simulatedBilling } from '@/server/adapters/billing'
import { gobiernoAdapterStatus } from '@/server/adapters/gobierno'
import { AUDIT_ACTION, AUDIT_GROUPS, AUDIT_OBJECT } from '@/lib/audit'
import { generate, plan, rfcCheckDigit, syntheticRfc, syntheticEin, syntheticNit, rng } from '../../scripts/synthetic-lib.mjs'

// Paquete gobierno (0033_gobierno): GOB-07, GOB-04, GOB-09, GOB-08 y E7.F2 a F9.
// 42501 = la base rechazó la operación.
const DENIED = '42501'
const admin = owner()
const TODAY = new Date().toISOString().split('T')[0]!
const MONTH = TODAY.slice(0, 7)
const TABLES = ['request_metrics', 'error_events', 'service_objectives', 'incidents', 'restore_tests', 'components', 'maintenance_windows', 'releases', 'deployments', 'cost_entries', 'synthetic_runs', 'synthetic_accounts', 'config_requests', 'change_reasons', 'team_champions', 'champion_reviews', 'training_materials']

afterAll(async () => {
  await admin.end()
})

describe('base: toda tabla nueva con RLS forzado y sin acceso para quien no gobierna', () => {
  it('RLS forzado en las 17 tablas', async () => {
    const rows = await admin<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'crm'::regnamespace and relname = any(${TABLES})`
    expect(rows.length).toBe(TABLES.length)
    for (const r of rows) expect(r.relrowsecurity && r.relforcerowsecurity, r.relname).toBe(true)
  })

  it('quien vende no lee servicio, costos, incidentes ni despliegues, ni por la lectura ni directo en la base', async () => {
    const lucia = await ctxFor('lucia.vega')
    for (const read of [() => serviceBoard(lucia), () => costBoard(lucia), () => incidents(lucia), () => deployments(lucia), () => components(lucia), () => testData(lucia), () => restoreTests(lucia), () => allConfigRequests(lucia)]) {
      await expect(read()).rejects.toMatchObject({ code: 'forbidden' })
    }
    await asPersona('lucia.vega', async (tx) => {
      for (const t of ['request_metrics', 'error_events', 'service_objectives', 'incidents', 'restore_tests', 'components', 'deployments', 'cost_entries', 'synthetic_runs', 'champion_reviews']) {
        expect((await tx.unsafe(`select 1 from crm.${t}`)).length, t).toBe(0)
      }
      expect(await attempt(tx, (sp) => sp`insert into crm.incidents (title, severity, started_at, impact, created_by) values ('Prueba gobierno', 'low', now(), 'nada grave', ${lucia.user.id})`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`insert into crm.cost_entries (month, kind, component, label, amount_usd, created_by) values ('2026-10-01', 'cost', 'platform', 'x1', 1, ${lucia.user.id})`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`update crm.components set owner_name = 'Alguien' where key = 'app'`)).toBe('0 rows')
    })
  })
})

describe('GOB-07: identificador de la petición, medición, objetivos, incidentes y restauración', () => {
  it('el identificador de la petición queda en la bitácora y se busca por su referencia corta', async () => {
    const nora = await ctxFor('nora.salas')
    const rid = cleanRequestId('req-gobierno-0001')
    expect(rid).toBe('req-gobierno-0001')
    expect(cleanRequestId('x')).toMatch(/^[0-9a-f-]{36}$/)
    expect(cleanRequestId("a'; drop table x; --")).toMatch(/^[0-9a-f-]{36}$/)
    await withRequestId(rid, () => setComponentOwners(nora, { key: 'jobs', owner: '', backup: '' }))
    const ev = await admin<{ request_id: string | null }[]>`select request_id from crm.audit_events where action = 'component.owners_set' order by at desc limit 1`
    expect(ev[0]!.request_id).toBe(rid)
    // fuera de una petición (una tarea, una prueba) queda vacío, no un valor inventado
    await setComponentOwners(nora, { key: 'jobs', owner: '', backup: '' })
    const ev2 = await admin<{ request_id: string | null }[]>`select request_id from crm.audit_events where action = 'component.owners_set' order by at desc limit 1`
    expect(ev2[0]!.request_id).toBeNull()
    // el error deja su registro con el mismo identificador y sin mensaje
    await withoutUser((tx) => tx`select app.record_error(${rid}, 'action', '/comercios', 'PostgresError', '23505')`)
    const board = await serviceBoard(nora, 30, shortRef(rid))
    expect(board.errors.map((e) => e.request_id)).toEqual([rid])
    expect(board.errors[0]).toMatchObject({ kind: 'action', screen: '/comercios', name: 'PostgresError', code: '23505' })
    expect((await serviceBoard(nora, 30, 'zzzzzzzz')).errors).toEqual([])
  })

  it('la pantalla que se mide no lleva identificadores ni búsquedas', () => {
    expect(screenKey('/comercios/01a1cd48-0000-7000-8000-000000000001?ficha=abc')).toBe('/comercios/[id]')
    expect(screenKey('https://contigo.test/deals/01a1cd48-0000-7000-8000-000000000001/pedido#x')).toBe('/deals/[id]/pedido')
    expect(screenKey('/f/tiendas-mx')).toBe('/f/[formulario]')
    expect(screenKey('/hoy')).toBe('/hoy')
    expect(screenKey('//evil.test/x')).toBe('otra')
    expect(screenKey(null)).toBe('otra')
    expect(screenKey('/Buscar?q=Juan Pérez 5512345678')).toBe('/buscar')
  })

  it('la medición suma por día, tipo y pantalla; el tablero calcula disponibilidad y el 95% de las veces', async () => {
    const nora = await ctxFor('nora.salas')
    expect(p95([0, 0, 0, 0, 0, 0])).toBeNull()
    expect(p95([19, 1, 0, 0, 0, 0])).toBe(200)
    expect(p95([10, 9, 1, 0, 0, 0])).toBe(500)
    expect(p95([0, 0, 0, 0, 0, 3])).toBe(Infinity)
    const before = await serviceBoard(nora)
    await withoutUser(async (tx) => {
      for (let i = 0; i < 18; i++) await tx`select app.record_request('page', '/prueba-gobierno', 150, false)`
      await tx`select app.record_request('page', '/prueba-gobierno', 900, false)`
      await tx`select app.record_request('page', '/prueba-gobierno', 9000, false)`
      for (let i = 0; i < 9; i++) await tx`select app.record_request('action', '/prueba-gobierno', 300, false)`
      await tx`select app.record_request('action', '/prueba-gobierno', 300, true)`
      // lo que no tiene forma de medición se descarta sin romper
      await tx`select app.record_request('otra', '/x', 1, false)`
      await tx`select app.record_request('page', ${'x'.repeat(200)}, 1, false)`
    })
    const after = await serviceBoard(nora)
    expect(after.total - before.total).toBe(30)
    expect(after.failures - before.failures).toBe(1)
    expect(after.availability).not.toBeNull()
    const screen = after.screens.find((s) => s.screen === '/prueba-gobierno')!
    expect(screen).toMatchObject({ n: 20, p95: 1000 })
    expect(screen.avg_ms).toBe(Math.round((18 * 150 + 900 + 9000) / 20))
    // la app no puede escribir la medición directo: solo por la función
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into crm.request_metrics (day, kind, screen) values (now()::date, 'page', '/x')`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`delete from crm.error_events`)).toBe(DENIED)
    })
  })

  it('un objetivo nace sin valor; el de servicio lo fija administración y el de recuperación exige quién lo acordó', async () => {
    const nora = await ctxFor('nora.salas')
    const luis = await ctxFor('luis.tovar')
    const start = await serviceBoard(luis)
    expect(start.objectives.map((o) => o.key)).toEqual(['availability', 'latency_page', 'latency_action', 'latency_api', 'rpo_minutes', 'rto_minutes', 'restore_test_days'])
    // nadie inventó un valor: los siete nacen vacíos
    expect(start.objectives.every((o) => o.target === null && o.agreed_by === null)).toBe(true)
    await expect(setObjective(luis, { key: 'availability', target: '99.5' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setObjective(nora, { key: 'availability', target: '120' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setObjective(nora, { key: 'availability', target: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setObjective(nora, { key: 'otra_cosa', target: '1' })).rejects.toMatchObject({ code: 'not_found' })
    await setObjective(nora, { key: 'availability', target: '99.5' })
    await setObjective(nora, { key: 'latency_page', target: '1000' })
    await expect(setObjective(nora, { key: 'rpo_minutes', target: '15' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setObjective(nora, { key: 'rto_minutes', target: '60', agreedBy: 'Persona de Prueba', agreedOn: 'ayer' })).rejects.toMatchObject({ code: 'invalid' })
    await setObjective(nora, { key: 'rto_minutes', target: '60', agreedBy: 'Persona de Prueba', agreedOn: TODAY })
    const now = await serviceBoard(nora)
    expect(now.objectives.find((o) => o.key === 'availability')).toMatchObject({ target: 99.5 })
    expect(now.objectives.find((o) => o.key === 'rto_minutes')).toMatchObject({ target: 60, agreed_by: 'Persona de Prueba', agreed_on: TODAY })
    expect(now.objectives.find((o) => o.key === 'rpo_minutes')!.target).toBeNull()
    // la base repite la regla del acuerdo
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.service_objectives set target = 5, updated_by = ${nora.user.id} where key = 'rpo_minutes'`)).toBe('23514')
    })
    await admin`update crm.service_objectives set target = null, agreed_by = null, agreed_on = null`
  })

  it('un incidente no se cierra sin causa, acciones y fecha; leadership lo lee y no lo cambia', async () => {
    const nora = await ctxFor('nora.salas')
    const luis = await ctxFor('luis.tovar')
    const started = new Date(Date.now() - 3 * 3600_000)
    await expect(openIncident(luis, { title: 'Prueba gobierno: caída', severity: 'high', startedAt: started, market: '', impact: 'Nadie pudo guardar' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(openIncident(nora, { title: 'Prueba gobierno: futuro', severity: 'high', startedAt: new Date(Date.now() + 3600_000), market: '', impact: 'Nadie pudo guardar' })).rejects.toMatchObject({ code: 'invalid' })
    const id = await openIncident(nora, { title: 'Prueba gobierno: caída', severity: 'high', startedAt: started, market: 'MX', impact: 'Nadie pudo guardar visitas en México', requestId: 'req-gobierno-0001' })
    expect((await incidents(luis)).find((i) => i.id === id)).toMatchObject({ status: 'open', severity: 'high', market_code: 'MX' })
    await expect(updateIncident(nora, { id, status: 'closed' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateIncident(nora, { id, status: 'closed', cause: 'Una migración', actions: 'Se revirtió', resolvedAt: new Date(started.getTime() - 1000) })).rejects.toMatchObject({ code: 'invalid' })
    await updateIncident(nora, { id, status: 'mitigated' })
    await updateIncident(nora, { id, status: 'closed', cause: 'Una migración bloqueó la tabla', actions: 'Se revirtió y se agregó la prueba', resolvedAt: new Date() })
    expect((await incidents(nora)).find((i) => i.id === id)).toMatchObject({ status: 'closed', cause: 'Una migración bloqueó la tabla' })
    await expect(updateIncident(nora, { id, status: 'mitigated' })).rejects.toMatchObject({ code: 'invalid' })
    const actions = (await admin<{ action: string }[]>`select action from crm.audit_events where object = 'incident' and object_id = ${id} order by at`).map((r) => r.action)
    expect(actions).toEqual(['incident.opened', 'incident.updated', 'incident.updated'])
  })

  it('el registro de pruebas de restauración nace vacío y solo administración anota', async () => {
    const nora = await ctxFor('nora.salas')
    expect(await restoreTests(nora)).toEqual([])
    await expect(recordRestoreTest(await ctxFor('luis.tovar'), { testedOn: TODAY, testedBy: 'Persona de Prueba', environment: 'staging', minutes: 30, dataLossMinutes: 0, result: 'ok', evidence: 'Ticket de prueba 1' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(recordRestoreTest(nora, { testedOn: '2099-01-01', testedBy: 'Persona de Prueba', environment: 'staging', minutes: 30, dataLossMinutes: 0, result: 'ok', evidence: 'Ticket de prueba 1' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(recordRestoreTest(nora, { testedOn: TODAY, testedBy: 'Persona de Prueba', environment: 'staging', minutes: 30, dataLossMinutes: 0, result: 'ok', evidence: '' })).rejects.toMatchObject({ code: 'invalid' })
    await recordRestoreTest(nora, { testedOn: TODAY, testedBy: 'Persona de Prueba', environment: 'staging', minutes: 42, dataLossMinutes: 5, result: 'ok', evidence: 'Ticket de prueba 1' })
    expect((await restoreTests(nora))[0]).toMatchObject({ tested_by: 'Persona de Prueba', minutes: 42, result: 'ok', recorded_by_name: 'Nora Salas' })
    // no se edita ni se borra
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.restore_tests set result = 'failed'`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`delete from crm.restore_tests`)).toBe(DENIED)
    })
  })

  it('el adaptador de trazas y el de facturación están apagados; simulados solo en pruebas y con su variable', async () => {
    expect(tracesAdapter().mode).toBe('off')
    expect(tracesAdapter().export({ requestId: 'r', kind: 'page', screen: '/hoy', ms: 1, error: false })).toBe('dropped_off')
    expect(await billingAdapter().fetchMonth('2026-10')).toEqual({ status: 'off', lines: [] })
    process.env.TRACES_ADAPTER = 'simulated'
    process.env.BILLING_ADAPTER = 'simulated'
    try {
      expect(tracesAdapter().export({ requestId: 'r', kind: 'page', screen: '/hoy', ms: 1, error: false })).toBe('simulated')
      expect(simulatedSpans().at(-1)).toMatchObject({ screen: '/hoy' })
      simulatedBilling().push({ month: '2026-10', component: 'platform', label: 'Prueba', amountUsd: 10 })
      expect((await billingAdapter().fetchMonth('2026-10')).lines).toHaveLength(1)
      // fuera de pruebas la variable no enciende nada
      const env = process.env.APP_ENV
      process.env.APP_ENV = 'staging'
      expect(tracesAdapter().mode).toBe('off')
      expect(billingAdapter().mode).toBe('off')
      process.env.APP_ENV = env
    } finally {
      delete process.env.TRACES_ADAPTER
      delete process.env.BILLING_ADAPTER
    }
    const status = gobiernoAdapterStatus()
    expect(status.map((a) => a.key)).toEqual(['traces', 'billing', 'backup'])
    expect(status.every((a) => a.mode === 'off' && a.needs[0].startsWith('Falta') || a.needs[0].startsWith('Es de la plataforma'))).toBe(true)
  })
})

describe('GOB-04: dueños por componente, mantenimiento, versiones con lista de salida y despliegues', () => {
  it('los componentes nacen sin nombres; dueño y suplente son dos personas distintas', async () => {
    const nora = await ctxFor('nora.salas')
    const list = await components(nora)
    expect(list.map((c) => c.key)).toEqual(['app', 'database', 'identity', 'deploy', 'inbound_api', 'pipedrive_import', 'jobs'])
    expect(list.every((c) => c.owner_name === null && c.backup_name === null)).toBe(true)
    await expect(setComponentOwners(await ctxFor('luis.tovar'), { key: 'deploy', owner: 'Persona Uno', backup: 'Persona Dos' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setComponentOwners(nora, { key: 'deploy', owner: 'Persona Uno', backup: 'persona uno' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setComponentOwners(nora, { key: 'no_existe', owner: 'Persona Uno', backup: '' })).rejects.toMatchObject({ code: 'not_found' })
    await setComponentOwners(nora, { key: 'deploy', owner: 'Persona Uno', backup: 'Persona Dos' })
    expect((await components(nora)).find((c) => c.key === 'deploy')).toMatchObject({ owner_name: 'Persona Uno', backup_name: 'Persona Dos' })
    await setComponentOwners(nora, { key: 'deploy', owner: '', backup: '' })
  })

  it('el calendario de mantenimiento lo ve cada quien según su mercado', async () => {
    const nora = await ctxFor('nora.salas')
    const starts = new Date(Date.now() + 2 * 86_400_000)
    const ends = new Date(starts.getTime() + 3600_000)
    await expect(scheduleMaintenance(nora, { title: 'Prueba gobierno: ventana', startsAt: ends, endsAt: starts, market: '', impact: 'CONTIGO lento' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(scheduleMaintenance(nora, { title: 'Prueba gobierno: ventana', startsAt: new Date(Date.now() - 86_400_000), endsAt: ends, market: '', impact: 'CONTIGO lento' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(scheduleMaintenance(await ctxFor('ana.robles'), { title: 'Prueba gobierno: ventana', startsAt: starts, endsAt: ends, market: 'MX', impact: 'CONTIGO lento' })).rejects.toMatchObject({ code: 'forbidden' })
    const all = await scheduleMaintenance(nora, { title: 'Prueba gobierno: ventana global', startsAt: starts, endsAt: ends, market: '', impact: 'CONTIGO lento una hora' })
    const us = await scheduleMaintenance(nora, { title: 'Prueba gobierno: ventana US', startsAt: starts, endsAt: ends, market: 'US', impact: 'CONTIGO fuera en US' })
    const lucia = (await maintenance(await ctxFor('lucia.vega'), true)).map((w) => w.id)
    expect(lucia).toContain(all)
    expect(lucia).not.toContain(us)
    expect((await maintenance(await ctxFor('sam.ortiz'), true)).map((w) => w.id)).toEqual(expect.arrayContaining([all, us]))
  })

  it('una versión se anuncia antes de liberarse y no sale sin la lista completa (revisión de tecnología y estándar incluidos)', async () => {
    const nora = await ctxFor('nora.salas')
    const lucia = await ctxFor('lucia.vega')
    expect(RELEASE_CHECKLIST.map((i) => i.key)).toEqual(expect.arrayContaining(['tech_review', 'standard', 'ci', 'migrations', 'two_people', 'backup', 'guide', 'data']))
    await expect(createRelease(lucia, { version: '9.9.0', titleEs: 'Prueba', titleEn: 'Test', notesEs: 'Notas de prueba', notesEn: 'Test notes', plannedFor: '', touchesMoney: false })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createRelease(nora, { version: '9.9.1', titleEs: 'Prueba', titleEn: 'Test', notesEs: 'Notas de prueba', notesEn: 'Test notes', plannedFor: '', touchesMoney: true })).rejects.toMatchObject({ code: 'invalid' })
    const id = await createRelease(nora, { version: '9.9.0', titleEs: 'Prueba gobierno', titleEn: 'Governance test', notesEs: 'Cambia la pantalla de costos', notesEn: 'The cost screen changes', plannedFor: '', touchesMoney: false })
    await expect(createRelease(nora, { version: '9.9.0', titleEs: 'Prueba', titleEn: 'Test', notesEs: 'Notas de prueba', notesEn: 'Test notes', plannedFor: '', touchesMoney: false })).rejects.toMatchObject({ code: 'invalid' })
    // un borrador no lo ve quien vende; administración y leadership sí
    expect((await releases(lucia)).map((r) => r.id)).not.toContain(id)
    expect((await releases(await ctxFor('luis.tovar'))).map((r) => r.id)).toContain(id)
    // sin anuncio no sale
    await expect(markReleased(nora, id, TODAY)).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('anuncia') })
    await announceRelease(nora, id)
    await expect(announceRelease(nora, id)).rejects.toMatchObject({ code: 'invalid' })
    expect((await releases(lucia)).find((r) => r.id === id)).toMatchObject({ status: 'announced', notes_es: 'Cambia la pantalla de costos' })
    // anunciada, pero sin la lista completa tampoco sale
    await expect(markReleased(nora, id, TODAY)).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('lista de salida') })
    await expect(checkReleaseItem(nora, { id, item: 'tech_review', evidence: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(checkReleaseItem(nora, { id, item: 'no_existe', evidence: 'algo escrito' })).rejects.toMatchObject({ code: 'not_found' })
    for (const item of RELEASE_CHECKLIST.filter((i) => i.key !== 'tech_review')) await checkReleaseItem(nora, { id, item: item.key, evidence: `Evidencia de prueba de ${item.key}` })
    // falta justo la revisión de tecnología: no sale
    expect(missingItems((await releases(nora)).find((r) => r.id === id)!.checklist)).toEqual(['tech_review'])
    await expect(markReleased(nora, id, TODAY)).rejects.toMatchObject({ code: 'invalid' })
    await checkReleaseItem(nora, { id, item: 'tech_review', evidence: 'Visto bueno escrito de prueba, con fecha' })
    await markReleased(nora, id, TODAY)
    const done = (await releases(nora)).find((r) => r.id === id)!
    expect(done.status).toBe('released')
    expect(done.checklist.tech_review).toMatchObject({ by: 'Nora Salas', evidence: 'Visto bueno escrito de prueba, con fecha' })
    await expect(checkReleaseItem(nora, { id, item: 'ci', evidence: 'cambio después de salir' })).rejects.toMatchObject({ code: 'invalid' })
    // la base repite "comunicar antes de liberar"
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into crm.releases (version, title_es, title_en, notes_es, notes_en, status, released_at, created_by) values ('9.9.9', 'abc', 'abc', 'abcde', 'abcde', 'released', now(), ${nora.user.id})`)).toBe(DENIED)
      const draft = (await tx<{ id: string }[]>`insert into crm.releases (version, title_es, title_en, notes_es, notes_en, created_by) values ('9.9.8', 'abc', 'abc', 'abcde', 'abcde', ${nora.user.id}) returning id`)[0]!.id
      expect(await attempt(tx, (sp) => sp`update crm.releases set status = 'released', released_at = now() where id = ${draft}`)).toBe('23514')
    })
  })

  it('una versión que toca comisiones o alta no sale antes de la fecha anunciada', async () => {
    const nora = await ctxFor('nora.salas')
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().split('T')[0]!
    const id = await createRelease(nora, { version: '9.10.0', titleEs: 'Prueba comisiones', titleEn: 'Commission test', notesEs: 'Cambia la tabla de comisiones', notesEn: 'The commission table changes', plannedFor: future, touchesMoney: true })
    await announceRelease(nora, id)
    for (const item of RELEASE_CHECKLIST) await checkReleaseItem(nora, { id, item: item.key, evidence: `Evidencia de prueba de ${item.key}` })
    await expect(markReleased(nora, id, TODAY)).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('fecha') })
    await markReleased(nora, id, future)
  })

  it('cada despliegue queda en el registro: el commit que corre se anota solo y una sola vez', async () => {
    const nora = await ctxFor('nora.salas')
    const sha = 'abc1234def5678900000000000000000000000aa'
    const first = await withoutUser((tx) => deployWatch(tx, 'staging', sha, 'design-v1'))
    const second = await withoutUser((tx) => deployWatch(tx, 'staging', sha, 'design-v1'))
    expect([first.done, second.done]).toEqual([1, 0])
    expect((await withoutUser((tx) => deployWatch(tx, 'test', null, null))).done).toBe(0)
    expect((await withoutUser((tx) => deployWatch(tx, 'staging', 'no es un commit', null))).done).toBe(0)
    await expect(recordDeployment(nora, { environment: 'production', commit: 'zzz', deployedAt: new Date(), deployedBy: 'Persona Uno', result: 'ok', releaseId: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(recordDeployment(await ctxFor('luis.tovar'), { environment: 'production', commit: sha, deployedAt: new Date(), deployedBy: 'Persona Uno', result: 'ok', releaseId: '' })).rejects.toMatchObject({ code: 'forbidden' })
    await recordDeployment(nora, { environment: 'production', commit: sha, deployedAt: new Date(Date.now() - 60_000), deployedBy: 'Persona Dos', result: 'rolled_back', releaseId: '', notes: 'Se volvió atrás por una migración' })
    const log = await deployments(await ctxFor('luis.tovar'))
    expect(log.filter((d) => d.commit_sha === sha).map((d) => `${d.environment}:${d.source}:${d.result}`).sort()).toEqual(['production:manual:rolled_back', 'staging:detected:ok'])
    // la app no puede inventar un despliegue "detectado" a mano
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into crm.deployments (environment, commit_sha, source, recorded_by) values ('production', 'abc1234', 'detected', ${nora.user.id})`)).toBe(DENIED)
    })
  })

  it('las tareas programadas del paquete están en el registro y corren dos veces sin romper', async () => {
    expect(JOBS.map((j) => j.key)).toEqual(expect.arrayContaining(['gobierno.deploy_watch', 'gobierno.health_probe', 'gobierno.slo_watch']))
    for (const j of gobiernoJobs) expect(j.description.es.length > 10 && j.description.en.length > 10 && j.everyMinutes >= 5).toBe(true)
    const nora = await ctxFor('nora.salas')
    const before = (await serviceBoard(nora)).probe.n
    await withoutUser((tx) => healthProbe(tx))
    await withoutUser((tx) => gobiernoJobs.find((j) => j.key === 'gobierno.health_probe')!.run(tx))
    expect((await serviceBoard(nora)).probe.n - before).toBe(2)
    // sin commit en el ambiente de pruebas, la tarea de despliegues no anota nada
    expect((await withoutUser((tx) => gobiernoJobs.find((j) => j.key === 'gobierno.deploy_watch')!.run(tx))).done).toBe(0)
  })

  it('alerta: si un objetivo de servicio no se cumple, administración recibe un aviso, uno por objetivo y por día', async () => {
    const noraId = await personaId('nora.salas')
    await admin`update crm.service_objectives set target = null, alerted_on = null where kind = 'slo'`
    await admin`insert into crm.request_metrics (day, kind, screen, n, errors, total_ms, buckets)
                values ((now() at time zone 'utc')::date, 'api', 'prueba-alerta', 100, 30, 100000, '{0,0,0,0,0,100}')`
    // sin objetivo fijado no hay alerta: CONTIGO no inventa el umbral
    expect((await withoutUser((tx) => sloWatch(tx))).done).toBe(0)
    await admin`update crm.service_objectives set target = 99.9 where key = 'availability'`
    await admin`update crm.service_objectives set target = 1000 where key = 'latency_api'`
    // quien no es el sistema no puede disparar ni consumir la alerta
    expect(await asPersona('lucia.vega', async (tx) => (await tx`select * from app.slo_check()`).length)).toBe(0)
    expect(await asPersona('nora.salas', async (tx) => (await tx`select * from app.slo_check()`).length)).toBe(0)
    const out = await withoutUser((tx) => sloWatch(tx))
    expect(out).toMatchObject({ done: 2, note: 'availability, latency_api' })
    const notices = await admin<{ title: string; kind: string }[]>`select title, kind from crm.notices where user_id = ${noraId} and kind = 'service_alert' order by title`
    expect(notices).toHaveLength(2)
    expect(notices.map((n) => n.title).join(' | ')).toContain('Disponibilidad')
    // el mismo día no vuelve a avisar
    expect((await withoutUser((tx) => sloWatch(tx))).done).toBe(0)
    expect((await admin`select 1 from crm.notices where kind = 'service_alert'`).length).toBe(2)
    await admin`delete from crm.request_metrics where screen = 'prueba-alerta'`
    await admin`update crm.service_objectives set target = null, alerted_on = null where kind = 'slo'`
  })
})

describe('GOB-09: costo unitario a partir de costos cargados a mano', () => {
  it('sin cargas no hay cifras; con cargas, costo por persona activa y por comercio a cargo', async () => {
    const nora = await ctxFor('nora.salas')
    const luis = await ctxFor('luis.tovar')
    expect(await costBoard(luis)).toEqual({ months: [], entries: [] })
    await expect(addCost(luis, { month: MONTH, kind: 'cost', component: 'platform', label: 'Plataforma de prueba', amount: '100' }, MONTH)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(addCost(nora, { month: '2099-01', kind: 'cost', component: 'platform', label: 'Plataforma de prueba', amount: '100' }, MONTH)).rejects.toMatchObject({ code: 'invalid' })
    for (const bad of ['-5', 'cien', '1.234', '']) await expect(addCost(nora, { month: MONTH, kind: 'cost', component: 'platform', label: 'Plataforma de prueba', amount: bad }, MONTH), bad).rejects.toMatchObject({ code: 'invalid' })
    const a = await addCost(nora, { month: MONTH, kind: 'cost', component: 'platform', label: 'Plataforma de prueba', amount: '300.00' }, MONTH)
    await addCost(nora, { month: MONTH, kind: 'cost', component: 'database', label: 'Base de prueba', amount: '1,200.50' }, MONTH)
    const wrong = await addCost(nora, { month: MONTH, kind: 'cost', component: 'third_party', label: 'Cargado por error', amount: '999' }, MONTH)
    await addCost(nora, { month: MONTH, kind: 'reference', component: 'other', label: 'Licencias de prueba que se dejan de pagar', amount: '2000' }, MONTH)
    await voidCost(nora, wrong)
    await expect(voidCost(nora, wrong)).rejects.toMatchObject({ code: 'invalid' })
    // dos personas entraron este mes: el denominador sale de los inicios de sesión
    for (const k of ['lucia.vega', 'marco.pena']) {
      const id = await personaId(k)
      await admin`insert into crm.audit_events (actor_id, action, object, object_id) values (${id}, 'session.started', 'session', ${id})`
    }
    const board = await costBoard(luis)
    const m = board.months.find((x) => x.month === MONTH)!
    expect(m.cost).toBeCloseTo(1500.5, 2)
    expect(m.reference).toBe(2000)
    expect(m.by_component).toEqual({ platform: 300, database: 1200.5 })
    expect(m.active_people).toBeGreaterThanOrEqual(2)
    const managed = (await admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where owner_id is not null and merged_into is null and archived_at is null`)[0]!.n
    expect(m.managed_accounts).toBe(managed)
    expect(board.entries.find((e) => e.id === wrong)!.voided).toBe(true)
    expect(board.entries.find((e) => e.id === a)).toMatchObject({ amount_usd: 300, created_by_name: 'Nora Salas', source: 'manual' })
    // el monto no se edita ni se borra: solo se anula
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.cost_entries set amount_usd = 1 where id = ${a}`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`delete from crm.cost_entries where id = ${a}`)).toBe(DENIED)
    })
    // quien no gobierna no recibe los denominadores
    expect(await asPersona('lucia.vega', async (tx) => (await tx<{ active_people: number | null }[]>`select * from app.cost_denominators(${`${MONTH}-01`}::date)`)[0]!.active_people)).toBeNull()
  })
})

describe('GOB-08: generador reproducible por mercado', () => {
  it('la misma semilla da los mismos datos; otra semilla, otros', () => {
    const a = plan({ market: 'MX', seed: 42, accounts: 300, depth: 4 })
    const b = plan({ market: 'MX', seed: 42, accounts: 300, depth: 4 })
    const c = plan({ market: 'MX', seed: 43, accounts: 300, depth: 4 })
    expect(a).toEqual(b)
    expect(a.map((x: { id: string }) => x.id)).not.toEqual(c.map((x: { id: string }) => x.id))
    expect(a).toHaveLength(300)
    expect(new Set(a.map((x: { id: string }) => x.id)).size).toBe(300)
    // cadena profunda: cuatro niveles, y cada hijo apunta a un padre del nivel de arriba que va antes en el plan
    expect(Math.max(...a.map((x: { level: number }) => x.level))).toBe(4)
    const byId = new Map(a.map((x: { id: string }) => [x.id, x]))
    for (const x of a as { level: number; parent_id: string | null; i: number }[]) if (x.parent_id) expect((byId.get(x.parent_id) as unknown as { level: number }).level).toBe(x.level - 1)
    // casos límite presentes y nombrados
    expect((a as { edge: string | null }[]).map((x) => x.edge).filter(Boolean).sort()).toEqual(['accents', 'churned_old', 'created_today', 'long_name', 'no_owner', 'no_phone', 'no_place', 'no_tax_id', 'same_name_a', 'same_name_b'])
    expect(plan({ market: 'US', seed: 1, accounts: 50, depth: 2, edgeCases: false }).every((x: { edge: string | null }) => x.edge === null)).toBe(true)
    expect(() => plan({ market: 'BR', seed: 1, accounts: 10, depth: 2 })).toThrow()
    expect(() => plan({ market: 'MX', seed: 1, accounts: 0, depth: 2 })).toThrow()
  })

  it('las identificaciones fiscales de prueba tienen formato válido y solo se guardan los últimos cuatro', () => {
    const r = rng('prueba')
    for (let i = 0; i < 50; i++) {
      const rfc = syntheticRfc(r)
      expect(rfc).toMatch(/^[A-Z]{3}\d{6}[A-Z0-9]{2}[0-9A]$/)
      expect(rfcCheckDigit(rfc.slice(0, 11))).toBe(rfc[11])
      expect(syntheticEin(r)).toMatch(/^\d{9}$/)
      expect(syntheticNit(r)).toMatch(/^\d{14}$/)
    }
    for (const m of ['MX', 'US', 'SV']) for (const x of plan({ market: m, seed: 5, accounts: 40, depth: 3 }) as { tax_id_last4: string | null; phone: string | null }[]) {
      if (x.tax_id_last4 !== null) expect(x.tax_id_last4).toMatch(/^[A-Z0-9]{4}$/)
      if (x.phone !== null) expect(x.phone).toMatch(/^\+[1-9][0-9]{6,14}$/)
    }
  })

  it('corre por mercado (MX, US, SV), deja su registro, no duplica y nunca corre en producción', async () => {
    const before = await testData(await ctxFor('nora.salas'))
    expect(before.runs).toEqual([])
    expect(before.origin).toMatchObject({ accounts_generated: 0, accounts_imported: 0, people_real: 0 })
    await expect(generate(admin, { market: 'MX', seed: 1, accounts: 10, depth: 2, appEnv: 'production' })).rejects.toThrow(/production/)
    await expect(generate(admin, { market: 'BR', seed: 1, accounts: 10, depth: 2, appEnv: 'test' })).rejects.toThrow()
    for (const market of ['MX', 'US', 'SV']) {
      const out = await generate(admin, { market, seed: 11, accounts: 80, depth: 4, runBy: 'tests/db/gobierno', appEnv: 'test' })
      expect(out, market).toMatchObject({ accounts: 80, max_depth: 4, edge_cases: 10 })
      const again = await generate(admin, { market, seed: 11, accounts: 80, depth: 4, runBy: 'tests/db/gobierno', appEnv: 'test' })
      expect(again, market).toMatchObject({ accounts: 0, runId: null })
      const shape = (await admin<{ depth: number; with_tax: number; with_geo: number; total: number }[]>`
        select max(coalesce(array_length(a.ancestor_ids, 1), 0)) + 1 as depth, count(a.tax_id_last4)::int as with_tax, count(a.latitude)::int as with_geo, count(*)::int as total
          from crm.accounts a join crm.synthetic_accounts s on s.account_id = a.id where a.market_code = ${market}`)[0]!
      expect(shape, market).toMatchObject({ depth: 4, total: 80 })
      expect(shape.with_tax).toBe(79)
      expect(shape.with_geo).toBe(79)
    }
    const after = await testData(await ctxFor('luis.tovar'))
    expect(after.runs.map((r) => r.market_code).sort()).toEqual(['MX', 'SV', 'US'])
    expect(after.origin.accounts_generated).toBe(240)
    expect(after.runs[0]).toMatchObject({ seed: 11, accounts: 80, depth: 4, edge_cases: true, run_by: 'tests/db/gobierno' })
    // los datos generados respetan el aislamiento por mercado: quien vende en MX no ve los de US ni los de SV
    const seen = await asPersona('ana.robles', async (tx) => (await tx<{ market_code: string }[]>`select distinct a.market_code from crm.accounts a where a.name like '%(caso límite)'`).map((r) => r.market_code))
    expect(seen).toEqual(['MX'])
    // y sirven para probar la cadena: quien lleva la cabeza de una cadena ve sus cuatro niveles
    const rep = await personaId('diana.cruz')
    const root = (await admin<{ id: string }[]>`
      select a.ancestor_ids[1] as id from crm.accounts a join crm.synthetic_accounts s on s.account_id = a.id
       where a.market_code = 'MX' and array_length(a.ancestor_ids, 1) = 3 limit 1`)[0]!.id
    await admin`update crm.accounts set owner_id = ${rep} where id = ${root}`
    const levels = await asPersona('diana.cruz', async (tx) => (await tx<{ n: number }[]>`select count(distinct coalesce(array_length(ancestor_ids, 1), 0))::int as n from crm.accounts where id = ${root} or ${root} = any(ancestor_ids)`)[0]!.n)
    expect(levels).toBe(4)
  })
})

describe('E7: solicitudes con aprobación, motivo de cada cambio, champions y material por mercado', () => {
  let requestId = ''

  it('F6: cualquiera pide con su para qué; cada quien ve las suyas; administración decide', async () => {
    const lucia = await ctxFor('lucia.vega')
    const nora = await ctxFor('nora.salas')
    await expect(createConfigRequest(lucia, { kind: 'field', title: 'Horario de apertura', purpose: 'corto', market: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createConfigRequest(lucia, { kind: 'field', title: 'Horario de apertura', purpose: 'Para planear la ruta de visitas de la mañana', market: 'US' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createConfigRequest(lucia, { kind: 'option', title: 'Más motivos', purpose: 'Para explicar por qué se pierde un negocio', market: 'MX' })).rejects.toMatchObject({ code: 'invalid' })
    requestId = await createConfigRequest(lucia, { kind: 'field', title: 'Horario de apertura', purpose: 'Para planear la ruta de visitas de la mañana', market: '' })
    expect((await myConfigRequests(lucia)).find((r) => r.id === requestId)).toMatchObject({ status: 'open', market_code: null, kind: 'field' })
    expect((await myConfigRequests(await ctxFor('marco.pena'))).map((r) => r.id)).not.toContain(requestId)
    expect(await asPersona('marco.pena', async (tx) => (await tx`select 1 from crm.config_requests where id = ${requestId}`).length)).toBe(0)
    expect((await allConfigRequests(await ctxFor('luis.tovar'))).map((r) => r.id)).toContain(requestId)
    // quien pide no se aprueba sola, ni por la regla ni en la base
    await expect(decideConfigRequest(lucia, { id: requestId, decision: 'approved' })).rejects.toMatchObject({ code: 'forbidden' })
    await asPersona('lucia.vega', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.config_requests set status = 'approved', decided_by = ${lucia.user.id}, decided_at = now() where id = ${requestId}`)).toBe('0 rows')
    })
    await expect(decideConfigRequest(nora, { id: requestId, decision: 'rejected' })).rejects.toMatchObject({ code: 'invalid' })
    // un campo no se crea desde una solicitud sin aprobar
    await expect(createField(nora, { object: 'account', market: '', motor: '', labelEs: 'Horario de apertura gob', labelEn: 'Opening hours gov', dataType: 'text', decision: 'Decide a qué hora se visita cada comercio', requestId })).rejects.toMatchObject({ code: 'invalid' })
    await decideConfigRequest(nora, { id: requestId, decision: 'approved', note: 'Va compartido para todos los mercados' })
    expect((await approvedFieldRequests(nora)).map((r) => r.id)).toContain(requestId)
    expect((await myConfigRequests(lucia)).find((r) => r.id === requestId)).toMatchObject({ status: 'approved', decision_note: 'Va compartido para todos los mercados', decided_by_name: 'Nora Salas' })
  })

  it('F6 y F7: un campo se crea con la decisión que habilita, que queda como el motivo del cambio; la solicitud queda hecha', async () => {
    const nora = await ctxFor('nora.salas')
    await expect(createField(nora, { object: 'account', market: '', motor: '', labelEs: 'Horario de apertura gob', labelEn: 'Opening hours gov', dataType: 'text', decision: '' })).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('decisión') })
    const fieldId = await createField(nora, { object: 'account', market: '', motor: '', labelEs: 'Horario de apertura gob', labelEn: 'Opening hours gov', dataType: 'text', decision: 'Decide a qué hora se visita cada comercio en la ruta de la mañana', requestId })
    const row = (await admin<{ decision: string; request_id: string }[]>`select decision, request_id from crm.field_definitions where id = ${fieldId}`)[0]!
    expect(row).toMatchObject({ decision: 'Decide a qué hora se visita cada comercio en la ruta de la mañana', request_id: requestId })
    expect((await admin<{ status: string; field_id: string }[]>`select status, field_id from crm.config_requests where id = ${requestId}`)[0]).toMatchObject({ status: 'done', field_id: fieldId })
    // la misma solicitud no crea dos campos
    await expect(createField(nora, { object: 'account', market: '', motor: '', labelEs: 'Horario dos gob', labelEn: 'Hours two gov', dataType: 'text', decision: 'Decide a qué hora se visita cada comercio', requestId })).rejects.toMatchObject({ code: 'invalid' })
    const changes = await configChanges(nora, false)
    const created = changes.rows.find((c) => c.action === 'field.created' && c.reason === 'Decide a qué hora se visita cada comercio en la ruta de la mañana')
    expect(created).toMatchObject({ object: 'field', actor_name: 'Nora Salas', reason_by: 'Nora Salas' })
    expect((created!.after as { shared: boolean; from_request: boolean })).toMatchObject({ shared: true, from_request: true })
  })

  it('F7: a un cambio de configuración sin motivo se le anota el porqué, una sola vez', async () => {
    const nora = await ctxFor('nora.salas')
    await setComponentOwners(nora, { key: 'identity', owner: 'Persona Tres', backup: '' })
    const pending = await configChanges(nora, true)
    expect(pending.missing).toBeGreaterThanOrEqual(1)
    const ev = pending.rows.find((c) => c.action === 'component.owners_set')!
    expect(ev.reason).toBeNull()
    await expect(annotateChange(await ctxFor('luis.tovar'), ev.id, 'Porque sí lo digo yo')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(annotateChange(nora, ev.id, 'no')).rejects.toMatchObject({ code: 'invalid' })
    await annotateChange(nora, ev.id, 'Se nombró a quien cubre el ingreso con Google antes del piloto')
    await expect(annotateChange(nora, ev.id, 'Otro motivo distinto al primero')).rejects.toMatchObject({ code: 'invalid' })
    const after = await configChanges(nora, false)
    expect(after.rows.find((c) => c.id === ev.id)!.reason).toBe('Se nombró a quien cubre el ingreso con Google antes del piloto')
    expect(after.missing).toBe(pending.missing - 1)
    // un evento que no es de configuración no admite motivo aquí
    const other = (await admin<{ id: string }[]>`select id from crm.audit_events where object not in ('pipeline','stage','field','component','service_objective','account_type','loss_reason','territory') limit 1`)[0]
    if (other) await expect(annotateChange(nora, other.id, 'Un motivo cualquiera')).rejects.toMatchObject({ code: 'not_found' })
    // el motivo no se edita ni se borra, igual que la bitácora
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.change_reasons set reason = 'otro motivo' where event_id = ${ev.id}`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`delete from crm.change_reasons where event_id = ${ev.id}`)).toBe(DENIED)
    })
  })

  it('F3: un champion por equipo, que trabaja en ese equipo, con su revisión mensual', async () => {
    const nora = await ctxFor('nora.salas')
    const lucia = await ctxFor('lucia.vega')
    const teams = await teamChampions(nora, true)
    const d2d = teams.find((t) => t.team === 'D2D Centro')!
    expect(d2d.champion).toBeNull()
    expect(d2d.members.map((m) => m.name)).toEqual(expect.arrayContaining(['Lucía Vega', 'Marco Peña', 'Fernando Ibarra']))
    expect(await myChampions(lucia)).toEqual([{ team: 'D2D Centro', champion: null }])
    await expect(setChampion(lucia, d2d.team_id, lucia.user.id)).rejects.toMatchObject({ code: 'forbidden' })
    // alguien de otro equipo no puede ser el champion
    await expect(setChampion(nora, d2d.team_id, await personaId('sam.ortiz'))).rejects.toMatchObject({ code: 'invalid' })
    await expect(recordChampionReview(nora, { teamId: d2d.team_id, month: MONTH, notes: 'Revisión sin champion' }, MONTH)).rejects.toMatchObject({ code: 'invalid' })
    await setChampion(nora, d2d.team_id, lucia.user.id)
    expect(await myChampions(await ctxFor('marco.pena'))).toEqual([{ team: 'D2D Centro', champion: 'Lucía Vega' }])
    await expect(recordChampionReview(nora, { teamId: d2d.team_id, month: '2099-01', notes: 'Revisión del futuro' }, MONTH)).rejects.toMatchObject({ code: 'invalid' })
    await recordChampionReview(nora, { teamId: d2d.team_id, month: MONTH, notes: 'Se revisaron los filtros del equipo y dos campos sin uso' }, MONTH)
    await expect(recordChampionReview(nora, { teamId: d2d.team_id, month: MONTH, notes: 'La misma revisión otra vez' }, MONTH)).rejects.toMatchObject({ code: 'invalid' })
    expect((await teamChampions(nora, false)).find((t) => t.team_id === d2d.team_id)).toMatchObject({ champion: 'Lucía Vega', last_review: MONTH })
    // ser champion no cambia permisos
    await expect(setChampion(lucia, d2d.team_id, '')).rejects.toMatchObject({ code: 'forbidden' })
    expect(lucia.can('config.manage')).toBe(false)
    await asPersona('lucia.vega', async (tx) => {
      expect(await attempt(tx, (sp) => sp`delete from crm.team_champions where team_id = ${d2d.team_id}`)).toBe('0 rows')
      expect((await tx`select 1 from crm.champion_reviews`).length).toBe(0)
    })
    await setChampion(nora, d2d.team_id, '')
    expect((await teamChampions(nora, false)).find((t) => t.team_id === d2d.team_id)!.champion).toBeNull()
  })

  it('F9: el material de capacitación es por mercado y en su idioma; del material se guarda el enlace', async () => {
    const nora = await ctxFor('nora.salas')
    await expect(saveMaterial(await ctxFor('ana.robles'), { market: 'MX', kind: 'deck', locale: 'es', title: 'Presentación de inicio', url: 'https://ejemplo.test/mx/deck', inPortal: false, pinned: false })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveMaterial(nora, { market: 'MX', kind: 'deck', locale: 'es', title: 'Presentación de inicio', url: 'http://ejemplo.test/mx/deck', inPortal: false, pinned: false })).rejects.toMatchObject({ code: 'invalid' })
    await saveMaterial(nora, { market: 'MX', kind: 'deck', locale: 'es', title: 'Presentación de inicio México', url: 'https://ejemplo.test/mx/deck', inPortal: false, pinned: false })
    await saveMaterial(nora, { market: 'US', kind: 'faq', locale: 'en', title: 'US FAQ', url: 'https://ejemplo.test/us/faq', inPortal: true, pinned: true })
    // guardar de nuevo el mismo mercado, tipo e idioma lo actualiza, no lo duplica
    await saveMaterial(nora, { market: 'MX', kind: 'deck', locale: 'es', title: 'Presentación de inicio México', url: 'https://ejemplo.test/mx/deck-v2', inPortal: true, pinned: false })
    expect((await materials(nora)).filter((m) => m.market_code === 'MX' && m.kind === 'deck')).toHaveLength(1)
    const mx = await materials(await ctxFor('lucia.vega'))
    expect(mx.map((m) => `${m.market_code}:${m.kind}:${m.locale}:${m.in_portal}`)).toEqual(['MX:deck:es:true'])
    expect(mx[0]!.url).toBe('https://ejemplo.test/mx/deck-v2')
    expect((await materials(await ctxFor('sam.ortiz'))).map((m) => m.title)).toEqual(['US FAQ'])
    await asPersona('lucia.vega', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.training_materials set title = 'otro título'`)).toBe('0 rows')
    })
  })

  it('cada acción nueva se lee en la bitácora en los dos idiomas y cae en el filtro Gobierno', async () => {
    const actions = (await admin<{ action: string }[]>`select distinct action from crm.audit_events where action ~ '^(objective|incident|restore_test|component|maintenance|release|deployment|cost|config_request|change|champion|material)\\.'`).map((r) => r.action)
    expect(actions.length).toBeGreaterThanOrEqual(15)
    for (const a of actions) {
      expect(AUDIT_ACTION[a], a).toBeDefined()
      expect(AUDIT_GROUPS.governance.like.some((p) => a.startsWith(p.replace('%', ''))), a).toBe(true)
    }
    const objects = (await admin<{ object: string }[]>`select distinct object from crm.audit_events where action ~ '^(objective|incident|restore_test|component|maintenance|release|deployment|cost|config_request|change|champion|material)\\.'`).map((r) => r.object)
    for (const o of objects) expect(AUDIT_OBJECT[o], o).toBeDefined()
  })
})
