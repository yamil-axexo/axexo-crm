import 'server-only'
import type { Tx } from '@/server/db'

/**
 * AUT-02: lectura de la cola de eventos por consumidor, con cursor por transacción confirmada.
 * Cada consumidor (automatizaciones, avisos, señales en vivo) toma lo nuevo con `takeEvents`; lo tomado queda anotado en la
 * misma transacción, así que si el consumidor falla y su transacción se revierte, los eventos vuelven a estar disponibles.
 * Solo se entregan eventos de transacciones ya terminadas: una transacción larga que confirma tarde se toma cuando confirma,
 * no se salta (antes el cursor avanzaba por id con un margen de 2 segundos).
 */
export type OutboxEvent = {
  id: string
  event_type: string
  aggregate: string
  aggregate_id: string
  market_code: string | null
  payload: Record<string, unknown>
  version: number
  created_at: Date
}

export const CONSUMERS = ['automations', 'notices', 'live'] as const
export type Consumer = (typeof CONSUMERS)[number]

/** Toma hasta `limit` eventos para el consumidor. La primera vez solo fija desde dónde lee y devuelve nada. */
export async function takeEvents(tx: Tx, consumer: Consumer, limit = 200): Promise<OutboxEvent[]> {
  return [...(await tx<OutboxEvent[]>`select * from app.outbox_take(${consumer}, ${limit})`)]
}

export type ConsumerLag = { consumer: string; pending: number; taken: number; updated_at: Date }
export async function consumerLag(tx: Tx): Promise<ConsumerLag[]> {
  const rows = await tx<{ consumer: string; pending: string; taken: string; updated_at: Date }[]>`select * from app.outbox_lag()`
  return rows.map((r) => ({ consumer: r.consumer, pending: Number(r.pending), taken: Number(r.taken), updated_at: r.updated_at }))
}
