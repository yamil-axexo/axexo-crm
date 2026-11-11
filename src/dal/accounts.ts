import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type AccountListItem = {
  id: string
  market_code: string
  name: string
  kind: string
  segment: string | null
  lifecycle: string
  locality: string | null
  region: string | null
  owner_id: string | null
  owner_name: string | null
  parent_name: string | null
  children: number
  last_txn_at: Date | null
  txn_count_30d: number | null
}

export type AccountFilters = { q?: string; market?: string; lifecycle?: string; owner?: string; kind?: string; after?: string }
export const ACCOUNT_PAGE = 40

/** PERF-02 / PERF-05 / UX-02: lista por llave (nombre, id) y búsqueda por nombre, teléfono o cualquier alias. */
export async function listAccounts(ctx: Ctx, f: AccountFilters): Promise<{ items: AccountListItem[]; next: string | null; total: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const q = (f.q ?? '').trim()
    const digits = q.replace(/[^\d]/g, '')
    const scope = ctx.markets.map((m) => m.code) // AUTHZ-07: filtro explícito por mercado, además de RLS
    const where = tx`
      a.archived_at is null and a.market_code = any(${scope}::text[])
      ${f.market ? tx`and a.market_code = ${f.market}` : tx``}
      ${f.lifecycle ? tx`and a.lifecycle = ${f.lifecycle}` : tx``}
      ${f.kind === 'parents' ? tx`and a.kind <> 'store'` : f.kind ? tx`and a.kind = ${f.kind}` : tx``}
      ${f.owner === 'me' ? tx`and a.owner_id = ${ctx.user.id}` : f.owner === 'none' ? tx`and a.owner_id is null` : f.owner ? tx`and a.owner_id = ${f.owner}` : tx``}
      ${q ? tx`and (a.name_norm like ${'%'} || app.norm(${q}) || ${'%'}
                    ${digits.length >= 4 ? tx`or a.phone like ${'%' + digits + '%'}` : tx``}
                    or exists (select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null and upper(al.external_id) like ${'%' + q.toUpperCase() + '%'}))` : tx``}`
    const [aName, aId] = (f.after ?? '').split('|')
    const cursor = aName !== undefined && aId ? tx`and (a.name_norm, a.id) > (${aName}, ${aId}::uuid)` : tx``
    const rows = await tx<(AccountListItem & { name_norm: string })[]>`
      select a.id, a.market_code, a.name, a.name_norm, a.kind, a.segment, a.lifecycle, a.locality, a.region, a.owner_id, u.full_name as owner_name,
             p.name as parent_name,
             (select count(*)::int from crm.accounts c where c.parent_id = a.id and c.archived_at is null) as children,
             mm.last_txn_at, mm.txn_count_30d
        from crm.accounts a
        left join crm.users u on u.id = a.owner_id
        left join crm.accounts p on p.id = a.parent_id
        left join lateral (select m.last_txn_at, m.txn_count_30d from crm.merchant_metrics_daily m where m.account_id = a.id order by m.as_of desc limit 1) mm on true
       where ${where} ${cursor}
       order by a.name_norm, a.id limit ${ACCOUNT_PAGE + 1}`
    const total = await tx<{ n: number }[]>`select count(*)::int as n from crm.accounts a where ${where}`
    const items = rows.slice(0, ACCOUNT_PAGE)
    const last = items[items.length - 1]
    return { items, next: rows.length > ACCOUNT_PAGE && last ? `${last.name_norm}|${last.id}` : null, total: total[0]?.n ?? 0 }
  })
}

export type TimelineItem = {
  at: Date
  kind: 'note' | 'call' | 'meeting' | 'task' | 'email' | 'handoff' | 'system' | 'visit' | 'stage' | 'attribution'
  title: string
  body: string | null
  actor: string | null
  meta: Record<string, unknown>
}

