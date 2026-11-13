import 'server-only'
import { marketToday, withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { ProcessAttr, ProcessStatus } from '@/domain/gobierno'
import type { Survivor } from '@/domain/datos'

// Lecturas del paquete datos: identidad del comercio (árbol, contactos, alias, productos, procesos), cola de duplicados,
// registro de campos, catálogos administrables y tablero de calidad. Todo corre con la identidad de quien mira (RLS).

export type NodeTotals = { open_deals: number; open_amount: string | null; won_deals: number; active: number; accounts: number; txn_30d: number; currency: string | null }

/** DAT-01: lo que suma un nodo del árbol con todo lo que cuelga de él: negocios abiertos y ganados, comercios activos y ventas. */
export async function nodeTotals(ctx: Ctx, accountId: string): Promise<NodeTotals> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<NodeTotals[]>`
      with node as (select d.id, d.lifecycle, d.market_code from crm.accounts d where (d.id = ${accountId} or d.ancestor_ids @> array[${accountId}]::uuid[]) and d.archived_at is null)
      select (select count(*)::int from crm.deals x where x.status = 'open' and x.account_id in (select id from node)) as open_deals,
             (select sum(x.amount_minor)::text from crm.deals x where x.status = 'open' and x.account_id in (select id from node)) as open_amount,
             (select count(*)::int from crm.deals x where x.status = 'won' and x.account_id in (select id from node)) as won_deals,
             (select count(*)::int from node where lifecycle = 'active') as active,
             (select count(*)::int from node) as accounts,
             coalesce((select sum(m.txn_count_30d)::int from crm.merchant_metrics_daily m
                        where m.account_id in (select id from node) and m.as_of = (select max(as_of) from crm.merchant_metrics_daily)), 0) as txn_30d,
             (select mk.currency::text from crm.markets mk where mk.code = (select market_code from node limit 1)) as currency`
    return rows[0]!
  })
}

export type TreeMove = { parent_name: string; valid_from: Date; valid_to: Date | null; reason: string | null; by_name: string | null }
export type ContactExtra = { contact_id: string; other_accounts: { id: string; name: string }[] }
export type PastContact = { full_name: string; role: string; valid_from: Date; valid_to: Date; end_reason: string | null }
export type PrimaryTurn = { full_name: string; from_at: Date; to_at: Date | null; by_name: string | null }
export type AliasRow = { id: string; system: string; kind: string; label_es: string; label_en: string; external_id: string; valid_from: Date; valid_to: Date | null; note: string | null; by_name: string | null }
export type AliasSystem = { code: string; label_es: string; label_en: string; kind: string; market_code: string | null; is_active: boolean; in_use: number }
export type MergeRow = { id: string; source_id: string; source_name: string; target_id: string; target_name: string; merged_at: Date; merged_by: string | null; undone_at: Date | null; undo_reason: string | null; moved: Record<string, string[]>; fields: Record<string, Survivor> }
export type AccountProduct = { id: string; product_id: string | null; product_name: string | null; provider_id: string | null; provider_es: string | null; provider_en: string | null; status: string; status_at: Date; requested_at: Date; submitted_at: Date | null; decided_at: Date | null; activated_at: Date | null; sla_days: number | null; late: boolean; note: string | null; deal_id: string | null }
export type ProcessRow = { list_id: string; name_es: string; name_en: string; statuses: ProcessStatus[]; attributes: ProcessAttr[]; is_active: boolean; membership_id: string | null; status: string | null; attrs: Record<string, string>; status_at: Date | null; ended_at: Date | null }

