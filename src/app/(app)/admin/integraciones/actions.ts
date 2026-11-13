'use server'

import { randomUUID } from 'node:crypto'
import { runAction, str } from '@/server/action'
import { systemCtx } from '@/server/context'
import { env } from '@/env'
import { createSubscriber, publishNow, resendDelivery, rotateSubscriberSecret, setSubscriberStatus } from '@/domain/publisher'
import { createApiKey, rotateApiKey, ALL_SCOPES } from '@/domain/api-keys'
import { ingestSalesAppEvent, replayInboundEvent } from '@/domain/integrations'
import { recordSimulation } from '@/domain/admin'
import { setFormLimits } from '@/domain/form-guard'
import { DomainError, forbidden, invalid, type ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function createSubscriberAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const all = fd.get('all_events') === 'on'
    const out = await createSubscriber(ctx, { name: str(fd, 'name'), destination: str(fd, 'destination'), market: str(fd, 'market'), eventTypes: all ? ['*'] : fd.getAll('event').map(String) })
    return {
      data: out.secret ?? undefined,
      message: out.secret
        ? ['Suscriptor creado. Copia su secreto para verificar la firma.', 'Subscriber created. Copy its secret to verify the signature.']
        : ['Suscriptor creado. El secreto se muestra cuando el servidor tenga llave de firma.', 'Subscriber created. The secret is shown once the server has a signing key.'],
    }
  })
}

export async function subscriberStatusAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const status = str(fd, 'status') as 'active' | 'paused' | 'removed'
    if (!['active', 'paused', 'removed'].includes(status)) throw invalid('Estado inválido.', 'Invalid status.')
    await setSubscriberStatus(ctx, str(fd, 'id'), status)
    return { message: status === 'paused' ? ['Suscriptor en pausa: no recibe nada hasta que lo reactives.', 'Subscriber paused: it gets nothing until you turn it back on.'] : status === 'removed' ? ['Suscriptor quitado.', 'Subscriber removed.'] : ['Suscriptor activo.', 'Subscriber active.'] }
  })
}

export async function rotateSubscriberAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const secret = await rotateSubscriberSecret(ctx, str(fd, 'id'))
    return { data: secret ?? undefined, message: ['Secreto rotado: desde ahora se firma con el nuevo.', 'Secret rotated: from now on the new one signs.'] }
  })
}

export async function publishNowAction(_: R | null, _fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const r = await publishNow(ctx)
    return {
      message: r.mode === 'off'
        ? [`Canal apagado: nada salió. ${r.waiting + r.queued} entregas quedan listas para publicar.`, `Channel off: nothing went out. ${r.waiting + r.queued} deliveries stay ready to publish.`]
        : [`Pasada terminada: ${r.delivered} entregadas, ${r.failed} en reintento y ${r.dead} a mensajes muertos.`, `Run finished: ${r.delivered} delivered, ${r.failed} retrying and ${r.dead} moved to dead letters.`],
    }
  })
}

export async function resendDeliveryAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await resendDelivery(ctx, str(fd, 'id'))
    return { message: ['Entrega de vuelta en la fila, con los intentos en cero.', 'Delivery back in the queue, with attempts reset.'] }
  })
}

export async function createApiKeyAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const scopes = fd.getAll('scope').map(String).filter((s): s is (typeof ALL_SCOPES)[number] => (ALL_SCOPES as readonly string[]).includes(s))
    const out = await createApiKey(ctx, { name: str(fd, 'name'), scopes, market: str(fd, 'market'), mode: str(fd, 'mode') === 'test' ? 'test' : 'live', ratePerMinute: str(fd, 'rate') || 120 })
    return { data: out.key, message: ['Llave creada.', 'Key created.'] }
  })
}

export async function rotateApiKeyAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await rotateApiKey(ctx, str(fd, 'id'), Number(str(fd, 'days') || 7))
    return { data: out.key, message: ['Llave rotada.', 'Key rotated.'] }
  })
}

export async function replayInboundAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await replayInboundEvent(ctx, str(fd, 'id'))
    if (out.status !== 'processed') throw new DomainError('still_stuck', 'Sigue sin poder procesarse. El motivo quedó actualizado.', 'It still cannot be processed. The reason was updated.')
    return { message: ['Mensaje procesado.', 'Message processed.'] }
  })
}

/** Simulador del contrato (nunca en producción): manda a la entrada el mismo mensaje que mandaría la Sales App. */
export async function simulateContractAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    if (!ctx.can('integration.operate')) throw forbidden()
    if (env().APP_ENV === 'production') throw invalid('El simulador no existe en producción.', 'The simulator does not exist in production.')
    const kind = str(fd, 'kind')
    const customer = str(fd, 'customer_id').trim()
    const now = new Date().toISOString()
    const id = `sim-${randomUUID()}`
    const event =
      kind === 'onboarding' ? { event_id: id, type: 'onboarding.submitted', version: 1, occurred_at: now, data: { customer_id: customer, submitted_at: now, documents_complete: true } }
      : kind === 'approved' ? { event_id: id, type: 'merchant.approved', version: 1, occurred_at: now, data: { customer_id: customer, merchant_ref: str(fd, 'merchant_ref').trim(), approved_at: now } }
      : { event_id: id, type: 'visit.cancelled', version: 1, occurred_at: now, data: { customer_id: customer } }
    await recordSimulation(ctx, kind === 'onboarding' || kind === 'approved' ? 'store' : 'visit', id, null)
    try {
      const out = await ingestSalesAppEvent(await systemCtx(), event)
      if (out.status === 'unmatched') return { message: ['El mensaje llegó, pero quedó detenido: lo ves abajo con su motivo.', 'The message arrived but was held: see it below with the reason.'] }
      return { message: ['Mensaje procesado: revisa el comercio.', 'Message processed: check the merchant.'] }
    } catch (e) {
      if (e instanceof DomainError && kind === 'invalid') return { message: ['El mensaje no cumple el contrato y quedó en mensajes muertos, como debe ser.', 'The message does not match the contract and went to dead letters, as it should.'] }
      throw e
    }
  })
}

export async function setFormLimitsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    // Vacío usa el valor general; lo que no es un número entero lo rechaza el dominio (NaN no pasa su validación).
    const num = (k: string) => (str(fd, k).trim() === '' ? null : Number(str(fd, k).trim()))
    await setFormLimits(ctx, str(fd, 'id'), { minFillSeconds: num('min_fill_seconds'), ratePerMinute: num('rate_per_minute') })
    return { message: ['Límites guardados.', 'Limits saved.'] }
  })
}