export async function getAccount(ctx: Ctx, id: string) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<
      { id: string; market_code: string; name: string; kind: string; segment: string | null; lifecycle: string; lifecycle_at: Date; owner_id: string | null; owner_name: string | null;
        parent_id: string | null; ancestor_ids: string[]; phone: string | null; email: string | null; address_line: string | null; locality: string | null; region: string | null;
        postal_code: string | null; territory: string | null; custom: Record<string, unknown>; created_at: Date; archived_at: Date | null; merged_into: string | null }[]
    >`select a.id, a.market_code, a.name, a.kind, a.segment, a.lifecycle, a.lifecycle_at, a.owner_id, u.full_name as owner_name, a.parent_id, a.ancestor_ids,
             a.phone, a.email::text, a.address_line, a.locality, a.region, a.postal_code, t.name as territory, a.custom, a.created_at, a.archived_at, a.merged_into
        from crm.accounts a left join crm.users u on u.id = a.owner_id left join crm.territories t on t.id = a.territory_id
       where a.id = ${id}`
    const account = rows[0]
    if (!account) return null
    const ancestors = account.ancestor_ids.length
      ? await tx<{ id: string; name: string }[]>`select id, name from crm.accounts where id = any(${account.ancestor_ids}::uuid[])
          order by array_position(${account.ancestor_ids}::uuid[], id)`
      : []
    // DAT-01: roll-up de todo lo que cuelga de esta cuenta, a cualquier profundidad.
    const rollup = await tx<{ stores: number; active: number; at_risk: number; onboarding: number; txn_30d: number; volume_30d: string | null; currency: string | null }[]>`
      select count(*) filter (where d.kind = 'store')::int as stores,
             count(*) filter (where d.lifecycle = 'active')::int as active,
             count(*) filter (where d.lifecycle = 'at_risk')::int as at_risk,
             count(*) filter (where d.lifecycle = 'onboarding')::int as onboarding,
             coalesce(sum(mm.txn_count_30d), 0)::int as txn_30d, sum(mm.volume_minor_30d)::text as volume_30d, max(mm.currency) as currency
        from crm.accounts d
        left join lateral (select m.txn_count_30d, m.volume_minor_30d, m.currency from crm.merchant_metrics_daily m where m.account_id = d.id order by m.as_of desc limit 1) mm on true
       where d.ancestor_ids @> array[${id}::uuid] and d.archived_at is null`
    const children = await tx<{ id: string; name: string; kind: string; lifecycle: string; locality: string | null; owner_name: string | null; txn_count_30d: number | null }[]>`
      select c.id, c.name, c.kind, c.lifecycle, c.locality, u.full_name as owner_name,
             (select m.txn_count_30d from crm.merchant_metrics_daily m where m.account_id = c.id order by m.as_of desc limit 1) as txn_count_30d
        from crm.accounts c left join crm.users u on u.id = c.owner_id
       where c.parent_id = ${id} and c.archived_at is null order by c.name limit 60`
    const contacts = await tx<{ id: string; full_name: string; phone: string | null; email: string | null; role: string; valid_from: Date }[]>`
      select c.id, c.full_name, c.phone, c.email::text, ac.role, ac.valid_from from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${id} and ac.valid_to is null order by ac.role, c.full_name`
    const aliases = await tx<{ system: string; external_id: string; valid_from: Date }[]>`
      select system, external_id, valid_from from crm.account_aliases where account_id = ${id} and valid_to is null order by system`
    const attributions = await tx<{ layer: string; party_label: string; party_kind: string; effective_from: Date; effective_to: Date | null }[]>`
      select layer, party_label, party_kind, effective_from, effective_to from crm.account_attributions where account_id = ${id}
       order by case layer when 'origin' then 0 when 'channel' then 1 else 2 end, effective_from desc`
    const deals = await tx<{ id: string; title: string; status: string; stage_es: string; stage_en: string; stage_kind: string; amount_minor: string | null; currency: string;
      next_step: string | null; next_step_due: string | null; revisit_needed: boolean; owner_name: string | null; won_at: Date | null; closed_by: string | null }[]>`
      select d.id, d.title, d.status, s.name_es as stage_es, s.name_en as stage_en, s.kind as stage_kind, d.amount_minor::text, d.currency, d.next_step,
             d.next_step_due::text, d.revisit_needed, u.full_name as owner_name, d.won_at, d.closed_by
        from crm.deals d join crm.stages s on s.id = d.stage_id left join crm.users u on u.id = d.owner_id
       where d.account_id = ${id} order by (d.status = 'open') desc, d.created_at desc`
    const metrics = await tx<{ as_of: string; first_txn_at: Date | null; last_txn_at: Date | null; txn_count_30d: number; volume_minor_30d: string; currency: string; active_days_30d: number }[]>`
      select as_of::text, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d::text, currency, active_days_30d
        from crm.merchant_metrics_daily where account_id = ${id} order by as_of desc limit 1`
    const tasks = await tx<{ id: string; kind: string; subject: string; due_at: Date | null; owner_name: string | null }[]>`
      select a.id, a.kind, a.subject, a.due_at, u.full_name as owner_name from crm.activities a left join crm.users u on u.id = a.owner_id
       where a.account_id = ${id} and a.kind in ('task','handoff') and a.done_at is null order by a.due_at nulls last limit 10`
    // ACT-01: un solo timeline con actividades, visitas de la Sales App, cambios de etapa y cambios de dueño.
    const timeline = await tx<TimelineItem[]>`
      select * from (
        select a.created_at as at, a.kind, a.subject as title, a.body, u.full_name as actor,
               jsonb_build_object('done', a.done_at is not null, 'source', a.source) as meta
          from crm.activities a left join crm.users u on u.id = a.created_by where a.account_id = ${id}
        union all
        select v.checked_in_at, 'visit', v.outcome, v.note, coalesce(u.full_name, v.salesperson_ref),
               jsonb_build_object('rejection', v.rejection_code, 'revisit', v.revisit, 'minutes', v.duration_seconds / 60, 'decision_maker', v.decision_maker_seen)
          from crm.visits v left join crm.users u on u.id = v.user_id where v.account_id = ${id}
        union all
        select e.at, 'stage', t.name_es, t.name_en, u.full_name, jsonb_build_object('cause', e.cause, 'kind', t.kind)
          from crm.deal_stage_events e join crm.deals d on d.id = e.deal_id join crm.stages t on t.id = e.to_stage_id left join crm.users u on u.id = e.actor_id
         where d.account_id = ${id}
        union all
        select at.effective_from, 'attribution', at.party_label, null, null, jsonb_build_object('layer', at.layer)
          from crm.account_attributions at where at.account_id = ${id} and at.layer = 'owner'
      ) x order by at desc limit 60`
    const pipelines = await tx<{ id: string; name: string }[]>`select id, name from crm.pipelines where market_code = ${account.market_code} order by position`
    return {
      account,
      ancestors: [...ancestors],
      rollup: rollup[0]!,
      children: [...children],
      contacts: [...contacts],
      aliases: [...aliases],
      attributions: [...attributions],
      deals: [...deals],
      metrics: metrics[0] ?? null,
      tasks: [...tasks],
      timeline: [...timeline],
      pipelines: [...pipelines],
    }
  })
}

