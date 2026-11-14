import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { notify, notifyMany, peopleWithRole } from '@/domain/notify'
import { invalid, notFound } from '@/lib/errors'
import { threshold } from './thresholds'
import { channelPolicyTx } from './canal2'
import { fundingFeed, type FundingRow } from '@/server/adapters/funding-feed'

const UUID = /^[0-9a-f-]{36}$/i

// ------------------------------------------------------------------------------------------------ CANAL-03 correcciones
/** Capas que se corrigen desde aquí. Quién lo lleva (owner) se cambia con el reparto, que ya cierra y abre su fila. */
export const CORRECTABLE = ['origin', 'channel'] as const
export const PARTY_KINDS = ['user', 'team', 'partner'] as const
export const ORIGIN_KINDS = ['network_conversion', 'new_acquisition'] as const

export type Correction = { layer: string; partyKind: string; partyRef: string; partyLabel: string; reason: string; originKind?: string | null }
const corr = z.object({
  layer: z.enum(CORRECTABLE),
  partyKind: z.enum(PARTY_KINDS),
  partyRef: z.string().trim().min(1).max(80),
  partyLabel: z.string().trim().min(2).max(120),
  reason: z.string().trim().min(3).max(300),
  originKind: z.enum(ORIGIN_KINDS).nullish().or(z.literal('')),
})

/**
 * Corrección como fila nueva: la vigente se cierra (no se edita su contenido) y la nueva apunta a ella en correction_of,
 * con motivo. La base impide dos filas vigentes encimadas en la misma capa (restricción de exclusión).
 */
export async function correctAttributionTx(tx: Tx, ctx: Ctx, accountId: string, raw: Correction): Promise<string> {
  const p = corr.safeParse(raw)
  if (!p.success) throw invalid('Elige la capa, a quién corresponde y escribe el motivo.', 'Choose the layer, who it belongs to and write the reason.')
  const d = p.data
  assertNoProhibited(d.partyLabel, d.reason)
  const acc = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${accountId} for update`)[0]
  if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
  const cur = (await tx<{ id: string; party_label: string; origin_kind: string | null }[]>`
    select id, party_label, origin_kind from crm.account_attributions where account_id = ${accountId} and layer = ${d.layer} and effective_to is null for update`)[0]
  if (cur) await tx`update crm.account_attributions set effective_to = now() where id = ${cur.id}`
  const originKind = d.layer === 'origin' ? (d.originKind || cur?.origin_kind || null) : null
  const rows = await tx<{ id: string }[]>`
    insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by, reason, correction_of, origin_kind)
    values (${accountId}, ${acc.market_code}, ${d.layer}, ${d.partyKind}, ${d.partyRef}, ${d.partyLabel}, ${ctx.user.id}, ${d.reason}, ${cur?.id ?? null}, ${originKind})
    returning id`
  await audit(tx, ctx, 'attribution.corrected', 'account', accountId, acc.market_code, cur ? { layer: d.layer, party: cur.party_label, origin_kind: cur.origin_kind } : null,
    { layer: d.layer, party: d.partyLabel, origin_kind: originKind, reason: d.reason, correction_of: cur?.id ?? null })
  return rows[0]!.id
}

export async function correctAttribution(ctx: Ctx, accountId: string, raw: Correction): Promise<string> {
  if (!UUID.test(accountId)) throw notFound()
  return withUser(ctx.user.id, async (tx) => {
    const m = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${accountId}`)[0]
    if (!m) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('attribution.correct', m.market_code)
    return correctAttributionTx(tx, ctx, accountId, raw)
  })
}

// ------------------------------------------------------------------------------------------------ CANAL-08 disputas
const disputeIn = z.object({
  accountId: z.guid(), layer: z.enum(CORRECTABLE), kind: z.enum(['dispute', 'adjustment', 'reversal']),
  claimedKind: z.enum(PARTY_KINDS), claimedRef: z.string().trim().min(1).max(80), claimedLabel: z.string().trim().min(2).max(120), reason: z.string().trim().min(5).max(500),
})

