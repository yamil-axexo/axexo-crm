import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { orderPdf } from '@/domain/order-pdf'

/** E11.F3 (reportes2): el PDF del pedido, armado por CONTIGO con la plantilla de marca del mercado. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 401 })
  const { id } = await params
  const out = await orderPdf(ctx, id)
  if (!out) return new NextResponse(null, { status: 404 })
  return new NextResponse(new Uint8Array(out.pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' },
  })
}
