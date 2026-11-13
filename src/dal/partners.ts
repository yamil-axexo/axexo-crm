import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { whatsappWindow, type WindowState } from '@/domain/comms'
import type { CommissionLine, ContractStatus, TierMetrics } from '@/domain/partners'

export type TermsRow = { id: string; version: number; commission_lines: CommissionLine[]; settlement: string; fees: string | null; nda: boolean; term_months: number; valid_from: string; valid_to: string; renewal_notice_days: number; note: string | null; is_current: boolean; created_at: string; created_by_name: string | null }
export type ContractRow = { id: string; status: ContractStatus; terms_id: string; terms_version: number | null; starts_on: string; ends_on: string; renewal_notice_days: number; sent_at: string | null; signed_on: string | null; signed_by_name: string | null; document_url: string | null; esign_state: string | null; renewal_noticed_at: string | null; renewed_from: string | null; created_at: string }
export type AccountHead = { id: string; name: string; market_code: string; owner: string | null; kind: string; can_terms_view: boolean; can_terms_edit: boolean }

async function head(tx: Parameters<Parameters<typeof withUser>[1]>[0], id: string): Promise<AccountHead | null> {
  const rows = await tx<AccountHead[]>`
    select a.id, a.name, a.market_code, u.full_name as owner, a.kind,
           app.sensitive_can('commercial_terms', a.id, 'view') as can_terms_view, app.sensitive_can('commercial_terms', a.id, 'edit') as can_terms_edit
      from crm.accounts a left join crm.users u on u.id = a.owner_id where a.id = ${id} and a.archived_at is null`
  return rows[0] ?? null
}

/** PIPE-07: los términos (si quien mira puede verlos) y los contratos de una cuenta. */
export async function accountContracts(ctx: Ctx, id: string): Promise<{ account: AccountHead; terms: TermsRow[]; contracts: ContractRow[] } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const account = await head(tx, id)
    if (!account) return null
    const terms = await tx<TermsRow[]>`
      select t.id, t.version, t.commission_lines, t.settlement, t.fees, t.nda, t.term_months, t.valid_from::text, t.valid_to::text, t.renewal_notice_days,
             t.note, t.is_current, t.created_at::text, u.full_name as created_by_name
        from crm.commercial_terms t left join crm.users u on u.id = t.created_by where t.account_id = ${id} order by t.version desc`
    const contracts = await tx<ContractRow[]>`
      select c.id, c.status, c.terms_id, t.version as terms_version, c.starts_on::text, c.ends_on::text, c.renewal_notice_days, c.sent_at::text, c.signed_on::text,
             c.signed_by_name, c.document_url, c.esign_state, c.renewal_noticed_at::text, c.renewed_from, c.created_at::text
        from crm.contracts c left join crm.commercial_terms t on t.id = c.terms_id where c.account_id = ${id} order by c.created_at desc`
    return { account, terms, contracts }
  })
}

/** La propuesta imprimible: la cuenta y una versión de sus términos. Sin permiso de ver los términos, no hay propuesta. */
export async function proposal(ctx: Ctx, accountId: string, termsId: string | null): Promise<{ account: AccountHead & { locality: string | null; region: string | null; entity: string | null }; terms: TermsRow } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const a = await head(tx, accountId)
    if (!a) return null
    const extra = await tx<{ locality: string | null; region: string | null; entity: string | null }[]>`
      select a.locality, a.region, e.name as entity from crm.accounts a left join crm.legal_entities e on e.id = a.legal_entity_id where a.id = ${accountId}`
    const t = await tx<TermsRow[]>`
      select t.id, t.version, t.commission_lines, t.settlement, t.fees, t.nda, t.term_months, t.valid_from::text, t.valid_to::text, t.renewal_notice_days,
             t.note, t.is_current, t.created_at::text, null as created_by_name
        from crm.commercial_terms t where t.account_id = ${accountId} and (${termsId}::uuid is null and t.is_current or t.id = ${termsId}::uuid)`
    if (!t[0]) return null
    return { account: { ...a, ...extra[0]! }, terms: t[0] }
  })
}

