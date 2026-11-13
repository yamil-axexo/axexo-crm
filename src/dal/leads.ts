import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isUuid } from '@/lib/ids'
import type { Territory } from '@/lib/territory'

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
  phone: string | null
  /** Tipo de empresa (catálogo de tipos de cuenta), embudo de campaña y número de tiendas: campos del lead (E15.F5). */
  account_type: string | null
  funnel: string | null
  store_count: string | null
}

export type LeadFilters = { /** Tipo de venta y equipo de quien lo lleva. */ motor?: string; team?: string; market?: string; status?: string; owner?: string; q?: string; before?: string; clock?: string; source?: string; sort?: string; /** Tipo de empresa, embudo de campaña y número de tiendas (mínimo y máximo). */ tipo?: string; embudo?: string; tiendas_min?: string; tiendas_max?: string; /** Día en que llegó el lead (zona del mercado), para abrir desde el Panel del LT los leads de un periodo. */ from?: string; to?: string }
const isDay = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '')
const isCount = (v: string | undefined): v is string => /^\d{1,7}$/.test(v ?? '')
export const LEAD_PAGE = 40
export const LEAD_SORTS = ['recent', 'oldest', 'due'] as const
export type LeadSort = (typeof LEAD_SORTS)[number]

/**
 * PERF-02: paginación por llave, no por offset. La llave depende del orden: (created_at, id) para más recientes y más
 * antiguos, (sla_due_at, id) para "vence primero", que solo trae los leads que todavía tienen el reloj corriendo.
 * La búsqueda es por nombre del negocio, de la persona o por teléfono (cuatro dígitos o más, en cualquier formato).
 */
