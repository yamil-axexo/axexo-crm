import 'server-only'
import { applyTerritoryOwners } from '@/domain/mx-config'
import { z } from 'zod'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit, newId, clean } from '@/domain/common'
import { DomainError, invalid, notFound } from '@/lib/errors'
import { assertNoProhibited } from '@/domain/guard'
import { toE164 } from '@/lib/format'
import { accountRule, intakeError } from '@/domain/intake'
import { notifyMany, peopleWithRole } from '@/domain/notify'
import { resolveRecruiter } from '@/domain/store-record'
import { checkTaxId, TAX_ID_TYPES } from '@/lib/tax-id'
import { blindIndex } from '@/server/adapters/markets'

/** `strong`: coincide una llave fuerte exacta (teléfono, correo, identificador externo, o nombre más dirección). */
export type Duplicate = { id: string; name: string; locality: string | null; owner_name: string | null; lifecycle: string; match: 'phone' | 'email' | 'external_id' | 'name_address' | 'name'; strong: boolean }

const createInput = z.object({
  market: z.string().length(2),
  kind: z.enum(['organization', 'distributor', 'chain', 'store']).optional().default('store'),
  /** Tipo de cuenta del catálogo (tienda, sucursal, cadena, corporativo, distribuidor, ISO, agregador...). Si viene, manda sobre `kind`. */
  accountType: z.string().trim().max(41).optional().default(''),
  name: z.string().trim().min(2).max(160),
  segment: z.enum(['d2d', 'b2b', 'dealer', 'event', 'orders', 'other']),
  parentId: z.guid().or(z.literal('')).optional(),
  phone: z.string().trim().max(30).optional().default(''),
  locality: z.string().trim().max(120).optional().default(''),
  region: z.string().trim().max(120).optional().default(''),
  territoryId: z.guid().or(z.literal('')).optional(),
  email: z.string().trim().max(160).optional().default(''),
  addressLine: z.string().trim().max(200).optional().default(''),
  /** El identificador que el comercio ya tiene en otro sistema, si quien captura lo conoce: también es llave de duplicado. */
  externalId: z.string().trim().max(80).optional().default(''),
  /** E9.F12 (mercados con ficha de dealer): quién reclutó la tienda. 'field_team' o el id de una agencia o socio. Vacío: el equipo propio. */
  recruitedBy: z.string().trim().max(40).optional().default(''),
  /** DAT-04: el identificador fiscal, si quien captura lo tiene a la mano. Aquí solo sirve para buscar el duplicado (por su huella); se registra en la ficha. */
  taxId: z.string().trim().max(40).optional().default(''),
  /** DAT-04: coordenadas, si las manda la Sales App o el teléfono. Opcionales: sin ellas no hay llave de ubicación. */
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  force: z.boolean().optional().default(false),
  /** Por qué se crea aunque se parezca a uno que ya existe. Sin motivo, el aviso no se salta. */
  reason: z.string().trim().max(400).optional().default(''),
})

export type NewAccount = {
  market: string; kind: string; accountType: string | null; name: string; segment: string; lifecycle: 'prospect' | 'onboarding'; parentId: string | null
  ownerId: string | null; territoryId: string | null; phone: string | null; locality: string | null; region: string | null; createdBy: string
  email?: string | null; addressLine?: string | null
  /** E9.F12: quién la reclutó, fijo desde el alta. Sin dato, queda por definir (lo fija después quien dirige, una vez). */
  recruitedBy?: 'field_team' | 'agency' | 'partner' | null; recruitedAgencyId?: string | null
}

/**
 * AUT-01: el alta de un comercio, una sola vez. La usan la pantalla (`createAccount`) y la Sales App (`ingestStore`):
 * las dos pasan por las mismas reglas de entrada antes de escribir.
 */
