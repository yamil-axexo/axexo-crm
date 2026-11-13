import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { loadCtx, type Ctx } from '@/server/context'
import { withUser } from '@/server/db'
import { createTeam, endMembership, grantAccess, grantMembership, keepTurn, recordSimulation, revokeApiClient, setMembershipExpiry, setRoutingMembers, updateStage } from '@/domain/admin'
import { createApiKey } from '@/domain/api-keys'
import { getAudit, getConfig, getDataQuality, getIntake, getStatus, getUsers, AUDIT_PAGE } from '@/dal/admin'
import { CONSENT_TEXT, assignLead, convertLead, createLead, disqualifyLead, intakeFromForm, markContacted, qualifyLead, takeLead } from '@/domain/leads'
import { getLead, listLeads } from '@/dal/leads'
import { createDeal, missingForStage, moveDeal, updateDeal } from '@/domain/deals'
import { addContact, createAccount, mergeAccounts, reassignAccounts, setParent, updateAccount } from '@/domain/accounts'
import { addActivity } from '@/domain/activities'
import { completeItem } from '@/domain/queue'
import { configurePipeline, updateCustom } from '@/domain/custom'
import { resolveException, runRulesNow } from '@/domain/rules'
import { ingestSalesAppEvent } from '@/domain/integrations'
import { cancelImport, purgeRaw, resumeImport, startImport } from '@/domain/pipedrive/import'
import { isReadOnly } from '@/domain/policy'
import { addDays, isoDay } from '@/lib/format'

// Comité del 11-nov-2026, grupo administración y leadership: cada hallazgo de este paquete queda con una prueba
// que falla sin su corrección. Las pruebas arman sus propias personas, su turno y su formulario, y dejan los
// datos sembrados como estaban: otros archivos de prueba corren sobre la misma base.
const admin = owner()
const DOMAINS = ['axexo.com', 'emida.com', 'emida.net'] as const
const tag = () => Math.random().toString(36).slice(2, 8)
const phone = () => `305 6${Math.floor(100000 + Math.random() * 899999)}`
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const todayIn = (tz: string) => isoDay(new Date(), tz)

let nora: Ctx
let luis: Ctx
let sys: Ctx
let ruleId: string
let formSlug: string
let formId: string

/** Da de alta a una persona de prueba con un rol y devuelve su id y el de su membresía. */
async function person(role: 'rep' | 'supervisor' | 'market_lead' | 'ops' | 'admin' | 'lt', market: 'US' | 'MX' | '' = 'US', extra: { expires?: string; teamId?: string; confirmAdmin?: boolean } = {}) {
  const k = tag()
  const email = `c2.${role}.${k}@contigo.test`
  const name = `C2 ${role} ${k}`
  const out = await grantAccess(nora, { email, fullName: name, role, market, ...extra }, DOMAINS)
  const m = await one(admin<{ id: string }[]>`select id from crm.memberships where user_id = ${out.userId} order by created_at desc limit 1`)
  return { id: out.userId, membershipId: m.id, name, email, result: out }
}
const setTurn = (members: string[], fallback: string | null = null, cursor = 0) =>
  admin`update crm.routing_rules set member_ids = ${members}::uuid[], fallback_id = ${fallback}, cursor = ${cursor} where id = ${ruleId}`
const webLead = async (extra: Record<string, unknown> = {}) => {
  const out = await intakeFromForm(sys, formSlug, { business_name: `C2 Tienda ${tag()}`, contact_name: 'Persona De Prueba', phone: phone(), ...extra }, `c2:${randomUUID()}`)
  return one(admin<{ id: string; owner_id: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; gclid: string | null; fbclid: string | null; consent_at: Date | null; consent_text: string | null }[]>`
    select id, owner_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, consent_at, consent_text from crm.leads where id = ${out.leadId}`)
}
const expire = (membershipId: string) => admin`update crm.memberships set valid_to = now() - interval '1 minute' where id = ${membershipId}`

beforeAll(async () => {
  nora = await ctxFor('nora.salas')
  luis = await ctxFor('luis.tovar')
  sys = await systemContext()
  const k = tag()
  formSlug = `c2-prueba-${k}`
  ruleId = (await one(admin<{ id: string }[]>`insert into crm.routing_rules (market_code, name, strategy, sla_minutes) values ('US', ${'C2 turno ' + k}, 'round_robin', 60) returning id`)).id
  formId = (await one(admin<{ id: string }[]>`insert into crm.web_forms (market_code, slug, name, motor, locale, routing_rule_id) values ('US', ${formSlug}, ${'C2 form ' + k}, 'dealer', 'en', ${ruleId}) returning id`)).id
})

afterAll(async () => {
  // El formulario y el turno de prueba se apagan y sus leads se retiran: nadie más los ve en su cola.
  await admin`update crm.leads set status = 'disqualified', disqualify_code = 'duplicate', owner_id = null where form_id = ${formId} and status in ('new','contacted','qualified')`
  await admin`update crm.web_forms set is_active = false where id = ${formId}`
  await admin`update crm.routing_rules set is_active = false, member_ids = '{}', fallback_id = null where id = ${ruleId}`
  await admin`update crm.memberships set valid_to = now() where valid_to is null and user_id in (select id from crm.users where email like 'c2.%@contigo.test')`
  await admin.end()
})

