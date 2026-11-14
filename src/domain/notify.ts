import 'server-only'
import type { Tx } from '@/server/db'
import { channelAdapter } from '@/server/adapters/channels'
import { pushNotice } from '@/domain/conectores/push'
import { NOTICE_KINDS, OUTSIDE, isPendingText, renderTemplate, wants, type Channel, type KindDef, type NoticeKind, type Prefs, type TemplateVars } from '@/lib/notice-kinds'

/**
 * AUT-05: el servicio único de avisos. Todo aviso a una persona pasa por `notify`; todo mensaje a alguien de afuera
 * (un lead, el buzón de pedidos) pasa por `notifyOutside`. Ningún módulo escribe avisos por su lado.
 *
 * Dentro de CONTIGO el aviso sale siempre al momento (campana, centro de avisos y Hoy si pide acción).
 * Hacia afuera (correo, Slack, WhatsApp) decide por la preferencia de la persona y el tipo de aviso, espera al horario
 * hábil del mercado, junta en un resumen cuando son muchos y deja cada intento en `crm.notifications` con su estado y costo.
 * Los tres canales de afuera están apagados: el mensaje queda en la cola como "Listo para enviar. Canal apagado".
 */
type Pair = [es: string, en: string]
type Actor = { user: { id: string } }

export type NotifyInput = {
  to: string
  kind: NoticeKind
  market: string | null
  title: Pair
  body: Pair
  /** A dónde lleva dentro de CONTIGO. */
  link?: string | null
  accountId?: string | null
  dealId?: string | null
  leadId?: string | null
  activityId?: string | null
  announcementId?: string | null
  /** Sale en Hoy hasta que la persona lo marca como visto. Por defecto, lo que diga el tipo. */
  needsAction?: boolean
  /** Plantilla para los canales de afuera. Sin plantilla propia se usa la general. */
  template?: string
  vars?: TemplateVars
}

type Target = { id: string; full_name: string; email: string; locale: string; prefs: Prefs; daily_digest: boolean }
type Template = { key: string; version: number; is_active: boolean; needs_consent: boolean; subject_es: string; body_es: string; subject_en: string; body_en: string }
type Status = 'delivered' | 'queued_off' | 'simulated' | 'sent' | 'failed' | 'held_hours' | 'held_digest' | 'held_limit' | 'skipped_consent' | 'skipped_no_address' | 'blocked_template'

/** Cuántos mensajes a la misma persona por el mismo canal en una hora antes de juntarlos en un resumen. */
export const BURST_LIMIT = 5

/** La plantilla vigente: primero la del mercado, luego la general. */
export async function currentTemplate(tx: Tx, key: string, market: string | null): Promise<Template | null> {
  const rows = await tx<Template[]>`
    select key, version, is_active, needs_consent, subject_es, body_es, subject_en, body_en from crm.message_templates
     where key = ${key} and is_current and (market_code is null or market_code = ${market})
     order by market_code nulls last limit 1`
  return rows[0] ?? null
}

async function unitCost(tx: Tx, market: string | null, channel: Channel): Promise<{ cost: string | null; currency: string | null; limit: number | null }> {
  if (!market || channel === 'in_app' || channel === 'slack') return { cost: null, currency: null, limit: null }
  if (channel === 'whatsapp') {
    // Un solo modelo de WhatsApp por mercado (0026_markets): el costo vigente de la categoría "utility" (los avisos lo son) y el
    // límite diario de la cuenta activa del mercado. Se cargan en Administración, Mercados.
    const rows = await tx<{ cost: string | null; currency: string | null; daily_limit: number | null }[]>`
      select (select r.cost::text from crm.whatsapp_rates r where r.market_code = ${market} and r.category = 'utility' and r.effective_from <= (now() at time zone coalesce((select k.timezone from crm.markets k where k.code = ${market}), 'UTC'))::date order by r.effective_from desc limit 1) as cost,
             (select trim(r.currency) from crm.whatsapp_rates r where r.market_code = ${market} and r.category = 'utility' and r.effective_from <= (now() at time zone coalesce((select k.timezone from crm.markets k where k.code = ${market}), 'UTC'))::date order by r.effective_from desc limit 1) as currency,
             (select min(a.daily_limit) from crm.whatsapp_accounts a where a.market_code = ${market} and a.is_active) as daily_limit`
    const r = rows[0]
    return { cost: r?.cost ?? null, currency: r?.currency ?? null, limit: r?.daily_limit ?? null }
  }
  const rows = await tx<{ email_unit_cost: string | null; currency: string }[]>`
    select c.email_unit_cost::text, trim(m.currency) as currency
      from crm.markets m left join crm.market_comms c on c.market_code = m.code where m.code = ${market}`
  const r = rows[0]
  if (!r) return { cost: null, currency: null, limit: null }
  return { cost: r.email_unit_cost, currency: r.currency, limit: null }
}

