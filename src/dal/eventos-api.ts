import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { forbidden } from '@/lib/errors'

// Lecturas de Administración > Integraciones (paquete eventos-api). Todas corren con la identidad de quien mira: RLS decide.
export type SubscriberRow = { id: string; name: string; destination: string; event_types: string[]; market_code: string | null; status: string; secret_version: number; created_at: Date; ready: number; retrying: number; delivered: number; dead: number }
export type DeliveryRow = { id: string; subscriber: string; event_type: string; event_id: string; status: string; attempts: number; next_attempt_at: Date; last_error: string | null; updated_at: Date }

export async function getEventsAdmin(ctx: Ctx) {
  if (!ctx.can('integration.operate')) throw forbidden()
  return withUser(ctx.user.id, async (tx) => {
    const subscribers = await tx<SubscriberRow[]>`
      select s.id, s.name, s.destination, s.event_types, s.market_code, s.status, s.secret_version, s.created_at,
             count(d.id) filter (where d.status = 'ready')::int as ready, count(d.id) filter (where d.status = 'retrying')::int as retrying,
             count(d.id) filter (where d.status = 'delivered')::int as delivered, count(d.id) filter (where d.status = 'dead')::int as dead
        from crm.event_subscribers s left join crm.event_deliveries d on d.subscriber_id = s.id
       where s.status <> 'removed' group by s.id order by s.created_at`
    const attention = await tx<DeliveryRow[]>`
      select d.id, s.name as subscriber, e.event_type, e.id as event_id, d.status, d.attempts, d.next_attempt_at, d.last_error, d.updated_at
        from crm.event_deliveries d join crm.event_subscribers s on s.id = d.subscriber_id join crm.outbox_events e on e.id = d.event_id
       where d.status in ('dead','retrying') and s.status <> 'removed' order by (d.status = 'dead') desc, d.updated_at desc limit 40`
    const totals = await tx<{ events: number; last_at: Date | null; types: number }[]>`select count(*)::int as events, max(created_at) as last_at, count(distinct event_type)::int as types from crm.outbox_events`
    const recent = await tx<{ id: string; event_type: string; version: number; aggregate: string; market_code: string | null; created_at: Date }[]>`
      select id, event_type, version, aggregate, market_code, created_at from crm.outbox_events order by created_at desc limit 12`
    return { subscribers: [...subscribers], attention: [...attention], totals: totals[0]!, recent: [...recent] }
  })
}

export type KeyRow = { id: string; name: string; key_prefix: string; scopes: string[]; market_code: string | null; mode: string; rate_per_minute: number; last_used_at: Date | null; retire_at: Date | null; rotated_from: string | null; created_at: Date; created_by: string | null; revoked_at: Date | null; retired: boolean }

export async function getApiAdmin(ctx: Ctx) {
  if (!ctx.can('integration.operate')) throw forbidden()
  return withUser(ctx.user.id, async (tx) => {
    const keys = await tx<KeyRow[]>`
      select c.id, c.name, c.key_prefix, c.scopes, c.market_code, c.mode, c.rate_per_minute, c.last_used_at, c.retire_at, c.rotated_from, c.created_at,
             u.full_name as created_by, c.revoked_at, (c.retire_at is not null and c.retire_at <= now()) as retired
        from crm.api_clients c left join crm.users u on u.id = c.created_by order by (c.revoked_at is null) desc, c.created_at desc limit 100`
    return { keys: [...keys] }
  })
}

export type InboundRow = { id: string; event_type: string; status: string; error: string | null; attempts: number; received_at: Date; replayed_at: Date | null; market_code: string | null }

export async function getSalesAppAdmin(ctx: Ctx) {
  if (!ctx.can('integration.operate')) throw forbidden()
  return withUser(ctx.user.id, async (tx) => {
    const stuck = await tx<InboundRow[]>`
      select id, event_type, status, error, attempts, received_at, replayed_at, market_code from crm.inbound_events
       where source = 'sales_app' and status in ('dead','rejected') order by received_at desc limit 40`
    const counts = await tx<{ status: string; n: number }[]>`select status, count(*)::int as n from crm.inbound_events where source = 'sales_app' group by status`
    const linkable = await tx<{ name: string; alias: string; market_code: string }[]>`
      select a.name, al.external_id as alias, a.market_code from crm.account_aliases al join crm.accounts a on a.id = al.account_id
       where al.system = 'sales_core' and al.valid_to is null and a.archived_at is null and a.merchant_ref is null order by al.valid_from desc limit 8`
    return { stuck: [...stuck], counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>, linkable: [...linkable] }
  })
}

export async function getFormsAdmin(ctx: Ctx) {
  if (!ctx.can('integration.operate')) throw forbidden()
  return withUser(ctx.user.id, async (tx) => {
    const forms = await tx<{ id: string; slug: string; name: string; market_code: string; is_active: boolean; min_fill_seconds: number | null; rate_per_minute: number | null }[]>`
      select id, slug, name, market_code, is_active, min_fill_seconds, rate_per_minute from crm.web_forms order by market_code, name`
    const rejected = await tx<{ slug: string; reason: string; n: number }[]>`
      select slug, reason, sum(n)::int as n from crm.intake_rejections where day > (now() at time zone 'UTC')::date - 7 group by slug, reason order by slug, reason`
    return { forms: [...forms], rejected: [...rejected] }
  })
}

export type ImportRow = { id: string; market_code: string; kind: string; file_name: string; rows_total: number; rows_created: number; rows_duplicate: number; rows_rejected: number; status: string; created_at: Date; created_by: string; undone_at: Date | null }

export async function getImports(ctx: Ctx): Promise<ImportRow[]> {
  return withUser(ctx.user.id, async (tx) => [...await tx<ImportRow[]>`
    select i.id, i.market_code, i.kind, i.file_name, i.rows_total, i.rows_created, i.rows_duplicate, i.rows_rejected, i.status, i.created_at, u.full_name as created_by, i.undone_at
      from crm.csv_imports i join crm.users u on u.id = i.created_by order by i.created_at desc limit 30`])
}

export type ExportRow = { id: string; who: string; what: string; reason: string; rows: number; row_cap: number; truncated: boolean; alert: boolean; market_code: string | null; created_at: Date }

/** Exportaciones recientes: administración y leadership ven todas; cada quien, las suyas. */
export async function getExports(ctx: Ctx): Promise<{ rows: ExportRow[]; alerts: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<ExportRow[]>`
      select e.id, u.full_name as who, e.what, e.reason, e.rows, e.row_cap, e.truncated, e.alert, e.market_code, e.created_at
        from crm.export_log e join crm.users u on u.id = e.user_id order by e.created_at desc limit 40`
    const alerts = await tx<{ n: number }[]>`select count(*)::int as n from crm.export_log where alert and created_at > now() - interval '7 days'`
    return { rows: [...rows], alerts: alerts[0]?.n ?? 0 }
  })
}
