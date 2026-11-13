import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ctxFor, owner } from './helpers'
// @ts-expect-error módulo de soporte sin tipos
import { startMock } from '../support/pipedrive-mock.mjs'
import { importStep, startImport, type Mode } from '@/domain/pipedrive/import'
import { decideField } from '@/domain/pipedrive/edits'
import { resolveConflict, setCutover, setGoalTarget } from '@/domain/pipedrive/coexistence'
import { getConflicts, getCutover, getGoals, getOrphans, getRebuild, getBoards } from '@/dal/coexistence'
import { getImportStatus } from '@/dal/imports'
import { problemIn, describe as say } from '@/domain/automation/catalog'
import { findJob, runJob } from '@/server/jobs/runner'
import type { Ctx } from '@/server/context'

type Mock = { data: Record<string, Record<string, unknown>[]>; close: () => Promise<void> }
const admin = owner()
let mock: Mock
let nora: Ctx
const one = async <T>(q: Promise<T[]>) => (await q)[0]!

async function runImport(mode: Mode) {
  await startImport(nora, mode)
  for (let i = 0; i < 400; i++) {
    const r = await importStep(nora, 4000)
    if (r.status === 'done') return
    if (r.status === 'failed' || r.status === 'idle') throw new Error(`import ${r.status} at ${r.phase}`)
    if (r.waitMs) await new Promise((res) => setTimeout(res, Math.min(r.waitMs!, 1500)))
  }
  throw new Error('import did not finish')
}
const account = (orgId: number) => one(admin<Record<string, unknown>[]>`
  select a.* from crm.accounts a join crm.account_aliases al on al.account_id = a.id where al.system = 'pipedrive' and al.external_id = ${String(orgId)}`)
const ref = async (object: string, id: number | string) => (await one(admin<{ internal_id: string }[]>`select internal_id from crm.external_refs where system = 'pipedrive' and object = ${object} and external_id = ${String(id)}`)).internal_id
const openConflicts = (recordId: string) => admin<{ id: string; field: string; contigo_value: unknown; pipedrive_value: unknown }[]>`
  select id, field, contigo_value, pipedrive_value from crm.import_conflicts where record_id = ${recordId} and status = 'open' order by field`
const touch = (o: Record<string, unknown>, patch: Record<string, unknown>) => Object.assign(o, patch, { update_time: new Date().toISOString() })

beforeAll(async () => {
  mock = await startMock(Number(process.env.UNIT_PIPEDRIVE_PORT ?? 46350))
  nora = await ctxFor('nora.salas')
  await runImport('full')
}, 180_000)
afterAll(async () => {
  await mock.close()
  await admin.end()
})

describe('E6.F2: la regla de cada campo (pura)', () => {
  it('igual: nada; vacío en CONTIGO: se llena; nadie lo tocó: se actualiza', () => {
    expect(decideField('A', 'A', 'A')).toEqual({ apply: false, conflict: false, base: 'A' })
    expect(decideField('A', null, 'B')).toEqual({ apply: true, conflict: false, base: 'A' })
    expect(decideField('A', '', undefined)).toEqual({ apply: true, conflict: false, base: 'A' })
    expect(decideField('Nuevo', 'Viejo', 'Viejo')).toEqual({ apply: true, conflict: false, base: 'Nuevo' })
  })
  it('editado en CONTIGO y Pipedrive igual: manda CONTIGO sin choque; cambiaron los dos: choque', () => {
    expect(decideField('Viejo', 'Editado', 'Viejo')).toEqual({ apply: false, conflict: false, base: 'Viejo' })
    expect(decideField('Otro', 'Editado', 'Viejo')).toEqual({ apply: false, conflict: true, base: 'Viejo' })
    // Sin base (registros cargados antes de esta regla) y distintos: no se sabe quién cambió, así que no se pisa y se pregunta.
    expect(decideField('Otro', 'Editado', undefined)).toEqual({ apply: false, conflict: true, base: null })
    // Pipedrive vació el campo y CONTIGO lo tiene editado: tampoco se borra.
    expect(decideField(null, 'Editado', 'Viejo')).toEqual({ apply: false, conflict: true, base: 'Viejo' })
    expect(decideField(1500, '1500', '1500')).toEqual({ apply: false, conflict: false, base: '1500' })
  })
})

