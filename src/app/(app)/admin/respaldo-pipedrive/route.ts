import { NextResponse } from 'next/server'
import { getCtx } from '@/server/context'
import { pipedriveBackup } from '@/domain/pipedrive/backup'

/** E6.F4: baja el respaldo completo de lo importado de Pipedrive. Solo administración; cada descarga queda en la bitácora. */
export async function GET() {
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 401 })
  if (!ctx.can('pipedrive.backup')) return new NextResponse(null, { status: 404 })
  try {
    const b = await pipedriveBackup(ctx)
    return new NextResponse(b.json, { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${b.fileName}"`, 'cache-control': 'no-store', 'x-contigo-sha256': b.sha256 } })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