/** Todo lo que la ficha muestra en Datos sobre la identidad del comercio. */
export async function accountIdentity(ctx: Ctx, accountId: string, market: string) {
  return withUser(ctx.user.id, async (tx) => {
    const moves = await tx<TreeMove[]>`
      select p.name as parent_name, l.valid_from, l.valid_to, l.reason, u.full_name as by_name
        from crm.account_links l join crm.accounts p on p.id = l.parent_id left join crm.users u on u.id = l.created_by
       where l.child_id = ${accountId} order by l.valid_from desc limit 12`
    const others = await tx<{ contact_id: string; id: string; name: string }[]>`
      select ac.contact_id, a.id, a.name from crm.account_contacts mine
        join crm.account_contacts ac on ac.contact_id = mine.contact_id and ac.account_id <> mine.account_id and ac.valid_to is null and ac.deal_id is null
        join crm.accounts a on a.id = ac.account_id and a.archived_at is null
       where mine.account_id = ${accountId} and mine.valid_to is null order by a.name`
    const past = await tx<PastContact[]>`
      select c.full_name, ac.role, ac.valid_from, ac.valid_to, ac.end_reason from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${accountId} and ac.valid_to is not null and ac.deal_id is null order by ac.valid_to desc limit 12`
    const primaries = await tx<PrimaryTurn[]>`
      select c.full_name, h.from_at, h.to_at, u.full_name as by_name from crm.contact_primary_history h
        join crm.contacts c on c.id = h.contact_id left join crm.users u on u.id = h.changed_by
       where h.account_id = ${accountId} order by h.from_at desc limit 12`
    const aliases = await tx<AliasRow[]>`
      select al.id, al.system, s.kind, s.label_es, s.label_en, al.external_id, al.valid_from, al.valid_to, al.note, u.full_name as by_name
        from crm.account_aliases al join crm.alias_systems s on s.code = al.system left join crm.users u on u.id = coalesce(al.closed_by, al.created_by)
       where al.account_id = ${accountId} order by (al.valid_to is null) desc, al.valid_from desc limit 40`
    const systems = await tx<{ code: string; label_es: string; label_en: string; kind: string }[]>`
      select code, label_es, label_en, kind from crm.alias_systems where is_active and (market_code is null or market_code = ${market}) order by label_es`
    const merges = await tx<MergeRow[]>`
      select e.id, e.source_id, s.name as source_name, e.target_id, t.name as target_name, e.merged_at, u.full_name as merged_by, e.undone_at, e.undo_reason, e.moved,
             coalesce(e.survivorship -> 'fields', '{}'::jsonb) as fields
        from crm.merge_events e join crm.accounts s on s.id = e.source_id join crm.accounts t on t.id = e.target_id left join crm.users u on u.id = e.merged_by
       where e.target_id = ${accountId} or e.source_id = ${accountId} order by e.merged_at desc limit 10`
    const products = await accountProducts(tx, accountId)
    const catalog = await tx<{ id: string; name: string; provider_id: string | null }[]>`
      select id, name, provider_id from crm.products where is_active and (market_code is null or market_code = ${market}) order by name`
    const providers = await tx<{ id: string; label_es: string; label_en: string; sla_days: number | null }[]>`
      select id, label_es, label_en, sla_days from crm.ops_catalog where kind = 'provider' and is_active and (market_code is null or market_code = ${market}) order by position, label_es`
    const processes = await tx<ProcessRow[]>`
      select l.id as list_id, l.name_es, l.name_en, l.statuses, l.attributes, l.is_active, m.id as membership_id, m.status, coalesce(m.attrs, '{}'::jsonb) as attrs, m.status_at, m.ended_at
        from crm.process_lists l
        left join lateral (select x.* from crm.process_memberships x where x.list_id = l.id and x.account_id = ${accountId} order by (x.ended_at is null) desc, x.started_at desc limit 1) m on true
       where l.market_code = ${market} and (l.is_active or m.id is not null) order by l.name_es`
    const byContact = new Map<string, { id: string; name: string }[]>()
    for (const o of others) byContact.set(o.contact_id, [...(byContact.get(o.contact_id) ?? []), { id: o.id, name: o.name }])
    return { moves: [...moves], otherAccounts: byContact, past: [...past], primaries: [...primaries], aliases: [...aliases], systems: [...systems], merges: [...merges],
      products: [...products], catalog: [...catalog], providers: [...providers], processes: [...processes] }
  })
}

