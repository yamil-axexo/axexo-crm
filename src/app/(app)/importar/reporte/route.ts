import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { importReport } from '@/domain/csv-import'
import { DomainError } from '@/lib/errors'

/** Reporte por fila de una importación (resultado y motivo), para corregir el archivo y volver a subirlo. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!ctx.can('data.import') || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse(null, { status: 404 })
  try {
    const out = await importReport(ctx, id)
    return new NextResponse(out.csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' } })
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(null, { status: 404 })
    return new NextResponse(null, { status: 500 })
  }
}
