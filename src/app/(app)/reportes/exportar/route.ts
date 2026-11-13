import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { exportReport } from '@/domain/reportes'
import { getReportOptions, marketPeriods } from '@/dal/reports'
import { wideScope } from '@/dal/reportes'
import { DomainError } from '@/lib/errors'
import { reportFilters, type ReportParams } from '../params'

/** Descarga de un reporte de la galería. El permiso, el tope de filas y el evento de bitácora viven en el dominio (exportReport). */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 401 })
  if (!ctx.can('report.export')) return new NextResponse(null, { status: 404 })
  const sp = Object.fromEntries([...req.nextUrl.searchParams].map(([k, v]) => [k, v.slice(0, 200)])) as ReportParams & { reporte?: string; fuente?: string; ver?: string; nivel?: string; tipo?: string }
  try {
    const period = marketPeriods(ctx, sp.periodo, sp.desde, sp.hasta, 'mes')
    const f = reportFilters(sp, await getReportOptions(ctx, wideScope(ctx)))
    const out = await exportReport(ctx, sp.reporte ?? '', period, { ...f, source: sp.fuente, mine: sp.ver === 'mias', level: sp.nivel, kind: sp.tipo }, req.nextUrl.searchParams.get('motivo') ?? '')
    return new NextResponse(out.csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store', 'x-contigo-rows': String(out.rows) },
    })
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.status === 403 ? null : ctx.t(e.es, e.en), { status: e.status === 403 ? 403 : 422, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    console.error(JSON.stringify({ level: 'error', msg: 'export_failed', name: (e as Error)?.name ?? 'Error' }))
    return new NextResponse(null, { status: 500 })
  }
}
