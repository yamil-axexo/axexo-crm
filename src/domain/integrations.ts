import 'server-only'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { withUser, type Tx } from '@/server/db'
import { systemCtx, type Ctx } from '@/server/context'
import { audit, emit, newId } from '@/domain/common'
import { insertAccountTx } from '@/domain/accounts'
import { accountRule, skipReason } from '@/domain/intake'
import { DomainError, invalid } from '@/lib/errors'
import { toE164 } from '@/lib/format'
import { notify } from '@/domain/notify'
import { scrub } from '@/domain/pipedrive/mapping'
import { markUntrusted, plainText } from '@/domain/untrusted'
import { ingestPerfectStoreTx } from '@/domain/campo-canal/campo'
import { applyClosing, closingFileFields, closingRowFields, manifestProblem, recordRestatements } from '@/domain/embudo/closing'
import { decisionMakerContact, ensureRevisitTask, saveDecisionMaker } from '@/domain/embudo/revisit'
import { noteUnknownReason } from '@/domain/embudo/reasons'
import { openSalesToOpsHandoffs } from '@/domain/care'

// CAMPO-01: contrato de eventos v1 entre la Sales App y CONTIGO (propuesto).
// Los nombres siguen los campos de VisitResponse de Sales Core. La visita se registra una sola vez, allá;
// aquí solo se lee. El PDV nace allá; CONTIGO emite el ID canónico y lo devuelve como alias.
const iso = z.string().datetime({ offset: true })

export const visitEvent = z.object({
  event_id: z.string().min(8).max(80),
  type: z.literal('visit.checked_out'),
  version: z.literal(1),
  occurred_at: iso,
  data: z.object({
    visit_id: z.string().min(1).max(80),
    customer_id: z.string().min(1).max(80),
    salesperson_id: z.string().min(1).max(80),
    salesperson_email: z.string().email().optional(),
    business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checked_in_at: iso,
    checked_out_at: iso.nullable().optional(),
    duration_seconds: z.number().int().nonnegative().nullable().optional(),
    sale: z.boolean(),
    rejection_reason: z.string().max(40).nullable().optional(),
    revisit: z.boolean().default(false),
    revisit_reason: z.string().max(120).nullable().optional(),
    decision_maker_present: z.boolean().nullable().optional(),
    auto_closed: z.boolean().default(false),
    note: z.string().max(500).nullable().optional(),
    // CAMPO-08: el checklist de punto de venta perfecto vive en la Sales App; aquí llegan solo cuántos ítems cumplió de cuántos.
    perfect_store: z.object({ items_ok: z.number().int().min(0).max(10), items_total: z.number().int().min(1).max(10) }).nullable().optional(),
    // CAMPO-07: competencia vista en la visita, por nombre de la lista del mercado, con producto y precio observado.
    competitors: z.array(z.object({ name: z.string().min(2).max(80), product: z.string().max(80).nullable().optional(), price: z.number().nonnegative().max(1e7).nullable().optional() })).max(10).optional(),
    // PIPE-05: quien decide, cuando no estaba en la visita (opcional: el contrato vigente sigue valiendo sin él).
    decision_maker_contact: decisionMakerContact.nullable().optional(),
    revisit_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }),
})

export const storeEvent = z.object({
  event_id: z.string().min(8).max(80),
  type: z.literal('store.created'),
  version: z.literal(1),
  occurred_at: iso,
  data: z.object({
    customer_id: z.string().min(1).max(80),
    market: z.string().length(2),
    name: z.string().trim().min(2).max(160),
    phone: z.string().max(30).nullable().optional(),
    locality: z.string().max(120).nullable().optional(),
    region: z.string().max(120).nullable().optional(),
    salesperson_email: z.string().email().optional(),
    // MULTI-04: dónde está el punto de venta, tomado por el teléfono de quien lo dio de alta. Opcional; van las dos o ninguna.
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    location_accuracy_m: z.number().int().min(0).max(100000).optional(),
  }),
})

// El alta del comercio se envió desde la Sales App. Si el PDV todavía no existe aquí, puede traer lo mínimo para ligarlo o crearlo.
export const onboardingEvent = z.object({
  event_id: z.string().min(8).max(80),
  type: z.literal('onboarding.submitted'),
  version: z.literal(1),
  occurred_at: iso,
  data: z.object({
    customer_id: z.string().min(1).max(80),
    submitted_at: iso,
    market: z.string().length(2).optional(),
    name: z.string().trim().min(2).max(160).optional(),
    phone: z.string().max(30).nullable().optional(),
    locality: z.string().max(120).nullable().optional(),
    region: z.string().max(120).nullable().optional(),
    salesperson_email: z.string().email().optional(),
    documents_complete: z.boolean().nullable().optional(),
  }),
})

// El comercio fue aprobado y ya tiene Merchant ID. No gana el negocio: eso lo hace la primera transacción.
export const approvedEvent = z.object({
  event_id: z.string().min(8).max(80),
  type: z.literal('merchant.approved'),
  version: z.literal(1),
  occurred_at: iso,
  data: z.object({
    customer_id: z.string().min(1).max(80),
    merchant_ref: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/),
    approved_at: iso,
  }),
})

export const salesAppEvent = z.discriminatedUnion('type', [visitEvent, storeEvent, onboardingEvent, approvedEvent])
export const SALES_APP_EVENTS = [visitEvent, storeEvent, onboardingEvent, approvedEvent] as const
export type SalesAppEvent = z.infer<typeof salesAppEvent>
export type IngestResult = { status: 'processed' | 'duplicate' | 'unmatched'; detail?: string; accountId?: string }
/** Reproceso: el mensaje ya tiene su fila en la bandeja de entrada; se procesa sobre esa misma fila. */
type Replay = { id: string } | undefined