async function accountProducts(tx: Parameters<Parameters<typeof withUser>[1]>[0], accountId: string) {
  return tx<AccountProduct[]>`
    select p.id, p.product_id, pr.name as product_name, p.provider_id, k.label_es as provider_es, k.label_en as provider_en, p.status, p.status_at, p.requested_at,
           p.submitted_at, p.decided_at, p.activated_at, k.sla_days,
           (p.status = 'submitted' and k.sla_days is not null and p.submitted_at < now() - make_interval(days => k.sla_days)) as late, p.note, p.deal_id
      from crm.account_products p left join crm.products pr on pr.id = p.product_id left join crm.ops_catalog k on k.id = p.provider_id
     where p.account_id = ${accountId} order by pr.name nulls last, k.label_es`
}

// ---------------------------------------------------------------- cola de duplicados

export type Side = { id: string; name: string; phone: string | null; email: string | null; address_line: string | null; locality: string | null; region: string | null; postal_code: string | null;
  owner_name: string | null; territory: string | null; segment: string | null; merchant_ref: string | null; lifecycle: string; created_at: Date; deals: number; activities: number; contacts: number; aliases: number }
export type Pair = { id: string; market_code: string; match_kinds: string[]; strong: boolean; score: string; detected_at: Date; a: Side; b: Side }

const sideSql = (tx: Parameters<Parameters<typeof withUser>[1]>[0], alias: 'a' | 'b') => tx`
  jsonb_build_object('id', ${tx(alias)}.id, 'name', ${tx(alias)}.name, 'phone', ${tx(alias)}.phone, 'email', ${tx(alias)}.email::text, 'address_line', ${tx(alias)}.address_line,
    'locality', ${tx(alias)}.locality, 'region', ${tx(alias)}.region, 'postal_code', ${tx(alias)}.postal_code,
    'owner_name', (select full_name from crm.users u where u.id = ${tx(alias)}.owner_id), 'territory', (select name from crm.territories t where t.id = ${tx(alias)}.territory_id),
    'segment', ${tx(alias)}.segment, 'merchant_ref', ${tx(alias)}.merchant_ref, 'lifecycle', ${tx(alias)}.lifecycle, 'created_at', ${tx(alias)}.created_at,
    'deals', (select count(*) from crm.deals d where d.account_id = ${tx(alias)}.id), 'activities', (select count(*) from crm.activities x where x.account_id = ${tx(alias)}.id),
    'contacts', (select count(*) from crm.account_contacts c where c.account_id = ${tx(alias)}.id and c.valid_to is null),
    'aliases', (select count(*) from crm.account_aliases l where l.account_id = ${tx(alias)}.id and l.valid_to is null))`

