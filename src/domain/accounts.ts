import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit, newId, clean } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import { toE164 } from '@/lib/format'

export type Duplicate = { id: string; name: string; locality: string | null; owner_name: string | null; lifecycle: string; match: 'phone' | 'name' }

const createInput = z.object({
  market: z.string().length(2),
  kind: z.enum(['organization', 'distributor', 'chain', 'store']),
  name: z.string().trim().min(2).max(160),
  segment: z.enum(['d2d', 'b2b', 'dealer']),
  parentId: z.guid().or(z.literal('')).optional(),
  phone: z.string().trim().max(30).optional().default(''),
  locality: z.string().trim().max(120).optional().default(''),
  region: z.string().trim().max(120).optional().default(''),
  force: z.boolean().optional().default(false),
})

/** DAT-04: antes de crear, se busca el duplicado en todo el mercado. Si aparece, se devuelve y no se crea. */
export async function createAccount(ctx: Ctx, input: z.input<typeof createInput>): Promise<{ id?: string; duplicates?: Duplicate[] }> {
  const parsed = createInput.safeParse(input)
  if (!parsed.success) throw invalid('Revisa nombre, tipo y mercado.', 'Check the name, type and market.')
  const v = parsed.data
  ctx.assert('account.create', v.market)
  const market = ctx.market(v.market)
  const phone = v.phone ? toE164(v.phone, market.phoneCc) : null
  if (v.phone && !phone) throw invalid('El teléfono no parece válido.', 'The phone number does not look valid.')
  return withUser(ctx.user.id, async (tx) => {
    if (!v.force) {
      const dups = await tx<Duplicate[]>`select id, name, locality, owner_name, lifecycle, match from app.duplicate_candidates(${v.market}, ${v.name}, ${phone})`
      if (dups.length) return { duplicates: [...dups] }
    }
    if (v.parentId) {
      const p = await tx`select 1 from crm.accounts where id = ${v.parentId} and market_code = ${v.market} and kind <> 'store'`
      if (!p[0]) throw invalid('El padre tiene que ser una cadena o distribuidor de este mercado.', 'The parent must be a chain or distributor in this market.')
    }
    const id = await newId(tx)
    await tx`insert into crm.accounts (id, market_code, kind, name, segment, parent_id, owner_id, phone, locality, region, country, created_by)
             values (${id}, ${v.market}, ${v.kind}, ${v.name}, ${v.segment}, ${v.parentId || null}, ${ctx.user.id}, ${phone},
                     ${clean(v.locality)}, ${clean(v.region)}, ${v.market}, ${ctx.user.id})`
    if (v.parentId) await tx`insert into crm.account_links (child_id, parent_id, created_by) values (${id}, ${v.parentId}, ${ctx.user.id})`
    await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by) values
      (${id}, ${v.market}, 'origin', 'user', ${ctx.user.id}, ${ctx.user.name}, ${ctx.user.id}),
      (${id}, ${v.market}, 'channel', 'team', ${v.segment}, ${v.segment.toUpperCase()}, ${ctx.user.id}),
      (${id}, ${v.market}, 'owner', 'user', ${ctx.user.id}, ${ctx.user.name}, ${ctx.user.id})`
    await audit(tx, ctx, 'account.created', 'account', id, v.market, null, { kind: v.kind, name: v.name, forced_duplicate: v.force })
    await emit(tx, 'account.created', 'account', id, v.market, { kind: v.kind })
    return { id }
  })
}

const editInput = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().max(160).optional().default(''),
  addressLine: z.string().trim().max(200).optional().default(''),
  locality: z.string().trim().max(120).optional().default(''),
  region: z.string().trim().max(120).optional().default(''),
  postalCode: z.string().trim().max(20).optional().default(''),
})

async function loadAccount(tx: Tx, id: string) {
  const rows = await tx<{ id: string; market_code: string; name: string; owner_id: string | null; parent_id: string | null; kind: string; phone: string | null; archived_at: Date | null }[]>`
    select id, market_code, name, owner_id, parent_id, kind, phone, archived_at from crm.accounts where id = ${id} for update`
  if (!rows[0] || rows[0].archived_at) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
  return rows[0]
}

export async function updateAccount(ctx: Ctx, id: string, input: z.input<typeof editInput>): Promise<void> {
  const parsed = editInput.safeParse(input)
  if (!parsed.success) throw invalid('Revisa los datos del comercio.', 'Check the merchant details.')
  const v = parsed.data
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, id)
    ctx.assert('account.edit', a.market_code)
    const phone = v.phone ? toE164(v.phone, ctx.market(a.market_code).phoneCc) : null
    if (v.phone && !phone) throw invalid('El teléfono no parece válido.', 'The phone number does not look valid.')
    if (v.email && !z.string().email().safeParse(v.email).success) throw invalid('El correo no parece válido.', 'The email does not look valid.')
    await tx`update crm.accounts set name = ${v.name}, phone = ${phone}, email = ${clean(v.email)}, address_line = ${clean(v.addressLine)},
              locality = ${clean(v.locality)}, region = ${clean(v.region)}, postal_code = ${clean(v.postalCode)} where id = ${id}`
    await audit(tx, ctx, 'account.updated', 'account', id, a.market_code, { name: a.name }, { name: v.name })
  })
}

/** DAT-01: mover una cuenta en el árbol cierra el vínculo anterior con fecha y abre el nuevo. */
export async function setParent(ctx: Ctx, id: string, parentId: string | null): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, id)
    ctx.assert('account.reassign', a.market_code)
    if (parentId) {
      const p = await tx`select 1 from crm.accounts where id = ${parentId} and market_code = ${a.market_code} and kind <> 'store' and archived_at is null`
      if (!p[0]) throw invalid('El padre tiene que ser una cadena o distribuidor de este mercado.', 'The parent must be a chain or distributor in this market.')
    }
    if (parentId === a.parent_id) return
    await tx`update crm.account_links set valid_to = now() where child_id = ${id} and valid_to is null`
    await tx`update crm.accounts set parent_id = ${parentId} where id = ${id}`
    if (parentId) await tx`insert into crm.account_links (child_id, parent_id, created_by) values (${id}, ${parentId}, ${ctx.user.id})`
    await audit(tx, ctx, 'account.parent_changed', 'account', id, a.market_code, { parent_id: a.parent_id }, { parent_id: parentId })
  })
}

/**
 * CAMPO-03 / CANAL-03: reasignar cartera mueve la cuenta, sus deals abiertos y sus tareas abiertas,
 * y deja la atribución de dueño con fecha efectiva (la anterior se cierra, no se borra).
 */
export async function reassignAccounts(ctx: Ctx, accountIds: string[], toUserId: string): Promise<number> {
  const ids = z.array(z.guid()).min(1).max(500).parse(accountIds)
  return withUser(ctx.user.id, async (tx) => {
    const accs = await tx<{ id: string; market_code: string; owner_id: string | null }[]>`
      select id, market_code, owner_id from crm.accounts where id = any(${ids}::uuid[]) and archived_at is null for update`
    if (accs.length === 0) throw notFound('No encontramos esos comercios.', 'We could not find those merchants.')
    const markets = [...new Set(accs.map((a) => a.market_code))]
    if (markets.length > 1) throw invalid('Reasigna un mercado a la vez.', 'Reassign one market at a time.')
    const market = markets[0]!
    ctx.assert('account.reassign', market)
    const target = await tx<{ full_name: string }[]>`
      select u.full_name from crm.users u join crm.memberships m on m.user_id = u.id
       where u.id = ${toUserId} and u.is_active and m.market_code = ${market} and m.role in ('rep','supervisor','market_lead')
         and (m.valid_to is null or m.valid_to > now()) limit 1`
    if (!target[0]) throw invalid('Esa persona no vende en este mercado.', 'That person does not sell in this market.')
    const moved = accs.filter((a) => a.owner_id !== toUserId).map((a) => a.id)
    if (moved.length === 0) return 0
    await tx`update crm.account_attributions set effective_to = now() where account_id = any(${moved}::uuid[]) and layer = 'owner' and effective_to is null`
    await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by)
             select a.id, a.market_code, 'owner', 'user', ${toUserId}, ${target[0].full_name}, ${ctx.user.id} from crm.accounts a where a.id = any(${moved}::uuid[])`
    await tx`update crm.deals set owner_id = ${toUserId} where account_id = any(${moved}::uuid[]) and status = 'open'`
    await tx`update crm.activities set owner_id = ${toUserId} where account_id = any(${moved}::uuid[]) and kind = 'task' and done_at is null`
    await tx`update crm.accounts set owner_id = ${toUserId} where id = any(${moved}::uuid[])`
    await audit(tx, ctx, 'account.reassigned', 'account', null, market, { count: moved.length }, { to_user_id: toUserId, account_ids: moved.slice(0, 50) })
    await emit(tx, 'account.reassigned', 'user', toUserId, market, { count: moved.length })
    return moved.length
  })
}

