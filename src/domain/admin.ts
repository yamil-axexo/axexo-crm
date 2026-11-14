import 'server-only'
import { recordSeatAtGrant, SEAT_MISSING, seatFields } from '@/domain/seats'
import { assertRolloutAllows } from '@/domain/rollout'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { forbidden, invalid, notFound } from '@/lib/errors'
import { domainList, emailInDomains } from '@/lib/domains'
import { assertNoProhibited } from '@/domain/guard'
import { notify } from '@/domain/notify'
import { ROLE_LABEL } from '@/domain/policy'

/** Lo que una etapa puede pedir para dejar entrar un negocio. El próximo paso con fecha lo pide toda etapa abierta, siempre. */
export const STAGE_REQUIREMENTS = ['amount', 'decision_maker', 'next_step'] as const

export const API_SCOPES = ['forms:write', 'events:write', 'metrics:write'] as const

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

// Las llaves se crean y se rotan en src/domain/api-keys.ts (una sola función para llaves de lectura y de escritura).
/** Revocar: la llave deja de servir en ese instante y no se reactiva. */
export async function revokeApiClient(ctx: Ctx, id: string): Promise<void> {
  ctx.assert('integration.operate')
  await withUser(ctx.user.id, async (tx) => {
    const r = await tx`update crm.api_clients set revoked_at = now() where id = ${id} and revoked_at is null returning id`
    if (!r[0]) throw notFound()
    await audit(tx, ctx, 'api_client.revoked', 'api_client', id, null, null, null)
  })
}

const SALES_ROLES = ['rep', 'supervisor', 'market_lead', 'kam'] as const
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const grant = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  // reportes2: Finanzas (solo lectura de sus reportes) y KAM (cuentas clave) se dan como cualquier rol de mercado.
  role: z.enum(['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops', 'finance', 'kam']),
  market: z.string().length(2).or(z.literal('')),
  teamId: z.guid().or(z.literal('')).optional(),
  // "Vence el": el rol vale hasta el final de ese día y deja de valer solo, sin que nadie lo quite.
  expires: isoDate.or(z.literal('')).optional(),
  // Administración no se da por descuido: quien la otorga confirma que sabe lo que el rol permite.
  confirmAdmin: z.boolean().optional(),
  // E4.F9 (datos2): el asiento aprobado va antes del acceso.
  ...seatFields,
})

export type GrantResult = { userId: string; supervisorWithoutTeam: boolean; expires: string | null }

/**
 * El día que vence un acceso termina a la medianoche del mercado del rol. Administración y Leadership no tienen
 * mercado: su día termina a la medianoche UTC (las 8 de la noche en Puerto Rico, las 6 de la tarde en Ciudad de México).
 */
const endOfDay = (tx: Tx, date: string, market: string | null) =>
  tx`((${date}::date + 1)::timestamp at time zone coalesce((select mk.timezone from crm.markets mk where mk.code = ${market}), 'UTC'))`

async function assertFutureDay(tx: Tx, date: string, market: string | null): Promise<void> {
  const ok = await tx<{ ok: boolean }[]>`select ${date}::date >= ${marketToday(tx, market ?? '')} and ${date}::date <= ${marketToday(tx, market ?? '')} + 1830 as ok`
  if (!ok[0]?.ok) throw invalid('La fecha de vencimiento tiene que ser de hoy en adelante.', 'The expiry date has to be today or later.')
}

/** AUTHZ-02: dar acceso es agregar una membresía; quitarlo es cerrarla con fecha. Nada se borra. */
export async function grantMembership(ctx: Ctx, input: z.input<typeof grant>, allowedDomains: readonly string[]): Promise<void> {
  await grantAccess(ctx, input, allowedDomains)
}

