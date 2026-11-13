import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import { toE164 } from '@/lib/format'
import { checkTaxId, taxIdLast4, type TaxIdType } from '@/lib/tax-id'
import { US_STATE_ZONE, FICHA_FACTS, type FichaFact } from '@/lib/markets'
import { blindIndex, protectedDataAdapter, taxRegistryAdapter, fxFeedAdapter } from '@/server/adapters/markets'
import type { Role } from '@/domain/policy'

// Paquete de mercados: entidad legal, unidad de negocio, mercados y festivos, identificador fiscal, dirección y
// ubicación, WhatsApp por mercado, encabezado de la ficha por rol y edición de contactos.

type Acc = { id: string; market_code: string; name: string; country: string | null; legal_entity_id: string; business_unit: string | null; timezone: string | null; region: string | null;
  latitude: string | null; longitude: string | null }
async function loadAcc(tx: Tx, id: string): Promise<Acc> {
  const rows = await tx<(Acc & { archived_at: Date | null })[]>`
    select id, market_code, name, country, legal_entity_id, business_unit, timezone, region, latitude::text, longitude::text, archived_at from crm.accounts where id = ${id} for update`
  if (!rows[0] || rows[0].archived_at) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
  return rows[0]
}

// ---------------------------------------------------------------- mercados (E1.F1)

const marketInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  name: z.string().trim().min(2).max(60),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  locale: z.enum(['es', 'en', 'pt']),
  timezone: z.string().trim().min(3).max(60),
  phoneCc: z.string().trim().regex(/^\+[1-9][0-9]{0,3}$/),
  entityName: z.string().trim().min(2).max(120),
})

/** Un mercado nuevo se agrega aquí, sin tocar los que ya operan. Nace "en preparación": no aparece en las listas de trabajo hasta abrirlo. */
export async function createMarket(ctx: Ctx, input: z.input<typeof marketInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = marketInput.safeParse(input)
  if (!parsed.success) {
    const f = String(parsed.error.issues[0]?.path[0] ?? '')
    if (f === 'code') throw invalid('Código: las dos letras del país, por ejemplo CO.', 'Code: the two letters of the country, for example CO.')
    if (f === 'currency') throw invalid('Moneda: las tres letras, por ejemplo COP.', 'Currency: the three letters, for example COP.')
    if (f === 'phoneCc') throw invalid('Prefijo telefónico: con signo de más, por ejemplo +57.', 'Phone prefix: with a plus sign, for example +57.')
    if (f === 'entityName') throw invalid('Entidad legal: escribe el nombre con el que axexo opera en ese mercado.', 'Legal entity: enter the name axexo operates under in that market.')
    throw invalid('Revisa nombre, idioma y zona horaria del mercado.', 'Check the market name, language and time zone.')
  }
  const v = parsed.data
  assertNoProhibited(v.name, v.entityName)
  return withUser(ctx.user.id, async (tx) => {
    if ((await tx`select 1 from crm.markets where code = ${v.code}`)[0]) throw invalid('Ese mercado ya existe.', 'That market already exists.')
    if (!(await tx`select 1 from pg_timezone_names where name = ${v.timezone}`)[0]) throw invalid('Esa zona horaria no existe. Usa el nombre completo, por ejemplo America/Bogota.', 'That time zone does not exist. Use the full name, for example America/Bogota.')
    const locales = v.locale === 'es' ? ['es'] : [v.locale, 'es']
    await tx`insert into crm.markets (code, name, currency, default_locale, locales, timezone, phone_cc, status)
             values (${v.code}, ${v.name}, ${v.currency}, ${v.locale}, ${locales}, ${v.timezone}, ${v.phoneCc}, 'planned')`
    await tx`insert into crm.legal_entities (market_code, name, is_default, currency, default_locale, tax_country) values (${v.code}, ${v.entityName}, true, ${v.currency}, ${v.locale}, ${v.code})`
    await audit(tx, ctx, 'market.created', 'market', null, v.code, null, { code: v.code, name: v.name, currency: v.currency, timezone: v.timezone, entity: v.entityName })
    return v.code
  })
}

export type MarketReadiness = { pipelines: number; territories: number; people: number; entity: boolean; rate: boolean }
export async function marketReadiness(tx: Tx, code: string): Promise<MarketReadiness> {
  const rows = await tx<MarketReadiness[]>`
    select (select count(*)::int from crm.pipelines p where p.market_code = m.code and exists (select 1 from crm.stages s where s.pipeline_id = p.id)) as pipelines,
           (select count(*)::int from crm.territories t where t.market_code = m.code) as territories,
           (select count(*)::int from crm.memberships x where x.market_code = m.code and x.valid_from <= now() and (x.valid_to is null or x.valid_to > now())) as people,
           exists (select 1 from crm.legal_entities e where e.market_code = m.code and e.archived_at is null and not e.needs_review) as entity,
           (trim(m.currency) = 'USD' or exists (select 1 from crm.fx_rates f where f.currency = m.currency)) as rate
      from crm.markets m where m.code = ${code}`
  if (!rows[0]) throw notFound('No encontramos ese mercado.', 'We could not find that market.')
  return rows[0]
}

/** Abrir un mercado ("en operación") pide lo mínimo para trabajar: un embudo con etapas, una entidad legal confirmada y al menos una persona. */
export async function setMarketStatus(ctx: Ctx, code: string, status: 'live' | 'planned'): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ status: string }[]>`select status from crm.markets where code = ${code} for update`
    if (!rows[0]) throw notFound('No encontramos ese mercado.', 'We could not find that market.')
    if (rows[0].status === status) return
    if (status === 'live') {
      const r = await marketReadiness(tx, code)
      if (r.pipelines === 0) throw invalid('Antes de abrirlo, créale un embudo con etapas en "Embudos y campos".', 'Before opening it, create a pipeline with stages for it under "Pipelines and fields".')
      if (!r.entity) throw invalid('Antes de abrirlo, confirma el nombre de su entidad legal.', 'Before opening it, confirm the name of its legal entity.')
      if (r.people === 0) throw invalid('Antes de abrirlo, dale acceso al menos a una persona en "Personas y acceso".', 'Before opening it, give at least one person access under "People and access".')
    } else {
      const open = await tx<{ n: number }[]>`select count(*)::int as n from crm.deals where market_code = ${code} and status = 'open'`
      if ((open[0]?.n ?? 0) > 0) throw invalid('Ese mercado tiene negocios abiertos: no se puede regresar a preparación.', 'That market has open deals: it cannot go back to preparation.')
    }
    await tx`update crm.markets set status = ${status} where code = ${code}`
    await audit(tx, ctx, 'market.status_changed', 'market', null, code, { status: rows[0].status }, { status })
  })
}

