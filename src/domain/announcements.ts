import 'server-only'
import { z } from 'zod'
import { marketToday, withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { notifyMany } from '@/domain/notify'
import { forbidden, invalid, notFound } from '@/lib/errors'
import { isUuid } from '@/lib/ids'

/**
 * GOB-06: anuncios a la red con acuse. Administración o quien lidera publica un anuncio para una audiencia (mercado, equipo, rol)
 * con vigencia; cada persona lo ve al entrar y lo marca leído o "enterado"; quien publica ve quién falta.
 * Cambiar un anuncio publicado crea una versión nueva y el acuse vuelve a empezar. Un cambio de comisiones o de alta siempre
 * exige acuse y se anuncia antes de que entre en vigor. Las novedades de versión de CONTIGO son anuncios de tema "release".
 */
export const TOPICS = ['general', 'commission', 'onboarding', 'outage', 'release'] as const
export type Topic = (typeof TOPICS)[number]
export const TOPIC_LABEL: Record<Topic, [es: string, en: string]> = {
  general: ['Aviso general', 'General notice'],
  commission: ['Cambio de comisiones', 'Commission change'],
  onboarding: ['Cambio en el alta', 'Sign-up change'],
  outage: ['Caída o mantenimiento', 'Outage or maintenance'],
  release: ['Novedades de CONTIGO', 'What is new in CONTIGO'],
}
/** Temas que tocan el ingreso de la red: siempre con acuse y con fecha de entrada en vigor posterior al anuncio. */
export const ACK_TOPICS: readonly Topic[] = ['commission', 'onboarding']
export const MAX_DAYS = 120

const input = z.object({
  seriesId: z.guid().or(z.literal('')).optional().default(''),
  topic: z.enum(TOPICS),
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(5).max(3000),
  titleOther: z.string().trim().max(140).optional().default(''),
  bodyOther: z.string().trim().max(3000).optional().default(''),
  market: z.string().length(2).or(z.literal('')),
  teamId: z.guid().or(z.literal('')).optional().default(''),
  role: z.enum(['admin', 'lt', 'market_lead', 'supervisor', 'rep', 'ops']).or(z.literal('')).optional().default(''),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional().default(''),
  requiresAck: z.boolean(),
})

export async function publishAnnouncement(ctx: Ctx, raw: z.input<typeof input>): Promise<{ id: string; audience: number; version: number }> {
  ctx.assert('announcement.publish')
  const parsed = input.safeParse(raw)
  if (!parsed.success) throw invalid('Escribe el título, el texto y hasta cuándo vale el anuncio.', 'Write the title, the text and until when the announcement applies.')
  const v = parsed.data
  assertNoProhibited(v.title, v.body, v.titleOther, v.bodyOther)
  if (Boolean(v.titleOther) !== Boolean(v.bodyOther)) throw invalid('Si lo escribes en el otro idioma, pon título y texto.', 'If you write it in the other language, add both title and text.')
  const market = v.market || null
  // Quién puede anunciar a quién: administración, a cualquiera; quien lidera un mercado, a su mercado; supervisión, a su equipo.
  if (!ctx.isAdmin) {
    if (v.topic === 'release') throw forbidden()
    if (!market || !ctx.can('announcement.publish', market)) throw invalid('Elige uno de tus mercados para el anuncio.', 'Pick one of your markets for the announcement.')
    const leads = ctx.memberships.some((m) => m.role === 'market_lead' && m.market === market)
    if (!leads) {
      const mine = ctx.memberships.filter((m) => m.role === 'supervisor' && m.market === market && m.teamId).map((m) => m.teamId)
      if (!v.teamId || !mine.includes(v.teamId)) throw invalid('Como supervisión, el anuncio va a tu equipo.', 'As a supervisor, the announcement goes to your team.')
    }
  }
  const mustAck = ACK_TOPICS.includes(v.topic)
  const requiresAck = mustAck || v.requiresAck
  return withUser(ctx.user.id, async (tx) => {
    const zone = market ?? ctx.markets[0]?.code ?? null
    const dates = await tx<{ today: string; ends_ok: boolean; eff_ok: boolean | null }[]>`
      select d::text as today, ${v.endsOn}::date > d and ${v.endsOn}::date <= d + ${MAX_DAYS}::int as ends_ok,
             case when ${v.effectiveOn || null}::date is null then null else ${v.effectiveOn || null}::date > d end as eff_ok
        from (select ${zone ? marketToday(tx, zone) : tx`(now() at time zone 'UTC')::date`} as d) x`
    const dt = dates[0]!
    if (!dt.ends_ok) throw invalid(`La vigencia termina después de hoy y dura como máximo ${MAX_DAYS} días.`, `The announcement must end after today and last at most ${MAX_DAYS} days.`)
    if (mustAck && !v.effectiveOn) throw invalid('Un cambio de comisiones o de alta dice desde qué fecha vale.', 'A commission or sign-up change must say from which date it applies.')
    if (dt.eff_ok === false) throw invalid('El cambio se anuncia antes de que entre en vigor: elige una fecha posterior a hoy.', 'A change is announced before it takes effect: choose a date after today.')
    if (v.teamId) {
      const team = await tx`select 1 from crm.teams where id = ${v.teamId} and market_code = ${market}`
      if (!team[0]) throw invalid('Ese equipo no es de ese mercado.', 'That team is not in that market.')
    }
    let seriesId = v.seriesId
    let version = 1
    if (seriesId) {
      const prev = await tx<{ id: string; version: number; created_by: string }[]>`
        select id, version, created_by from crm.announcements where series_id = ${seriesId} order by version desc limit 1 for update`
      if (!prev[0]) throw notFound('No encontramos ese anuncio.', 'We could not find that announcement.')
      if (prev[0].created_by !== ctx.user.id && !ctx.isAdmin) throw forbidden()
      await tx`update crm.announcements set status = 'superseded' where series_id = ${seriesId} and status = 'published'`
      version = prev[0].version + 1
    } else seriesId = await newId(tx)
    const id = await newId(tx)
    await tx`insert into crm.announcements (id, series_id, version, topic, locale, title, body, title_other, body_other, market_code, team_id, role, ends_at, effective_on, requires_ack, created_by)
             values (${id}, ${seriesId}, ${version}, ${v.topic}, ${ctx.locale}, ${v.title}, ${v.body}, ${clean(v.titleOther)}, ${clean(v.bodyOther)}, ${market}, ${v.teamId || null}, ${v.role || null},
                     (${v.endsOn}::date + 1)::timestamp at time zone ${zone ? ctx.market(zone).timezone : 'UTC'}, ${v.effectiveOn || null}, ${requiresAck}, ${ctx.user.id})`
    const people = await tx<{ user_id: string }[]>`select user_id from app.announcement_audience(${id})`
    // Cada persona lo recibe en el idioma en que lee CONTIGO, si quien publica lo escribió en los dos.
    const es = ctx.locale === 'es' ? [v.title, v.body] : [v.titleOther || v.title, v.bodyOther || v.body]
    const en = ctx.locale === 'en' ? [v.title, v.body] : [v.titleOther || v.title, v.bodyOther || v.body]
    const audience = await notifyMany(tx, ctx, people.map((p) => p.user_id), {
      kind: 'announcement', market, link: '/anuncios', announcementId: id, needsAction: requiresAck,
      title: [es[0]!, en[0]!], body: [es[1]!.slice(0, 600), en[1]!.slice(0, 600)],
    })
    await audit(tx, ctx, version > 1 ? 'announcement.updated' : 'announcement.published', 'announcement', id, market, null,
      { topic: v.topic, version, team_id: v.teamId || null, role: v.role || null, requires_ack: requiresAck, effective_on: v.effectiveOn || null, ends_on: v.endsOn, audience: people.length })
    return { id, audience, version }
  })
}

export async function withdrawAnnouncement(ctx: Ctx, id: string): Promise<void> {
  ctx.assert('announcement.publish')
  if (!isUuid(id)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ created_by: string; market_code: string | null; status: string }[]>`select created_by, market_code, status from crm.announcements where id = ${id} for update`
    const a = rows[0]
    if (!a) throw notFound('No encontramos ese anuncio.', 'We could not find that announcement.')
    if (a.created_by !== ctx.user.id && !ctx.isAdmin) throw forbidden()
    if (a.status !== 'published') return
    await tx`update crm.announcements set status = 'withdrawn' where id = ${id}`
    await audit(tx, ctx, 'announcement.withdrawn', 'announcement', id, a.market_code, { status: 'published' }, { status: 'withdrawn' })
  })
}

