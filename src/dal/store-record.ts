import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { protectedDataAdapter } from '@/server/adapters/markets'

export type Carrier = {
  provider_id: string; label_es: string; label_en: string; ref_label: string | null; is_active: boolean; sla_days: number | null
  /** Renglón del carrier en la tienda (sin producto). Nulo si el carrier solo aparece por un producto. */
  row_id: string | null
  status: string; status_at: Date | null; requested_at: Date | null; submitted_at: Date | null; decided_at: Date | null; activated_at: Date | null
  carrier_ref: string | null; kit_sent_on: string | null; sims_ordered: number | null; training_on: string | null; note: string | null; deal_id: string | null
  products: number; late: boolean
}
export type StoreRecord = {
  merchant_ref: string | null; site_ref: string | null; tax_id_last4: string | null
  business_type: string | null; business_es: string | null; business_en: string | null; takes_business_type: boolean
  merchant_origin: string | null; merchant_origin_at: Date | null
  recruited_by: string | null; recruited_agency: string | null; recruited_at: Date | null; retired_carriers: string | null
  /** Carriers con los que la tienda trabaja o ha trabajado: solo los que tienen movimiento. */
  carriers: Carrier[]
  /** Carriers vigentes del mercado en los que la tienda no tiene nada: no se muestran vacíos, se ofrecen para agregar. */
  available: { id: string; label_es: string; label_en: string; ref_label: string | null }[]
  businessTypes: { code: string; label_es: string; label_en: string }[]
  agencies: { id: string; kind: string; name: string }[]
}

/**
 * La ficha de dealer de una tienda (E9): identificadores, tipo de negocio, origen, reclutado por y su portafolio de carriers.
 * El portafolio sale de crm.account_products: el mismo registro que escribe Operaciones desde un negocio. RLS decide si se ve la tienda.
 */
export async function storeRecord(ctx: Ctx, accountId: string, market: string): Promise<StoreRecord | null> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Omit<StoreRecord, 'carriers' | 'available' | 'businessTypes' | 'agencies'>[]>`
      select a.merchant_ref, a.site_ref, a.tax_id_last4, a.business_type, b.label_es as business_es, b.label_en as business_en,
             coalesce((select t.takes_business_type from crm.account_types t where t.code = a.account_type and (t.market_code is null or t.market_code = a.market_code)
                        order by t.market_code nulls last limit 1), false) as takes_business_type,
             a.merchant_origin, a.merchant_origin_at, a.recruited_by, g.name as recruited_agency, a.recruited_at, a.retired_carriers
        from crm.accounts a
        left join crm.business_types b on b.market_code = a.market_code and b.code = a.business_type
        left join crm.agencies g on g.id = a.recruited_agency_id
       where a.id = ${accountId}`
    if (!rows[0]) return null
    const all = await tx<(Omit<Carrier, 'status'> & { status: string | null })[]>`
      select k.id as provider_id, k.label_es, k.label_en, k.ref_label, k.is_active, k.sla_days, p.id as row_id,
             coalesce(p.status, x.status) as status, coalesce(p.status_at, x.status_at) as status_at, coalesce(p.requested_at, x.requested_at) as requested_at,
             coalesce(p.submitted_at, x.submitted_at) as submitted_at, coalesce(p.decided_at, x.decided_at) as decided_at, coalesce(p.activated_at, x.activated_at) as activated_at,
             p.carrier_ref, p.kit_sent_on::text, p.sims_ordered, p.training_on::text, p.note, coalesce(p.deal_id, x.deal_id) as deal_id,
             (select count(*)::int from crm.account_products y where y.account_id = ${accountId} and y.provider_id = k.id and y.product_id is not null) as products,
             coalesce(coalesce(p.status, x.status) = 'submitted' and k.sla_days is not null and coalesce(p.submitted_at, x.submitted_at) < now() - make_interval(days => k.sla_days), false) as late
        from crm.ops_catalog k
        left join crm.account_products p on p.provider_id = k.id and p.account_id = ${accountId} and p.product_id is null
        left join lateral (select y.status, y.status_at, y.requested_at, y.submitted_at, y.decided_at, y.activated_at, y.deal_id from crm.account_products y
                            where y.account_id = ${accountId} and y.provider_id = k.id and y.product_id is not null order by y.status_at desc limit 1) x on true
       where k.kind = 'provider' and (k.market_code is null or k.market_code = ${market})
       order by k.position, k.label_en`
    const carriers = all.filter((c): c is Carrier => c.status !== null)
    const available = all.filter((c) => c.status === null && c.is_active).map((c) => ({ id: c.provider_id, label_es: c.label_es, label_en: c.label_en, ref_label: c.ref_label }))
    const businessTypes = await tx<StoreRecord['businessTypes']>`select code, label_es, label_en from crm.business_types where market_code = ${market} and is_active order by position, label_es`
    const agencies = await tx<StoreRecord['agencies']>`select id, kind, name from crm.agencies where market_code = ${market} and is_active order by kind, name`
    return { ...rows[0], carriers: [...carriers], available, businessTypes: [...businessTypes], agencies: [...agencies] }
  })
}