const holidayInput = z.object({ market: z.string().length(2), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(2).max(80) })
/** Día festivo de un mercado: ese día no cae ningún próximo paso por defecto. Lo carga administración; CONTIGO no trae calendarios de ningún lado. */
export async function addHoliday(ctx: Ctx, input: z.input<typeof holidayInput>): Promise<void> {
  ctx.assert('config.manage')
  const v = holidayInput.safeParse(input)
  if (!v.success) throw invalid('Elige el mercado, la fecha y escribe qué se celebra.', 'Pick the market, the date and enter what is observed.')
  await withUser(ctx.user.id, async (tx) => {
    if (!(await tx`select 1 from crm.markets where code = ${v.data.market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    await tx`insert into crm.market_holidays (market_code, day, name, created_by) values (${v.data.market}, ${v.data.day}::date, ${v.data.name}, ${ctx.user.id})
             on conflict (market_code, day) do update set name = excluded.name`
    await audit(tx, ctx, 'market.holiday_added', 'market', null, v.data.market, null, { day: v.data.day, name: v.data.name })
  })
}
export async function removeHoliday(ctx: Ctx, market: string, day: string): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ name: string }[]>`delete from crm.market_holidays where market_code = ${market} and day = ${day}::date returning name`
    if (rows[0]) await audit(tx, ctx, 'market.holiday_removed', 'market', null, market, { day, name: rows[0].name }, null)
  })
}

// ---------------------------------------------------------------- entidad legal (MULTI-02)

const entityInput = z.object({ market: z.string().length(2), name: z.string().trim().min(2).max(120), makeDefault: z.boolean().optional().default(false) })
export async function createEntity(ctx: Ctx, input: z.input<typeof entityInput>): Promise<string> {
  ctx.assert('config.manage')
  const v = entityInput.safeParse(input)
  if (!v.success) throw invalid('Elige el mercado y escribe el nombre de la entidad legal (de 2 a 120 letras).', 'Pick the market and enter the legal entity’s name (2 to 120 characters).')
  assertNoProhibited(v.data.name)
  return withUser(ctx.user.id, async (tx) => {
    if (!(await tx`select 1 from crm.markets where code = ${v.data.market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    if ((await tx`select 1 from crm.legal_entities where market_code = ${v.data.market} and lower(name) = lower(${v.data.name}) and archived_at is null`)[0]) throw invalid('Ese mercado ya tiene una entidad con ese nombre.', 'That market already has an entity with that name.')
    const id = await newId(tx)
    if (v.data.makeDefault) await tx`update crm.legal_entities set is_default = false where market_code = ${v.data.market} and is_default`
    await tx`insert into crm.legal_entities (id, market_code, name, is_default) values (${id}, ${v.data.market}, ${v.data.name}, ${v.data.makeDefault})`
    await audit(tx, ctx, 'entity.created', 'legal_entity', id, v.data.market, null, { name: v.data.name, is_default: v.data.makeDefault })
    return id
  })
}

/** Corrige el nombre de una entidad (por ejemplo, la provisional que CONTIGO creó) o la deja como la de por defecto del mercado. */
export async function updateEntity(ctx: Ctx, id: string, input: { name: string; makeDefault: boolean }): Promise<void> {
  ctx.assert('config.manage')
  const name = input.name.trim()
  if (name.length < 2 || name.length > 120) throw invalid('El nombre de la entidad lleva de 2 a 120 letras.', 'The entity name takes 2 to 120 characters.')
  assertNoProhibited(name)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; name: string; is_default: boolean; needs_review: boolean }[]>`select market_code, name, is_default, needs_review from crm.legal_entities where id = ${id} and archived_at is null for update`
    const e = rows[0]
    if (!e) throw notFound('No encontramos esa entidad.', 'We could not find that entity.')
    if ((await tx`select 1 from crm.legal_entities where market_code = ${e.market_code} and lower(name) = lower(${name}) and archived_at is null and id <> ${id}`)[0]) throw invalid('Ese mercado ya tiene una entidad con ese nombre.', 'That market already has an entity with that name.')
    if (input.makeDefault && !e.is_default) await tx`update crm.legal_entities set is_default = false where market_code = ${e.market_code} and is_default`
    // Guardar el nombre es confirmarlo: deja de estar "por confirmar".
    await tx`update crm.legal_entities set name = ${name}, is_default = ${e.is_default || input.makeDefault}, needs_review = false where id = ${id}`
    await audit(tx, ctx, 'entity.updated', 'legal_entity', id, e.market_code, { name: e.name, is_default: e.is_default, needs_review: e.needs_review }, { name, is_default: e.is_default || input.makeDefault, needs_review: false })
  })
}

/** A qué entidad pertenece una persona y, si hace falta, que su acceso en un mercado alcance solo los comercios de una entidad. */
export async function setUserEntity(ctx: Ctx, userId: string, input: { entityId: string | null; limit: boolean }): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const users = await tx<{ id: string; legal_entity_id: string | null }[]>`select id, legal_entity_id from crm.users where id = ${userId} and not is_system for update`
    if (!users[0]) throw notFound('No encontramos a esa persona.', 'We could not find that person.')
    let market: string | null = null
    if (input.entityId) {
      const e = await tx<{ market_code: string }[]>`select market_code from crm.legal_entities where id = ${input.entityId} and archived_at is null`
      if (!e[0]) throw invalid('Esa entidad no existe.', 'That entity does not exist.')
      market = e[0].market_code
    }
    if (input.limit && !input.entityId) throw invalid('Para limitar el acceso, elige primero la entidad.', 'To limit access, pick the entity first.')
    await tx`update crm.users set legal_entity_id = ${input.entityId} where id = ${userId}`
    // El límite vive en los accesos vigentes de la persona en el mercado de esa entidad. Sin límite, ve todo lo de su alcance.
    const before = await tx<{ n: number }[]>`select count(*)::int as n from crm.memberships where user_id = ${userId} and legal_entity_id is not null and (valid_to is null or valid_to > now())`
    await tx`update crm.memberships set legal_entity_id = null where user_id = ${userId} and legal_entity_id is not null and (valid_to is null or valid_to > now())`
    let limited = 0
    if (input.limit && market) {
      const upd = await tx`update crm.memberships set legal_entity_id = ${input.entityId} where user_id = ${userId} and market_code = ${market} and (valid_to is null or valid_to > now()) returning id`
      limited = upd.length
      if (limited === 0) throw invalid('Esa persona no tiene acceso en el mercado de esa entidad: no hay nada que limitar.', 'That person has no access in that entity’s market: there is nothing to limit.')
    }
    await audit(tx, ctx, 'user.entity_set', 'user', userId, market, { entity_id: users[0].legal_entity_id, limited: (before[0]?.n ?? 0) > 0 }, { entity_id: input.entityId, limited: limited > 0 })
  })
}

