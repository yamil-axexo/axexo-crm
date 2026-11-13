import 'server-only'
import type { Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import type postgres from 'postgres'
import { decide, NO_AGGREGATE } from '@/domain/events/catalog'

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
  // AUT-02: todo cambio de dominio emite su evento en la misma transacción. La lista de qué emite y qué no vive en
  // domain/events/catalog.ts (decide). El evento lleva qué campos cambiaron, nunca sus valores.
  if (decide(action).emit === 'auto') {
    await emit(tx, action, object, objectId ?? NO_AGGREGATE, market, { changed: Object.keys(after ?? before ?? {}).sort(), actor_id: ctx.user.id })
  }
}

/** REL-06: el evento sale por el outbox, en la misma transacción que el cambio. */
export async function emit(
  tx: Tx,
  eventType: string,
  aggregate: string,
  aggregateId: string,
  market: string | null,
  payload: Record<string, unknown>,
  version = 1,
): Promise<void> {
  await tx`insert into crm.outbox_events (event_type, aggregate, aggregate_id, market_code, payload, version)
           values (${eventType}, ${aggregate}, ${aggregateId}, ${market}, ${tx.json(payload as Json)}, ${version})`
}

export async function newId(tx: Tx): Promise<string> {
  const rows = await tx<{ id: string }[]>`select app.uuid_v7() as id`
  return rows[0]!.id
}

export const clean = (s: string | null | undefined): string | null => {
  const v = (s ?? '').trim()
  return v ? v : null
}
