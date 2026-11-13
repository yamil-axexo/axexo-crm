import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { addressFormat, marketReadiness, type AddressFormat, type GeoDuplicate, type MarketReadiness } from '@/domain/markets'
import { blindIndex } from '@/server/adapters/markets'
import { checkTaxId, TAX_ID_TYPES } from '@/lib/tax-id'
import { fichaRole, FICHA_FACTS, type FichaFact } from '@/lib/markets'
import { rolesIn, type Role } from '@/domain/policy'
import { isUuid } from '@/lib/ids'

// ---------------------------------------------------------------- encabezado de la ficha (UX-01)

export type AccountHeader = {
  id: string
  market: string
  lifecycle: string
  owner: string | null
  team: string | null
  path: { id: string; name: string }[]
  below: number
  alerts: number
  alert_kinds: string[]
  data_as_of: string | null
  txn_30d: number | null
  volume_minor_30d: number | null
  volume_currency: string | null
  next_step: { text: string; due: string | null; deal_id: string } | null
  open_deal: { id: string; stage_es: string; stage_en: string; amount_minor: number | null; currency: string; amount_usd_minor: number | null; fx_rate_date: string | null } | null
  entity: string
  entity_review: boolean
  business_unit: string | null
  tax: { status: 'format_valid' | 'needs_review' | 'verified' | 'rejected'; last4: string; type: string } | null
  contact: { name: string; phone: string | null; role: string } | null
  timezone: string
  own_timezone: boolean
  whatsapp_until: string | null
}

/**
 * Lo que va arriba en la ficha, en UNA llamada a la base (app.account_header), y qué datos ve el rol de quien la abre.
 * `ms` es lo que tardó la llamada: la prueba de base lo compara con el presupuesto de latencia.
 */
export async function getAccountHeader(ctx: Ctx, id: string): Promise<{ header: AccountHeader; role: Role; facts: FichaFact[]; units: Record<string, { es: string; en: string }>; ms: number } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const t0 = performance.now()
    const rows = await tx<{ h: AccountHeader | null }[]>`select app.account_header(${id}) as h`
    const ms = performance.now() - t0
    const header = rows[0]?.h
    if (!header) return null
    const role = fichaRole(rolesIn(ctx.memberships, header.market))
    const layout = await tx<{ facts: string[] }[]>`select facts from crm.ficha_layouts where role = ${role}`
    const facts = (layout[0]?.facts ?? ['next_step', 'owner_team', 'alerts', 'sales_30d', 'data_as_of']).filter((f): f is FichaFact => (FICHA_FACTS as readonly string[]).includes(f))
    const bu = await tx<{ code: string; label_es: string; label_en: string }[]>`select code, label_es, label_en from crm.business_units`
    return { header, role, facts, units: Object.fromEntries(bu.map((b) => [b.code, { es: b.label_es, en: b.label_en }])), ms }
  })
}

// ---------------------------------------------------------------- bloque de mercados en la ficha

export type AccountMarketData = {
  profile: { legal_entity_id: string; entity_name: string; entity_review: boolean; business_unit: string | null; timezone: string | null; market_timezone: string; country: string;
    address_line: string | null; address_line2: string | null; sublocality: string | null; locality: string | null; region: string | null; postal_code: string | null;
    latitude: string | null; longitude: string | null; geo_source: string | null; geo_accuracy_m: number | null; geo_at: Date | null; geo_by: string | null }
  entities: { id: string; name: string; is_default: boolean; needs_review: boolean }[]
  units: { code: string; label_es: string; label_en: string }[]
  format: AddressFormat
  near: GeoDuplicate[]
  tax: { id: string; id_type: string; last4: string; status: 'format_valid' | 'needs_review' | 'verified' | 'rejected'; checksum_ok: boolean | null; registry_status: string; legal_name: string | null;
    tax_regime: string | null; tax_postal_code: string | null; captured_by: string | null; captured_by_id: string | null; captured_at: Date; reviewed_by: string | null; reviewed_at: Date | null; review_note: string | null; fingerprint: boolean } | null
  checks: { layer: string; provider: string; result: string; detail: string | null; at: Date; actor: string | null }[]
  taxRepeats: { account_id: string; name: string; locality: string | null; owner_name: string | null }[]
  window: { kind: string; expires_at: Date; opened_by: string | null } | null
  whatsapp: { display_name: string; phone: string | null } | null
}