export async function raiseDispute(ctx: Ctx, raw: Record<string, string>): Promise<string> {
  const p = disputeIn.safeParse(raw)
  if (!p.success) throw invalid('Elige el comercio, la capa, a quién debería corresponder y explica por qué (al menos unas palabras).', 'Choose the merchant, the layer, who it should belong to and explain why (at least a few words).')
  const d = p.data
  assertNoProhibited(d.claimedLabel, d.reason)
  return withUser(ctx.user.id, async (tx) => {
    const acc = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${d.accountId}`)[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('dispute.raise', acc.market_code)
    const open = await tx`select 1 from crm.attribution_disputes where account_id = ${d.accountId} and layer = ${d.layer} and status = 'open'`
    if (open[0]) throw invalid('Ya hay una disputa abierta sobre esa capa de este comercio.', 'There is already an open dispute on that layer of this merchant.')
    const sla = await threshold(tx, acc.market_code, 'dispute_sla_days')
    const rows = await tx<{ id: string }[]>`
      insert into crm.attribution_disputes (account_id, market_code, layer, kind, claimant_id, claimed_kind, claimed_ref, claimed_label, reason, sla_due_at)
      values (${d.accountId}, ${acc.market_code}, ${d.layer}, ${d.kind}, ${ctx.user.id}, ${d.claimedKind}, ${d.claimedRef}, ${d.claimedLabel}, ${d.reason}, now() + make_interval(days => ${sla.value}))
      returning id`
    const id = rows[0]!.id
    await audit(tx, ctx, 'dispute.raised', 'attribution_dispute', id, acc.market_code, null, { account_id: d.accountId, layer: d.layer, kind: d.kind, claimed: d.claimedLabel, sla_days: sla.value })
    await notifyMany(tx, ctx, (await peopleWithRole(tx, acc.market_code, ['market_lead'])).filter((u) => u !== ctx.user.id), {
      kind: 'lifecycle', market: acc.market_code, link: '/campo?tab=disputas', needsAction: true,
      title: ['Disputa de atribución por resolver', 'Attribution dispute to resolve'], body: [`Plazo: ${sla.value} días.`, `Deadline: ${sla.value} days.`],
    })
    return id
  })
}

/** Quien arbitra (no puede ser quien la levantó) aprueba o rechaza; aprobar crea la fila corregida con correction_of. */
export async function resolveDispute(ctx: Ctx, id: string, decision: string, rawResolution: string): Promise<void> {
  if (!UUID.test(id)) throw notFound()
  if (decision !== 'approve' && decision !== 'reject') throw invalid('Elige aprobar o rechazar.', 'Choose approve or reject.')
  const resolution = clean(rawResolution)
  if (!resolution || resolution.length < 3) throw invalid('Escribe la resolución: queda en la bitácora.', 'Write the resolution: it stays in the log.')
  assertNoProhibited(resolution)
  await withUser(ctx.user.id, async (tx) => {
    // Primero el permiso (quien levantó la disputa la ve, pero no la puede tocar), luego el candado de la fila.
    const seen = (await tx<{ market_code: string }[]>`select market_code from crm.attribution_disputes where id = ${id}`)[0]
    if (!seen) throw notFound('No encontramos esa disputa.', 'We could not find that dispute.')
    ctx.assert('dispute.arbitrate', seen.market_code)
    const d = (await tx<{ account_id: string; market_code: string; layer: string; status: string; claimant_id: string; claimed_kind: string; claimed_ref: string; claimed_label: string; reason: string }[]>`
      select account_id, market_code, layer, status, claimant_id, claimed_kind, claimed_ref, claimed_label, reason from crm.attribution_disputes where id = ${id} for update`)[0]
    if (!d) throw notFound('No encontramos esa disputa.', 'We could not find that dispute.')
    ctx.assert('dispute.arbitrate', d.market_code)
    if (d.status !== 'open') throw invalid('Esa disputa ya se resolvió.', 'That dispute was already resolved.')
    if (d.claimant_id === ctx.user.id) throw invalid('No puedes arbitrar una disputa que levantaste tú. La resuelve otra persona que lidere el mercado o administración.', 'You cannot arbitrate a dispute you raised. Another market lead or administration resolves it.')
    // CANAL-08: si la política escrita del mercado nombra a quien arbitra, solo esa persona (o administración) resuelve.
    const pol = await channelPolicyTx(tx, d.market_code)
    if (pol?.arbiter_id && pol.arbiter_id !== ctx.user.id && !ctx.isAdmin) throw invalid(`La política del mercado nombra a ${pol.arbiter ?? 'otra persona'} como quien arbitra.`, `The market policy names ${pol.arbiter ?? 'someone else'} as the arbiter.`)
    let correctionId: string | null = null
    if (decision === 'approve') {
      correctionId = await correctAttributionTx(tx, ctx, d.account_id, { layer: d.layer, partyKind: d.claimed_kind, partyRef: d.claimed_ref, partyLabel: d.claimed_label, reason: `Disputa aprobada: ${resolution}`.slice(0, 300) })
    }
    await tx`update crm.attribution_disputes set status = ${decision === 'approve' ? 'approved' : 'rejected'}, arbiter_id = ${ctx.user.id}, resolution = ${resolution}, resolved_at = now(), correction_id = ${correctionId} where id = ${id}`
    await audit(tx, ctx, 'dispute.resolved', 'attribution_dispute', id, d.market_code, { status: 'open' }, { status: decision === 'approve' ? 'approved' : 'rejected', correction_id: correctionId })
    await notify(tx, ctx, { to: d.claimant_id, kind: 'lifecycle', market: d.market_code, link: '/campo?tab=disputas', needsAction: false,
      title: decision === 'approve' ? ['Aprobaron tu disputa', 'Your dispute was approved'] : ['Rechazaron tu disputa', 'Your dispute was rejected'], body: [resolution, resolution] })
  })
}

// ------------------------------------------------------------------------------------------------ CANAL-02 registros de canal
const claimIn = z.object({
  market: z.string().min(2).max(3), storeName: z.string().trim().min(2).max(160), city: z.string().trim().max(80).optional().default(''),
  nodeRef: z.string().trim().min(1).max(80), nodeLabel: z.string().trim().min(2).max(120), channel: z.string().trim().regex(/^[a-z0-9_]{2,30}$/),
})
export type ClaimOutcome = { status: 'registered'; id: string; until: Date } | { status: 'held'; until: Date } | { status: 'customer' }

/**
 * Registrar una tienda u oportunidad a nombre de un canal. El primero que llega la tiene durante la ventana; quien llega
 * después recibe solo "ya tiene registro vigente hasta tal fecha" (sin saber de quién) y su intento queda rechazado con motivo.
 * Una tienda que ya es cliente no se registra.
 */
export async function registerClaim(ctx: Ctx, raw: Record<string, string>): Promise<ClaimOutcome> {
  const p = claimIn.safeParse(raw)
  if (!p.success) throw invalid('Escribe la tienda, el aliado que la registra y el canal.', 'Write the store, the partner registering it and the channel.')
  const d = p.data
  ctx.assert('claim.manage', d.market)
  assertNoProhibited(d.storeName, d.nodeLabel, d.city)
  return withUser(ctx.user.id, async (tx) => {
    const key = (await tx<{ k: string }[]>`select app.norm(${d.storeName}) || '|' || app.norm(${d.city}) as k`)[0]!.k
    const customer = await tx`select 1 from crm.accounts a where a.market_code = ${d.market} and a.name_norm = app.norm(${d.storeName})
                               and a.lifecycle in ('active', 'at_risk', 'onboarding') and a.archived_at is null limit 1`
    const win = await threshold(tx, d.market, 'claim_window_days')
    if (customer[0]) {
      await tx`insert into crm.channel_claims (market_code, store_name, store_key, node_ref, node_label, channel, status, expires_at, rejection_reason, registered_by, closed_at)
               values (${d.market}, ${d.storeName}, ${key}, ${d.nodeRef}, ${d.nodeLabel}, ${d.channel}, 'rejected', now(), 'La tienda ya es cliente', ${ctx.user.id}, now())`
      await audit(tx, ctx, 'claim.rejected', 'channel_claim', null, d.market, null, { reason: 'customer', node: d.nodeLabel })
      return { status: 'customer' }
    }
    const held = (await tx<{ id: string; node_ref: string; expires_at: Date }[]>`
      select id, node_ref, expires_at from crm.channel_claims where market_code = ${d.market} and store_key = ${key} and status = 'active' for update`)[0]
    if (held && held.node_ref !== d.nodeRef) {
      await tx`insert into crm.channel_claims (market_code, store_name, store_key, node_ref, node_label, channel, status, expires_at, rejection_reason, registered_by, closed_at)
               values (${d.market}, ${d.storeName}, ${key}, ${d.nodeRef}, ${d.nodeLabel}, ${d.channel}, 'rejected', now(), 'Ya tiene registro vigente de otro canal', ${ctx.user.id}, now())`
      await audit(tx, ctx, 'claim.rejected', 'channel_claim', held.id, d.market, null, { reason: 'held', node: d.nodeLabel })
      return { status: 'held', until: held.expires_at }
    }
    if (held) return { status: 'registered', id: held.id, until: held.expires_at }
    const rows = await tx<{ id: string; expires_at: Date }[]>`
      insert into crm.channel_claims (market_code, store_name, store_key, node_ref, node_label, channel, expires_at, registered_by)
      values (${d.market}, ${d.storeName}, ${key}, ${d.nodeRef}, ${d.nodeLabel}, ${d.channel}, now() + make_interval(days => ${win.value}), ${ctx.user.id})
      returning id, expires_at`
    await audit(tx, ctx, 'claim.registered', 'channel_claim', rows[0]!.id, d.market, null, { node: d.nodeLabel, channel: d.channel, window_days: win.value, window_version: win.version })
    return { status: 'registered', id: rows[0]!.id, until: rows[0]!.expires_at }
  })
}

/** Extender la ventana solo con evidencia de actividad, hasta el máximo de extensiones. */
export async function extendClaim(ctx: Ctx, id: string, rawEvidence: string): Promise<void> {
  const evidence = clean(rawEvidence)
  if (!evidence || evidence.length < 5) throw invalid('Cuenta qué actividad hubo con la tienda (visita, propuesta, llamada).', 'Say what activity there was with the store (visit, proposal, call).')
  assertNoProhibited(evidence)
  if (!UUID.test(id)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const c = (await tx<{ market_code: string; status: string; extensions: number }[]>`select market_code, status, extensions from crm.channel_claims where id = ${id} for update`)[0]
    if (!c) throw notFound('No encontramos ese registro.', 'We could not find that registration.')
    ctx.assert('claim.manage', c.market_code)
    if (c.status !== 'active') throw invalid('Ese registro ya no está vigente.', 'That registration is no longer active.')
    const max = await threshold(tx, c.market_code, 'claim_max_extensions')
    if (c.extensions >= max.value) throw invalid('Ese registro ya usó todas sus extensiones.', 'That registration has used all its extensions.')
    const days = await threshold(tx, c.market_code, 'claim_extension_days')
    await tx`update crm.channel_claims set expires_at = expires_at + make_interval(days => ${days.value}), extensions = extensions + 1, evidence = ${evidence.slice(0, 500)} where id = ${id}`
    await audit(tx, ctx, 'claim.extended', 'channel_claim', id, c.market_code, { extensions: c.extensions }, { extensions: c.extensions + 1, days: days.value })
  })
}

export async function rejectClaim(ctx: Ctx, id: string, rawReason: string): Promise<void> {
  const reason = clean(rawReason)
  if (!reason || reason.length < 3) throw invalid('Escribe el motivo del rechazo: se le comunica al aliado.', 'Write the reason for the rejection: the partner is told.')
  assertNoProhibited(reason)
  if (!UUID.test(id)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const c = (await tx<{ market_code: string; status: string }[]>`select market_code, status from crm.channel_claims where id = ${id} for update`)[0]
    if (!c) throw notFound('No encontramos ese registro.', 'We could not find that registration.')
    ctx.assert('claim.manage', c.market_code)
    if (c.status !== 'active') throw invalid('Ese registro ya no está vigente.', 'That registration is no longer active.')
    await tx`update crm.channel_claims set status = 'rejected', rejection_reason = ${reason.slice(0, 300)}, closed_at = now() where id = ${id}`
    await audit(tx, ctx, 'claim.rejected', 'channel_claim', id, c.market_code, { status: 'active' }, { status: 'rejected', reason })
  })
}

/** Tarea programada: los registros cuya ventana pasó quedan vencidos (la tienda vuelve a estar libre). */
export async function expireClaimsTx(tx: Tx): Promise<number> {
  const rows = await tx`update crm.channel_claims set status = 'expired', closed_at = now() where status = 'active' and expires_at < now() returning id`
  return rows.count
}

// ------------------------------------------------------------------------------------------------ CANAL-07 fondeo y crédito
/** Carga filas de fondeo (del archivo de ventas o del simulador). Nunca desde un formulario de captura de saldo. */
export async function ingestFundingTx(tx: Tx, rows: FundingRow[], source: 'sales_file' | 'simulator'): Promise<number> {
  let n = 0
  for (const r of rows) {
    const acc = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${r.account_id}`)[0]
    if (!acc) continue
    const res = await tx`insert into crm.account_funding (account_id, market_code, method, balance_minor, credit_limit_minor, as_of, source)
             values (${r.account_id}, ${acc.market_code}, ${r.method}, ${r.balance_minor}, ${r.credit_limit_minor}, ${r.as_of}::date, ${source})
             on conflict (account_id, as_of, source) do nothing`
    n += res.count
  }
  return n
}

