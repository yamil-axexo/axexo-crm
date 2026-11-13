import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { AdminArea, Role } from '@/domain/policy'
import type { Thresholds } from '@/domain/security'

// 0027 seguridad: lecturas de la pantalla de Seguridad y de la hoja "Equipo y datos reservados" de un comercio.
const current = `m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())`

export type Alert = { id: string; at: Date; kind: string; subject: string; period: string; observed: number; threshold: number; status: 'open' | 'acknowledged'; ack_name: string | null; ack_note: string | null }

/** Alertas, lo que salió de CONTIGO en los últimos 7 días, los lotes de copia y los umbrales. */
export async function getMonitoring(ctx: Ctx) {
  ctx.assert('security.read')
  return withUser(ctx.user.id, async (tx) => {
    const alerts = await tx<Alert[]>`
      select a.id, a.at, a.kind, coalesce(u.full_name, k.name, a.subject_key) as subject, a.period, a.observed, a.threshold, a.status, au.full_name as ack_name, a.ack_note
        from crm.security_alerts a left join crm.users u on u.id = a.actor_id left join crm.api_clients k on k.id = a.key_id left join crm.users au on au.id = a.ack_by
       order by (a.status = 'open') desc, a.at desc limit 60`
    const reads = await tx<{ name: string; kind: string; times: number; row_total: number; last_at: Date }[]>`
      select coalesce(u.full_name, k.name, 's/d') as name, r.kind, count(*)::int as times, coalesce(sum(r.row_count), 0)::int as row_total, max(r.at) as last_at
        from audit.read_log r left join crm.users u on u.id = r.actor_id left join crm.api_clients k on k.id = r.key_id
       where r.at > now() - interval '7 days' group by 1, 2 order by row_total desc, times desc limit 40`
    const batches = await tx<{ id: string; created_at: Date; log_name: string; row_count: number; sha256: string; status: string }[]>`
      select id::text, created_at, log_name, row_count, sha256, status from audit.archive_batches order by id desc limit 12`
    const settings = await tx<{ key: string; value: unknown }[]>`select key, value from crm.settings where key like 'security.%' or key like 'privacy.%'`
    const get = (k: string) => settings.find((s) => s.key === k)?.value
    const logs = await tx<{ data_rows: number; config_rows: number; via: { via: string; n: number }[] | null; excluded: { table_name: string; reason: string }[] | null }[]>`
      select (select count(*)::int from audit.data_log) as data_rows, (select count(*)::int from audit.config_log) as config_rows,
             (select jsonb_agg(jsonb_build_object('via', x.via, 'n', x.n)) from (select via, count(*)::int as n from audit.data_log where at > now() - interval '7 days' group by via order by 2 desc) x) as via,
             (select jsonb_agg(jsonb_build_object('table_name', e.table_name, 'reason', e.reason) order by e.table_name) from audit.excluded_tables e) as excluded`
    return {
      alerts: [...alerts], reads: [...reads], batches: [...batches],
      thresholds: (get('security.thresholds') ?? {}) as Partial<Thresholds>,
      dueDays: (get('privacy.due_days') ?? {}) as Record<string, number>,
      logs: { dataRows: logs[0]?.data_rows ?? 0, configRows: logs[0]?.config_rows ?? 0, via: logs[0]?.via ?? [], excluded: logs[0]?.excluded ?? [] },
    }
  })
}

export type LogRow = { id: string; at: Date; table_name: string; op: string; row_id: string | null; market_code: string | null; actor: string | null; db_role: string; via: string; changed: string[] | null; redacted: boolean }

/** La bitácora que escribe la base: qué tabla, qué fila, qué columnas, quién y por dónde. */
export async function getDbLog(ctx: Ctx, which: 'data' | 'config', via: string | null) {
  ctx.assert('audit.read')
  return withUser(ctx.user.id, async (tx) => {
    const t = which === 'config' ? tx`audit.config_log` : tx`audit.data_log`
    return [...(await tx<LogRow[]>`
      select l.id::text, l.at, l.table_name, l.op, l.row_id, l.market_code, u.full_name as actor, l.db_role, l.via, l.changed, l.redacted_at is not null as redacted
        from ${t} l left join crm.users u on u.id = l.actor_id
       where ${via ? tx`l.via = ${via}` : tx`true`} order by l.id desc limit 60`)]
  })
}

