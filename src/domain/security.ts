import 'server-only'
import { recordSeatAtGrant, SEAT_MISSING, seatFields } from '@/domain/seats'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean, newId } from '@/domain/common'
import { ADMIN_AREAS, type AdminArea } from '@/domain/policy'
import { assertNoProhibited } from '@/domain/guard'
import { forbidden, invalid, notFound } from '@/lib/errors'
import { emailInDomains, domainList } from '@/lib/domains'
import { open, seal } from '@/server/adapters/field-crypto'
import { archiveBatchStatus } from '@/server/adapters/audit-archive'
import { notify, notifyMany, peopleWithRole } from '@/domain/notify'

// 0027 seguridad: comandos de SEG-01, 02, 03, 04, 07, 08 y 09. Cada uno revisa el permiso aquí y la base lo repite.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const uuid = z.guid()

/** SEG-07: la persona se entera de que recibió un acceso, por el servicio de avisos (dentro de CONTIGO; el correo, cuando su canal se encienda). */
export async function accessGranted(tx: Tx, ctx: Ctx, userId: string, market: string | null, role: [string, string]): Promise<void> {
  if (userId === ctx.user.id) return
  await notify(tx, ctx, {
    to: userId, kind: 'access_granted', market: null, link: '/bienvenida',
    title: [`Tienes acceso a CONTIGO como ${role[0]}${market ? ` en ${market}` : ''}`, `You have access to CONTIGO as ${role[1]}${market ? ` in ${market}` : ''}`],
    body: [`Te lo dio ${ctx.user.name}. Si no lo esperabas, avisa a Administración.`, `${ctx.user.name} gave it to you. If you were not expecting it, tell Administration.`],
  })
}

// ------------------------------------------------------------ SEG-01: Administración por partes, jerarquía, entidad legal, agencias
/** Deja a una persona administradora con todas las partes (null) o solo con las que se eligen. Siempre queda alguien con todas y sin vencimiento. */
export async function setAdminAreas(ctx: Ctx, membershipId: string, areas: AdminArea[] | null): Promise<void> {
  ctx.assert('access.manage')
  // Cambiar las partes de una administración es de la administración completa.
  if (!ctx.isAdmin) throw forbidden()
  const list = areas === null ? null : [...new Set(z.array(z.enum(ADMIN_AREAS)).min(1).parse(areas))]
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ user_id: string; admin_areas: AdminArea[] | null }[]>`
      select user_id, admin_areas from crm.memberships where id = ${membershipId} and role = 'admin' and (valid_to is null or valid_to > now()) for update`
    const m = rows[0]
    if (!m) throw notFound()
    if (list) {
      const others = await tx<{ n: number }[]>`select count(*)::int as n from crm.memberships x join crm.users u on u.id = x.user_id
        where x.role = 'admin' and x.admin_areas is null and x.valid_to is null and u.is_active and not u.is_system and x.id <> ${membershipId}`
      if ((others[0]?.n ?? 0) === 0) throw invalid('Tiene que quedar al menos una persona con toda la administración y sin fecha de vencimiento.', 'At least one person with full administration and no expiry date must remain.')
    }
    await tx`update crm.memberships set admin_areas = ${list} where id = ${membershipId}`
    await audit(tx, ctx, 'membership.areas_changed', 'user', m.user_id, null, { areas: m.admin_areas ?? 'all' }, { areas: list ?? 'all' })
  })
}

