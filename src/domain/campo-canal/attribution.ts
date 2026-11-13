import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'

/**
 * CANAL-03: la atribución nace completa en el alta, sin formulario aparte.
 * - Origen: red adquirida o alta nueva se decide por regla con la evidencia que el comercio ya trae (origen del comercio,
 *   ID de una red adquirida). Nunca se pregunta.
 * - Segunda capa (canal): el equipo que reclutó la tienda. Si la reclutó una agencia o un aliado (crm.agencies, el mismo
 *   modelo que "Reclutado por" y la agencia confinada), la capa es de ese aliado; si no, del equipo de quien la trajo.
 * Una sola regla para todos los caminos de alta: pantalla, lead convertido, Sales App y carga de una red.
 */
export const NETWORK_SYSTEMS = ['emida', 'sky', 'movilway'] as const
export type OriginKind = 'network_conversion' | 'new_acquisition'
export type OriginEvidence = 'merchant_origin' | 'network_alias' | 'network_load' | 'created_here'

type AccFacts = { merchant_origin: string | null; network_alias: boolean }

/** La regla, sin base: con la evidencia del comercio decide el origen y dice por qué. */
export function classifyOrigin(a: AccFacts): { kind: OriginKind; evidence: OriginEvidence } {
  if (a.merchant_origin === 'emida_conversion' || a.merchant_origin === 'network_conversion') return { kind: 'network_conversion', evidence: 'merchant_origin' }
  if (a.network_alias) return { kind: 'network_conversion', evidence: 'network_alias' }
  if (a.merchant_origin === 'new_acquisition') return { kind: 'new_acquisition', evidence: 'merchant_origin' }
  return { kind: 'new_acquisition', evidence: 'created_here' }
}

const EVIDENCE_TEXT: Record<OriginEvidence, string> = {
  merchant_origin: 'Clasificado por regla: origen del comercio',
  network_alias: 'Clasificado por regla: trae ID de una red adquirida',
  network_load: 'Clasificado por regla: carga de una red adquirida',
  created_here: 'Clasificado por regla: alta hecha en CONTIGO o en la Sales App',
}

async function facts(tx: Tx, accountId: string): Promise<(AccFacts & { market_code: string; owner_id: string | null; created_by: string | null; recruited_by: string | null; recruited_agency_id: string | null }) | null> {
  const rows = await tx<(AccFacts & { market_code: string; owner_id: string | null; created_by: string | null; recruited_by: string | null; recruited_agency_id: string | null })[]>`
    select a.market_code, a.merchant_origin, a.owner_id, a.created_by, a.recruited_by, a.recruited_agency_id,
           exists (select 1 from crm.account_aliases x where x.account_id = a.id and x.system = any(${[...NETWORK_SYSTEMS]}::text[])) as network_alias
      from crm.accounts a where a.id = ${accountId}`
  return rows[0] ?? null
}

/** Quién reclutó: el aliado (agencia o partner) si lo hay; si no, el equipo vigente de quien lo trajo en ese mercado. */
export async function recruiterParty(tx: Tx, accountId: string): Promise<{ kind: 'partner' | 'team'; ref: string; label: string } | null> {
  const f = await facts(tx, accountId)
  if (!f) return null
  if (f.recruited_agency_id) {
    const g = (await tx<{ name: string }[]>`select name from crm.agencies where id = ${f.recruited_agency_id}`)[0]
    if (g) return { kind: 'partner', ref: f.recruited_agency_id, label: g.name }
  }
  const person = f.owner_id ?? f.created_by
  const team = person
    ? (await tx<{ id: string; name: string }[]>`
        select t.id, t.name from crm.memberships mm join crm.teams t on t.id = mm.team_id
         where mm.user_id = ${person} and mm.market_code = ${f.market_code} and mm.valid_from <= now() and (mm.valid_to is null or mm.valid_to > now())
         order by mm.valid_from desc limit 1`)[0]
    : undefined
  if (team) return { kind: 'team', ref: team.id, label: team.name }
  return { kind: 'team', ref: 'field_team', label: 'Equipo propio' }
}

/**
 * Se llama en cada alta, en la misma transacción: clasifica el origen vigente si no lo está y deja la capa de canal con
 * el equipo reclutador si todavía no hay una. No pisa nada que alguien ya haya puesto.
 */