/** DAT-04: fusionar no borra. La cuenta duplicada queda archivada y apunta a la que sobrevive. */
export async function mergeAccounts(ctx: Ctx, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw invalid('Elige dos comercios distintos.', 'Pick two different merchants.')
  await withUser(ctx.user.id, async (tx) => {
    const s = await loadAccount(tx, sourceId)
    const t = await loadAccount(tx, targetId)
    ctx.assert('account.merge', s.market_code)
    if (s.market_code !== t.market_code) throw invalid('Solo se fusionan comercios del mismo mercado.', 'Only merchants in the same market can be merged.')
    await tx`update crm.deals set account_id = ${targetId} where account_id = ${sourceId}`
    await tx`update crm.activities set account_id = ${targetId} where account_id = ${sourceId}`
    await tx`update crm.visits set account_id = ${targetId} where account_id = ${sourceId}`
    await tx`update crm.leads set account_id = ${targetId} where account_id = ${sourceId}`
    await tx`update crm.account_contacts set account_id = ${targetId} where account_id = ${sourceId}`
    await tx`update crm.account_aliases set account_id = ${targetId} where account_id = ${sourceId}`
    await tx`update crm.account_attributions set account_id = ${targetId} where account_id = ${sourceId}`
    await tx`update crm.exceptions set resolved_at = now(), resolved_by = ${ctx.user.id}, resolution = 'merged'
              where resolved_at is null and (account_id = ${sourceId} or (kind = 'duplicate_suspect' and account_id = ${targetId}))`
    await tx`update crm.merchant_metrics_daily m set account_id = ${targetId} where account_id = ${sourceId}
              and not exists (select 1 from crm.merchant_metrics_daily x where x.account_id = ${targetId} and x.as_of = m.as_of)`
    await tx`update crm.accounts set parent_id = ${targetId} where parent_id = ${sourceId}`
    await tx`update crm.accounts set merged_into = ${targetId}, archived_at = now(), phone = null where id = ${sourceId}`
    await audit(tx, ctx, 'account.merged', 'account', targetId, s.market_code, { source_id: sourceId, source_name: s.name }, { target_id: targetId })
    await emit(tx, 'account.merged', 'account', targetId, s.market_code, { source_id: sourceId })
  })
}

const contactInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().max(160).optional().default(''),
  role: z.enum(['owner', 'decision_maker', 'manager', 'staff', 'billing']),
})

/** DAT-02: el contacto se liga a la cuenta con rol y vigencia. */
export async function addContact(ctx: Ctx, accountId: string, input: z.input<typeof contactInput>): Promise<string> {
  const parsed = contactInput.safeParse(input)
  if (!parsed.success) throw invalid('Revisa nombre y rol del contacto.', 'Check the contact name and role.')
  const v = parsed.data
  return withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, accountId)
    ctx.assert('account.edit', a.market_code)
    const phone = v.phone ? toE164(v.phone, ctx.market(a.market_code).phoneCc) : null
    if (v.phone && !phone) throw invalid('El teléfono no parece válido.', 'The phone number does not look valid.')
    if (v.email && !z.string().email().safeParse(v.email).success) throw invalid('El correo no parece válido.', 'The email does not look valid.')
    const id = await newId(tx)
    await tx`insert into crm.contacts (id, market_code, full_name, phone, email, created_by) values (${id}, ${a.market_code}, ${v.fullName}, ${phone}, ${clean(v.email)}, ${ctx.user.id})`
    await tx`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${accountId}, ${id}, ${a.market_code}, ${v.role})`
    await audit(tx, ctx, 'contact.added', 'account', accountId, a.market_code, null, { contact_id: id, role: v.role })
    return id
  })
}