/** Quién administra qué, agencias, jerarquía de equipos, asientos, accesos sin uso y revisiones. */
export async function getAccessControl(ctx: Ctx) {
  if (!ctx.can('access.manage') && !ctx.can('access.review') && !ctx.can('security.read')) return null
  return withUser(ctx.user.id, async (tx) => {
    const unusedDays = (await tx<{ d: number }[]>`select coalesce((select (value #>> '{}')::int from crm.settings where key = 'security.unused_days'), 30) as d`)[0]!.d
    const admins = await tx<{ membership_id: string; user_id: string; full_name: string; areas: AdminArea[] | null }[]>`
      select m.id as membership_id, u.id as user_id, u.full_name, m.admin_areas as areas from crm.memberships m join crm.users u on u.id = m.user_id
       where m.role = 'admin' and u.is_active and not u.is_system and ${tx.unsafe(current)} order by u.full_name`
    const agencies = await tx<{ id: string; market_code: string; name: string; pipeline: string | null; territory: string | null; people: number; accounts: number; leads: number }[]>`
      select a.id, a.market_code, a.name, p.name as pipeline, t.name as territory,
             (select count(*)::int from crm.memberships m where m.agency_id = a.id and ${tx.unsafe(current)}) as people,
             (select count(*)::int from crm.accounts x where x.recruited_agency_id = a.id) as accounts,
             (select count(*)::int from crm.leads x where x.recruited_agency_id = a.id) as leads
        from crm.agencies a left join crm.pipelines p on p.id = a.pipeline_id left join crm.territories t on t.id = a.territory_id
       where a.is_active order by a.market_code, a.name`
    const teams = await tx<{ id: string; market_code: string; name: string; parent_team_id: string | null }[]>`
      select id, market_code, name, parent_team_id from crm.teams order by market_code, name`
    const seats = await tx<{ membership_id: string; full_name: string; role: Role; market_code: string | null; since: Date; approver_name: string | null; approved_on: string | null; reference: string | null }[]>`
      select m.id as membership_id, u.full_name, m.role, m.market_code, m.valid_from as since, s.approver_name, to_char(s.approved_on, 'YYYY-MM-DD') as approved_on, s.reference
        from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active and not u.is_system
        left join crm.seat_approvals s on s.membership_id = m.id
       where ${tx.unsafe(current)} order by (s.membership_id is null) desc, u.full_name limit 300`
    const unused = await tx<{ user_id: string; full_name: string; roles: string; last_active_at: Date | null }[]>`
      select u.id as user_id, u.full_name, string_agg(distinct m.role || coalesce(':' || m.market_code, ''), ', ') as roles,
             greatest(u.last_seen_at, (select max(e.at) from crm.usage_events e where e.user_id = u.id)) as last_active_at
        from crm.users u join crm.memberships m on m.user_id = u.id and ${tx.unsafe(current)}
       where u.is_active and not u.is_system group by u.id, u.full_name, u.last_seen_at
      having coalesce(greatest(u.last_seen_at, (select max(e.at) from crm.usage_events e where e.user_id = u.id)), 'epoch'::timestamptz) < now() - make_interval(days => ${unusedDays})
       order by 4 nulls first, u.full_name limit 200`
    const reviews = await tx<{ id: string; market_code: string | null; opened_at: Date; due_on: string; closed_at: Date | null; closed_name: string | null; total: number; pending: number; remove: number }[]>`
      select r.id, r.market_code, r.opened_at, to_char(r.due_on, 'YYYY-MM-DD') as due_on, r.closed_at, cu.full_name as closed_name,
             (select count(*)::int from crm.access_review_items i where i.review_id = r.id) as total,
             (select count(*)::int from crm.access_review_items i where i.review_id = r.id and i.decision is null) as pending,
             (select count(*)::int from crm.access_review_items i where i.review_id = r.id and i.decision = 'remove') as remove
        from crm.access_reviews r left join crm.users cu on cu.id = r.closed_by order by (r.closed_at is null) desc, r.opened_at desc limit 20`
    const items = await tx<{ id: string; review_id: string; membership_id: string; user_id: string; full_name: string; role: Role; market_code: string | null; last_active_at: Date | null; decision: 'keep' | 'remove' | null; note: string | null; still_active: boolean }[]>`
      select i.id, i.review_id, i.membership_id, i.user_id, u.full_name, i.role, i.market_code, i.last_active_at, i.decision, i.note,
             exists (select 1 from crm.memberships m where m.id = i.membership_id and ${tx.unsafe(current)}) as still_active
        from crm.access_review_items i join crm.users u on u.id = i.user_id
       where i.review_id in (select r.id from crm.access_reviews r where r.closed_at is null or r.closed_at > now() - interval '30 days')
       order by u.full_name`
    const people = await tx<{ id: string; full_name: string }[]>`
      select distinct u.id, u.full_name from crm.users u join crm.memberships m on m.user_id = u.id and ${tx.unsafe(current)}
       where u.is_active and not u.is_system order by u.full_name`
    const entities = await tx<{ id: string; market_code: string; name: string }[]>`select id, market_code, name from crm.legal_entities order by market_code, name`
    const scoped = await tx<{ membership_id: string; full_name: string; role: Role; market_code: string; legal_entity_id: string | null }[]>`
      select m.id as membership_id, u.full_name, m.role, m.market_code, m.legal_entity_id from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active and not u.is_system
       where m.market_code is not null and m.role in ('market_lead','supervisor','rep','ops') and ${tx.unsafe(current)} order by m.market_code, u.full_name limit 300`
    const pipelines = await tx<{ id: string; market_code: string; name: string }[]>`select id, market_code, name from crm.pipelines order by market_code, name`
    const territories = await tx<{ id: string; market_code: string; name: string }[]>`select id, market_code, name from crm.territories where archived_at is null order by market_code, name`
    return { unusedDays, admins: [...admins], agencies: [...agencies], teams: [...teams], seats: [...seats], unused: [...unused], reviews: [...reviews], items: [...items], people: [...people], entities: [...entities], scoped: [...scoped], pipelines: [...pipelines], territories: [...territories] }
  })
}

