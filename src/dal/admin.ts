import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isUuid } from '@/lib/ids'
import { AUDIT_GROUPS, AUDIT_OBJECT, idsIn, isAuditGroup, type Names } from '@/lib/audit'
import type postgres from 'postgres'

export type AccessFilter = 'con' | 'sin' | 'todas'

export type MembershipRow = {
  id: string
  user_id: string
  market_code: string | null
  role: string
  team: string | null
  /** Último día con acceso (AAAA-MM-DD), o null si no vence. */
  expires: string | null
  expires_in_days: number | null
  /** Lo que la persona tiene a su nombre y sigue abierto, en el mercado del rol (o en todos, si el rol es global). */
  accounts: number
  deals: number
  leads: number
  /** Turnos de los que saldría si se le quita este rol, y turnos de los que es respaldo. */
  leaves_rules: string[]
  fallback_of: string[]
}

/** Vigencia de una membresía: la misma condición que usa la base para decidir quién entra. */
const current = (tx: Tx, alias: postgres.Fragment) => tx`${alias}.valid_from <= now() and (${alias}.valid_to is null or ${alias}.valid_to > now())`

export async function getUsers(ctx: Ctx, access: AccessFilter = 'con') {
  return withUser(ctx.user.id, async (tx) => {
    const m = tx`m`
    const all = await tx<{ id: string; full_name: string; email: string; is_synthetic: boolean; last_seen: Date | null; active_days: number; actions: number; has_access: boolean; ended_at: Date | null }[]>`
      select u.id, u.full_name, u.email::text, u.is_synthetic,
             (select max(e.at) from crm.usage_events e where e.user_id = u.id) as last_seen,
             (select count(distinct e.at::date)::int from crm.usage_events e where e.user_id = u.id and e.at > now() - interval '14 days') as active_days,
             (select count(*)::int from crm.audit_events a where a.actor_id = u.id and a.at > now() - interval '14 days') as actions,
             exists (select 1 from crm.memberships m where m.user_id = u.id and ${current(tx, m)}) as has_access,
             (select max(m.valid_to) from crm.memberships m where m.user_id = u.id and m.valid_to <= now()) as ended_at
        from crm.users u where u.is_active and not u.is_system order by u.full_name`
    const memberships = await tx<MembershipRow[]>`
      select m.id, m.user_id, m.market_code, m.role, t.name as team,
             to_char((m.valid_to at time zone z.tz) - interval '1 second', 'YYYY-MM-DD') as expires,
             ((m.valid_to at time zone z.tz) - interval '1 second')::date - (now() at time zone z.tz)::date as expires_in_days,
             (select count(*)::int from crm.accounts a where a.owner_id = m.user_id and a.archived_at is null and (m.market_code is null or a.market_code = m.market_code)) as accounts,
             (select count(*)::int from crm.deals d where d.owner_id = m.user_id and d.status = 'open' and (m.market_code is null or d.market_code = m.market_code)) as deals,
             (select count(*)::int from crm.leads l where l.owner_id = m.user_id and l.status in ('new','contacted','qualified') and (m.market_code is null or l.market_code = m.market_code)) as leads,
             coalesce((select array_agg(r.name order by r.name) from crm.routing_rules r
                        where r.market_code = m.market_code and m.user_id = any(r.member_ids) and k.last_sales_role), '{}') as leaves_rules,
             coalesce((select array_agg(r.name order by r.name) from crm.routing_rules r
                        where r.market_code = m.market_code and r.fallback_id = m.user_id and k.last_sales_role), '{}') as fallback_of
        from crm.memberships m
        left join crm.teams t on t.id = m.team_id
        cross join lateral (select coalesce((select mk.timezone from crm.markets mk where mk.code = m.market_code), 'UTC') as tz) z
        cross join lateral (select m.role in ('rep','supervisor','market_lead') and not exists (
            select 1 from crm.memberships o where o.user_id = m.user_id and o.id <> m.id and o.market_code = m.market_code
               and o.role in ('rep','supervisor','market_lead') and o.valid_from <= now() and (o.valid_to is null or o.valid_to > now())) as last_sales_role) k
       where ${current(tx, m)} order by m.market_code nulls first, m.role`
    const teams = await tx<{ id: string; name: string; market_code: string; motor: string; members: number }[]>`
      select t.id, t.name, t.market_code, t.motor,
             (select count(*)::int from crm.memberships m where m.team_id = t.id and ${current(tx, m)}) as members
        from crm.teams t order by t.market_code, t.name`
    const users = all.filter((u) => (access === 'todas' ? true : access === 'sin' ? !u.has_access : u.has_access))
    return {
      users,
      memberships: [...memberships],
      teams: [...teams],
      counts: { con: all.filter((u) => u.has_access).length, sin: all.filter((u) => !u.has_access).length, todas: all.length },
    }
  })
}