const profileInput = z.object({
  entityId: z.guid().or(z.literal('')).optional().default(''),
  businessUnit: z.string().trim().max(41).optional().default(''),
  timezone: z.string().trim().max(60).optional().default(''),
})
/** Entidad legal, unidad de negocio y zona horaria del comercio. La entidad la cambia quien lidera el mercado o administración. */
export async function setAccountProfile(ctx: Ctx, id: string, input: z.input<typeof profileInput>): Promise<void> {
  const parsed = profileInput.safeParse(input)
  if (!parsed.success) throw invalid('Revisa entidad, unidad de negocio y zona horaria.', 'Check the entity, business unit and time zone.')
  const v = parsed.data
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAcc(tx, id)
    ctx.assert('account.edit', a.market_code)
    const entityId = v.entityId || a.legal_entity_id
    if (entityId !== a.legal_entity_id) {
      ctx.assert('account.entity', a.market_code)
      if (!(await tx`select 1 from crm.legal_entities where id = ${entityId} and market_code = ${a.market_code} and archived_at is null`)[0]) throw invalid('Esa entidad no es de este mercado.', 'That entity does not belong to this market.')
    }
    const bu = v.businessUnit || null
    if (bu && !(await tx`select 1 from crm.business_units where code = ${bu} and is_active`)[0]) throw invalid('Esa unidad de negocio no existe.', 'That business unit does not exist.')
    const tz = v.timezone || null
    if (tz && !(await tx`select 1 from pg_timezone_names where name = ${tz}`)[0]) throw invalid('Esa zona horaria no existe.', 'That time zone does not exist.')
    await tx`update crm.accounts set legal_entity_id = ${entityId}, business_unit = ${bu}, timezone = ${tz} where id = ${id}`
    // Los negocios abiertos siguen a su comercio; los cerrados conservan la entidad con la que cerraron.
    if (entityId !== a.legal_entity_id) await tx`update crm.deals set legal_entity_id = ${entityId} where account_id = ${id} and status = 'open'`
    if (bu !== a.business_unit) await tx`update crm.deals set business_unit = ${bu} where account_id = ${id} and status = 'open'`
    await audit(tx, ctx, 'account.profile_set', 'account', id, a.market_code, { entity_id: a.legal_entity_id, business_unit: a.business_unit, timezone: a.timezone }, { entity_id: entityId, business_unit: bu, timezone: tz })
  })
}

// ---------------------------------------------------------------- tasas (MULTI-01)

/** Trae las tasas del día por el adaptador. Apagado: no hace nada y lo dice; administración las sigue cargando a mano. */
export async function pullFxFeed(tx: Tx, currencies: string[]): Promise<{ loaded: number; off: boolean }> {
  const res = await fxFeedAdapter().fetch(currencies)
  if (res.status === 'off') return { loaded: 0, off: true }
  for (const r of res.rates) {
    await tx`insert into crm.fx_rates (currency, as_of, usd_rate, source) values (${r.currency}, ${r.asOf}::date, ${r.usdRate}, ${r.source})
             on conflict (currency, as_of) do update set usd_rate = excluded.usd_rate, source = excluded.source, loaded_at = now()`
  }
  return { loaded: res.rates.length, off: false }
}

// ---------------------------------------------------------------- identificador fiscal (MULTI-03)

const taxInput = z.object({
  type: z.enum(['mx_rfc', 'us_ein', 'co_nit', 'sv_nit', 'br_cnpj', 'other']),
  value: z.string().max(40),
  legalName: z.string().trim().max(160).optional().default(''),
  taxRegime: z.string().trim().max(80).optional().default(''),
  postalCode: z.string().trim().max(12).optional().default(''),
})
export type TaxMatch = { account_id: string; name: string; market_code: string; locality: string | null; owner_name: string | null }
export type TaxCapture = { status: 'format_valid' | 'needs_review'; last4: string; duplicates: TaxMatch[]; fingerprint: boolean }

const COUNTRY_OF: Record<TaxIdType, string> = { mx_rfc: 'MX', us_ein: 'US', co_nit: 'CO', sv_nit: 'SV', br_cnpj: 'BR', other: 'ZZ' }

/**
 * Captura el identificador fiscal UNA vez. Capa 1 aquí mismo (formato y dígito verificador). El valor completo no se guarda:
 * quedan los últimos 4, una huella para encontrar repetidos y el estado. Las capas 2 y 3 (registro oficial y listas de
 * riesgo) salen por un adaptador que hoy está apagado; mientras tanto, una persona lo revisa con el documento a la vista.
 */