/** Decide qué pasa con un mensaje de afuera en este momento y lo entrega al canal si toca. */
async function place(
  tx: Tx,
  p: { market: string | null; channel: Exclude<Channel, 'in_app'>; address: string | null; subject: string; body: string; userId: string | null; digest: boolean; urgent: boolean; force?: boolean },
): Promise<{ status: Status; releaseAt: Date | null; cost: string | null; currency: string | null; sentAt: boolean }> {
  const none = { releaseAt: null, cost: null, currency: null, sentAt: false }
  if (!p.address) return { status: 'skipped_no_address', ...none }
  if (!p.force) {
    if (p.digest && !p.urgent) return { status: 'held_digest', ...none }
    const open = await tx<{ open: boolean; next: Date | null }[]>`
      select app.market_open(${p.market}, now()) as open, case when ${p.market}::text is null then null else app.business_due(${p.market}, now(), 0) end as next`
    if (open[0] && !open[0].open) return { status: 'held_hours', ...none, releaseAt: open[0].next }
    if (p.userId) {
      const recent = await tx<{ n: number }[]>`
        select count(*)::int as n from crm.notifications
         where recipient_user_id = ${p.userId} and channel = ${p.channel} and created_at > now() - interval '60 minutes' and status in ('queued_off', 'simulated', 'sent')`
      if ((recent[0]?.n ?? 0) >= BURST_LIMIT && !p.urgent) return { status: 'held_digest', ...none }
    }
  }
  const price = await unitCost(tx, p.market, p.channel)
  if (price.limit !== null) {
    const today = await tx<{ n: number }[]>`
      select count(*)::int as n from crm.notifications
       where market_code = ${p.market} and channel = 'whatsapp' and status in ('queued_off', 'simulated', 'sent')
         and created_at >= date_trunc('day', now() at time zone coalesce((select timezone from crm.markets where code = ${p.market}), 'UTC')) at time zone coalesce((select timezone from crm.markets where code = ${p.market}), 'UTC')`
    if ((today[0]?.n ?? 0) >= price.limit) return { status: 'held_limit', ...none }
  }
  const sent = await channelAdapter(p.channel).send({ to: p.address, subject: p.subject, body: p.body })
  // El costo se anota cuando el mensaje sale de verdad (o en la simulación de pruebas). En la cola apagada no se ha gastado nada.
  // Con el conector encendido (live) el mensaje sale de verdad: "sent" con su costo, o "failed" si el proveedor lo rechazó.
  if (sent.status === 'simulated' || sent.status === 'sent')
    return { status: sent.status, releaseAt: null, cost: price.cost, currency: price.cost ? price.currency : null, sentAt: true }
  if (sent.status === 'failed' || sent.status === 'blocked_template') return { status: sent.status, ...none }
  return { status: 'queued_off', ...none }
}

export type NotifyResult = { noticeId: string | null; channels: Partial<Record<Channel, Status>> }

