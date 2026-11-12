import { NextResponse } from 'next/server'
import { getCtx } from '@/server/context'
import { dockCounts } from '@/dal/boards'

export const dynamic = 'force-dynamic'

// Lo que la app abierta consulta cada minuto para saber si llegó un lead: el mismo conteo del dock, solo para quien tiene sesión.
export async function GET() {
  const ctx = await getCtx()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json(await dockCounts(ctx), { headers: { 'Cache-Control': 'no-store' } })
}
