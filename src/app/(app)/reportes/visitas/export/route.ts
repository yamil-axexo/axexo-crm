import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { exportVisitDetail } from '@/domain/visit-detail'
import { DomainError } from '@/lib/errors'

/** Descarga del detalle de visitas (E12.F6). El permiso, el alcance y el evento de bitácora viven en el dominio. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 401 })
  if (!ctx.can('report.export') && !ctx.can('visit.reimbursement')) return new NextResponse(null, { status: 404 })
  const sp = req.nextUrl.searchParams
  const pick = (k: string) => (sp.get(k) ?? '').slice(0, 20) || undefined
  try {
    const out = await exportVisitDetail(ctx, { market: pick('mercado'), from: pick('desde'), to: pick('hasta') }, sp.get('motivo') ?? '')
    return new NextResponse(out.csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store', 'x-contigo-rows': String(out.rows) },
    })
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.status === 403 ? null : ctx.t(e.es, e.en), { status: e.status === 403 ? 403 : 422, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    console.error(JSON.stringify({ level: 'error', msg: 'export_failed', name: (e as Error)?.name ?? 'Error' }))
    return new NextResponse(null, { status: 500 })
  }
}