export async function stampAttributionTx(tx: Tx, actorId: string | null, accountId: string): Promise<void> {
  const f = await facts(tx, accountId)
  if (!f) return
  const origin = classifyOrigin(f)
  await tx`update crm.account_attributions set origin_kind = ${origin.kind}, reason = coalesce(reason, ${EVIDENCE_TEXT[origin.evidence]})
            where account_id = ${accountId} and layer = 'origin' and effective_to is null and origin_kind is null`
  const hasChannel = await tx`select 1 from crm.account_attributions where account_id = ${accountId} and layer = 'channel' and effective_to is null`
  if (!hasChannel[0]) {
    const r = await recruiterParty(tx, accountId)
    if (r) await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by, reason)
                    values (${accountId}, ${f.market_code}, 'channel', ${r.kind}, ${r.ref}, ${r.label}, ${actorId}, 'Equipo reclutador al dar de alta')`
  }
}

/**
 * Corrida auditada para lo que ya existía: clasifica cada origen vigente sin clasificar con la misma regla del alta y,
 * donde la capa de canal guarda el tipo de venta (D2D, B2B) en vez de un equipo, abre la fila nueva con el equipo
 * reclutador (la anterior se cierra, no se edita). Deja un evento en la bitácora con los conteos.
 */
export async function reclassifyAttributionTx(tx: Tx, actor: Ctx, market: string): Promise<{ classified: number; network: number; acquisition: number; channels: number }> {
  const pending = await tx<{ account_id: string }[]>`
    select t.account_id from crm.account_attributions t join crm.accounts a on a.id = t.account_id
     where t.market_code = ${market} and t.layer = 'origin' and t.effective_to is null and t.origin_kind is null and a.archived_at is null`
  let network = 0
  let acquisition = 0
  for (const p of pending) {
    const f = await facts(tx, p.account_id)
    if (!f) continue
    const o = classifyOrigin(f)
    const res = await tx`update crm.account_attributions set origin_kind = ${o.kind}, reason = coalesce(reason, ${EVIDENCE_TEXT[o.evidence]})
                          where account_id = ${p.account_id} and layer = 'origin' and effective_to is null and origin_kind is null`
    if (res.count) o.kind === 'network_conversion' ? network++ : acquisition++
  }
  // Capa de canal heredada (guardaba el tipo de venta): se reemplaza por el equipo reclutador, como fila nueva.
  const legacy = await tx<{ id: string; account_id: string }[]>`
    select t.id, t.account_id from crm.account_attributions t join crm.accounts a on a.id = t.account_id
     where t.market_code = ${market} and t.layer = 'channel' and t.effective_to is null and t.party_kind = 'team'
       and t.party_ref <> 'field_team' and not exists (select 1 from crm.teams tm where tm.id::text = t.party_ref) and a.archived_at is null`
  let channels = 0
  for (const l of legacy) {
    const r = await recruiterParty(tx, l.account_id)
    if (!r) continue
    await tx`update crm.account_attributions set effective_to = now() where id = ${l.id}`
    await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by, reason, correction_of)
             values (${l.account_id}, ${market}, 'channel', ${r.kind}, ${r.ref}, ${r.label}, ${actor.user.id}, 'Corrida de clasificación: equipo reclutador en vez del tipo de venta', ${l.id})`
    channels++
  }
  // Comercios sin capa de canal: la reciben.
  const missing = await tx<{ id: string }[]>`
    select a.id from crm.accounts a where a.market_code = ${market} and a.archived_at is null and a.merged_into is null
       and not exists (select 1 from crm.account_attributions t where t.account_id = a.id and t.layer = 'channel' and t.effective_to is null)
       and exists (select 1 from crm.account_attributions t where t.account_id = a.id and t.layer = 'origin')`
  for (const m of missing) {
    const r = await recruiterParty(tx, m.id)
    if (!r) continue
    await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by, reason)
             values (${m.id}, ${market}, 'channel', ${r.kind}, ${r.ref}, ${r.label}, ${actor.user.id}, 'Corrida de clasificación: equipo reclutador')`
    channels++
  }
  const out = { classified: network + acquisition, network, acquisition, channels }
  await audit(tx, actor, 'attribution.reclassified', 'market', null, market, null, out)
  return out
}

export async function reclassifyAttribution(ctx: Ctx, market: string): Promise<{ classified: number; network: number; acquisition: number; channels: number }> {
  ctx.assert('attribution.correct', market)
  ctx.market(market)
  return withUser(ctx.user.id, (tx) => reclassifyAttributionTx(tx, ctx, market))
}