export async function getConfig(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const pipelines = await tx<{ id: string; market_code: string; motor: string; name: string; close_by_transaction: boolean; open_deals: number }[]>`
      select p.id, p.market_code, p.motor, p.name, p.close_by_transaction,
             (select count(*)::int from crm.deals d where d.pipeline_id = p.id and d.status = 'open') as open_deals
        from crm.pipelines p where p.is_active order by p.market_code, p.position`
    const stages = await tx<{ id: string; pipeline_id: string; position: number; name_es: string; name_en: string; kind: string; probability: number; rot_days: number; required_fields: string[]; exit_es: string; exit_en: string; edited_at: Date | null }[]>`
      select id, pipeline_id, position, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en, edited_at from crm.stages order by pipeline_id, position`
    const reasons = await tx<{ code: string; kind: string; label_es: string; label_en: string }[]>`
      select code, kind, label_es, label_en from crm.loss_reasons where is_active order by kind, label_es`
    const fields = await tx<{ object: string; key: string; label_es: string; label_en: string; data_type: string; market_code: string | null; data_class: string }[]>`
      select object, key, label_es, label_en, data_type, market_code, data_class from crm.field_definitions where is_active and source = 'manual' order by object, key`
    const imported = await tx<{ object: string; n: number }[]>`
      select object, count(*)::int as n from crm.field_definitions where is_active and source <> 'manual' group by object order by object`
    return { pipelines: [...pipelines], stages: [...stages], reasons: [...reasons], fields: [...fields], imported: [...imported] }
  })
}

export async function getIntake(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const forms = await tx<{ id: string; slug: string; name: string; market_code: string; motor: string; locale: string; is_active: boolean; rule: string | null; leads_30d: number }[]>`
      select f.id, f.slug, f.name, f.market_code, f.motor, f.locale, f.is_active, r.name as rule,
             (select count(*)::int from crm.leads l where l.form_id = f.id and l.created_at > now() - interval '30 days') as leads_30d
        from crm.web_forms f left join crm.routing_rules r on r.id = f.routing_rule_id order by f.market_code, f.name`
    const rules = await tx<{ id: string; market_code: string; name: string; strategy: string; member_ids: string[]; cursor: number; fallback: string | null; fallback_active: boolean; sla_minutes: number; members: { id: string; full_name: string; active: boolean }[] }[]>`
      select r.id, r.market_code, r.name, r.strategy, r.member_ids, r.cursor, u.full_name as fallback,
             (r.fallback_id is not null and app.can_sell_in(r.fallback_id, r.market_code)) as fallback_active, r.sla_minutes,
             coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', mu.full_name, 'active', app.can_sell_in(x.id, r.market_code)) order by x.ord)
                         from unnest(r.member_ids) with ordinality as x(id, ord) join crm.users mu on mu.id = x.id), '[]'::jsonb) as members
        from crm.routing_rules r left join crm.users u on u.id = r.fallback_id where r.is_active order by r.market_code, r.name`
    const load = await tx<{ owner_id: string; n: number }[]>`
      select owner_id, count(*)::int as n from crm.leads where created_at > now() - interval '30 days' and owner_id is not null group by owner_id`
    return { forms: [...forms], rules: [...rules], load: Object.fromEntries(load.map((l) => [l.owner_id, l.n])) as Record<string, number> }
  })
}