export type Milestone = { id: string; position: number; phase: string; title: string; side: 'client' | 'axexo'; owner_user_id: string | null; owner: string | null; due_on: string | null; status: string; done_on: string | null; note: string | null; overdue: boolean }
export type Plan = { id: string; title: string; deal_id: string | null; deal_title: string | null; started_on: string; certified_on: string | null; days_to_cert: number | null; days_open: number; client_access: string; milestones: Milestone[] }
/** PIPE-08: los planes de integración de una cuenta, con sus hitos, y quién puede ser dueño del lado de axexo. */
export async function accountPlans(ctx: Ctx, id: string): Promise<{ account: AccountHead; plans: Plan[]; people: { id: string; full_name: string }[]; deals: { id: string; title: string }[] } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const account = await head(tx, id)
    if (!account) return null
    const plans = await tx<Omit<Plan, 'milestones'>[]>`
      select p.id, p.title, p.deal_id, d.title as deal_title, p.started_on::text, p.certified_on::text,
             (p.certified_on - p.started_on) as days_to_cert, (now()::date - p.started_on) as days_open, p.client_access
        from crm.integration_plans p left join crm.deals d on d.id = p.deal_id where p.account_id = ${id} order by p.created_at desc`
    const ms = await tx<(Milestone & { plan_id: string })[]>`
      select m.id, m.plan_id, m.position, m.phase, m.title, m.side, m.owner_user_id, coalesce(u.full_name, m.owner_name) as owner, m.due_on::text, m.status, m.done_on::text, m.note,
             (m.status <> 'done' and m.due_on is not null and m.due_on < (now() at time zone (select timezone from crm.markets where code = m.market_code))::date) as overdue
        from crm.plan_milestones m left join crm.users u on u.id = m.owner_user_id where m.account_id = ${id} order by m.position`
    const people = await tx<{ id: string; full_name: string }[]>`
      select distinct u.id, u.full_name from crm.users u join crm.memberships m on m.user_id = u.id
       where u.is_active and not u.is_system and m.role in ('admin','market_lead','supervisor','rep','ops') and (m.market_code = ${account.market_code} or m.market_code is null)
         and (m.valid_to is null or m.valid_to > now()) order by u.full_name`
    const deals = await tx<{ id: string; title: string }[]>`select id, title from crm.deals where account_id = ${id} and status = 'open' order by created_at desc limit 20`
    return { account, plans: plans.map((p) => ({ ...p, milestones: ms.filter((m) => m.plan_id === p.id) })), people, deals }
  })
}

export type Comm = { id: string; channel: 'email' | 'meeting' | 'whatsapp'; subject: string; body: string | null; participants: string[]; direction: string | null; occurred_at: string; ends_at: string | null; source: string; by: string | null }
/** ACT-03: lo capturado de una cuenta y su ventana de WhatsApp. */
export async function accountComms(ctx: Ctx, id: string): Promise<{ account: AccountHead; comms: Comm[]; window: WindowState; phone: string | null } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const account = await head(tx, id)
    if (!account) return null
    const comms = await tx<Comm[]>`
      select c.activity_id as id, c.channel, a.subject, a.body, c.participants, c.direction, c.occurred_at::text, c.ends_at::text, c.source, u.full_name as by
        from crm.activity_comms c join crm.activities a on a.id = c.activity_id left join crm.users u on u.id = c.created_by
       where c.account_id = ${id} order by c.occurred_at desc limit 100`
    const phone = (await tx<{ phone: string | null }[]>`select phone from crm.accounts where id = ${id}`)[0]?.phone ?? null
    return { account, comms, window: await whatsappWindow(tx, id), phone }
  })
}

