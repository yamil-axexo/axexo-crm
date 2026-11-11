'use server'

import { randomUUID } from 'node:crypto'
import { runAction, str } from '@/server/action'
import { systemCtx } from '@/server/context'
import { env } from '@/env'
import { createApiClient, endMembership, grantMembership, revokeApiClient, setRoutingMembers } from '@/domain/admin'
import { ingestMetricsFile, ingestSalesAppEvent } from '@/domain/integrations'
import { forbidden, invalid, type ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function grantMembershipAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await grantMembership(ctx, { email: str(fd, 'email'), fullName: str(fd, 'full_name'), role: str(fd, 'role') as 'rep', market: str(fd, 'market'), teamId: str(fd, 'team_id') }, env().AUTH_ALLOWED_DOMAIN)
    return { message: ['Acceso otorgado.', 'Access granted.'] }
  })
}

export async function endMembershipAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await endMembership(ctx, str(fd, 'id'))
    return { message: ['Acceso cerrado con fecha de hoy.', 'Access ended as of today.'] }
  })
}

export async function setRoutingMembersAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setRoutingMembers(ctx, str(fd, 'rule_id'), fd.getAll('member_id').filter((v): v is string => typeof v === 'string'))
    return { message: ['Turno actualizado.', 'Rotation updated.'] }
  })
}

export async function createApiClientAction(_: R | null, fd: FormData): Promise<R> {
  return runAction<string>(async (ctx) => {
    const out = await createApiClient(ctx, str(fd, 'name'), fd.getAll('scope').filter((v): v is string => typeof v === 'string'))
    return { data: out.key }
  })
}

export async function revokeApiClientAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await revokeApiClient(ctx, str(fd, 'id'))
    return { message: ['Llave revocada.', 'Key revoked.'] }
  })
}

// Las tres acciones de abajo mandan a la integración el mismo mensaje que mandaría el sistema real,
// por el mismo camino de código (contrato v1). Sirven para probar staging sin la Sales App ni S5 conectados.
function guard(ctx: { can: (c: 'integration.operate') => boolean }) {
  if (!ctx.can('integration.operate')) throw forbidden()
  if (env().APP_ENV === 'production') throw invalid('Las pruebas de integración no existen en producción.', 'Integration tests do not exist in production.')
}

export async function simulateVisitAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    guard(ctx)
    const outcome = str(fd, 'outcome')
    const now = new Date()
    const out = await ingestSalesAppEvent(await systemCtx(), {
      event_id: randomUUID(),
      type: 'visit.checked_out',
      version: 1,
      occurred_at: now.toISOString(),
      data: {
        visit_id: `SCV-${randomUUID().slice(0, 12)}`,
        customer_id: str(fd, 'customer_id'),
        salesperson_id: 'SC-U-staging',
        business_date: now.toISOString().slice(0, 10),
        checked_in_at: new Date(now.getTime() - 12 * 60000).toISOString(),
        checked_out_at: now.toISOString(),
        duration_seconds: 720,
        sale: outcome === 'sale',
        rejection_reason: outcome === 'revisit' ? 'owner_absent' : outcome === 'no_sale' ? 'has_stock' : null,
        revisit: outcome === 'revisit',
        revisit_reason: outcome === 'revisit' ? 'owner_absent' : null,
        decision_maker_present: outcome !== 'revisit',
        auto_closed: false,
      },
    })
    if (out.status === 'unmatched') return { message: ['El evento llegó, pero ese ID de la Sales App no existe aquí. Quedó en la cola de excepciones.', 'The event arrived, but that Sales App ID does not exist here. It went to the exception queue.'] }
    return { message: ['Evento recibido y procesado. Mira el timeline del comercio y su deal.', 'Event received and processed. Check the merchant’s timeline and its deal.'] }
  })
}

export async function simulateStoreAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    guard(ctx)
    const market = str(fd, 'market')
    const customerId = `SC-${market}-${Math.floor(100000 + Math.random() * 899999)}`
    const out = await ingestSalesAppEvent(await systemCtx(), {
      event_id: randomUUID(),
      type: 'store.created',
      version: 1,
      occurred_at: new Date().toISOString(),
      data: { customer_id: customerId, market, name: str(fd, 'name'), phone: str(fd, 'phone') || null, locality: str(fd, 'locality') || null },
    })
    if (out.status !== 'processed') throw invalid('No se pudo procesar el evento.', 'The event could not be processed.')
    return { message: [`PDV recibido como ${customerId}. CONTIGO le emitió su ID y lo devolvió por el outbox.`, `Store received as ${customerId}. CONTIGO issued its ID and returned it through the outbox.`] }
  })
}

export async function simulateMetricsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    guard(ctx)
    const now = new Date()
    const asOf = now.toISOString().slice(0, 10)
    const out = await ingestMetricsFile(await systemCtx(), {
      as_of: asOf,
      file_name: `merchant_metrics_daily_${asOf.replaceAll('-', '')}_${now.getTime()}.json`,
      mode: 'delta',
      rows: [
        { merchant_ref: str(fd, 'merchant_ref'), first_txn_at: now.toISOString(), last_txn_at: now.toISOString(), txn_count_30d: 1, volume_minor_30d: 5000, currency: str(fd, 'currency') || 'USD', active_days_30d: 1 },
      ],
    })
    if (out.matched === 0) throw invalid('Ese ID no corresponde a ningún comercio.', 'That ID does not match any merchant.')
    return { message: [`Archivo cargado: ${out.matched} comercio, ${out.dealsWon} deal ganado por primera transacción.`, `File loaded: ${out.matched} merchant, ${out.dealsWon} deal won by first transaction.`] }
  })
}