export async function getIntegrations(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const events = await tx<{ id: string; source: string; event_type: string; idempotency_key: string; status: string; error: string | null; received_at: Date }[]>`
      select id, source, event_type, idempotency_key, status, error, received_at from crm.inbound_events order by received_at desc limit 15`
    const batches = await tx<{ id: string; as_of: string; file_name: string; row_count: number; matched: number; unmatched: number; loaded_at: Date }[]>`
      select id, as_of::text, file_name, row_count, matched, unmatched, loaded_at from crm.ingest_batches order by loaded_at desc limit 8`
    const outbox = await tx<{ id: string; event_type: string; aggregate: string; market_code: string | null; created_at: Date; published_at: Date | null }[]>`
      select id, event_type, aggregate, market_code, created_at, published_at from crm.outbox_events order by created_at desc limit 12`
    const pending = await tx<{ n: number }[]>`select count(*)::int as n from crm.outbox_events where published_at is null`
    const clients = await tx<{ id: string; name: string; key_prefix: string; scopes: string[]; created_at: Date; created_by: string | null; revoked_at: Date | null }[]>`
      select c.id, c.name, c.key_prefix, c.scopes, c.created_at, u.full_name as created_by, c.revoked_at
        from crm.api_clients c left join crm.users u on u.id = c.created_by order by c.created_at desc`
    // Candidatos para probar el contrato desde esta pantalla: un comercio esperando su primera venta y uno con deal abierto.
    const awaiting = await tx<{ account_id: string; name: string; alias: string; market_code: string; currency: string }[]>`
      select a.id as account_id, a.name, al.external_id as alias, a.market_code, mk.currency
        from crm.deals d join crm.stages s on s.id = d.stage_id and s.kind = 'awaiting_txn' join crm.accounts a on a.id = d.account_id
        join crm.markets mk on mk.code = a.market_code
        join crm.account_aliases al on al.account_id = a.id and al.valid_to is null and al.system in ('s5','sales_core')
       where d.status = 'open' order by d.stage_entered_at limit 6`
    const visitable = await tx<{ account_id: string; name: string; alias: string; market_code: string }[]>`
      select a.id as account_id, a.name, al.external_id as alias, a.market_code
        from crm.deals d join crm.stages s on s.id = d.stage_id and s.kind = 'open' join crm.accounts a on a.id = d.account_id
        join crm.account_aliases al on al.account_id = a.id and al.valid_to is null and al.system = 'sales_core'
       where d.status = 'open' and not d.revisit_needed order by d.created_at desc limit 6`
    return { events: [...events], batches: [...batches], outbox: [...outbox], outboxPending: pending[0]?.n ?? 0, clients: [...clients], awaiting: [...awaiting], visitable: [...visitable] }
  })
}

/** Mercado y moneda del comercio que lleva ese ID externo. Lo usa el simulador para fechar el archivo con el día del mercado. */
export async function aliasMarket(ctx: Ctx, externalId: string): Promise<{ market_code: string; currency: string } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; currency: string }[]>`
      select a.market_code, trim(mk.currency) as currency from crm.account_aliases al join crm.accounts a on a.id = al.account_id
        join crm.markets mk on mk.code = a.market_code where al.external_id = ${externalId} and al.valid_to is null limit 1`
    return rows[0] ?? null
  })
}

export const AUDIT_PAGE = 50

