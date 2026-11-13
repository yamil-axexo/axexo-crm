import 'server-only'
import { withUser, marketToday } from '@/server/db'
import type { Ctx } from '@/server/context'
import { THRESHOLD_KEYS, THRESHOLDS } from '@/domain/campo-canal/thresholds'

/** Lecturas del paquete campo-canal. Todas corren con la identidad de la persona: RLS decide qué filas ve. */

export type Option = { id: string; name: string }

export async function marketAccounts(ctx: Ctx, market: string): Promise<Option[]> {
  return withUser(ctx.user.id, (tx) => tx<Option[]>`
    select id, name from crm.accounts where market_code = ${market} and archived_at is null order by name, id limit 300`)
}

export async function marketPeople(ctx: Ctx, market: string, roles: string[] = ['rep', 'supervisor', 'market_lead']): Promise<Option[]> {
  return withUser(ctx.user.id, (tx) => tx<Option[]>`
    select distinct u.id, u.full_name as name from crm.users u join crm.memberships m on m.user_id = u.id
     where m.market_code = ${market} and m.role = any(${roles}) and u.is_active and not u.is_system
       and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()) order by name`)
}

export async function accountName(ctx: Ctx, id: string | undefined): Promise<{ id: string; name: string; market_code: string } | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return withUser(ctx.user.id, async (tx) => (await tx<{ id: string; name: string; market_code: string }[]>`select id, name, market_code from crm.accounts where id = ${id}`)[0] ?? null)
}

// ---------------------------------------------------------------- expedientes
export type FileRow = {
  id: string; account_id: string; account: string; status: string; funding: string; person_type: string; captured_via: string
  due_at: Date | null; overdue: boolean; assigned: string | null; docs_total: number; docs_valid: number; docs_missing: number; docs_rejected: number
  created_at: Date; submitted_at: Date | null; decided_at: Date | null; decision_note: string | null
}
export async function onboardingFiles(ctx: Ctx, market: string, scope: 'desk' | 'open' | 'decided'): Promise<FileRow[]> {
  return withUser(ctx.user.id, (tx) => tx<FileRow[]>`
    select f.id, f.account_id, a.name as account, f.status, f.funding, f.person_type, f.captured_via, f.due_at,
           (f.due_at is not null and f.due_at < now() and f.status in ('submitted', 'in_review')) as overdue, u.full_name as assigned,
           count(d.id)::int as docs_total, count(d.id) filter (where d.status = 'valid')::int as docs_valid,
           count(d.id) filter (where d.status = 'missing')::int as docs_missing, count(d.id) filter (where d.status = 'rejected')::int as docs_rejected,
           f.created_at, f.submitted_at, f.decided_at, f.decision_note
      from crm.onboarding_files f join crm.accounts a on a.id = f.account_id
      left join crm.users u on u.id = f.assigned_to
      left join crm.onboarding_documents d on d.file_id = f.id
     where f.market_code = ${market}
       and ${scope === 'desk' ? tx`f.status in ('submitted', 'in_review')` : scope === 'open' ? tx`f.status in ('draft', 'returned')` : tx`f.status in ('approved', 'auto_approved')`}
     group by f.id, a.name, u.full_name
     order by ${scope === 'desk' ? tx`f.due_at nulls last` : tx`f.created_at desc`}, f.id limit 100`)
}

export type DocRow = { id: string; requirement: string; label_es: string | null; label_en: string | null; feeds: string | null; status: string; link: string | null; note: string | null; pii_class: string; retention_until: string | null; validated_by: string | null; validated_at: Date | null; reads: number }
export async function fileDocuments(ctx: Ctx, fileId: string): Promise<DocRow[]> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return []
  return withUser(ctx.user.id, (tx) => tx<DocRow[]>`
    select d.id, d.requirement, r.label_es, r.label_en, r.feeds, d.status, d.link, d.note, d.pii_class, d.retention_until::text, u.full_name as validated_by, d.validated_at,
           (select count(*)::int from crm.document_reads x where x.document_id = d.id) as reads
      from crm.onboarding_documents d join crm.onboarding_files f on f.id = d.file_id
      left join crm.onboarding_requirements r on r.market_code = d.market_code and r.code = d.requirement and r.person_type = f.person_type and r.funding in (f.funding, 'any')
      left join crm.users u on u.id = d.validated_by
     where d.file_id = ${fileId} order by r.position nulls last, d.requirement`)
}