export async function insertAccountTx(tx: Tx, a: NewAccount): Promise<string> {
  const broken = accountRule({ name: a.name, phone: a.phone })
  if (broken) throw intakeError(broken)
  const id = await newId(tx)
  // E9.F5: en un mercado con ficha de dealer, una tienda que nace aquí (pantalla, Sales App, archivo) es un alta nueva. Se fija una vez.
  await tx`insert into crm.accounts (id, market_code, kind, account_type, name, segment, lifecycle, parent_id, owner_id, territory_id, phone, email, address_line, locality, region, country, created_by,
                                     recruited_by, recruited_agency_id, merchant_origin)
           values (${id}, ${a.market}, ${a.kind}, ${a.accountType}, ${a.name.trim()}, ${a.segment}, ${a.lifecycle}, ${a.parentId}, ${a.ownerId}, ${a.territoryId}, ${a.phone},
                   ${a.email ?? null}, ${a.addressLine ?? null}, ${a.locality}, ${a.region}, ${a.market}, ${a.createdBy}, ${a.recruitedBy ?? null}, ${a.recruitedAgencyId ?? null},
                   (select 'new_acquisition' from crm.markets m where m.code = ${a.market} and ${a.kind} = 'store' and coalesce((m.flags ->> 'dealer_record')::boolean, false)))`
  return id
}