export async function duplicateQueue(ctx: Ctx, market: string | null, pairId: string | null) {
  return withUser(ctx.user.id, async (tx) => {
    const pairs = await tx<Pair[]>`
      select p.id, p.market_code, p.match_kinds, p.strong, p.score::text, p.detected_at, ${sideSql(tx, 'a')} as a, ${sideSql(tx, 'b')} as b
        from crm.duplicate_pairs p join crm.accounts a on a.id = p.a_id join crm.accounts b on b.id = p.b_id
       where p.status = 'open' and a.archived_at is null and b.archived_at is null
         ${market ? tx`and p.market_code = ${market}` : tx``} ${pairId ? tx`and p.id = ${pairId}` : tx``}
       order by p.strong desc, p.score desc, p.detected_at limit ${pairId ? 1 : 25}`
    const counts = await tx<{ market_code: string; open: number; strong: number }[]>`
      select market_code, count(*)::int as open, (count(*) filter (where strong))::int as strong from crm.duplicate_pairs where status = 'open' group by 1 order by 1`
    const bypasses = await tx<{ id: string; market_code: string; account_id: string; account_name: string; matched: string[]; match_kinds: string[]; strong: boolean; reason: string; actor: string; created_at: Date; reviewed_at: Date | null }[]>`
      select b.id, b.market_code, b.account_id, a.name as account_name,
             array(select x.name from crm.accounts x where x.id = any(b.matched_ids)) as matched, b.match_kinds, b.strong, b.reason, u.full_name as actor, b.created_at, b.reviewed_at
        from crm.duplicate_bypasses b join crm.accounts a on a.id = b.account_id join crm.users u on u.id = b.actor_id
       where b.reviewed_at is null ${market ? tx`and b.market_code = ${market}` : tx``} order by b.created_at desc limit 30`
    const merges = await tx<MergeRow[]>`
      select e.id, e.source_id, s.name as source_name, e.target_id, t.name as target_name, e.merged_at, u.full_name as merged_by, e.undone_at, e.undo_reason, e.moved,
             coalesce(e.survivorship -> 'fields', '{}'::jsonb) as fields
        from crm.merge_events e join crm.accounts s on s.id = e.source_id join crm.accounts t on t.id = e.target_id left join crm.users u on u.id = e.merged_by
       where true ${market ? tx`and e.market_code = ${market}` : tx``} order by e.merged_at desc limit 15`
    return { pairs: [...pairs], counts: [...counts], bypasses: [...bypasses], merges: [...merges] }
  })
}

// ---------------------------------------------------------------- registro de campos

export type RegistryField = { id: string; object: string; key: string; label_es: string; label_en: string; data_type: string; options: string[]; market_code: string | null; motor: string | null;
  is_active: boolean; source: string; status: string; owner_id: string | null; owner_name: string | null; purpose: string | null; decision: string | null; review_on: string | null; review_due: boolean;
  pii_class: string; data_class: string; untrusted: boolean; origin: string | null; used_by: string | null; proposed_by: string | null; proposed_at: Date | null; overdue: boolean; decision_note: string | null;
  filled: number; total: number; stages: string[] }

export async function fieldRegistry(ctx: Ctx, view: 'vigentes' | 'propuestos' | 'archivados' | 'sin-decision') {
  return withUser(ctx.user.id, async (tx) => {
    const sla = Number((await tx<{ value: unknown }[]>`select value from crm.settings where key = 'field_approval_sla_days'`)[0]?.value ?? 3)
    const fields = await tx<RegistryField[]>`
      select f.id, f.object, f.key, f.label_es, f.label_en, f.data_type, f.options, f.market_code, f.motor, f.is_active, f.source, f.status, f.owner_id, o.full_name as owner_name,
             f.purpose, f.decision, f.review_on::text, (f.review_on is not null and f.review_on < ${marketToday(tx, tx`f.market_code`)}) as review_due, f.pii_class, f.data_class, f.untrusted, f.origin, f.used_by,
             p.full_name as proposed_by, f.proposed_at, (f.status = 'proposed' and f.proposed_at < now() - make_interval(days => ${sla})) as overdue, f.decision_note,
             coalesce(us.filled, 0) as filled, coalesce(us.total, 0) as total,
             array(select coalesce(s.name_es, '') || ' | ' || coalesce(s.name_en, '') from crm.stages s where ('field:' || f.key) = any(s.required_fields) and f.object = 'deal') as stages
        from crm.field_definitions f left join crm.users o on o.id = f.owner_id left join crm.users p on p.id = f.proposed_by
        left join app.field_usage() us on us.field_id = f.id
       where (f.market_code is null or f.market_code = any(${ctx.markets.map((m) => m.code)}::text[]))
         and ${view === 'propuestos' ? tx`f.status in ('proposed','rejected')` : view === 'archivados' ? tx`f.status = 'approved' and not f.is_active`
            : view === 'sin-decision' ? tx`f.status = 'approved' and f.is_active and (f.decision is null or f.owner_id is null or f.review_on is null or f.review_on < ${marketToday(tx, tx`f.market_code`)})`
            : tx`f.status = 'approved' and f.is_active`}
       order by f.object, f.market_code nulls first, f.position, f.label_es limit 300`
    const counts = await tx<{ vigentes: number; propuestos: number; archivados: number; sin_decision: number }[]>`
      select (count(*) filter (where status = 'approved' and is_active))::int as vigentes, (count(*) filter (where status = 'proposed'))::int as propuestos,
             (count(*) filter (where status = 'approved' and not is_active))::int as archivados,
             (count(*) filter (where status = 'approved' and is_active and (decision is null or owner_id is null or review_on is null or review_on < ${marketToday(tx, tx`market_code`)})))::int as sin_decision
        from crm.field_definitions where market_code is null or market_code = any(${ctx.markets.map((m) => m.code)}::text[])`
    const people = await tx<{ id: string; full_name: string }[]>`select id, full_name from crm.users where is_active and not is_system order by full_name limit 300`
    return { sla, fields: [...fields], counts: counts[0]!, people: [...people] }
  })
}