/** Lee el archivo de ventas por el adaptador (apagado: no entra nada). La usa la tarea programada. */
export async function pullFundingTx(tx: Tx): Promise<number> {
  return ingestFundingTx(tx, await fundingFeed().pull(), 'sales_file')
}

const simIn = z.object({ accountId: z.guid(), method: z.enum(['prepaid', 'ach_credit']), balance: z.coerce.number().min(-1e9).max(1e9), creditLimit: z.coerce.number().min(0).max(1e9).optional() })
/** Simulador para probar la ficha y los avisos fuera de producción. La fila queda marcada como simulada. */
export async function simulateFunding(ctx: Ctx, raw: Record<string, string>): Promise<void> {
  if (process.env.APP_ENV === 'production') throw invalid('El simulador no está disponible en producción.', 'The simulator is not available in production.')
  const p = simIn.safeParse(raw)
  if (!p.success) throw invalid('Elige el comercio, el método y un saldo de prueba.', 'Choose the merchant, the method and a test balance.')
  const d = p.data
  await withUser(ctx.user.id, async (tx) => {
    const acc = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${d.accountId}`)[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('funding.simulate', acc.market_code)
    const asOf = (await tx<{ d: string }[]>`select (now() at time zone coalesce((select timezone from crm.markets where code = ${acc.market_code}), 'UTC'))::date::text as d`)[0]!.d
    const n = await ingestFundingTx(tx, [{ account_id: d.accountId, method: d.method, balance_minor: Math.round(d.balance * 100), credit_limit_minor: d.method === 'ach_credit' ? Math.round((d.creditLimit ?? 0) * 100) : null, as_of: asOf }], 'simulator')
    if (n === 0) throw invalid('Ya hay un dato simulado de hoy para este comercio.', 'There is already a simulated value for today for this merchant.')
    await audit(tx, ctx, 'funding.simulated', 'account', d.accountId, acc.market_code, null, { method: d.method, as_of: asOf })
  })
}

const creditIn = z.object({ accountId: z.guid(), amount: z.coerce.number().positive().max(1e9), reason: z.string().trim().min(5).max(300) })
export async function requestCreditLimit(ctx: Ctx, raw: Record<string, string>): Promise<string> {
  const p = creditIn.safeParse(raw)
  if (!p.success) throw invalid('Escribe el límite que pides y por qué.', 'Write the limit you are asking for and why.')
  const d = p.data
  assertNoProhibited(d.reason)
  return withUser(ctx.user.id, async (tx) => {
    const acc = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${d.accountId}`)[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('credit.request', acc.market_code)
    const open = await tx`select 1 from crm.credit_limit_requests where account_id = ${d.accountId} and status = 'requested'`
    if (open[0]) throw invalid('Ya hay una solicitud de límite esperando aprobación.', 'A limit request is already waiting for approval.')
    const rows = await tx<{ id: string }[]>`insert into crm.credit_limit_requests (account_id, market_code, amount_minor, reason, requested_by)
      values (${d.accountId}, ${acc.market_code}, ${Math.round(d.amount * 100)}, ${d.reason}, ${ctx.user.id}) returning id`
    await audit(tx, ctx, 'credit.requested', 'account', d.accountId, acc.market_code, null, { request_id: rows[0]!.id })
    return rows[0]!.id
  })
}

