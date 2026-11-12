import 'server-only'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import { domainList, emailInDomains } from '@/lib/domains'

export const API_SCOPES = ['forms:write', 'events:write', 'metrics:write'] as const

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

/** SEG-08 / AUT-04: la llave se muestra una sola vez; en la base solo queda su hash. */
export async function createApiClient(ctx: Ctx, name: string, scopes: string[]): Promise<{ id: string; key: string }> {
  ctx.assert('integration.operate')
  const v = z.object({ name: z.string().trim().min(3).max(80), scopes: z.array(z.enum(API_SCOPES)).min(1) }).safeParse({ name, scopes })
  if (!v.success) throw invalid('Ponle nombre y al menos un permiso.', 'Give it a name and at least one scope.')
  const key = `ctg_${randomBytes(30).toString('base64url')}`
  return withUser(ctx.user.id, async (tx) => {
    const id = await newId(tx)
    await tx`insert into crm.api_clients (id, name, key_prefix, key_hash, scopes, created_by)
             values (${id}, ${v.data.name}, ${key.slice(0, 8)}, ${hashKey(key)}, ${v.data.scopes}, ${ctx.user.id})`
    await audit(tx, ctx, 'api_client.created', 'api_client', id, null, null, { name: v.data.name, scopes: v.data.scopes })
    return { id, key }
  })
}

export async function revokeApiClient(ctx: Ctx, id: string): Promise<void> {
  ctx.assert('integration.operate')
  await withUser(ctx.user.id, async (tx) => {
    const r = await tx`update crm.api_clients set revoked_at = now() where id = ${id} and revoked_at is null returning id`
    if (!r[0]) throw notFound()
    await audit(tx, ctx, 'api_client.revoked', 'api_client', id, null, null, null)
  })
}

const grant = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops']),
  market: z.string().length(2).or(z.literal('')),
  teamId: z.guid().or(z.literal('')).optional(),
})

/** AUTHZ-02: dar acceso es agregar una membresía; quitarlo es cerrarla con fecha. Nada se borra. */
export async function grantMembership(ctx: Ctx, input: z.input<typeof grant>, allowedDomains: readonly string[]): Promise<void> {
  ctx.assert('config.manage')
  const parsed = grant.safeParse(input)
  if (!parsed.success) throw invalid('Revisa correo, nombre y rol.', 'Check the email, name and role.')
  const v = parsed.data
  const global = v.role === 'admin' || v.role === 'lt'
  if (!global && !v.market) throw invalid('Ese rol necesita un mercado.', 'That role needs a market.')
  if (!emailInDomains(v.email, allowedDomains) && !v.email.endsWith('@contigo.test')) {
    throw invalid(`Solo cuentas de ${domainList(allowedDomains, 'o')}.`, `Only ${domainList(allowedDomains, 'or')} accounts.`)
  }
  await withUser(ctx.user.id, async (tx) => {
    let users = await tx<{ id: string }[]>`select id from crm.users where email = ${v.email}`
    if (!users[0]) users = await tx<{ id: string }[]>`insert into crm.users (email, full_name) values (${v.email}, ${v.fullName}) returning id`
    const userId = users[0]!.id
    const market = global ? null : v.market
    const dup = await tx`select 1 from crm.memberships where user_id = ${userId} and role = ${v.role}
                          and market_code is not distinct from ${market} and (valid_to is null or valid_to > now())`
    if (dup[0]) throw invalid('Esa persona ya tiene ese rol.', 'That person already has that role.')
    await tx`insert into crm.memberships (user_id, market_code, role, team_id) values (${userId}, ${market}, ${v.role}, ${v.teamId || null})`
    await audit(tx, ctx, 'membership.granted', 'user', userId, market, null, { role: v.role, market })
  })
}

export async function endMembership(ctx: Ctx, membershipId: string): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ user_id: string; role: string; market_code: string | null }[]>`
      select user_id, role, market_code from crm.memberships where id = ${membershipId} and valid_to is null for update`
    const m = rows[0]
    if (!m) throw notFound()
    if (m.role === 'admin') {
      const others = await tx<{ n: number }[]>`select count(*)::int as n from crm.memberships m join crm.users u on u.id = m.user_id
        where m.role = 'admin' and m.valid_to is null and not u.is_system and m.id <> ${membershipId}`
      if ((others[0]?.n ?? 0) === 0) throw invalid('Tiene que quedar al menos una persona administradora.', 'At least one admin must remain.')
    }
    await tx`update crm.memberships set valid_to = now() where id = ${membershipId}`
    await audit(tx, ctx, 'membership.ended', 'user', m.user_id, m.market_code, { role: m.role }, null)
  })
}

export async function setRoutingMembers(ctx: Ctx, ruleId: string, memberIds: string[]): Promise<void> {
  ctx.assert('config.manage')
  const ids = z.array(z.guid()).max(50).parse(memberIds)
  await withUser(ctx.user.id, async (tx) => {
    const rules = await tx<{ market_code: string; member_ids: string[] }[]>`select market_code, member_ids from crm.routing_rules where id = ${ruleId} for update`
    const rule = rules[0]
    if (!rule) throw notFound()
    const valid = await tx<{ user_id: string }[]>`select distinct user_id from crm.memberships where user_id = any(${ids}::uuid[])
      and market_code = ${rule.market_code} and role in ('rep','supervisor','market_lead') and (valid_to is null or valid_to > now())`
    if (valid.length !== new Set(ids).size) throw invalid('Solo entran personas que venden en ese mercado.', 'Only people who sell in that market can be added.')
    await tx`update crm.routing_rules set member_ids = ${ids}::uuid[], cursor = 0 where id = ${ruleId}`
    await audit(tx, ctx, 'routing.members_changed', 'routing_rule', ruleId, rule.market_code, { member_ids: rule.member_ids }, { member_ids: ids })
  })
}
