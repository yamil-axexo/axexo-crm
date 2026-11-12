import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isUuid } from '@/lib/ids'
import { accountFilter, type AccountFilters } from '@/server/account-filter'

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
  /** El dueño tiene hoy un rol de ventas o de operaciones en el mercado del comercio. Falso para cuentas de servicio y personas que salieron. */
  owner_current: boolean
  territory: string | null
  parent_name: string | null
  children: number
  last_txn_at: Date | null
  txn_count_30d: number | null
  has_deal: boolean
  phone: string | null
  /** Tipo de cuenta del catálogo (tienda, sucursal, cadena, corporativo, distribuidor, ISO...), con su nombre en los dos idiomas. */
  account_type: string
  type_es: string | null
  type_en: string | null
}

export type { AccountFilters }
export type AccountCounts = { all: number; risk: number; idle: number; nostep: number }
export const ACCOUNT_PAGE = 40

/** PERF-02 / PERF-05 / UX-02: lista por llave (nombre, id) y búsqueda por nombre, ciudad, estado, teléfono o cualquier alias. */
export async function listAccounts(ctx: Ctx, f: AccountFilters): Promise<{ items: AccountListItem[]; next: string | null; total: number; counts: AccountCounts }> {
  return withUser(ctx.user.id, async (tx) => {
    const { base, where, risk, idle, nostep, openDeal, keys } = accountFilter(tx, ctx, f)
    const [aName, aId] = (f.after ?? '').split('|')
    const cursor = aName !== undefined && isUuid(aId) ? tx`and (a.name_norm, a.id) > (${aName}, ${aId}::uuid)` : tx``
    const rows = await tx<(AccountListItem & { name_norm: string })[]>`
      select a.id, a.market_code, a.name, a.name_norm, a.kind, a.segment, a.lifecycle, a.locality, a.region, a.owner_id, u.full_name as owner_name,
             (a.owner_id is not null and (a.market_code || ':' || a.owner_id::text) = any(${keys})) as owner_current,
             t.name as territory, p.name as parent_name,
             (select count(*)::int from crm.accounts c where c.parent_id = a.id and c.archived_at is null) as children,
             mm.last_txn_at, mm.txn_count_30d, ${openDeal} as has_deal, a.phone, a.account_type,
             (select x.label_es from crm.account_types x where x.code = a.account_type and (x.market_code is null or x.market_code = a.market_code) order by x.market_code nulls last limit 1) as type_es,
             (select x.label_en from crm.account_types x where x.code = a.account_type and (x.market_code is null or x.market_code = a.market_code) order by x.market_code nulls last limit 1) as type_en
        from crm.accounts a
        left join crm.users u on u.id = a.owner_id
        left join crm.territories t on t.id = a.territory_id
        left join crm.accounts p on p.id = a.parent_id
        left join lateral (select m.last_txn_at, m.txn_count_30d from crm.merchant_metrics_daily m where m.account_id = a.id order by m.as_of desc limit 1) mm on true
       where ${where} ${cursor}
       order by a.name_norm, a.id limit ${ACCOUNT_PAGE + 1}`
    const counts = await tx<AccountCounts[]>`
      select count(*)::int as "all", count(*) filter (where ${risk})::int as risk, count(*) filter (where ${idle})::int as idle, count(*) filter (where ${nostep})::int as nostep
        from crm.accounts a where ${base}`
    const c = counts[0]!
    const items = rows.slice(0, ACCOUNT_PAGE)
    const last = items[items.length - 1]
    const total = f.ver === 'riesgo' ? c.risk : f.ver === 'sin-transaccionar' ? c.idle : f.ver === 'sin-paso' ? c.nostep : c.all
    return { items, next: rows.length > ACCOUNT_PAGE && last ? `${last.name_norm}|${last.id}` : null, total, counts: c }
  })
}

export type TreeNode = { id: string; name: string; kind: string; lifecycle: string; depth: number; has_deal: boolean; owner_name: string | null; children: number }
export const TREE_LIMIT = 300

