import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isUuid } from '@/lib/ids'

export type Announcement = {
  id: string; series_id: string; version: number; topic: string; locale: string; title: string; body: string; title_other: string | null; body_other: string | null
  market_code: string | null; team_id: string | null; team_name: string | null; role: string | null; starts_at: Date; ends_at: Date; effective_on: string | null
  requires_ack: boolean; status: string; author: string; created_by: string; read_at: Date | null; ack_at: Date | null
}

type Q = Parameters<Parameters<typeof withUser>[1]>[0]
const SELECT = (tx: Q) => tx`
  a.id, a.series_id, a.version, a.topic, a.locale, a.title, a.body, a.title_other, a.body_other, a.market_code, a.team_id, tm.name as team_name, a.role, a.starts_at, a.ends_at,
  a.effective_on::text, a.requires_ack, a.status, u.full_name as author, a.created_by, r.read_at, r.ack_at`
const FROM = (tx: Q, me: string) => tx`
  from crm.announcements a join crm.users u on u.id = a.created_by left join crm.teams tm on tm.id = a.team_id
  left join crm.announcement_receipts r on r.announcement_id = a.id and r.user_id = ${me}`

/** Los anuncios vigentes para la persona (está en la audiencia y no los publicó ella), con su lectura y su acuse. */
export async function liveAnnouncements(ctx: Ctx): Promise<Announcement[]> {
  return withUser(ctx.user.id, (tx) => tx<Announcement[]>`
    select ${SELECT(tx)} ${FROM(tx, ctx.user.id)}
     where a.status = 'published' and a.starts_at <= now() and a.ends_at > now() and a.created_by <> ${ctx.user.id}
       and app.in_audience(a.market_code, a.team_id, a.role)
     order by (a.requires_ack and r.ack_at is null) desc, (r.read_at is null) desc, a.created_at desc limit 50`)
}

/** Lo que la persona todavía tiene pendiente: sin leer, o con acuse obligatorio sin dar. Es lo que ve al entrar. */
export async function pendingAnnouncements(ctx: Ctx): Promise<Announcement[]> {
  const all = await liveAnnouncements(ctx)
  return all.filter((a) => !a.read_at || (a.requires_ack && !a.ack_at))
}

export type Published = Announcement & { audience: number; read: number; acked: number }
/** Lo que publicó la persona (administración ve todo), con cuántos lo leyeron y cuántos dieron acuse. */
export async function publishedBy(ctx: Ctx): Promise<Published[]> {
  ctx.assert('announcement.publish')
  return withUser(ctx.user.id, (tx) => tx<Published[]>`
    select ${SELECT(tx)}, c.audience, c.read, c.acked ${FROM(tx, ctx.user.id)}
     cross join lateral (select count(*)::int as audience, count(x.read_at)::int as read, count(x.ack_at)::int as acked from app.announcement_audience(a.id) x) c
     where (a.created_by = ${ctx.user.id} or ${ctx.isAdmin}) and a.status <> 'superseded'
     order by a.created_at desc limit 50`)
}

export type AudienceRow = { user_id: string; full_name: string; read_at: Date | null; ack_at: Date | null }
/** Quién falta: la audiencia de un anuncio con su lectura y su acuse. Solo quien lo publicó y administración. */
export async function audienceOf(ctx: Ctx, id: string): Promise<AudienceRow[]> {
  ctx.assert('announcement.publish')
  if (!isUuid(id)) return []
  return withUser(ctx.user.id, (tx) => tx<AudienceRow[]>`select user_id, full_name, read_at, ack_at from app.announcement_audience(${id})`)
}

export async function teamsFor(ctx: Ctx): Promise<{ id: string; name: string; market_code: string }[]> {
  return withUser(ctx.user.id, (tx) => tx<{ id: string; name: string; market_code: string }[]>`select id, name, market_code from crm.teams where market_code = any(app.my_markets()) order by market_code, name`)
}
