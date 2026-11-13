import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { accountOrders } from '@/dal/order-history'
import { Badge } from '@/ui/kit'
import { day, daysSince, money } from '@/lib/format'

const lastText = (ctx: Ctx, last: Date, total: number, timezone: string) => {
  const { t, locale } = ctx
  const ago = daysSince(last)
  return t(`Último pedido: ${day(last, locale, timezone)} (${ago === 0 ? 'hoy' : ago === 1 ? 'hace 1 día' : `hace ${ago} días`}). ${total === 1 ? '1 pedido en total' : `${total} pedidos en total`}.`,
    `Last order: ${day(last, locale, timezone)} (${ago === 0 ? 'today' : ago === 1 ? '1 day ago' : `${ago} days ago`}). ${total === 1 ? '1 order in total' : `${total} orders in total`}.`)
}

/** Cuándo fue el último pedido, a la vista en la cabecera de la tienda sin cambiar de pestaña (E11.F5). Sin pedidos no ocupa lugar. */
export async function LastOrderLine({ ctx, accountId, timezone, hasOrderPipeline }: { ctx: Ctx; accountId: string; timezone: string; hasOrderPipeline: boolean }) {
  if (!hasOrderPipeline) return null
  const { last, total } = await accountOrders(ctx, accountId)
  if (!last) return null
  return <p className="mt-3 text-[13.5px] text-muted-2" data-testid="last-order-line">{lastText(ctx, last, total, timezone)}</p>
}

/**
 * Pedidos del comercio (E11.F5): cuándo fue el último y el historial, para que quien vende sepa cuándo pidió por última vez.
 * Solo aparece en mercados con un embudo de pedidos; si el comercio nunca ha pedido, lo dice.
 */
export async function AccountOrders({ ctx, accountId, timezone, hasOrderPipeline }: { ctx: Ctx; accountId: string; timezone: string; hasOrderPipeline: boolean }) {
  if (!hasOrderPipeline) return null
  const { t, locale } = ctx
  const { orders, last, total } = await accountOrders(ctx, accountId)
  return (
    <section className="border-t border-line pt-6" data-testid="account-orders">
      <h3 className="text-[15px] leading-6 font-semibold">{t('Pedidos', 'Orders')}</h3>
      <p className="mt-1 text-[14px] text-muted-2" data-testid="last-order">
        {last
          ? lastText(ctx, last, total, timezone)
          : t('Este comercio todavía no tiene pedidos.', 'This store has no orders yet.')}
      </p>
      {orders.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {orders.map((o) => (
            <li key={o.id} data-testid="order-row">
              <Link href={`/deals/${o.id}`} className="row-hover -mx-2 flex items-center justify-between gap-3 rounded-[10px] px-2 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-strong">{day(o.ordered_at, locale, timezone)} · {o.amount_minor ? money(Number(o.amount_minor), o.currency, locale) : t('sin monto', 'no amount')}</span>
                  <span className="block truncate text-[13px] text-muted">{[o.lines === 1 ? t('1 línea', '1 line') : t(`${o.lines} líneas`, `${o.lines} lines`), o.carrier, o.po_number ? `PO ${o.po_number}` : null].filter(Boolean).join(' · ')}</span>
                </span>
                <Badge tone={o.status === 'won' ? 'good' : o.status === 'lost' ? 'bad' : 'neutral'}>{t(o.stage_es, o.stage_en)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