/** Limita un rol de mercado a una entidad legal (o le quita el límite). */
export async function setMembershipEntity(ctx: Ctx, membershipId: string, legalEntityId: string | null): Promise<void> {
  ctx.assert('access.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ user_id: string; market_code: string | null; legal_entity_id: string | null }[]>`
      select user_id, market_code, legal_entity_id from crm.memberships where id = ${membershipId} and (valid_to is null or valid_to > now()) for update`
    const m = rows[0]
    if (!m) throw notFound()
    if (!m.market_code) throw invalid('Un rol sin mercado no se limita a una entidad legal.', 'A role with no market cannot be limited to a legal entity.')
    if (legalEntityId) {
      const ok = await tx`select 1 from crm.legal_entities where id = ${legalEntityId} and market_code = ${m.market_code}`
      if (!ok[0]) throw invalid('Esa entidad legal es de otro mercado.', 'That legal entity belongs to another market.')
    }
    await tx`update crm.memberships set legal_entity_id = ${legalEntityId} where id = ${membershipId}`
    await audit(tx, ctx, 'membership.entity_changed', 'user', m.user_id, m.market_code, { legal_entity_id: m.legal_entity_id }, { legal_entity_id: legalEntityId })
  })
}

/** Jerarquía de supervisión: un equipo cuelga de otro, y quien supervisa el de arriba ve a los de abajo. */
export async function setTeamParent(ctx: Ctx, teamId: string, parentId: string | null): Promise<void> {
  ctx.assert('access.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; parent_team_id: string | null }[]>`select market_code, parent_team_id from crm.teams where id = ${teamId} for update`
    const team = rows[0]
    if (!team) throw notFound()
    if (parentId) {
      if (parentId === teamId) throw invalid('Un equipo no cuelga de sí mismo.', 'A team cannot report to itself.')
      const chain = await tx<{ id: string; market_code: string }[]>`
        with recursive up as (select id, parent_team_id, market_code from crm.teams where id = ${parentId}
                              union select t.id, t.parent_team_id, t.market_code from crm.teams t join up on t.id = up.parent_team_id)
        select id, market_code from up`
      if (!chain[0]) throw notFound()
      if (chain.some((c) => c.id === teamId)) throw invalid('Eso haría un círculo: ese equipo ya cuelga de este.', 'That would make a loop: that team already reports to this one.')
      if (chain.find((c) => c.id === parentId)?.market_code !== team.market_code) throw invalid('Los dos equipos tienen que ser del mismo mercado.', 'Both teams must be in the same market.')
    }
    await tx`update crm.teams set parent_team_id = ${parentId} where id = ${teamId}`
    await audit(tx, ctx, 'team.parent_changed', 'team', teamId, team.market_code, { parent_team_id: team.parent_team_id }, { parent_team_id: parentId })
  })
}

// Alta de agencias: una sola, en domain/store-record.ts (createAgency), y una sola pantalla, Datos > Catálogos.

const externalInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  agencyId: uuid,
  expires: isoDate.or(z.literal('')).optional(),
  ...seatFields,
})
/** Da acceso a una persona de una agencia: entra con el rol Agencia, confinada a lo que su agencia reclutó. */
export async function grantAgencyAccess(ctx: Ctx, input: z.input<typeof externalInput>, allowedDomains: readonly string[]): Promise<string> {
  ctx.assert('access.manage')
  const p = externalInput.safeParse(input)
  if (!p.success) {
    if (p.error.issues.some((i) => String(i.path[0]).startsWith('seat'))) throw invalid(...SEAT_MISSING)
    throw invalid('Revisa correo, nombre y agencia.', 'Check the email, name and agency.')
  }
  const v = p.data
  if (!emailInDomains(v.email, allowedDomains) && !v.email.endsWith('@contigo.test')) {
    throw invalid(
      `La persona de la agencia necesita una cuenta de ${domainList(allowedDomains, 'o')}: CONTIGO solo deja entrar con cuentas de la organización.`,
      `The agency user needs a ${domainList(allowedDomains, 'or')} account: CONTIGO only lets organization accounts sign in.`,
    )
  }
  return withUser(ctx.user.id, async (tx) => {
    const ag = await tx<{ market_code: string; name: string }[]>`select market_code, name from crm.agencies where id = ${v.agencyId} and is_active`
    if (!ag[0]) throw notFound()
    let users = await tx<{ id: string }[]>`select id from crm.users where email = ${v.email}`
    if (!users[0]) users = await tx<{ id: string }[]>`insert into crm.users (email, full_name) values (${v.email}, ${v.fullName}) returning id`
    const userId = users[0]!.id
    const other = await tx`select 1 from crm.memberships where user_id = ${userId} and (valid_to is null or valid_to > now())`
    if (other[0]) throw invalid('Esa persona ya tiene un acceso. Una persona de agencia no combina su rol con otro.', 'That person already has access. An agency user does not combine that role with another.')
    const mem = await tx<{ id: string }[]>`insert into crm.memberships (user_id, market_code, role, agency_id, valid_to)
             values (${userId}, ${ag[0].market_code}, 'agency', ${v.agencyId},
                     ${v.expires ? tx`((${v.expires}::date + 1)::timestamp at time zone (select timezone from crm.markets where code = ${ag[0].market_code}))` : null}) returning id`
    await recordSeatAtGrant(tx, ctx, mem[0]!.id, userId, ag[0].market_code, 'agency', v)
    await audit(tx, ctx, 'membership.granted', 'user', userId, ag[0].market_code, null, { role: 'agency', market: ag[0].market_code, agency: ag[0].name, expires: v.expires || null })
    await accessGranted(tx, ctx, userId, ag[0].market_code, ['Agencia', 'Agency'])
    return userId
  })
}

const seatInput = z.object({ approverName: z.string().trim().min(2).max(120), approvedOn: isoDate, reference: z.string().trim().max(200).optional() })
/** E4.F9: deja escrito quién aprobó el asiento (quien tiene el presupuesto), cuándo y con qué referencia. */
export async function recordSeatApproval(ctx: Ctx, membershipId: string, input: z.input<typeof seatInput>): Promise<void> {
  ctx.assert('access.manage')
  const p = seatInput.safeParse(input)
  if (!p.success) throw invalid('Escribe quién aprobó el asiento y en qué fecha.', 'Write who approved the seat and on what date.')
  const v = p.data
  assertNoProhibited(v.approverName, v.reference)
  await withUser(ctx.user.id, async (tx) => {
    const m = await tx<{ user_id: string; market_code: string | null; role: string }[]>`select user_id, market_code, role from crm.memberships where id = ${membershipId}`
    if (!m[0]) throw notFound()
    if ((await tx`select 1 from crm.seat_approvals where membership_id = ${membershipId}`)[0]) throw invalid('Ese asiento ya tiene su aprobación registrada.', 'That seat already has its approval on record.')
    if ((await tx<{ ok: boolean }[]>`select ${v.approvedOn}::date <= (now() at time zone 'UTC')::date + 1 as ok`)[0]?.ok !== true) throw invalid('La fecha de aprobación no puede ser futura.', 'The approval date cannot be in the future.')
    await tx`insert into crm.seat_approvals (membership_id, approver_name, approved_on, reference, recorded_by)
             values (${membershipId}, ${v.approverName}, ${v.approvedOn}, ${clean(v.reference)}, ${ctx.user.id})`
    await audit(tx, ctx, 'seat.approved', 'user', m[0].user_id, m[0].market_code, null, { role: m[0].role, approver: v.approverName, approved_on: v.approvedOn, reference: clean(v.reference) })
  })
}

// ------------------------------------------------------------ SEG-01: equipo de cuenta
export const TEAM_FUNCTIONS = ['support', 'specialist', 'operations', 'executive', 'other'] as const
const teamMember = z.object({ accountId: uuid, userId: uuid, fn: z.enum(TEAM_FUNCTIONS), access: z.enum(['read', 'edit']), note: z.string().trim().max(200).optional() })
/** Suma a una persona al equipo de una cuenta: ve la cuenta (o la edita) sin ser quien la lleva. */
export async function addAccountTeamMember(ctx: Ctx, input: z.input<typeof teamMember>): Promise<void> {
  const p = teamMember.safeParse(input)
  if (!p.success) throw invalid('Elige a la persona, qué hace en la cuenta y con qué permiso.', 'Choose the person, what they do on the account and with what permission.')
  const v = p.data
  assertNoProhibited(v.note)
  await withUser(ctx.user.id, async (tx) => {
    const acc = await tx<{ market_code: string; owner_id: string | null; manage: boolean }[]>`
      select market_code, owner_id, app.can_manage_account(id) as manage from crm.accounts where id = ${v.accountId}`
    const a = acc[0]
    if (!a) throw notFound()
    ctx.assert('account.team', a.market_code)
    if (!a.manage) throw forbidden()
    if (a.owner_id === v.userId) throw invalid('Esa persona ya lleva la cuenta.', 'That person already owns the account.')
    const member = await tx`select 1 from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
      where m.user_id = ${v.userId} and m.market_code = ${a.market_code} and m.role in ('rep','supervisor','market_lead','ops')
        and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())`
    if (!member[0]) throw invalid('Solo entra al equipo alguien que trabaja en ese mercado.', 'Only someone who works in that market can join the team.')
    if ((await tx`select 1 from crm.account_team where account_id = ${v.accountId} and user_id = ${v.userId} and valid_to is null`)[0]) throw invalid('Esa persona ya está en el equipo de la cuenta.', 'That person is already on the account team.')
    await tx`insert into crm.account_team (account_id, market_code, user_id, function, access, note, added_by)
             values (${v.accountId}, ${a.market_code}, ${v.userId}, ${v.fn}, ${v.access}, ${clean(v.note)}, ${ctx.user.id})`
    await audit(tx, ctx, 'account.team_added', 'account', v.accountId, a.market_code, null, { user_id: v.userId, function: v.fn, access: v.access })
  })
}

export async function removeAccountTeamMember(ctx: Ctx, id: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ account_id: string; market_code: string; user_id: string; function: string; access: string }[]>`
      update crm.account_team set valid_to = now() where id = ${id} and valid_to is null returning account_id, market_code, user_id, function, access`
    const r = rows[0]
    if (!r) throw notFound()
    ctx.assert('account.team', r.market_code)
    await audit(tx, ctx, 'account.team_removed', 'account', r.account_id, r.market_code, { user_id: r.user_id, function: r.function, access: r.access }, null)
  })
}

// ------------------------------------------------------------ SEG-02: campos sensibles
const ROLES = ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'partner'] as const
const sensitiveDef = z.object({
  viewRoles: z.array(z.enum(ROLES)), editRoles: z.array(z.enum(['admin', 'market_lead', 'supervisor', 'rep', 'ops'])),
  ownerCanView: z.boolean(), ownerCanEdit: z.boolean(), isActive: z.boolean(),
})
/** Quién ve y quién edita cada campo sensible: lo decide la parte de configuración. */
export async function updateSensitiveField(ctx: Ctx, key: string, input: z.input<typeof sensitiveDef>): Promise<void> {
  ctx.assert('config.manage')
  const v = sensitiveDef.parse(input)
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ view_roles: string[]; edit_roles: string[]; owner_can_view: boolean; owner_can_edit: boolean; is_active: boolean }[]>`
      select view_roles, edit_roles, owner_can_view, owner_can_edit, is_active from crm.sensitive_fields where key = ${key} for update`
    if (!before[0]) throw notFound()
    await tx`update crm.sensitive_fields set view_roles = ${v.viewRoles}::text[], edit_roles = ${v.editRoles}::text[], owner_can_view = ${v.ownerCanView},
              owner_can_edit = ${v.ownerCanEdit}, is_active = ${v.isActive} where key = ${key}`
    await audit(tx, ctx, 'sensitive_field.updated', 'sensitive_field', null, null, { key, ...before[0] },
      { key, view_roles: v.viewRoles, edit_roles: v.editRoles, owner_can_view: v.ownerCanView, owner_can_edit: v.ownerCanEdit, is_active: v.isActive })
  })
}

const sensitiveNew = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/), labelEs: z.string().trim().min(2).max(60), labelEn: z.string().trim().min(2).max(60) })
/** Un campo sensible nuevo nace cerrado: solo lo ve y lo edita quien lidera el mercado, hasta que configuración lo abra. */
export async function createSensitiveField(ctx: Ctx, input: z.input<typeof sensitiveNew>): Promise<void> {
  ctx.assert('config.manage')
  const p = sensitiveNew.safeParse(input)
  if (!p.success) throw invalid('El campo lleva una clave en minúsculas sin espacios y su nombre en español y en inglés.', 'The field needs a lowercase key with no spaces and its name in Spanish and in English.')
  const v = p.data
  assertNoProhibited(v.labelEs, v.labelEn)
  await withUser(ctx.user.id, async (tx) => {
    if ((await tx`select 1 from crm.sensitive_fields where key = ${v.key}`)[0]) throw invalid('Ya hay un campo con esa clave.', 'There is already a field with that key.')
    await tx`insert into crm.sensitive_fields (key, label_es, label_en, view_roles, edit_roles, owner_can_view, owner_can_edit)
             values (${v.key}, ${v.labelEs}, ${v.labelEn}, '{market_lead}', '{market_lead}', false, false)`
    await audit(tx, ctx, 'sensitive_field.created', 'sensitive_field', null, null, null, { key: v.key, label_es: v.labelEs, label_en: v.labelEn })
  })
}

/** Guarda el valor de un campo sensible. Lo que el estándar prohíbe (tarjetas, cuentas, identificaciones) tampoco entra aquí. */
export async function setSensitive(ctx: Ctx, accountId: string, key: string, value: string): Promise<void> {
  const v = z.string().trim().min(1).max(1500).safeParse(value)
  if (!v.success) throw invalid('Escribe el dato (hasta 1,500 caracteres).', 'Write the value (up to 1,500 characters).')
  assertNoProhibited(v.data)
  const sealed = seal(v.data)
  await withUser(ctx.user.id, (tx) => tx`select app.sensitive_set(${uuid.parse(accountId)}, ${key}, ${sealed.payload}, ${sealed.cipher})`)
}

/** Revela un campo sensible: pide motivo, y la base deja el evento antes de devolver el valor. */
export async function revealSensitive(ctx: Ctx, accountId: string, key: string, reason: string): Promise<string | null> {
  const r = z.string().trim().min(10).max(300).safeParse(reason)
  if (!r.success) throw invalid('Escribe para qué necesitas verlo (10 caracteres o más). Queda en la bitácora.', 'Write why you need to see it (10 characters or more). It is logged.')
  assertNoProhibited(r.data)
  // Ver como otra persona no revela datos reservados.
  if (ctx.viewAs) throw forbidden()
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ value: string; cipher: string }[]>`select value, cipher from app.sensitive_reveal(${uuid.parse(accountId)}, ${key}, ${r.data})`
    return rows[0] ? open(rows[0].cipher, rows[0].value) : null
  })
}

// ------------------------------------------------------------ SEG-04: consentimiento, baja y retención
export const CHANNELS = ['email', 'phone', 'sms', 'whatsapp'] as const
export const CONSENT_CATEGORIES = ['service', 'marketing'] as const
export const CONSENT_SOURCES = ['verbal', 'written', 'web_form', 'import'] as const
const consentInput = z.object({
  contactId: uuid.optional(), leadId: uuid.optional(),
  channel: z.enum(CHANNELS), category: z.enum(CONSENT_CATEGORIES), source: z.enum(CONSENT_SOURCES),
  evidence: z.string().trim().min(3).max(400),
})
/** Registra que una persona aceptó que se le contacte por un canal y para qué, con la evidencia y la fecha. */
export async function recordConsent(ctx: Ctx, input: z.input<typeof consentInput>): Promise<string> {
  const p = consentInput.safeParse(input)
  if (!p.success || (!p.data.contactId && !p.data.leadId)) throw invalid('Elige canal, para qué y de dónde salió, y escribe la evidencia (qué dijo o firmó, y cuándo).', 'Choose the channel, the purpose and where it came from, and write the evidence (what they said or signed, and when).')
  const v = p.data
  assertNoProhibited(v.evidence)
  return withUser(ctx.user.id, async (tx) => {
    const who = v.contactId
      ? await tx<{ market_code: string }[]>`select market_code from crm.contacts where id = ${v.contactId}`
      : await tx<{ market_code: string }[]>`select market_code from crm.leads where id = ${v.leadId!}`
    if (!who[0]) throw notFound()
    ctx.assert('consent.write', who[0].market_code)
    const id = await newId(tx)
    await tx`insert into crm.consents (id, market_code, contact_id, lead_id, channel, category, source, evidence, recorded_by)
             values (${id}, ${who[0].market_code}, ${v.contactId ?? null}, ${v.leadId ?? null}, ${v.channel}, ${v.category}, ${v.source}, ${v.evidence}, ${ctx.user.id})`
    await audit(tx, ctx, 'consent.recorded', v.contactId ? 'contact' : 'lead', v.contactId ?? v.leadId!, who[0].market_code, null, { channel: v.channel, category: v.category, source: v.source })
    return id
  })
}

export async function revokeConsent(ctx: Ctx, id: string, reason: string): Promise<void> {
  const why = z.string().trim().min(3).max(200).safeParse(reason)
  if (!why.success) throw invalid('Escribe por qué se retira (qué pidió la persona).', 'Write why it is withdrawn (what the person asked).')
  assertNoProhibited(why.data)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; contact_id: string | null; lead_id: string | null; channel: string; category: string }[]>`
      select market_code, contact_id, lead_id, channel, category from crm.consents where id = ${id} and revoked_at is null for update`
    const c = rows[0]
    if (!c) throw notFound()
    ctx.assert('consent.write', c.market_code)
    await tx`update crm.consents set revoked_at = now(), revoked_reason = ${why.data} where id = ${id}`
    await audit(tx, ctx, 'consent.revoked', c.contact_id ? 'contact' : 'lead', c.contact_id ?? c.lead_id, c.market_code, { channel: c.channel, category: c.category }, { reason: why.data })
  })
}

const normAddress = (channel: string, address: string): string => (channel === 'email' ? address.trim().toLowerCase() : address.replace(/[^\d+]/g, ''))
const optOutInput = z.object({ market: z.string().length(2), channel: z.enum([...CHANNELS, 'all']), address: z.string().trim().min(3).max(320), reason: z.string().trim().max(200).optional() })
/** Baja: esa dirección no vuelve a recibir nada por ese canal. Vale para cualquier contacto o lead que la tenga. */
export async function optOut(ctx: Ctx, input: z.input<typeof optOutInput>): Promise<void> {
  const p = optOutInput.safeParse(input)
  if (!p.success) throw invalid('Elige el canal y escribe el teléfono o el correo que pidió la baja.', 'Choose the channel and write the phone or email that asked to opt out.')
  const v = p.data
  ctx.assert('consent.write', v.market)
  assertNoProhibited(v.reason)
  const isEmail = v.address.includes('@')
  if ((v.channel === 'email') !== isEmail && v.channel !== 'all') throw invalid('El canal y la dirección no coinciden: correo para correo, teléfono para lo demás.', 'The channel and the address do not match: an email for email, a phone for the rest.')
  const addr = normAddress(isEmail ? 'email' : 'phone', v.address)
  if (!isEmail && !/^\+[1-9]\d{6,14}$/.test(addr)) throw invalid('Escribe el teléfono completo con código de país, por ejemplo +52 55 1234 5678.', 'Write the full phone with country code, for example +1 305 555 0100.')
  await withUser(ctx.user.id, async (tx) => {
    if ((await tx`select 1 from crm.contact_suppressions where channel = ${v.channel} and address_norm = ${addr} and lifted_at is null`)[0]) throw invalid('Esa baja ya está registrada.', 'That opt-out is already on record.')
    const id = await newId(tx)
    await tx`insert into crm.contact_suppressions (id, market_code, channel, address_norm, reason, created_by) values (${id}, ${v.market}, ${v.channel}, ${addr}, ${clean(v.reason)}, ${ctx.user.id})`
    await audit(tx, ctx, 'consent.opted_out', 'suppression', id, v.market, null, { channel: v.channel })
  })
}

export async function liftOptOut(ctx: Ctx, id: string, reason: string): Promise<void> {
  const why = z.string().trim().min(10).max(200).safeParse(reason)
  if (!why.success) throw invalid('Escribe por qué se levanta la baja (10 caracteres o más): la persona tuvo que pedirlo.', 'Write why the opt-out is lifted (10 characters or more): the person must have asked for it.')
  assertNoProhibited(why.data)
  // Levantar una baja es de quien lidera o de privacidad: quien vende ni llega a buscarla.
  ctx.assert('consent.lift')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; channel: string }[]>`select market_code, channel from crm.contact_suppressions where id = ${id} and lifted_at is null for update`
    const s = rows[0]
    if (!s) throw notFound()
    ctx.assert('consent.lift', s.market_code)
    await tx`update crm.contact_suppressions set lifted_at = now(), lifted_by = ${ctx.user.id}, reason = ${why.data} where id = ${id}`
    await audit(tx, ctx, 'consent.opt_out_lifted', 'suppression', id, s.market_code, { channel: s.channel }, { reason: why.data })
  })
}

/**
 * Lo que TODO envío a un contacto pregunta antes de salir (correo, SMS, WhatsApp, llamada automática): una baja manda
 * siempre, y lo comercial además pide consentimiento vigente. Un adaptador de envío que no pase por aquí no se integra.
 */
export async function mayContact(tx: Tx, channel: (typeof CHANNELS)[number], address: string, category: (typeof CONSENT_CATEGORIES)[number] = 'service'): Promise<{ ok: boolean; why: 'ok' | 'opted_out' | 'no_consent' | 'no_address' }> {
  const rows = await tx<{ ok: boolean; why: 'ok' | 'opted_out' | 'no_consent' | 'no_address' }[]>`select ok, why from app.may_contact(${channel}, ${normAddress(channel, address)}, ${category})`
  return rows[0] ?? { ok: false, why: 'no_address' }
}

const retentionInput = z.object({ afterDays: z.number().int().min(30).max(3650).nullable(), isActive: z.boolean() })
/** Plazo y encendido de una regla de retención. El plazo lo define Legal: sin plazo, la regla no se puede encender. */
export async function setRetentionRule(ctx: Ctx, key: string, input: z.input<typeof retentionInput>): Promise<void> {
  ctx.assert('security.manage')
  const p = retentionInput.safeParse(input)
  if (!p.success) throw invalid('El plazo va en días, entre 30 y 3,650.', 'The period is in days, between 30 and 3,650.')
  const v = p.data
  if (v.isActive && v.afterDays === null) throw invalid('Para encender la regla hace falta el plazo que definió Legal.', 'To turn the rule on you need the period Legal defined.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ after_days: number | null; is_active: boolean }[]>`select after_days, is_active from crm.retention_rules where key = ${key} for update`
    if (!before[0]) throw notFound()
    await tx`update crm.retention_rules set after_days = ${v.afterDays}, is_active = ${v.isActive}, updated_by = ${ctx.user.id}, updated_at = now() where key = ${key}`
    await audit(tx, ctx, 'retention.rule_changed', 'retention_rule', null, null, { key, ...before[0] }, { key, after_days: v.afterDays, is_active: v.isActive })
  })
}

/** Corre una regla encendida ahora. El conteo de lo que tocó queda en la bitácora. */
export async function applyRetention(ctx: Ctx, key: string): Promise<number> {
  ctx.assert('security.manage')
  return withUser(ctx.user.id, async (tx) => (await tx<{ n: number }[]>`select app.retention_apply(${key}) as n`)[0]?.n ?? 0)
}

// ------------------------------------------------------------ SEG-09: solicitudes de titulares
export const REQUEST_KINDS = ['access', 'rectification', 'erasure'] as const
const requestInput = z.object({
  market: z.string().length(2), kind: z.enum(REQUEST_KINDS), subjectName: z.string().trim().min(2).max(160),
  subjectContact: z.string().trim().max(200).optional(), detail: z.string().trim().max(1500).optional(), receivedOn: isoDate,
  contactId: uuid.or(z.literal('')).optional(), leadId: uuid.or(z.literal('')).optional(), assigneeId: uuid.or(z.literal('')).optional(),
})
/** Registra la solicitud de una persona sobre sus datos. El plazo sale de lo que Legal cargó para ese país; si no hay, queda por definir. */
export async function createSubjectRequest(ctx: Ctx, input: z.input<typeof requestInput>): Promise<string> {
  ctx.assert('security.manage')
  const p = requestInput.safeParse(input)
  if (!p.success) throw invalid('La solicitud lleva país, tipo, nombre de la persona y fecha en que llegó.', 'The request needs a country, a type, the person’s name and the date it arrived.')
  const v = p.data
  assertNoProhibited(v.subjectName, v.subjectContact, v.detail)
  return withUser(ctx.user.id, async (tx) => {
    const days = await tx<{ d: number | null }[]>`select (value ->> ${v.market})::int as d from crm.settings where key = 'privacy.due_days'`
    const id = await newId(tx)
    await tx`insert into crm.subject_requests (id, market_code, kind, subject_name, subject_contact, detail, received_on, due_on, contact_id, lead_id, assignee_id, created_by)
             values (${id}, ${v.market}, ${v.kind}, ${v.subjectName}, ${clean(v.subjectContact)}, ${clean(v.detail)}, ${v.receivedOn},
                     ${days[0]?.d ? tx`${v.receivedOn}::date + ${days[0].d}::int` : null}, ${v.contactId || null}, ${v.leadId || null}, ${v.assigneeId || ctx.user.id}, ${ctx.user.id})`
    await audit(tx, ctx, 'subject_request.created', 'subject_request', id, v.market, null, { kind: v.kind, received_on: v.receivedOn, due_days: days[0]?.d ?? null })
    return id
  })
}

const requestUpdate = z.object({
  status: z.enum(['received', 'in_progress', 'done', 'rejected']), resolution: z.string().trim().max(1500).optional(),
  contactId: uuid.or(z.literal('')).optional(), leadId: uuid.or(z.literal('')).optional(),
})
export async function updateSubjectRequest(ctx: Ctx, id: string, input: z.input<typeof requestUpdate>): Promise<void> {
  ctx.assert('security.manage')
  const v = requestUpdate.parse(input)
  assertNoProhibited(v.resolution)
  const closing = v.status === 'done' || v.status === 'rejected'
  if (closing && !clean(v.resolution)) throw invalid('Para cerrar la solicitud escribe qué se hizo o por qué no procede.', 'To close the request write what was done or why it does not apply.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; kind: string; status: string; anonymized_at: Date | null; contact_id: string | null; lead_id: string | null }[]>`
      select market_code, kind, status, anonymized_at, contact_id, lead_id from crm.subject_requests where id = ${id} for update`
    const r = rows[0]
    if (!r) throw notFound()
    if (r.status === 'done' || r.status === 'rejected') throw invalid('Esa solicitud ya está cerrada.', 'That request is already closed.')
    if (v.status === 'done' && r.kind === 'erasure' && !r.anonymized_at) throw invalid('Una solicitud de eliminación se cierra después de anonimizar. Si no procede, ciérrala como "No procede" con el motivo.', 'An erasure request is closed after anonymizing. If it does not apply, close it as "Does not apply" with the reason.')
    await tx`update crm.subject_requests set status = ${v.status}, resolution = ${clean(v.resolution)},
              contact_id = ${v.contactId === undefined ? r.contact_id : v.contactId || null}, lead_id = ${v.leadId === undefined ? r.lead_id : v.leadId || null},
              closed_at = ${closing ? tx`now()` : null}, closed_by = ${closing ? ctx.user.id : null} where id = ${id}`
    await audit(tx, ctx, closing ? 'subject_request.closed' : 'subject_request.updated', 'subject_request', id, r.market_code, { status: r.status }, { status: v.status })
  })
}

/** Lo que CONTIGO guarda de la persona de la solicitud, para entregárselo. La base deja el registro de que se sacó. */
export async function exportSubject(ctx: Ctx, id: string): Promise<Record<string, unknown>> {
  ctx.assert('security.manage')
  return withUser(ctx.user.id, async (tx) => (await tx<{ v: Record<string, unknown> }[]>`select app.subject_export(${uuid.parse(id)}) as v`)[0]!.v)
}

/** Anonimiza a la persona de una solicitud de eliminación en curso: se borra el dato, se conserva el hecho. */
export async function anonymizeSubject(ctx: Ctx, id: string, confirm: string): Promise<number> {
  ctx.assert('security.manage')
  if (confirm.trim().toUpperCase() !== 'ANONIMIZAR' && confirm.trim().toUpperCase() !== 'ANONYMIZE') throw invalid('Para confirmar escribe ANONIMIZAR. No se puede deshacer.', 'To confirm type ANONYMIZE. It cannot be undone.')
  try {
    return await withUser(ctx.user.id, async (tx) => (await tx<{ n: number }[]>`select app.subject_anonymize(${uuid.parse(id)}) as n`)[0]?.n ?? 0)
  } catch (e) {
    if ((e as { code?: string }).code === '22023') throw invalid('Solo se anonimiza una solicitud de eliminación que está en curso y ya tiene ligado el contacto o el lead.', 'Only an erasure request that is in progress and already linked to the contact or lead can be anonymized.')
    throw e
  }
}

// ------------------------------------------------------------ SEG-07: ver como, recertificación
/** Abre "ver como": solo lectura, con motivo y tiempo límite. La base valida el permiso y deja el evento. */
export async function startViewAs(ctx: Ctx, targetId: string, reason: string, minutes: number): Promise<string> {
  ctx.assert('user.view_as')
  const r = z.string().trim().min(10).max(300).safeParse(reason)
  if (!r.success) throw invalid('Escribe para qué necesitas ver como esa persona (10 caracteres o más). Queda en la bitácora.', 'Write why you need to view as that person (10 characters or more). It is logged.')
  assertNoProhibited(r.data)
  if (targetId === ctx.user.id) throw invalid('Elige a otra persona.', 'Choose someone else.')
  try {
    return await withUser(ctx.user.id, async (tx) => (await tx<{ id: string }[]>`select app.view_as_start(${uuid.parse(targetId)}, ${r.data}, ${minutes}) as id`)[0]!.id)
  } catch (e) {
    if ((e as { code?: string }).code === '22023') throw invalid('No se puede ver como esa persona: no tiene acceso vigente.', 'You cannot view as that person: they have no current access.')
    throw e
  }
}

/** Abre una revisión de accesos: una foto de quién tiene qué, para que quien lidera diga qué se mantiene y qué se quita. */
export async function openAccessReview(ctx: Ctx, market: string | null, dueOn: string): Promise<string> {
  ctx.assert('access.manage')
  if (!isoDate.safeParse(dueOn).success) throw invalid('Pon la fecha límite de la revisión.', 'Set the review’s due date.')
  return withUser(ctx.user.id, async (tx) => {
    if ((await tx`select 1 from crm.access_reviews where market_code is not distinct from ${market} and closed_at is null`)[0]) throw invalid('Ya hay una revisión abierta para ese alcance. Ciérrala antes de abrir otra.', 'There is already an open review for that scope. Close it before opening another.')
    const id = await newId(tx)
    await tx`insert into crm.access_reviews (id, market_code, opened_by, due_on) values (${id}, ${market}, ${ctx.user.id}, ${dueOn})`
    const items = await tx`
      insert into crm.access_review_items (review_id, market_code, membership_id, user_id, role, last_active_at)
      select ${id}, m.market_code, m.id, m.user_id, m.role,
             greatest(u.last_seen_at, (select max(e.at) from crm.usage_events e where e.user_id = u.id))
        from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active and not u.is_system
       where m.market_code is not distinct from ${market} and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
      returning id`
    await audit(tx, ctx, 'access_review.opened', 'access_review', id, market, null, { accesses: items.length, due_on: dueOn })
    // A quien lidera el mercado le llega el aviso con el enlace: es quien acusa la revisión.
    if (market) {
      await notifyMany(tx, ctx, await peopleWithRole(tx, market, ['market_lead']), {
        kind: 'access_review', market: null, link: '/admin/seguridad?s=accesos',
        title: [`Te toca revisar los accesos de ${market}`, `It is your turn to review access for ${market}`],
        body: [`Son ${items.length} accesos. Di cuál se mantiene y cuál se quita antes del ${dueOn}, y cierra la revisión.`, `There are ${items.length} accesses. Say which stays and which goes before ${dueOn}, and close the review.`],
      })
    }
    return id
  })
}

export async function decideReviewItem(ctx: Ctx, itemId: string, decision: 'keep' | 'remove', note: string): Promise<void> {
  if (decision !== 'keep' && decision !== 'remove') throw invalid('Elige si el acceso se mantiene o se quita.', 'Choose whether the access stays or goes.')
  assertNoProhibited(note)
  ctx.assert('access.review')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string | null; user_id: string; role: string; closed: boolean }[]>`
      select i.market_code, i.user_id, i.role, r.closed_at is not null as closed from crm.access_review_items i join crm.access_reviews r on r.id = i.review_id where i.id = ${itemId} for update of i`
    const it = rows[0]
    if (!it) throw notFound()
    ctx.assert('access.review', it.market_code)
    // Los accesos sin mercado los acusa quien administra accesos, no quien lidera un mercado.
    if (it.market_code === null && !ctx.can('access.manage')) throw forbidden()
    if (it.closed) throw invalid('Esa revisión ya está cerrada.', 'That review is already closed.')
    if (it.user_id === ctx.user.id) throw invalid('Tu propio acceso lo acusa otra persona.', 'Your own access is confirmed by someone else.')
    await tx`update crm.access_review_items set decision = ${decision}, decided_by = ${ctx.user.id}, decided_at = now(), note = ${clean(note)} where id = ${itemId}`
    await audit(tx, ctx, 'access_review.decided', 'user', it.user_id, it.market_code, null, { role: it.role, decision })
  })
}

/** Cierra la revisión: es el acuse de quien lidera. Solo cierra cuando cada acceso tiene su decisión. */
export async function closeAccessReview(ctx: Ctx, reviewId: string): Promise<{ keep: number; remove: number }> {
  ctx.assert('access.review')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string | null; closed: boolean }[]>`select market_code, closed_at is not null as closed from crm.access_reviews where id = ${reviewId} for update`
    const r = rows[0]
    if (!r) throw notFound()
    ctx.assert('access.review', r.market_code)
    if (r.market_code === null && !ctx.can('access.manage')) throw forbidden()
    if (r.closed) throw invalid('Esa revisión ya está cerrada.', 'That review is already closed.')
    const c = await tx<{ pending: number; keep: number; remove: number }[]>`
      select count(*) filter (where decision is null and user_id <> ${ctx.user.id})::int as pending, count(*) filter (where decision = 'keep')::int as keep,
             count(*) filter (where decision = 'remove')::int as remove from crm.access_review_items where review_id = ${reviewId}`
    if ((c[0]?.pending ?? 0) > 0) throw invalid(`Faltan ${c[0]!.pending} accesos por decidir.`, `${c[0]!.pending} accesses still need a decision.`)
    await tx`update crm.access_reviews set closed_at = now(), closed_by = ${ctx.user.id} where id = ${reviewId}`
    await audit(tx, ctx, 'access_review.closed', 'access_review', reviewId, r.market_code, null, { keep: c[0]!.keep, remove: c[0]!.remove })
    return { keep: c[0]!.keep, remove: c[0]!.remove }
  })
}

// ------------------------------------------------------------ SEG-08: llaves y secretos
const keyMeta = z.object({ ownerId: uuid.or(z.literal('')), expires: isoDate.or(z.literal('')) })
/** Dueño y vencimiento de una llave de API. Una llave vencida deja de valer sola. La rotación (llave nueva, la anterior con fecha de retiro) vive en domain/api-keys.ts. */
export async function setApiClientMeta(ctx: Ctx, id: string, input: z.input<typeof keyMeta>): Promise<void> {
  ctx.assert('integration.operate')
  const v = keyMeta.parse(input)
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ owner_id: string | null; expires: string | null }[]>`
      select owner_id, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD') as expires from crm.api_clients where id = ${id} and revoked_at is null for update`
    if (!before[0]) throw notFound()
    if (v.expires && (await tx<{ ok: boolean }[]>`select ${v.expires}::date > (now() at time zone 'UTC')::date as ok`)[0]?.ok !== true) throw invalid('El vencimiento tiene que ser una fecha futura.', 'The expiry has to be a future date.')
    await tx`update crm.api_clients set owner_id = ${v.ownerId || null}, expires_at = ${v.expires ? tx`(${v.expires}::date + 1)::timestamp at time zone 'UTC'` : null} where id = ${id}`
    await audit(tx, ctx, 'api_client.updated', 'api_client', id, null, before[0], { owner_id: v.ownerId || null, expires: v.expires || null })
  })
}

