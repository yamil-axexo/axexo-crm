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
  kind: z.enum(['organization', 'distributor', 'chain', 'store']).optional().default('store'),
  /** Tipo de cuenta del catálogo (tienda, sucursal, cadena, corporativo, distribuidor, ISO, agregador...). Si viene, manda sobre `kind`. */
  accountType: z.string().trim().max(41).optional().default(''),
  name: z.string().trim().min(2).max(160),
  segment: z.enum(['d2d', 'b2b', 'dealer']),
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
    if (v.territoryId) {
      const ter = await tx`select 1 from crm.territories where id = ${v.territoryId} and market_code = ${v.market} and archived_at is null`
      if (!ter[0]) throw invalid('Ese territorio no es de este mercado.', 'That territory does not belong to this market.')
    }
    // El tipo de cuenta sale del catálogo del mercado y decide el nivel en el árbol. Sin tipo, vale el nivel (camino anterior).
    let kind: string = v.kind
    let accountType: string | null = null
    if (v.accountType) {
      const types = await tx<{ kind: string }[]>`
        select kind from crm.account_types where code = ${v.accountType} and is_active and (market_code is null or market_code = ${v.market})
         order by market_code nulls last limit 1`
      if (types[0]) {
        kind = types[0].kind
        accountType = v.accountType
      } else if (createInput.shape.kind.safeParse(v.accountType).success) kind = v.accountType
      else throw invalid('Ese tipo de cuenta no existe en este mercado.', 'That account type does not exist in this market.')
    }
    const id = await newId(tx)
    // Sin territorio elegido, la base pone el de quien lo crea cuando tiene uno solo en este mercado (0011_distribution).
    await tx`insert into crm.accounts (id, market_code, kind, account_type, name, segment, parent_id, owner_id, territory_id, phone, locality, region, country, created_by)
             values (${id}, ${v.market}, ${kind}, ${accountType}, ${v.name}, ${v.segment}, ${v.parentId || null}, ${ctx.user.id}, ${v.territoryId || null}, ${phone},
                     ${clean(v.locality)}, ${clean(v.region)}, ${v.market}, ${ctx.user.id})`
    if (v.parentId) await tx`insert into crm.account_links (child_id, parent_id, created_by) values (${id}, ${v.parentId}, ${ctx.user.id})`
    await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by) values
      (${id}, ${v.market}, 'origin', 'user', ${ctx.user.id}, ${ctx.user.name}, ${ctx.user.id}),
      (${id}, ${v.market}, 'channel', 'team', ${v.segment}, ${v.segment.toUpperCase()}, ${ctx.user.id}),
      (${id}, ${v.market}, 'owner', 'user', ${ctx.user.id}, ${ctx.user.name}, ${ctx.user.id})`
    await audit(tx, ctx, 'account.created', 'account', id, v.market, null, { kind, account_type: accountType, name: v.name, forced_duplicate: v.force })
    await emit(tx, 'account.created', 'account', id, v.market, { kind })
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
    ctx.assert('account.tree', a.market_code)
    // Quien vende arma el árbol de SUS cuentas: la que mueve y la matriz son suyas. Quien dirige mueve cualquiera de su alcance.
    const manages = ctx.can('account.reassign', a.market_code)
    if (!manages && a.owner_id !== ctx.user.id) throw invalid('Solo puedes mover en el árbol las cuentas que son tuyas.', 'You can only move accounts that are yours in the tree.')
    if (parentId) {
      const p = await tx<{ owner_id: string | null; ancestor_ids: string[] }[]>`
        select owner_id, ancestor_ids from crm.accounts where id = ${parentId} and market_code = ${a.market_code} and kind <> 'store' and archived_at is null`
      if (!p[0]) throw invalid('La cuenta matriz tiene que ser una cadena, un distribuidor, un ISO o un corporativo de este mercado.', 'The parent account must be a chain, a distributor, an ISO or a corporate account in this market.')
      if (!manages && p[0].owner_id !== ctx.user.id) throw invalid('La cuenta matriz también tiene que ser tuya. Si no lo es, pídeselo a quien supervisa.', 'The parent account must be yours too. If it is not, ask your supervisor.')
      // La base también lo impide (crm.account_tree_before); aquí se explica antes de llegar.
      if (parentId === id || p[0].ancestor_ids.includes(id)) throw invalid('Esa cuenta cuelga de esta: no puede ser su matriz.', 'That account sits under this one: it cannot be its parent.')
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

/** Roles de un contacto: los de tienda y los de una cuenta corporativa (dirección, compras, finanzas, tecnología, legal, operación). */
export const CONTACT_ROLES = ['owner', 'decision_maker', 'manager', 'staff', 'billing', 'executive', 'purchasing', 'finance', 'technology', 'legal', 'operations'] as const

const contactInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().max(160).optional().default(''),
  role: z.enum(CONTACT_ROLES),
  locale: z.enum(['es', 'en']).or(z.literal('')).optional().default(''),
  sms: z.boolean().optional().default(false),
  primary: z.boolean().optional().default(false),
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
    // "Móvil que recibe SMS" solo tiene sentido con teléfono; sin teléfono queda sin dato.
    await tx`insert into crm.contacts (id, market_code, full_name, phone, email, preferred_locale, sms_capable, created_by)
             values (${id}, ${a.market_code}, ${v.fullName}, ${phone}, ${clean(v.email)}, ${v.locale || null}, ${phone ? v.sms : null}, ${ctx.user.id})`
    // El primer contacto de una cuenta queda como principal; después, solo si se pide.
    const others = await tx`select 1 from crm.account_contacts where account_id = ${accountId} and valid_to is null limit 1`
    const primary = v.primary || !others[0]
    if (primary) await tx`update crm.account_contacts set is_primary = false where account_id = ${accountId} and is_primary and valid_to is null`
    await tx`insert into crm.account_contacts (account_id, contact_id, market_code, role, is_primary) values (${accountId}, ${id}, ${a.market_code}, ${v.role}, ${primary})`
    await audit(tx, ctx, 'contact.added', 'account', accountId, a.market_code, null, { contact_id: id, role: v.role, primary })
    return id
  })
}