// ---------------------------------------------------------------- catálogos administrables

export async function dataCatalogs(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const markets = await tx<{ code: string; name: string; currency: string; default_locale: string; timezone: string; phone_cc: string; status: string; accounts: number; pipelines: number }[]>`
      select m.code, m.name, m.currency::text, m.default_locale, m.timezone, m.phone_cc, m.status,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null) as accounts,
             (select count(*)::int from crm.pipelines p where p.market_code = m.code) as pipelines
        from crm.markets m order by m.status, m.code`
    const forms = await tx<{ id: string; market_code: string; slug: string; name: string; motor: string; locale: string; is_active: boolean; rule_name: string | null; leads: number }[]>`
      select f.id, f.market_code, f.slug, f.name, f.motor, f.locale, f.is_active, r.name as rule_name, (select count(*)::int from crm.leads l where l.form_id = f.id) as leads
        from crm.web_forms f left join crm.routing_rules r on r.id = f.routing_rule_id order by f.market_code, f.name`
    const rules = await tx<{ id: string; market_code: string; name: string; strategy: string; members: string[]; fallback: string | null; sla_minutes: number; is_active: boolean }[]>`
      select r.id, r.market_code, r.name, r.strategy, array(select u.full_name from crm.users u where u.id = any(r.member_ids) order by u.full_name) as members,
             (select full_name from crm.users u where u.id = r.fallback_id) as fallback, r.sla_minutes, r.is_active
        from crm.routing_rules r order by r.market_code, r.name`
    const sellers = await tx<{ id: string; full_name: string; market_code: string }[]>`
      select distinct u.id, u.full_name, m.market_code from crm.users u join crm.memberships m on m.user_id = u.id
       where u.is_active and not u.is_system and m.role in ('rep','supervisor','market_lead') and m.market_code is not null and (m.valid_to is null or m.valid_to > now()) order by u.full_name`
    const systems = await tx<AliasSystem[]>`
      select s.code, s.label_es, s.label_en, s.kind, s.market_code, s.is_active, (select count(*)::int from crm.account_aliases al where al.system = s.code and al.valid_to is null) as in_use
        from crm.alias_systems s order by s.kind, s.label_es`
    const types = await tx<{ id: string; code: string; label_es: string; label_en: string; kind: string; market_code: string | null; max_depth: number | null; is_active: boolean }[]>`
      select id, code, label_es, label_en, kind, market_code, max_depth, is_active from crm.account_types where kind <> 'store' order by position, label_es`
    const lists = await tx<{ id: string; market_code: string; name_es: string; name_en: string; statuses: ProcessStatus[]; attributes: ProcessAttr[]; is_active: boolean; members: number }[]>`
      select l.id, l.market_code, l.name_es, l.name_en, l.statuses, l.attributes, l.is_active, (select count(*)::int from crm.process_memberships m where m.list_id = l.id and m.ended_at is null) as members
        from crm.process_lists l order by l.market_code, l.name_es`
    return { markets: [...markets], forms: [...forms], rules: [...rules], sellers: [...sellers], systems: [...systems], types: [...types], lists: [...lists] }
  })
}