export type AgencyRow = { id: string; market_code: string; market_name: string; kind: string; name: string; is_active: boolean; stores: number }
export type ProviderLabelRow = { id: string; market_name: string | null; label_es: string; label_en: string; ref_label: string | null }

/** Agencias y socios de los mercados donde la persona los administra, con cuántas tiendas reclutó cada uno. */
export async function agenciesAdmin(ctx: Ctx): Promise<{ agencies: AgencyRow[]; providers: ProviderLabelRow[] }> {
  return withUser(ctx.user.id, async (tx) => {
    const markets = ctx.markets.filter((m) => ctx.can('agency.manage', m.code)).map((m) => m.code)
    const agencies = await tx<AgencyRow[]>`
      select g.id, g.market_code, m.name as market_name, g.kind, g.name, g.is_active,
             (select count(*)::int from crm.accounts a where a.recruited_agency_id = g.id and a.archived_at is null) as stores
        from crm.agencies g join crm.markets m on m.code = g.market_code
       where g.market_code = any(${markets}::text[]) order by m.name, g.is_active desc, g.kind, g.name`
    const providers = ctx.can('config.manage') ? await tx<ProviderLabelRow[]>`
      select k.id, m.name as market_name, k.label_es, k.label_en, k.ref_label from crm.ops_catalog k left join crm.markets m on m.code = k.market_code
       where k.kind = 'provider' and k.is_active order by m.name nulls first, k.position, k.label_en` : []
    return { agencies: [...agencies], providers: [...providers] }
  })
}

/** Para el alta de una tienda: agencias y socios activos de los mercados con ficha de dealer donde la persona puede crear comercios. */
export async function recruiterChoices(ctx: Ctx): Promise<{ id: string; market_code: string; kind: string; name: string }[]> {
  const markets = ctx.markets.filter((m) => m.dealerRecord && ctx.can('account.create', m.code)).map((m) => m.code)
  if (markets.length === 0) return []
  return withUser(ctx.user.id, async (tx) => [...await tx<{ id: string; market_code: string; kind: string; name: string }[]>`
    select id, market_code, kind, name from crm.agencies where is_active and market_code = any(${markets}::text[]) order by market_code, kind, name`])
}

/** E9.F12: quién reclutó la tienda de un negocio (el negocio lo copia de la tienda y queda fijo). */
export async function dealRecruiter(ctx: Ctx, dealId: string): Promise<{ recruited_by: string; agency: string | null } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ recruited_by: string | null; agency: string | null }[]>`
      select d.recruited_by, g.name as agency from crm.deals d left join crm.agencies g on g.id = d.recruited_agency_id where d.id = ${dealId}`
    return rows[0]?.recruited_by ? { recruited_by: rows[0].recruited_by, agency: rows[0].agency } : null
  })
}

/**
 * E9.F13: el Tax ID de una tienda para un documento. Es la única puerta: todo documento que lo necesite lo pide aquí y sale ya
 * capturado, sin volver a pedirlo. Con el resguardo de datos protegidos apagado (como está), sale enmascarado con sus últimos 4.
 */
export async function documentTaxId(ctx: Ctx, accountId: string): Promise<{ text: string; complete: boolean } | null> {
  const last4 = await withUser(ctx.user.id, async (tx) => (await tx<{ tax_id_last4: string | null }[]>`select tax_id_last4 from crm.accounts where id = ${accountId}`)[0]?.tax_id_last4 ?? null)
  if (!last4) return null
  const full = await protectedDataAdapter().read({ kind: 'tax_id', accountId })
  return full ? { text: full, complete: true } : { text: `•••••${last4}`, complete: false }
}
