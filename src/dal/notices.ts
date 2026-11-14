import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { Prefs } from '@/lib/notice-kinds'

export type CenterRow = {
  id: string; kind: string; title: string | null; body: string; link: string | null; from_name: string
  account_id: string | null; deal_id: string | null; lead_id: string | null; announcement_id: string | null
  record: string | null; seen_at: Date | null; created_at: Date
}

/** Cuántos avisos sin leer tiene la persona: el número de la campana. */
export async function unreadNotices(ctx: Ctx): Promise<number> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ n: number }[]>`select count(*)::int as n from crm.notices n where n.user_id = ${ctx.user.id} and n.seen_at is null
         and (n.announcement_id is null or exists (select 1 from crm.announcements a where a.id = n.announcement_id and a.status = 'published' and a.ends_at > now()))`
    return rows[0]?.n ?? 0
  })
}

/** El centro de avisos: los últimos de la persona, leídos y sin leer. */
export async function myCenter(ctx: Ctx, only: 'all' | 'unread'): Promise<CenterRow[]> {
  return withUser(ctx.user.id, (tx) => tx<CenterRow[]>`
    select n.id, n.kind, n.title, n.body, n.link, u.full_name as from_name, n.account_id, n.deal_id, n.lead_id, n.announcement_id,
           coalesce(d.title, a.name) as record, n.seen_at, n.created_at
      from crm.notices n join crm.users u on u.id = n.from_user_id left join crm.deals d on d.id = n.deal_id left join crm.accounts a on a.id = n.account_id
     where n.user_id = ${ctx.user.id} ${only === 'unread' ? tx`and n.seen_at is null` : tx``}
     order by n.created_at desc limit 100`)
}

export async function myPrefs(ctx: Ctx): Promise<{ prefs: Prefs; dailyDigest: boolean }> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ prefs: Prefs; daily_digest: boolean }[]>`select prefs, daily_digest from crm.notification_prefs where user_id = ${ctx.user.id}`
    return { prefs: rows[0]?.prefs ?? {}, dailyDigest: rows[0]?.daily_digest ?? false }
  })
}

export type TemplateRow = {
  id: string; key: string; market_code: string | null; version: number; is_active: boolean; recipient: string; trigger_event: string; needs_consent: boolean
  subject_es: string; body_es: string; subject_en: string; body_en: string; created_at: Date; by_name: string | null; versions: number
}
export async function templates(ctx: Ctx): Promise<TemplateRow[]> {
  ctx.assert('config.manage')
  return withUser(ctx.user.id, (tx) => tx<TemplateRow[]>`
    select t.id, t.key, t.market_code, t.version, t.is_active, t.recipient, t.trigger_event, t.needs_consent, t.subject_es, t.body_es, t.subject_en, t.body_en, t.created_at,
           u.full_name as by_name, (select count(*)::int from crm.message_templates x where x.key = t.key and coalesce(x.market_code, '') = coalesce(t.market_code, '')) as versions
      from crm.message_templates t left join crm.users u on u.id = t.created_by
     where t.is_current order by t.key, t.market_code nulls first`)
}

export type QueueRow = {
  id: string; market_code: string | null; kind: string; channel: string; template_key: string | null; template_version: number | null
  recipient_kind: string; recipient_name: string | null; recipient_address: string | null; subject: string; body: string; status: string
  cost: string | null; cost_currency: string | null; release_at: Date | null; created_at: Date
}
/** La cola de lo que saldría por correo, Slack o WhatsApp, con su estado. Solo administración. */
export async function outsideQueue(ctx: Ctx, channel: string | null): Promise<{ rows: QueueRow[]; counts: { channel: string; status: string; n: number; cost: string | null }[] }> {
  ctx.assert('config.manage')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<QueueRow[]>`
      select n.id, n.market_code, n.kind, n.channel, n.template_key, n.template_version, n.recipient_kind, u.full_name as recipient_name, n.recipient_address,
             n.subject, n.body, n.status, n.cost::text, n.cost_currency, n.release_at, n.created_at
        from crm.notifications n left join crm.users u on u.id = n.recipient_user_id
       where n.channel <> 'in_app' ${channel ? tx`and n.channel = ${channel}` : tx``}
       order by n.created_at desc limit 100`
    const counts = await tx<{ channel: string; status: string; n: number; cost: string | null }[]>`
      select channel, status, count(*)::int as n, sum(cost)::text as cost from crm.notifications group by channel, status order by channel, status`
    return { rows: [...rows], counts: [...counts] }
  })
}

export type Comms = {
  market_code: string; order_header: string | null; orders_mailbox: string | null; sender_address: string | null; walkthrough_url: string | null; support_whatsapp: string | null
  email_unit_cost: string | null
  support_hours_high: number | null; support_hours_normal: number | null; support_hours_low: number | null
}
export async function marketComms(ctx: Ctx): Promise<Comms[]> {
  return withUser(ctx.user.id, (tx) => tx<Comms[]>`
    select m.code as market_code, c.order_header, c.orders_mailbox, c.sender_address, c.walkthrough_url, c.support_whatsapp,
           c.email_unit_cost::text, c.support_hours_high, c.support_hours_normal, c.support_hours_low
      from crm.markets m left join crm.market_comms c on c.market_code = m.code where m.code = any(app.my_markets()) order by m.status, m.code`)
}

export async function helpLessons(ctx: Ctx): Promise<Record<string, string>> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ screen: string; url: string }[]>`select screen, url from crm.help_lessons`
    return Object.fromEntries(rows.map((r) => [r.screen, r.url]))
  })
}