export async function savedViews(ctx: Ctx, object: 'account' | 'lead' | 'deal') {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; name: string; filters: Record<string, string>; is_shared: boolean; mine: boolean }[]>`
      select id, name, filters, is_shared, user_id = ${ctx.user.id} as mine from crm.saved_views where object = ${object} order by is_shared desc, name`
    return [...rows]
  })
}

export async function parentOptions(ctx: Ctx, market: string) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; name: string }[]>`
      select id, name from crm.accounts where market_code = ${market} and kind <> 'store' and archived_at is null order by name limit 200`
    return [...rows]
  })
}

/** UX-02: búsqueda global por nombre, teléfono o alias externo. */
export async function searchAll(ctx: Ctx, q: string) {
  const term = q.trim()
  if (term.length < 2) return { accounts: [], leads: [], deals: [] }
  return withUser(ctx.user.id, async (tx) => {
    const digits = term.replace(/[^\d]/g, '')
    const accounts = await tx<{ id: string; name: string; market_code: string; lifecycle: string; locality: string | null; via: string | null }[]>`
      select a.id, a.name, a.market_code, a.lifecycle, a.locality,
             (select al.system || ' ' || al.external_id from crm.account_aliases al where al.account_id = a.id and al.valid_to is null
               and upper(al.external_id) like ${'%' + term.toUpperCase() + '%'} limit 1) as via
        from crm.accounts a
       where a.archived_at is null and a.market_code = any(${ctx.markets.map((m) => m.code)}::text[])
         and (a.name_norm like ${'%'} || app.norm(${term}) || ${'%'} or a.name_norm % app.norm(${term})
             ${digits.length >= 4 ? tx`or a.phone like ${'%' + digits + '%'}` : tx``}
             or exists (select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null and upper(al.external_id) like ${'%' + term.toUpperCase() + '%'}))
       order by similarity(a.name_norm, app.norm(${term})) desc limit 12`
    const leads = await tx<{ id: string; business_name: string; market_code: string; status: string }[]>`
      select id, business_name, market_code, status from crm.leads
       where app.norm(business_name) like ${'%'} || app.norm(${term}) || ${'%'} or app.norm(contact_name) like ${'%'} || app.norm(${term}) || ${'%'}
       order by created_at desc limit 8`
    const deals = await tx<{ id: string; title: string; market_code: string; status: string }[]>`
      select id, title, market_code, status from crm.deals where app.norm(title) like ${'%'} || app.norm(${term}) || ${'%'} order by created_at desc limit 8`
    return { accounts: [...accounts], leads: [...leads], deals: [...deals] }
  })
}
