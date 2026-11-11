import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export async function getUsers(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const users = await tx<{ id: string; full_name: string; email: string; is_synthetic: boolean; last_seen: Date | null; active_days: number; actions: number }[]>`
      select u.id, u.full_name, u.email::text, u.is_synthetic,
             (select max(e.at) from crm.usage_events e where e.user_id = u.id) as last_seen,
             (select count(distinct e.at::date)::int from crm.usage_events e where e.user_id = u.id and e.at > now() - interval '14 days') as active_days,
             (select count(*)::int from crm.audit_events a where a.actor_id = u.id and a.at > now() - interval '14 days') as actions
        from crm.users u where u.is_active and not u.is_system order by u.full_name`
    const memberships = await tx<{ id: string; user_id: string; market_code: string | null; role: string; team: string | null }[]>`
      select m.id, m.user_id, m.market_code, m.role, t.name as team from crm.memberships m left join crm.teams t on t.id = m.team_id
       where m.valid_to is null order by m.market_code nulls first, m.role`
    const teams = await tx<{ id: string; name: string; market_code: string }[]>`select id, name, market_code from crm.teams order by market_code, name`
    return { users: [...users], memberships: [...memberships], teams: [...teams] }
  })
}

export async function getConfig(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const pipelines = await tx<{ id: string; market_code: string; motor: string; name: string; close_by_transaction: boolean }[]>`
      select id, market_code, motor, name, close_by_transaction from crm.pipelines where is_active order by market_code, position`
    const stages = await tx<{ id: string; pipeline_id: string; position: number; name_es: string; name_en: string; kind: string; probability: number; rot_days: number; required_fields: string[]; exit_es: string; exit_en: string }[]>`
      select id, pipeline_id, position, name_es, name_en, kind, probability, rot_days, required_fields, exit_es, exit_en from crm.stages order by pipeline_id, position`
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
    const rules = await tx<{ id: string; market_code: string; name: string; strategy: string; member_ids: string[]; cursor: number; fallback: string | null; sla_minutes: number }[]>`
      select r.id, r.market_code, r.name, r.strategy, r.member_ids, r.cursor, u.full_name as fallback, r.sla_minutes
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
    const clients = await tx<{ id: string; name: string; key_prefix: string; scopes: string[]; created_at: Date; revoked_at: Date | null }[]>`
      select id, name, key_prefix, scopes, created_at, revoked_at from crm.api_clients order by created_at desc`
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

export const AUDIT_PAGE = 50

export async function getAudit(ctx: Ctx, f: { before?: string; object?: string }) {
  return withUser(ctx.user.id, async (tx) => {
    const [bTs, bId] = (f.before ?? '').split('|')
    const rows = await tx<{ id: string; at: Date; actor: string | null; action: string; object: string; object_id: string | null; market_code: string | null; after: Record<string, unknown> | null }[]>`
      select e.id, e.at, u.full_name as actor, e.action, e.object, e.object_id, e.market_code, e.after
        from crm.audit_events e left join crm.users u on u.id = e.actor_id
       where true ${f.object ? tx`and e.object = ${f.object}` : tx``}
         ${bTs && bId ? tx`and (e.at, e.id) < (${bTs}::timestamptz, ${bId}::uuid)` : tx``}
       order by e.at desc, e.id desc limit ${AUDIT_PAGE + 1}`
    const items = rows.slice(0, AUDIT_PAGE)
    const last = items[items.length - 1]
    return { items, next: rows.length > AUDIT_PAGE && last ? `${new Date(last.at).toISOString()}|${last.id}` : null }
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
    return { dups: [...dups], gaps: [...gaps] }
  })
}