/** Medición del alta: de la visita a la aprobación (horas) y de la aprobación a la primera transacción (días), últimos 90 días. */
export async function onboardingTimes(ctx: Ctx, market: string): Promise<{ approved: number; visit_to_approval_h: number | null; approval_to_first_txn_d: number | null; with_txn: number }> {
  return withUser(ctx.user.id, async (tx) => (await tx<{ approved: number; visit_to_approval_h: number | null; approval_to_first_txn_d: number | null; with_txn: number }[]>`
    with f as (
      select f.*, (select min(m.first_txn_at) from crm.merchant_metrics_daily m where m.account_id = f.account_id and m.first_txn_at is not null) as txn
        from crm.onboarding_files f where f.market_code = ${market} and f.status in ('approved', 'auto_approved') and f.decided_at > now() - interval '90 days')
    select count(*)::int as approved,
           round(avg(extract(epoch from (decided_at - visited_at)) / 3600) filter (where visited_at is not null)::numeric, 1)::float as visit_to_approval_h,
           round(avg(extract(epoch from (txn - decided_at)) / 86400) filter (where txn is not null and txn >= decided_at)::numeric, 1)::float as approval_to_first_txn_d,
           count(*) filter (where txn is not null and txn >= decided_at)::int as with_txn
      from f`)[0]!)
}

export async function requirements(ctx: Ctx, market: string): Promise<{ person_type: string; funding: string; code: string; label_es: string; label_en: string; feeds: string; pii_class: string }[]> {
  return withUser(ctx.user.id, (tx) => tx`select person_type, funding, code, label_es, label_en, feeds, pii_class from crm.onboarding_requirements where market_code = ${market} and is_active order by person_type, funding, position`) as never
}

// ---------------------------------------------------------------- cartera
export type PlanRow = { id: string; status: string; to_name: string; created_by: string; created_at: Date; applied_at: Date | null; moved: number | null; note: string | null; diff: { accounts: number; deals: number; tasks: number; lose: { id: string; name: string; count: number }[]; gain: { id: string; name: string; count: number }[] } }
export async function plans(ctx: Ctx, market: string): Promise<PlanRow[]> {
  return withUser(ctx.user.id, (tx) => tx<PlanRow[]>`
    select p.id, p.status, t.full_name as to_name, c.full_name as created_by, p.created_at, p.applied_at, p.moved, p.note, p.diff
      from crm.reassignment_plans p join crm.users t on t.id = p.to_user_id join crm.users c on c.id = p.created_by
     where p.market_code = ${market} order by (p.status = 'draft') desc, p.created_at desc limit 20`)
}
export async function territoryOwners(ctx: Ctx, market: string): Promise<{ id: string; name: string; owner: string | null; since: Date | null }[]> {
  return withUser(ctx.user.id, (tx) => tx`
    select t.id, t.name, u.full_name as owner, o.valid_from as since from crm.territories t
      left join crm.territory_owners o on o.territory_id = t.id and o.valid_to is null left join crm.users u on u.id = o.user_id
     where t.market_code = ${market} order by t.name`) as never
}
export async function sellerProfiles(ctx: Ctx, market: string): Promise<Record<string, string>> {
  return withUser(ctx.user.id, async (tx) => Object.fromEntries((await tx<{ user_id: string; profile: string }[]>`select user_id, profile from crm.seller_profiles where market_code = ${market}`).map((r) => [r.user_id, r.profile])))
}
export async function channelAssignments(ctx: Ctx, accountId: string): Promise<{ duty: string; channel: string; person: string | null; valid_from: Date; valid_to: Date | null; reason: string | null }[]> {
  return withUser(ctx.user.id, (tx) => tx`
    select c.duty, c.channel, u.full_name as person, c.valid_from, c.valid_to, c.reason from crm.channel_assignments c left join crm.users u on u.id = c.user_id
     where c.account_id = ${accountId} order by c.valid_from desc limit 20`) as never
}

