import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { runVia, withoutUser } from '@/server/db'
import { hashKey } from '@/domain/admin'
import { DomainError } from '@/lib/errors'
import { LIMITS, clientIp, ipHash, rateHit } from '@/server/protect'
import type { ApiKey } from '@/dal/api-v1'

/**
 * AUT-04 / SEC-02 / SEC-06: cada ruta de API autentica con una llave (hash en la base), revisa el permiso (scope),
 * aplica el límite de frecuencia por IP y por llave, y deja la validación al dominio. Las respuestas no filtran detalles.
 */
const limited = (retryAfter: number) =>
  NextResponse.json({ error: 'rate_limited', retry_after: retryAfter }, { status: 429, headers: { 'retry-after': String(retryAfter), 'cache-control': 'no-store' } })

type Auth = { key: ApiKey } | { response: NextResponse }

async function authenticate(request: NextRequest, scope: string): Promise<Auth> {
  const ip = ipHash(clientIp(request.headers))
  const byIp = await rateHit(`api:ip:${ip}`, LIMITS.apiPerIp)
  if (!byIp.allowed) return { response: limited(byIp.retryAfter) }
  const auth = request.headers.get('authorization') ?? ''
  const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const rows = raw.startsWith('ctg_')
    ? await withoutUser((tx) => tx<{ id: string; scopes: string[]; market_code: string | null; mode: 'live' | 'test'; rate_per_minute: number; created_by: string | null }[]>`
        select id, scopes, market_code, mode, rate_per_minute, created_by from app.api_key(${hashKey(raw)})`)
    : []
  const c = rows[0]
  if (!c) {
    // Adivinar llaves tiene tope: pasado el límite de intentos fallidos por IP, la respuesta es 429.
    const fails = await rateHit(`api:authfail:${ip}`, LIMITS.apiAuthFailPerIp)
    if (!fails.allowed) return { response: limited(fails.retryAfter) }
    return { response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }
  const byKey = await rateHit(`api:key:${c.id}`, c.rate_per_minute)
  if (!byKey.allowed) return { response: limited(byKey.retryAfter) }
  if (!c.scopes.includes(scope)) return { response: NextResponse.json({ error: 'forbidden', required_scope: scope }, { status: 403 }) }
  return { key: { id: c.id, scopes: c.scopes, market: c.market_code, mode: c.mode, ratePerMinute: c.rate_per_minute, createdBy: c.created_by } }
}

function failure(e: unknown, scope: string): NextResponse {
  if (e instanceof DomainError) return NextResponse.json({ error: e.code, message: e.en }, { status: e.status })
  if (e instanceof ZodError) return NextResponse.json({ error: 'invalid' }, { status: 422 })
  console.error(JSON.stringify({ level: 'error', msg: 'api_failed', scope }))
  return NextResponse.json({ error: 'internal' }, { status: 500 })
}

/** Entradas (POST): eventos de la Sales App, archivo diario y formularios del sitio. */
export async function apiHandler(request: NextRequest, scope: string, fn: (body: unknown, idempotencyKey: string | null) => Promise<unknown>) {
  const auth = await authenticate(request, scope)
  if ('response' in auth) return auth.response
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  try {
    return NextResponse.json(await runVia('api', () => fn(body, request.headers.get('idempotency-key'))))
  } catch (e) {
    return failure(e, scope)
  }
}

/** Lecturas (GET) de la API v1. */
export async function apiRead(request: NextRequest, scope: string, fn: (key: ApiKey, params: URLSearchParams) => Promise<unknown>) {
  const auth = await authenticate(request, scope)
  if ('response' in auth) return auth.response
  try {
    return NextResponse.json(await fn(auth.key, request.nextUrl.searchParams), {
      headers: { 'cache-control': 'no-store', 'x-ratelimit-limit': String(auth.key.ratePerMinute), 'x-contigo-data': auth.key.mode === 'test' ? 'synthetic' : 'live' },
    })
  } catch (e) {
    return failure(e, scope)
  }
}