const secretMeta = z.object({ ownerId: uuid.or(z.literal('')), rotateEveryDays: z.number().int().min(1).max(730).nullable(), lastRotatedOn: isoDate.or(z.literal('')), note: z.string().trim().max(400).optional() })
/** Inventario de secretos de salida: dueño, cada cuánto se rota y cuándo se rotó por última vez. El valor nunca vive aquí. */
export async function setSecretMeta(ctx: Ctx, key: string, input: z.input<typeof secretMeta>): Promise<void> {
  ctx.assert('integration.operate')
  const p = secretMeta.safeParse(input)
  if (!p.success) throw invalid('Revisa quién responde por ella, los días entre rotaciones (1 a 730) y la fecha.', 'Check the owner, the days between rotations (1 to 730) and the date.')
  const v = p.data
  assertNoProhibited(v.note)
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ owner_id: string | null; rotate_every_days: number | null; last_rotated_on: string | null }[]>`
      select owner_id, rotate_every_days, to_char(last_rotated_on, 'YYYY-MM-DD') as last_rotated_on from crm.secret_inventory where key = ${key} for update`
    if (!before[0]) throw notFound()
    if (v.lastRotatedOn && (await tx<{ ok: boolean }[]>`select ${v.lastRotatedOn}::date <= (now() at time zone 'UTC')::date + 1 as ok`)[0]?.ok !== true) throw invalid('La última rotación no puede ser una fecha futura.', 'The last rotation cannot be a future date.')
    await tx`update crm.secret_inventory set owner_id = ${v.ownerId || null}, rotate_every_days = ${v.rotateEveryDays}, last_rotated_on = ${v.lastRotatedOn || null},
              note = ${clean(v.note)}, updated_by = ${ctx.user.id}, updated_at = now() where key = ${key}`
    await audit(tx, ctx, 'secret.updated', 'secret', null, null, { key, ...before[0] }, { key, owner_id: v.ownerId || null, rotate_every_days: v.rotateEveryDays, last_rotated_on: v.lastRotatedOn || null })
  })
}