export async function listLeads(ctx: Ctx, f: LeadFilters): Promise<{ items: LeadListItem[]; next: string | null; counts: Record<string, number>; sort: LeadSort }> {
  return withUser(ctx.user.id, async (tx) => {
    const sort: LeadSort = f.sort === 'oldest' || f.sort === 'due' ? f.sort : 'recent'
    const [bTs, bId] = (f.before ?? '').split('|')
    const okCursor = bTs && isUuid(bId) && !Number.isNaN(Date.parse(bTs))
    const cursor = !okCursor ? tx``
      : sort === 'recent' ? tx`and (l.created_at, l.id) < (${bTs}::timestamptz, ${bId}::uuid)`
      : sort === 'oldest' ? tx`and (l.created_at, l.id) > (${bTs}::timestamptz, ${bId}::uuid)`
      : tx`and (l.sla_due_at, l.id) > (${bTs}::timestamptz, ${bId}::uuid)`
    const scope = ctx.markets.map((m) => m.code) // AUTHZ-07
    const q = (f.q ?? '').trim().slice(0, 80)
    const digits = q.replace(/[^\d]/g, '')
    const waiting = tx`l.status = 'new' and l.first_touch_at is null and l.sla_due_at is not null`
    const base = tx`
      and l.market_code = any(${scope}::text[])
      ${f.market ? tx`and l.market_code = ${f.market}` : tx``}
      ${f.owner === 'me' ? tx`and l.owner_id = ${ctx.user.id}` : f.owner === 'none' ? tx`and l.owner_id is null` : isUuid(f.owner) ? tx`and l.owner_id = ${f.owner}` : tx``}
      ${f.source ? tx`and l.source = ${f.source}` : tx``}
      ${f.motor ? tx`and l.motor = ${f.motor}` : tx``}
      ${f.tipo && /^[a-z][a-z0-9_]{1,40}$/.test(f.tipo) ? tx`and l.account_type = ${f.tipo}` : tx``}
      ${f.embudo && /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(f.embudo) ? tx`and l.funnel = ${f.embudo}` : tx``}
      ${isCount(f.tiendas_min) ? tx`and app.store_count(l.custom) >= ${Number(f.tiendas_min)}` : tx``}
      ${isCount(f.tiendas_max) ? tx`and app.store_count(l.custom) <= ${Number(f.tiendas_max)}` : tx``}
      ${f.team === 'none'
        ? tx`and exists (select 1 from crm.memberships mm where mm.user_id = l.owner_id and mm.market_code = l.market_code and mm.team_id is null and mm.role in ('rep', 'supervisor', 'market_lead') and (mm.valid_to is null or mm.valid_to > now()))`
        : isUuid(f.team) ? tx`and exists (select 1 from crm.memberships mm where mm.user_id = l.owner_id and mm.team_id = ${f.team!} and (mm.valid_to is null or mm.valid_to > now()))` : tx``}
      ${isDay(f.from) ? tx`and (l.created_at at time zone (select mk.timezone from crm.markets mk where mk.code = l.market_code))::date >= ${f.from}::date` : tx``}
      ${isDay(f.to) ? tx`and (l.created_at at time zone (select mk.timezone from crm.markets mk where mk.code = l.market_code))::date <= ${f.to}::date` : tx``}
      ${f.clock === 'with' || sort === 'due' ? tx`and ${waiting}` : f.clock === 'without' ? tx`and l.sla_due_at is null` : tx``}
      ${q ? tx`and (app.norm(l.business_name) like '%' || app.norm(${q}) || '%' or app.norm(l.contact_name) like '%' || app.norm(${q}) || '%'
                   ${digits.length >= 4 ? tx`or l.phone like ${'%' + digits + '%'}` : tx``})` : tx``}`
    const status =
      f.status === 'overdue' ? tx`and l.status = 'new' and l.first_touch_at is null and l.sla_due_at < now()`
      : f.status === 'open' ? tx`and l.status in ('new','contacted','qualified')`
      : f.status ? tx`and l.status = ${f.status}` : tx``
    const order = sort === 'recent' ? tx`l.created_at desc, l.id desc` : sort === 'oldest' ? tx`l.created_at, l.id` : tx`l.sla_due_at, l.id`
    const rows = await tx<LeadListItem[]>`
      select l.id, l.market_code, l.business_name, l.contact_name, l.locality, l.motor, l.source, l.status, l.owner_id, u.full_name as owner_name,
             l.sla_due_at, l.first_touch_at, l.created_at, l.duplicate_of, l.phone, l.account_type, l.funnel, app.store_count(l.custom)::text as store_count
        from crm.leads l left join crm.users u on u.id = l.owner_id
       where true ${base} ${status} ${cursor}
       order by ${order} limit ${LEAD_PAGE + 1}`
    const counts = await tx<{ k: string; n: number }[]>`
      select k, count(*)::int as n from (
        select unnest(array[l.status, case when l.status = 'new' and l.first_touch_at is null and l.sla_due_at < now() then 'overdue' end,
                            case when l.status in ('new','contacted','qualified') then 'open' end]) as k
          from crm.leads l where true ${base}) x where k is not null group by k`
    const items = rows.slice(0, LEAD_PAGE)
    const last = items[items.length - 1]
    const key = last ? new Date(sort === 'due' ? last.sla_due_at : last.created_at).toISOString() : ''
    return {
      items,
      next: rows.length > LEAD_PAGE && last ? `${key}|${last.id}` : null,
      counts: Object.fromEntries(counts.map((c) => [c.k, c.n])),
      sort,
    }
  })
}

/** Orígenes que de verdad aparecen en los leads que la persona ve: son las opciones del filtro. */
export async function leadSources(ctx: Ctx): Promise<string[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ source: string }[]>`select distinct source from crm.leads where market_code = any(${ctx.markets.map((m) => m.code)}::text[]) order by source`
    return rows.map((r) => r.source)
  })
}

/** Embudos activos por mercado: de aquí salen los tipos de venta que se ofrecen al crear un lead y los embudos al convertirlo. */
export async function marketPipelines(ctx: Ctx, market?: string): Promise<{ id: string; market_code: string; motor: string; name: string }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; market_code: string; motor: string; name: string }[]>`
      select p.id, p.market_code, p.motor, p.name from crm.pipelines p
       where p.is_active and p.market_code = any(${market ? [market] : ctx.markets.map((m) => m.code)}::text[])
         and exists (select 1 from crm.stages s where s.pipeline_id = p.id)
       order by p.market_code, p.position, p.id`
    return [...rows]
  })
}

/** Territorios de un mercado, con la marca de cuáles cubre una persona: de ahí sale el territorio de un lead convertido. */
export async function territoriesOf(ctx: Ctx, market: string, userId: string): Promise<(Territory & { own: boolean })[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<(Territory & { own: boolean })[]>`
      select t.id, t.code, t.name, exists (select 1 from crm.user_territories ut where ut.territory_id = t.id and ut.user_id = ${userId}) as own
        from crm.territories t where t.market_code = ${market} and t.archived_at is null order by t.name`
    return [...rows]
  })
}