// ---------------------------------------------------------------- atribución
export type AttrRow = { id: string; layer: string; party_kind: string; party_label: string; effective_from: Date; effective_to: Date | null; reason: string | null; correction_of: string | null; origin_kind: string | null; by: string | null }
export async function attributionHistory(ctx: Ctx, accountId: string): Promise<AttrRow[]> {
  return withUser(ctx.user.id, (tx) => tx<AttrRow[]>`
    select a.id, a.layer, a.party_kind, a.party_label, a.effective_from, a.effective_to, a.reason, a.correction_of, a.origin_kind, u.full_name as by
      from crm.account_attributions a left join crm.users u on u.id = a.created_by where a.account_id = ${accountId}
     order by case a.layer when 'origin' then 0 when 'channel' then 1 else 2 end, a.effective_from desc`)
}

/** Reporte de excepciones de atribución por ciclo (mes): huecos, correcciones y disputas, y el origen por tipo. */
export async function attributionCycle(ctx: Ctx, market: string, month: string): Promise<{ no_owner_row: number; no_origin: number; unclassified_origin: number; network: number; acquisition: number; corrections: number; disputes_opened: number; disputes_open_late: number; gaps: { id: string; name: string; issue: string }[] }> {
  const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7)
  return withUser(ctx.user.id, async (tx) => {
    const c = (await tx<{ no_owner_row: number; no_origin: number; unclassified_origin: number; network: number; acquisition: number; corrections: number; disputes_opened: number; disputes_open_late: number }[]>`
      with acc as (select a.id, a.owner_id from crm.accounts a where a.market_code = ${market} and a.archived_at is null)
      select (select count(*)::int from acc where acc.owner_id is not null and not exists (select 1 from crm.account_attributions t where t.account_id = acc.id and t.layer = 'owner' and t.effective_to is null)) as no_owner_row,
             (select count(*)::int from acc where not exists (select 1 from crm.account_attributions t where t.account_id = acc.id and t.layer = 'origin')) as no_origin,
             (select count(*)::int from crm.account_attributions t join acc on acc.id = t.account_id where t.layer = 'origin' and t.effective_to is null and t.origin_kind is null) as unclassified_origin,
             (select count(*)::int from crm.account_attributions t join acc on acc.id = t.account_id where t.layer = 'origin' and t.effective_to is null and t.origin_kind = 'network_conversion') as network,
             (select count(*)::int from crm.account_attributions t join acc on acc.id = t.account_id where t.layer = 'origin' and t.effective_to is null and t.origin_kind = 'new_acquisition') as acquisition,
             (select count(*)::int from crm.account_attributions t where t.market_code = ${market} and t.correction_of is not null and to_char(t.effective_from, 'YYYY-MM') = ${m}) as corrections,
             (select count(*)::int from crm.attribution_disputes x where x.market_code = ${market} and to_char(x.created_at, 'YYYY-MM') = ${m}) as disputes_opened,
             (select count(*)::int from crm.attribution_disputes x where x.market_code = ${market} and x.status = 'open' and x.sla_due_at < now()) as disputes_open_late`)[0]!
    const gaps = await tx<{ id: string; name: string; issue: string }[]>`
      select a.id, a.name, case when not exists (select 1 from crm.account_attributions t where t.account_id = a.id and t.layer = 'origin') then 'no_origin' else 'no_owner_row' end as issue
        from crm.accounts a where a.market_code = ${market} and a.archived_at is null
         and (not exists (select 1 from crm.account_attributions t where t.account_id = a.id and t.layer = 'origin')
              or (a.owner_id is not null and not exists (select 1 from crm.account_attributions t where t.account_id = a.id and t.layer = 'owner' and t.effective_to is null)))
       order by a.name limit 20`
    return { ...c, gaps }
  })
}