/** La persona marca el anuncio como leído o, si lo exige, como "enterado". Lo hace cualquier persona de la audiencia. */
export async function markAnnouncement(ctx: Ctx, id: string, ack: boolean): Promise<void> {
  if (!isUuid(id)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string | null; requires_ack: boolean; mine: boolean }[]>`
      select market_code, requires_ack, app.in_audience(market_code, team_id, role) as mine from crm.announcements where id = ${id} and status = 'published'`
    const a = rows[0]
    if (!a || !a.mine) throw notFound('Ese anuncio ya no está vigente.', 'That announcement is no longer current.')
    const before = await tx<{ ack_at: Date | null }[]>`select ack_at from crm.announcement_receipts where announcement_id = ${id} and user_id = ${ctx.user.id}`
    const confirm = ack && a.requires_ack
    if (!before[0]) {
      await tx`insert into crm.announcement_receipts (announcement_id, user_id, ack_at) values (${id}, ${ctx.user.id}, ${confirm ? tx`now()` : null})`
      await audit(tx, ctx, confirm ? 'announcement.acknowledged' : 'announcement.read', 'announcement', id, a.market_code, null, null)
    } else if (confirm && !before[0].ack_at) {
      await tx`update crm.announcement_receipts set ack_at = now() where announcement_id = ${id} and user_id = ${ctx.user.id}`
      await audit(tx, ctx, 'announcement.acknowledged', 'announcement', id, a.market_code, null, null)
    }
    // El aviso de la campana se da por leído cuando ya no queda nada que hacer con el anuncio.
    if (confirm || !a.requires_ack) await tx`update crm.notices set seen_at = now() where user_id = ${ctx.user.id} and announcement_id = ${id} and seen_at is null`
  })
}