/** Lo mismo que `grantMembership`, y además dice qué quedó: a quién, si vence y si la supervisión quedó sin equipo. */
export async function grantAccess(ctx: Ctx, input: z.input<typeof grant>, allowedDomains: readonly string[]): Promise<GrantResult> {
  ctx.assert('access.manage')
  const parsed = grant.safeParse(input)
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => String(i.path[0]).startsWith('seat'))) throw invalid(...SEAT_MISSING)
    throw invalid('Revisa correo, nombre, rol y fecha de vencimiento.', 'Check the email, name, role and expiry date.')
  }
  const v = parsed.data
  const global = v.role === 'admin' || v.role === 'lt'
  if (!global && !v.market) throw invalid('Ese rol necesita un mercado.', 'That role needs a market.')
  if (!emailInDomains(v.email, allowedDomains) && !v.email.endsWith('@contigo.test')) {
    throw invalid(
      `Ese dominio no está admitido. La persona necesita una cuenta de ${domainList(allowedDomains, 'o')}. Para darle acceso con otro correo, quien administra CONTIGO tiene que pedirle esa cuenta a quien administra las cuentas de Google de la empresa.`,
      `That domain is not allowed. The person needs a ${domainList(allowedDomains, 'or')} account. To give access to anyone else, whoever administers CONTIGO has to ask the person who manages the company’s Google accounts for that account.`,
    )
  }
  // Solo la administración completa da Administración: quien administra una parte no se da (ni da) más poder.
  if (v.role === 'admin' && !ctx.isAdmin) throw forbidden()
  if (v.role === 'admin' && !v.confirmAdmin) {
    throw invalid(
      'Administración ve y cambia todo, en todos los mercados: da y quita accesos, crea llaves de API y cambia la configuración. Marca la casilla para confirmar que se la quieres dar.',
      'Administration sees and changes everything, in every market: it grants and removes access, creates API keys and changes the configuration. Tick the box to confirm you want to grant it.',
    )
  }
  return withUser(ctx.user.id, async (tx) => {
    let users = await tx<{ id: string }[]>`select id from crm.users where email = ${v.email}`
    if (!users[0]) users = await tx<{ id: string }[]>`insert into crm.users (email, full_name) values (${v.email}, ${v.fullName}) returning id`
    const userId = users[0]!.id
    const market = global ? null : v.market
    const teamId = global ? null : v.teamId || null
    if (teamId) {
      // Un equipo es de un mercado: no se arma un equipo con gente de otro.
      const team = await tx`select 1 from crm.teams where id = ${teamId} and market_code is not distinct from ${market}`
      if (!team[0]) throw invalid('Ese equipo es de otro mercado.', 'That team belongs to another market.')
    }
    const dup = await tx`select 1 from crm.memberships where user_id = ${userId} and role = ${v.role}
                          and market_code is not distinct from ${market} and (valid_to is null or valid_to > now())`
    if (dup[0]) throw invalid('Esa persona ya tiene ese rol.', 'That person already has that role.')
    const expires = v.expires || null
    if (expires) await assertFutureDay(tx, expires, market)
    // E18.F2: con "primero quienes lideran" activo en el mercado, Ventas entra solo si la persona es clave.
    await assertRolloutAllows(tx, market, v.role, v.email)
    const mem = await tx<{ id: string }[]>`insert into crm.memberships (user_id, market_code, role, team_id, valid_to)
             values (${userId}, ${market}, ${v.role}, ${teamId}, ${expires ? endOfDay(tx, expires, market) : null}) returning id`
    await recordSeatAtGrant(tx, ctx, mem[0]!.id, userId, market, v.role, v)
    // Dar Administración deja escrito el alcance que se confirmó, si el correo es de otro dominio que el de quien la da y si tiene fecha de fin.
    const at = (e: string) => e.slice(e.lastIndexOf('@') + 1).toLowerCase()
    await audit(tx, ctx, 'membership.granted', 'user', userId, market, null, {
      role: v.role, market, team_id: teamId, expires,
      ...(v.role === 'admin' ? { scope: 'all_markets', confirmed: true, external: at(v.email) !== at(ctx.user.email) } : {}),
    })
    // SEG-07: la persona se entera de que recibió el acceso (dentro de CONTIGO; por correo cuando ese canal se encienda).
    if (userId !== ctx.user.id) {
      await notify(tx, ctx, {
        // El aviso es de la persona, no del mercado: así también lo puede dejar quien administra solo la parte Accesos.
        to: userId, kind: 'access_granted', market: null, link: '/bienvenida',
        title: [`Tienes acceso a CONTIGO como ${ROLE_LABEL[v.role].es}${market ? ` en ${market}` : ''}`, `You have access to CONTIGO as ${ROLE_LABEL[v.role].en}${market ? ` in ${market}` : ''}`],
        body: [`Te lo dio ${ctx.user.name}. Si no lo esperabas, avisa a Administración.`, `${ctx.user.name} gave it to you. If you were not expecting it, tell Administration.`],
      })
    }
    return { userId, supervisorWithoutTeam: v.role === 'supervisor' && !teamId, expires }
  })
}