export type DisputeRow = { id: string; account_id: string; account: string; layer: string; kind: string; claimant: string; claimant_id: string; claimed_label: string; reason: string; status: string; sla_due_at: Date; late: boolean; arbiter: string | null; resolution: string | null; resolved_at: Date | null }
export async function disputes(ctx: Ctx, market: string): Promise<DisputeRow[]> {
  return withUser(ctx.user.id, (tx) => tx<DisputeRow[]>`
    select d.id, d.account_id, a.name as account, d.layer, d.kind, c.full_name as claimant, d.claimant_id, d.claimed_label, d.reason, d.status, d.sla_due_at,
           (d.status = 'open' and d.sla_due_at < now()) as late, r.full_name as arbiter, d.resolution, d.resolved_at
      from crm.attribution_disputes d join crm.accounts a on a.id = d.account_id join crm.users c on c.id = d.claimant_id left join crm.users r on r.id = d.arbiter_id
     where d.market_code = ${market} order by (d.status = 'open') desc, d.sla_due_at, d.id limit 100`)
}

// ---------------------------------------------------------------- registros de canal
export type ClaimRow = { id: string; store_name: string; node_label: string; channel: string; status: string; expires_at: Date; extensions: number; evidence: string | null; rejection_reason: string | null; created_at: Date }
export async function claims(ctx: Ctx, market: string): Promise<ClaimRow[]> {
  return withUser(ctx.user.id, (tx) => tx<ClaimRow[]>`
    select id, store_name, node_label, channel, status, expires_at, extensions, evidence, rejection_reason, created_at from crm.channel_claims
     where market_code = ${market} order by (status = 'active') desc, created_at desc limit 100`)
}

// ---------------------------------------------------------------- fondeo y crédito
export type FundingRowView = { method: string; balance_minor: string; credit_limit_minor: string | null; as_of: string; source: string; loaded_at: Date }
export async function funding(ctx: Ctx, accountId: string): Promise<FundingRowView[]> {
  return withUser(ctx.user.id, (tx) => tx<FundingRowView[]>`
    select method, balance_minor::text, credit_limit_minor::text, as_of::text, source, loaded_at from crm.account_funding where account_id = ${accountId} order by as_of desc, loaded_at desc limit 10`)
}
export type CreditRow = { id: string; account_id: string; account: string; amount_minor: string; reason: string; status: string; requested_by: string; requested_by_id: string; requested_at: Date; decided_by: string | null; decided_at: Date | null; decision_note: string | null }
export async function creditRequests(ctx: Ctx, market: string, accountId?: string): Promise<CreditRow[]> {
  return withUser(ctx.user.id, (tx) => tx<CreditRow[]>`
    select r.id, r.account_id, a.name as account, r.amount_minor::text, r.reason, r.status, q.full_name as requested_by, r.requested_by as requested_by_id, r.requested_at, d.full_name as decided_by, r.decided_at, r.decision_note
      from crm.credit_limit_requests r join crm.accounts a on a.id = r.account_id join crm.users q on q.id = r.requested_by left join crm.users d on d.id = r.decided_by
     where r.market_code = ${market} ${accountId ? tx`and r.account_id = ${accountId}` : tx``} order by (r.status = 'requested') desc, r.requested_at desc limit 50`)
}

