import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { withUser } from '@/server/db'

export const dynamic = 'force-dynamic'

/**
 * AUT-02: la hora del último cambio por tema (mercado y tipo de registro) para que una pantalla abierta sepa si refrescarse.
 * Solo temas de los mercados de la persona (la base lo filtra con RLS). No devuelve registros ni datos de nadie.
 */
export async function GET(request: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return NextResponse.json({ marks: {} }, { status: 401 })
  const topics = (request.nextUrl.searchParams.get('t') ?? '').split(',').map((t) => t.trim()).filter((t) => /^[A-Za-z]{2,3}:[a-z_]{2,30}$/.test(t)).slice(0, 20)
  if (topics.length === 0) return NextResponse.json({ marks: {} })
  const rows = await withUser(ctx.user.id, (tx) => tx<{ topic: string; last_at: Date }[]>`select topic, last_at from crm.live_signals where topic = any(${topics}::text[])`)
  return NextResponse.json({ marks: Object.fromEntries(rows.map((r) => [r.topic, r.last_at.toISOString()])) }, { headers: { 'cache-control': 'no-store' } })
}