export type PortalNode = { id: string; name: string; kind: string; account_type: string | null; lifecycle: string; depth: number; parent_id: string | null; open_deals: number; stage: string | null; stage_en: string | null; updated_at: string }
/** CANAL-01: el portal de una persona de partner. Lo que trae lo decide RLS: su nodo y todo lo que cuelga de él. */
export async function partnerPortal(ctx: Ctx): Promise<{ roots: { id: string; name: string; tier: string | null; tier_en: string | null; metrics: TierMetrics | null }[]; nodes: PortalNode[]; materials: { title_es: string; title_en: string; url: string }[] }> {
  return withUser(ctx.user.id, async (tx) => {
    const roots = await tx<{ id: string; name: string; tier: string | null; tier_en: string | null; metrics: TierMetrics | null; market_code: string; tier_code: string | null }[]>`
      select a.id, a.name, a.market_code, p.tier_code, t.name_es as tier, t.name_en as tier_en, p.metrics
        from crm.accounts a left join crm.partner_profiles p on p.account_id = a.id and p.ended_at is null
        left join crm.partner_tiers t on t.market_code = p.market_code and t.code = p.tier_code
       where a.id = any(app.partner_root_ids()) order by a.name`
    const nodes = await tx<PortalNode[]>`
      select a.id, a.name, a.kind, a.account_type, a.lifecycle, a.parent_id,
             coalesce(cardinality(a.ancestor_ids) - (select min(cardinality(r.ancestor_ids)) from crm.accounts r where r.id = any(app.partner_root_ids())), 0) as depth,
             (select count(*)::int from crm.deals d where d.account_id = a.id and d.status = 'open') as open_deals,
             (select s.name_es from crm.deals d join crm.stages s on s.id = d.stage_id where d.account_id = a.id order by d.updated_at desc limit 1) as stage,
             (select s.name_en from crm.deals d join crm.stages s on s.id = d.stage_id where d.account_id = a.id order by d.updated_at desc limit 1) as stage_en,
             a.updated_at::text
        from crm.accounts a
       where a.archived_at is null and a.merged_into is null
         and (a.id = any(app.partner_root_ids()) or a.ancestor_ids && app.partner_root_ids())
       order by a.ancestor_ids, a.name limit 500`
    const tiers = roots.filter((r) => r.tier_code).map((r) => `${r.market_code}:${r.tier_code}`)
    const materials = tiers.length
      ? await tx<{ title_es: string; title_en: string; url: string }[]>`
          select title_es, title_en, url from crm.partner_enablement where is_active and (market_code || ':' || tier_code) = any(${tiers}::text[]) order by title_es`
      : []
    return { roots: roots.map(({ id, name, tier, tier_en, metrics }) => ({ id, name, tier, tier_en, metrics })), nodes, materials }
  })
}