// ---------------------------------------------------------------- productos por comercio (matriz)

export type MatrixRow = { id: string; account_id: string; account_name: string; market_code: string; product_name: string | null; provider_es: string | null; provider_en: string | null; status: string; status_at: Date; submitted_at: Date | null; sla_days: number | null; late: boolean }

export async function productMatrix(ctx: Ctx, f: { market: string | null; provider: string | null; status: string | null; late: boolean }) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<MatrixRow[]>`
      select p.id, p.account_id, a.name as account_name, p.market_code, pr.name as product_name, k.label_es as provider_es, k.label_en as provider_en, p.status, p.status_at, p.submitted_at, k.sla_days,
             (p.status = 'submitted' and k.sla_days is not null and p.submitted_at < now() - make_interval(days => k.sla_days)) as late
        from crm.account_products p join crm.accounts a on a.id = p.account_id left join crm.products pr on pr.id = p.product_id left join crm.ops_catalog k on k.id = p.provider_id
       where a.archived_at is null ${f.market ? tx`and p.market_code = ${f.market}` : tx``} ${f.provider ? tx`and p.provider_id = ${f.provider}` : tx``} ${f.status ? tx`and p.status = ${f.status}` : tx``}
         ${f.late ? tx`and p.status = 'submitted' and k.sla_days is not null and p.submitted_at < now() - make_interval(days => k.sla_days)` : tx``}
       order by late desc, p.status_at limit 200`
    const providers = await tx<{ id: string; market_code: string | null; label_es: string; label_en: string; sla_days: number | null; waiting: number; late: number }[]>`
      select k.id, k.market_code, k.label_es, k.label_en, k.sla_days,
             (select count(*)::int from crm.account_products p where p.provider_id = k.id and p.status = 'submitted') as waiting,
             (select count(*)::int from crm.account_products p where p.provider_id = k.id and p.status = 'submitted' and k.sla_days is not null and p.submitted_at < now() - make_interval(days => k.sla_days)) as late
        from crm.ops_catalog k where k.kind = 'provider' and k.is_active order by k.market_code nulls first, k.position, k.label_es`
    const products = await tx<{ id: string; name: string; market_code: string | null; provider_id: string | null; merchants: number; without: number }[]>`
      select pr.id, pr.name, pr.market_code, pr.provider_id, (select count(distinct p.account_id)::int from crm.account_products p where p.product_id = pr.id and p.status in ('approved','active')) as merchants,
             (select count(*)::int from crm.accounts a where a.archived_at is null and a.kind = 'store' and a.lifecycle = 'active' and (pr.market_code is null or a.market_code = pr.market_code)
                 and not exists (select 1 from crm.account_products p where p.account_id = a.id and p.product_id = pr.id and p.status not in ('rejected'))) as without
        from crm.products pr where pr.is_active and (pr.market_code is null or pr.market_code = any(${ctx.markets.map((m) => m.code)}::text[])) order by pr.market_code nulls first, pr.name limit 200`
    return { rows: [...rows], providers: [...providers], products: [...products] }
  })
}

export type ExpansionRow = { id: string; name: string; locality: string | null; owner_name: string | null; txn_30d: number | null }

/**
 * Base de expansión: comercios activos del mercado del producto que todavía no lo tienen (ni lo tienen en trámite),
 * primero los que más venden. De aquí sale a quién ofrecérselo.
 */