// ------------------------------------------------------------ SEG-03: alertas, umbrales y copia
export const THRESHOLD_KEYS = ['exports_per_day', 'export_rows_per_day', 'searches_per_hour', 'reveals_per_day', 'api_calls_per_hour', 'api_rows_per_day', 'key_unused_days', 'key_expiring_days'] as const
export type Thresholds = Record<(typeof THRESHOLD_KEYS)[number], number>

export async function setThresholds(ctx: Ctx, input: Record<string, number>): Promise<void> {
  ctx.assert('security.manage')
  const shape = Object.fromEntries(THRESHOLD_KEYS.map((k) => [k, z.number().int().min(1).max(1_000_000)])) as Record<(typeof THRESHOLD_KEYS)[number], z.ZodNumber>
  const p = z.object(shape).safeParse(input)
  if (!p.success) throw invalid('Cada umbral es un número entero mayor que cero.', 'Each threshold is a whole number greater than zero.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ value: Record<string, number> }[]>`select value from crm.settings where key = 'security.thresholds'`
    await tx`select app.security_setting_set('security.thresholds', ${tx.json(p.data)})`
    await audit(tx, ctx, 'security.thresholds_changed', 'security', null, null, before[0]?.value ?? null, p.data)
  })
}

/** Plazo de respuesta a solicitudes de titulares por país, en días. Lo define Legal. */
export async function setDueDays(ctx: Ctx, market: string, days: number | null): Promise<void> {
  ctx.assert('security.manage')
  ctx.market(market)
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)) throw invalid('El plazo va en días, entre 1 y 365.', 'The period is in days, between 1 and 365.')
  await withUser(ctx.user.id, async (tx) => {
    const cur = (await tx<{ value: Record<string, number> }[]>`select value from crm.settings where key = 'privacy.due_days'`)[0]?.value ?? {}
    const next = { ...cur }
    if (days === null) delete next[market]
    else next[market] = days
    await tx`select app.security_setting_set('privacy.due_days', ${tx.json(next)})`
    await audit(tx, ctx, 'security.due_days_changed', 'market', null, market, { days: cur[market] ?? null }, { days })
  })
}

