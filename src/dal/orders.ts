import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isUuid } from '@/lib/ids'

export type OrderDispatch = { id: string; sent_at: Date; sent_by_name: string; mailbox: string | null; received_at: Date | null; received_by_name: string | null; lines: number; total_minor: string }
export type OrderPrint = {
  id: string; title: string; market_code: string; currency: string; status: string; created_at: Date; created_by_name: string | null; owner_name: string | null; has_items: boolean
  account: { id: string; name: string; merchant_ref: string | null; phone: string | null; address_line: string | null; locality: string | null; region: string | null; postal_code: string | null }
  items: { id: string; name: string; quantity: string; unit_price_minor: string | null; sum_minor: string | null; comments: string | null }[]
  header: string | null
  dispatches: OrderDispatch[]
}

/** Todo lo que lleva el pedido impreso: comercio, líneas, totales, quién lo levantó y sus envíos a Operaciones. */
export async function orderPrint(ctx: Ctx, dealId: string): Promise<OrderPrint | null> {
  if (!isUuid(dealId)) return null
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<(Omit<OrderPrint, 'account' | 'items' | 'dispatches'> & { account_id: string; account_name: string; merchant_ref: string | null; phone: string | null; address_line: string | null; locality: string | null; region: string | null; postal_code: string | null })[]>`
      select d.id, d.title, d.market_code, trim(d.currency) as currency, d.status, d.created_at, cb.full_name as created_by_name, o.full_name as owner_name, p.has_items,
             a.id as account_id, a.name as account_name, a.merchant_ref, a.phone, a.address_line, a.locality, a.region, a.postal_code,
             (select c.order_header from crm.market_comms c where c.market_code = d.market_code) as header
        from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.accounts a on a.id = d.account_id
        left join crm.users cb on cb.id = d.created_by left join crm.users o on o.id = d.owner_id
       where d.id = ${dealId}`
    const d = rows[0]
    if (!d) return null
    const items = await tx<OrderPrint['items']>`
      select id, name, quantity::text, unit_price_minor::text, sum_minor::text, comments from crm.deal_items where deal_id = ${dealId} order by position, created_at`
    const dispatches = await tx<OrderDispatch[]>`
      select x.id, x.sent_at, s.full_name as sent_by_name, x.mailbox, x.received_at, r.full_name as received_by_name, x.lines, x.total_minor::text
        from crm.order_dispatches x join crm.users s on s.id = x.sent_by left join crm.users r on r.id = x.received_by
       where x.deal_id = ${dealId} order by x.sent_at desc`
    return {
      id: d.id, title: d.title, market_code: d.market_code, currency: d.currency, status: d.status, created_at: d.created_at, created_by_name: d.created_by_name, owner_name: d.owner_name,
      has_items: d.has_items, header: d.header,
      account: { id: d.account_id, name: d.account_name, merchant_ref: d.merchant_ref, phone: d.phone, address_line: d.address_line, locality: d.locality, region: d.region, postal_code: d.postal_code },
      items: [...items], dispatches: [...dispatches],
    }
  })
}

export type PendingOrder = { id: string; deal_id: string; account_name: string; title: string; market_code: string; sent_at: Date; sent_by_name: string; lines: number; total_minor: string; currency: string }
/** Pedidos enviados a Operaciones que nadie ha recibido todavía, en los mercados de la persona. */
export async function pendingOrders(ctx: Ctx): Promise<PendingOrder[]> {
  if (!ctx.can('deal.ops')) return []
  return withUser(ctx.user.id, (tx) => tx<PendingOrder[]>`
    select x.id, x.deal_id, a.name as account_name, d.title, x.market_code, x.sent_at, s.full_name as sent_by_name, x.lines, x.total_minor::text, trim(d.currency) as currency
      from crm.order_dispatches x join crm.deals d on d.id = x.deal_id join crm.accounts a on a.id = d.account_id join crm.users s on s.id = x.sent_by
     where x.received_at is null and x.market_code = any(app.ops_markets()) order by x.sent_at limit 100`)
}