/** Huellas del identificador fiscal escrito, probado contra cada tipo conocido: solo para comparar, nunca se guarda el texto. */
function taxBlinds(raw: string): string[] {
  if (!raw.trim()) return []
  return TAX_ID_TYPES.filter((x) => x.type !== 'other').map((x) => ({ type: x.type, check: checkTaxId(x.type, raw) })).filter((x) => x.check.formatOk)
    .map((x) => blindIndex(x.type, x.check.normalized)).filter((b): b is string => b !== null)
}

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
  if (v.email && !z.string().email().safeParse(v.email).success) throw invalid('El correo no parece válido.', 'The email does not look valid.')
  assertNoProhibited(v.reason, v.externalId)
  return withUser(ctx.user.id, async (tx) => {
    // DAT-04: se busca en todo el mercado por llaves fuertes y por nombre parecido. Una llave fuerte exacta bloquea a quien
    // vende (solo quien dirige puede crear, con motivo); lo demás es un aviso que se salta con motivo. Cada salto queda para revisión.
    const blinds = taxBlinds(v.taxId)
    const geo = v.latitude != null && v.longitude != null ? { lat: v.latitude, lon: v.longitude } : null
    const dups = await tx<Duplicate[]>`select id, name, locality, owner_name, lifecycle, match, strong
      from app.duplicate_matches(${v.market}, ${v.name}, ${phone}, ${clean(v.email)}, ${clean(v.addressLine)}, ${clean(v.locality)}, ${clean(v.externalId)}, null,
                                 ${blinds.length ? blinds : null}::text[], ${geo?.lat ?? null}::numeric, ${geo?.lon ?? null}::numeric)`
    if (dups.length) {
      if (!v.force) return { duplicates: [...dups] }
      const strong = dups.find((d) => d.strong)
      if (strong && !ctx.can('account.reassign', v.market))
        throw new DomainError('duplicate_blocked',
          `"${strong.name}" ya existe con ese mismo dato${strong.owner_name ? ` (lo lleva ${strong.owner_name})` : ''}. No se crea otro: búscalo o pídeselo a tu supervisión.`,
          `"${strong.name}" already exists with that same detail${strong.owner_name ? ` (owner: ${strong.owner_name})` : ''}. A second one is not created: look it up or ask your supervisor.`)
      if (v.reason.length < 10) throw invalid('Escribe por qué es otro comercio (al menos 10 letras). Sin motivo no se crea.', 'Say why this is a different merchant (at least 10 characters). It is not created without a reason.')
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
    // E9.F12: con ficha de dealer, quien crea la tienda en pantalla dice quién la reclutó (por defecto, el equipo propio). Queda fijo. Una carga por archivo no lo trae: queda por definir.
    const recruiter = market.dealerRecord && kind === 'store' && v.recruitedBy ? await resolveRecruiter(tx, v.market, v.recruitedBy) : null
    // Sin territorio elegido, la base pone el de quien lo crea cuando tiene uno solo en este mercado (0011_distribution).
    const id = await insertAccountTx(tx, { market: v.market, kind, accountType, name: v.name, segment: v.segment, lifecycle: 'prospect', parentId: v.parentId || null,
      ownerId: ctx.user.id, territoryId: v.territoryId || null, phone, locality: clean(v.locality), region: clean(v.region), email: clean(v.email), addressLine: clean(v.addressLine), createdBy: ctx.user.id,
      recruitedBy: recruiter?.kind ?? null, recruitedAgencyId: recruiter?.agencyId ?? null })
    if (geo) await tx`update crm.accounts set latitude = ${geo.lat}, longitude = ${geo.lon}, geo_source = 'device', geo_at = now(), geo_by = ${ctx.user.id} where id = ${id}`
    if (dups.length) {
      await tx`insert into crm.duplicate_bypasses (market_code, account_id, matched_ids, match_kinds, strong, reason, actor_id)
               values (${v.market}, ${id}, ${dups.map((d) => d.id)}::uuid[], ${[...new Set(dups.map((d) => d.match))]}::text[], ${dups.some((d) => d.strong)}, ${v.reason}, ${ctx.user.id})`
      await audit(tx, ctx, 'duplicate.bypassed', 'account', id, v.market, null, { matched: dups.map((d) => d.id), kinds: [...new Set(dups.map((d) => d.match))], reason: v.reason })
    }
    if (v.parentId) await tx`insert into crm.account_links (child_id, parent_id, created_by) values (${id}, ${v.parentId}, ${ctx.user.id})`
    await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by) values
      (${id}, ${v.market}, 'origin', 'user', ${ctx.user.id}, ${ctx.user.name}, ${ctx.user.id}),
      (${id}, ${v.market}, 'channel', 'team', ${v.segment}, ${v.segment.toUpperCase()}, ${ctx.user.id}),
      (${id}, ${v.market}, 'owner', 'user', ${ctx.user.id}, ${ctx.user.name}, ${ctx.user.id})`
    await audit(tx, ctx, 'account.created', 'account', id, v.market, null, { kind, account_type: accountType, name: v.name, forced_duplicate: dups.length > 0 })
    await emit(tx, 'account.created', 'account', id, v.market, { kind })
    // E16.F2: una tienda de venta puerta a puerta es del gerente de su territorio (si el territorio tiene uno).
    await applyTerritoryOwners(tx, [id])
    // E13.F2 (cuenta nueva): Operaciones del mercado se entera. No pide acción: no aparece en Hoy.
    await notifyMany(tx, ctx, await peopleWithRole(tx, v.market, ['ops']), {
      kind: 'lifecycle', market: v.market, template: 'account_new', link: `/comercios/${id}`, accountId: id, needsAction: false,
      title: [`Cuenta nueva: ${v.name}`, `New account: ${v.name}`],
      body: [`${ctx.user.name} creó la cuenta en ${ctx.market(v.market).name}.`, `${ctx.user.name} created the account in ${ctx.market(v.market).name}.`],
      vars: { comercio: v.name, quien: ctx.user.name, mercado: ctx.market(v.market).name },
    })
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

/**
 * DAT-01: mover una cuenta en el árbol es una transición con motivo y fecha efectiva: cierra el vínculo anterior en esa fecha
 * y abre el nuevo. La cuenta conserva su historia, su atribución y a quien la lleva; el árbol no crece más de lo que admite el
 * tipo de su raíz. Poner por primera vez una cuenta independiente bajo una matriz no pide motivo; cambiarla o sacarla, sí.
 */
export async function setParent(ctx: Ctx, id: string, parentId: string | null, opts: { reason?: string; effectiveOn?: string } = {}): Promise<{ ownerDiffers: boolean }> {
  const reason = (opts.reason ?? '').trim()
  const effectiveOn = (opts.effectiveOn ?? '').trim()
  if (effectiveOn && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) throw invalid('La fecha efectiva no es válida.', 'The effective date is not valid.')
  assertNoProhibited(reason)
  return withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, id)
    ctx.assert('account.tree', a.market_code)
    // Quien vende arma el árbol de SUS cuentas: la que mueve y la matriz son suyas. Quien dirige mueve cualquiera de su alcance.
    const manages = ctx.can('account.reassign', a.market_code)
    if (!manages && a.owner_id !== ctx.user.id) throw invalid('Solo puedes mover en el árbol las cuentas que son tuyas.', 'You can only move accounts that are yours in the tree.')
    let parentOwner: string | null = null
    if (parentId) {
      const p = await tx<{ owner_id: string | null; ancestor_ids: string[] }[]>`
        select owner_id, ancestor_ids from crm.accounts where id = ${parentId} and market_code = ${a.market_code} and kind <> 'store' and archived_at is null`
      if (!p[0]) throw invalid('La cuenta matriz tiene que ser una cadena, un distribuidor, un ISO o un corporativo de este mercado.', 'The parent account must be a chain, a distributor, an ISO or a corporate account in this market.')
      if (!manages && p[0].owner_id !== ctx.user.id) throw invalid('La cuenta matriz también tiene que ser tuya. Si no lo es, pídeselo a quien supervisa.', 'The parent account must be yours too. If it is not, ask your supervisor.')
      // La base también lo impide (crm.account_tree_before); aquí se explica antes de llegar.
      if (parentId === id || p[0].ancestor_ids.includes(id)) throw invalid('Esa cuenta cuelga de esta: no puede ser su matriz.', 'That account sits under this one: it cannot be its parent.')
      parentOwner = p[0].owner_id
    }
    if (parentId === a.parent_id) return { ownerDiffers: false }
    if (a.parent_id && (reason.length < 5 || reason.length > 300)) throw invalid('Escribe por qué se mueve esta cuenta en el árbol (de 5 a 300 letras).', 'Say why this account is moving in the tree (5 to 300 characters).')
    // Fecha efectiva: hoy o un día pasado (un cambio que ya ocurrió y se registra tarde). Un cambio a futuro no se agenda aquí.
    const when = await tx<{ at: Date; future: boolean; early: boolean }[]>`
      with w as (
        select case when ${effectiveOn || null}::date is null or ${effectiveOn || null}::date = ${marketToday(tx, a.market_code)} then now()
                    else (${effectiveOn || null}::date + time '12:00') at time zone (select timezone from crm.markets where code = ${a.market_code}) end as at
      )
      select w.at, coalesce(${effectiveOn || null}::date > ${marketToday(tx, a.market_code)}, false) as future,
             exists (select 1 from crm.account_links l where l.child_id = ${id} and l.valid_from > w.at) as early
        from w`
    if (when[0]!.future) throw invalid('La fecha efectiva no puede ser futura. Regístralo el día que ocurra.', 'The effective date cannot be in the future. Record it on the day it happens.')
    if (when[0]!.early) throw invalid('La fecha efectiva es anterior al vínculo que tiene hoy. Elige una fecha posterior.', 'The effective date is earlier than its current link. Pick a later date.')
    const at = when[0]!.at
    await tx`update crm.account_links set valid_to = ${at} where child_id = ${id} and valid_to is null`
    try {
      await tx.savepoint((sp) => sp`update crm.accounts set parent_id = ${parentId} where id = ${id}`)
    } catch (e) {
      const pg = e as { code?: string; message?: string }
      if (pg.code === '23514' && /too deep/.test(pg.message ?? '')) throw invalid('Ese árbol ya tiene todos los niveles que admite su tipo de cuenta. Administración puede cambiar el límite en Datos.', 'That tree already has every level its account type allows. Administration can change the limit under Data.')
      throw e
    }
    if (parentId) await tx`insert into crm.account_links (child_id, parent_id, valid_from, created_by, reason) values (${id}, ${parentId}, ${at}, ${ctx.user.id}, ${clean(reason)})`
    const ownerDiffers = !!parentId && !!a.owner_id && !!parentOwner && parentOwner !== a.owner_id
    await audit(tx, ctx, 'account.parent_changed', 'account', id, a.market_code, { parent_id: a.parent_id }, { parent_id: parentId, reason: clean(reason), effective_on: effectiveOn || null, owner_kept: a.owner_id, owner_differs_from_parent: ownerDiffers })
    return { ownerDiffers }
  })
}

// Reasignar comercios (uno, una selección o todo un filtro) vive en domain/reparto.ts, con el resto del reparto de cartera.
export { reassignAccounts } from '@/domain/reparto'

// DAT-04: la fusión (con foto previa, reglas de supervivencia y deshacer) vive en domain/datos.ts.
export { mergeAccounts } from '@/domain/datos'

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
  return (await addContactLinked(ctx, accountId, input)).id
}

/**
 * Igual que `addContact`, y además dice si la persona ya existía. La misma persona no se captura dos veces: si su teléfono ya es
 * de un contacto del mercado, ese contacto se liga a esta cuenta con su rol aquí (un contacto, varias cuentas).
 */
export async function addContactLinked(ctx: Ctx, accountId: string, input: z.input<typeof contactInput>): Promise<{ id: string; linked: boolean; name: string }> {
  const parsed = contactInput.safeParse(input)
  if (!parsed.success) throw invalid('Revisa nombre y rol del contacto.', 'Check the contact name and role.')
  const v = parsed.data
  return withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, accountId)
    ctx.assert('account.edit', a.market_code)
    const phone = v.phone ? toE164(v.phone, ctx.market(a.market_code).phoneCc) : null
    if (v.phone && !phone) throw invalid('El teléfono no parece válido.', 'The phone number does not look valid.')
    if (v.email && !z.string().email().safeParse(v.email).success) throw invalid('El correo no parece válido.', 'The email does not look valid.')
    const known = phone ? (await tx<{ id: string; full_name: string }[]>`select id, full_name from app.contact_by_phone(${a.market_code}, ${phone})`)[0] : undefined
    const id = known?.id ?? (await newId(tx))
    if (known) {
      const here = await tx`select 1 from crm.account_contacts where account_id = ${accountId} and contact_id = ${id} and valid_to is null and deal_id is null`
      if (here[0]) throw invalid(`${known.full_name} ya es contacto de esta cuenta con ese teléfono.`, `${known.full_name} is already a contact of this account with that phone.`)
    } else {
      // "Móvil que recibe SMS" solo tiene sentido con teléfono; sin teléfono queda sin dato.
      await tx`insert into crm.contacts (id, market_code, full_name, phone, email, preferred_locale, sms_capable, created_by)
               values (${id}, ${a.market_code}, ${v.fullName}, ${phone}, ${clean(v.email)}, ${v.locale || null}, ${phone ? v.sms : null}, ${ctx.user.id})`
    }
    // El primer contacto de una cuenta queda como principal; después, solo si se pide.
    const others = await tx`select 1 from crm.account_contacts where account_id = ${accountId} and valid_to is null limit 1`
    const primary = v.primary || !others[0]
    if (primary) await tx`update crm.account_contacts set is_primary = false where account_id = ${accountId} and is_primary and valid_to is null`
    await tx`insert into crm.account_contacts (account_id, contact_id, market_code, role, is_primary) values (${accountId}, ${id}, ${a.market_code}, ${v.role}, ${primary})`
    await audit(tx, ctx, 'contact.added', 'account', accountId, a.market_code, null, { contact_id: id, role: v.role, primary, linked_existing: !!known })
    return { id, linked: !!known, name: known?.full_name ?? v.fullName }
  })
}