describe('quitar el acceso bien hecho', () => {
  it('reproduce el caso del comité: quien pierde el acceso sale del turno y el siguiente lead web no le llega', async () => {
    const out = await person('rep')
    const stays = await person('rep')
    await setRoutingMembers(nora, ruleId, [out.id, stays.id])
    // Antes de quitar el acceso, el turno sí le entrega leads.
    expect((await webLead()).owner_id).toBe(out.id)
    await setTurn([out.id, stays.id], null, 0)

    const res = await endMembership(nora, out.membershipId)
    expect(res.removedFrom.some((n) => n.startsWith('C2 turno'))).toBe(true)
    expect(res.leads).toBe(1) // el lead que ya tenía sigue a su nombre, y la respuesta lo dice
    const rule = await one(admin<{ member_ids: string[] }[]>`select member_ids from crm.routing_rules where id = ${ruleId}`)
    expect(rule.member_ids).toEqual([stays.id])

    // El siguiente lead web ya no le llega: le toca a quien sigue con acceso.
    for (let i = 0; i < 3; i++) expect((await webLead()).owner_id).toBe(stays.id)

    const events = await admin<{ action: string; before: Record<string, unknown>; after: Record<string, unknown> }[]>`
      select action, before, after from crm.audit_events where actor_id = ${nora.user.id} and at > now() - interval '1 minute'
         and ((action = 'membership.ended' and object_id = ${out.id}) or (action = 'routing.members_changed' and object_id = ${ruleId} and after ->> 'reason' = 'access_removed'))`
    expect(events.map((e) => e.action).sort()).toEqual(['membership.ended', 'routing.members_changed'])
    expect(events.find((e) => e.action === 'membership.ended')!.before).toMatchObject({ role: 'rep', market: 'US' })
    expect(events.find((e) => e.action === 'membership.ended')!.after).toMatchObject({ leads: 1 })
  })

  it('el ruteo nunca asigna a quien no tiene rol vigente de ventas, aunque siga apuntado en el turno', async () => {
    const lapsed = await person('rep')
    const other = await person('rep')
    await setTurn([lapsed.id, other.id])
    await expire(lapsed.membershipId) // el acceso venció por fecha: nadie corrió "quitar acceso"
    for (let i = 0; i < 4; i++) expect((await webLead()).owner_id).toBe(other.id)
    // Tampoco a un rol que no vende (operaciones) ni a un rol de ventas en otro mercado.
    const ops = await person('ops')
    const mx = await person('rep', 'MX')
    await setTurn([ops.id, mx.id, other.id])
    for (let i = 0; i < 3; i++) expect((await webLead()).owner_id).toBe(other.id)
    // La pantalla del turno la muestra marcada, para poder sacarla.
    const shown = (await getIntake(nora)).rules.find((r) => r.id === ruleId)!
    expect(shown.members.find((m) => m.id === ops.id)).toMatchObject({ active: false })
    expect(shown.members.find((m) => m.id === other.id)).toMatchObject({ active: true })
  })

  it('si en el turno no queda nadie con acceso, el lead queda sin dueño y lo ve quien vende en ese mercado', async () => {
    const lapsed = await person('rep')
    const fallback = await person('market_lead')
    await setTurn([lapsed.id], fallback.id)
    await expire(lapsed.membershipId)
    // Con respaldo vigente, el lead va al respaldo.
    expect((await webLead()).owner_id).toBe(fallback.id)
    // Sin respaldo vigente, queda sin dueño.
    await expire(fallback.membershipId)
    const lead = await webLead()
    expect(lead.owner_id).toBeNull()
    const sam = await ctxFor('sam.ortiz')
    expect((await listLeads(sam, { owner: 'none', status: 'new' })).items.some((l) => l.id === lead.id)).toBe(true)
    const marco = await ctxFor('marco.pena')
    expect((await listLeads(marco, {})).items.some((l) => l.id === lead.id)).toBe(false)
    // Y un turno vacío hace lo mismo.
    await setTurn([], null)
    expect((await webLead()).owner_id).toBeNull()
  })

  it('quien conserva otro rol de ventas en el mercado se queda en el turno; el respaldo que pierde el acceso deja de serlo', async () => {
    const two = await person('rep')
    await grantMembership(nora, { email: two.email, fullName: two.name, role: 'supervisor', market: 'US' }, DOMAINS)
    await setTurn([two.id], two.id)
    const kept = await endMembership(nora, two.membershipId)
    expect(kept.removedFrom).toEqual([])
    expect((await webLead()).owner_id).toBe(two.id)
    const sup = await one(admin<{ id: string }[]>`select id from crm.memberships where user_id = ${two.id} and role = 'supervisor' and valid_to is null`)
    const gone = await endMembership(nora, sup.id)
    expect(gone.removedFrom).toHaveLength(1)
    expect(gone.fallbackOf).toHaveLength(1)
    const rule = await one(admin<{ member_ids: string[]; fallback_id: string | null }[]>`select member_ids, fallback_id from crm.routing_rules where id = ${ruleId}`)
    expect(rule).toMatchObject({ member_ids: [], fallback_id: null })
  })

  it('la pantalla sabe, antes de quitar, qué tiene la persona a su nombre y de qué turnos sale', async () => {
    const p = await person('rep')
    await setTurn([p.id])
    const lead = await webLead()
    expect(lead.owner_id).toBe(p.id)
    const row = (await getUsers(nora)).memberships.find((m) => m.id === p.membershipId)!
    expect(row).toMatchObject({ accounts: 0, deals: 0, leads: 1, fallback_of: [] })
    expect(row.leaves_rules).toHaveLength(1)
    // Al quitarlo, el lead queda con un dueño sin acceso: Calidad de datos lo cuenta y la ficha del lead lo avisa.
    await endMembership(nora, p.membershipId)
    const orphan = (await getDataQuality(nora)).orphans.find((o) => o.owner_id === p.id)
    expect(orphan).toMatchObject({ market_code: 'US', leads: 1 })
    expect((await getLead(nora, lead.id))!.lead.owner_active).toBe(false)
    expect((await getUsers(nora, 'sin')).users.some((u) => u.id === p.id)).toBe(true)
    expect((await getUsers(nora, 'con')).users.some((u) => u.id === p.id)).toBe(false)
  })

  it('siempre queda una administración sin fecha de vencimiento', async () => {
    const noraM = await one(admin<{ id: string }[]>`select id from crm.memberships where user_id = ${nora.user.id} and role = 'admin' and valid_to is null`)
    await expect(endMembership(nora, noraM.id)).rejects.toMatchObject({ code: 'invalid' })
    // Otra administración que vence no cuenta: el día que venza, nadie podría administrar.
    const temp = await person('admin', '', { confirmAdmin: true, expires: addDays(todayIn('UTC'), 20) })
    await expect(endMembership(nora, noraM.id)).rejects.toMatchObject({ code: 'invalid' })
    await expect(setMembershipExpiry(nora, noraM.id, addDays(todayIn('UTC'), 30))).rejects.toMatchObject({ code: 'invalid' })
    await endMembership(nora, temp.membershipId)
    expect(await one(admin<{ n: number }[]>`select count(*)::int as n from crm.memberships where id = ${noraM.id} and valid_to is null`)).toMatchObject({ n: 1 })
  })

  it('guardar un turno lo deja donde iba, sin regresarlo a la primera persona', async () => {
    expect(keepTurn(['a', 'b', 'c'], 1, ['a', 'b', 'c', 'd'])).toBe(1) // seguía b y sigue b
    expect(keepTurn(['a', 'b', 'c'], 1, ['a', 'c'])).toBe(1) // seguía b, salió: sigue c
    expect(keepTurn(['a', 'b', 'c'], 2, ['a', 'b'])).toBe(0) // seguía c, salió: vuelve a a
    expect(keepTurn([], 0, ['a'])).toBe(0)
    const [a, b, c] = [await person('rep'), await person('rep'), await person('rep')]
    await setTurn([a.id, b.id], null, 1)
    await setRoutingMembers(nora, ruleId, [c.id, b.id, a.id])
    const rule = await one(admin<{ member_ids: string[]; cursor: number }[]>`select member_ids, cursor from crm.routing_rules where id = ${ruleId}`)
    expect(rule.member_ids).toEqual([a.id, b.id, c.id]) // quien entra va al final
    expect(rule.cursor).toBe(1) // sigue b
    expect((await webLead()).owner_id).toBe(b.id)
  })
})