export async function runSecurityScan(ctx: Ctx): Promise<number> {
  ctx.assert('security.manage')
  return withUser(ctx.user.id, async (tx) => (await tx<{ n: number }[]>`select app.security_scan() as n`)[0]?.n ?? 0)
}

export async function acknowledgeAlert(ctx: Ctx, id: string, note: string): Promise<void> {
  ctx.assert('security.manage')
  const n = z.string().trim().min(5).max(300).safeParse(note)
  if (!n.success) throw invalid('Escribe qué revisaste (5 caracteres o más).', 'Write what you checked (5 characters or more).')
  assertNoProhibited(n.data)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ kind: string }[]>`update crm.security_alerts set status = 'acknowledged', ack_by = ${ctx.user.id}, ack_at = now(), ack_note = ${n.data}
      where id = ${id} and status = 'open' returning kind`
    if (!rows[0]) throw notFound()
    await audit(tx, ctx, 'security.alert_acknowledged', 'security_alert', id, null, null, { kind: rows[0].kind, note: n.data })
  })
}

/** Arma los lotes de la copia de la bitácora. Con el destino apagado quedan en la cola como "Canal apagado". */
export async function prepareAuditArchive(ctx: Ctx): Promise<number> {
  ctx.assert('security.manage')
  return withUser(ctx.user.id, async (tx) => (await tx<{ n: number }[]>`select app.audit_archive_prepare(${archiveBatchStatus()}) as n`)[0]?.n ?? 0)
}