/** Avisa a una persona de CONTIGO. Corre dentro de la transacción del cambio que origina el aviso. */
export async function notify(tx: Tx, actor: Actor, n: NotifyInput): Promise<NotifyResult> {
  const out: NotifyResult = { noticeId: null, channels: {} }
  const targets = await tx<Target[]>`select id, full_name, email, locale, prefs, daily_digest from app.notify_target(${n.to})`
  const who = targets[0]
  if (!who) return out
  const def: KindDef = NOTICE_KINDS[n.kind]
  const en = who.locale === 'en'
  const title = (en ? n.title[1] : n.title[0]).slice(0, 160)
  const body = (en ? n.body[1] : n.body[0]).slice(0, 600)

  if (wants(who.prefs, n.kind, 'in_app')) {
    const rows = await tx<{ id: string }[]>`
      insert into crm.notices (market_code, user_id, from_user_id, kind, title, body, link, needs_action, account_id, deal_id, lead_id, activity_id, announcement_id)
      values (${n.market}, ${who.id}, ${actor.user.id}, ${n.kind}, ${title}, ${body}, ${n.link ?? null}, ${n.needsAction ?? def.action},
              ${n.accountId ?? null}, ${n.dealId ?? null}, ${n.leadId ?? null}, ${n.activityId ?? null}, ${n.announcementId ?? null})
      returning id`
    out.noticeId = rows[0]!.id
    await tx`insert into crm.notifications (market_code, notice_id, kind, channel, recipient_kind, recipient_user_id, lead_id, account_id, deal_id, subject, body, status, cost, sent_at, created_by)
             values (${n.market}, ${out.noticeId}, ${n.kind}, 'in_app', 'person', ${who.id}, ${n.leadId ?? null}, ${n.accountId ?? null}, ${n.dealId ?? null}, ${title}, ${body}, 'delivered', 0, now(), ${actor.user.id})`
    out.channels.in_app = 'delivered'
    // AUT-05: con el push web encendido, el mismo aviso llega a los navegadores donde la persona lo activó.
    await pushNotice(tx, who.id, { title, body, link: n.link ?? null })
  }

  const channels = OUTSIDE.filter((c) => wants(who.prefs, n.kind, c))
  if (channels.length === 0) return out
  const tpl = (n.template ? await currentTemplate(tx, n.template, n.market) : null) ?? (await currentTemplate(tx, 'notice', n.market))
  if (!tpl || !tpl.is_active) return out
  const vars: TemplateVars = { titulo: title, texto: body, enlace: n.link ?? '', ...n.vars }
  const subject = renderTemplate(en ? tpl.subject_en : tpl.subject_es, vars).slice(0, 300) || title
  const text = renderTemplate(en ? tpl.body_en : tpl.body_es, vars).slice(0, 6000) || body
  for (const channel of channels) {
    // De cada persona CONTIGO solo conoce su correo: sirve para correo y para encontrarla en Slack. No guarda su teléfono.
    const address = channel === 'whatsapp' ? null : who.email
    const r = isPendingText(text) || isPendingText(subject)
      ? { status: 'blocked_template' as Status, releaseAt: null, cost: null, currency: null, sentAt: false }
      : await place(tx, { market: n.market, channel, address, subject, body: text, userId: who.id, digest: who.daily_digest, urgent: def.urgent })
    await tx`insert into crm.notifications (market_code, notice_id, kind, channel, template_key, template_version, recipient_kind, recipient_user_id, recipient_address,
                                            lead_id, account_id, deal_id, subject, body, status, cost, cost_currency, release_at, sent_at, created_by)
             values (${n.market}, ${out.noticeId}, ${n.kind}, ${channel}, ${tpl.key}, ${tpl.version}, 'person', ${who.id}, ${address},
                     ${n.leadId ?? null}, ${n.accountId ?? null}, ${n.dealId ?? null}, ${subject}, ${text}, ${r.status}, ${r.cost}, ${r.currency}, ${r.releaseAt}, ${r.sentAt ? tx`now()` : null}, ${actor.user.id})`
    out.channels[channel] = r.status
  }
  return out
}