async function openEvent(tx: Tx, ev: SalesAppEvent, market: string | null, replay?: Replay): Promise<string | null> {
  if (replay) {
    await tx`update crm.inbound_events set event_type = ${ev.type}, market_code = coalesce(${market}, market_code), status = 'received', error = null where id = ${replay.id}`
    return replay.id
  }
  const rows = await tx<{ id: string }[]>`
    insert into crm.inbound_events (source, event_type, idempotency_key, market_code, payload)
    values ('sales_app', ${ev.type}, ${ev.event_id}, ${market}, ${tx.json(ev as never)})
    on conflict (source, idempotency_key) do nothing returning id`
  return rows[0]?.id ?? null
}

/** Por qué un mensaje no cumple el contrato, en una línea corta y sin copiar su contenido. */
export function contractProblem(raw: unknown): string {
  const o = (raw ?? {}) as { type?: unknown; version?: unknown }
  const known = SALES_APP_EVENTS.map((e) => e.shape.type.value as string)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'not_an_object'
  if (typeof o.type !== 'string' || !known.includes(o.type)) return 'unknown_type'
  if (o.version !== 1) return 'unsupported_version'
  const parsed = salesAppEvent.safeParse(raw)
  if (parsed.success) return ''
  const issue = parsed.error.issues[0]
  return `invalid_field:${(issue?.path ?? []).join('.').slice(0, 80) || 'body'}`
}

/** Copia del mensaje que se guarda en muertos: sin datos prohibidos, sin caracteres invisibles y con tope de tamaño. */
function deadCopy(raw: unknown): Record<string, unknown> {
  const clean = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return scrub(plainText(v)).slice(0, 500)
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v
    if (depth > 4) return null
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1))
    if (typeof v === 'object' && v) return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 40).map(([k, x]) => [k.slice(0, 60), clean(x, depth + 1)]))
    return null
  }
  const out = clean(raw, 0)
  const body = typeof out === 'object' && out !== null && !Array.isArray(out) ? (out as Record<string, unknown>) : { value: out }
  return JSON.stringify(body).length > 8000 ? { truncated: true, type: body.type ?? null, event_id: body.event_id ?? null } : body
}

