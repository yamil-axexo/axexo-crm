import 'server-only'
import { z } from 'zod'
import { createHmac } from 'node:crypto'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { eventTypes, type Envelope } from '@/domain/events/catalog'
import { eventDelivery, signingKey } from '@/server/adapters/event-delivery'
import { invalid, notFound } from '@/lib/errors'

// AUT-02: publicador de la bandeja de salida. Reparte cada evento a los suscriptores que lo pidieron, reintenta con
// espera creciente y, cuando se acaban los intentos, lo deja en mensajes muertos para reenviarlo a mano.
export const MAX_ATTEMPTS = 5
/** Minutos de espera antes del intento 2, 3, 4 y 5. */
export const BACKOFF_MINUTES = [1, 5, 30, 120] as const
const BATCH = 200

const subscriberInput = z.object({
  name: z.string().trim().min(3).max(80),
  destination: z.string().trim().max(300).regex(/^https:\/\/[a-z0-9.-]+(:[0-9]{2,5})?(\/[A-Za-z0-9._~/-]*)?$/),
  eventTypes: z.array(z.string().max(60)).min(1).max(80),
  market: z.string().length(2).or(z.literal('')).optional().default(''),
})

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|\d+\.\d+\.\d+\.\d+|\[.*\])$/

/** El secreto del suscriptor se deriva: no se guarda en la base. Cambia al rotar (secret_version). */
export function subscriberSecret(id: string, version: number): string | null {
  const key = signingKey()
  return key ? `whsec_${createHmac('sha256', key).update(`subscriber:${id}:${version}`).digest('hex')}` : null
}

export function sign(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

export async function createSubscriber(ctx: Ctx, input: z.input<typeof subscriberInput>): Promise<{ id: string; secret: string | null }> {
  ctx.assert('integration.operate')
  const v = subscriberInput.safeParse(input)
  if (!v.success) throw invalid('Revisa el suscriptor: nombre de 3 a 80 letras, destino que empiece con https:// y al menos un evento.', 'Check the subscriber: a name of 3 to 80 characters, a destination starting with https:// and at least one event.')
  const host = new URL(v.data.destination).hostname
  if (PRIVATE_HOST.test(host)) throw invalid('El destino tiene que ser una dirección pública con nombre, no una dirección interna.', 'The destination must be a public named address, not an internal one.')
  const known = new Set(eventTypes())
  const types = [...new Set(v.data.eventTypes)]
  if (!(types.length === 1 && types[0] === '*') && types.some((t) => !known.has(t))) throw invalid('Elige los eventos del catálogo.', 'Pick the events from the catalog.')
  if (v.data.market) ctx.market(v.data.market)
  return withUser(ctx.user.id, async (tx) => {
    const dup = await tx`select 1 from crm.event_subscribers where lower(btrim(name)) = lower(${v.data.name}) and status <> 'removed'`
    if (dup[0]) throw invalid('Ya hay un suscriptor con ese nombre.', 'There is already a subscriber with that name.')
    const id = await newId(tx)
    await tx`insert into crm.event_subscribers (id, name, destination, event_types, market_code, created_by)
             values (${id}, ${v.data.name}, ${v.data.destination}, ${types}, ${v.data.market || null}, ${ctx.user.id})`
    await audit(tx, ctx, 'event_subscriber.created', 'event_subscriber', id, v.data.market || null, null, { name: v.data.name, destination_host: host, events: types.length === 1 && types[0] === '*' ? 'all' : types.length })
    return { id, secret: subscriberSecret(id, 1) }
  })
}

export async function setSubscriberStatus(ctx: Ctx, id: string, status: 'active' | 'paused' | 'removed'): Promise<void> {
  ctx.assert('integration.operate')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ status: string; market_code: string | null }[]>`select status, market_code from crm.event_subscribers where id = ${id} and status <> 'removed' for update`
    if (!rows[0]) throw notFound()
    if (rows[0].status === status) return
    await tx`update crm.event_subscribers set status = ${status}, updated_at = now() where id = ${id}`
    await audit(tx, ctx, 'event_subscriber.status_changed', 'event_subscriber', id, rows[0].market_code, { status: rows[0].status }, { status })
  })
}

/** Rotar el secreto: desde ese momento se firma con el nuevo. Devuelve el secreto para mostrarlo una vez. */
export async function rotateSubscriberSecret(ctx: Ctx, id: string): Promise<string | null> {
  ctx.assert('integration.operate')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ secret_version: number; market_code: string | null }[]>`
      update crm.event_subscribers set secret_version = secret_version + 1, updated_at = now() where id = ${id} and status <> 'removed' returning secret_version, market_code`
    if (!rows[0]) throw notFound()
    await audit(tx, ctx, 'event_subscriber.secret_rotated', 'event_subscriber', id, rows[0].market_code, null, { secret_version: rows[0].secret_version })
    return subscriberSecret(id, rows[0].secret_version)
  })
}

type Due = {
  id: string; attempts: number; destination: string; subscriber_id: string; secret_version: number
  event_id: string; event_type: string; version: number; aggregate: string; aggregate_id: string; market_code: string | null; payload: Record<string, unknown>; created_at: Date
}

