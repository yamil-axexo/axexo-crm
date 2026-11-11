import 'server-only'
import type { Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import type postgres from 'postgres'

type Json = postgres.JSONValue

/** OBS-03: cada cambio de negocio deja un evento de auditoría en la misma transacción. */
export async function audit(
  tx: Tx,
  ctx: Ctx,
  action: string,
  object: string,
  objectId: string | null,
  market: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  await tx`insert into crm.audit_events (actor_id, action, object, object_id, market_code, before, after)
           values (${ctx.user.id}, ${action}, ${object}, ${objectId}, ${market},
                   ${before ? tx.json(before as Json) : null}, ${after ? tx.json(after as Json) : null})`
}

/** REL-06: el evento sale por el outbox, en la misma transacción que el cambio. */
export async function emit(
  tx: Tx,
  eventType: string,
  aggregate: string,
  aggregateId: string,
  market: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx`insert into crm.outbox_events (event_type, aggregate, aggregate_id, market_code, payload)
           values (${eventType}, ${aggregate}, ${aggregateId}, ${market}, ${tx.json(payload as Json)})`
}

export async function newId(tx: Tx): Promise<string> {
  const rows = await tx<{ id: string }[]>`select app.uuid_v7() as id`
  return rows[0]!.id
}

export const clean = (s: string | null | undefined): string | null => {
  const v = (s ?? '').trim()
  return v ? v : null
}