/**
 * Vista Árbol de la lista: organizaciones y cadenas con lo que cuelga de ellas, en orden de jerarquía.
 * La sangría cuenta solo los ancestros que la persona puede ver: si su rol no ve la cadena, sus tiendas salen al primer nivel.
 */
export async function listTree(ctx: Ctx, f: { market?: string; owner?: string; q?: string }): Promise<{ nodes: TreeNode[]; cut: boolean }> {
  return withUser(ctx.user.id, async (tx) => {
    const q = (f.q ?? '').trim()
    const rows = await tx<(TreeNode & { ancestor_ids: string[] })[]>`
      select a.id, a.name, a.kind, a.lifecycle, a.ancestor_ids, 0 as depth, u.full_name as owner_name,
             exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open') as has_deal,
             (select count(*)::int from crm.accounts c where c.parent_id = a.id and c.archived_at is null) as children
        from crm.accounts a left join crm.users u on u.id = a.owner_id
       where a.archived_at is null and a.market_code = any(${ctx.markets.map((m) => m.code)}::text[])
         ${f.market ? tx`and a.market_code = ${f.market}` : tx``}
         ${f.owner === 'me' ? tx`and (a.owner_id = ${ctx.user.id} or exists (select 1 from crm.accounts p where p.id = any(a.ancestor_ids) and p.owner_id = ${ctx.user.id}))` : tx``}
         ${q ? tx`and (a.name_norm like ${'%'} || app.norm(${q}) || ${'%'} or exists (select 1 from crm.accounts p where p.id = any(a.ancestor_ids) and p.name_norm like ${'%'} || app.norm(${q}) || ${'%'}))` : tx``}
         and (a.parent_id is not null or exists (select 1 from crm.accounts c where c.parent_id = a.id and c.archived_at is null))
       order by coalesce((select string_agg(p.name_norm || ' ' || p.id::text, '/' order by o.ord) from unnest(a.ancestor_ids) with ordinality o(pid, ord) join crm.accounts p on p.id = o.pid) || '/', '')
                || a.name_norm || ' ' || a.id::text
       limit ${TREE_LIMIT + 1}`
    const seen = new Set(rows.map((r) => r.id))
    const nodes = rows.slice(0, TREE_LIMIT).map(({ ancestor_ids, ...r }) => ({ ...r, depth: ancestor_ids.filter((id) => seen.has(id)).length }))
    return { nodes, cut: rows.length > TREE_LIMIT }
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
        postal_code: string | null; territory: string | null; in_my_territory: boolean; custom: Record<string, unknown>; created_at: Date; archived_at: Date | null; merged_into: string | null;
        account_type: string; type_es: string | null; type_en: string | null }[]
    >`select a.id, a.market_code, a.name, a.kind, a.segment, a.lifecycle, a.lifecycle_at, a.owner_id, u.full_name as owner_name, a.parent_id, a.ancestor_ids,
             a.phone, a.email::text, a.address_line, a.locality, a.region, a.postal_code, t.name as territory,
             exists (select 1 from crm.user_territories ut where ut.territory_id = a.territory_id and ut.user_id = ${ctx.user.id}) as in_my_territory,
             a.custom, a.created_at, a.archived_at, a.merged_into,
             a.account_type, ty.label_es as type_es, ty.label_en as type_en
        from crm.accounts a left join crm.users u on u.id = a.owner_id left join crm.territories t on t.id = a.territory_id
        left join lateral (select x.label_es, x.label_en from crm.account_types x where x.code = a.account_type and (x.market_code is null or x.market_code = a.market_code)
                            order by x.market_code nulls last limit 1) ty on true
       where a.id = ${id}`
    const account = rows[0]
    if (!account) return null
    const ancestors = account.ancestor_ids.length
      ? await tx<{ id: string; name: string; kind: string; type_es: string | null; type_en: string | null }[]>`select p.id, p.name, p.kind,
             (select x.label_es from crm.account_types x where x.code = p.account_type and (x.market_code is null or x.market_code = p.market_code) order by x.market_code nulls last limit 1) as type_es,
             (select x.label_en from crm.account_types x where x.code = p.account_type and (x.market_code is null or x.market_code = p.market_code) order by x.market_code nulls last limit 1) as type_en
            from crm.accounts p where p.id = any(${account.ancestor_ids}::uuid[])
          order by array_position(${account.ancestor_ids}::uuid[], p.id)`
      : []
    // DAT-01: roll-up de todo lo que cuelga de esta cuenta, a cualquier profundidad.
    const rollup = await tx<{ accounts: number; stores: number; active: number; at_risk: number; onboarding: number; txn_30d: number; volume_30d: string | null; currency: string | null }[]>`
      select count(*)::int as accounts, count(*) filter (where d.kind = 'store')::int as stores,
             count(*) filter (where d.lifecycle = 'active')::int as active,
             count(*) filter (where d.lifecycle = 'at_risk')::int as at_risk,
             count(*) filter (where d.lifecycle = 'onboarding')::int as onboarding,
             coalesce(sum(mm.txn_count_30d), 0)::int as txn_30d, sum(mm.volume_minor_30d)::text as volume_30d, max(mm.currency) as currency
        from crm.accounts d
        left join lateral (select m.txn_count_30d, m.volume_minor_30d, m.currency from crm.merchant_metrics_daily m where m.account_id = d.id order by m.as_of desc limit 1) mm on true
       where d.ancestor_ids @> array[${id}::uuid] and d.archived_at is null`
    const children = await tx<{ id: string; name: string; kind: string; type_es: string | null; type_en: string | null; lifecycle: string; locality: string | null; owner_name: string | null; txn_count_30d: number | null; since: Date; has_deal: boolean }[]>`
      select c.id, c.name, c.kind, c.lifecycle, c.locality, u.full_name as owner_name,
             (select x.label_es from crm.account_types x where x.code = c.account_type and (x.market_code is null or x.market_code = c.market_code) order by x.market_code nulls last limit 1) as type_es,
             (select x.label_en from crm.account_types x where x.code = c.account_type and (x.market_code is null or x.market_code = c.market_code) order by x.market_code nulls last limit 1) as type_en,
             coalesce((select max(x.effective_from) from crm.account_attributions x where x.account_id = c.id and x.layer = 'channel' and x.effective_to is null), c.created_at) as since,
             exists (select 1 from crm.deals d where d.account_id = c.id and d.status = 'open') as has_deal,
             (select m.txn_count_30d from crm.merchant_metrics_daily m where m.account_id = c.id order by m.as_of desc limit 1) as txn_count_30d
        from crm.accounts c left join crm.users u on u.id = c.owner_id
       where c.parent_id = ${id} and c.archived_at is null order by c.name limit 60`
    const contacts = await tx<{ id: string; full_name: string; phone: string | null; email: string | null; role: string; valid_from: Date; is_primary: boolean; preferred_locale: string | null; sms_capable: boolean | null }[]>`
      select c.id, c.full_name, c.phone, c.email::text, ac.role, ac.valid_from, ac.is_primary, c.preferred_locale, c.sms_capable
        from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${id} and ac.valid_to is null order by ac.is_primary desc, ac.role, c.full_name`
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
    // El archivo más reciente de S5 y, si existe, el de 30 días antes (hasta 7 días de tolerancia): la comparación no se inventa.
    const metrics = await tx<{ as_of: string; first_txn_at: Date | null; last_txn_at: Date | null; txn_count_30d: number; volume_minor_30d: string; currency: string; active_days_30d: number;
      prev_as_of: string | null; prev_txn_count_30d: number | null; prev_volume_minor_30d: string | null }[]>`
      select m.as_of::text, m.first_txn_at, m.last_txn_at, m.txn_count_30d, m.volume_minor_30d::text, m.currency, m.active_days_30d,
             p.as_of::text as prev_as_of, p.txn_count_30d as prev_txn_count_30d, p.volume_minor_30d::text as prev_volume_minor_30d
        from crm.merchant_metrics_daily m
        left join lateral (select x.as_of, x.txn_count_30d, x.volume_minor_30d from crm.merchant_metrics_daily x
                            where x.account_id = m.account_id and x.as_of <= m.as_of - 30 and x.as_of >= m.as_of - 37 order by x.as_of desc limit 1) p on true
       where m.account_id = ${id} order by m.as_of desc limit 1`
    // `motor`: el tipo de venta del embudo del negocio al que pertenece la tarea; sin negocio, vale el segmento del comercio.
    const tasks = await tx<{ id: string; kind: string; subject: string; due_at: Date | null; owner_name: string | null; motor: string | null }[]>`
      select a.id, a.kind, a.subject, a.due_at, u.full_name as owner_name,
             (select p.motor from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where d.id = a.deal_id) as motor
        from crm.activities a left join crm.users u on u.id = a.owner_id
       where a.account_id = ${id} and a.kind in ('task', 'handoff', 'call', 'meeting', 'email', 'visit') and a.done_at is null order by a.due_at nulls last limit 10`
    // ACT-01: un solo hilo con actividades (incluidas las visitas capturadas a mano), visitas de la Sales App, cambios de etapa y de dueño.
    const timeline = await tx<TimelineItem[]>`
      select * from (
        -- Lo hecho se fecha con el día en que se hizo, no con el día en que se creó la tarea.
        select coalesce(a.done_at, a.created_at) as at, a.kind, a.subject as title, a.body, u.full_name as actor,
               jsonb_build_object('done', a.done_at is not null, 'source', a.source, 'outcome', a.outcome, 'visited_by', a.visited_by,
                                  'origin', case when a.kind = 'visit' then 'manual' end, 'type_label', a.type_label,
                                  'rejection', a.no_sale_code, 'rejection_es', nr.label_es, 'rejection_en', nr.label_en) as meta
          from crm.activities a left join crm.users u on u.id = a.created_by left join crm.loss_reasons nr on nr.code = a.no_sale_code where a.account_id = ${id} and (a.done_at is not null or a.kind in ('note', 'system'))
        union all
        select v.checked_in_at, 'visit', v.outcome, v.note, coalesce(u.full_name, v.salesperson_ref),
               jsonb_build_object('origin', 'sales_app', 'rejection', v.rejection_code, 'rejection_es', r.label_es, 'rejection_en', r.label_en,
                                  'revisit', v.revisit, 'minutes', v.duration_seconds / 60, 'decision_maker', v.decision_maker_seen)
          from crm.visits v left join crm.users u on u.id = v.user_id left join crm.loss_reasons r on r.code = v.rejection_code where v.account_id = ${id}
        union all
        select e.at, 'stage', t.name_es, t.name_en, u.full_name, jsonb_build_object('cause', e.cause, 'kind', t.kind, 'won_on', case when t.kind = 'won' and d.status = 'won' then (d.won_at at time zone (select mk.timezone from crm.markets mk where mk.code = d.market_code))::date::text end)
          from crm.deal_stage_events e join crm.deals d on d.id = e.deal_id join crm.stages t on t.id = e.to_stage_id left join crm.users u on u.id = e.actor_id
         where d.account_id = ${id}
        union all
        -- Cambio de dueño: quién lo hizo (created_by) y de quién venía (el dueño anterior en la misma capa).
        select at.effective_from, 'attribution', at.party_label, null, cu.full_name,
               jsonb_build_object('layer', at.layer, 'from', (select p.party_label from crm.account_attributions p
                   where p.account_id = at.account_id and p.layer = 'owner' and p.effective_from < at.effective_from order by p.effective_from desc limit 1))
          from crm.account_attributions at left join crm.users cu on cu.id = at.created_by where at.account_id = ${id} and at.layer = 'owner'
      ) x order by at desc limit 60`
    // Con cada embudo van las etapas de Ventas donde puede nacer un negocio (las anteriores a la primera de Operaciones).
    const pipelines = await tx<{ id: string; name: string; motor: string; multi_open: boolean; has_items: boolean; stages: { id: string; name_es: string; name_en: string }[] }[]>`
      select p.id, p.name, p.motor, p.multi_open, p.has_items,
             coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name_es', s.name_es, 'name_en', s.name_en) order by s.position) from crm.stages s
                        where s.pipeline_id = p.id and s.kind = 'open'
                          and not exists (select 1 from crm.stages o where o.pipeline_id = p.id and o.is_ops and o.position <= s.position)), '[]'::jsonb) as stages
        from crm.pipelines p where p.market_code = ${account.market_code} and p.is_active order by p.position`
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
  if (term.length < 2) return { accounts: [], leads: [], deals: [], others: [] }
  return withUser(ctx.user.id, async (tx) => {
    const digits = term.replace(/[^\d]/g, '')
    const accounts = await tx<{ id: string; name: string; market_code: string; lifecycle: string; locality: string | null; via: string | null; has_deal: boolean }[]>`
      select a.id, a.name, a.market_code, a.lifecycle, a.locality,
             exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open') as has_deal,
             (select al.system || ' ' || al.external_id from crm.account_aliases al where al.account_id = a.id and al.valid_to is null
               and upper(al.external_id) like ${'%' + term.toUpperCase() + '%'} limit 1) as via
        from crm.accounts a
       where a.archived_at is null and a.market_code = any(${ctx.markets.map((m) => m.code)}::text[])
         and (a.name_norm like ${'%'} || app.norm(${term}) || ${'%'} or a.name_norm % app.norm(${term})
             ${digits.length >= 4 ? tx`or a.phone like ${'%' + digits + '%'}` : tx``}
             ${/^[0-9a-f]{8}(-[0-9a-f-]{0,28})?$/i.test(term) ? tx`or a.id::text like ${term.toLowerCase() + '%'}` : tx``}
             or exists (select 1 from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
                         where ac.account_id = a.id and ac.valid_to is null
                           and (app.norm(c.full_name) like ${'%'} || app.norm(${term}) || ${'%'} ${digits.length >= 4 ? tx`or c.phone like ${'%' + digits + '%'}` : tx``}))
             or exists (select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null and upper(al.external_id) like ${'%' + term.toUpperCase() + '%'}))
       order by similarity(a.name_norm, app.norm(${term})) desc limit 12`
    const leads = await tx<{ id: string; business_name: string; market_code: string; status: string }[]>`
      select id, business_name, market_code, status from crm.leads
       where app.norm(business_name) like ${'%'} || app.norm(${term}) || ${'%'} or app.norm(contact_name) like ${'%'} || app.norm(${term}) || ${'%'}
          ${digits.length >= 4 ? tx`or phone like ${'%' + digits + '%'}` : tx``}
       order by created_at desc limit 8`
    const deals = await tx<{ id: string; title: string; market_code: string; status: string }[]>`
      select id, title, market_code, status from crm.deals where app.norm(title) like ${'%'} || app.norm(${term}) || ${'%'} order by created_at desc limit 8`
    // "Existe y lo lleva X": lo que es de otra persona en un mercado donde vendo. La función solo da nombre, ciudad y dueño;
    // aquí se quita lo que la persona sí puede abrir (por ejemplo, lo de su equipo), para no repetirlo.
    const found = await tx<{ kind: 'account' | 'lead'; id: string; name: string; locality: string | null; owner_name: string; market_code: string }[]>`
      select kind, id, name, locality, owner_name, market_code from app.search_others(${term})`
    const ids = found.map((o) => o.id)
    const mine = ids.length === 0 ? [] : await tx<{ id: string }[]>`
      select id from crm.accounts where id = any(${ids}::uuid[]) union all select id from crm.leads where id = any(${ids}::uuid[])`
    const visible = new Set(mine.map((r) => r.id))
    const others = found.filter((o) => !visible.has(o.id)).map(({ kind, name, locality, owner_name, market_code }) => ({ kind, name, locality, owner_name, market_code }))
    return { accounts: [...accounts], leads: [...leads], deals: [...deals], others }
  })
}
