import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { exportAccounts } from '@/domain/exports'
import { DomainError } from '@/lib/errors'

/** Descarga de los comercios filtrados. Permiso, motivo, tope por rol y bitácora viven en el dominio (exportAccounts). */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 401 })
  if (!ctx.can('report.export')) return new NextResponse(null, { status: 404 })
  const sp = Object.fromEntries([...req.nextUrl.searchParams].map(([k, v]) => [k, v.slice(0, 300)])) as Record<string, string>
  try {
    const { motivo, ...filters } = sp
    const out = await exportAccounts(ctx, filters, motivo ?? '')
    return new NextResponse(out.csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store', 'x-contigo-rows': String(out.rows), 'x-contigo-truncated': String(out.truncated) },
    })
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.status === 403 ? null : ctx.t(e.es, e.en), { status: e.status === 403 ? 403 : 422, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    console.error(JSON.stringify({ level: 'error', msg: 'export_failed', name: (e as Error)?.name ?? 'Error' }))
    return new NextResponse(null, { status: 500 })
  }
}