/** Un mensaje que no se puede procesar no se pierde ni se descarta en silencio: queda en muertos con su motivo. */
async function toDeadLetter(sys: Ctx, raw: unknown, reason: string): Promise<void> {
  const o = (raw ?? {}) as { event_id?: unknown; type?: unknown }
  const key = typeof o.event_id === 'string' && o.event_id.length >= 8 && o.event_id.length <= 80 ? o.event_id : `sha:${createHash('sha256').update(JSON.stringify(raw ?? null)).digest('hex').slice(0, 40)}`
  const type = typeof o.type === 'string' ? o.type.slice(0, 60) : 'unknown'
  await withUser(sys.user.id, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into crm.inbound_events (source, event_type, idempotency_key, payload, status, error, attempts, processed_at)
      values ('sales_app', ${type}, ${key}, ${tx.json(deadCopy(raw) as never)}, 'dead', ${reason}, 1, now())
      on conflict (source, idempotency_key) do nothing returning id`
    if (rows[0]) await audit(tx, sys, 'integration.dead_letter', 'inbound_event', rows[0].id, null, null, { source: 'sales_app', type, reason })
  })
}

/** REL-07: procesar dos veces el mismo evento no cambia nada. Corre como usuario de sistema. */
export async function ingestSalesAppEvent(sys: Ctx, raw: unknown): Promise<IngestResult> {
  const parsed = salesAppEvent.safeParse(raw)
  if (!parsed.success) {
    await toDeadLetter(sys, raw, contractProblem(raw) || 'invalid')
    throw invalid('El evento no cumple el contrato v1. Quedó en mensajes muertos con su motivo.', 'The event does not match contract v1. It was kept in dead letters with the reason.')
  }
  const ev = parsed.data
  return withUser(sys.user.id, (tx) => route(tx, sys, ev))
}

function route(tx: Tx, sys: Ctx, ev: SalesAppEvent, replay?: Replay): Promise<IngestResult> {
  if (ev.type === 'store.created') return ingestStore(tx, sys, ev, replay)
  if (ev.type === 'onboarding.submitted') return ingestOnboarding(tx, sys, ev, replay)
  if (ev.type === 'merchant.approved') return ingestApproved(tx, sys, ev, replay)
  return ingestVisit(tx, sys, ev, replay)
}

/**
 * Reproceso de un mensaje muerto o sin comercio. Si ahora sí se puede procesar (por ejemplo, ya llegó la tienda), se
 * procesa sobre su misma fila; si no, sigue donde estaba, con un intento más y el motivo de hoy.
 */
export async function replayInboundEvent(ctx: Ctx, id: string): Promise<IngestResult> {
  ctx.assert('integration.operate')
  const sys = await systemCtx()
  const rows = await withUser(ctx.user.id, (tx) => tx<{ payload: unknown; status: string; market_code: string | null }[]>`
    select payload, status, market_code from crm.inbound_events where id = ${id} and source = 'sales_app' and status in ('dead','rejected')`)
  const row = rows[0]
  if (!row) throw invalid('Ese mensaje ya se procesó o no existe.', 'That message was already processed or does not exist.')
  const parsed = salesAppEvent.safeParse(row.payload)
  const stamp = (tx: Tx, result: string, error: string | null) => audit(tx, ctx, 'inbound.replayed', 'inbound_event', id, row.market_code, { status: row.status }, { result, ...(error ? { reason: error } : {}) })
  if (!parsed.success) {
    const reason = contractProblem(row.payload) || 'invalid'
    await withUser(ctx.user.id, async (tx) => {
      await tx`update crm.inbound_events set attempts = attempts + 1, error = ${reason}, replayed_at = now(), replayed_by = ${ctx.user.id} where id = ${id}`
      await stamp(tx, 'still_dead', reason)
    })
    return { status: 'unmatched', detail: reason }
  }
  const out = await withUser(sys.user.id, (tx) => route(tx, sys, parsed.data, { id }))
  await withUser(ctx.user.id, async (tx) => {
    await tx`update crm.inbound_events set attempts = attempts + 1, replayed_at = now(), replayed_by = ${ctx.user.id} where id = ${id}`
    await stamp(tx, out.status, out.detail ?? null)
  })
  return out
}

async function ingestVisit(tx: Tx, sys: Ctx, ev: z.infer<typeof visitEvent>, replay?: Replay): Promise<IngestResult> {
  const d = ev.data
  const accs = await tx<{ id: string; market_code: string }[]>`
    select a.id, a.market_code from crm.account_aliases al join crm.accounts a on a.id = al.account_id
     where al.system = 'sales_core' and al.external_id = ${d.customer_id} and al.valid_to is null and a.archived_at is null`
  const acc = accs[0]
  const eventId = await openEvent(tx, ev, acc?.market_code ?? null, replay)
  if (!eventId) return { status: 'duplicate' }
  if (!acc) {
    await tx`update crm.inbound_events set status = 'rejected', error = 'unknown customer_id', processed_at = now() where id = ${eventId}`
    const mk = await tx<{ code: string }[]>`select code from crm.markets where status = 'live' order by code limit 1`
    await tx`insert into crm.exceptions (market_code, kind, severity, detail, dedupe_key)
             values (${mk[0]!.code}, 'unmatched_event', 'medium', ${tx.json({ source: 'sales_app', type: ev.type, customer_id: d.customer_id })}, ${'unmatched:' + ev.event_id})
             on conflict do nothing`
    return { status: 'unmatched', detail: 'unknown customer_id' }
  }
  if (!d.sale && d.rejection_reason) {
    const ok = await tx`select 1 from crm.loss_reasons where code = ${d.rejection_reason} and kind = 'no_sale'`
    if (!ok[0]) {
      // PIPE-04: el código que CONTIGO no conoce no se pierde en silencio: queda contado y a la vista en Administración.
      await noteUnknownReason(tx, 'sales_app', d.rejection_reason, acc.market_code)
      d.rejection_reason = null
    }
  }
  const users = d.salesperson_email ? await tx<{ id: string }[]>`select id from crm.users where email = ${d.salesperson_email} and is_active` : []
  // IA-07 / SEC-08: la nota y el motivo los escribió alguien en otra app: sin datos prohibidos, sin caracteres invisibles y con su marca.
  const note = d.note ? scrub(plainText(d.note)) : null
  const revisitReason = d.revisit_reason ? scrub(plainText(d.revisit_reason)) : null
  const visit = await tx<{ id: string }[]>`insert into crm.visits (market_code, account_id, external_visit_id, salesperson_ref, user_id, business_date, checked_in_at, checked_out_at,
                                   duration_seconds, outcome, rejection_code, revisit, revisit_reason, decision_maker_seen, auto_closed, note, inbound_event_id)
           values (${acc.market_code}, ${acc.id}, ${d.visit_id}, ${d.salesperson_id}, ${users[0]?.id ?? null}, ${d.business_date}, ${d.checked_in_at},
                   ${d.checked_out_at ?? null}, ${d.duration_seconds ?? null}, ${d.sale ? 'sale' : 'no_sale'}, ${d.sale ? null : (d.rejection_reason ?? null)},
                   ${d.revisit}, ${revisitReason}, ${d.decision_maker_present ?? null}, ${d.auto_closed}, ${note}, ${eventId})
           on conflict (external_visit_id) do nothing returning id`
  if (visit[0] && (note || revisitReason)) await markUntrusted(tx, 'visit', visit[0].id, acc.market_code, 'sales_app', [...(note ? ['note'] : []), ...(revisitReason ? ['revisit_reason'] : [])])
  // PIPE-05: la revisita al decisor queda visible en el embudo, no escondida en una nota.
  if (d.revisit) {
    // La fecha de la revisita la puede traer la visita; si no, dos días después (lo de siempre).
    const due = (await tx<{ d: string }[]>`select coalesce(${d.revisit_due ?? null}::date, ${d.business_date}::date + 2)::text as d`)[0]!.d
    await tx`update crm.deals set revisit_needed = true, revisit_reason = ${revisitReason ?? d.rejection_reason ?? 'revisit'},
              revisit_due = ${due}::date where account_id = ${acc.id} and status = 'open'`
    // Quien decide queda como contacto del comercio, y la revisita es una tarea con fecha y dueño aunque no haya negocio abierto.
    if (d.decision_maker_contact) await saveDecisionMaker(tx, sys, acc, d.decision_maker_contact)
    await ensureRevisitTask(tx, sys, { accountId: acc.id, market: acc.market_code, visitId: d.visit_id, due, reason: revisitReason, visitorId: users[0]?.id ?? null })
  } else if (d.decision_maker_present) {
    await tx`update crm.deals set revisit_needed = false, decision_maker_met = (decision_maker_id is not null) where account_id = ${acc.id} and status = 'open'`
  }
  if (d.perfect_store && d.perfect_store.items_ok <= d.perfect_store.items_total) {
    await ingestPerfectStoreTx(tx, { account_id: acc.id, items_ok: d.perfect_store.items_ok, items_total: d.perfect_store.items_total, observed_at: d.checked_out_at ?? d.checked_in_at, visit_ref: d.visit_id })
  }
  for (const c of d.competitors ?? []) {
    const comp = (await tx<{ id: string }[]>`select id from crm.competitors where market_code = ${acc.market_code} and lower(name) = lower(${c.name}) and is_active`)[0]
    if (!comp) continue
    await tx`insert into crm.account_competitors (account_id, market_code, competitor_id, product, price_minor, observed_on, source)
             values (${acc.id}, ${acc.market_code}, ${comp.id}, ${c.product ? scrub(plainText(c.product)) : null}, ${c.price == null ? null : Math.round(c.price * 100)}, ${d.business_date}::date, 'sales_app')`
  }
  await tx`update crm.inbound_events set status = 'processed', processed_at = now() where id = ${eventId}`
  await audit(tx, sys, 'integration.visit_received', 'account', acc.id, acc.market_code, null, { visit_id: d.visit_id, sale: d.sale, revisit: d.revisit })
  return { status: 'processed', accountId: acc.id }
}

type StoreData = { customer_id: string; market: string; name: string; phone?: string | null; locality?: string | null; region?: string | null; salesperson_email?: string }

/**
 * Un solo creador de PDV. El comercio se busca por el ID de Sales Core; si no está, por el teléfono dentro del mercado
 * (el prospecto que CONTIGO ya tenía); solo si no existe se crea. Quien llega segundo se liga, nunca duplica.
 */
async function linkOrCreateStore(tx: Tx, sys: Ctx, d: StoreData): Promise<{ accountId: string; created: boolean } | { error: string }> {
  const existing = await tx<{ account_id: string }[]>`
    select account_id from crm.account_aliases where system = 'sales_core' and external_id = ${d.customer_id} and valid_to is null`
  if (existing[0]) return { accountId: existing[0].account_id, created: false }
  const mk = await tx<{ phone_cc: string }[]>`select phone_cc from crm.markets where code = ${d.market}`
  if (!mk[0]) return { error: 'unknown market' }
  const phone = toE164(d.phone ?? null, mk[0].phone_cc)
  const match = phone ? await tx<{ id: string }[]>`select id from crm.accounts where market_code = ${d.market} and phone = ${phone} and archived_at is null order by created_at limit 1` : []
  let accountId = match[0]?.id
  const created = !accountId
  if (!accountId) {
    const owner = d.salesperson_email ? await tx<{ id: string }[]>`select id from crm.users where email = ${d.salesperson_email} and is_active` : []
    const locality = d.locality ? scrub(plainText(d.locality)) : null
    const region = d.region ? scrub(plainText(d.region)) : null
    // AUT-01: el punto de venta nace por la misma función que el alta de la pantalla, con sus mismas reglas de entrada.
    // La regla mira el nombre como llegó (solo sin formato): un dato prohibido en el nombre se rechaza igual que en la
    // pantalla, no se guarda tachado. Lo que sí pasa la regla se guarda limpio.
    const broken = accountRule({ name: plainText(d.name).slice(0, 160), phone })
    if (broken) return { error: skipReason(broken) }
    const name = scrub(plainText(d.name)).slice(0, 160)
    accountId = await insertAccountTx(tx, { market: d.market, kind: 'store', accountType: null, name, segment: 'd2d', lifecycle: 'onboarding', parentId: null,
      ownerId: owner[0]?.id ?? null, territoryId: null, phone, locality, region, createdBy: sys.user.id })
    await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by)
             values (${accountId}, ${d.market}, 'origin', 'import', 'sales_app', 'Sales App', ${sys.user.id})`
    await markUntrusted(tx, 'account', accountId, d.market, 'sales_app', ['name', ...(locality ? ['locality'] : []), ...(region ? ['region'] : [])])
  } else {
    await tx`update crm.accounts set lifecycle = 'onboarding' where id = ${accountId} and lifecycle = 'prospect'`
  }
  await tx`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${accountId}, ${d.market}, 'sales_core', ${d.customer_id})`
  await emit(tx, 'account.alias_issued', 'account', accountId, d.market, { system: 'sales_core', external_id: d.customer_id, account_id: accountId })
  return { accountId, created }
}

