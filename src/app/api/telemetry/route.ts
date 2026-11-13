import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/server/context'
import { recordRequest } from '@/server/telemetry'
import { screenKey } from '@/lib/screen-key'

export const dynamic = 'force-dynamic'

/**
 * GOB-07: el navegador de una persona con sesión avisa cuánto tardó en abrir una pantalla. Se guarda la pantalla
 * (sin identificadores ni búsquedas) y el tiempo, sumados al renglón del día. Nada más.
 */
export async function POST(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return new NextResponse(null, { status: 204 })
  const ctx = await getCtx()
  if (!ctx) return new NextResponse(null, { status: 204 })
  let body: { p?: unknown; ms?: unknown }
  try {
    body = JSON.parse((await request.text()).slice(0, 400)) as { p?: unknown; ms?: unknown }
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  const ms = typeof body.ms === 'number' && Number.isFinite(body.ms) ? Math.round(body.ms) : -1
  const screen = screenKey(typeof body.p === 'string' ? body.p : '')
  if (ms >= 0 && ms <= 120_000 && screen !== 'otra') await recordRequest('page', screen, ms, false)
  return new NextResponse(null, { status: 204 })
}
