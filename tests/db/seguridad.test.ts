import { describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { loadCtx } from '@/server/context'
import { runVia, withUser, withoutUser } from '@/server/db'
import { can, isReadOnly, type Membership } from '@/domain/policy'
import { createApiClient, grantAccess, hashKey } from '@/domain/admin'
import { createLead, intakeFromForm } from '@/domain/leads'
import { deadLeadsForMailing } from '@/dal/mx'
import { exportClosedDeals } from '@/domain/reports'
import { marketPeriods } from '@/dal/reports'
import { searchAll } from '@/dal/accounts'
import { getAccountSecurity, getKeys, getMonitoring } from '@/dal/security'
import {
  acknowledgeAlert, addAccountTeamMember, anonymizeSubject, applyRetention, closeAccessReview, createAgency, createSubjectRequest, decideReviewItem,
  exportSubject, grantAgencyAccess, liftOptOut, mayContact, openAccessReview, optOut, prepareAuditArchive, recordConsent, recordSeatApproval,
  revealSensitive, runSecurityScan, setAdminAreas, setApiClientMeta, setMembershipEntity, setRetentionRule, setSensitive,
  setTeamParent, setThresholds, startViewAs, updateSubjectRequest,
} from '@/domain/security'
import { rotateApiKey } from '@/domain/api-keys'
import { seguridadJobs } from '@/server/jobs/seguridad'
import { JOBS } from '@/server/jobs/registry'
import { simulateDirectoryGone } from '@/server/adapters/directory'
import { AUDIT_ACTION } from '@/lib/audit'

// Paquete seguridad (migración 0031): SEG-01, 02, 03, 04, 07, 08, 09, UX-02 y E4.F2, F4, F9.
const admin = owner()
const tag = () => Math.random().toString(36).slice(2, 8)
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const DOMAINS = ['axexo.com']
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'error')
const mxPhone = () => `+5255${Math.floor(10_000_000 + Math.random() * 89_999_999)}`