async function ingestStore(tx: Tx, sys: Ctx, ev: z.infer<typeof storeEvent>, replay?: Replay): Promise<IngestResult> {
  const d = ev.data
  const eventId = await openEvent(tx, ev, d.market, replay)
  if (!eventId) return { status: 'duplicate' }
  const out = await linkOrCreateStore(tx, sys, d)
  if ('error' in out) {
    await tx`update crm.inbound_events set status = 'rejected', error = ${out.error}, processed_at = now() where id = ${eventId}`
    return { status: 'unmatched', detail: out.error }
  }
  // La ubicación que trae el evento llena el hueco; nunca pisa la que alguien ya guardó en CONTIGO.
  const located = d.latitude !== undefined && d.longitude !== undefined
    ? (await tx`update crm.accounts set latitude = ${d.latitude}, longitude = ${d.longitude}, geo_source = 'sales_app', geo_accuracy_m = ${d.location_accuracy_m ?? null}, geo_at = ${ev.occurred_at}, geo_by = null
                 where id = ${out.accountId} and latitude is null returning id`).length > 0
    : false
  await tx`update crm.inbound_events set status = 'processed', processed_at = now() where id = ${eventId}`
  await audit(tx, sys, 'integration.store_received', 'account', out.accountId, d.market, null, { customer_id: d.customer_id, ...(located ? { located: true } : {}) })
  return { status: 'processed', accountId: out.accountId }
}

const sysNote = (sys: Ctx, market: string, es: string, en: string) => (sys.market(market).locale === 'en' ? en : es)