describe('E6.F2: la recarga de Pipedrive no pisa lo editado en CONTIGO', () => {
  let acc: string, contact: string, deal: string, committed: string, migrating: string, other: string
  beforeAll(async () => {
    acc = String((await account(1002)).id)
    contact = await ref('person', 5002)
    deal = await ref('deal', 7001)
    const pipe = await ref('pipeline', 7)
    committed = (await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${pipe} and name_en = 'Committed'`)).id
    migrating = await ref('stage', 48)
    other = (await one(admin<{ id: string }[]>`select u.id from crm.users u join crm.memberships m on m.user_id = u.id where m.market_code = 'US' and u.is_active and not u.is_system
      and u.id <> ${String((await account(1002)).owner_id)} order by u.id limit 1`)).id
    // Ediciones en CONTIGO (como las haría una persona desde la ficha).
    await admin`update crm.accounts set name = 'Sunrise editado en CONTIGO', locality = 'Coral Gables', postal_code = null, owner_id = ${other} where id = ${acc}`
    await admin`update crm.contacts set full_name = 'Gary Lowe Jr' where id = ${contact}`
    await admin`update crm.deals set stage_id = ${committed}, title = 'Alta editada en CONTIGO' where id = ${deal}`
    // Cambios en Pipedrive.
    touch(mock.data.organizations!.find((o) => o.id === 1002)!, { name: 'Sunrise Wireless renombrado en Pipedrive' })
    touch(mock.data.persons!.find((p) => p.id === 5002)!, { phones: [{ value: '(305) 555-0199', primary: true }], emails: [{ value: 'gary.lowe@ejemplo.test', primary: true }] })
    touch(mock.data.deals!.find((d) => d.id === 7001)!, { stage_id: 48 })
    await runImport('full')
  }, 180_000)

  it('nombre: cambió en los dos lados, se queda el de CONTIGO y el choque va a la cola', async () => {
    expect((await account(1002)).name).toBe('Sunrise editado en CONTIGO')
    const c = (await openConflicts(acc)).find((x) => x.field === 'name')
    expect(c).toMatchObject({ contigo_value: 'Sunrise editado en CONTIGO', pipedrive_value: 'Sunrise Wireless renombrado en Pipedrive' })
  })
  it('quién lo lleva y ciudad: editados solo en CONTIGO, se quedan y no hacen ruido', async () => {
    const a = await account(1002)
    expect(a.owner_id).toBe(other)
    expect(a.locality).toBe('Coral Gables')
    expect((await openConflicts(acc)).map((x) => x.field)).toEqual(['name'])
  })
  it('código postal: vacío en CONTIGO, la recarga lo llena', async () => {
    expect((await account(1002)).postal_code).toBe('33101')
  })
  it('teléfono y correo del contacto: nadie los tocó en CONTIGO, llegan los de Pipedrive; su nombre editado se queda', async () => {
    const c = await one(admin<{ full_name: string; phone: string; email: string }[]>`select full_name, phone, email from crm.contacts where id = ${contact}`)
    expect(c).toMatchObject({ full_name: 'Gary Lowe Jr', phone: '+13055550199', email: 'gary.lowe@ejemplo.test' })
    expect(await openConflicts(contact)).toEqual([])
  })
  it('etapa: movida en los dos lados, se queda la de CONTIGO (sin evento de etapa nuevo) y el choque guarda la de Pipedrive; el título editado se queda', async () => {
    const d = await one(admin<{ stage_id: string; title: string }[]>`select stage_id, title from crm.deals where id = ${deal}`)
    expect(d).toMatchObject({ stage_id: committed, title: 'Alta editada en CONTIGO' })
    const c = await openConflicts(deal)
    expect(c.map((x) => x.field)).toEqual(['stage_id'])
    expect((c[0]!.pipedrive_value as Record<string, string>).stage_id).not.toBe(committed)
    expect(migrating).toBeTruthy()
    const shown = (await getConflicts(nora)).rows.find((x) => x.record_id === deal)!
    expect(shown.contigo).toContain('Committed')
    expect(shown.pipedrive).toMatch(/ \/ /) // la etapa se muestra por su nombre, no por su identificador
    expect(shown.pipedrive).not.toBe(shown.contigo)
    const s = await getImportStatus(nora)
    expect((s.run!.stats as Record<string, Record<string, number>>).conflicts).toMatchObject({ organization: 1, deal: 1 })
  })

  it('una persona decide: "usar Pipedrive" pone su valor; "quedarse con CONTIGO" lo conserva; la siguiente recarga no vuelve a preguntar', async () => {
    const name = (await openConflicts(acc)).find((x) => x.field === 'name')!
    const stage = (await openConflicts(deal))[0]!
    await expect(resolveConflict(await ctxFor('ana.robles'), name.id, 'take')).rejects.toMatchObject({ code: expect.stringMatching(/^(forbidden|not_found)$/) })
    await resolveConflict(nora, name.id, 'take')
    await resolveConflict(nora, stage.id, 'keep')
    expect((await account(1002)).name).toBe('Sunrise Wireless renombrado en Pipedrive')
    await expect(resolveConflict(nora, name.id, 'keep')).rejects.toMatchObject({ code: 'invalid' })
    expect(await one(admin<{ action: string }[]>`select action from crm.audit_events where action like 'import.conflict_%' order by at desc limit 1`)).toMatchObject({ action: 'import.conflict_kept' })
    await runImport('full')
    expect(await openConflicts(acc)).toEqual([])
    expect(await openConflicts(deal)).toEqual([])
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${deal}`)).stage_id).toBe(committed)
  }, 180_000)
})

