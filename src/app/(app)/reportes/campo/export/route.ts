import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { exportFieldReport } from '@/domain/reports'
import { getReportOptions } from '@/dal/reports'
import { DomainError } from '@/lib/errors'
import { reportFilters, type ReportParams } from '../../params'

/** Descarga del reporte semanal de campo. El permiso y el evento de bitácora viven en el dominio (exportFieldReport). */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 401 })
  if (!ctx.can('report.export')) return new NextResponse(null, { status: 404 })
  const sp = Object.fromEntries([...req.nextUrl.searchParams].map(([k, v]) => [k, v.slice(0, 200)])) as ReportParams & { tipo?: string }
  try {
    const f = reportFilters(sp, await getReportOptions(ctx))
    const out = await exportFieldReport(ctx, { market: f.market, team: f.team, owner: f.owner, by: sp.por === 'plaza' ? 'plaza' : 'territorio' }, sp.tipo === 'visitas' ? 'visitas' : 'comercios')
    return new NextResponse(out.csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store', 'x-contigo-rows': String(out.rows) },
    })
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(null, { status: e.status === 403 ? 403 : 422 })
    console.error(JSON.stringify({ level: 'error', msg: 'export_failed', name: (e as Error)?.name ?? 'Error' }))
    return new NextResponse(null, { status: 500 })
  }
}