/** Avisa a varias personas a la vez (Operaciones de un mercado, la audiencia de un anuncio). Nunca a quien origina el aviso. */
export async function notifyMany(tx: Tx, actor: Actor, userIds: string[], n: Omit<NotifyInput, 'to'>): Promise<number> {
  let sent = 0
  for (const to of [...new Set(userIds)]) {
    if (to === actor.user.id) continue
    const r = await notify(tx, actor, { ...n, to })
    if (r.noticeId || Object.keys(r.channels).length) sent++
  }
  return sent
}

/**
 * Personas con alguno de esos roles en el mercado (la única función: la usan avisos y automatizaciones). Con 'supervisor'
 * y una persona de referencia, primero quienes supervisan su equipo.
 */
export async function peopleWithRole(tx: Tx, market: string | null, roles: string[], forUserId: string | null = null): Promise<string[]> {
  const rows = await tx<{ user_id: string }[]>`select user_id from app.people_with_role(${market}, ${roles}::text[], ${forUserId}::uuid)`
  return rows.map((r) => r.user_id)
}

export type OutsideInput = {
  kind: NoticeKind
  template: string
  market: string
  recipient: 'lead' | 'mailbox'
  address: string | null
  locale: 'es' | 'en'
  vars: TemplateVars
  /** Solo para leads: si aceptó recibir correos. */
  consent?: boolean
  leadId?: string | null
  accountId?: string | null
  dealId?: string | null
}

/**
 * Un mensaje para alguien que no usa CONTIGO (un lead, el buzón de pedidos). Solo existe el canal de correo.
 * Con el canal apagado queda en la cola "listo para enviar" y no sale nada. Respeta el consentimiento del lead.
 */
export async function notifyOutside(tx: Tx, actor: Actor, m: OutsideInput): Promise<Status | null> {
  const tpl = await currentTemplate(tx, m.template, m.market)
  if (!tpl || !tpl.is_active) return null
  const subject = renderTemplate(m.locale === 'en' ? tpl.subject_en : tpl.subject_es, m.vars).slice(0, 300)
  const body = renderTemplate(m.locale === 'en' ? tpl.body_en : tpl.body_es, m.vars).slice(0, 6000)
  let r: Awaited<ReturnType<typeof place>>
  const none = { releaseAt: null, cost: null, currency: null, sentAt: false }
  if (isPendingText(subject) || isPendingText(body)) r = { status: 'blocked_template', ...none }
  else if (m.recipient === 'lead' && tpl.needs_consent && !m.consent) r = { status: 'skipped_consent', ...none }
  // SEG-04: una baja manda siempre. Si esa dirección pidió no recibir correos, el mensaje queda registrado y no sale.
  else if (m.recipient === 'lead' && (await optedOut(tx, m.address))) r = { status: 'skipped_consent', ...none }
  else r = await place(tx, { market: m.market, channel: 'email', address: m.address, subject, body, userId: null, digest: false, urgent: false })
  await tx`insert into crm.notifications (market_code, kind, channel, template_key, template_version, recipient_kind, recipient_address, lead_id, account_id, deal_id,
                                          subject, body, status, cost, cost_currency, release_at, sent_at, created_by)
           values (${m.market}, ${m.kind}, 'email', ${tpl.key}, ${tpl.version}, ${m.recipient}, ${m.address}, ${m.leadId ?? null}, ${m.accountId ?? null}, ${m.dealId ?? null},
                   ${subject || '(sin asunto)'}, ${body || '(sin texto)'}, ${r.status}, ${r.cost}, ${r.currency}, ${r.releaseAt}, ${r.sentAt ? tx`now()` : null}, ${actor.user.id})`
  return r.status
}

/** SEG-04: ¿esa dirección de alguien de fuera pidió la baja? Pregunta a la base (app.may_contact), la misma regla para todo envío. */
async function optedOut(tx: Tx, address: string | null): Promise<boolean> {
  if (!address) return false
  const rows = await tx<{ why: string }[]>`select why from app.may_contact('email', ${address.trim().toLowerCase()}, 'service')`
  return rows[0]?.why === 'opted_out'
}