/** Campos sensibles, retención con su vista previa, solicitudes de titulares y bajas. */
export async function getPrivacy(ctx: Ctx) {
  ctx.assert('security.read')
  return withUser(ctx.user.id, async (tx) => {
    const fields = await tx<{ key: string; label_es: string; label_en: string; view_roles: string[]; edit_roles: string[]; owner_can_view: boolean; owner_can_edit: boolean; is_active: boolean }[]>`
      select key, label_es, label_en, view_roles, edit_roles, owner_can_view, owner_can_edit, is_active from crm.sensitive_fields order by label_es`
    const rules = await tx<{ key: string; label_es: string; label_en: string; action: string; after_days: number | null; is_active: boolean; last_run_at: Date | null; last_done: number | null }[]>`
      select key, label_es, label_en, action, after_days, is_active, last_run_at, last_done from crm.retention_rules order by key`
    const previews: Record<string, { total: number; sample: { kind: string; label: string; since: string }[] }> = {}
    if (ctx.can('security.manage')) {
      for (const r of rules) {
        if (r.after_days === null) continue
        const p = await tx<{ total: number; sample: { kind: string; label: string; since: string }[] }[]>`select total, sample from app.retention_preview(${r.key})`
        previews[r.key] = p[0] ?? { total: 0, sample: [] }
      }
    }
    const requests = await tx<{ id: string; market_code: string; kind: string; subject_name: string; received_on: string; due_on: string | null; status: string; assignee: string | null; resolution: string | null; linked: boolean; exported_at: Date | null; anonymized_at: Date | null; overdue: boolean }[]>`
      select r.id, r.market_code, r.kind, r.subject_name, to_char(r.received_on, 'YYYY-MM-DD') as received_on, to_char(r.due_on, 'YYYY-MM-DD') as due_on, r.status,
             u.full_name as assignee, r.resolution, (r.contact_id is not null or r.lead_id is not null) as linked, r.exported_at, r.anonymized_at,
             (r.due_on is not null and r.closed_at is null and r.due_on < (now() at time zone coalesce((select mk.timezone from crm.markets mk where mk.code = r.market_code), 'UTC'))::date) as overdue
        from crm.subject_requests r left join crm.users u on u.id = r.assignee_id order by (r.closed_at is null) desc, r.due_on nulls last, r.created_at desc limit 80`
    const suppressions = await tx<{ id: string; market_code: string; channel: string; address_norm: string; created_at: Date; lifted_at: Date | null }[]>`
      select id, market_code, channel, address_norm, created_at, lifted_at from crm.contact_suppressions order by created_at desc limit 60`
    return { fields: [...fields], rules: [...rules], previews, requests: [...requests], suppressions: [...suppressions] }
  })
}

