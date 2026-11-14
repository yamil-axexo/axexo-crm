import 'server-only'
import type { Tx } from '@/server/db'

/** Lo que saldría por un adaptador apagado del paquete partners-contratos queda a la vista en crm.external_queue (Estado de CONTIGO). */
export type ExternalItem = { adapter: 'esign' | 'external_identity' | 'gmail' | 'calendar' | 'whatsapp_capture'; object: string; objectId: string | null; market: string | null; summary: string; status: 'channel_off' | 'simulated' | 'sent' | 'failed' }
/** Deja a la vista lo que habría salido por un adaptador apagado. */
export async function queueExternal(tx: Tx, userId: string, i: ExternalItem): Promise<void> {
  await tx`insert into crm.external_queue (adapter, object, object_id, market_code, summary, status, created_by)
           values (${i.adapter}, ${i.object}, ${i.objectId}, ${i.market}, ${i.summary.slice(0, 300)}, ${i.status}, ${userId})`
}