/** El límite es un dato aprobado por transición: lo decide alguien distinto de quien lo pidió. */
export async function decideCreditLimit(ctx: Ctx, id: string, decision: string, rawNote: string): Promise<void> {
  if (decision !== 'approve' && decision !== 'reject') throw invalid('Elige aprobar o rechazar.', 'Choose approve or reject.')
  const note = clean(rawNote)
  if (!note || note.length < 3) throw invalid('Escribe una nota de la decisión.', 'Write a note for the decision.')
  assertNoProhibited(note)
  if (!UUID.test(id)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const r = (await tx<{ account_id: string; market_code: string; status: string; requested_by: string }[]>`select account_id, market_code, status, requested_by from crm.credit_limit_requests where id = ${id} for update`)[0]
    if (!r) throw notFound('No encontramos esa solicitud.', 'We could not find that request.')
    ctx.assert('credit.approve', r.market_code)
    if (r.status !== 'requested') throw invalid('Esa solicitud ya se decidió.', 'That request was already decided.')
    if (r.requested_by === ctx.user.id) throw invalid('No puedes aprobar un límite que pediste tú.', 'You cannot approve a limit you requested.')
    await tx`update crm.credit_limit_requests set status = ${decision === 'approve' ? 'approved' : 'rejected'}, decided_by = ${ctx.user.id}, decided_at = now(), decision_note = ${note} where id = ${id}`
    await audit(tx, ctx, 'credit.decided', 'account', r.account_id, r.market_code, { status: 'requested' }, { status: decision === 'approve' ? 'approved' : 'rejected', request_id: id })
    await notify(tx, ctx, { to: r.requested_by, kind: 'lifecycle', market: r.market_code, link: `/campo?tab=credito&cuenta=${r.account_id}`, needsAction: false,
      title: decision === 'approve' ? ['Aprobaron el límite de crédito', 'The credit limit was approved'] : ['Rechazaron el límite de crédito', 'The credit limit was rejected'], body: [note, note] })
  })
}
