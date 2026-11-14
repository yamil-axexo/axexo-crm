import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { orderPrint } from '@/dal/orders'
import { A4, buildPdf, textWidth, type PdfOp } from '@/lib/pdf-lite'
import { day } from '@/lib/format'

type Brand = { company: string | null; tagline: string | null; proposed: boolean; pending: string }
/** La plantilla de marca del pedido para un mercado: dato de Administración (crm.settings 'orders.brand'), nunca escrita en código. */
export async function orderBrand(ctx: Ctx, market: string): Promise<Brand> {
  return withUser(ctx.user.id, async (tx) => {
    const r = await tx<{ value: Record<string, unknown> }[]>`select value from crm.settings where key = 'orders.brand'`
    const v = r[0]?.value ?? {}
    const m = (v[market] ?? {}) as { company?: string | null; tagline?: string | null }
    return { company: m.company ?? null, tagline: m.tagline ?? null, proposed: v.proposed !== false, pending: String(v.pending ?? 'Marketing') }
  })
}

/**
 * Un solo encabezado del pedido (integración ola 6): el que puso una persona en Administración, Comunicaciones del mercado
 * (avisos) gana sobre la plantilla de marca mientras esa plantilla siga siendo valor propuesto; una plantilla confirmada por
 * Marketing gana siempre. Sin ninguna, "axexo".
 */
export function orderHeaderText(brand: Brand, commsHeader: string | null): string {
  if (brand.company && !brand.proposed) return brand.company
  return commsHeader ?? brand.company ?? 'axexo'
}

const GREEN: [number, number, number] = [0x33, 0xb8, 0x88]
const INK: [number, number, number] = [0, 0, 0]
const MUTED: [number, number, number] = [90, 90, 90]

/**
 * E11.F3 (reportes2): el PDF del pedido lo arma CONTIGO, con la plantilla de marca del mercado: encabezado con la empresa, línea
 * verde de marca, comercio, envío, líneas con su descuento y total. Descargarlo queda en la bitácora.
 */
export async function orderPdf(ctx: Ctx, dealId: string): Promise<{ pdf: Buffer; fileName: string } | null> {
  const o = await orderPrint(ctx, dealId)
  if (!o || !o.has_items) return null
  const { t, locale } = ctx
  const brand = await orderBrand(ctx, o.market_code)
  const money = (minor: string | null) => (minor === null ? '' : new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { style: 'currency', currency: o.currency, currencyDisplay: 'code', minimumFractionDigits: 2 }).format(Number(minor) / 100))
  const pages: PdfOp[][] = []
  let ops: PdfOp[] = []
  let y = 0
  const M = 48
  const right = A4.w - M
  const newPage = () => {
    ops = []
    pages.push(ops)
    ops.push({ kind: 'rect', x: 0, y: A4.h - 6, w: A4.w, h: 6, color: GREEN })
    ops.push({ kind: 'text', x: M, y: A4.h - 52, size: 20, bold: true, text: orderHeaderText(brand, o.header) })
    if (brand.tagline) ops.push({ kind: 'text', x: M, y: A4.h - 70, size: 10, text: brand.tagline, color: MUTED })
    const label = t('PEDIDO', 'ORDER')
    ops.push({ kind: 'text', x: right - textWidth(label, 11, true), y: A4.h - 48, size: 11, bold: true, text: label, color: GREEN })
    const d = day(o.created_at, locale)
    ops.push({ kind: 'text', x: right - textWidth(d, 10), y: A4.h - 64, size: 10, text: d, color: MUTED })
    ops.push({ kind: 'rect', x: M, y: A4.h - 84, w: A4.w - 2 * M, h: 1, color: [220, 220, 220] })
    y = A4.h - 108
  }
  const line = (text: string, size = 10, bold = false, color: [number, number, number] = INK, x = M) => {
    if (y < 72) newPage()
    ops.push({ kind: 'text', x, y, size, bold, text: text.slice(0, 110), color })
    y -= size + 6
  }
  newPage()
  line(t('Comercio', 'Merchant'), 9, true, MUTED)
  line(o.account.name, 12, true)
  const where = [o.account.address_line, o.account.locality, o.account.region, o.account.postal_code].filter(Boolean).join(', ')
  if (where) line(where)
  if (o.account.merchant_ref) line(`Merchant ID: ${o.account.merchant_ref}`)
  if (o.shipping) {
    y -= 6
    line(t('Envío', 'Shipping'), 9, true, MUTED)
    line([o.shipping.carrier, o.shipping.customer_number ? `${t('Cliente', 'Customer')} ${o.shipping.customer_number}` : null, o.shipping.po_number ? `PO ${o.shipping.po_number}` : null, o.shipping.due_on ? `${t('Entrega', 'Due')} ${day(o.shipping.due_on, locale)}` : null].filter(Boolean).join(' · '))
    if (o.shipping.ship_to) line(o.shipping.ship_to)
    if (o.shipping.terms) line(`${t('Términos', 'Terms')}: ${o.shipping.terms}`)
  }
  y -= 10
  ops.push({ kind: 'rect', x: M, y: y - 4, w: A4.w - 2 * M, h: 18, color: [234, 247, 241] })
  const cols = { name: M + 6, qty: 330, price: 420, sum: right - 6 }
  const head = (txt: string, x: number, alignRight = false) => ops.push({ kind: 'text', x: alignRight ? x - textWidth(txt, 9, true) : x, y, size: 9, bold: true, text: txt })
  head(t('Producto', 'Product'), cols.name); head(t('Cantidad', 'Qty'), cols.qty + 40, true); head(t('Precio', 'Price'), cols.price + 60, true); head(t('Importe', 'Amount'), cols.sum, true)
  y -= 22
  let total = 0
  for (const it of o.items) {
    if (y < 96) newPage()
    const sum = Number(it.sum_minor ?? 0)
    total += sum
    const disc = it.discount_pct && Number(it.discount_pct) > 0 ? ` (-${Number(it.discount_pct)}%)` : ''
    ops.push({ kind: 'text', x: cols.name, y, size: 10, text: `${it.name}${disc}`.slice(0, 48) })
    const q = String(Number(it.quantity)); ops.push({ kind: 'text', x: cols.qty + 40 - textWidth(q, 10), y, size: 10, text: q })
    const p = money(it.unit_price_minor); ops.push({ kind: 'text', x: cols.price + 60 - textWidth(p, 10), y, size: 10, text: p })
    const s = money(it.sum_minor); ops.push({ kind: 'text', x: cols.sum - textWidth(s, 10), y, size: 10, text: s })
    y -= 18
    if (it.comments) { ops.push({ kind: 'text', x: cols.name + 8, y, size: 8.5, text: it.comments.slice(0, 90), color: MUTED }); y -= 14 }
  }
  ops.push({ kind: 'rect', x: M, y: y + 6, w: A4.w - 2 * M, h: 1, color: [220, 220, 220] })
  y -= 10
  const tot = `${t('Total', 'Total')}: ${money(String(total))}`
  ops.push({ kind: 'text', x: cols.sum - textWidth(tot, 12, true), y, size: 12, bold: true, text: tot })
  y -= 30
  line(`${t('Levantó', 'Prepared by')}: ${o.created_by_name ?? o.owner_name ?? ''}`, 9, false, MUTED)
  const pdf = buildPdf(pages, { title: `${t('Pedido', 'Order')} ${o.account.name}` })
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'document.order_pdf', 'deal', o.id, o.market_code, null, { lines: o.items.length, brand: brand.company ? 'set' : 'none' }))
  return { pdf, fileName: `pedido-${o.account.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase().slice(0, 40)}.pdf` }
}