describe('GOB-05 / E6.F3: convivencia y corte por mercado', () => {
  it('mide los criterios de salida y dice qué falta para apagar Pipedrive', async () => {
    const us = (await getCutover(nora)).find((m) => m.market === 'US')!
    expect(us.criteria.map((c) => c.key)).toEqual(['import', 'loaded', 'conflicts', 'rebuild', 'date', 'freeze'])
    expect(us.criteria.find((c) => c.key === 'import')!.ok).toBe(true)
    expect(us.criteria.find((c) => c.key === 'date')!.ok).toBe(false)
    expect(us.loaded).toBeGreaterThan(0)
  })
  it('congelar pide fecha; apagar pide congelamiento y última sincronización; apagado, la recarga ya no toca el mercado', async () => {
    await expect(setCutover(nora, 'US', { action: 'freeze' })).rejects.toMatchObject({ code: 'invalid' })
    await setCutover(nora, 'US', { action: 'date', cutoffOn: '2026-12-15' })
    await setCutover(nora, 'US', { action: 'freeze' })
    await expect(setCutover(nora, 'US', { action: 'off' })).rejects.toMatchObject({ code: 'invalid' })
    await runImport('delta') // la última sincronización
    expect((await one(admin<{ last_sync_at: Date | null }[]>`select last_sync_at from crm.pipedrive_cutover where market_code = 'US'`)).last_sync_at).not.toBeNull()
    await setCutover(nora, 'US', { action: 'off' })
    touch(mock.data.organizations!.find((o) => o.id === 1002)!, { name: 'Cambio después del corte' })
    await runImport('full')
    expect((await account(1002)).name).not.toBe('Cambio después del corte')
    const s = await getImportStatus(nora)
    expect((s.run!.stats.skipped as Record<string, number>)['organization:market_cut_over']).toBeGreaterThan(0)
    await expect(setCutover(nora, 'US', { action: 'unfreeze' })).rejects.toMatchObject({ code: 'invalid' })
    expect(await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'import.cutover_updated'`)).toMatchObject({ n: 3 })
  }, 240_000)
})

describe('E6.F6: lo que desapareció de Pipedrive se lista para que una persona decida', () => {
  it('una organización que la importación completa ya no trae aparece en la lista; CONTIGO no la borra', async () => {
    const before = String((await account(1005)).id)
    mock.data.organizations = mock.data.organizations!.filter((o) => o.id !== 1005)
    await runImport('full')
    const o = await getOrphans(nora)
    expect(o.rows.find((r) => r.object === 'organization' && r.external_id === '1005')).toMatchObject({ record_id: before, market_code: 'MX' })
    expect(await admin`select 1 from crm.accounts where id = ${before}`).toHaveLength(1)
  }, 180_000)
})

describe('GOB-05: lo que el equipo armó en Pipedrive existe en CONTIGO', () => {
  it('tras migrar: 9 automatizaciones, 1 regla de asignación, 12 reportes, 6 tableros, 1 meta y 10 filtros, cada uno con su lugar', async () => {
    const rows = await getRebuild(nora)
    const count = (k: string) => rows.filter((r) => r.kind === k).length
    expect([count('automation'), count('assignment'), count('report'), count('dashboard'), count('goal'), count('filter')]).toEqual([9, 1, 12, 6, 1, 10])
    const all = await admin<{ kind: string; pd_name: string; contigo_kind: string; contigo_id: string | null; status: string }[]>`select kind, pd_name, contigo_kind, contigo_id, status from crm.pipedrive_rebuild`
    for (const r of all) {
      if (r.contigo_kind === 'none') { expect(r.status).not.toBe('built'); continue }
      const table = { automation: 'automations', routing_rule: 'routing_rules', saved_report: 'saved_reports', report_board: 'report_boards', goal: 'goals', saved_view: 'saved_views' }[r.contigo_kind]!
      expect((await admin.unsafe(`select 1 from crm.${table} where id = $1`, [r.contigo_id!])).length, `${r.kind} ${r.pd_name}`).toBe(1)
    }
    const autos = await admin<{ key: string; is_active: boolean; off_reason_es: string | null; description_es: string; trigger_event: string; actions: { type: string }[] }[]>`
      select key, is_active, off_reason_es, description_es, trigger_event, actions from crm.automations where pipedrive_ref is not null and market_code = 'US' order by key`
    expect(autos).toHaveLength(10)
    // Cada una está encendida o dice por qué no.
    for (const a of autos) expect(a.is_active || Boolean(a.off_reason_es) || ['pd_welcome_vegas_2026', 'pd_followup_vegas_2026'].includes(a.key)).toBe(true)
    // Los correos nacen apagados como en Pipedrive; la #4 dice quién tiene los nombres; la #1 usa la cola de Operaciones, no un nombre fijo.
    expect(autos.filter((a) => a.key.includes('vegas_2026')).every((a) => !a.is_active)).toBe(true)
    expect(autos.find((a) => a.key === 'pd_recruited_by_ace')!.description_es).toContain('[pendiente: LuisRo Sanabria]')
    expect(autos.find((a) => a.key === 'pd_owner_at_approvals')!.actions).toEqual([{ type: 'ops_handoff', to: 'queue' }])
    // Las definiciones respetan el vocabulario del motor.
    for (const a of await admin<{ source: string; trigger_event: string; conditions: never[]; actions: never[] }[]>`select source, trigger_event, conditions, actions from crm.automations where pipedrive_ref is not null and is_active`) {
      expect(problemIn({ source: a.source, trigger: { kind: 'event', event: a.trigger_event }, conditions: a.conditions, actions: a.actions })).toBeNull()
    }
    // Tableros: los dos de US juntan sus reportes; los de México, reportes de México que ya existen.
    const boards = await getBoards(nora)
    expect(boards.find((b) => b.key === 'us_dealer_ops')!.reports.length).toBe(8)
    expect(boards.find((b) => b.key === 'us_vegas_sales')!.reports.length).toBe(4)
    expect(boards.filter((b) => b.market_code === 'MX').every((b) => b.reports.length >= 2)).toBe(true)
    expect(await admin`select 1 from crm.message_templates where key in ('vegas_2026_welcome', 'vegas_2026_followup') and market_code = 'US'`).toHaveLength(2)
  })

  it('la meta "Deals won" se ve con su avance; la cifra la pone quien lidera el mercado', async () => {
    const g = (await getGoals(nora, 'US')).find((x) => x.name_en === 'Deals won this month')!
    expect(g.target).toBeNull()
    expect(g.done).toBeGreaterThanOrEqual(0)
    await expect(setGoalTarget(await ctxFor('ana.robles'), g.id, '10')).rejects.toMatchObject({ code: expect.stringMatching(/^(forbidden|not_found)$/) })
    await expect(setGoalTarget(nora, g.id, '-3')).rejects.toMatchObject({ code: 'invalid' })
    await setGoalTarget(nora, g.id, '25')
    expect((await getGoals(nora, 'US')).find((x) => x.id === g.id)!.target).toBe(25)
  })

  it('el motor corre las reconstruidas: llena el origen del comercio solo si está vacío y nunca lo sobrescribe', async () => {
    await admin`insert into crm.field_definitions (object, key, label_es, label_en, data_type, market_code) values
      ('account', 'merchant_origin', 'Origen del comercio', 'Merchant Origin', 'text', 'US') on conflict do nothing`
    await admin`select crm.pipedrive_rebuild_apply()`
    const auto = await one(admin<{ id: string; is_active: boolean }[]>`select id, is_active from crm.automations where key = 'pd_merchant_origin_created' and market_code = 'US'`)
    expect(auto.is_active).toBe(true)
    const job = findJob('automatizaciones.eventos')!
    await runJob(job, 'manual', { force: true })
    const [empty, filled] = await admin<{ id: string }[]>`select a.id from crm.accounts a where a.market_code = 'US' and a.archived_at is null order by a.id limit 2`
    await admin`update crm.accounts set custom = custom - 'merchant_origin' where id = ${empty!.id}`
    await admin`update crm.accounts set custom = custom || '{"merchant_origin":"Referral"}'::jsonb where id = ${filled!.id}`
    for (const id of [empty!.id, filled!.id]) await admin`insert into crm.outbox_events (event_type, aggregate, aggregate_id, market_code, payload) values ('account.created', 'account', ${id}, 'US', '{}'::jsonb)`
    await new Promise((r) => setTimeout(r, 2300))
    await runJob(job, 'manual', { force: true })
    expect((await one(admin<{ v: string }[]>`select custom ->> 'merchant_origin' as v from crm.accounts where id = ${empty!.id}`)).v).toBe('New acquisition')
    expect((await one(admin<{ v: string }[]>`select custom ->> 'merchant_origin' as v from crm.accounts where id = ${filled!.id}`)).v).toBe('Referral')
    const log = await admin<{ record_id: string; outcome: string }[]>`select record_id, outcome from crm.automation_log where automation_id = ${auto.id}`
    expect(log.find((l) => l.record_id === empty!.id)?.outcome).toBe('done')
    expect(log.find((l) => l.record_id === filled!.id)?.outcome).toBe('skipped')
  }, 30_000)

  it('el turno de Las Vegas reparte por turno los negocios nuevos de su embudo', async () => {
    const pipe = await one(admin<{ id: string }[]>`insert into crm.pipelines (market_code, motor, name, position) values ('US', 'vegas', 'US - Vegas Conference 2026', 9) returning id`)
    await admin`insert into crm.stages (pipeline_id, position, code, name_es, name_en, kind, probability, rot_days) values
      (${pipe.id}, 1, 'lead_captured', 'Lead capturado', 'Lead captured', 'open', 10, 10), (${pipe.id}, 2, 'won', 'Ganado', 'Won', 'won', 100, 0), (${pipe.id}, 3, 'lost', 'Perdido', 'Lost', 'lost', 0, 0)`
    const reps = (await admin<{ id: string }[]>`select distinct m.user_id as id from crm.memberships m join crm.users u on u.id = m.user_id where m.market_code = 'US' and m.role = 'rep' and u.is_active order by 1 limit 2`).map((r) => r.id)
    expect(reps).toHaveLength(2)
    await admin`update crm.routing_rules set member_ids = ${reps}::uuid[], cursor = 0 where pipedrive_ref = 'Las Vegas Round Robin'`
    await admin`select crm.pipedrive_rebuild_apply()`
    const rr = await one(admin<{ is_active: boolean }[]>`select is_active from crm.automations where key = 'pd_vegas_round_robin'`)
    expect(rr.is_active).toBe(true)
    // Los correos de Las Vegas ya tienen embudo y etapa, pero siguen apagados como en Pipedrive.
    expect((await one(admin<{ is_active: boolean }[]>`select is_active from crm.automations where key = 'pd_welcome_vegas_2026'`)).is_active).toBe(false)
    const job = findJob('automatizaciones.eventos')!
    await runJob(job, 'manual', { force: true })
    const accs = await admin<{ id: string }[]>`select id from crm.accounts where market_code = 'US' and archived_at is null order by id limit 2`
    const stage = await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${pipe.id} and code = 'lead_captured'`)
    const deals: string[] = []
    for (const a of accs) {
      const d = await one(admin<{ id: string }[]>`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, title, currency, status, owner_id)
        values ('US', ${pipe.id}, ${stage.id}, ${a.id}, 'Lead de la conferencia', 'USD', 'open', null) returning id`)
      deals.push(d.id)
      await admin`insert into crm.outbox_events (event_type, aggregate, aggregate_id, market_code, payload) values ('deal.created', 'deal', ${d.id}, 'US', '{}'::jsonb)`
    }
    await new Promise((r) => setTimeout(r, 2300))
    await runJob(job, 'manual', { force: true })
    const owners = await admin<{ owner_id: string }[]>`select owner_id from crm.deals where id = any(${deals}::uuid[]) order by created_at, id`
    expect(owners.map((o) => o.owner_id).sort()).toEqual([...reps].sort())
    expect(await admin`select 1 from crm.audit_events where action = 'deal.turn_assigned' and object_id = any(${deals}::uuid[])`).toHaveLength(2)
    const d = say({ source: 'deal', trigger: { kind: 'event', event: 'deal.created' }, conditions: [{ field: 'owner_id', op: 'in', value: '' }], actions: [{ type: 'assign_turn', rule_id: reps[0]! }] })
    expect(d.ifs[0]!.es).toContain('la lista está vacía')
  }, 30_000)
})