export async function captureTaxId(ctx: Ctx, accountId: string, input: z.input<typeof taxInput>): Promise<TaxCapture> {
  const parsed = taxInput.safeParse(input)
  if (!parsed.success) throw invalid('Revisa el identificador fiscal.', 'Check the tax ID.')
  const v = parsed.data
  const check = checkTaxId(v.type, v.value)
  if (!check.formatOk) {
    if (check.problem === 'ssn') throw invalid('Eso parece un SSN. Un SSN no se guarda en CONTIGO: pide el EIN del negocio.', 'That looks like an SSN. CONTIGO does not store SSNs: ask for the business’s EIN.')
    if (check.problem === 'generic') throw invalid('Ese es un RFC genérico: no identifica a este comercio. Pide el RFC del negocio o de su dueño.', 'That is a generic RFC: it does not identify this merchant. Ask for the RFC of the business or its owner.')
    if (check.problem === 'date') throw invalid('La fecha dentro del RFC no existe. Revisa los seis números después de las letras.', 'The date inside the RFC does not exist. Check the six digits after the letters.')
    if (check.problem === 'prefix') throw invalid('Ese EIN empieza con dos números que el IRS no asigna. Revísalo con el comercio.', 'That EIN starts with two digits the IRS does not assign. Check it with the merchant.')
    if (check.problem === 'empty') throw invalid('Escribe el identificador fiscal.', 'Enter the tax ID.')
    const shape: Record<TaxIdType, [string, string]> = {
      mx_rfc: ['El RFC lleva 12 caracteres (empresa) o 13 (persona): letras, fecha y tres caracteres más.', 'An RFC takes 12 characters (company) or 13 (person): letters, a date and three more characters.'],
      us_ein: ['El EIN lleva 9 números, como 12-3456789.', 'An EIN takes 9 digits, like 12-3456789.'],
      co_nit: ['El NIT lleva de 8 a 16 números, con su dígito de verificación al final.', 'A NIT takes 8 to 16 digits, with its check digit at the end.'],
      sv_nit: ['El NIT lleva 14 números, como 0614-050707-104-8.', 'A NIT takes 14 digits, like 0614-050707-104-8.'],
      br_cnpj: ['El CNPJ lleva 14 caracteres: doce letras o números y dos dígitos al final.', 'A CNPJ takes 14 characters: twelve letters or digits and two digits at the end.'],
      other: ['El identificador lleva de 5 a 20 letras o números.', 'The identifier takes 5 to 20 letters or digits.'],
    }
    throw invalid(...shape[v.type])
  }
  assertNoProhibited(v.legalName, v.taxRegime)
  if (v.type === 'mx_rfc') {
    // En México el nombre, el régimen y el código postal tienen que coincidir exactos con el padrón: se capturan aquí, una vez.
    if (v.legalName.length < 2) throw invalid('Escribe el nombre o razón social tal como aparece en la constancia fiscal.', 'Enter the legal name exactly as it appears on the tax certificate.')
    if (v.taxRegime.length < 2) throw invalid('Escribe el régimen fiscal de la constancia.', 'Enter the tax regime from the certificate.')
    if (!/^\d{5}$/.test(v.postalCode)) throw invalid('Escribe el código postal fiscal: cinco números.', 'Enter the tax postal code: five digits.')
  }
  const last4 = taxIdLast4(check.normalized)
  const blind = blindIndex(v.type, check.normalized)
  const registry = await taxRegistryAdapter().verify({ type: v.type, country: COUNTRY_OF[v.type], normalized: check.normalized, legalName: clean(v.legalName), postalCode: clean(v.postalCode) })
  return withUser(ctx.user.id, async (tx) => {
    const a = await loadAcc(tx, accountId)
    ctx.assert('taxid.capture', a.market_code)
    await protectedDataAdapter().store({ kind: 'tax_id', accountId, value: check.normalized })
    const duplicates = blind ? [...(await tx<TaxMatch[]>`select account_id, name, market_code, locality, owner_name from app.tax_id_matches(${blind}, ${accountId})`)] : []
    // Dígito verificador que no cuadra, tipo sin validador, registro que no coincide o repetido: pasa a revisión de una persona.
    const review = check.checksumOk === false || v.type === 'other' || registry.status === 'mismatch' || duplicates.length > 0
    const status = review ? 'needs_review' : 'format_valid'
    await tx`update crm.tax_ids set valid_to = now() where account_id = ${accountId} and valid_to is null`
    const id = await newId(tx)
    const registryStatus = registry.status === 'queued_off' ? 'queued_off' : registry.status
    await tx`insert into crm.tax_ids (id, account_id, market_code, country, id_type, last4, blind_ix, checksum_ok, status, registry_status, legal_name, tax_regime, tax_postal_code, captured_by)
             values (${id}, ${accountId}, ${a.market_code}, ${COUNTRY_OF[v.type]}, ${v.type}, ${last4}, ${blind}, ${check.checksumOk}, ${status}, ${registryStatus},
                     ${clean(v.legalName)}, ${clean(v.taxRegime)}, ${clean(v.postalCode)}, ${ctx.user.id})`
    const formatDetail = check.checksumOk === false ? 'checksum_mismatch' : check.checksumOk === null ? 'no_check_digit' : 'ok'
    await tx`insert into crm.tax_id_verifications (tax_id_id, account_id, market_code, layer, provider, result, detail, actor_id) values
      (${id}, ${accountId}, ${a.market_code}, 'format', 'contigo', ${check.checksumOk === false || v.type === 'other' ? 'review' : 'pass'}, ${formatDetail}, ${ctx.user.id}),
      (${id}, ${accountId}, ${a.market_code}, 'registry', ${registry.status === 'queued_off' ? 'off' : registry.provider},
        ${registry.status === 'queued_off' ? 'queued_off' : registry.status === 'match' ? 'pass' : 'fail'}, null, null),
      (${id}, ${accountId}, ${a.market_code}, 'risk_list', 'off', 'queued_off', null, null)`
    await tx`update crm.accounts set tax_id_last4 = ${last4}, tax_id_blind_ix = ${blind} where id = ${accountId}`
    // La bitácora nunca lleva el identificador: solo tipo, últimos 4 y resultado.
    await audit(tx, ctx, 'taxid.captured', 'account', accountId, a.market_code, null, { type: v.type, last4, status, checksum_ok: check.checksumOk, registry: registryStatus, repeated_in: duplicates.length })
    return { status, last4, duplicates, fingerprint: blind !== null }
  })
}

/** Capa humana: quien revisa compara el identificador con el documento del comercio y deja su decisión con una nota. */
export async function reviewTaxId(ctx: Ctx, accountId: string, input: { decision: 'approve' | 'reject'; note: string }): Promise<void> {
  const note = input.note.trim()
  if (input.decision !== 'approve' && input.decision !== 'reject') throw invalid('Elige aprobar o rechazar.', 'Pick approve or reject.')
  if (note.length < 3 || note.length > 300) throw invalid('Escribe qué documento revisaste (de 3 a 300 letras).', 'Enter which document you checked (3 to 300 characters).')
  assertNoProhibited(note)
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAcc(tx, accountId)
    ctx.assert('taxid.review', a.market_code)
    const rows = await tx<{ id: string; status: string; captured_by: string | null }[]>`select id, status, captured_by from crm.tax_ids where account_id = ${accountId} and valid_to is null for update`
    const t = rows[0]
    if (!t) throw notFound('Ese comercio no tiene identificador fiscal capturado.', 'That merchant has no tax ID captured.')
    // Quien lo capturó no lo aprueba: lo revisa otra persona.
    if (input.decision === 'approve' && t.captured_by === ctx.user.id && !ctx.isAdmin) throw invalid('Lo capturaste tú: tiene que aprobarlo otra persona.', 'You captured it: someone else has to approve it.')
    const status = input.decision === 'approve' ? 'verified' : 'rejected'
    await tx`update crm.tax_ids set status = ${status}, reviewed_by = ${ctx.user.id}, reviewed_at = now(), review_note = ${note} where id = ${t.id}`
    await tx`insert into crm.tax_id_verifications (tax_id_id, account_id, market_code, layer, provider, result, detail, actor_id)
             values (${t.id}, ${accountId}, ${a.market_code}, 'human', 'person', ${input.decision === 'approve' ? 'pass' : 'fail'}, ${note}, ${ctx.user.id})`
    await audit(tx, ctx, 'taxid.reviewed', 'account', accountId, a.market_code, { status: t.status }, { status, note })
  })
}

