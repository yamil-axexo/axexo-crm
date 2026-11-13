import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { runVia, withoutUser } from '@/server/db'
import { hashKey } from '@/domain/admin'
import { DomainError } from '@/lib/errors'
import { LIMITS, clientIp, ipHash, rateHit } from '@/server/protect'
import { cleanRequestId, currentRequestId, withRequestId } from '@/server/request-id'
import { recordError, recordRequest } from '@/server/telemetry'
import type { ApiKey } from '@/dal/api-v1'
import { loadCtx, type Ctx } from '@/server/context'

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

async function failure(e: unknown, scope: string): Promise<NextResponse> {
  if (e instanceof DomainError) return NextResponse.json({ error: e.code, message: e.en }, { status: e.status })
  if (e instanceof ZodError) return NextResponse.json({ error: 'invalid' }, { status: 422 })
  // GOB-07: el error inesperado queda con el identificador de la llamada, sin datos de nadie; quien llama recibe la misma referencia.
  const requestId = await currentRequestId()
  const err = e as { code?: string; name?: string }
  console.error(JSON.stringify({ level: 'error', msg: 'api_failed', scope, request_id: requestId, name: err?.name ?? 'Error', code: err?.code ?? null }))
  if (requestId) await recordError('api', scope, requestId, err?.name ?? 'Error', err?.code ?? null)
  return NextResponse.json({ error: 'internal', request_id: requestId }, { status: 500 })
}

/**
 * GOB-07: cada llamada lleva su identificador (el que manda quien llama, si tiene forma de identificador, o uno nuevo),
 * vuelve en el encabezado x-request-id, queda en la bitácora y en el registro de errores, y se mide (tiempo y si falló).
 */
async function traced(request: NextRequest, scope: string, run: () => Promise<NextResponse>): Promise<NextResponse> {
  const requestId = cleanRequestId(request.headers.get('x-request-id'))
  const started = Date.now()
  const response = await withRequestId(requestId, run)
  response.headers.set('x-request-id', requestId)
  await recordRequest('api', scope, Date.now() - started, response.status >= 500, requestId)
  return response
}

/** Entradas (POST): eventos de la Sales App, archivo diario y formularios del sitio. */
export function apiHandler(request: NextRequest, scope: string, fn: (body: unknown, idempotencyKey: string | null) => Promise<unknown>) {
  return traced(request, scope, () => handlePost(request, scope, fn))
}

async function handlePost(request: NextRequest, scope: string, fn: (body: unknown, idempotencyKey: string | null) => Promise<unknown>): Promise<NextResponse> {
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
export function apiRead(request: NextRequest, scope: string, fn: (key: ApiKey, params: URLSearchParams) => Promise<unknown>) {
  return traced(request, scope, () => handleGet(request, scope, fn))
}

async function handleGet(request: NextRequest, scope: string, fn: (key: ApiKey, params: URLSearchParams) => Promise<unknown>): Promise<NextResponse> {
  const auth = await authenticate(request, scope)
  if ('response' in auth) return auth.response
  try {
    const out = await fn(auth.key, request.nextUrl.searchParams)
    // SEG-03: cada lectura con una llave queda en el registro de lecturas de la base, con cuántas filas salieron (los datos de prueba no cuentan).
    const rows = Array.isArray((out as { data?: unknown } | null)?.data) ? (out as { data: unknown[] }).data.length : 0
    if (auth.key.mode === 'live') await withoutUser((tx) => tx`select app.log_read('api', ${scope}, ${rows}, ${auth.key.market}, null, ${auth.key.id})`)
    return NextResponse.json(out, {
      headers: { 'cache-control': 'no-store', 'x-ratelimit-limit': String(auth.key.ratePerMinute), 'x-contigo-data': auth.key.mode === 'test' ? 'synthetic' : 'live' },
    })
  } catch (e) {
    return failure(e, scope)
  }
}

/**
 * AUT-04: escritura general sobre el dominio (POST/PATCH). La llave actúa como la persona que la creó, con sus permisos y su
 * alcance, acotada al mercado de la llave; el comando del dominio valida, deja la bitácora y emite el evento como en pantalla.
 * Una llave de prueba (ctg_test_) no escribe.
 */
export function apiWrite(request: NextRequest, scope: string, fn: (ctx: Ctx, market: string, body: unknown) => Promise<unknown>) {
  return traced(request, scope, () => handleWrite(request, scope, fn))
}

async function handleWrite(request: NextRequest, scope: string, fn: (ctx: Ctx, market: string, body: unknown) => Promise<unknown>): Promise<NextResponse> {
  const auth = await authenticate(request, scope)
  if ('response' in auth) return auth.response
  const key = auth.key
  if (key.mode === 'test') return NextResponse.json({ error: 'forbidden', message: 'Test keys only read.' }, { status: 403 })
  if (!key.market || !key.createdBy) return NextResponse.json({ error: 'forbidden', message: 'The key has no market.' }, { status: 403 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  try {
    const base = await loadCtx(key.createdBy, 'en')
    if (!base) return NextResponse.json({ error: 'forbidden', message: 'The key owner is no longer active.' }, { status: 403 })
    const market = key.market
    // Lo mismo que la persona puede hacer, pero solo en el mercado de la llave.
    const ctx: Ctx = {
      ...base,
      markets: base.markets.filter((m) => m.code === market),
      can: (cap, m) => (!m || m === market) && base.can(cap, m ?? market),
      assert: (cap, m) => {
        if (m && m !== market) throw new DomainError('forbidden', 'No tienes permiso para hacer esto.', 'You do not have permission to do this.', 403)
        base.assert(cap, m ?? market)
      },
    }
    const out = await runVia('api', () => fn(ctx, market, body))
    return NextResponse.json(out, { status: request.method === 'POST' ? 201 : 200, headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return failure(e, scope)
  }
}
