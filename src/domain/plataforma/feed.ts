import 'server-only'
import type { Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { notify, peopleWithRole } from '@/domain/notify'
import { NOTICE_KINDS, type NoticeKind } from '@/lib/notice-kinds'
import { broadcast, type LiveSignal } from '@/server/adapters/realtime'
import { audit } from '@/domain/common'
import { takeEvents, type OutboxEvent } from './outbox'

/**
 * AUT-05: el servicio de avisos se alimenta de la cola de eventos. Una regla (crm.event_notice_rules, Administración, Avisos)
 * dice qué evento avisa a quién; esta pasada toma lo nuevo de la cola (consumidor `notices`) y llama a `notify`, que decide
 * canal (dentro de CONTIGO, correo, Slack, WhatsApp, push), horario hábil y resumen. Nunca avisa a quien hizo el cambio.
 */
type Rule = { id: string; event_type: string; notice_kind: string; audience: 'owner' | 'market_leads' | 'admins'; title_es: string; title_en: string; body_es: string; body_en: string }

const LINK: Record<string, (id: string) => string> = { deal: (id) => `/deals/${id}`, account: (id) => `/comercios/${id}`, lead: (id) => `/leads/${id}` }

async function ownerOf(tx: Tx, ev: OutboxEvent): Promise<string | null> {
  const table = ev.aggregate === 'deal' ? tx`crm.deals` : ev.aggregate === 'account' ? tx`crm.accounts` : ev.aggregate === 'lead' ? tx`crm.leads` : null
  if (!table) return null
  const rows = await tx<{ owner_id: string | null }[]>`select owner_id from ${table} where id = ${ev.aggregate_id}`
  return rows[0]?.owner_id ?? null
}

export async function noticesFromOutbox(tx: Tx, sys: Ctx, limit = 200): Promise<{ events: number; notices: number }> {
  const events = await takeEvents(tx, 'notices', limit)
  if (events.length === 0) return { events: 0, notices: 0 }
  const rules = await tx<Rule[]>`select id, event_type, notice_kind, audience, title_es, title_en, body_es, body_en from crm.event_notice_rules where is_active`
  let notices = 0
  for (const ev of events) {
    const actorId = typeof ev.payload?.actor_id === 'string' ? ev.payload.actor_id : null
    for (const r of rules) {
      if (r.event_type !== ev.event_type || !(r.notice_kind in NOTICE_KINDS)) continue
      const to =
        r.audience === 'owner' ? [await ownerOf(tx, ev)].filter((x): x is string => Boolean(x))
        : r.audience === 'market_leads' ? await peopleWithRole(tx, ev.market_code, ['market_lead'])
        : await peopleWithRole(tx, null, ['admin'])
      for (const userId of new Set(to)) {
        if (userId === actorId || userId === sys.user.id) continue
        const res = await notify(tx, sys, {
          to: userId,
          kind: r.notice_kind as NoticeKind,
          market: ev.market_code,
          title: [r.title_es, r.title_en],
          body: [r.body_es, r.body_en],
          link: LINK[ev.aggregate]?.(ev.aggregate_id) ?? null,
          accountId: ev.aggregate === 'account' ? ev.aggregate_id : null,
          dealId: ev.aggregate === 'deal' ? ev.aggregate_id : null,
          leadId: ev.aggregate === 'lead' ? ev.aggregate_id : null,
        })
        if (res.noticeId || Object.keys(res.channels).length > 0) notices++
      }
    }
  }
  return { events: events.length, notices }
}

/** Encender o apagar una regla de aviso por evento (administración). */
export async function setNoticeRule(ctx: Ctx, tx: Tx, id: string, active: boolean): Promise<void> {
  ctx.assert('platform.manage')
  const rows = await tx<{ event_type: string; is_active: boolean }[]>`select event_type, is_active from crm.event_notice_rules where id = ${id}`
  if (!rows[0]) return
  await tx`update crm.event_notice_rules set is_active = ${active}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${id}`
  await audit(tx, ctx, 'notice_rule.changed', 'event_notice_rule', id, null, { is_active: rows[0].is_active }, { is_active: active, event_type: rows[0].event_type })
}

/**
 * AUT-02: señales en vivo. Toma lo nuevo de la cola (consumidor `live`) y marca, por mercado y tipo de registro, la hora del
 * último cambio en crm.live_signals. Las pantallas abiertas comparan esa marca y se refrescan solas. Si Broadcast está
 * encendido, la misma señal sale por ahí (sin datos de nadie).
 */
export async function liveSignals(tx: Tx, limit = 500): Promise<{ events: number; topics: number; broadcast: number }> {
  const events = await takeEvents(tx, 'live', limit)
  if (events.length === 0) return { events: 0, topics: 0, broadcast: 0 }
  const topics = new Map<string, { market: string | null; event: string; n: number }>()
  for (const ev of events) {
    const key = `${ev.market_code ?? 'all'}:${ev.aggregate}`
    const cur = topics.get(key)
    topics.set(key, { market: ev.market_code, event: ev.event_type, n: (cur?.n ?? 0) + 1 })
  }
  const signals: LiveSignal[] = []
  for (const [topic, t] of topics) {
    await tx`insert into crm.live_signals (topic, market_code, last_at, n) values (${topic}, ${t.market}, now(), ${t.n})
             on conflict (topic) do update set last_at = now(), n = crm.live_signals.n + excluded.n`
    signals.push({ topic, event: t.event, at: new Date().toISOString() })
  }
  const sent = await broadcast(signals).catch(() => ({ sent: 0 }))
  return { events: events.length, topics: topics.size, broadcast: sent.sent }
}