// ---------------------------------------------------------------- dirección y ubicación (MULTI-04)

export type AddressField = { key: 'address_line' | 'address_line2' | 'sublocality' | 'locality' | 'region' | 'postal_code'; es: string; en: string; required: boolean }
export type AddressFormat = { country: string; fields: AddressField[]; postal_regex: string | null; postal_example: string | null; regions: string[] }

export async function addressFormat(tx: Tx, country: string): Promise<AddressFormat> {
  const rows = await tx<AddressFormat[]>`
    select trim(country) as country, fields, postal_regex, postal_example, regions from crm.address_formats
     where country in (${country.toUpperCase()}, 'ZZ') order by (country = 'ZZ') limit 1`
  return rows[0]!
}

const addressInput = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).or(z.literal('')).optional().default(''),
  address_line: z.string().trim().max(200).optional().default(''),
  address_line2: z.string().trim().max(120).optional().default(''),
  sublocality: z.string().trim().max(120).optional().default(''),
  locality: z.string().trim().max(120).optional().default(''),
  region: z.string().trim().max(120).optional().default(''),
  postal_code: z.string().trim().max(20).optional().default(''),
})
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Guarda la dirección con el formato del país del comercio: qué campos pide, cuáles son obligatorios y cómo es su código postal. */
export async function updateAddress(ctx: Ctx, id: string, input: z.input<typeof addressInput>): Promise<void> {
  const parsed = addressInput.safeParse(input)
  if (!parsed.success) throw invalid('Revisa la dirección: algún campo es demasiado largo.', 'Check the address: a field is too long.')
  const v = parsed.data
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAcc(tx, id)
    ctx.assert('account.edit', a.market_code)
    const country = v.country || (a.country ?? a.market_code).trim()
    const fmt = await addressFormat(tx, country)
    const t = ctx.t
    const values: Record<AddressField['key'], string> = { address_line: tidy(v.address_line), address_line2: tidy(v.address_line2), sublocality: tidy(v.sublocality), locality: tidy(v.locality), region: tidy(v.region), postal_code: tidy(v.postal_code).toUpperCase() }
    const asked = new Set(fmt.fields.map((f) => f.key))
    for (const f of fmt.fields) {
      if (f.required && !values[f.key]) throw invalid(`${f.es}: hace falta para una dirección de este país.`, `${f.en}: it is required for an address in this country.`)
    }
    if (values.postal_code && fmt.postal_regex && !new RegExp(fmt.postal_regex).test(values.postal_code)) {
      throw invalid(`El código postal no tiene la forma de este país${fmt.postal_example ? ` (por ejemplo, ${fmt.postal_example})` : ''}.`, `The postal code does not have this country’s shape${fmt.postal_example ? ` (for example, ${fmt.postal_example})` : ''}.`)
    }
    if (values.region && fmt.regions.length > 0) {
      const hit = fmt.regions.find((r) => r.toUpperCase() === values.region.toUpperCase())
      if (!hit) throw invalid('Elige el estado de la lista.', 'Pick the state from the list.')
      values.region = hit
    }
    void t
    assertNoProhibited(values.address_line, values.address_line2, values.sublocality)
    // Lo que el formato del país no pide se conserva como estaba (no se borra un dato por cambiar de formato).
    const keep = async (k: AddressField['key']) => (asked.has(k) ? clean(values[k]) : ((await tx<Record<string, string | null>[]>`select ${tx(k)} from crm.accounts where id = ${id}`)[0]?.[k] ?? null))
    const next = { address_line: await keep('address_line'), address_line2: await keep('address_line2'), sublocality: await keep('sublocality'), locality: await keep('locality'), region: await keep('region'), postal_code: await keep('postal_code') }
    // Estados Unidos tiene varias zonas horarias: si el comercio no tiene la suya, se propone la de su estado.
    const zone = !a.timezone && country === 'US' && next.region ? (US_STATE_ZONE[next.region.toUpperCase()] ?? null) : a.timezone
    await tx`update crm.accounts set address_line = ${next.address_line}, address_line2 = ${next.address_line2}, sublocality = ${next.sublocality}, locality = ${next.locality},
              region = ${next.region}, postal_code = ${next.postal_code}, country = ${country}, timezone = ${zone} where id = ${id}`
    await audit(tx, ctx, 'account.address_set', 'account', id, a.market_code, null, { country, locality: next.locality, region: next.region, postal_code: next.postal_code, timezone: zone })
  })
}

const locationInput = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  source: z.enum(['manual', 'device']),
  accuracy: z.coerce.number().min(0).max(100000).optional(),
})
export type GeoDuplicate = { id: string; name: string; locality: string | null; owner_name: string | null; distance_m: number }

/** Guarda dónde está el comercio: a mano (dos números) o con la ubicación del teléfono. Devuelve los comercios que quedan a menos de 60 metros. */
export async function setLocation(ctx: Ctx, id: string, input: { latitude: string; longitude: string; source: string; accuracy?: string }): Promise<{ near: GeoDuplicate[] }> {
  const parsed = locationInput.safeParse({ ...input, accuracy: input.accuracy || undefined })
  if (!parsed.success || input.latitude.trim() === '' || input.longitude.trim() === '') throw invalid('Latitud entre -90 y 90, longitud entre -180 y 180. Por ejemplo: 19.4326 y -99.1332.', 'Latitude between -90 and 90, longitude between -180 and 180. For example: 19.4326 and -99.1332.')
  const v = parsed.data
  if (v.latitude === 0 && v.longitude === 0) throw invalid('Esas coordenadas (0, 0) caen en el mar: revisa los números.', 'Those coordinates (0, 0) fall in the ocean: check the numbers.')
  return withUser(ctx.user.id, async (tx) => {
    const a = await loadAcc(tx, id)
    ctx.assert('account.edit', a.market_code)
    await tx`update crm.accounts set latitude = ${v.latitude.toFixed(6)}, longitude = ${v.longitude.toFixed(6)}, geo_source = ${v.source},
              geo_accuracy_m = ${v.accuracy === undefined ? null : Math.round(v.accuracy)}, geo_at = now(), geo_by = ${ctx.user.id} where id = ${id}`
    const near = await tx<GeoDuplicate[]>`select id, name, locality, owner_name, distance_m from app.geo_duplicates(${id}, 60)`
    // La bitácora guarda que se ubicó y cómo, con dos decimales (cerca de un kilómetro): no hace falta más para auditar.
    await audit(tx, ctx, 'account.located', 'account', id, a.market_code, { had_location: a.latitude !== null }, { source: v.source, accuracy_m: v.accuracy === undefined ? null : Math.round(v.accuracy), near: near.length, lat: Number(v.latitude.toFixed(2)), lon: Number(v.longitude.toFixed(2)) })
    return { near: [...near] }
  })
}