export type PartnerProfile = { account_id: string; name: string; market_code: string; since: string; tier_code: string | null; tier_period: string | null; metrics: TierMetrics | Record<string, never>; overlaps: number }
export type Tier = { market_code: string; code: string; name_es: string; name_en: string; rank: number; min_active: number; min_quality_pct: number; min_compliance_pct: number }
export type PartnerToken = { id: string; label: string; user: string; scope: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
/** Pantalla de partners para quien los maneja: perfiles con nivel, criterios, material, accesos, tokens y cruce de bases. */
export async function partnersAdmin(ctx: Ctx, market: string) {
  return withUser(ctx.user.id, async (tx) => {
    const profiles = await tx<PartnerProfile[]>`
      select p.account_id, a.name, p.market_code, p.since::text, p.tier_code, p.tier_period, p.metrics,
             (select count(*)::int from crm.partner_overlaps o where o.partner_account_id = p.account_id) as overlaps
        from crm.partner_profiles p join crm.accounts a on a.id = p.account_id where p.market_code = ${market} and p.ended_at is null order by a.name`
    const tiers = await tx<Tier[]>`select market_code, code, name_es, name_en, rank, min_active, min_quality_pct, min_compliance_pct from crm.partner_tiers where market_code = ${market} and is_active order by rank`
    const materials = await tx<{ id: string; tier_code: string; title_es: string; title_en: string; url: string }[]>`
      select id, tier_code, title_es, title_en, url from crm.partner_enablement where market_code = ${market} and is_active order by tier_code, title_es`
    const tokens = await tx<PartnerToken[]>`
      select t.id, t.label, u.full_name as user, a.name as scope, t.created_at::text, t.last_used_at::text, t.revoked_at::text
        from crm.partner_tokens t join crm.users u on u.id = t.user_id join crm.accounts a on a.id = t.scope_account_id where t.market_code = ${market} order by t.created_at desc`
    const partnerUsers = await tx<{ user_id: string; full_name: string; email: string; scope: string }[]>`
      select m.user_id, u.full_name, u.email::text, a.name as scope from crm.memberships m join crm.users u on u.id = m.user_id join crm.accounts a on a.id = m.scope_account_id
       where m.role = 'partner' and m.market_code = ${market} and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()) order by u.full_name`
    const overlaps = ctx.can('partner.crossmatch', market)
      ? await tx<{ partner: string; node: string; own: string; own_id: string; match_key: string; owner: string | null }[]>`
          select p.name as partner, n.name as node, o.name as own, o.id as own_id, x.match_key, u.full_name as owner
            from crm.partner_overlaps x join crm.accounts p on p.id = x.partner_account_id join crm.accounts n on n.id = x.node_account_id
            join crm.accounts o on o.id = x.own_account_id left join crm.users u on u.id = o.owner_id
           where x.market_code = ${market} order by p.name, n.name limit 200`
      : []
    const candidates = await tx<{ id: string; name: string }[]>`
      select a.id, a.name from crm.accounts a where a.market_code = ${market} and a.archived_at is null and a.merged_into is null and a.kind in ('distributor','organization','chain')
         and not exists (select 1 from crm.partner_profiles p where p.account_id = a.id and p.ended_at is null) order by a.name limit 300`
    const freeUsers = ctx.can('access.manage')
      ? await tx<{ id: string; full_name: string; email: string }[]>`
          select u.id, u.full_name, u.email::text from crm.users u where u.is_active and not u.is_system
             and not exists (select 1 from crm.memberships m where m.user_id = u.id and (m.valid_to is null or m.valid_to > now())) order by u.full_name limit 200`
      : []
    return { profiles, tiers, materials, tokens, partnerUsers, overlaps, candidates, freeUsers }
  })
}

export type NetworkLoad = { id: string; name: string; market_code: string; entity: string; source_system: string; status: string; rows_total: number; ready: number; errors: number; duplicates: number; promoted: number; legal_release_at: string | null; legal_by: string | null; business_release_at: string | null; business_by: string | null; created_at: string; created_by_name: string | null; root: string | null; mapping: Record<string, string> }
const loadCols = `l.id, l.name, l.market_code, e.name as entity, l.source_system, l.status, l.rows_total, l.mapping,
  (select count(*)::int from crm.network_load_rows r where r.load_id = l.id and r.status = 'ready') as ready,
  (select count(*)::int from crm.network_load_rows r where r.load_id = l.id and r.status = 'error') as errors,
  (select count(*)::int from crm.network_load_rows r where r.load_id = l.id and r.status = 'duplicate') as duplicates,
  (select count(*)::int from crm.network_load_rows r where r.load_id = l.id and r.status in ('promoted','kept')) as promoted,
  l.legal_release_at::text, ul.full_name as legal_by, l.business_release_at::text, ub.full_name as business_by, l.created_at::text, uc.full_name as created_by_name, ra.name as root`
/** DAT-06: las redes cargadas que quien mira puede ver (su mercado y, si aplica, su entidad legal). */
export async function networkLoads(ctx: Ctx): Promise<NetworkLoad[]> {
  return withUser(ctx.user.id, (tx) => tx.unsafe<NetworkLoad[]>(`
    select ${loadCols} from crm.network_loads l join crm.legal_entities e on e.id = l.legal_entity_id
      left join crm.users ul on ul.id = l.legal_release_by left join crm.users ub on ub.id = l.business_release_by left join crm.users uc on uc.id = l.created_by
      left join crm.accounts ra on ra.id = l.root_account_id
     order by l.created_at desc limit 50`))
}

export type LoadRow = { line: number; external_id: string; parent_external_id: string | null; name: string; phone: string | null; locality: string | null; status: string; issues: string[]; dup_key: string | null; dup_name: string | null; dup_id: string | null; batch: number | null; account_id: string | null }
export async function networkLoad(ctx: Ctx, id: string): Promise<{ load: NetworkLoad; byNode: { node: string; total: number; ready: number; errors: number; duplicates: number; promoted: number }[]; issues: { issue: string; n: number }[]; batches: { batch: number; promoted: number; kept: number }[]; rows: LoadRow[] } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const l = await tx.unsafe<NetworkLoad[]>(`
      select ${loadCols} from crm.network_loads l join crm.legal_entities e on e.id = l.legal_entity_id
        left join crm.users ul on ul.id = l.legal_release_by left join crm.users ub on ub.id = l.business_release_by left join crm.users uc on uc.id = l.created_by
        left join crm.accounts ra on ra.id = l.root_account_id where l.id = $1`, [id])
    if (!l[0]) return null
    // Calidad por nodo: cada fila cuenta en el nodo del que cuelga (su padre en el archivo, o la raíz).
    const byNode = await tx<{ node: string; total: number; ready: number; errors: number; duplicates: number; promoted: number }[]>`
      select coalesce(p.name || ' (' || r.parent_external_id || ')', r.parent_external_id, '') as node, count(*)::int as total,
             count(*) filter (where r.status = 'ready')::int as ready, count(*) filter (where r.status = 'error')::int as errors,
             count(*) filter (where r.status = 'duplicate')::int as duplicates, count(*) filter (where r.status in ('promoted','kept'))::int as promoted
        from crm.network_load_rows r left join crm.network_load_rows p on p.load_id = r.load_id and p.external_id = r.parent_external_id
       where r.load_id = ${id} group by 1 order by 2 desc limit 100`
    const issues = await tx<{ issue: string; n: number }[]>`
      select i as issue, count(*)::int as n from crm.network_load_rows r, unnest(r.issues) i where r.load_id = ${id} group by i
      union all select 'dup_' || dup_key, count(*)::int from crm.network_load_rows where load_id = ${id} and status = 'duplicate' group by dup_key order by 2 desc`
    const batches = await tx<{ batch: number; promoted: number; kept: number }[]>`
      select batch, count(*) filter (where status = 'promoted')::int as promoted, count(*) filter (where status = 'kept')::int as kept
        from crm.network_load_rows where load_id = ${id} and batch is not null group by batch order by batch`
    const rows = await tx<LoadRow[]>`
      select r.line, r.external_id, r.parent_external_id, r.name, r.phone, r.locality, r.status, r.issues, r.dup_key, a.name as dup_name, r.dup_account_id as dup_id, r.batch, r.account_id
        from crm.network_load_rows r left join crm.accounts a on a.id = r.dup_account_id
       where r.load_id = ${id} order by (r.status = 'ready'), r.line limit 200`
    return { load: l[0], byNode, issues, batches, rows }
  })
}

