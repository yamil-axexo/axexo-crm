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
  segment: z.enum(['d2d', 'b2b', 'dealer', 'event', 'orders', 'other']),
  parentId: z.guid().or(z.literal('')).optional(),
  phone: z.string().trim().max(30).optional().default(''),
  locality: z.string().trim().max(120).optional().default(''),
  region: z.string().trim().max(120).optional().default(''),
  territoryId: z.guid().or(z.literal('')).optional(),
  force: z.boolean().optional().default(false),
})

/** DAT-04: antes de crear, se busca el duplicado en todo el mercado. Si aparece, se devuelve y no se crea. */
export async function createAccount(ctx: Ctx, input: z.input<typeof createInput>): Promise<{ id?: string; duplicates?: Duplicate[] }> {
  const parsed = createInput.safeParse(input)
  if (!parsed.success) {
    // El error dice qué campo y por qué, no "revisa los datos".
    const field = String(parsed.error.issues[0]?.path[0] ?? '')
    if (field === 'name') throw invalid('Nombre: escribe entre 2 y 160 letras.', 'Name: enter between 2 and 160 characters.')
    if (field === 'kind') throw invalid('Tipo: elige tienda, cadena, distribuidor u organización.', 'Type: pick store, chain, distributor or organization.')
    if (field === 'segment') throw invalid('Canal: elige una opción de la lista.', 'Channel: pick an option from the list.')
    if (field === 'market') throw invalid('Mercado: elige el mercado del comercio.', 'Market: pick the merchant’s market.')
    if (field === 'phone') throw invalid('Teléfono: hasta 30 caracteres.', 'Phone: up to 30 characters.')
    if (field === 'locality' || field === 'region') throw invalid('Ciudad y estado: hasta 120 letras cada uno.', 'City and state: up to 120 characters each.')
    throw invalid('Revisa nombre, tipo y mercado.', 'Check the name, type and market.')
  }
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
    if (v.territoryId) {
      const ter = await tx`select 1 from crm.territories where id = ${v.territoryId} and market_code = ${v.market} and archived_at is null`
      if (!ter[0]) throw invalid('Ese territorio no es de este mercado.', 'That territory does not belong to this market.')
    }
    const id = await newId(tx)
    // Sin territorio elegido, la base pone el de quien lo crea cuando tiene uno solo en este mercado (0011_distribution).
    await tx`insert into crm.accounts (id, market_code, kind, name, segment, parent_id, owner_id, territory_id, phone, locality, region, country, created_by)
             values (${id}, ${v.market}, ${v.kind}, ${v.name}, ${v.segment}, ${v.parentId || null}, ${ctx.user.id}, ${v.territoryId || null}, ${phone},
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

// Reasignar comercios (uno, una selección o todo un filtro) vive en domain/reparto.ts, con el resto del reparto de cartera.
export { reassignAccounts } from '@/domain/reparto'

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