export const envelope = (e: Pick<Due, 'event_id' | 'event_type' | 'version' | 'aggregate' | 'aggregate_id' | 'market_code' | 'payload' | 'created_at'>): Envelope => ({
  id: e.event_id, type: e.event_type, version: e.version, occurred_at: e.created_at.toISOString(), market: e.market_code,
  aggregate: { type: e.aggregate, id: e.aggregate_id }, data: e.payload,
})

export type PublishResult = { queued: number; delivered: number; failed: number; dead: number; waiting: number; mode: 'off' | 'simulated' | 'live' }

/**
 * Una pasada del publicador dentro de la transacción que recibe. Es seguro correrla dos veces: la fila de entrega es
 * única por evento y suscriptor, y quien recibe puede descartar repetidos por el id del evento.
 */
export async function publishDue(tx: Tx): Promise<PublishResult> {
  // 1) Reparto: una fila de entrega por cada evento que un suscriptor activo pidió y todavía no tiene.
  const queued = await tx`
    insert into crm.event_deliveries (event_id, subscriber_id)
    select e.id, s.id
      from crm.event_subscribers s
      join crm.outbox_events e on e.created_at >= s.created_at
       and (s.event_types = array['*'] or e.event_type = any(s.event_types))
       and (s.market_code is null or e.market_code = s.market_code)
     where s.status = 'active'
       and not exists (select 1 from crm.event_deliveries d where d.event_id = e.id and d.subscriber_id = s.id)
     order by e.created_at
     limit ${BATCH * 5}
    on conflict (event_id, subscriber_id) do nothing`
  // 2) Entrega de lo que ya toca.
  const due = await tx<Due[]>`
    select d.id, d.attempts, s.destination, s.id as subscriber_id, s.secret_version,
           e.id as event_id, e.event_type, e.version, e.aggregate, e.aggregate_id, e.market_code, e.payload, e.created_at
      from crm.event_deliveries d
      join crm.event_subscribers s on s.id = d.subscriber_id and s.status = 'active'
      join crm.outbox_events e on e.id = d.event_id
     where d.status in ('ready','retrying') and d.next_attempt_at <= now()
     order by d.next_attempt_at, d.created_at
     limit ${BATCH}
       for update of d skip locked`
  const adapter = eventDelivery()
  const out: PublishResult = { queued: queued.count, delivered: 0, failed: 0, dead: 0, waiting: 0, mode: adapter.mode }
  for (const d of due) {
    const body = JSON.stringify(envelope(d))
    const secret = subscriberSecret(d.subscriber_id, d.secret_version)
    const ts = Math.floor(Date.now() / 1000)
    const res = await adapter.deliver({
      destination: d.destination, body,
      headers: { 'content-type': 'application/json', 'x-contigo-event': d.event_type, 'x-contigo-event-id': d.event_id, 'x-contigo-delivery': d.id, ...(secret ? { 'x-contigo-signature': sign(secret, ts, body) } : {}) },
    })
    if (res.kind === 'off') {
      out.waiting++
      continue
    }
    if (res.kind === 'ok') {
      await tx`update crm.event_deliveries set status = 'delivered', attempts = attempts + 1, delivered_at = now(), last_error = null, updated_at = now() where id = ${d.id}`
      out.delivered++
      continue
    }
    const attempts = d.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      await tx`update crm.event_deliveries set status = 'dead', attempts = ${attempts}, last_error = ${res.error.slice(0, 300)}, updated_at = now() where id = ${d.id}`
      out.dead++
    } else {
      const wait = BACKOFF_MINUTES[attempts - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]!
      await tx`update crm.event_deliveries set status = 'retrying', attempts = ${attempts}, last_error = ${res.error.slice(0, 300)},
                 next_attempt_at = now() + make_interval(mins => ${wait}), updated_at = now() where id = ${d.id}`
      out.failed++
    }
  }
  return out
}

/** "Publicar ahora" desde Administración: la misma pasada que corre el job, a nombre de quien la pidió. */
export async function publishNow(ctx: Ctx): Promise<PublishResult> {
  ctx.assert('integration.operate')
  return withUser(ctx.user.id, (tx) => publishDue(tx))
}

/** Reenvío manual de una entrega (muerta o en reintento): vuelve a la fila con los intentos en cero. */
export async function resendDelivery(ctx: Ctx, deliveryId: string): Promise<void> {
  ctx.assert('integration.operate')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ status: string; event_id: string; subscriber_id: string }[]>`
      select status, event_id, subscriber_id from crm.event_deliveries where id = ${deliveryId} for update`
    const d = rows[0]
    if (!d) throw notFound()
    if (d.status === 'delivered') throw invalid('Esa entrega ya llegó: no hace falta reenviarla.', 'That delivery already arrived: there is no need to resend it.')
    await tx`update crm.event_deliveries set status = 'ready', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now() where id = ${deliveryId}`
    await audit(tx, ctx, 'event_delivery.resent', 'event_delivery', deliveryId, null, { status: d.status }, { status: 'ready', event_id: d.event_id, subscriber_id: d.subscriber_id })
  })
}