/** Llaves de API con dueño, vencimiento y último uso, y el inventario de secretos de salida (sin valores). */
export async function getKeys(ctx: Ctx) {
  if (!ctx.can('integration.operate') && !ctx.can('security.read')) return null
  return withUser(ctx.user.id, async (tx) => {
    const keys = await tx<{ id: string; name: string; key_prefix: string; scopes: string[]; owner_id: string | null; owner: string | null; created_at: Date; expires: string | null; expired: boolean; last_used_at: Date | null; revoked_at: Date | null; rotated_from: string | null; retires: string | null }[]>`
      select c.id, c.name, c.key_prefix, c.scopes, c.owner_id, u.full_name as owner, c.created_at, to_char((c.expires_at at time zone 'UTC') - interval '1 second', 'YYYY-MM-DD') as expires,
             ((c.expires_at is not null and c.expires_at <= now()) or (c.retire_at is not null and c.retire_at <= now())) as expired, c.last_used_at, c.revoked_at, c.rotated_from,
             case when c.retire_at > now() then to_char(c.retire_at at time zone 'UTC', 'YYYY-MM-DD') end as retires
        from crm.api_clients c left join crm.users u on u.id = c.owner_id order by (c.revoked_at is null) desc, c.created_at desc limit 60`
    const secrets = await tx<{ key: string; label_es: string; label_en: string; system_name: string; owner_id: string | null; owner: string | null; rotate_every_days: number | null; last_rotated_on: string | null; due: boolean; note: string | null }[]>`
      select s.key, s.label_es, s.label_en, s.system_name, s.owner_id, u.full_name as owner, s.rotate_every_days, to_char(s.last_rotated_on, 'YYYY-MM-DD') as last_rotated_on,
             (s.rotate_every_days is not null and s.last_rotated_on is not null and s.last_rotated_on + s.rotate_every_days < now()::date) as due, s.note
        from crm.secret_inventory s left join crm.users u on u.id = s.owner_id order by s.system_name, s.key`
    const people = await tx<{ id: string; full_name: string }[]>`
      select distinct u.id, u.full_name from crm.users u join crm.memberships m on m.user_id = u.id and ${tx.unsafe(current)} where u.is_active and not u.is_system order by u.full_name`
    // Solo se dice si la variable existe en este ambiente; el valor no se lee ni se muestra.
    return { keys: [...keys], secrets: secrets.map((s) => ({ ...s, configured: Boolean(process.env[s.key]) })), people: [...people] }
  })
}