async function ingestOnboarding(tx: Tx, sys: Ctx, ev: z.infer<typeof onboardingEvent>, replay?: Replay): Promise<IngestResult> {
  const d = ev.data
  const known = await tx<{ id: string; market_code: string }[]>`
    select a.id, a.market_code from crm.account_aliases al join crm.accounts a on a.id = al.account_id
     where al.system = 'sales_core' and al.external_id = ${d.customer_id} and al.valid_to is null and a.archived_at is null`
  let acc = known[0]
  const eventId = await openEvent(tx, ev, acc?.market_code ?? d.market ?? null, replay)
  if (!eventId) return { status: 'duplicate' }
  if (!acc && d.market && d.name) {
    // El alta llegó antes que la tienda: con nombre y mercado se liga al prospecto que ya existía o se crea, una sola vez.
    const out = await linkOrCreateStore(tx, sys, { customer_id: d.customer_id, market: d.market, name: d.name, phone: d.phone, locality: d.locality, region: d.region, salesperson_email: d.salesperson_email })
    if (!('error' in out)) acc = { id: out.accountId, market_code: d.market }
  }
  if (!acc) {
    await tx`update crm.inbound_events set status = 'rejected', error = 'unknown customer_id', processed_at = now() where id = ${eventId}`
    return { status: 'unmatched', detail: 'unknown customer_id' }
  }
  await tx`update crm.accounts set lifecycle = 'onboarding' where id = ${acc.id} and lifecycle = 'prospect'`
  await tx`insert into crm.activities (market_code, account_id, kind, subject, done_at, created_by, source)
           values (${acc.market_code}, ${acc.id}, 'system', ${sysNote(sys, acc.market_code, 'Alta enviada desde la Sales App', 'Onboarding submitted from the Sales App')}, ${d.submitted_at}, ${sys.user.id}, 'sales_app')`
  await tx`update crm.inbound_events set status = 'processed', market_code = ${acc.market_code}, processed_at = now() where id = ${eventId}`
  await audit(tx, sys, 'integration.onboarding_received', 'account', acc.id, acc.market_code, null, { customer_id: d.customer_id, documents_complete: d.documents_complete ?? null })
  return { status: 'processed', accountId: acc.id }
}

async function ingestApproved(tx: Tx, sys: Ctx, ev: z.infer<typeof approvedEvent>, replay?: Replay): Promise<IngestResult> {
  const d = ev.data
  const known = await tx<{ id: string; market_code: string; merchant_ref: string | null }[]>`
    select a.id, a.market_code, a.merchant_ref from crm.account_aliases al join crm.accounts a on a.id = al.account_id
     where al.system = 'sales_core' and al.external_id = ${d.customer_id} and al.valid_to is null and a.archived_at is null for update of a`
  const acc = known[0]
  const eventId = await openEvent(tx, ev, acc?.market_code ?? null, replay)
  if (!eventId) return { status: 'duplicate' }
  const reject = async (error: string): Promise<IngestResult> => {
    await tx`update crm.inbound_events set status = 'rejected', error = ${error}, processed_at = now() where id = ${eventId}`
    return { status: 'unmatched', detail: error }
  }
  if (!acc) return reject('unknown customer_id')
  // El Merchant ID lo decide quien aprueba (matriz del contrato). Uno que ya lleva otro comercio del mercado no se pisa: se revisa a mano.
  const taken = await tx`select 1 from crm.accounts where market_code = ${acc.market_code} and merchant_ref is not null
    and upper(btrim(merchant_ref)) = upper(${d.merchant_ref}) and id <> ${acc.id} and archived_at is null`
  if (taken[0]) return reject('merchant_ref in use')
  if (acc.merchant_ref !== d.merchant_ref) await tx`update crm.accounts set merchant_ref = ${d.merchant_ref} where id = ${acc.id}`
  await tx`update crm.accounts set lifecycle = 'onboarding' where id = ${acc.id} and lifecycle = 'prospect'`
  await tx`insert into crm.activities (market_code, account_id, kind, subject, done_at, created_by, source)
           values (${acc.market_code}, ${acc.id}, 'system', ${sysNote(sys, acc.market_code, 'Comercio aprobado: ya tiene Merchant ID', 'Merchant approved: it now has a Merchant ID')}, ${d.approved_at}, ${sys.user.id}, 'sales_app')`
  await tx`update crm.inbound_events set status = 'processed', processed_at = now() where id = ${eventId}`
  await audit(tx, sys, 'integration.merchant_approved', 'account', acc.id, acc.market_code, { merchant_ref: acc.merchant_ref }, { merchant_ref: d.merchant_ref, customer_id: d.customer_id })
  return { status: 'processed', accountId: acc.id }
}

// AUT-06 / REP-04: archivo diario de agregados del lakehouse (S5). Nunca transacciones individuales.
const metricRow = z.object({
  merchant_ref: z.string().min(1).max(80),
  first_txn_at: iso.nullable().optional(),
  last_txn_at: iso.nullable().optional(),
  txn_count_30d: z.number().int().nonnegative(),
  volume_minor_30d: z.number().int().nonnegative(),
  currency: z.string().length(3),
  active_days_30d: z.number().int().min(0).max(31),
  // REP-04: el estado del comercio lo define quien es dueño de la métrica (Data y Reportería) y viaja en el archivo.
  // Es opcional mientras el contrato no lo traiga: sin él, CONTIGO usa su regla de respaldo y lo dice en la pantalla.
  status: z.enum(['active', 'at_risk', 'inactive']).nullable().optional(),
  // reportes2 (REP-04): TPV por producto y comisión, opcionales en el contrato. Si llegan se guardan tal cual; CONTIGO no los calcula.
  tpv_by_product: z.array(z.object({ product: z.string().min(1).max(60), volume_minor_30d: z.number().int().nonnegative() })).max(30).nullable().optional(),
  commission_minor_30d: z.number().int().nonnegative().nullable().optional(),
  // PIPE-06: primer fondeo con su método y hábito, cada uno por separado (opcionales mientras el contrato no los traiga).
  ...closingRowFields,
})
export const metricsFile = z
  .object({
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    file_name: z.string().min(3).max(160),
    // "full" = el archivo trae todos los comercios del corte; "delta" = solo los que cambiaron.
    mode: z.enum(['full', 'delta']).default('full'),
    rows: z.array(metricRow).min(1).max(20000),
    // PIPE-06: manifiesto del archivo y correcciones compensatorias de hitos ya cargados.
    ...closingFileFields,
  })
  .superRefine((f, ctx) => {
    // REL-10: llave única dentro del archivo.
    if (new Set(f.rows.map((r) => r.merchant_ref)).size !== f.rows.length) ctx.addIssue({ code: 'custom', message: 'duplicate merchant_ref', path: ['rows'] })
  })