describe('dar acceso con cuidado', () => {
  it('un acceso con fecha vale hasta el final de ese día en la hora del mercado, y luego deja de valer solo', async () => {
    const today = todayIn('America/Mexico_City')
    const p = await person('rep', 'MX', { expires: today })
    expect(p.result.expires).toBe(today)
    const m = await one(admin<{ ok: boolean }[]>`
      select (valid_to at time zone 'America/Mexico_City') = (${today}::date + 1)::timestamp as ok from crm.memberships where id = ${p.membershipId}`)
    expect(m.ok).toBe(true)
    expect(await loadCtx(p.id, 'es')).not.toBeNull() // hoy todavía entra
    expect((await getUsers(nora)).memberships.find((x) => x.id === p.membershipId)).toMatchObject({ expires: today, expires_in_days: 0 })
    // Pasa la medianoche del mercado: nadie tocó nada y el rol ya no vale, ni en la app ni en la base.
    await expire(p.membershipId)
    expect(await loadCtx(p.id, 'es')).toBeNull()
    expect(await withUser(p.id, (tx) => tx`select 1 from app.active_memberships()`)).toHaveLength(0)
    expect((await getUsers(nora)).memberships.some((x) => x.id === p.membershipId)).toBe(false)
  })

  it('un rol global con fecha termina a la medianoche UTC de ese día', async () => {
    const day = addDays(todayIn('UTC'), 3)
    const p = await person('lt', '', { expires: day })
    const m = await one(admin<{ ok: boolean }[]>`select (valid_to at time zone 'UTC') = (${day}::date + 1)::timestamp as ok from crm.memberships where id = ${p.membershipId}`)
    expect(m.ok).toBe(true)
    expect((await getStatus(nora)).admins.every((a) => a.id !== p.id)).toBe(true)
  })

  it('no acepta una fecha de vencimiento pasada ni mal escrita', async () => {
    const yesterday = addDays(todayIn('America/New_York'), -1)
    const base = { email: `c2.past.${tag()}@contigo.test`, fullName: 'C2 Fecha Pasada', role: 'rep' as const, market: 'US' }
    await expect(grantMembership(nora, { ...base, expires: yesterday }, DOMAINS)).rejects.toMatchObject({ code: 'invalid' })
    await expect(grantMembership(nora, { ...base, expires: '30/11/2026' }, DOMAINS)).rejects.toMatchObject({ code: 'invalid' })
    expect(await admin`select 1 from crm.memberships m join crm.users u on u.id = m.user_id where u.email = ${base.email}`).toHaveLength(0)
  })

  it('la fecha se pone, se mueve y se quita después, y cada cambio queda en la bitácora', async () => {
    const p = await person('rep')
    const day = addDays(todayIn('America/New_York'), 10)
    await setMembershipExpiry(nora, p.membershipId, day)
    expect((await getUsers(nora)).memberships.find((x) => x.id === p.membershipId)).toMatchObject({ expires: day, expires_in_days: 10 })
    await setMembershipExpiry(nora, p.membershipId, null)
    expect((await getUsers(nora)).memberships.find((x) => x.id === p.membershipId)).toMatchObject({ expires: null })
    const events = await admin<{ before: Record<string, unknown>; after: Record<string, unknown> }[]>`
      select before, after from crm.audit_events where action = 'membership.expiry_changed' and object_id = ${p.id} order by at, id`
    expect(events.map((e) => [e.before.expires, e.after.expires])).toEqual([[null, day], [day, null]])
    await expect(setMembershipExpiry(luis, p.membershipId, day)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('dar Administración pide una confirmación aparte, también para un externo, y queda destacado en la bitácora', async () => {
    const base = { email: `c2.adm.${tag()}@contigo.test`, fullName: 'C2 Admin Temporal', role: 'admin' as const, market: '' }
    await expect(grantMembership(nora, base, DOMAINS)).rejects.toMatchObject({ code: 'invalid' })
    await expect(grantMembership(nora, { ...base, confirmAdmin: false }, DOMAINS)).rejects.toMatchObject({ code: 'invalid' })
    const day = addDays(todayIn('UTC'), 15)
    const out = await grantAccess(nora, { ...base, confirmAdmin: true, expires: day }, DOMAINS)
    const ev = await one(admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'membership.granted' and object_id = ${out.userId}`)
    expect(ev.after).toMatchObject({ role: 'admin', expires: day })
    // Leadership ve quién administra y hasta cuándo.
    expect((await getStatus(luis)).admins.find((a) => a.id === out.userId)).toMatchObject({ expires: day })
    expect((await getStatus(luis)).admins.find((a) => a.id === nora.user.id)).toMatchObject({ expires: null })
  })

  it('una supervisión sin equipo se guarda y avisa; con equipo no avisa', async () => {
    const lone = await person('supervisor')
    expect(lone.result.supervisorWithoutTeam).toBe(true)
    const teamId = await createTeam(nora, { market: 'US', name: `C2 equipo ${tag()}`, motor: 'dealer' })
    const led = await person('supervisor', 'US', { teamId })
    expect(led.result.supervisorWithoutTeam).toBe(false)
    expect((await getUsers(nora)).memberships.find((m) => m.id === lone.membershipId)).toMatchObject({ role: 'supervisor', team: null })
  })

  it('un dominio no admitido se rechaza con un mensaje que dice qué cuenta sí sirve', async () => {
    await expect(grantMembership(nora, { email: `alguien.${tag()}@empowerretailers.com`, fullName: 'Persona Externa', role: 'rep', market: 'US' }, DOMAINS))
      .rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('necesita una cuenta de axexo.com, emida.com o emida.net') })
  })
})

describe('bitácora que se puede leer', () => {
  const tz = 'America/Puerto_Rico'

  it('trae el nombre del registro afectado, y enlace solo a lo que quien lee puede abrir', async () => {
    const p = await person('rep')
    await setTurn([p.id])
    const lead = await webLead({ utm_source: 'google' })
    await endMembership(nora, p.membershipId)
    const mine = await getAudit(nora, { tz, id: p.id, group: 'access' })
    expect(mine.items.map((e) => e.action)).toEqual(['membership.ended', 'membership.granted'])
    expect(mine.names[p.id]).toBe(p.name)
    expect(mine.links[p.id]).toBeUndefined() // una persona no tiene ficha: no hay enlace
    const created = await getAudit(nora, { tz, id: lead.id })
    expect(created.items[0]).toMatchObject({ action: 'lead.created', object: 'lead' })
    expect(created.names[lead.id]).toMatch(/^C2 Tienda/)
    expect(created.links[lead.id]).toBe(`/leads/${lead.id}`)
    expect(created.names[p.id]).toBe(p.name) // el dueño que aparece en el "después" también sale con nombre
    // La líder de MX lee la bitácora de su mercado: no ve este evento de US ni el nombre del lead.
    const ana = await ctxFor('ana.robles')
    const hers = await getAudit(ana, { tz, id: lead.id })
    expect(hers.items).toHaveLength(0)
    expect(hers.names[lead.id]).toBeUndefined()
  })

  it('filtra por persona, por tipo de acción, por registro y por mercado', async () => {
    const byActor = await getAudit(nora, { tz, actor: nora.user.id, group: 'all' })
    expect(byActor.items.length).toBeGreaterThan(0)
    expect(byActor.items.every((e) => e.actor_id === nora.user.id)).toBe(true)
    const access = await getAudit(nora, { tz, group: 'access' })
    expect(access.items.every((e) => /^(membership|team|user)\./.test(e.action))).toBe(true)
    const config = await getAudit(nora, { tz, group: 'config' })
    expect(config.items.every((e) => /^(pipeline|stage|routing|api_client|territory|field|account_type|loss_reason|form)\./.test(e.action))).toBe(true)
    const leads = await getAudit(nora, { tz, object: 'lead', market: 'US' })
    expect(leads.items.length).toBeGreaterThan(0)
    expect(leads.items.every((e) => e.object === 'lead' && e.market_code === 'US')).toBe(true)
    // Un filtro que no existe no rompe la consulta: se ignora.
    expect((await getAudit(nora, { tz, group: 'no-existe', object: 'x; drop table', actor: 'no-es-id', id: 'x', market: 'zz' })).total).toBeGreaterThan(0)
  })

  it('de entrada no muestra inicios de sesión; el filtro los trae', async () => {
    await admin`insert into crm.audit_events (actor_id, action, object, object_id, after) values (${nora.user.id}, 'session.started', 'session', ${nora.user.id}, '{"kind":"persona"}')`
    const changes = await getAudit(nora, { tz })
    expect(changes.items.some((e) => e.action.startsWith('session.'))).toBe(false)
    const sessions = await getAudit(nora, { tz, group: 'sessions' })
    expect(sessions.items.length).toBeGreaterThan(0)
    expect(sessions.items.every((e) => e.action.startsWith('session.'))).toBe(true)
    expect((await getAudit(nora, { tz, group: 'all' })).total).toBe(changes.total + sessions.total)
  })

  it('las fechas del filtro son las de la zona de quien lee', async () => {
    const id = randomUUID()
    // 03:30 UTC del 10 de marzo: en Puerto Rico todavía es 9 de marzo, 11:30 p.m.
    await admin`insert into crm.audit_events (at, actor_id, action, object, object_id) values ('2026-03-10T03:30:00Z', ${nora.user.id}, 'team.created', 'team', ${id})`
    const pr = await getAudit(nora, { tz: 'America/Puerto_Rico', id, from: '2026-03-09', to: '2026-03-09' })
    expect(pr.total).toBe(1)
    const utc = await getAudit(nora, { tz: 'UTC', id, from: '2026-03-09', to: '2026-03-09' })
    expect(utc.total).toBe(0)
    expect((await getAudit(nora, { tz: 'UTC', id, from: '2026-03-10', to: '2026-03-10' })).total).toBe(1)
    expect((await getAudit(nora, { tz: 'America/Puerto_Rico', id, from: '2026-03-10' })).total).toBe(0)
    // Una zona que la base no conoce no rompe el filtro: cae en UTC.
    expect((await getAudit(nora, { tz: 'Marte/Olympus', id, from: '2026-03-10', to: '2026-03-10' })).total).toBe(1)
  })

  it('pagina hacia atrás y hacia adelante sin repetir ni saltar eventos', async () => {
    const id = randomUUID()
    const n = AUDIT_PAGE * 2 + 20
    await admin`insert into crm.audit_events (at, actor_id, action, object, object_id, after)
      select now() - make_interval(secs => g), ${nora.user.id}, 'activity.added', 'activity', ${id}, jsonb_build_object('n', g) from generate_series(1, ${n}) g`
    const p1 = await getAudit(nora, { tz, id })
    expect(p1).toMatchObject({ total: n, newer: null })
    expect(p1.items).toHaveLength(AUDIT_PAGE)
    const p2 = await getAudit(nora, { tz, id, before: p1.older! })
    expect(p2.items).toHaveLength(AUDIT_PAGE)
    const p3 = await getAudit(nora, { tz, id, before: p2.older! })
    expect(p3.items).toHaveLength(20)
    expect(p3.older).toBeNull()
    const seen = [...p1.items, ...p2.items, ...p3.items].map((e) => e.id)
    expect(new Set(seen).size).toBe(n)
    // De regreso: de la tercera a la segunda, y de la segunda a la primera.
    const back2 = await getAudit(nora, { tz, id, after: p3.newer! })
    expect(back2.items.map((e) => e.id)).toEqual(p2.items.map((e) => e.id))
    const back1 = await getAudit(nora, { tz, id, after: back2.newer! })
    expect(back1.items.map((e) => e.id)).toEqual(p1.items.map((e) => e.id))
    expect(back1.newer).toBeNull()
    // Un cursor manipulado se ignora.
    expect((await getAudit(nora, { tz, id, before: 'x|y' })).items).toHaveLength(AUDIT_PAGE)
  })

  it('la bitácora sigue siendo solo de quien gobierna: ventas no la lee', async () => {
    const sam = await ctxFor('sam.ortiz')
    expect((await getAudit(sam, { tz, group: 'all' })).total).toBe(0)
  })
})

describe('página de estado', () => {
  it('administración y leadership la ven; ventas, supervisión y líder de mercado no', async () => {
    for (const ctx of [nora, luis]) {
      const s = await getStatus(ctx)
      expect(s.migrations.map((m) => m.name)).toContain('0012_admin_controls')
      expect(s.migrations[0]!.name).toBe('0001_core')
      expect(s.people.with_access).toBeGreaterThan(10)
      expect(s.admins.some((a) => a.id === nora.user.id)).toBe(true)
      expect(s.forms).toBeGreaterThanOrEqual(3)
      expect(typeof s.outbox_pending).toBe('number')
    }
    for (const key of ['sam.ortiz', 'kira.dunn', 'ana.robles', 'valeria.soto']) {
      await expect(getStatus(await ctxFor(key))).rejects.toMatchObject({ code: 'forbidden' })
      await asPersona(key, async (tx) => {
        expect(await attempt(tx, async (sp) => ({ count: (await sp`select app.system_status()`).length }))).toBe('42501')
      })
    }
  })

  it('distingue una prueba hecha desde Administración de un dato que llegó de verdad', async () => {
    const send = async () => {
      const eventId = randomUUID()
      await ingestSalesAppEvent(sys, { event_id: eventId, type: 'store.created', version: 1, occurred_at: new Date().toISOString(), data: { customer_id: `SC-US-${Math.floor(100000 + Math.random() * 899999)}`, market: 'US', name: `C2 PDV ${tag()}`, phone: null, locality: null } })
      return eventId
    }
    const simulated = await send()
    await recordSimulation(nora, 'store', simulated, 'US')
    expect((await getStatus(luis)).sales_app).toMatchObject({ simulated: true })
    const who = await one(admin<{ actor_id: string }[]>`select actor_id from crm.audit_events where action = 'integration.simulated' and after ->> 'key' = ${simulated}`)
    expect(who.actor_id).toBe(nora.user.id) // queda a nombre de quien la corrió, no del sistema
    await send()
    expect((await getStatus(luis)).sales_app).toMatchObject({ simulated: false })
    await expect(recordSimulation(luis, 'store', simulated, 'US')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('cuenta las llaves vigentes por permiso y deja de contarlas al revocarlas', async () => {
    const before = (await getStatus(nora)).keys['forms:write'] ?? 0
    const key = await createApiKey(nora, { name: `C2 sitio ${tag()}`, scopes: ['forms:write'] })
    expect((await getStatus(nora)).keys['forms:write']).toBe(before + 1)
    await revokeApiClient(nora, key.id)
    expect((await getStatus(nora)).keys['forms:write'] ?? 0).toBe(before)
  })
})

describe('etapas editables desde Administración', () => {
  const stage = () => one(admin<{ id: string; name_es: string; name_en: string; rot_days: number; required_fields: string[]; kind: string; edited_at: Date | null }[]>`
    select s.id, s.name_es, s.name_en, s.rot_days, s.required_fields, s.kind, s.edited_at from crm.stages s join crm.pipelines p on p.id = s.pipeline_id
     where p.market_code = 'SV' and s.code = 'propuesta'`)
  const restore = (s: { id: string; name_es: string; name_en: string; rot_days: number; required_fields: string[] }) =>
    admin`update crm.stages set name_es = ${s.name_es}, name_en = ${s.name_en}, rot_days = ${s.rot_days}, required_fields = ${s.required_fields}::text[], edited_at = null, edited_by = null where id = ${s.id}`

  it('cambia el nombre en los dos idiomas, los días y lo que pide para entrar, con el antes y el después en la bitácora', async () => {
    const was = await stage()
    try {
      await updateStage(nora, was.id, { nameEs: 'Propuesta enviada', nameEn: 'Proposal sent', rotDays: 9, requiredFields: ['decision_maker'] })
      const now = await stage()
      expect(now).toMatchObject({ name_es: 'Propuesta enviada', name_en: 'Proposal sent', rot_days: 9, required_fields: ['decision_maker'] })
      expect(now.edited_at).not.toBeNull()
      const ev = await one(admin<{ actor_id: string; market_code: string; before: Record<string, unknown>; after: Record<string, unknown> }[]>`
        select actor_id, market_code, before, after from crm.audit_events where action = 'stage.updated' and object_id = ${was.id} order by at desc limit 1`)
      expect(ev).toMatchObject({ actor_id: nora.user.id, market_code: 'SV' })
      expect(ev.before).toMatchObject({ name_es: was.name_es, rot_days: was.rot_days, required_fields: ['amount'] })
      expect(ev.after).toMatchObject({ name_es: 'Propuesta enviada', name_en: 'Proposal sent', rot_days: 9, required_fields: ['decision_maker'] })
      // La regla nueva es la que aplica al mover un negocio: ya no pide monto, pide decisor.
      const gate = { kind: 'open' as const, required_fields: now.required_fields }
      const deal = { amount_minor: null, next_step: 'Llamar', next_step_due: '2026-12-01', decision_maker_id: null, decision_maker_met: false }
      expect(missingForStage(deal, gate)).toEqual(['decision_maker'])
      // Guardar lo mismo no ensucia la bitácora.
      const count = async () => (await admin`select 1 from crm.audit_events where action = 'stage.updated' and object_id = ${was.id}`).length
      const n = await count()
      await updateStage(nora, was.id, { nameEs: 'Propuesta enviada', nameEn: 'Proposal sent', rotDays: 9, requiredFields: ['decision_maker'] })
      expect(await count()).toBe(n)
      // La pantalla de Embudos lo muestra.
      expect((await getConfig(nora)).stages.find((s) => s.id === was.id)).toMatchObject({ name_es: 'Propuesta enviada', rot_days: 9 })
    } finally {
      await restore(was)
    }
  })

  it('valida nombre, días y que no haya dos etapas iguales en el embudo', async () => {
    const was = await stage()
    await expect(updateStage(nora, was.id, { nameEs: '', nameEn: 'Proposal', rotDays: 5, requiredFields: [] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateStage(nora, was.id, { nameEs: 'Propuesta', nameEn: 'Proposal', rotDays: 400, requiredFields: [] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateStage(nora, was.id, { nameEs: 'Propuesta', nameEn: 'Proposal', rotDays: 5, requiredFields: ['otra_cosa' as 'amount'] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateStage(nora, was.id, { nameEs: 'Calificación', nameEn: 'Proposal', rotDays: 5, requiredFields: [] })).rejects.toMatchObject({ code: 'invalid' })
    expect(await stage()).toMatchObject({ name_es: was.name_es, rot_days: was.rot_days, edited_at: null })
  })

  it('una etapa de cierre solo cambia de nombre: no se estanca ni pide nada', async () => {
    const won = await one(admin<{ id: string; name_es: string; name_en: string; rot_days: number; required_fields: string[] }[]>`
      select s.id, s.name_es, s.name_en, s.rot_days, s.required_fields from crm.stages s join crm.pipelines p on p.id = s.pipeline_id where p.market_code = 'SV' and s.kind = 'won'`)
    try {
      await updateStage(nora, won.id, { nameEs: 'Ganada con venta', nameEn: 'Won with a sale', rotDays: 30, requiredFields: ['amount'] })
      expect(await one(admin`select name_es, rot_days, required_fields from crm.stages where id = ${won.id}`)).toMatchObject({ name_es: 'Ganada con venta', rot_days: 0, required_fields: [] })
    } finally {
      await restore(won)
    }
  })

  it('solo administración edita etapas: ni leadership, ni una líder de mercado, ni la base se lo permiten a otro rol', async () => {
    const was = await stage()
    const input = { nameEs: 'Cambio no permitido', nameEn: 'Change not allowed', rotDays: 1, requiredFields: [] as 'amount'[] }
    for (const key of ['luis.tovar', 'ana.robles', 'marco.pena']) {
      await expect(updateStage(await ctxFor(key), was.id, input)).rejects.toMatchObject({ code: 'forbidden' })
      await asPersona(key, async (tx) => {
        expect(await attempt(tx, (sp) => sp`update crm.stages set name_es = 'x' where id = ${was.id}`)).toBe('0 rows')
      })
    }
    expect(await stage()).toMatchObject({ name_es: was.name_es })
  })
})

describe('leads web con su origen', () => {
  it('guarda de dónde vino el lead y el consentimiento con su fecha y su texto, y se ven en el detalle', async () => {
    const lead = await webLead({
      utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'dealers-otono', utm_content: 'anuncio-b', utm_term: 'vender recargas',
      gclid: 'Cj0KCQiA-prueba_123', fbclid: 'IwAR0-prueba_456', consent: 'on',
    })
    expect(lead).toMatchObject({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'dealers-otono', utm_content: 'anuncio-b', utm_term: 'vender recargas', gclid: 'Cj0KCQiA-prueba_123', fbclid: 'IwAR0-prueba_456' })
    expect(Date.now() - new Date(lead.consent_at!).getTime()).toBeLessThan(60_000)
    expect(lead.consent_text).toBe(CONSENT_TEXT.en) // el formulario de prueba es en inglés: se guarda lo que la persona leyó
    const detail = (await getLead(nora, lead.id))!.lead
    expect(detail).toMatchObject({ utm_source: 'google', utm_campaign: 'dealers-otono', gclid: 'Cj0KCQiA-prueba_123', consent_text: CONSENT_TEXT.en })
    expect(detail.consent_at).not.toBeNull()
    // La bitácora guarda fuente, campaña y si hubo consentimiento; no los identificadores de clic.
    const ev = await one(admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'lead.created' and object_id = ${lead.id}`)
    expect(ev.after).toMatchObject({ source: 'web_form', utm_source: 'google', utm_campaign: 'dealers-otono', consent: true })
    expect(JSON.stringify(ev.after)).not.toContain('Cj0KCQiA')
  })

  it('sin casilla marcada no hay consentimiento, y un lead sin datos de campaña entra igual', async () => {
    const lead = await webLead()
    expect(lead).toMatchObject({ utm_source: null, utm_campaign: null, gclid: null, fbclid: null, consent_at: null, consent_text: null })
    expect((await webLead({ consent: false, consent_text: 'texto que nadie aceptó' })).consent_text).toBeNull()
    expect((await webLead({ consent: '' })).consent_at).toBeNull()
  })

  it('por la API el sitio manda el texto que mostró y el momento en que la persona aceptó', async () => {
    const at = new Date(Date.now() - 5 * 60_000).toISOString()
    const lead = await webLead({ consent: true, consent_text: 'I agree to be contacted by email.', consent_at: at })
    expect(lead.consent_text).toBe('I agree to be contacted by email.')
    expect(new Date(lead.consent_at!).toISOString()).toBe(at)
    // Un momento en el futuro no es creíble: se guarda el de llegada.
    const future = await webLead({ consent: true, consent_at: new Date(Date.now() + 86_400_000).toISOString() })
    expect(new Date(future.consent_at!).getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('un valor larguísimo, raro o con un dato prohibido no tumba el lead: se recorta o se limpia', async () => {
    const card = ['4111', '1111', '1111', '1111'].join(' ')
    const lead = await webLead({ utm_campaign: 'x'.repeat(5000), utm_source: '  goo\u0000gle\n ', utm_medium: 42, utm_content: `promo ${card}`, gclid: ['a', 'b'] })
    expect(lead.utm_campaign).toHaveLength(200)
    expect(lead.utm_source).toBe('google')
    expect(lead.utm_medium).toBeNull()
    expect(lead.gclid).toBeNull()
    expect(lead.utm_content).not.toContain('4111')
  })

  it('un lead capturado a mano no lleva origen web ni consentimiento', async () => {
    const sam = await ctxFor('sam.ortiz')
    const id = await createLead(sam, { market: 'US', motor: 'dealer', businessName: `C2 Manual ${tag()}`, contactName: 'Persona De Prueba', phone: phone() })
    try {
      expect((await getLead(sam, id))!.lead).toMatchObject({ source: 'manual', utm_source: null, consent_at: null, owner_active: true })
    } finally {
      await admin`update crm.leads set status = 'disqualified', disqualify_code = 'duplicate' where id = ${id}`
    }
  })
})

describe('solo lectura que se respeta', () => {
  it('quien solo tiene Leadership es de solo lectura; cualquier otro rol no', async () => {
    expect(isReadOnly(luis.memberships)).toBe(true)
    expect(isReadOnly(nora.memberships)).toBe(false)
    expect(isReadOnly((await ctxFor('ana.robles')).memberships)).toBe(false)
    expect(isReadOnly([...luis.memberships, { role: 'supervisor', market: 'MX', teamId: null }])).toBe(false)
    expect(luis.can('rules.run')).toBe(false)
    expect(luis.can('status.read')).toBe(true)
    expect(luis.can('board.supervisor')).toBe(true) // sigue viendo Mi equipo
  })

  it('"Evaluar reglas ahora": Leadership no la corre; quien dirige sí, y queda en la bitácora a su nombre', async () => {
    const count = async (actor: string) => (await admin`select 1 from crm.audit_events where action = 'rules.evaluated' and actor_id = ${actor}`).length
    const before = await one(admin<{ v: string }[]>`select value::text as v from crm.settings where key = 'rules_last_run'`)
    await expect(runRulesNow(luis, sys)).rejects.toMatchObject({ code: 'forbidden' })
    expect(await count(luis.user.id)).toBe(0)
    expect((await one(admin<{ v: string }[]>`select value::text as v from crm.settings where key = 'rules_last_run'`)).v).toBe(before.v) // no corrió nada

    const kira = await ctxFor('kira.dunn')
    const n = await count(kira.user.id)
    const out = await runRulesNow(kira, sys)
    expect(await count(kira.user.id)).toBe(n + 1)
    const ev = await one(admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'rules.evaluated' and actor_id = ${kira.user.id} order by at desc limit 1`)
    expect(ev.after).toEqual({ opened: out.opened, closed: out.closed })
  })

  it('Leadership no ejecuta ninguna acción que cambie datos: todas responden "sin permiso" y la bitácora no se mueve', async () => {
    const lead = await webLead()
    const marco = await personaId('marco.pena')
    const diana = await personaId('diana.cruz')
    const acc = await one(admin<{ id: string }[]>`select id from crm.accounts where owner_id = ${marco} and archived_at is null and kind = 'store' order by id limit 1`)
    const acc2 = await one(admin<{ id: string }[]>`select id from crm.accounts where owner_id = ${marco} and archived_at is null and kind = 'store' order by id offset 1 limit 1`)
    const deal = await one(admin<{ id: string; stage_id: string; pipeline_id: string }[]>`select id, stage_id, pipeline_id from crm.deals where owner_id = ${marco} and status = 'open' order by id limit 1`)
    const nextStage = await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${deal.pipeline_id} and id <> ${deal.stage_id} and kind = 'open' order by position limit 1`)
    const task = await one(admin<{ id: string }[]>`select id from crm.activities where kind = 'task' and done_at is null order by id limit 1`)
    const exception = await one(admin<{ id: string }[]>`select id from crm.exceptions where resolved_at is null order by id limit 1`)
    const membership = await one(admin<{ id: string }[]>`select id from crm.memberships where user_id = ${marco} and valid_to is null`)
    const pipeline = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' order by position limit 1`)
    const stage = await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${pipeline.id} order by position limit 1`)
    const seededRule = await one(admin<{ id: string }[]>`select id from crm.routing_rules where name = 'Web US dealers'`)
    const key = await createApiKey(nora, { name: `C2 llave ${tag()}`, scopes: ['forms:write'] })
    const soon = addDays(todayIn('America/Mexico_City'), 3)

    const writes: [string, () => Promise<unknown>][] = [
      ['crear lead', () => createLead(luis, { market: 'MX', motor: 'd2d', businessName: 'C2 No Debe Existir', contactName: 'Nadie', phone: '55 6123 4567' })],
      ['tomar lead', () => takeLead(luis, lead.id)],
      ['contactar lead', () => markContacted(luis, lead.id)],
      ['calificar lead', () => qualifyLead(luis, lead.id)],
      ['descartar lead', () => disqualifyLead(luis, lead.id, 'duplicate')],
      ['asignar lead', () => assignLead(luis, lead.id, marco)],
      ['convertir lead', () => convertLead(luis, lead.id)],
      ['crear comercio', () => createAccount(luis, { market: 'MX', kind: 'store', name: 'C2 No Debe Existir', segment: 'd2d' })],
      ['editar comercio', () => updateAccount(luis, acc.id, { name: 'C2 Cambiado' } as never)],
      ['agregar contacto', () => addContact(luis, acc.id, { fullName: 'C2 Contacto', role: 'owner' } as never)],
      ['cambiar cadena', () => setParent(luis, acc.id, null)],
      ['reasignar cartera', () => reassignAccounts(luis, [acc.id], diana)],
      ['fusionar comercios', () => mergeAccounts(luis, acc2.id, acc.id)],
      ['campos del comercio', () => updateCustom(luis, 'account', acc.id, { giro: 'Farmacia' })],
      ['crear negocio', () => createDeal(luis, { accountId: acc2.id, pipelineId: pipeline.id, title: 'C2 No Debe Existir', nextStep: 'Llamar', nextStepDue: soon })],
      ['editar negocio', () => updateDeal(luis, deal.id, { title: 'C2 Cambiado' })],
      ['mover negocio', () => moveDeal(luis, deal.id, nextStage.id, undefined, { step: 'Llamar', due: soon })],
      ['campos del negocio', () => updateCustom(luis, 'deal', deal.id, { expected_stores: '3' })],
      ['nota', () => addActivity(luis, { accountId: acc.id, kind: 'note', subject: 'C2 nota que no debe existir' })],
      ['completar tarea', () => completeItem(luis, { type: 'task', id: task.id, result: 'done', next: 'none', when: '' })],
      ['completar lead', () => completeItem(luis, { type: 'lead', id: lead.id, result: 'reached', next: 'none', when: '' })],
      ['atender sugerencia', () => completeItem(luis, { type: 'suggestion', id: exception.id, result: 'done', next: 'task', when: soon, nextText: 'Revisar con el equipo' })],
      ['descartar aviso', () => resolveException(luis, exception.id, 'no')],
      ['evaluar reglas', () => runRulesNow(luis, sys)],
      ['dar acceso', () => grantMembership(luis, { email: `c2.no.${tag()}@contigo.test`, fullName: 'C2 No', role: 'rep', market: 'MX' }, DOMAINS)],
      ['quitar acceso', () => endMembership(luis, membership.id)],
      ['vencimiento', () => setMembershipExpiry(luis, membership.id, soon)],
      ['crear equipo', () => createTeam(luis, { market: 'MX', name: `C2 no ${tag()}`, motor: 'd2d' })],
      ['cambiar turno', () => setRoutingMembers(luis, seededRule.id, [])],
      ['regla de cierre', () => configurePipeline(luis, pipeline.id, { closeByTransaction: false, awaitingStageId: null })],
      ['editar etapa', () => updateStage(luis, stage.id, { nameEs: 'C2 no', nameEn: 'C2 no', rotDays: 1, requiredFields: [] })],
      ['crear llave', () => createApiKey(luis, { name: 'C2 llave no', scopes: ['forms:write'] })],
      ['revocar llave', () => revokeApiClient(luis, key.id)],
      ['probar integración', () => recordSimulation(luis, 'visit', 'x', null)],
      ['importar Pipedrive', () => startImport(luis, 'delta')],
      ['reanudar importación', () => resumeImport(luis)],
      ['detener importación', () => cancelImport(luis)],
      ['vaciar copia cruda', () => purgeRaw(luis)],
    ]
    const snapshot = () => one(admin<Record<string, number>[]>`
      select (select count(*)::int from crm.audit_events where actor_id = ${luis.user.id} and action not like 'session.%') as audit,
             (select count(*)::int from crm.leads) as leads, (select count(*)::int from crm.accounts) as accounts, (select count(*)::int from crm.deals) as deals,
             (select count(*)::int from crm.activities) as activities, (select count(*)::int from crm.memberships) as memberships,
             (select count(*)::int from crm.teams) as teams, (select count(*)::int from crm.api_clients) as api_clients,
             (select count(*)::int from crm.exceptions where resolved_at is null) as open_exceptions, (select count(*)::int from crm.import_runs) as import_runs`)
    const before = await snapshot()
    for (const [name, run] of writes) await expect(run(), name).rejects.toMatchObject({ code: 'forbidden' })
    expect(await snapshot()).toEqual(before)
    expect(before.audit).toBe(0)
    await revokeApiClient(nora, key.id)
  })
})