/** Personas a las que se puede ver como, y la última vez que alguien lo hizo. */
export async function getViewAs(ctx: Ctx) {
  ctx.assert('user.view_as')
  return withUser(ctx.user.id, async (tx) => {
    const people = await tx<{ id: string; full_name: string; roles: string }[]>`
      select u.id, u.full_name, string_agg(distinct m.role || coalesce(' ' || m.market_code, ''), ', ') as roles
        from crm.users u join crm.memberships m on m.user_id = u.id and ${tx.unsafe(current)}
       where u.is_active and not u.is_system and u.id <> ${ctx.user.id} group by u.id, u.full_name order by u.full_name`
    const recent = await tx<{ at: Date; actor: string; target: string; reason: string }[]>`
      select e.at, a.full_name as actor, t.full_name as target, e.after ->> 'reason' as reason
        from crm.audit_events e join crm.users a on a.id = e.actor_id join crm.users t on t.id = e.object_id
       where e.action = 'view_as.started' order by e.at desc limit 10`
    return { people: [...people], recent: [...recent] }
  })
}

/** Hoja de un comercio: su equipo, sus campos reservados (tapados) y el consentimiento de sus contactos. */
export async function getAccountSecurity(ctx: Ctx, accountId: string) {
  return withUser(ctx.user.id, async (tx) => {
    const acc = await tx<{ id: string; name: string; market_code: string; owner_id: string | null; owner: string | null; agency: string | null; can_manage: boolean; phone: string | null; email: string | null }[]>`
      select a.id, a.name, a.market_code, a.owner_id, u.full_name as owner, ag.name as agency, app.can_manage_account(a.id) as can_manage, a.phone, a.email::text
        from crm.accounts a left join crm.users u on u.id = a.owner_id left join crm.agencies ag on ag.id = a.recruited_agency_id where a.id = ${accountId}`
    if (!acc[0]) return null
    const team = await tx<{ id: string; user_id: string; full_name: string; function: string; access: string; note: string | null; valid_from: Date }[]>`
      select t.id, t.user_id, u.full_name, t.function, t.access, t.note, t.valid_from from crm.account_team t join crm.users u on u.id = t.user_id
       where t.account_id = ${accountId} and t.valid_to is null order by u.full_name`
    const candidates = acc[0].can_manage ? await tx<{ id: string; full_name: string }[]>`
      select distinct u.id, u.full_name from crm.users u join crm.memberships m on m.user_id = u.id and ${tx.unsafe(current)}
       where u.is_active and not u.is_system and m.market_code = ${acc[0].market_code} and m.role in ('rep','supervisor','market_lead','ops')
         and u.id is distinct from ${acc[0].owner_id} and not exists (select 1 from crm.account_team t where t.account_id = ${accountId} and t.user_id = u.id and t.valid_to is null)
       order by u.full_name` : []
    const sensitive = await tx<{ field_key: string; label_es: string; label_en: string; has_value: boolean; can_view: boolean; can_edit: boolean; updated_at: Date | null }[]>`
      select field_key, label_es, label_en, has_value, can_view, can_edit, updated_at from app.sensitive_list(${accountId})`
    const contacts = await tx<{ id: string; full_name: string; phone: string | null; email: string | null }[]>`
      select c.id, c.full_name, c.phone, c.email::text from crm.contacts c join crm.account_contacts ac on ac.contact_id = c.id and ac.valid_to is null where ac.account_id = ${accountId} order by c.full_name`
    const ids = contacts.map((c) => c.id)
    const consents = ids.length === 0 ? [] : await tx<{ id: string; contact_id: string; channel: string; category: string; source: string; evidence: string | null; granted_at: Date; revoked_at: Date | null }[]>`
      select id, contact_id, channel, category, source, evidence, granted_at, revoked_at from crm.consents where contact_id = any(${ids}::uuid[]) order by granted_at desc`
    const addresses = [...new Set(contacts.flatMap((c) => [c.phone, c.email?.toLowerCase()]).concat([acc[0].phone, acc[0].email?.toLowerCase()]).filter((x): x is string => Boolean(x)))]
    const optouts = addresses.length === 0 ? [] : await tx<{ id: string; channel: string; address_norm: string; created_at: Date }[]>`
      select id, channel, address_norm, created_at from crm.contact_suppressions where lifted_at is null and address_norm = any(${addresses}::text[])`
    return { account: acc[0], team: [...team], candidates: [...candidates], sensitive: [...sensitive], contacts: [...contacts], consents: [...consents], optouts: [...optouts] }
  })
}