export async function clearLocation(ctx: Ctx, id: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAcc(tx, id)
    ctx.assert('account.edit', a.market_code)
    if (a.latitude === null) return
    await tx`update crm.accounts set latitude = null, longitude = null, geo_source = null, geo_accuracy_m = null, geo_at = null, geo_by = null where id = ${id}`
    await audit(tx, ctx, 'account.location_cleared', 'account', id, a.market_code, { had_location: true }, { had_location: false })
  })
}

// ---------------------------------------------------------------- WhatsApp por mercado (MULTI-05)

const waAccountInput = z.object({
  market: z.string().length(2).or(z.literal('')).optional().default(''),
  entityId: z.guid(),
  displayName: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30).optional().default(''),
  externalRef: z.string().trim().max(60).regex(/^[A-Za-z0-9_-]*$/).optional().default(''),
  dailyLimit: z.coerce.number().int().min(1).max(1000000).optional(),
})
/** El número de WhatsApp de un mercado y entidad. Se guarda la configuración; el canal sigue apagado y no sale ningún mensaje. */
export async function saveWhatsappAccount(ctx: Ctx, input: { market?: string; entityId: string; displayName: string; phone?: string; externalRef?: string; dailyLimit?: string }): Promise<string> {
  ctx.assert('config.manage')
  const parsed = waAccountInput.safeParse({ ...input, dailyLimit: input.dailyLimit || undefined })
  if (!parsed.success) throw invalid('Elige mercado y entidad, y escribe el nombre que verá el comercio (de 2 a 80 letras).', 'Pick the market and entity, and enter the name the merchant will see (2 to 80 characters).')
  const v = parsed.data
  assertNoProhibited(v.displayName)
  return withUser(ctx.user.id, async (tx) => {
    // El mercado sale de la entidad: así no se puede guardar una entidad de otro mercado.
    const ent = await tx<{ market_code: string }[]>`select market_code from crm.legal_entities where id = ${v.entityId} and archived_at is null`
    if (!ent[0] || (v.market && v.market !== ent[0].market_code)) throw invalid('Esa entidad no es de ese mercado.', 'That entity does not belong to that market.')
    const market = ent[0].market_code
    const m = await tx<{ phone_cc: string }[]>`select phone_cc from crm.markets where code = ${market}`
    if (!m[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    const phone = v.phone ? toE164(v.phone, m[0].phone_cc) : null
    if (v.phone && !phone) throw invalid('El teléfono no parece válido.', 'The phone number does not look valid.')
    const existing = await tx<{ id: string }[]>`select id from crm.whatsapp_accounts where market_code = ${market} and legal_entity_id = ${v.entityId} and is_active for update`
    const id = existing[0]?.id ?? (await newId(tx))
    if (existing[0]) {
      await tx`update crm.whatsapp_accounts set display_name = ${v.displayName}, phone = ${phone}, external_ref = ${clean(v.externalRef)}, daily_limit = ${v.dailyLimit ?? null}, updated_at = now() where id = ${id}`
    } else {
      await tx`insert into crm.whatsapp_accounts (id, market_code, legal_entity_id, display_name, phone, external_ref, daily_limit, created_by)
               values (${id}, ${market}, ${v.entityId}, ${v.displayName}, ${phone}, ${clean(v.externalRef)}, ${v.dailyLimit ?? null}, ${ctx.user.id})`
    }
    await audit(tx, ctx, 'whatsapp.account_saved', 'whatsapp_account', id, market, null, { display_name: v.displayName, entity_id: v.entityId, has_phone: phone !== null, daily_limit: v.dailyLimit ?? null })
    return id
  })
}

const waTemplateInput = z.object({
  accountId: z.guid(),
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,60}$/),
  locale: z.enum(['es', 'en', 'pt']),
  category: z.enum(['utility', 'marketing', 'authentication']),
  body: z.string().trim().min(5).max(1024),
})
// La política de comercio de WhatsApp no admite ofrecer por ahí productos financieros ni de prepago: una plantilla no vende.
const WA_BLOCKED = /\b(compra|c[oó]mpralo|paga aqu[ií]|pagar ahora|cat[aá]logo|buy now|pay now|checkout|catalog)\b/i
export async function saveWhatsappTemplate(ctx: Ctx, input: z.input<typeof waTemplateInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = waTemplateInput.safeParse(input)
  if (!parsed.success) {
    const f = String(parsed.error.issues[0]?.path[0] ?? '')
    if (f === 'key') throw invalid('Nombre interno: minúsculas, números y guion bajo, por ejemplo alta_confirmada.', 'Internal name: lowercase letters, digits and underscore, for example signup_confirmed.')
    if (f === 'body') throw invalid('El texto de la plantilla lleva de 5 a 1,024 caracteres.', 'The template text takes 5 to 1,024 characters.')
    throw invalid('Elige la cuenta, el idioma y la categoría de la plantilla.', 'Pick the template’s account, language and category.')
  }
  const v = parsed.data
  assertNoProhibited(v.body)
  if (WA_BLOCKED.test(v.body)) throw invalid('Una plantilla no vende ni cobra: WhatsApp no admite catálogos ni pagos para productos financieros o de prepago. Quita esa parte.', 'A template does not sell or charge: WhatsApp does not allow catalogs or payments for financial or prepaid products. Remove that part.')
  return withUser(ctx.user.id, async (tx) => {
    const acc = await tx<{ market_code: string }[]>`select market_code from crm.whatsapp_accounts where id = ${v.accountId} and is_active`
    if (!acc[0]) throw notFound('No encontramos esa cuenta de WhatsApp.', 'We could not find that WhatsApp account.')
    const existing = await tx<{ id: string }[]>`select id from crm.whatsapp_templates where account_id = ${v.accountId} and key = ${v.key} and locale = ${v.locale} and is_active for update`
    const id = existing[0]?.id ?? (await newId(tx))
    if (existing[0]) {
      // Cambiar el texto regresa la plantilla a borrador: Meta aprueba cada versión.
      await tx`update crm.whatsapp_templates set category = ${v.category}, body = ${v.body}, status = 'draft', updated_at = now() where id = ${id}`
    } else {
      await tx`insert into crm.whatsapp_templates (id, account_id, market_code, key, locale, category, body, created_by) values (${id}, ${v.accountId}, ${acc[0].market_code}, ${v.key}, ${v.locale}, ${v.category}, ${v.body}, ${ctx.user.id})`
    }
    await audit(tx, ctx, 'whatsapp.template_saved', 'whatsapp_template', id, acc[0].market_code, null, { key: v.key, locale: v.locale, category: v.category })
    return id
  })
}

