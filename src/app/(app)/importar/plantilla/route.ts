import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { IMPORT_KINDS, importTemplate, type ImportKind } from '@/domain/csv-import'

/** Plantilla CSV de una importación: encabezados y una fila de ejemplo. No trae datos de nadie. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 401 })
  if (!ctx.can('data.import')) return new NextResponse(null, { status: 404 })
  const kind = req.nextUrl.searchParams.get('tipo') as ImportKind
  if (!IMPORT_KINDS.includes(kind)) return new NextResponse(null, { status: 404 })
  const out = importTemplate(kind, ctx.locale)
  return new NextResponse(out.csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' } })
}
