import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit } from '@/domain/common'
import { notifyMany, notifyOutside, peopleWithRole } from '@/domain/notify'
import { invalid, notFound } from '@/lib/errors'
import { isUuid } from '@/lib/ids'

/**
 * E11.F4: el pedido llega a Operaciones. Dentro de CONTIGO queda en la cola de Operaciones y cada persona de Operaciones
 * del mercado recibe el aviso con enlace al pedido listo para imprimir. El correo al buzón de pedidos queda en la cola del
 * canal de correo (apagado). Queda registrado quién lo envió y cuándo.
 */
export async function sendOrderToOps(ctx: Ctx, dealId: string): Promise<{ mailbox: string | null }> {
  if (!isUuid(dealId)) throw notFound()
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; market_code: string; account_id: string; title: string; status: string; has_items: boolean; account: string; currency: string }[]>`
      select d.id, d.market_code, d.account_id, d.title, d.status, p.has_items, a.name as account, trim(d.currency) as currency
        from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.accounts a on a.id = d.account_id where d.id = ${dealId} for update of d`
    const d = rows[0]
    if (!d) throw notFound('No encontramos ese pedido.', 'We could not find that order.')
    ctx.assert('deal.edit', d.market_code)
    if (!d.has_items) throw invalid('Solo un pedido se envía a Operaciones.', 'Only an order can be sent to Operations.')
    if (d.status === 'lost') throw invalid('Un pedido perdido no se envía.', 'A lost order cannot be sent.')
    const items = await tx<{ name: string; quantity: string; sum_minor: string | null }[]>`select name, quantity::text, sum_minor::text from crm.deal_items where deal_id = ${dealId} order by position, created_at`
    if (items.length === 0) throw invalid('Agrega al menos una línea antes de enviar el pedido.', 'Add at least one line before sending the order.')
    const waiting = await tx`select 1 from crm.order_dispatches where deal_id = ${dealId} and received_at is null limit 1`
    if (waiting[0]) throw invalid('Este pedido ya está en la cola de Operaciones. Cuando lo reciban, lo puedes volver a enviar si cambia.', 'This order is already in the Operations queue. Once they receive it, you can send it again if it changes.')
    const comms = await tx<{ orders_mailbox: string | null }[]>`select orders_mailbox from crm.market_comms where market_code = ${d.market_code}`
    const mailbox = comms[0]?.orders_mailbox ?? null
    const total = items.reduce((n, it) => n + Number(it.sum_minor ?? 0), 0)
    const disp = await tx<{ id: string; on: string }[]>`
      insert into crm.order_dispatches (deal_id, market_code, sent_by, mailbox, total_minor, lines)
      values (${dealId}, ${d.market_code}, ${ctx.user.id}, ${mailbox}, ${total}, ${items.length})
      returning id, (sent_at at time zone ${ctx.market(d.market_code).timezone})::date::text as on`
    const link = `/deals/${dealId}/pedido`
    const amount = `${(total / 100).toFixed(2)} ${d.currency}`
    await notifyMany(tx, ctx, await peopleWithRole(tx, d.market_code, ['ops']), {
      kind: 'order_sent', market: d.market_code, link, accountId: d.account_id, dealId,
      title: [`Pedido de ${d.account}`, `Order from ${d.account}`],
      body: [`${ctx.user.name} lo envió a Operaciones: ${items.length} ${items.length === 1 ? 'línea' : 'líneas'}, ${amount}.`, `${ctx.user.name} sent it to Operations: ${items.length} ${items.length === 1 ? 'line' : 'lines'}, ${amount}.`],
    })
    await notifyOutside(tx, ctx, {
      kind: 'order_sent', template: 'order_to_ops', market: d.market_code, recipient: 'mailbox', address: mailbox, locale: ctx.market(d.market_code).locale === 'en' ? 'en' : 'es',
      accountId: d.account_id, dealId,
      vars: { comercio: d.account, negocio: d.title, quien: ctx.user.name, fecha: disp[0]!.on, enlace: link, detalle: [...items.map((it) => `${Number(it.quantity)} × ${it.name}`), `Total: ${amount}`].join('\n') },
    })
    await audit(tx, ctx, 'order.sent_to_ops', 'deal', dealId, d.market_code, null, { lines: items.length, total_minor: total, mailbox: Boolean(mailbox) })
    await emit(tx, 'order.sent_to_ops', 'deal', dealId, d.market_code, { lines: items.length, total_minor: total })
    return { mailbox }
  })
}

/** Operaciones marca el pedido como recibido: sale de su lista de pedidos por atender y queda quién y cuándo. */
export async function receiveOrder(ctx: Ctx, dispatchId: string): Promise<void> {
  if (!isUuid(dispatchId)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ deal_id: string; market_code: string; received_at: Date | null }[]>`select deal_id, market_code, received_at from crm.order_dispatches where id = ${dispatchId} for update`
    const o = rows[0]
    if (!o) throw notFound('No encontramos ese pedido.', 'We could not find that order.')
    ctx.assert('deal.ops', o.market_code)
    if (o.received_at) return
    await tx`update crm.order_dispatches set received_by = ${ctx.user.id}, received_at = now() where id = ${dispatchId}`
    await tx`update crm.notices set seen_at = now() where user_id = ${ctx.user.id} and deal_id = ${o.deal_id} and kind = 'order_sent' and seen_at is null`
    await audit(tx, ctx, 'order.received', 'deal', o.deal_id, o.market_code, null, { dispatch_id: dispatchId })
  })
}