/** Poner, mover o quitar la fecha en que un acceso deja de valer. La última administración sin fecha no puede quedar con vencimiento. */
export async function setMembershipExpiry(ctx: Ctx, membershipId: string, expires: string | null): Promise<void> {
  ctx.assert('access.manage')
  const date = expires ? isoDate.safeParse(expires) : null
  if (date && !date.success) throw invalid('Esa fecha no es válida.', 'That date is not valid.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ user_id: string; role: string; market_code: string | null; expires: string | null }[]>`
      select m.user_id, m.role, m.market_code,
             to_char((m.valid_to at time zone coalesce((select mk.timezone from crm.markets mk where mk.code = m.market_code), 'UTC')) - interval '1 second', 'YYYY-MM-DD') as expires
        from crm.memberships m where m.id = ${membershipId} and (m.valid_to is null or m.valid_to > now()) for update`
    const m = rows[0]
    if (!m) throw notFound()
    if (m.role === 'admin' && !ctx.isAdmin) throw forbidden()
    if (expires) {
      await assertFutureDay(tx, expires, m.market_code)
      if (m.role === 'admin') await assertAnotherPermanentAdmin(tx, membershipId)
    }
    await tx`update crm.memberships set valid_to = ${expires ? endOfDay(tx, expires, m.market_code) : null} where id = ${membershipId}`
    await audit(tx, ctx, 'membership.expiry_changed', 'user', m.user_id, m.market_code, { role: m.role, expires: m.expires }, { role: m.role, expires })
  })
}

/** Siempre queda al menos una persona administradora cuyo acceso no vence: si no, un día nadie podría administrar. */
async function assertAnotherPermanentAdmin(tx: Tx, exceptMembershipId: string): Promise<void> {
  const others = await tx<{ n: number }[]>`select count(*)::int as n from crm.memberships m join crm.users u on u.id = m.user_id
    where m.role = 'admin' and m.admin_areas is null and m.valid_to is null and u.is_active and not u.is_system and m.id <> ${exceptMembershipId}`
  if ((others[0]?.n ?? 0) === 0) {
    throw invalid('Tiene que quedar al menos una persona administradora sin fecha de vencimiento.', 'At least one admin with no expiry date must remain.')
  }
}

const teamInput = z.object({
  market: z.string().length(2),
  name: z.string().trim().min(2).max(60),
  motor: z.enum(['d2d', 'b2b', 'dealer', 'event', 'orders', 'other']),
})

/** Un equipo agrupa a quienes venden juntos bajo una supervisión. Quien supervisa ve lo de su equipo. */
export async function createTeam(ctx: Ctx, input: z.input<typeof teamInput>): Promise<string> {
  ctx.assert('access.manage')
  const parsed = teamInput.safeParse(input)
  if (!parsed.success) throw invalid('Un equipo lleva mercado, nombre y tipo de venta.', 'A team needs a market, a name and a sale type.')
  const v = parsed.data
  return withUser(ctx.user.id, async (tx) => {
    const mk = await tx`select 1 from crm.markets where code = ${v.market}`
    if (!mk[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    const dup = await tx`select 1 from crm.teams where market_code = ${v.market} and lower(name) = lower(${v.name})`
    if (dup[0]) throw invalid('Ya hay un equipo con ese nombre en ese mercado.', 'There is already a team with that name in that market.')
    const rows = await tx<{ id: string }[]>`insert into crm.teams (market_code, name, motor) values (${v.market}, ${v.name}, ${v.motor}) returning id`
    await audit(tx, ctx, 'team.created', 'team', rows[0]!.id, v.market, null, { name: v.name, motor: v.motor })
    return rows[0]!.id
  })
}

export type EndResult = {
  userId: string
  name: string
  /** Mercado del rol que se quitó; null si era un rol global (Administración, Leadership). */
  market: string | null
  removedFrom: string[]
  fallbackOf: string[]
  accounts: number
  deals: number
  leads: number
  /**
   * Con este rol se fue el último con el que la persona contaba como dueña vigente en ese mercado (ventas, supervisión,
   * líder u operaciones): lo que tiene a su nombre quedó sin dueño vigente y lo ve supervisión para repartirlo.
   */
  vacant: boolean
}

/**
 * Quitar un acceso cierra la membresía hoy. Si con eso la persona deja de vender en el mercado, sale en la misma
 * operación de todos los turnos de leads de ese mercado y deja de ser el respaldo de cualquiera de ellos.
 * Sus comercios, negocios y leads siguen a su nombre: la respuesta dice cuántos son y si quedaron sin dueño vigente,
 * con la misma cuenta que muestra Mi equipo en "Sin dueño vigente", para mandarlos a repartir.
 */
export async function endMembership(ctx: Ctx, membershipId: string): Promise<EndResult> {
  ctx.assert('access.manage')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ user_id: string; role: string; market_code: string | null; team_id: string | null; full_name: string }[]>`
      select m.user_id, m.role, m.market_code, m.team_id, u.full_name from crm.memberships m join crm.users u on u.id = m.user_id
       where m.id = ${membershipId} and (m.valid_to is null or m.valid_to > now()) for update of m`
    const m = rows[0]
    if (!m) throw notFound()
    if (m.role === 'admin' && !ctx.isAdmin) throw forbidden()
    if (m.role === 'admin') await assertAnotherPermanentAdmin(tx, membershipId)
    await tx`update crm.memberships set valid_to = now() where id = ${membershipId}`

    const removedFrom: string[] = []
    const fallbackOf: string[] = []
    const rules = await tx<{ id: string; name: string; market_code: string; member_ids: string[]; cursor: number; fallback_id: string | null }[]>`
      select r.id, r.name, r.market_code, r.member_ids, r.cursor, r.fallback_id from crm.routing_rules r
       where (${m.user_id}::uuid = any(r.member_ids) or r.fallback_id = ${m.user_id})
         and not app.can_sell_in(${m.user_id}, r.market_code)
       order by r.name for update`
    for (const r of rules) {
      const members = r.member_ids.filter((id) => id !== m.user_id)
      const cursor = keepTurn(r.member_ids, r.cursor, members)
      const fallback = r.fallback_id === m.user_id ? null : r.fallback_id
      await tx`update crm.routing_rules set member_ids = ${members}::uuid[], cursor = ${cursor}, fallback_id = ${fallback} where id = ${r.id}`
      await audit(tx, ctx, 'routing.members_changed', 'routing_rule', r.id, r.market_code,
        { member_ids: r.member_ids, fallback_id: r.fallback_id }, { member_ids: members, fallback_id: fallback, reason: 'access_removed' })
      if (members.length !== r.member_ids.length) removedFrom.push(r.name)
      if (fallback !== r.fallback_id) fallbackOf.push(r.name)
    }
    const owned = await ownedOpen(tx, m.user_id, m.market_code)
    // Un rol global no decide quién es dueño vigente: quitarlo no cambia lo que Mi equipo muestra en ningún mercado.
    const left = m.market_code
      ? await tx<{ vacant: boolean }[]>`
          select ${m.role} = any(app.owner_roles())
                 and not ((${m.market_code}::text || ':' || ${m.user_id}::text) = any(app.owner_keys(array[${m.market_code}]::text[]))) as vacant`
      : []
    const vacant = (left[0]?.vacant ?? false) && owned.accounts + owned.deals + owned.leads > 0
    await audit(tx, ctx, 'membership.ended', 'user', m.user_id, m.market_code, { role: m.role, market: m.market_code, team_id: m.team_id },
      { removed_from_rules: removedFrom, fallback_cleared: fallbackOf, ...owned, no_current_owner: vacant })
    return { userId: m.user_id, name: m.full_name, market: m.market_code, removedFrom, fallbackOf, ...owned, vacant }
  })
}

/** Lo que una persona tiene a su nombre y sigue abierto, en un mercado o en todos (rol global). */
async function ownedOpen(tx: Tx, userId: string, market: string | null): Promise<{ accounts: number; deals: number; leads: number }> {
  const scope = market ? tx`and market_code = ${market}` : tx``
  const rows = await tx<{ accounts: number; deals: number; leads: number }[]>`
    select (select count(*)::int from crm.accounts where owner_id = ${userId} and archived_at is null ${scope}) as accounts,
           (select count(*)::int from crm.deals where owner_id = ${userId} and status = 'open' ${scope}) as deals,
           (select count(*)::int from crm.leads where owner_id = ${userId} and status in ('new','contacted','qualified') ${scope}) as leads`
  return rows[0]!
}

/**
 * Al cambiar quién está en un turno, el turno sigue donde iba: le toca a la misma persona que seguía, o a la
 * siguiente que quede si esa salió. Antes, guardar el turno lo regresaba a la primera persona sin avisar.
 */
export function keepTurn(before: string[], cursor: number, after: string[]): number {
  if (before.length === 0 || after.length === 0) return 0
  for (let i = 0; i < before.length; i++) {
    const at = after.indexOf(before[(cursor + i) % before.length]!)
    if (at >= 0) return at
  }
  return 0
}

export async function setRoutingMembers(ctx: Ctx, ruleId: string, memberIds: string[]): Promise<void> {
  ctx.assert('config.manage')
  const ids = [...new Set(z.array(z.guid()).max(50).parse(memberIds))]
  await withUser(ctx.user.id, async (tx) => {
    const rules = await tx<{ market_code: string; member_ids: string[]; cursor: number }[]>`select market_code, member_ids, cursor from crm.routing_rules where id = ${ruleId} for update`
    const rule = rules[0]
    if (!rule) throw notFound()
    const valid = await tx<{ user_id: string }[]>`select distinct user_id from crm.memberships where user_id = any(${ids}::uuid[])
      and market_code = ${rule.market_code} and role = any(${[...SALES_ROLES]}::text[]) and valid_from <= now() and (valid_to is null or valid_to > now())`
    if (valid.length !== ids.length) throw invalid('Solo entran personas que venden en ese mercado.', 'Only people who sell in that market can be added.')
    // El orden del turno se conserva: quienes ya estaban quedan donde estaban y quienes entran van al final.
    const ordered = [...rule.member_ids.filter((id) => ids.includes(id)), ...ids.filter((id) => !rule.member_ids.includes(id))]
    await tx`update crm.routing_rules set member_ids = ${ordered}::uuid[], cursor = ${keepTurn(rule.member_ids, rule.cursor, ordered)} where id = ${ruleId}`
    await audit(tx, ctx, 'routing.members_changed', 'routing_rule', ruleId, rule.market_code, { member_ids: rule.member_ids }, { member_ids: ordered })
  })
}

const stageInput = z.object({
  nameEs: z.string().trim().min(2).max(60),
  nameEn: z.string().trim().min(2).max(60),
  rotDays: z.number().int().min(0).max(365),
  requiredFields: z.array(z.enum(STAGE_REQUIREMENTS)).max(STAGE_REQUIREMENTS.length),
  /** Campos definidos del negocio que la etapa pide para entrar (claves). Sin mandarlo, los que ya pedía se conservan. */
  requiredCustom: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/)).max(60).optional(),
  /** Lo que la etapa destaca sin exigirlo: 'amount', 'decision_maker', 'next_step' o 'field:<clave>'. Sin mandarlo, no cambia. */
  highlight: z.array(z.string().regex(/^(amount|decision_maker|next_step|field:[a-z][a-z0-9_]{1,40})$/)).max(60).optional(),
})

/**
 * Lo que administración cambia de una etapa: cómo se llama en cada idioma, a los cuántos días se considera estancada
 * (0 = nunca) y qué tiene que traer un negocio para entrar. Tipo, orden y probabilidad no se tocan aquí.
 * La importación de Pipedrive respeta una etapa editada (`edited_at`): no le vuelve a poner el nombre en inglés.
 */
export async function updateStage(ctx: Ctx, stageId: string, input: z.input<typeof stageInput>): Promise<void> {
  ctx.assert('config.manage')
  const parsed = stageInput.safeParse(input)
  if (!parsed.success) throw invalid('La etapa lleva nombre en español y en inglés, y días entre 0 y 365.', 'A stage needs a name in Spanish and in English, and days between 0 and 365.')
  const v = parsed.data
  assertNoProhibited(v.nameEs, v.nameEn)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ pipeline_id: string; market_code: string; motor: string; kind: string; name_es: string; name_en: string; rot_days: number; required_fields: string[]; highlight_fields: string[] }[]>`
      select s.pipeline_id, p.market_code, p.motor, s.kind, s.name_es, s.name_en, s.rot_days, s.required_fields, s.highlight_fields
        from crm.stages s join crm.pipelines p on p.id = s.pipeline_id where s.id = ${stageId} for update of s`
    const s = rows[0]
    if (!s) throw notFound()
    const closing = s.kind === 'won' || s.kind === 'lost'
    // Una etapa de cierre no se estanca ni pide nada para entrar: ganar y perder tienen sus propias reglas.
    const rotDays = closing ? 0 : v.rotDays
    // En una etapa abierta el próximo paso se pide siempre (ACT-02): no depende de esta lista y aquí no se cambia.
    // Lo que esta pantalla no ofrece (líneas de producto, un campo adicional del negocio) se conserva: editar el nombre no lo borra.
    // La etapa puede pedir o destacar cualquier campo definido del negocio (de su mercado y su tipo de venta). Un campo que ya
    // pedía y que la pantalla no ofrece (está retirado, o es 'items') se conserva: editar la etapa no lo borra.
    const offered = new Set((await tx<{ key: string }[]>`
      select key from crm.field_definitions where object = 'deal' and is_active and data_class <> 'confidential'
         and (market_code is null or market_code = ${s.market_code}) and (motor is null or motor = ${s.motor})`).map((r) => r.key))
    const unknown = [...(v.requiredCustom ?? []), ...(v.highlight ?? []).filter((x) => x.startsWith('field:')).map((x) => x.slice(6))].find((k) => !offered.has(k))
    if (unknown) throw invalid('Ese campo no está definido para los negocios de este embudo.', 'That field is not defined for deals in this pipeline.')
    const kept = s.required_fields.filter((f) => !(STAGE_REQUIREMENTS as readonly string[]).includes(f) && (v.requiredCustom === undefined || !f.startsWith('field:') || !offered.has(f.slice(6))))
    const custom = (v.requiredCustom ?? []).map((k) => `field:${k}`)
    const required = closing ? [] : [...new Set([...STAGE_REQUIREMENTS.filter((f) => (f === 'next_step' && s.kind === 'open' ? s.required_fields.includes(f) : v.requiredFields.includes(f))), ...kept, ...custom])]
    // Lo que ya es requisito no hace falta destacarlo: se quita de los destacados para no decir dos veces lo mismo.
    const highlight = closing ? [] : v.highlight === undefined ? s.highlight_fields : [...new Set(v.highlight)].filter((x) => !required.includes(x))
    const before = { name_es: s.name_es, name_en: s.name_en, rot_days: s.rot_days, required_fields: [...s.required_fields].sort(), ...(v.highlight === undefined ? {} : { highlight_fields: [...s.highlight_fields].sort() }) }
    const after = { name_es: v.nameEs, name_en: v.nameEn, rot_days: rotDays, required_fields: [...required].sort(), ...(v.highlight === undefined ? {} : { highlight_fields: [...highlight].sort() }) }
    if (JSON.stringify(before) === JSON.stringify(after)) return
    const clash = await tx`select 1 from crm.stages where pipeline_id = ${s.pipeline_id} and id <> ${stageId}
      and (lower(name_es) = lower(${v.nameEs}) or lower(name_en) = lower(${v.nameEn}))`
    if (clash[0]) throw invalid('Ya hay otra etapa con ese nombre en este embudo.', 'There is already another stage with that name in this pipeline.')
    await tx`update crm.stages set name_es = ${v.nameEs}, name_en = ${v.nameEn}, rot_days = ${rotDays}, required_fields = ${required}::text[],
              highlight_fields = ${highlight}::text[], edited_at = now(), edited_by = ${ctx.user.id} where id = ${stageId}`
    await audit(tx, ctx, 'stage.updated', 'stage', stageId, s.market_code, before, after)
  })
}

/** Deja escrito quién probó una integración desde Administración: el mensaje de prueba entra con identidad de sistema. */
export async function recordSimulation(ctx: Ctx, kind: 'visit' | 'store' | 'metrics', key: string, market: string | null): Promise<void> {
  ctx.assert('integration.operate')
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'integration.simulated', 'integration', null, market, null, { kind, key }))
}