// ---------------------------------------------------------------- competencia
export async function competitors(ctx: Ctx, market: string): Promise<Option[]> {
  return withUser(ctx.user.id, (tx) => tx<Option[]>`select id, name from crm.competitors where market_code = ${market} and is_active order by name`)
}
export type CompetitorReport = { competitor: string; stores: number; observations: number; avg_price_minor: string | null; last_seen: string | null }
export async function competitorReport(ctx: Ctx, market: string): Promise<CompetitorReport[]> {
  return withUser(ctx.user.id, (tx) => tx<CompetitorReport[]>`
    select c.name as competitor, count(distinct o.account_id)::int as stores, count(o.id)::int as observations, round(avg(o.price_minor))::text as avg_price_minor, max(o.observed_on)::text as last_seen
      from crm.competitors c left join crm.account_competitors o on o.competitor_id = c.id
     where c.market_code = ${market} group by c.id, c.name order by stores desc, c.name`)
}
export async function accountCompetitors(ctx: Ctx, accountId: string): Promise<{ competitor: string; product: string | null; price_minor: string | null; observed_on: string; source: string; by: string | null }[]> {
  return withUser(ctx.user.id, (tx) => tx`
    select c.name as competitor, o.product, o.price_minor::text, o.observed_on::text, o.source, u.full_name as by from crm.account_competitors o
      join crm.competitors c on c.id = o.competitor_id left join crm.users u on u.id = o.recorded_by where o.account_id = ${accountId} order by o.observed_on desc limit 20`) as never
}

// ---------------------------------------------------------------- punto de venta perfecto y prioridad
export async function perfectStores(ctx: Ctx, market: string): Promise<{ account_id: string; account: string; score: number; items_ok: number; items_total: number; observed_at: Date }[]> {
  return withUser(ctx.user.id, (tx) => tx`
    select distinct on (s.account_id) s.account_id, a.name as account, s.score, s.items_ok, s.items_total, s.observed_at
      from crm.perfect_store_scores s join crm.accounts a on a.id = s.account_id where s.market_code = ${market}
     order by s.account_id, s.observed_at desc limit 100`) as never
}

export type PriorityRow = { account_id: string; account: string; owner: string | null; segment: string; score: number; reasons: { code: string; days?: number }[]; holdout: boolean }
export async function priorityToday(ctx: Ctx, market: string, mine: boolean): Promise<{ day: string | null; rows: PriorityRow[]; holdout: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const day = (await tx<{ d: string | null }[]>`select max(day)::text as d from crm.store_priority where market_code = ${market} and day <= ${marketToday(tx, market)}`)[0]?.d ?? null
    if (!day) return { day: null, rows: [], holdout: 0 }
    const rows = await tx<PriorityRow[]>`
      select p.account_id, a.name as account, u.full_name as owner, p.segment, p.score, p.reasons, p.holdout
        from crm.store_priority p join crm.accounts a on a.id = p.account_id left join crm.users u on u.id = p.owner_id
       where p.market_code = ${market} and p.day = ${day}::date and not p.holdout and p.score > 0 and jsonb_array_length(p.reasons) > 0 ${mine ? tx`and p.owner_id = ${ctx.user.id}` : tx``}
       order by p.score desc, a.name limit 30`
    const h = (await tx<{ n: number }[]>`select count(*)::int as n from crm.store_priority p where p.market_code = ${market} and p.day = ${day}::date and p.holdout ${mine ? tx`and p.owner_id = ${ctx.user.id}` : tx``}`)[0]!.n
    return { day, rows, holdout: h }
  })
}

// ---------------------------------------------------------------- incidentes
export type IncidentRow = { id: string; account: string | null; party_kind: string; party_label: string; type: string; occurred_on: string; description: string; status: string; reported_by: string; assigned: string | null; resolution: string | null; created_at: Date }
export async function incidents(ctx: Ctx, market: string): Promise<IncidentRow[]> {
  return withUser(ctx.user.id, (tx) => tx<IncidentRow[]>`
    select i.id, a.name as account, i.party_kind, i.party_label, i.type, i.occurred_on::text, i.description, i.status, r.full_name as reported_by, s.full_name as assigned, i.resolution, i.created_at
      from crm.field_incidents i join crm.users r on r.id = i.reported_by left join crm.users s on s.id = i.assigned_to left join crm.accounts a on a.id = i.account_id
     where i.market_code = ${market} order by (i.status <> 'closed') desc, i.created_at desc limit 100`)
}