export type MetricsFile = z.infer<typeof metricsFile>
export type MetricsResult = { status: 'loaded' | 'duplicate' | 'quarantined'; rows: number; matched: number; unmatched: number; dealsWon: number; batchId?: string
  /** PIPE-06: negocios que pasaron a esperar la primera venta por el primer fondeo, correcciones aplicadas y cifras de un corte ya cargado que cambiaron. */
  funded?: number; corrections?: number; restatedRows?: number }

// Valor de fábrica del umbral de riesgo. El vigente es la ventana del mercado y la línea de producto (crm.lifecycle_windows):
// entrar a riesgo y salir de riesgo usan umbrales distintos (histéresis, CS-01).
export const AT_RISK_BELOW_ACTIVE_DAYS = 5
export const MAX_ROW_DELTA = 0.2

export async function ingestMetricsFile(sys: Ctx, raw: unknown): Promise<MetricsResult> {
  const parsed = metricsFile.safeParse(raw)
  if (!parsed.success) throw invalid('El archivo no cumple el formato merchant_metrics_daily v1.', 'The file does not match merchant_metrics_daily v1.')
  const file = parsed.data
  const checksum = createHash('sha256').update(JSON.stringify(file)).digest('hex')
  // AUT-06 (reportes2): un archivo con fecha de corte anterior a la última aplicada a sus comercios llegó tarde: no se aplica nada
  // (cambiaría el estado de los comercios hacia atrás). El mismo corte sí entra: es una corrección y deja su antes y después. Y si Administración
  // fijó que el manifiesto es obligatorio, un archivo sin manifiesto tampoco entra.
  await rejectLateOrBare(sys, file, checksum)
  // PIPE-06: si el manifiesto dice traer otro número de filas, el archivo llegó incompleto: no se aplica nada.
  if (manifestProblem(file)) {
    await withUser(sys.user.id, async (tx) => {
      await tx`insert into crm.ingest_batches (source, as_of, file_name, checksum, row_count, mode, status, reject_reason, manifest)
               values ('s5', ${file.as_of}, ${file.file_name}, ${checksum}, ${file.rows.length}, ${file.mode}, 'rejected', 'manifest_mismatch', ${tx.json(file.manifest as never)})
               on conflict (source, checksum) do nothing`
      await audit(tx, sys, 'integration.metrics_quarantined', 'ingest_batch', null, null, null, { as_of: file.as_of, rows: file.rows.length, reason: 'manifest_mismatch', manifest_rows: file.manifest!.row_count })
    })
    throw new DomainError('manifest_mismatch',
      'El archivo no trae las filas que dice su manifiesto. No se aplicó nada.',
      'The file does not carry the rows its manifest declares. Nothing was applied.', 409)
  }
  const result = await loadMetrics(sys, file, checksum)
  if (result.status === 'quarantined') {
    await withUser(sys.user.id, async (tx) => {
      await tx`insert into crm.ingest_batches (source, as_of, file_name, checksum, row_count, mode, status, reject_reason)
               values ('s5', ${file.as_of}, ${file.file_name}, ${checksum}, ${file.rows.length}, ${file.mode}, 'rejected', 'row_delta')
               on conflict (source, checksum) do nothing`
      await audit(tx, sys, 'integration.metrics_quarantined', 'ingest_batch', null, null, null, { as_of: file.as_of, rows: file.rows.length, reason: 'row_delta' })
    })
    throw new DomainError('quarantined',
      'El archivo cambió más de 20% de tamaño contra el anterior y quedó en cuarentena. No se aplicó nada.',
      'The file size changed more than 20% versus the previous one and was quarantined. Nothing was applied.', 409)
  }
  return result
}

async function rejectLateOrBare(sys: Ctx, file: MetricsFile, checksum: string): Promise<void> {
  const check = await withUser(sys.user.id, async (tx) => {
    // El corte se compara contra el último aplicado a los mismos comercios: si alguno ya tiene un corte posterior, el archivo llegó tarde.
    const last = await tx<{ as_of: string | null; n: number }[]>`
      select max(mm.as_of)::text as as_of, count(distinct mm.account_id)::int as n
        from crm.account_aliases al join crm.merchant_metrics_daily mm on mm.account_id = al.account_id and mm.as_of > ${file.as_of}::date
       where al.system in ('s5','sales_core') and al.valid_to is null and al.external_id = any(${file.rows.map((r) => r.merchant_ref)}::text[])`
    const req = await tx<{ value: { value?: boolean } }[]>`select value from crm.settings where key = 'ingest.require_manifest'`
    return { last: last[0]?.as_of ?? null, merchants: last[0]?.n ?? 0, requireManifest: req[0]?.value?.value === true }
  })
  const reason = check.last ? 'stale_as_of' : check.requireManifest && !file.manifest ? 'manifest_missing' : null
  if (!reason) return
  await withUser(sys.user.id, async (tx) => {
    await tx`insert into crm.ingest_batches (source, as_of, file_name, checksum, row_count, mode, status, reject_reason)
             values ('s5', ${file.as_of}, ${file.file_name}, ${checksum}, ${file.rows.length}, ${file.mode}, 'rejected', ${reason})
             on conflict (source, checksum) do nothing`
    await audit(tx, sys, 'integration.metrics_quarantined', 'ingest_batch', null, null, null, { as_of: file.as_of, rows: file.rows.length, reason, last_applied: check.last, merchants_ahead: check.merchants })
  })
  if (reason === 'stale_as_of')
    throw new DomainError('stale_cutoff',
      `El archivo trae corte al ${file.as_of} y ${check.merchants} de sus comercios ya tienen un corte posterior (al ${check.last}). Un corte anterior no cambia el estado de los comercios: no se aplicó nada.`,
      `The file has a cutoff of ${file.as_of} and ${check.merchants} of its merchants already have a later one (${check.last}). An earlier cutoff does not change merchant status: nothing was applied.`, 409)
  throw new DomainError('manifest_missing',
    'El archivo llegó sin manifiesto y Administración lo pide obligatorio. No se aplicó nada.',
    'The file arrived with no manifest and Administration requires one. Nothing was applied.', 409)
}