export const WA_TEMPLATE_STATUS = ['draft', 'submitted', 'approved', 'rejected', 'paused'] as const
/** El estado de aprobación de una plantilla se anota a mano mientras el canal esté apagado. */
export async function setWhatsappTemplateStatus(ctx: Ctx, id: string, status: string): Promise<void> {
  ctx.assert('config.manage')
  if (!(WA_TEMPLATE_STATUS as readonly string[]).includes(status)) throw invalid('Elige un estado de la lista.', 'Pick a status from the list.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; status: string; key: string }[]>`select market_code, status, key from crm.whatsapp_templates where id = ${id} and is_active for update`
    if (!rows[0]) throw notFound('No encontramos esa plantilla.', 'We could not find that template.')
    if (rows[0].status === status) return
    await tx`update crm.whatsapp_templates set status = ${status}, updated_at = now() where id = ${id}`
    await audit(tx, ctx, 'whatsapp.template_status', 'whatsapp_template', id, rows[0].market_code, { status: rows[0].status }, { status, key: rows[0].key })
  })
}

const waRateInput = z.object({
  market: z.string().length(2),
  category: z.enum(['utility', 'marketing', 'authentication', 'service']),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  cost: z.coerce.number().min(0).max(1000),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().trim().min(3).max(120),
})
/** Costo por mensaje de una categoría en un mercado, con desde cuándo aplica y de dónde sale. No se inventa: lo carga administración. */
export async function saveWhatsappRate(ctx: Ctx, input: { market: string; category: string; currency: string; cost: string; effectiveFrom: string; source: string }): Promise<void> {
  ctx.assert('config.manage')
  const parsed = waRateInput.safeParse(input)
  if (!parsed.success || input.cost.trim() === '') throw invalid('Revisa el costo: mercado, categoría, moneda de tres letras, un número de cero en adelante, fecha y de dónde sale.', 'Check the cost: market, category, three-letter currency, a number from zero up, date and where it comes from.')
  const v = parsed.data
  await withUser(ctx.user.id, async (tx) => {
    if (!(await tx`select 1 from crm.markets where code = ${v.market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    await tx`insert into crm.whatsapp_rates (market_code, category, currency, cost, effective_from, source, loaded_by) values (${v.market}, ${v.category}, ${v.currency}, ${v.cost}, ${v.effectiveFrom}::date, ${v.source}, ${ctx.user.id})
             on conflict (market_code, category, effective_from) do update set currency = excluded.currency, cost = excluded.cost, source = excluded.source, loaded_by = excluded.loaded_by, loaded_at = now()`
    await audit(tx, ctx, 'whatsapp.rate_saved', 'whatsapp_rate', null, v.market, null, { category: v.category, currency: v.currency, cost: v.cost, effective_from: v.effectiveFrom, source: v.source })
  })
}

/** "El comercio me escribió": abre la ventana de 24 horas (72 si llegó por un anuncio) en la que se le puede responder sin plantilla. */
export async function openWhatsappWindow(ctx: Ctx, accountId: string, kind: 'service_24h' | 'ad_72h'): Promise<void> {
  if (kind !== 'service_24h' && kind !== 'ad_72h') throw invalid('Elige cómo llegó el mensaje.', 'Pick how the message came in.')
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAcc(tx, accountId)
    ctx.assert('activity.write', a.market_code)
    const hours = kind === 'ad_72h' ? 72 : 24
    await tx`insert into crm.whatsapp_windows (account_id, market_code, kind, expires_at, source, opened_by) values (${accountId}, ${a.market_code}, ${kind}, now() + make_interval(hours => ${hours}), 'manual', ${ctx.user.id})`
    await audit(tx, ctx, 'whatsapp.window_opened', 'account', accountId, a.market_code, null, { kind, hours })
  })
}

// ---------------------------------------------------------------- encabezado de la ficha por rol (UX-01)

const ROLES: Role[] = ['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops']
/** Los datos que cada rol ve arriba en la ficha (hasta cinco, en orden). */
export async function setFichaLayout(ctx: Ctx, role: string, facts: string[]): Promise<void> {
  ctx.assert('config.manage')
  if (!ROLES.includes(role as Role)) throw invalid('Ese rol no existe.', 'That role does not exist.')
  const picked = [...new Set(facts.filter((f) => f))]
  if (picked.length < 1 || picked.length > 5 || picked.some((f) => !(FICHA_FACTS as readonly string[]).includes(f))) throw invalid('Elige de uno a cinco datos de la lista, sin repetir.', 'Pick one to five facts from the list, with no repeats.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ facts: string[] }[]>`select facts from crm.ficha_layouts where role = ${role} for update`
    await tx`insert into crm.ficha_layouts (role, facts, updated_by) values (${role}, ${picked as FichaFact[]}, ${ctx.user.id})
             on conflict (role) do update set facts = excluded.facts, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'ficha.layout_set', 'ficha_layout', null, null, before[0] ? { role, facts: before[0].facts } : null, { role, facts: picked })
  })
}

// ---------------------------------------------------------------- contactos (E2.F4)

const CONTACT_ROLES = ['owner', 'decision_maker', 'manager', 'staff', 'billing', 'executive', 'purchasing', 'finance', 'technology', 'legal', 'operations'] as const
const contactEdit = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().max(160).optional().default(''),
  role: z.enum(CONTACT_ROLES),
  locale: z.enum(['es', 'en']).or(z.literal('')).optional().default(''),
})
/** Corrige un contacto del comercio: nombre, teléfono, correo, rol e idioma. Lo hace el equipo que lleva la cuenta, sin pedirlo a nadie. */
export async function updateContact(ctx: Ctx, accountId: string, contactId: string, input: z.input<typeof contactEdit>): Promise<void> {
  const parsed = contactEdit.safeParse(input)
  if (!parsed.success) throw invalid('Revisa nombre y rol del contacto.', 'Check the contact name and role.')
  const v = parsed.data
  assertNoProhibited(v.fullName)
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAcc(tx, accountId)
    ctx.assert('account.edit', a.market_code)
    const link = await tx<{ id: string; role: string; full_name: string; phone: string | null; email: string | null }[]>`
      select ac.id, ac.role, c.full_name, c.phone, c.email::text from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${accountId} and ac.contact_id = ${contactId} and ac.valid_to is null for update of ac`
    if (!link[0]) throw notFound('Ese contacto ya no está en este comercio.', 'That contact is no longer on this merchant.')
    const phone = v.phone ? toE164(v.phone, ctx.market(a.market_code).phoneCc) : null
    if (v.phone && !phone) throw invalid('El teléfono no parece válido.', 'The phone number does not look valid.')
    if (v.email && !z.string().email().safeParse(v.email).success) throw invalid('El correo no parece válido.', 'The email does not look valid.')
    await tx`update crm.contacts set full_name = ${v.fullName}, phone = ${phone}, email = ${clean(v.email)}, preferred_locale = ${v.locale || null},
              sms_capable = case when ${phone}::text is null then null else sms_capable end where id = ${contactId}`
    if (v.role !== link[0].role) await tx`update crm.account_contacts set role = ${v.role} where id = ${link[0].id}`
    await audit(tx, ctx, 'contact.updated', 'account', accountId, a.market_code, { name: link[0].full_name, role: link[0].role, had_phone: link[0].phone !== null, had_email: link[0].email !== null },
      { contact_id: contactId, name: v.fullName, role: v.role, has_phone: phone !== null, has_email: !!v.email })
  })
}