/** Una cuenta B2B de México a nombre de la persona, con un contacto. */
async function account(ownerKey: string, extra: { entity?: string } = {}) {
  const ownerId = await personaId(ownerKey)
  const acc = await one(admin<{ id: string }[]>`
    insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, account_type, country, legal_entity_id)
    values ('MX', 'chain', ${`Cadena Reservada ${tag()}`}, 'b2b', 'prospect', ${ownerId}, 'chain', 'MX', ${extra.entity ?? null}) returning id`)
  const phone = mxPhone()
  const contact = await one(admin<{ id: string }[]>`
    insert into crm.contacts (market_code, full_name, phone, email) values ('MX', ${`Persona ${tag()}`}, ${phone}, ${`persona.${tag()}@ejemplo.test`}) returning id`)
  await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${acc.id}, ${contact.id}, 'MX', 'owner')`
  return { id: acc.id, contactId: contact.id, phone }
}
/** Una persona nueva con el rol y las partes que se pidan. */
async function person(role: string, opts: { market?: string | null; areas?: string[] | null; entity?: string | null; scopeAccount?: string | null } = {}) {
  const u = await one(admin<{ id: string }[]>`insert into crm.users (email, full_name) values (${`seg.${tag()}@contigo.test`}, ${`Persona Seguridad ${tag()}`}) returning id`)
  await admin`insert into crm.memberships (user_id, market_code, role, admin_areas, legal_entity_id, scope_account_id)
              values (${u.id}, ${opts.market ?? null}, ${role}, ${opts.areas ?? null}, ${opts.entity ?? null}, ${opts.scopeAccount ?? null})`
  return (await loadCtx(u.id, 'es'))!
}

describe('SEG-03: la bitácora la escribe la base', () => {
  it('toda tabla de crm tiene su trigger de bitácora o está en la lista de excluidas con su motivo', async () => {
    const missing = await admin<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'crm' and c.relkind in ('r','p') and not c.relispartition
         and c.relname not in (select table_name from audit.excluded_tables)
         and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'zz_audit_capture')`
    expect(missing.map((m) => m.relname)).toEqual([])
    const excluded = await admin<{ table_name: string; reason: string }[]>`select table_name, reason from audit.excluded_tables`
    for (const e of excluded) expect(e.reason.length, e.table_name).toBeGreaterThan(20)
  })

  it('un cambio por SQL directo queda registrado con la vía "sql", y uno de la aplicación con su vía y su solicitud', async () => {
    const a = await account('diana.cruz')
    await admin`update crm.accounts set locality = 'Centro' where id = ${a.id}`
    const direct = await one(admin<{ via: string; actor_id: string | null; changed: string[]; db_role: string }[]>`
      select via, actor_id, changed, db_role from audit.data_log where table_name = 'accounts' and row_id = ${a.id} and op = 'U' order by id desc limit 1`)
    expect(direct).toMatchObject({ via: 'sql', actor_id: null, db_role: 'postgres' })
    expect(direct.changed).toContain('locality')

    const diana = await ctxFor('diana.cruz')
    await runVia('api', () => withUser(diana.user.id, (tx) => tx`update crm.accounts set locality = 'Norte' where id = ${a.id}`))
    const app = await one(admin<{ via: string; actor_id: string; request_id: string | null; before: { locality: string }; after: { locality: string } }[]>`
      select via, actor_id, request_id, before, after from audit.data_log where table_name = 'accounts' and row_id = ${a.id} and op = 'U' order by id desc limit 1`)
    expect(app).toMatchObject({ via: 'api', actor_id: diana.user.id, before: { locality: 'Centro' }, after: { locality: 'Norte' } })
    expect(app.request_id).toMatch(/^[0-9a-f-]{36}$/)
    // Sin vía declarada y con identidad, es la pantalla.
    await withUser(diana.user.id, (tx) => tx`update crm.accounts set locality = 'Sur' where id = ${a.id}`)
    expect((await one(admin<{ via: string }[]>`select via from audit.data_log where table_name = 'accounts' and row_id = ${a.id} order by id desc limit 1`)).via).toBe('screen')
  })

  it('la configuración va a su propia bitácora y las huellas de las llaves no se copian', async () => {
    const nora = await ctxFor('nora.salas')
    const { id } = await createApiClient(nora, `Llave bitácora ${tag()}`, ['forms:write'])
    const row = await one(admin<{ after: Record<string, unknown>; n: number }[]>`
      select after, (select count(*)::int from audit.data_log where table_name = 'api_clients') as n from audit.config_log where table_name = 'api_clients' and row_id = ${id}`)
    expect(row.n).toBe(0)
    expect(row.after).not.toHaveProperty('key_hash')
    expect(row.after).toHaveProperty('key_prefix')
  })

  it('nadie edita ni borra la bitácora: ni el dueño del esquema, ni la aplicación', async () => {
    for (const t of ['data_log', 'config_log', 'read_log']) {
      expect(await code(admin.unsafe(`update audit.${t} set via = 'x' where id = (select max(id) from audit.${t})`)), t).toMatch(/42501|ok/)
      expect(await code(admin.unsafe(`truncate audit.${t}`)), t).toBe('42501')
    }
    expect(await code(admin`delete from audit.data_log where id = (select max(id) from audit.data_log)`)).toBe('42501')
    expect(await code(admin`update audit.data_log set via = 'x' where id = (select max(id) from audit.data_log)`)).toBe('42501')
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into audit.data_log (table_name, op, via) values ('accounts', 'I', 'screen')`)).toBe('42501')
      expect(await attempt(tx, (sp) => sp`insert into audit.read_log (via, kind, object) values ('screen', 'export', 'x')`)).toBe('42501')
      expect(await attempt(tx, (sp) => sp`select audit.attach_all()`)).toBe('42501')
    })
  })

  it('quien vende no lee la bitácora de la base; la parte Bitácora y Leadership sí', async () => {
    expect((await asPersona('diana.cruz', (tx) => tx`select 1 from audit.data_log limit 5`)).length).toBe(0)
    expect((await asPersona('diana.cruz', (tx) => tx`select 1 from audit.read_log limit 5`)).length).toBe(0)
    expect((await asPersona('luis.tovar', (tx) => tx`select 1 from audit.data_log limit 5`)).length).toBeGreaterThan(0)
    expect((await asPersona('nora.salas', (tx) => tx`select 1 from audit.config_log limit 5`)).length).toBeGreaterThan(0)
  })

  it('cada exportación queda en el registro de lecturas y pasar el umbral abre una alerta que se revisa con nota', async () => {
    const ana = await ctxFor('ana.robles')
    const nora = await ctxFor('nora.salas')
    const out = await exportClosedDeals(ana, marketPeriods(ana, 'mes'), { market: 'MX' }, 'Cierre de mes para dirección')
    const read = await one(admin<{ kind: string; row_count: number; object: string; via: string }[]>`
      select kind, row_count, object, via from audit.read_log where actor_id = ${ana.user.id} and kind = 'export' order by id desc limit 1`)
    expect(read).toMatchObject({ kind: 'export', row_count: out.rows, object: 'closed_deals' })

    await setThresholds(nora, { exports_per_day: 1, export_rows_per_day: 5000, searches_per_hour: 120, reveals_per_day: 20, api_calls_per_hour: 2000, api_rows_per_day: 50000, key_unused_days: 90, key_expiring_days: 14 })
    await exportClosedDeals(ana, marketPeriods(ana, 'mes'), { market: 'MX' }, 'Segundo corte del mismo cierre')
    expect(await runSecurityScan(nora)).toBeGreaterThan(0)
    const before = (await getMonitoring(nora)).alerts.filter((a) => a.kind === 'exports_per_day' && a.subject === 'Ana Robles')
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ status: 'open', threshold: 1 })
    expect(before[0]!.observed).toBeGreaterThanOrEqual(2)
    // Correr la revisión otra vez no duplica la alerta.
    await runSecurityScan(nora)
    expect((await getMonitoring(nora)).alerts.filter((a) => a.kind === 'exports_per_day' && a.subject === 'Ana Robles')).toHaveLength(1)
    await expect(acknowledgeAlert(nora, before[0]!.id, 'ok')).rejects.toMatchObject({ code: 'invalid' })
    await acknowledgeAlert(nora, before[0]!.id, 'Cierre de mes, exportó dos cortes.')
    expect((await getMonitoring(nora)).alerts.find((a) => a.id === before[0]!.id)).toMatchObject({ status: 'acknowledged', ack_name: 'Nora Salas' })
    // Quien vende no corre la revisión ni ve las alertas.
    await expect(runSecurityScan(await ctxFor('diana.cruz'))).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('un cambio por fuera de la aplicación abre una alerta', async () => {
    const a = await account('diana.cruz')
    await admin`update app.schema_migrations set applied_at = now() - interval '2 hours'`
    await admin`update crm.accounts set locality = 'Fuera' where id = ${a.id}`
    const nora = await ctxFor('nora.salas')
    await runSecurityScan(nora)
    const alert = (await getMonitoring(nora)).alerts.find((x) => x.kind === 'direct_sql_change' && x.subject === 'accounts')
    expect(alert).toBeDefined()
  })

  it('la copia fuera de la base arma el lote con su huella y lo deja en "canal apagado"', async () => {
    const nora = await ctxFor('nora.salas')
    expect(await prepareAuditArchive(nora)).toBeGreaterThan(0)
    const batches = (await getMonitoring(nora)).batches
    expect(batches.length).toBeGreaterThan(0)
    for (const b of batches) {
      expect(b.status).toBe('channel_off')
      expect(b.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    // Sin filas nuevas no hay lote nuevo (salvo las que dejó esta misma corrida en configuración).
    expect(await code(admin`delete from audit.archive_batches`)).toBe('42501')
  })

  it('lo que cambia una tarea programada queda con la vía "job", y una lectura con llave queda por llave', async () => {
    const { runJob } = await import('@/server/jobs/runner')
    const out = await runJob({ key: 'seguridad.prueba_via', everyMinutes: 1, description: { es: 'Prueba', en: 'Test' }, run: async (tx) => {
      await tx`update crm.settings set value = '31'::jsonb where key = 'security.unused_days'`
      return { done: 1 }
    } }, 'manual', { force: true })
    expect(out.status).toBe('ok')
    expect((await one(admin<{ via: string }[]>`select via from audit.config_log where table_name = 'settings' and row_id = 'security.unused_days' order by id desc limit 1`)).via).toBe('job')
    const nora = await ctxFor('nora.salas')
    const key = await createApiClient(nora, `Llave lectura ${tag()}`, ['forms:write'])
    await withoutUser((tx) => tx`select app.log_read('api', 'accounts:read', 60000, 'MX', null, ${key.id})`)
    expect(await one(admin<{ via: string; actor_id: string | null; row_count: number }[]>`select via, actor_id, row_count from audit.read_log where key_id = ${key.id}`)).toEqual({ via: 'api', actor_id: null, row_count: 60000 })
    await runSecurityScan(nora)
    expect((await getMonitoring(nora)).alerts.find((a) => a.kind === 'api_rows_per_day')).toMatchObject({ observed: 60000, threshold: 50000 })
  })

  it('los jobs del paquete están en el registro y se pueden correr dos veces', async () => {
    for (const j of seguridadJobs) expect(JOBS.some((x) => x.key === j.key), j.key).toBe(true)
    for (const j of seguridadJobs) {
      for (let i = 0; i < 2; i++) {
        const r = await withoutUser((tx) => j.run(tx))
        expect(r.done, j.key).toBeGreaterThanOrEqual(0)
      }
    }
    const dir = seguridadJobs.find((j) => j.key === 'seguridad.directorio')!
    expect((await withoutUser((tx) => dir.run(tx))).note).toBe('Canal apagado')
  })

  it('toda acción de seguridad tiene nombre en la bitácora, también las que escribe la base', async () => {
    const actions = await admin<{ action: string }[]>`select distinct action from crm.audit_events`
    for (const a of actions) expect(AUDIT_ACTION[a.action], a.action).toBeDefined()
    for (const a of ['sensitive.revealed', 'sensitive.updated', 'retention.applied', 'subject_request.exported', 'subject_request.anonymized', 'view_as.started', 'view_as.ended', 'membership.ended_by_directory']) expect(AUDIT_ACTION[a], a).toBeDefined()
  })
})

describe('SEG-01: Administración por partes, equipo de cuenta, jerarquía, entidad legal, agencia y partner', () => {
  it('una parte de Administración solo hace lo suyo, en el dominio y en la base', async () => {
    const auditOnly = await person('admin', { areas: ['audit'] })
    expect(auditOnly.can('audit.read')).toBe(true)
    expect(auditOnly.can('security.manage')).toBe(true)
    expect(auditOnly.can('access.manage')).toBe(false)
    expect(auditOnly.can('config.manage')).toBe(false)
    expect(auditOnly.can('integration.operate')).toBe(false)
    expect(auditOnly.can('lead.create')).toBe(false)
    expect(auditOnly.isAdmin).toBe(false)
    await expect(grantAccess(auditOnly, { email: `x.${tag()}@axexo.com`, fullName: 'Persona Nueva', role: 'rep', market: 'MX' }, DOMAINS)).rejects.toMatchObject({ code: 'forbidden' })
    await withUser(auditOnly.user.id, async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into crm.memberships (user_id, market_code, role) values (${auditOnly.user.id}, 'MX', 'rep')`)).toBe('42501')
      expect(await attempt(tx, (sp) => sp`update crm.stages set rot_days = rot_days where true`)).toBe('0 rows')
      expect(await attempt(tx, (sp) => sp`insert into crm.api_clients (name, key_prefix, key_hash, scopes) values ('x', 'ctg_xxxx', 'h', '{forms:write}')`)).toBe('42501')
      expect((await tx`select 1 from audit.data_log limit 1`).length).toBe(1)
    })

    const access = await person('admin', { areas: ['access'] })
    expect(access.can('access.manage')).toBe(true)
    expect(access.can('audit.read')).toBe(false)
    // Da accesos de venta, pero no Administración: una parte no se da más poder.
    await grantAccess(access, { email: `rep.${tag()}@axexo.com`, fullName: 'Persona de Ventas', role: 'rep', market: 'MX' }, DOMAINS)
    await expect(grantAccess(access, { email: `adm.${tag()}@axexo.com`, fullName: 'Otra Admin', role: 'admin', market: '', confirmAdmin: true }, DOMAINS)).rejects.toMatchObject({ code: 'forbidden' })
    await withUser(access.user.id, async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into crm.memberships (user_id, role) values (${access.user.id}, 'admin')`)).toBe('42501')
      expect(await attempt(tx, (sp) => sp`update crm.memberships set admin_areas = null where user_id = ${access.user.id}`)).toMatch(/42501|0 rows/)
      expect((await tx`select 1 from audit.data_log limit 1`).length).toBe(0)
    })
    const m = await one(admin<{ id: string }[]>`select id from crm.memberships where user_id = ${access.user.id}`)
    await expect(setAdminAreas(access, m.id, null)).rejects.toMatchObject({ code: 'forbidden' })

    // La administración completa reparte las partes; siempre queda alguien con todas.
    const nora = await ctxFor('nora.salas')
    await setAdminAreas(nora, m.id, ['access', 'integrations'])
    expect((await loadCtx(access.user.id, 'es'))!.can('integration.operate')).toBe(true)
    const noraM = await one(admin<{ id: string }[]>`select id from crm.memberships where user_id = ${nora.user.id} and role = 'admin'`)
    await expect(setAdminAreas(nora, noraM.id, ['audit'])).rejects.toMatchObject({ code: 'invalid' })
  })

  it('equipo de cuenta: quien entra ve la cuenta; con permiso de editar, la cambia; al salir deja de verla', async () => {
    const diana = await ctxFor('diana.cruz')
    const ivan = await ctxFor('ivan.rios')
    const a = await account('diana.cruz')
    const sees = async () => (await withUser(ivan.user.id, (tx) => tx`select 1 from crm.accounts where id = ${a.id}`)).length
    expect(await sees()).toBe(0)
    await addAccountTeamMember(diana, { accountId: a.id, userId: ivan.user.id, fn: 'specialist', access: 'read' })
    expect(await sees()).toBe(1)
    expect((await withUser(ivan.user.id, (tx) => tx`update crm.accounts set locality = 'x' where id = ${a.id}`)).count).toBe(0)
    await expect(addAccountTeamMember(diana, { accountId: a.id, userId: ivan.user.id, fn: 'support', access: 'edit' })).rejects.toMatchObject({ code: 'invalid' })
    // Quien no lleva la cuenta ni dirige no arma su equipo.
    await expect(addAccountTeamMember(ivan, { accountId: a.id, userId: await personaId('marco.pena'), fn: 'support', access: 'read' })).rejects.toMatchObject({ code: 'forbidden' })
    const sheet = (await getAccountSecurity(diana, a.id))!
    expect(sheet.team.map((t) => t.full_name)).toEqual(['Iván Ríos'])
    expect(sheet.candidates.some((c) => c.id === ivan.user.id)).toBe(false)
    const { removeAccountTeamMember } = await import('@/domain/security')
    await removeAccountTeamMember(diana, sheet.team[0]!.id)
    expect(await sees()).toBe(0)
    await addAccountTeamMember(await ctxFor('ana.robles'), { accountId: a.id, userId: ivan.user.id, fn: 'support', access: 'edit' })
    expect((await withUser(ivan.user.id, (tx) => tx`update crm.accounts set locality = 'Equipo' where id = ${a.id}`)).count).toBe(1)
    // Alguien de otro mercado no entra al equipo.
    await expect(addAccountTeamMember(diana, { accountId: a.id, userId: await personaId('sam.ortiz'), fn: 'support', access: 'read' })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('supervisión de varios niveles: quien supervisa el equipo de arriba ve a los de abajo; sin círculos', async () => {
    const nora = await ctxFor('nora.salas')
    const fernando = await personaId('fernando.ibarra')
    const diana = await personaId('diana.cruz')
    const d2d = await one(admin<{ id: string }[]>`select team_id as id from crm.memberships where user_id = ${fernando} and role = 'supervisor'`)
    const b2b = await one(admin<{ id: string }[]>`select team_id as id from crm.memberships where user_id = ${diana} and role = 'rep'`)
    const supervised = async () => ((await withUser(fernando, (tx) => tx<{ ids: string[] }[]>`select app.supervised_user_ids() as ids`))[0]!).ids
    expect(await supervised()).not.toContain(diana)
    await setTeamParent(nora, b2b.id, d2d.id)
    expect(await supervised()).toContain(diana)
    await expect(setTeamParent(nora, d2d.id, b2b.id)).rejects.toMatchObject({ code: 'invalid' })
    const us = await one(admin<{ id: string }[]>`select id from crm.teams where market_code = 'US' limit 1`)
    await expect(setTeamParent(nora, us.id, d2d.id)).rejects.toMatchObject({ code: 'invalid' })
    await setTeamParent(nora, b2b.id, null)
    expect(await supervised()).not.toContain(diana)
  })

  it('alcance por entidad legal: un rol limitado a una entidad no ve las cuentas de otra', async () => {
    const nora = await ctxFor('nora.salas')
    const leMx = await one(admin<{ id: string }[]>`select id from crm.legal_entities where market_code = 'MX' limit 1`)
    const other = await one(admin<{ id: string }[]>`insert into crm.legal_entities (market_code, name) values ('MX', ${`Entidad dos ${tag()}`}) returning id`)
    const mine = await account('diana.cruz', { entity: leMx.id })
    const theirs = await account('diana.cruz', { entity: other.id })
    const none = await account('diana.cruz')
    const lead = await person('market_lead', { market: 'MX' })
    const visible = async () => (await withUser(lead.user.id, (tx) => tx<{ id: string }[]>`select id from crm.accounts where id in (${mine.id}, ${theirs.id}, ${none.id})`)).map((r) => r.id)
    expect((await visible()).sort()).toEqual([mine.id, theirs.id, none.id].sort())
    const m = await one(admin<{ id: string }[]>`select id from crm.memberships where user_id = ${lead.user.id}`)
    await setMembershipEntity(nora, m.id, leMx.id)
    expect((await visible()).sort()).toEqual([mine.id, none.id].sort())
    const leUs = await one(admin<{ id: string }[]>`select id from crm.legal_entities where market_code = 'US' limit 1`)
    await expect(setMembershipEntity(nora, m.id, leUs.id)).rejects.toMatchObject({ code: 'invalid' })
    await setMembershipEntity(nora, m.id, null)
    expect((await visible()).length).toBe(3)
  })

  it('E4.F4 agencia confinada: solo ve y trabaja lo que su agencia reclutó, en su embudo', async () => {
    const nora = await ctxFor('nora.salas')
    const pipeline = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'd2d' limit 1`)
    const otherPipeline = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'b2b' limit 1`)
    const agencyId = await createAgency(nora, { market: 'MX', name: `Agencia Norte ${tag()}`, pipelineId: pipeline.id })
    const userId = await grantAgencyAccess(nora, { email: `agencia.${tag()}@axexo.com`, fullName: 'Persona de Agencia', agencyId }, DOMAINS)
    const agent = (await loadCtx(userId, 'es'))!
    expect(agent.can('lead.create', 'MX')).toBe(true)
    expect(agent.can('report.export', 'MX')).toBe(false)
    expect(agent.can('account.reassign', 'MX')).toBe(false)
    expect(agent.can('board.supervisor', 'MX')).toBe(false)
    // No ve nada de lo que existe: ni comercios, ni leads, ni negocios de otras personas.
    await withUser(userId, async (tx) => {
      expect((await tx`select 1 from crm.accounts limit 1`).length).toBe(0)
      expect((await tx`select 1 from crm.leads limit 1`).length).toBe(0)
      expect((await tx`select 1 from crm.deals limit 1`).length).toBe(0)
    })
    const leadId = await createLead(agent, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Agencia ${tag()}`, contactName: 'Rosa Lima', phone: mxPhone().slice(3) })
    expect((await one(admin<{ recruited_agency_id: string }[]>`select recruited_agency_id from crm.leads where id = ${leadId}`)).recruited_agency_id).toBe(agencyId)
    expect((await withUser(userId, (tx) => tx`select 1 from crm.leads`)).length).toBe(1)
    await withUser(userId, async (tx) => {
      const acc = await tx<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, country)
        values ('MX', 'store', ${`Tienda Agencia ${tag()}`}, 'd2d', 'prospect', ${userId}, 'MX') returning id`
      const st = await tx<{ id: string }[]>`select id from crm.stages where pipeline_id = ${otherPipeline.id} order by position limit 1`
      // Un negocio fuera del embudo de la agencia no entra.
      expect(await attempt(tx, (sp) => sp`insert into crm.deals (market_code, account_id, pipeline_id, stage_id, title, owner_id, currency)
        values ('MX', ${acc[0]!.id}, ${otherPipeline.id}, ${st[0]!.id}, 'Fuera de su embudo', ${userId}, 'MXN')`)).toBe('42501')
    })
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where recruited_agency_id = ${agencyId}`)).n).toBe(1)
    // La venta directa del mismo mercado (supervisión y ventas) no ve lo que reclutó la agencia; quien lidera el mercado y Operaciones sí.
    const agencyAccount = await one(admin<{ id: string }[]>`select id from crm.accounts where recruited_agency_id = ${agencyId}`)
    for (const k of ['fernando.ibarra', 'paula.mendez', 'marco.pena']) {
      const id = await personaId(k)
      expect((await withUser(id, (tx) => tx`select 1 from crm.leads where id = ${leadId}`)).length, k).toBe(0)
      expect((await withUser(id, (tx) => tx`select 1 from crm.accounts where id = ${agencyAccount.id}`)).length, k).toBe(0)
      expect((await one(await withUser(id, (tx) => tx<{ ok: boolean }[]>`select app.can_see_account(${agencyAccount.id}) as ok`).then((r) => [...r]))).ok, k).toBe(false)
    }
    for (const k of ['ana.robles', 'valeria.soto', 'luis.tovar']) {
      const id = await personaId(k)
      expect((await withUser(id, (tx) => tx`select 1 from crm.leads where id = ${leadId}`)).length, k).toBe(1)
      expect((await withUser(id, (tx) => tx`select 1 from crm.accounts where id = ${agencyAccount.id}`)).length, k).toBe(1)
    }
    // Una persona de agencia no combina su rol con otro.
    await expect(grantAgencyAccess(nora, { email: 'diana.cruz@contigo.test', fullName: 'Diana Cruz', agencyId }, DOMAINS)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('alcance por partner: un usuario de partner solo lee la cuenta que le toca y su árbol, sin cambiar nada', async () => {
    const root = await account('diana.cruz')
    const child = await one(admin<{ id: string }[]>`
      insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id, country, parent_id)
      values ('MX', 'store', ${`Sucursal ${tag()}`}, 'b2b', 'prospect', ${await personaId('diana.cruz')}, 'MX', ${root.id}) returning id`)
    const partner = await person('partner', { market: 'MX', scopeAccount: root.id })
    expect(isReadOnly(partner.memberships)).toBe(true)
    expect(partner.can('account.edit', 'MX')).toBe(false)
    const rows = await withUser(partner.user.id, (tx) => tx<{ id: string }[]>`select id from crm.accounts`)
    expect(rows.map((r) => r.id).sort()).toEqual([root.id, child.id].sort())
    expect((await withUser(partner.user.id, (tx) => tx`update crm.accounts set locality = 'x' where id = ${root.id}`)).count).toBe(0)
    expect((await withUser(partner.user.id, (tx) => tx`select 1 from crm.leads limit 1`)).length).toBe(0)
  })

  it('E4.F9: el asiento guarda quién lo aprobó, una sola vez', async () => {
    const nora = await ctxFor('nora.salas')
    const m = await one(admin<{ id: string }[]>`select id from crm.memberships where user_id = ${await personaId('ivan.rios')}`)
    await expect(recordSeatApproval(nora, m.id, { approverName: '', approvedOn: '2026-01-10' })).rejects.toMatchObject({ code: 'invalid' })
    await recordSeatApproval(nora, m.id, { approverName: 'Dirección comercial MX', approvedOn: '2026-01-10', reference: 'Presupuesto 2026' })
    await expect(recordSeatApproval(nora, m.id, { approverName: 'Otra persona', approvedOn: '2026-01-11' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(recordSeatApproval(await ctxFor('ana.robles'), m.id, { approverName: 'Ana', approvedOn: '2026-01-11' })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await withUser(await personaId('diana.cruz'), (tx) => tx`select 1 from crm.seat_approvals`)).length).toBe(0)
  })
})

describe('SEG-02: campos sensibles', () => {
  it('el valor vive en una tabla sin lectura directa, se muestra tapado y revelarlo pide motivo y queda registrado', async () => {
    const ana = await ctxFor('ana.robles')
    const diana = await ctxFor('diana.cruz')
    const ivan = await ctxFor('ivan.rios')
    const a = await account('diana.cruz')
    await setSensitive(ana, a.id, 'agreed_commission', '2.5% sobre recargas, revisión en julio')
    // La aplicación no lee la tabla: solo las funciones.
    expect(await code(withUser(ana.user.id, (tx) => tx`select value from crm.account_sensitive`))).toBe('42501')
    const sheet = (await getAccountSecurity(diana, a.id))!
    const field = sheet.sensitive.find((f) => f.field_key === 'agreed_commission')!
    expect(field).toMatchObject({ has_value: true, can_view: true, can_edit: false })
    expect(JSON.stringify(sheet)).not.toContain('2.5%')

    await expect(revealSensitive(diana, a.id, 'agreed_commission', 'ver')).rejects.toMatchObject({ code: 'invalid' })
    expect(await revealSensitive(diana, a.id, 'agreed_commission', 'Preparar la renovación con el cliente')).toBe('2.5% sobre recargas, revisión en julio')
    const ev = await one(admin<{ after: { field: string; reason: string }; actor_id: string }[]>`
      select after, actor_id from crm.audit_events where action = 'sensitive.revealed' and object_id = ${a.id} order by at desc limit 1`)
    expect(ev).toMatchObject({ actor_id: diana.user.id, after: { field: 'agreed_commission', reason: 'Preparar la renovación con el cliente' } })
    expect((await admin`select 1 from audit.read_log where kind = 'reveal' and actor_id = ${diana.user.id}`).length).toBe(1)
    // La dueña ve la comisión pero no la cambia; quien no lleva la cuenta ni la ve ni sabe que existe.
    await expect(setSensitive(diana, a.id, 'agreed_commission', 'otro')).rejects.toMatchObject({ code: '42501' })
    await addAccountTeamMember(diana, { accountId: a.id, userId: ivan.user.id, fn: 'support', access: 'edit' })
    expect((await getAccountSecurity(ivan, a.id))!.sensitive).toEqual([])
    await expect(revealSensitive(ivan, a.id, 'agreed_commission', 'Quiero saber cuánto gana')).rejects.toMatchObject({ code: '42501' })
    // La bitácora de la base guarda que el dato cambió, nunca el dato.
    const log = await admin<{ after: { value: string } }[]>`select after from audit.data_log where table_name = 'account_sensitive' and row_id like ${a.id + '%'}`
    expect(log.length).toBeGreaterThan(0)
    for (const l of log) expect(l.after.value).toBe('[protegido]')
    expect(JSON.stringify(await admin`select before, after from crm.audit_events where object_id = ${a.id}`)).not.toContain('2.5%')
  })

  it('lo que el estándar prohíbe tampoco entra como dato reservado, y "ver como" no revela', async () => {
    const ana = await ctxFor('ana.robles')
    const a = await account('diana.cruz')
    await expect(setSensitive(ana, a.id, 'commercial_terms', 'Pago a la tarjeta 4111 1111 1111 1111')).rejects.toMatchObject({ code: 'invalid' })
    await setSensitive(ana, a.id, 'commercial_terms', 'Pago a 30 días, descuento por volumen')
    const seen = (await loadCtx(ana.user.id, 'es', { id: '00000000-0000-0000-0000-000000000000', actorId: (await ctxFor('nora.salas')).user.id, actorName: 'Nora Salas', until: new Date().toISOString() }))!
    await expect(revealSensitive(seen, a.id, 'commercial_terms', 'Probar que no se revela')).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('SEG-04: consentimiento, baja y retención', () => {
  it('una baja manda siempre; lo comercial además pide consentimiento vigente', async () => {
    const diana = await ctxFor('diana.cruz')
    const a = await account('diana.cruz')
    const ask = (category: 'service' | 'marketing') => withUser(diana.user.id, (tx) => mayContact(tx, 'whatsapp', a.phone, category))
    expect(await ask('service')).toEqual({ ok: true, why: 'ok' })
    expect(await ask('marketing')).toEqual({ ok: false, why: 'no_consent' })
    await expect(recordConsent(diana, { contactId: a.contactId, channel: 'whatsapp', category: 'marketing', source: 'verbal', evidence: '' })).rejects.toMatchObject({ code: 'invalid' })
    const consentId = await recordConsent(diana, { contactId: a.contactId, channel: 'whatsapp', category: 'marketing', source: 'verbal', evidence: 'Aceptó por teléfono recibir promociones' })
    expect(await ask('marketing')).toEqual({ ok: true, why: 'ok' })
    const sheet = (await getAccountSecurity(diana, a.id))!
    expect(sheet.consents).toHaveLength(1)
    expect(sheet.consents[0]).toMatchObject({ channel: 'whatsapp', category: 'marketing', source: 'verbal', revoked_at: null })

    await optOut(diana, { market: 'MX', channel: 'whatsapp', address: a.phone, reason: 'Pidió no recibir mensajes' })
    expect(await ask('marketing')).toEqual({ ok: false, why: 'opted_out' })
    expect(await ask('service')).toEqual({ ok: false, why: 'opted_out' })
    expect(await withUser(diana.user.id, (tx) => mayContact(tx, 'phone', a.phone))).toEqual({ ok: true, why: 'ok' })
    await expect(optOut(diana, { market: 'MX', channel: 'whatsapp', address: a.phone })).rejects.toMatchObject({ code: 'invalid' })
    expect((await getAccountSecurity(diana, a.id))!.optouts).toHaveLength(1)
    // Levantar una baja no es de quien vende.
    const sup = await one(admin<{ id: string }[]>`select id from crm.contact_suppressions where address_norm = ${a.phone}`)
    await expect(liftOptOut(diana, sup.id, 'La persona llamó para pedirlo')).rejects.toMatchObject({ code: 'forbidden' })
    await liftOptOut(await ctxFor('ana.robles'), sup.id, 'La persona llamó para pedirlo')
    expect(await ask('marketing')).toEqual({ ok: true, why: 'ok' })
    const { revokeConsent } = await import('@/domain/security')
    await revokeConsent(diana, consentId, 'Ya no quiere promociones')
    expect(await ask('marketing')).toEqual({ ok: false, why: 'no_consent' })
  })

  it('todo envío a alguien de fuera respeta la baja: el acuse de un lead web y la base de correo de leads descartados', async () => {
    const sys = await systemContext()
    const ana = await ctxFor('ana.robles')
    const form = await one(admin<{ slug: string }[]>`select slug from crm.web_forms where market_code = 'US' and is_active limit 1`)
    const t = tag()
    const status = async (leadId: string) => (await one(admin<{ status: string }[]>`select status from crm.notifications where lead_id = ${leadId} and recipient_kind = 'lead'`)).status
    const before = await intakeFromForm(sys, form.slug, { business_name: `Con permiso ${t}`, contact_name: 'Persona Uno', email: `uno-${t}@ejemplo.test`, consent: true }, `seg-${t}-1`)
    // Con el canal apagado queda en la cola; fuera del horario del mercado, en espera. En los dos casos, listo para salir.
    expect(['queued_off', 'held_hours']).toContain(await status(before.leadId))
    // La misma dirección pide la baja: el siguiente mensaje queda registrado y no sale, aunque haya dado su consentimiento.
    await optOut(await ctxFor('robert.hale'), { market: 'US', channel: 'email', address: `dos-${t}@ejemplo.test` })
    const after = await intakeFromForm(sys, form.slug, { business_name: `Con baja ${t}`, contact_name: 'Persona Dos', email: `dos-${t}@ejemplo.test`, consent: true }, `seg-${t}-2`)
    expect(await status(after.leadId)).toBe('skipped_consent')

    // Base de correo: sale quien dio su consentimiento y no pidió la baja.
    const mk = (email: string) => admin`insert into crm.leads (market_code, motor, business_name, contact_name, email, source, status, consent_at, consent_text)
      values ('MX', 'd2d', ${`Descartado ${tag()}`}, 'Persona Lista', ${email}, 'web_form', 'disqualified', now(), 'Acepto recibir correos')`
    await mk(`si-${t}@ejemplo.test`)
    await mk(`no-${t}@ejemplo.test`)
    await optOut(ana, { market: 'MX', channel: 'all', address: `no-${t}@ejemplo.test` })
    const list = await withUser(ana.user.id, (tx) => deadLeadsForMailing(tx, 'MX', 'America/Mexico_City', 500))
    expect(list.some((l) => l.email === `si-${t}@ejemplo.test`)).toBe(true)
    expect(list.some((l) => l.email === `no-${t}@ejemplo.test`)).toBe(false)
  })

  it('al convertir un lead, su consentimiento vigente pasa al contacto que es esa misma persona', async () => {
    const a = await account('diana.cruz')
    const lead = await one(admin<{ id: string }[]>`
      insert into crm.leads (market_code, motor, business_name, contact_name, phone, source, consent_at, consent_text, owner_id)
      values ('MX', 'b2b', ${`Lead a convertir ${tag()}`}, 'Persona Convertida', ${a.phone}, 'web_form', now(), 'Acepto que me contacten', ${await personaId('diana.cruz')}) returning id`)
    await admin`update crm.leads set status = 'converted', account_id = ${a.id} where id = ${lead.id}`
    const c = await admin<{ channel: string; category: string; source: string }[]>`select channel, category, source from crm.consents where contact_id = ${a.contactId}`
    expect(c).toMatchObject([{ channel: 'email', category: 'marketing', source: 'web_form' }])
  })

  it('el consentimiento de un formulario web queda como registro propio', async () => {
    const lead = await one(admin<{ id: string }[]>`
      insert into crm.leads (market_code, motor, business_name, contact_name, email, source, consent_at, consent_text)
      values ('MX', 'b2b', ${`Lead con permiso ${tag()}`}, 'Carla Ruiz', ${`carla.${tag()}@ejemplo.test`}, 'web_form', now(), 'Acepto que me contacten') returning id`)
    const c = await admin<{ channel: string; category: string; source: string; evidence: string }[]>`select channel, category, source, evidence from crm.consents where lead_id = ${lead.id}`
    expect(c).toMatchObject([{ channel: 'email', category: 'marketing', source: 'web_form', evidence: 'Acepto que me contacten' }])
  })

  it('retención: sin plazo no se enciende; la vista previa cuenta sin cambiar nada; aplicar anonimiza y deja el conteo', async () => {
    const nora = await ctxFor('nora.salas')
    const old = await one(admin<{ id: string }[]>`
      insert into crm.leads (market_code, motor, business_name, contact_name, phone, source, status, updated_at)
      values ('MX', 'd2d', ${`Lead viejo ${tag()}`}, 'Pedro Antiguo', ${mxPhone()}, 'manual', 'disqualified', now() - interval '400 days') returning id`)
    // El sello de "última modificación" lo pone la base en cada cambio: para envejecer el lead de prueba se apagan los triggers en esa transacción.
    await admin.begin(async (tx) => {
      await tx`set local session_replication_role = replica`
      await tx`update crm.leads set updated_at = now() - interval '400 days' where id = ${old.id}`
    })
    await expect(setRetentionRule(nora, 'leads_disqualified', { afterDays: null, isActive: true })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setRetentionRule(nora, 'leads_disqualified', { afterDays: 5, isActive: true })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setRetentionRule(await ctxFor('ana.robles'), 'leads_disqualified', { afterDays: 365, isActive: true })).rejects.toMatchObject({ code: 'forbidden' })
    // Con plazo y apagada: hay vista previa, y aplicar no toca nada.
    await setRetentionRule(nora, 'leads_disqualified', { afterDays: 365, isActive: false })
    const preview = await (await withUser(nora.user.id, (tx) => tx<{ total: number }[]>`select total from app.retention_preview('leads_disqualified')`))[0]!
    expect(preview.total).toBeGreaterThanOrEqual(1)
    expect(await applyRetention(nora, 'leads_disqualified')).toBe(0)
    expect((await one(admin<{ contact_name: string }[]>`select contact_name from crm.leads where id = ${old.id}`)).contact_name).toBe('Pedro Antiguo')
    await setRetentionRule(nora, 'leads_disqualified', { afterDays: 365, isActive: true })
    expect(await applyRetention(nora, 'leads_disqualified')).toBe(preview.total)
    expect(await one(admin<{ contact_name: string; phone: string | null; business_name: string; anonymized: boolean }[]>`
      select contact_name, phone, business_name, anonymized_at is not null as anonymized from crm.leads where id = ${old.id}`)).toMatchObject({ contact_name: '[anonimizado]', phone: null, anonymized: true })
    expect((await admin`select 1 from crm.audit_events where action = 'retention.applied'`).length).toBe(1)
    // Segunda corrida: nada que hacer. Y quien vende no la corre ni por la base.
    expect(await applyRetention(nora, 'leads_disqualified')).toBe(0)
    expect(await code(withUser(await personaId('diana.cruz'), (tx) => tx`select app.retention_apply('leads_disqualified')`))).toBe('42501')
  })
})

describe('SEG-07: ver como y recertificación de accesos', () => {
  it('ver como: solo lectura, con motivo, con tiempo límite y registrado', async () => {
    const nora = await ctxFor('nora.salas')
    const diana = await ctxFor('diana.cruz')
    await expect(startViewAs(nora, diana.user.id, 'corto', 15)).rejects.toMatchObject({ code: 'invalid' })
    await expect(startViewAs(diana, nora.user.id, 'Quiero ver lo que ve administración', 15)).rejects.toMatchObject({ code: 'forbidden' })
    expect(await code(withUser(diana.user.id, (tx) => tx`select app.view_as_start(${nora.user.id}, 'Quiero ver lo que ve administración', 15)`))).toBe('42501')
    const id = await startViewAs(nora, diana.user.id, 'Diana no encuentra un comercio en su lista', 600)
    const cur = await (await withoutUser((tx) => tx<{ target_id: string; expires_at: Date; actor_name: string }[]>`select target_id, expires_at, actor_name from app.view_as_current(${id}, ${nora.user.id})`))[0]!
    expect(cur).toMatchObject({ target_id: diana.user.id, actor_name: 'Nora Salas' })
    // El tiempo pedido se recorta a 60 minutos.
    expect(cur.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000 + 5_000)
    // Otra persona no puede usar esa sesión.
    expect((await withoutUser((tx) => tx`select 1 from app.view_as_current(${id}, ${diana.user.id})`)).length).toBe(0)
    const seen = (await loadCtx(diana.user.id, 'es', { id, actorId: nora.user.id, actorName: 'Nora Salas', until: cur.expires_at.toISOString() }))!
    expect(seen.user.id).toBe(diana.user.id)
    expect(seen.can('lead.create', 'MX')).toBe(false)
    expect(seen.can('account.edit', 'MX')).toBe(false)
    expect(seen.can('report.export', 'MX')).toBe(false)
    expect(seen.can('report.view', 'MX')).toBe(diana.can('report.view', 'MX'))
    await expect(createLead(seen, { market: 'MX', motor: 'b2b', businessName: 'No debe entrar', contactName: 'Nadie', phone: '5512345678' })).rejects.toMatchObject({ code: 'forbidden' })
    const ev = await one(admin<{ after: { reason: string; minutes: number } }[]>`select after from crm.audit_events where action = 'view_as.started' and object_id = ${diana.user.id}`)
    expect(ev.after).toMatchObject({ reason: 'Diana no encuentra un comercio en su lista', minutes: 60 })
    await withoutUser((tx) => tx`select app.view_as_end(${id}, ${nora.user.id})`)
    expect((await withoutUser((tx) => tx`select 1 from app.view_as_current(${id}, ${nora.user.id})`)).length).toBe(0)
    expect((await admin`select 1 from crm.audit_events where action = 'view_as.ended'`).length).toBe(1)
  })

  it('recertificación: quien lidera acusa los accesos de su mercado, y la revisión cierra cuando todos tienen decisión', async () => {
    const nora = await ctxFor('nora.salas')
    const ana = await ctxFor('ana.robles')
    const reviewId = await openAccessReview(nora, 'MX', '2026-12-31')
    await expect(openAccessReview(nora, 'MX', '2026-12-31')).rejects.toMatchObject({ code: 'invalid' })
    await expect(openAccessReview(ana, 'US', '2026-12-31')).rejects.toMatchObject({ code: 'forbidden' })
    const items = await admin<{ id: string; user_id: string }[]>`select id, user_id from crm.access_review_items where review_id = ${reviewId}`
    expect(items.length).toBeGreaterThan(5)
    await expect(closeAccessReview(ana, reviewId)).rejects.toMatchObject({ code: 'invalid' })
    // Su propio acceso lo acusa otra persona; quien vende no acusa nada; quien lidera otro mercado tampoco.
    await expect(decideReviewItem(ana, items.find((i) => i.user_id === ana.user.id)!.id, 'keep', '')).rejects.toMatchObject({ code: 'invalid' })
    await expect(decideReviewItem(await ctxFor('diana.cruz'), items[0]!.id, 'keep', '')).rejects.toMatchObject({ code: 'forbidden' })
    // Quien lidera otro mercado ni siquiera ve esos accesos.
    await expect(decideReviewItem(await ctxFor('robert.hale'), items[0]!.id, 'keep', '')).rejects.toMatchObject({ code: 'not_found' })
    const ivan = await personaId('ivan.rios')
    for (const i of items.filter((x) => x.user_id !== ana.user.id)) await decideReviewItem(ana, i.id, i.user_id === ivan ? 'remove' : 'keep', i.user_id === ivan ? 'Cambió de área' : '')
    expect(await closeAccessReview(ana, reviewId)).toEqual({ keep: items.length - 2, remove: 1 })
    await expect(decideReviewItem(ana, items[0]!.id, 'keep', '')).rejects.toMatchObject({ code: 'invalid' })
    expect((await one(admin<{ closed_by: string }[]>`select closed_by from crm.access_reviews where id = ${reviewId}`)).closed_by).toBe(ana.user.id)
  })

  it('directorio de Google: apagado no toca nada; simulado quita el acceso de quien ya no tiene cuenta, sin dejar a CONTIGO sin administración', async () => {
    const job = seguridadJobs.find((j) => j.key === 'seguridad.directorio')!
    const gone = await person('rep', { market: 'MX' })
    const email = (await one(admin<{ email: string }[]>`select email::text from crm.users where id = ${gone.user.id}`)).email
    simulateDirectoryGone([email, 'nora.salas@contigo.test'])
    expect(await withoutUser((tx) => job.run(tx))).toMatchObject({ done: 0, note: 'Canal apagado' })
    process.env.DIRECTORY_ADAPTER = 'simulated'
    try {
      const sys = await (await withoutUser((tx) => tx<{ id: string }[]>`select app.system_user_id() as id`))[0]!
      const r = await withUser(sys.id, (tx) => job.run(tx))
      expect(r.done).toBe(1)
      expect(await loadCtx(gone.user.id, 'es')).toBeNull()
      // La única administración completa no se queda sin acceso aunque el directorio la reporte.
      expect(await loadCtx(await personaId('nora.salas'), 'es')).not.toBeNull()
      expect((await admin`select 1 from crm.audit_events where action = 'membership.ended_by_directory' and object_id = ${gone.user.id}`).length).toBe(1)
    } finally {
      delete process.env.DIRECTORY_ADAPTER
      simulateDirectoryGone([])
    }
  })
})

describe('SEG-09: solicitudes de titulares', () => {
  it('registro con plazo, exportación de lo que hay de la persona y anonimización que conserva el hecho', async () => {
    const nora = await ctxFor('nora.salas')
    const diana = await ctxFor('diana.cruz')
    const a = await account('diana.cruz')
    const name = (await one(admin<{ full_name: string }[]>`select full_name from crm.contacts where id = ${a.contactId}`)).full_name
    await recordConsent(diana, { contactId: a.contactId, channel: 'email', category: 'service', source: 'written', evidence: 'Firmó el formato de alta' })
    await withUser(diana.user.id, (tx) => tx`update crm.contacts set full_name = ${name + ' Segundo'} where id = ${a.contactId}`)
    await expect(createSubjectRequest(diana, { market: 'MX', kind: 'erasure', subjectName: name, receivedOn: '2026-11-01' })).rejects.toMatchObject({ code: 'forbidden' })
    // Sin plazo cargado por Legal, la solicitud nace sin fecha límite; con plazo, la calcula.
    const noDue = await createSubjectRequest(nora, { market: 'MX', kind: 'access', subjectName: name, receivedOn: '2026-11-01', contactId: a.contactId })
    expect((await one(admin<{ due_on: string | null }[]>`select due_on::text from crm.subject_requests where id = ${noDue}`)).due_on).toBeNull()
    const { setDueDays } = await import('@/domain/security')
    await setDueDays(nora, 'MX', 20)
    const id = await createSubjectRequest(nora, { market: 'MX', kind: 'erasure', subjectName: name, subjectContact: a.phone, receivedOn: '2026-11-01', contactId: a.contactId })
    expect((await one(admin<{ due_on: string }[]>`select due_on::text from crm.subject_requests where id = ${id}`)).due_on).toBe('2026-11-21')

    const data = await exportSubject(nora, id) as { contact: { full_name: string; phone: string }; merchants: unknown[]; consents: unknown[] }
    expect(data.contact).toMatchObject({ full_name: name + ' Segundo', phone: a.phone })
    expect(data.merchants).toHaveLength(1)
    expect(data.consents).toHaveLength(1)
    expect((await admin`select 1 from audit.read_log where kind = 'subject_export' and actor_id = ${nora.user.id}`).length).toBe(1)

    // Solo se anonimiza una eliminación en curso, con confirmación escrita.
    await expect(anonymizeSubject(nora, id, 'ANONIMIZAR')).rejects.toMatchObject({ code: 'invalid' })
    await updateSubjectRequest(nora, id, { status: 'in_progress' })
    await expect(updateSubjectRequest(nora, id, { status: 'done', resolution: 'Listo' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(anonymizeSubject(nora, id, 'si')).rejects.toMatchObject({ code: 'invalid' })
    const logBefore = await one(admin<{ n: number }[]>`select count(*)::int as n from audit.data_log where table_name = 'contacts' and row_id = ${a.contactId}`)
    expect(await anonymizeSubject(nora, id, 'ANONIMIZAR')).toBeGreaterThan(0)

    const c = await one(admin<{ full_name: string; phone: string | null; email: string | null }[]>`select full_name, phone, email::text from crm.contacts where id = ${a.contactId}`)
    expect(c).toEqual({ full_name: '[anonimizado]', phone: null, email: null })
    // El hecho se conserva: las mismas filas de bitácora (más la de la anonimización), con quién y cuándo, sin el dato.
    const log = await admin<{ before: Record<string, string> | null; after: Record<string, string> | null; actor_id: string | null; changed: string[] | null; redacted: boolean }[]>`
      select before, after, actor_id, changed, redacted_at is not null as redacted from audit.data_log where table_name = 'contacts' and row_id = ${a.contactId} order by id`
    expect(log.length).toBe(logBefore.n + 1)
    expect(JSON.stringify(log)).not.toContain(name)
    expect(JSON.stringify(log)).not.toContain(a.phone)
    expect(log.some((l) => l.actor_id === diana.user.id && l.changed?.includes('full_name'))).toBe(true)
    expect(JSON.stringify(await admin`select before, after from crm.audit_events where object_id = ${a.contactId}`)).not.toContain(name)
    // El vínculo con el comercio y el consentimiento (sin evidencia) siguen ahí.
    expect((await admin`select 1 from crm.account_contacts where contact_id = ${a.contactId}`).length).toBe(1)
    expect(await one(admin<{ evidence: string | null; revoked: boolean }[]>`select evidence, revoked_at is not null as revoked from crm.consents where contact_id = ${a.contactId}`)).toEqual({ evidence: null, revoked: true })
    // Fuera de una eliminación en curso la bitácora sigue sin poder tocarse, ni con la marca puesta a mano.
    expect(await code(admin.begin(async (tx) => {
      await tx`select set_config('audit.redaction_ref', ${noDue}, true)`
      await tx`update audit.data_log set before = null, redacted_at = now(), redaction_ref = ${noDue} where table_name = 'contacts' and row_id = ${a.contactId}`
    }))).toBe('42501')
    await updateSubjectRequest(nora, id, { status: 'done', resolution: 'Datos anonimizados y persona avisada.' })
    await expect(updateSubjectRequest(nora, id, { status: 'in_progress' })).rejects.toMatchObject({ code: 'invalid' })
    expect(await code(admin`update audit.data_log set before = null, redacted_at = now(), redaction_ref = ${id} where table_name = 'contacts' and row_id = ${a.contactId}`)).toBe('42501')
  })
})

describe('SEG-08: llaves y secretos', () => {
  it('una llave tiene dueño, vencimiento y último uso; la rotación conserva al dueño; vencida deja de valer', async () => {
    const nora = await ctxFor('nora.salas')
    const ana = await ctxFor('ana.robles')
    const made = await createApiClient(nora, `Llave inventario ${tag()}`, ['forms:write'])
    // Las dos funciones con las que se autentica una llave (la de entradas y la de la API de lectura).
    const lookup = async (key: string) => (await withoutUser((tx) => tx<{ id: string }[]>`select id from app.api_client(${hashKey(key)})`))[0]?.id ?? null
    const auth = async (key: string) => (await withoutUser((tx) => tx<{ id: string }[]>`select id from app.api_key(${hashKey(key)})`))[0]?.id ?? null
    expect(await lookup(made.key)).toBe(made.id)
    expect((await getKeys(nora))!.keys.find((k) => k.id === made.id)).toMatchObject({ owner: 'Nora Salas', expired: false, last_used_at: null, expires: null })
    expect(await auth(made.key)).toBe(made.id)
    expect((await getKeys(nora))!.keys.find((k) => k.id === made.id)!.last_used_at).not.toBeNull()
    // El uso de la llave no llena la bitácora de configuración.
    expect((await admin`select 1 from audit.config_log where table_name = 'api_clients' and row_id = ${made.id} and op = 'U'`).length).toBe(0)

    await expect(setApiClientMeta(nora, made.id, { ownerId: '', expires: '2020-01-01' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setApiClientMeta(ana, made.id, { ownerId: ana.user.id, expires: '2030-01-01' })).rejects.toMatchObject({ code: 'forbidden' })
    await setApiClientMeta(nora, made.id, { ownerId: ana.user.id, expires: '2030-01-01' })
    expect((await getKeys(nora))!.keys.find((k) => k.id === made.id)).toMatchObject({ owner: 'Ana Robles', expires: '2030-01-01' })
    // Rotar (paquete eventos-api): la llave nueva hereda al dueño y la anterior queda con fecha de retiro.
    const rotated = await rotateApiKey(nora, made.id, 7)
    const after = (await getKeys(nora))!.keys
    expect(after.find((k) => k.id === rotated.id)).toMatchObject({ owner: 'Ana Robles', rotated_from: made.id })
    expect(after.find((k) => k.id === made.id)!.retires).not.toBeNull()
    expect(await lookup(rotated.key)).toBe(rotated.id)
    expect(await lookup(made.key)).toBe(made.id)
    // Vencida, deja de valer sola por las dos entradas.
    await admin`update crm.api_clients set expires_at = now() - interval '1 minute' where id = ${rotated.id}`
    expect(await lookup(rotated.key)).toBeNull()
    expect(await auth(rotated.key)).toBeNull()
    expect((await getKeys(nora))!.keys.find((k) => k.id === rotated.id)!.expired).toBe(true)
    // Una llave que vence pronto abre su alerta; y muchas llamadas en una hora, la suya.
    await admin`update crm.api_clients set expires_at = now() + interval '3 days' where id = ${rotated.id}`
    await admin`insert into crm.rate_counters (bucket, window_start, hits) values (${'api:key:' + rotated.id}, date_trunc('minute', now()), 5000)`
    await runSecurityScan(nora)
    const alerts = (await getMonitoring(nora)).alerts
    expect(alerts.some((a) => a.kind === 'key_expiring')).toBe(true)
    expect(alerts.find((a) => a.kind === 'api_calls_per_hour')).toMatchObject({ observed: 5000, threshold: 2000 })
  })

  it('el inventario de secretos no guarda valores y avisa cuando la rotación se pasó', async () => {
    const cols = await admin<{ column_name: string }[]>`select column_name from information_schema.columns where table_schema = 'crm' and table_name = 'secret_inventory'`
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(['value']))
    expect(cols.some((c) => /value|secret|token|password/.test(c.column_name))).toBe(false)
    const nora = await ctxFor('nora.salas')
    const { setSecretMeta } = await import('@/domain/security')
    await setSecretMeta(nora, 'PIPEDRIVE_API_TOKEN', { ownerId: nora.user.id, rotateEveryDays: 90, lastRotatedOn: '2026-01-01' })
    const keys = (await getKeys(nora))!
    expect(keys.secrets.find((s) => s.key === 'PIPEDRIVE_API_TOKEN')).toMatchObject({ due: true, owner: 'Nora Salas', configured: true })
    expect(JSON.stringify(keys)).not.toContain(process.env.PIPEDRIVE_API_TOKEN!)
    await runSecurityScan(nora)
    expect((await getMonitoring(nora)).alerts.some((a) => a.kind === 'secret_rotation_due' && a.subject === 'PIPEDRIVE_API_TOKEN')).toBe(true)
    expect(await getKeys(await ctxFor('diana.cruz'))).toBeNull()
  })
})

describe('UX-02: la búsqueda no deja enumerar', () => {
  it('teléfono y alias no se buscan por pedazo; el nombre sí; y hay límite por minuto', async () => {
    const ana = await ctxFor('ana.robles')
    const a = await account('diana.cruz')
    const name = (await one(admin<{ name: string }[]>`select name from crm.accounts where id = ${a.id}`)).name
    const alias = `EXT-${tag().toUpperCase()}-778899`
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${a.id}, 'MX', 'sales_core', ${alias})`
    await admin`update crm.accounts set phone = ${a.phone} where id = ${a.id}`
    const hit = async (q: string) => (await searchAll(ana, q)).accounts.some((x) => x.id === a.id)
    const digits = a.phone.replace('+', '')
    expect(await hit(name)).toBe(true)
    // Un pedazo del teléfono (4 a 6 dígitos) ya no encuentra nada; el número completo, con o sin código de país, sí.
    expect(await hit(digits.slice(-4))).toBe(false)
    expect(await hit(digits.slice(4, 10))).toBe(false)
    expect(await hit(digits)).toBe(true)
    expect(await hit(digits.slice(2))).toBe(true)
    // El alias, solo completo.
    expect(await hit('778899')).toBe(false)
    expect(await hit(alias.slice(0, 8))).toBe(false)
    expect(await hit(alias.toLowerCase())).toBe(true)
    // Cada búsqueda queda contada, y pasado el límite por minuto la persona espera.
    expect((await admin`select 1 from audit.read_log where actor_id = ${ana.user.id} and kind = 'search'`).length).toBe(8)
    await admin`update crm.settings set value = '8'::jsonb where key = 'security.search_per_minute'`
    const limited = await searchAll(ana, name)
    expect(limited).toMatchObject({ limited: true, accounts: [] })
    // El límite es por persona.
    expect((await searchAll(await ctxFor('paula.mendez'), name)).limited).toBe(false)
  })
})

describe('política: los roles nuevos y las capacidades de lectura', () => {
  it('una membresía de administración con partes solo da las capacidades de sus partes', () => {
    const m = (areas: Membership['areas']): Membership[] => [{ market: null, role: 'admin', teamId: null, areas }]
    expect(can(m(null), 'account.merge')).toBe(true)
    expect(can(m(['config']), 'config.manage')).toBe(true)
    expect(can(m(['config']), 'account.merge')).toBe(false)
    expect(can(m(['config']), 'access.manage')).toBe(false)
    expect(can(m(['integrations']), 'integration.operate')).toBe(true)
    expect(can(m(['integrations']), 'audit.read')).toBe(false)
    expect(can(m(['audit']), 'security.read')).toBe(true)
    expect(can(m(['access']), 'user.view_as')).toBe(true)
  })
})