export async function getAccountMarketData(ctx: Ctx, id: string): Promise<AccountMarketData | null> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<AccountMarketData['profile'][]>`
      select a.legal_entity_id, e.name as entity_name, e.needs_review as entity_review, a.business_unit, a.timezone, m.timezone as market_timezone,
             coalesce(trim(a.country), a.market_code) as country, a.address_line, a.address_line2, a.sublocality, a.locality, a.region, a.postal_code,
             a.latitude::text, a.longitude::text, a.geo_source, a.geo_accuracy_m, a.geo_at, gu.full_name as geo_by
        from crm.accounts a join crm.legal_entities e on e.id = a.legal_entity_id join crm.markets m on m.code = a.market_code
        left join crm.users gu on gu.id = a.geo_by
       where a.id = ${id}`
    const profile = rows[0]
    if (!profile) return null
    const market = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${id}`)[0]!.market_code
    const entities = await tx<AccountMarketData['entities']>`select id, name, is_default, needs_review from crm.legal_entities where market_code = ${market} and archived_at is null order by is_default desc, name`
    const units = await tx<AccountMarketData['units']>`select code, label_es, label_en from crm.business_units where is_active order by position`
    const format = await addressFormat(tx, profile.country)
    const near = profile.latitude ? await tx<GeoDuplicate[]>`select id, name, locality, owner_name, distance_m from app.geo_duplicates(${id}, 60)` : []
    const tax = await tx<NonNullable<AccountMarketData['tax']>[]>`
      select t.id, t.id_type, t.last4, t.status, t.checksum_ok, t.registry_status, t.legal_name, t.tax_regime, t.tax_postal_code, cu.full_name as captured_by, t.captured_by as captured_by_id,
             t.captured_at, ru.full_name as reviewed_by, t.reviewed_at, t.review_note, t.blind_ix is not null as fingerprint
        from crm.tax_ids t left join crm.users cu on cu.id = t.captured_by left join crm.users ru on ru.id = t.reviewed_by
       where t.account_id = ${id} and t.valid_to is null`
    const checks = tax[0] ? await tx<AccountMarketData['checks']>`
      select v.layer, v.provider, v.result, v.detail, v.at, u.full_name as actor from crm.tax_id_verifications v left join crm.users u on u.id = v.actor_id
       where v.tax_id_id = ${tax[0].id} order by v.at, case v.layer when 'format' then 0 when 'registry' then 1 when 'risk_list' then 2 else 3 end` : []
    const taxRepeats = tax[0]?.fingerprint ? await tx<AccountMarketData['taxRepeats']>`
      select m.account_id, m.name, m.locality, m.owner_name from app.tax_id_matches((select blind_ix from crm.tax_ids where id = ${tax[0].id}), ${id}) m` : []
    const window = await tx<NonNullable<AccountMarketData['window']>[]>`
      select w.kind, w.expires_at, u.full_name as opened_by from crm.whatsapp_windows w left join crm.users u on u.id = w.opened_by
       where w.account_id = ${id} and w.expires_at > now() order by w.expires_at desc limit 1`
    const whatsapp = await tx<NonNullable<AccountMarketData['whatsapp']>[]>`
      select display_name, phone from crm.whatsapp_accounts where market_code = ${market} and legal_entity_id = ${profile.legal_entity_id} and is_active`
    return { profile, entities: [...entities], units: [...units], format, near: [...near], tax: tax[0] ?? null, checks: [...checks], taxRepeats: [...taxRepeats], window: window[0] ?? null, whatsapp: whatsapp[0] ?? null }
  })
}

// ---------------------------------------------------------------- cerca de mí (MULTI-04)

export type NearAccount = { id: string; name: string; market_code: string; lifecycle: string; locality: string | null; address_line: string | null; owner_name: string | null; phone: string | null; distance_m: number }
export async function accountsNear(ctx: Ctx, lat: number, lon: number, radiusM: number): Promise<NearAccount[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<NearAccount[]>`select id, name, market_code, lifecycle, locality, address_line, owner_name, phone, distance_m from app.accounts_near(${lat.toFixed(6)}::numeric, ${lon.toFixed(6)}::numeric, ${Math.round(radiusM)}, 40)`
    return [...rows]
  })
}
/** Cuántos comercios del alcance de la persona tienen ubicación: para decir la verdad cuando "cerca de mí" sale vacío. */
export async function locatedCount(ctx: Ctx): Promise<{ located: number; total: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ located: number; total: number }[]>`select count(*) filter (where latitude is not null)::int as located, count(*)::int as total from crm.accounts where archived_at is null`
    return rows[0]!
  })
}

// ---------------------------------------------------------------- búsqueda por identificador fiscal y por enlace externo

/** MULTI-03: búsqueda por coincidencia exacta. El texto se prueba contra cada tipo; si tiene forma de identificador, se compara su huella. */
export async function accountsByTaxId(ctx: Ctx, term: string): Promise<{ id: string; name: string; market_code: string; locality: string | null }[]> {
  const blinds = TAX_ID_TYPES.filter((x) => x.type !== 'other').map((x) => ({ type: x.type, check: checkTaxId(x.type, term) })).filter((x) => x.check.formatOk)
    .map((x) => blindIndex(x.type, x.check.normalized)).filter((b): b is string => b !== null)
  if (blinds.length === 0) return []
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; name: string; market_code: string; locality: string | null }[]>`
      select a.id, a.name, a.market_code, a.locality from crm.tax_ids t join crm.accounts a on a.id = t.account_id
       where t.valid_to is null and t.blind_ix = any(${blinds}::text[]) and a.archived_at is null order by a.name limit 10`
    return [...rows]
  })
}

/** UX-04: el comercio que corresponde a un identificador de otro sistema (Sales App, Merchant ID, Pipedrive...) o al propio de CONTIGO. */
export async function accountByRef(ctx: Ctx, ref: string, system?: string): Promise<{ id: string } | null> {
  const value = ref.trim()
  if (!value || value.length > 80) return null
  return withUser(ctx.user.id, async (tx) => {
    if (isUuid(value)) {
      const own = await tx<{ id: string }[]>`select id from crm.accounts where id = ${value}`
      if (own[0]) return own[0]
    }
    const rows = await tx<{ id: string }[]>`
      select a.id from crm.account_aliases al join crm.accounts a on a.id = al.account_id
       where al.valid_to is null and upper(al.external_id) = upper(${value}) ${system ? tx`and al.system = ${system}` : tx``}
       order by (al.system = 'sales_core') desc, al.valid_from desc limit 1`
    if (rows[0]) return rows[0]
    const byMerchant = await tx<{ id: string }[]>`select id from crm.accounts where archived_at is null and merchant_ref is not null and upper(btrim(merchant_ref)) = upper(${value}) order by created_at limit 1`
    return byMerchant[0] ?? null
  })
}

// ---------------------------------------------------------------- administración

export type MarketsAdmin = {
  markets: { code: string; name: string; currency: string; default_locale: string; timezone: string; phone_cc: string; status: 'live' | 'planned'; accounts: number; ready: MarketReadiness }[]
  entities: { id: string; market_code: string; name: string; is_default: boolean; needs_review: boolean; accounts: number; deals: number; people: number }[]
  holidays: { market_code: string; day: string; name: string }[]
  people: { id: string; full_name: string; email: string; legal_entity_id: string | null; markets: string[]; limited: boolean }[]
  whatsapp: { id: string; market_code: string; legal_entity_id: string; entity: string; display_name: string; phone: string | null; external_ref: string | null; daily_limit: number | null }[]
  templates: { id: string; account_id: string; market_code: string; key: string; locale: string; category: string; body: string; status: string }[]
  rates: { market_code: string; category: string; currency: string; cost: string; effective_from: string; source: string }[]
  layouts: { role: Role; facts: string[] }[]
  sections: { id: string; code: string; market_code: string | null; label_es: string; label_en: string; team: string | null; fields: number }[]
  fields: { id: string; object: string; label_es: string; label_en: string; market_code: string | null; section: string | null }[]
  units: { code: string; label_es: string; label_en: string; accounts: number }[]
}

export async function getMarketsAdmin(ctx: Ctx): Promise<MarketsAdmin> {
  return withUser(ctx.user.id, async (tx) => {
    const markets = await tx<Omit<MarketsAdmin['markets'][number], 'ready'>[]>`
      select m.code, m.name, trim(m.currency) as currency, m.default_locale, m.timezone, m.phone_cc, m.status,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null) as accounts
        from crm.markets m order by m.status, m.code`
    const withReady: MarketsAdmin['markets'] = []
    for (const m of markets) withReady.push({ ...m, ready: await marketReadiness(tx, m.code) })
    const entities = await tx<MarketsAdmin['entities']>`
      select e.id, e.market_code, e.name, e.is_default, e.needs_review,
             (select count(*)::int from crm.accounts a where a.legal_entity_id = e.id and a.archived_at is null) as accounts,
             (select count(*)::int from crm.deals d where d.legal_entity_id = e.id) as deals,
             (select count(*)::int from crm.users u where u.legal_entity_id = e.id and u.is_active) as people
        from crm.legal_entities e where e.archived_at is null order by e.market_code, e.is_default desc, e.name`
    const holidays = await tx<MarketsAdmin['holidays']>`select market_code, day::text, name from crm.market_holidays where day >= (now() at time zone 'UTC')::date - 30 order by day, market_code limit 200`
    const people = await tx<MarketsAdmin['people']>`
      select u.id, u.full_name, u.email::text, u.legal_entity_id,
             coalesce(array_agg(distinct m.market_code) filter (where m.market_code is not null), '{}') as markets,
             coalesce(bool_or(m.legal_entity_id is not null), false) as limited
        from crm.users u join crm.memberships m on m.user_id = u.id and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
       where u.is_active and not u.is_system group by u.id, u.full_name, u.email, u.legal_entity_id order by u.full_name limit 300`
    const whatsapp = await tx<MarketsAdmin['whatsapp']>`
      select w.id, w.market_code, w.legal_entity_id, e.name as entity, w.display_name, w.phone, w.external_ref, w.daily_limit
        from crm.whatsapp_accounts w join crm.legal_entities e on e.id = w.legal_entity_id where w.is_active order by w.market_code, e.name`
    const templates = await tx<MarketsAdmin['templates']>`select id, account_id, market_code, key, locale, category, body, status from crm.whatsapp_templates where is_active order by market_code, key, locale`
    const rates = await tx<MarketsAdmin['rates']>`
      select distinct on (market_code, category) market_code, category, trim(currency) as currency, cost::text, effective_from::text, source
        from crm.whatsapp_rates order by market_code, category, effective_from desc`
    const layouts = await tx<MarketsAdmin['layouts']>`select role, facts from crm.ficha_layouts order by case role when 'rep' then 0 when 'supervisor' then 1 when 'market_lead' then 2 when 'ops' then 3 when 'lt' then 4 else 5 end`
    const sections = await tx<MarketsAdmin['sections']>`
      select s.id, s.code, s.market_code, s.label_es, s.label_en, s.team,
             (select count(*)::int from crm.field_definitions f where f.section = s.code and f.is_active and (s.market_code is null or f.market_code = s.market_code)) as fields
        from crm.field_sections s where s.is_active order by s.market_code nulls first, s.position`
    const fields = await tx<MarketsAdmin['fields']>`select id, object, label_es, label_en, market_code, section from crm.field_definitions where is_active and object in ('account', 'deal') order by object, position, label_en limit 300`
    const units = await tx<MarketsAdmin['units']>`
      select b.code, b.label_es, b.label_en, (select count(*)::int from crm.accounts a where a.business_unit = b.code and a.archived_at is null) as accounts
        from crm.business_units b where b.is_active order by b.position`
    return { markets: withReady, entities: [...entities], holidays: [...holidays], people: [...people], whatsapp: [...whatsapp], templates: [...templates], rates: [...rates], layouts: [...layouts], sections: [...sections], fields: [...fields], units: [...units] }
  })
}

// ---------------------------------------------------------------- consolidado en USD (MULTI-01, E1.F10)

export type ConsolidatedCut = 'market' | 'entity' | 'unit'
export type ConsolidatedRow = {
  key: string
  label: string
  currency: string
  deals: number
  amount_minor: string
  usd_minor: string | null
  weighted_usd_minor: string | null
  /** Negocios con monto que no se pudieron convertir porque no hay tasa cargada para su fecha. */
  unconverted: number
  rate_from: string | null
  rate_to: string | null
  sources: string[]
}

/**
 * Negocios con monto, en su moneda y en USD. UNA sola regla para sumar: cada negocio usa la tasa que quedó guardada en él
 * (la del día para los abiertos, la del cierre para los cerrados). No se mezcla con ninguna tasa "de hoy": un negocio sin
 * tasa guardada no entra al total en USD y se cuenta aparte.
 */
export async function getConsolidated(ctx: Ctx, f: { status: 'open' | 'won'; cut: ConsolidatedCut; market?: string; from?: string; to?: string }): Promise<{ rows: ConsolidatedRow[]; total_usd_minor: string | null; unconverted: number; deals: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const key = f.cut === 'entity' ? tx`d.legal_entity_id::text` : f.cut === 'unit' ? tx`coalesce(d.business_unit, '')` : tx`d.market_code`
    const label = f.cut === 'entity' ? tx`e.name` : f.cut === 'unit' ? (ctx.locale === 'en' ? tx`coalesce(b.label_en, '')` : tx`coalesce(b.label_es, '')`) : tx`m.name`
    const rows = await tx<ConsolidatedRow[]>`
      select ${key} as key, ${label} as label, trim(d.currency) as currency, count(*)::int as deals,
             sum(d.amount_minor)::text as amount_minor, sum(d.amount_usd_minor)::text as usd_minor,
             round(sum(d.amount_usd_minor * s.probability / 100.0))::text as weighted_usd_minor,
             count(*) filter (where d.amount_usd_minor is null)::int as unconverted,
             min(d.fx_rate_date)::text as rate_from, max(d.fx_rate_date)::text as rate_to,
             coalesce(array_agg(distinct d.fx_source) filter (where d.fx_source is not null and d.fx_source <> 'USD'), '{}') as sources
        from crm.deals d
        join crm.stages s on s.id = d.stage_id
        join crm.markets m on m.code = d.market_code
        join crm.legal_entities e on e.id = d.legal_entity_id
        left join crm.business_units b on b.code = d.business_unit
       where d.amount_minor is not null and d.status = ${f.status}
         ${f.market ? tx`and d.market_code = ${f.market}` : tx``}
         ${f.status === 'won' && f.from ? tx`and (d.won_at at time zone m.timezone)::date >= ${f.from}::date` : tx``}
         ${f.status === 'won' && f.to ? tx`and (d.won_at at time zone m.timezone)::date <= ${f.to}::date` : tx``}
       group by 1, 2, 3 order by 2, 3`
    const total = rows.reduce<bigint | null>((acc, r) => (r.usd_minor === null ? acc : (acc ?? 0n) + BigInt(r.usd_minor)), null)
    return { rows: [...rows], total_usd_minor: total === null ? null : total.toString(), unconverted: rows.reduce((n, r) => n + r.unconverted, 0), deals: rows.reduce((n, r) => n + r.deals, 0) }
  })
}