async function loadMetrics(sys: Ctx, file: MetricsFile, checksum: string): Promise<MetricsResult> {
  return withUser(sys.user.id, async (tx) => {
    const seen = await tx`select 1 from crm.ingest_batches where source = 's5' and checksum = ${checksum}`
    if (seen[0]) return { status: 'duplicate', rows: file.rows.length, matched: 0, unmatched: 0, dealsWon: 0 }
    // REL-10: un archivo completo cuyo tamaño cambia más de ±20% contra el anterior no se aplica: queda en cuarentena.
    if (file.mode === 'full') {
      const prev = await tx<{ row_count: number }[]>`select row_count from crm.ingest_batches
        where source = 's5' and mode = 'full' and status = 'loaded' order by as_of desc, loaded_at desc limit 1`
      const before = prev[0]?.row_count
      if (before && Math.abs(file.rows.length - before) / before > MAX_ROW_DELTA) return { status: 'quarantined', rows: file.rows.length, matched: 0, unmatched: 0, dealsWon: 0 }
    }
    const batch = await tx<{ id: string }[]>`
      insert into crm.ingest_batches (source, as_of, file_name, checksum, row_count, mode)
      values ('s5', ${file.as_of}, ${file.file_name}, ${checksum}, ${file.rows.length}, ${file.mode})
      on conflict (source, checksum) do nothing returning id`
    if (!batch[0]) return { status: 'duplicate', rows: file.rows.length, matched: 0, unmatched: 0, dealsWon: 0 }
    const batchId = batch[0].id
    const rows = tx.json(file.rows as never)
    if (file.manifest) await tx`update crm.ingest_batches set manifest = ${tx.json(file.manifest as never)} where id = ${batchId}`
    // PIPE-06: un corte que ya estaba cargado y llega con otras cifras no se sobrescribe en silencio: el antes y el después quedan guardados.
    const restatedRows = await recordRestatements(tx, file, batchId)

    const loaded = await tx<{ account_id: string }[]>`
      with r as (
        select * from jsonb_to_recordset(${rows}) as x(merchant_ref text, first_txn_at timestamptz, last_txn_at timestamptz,
               txn_count_30d int, volume_minor_30d bigint, currency text, active_days_30d int, status text, tpv_by_product jsonb, commission_minor_30d bigint)
      ), m as (
        select distinct on (al.account_id) r.*, al.account_id, a.market_code
          from r join crm.account_aliases al on al.external_id = r.merchant_ref and al.system in ('s5','sales_core') and al.valid_to is null
                 join crm.accounts a on a.id = al.account_id and a.archived_at is null
      )
      insert into crm.merchant_metrics_daily (account_id, as_of, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d, status, batch_id, tpv_by_product, commission_minor_30d)
      select account_id, ${file.as_of}, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d, status, ${batchId}, tpv_by_product, commission_minor_30d from m
      on conflict (account_id, as_of) do update set first_txn_at = coalesce(crm.merchant_metrics_daily.first_txn_at, excluded.first_txn_at),
        last_txn_at = excluded.last_txn_at, txn_count_30d = excluded.txn_count_30d, volume_minor_30d = excluded.volume_minor_30d,
        active_days_30d = excluded.active_days_30d, status = excluded.status, batch_id = excluded.batch_id,
        tpv_by_product = excluded.tpv_by_product, commission_minor_30d = excluded.commission_minor_30d
      returning account_id`
    const ids = loaded.map((r) => r.account_id)
    const unmatched = file.rows.length - ids.length

    // PIPE-06: el deal se gana con la primera transacción real, con la fecha de esa transacción.
    const won = await tx<{ id: string; account_id: string; market_code: string }[]>`
      with target as (
        select d.id, d.stage_id as from_stage, w.id as to_stage, d.market_code, d.account_id, mm.first_txn_at
          from crm.deals d
          join crm.merchant_metrics_daily mm on mm.account_id = d.account_id and mm.as_of = ${file.as_of} and mm.first_txn_at is not null
          join crm.pipelines p on p.id = d.pipeline_id and (p.close_by_transaction or p.txn_also_wins)   -- E14.F8: contrato firmado, o primera transacción
          join lateral (select s.id from crm.stages s where s.pipeline_id = d.pipeline_id and s.kind = 'won' limit 1) w on true
         where d.status = 'open' and d.account_id = any(${ids}::uuid[])
      ), ev as (
        insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause)
        select id, market_code, from_stage, to_stage, ${sys.user.id}, 'transaction' from target
      )
      update crm.deals d set status = 'won', stage_id = t.to_stage, won_at = t.first_txn_at, closed_by = 'transaction',
             stage_entered_at = now(), revisit_needed = false
        from target t where d.id = t.id
      returning d.id, d.account_id, d.market_code`

    // CS-01: al activarse, el comercio cambia de etapa de vida y el handoff a operaciones nace con dueño y fecha.
    await tx`
      insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by, source)
      select d.market_code, d.account_id, d.id, 'handoff',
             case when mk.default_locale = 'en' then 'Handoff: welcome call and activation follow-up' else 'Entrega a Operaciones: bienvenida y seguimiento de activación' end,
             now() + interval '2 days',
             coalesce((select m.user_id from crm.memberships m where m.market_code = d.market_code and m.role = 'ops' and (m.valid_to is null or m.valid_to > now()) order by m.created_at limit 1), d.owner_id),
             ${sys.user.id}, 's5'
        from crm.deals d join crm.markets mk on mk.code = d.market_code
       where d.id = any(${won.map((w) => w.id)}::uuid[])`
    // CS-01: la entrega a Operaciones también queda como entrega con lista y acuse (no solo como tarea).
    await openSalesToOpsHandoffs(tx, sys, won.map((w) => w.id))
    // CS-01: cada cambio de etapa que hace esta carga queda en el historial con su origen: el archivo de ventas.
    await tx`select set_config('app.lifecycle_source', 'sales_file', true)`
    // REP-04: si el archivo trae el estado, manda el archivo. CONTIGO no lo recalcula con otra lógica.
    await tx`update crm.accounts a set lifecycle = mm.status
              from crm.merchant_metrics_daily mm
             where mm.account_id = a.id and mm.as_of = ${file.as_of} and a.id = any(${ids}::uuid[]) and mm.status is not null
               and a.lifecycle <> mm.status
               and (a.lifecycle in ('active','at_risk','inactive') or (a.lifecycle in ('prospect','onboarding') and mm.first_txn_at is not null))`
    // Regla de respaldo, solo para las filas que llegan sin estado.
    await tx`update crm.accounts a set lifecycle = 'active'
              from crm.merchant_metrics_daily mm
             where mm.account_id = a.id and mm.as_of = ${file.as_of} and a.id = any(${ids}::uuid[]) and mm.status is null
               and ((a.lifecycle in ('prospect','onboarding') and mm.first_txn_at is not null)
                    or (a.lifecycle in ('at_risk','inactive') and mm.active_days_30d >= app.lifecycle_recover_at(a.id)))`
    const cooled = await tx<{ id: string; name: string; owner_id: string | null; market_code: string; lifecycle: string }[]>`
             update crm.accounts a set lifecycle = case when mm.txn_count_30d = 0 then 'inactive' else 'at_risk' end
              from crm.merchant_metrics_daily mm
             where mm.account_id = a.id and mm.as_of = ${file.as_of} and a.id = any(${ids}::uuid[]) and mm.status is null
               and a.lifecycle in ('active','at_risk') and mm.active_days_30d < app.lifecycle_risk_below(a.id)
               and a.lifecycle <> case when mm.txn_count_30d = 0 then 'inactive' else 'at_risk' end
               and mm.first_txn_at < now() - interval '14 days'
         returning a.id, a.name, a.owner_id, a.market_code, a.lifecycle`
    await tx`select set_config('app.lifecycle_source', '', true)`
    // E13.F2 (dealer sin ventas): cuando un comercio activo deja de vender del todo, quien lo lleva se entera.
    for (const a of cooled.filter((x) => x.lifecycle === 'inactive' && x.owner_id))
      await notify(tx, sys, {
        to: a.owner_id!, kind: 'lifecycle', market: a.market_code, template: 'dealer_churned', link: `/comercios/${a.id}`, accountId: a.id, needsAction: false,
        title: [`${a.name} dejó de vender`, `${a.name} stopped selling`],
        body: [`No tiene ventas en los últimos 30 días, con corte al ${file.as_of}.`, `It has no sales in the last 30 days, as of ${file.as_of}.`],
        vars: { comercio: a.name, detalle: `Sin ventas en los últimos 30 días, con corte al ${file.as_of}.`, fecha: file.as_of },
      })

    await tx`update crm.ingest_batches set matched = ${ids.length}, unmatched = ${unmatched} where id = ${batchId}`
    // PIPE-06: hitos (primer fondeo y método, primera transacción, hábito), correcciones compensatorias y conversiones en cola.
    const closing = await applyClosing(tx, sys, file, batchId, won)
    for (const w of won) {
      await audit(tx, sys, 'deal.won_by_transaction', 'deal', w.id, w.market_code, { status: 'open' }, { status: 'won', as_of: file.as_of })
      // E13.F2 (dealer activo): quien lo vendió se entera de que la primera venta ya llegó.
      const info = await tx<{ owner_id: string | null; title: string; account: string }[]>`select d.owner_id, d.title, a.name as account from crm.deals d join crm.accounts a on a.id = d.account_id where d.id = ${w.id}`
      if (info[0]?.owner_id)
        await notify(tx, sys, {
          to: info[0].owner_id, kind: 'deal_won', market: w.market_code, template: 'dealer_active', link: `/deals/${w.id}`, accountId: w.account_id, dealId: w.id, needsAction: false,
          title: [`${info[0].account} ya vende: negocio ganado`, `${info[0].account} is selling: deal won`],
          body: [`${info[0].title} se ganó con la primera transacción, con corte al ${file.as_of}.`, `${info[0].title} was won by the first transaction, as of ${file.as_of}.`],
          vars: { comercio: info[0].account, negocio: info[0].title, fecha: file.as_of },
        })
      await emit(tx, 'deal.won', 'deal', w.id, w.market_code, { account_id: w.account_id, closed_by: 'transaction' })
    }
    await audit(tx, sys, 'integration.metrics_loaded', 'ingest_batch', batchId, null, null,
      { as_of: file.as_of, rows: file.rows.length, matched: ids.length, unmatched, deals_won: won.length, funded: closing.funded, corrections: closing.corrections, restated_rows: restatedRows })
    return { status: 'loaded', rows: file.rows.length, matched: ids.length, unmatched, dealsWon: won.length, batchId, funded: closing.funded, corrections: closing.corrections, restatedRows }
  })
}
