import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type LeadListItem = {
  id: string
  market_code: string
  business_name: string
  contact_name: string
  locality: string | null
  motor: string
  source: string
  status: string
  owner_id: string | null
  owner_name: string | null
  sla_due_at: Date
  first_touch_at: Date | null
  created_at: Date
  duplicate_of: string | null
}

export type LeadFilters = { market?: string; status?: string; owner?: string; q?: string; before?: string }
export const LEAD_PAGE = 40

/** PERF-02: paginación por llave (created_at, id), no por offset. */
export async function listLeads(ctx: Ctx, f: LeadFilters): Promise<{ items: LeadListItem[]; next: string | null; counts: Record<string, number> }> {
  return withUser(ctx.user.id, async (tx) => {
    const [bTs, bId] = (f.before ?? '').split('|')
    const cursor = bTs && bId ? tx`and (l.created_at, l.id) < (${bTs}::timestamptz, ${bId}::uuid)` : tx``
    const scope = ctx.markets.map((m) => m.code) // AUTHZ-07
    const base = tx`
      and l.market_code = any(${scope}::text[])
      ${f.market ? tx`and l.market_code = ${f.market}` : tx``}
      ${f.owner === 'me' ? tx`and l.owner_id = ${ctx.user.id}` : f.owner === 'none' ? tx`and l.owner_id is null` : f.owner ? tx`and l.owner_id = ${f.owner}` : tx``}
      ${f.q ? tx`and (app.norm(l.business_name) like ${'%' + f.q.toLowerCase() + '%'} or app.norm(l.contact_name) like ${'%' + f.q.toLowerCase() + '%'})` : tx``}`
    const status =
      f.status === 'overdue' ? tx`and l.status = 'new' and l.first_touch_at is null and l.sla_due_at < now()`
      : f.status === 'open' ? tx`and l.status in ('new','contacted','qualified')`
      : f.status ? tx`and l.status = ${f.status}` : tx``
    const rows = await tx<LeadListItem[]>`
      select l.id, l.market_code, l.business_name, l.contact_name, l.locality, l.motor, l.source, l.status, l.owner_id, u.full_name as owner_name,
             l.sla_due_at, l.first_touch_at, l.created_at, l.duplicate_of
        from crm.leads l left join crm.users u on u.id = l.owner_id
       where true ${base} ${status} ${cursor}
       order by l.created_at desc, l.id desc limit ${LEAD_PAGE + 1}`
    const counts = await tx<{ k: string; n: number }[]>`
      select k, count(*)::int as n from (
        select unnest(array[l.status, case when l.status = 'new' and l.first_touch_at is null and l.sla_due_at < now() then 'overdue' end,
                            case when l.status in ('new','contacted','qualified') then 'open' end]) as k
          from crm.leads l where true ${base}) x where k is not null group by k`
    const items = rows.slice(0, LEAD_PAGE)
    const last = items[items.length - 1]
    return {
      items,
      next: rows.length > LEAD_PAGE && last ? `${new Date(last.created_at).toISOString()}|${last.id}` : null,
      counts: Object.fromEntries(counts.map((c) => [c.k, c.n])),
    }
  })
}

export type LeadDetail = LeadListItem & {
  phone: string | null
  email: string | null
  message: string | null
  form_name: string | null
  disqualify_code: string | null
  account_id: string | null
  assigned_at: Date | null
}

export async function getLead(ctx: Ctx, id: string) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<LeadDetail[]>`
      select l.id, l.market_code, l.business_name, l.contact_name, l.locality, l.motor, l.source, l.status, l.owner_id, u.full_name as owner_name,
             l.sla_due_at, l.first_touch_at, l.created_at, l.duplicate_of, l.phone, l.email::text, l.message, f.name as form_name,
             l.disqualify_code, l.account_id, l.assigned_at
        from crm.leads l left join crm.users u on u.id = l.owner_id left join crm.web_forms f on f.id = l.form_id
       where l.id = ${id}`
    const lead = rows[0]
    if (!lead) return null
    const duplicates = await tx<{ id: string; name: string; locality: string | null; owner_name: string | null; lifecycle: string; match: string }[]>`
      select id, name, locality, owner_name, lifecycle, match from app.duplicate_candidates(${lead.market_code}, ${lead.business_name}, ${lead.phone})`
    const activities = await tx<{ id: string; kind: string; subject: string; body: string | null; created_at: Date; author: string | null }[]>`
      select a.id, a.kind, a.subject, a.body, a.created_at, u.full_name as author
        from crm.activities a left join crm.users u on u.id = a.created_by where a.lead_id = ${id} order by a.created_at desc limit 30`
    return { lead, duplicates: [...duplicates], activities: [...activities] }
  })
}

export type Seller = { id: string; full_name: string; role: string; market_code: string }

export async function sellers(ctx: Ctx, market?: string): Promise<Seller[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Seller[]>`
      select distinct on (u.id, m.market_code) u.id, u.full_name, m.role, m.market_code
        from crm.users u join crm.memberships m on m.user_id = u.id
       where u.is_active and not u.is_system and m.role in ('rep','supervisor','market_lead') and (m.valid_to is null or m.valid_to > now())
         ${market ? tx`and m.market_code = ${market}` : tx``}
       order by u.id, m.market_code, m.role`
    return [...rows].sort((a, b) => a.full_name.localeCompare(b.full_name))
  })
}

export async function lossReasons(ctx: Ctx, kind: 'lost' | 'no_sale' = 'lost') {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ code: string; label_es: string; label_en: string }[]>`
      select code, label_es, label_en from crm.loss_reasons where kind = ${kind} and is_active order by label_es`
    return [...rows]
  })
}