/** Horario hábil de un mercado (por defecto, lunes a viernes de 9:00 a 18:00). */
export async function marketHours(ctx: Ctx): Promise<{ market_code: string; days: number[]; opens: string; closes: string }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; days: number[]; opens: string; closes: string }[]>`
      select m.code as market_code, coalesce(h.days, '{1,2,3,4,5}'::int[]) as days,
             to_char(coalesce(h.opens, time '09:00'), 'HH24:MI') as opens, to_char(coalesce(h.closes, time '18:00'), 'HH24:MI') as closes
        from crm.markets m left join crm.market_hours h on h.market_code = m.code
       where m.code = any(${ctx.markets.map((m) => m.code)}::text[]) order by m.status, m.code`
    return [...rows]
  })
}

export type LeadDetail = LeadListItem & {
  phone: string | null
  email: string | null
  message: string | null
  form_name: string | null
  channel_id: string | null
  disqualify_code: string | null
  account_id: string | null
  assigned_at: Date | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  gclid: string | null
  fbclid: string | null
  consent_at: Date | null
  consent_text: string | null
  /** El dueño todavía vende en el mercado del lead. Si no, alguien tiene que reasignarlo. */
  owner_active: boolean
  account_type: string | null
  contact_role: string | null
  extra_contacts: { name: string; phone: string | null; email: string | null; at: string }[]
}

export async function getLead(ctx: Ctx, id: string) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<LeadDetail[]>`
      select l.id, l.market_code, l.business_name, l.contact_name, l.locality, l.motor, l.source, l.status, l.owner_id, u.full_name as owner_name,
             l.sla_due_at, l.first_touch_at, l.created_at, l.duplicate_of, l.phone, l.email::text, l.message, f.name as form_name,
             l.funnel, l.channel_id, app.store_count(l.custom)::text as store_count,
             l.disqualify_code, l.account_id, l.assigned_at,
             l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term, l.gclid, l.fbclid, l.consent_at, l.consent_text,
             (l.owner_id is null or app.works_in(l.owner_id, l.market_code)) as owner_active,
             l.account_type, l.contact_role, l.extra_contacts
        from crm.leads l left join crm.users u on u.id = l.owner_id left join crm.web_forms f on f.id = l.form_id
       where l.id = ${id}`
    const lead = rows[0]
    if (!lead) return null
    const duplicates = await tx<{ id: string; name: string; locality: string | null; owner_name: string | null; lifecycle: string; match: string }[]>`
      select id, name, locality, owner_name, lifecycle, match from app.duplicate_candidates(${lead.market_code}, ${lead.business_name}, ${lead.phone})`
    const activities = await tx<{ id: string; kind: string; subject: string; body: string | null; created_at: Date; author: string | null; done_at: Date | null; due_at: Date | null; type_label: string | null }[]>`
      select a.id, a.kind, a.subject, a.body, a.created_at, u.full_name as author, a.done_at, a.due_at, a.type_label
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

/** Motivos generales (valen para cualquier tipo de venta): los que se ofrecen al cerrar varios leads a la vez. Para un solo lead, `lossReasonsFor`. */
export async function lossReasons(ctx: Ctx, kind: 'lost' | 'no_sale' = 'lost') {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ code: string; label_es: string; label_en: string }[]>`
      select code, label_es, label_en from crm.loss_reasons where kind = ${kind} and is_active and motors is null order by position, label_es`
    return [...rows]
  })
}

/** Tipos de empresa y embudos de campaña que de verdad aparecen en los leads que la persona ve: las opciones de esos filtros. */
export async function leadFacets(ctx: Ctx): Promise<{ types: { code: string; label_es: string; label_en: string }[]; funnels: string[] }> {
  return withUser(ctx.user.id, async (tx) => {
    const scope = ctx.markets.map((m) => m.code)
    const types = await tx<{ code: string; label_es: string; label_en: string }[]>`
      select distinct on (t.code) t.code, t.label_es, t.label_en from crm.account_types t
       where t.is_active and exists (select 1 from crm.leads l where l.account_type = t.code and l.market_code = any(${scope}::text[]))
       order by t.code, t.market_code nulls last`
    const funnels = await tx<{ funnel: string }[]>`select distinct funnel from crm.leads where funnel is not null and market_code = any(${scope}::text[]) order by funnel`
    return { types: [...types], funnels: funnels.map((f) => f.funnel) }
  })
}
