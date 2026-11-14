import { NextResponse } from 'next/server'
import { mcpMode } from '@/server/adapters/ai'
import { exchangeCode } from '@/domain/plataforma/mcp-oauth'
import { clientIp, ipHash, rateHit, LIMITS } from '@/server/protect'

export const dynamic = 'force-dynamic'

/** IA-06: canje del código de autorización con PKCE (application/x-www-form-urlencoded, como pide OAuth 2.1). */
export async function POST(req: Request) {
  if (mcpMode() === 'off') return new NextResponse(null, { status: 404 })
  const hit = await rateHit(`mcp:token:${ipHash(clientIp(req.headers))}`, LIMITS.apiAuthFailPerIp)
  if (!hit.allowed) return NextResponse.json({ error: 'slow_down' }, { status: 429, headers: { 'retry-after': String(hit.retryAfter) } })
  const form = new URLSearchParams((await req.text()).slice(0, 4000))
  const out = await exchangeCode(form)
  return NextResponse.json(out, { status: 'error' in out ? 400 : 200, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } })
}