/** Lo necesario para el formulario de carga: entidades legales, cuentas raíz posibles y el último mapeo por sistema. */
export async function networkSetup(ctx: Ctx, market: string) {
  return withUser(ctx.user.id, async (tx) => {
    const entities = await tx<{ id: string; name: string }[]>`select id, name from crm.legal_entities where market_code = ${market} order by name`
    const roots = await tx<{ id: string; name: string }[]>`
      select id, name from crm.accounts where market_code = ${market} and archived_at is null and merged_into is null and kind in ('distributor','organization','chain') order by name limit 300`
    const last = await tx<{ source_system: string; mapping: Record<string, string> }[]>`
      select distinct on (source_system) source_system, mapping from crm.network_loads where market_code = ${market} order by source_system, created_at desc`
    return { entities, roots, lastMapping: Object.fromEntries(last.map((l) => [l.source_system, l.mapping])) as Record<string, Record<string, string>> }
  })
}

/** Para "Estado de CONTIGO": cuántas operaciones esperan en la cola de cada adaptador apagado. */
export async function externalQueueCounts(ctx: Ctx): Promise<Record<string, number>> {
  const rows = await withUser(ctx.user.id, (tx) => tx<{ adapter: string; n: number }[]>`select adapter, count(*)::int as n from crm.external_queue group by adapter`)
  return Object.fromEntries(rows.map((r) => [r.adapter, r.n]))
}
