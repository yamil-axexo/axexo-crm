import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { orderPrint } from '@/dal/orders'
import { ActionForm, Submit } from '@/ui/client'
import { PrintButton } from '@/ui/orders'
import { day, dayTime, money, noData } from '@/lib/format'
import { receiveOrderAction, sendOrderAction } from './actions'

export const dynamic = 'force-dynamic'

/**
 * E11.F3: el pedido en una hoja lista para imprimir. No usa una librería de PDF: el navegador lo imprime o lo guarda como PDF.
 * En papel solo sale la hoja (la barra, el menú y los botones no se imprimen).
 */
export default async function OrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  const o = await orderPrint(ctx, id)
  if (!o || !o.has_items) notFound()
  const market = ctx.market(o.market_code)
  const price = (minor: string | null) => (minor === null ? noData(locale) : new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { style: 'currency', currency: o.currency, currencyDisplay: 'code', minimumFractionDigits: 2 }).format(Number(minor) / 100))
  const total = o.items.reduce((n, it) => n + Number(it.sum_minor ?? 0), 0)
  const waiting = o.dispatches.find((d) => !d.received_at)
  const canSend = ctx.can('deal.edit', o.market_code) && o.status !== 'lost'
  const where = [o.account.address_line, o.account.locality, o.account.region, o.account.postal_code].filter(Boolean).join(', ')
  return (
    <div data-testid="order-print">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/deals/${o.id}`} className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="order-back">{t('Volver al pedido', 'Back to the order')}</Link>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          <PrintButton label={t('Imprimir o guardar como PDF', 'Print or save as PDF')} />
          {canSend && !waiting && o.items.length > 0 && (
            <ActionForm action={sendOrderAction}>
              <input type="hidden" name="deal_id" value={o.id} />
              <Submit testId="order-send">{t('Enviar a Operaciones', 'Send to Operations')}</Submit>
            </ActionForm>
          )}
        </span>
      </div>

      <article className="order-sheet card mx-auto max-w-[820px] p-6 md:p-10" data-testid="order-sheet">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-[13px] font-semibold tracking-wide text-muted-2 uppercase">{t('Pedido', 'Order')}</p>
            <h1 className="text-[24px] leading-8 font-semibold text-strong" data-testid="order-header">{o.header ?? 'axexo'}</h1>
          </div>
          <dl className="text-right text-[13.5px] text-strong">
            <dt className="sr-only">{t('Fecha del pedido', 'Order date')}</dt><dd data-testid="order-date">{day(o.created_at, locale)}</dd>
            <dt className="sr-only">{t('Mercado', 'Market')}</dt><dd className="text-muted-2">{market.name}</dd>
          </dl>
        </header>

        <section className="grid grid-cols-1 gap-5 border-b border-line py-5 md:grid-cols-2">
          <div>
            <h2 className="text-[12.5px] font-semibold tracking-wide text-muted-2 uppercase">{t('Comercio', 'Merchant')}</h2>
            <p className="mt-1 text-[16px] font-semibold text-strong" data-testid="order-merchant">{o.account.name}</p>
            <p className="text-[13.5px] text-strong">{where || t('Dirección: s/d', 'Address: n/a')}</p>
            <p className="text-[13.5px] text-strong">{t('Teléfono', 'Phone')}: {o.account.phone ?? t('s/d', 'n/a')}</p>
            <p className="text-[13.5px] text-strong">Merchant ID: {o.account.merchant_ref ?? t('s/d', 'n/a')}</p>
          </div>
          <div>
            <h2 className="text-[12.5px] font-semibold tracking-wide text-muted-2 uppercase">{t('Pedido', 'Order')}</h2>
            <p className="mt-1 text-[16px] font-semibold text-strong">{o.title}</p>
            <p className="text-[13.5px] text-strong" data-testid="order-by">{t('Lo levantó', 'Placed by')}: {o.created_by_name ?? o.owner_name ?? t('s/d', 'n/a')}</p>
            {o.owner_name && o.owner_name !== o.created_by_name && <p className="text-[13.5px] text-strong">{t('Lo lleva', 'Owner')}: {o.owner_name}</p>}
          </div>
        </section>

        {o.shipping && (
          <section className="border-b border-line py-5" data-testid="order-shipping">
            <h2 className="text-[12.5px] font-semibold tracking-wide text-muted-2 uppercase">{t('Datos de envío', 'Shipping details')}</h2>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13.5px] text-strong md:grid-cols-2 print:grid-cols-2">
              {([
                [t('Paquetería', 'Carrier'), o.shipping.carrier], [t('Número de cliente', 'Customer number'), o.shipping.customer_number],
                [t('Fecha de entrega', 'Due date'), o.shipping.due_on ? day(o.shipping.due_on, locale) : null], [t('Orden de compra (PO)', 'PO number'), o.shipping.po_number],
                [t('Dirección de envío', 'Shipping address'), o.shipping.ship_to], [t('Términos', 'Terms'), o.shipping.terms], [t('Descripción', 'Description'), o.shipping.description],
              ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="flex flex-wrap gap-x-2"><dt className="text-muted-2">{k}:</dt><dd className="min-w-0 break-words">{v}</dd></div>
              ))}
            </dl>
          </section>
        )}

        <table className="mt-5 w-full border-collapse text-[14px]" data-testid="order-lines">
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] font-semibold tracking-wide text-muted-2 uppercase">
              <th scope="col" className="py-2 pr-3">{t('Producto', 'Product')}</th>
              <th scope="col" className="py-2 pr-3 text-right">{t('Cantidad', 'Quantity')}</th>
              <th scope="col" className="hidden py-2 pr-3 text-right md:table-cell print:table-cell">{t('Precio unitario', 'Unit price')}</th>
              <th scope="col" className="py-2 text-right">{t('Importe', 'Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((it) => (
              <tr key={it.id} className="border-b border-line align-top" data-testid="order-line">
                <td className="py-2.5 pr-3 text-strong"><span className="font-medium">{it.name}</span>{Number(it.discount_pct ?? 0) > 0 ? <span className="block text-[12.5px] text-muted-2" data-testid="order-line-discount">{t(`Menos ${Number(it.discount_pct)}% de descuento`, `Less ${Number(it.discount_pct)}% discount`)}</span> : null}{it.comments ? <span className="block text-[12.5px] text-muted-2">{it.comments}</span> : null}</td>
                <td className="num py-2.5 pr-3 text-right text-strong">{Number(it.quantity)}</td>
                <td className="num hidden py-2.5 pr-3 text-right text-strong md:table-cell print:table-cell">{price(it.unit_price_minor)}</td>
                <td className="num py-2.5 text-right text-strong">{price(it.sum_minor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="py-3 text-left text-[15px] font-semibold text-strong">{t('Total', 'Total')}</th>
              <td className="hidden md:table-cell print:table-cell" />
              <td className="num py-3 text-right text-[16px] font-semibold text-strong" data-testid="order-total">{money(total, o.currency, locale)}</td>
            </tr>
          </tfoot>
        </table>
        {o.items.length === 0 && <p className="mt-3 text-[14px] text-muted-2" data-testid="order-empty">{t('Este pedido todavía no tiene líneas. Agrégalas en el pedido antes de imprimirlo o enviarlo.', 'This order has no lines yet. Add them on the order before printing or sending it.')}</p>}

        <footer className="mt-6 border-t border-line pt-4 text-[13px] text-strong" data-testid="order-trail">
          {o.dispatches.length === 0 ? (
            <p>{t('Todavía no se ha enviado a Operaciones.', 'Not sent to Operations yet.')}</p>
          ) : (
            <ul className="space-y-1">
              {o.dispatches.map((d) => (
                <li key={d.id} data-testid="order-dispatch">
                  {t(`Enviado a Operaciones por ${d.sent_by_name} el ${dayTime(d.sent_at, locale, market.timezone)}.`, `Sent to Operations by ${d.sent_by_name} on ${dayTime(d.sent_at, locale, market.timezone)}.`)}{' '}
                  {d.received_at ? t(`Recibido por ${d.received_by_name} el ${dayTime(d.received_at, locale, market.timezone)}.`, `Received by ${d.received_by_name} on ${dayTime(d.received_at, locale, market.timezone)}.`) : t('Operaciones todavía no lo marca como recibido.', 'Operations has not marked it as received yet.')}
                </li>
              ))}
            </ul>
          )}
        </footer>
      </article>

      {waiting && (
        <div className="mx-auto mt-5 flex max-w-[820px] flex-wrap items-center gap-3 rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong print:hidden" role="status" data-testid="order-waiting">
          <span className="min-w-[200px] flex-1">
            {t('Está en la cola de Operaciones dentro de CONTIGO.', 'It is in the Operations queue inside CONTIGO.')}{' '}
            {waiting.mailbox ? t('El correo al buzón de pedidos está listo para enviar, con el canal de correo apagado: no ha salido nada.', 'The email to the order mailbox is ready to send, with the email channel turned off: nothing has gone out.') : t('Este mercado no tiene buzón de pedidos configurado.', 'This market has no order mailbox configured.')}
          </span>
          {ctx.can('deal.ops', o.market_code) && (
            <ActionForm action={receiveOrderAction}>
              <input type="hidden" name="dispatch_id" value={waiting.id} />
              <Submit variant="ghost" size="sm" testId="order-receive">{t('Marcar como recibido', 'Mark as received')}</Submit>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  )
}