/** Lo que estaba esperando al horario hábil y ya puede salir. Lo llama la tarea programada. */
export async function releaseHeld(tx: Tx): Promise<number> {
  const rows = await tx<{ id: string; market_code: string | null; channel: Exclude<Channel, 'in_app'>; recipient_address: string | null; subject: string; body: string; recipient_user_id: string | null }[]>`
    select id, market_code, channel, recipient_address, subject, body, recipient_user_id from crm.notifications
     where status = 'held_hours' and (release_at is null or release_at <= now()) order by created_at limit 200 for update skip locked`
  let done = 0
  for (const r of rows) {
    const open = await tx<{ open: boolean }[]>`select app.market_open(${r.market_code}, now()) as open`
    if (!open[0]?.open) continue
    // La baja pudo llegar mientras el mensaje esperaba: a alguien de fuera no le sale.
    if (!r.recipient_user_id && (await optedOut(tx, r.recipient_address))) {
      await tx`update crm.notifications set status = 'skipped_consent', release_at = null where id = ${r.id}`
      continue
    }
    const p = await place(tx, { market: r.market_code, channel: r.channel, address: r.recipient_address, subject: r.subject, body: r.body, userId: r.recipient_user_id, digest: false, urgent: true, force: true })
    await tx`update crm.notifications set status = ${p.status}, cost = ${p.cost}, cost_currency = ${p.currency}, release_at = null, sent_at = ${p.sentAt ? tx`now()` : null} where id = ${r.id}`
    done++
  }
  return done
}

/** El resumen: un solo mensaje por persona y canal con lo que quedó en espera. Lo llama la tarea programada diaria. */
export async function sendDigests(tx: Tx, actorId: string): Promise<number> {
  const groups = await tx<{ user_id: string; channel: Exclude<Channel, 'in_app'>; market_code: string | null; ids: string[]; subjects: string[] }[]>`
    select recipient_user_id as user_id, channel, min(market_code) as market_code, array_agg(id order by created_at) as ids, array_agg(subject order by created_at) as subjects
      from crm.notifications where status in ('held_digest', 'held_limit') and recipient_user_id is not null
     group by recipient_user_id, channel`
  let done = 0
  for (const g of groups) {
    const targets = await tx<Target[]>`select id, full_name, email, locale, prefs, daily_digest from app.notify_target(${g.user_id})`
    const who = targets[0]
    if (!who) continue
    const tpl = await currentTemplate(tx, 'digest', g.market_code)
    if (!tpl || !tpl.is_active) continue
    const en = who.locale === 'en'
    const count = g.ids.length
    const vars: TemplateVars = {
      titulo: en ? `${count} ${count === 1 ? 'notice' : 'notices'}` : `${count} ${count === 1 ? 'aviso' : 'avisos'}`,
      texto: g.subjects.slice(0, 40).map((s) => `· ${s}`).join('\n'),
      enlace: '/avisos',
    }
    const subject = renderTemplate(en ? tpl.subject_en : tpl.subject_es, vars).slice(0, 300)
    const body = renderTemplate(en ? tpl.body_en : tpl.body_es, vars).slice(0, 6000)
    const p = await place(tx, { market: g.market_code, channel: g.channel, address: g.channel === 'whatsapp' ? null : who.email, subject, body, userId: who.id, digest: false, urgent: true, force: true })
    await tx`insert into crm.notifications (market_code, kind, channel, template_key, template_version, recipient_kind, recipient_user_id, recipient_address, subject, body, status, cost, cost_currency, sent_at, created_by)
             values (${g.market_code}, 'digest', ${g.channel}, ${tpl.key}, ${tpl.version}, 'person', ${who.id}, ${g.channel === 'whatsapp' ? null : who.email}, ${subject}, ${body}, ${p.status}, ${p.cost}, ${p.currency}, ${p.sentAt ? tx`now()` : null}, ${actorId})`
    await tx`update crm.notifications set status = 'digested' where id = any(${g.ids}::uuid[])`
    done++
  }
  return done
}
