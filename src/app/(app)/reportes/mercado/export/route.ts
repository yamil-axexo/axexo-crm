import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { exportDeadLeads, exportMarketReport, MARKET_EXPORTS, type MarketExport } from '@/domain/mx-reports'
import { DomainError } from '@/lib/errors'

/** Descargas del reporte del mercado. El permiso y el evento de bitácora viven en el dominio. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 401 })
  const sp = req.nextUrl.searchParams
  const market = (sp.get('mercado') ?? '').slice(0, 2)
  const what = sp.get('que') ?? ''
  if (!ctx.markets.some((m) => m.code === market)) return new NextResponse(null, { status: 404 })
  try {
    const out = what === 'descartados'
      ? await exportDeadLeads(ctx, market)
      : (MARKET_EXPORTS as readonly string[]).includes(what)
        ? await exportMarketReport(ctx, market, Number(sp.get('meses') ?? 6), what as MarketExport)
        : null
    if (!out) return new NextResponse(null, { status: 404 })
    return new NextResponse(out.csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store', 'x-contigo-rows': String(out.rows) },
    })
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(null, { status: e.status === 403 ? 404 : 422 })
    console.error(JSON.stringify({ level: 'error', msg: 'export_failed', name: (e as Error)?.name ?? 'Error' }))
    return new NextResponse(null, { status: 500 })
  }
}