export type AuditFilters = {
  /** Quién hizo el cambio. */
  actor?: string
  /** Tipo de acción (`AUDIT_GROUPS`). Vacío: todo menos inicios y cierres de sesión. */
  group?: string
  /** Tipo de registro afectado y, si se quiere, un registro en particular. */
  object?: string
  id?: string
  market?: string
  /** Fechas (AAAA-MM-DD) en la zona horaria de quien lee, las dos incluidas. */
  from?: string
  to?: string
  tz: string
  /** Paginación por llave (at, id): `before` trae lo anterior a ese evento y `after` lo posterior. */
  before?: string
  after?: string
}

export type AuditEvent = {
  id: string
  at: Date
  at_us: string
  actor: string | null
  actor_id: string | null
  action: string
  object: string
  object_id: string | null
  market_code: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const parseCursor = (v: string | undefined) => {
  const [ts, id] = (v ?? '').split('|')
  return ts && isUuid(id) && !Number.isNaN(Date.parse(ts)) ? { ts, id } : null
}
// El cursor lleva la hora con microsegundos, como la guarda la base: con milisegundos, dos eventos del mismo
// milisegundo se repetían o se saltaban al cambiar de página.
const cursorOf = (e: { at_us: string; id: string } | undefined) => (e ? `${e.at_us}|${e.id}` : null)

/**
 * Bitácora con filtros y nombres. Los nombres se buscan con los permisos de quien lee (RLS): si la persona no puede ver
 * un registro, la bitácora no le dice cómo se llama ni le da enlace.
 */
export async function getAudit(ctx: Ctx, f: AuditFilters) {
  return withUser(ctx.user.id, async (tx) => {
    const group = AUDIT_GROUPS[isAuditGroup(f.group) ? f.group : '']
    // La zona llega del navegador. Si la base no la conoce (su catálogo de zonas puede ir atrás del navegador), el filtro
    // de fechas usa UTC en vez de fallar.
    const dated = (f.from && DAY.test(f.from)) || (f.to && DAY.test(f.to))
    const tz = dated && (await tx`select 1 from pg_timezone_names where name = ${f.tz}`).length > 0 ? f.tz : 'UTC'
    const where = tx`
      ${isUuid(f.actor) ? tx`and e.actor_id = ${f.actor}` : tx``}
      ${group.like ? tx`and e.action like any(${[...group.like]}::text[])` : tx``}
      ${group.not ? tx`and not (e.action like any(${[...group.not]}::text[]))` : tx``}
      ${f.object && f.object in AUDIT_OBJECT ? tx`and e.object = ${f.object}` : tx``}
      ${isUuid(f.id) ? tx`and e.object_id = ${f.id}` : tx``}
      ${f.market && /^[A-Z]{2}$/.test(f.market) ? tx`and e.market_code = ${f.market}` : tx``}
      ${f.from && DAY.test(f.from) ? tx`and e.at >= (${f.from}::date::timestamp at time zone ${tz})` : tx``}
      ${f.to && DAY.test(f.to) ? tx`and e.at < ((${f.to}::date + 1)::timestamp at time zone ${tz})` : tx``}`
    const after = parseCursor(f.after)
    const before = after ? null : parseCursor(f.before)
    const cols = tx`e.id, e.at, to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_us,
                    u.full_name as actor, e.actor_id, e.action, e.object, e.object_id, e.market_code, e.before, e.after`
    const from = tx`from crm.audit_events e left join crm.users u on u.id = e.actor_id where true ${where}`
    let rows: AuditEvent[]
    if (after) {
      rows = [...await tx<AuditEvent[]>`select ${cols} ${from} and (e.at, e.id) > (${after.ts}::timestamptz, ${after.id}::uuid) order by e.at, e.id limit ${AUDIT_PAGE + 1}`].reverse()
    } else {
      rows = [...await tx<AuditEvent[]>`select ${cols} ${from} ${before ? tx`and (e.at, e.id) < (${before.ts}::timestamptz, ${before.id}::uuid)` : tx``} order by e.at desc, e.id desc limit ${AUDIT_PAGE + 1}`]
    }
    const more = rows.length > AUDIT_PAGE
    const items = after ? rows.slice(more ? 1 : 0) : rows.slice(0, AUDIT_PAGE)
    const total = await tx<{ n: number }[]>`select count(*)::int as n ${from}`
    const actors = await tx<{ id: string; full_name: string }[]>`
      select u.id, u.full_name from crm.users u where exists (select 1 from crm.audit_events e where e.actor_id = u.id) order by u.is_system, u.full_name`

    // Nombres: de los registros afectados y de todo identificador que aparezca en el antes o el después.
    const ids = new Set<string>()
    for (const e of items) {
      if (e.object_id) ids.add(e.object_id)
      idsIn(e.before, ids)
      idsIn(e.after, ids)
    }
    const list = [...ids]
    const names: Names = {}
    const links: Record<string, string> = {}
    if (list.length > 0) {
      const found = await tx<{ id: string; kind: string; name: string }[]>`
        select id, 'user' as kind, full_name as name from crm.users where id = any(${list}::uuid[])
        union all select id, 'account', name from crm.accounts where id = any(${list}::uuid[])
        union all select id, 'deal', title from crm.deals where id = any(${list}::uuid[])
        union all select id, 'lead', business_name from crm.leads where id = any(${list}::uuid[])
        union all select id, 'team', name from crm.teams where id = any(${list}::uuid[])
        union all select p.id, 'pipeline', p.market_code || ' · ' || p.name from crm.pipelines p where p.id = any(${list}::uuid[])
        union all select s.id, 'stage', ${ctx.locale === 'en' ? tx`s.name_en` : tx`s.name_es`} from crm.stages s where s.id = any(${list}::uuid[])
        union all select id, 'routing_rule', name from crm.routing_rules where id = any(${list}::uuid[])
        union all select id, 'api_client', name from crm.api_clients where id = any(${list}::uuid[])
        union all select id, 'activity', left(subject, 80) from crm.activities where id = any(${list}::uuid[])
        union all select id, 'ingest_batch', file_name from crm.ingest_batches where id = any(${list}::uuid[])`
      for (const r of found) {
        names[r.id] = r.name
        if (r.kind === 'account') links[r.id] = `/comercios/${r.id}`
        else if (r.kind === 'deal') links[r.id] = `/deals/${r.id}`
        else if (r.kind === 'lead') links[r.id] = `/leads/${r.id}`
      }
    }
    return {
      items,
      total: total[0]?.n ?? 0,
      // Hay eventos más recientes si se llegó aquí yendo hacia atrás, o si al volver hacia adelante sobró una fila.
      newer: after ? (more ? cursorOf(items[0]) : null) : before ? cursorOf(items[0]) : null,
      older: after ? cursorOf(items[items.length - 1]) : more ? cursorOf(items[items.length - 1]) : null,
      actors: [...actors],
      names,
      links,
    }
  })
}

export async function getDataQuality(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const dups = await tx<{ id: string; market_code: string; a_id: string; a_name: string; a_locality: string | null; a_lifecycle: string; b_id: string; b_name: string; b_locality: string | null; b_lifecycle: string }[]>`
      select e.id, e.market_code, a.id as a_id, a.name as a_name, a.locality as a_locality, a.lifecycle as a_lifecycle,
             b.id as b_id, b.name as b_name, b.locality as b_locality, b.lifecycle as b_lifecycle
        from crm.exceptions e join crm.accounts a on a.id = e.account_id join crm.accounts b on b.id = (e.detail ->> 'other_id')::uuid
       where e.kind = 'duplicate_suspect' and e.resolved_at is null and a.archived_at is null and b.archived_at is null order by e.opened_at limit 30`
    const gaps = await tx<{ market_code: string; total: number; no_owner: number; no_phone: number; no_contact: number; no_alias: number }[]>`
      select a.market_code, count(*)::int as total,
             count(*) filter (where a.owner_id is null and a.parent_id is null)::int as no_owner,
             count(*) filter (where a.phone is null)::int as no_phone,
             count(*) filter (where not exists (select 1 from crm.account_contacts ac where ac.account_id = a.id and ac.valid_to is null))::int as no_contact,
             count(*) filter (where a.lifecycle <> 'prospect' and not exists (select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null))::int as no_alias
        from crm.accounts a where a.archived_at is null group by a.market_code order by a.market_code`
    // Lo que quedó a nombre de alguien que ya no tiene acceso, y lo que no tiene dueño: nadie lo va a trabajar hasta que se reasigne.
    const orphans = await tx<{ market_code: string; owner_id: string; full_name: string; accounts: number; deals: number; leads: number }[]>`
      select x.market_code, x.owner_id, u.full_name, sum(x.accounts)::int as accounts, sum(x.deals)::int as deals, sum(x.leads)::int as leads
        from (
          select market_code, owner_id, count(*) as accounts, 0 as deals, 0 as leads from crm.accounts where owner_id is not null and archived_at is null group by 1, 2
          union all select market_code, owner_id, 0, count(*), 0 from crm.deals where owner_id is not null and status = 'open' group by 1, 2
          union all select market_code, owner_id, 0, 0, count(*) from crm.leads where owner_id is not null and status in ('new','contacted','qualified') group by 1, 2
        ) x join crm.users u on u.id = x.owner_id
       where not app.works_in(x.owner_id, x.market_code)
       group by x.market_code, x.owner_id, u.full_name order by x.market_code, u.full_name limit 200`
    const unowned = await tx<{ market_code: string; leads: number; deals: number }[]>`
      select mk.code as market_code,
             (select count(*)::int from crm.leads l where l.market_code = mk.code and l.owner_id is null and l.status in ('new','contacted','qualified')) as leads,
             (select count(*)::int from crm.deals d where d.market_code = mk.code and d.owner_id is null and d.status = 'open') as deals
        from crm.markets mk order by mk.code`
    return { dups: [...dups], gaps: [...gaps], orphans: [...orphans], unowned: Object.fromEntries(unowned.map((u) => [u.market_code, u])) as Record<string, { leads: number; deals: number }> }
  })
}