// ---------------------------------------------------------------- umbrales y metas
export type ThresholdRow = { key: string; value: number; version: number; reason: string | null; valid_from: Date | null; by: string | null; pending_owner: string | null; review_due: string | null; review_late: boolean }
/** CAMPO-04: cada umbral con su versión, si todavía es un valor propuesto (y de quién depende) y cuándo toca revisarlo (calibración). */
export async function thresholds(ctx: Ctx, market: string): Promise<ThresholdRow[]> {
  const rows = await withUser(ctx.user.id, (tx) => tx<{ key: string; value: string; version: number; reason: string | null; valid_from: Date; by: string | null; pending_owner: string | null; review_due: string; review_late: boolean }[]>`
    with rv as (select coalesce((select f.value::int from crm.field_thresholds f where f.market_code = ${market} and f.key = 'threshold_review_days' and f.valid_to is null), 90) as days)
    select t.key, t.value::text, t.version, t.reason, t.valid_from, u.full_name as by, t.pending_owner,
           ((t.valid_from at time zone mk.timezone)::date + rv.days)::text as review_due,
           ((t.valid_from at time zone mk.timezone)::date + rv.days) < (now() at time zone mk.timezone)::date as review_late
      from crm.field_thresholds t join crm.markets mk on mk.code = t.market_code cross join rv left join crm.users u on u.id = t.set_by
     where t.market_code = ${market} and t.valid_to is null`)
  return THRESHOLD_KEYS.map((k) => {
    const r = rows.find((x) => x.key === k)
    return { key: k, value: r ? Number(r.value) : NaN, version: r?.version ?? 0, reason: r?.reason ?? null, valid_from: r?.valid_from ?? null, by: r?.by ?? null,
      pending_owner: r?.pending_owner ?? null, review_due: r?.review_due ?? null, review_late: r?.review_late ?? false }
  }).filter((r) => THRESHOLDS[r.key as keyof typeof THRESHOLDS])
}
/** Valores propuestos que esperan a su dueño, en todos los mercados que la persona ve. Para Estado de CONTIGO. */
export async function proposedValues(ctx: Ctx): Promise<{ market_code: string; key: string; value: number; owner: string }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const t = await tx<{ market_code: string; key: string; value: string; owner: string }[]>`
      select market_code, key, value::text, pending_owner as owner from crm.field_thresholds where valid_to is null and pending_owner is not null order by key, market_code`
    const p = await tx<{ market_code: string; value: string; owner: string }[]>`
      select market_code, clawback_days::text as value, pending_owner as owner from crm.channel_policies where valid_to is null and status = 'proposed' and pending_owner is not null order by market_code`
    return [...t.map((r) => ({ ...r, value: Number(r.value) })), ...p.map((r) => ({ market_code: r.market_code, key: 'clawback_policy', value: Number(r.value), owner: r.owner }))]
  })
}
export async function repPlans(ctx: Ctx, market: string): Promise<{ user_id: string; name: string; month: string; target_won: number; won: number }[]> {
  return withUser(ctx.user.id, (tx) => tx`
    select p.user_id, u.full_name as name, to_char(p.month, 'YYYY-MM') as month, p.target_won,
           (select count(*)::int from crm.deals d where d.owner_id = p.user_id and d.market_code = p.market_code and d.status = 'won'
              and (d.won_at at time zone mk.timezone)::date >= p.month and (d.won_at at time zone mk.timezone)::date < p.month + interval '1 month') as won
      from crm.rep_plans p join crm.users u on u.id = p.user_id join crm.markets mk on mk.code = p.market_code
     where p.market_code = ${market} order by p.month desc, u.full_name limit 50`) as never
}