// ------------------------------------------------------------ lo que corre por horario (src/server/jobs/seguridad.ts)
const ALERT_TEXT: Record<string, [string, string]> = {
  exports_per_day: ['muchas exportaciones en un día', 'many exports in one day'],
  export_rows_per_day: ['muchas filas exportadas en un día', 'many rows exported in one day'],
  searches_per_hour: ['muchas búsquedas en una hora', 'many searches in one hour'],
  reveals_per_day: ['muchos datos reservados revelados en un día', 'many restricted values revealed in one day'],
  api_calls_per_hour: ['muchas llamadas con una llave en una hora', 'many calls with one key in an hour'],
  api_rows_per_day: ['muchas filas leídas con una llave en un día', 'many rows read with one key in one day'],
  key_expiring: ['una llave está por vencer', 'a key is about to expire'],
  key_unused: ['una llave lleva mucho sin uso', 'a key has gone unused for long'],
  secret_rotation_due: ['la rotación de una conexión está vencida', 'a connection’s rotation is overdue'],
  direct_sql_change: ['datos cambiados por fuera de la aplicación', 'data changed outside the application'],
}

/** Avisa de las alertas nuevas a quien lleva la bitácora (administración completa o su parte Bitácora), una sola vez por alerta. */
export async function notifyNewAlertsTx(tx: Tx): Promise<number> {
  const fresh = await tx<{ id: string; kind: string }[]>`
    update crm.security_alerts set notified_at = now() where status = 'open' and notified_at is null returning id, kind`
  if (fresh.length === 0) return 0
  const people = await tx<{ user_id: string }[]>`
    select distinct m.user_id from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active and not u.is_system
     where m.role = 'admin' and (m.admin_areas is null or 'audit' = any(m.admin_areas)) and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())`
  const actor = (await tx<{ id: string }[]>`select app.system_user_id() as id`)[0]!
  const kinds = [...new Set(fresh.map((f) => f.kind))]
  const list = (i: 0 | 1) => kinds.map((k) => ALERT_TEXT[k]?.[i] ?? k).join('; ')
  await notifyMany(tx, { user: { id: actor.id } }, people.map((p) => p.user_id), {
    kind: 'security_alert', market: null, link: '/admin/seguridad?s=alertas',
    title: [fresh.length === 1 ? 'Hay una alerta de seguridad sin revisar' : `Hay ${fresh.length} alertas de seguridad sin revisar`, fresh.length === 1 ? 'There is a security alert to review' : `There are ${fresh.length} security alerts to review`],
    body: [`Revisa en Seguridad: ${list(0)}.`, `Review under Security: ${list(1)}.`],
  })
  return fresh.length
}