/** Da de baja a un contacto del comercio. No se borra: el vínculo se cierra con fecha y queda en la historia. */
export async function endContact(ctx: Ctx, accountId: string, contactId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAcc(tx, accountId)
    ctx.assert('account.edit', a.market_code)
    const link = await tx<{ id: string; is_primary: boolean; full_name: string }[]>`
      select ac.id, ac.is_primary, c.full_name from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${accountId} and ac.contact_id = ${contactId} and ac.valid_to is null for update of ac`
    if (!link[0]) throw notFound('Ese contacto ya no está en este comercio.', 'That contact is no longer on this merchant.')
    await tx`update crm.account_contacts set valid_to = now(), is_primary = false where id = ${link[0].id}`
    // Si era el principal, pasa a serlo el contacto vigente más antiguo.
    if (link[0].is_primary) {
      await tx`update crm.account_contacts set is_primary = true where id = (select id from crm.account_contacts where account_id = ${accountId} and valid_to is null order by valid_from limit 1)`
    }
    await tx`update crm.deals set decision_maker_id = null where account_id = ${accountId} and decision_maker_id = ${contactId} and status = 'open'`
    await audit(tx, ctx, 'contact.ended', 'account', accountId, a.market_code, { contact_id: contactId, name: link[0].full_name, primary: link[0].is_primary }, null)
  })
}

// ---------------------------------------------------------------- secciones de campos (E2.F5)

const sectionInput = z.object({
  market: z.string().length(2).or(z.literal('')),
  labelEs: z.string().trim().min(2).max(60),
  labelEn: z.string().trim().min(2).max(60),
  team: z.enum(['sales', 'ops', 'support', 'finance', 'all']),
})
/** Una sección nueva para agrupar campos en la ficha. Sin mercado vale para todos; con mercado, solo ese mercado la ve. */
export async function createFieldSection(ctx: Ctx, input: z.input<typeof sectionInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = sectionInput.safeParse(input)
  if (!parsed.success) throw invalid('La sección lleva nombre en español y en inglés (de 2 a 60 letras) y el equipo que la usa.', 'A section needs a name in Spanish and in English (2 to 60 characters) and the team that uses it.')
  const v = parsed.data
  assertNoProhibited(v.labelEs, v.labelEn)
  return withUser(ctx.user.id, async (tx) => {
    const market = v.market || null
    if (market && !(await tx`select 1 from crm.markets where code = ${market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    if ((await tx`select 1 from crm.field_sections where is_active and (market_code is null or ${market}::text is null or market_code = ${market}) and (lower(label_es) = lower(${v.labelEs}) or lower(label_en) = lower(${v.labelEn}))`)[0]) throw invalid('Ya hay una sección con ese nombre.', 'There is already a section with that name.')
    const base = v.labelEn.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 30) || 'section'
    let code = base.length < 2 ? `${base}_s` : base
    for (let i = 2; (await tx`select 1 from crm.field_sections where code = ${code}`)[0]; i++) code = `${base}_${i}`
    const id = await newId(tx)
    await tx`insert into crm.field_sections (id, code, market_code, label_es, label_en, team, position)
             values (${id}, ${code}, ${market}, ${v.labelEs}, ${v.labelEn}, ${v.team}, (select coalesce(max(position), 0) + 1 from crm.field_sections))`
    await audit(tx, ctx, 'field_section.created', 'field_section', id, market, null, { code, label_es: v.labelEs, label_en: v.labelEn, team: v.team })
    return id
  })
}

/** Mueve un campo a una sección (o lo deja sin sección). La sección tiene que valer para el mercado del campo. */
export async function setFieldSection(ctx: Ctx, fieldId: string, section: string): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string | null; section: string | null; key: string; object: string }[]>`select market_code, section, key, object from crm.field_definitions where id = ${fieldId} for update`
    const f = rows[0]
    if (!f) throw notFound('No encontramos ese campo.', 'We could not find that field.')
    const next = section || null
    if (next && !(await tx`select 1 from crm.field_sections where code = ${next} and is_active and (market_code is null or market_code = ${f.market_code})`)[0]) throw invalid('Esa sección no vale para el mercado de este campo.', 'That section does not apply to this field’s market.')
    if (next === f.section) return
    await tx`update crm.field_definitions set section = ${next} where id = ${fieldId}`
    await audit(tx, ctx, 'field.section_set', 'field', fieldId, f.market_code, { section: f.section }, { section: next, key: f.key, object: f.object })
  })
}