export type SystemStatus = {
  migrations: { name: string; applied_at: string }[]
  pipedrive: { status: string; mode: string | null; started_at: string; finished_at: string | null } | null
  s5: { as_of: string; loaded_at: string; simulated: boolean } | null
  sales_app: { received_at: string; simulated: boolean } | null
  web_forms: { received_at: string } | null
  keys: Record<string, number>
  outbox_pending: number
}

/** Página de estado. Las fechas de integración salen de `app.system_status()`, que solo entrega conteos y fechas. */
export async function getStatus(ctx: Ctx) {
  ctx.assert('status.read')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ s: SystemStatus }[]>`select app.system_status() as s`
    const m = tx`m`
    const people = await tx<{ with_access: number; active_14d: number }[]>`
      select count(*)::int as with_access,
             count(*) filter (where exists (select 1 from crm.usage_events e where e.user_id = u.id and e.at > now() - interval '14 days'))::int as active_14d
        from crm.users u where u.is_active and not u.is_system and exists (select 1 from crm.memberships m where m.user_id = u.id and ${current(tx, m)})`
    const admins = await tx<{ id: string; full_name: string; expires: string | null }[]>`
      select u.id, u.full_name, to_char((m.valid_to at time zone 'UTC') - interval '1 second', 'YYYY-MM-DD') as expires
        from crm.memberships m join crm.users u on u.id = m.user_id
       where m.role = 'admin' and u.is_active and not u.is_system and ${current(tx, m)} order by u.full_name`
    const forms = await tx<{ n: number }[]>`select count(*)::int as n from crm.web_forms where is_active`
    return { ...rows[0]!.s, people: people[0] ?? { with_access: 0, active_14d: 0 }, admins: [...admins], forms: forms[0]?.n ?? 0 }
  })
}