/**
 * SEG-07: quita el acceso a quien el directorio reporta sin cuenta. Lo llama la tarea programada, solo con el adaptador encendido.
 * Nunca deja a CONTIGO sin una administración completa y sin vencimiento.
 */
export async function endAccessByDirectoryTx(tx: Tx, gone: string[]): Promise<number> {
  const rows = await tx<{ user_id: string }[]>`
    update crm.memberships m set valid_to = now() from crm.users u
     where u.id = m.user_id and lower(u.email::text) = any(${gone}::text[]) and not u.is_system and (m.valid_to is null or m.valid_to > now())
       and not (m.role = 'admin' and m.admin_areas is null and not exists (
             select 1 from crm.memberships o join crm.users ou on ou.id = o.user_id and ou.is_active and not ou.is_system
              where o.role = 'admin' and o.admin_areas is null and o.valid_to is null and o.id <> m.id and lower(ou.email::text) <> all(${gone}::text[])))
    returning m.user_id`
  const users = [...new Set(rows.map((r) => r.user_id))]
  for (const id of users) {
    await tx`insert into crm.audit_events (actor_id, action, object, object_id, after)
             values (app.current_user_id(), 'membership.ended_by_directory', 'user', ${id}, ${tx.json({ reason: 'account_not_in_directory' })})`
  }
  return users.length
}