export async function expansionList(ctx: Ctx, productId: string) {
  return withUser(ctx.user.id, async (tx) => {
    const product = (await tx<{ id: string; name: string; market_code: string | null }[]>`select id, name, market_code from crm.products where id = ${productId} and is_active`)[0]
    if (!product) return null
    const rows = await tx<ExpansionRow[]>`
      select a.id, a.name, a.locality, u.full_name as owner_name,
             (select m.txn_count_30d from crm.merchant_metrics_daily m where m.account_id = a.id order by m.as_of desc limit 1) as txn_30d
        from crm.accounts a left join crm.users u on u.id = a.owner_id
       where a.archived_at is null and a.kind = 'store' and a.lifecycle = 'active' and (${product.market_code}::text is null or a.market_code = ${product.market_code})
         and not exists (select 1 from crm.account_products p where p.account_id = a.id and p.product_id = ${productId} and p.status not in ('rejected'))
       order by txn_30d desc nulls last, a.name limit 100`
    return { product, rows: [...rows] }
  })
}

// ---------------------------------------------------------------- tablero de calidad

export type QualityRule = { code: string; label_es: string; label_en: string; fix_es: string; fix_en: string; owner_role: string; owner_id: string | null; owner_name: string | null; threshold: number | null; is_active: boolean }
export type QualityCell = { market_code: string; team_id: string | null; team_name: string | null; rule_code: string; total: number; failing: number }
export type QualityTrend = { market_code: string; rule_code: string; as_of: string; failing: number }

export async function qualityBoard(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const rules = await tx<QualityRule[]>`
      select r.code, r.label_es, r.label_en, r.fix_es, r.fix_en, r.owner_role, r.owner_id, u.full_name as owner_name, r.threshold, r.is_active
        from crm.quality_rules r left join crm.users u on u.id = r.owner_id order by r.position`
    const cells = await tx<QualityCell[]>`
      select q.market_code, q.team_id, t.name as team_name, q.rule_code, q.total, q.failing
        from app.quality_measure() q left join crm.teams t on t.id = q.team_id where q.market_code = any(${ctx.markets.map((m) => m.code)}::text[])`
    // Tendencia: el corte más antiguo de los últimos 30 días contra hoy, por mercado y regla (sumando equipos).
    const trend = await tx<QualityTrend[]>`
      select s.market_code, s.rule_code, s.as_of::text, sum(s.failing)::int as failing from crm.quality_snapshots s
       where s.as_of >= (now() - interval '31 days')::date group by 1, 2, 3 order by 3`
    const people = await tx<{ id: string; full_name: string }[]>`select id, full_name from crm.users where is_active and not is_system order by full_name limit 300`
    return { rules: [...rules], cells: [...cells], trend: [...trend], people: [...people] }
  })
}

export type FailingRow = { kind: 'account' | 'deal'; id: string; name: string; who: string | null; since: Date }

export async function qualityQueue(ctx: Ctx, rule: string, market: string): Promise<FailingRow[]> {
  return withUser(ctx.user.id, async (tx) => [...(await tx<FailingRow[]>`select kind, id, name, who, since from app.quality_failing(${rule}, ${market}, 100)`)])
}

// ---------------------------------------------------------------- personas de un negocio (DAT-02)

export type DealPerson = { contact_id: string; full_name: string; role: string; phone: string | null; since: Date }

/** Quién participa en un negocio y con qué rol, y los contactos de la cuenta que todavía no están en él. */
export async function dealPeople(ctx: Ctx, dealId: string, accountId: string) {
  return withUser(ctx.user.id, async (tx) => {
    const people = await tx<DealPerson[]>`
      select c.id as contact_id, c.full_name, ac.role, c.phone, ac.valid_from as since from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.deal_id = ${dealId} and ac.valid_to is null order by ac.valid_from`
    const candidates = await tx<{ id: string; full_name: string; role: string }[]>`
      select c.id, c.full_name, ac.role from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${accountId} and ac.valid_to is null and ac.deal_id is null order by c.full_name`
    return { people: [...people], candidates: [...candidates] }
  })
}
