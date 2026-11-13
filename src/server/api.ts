import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { withoutUser } from '@/server/db'
import { hashKey } from '@/domain/admin'
import { DomainError } from '@/lib/errors'
import { cleanRequestId, withRequestId } from '@/server/request-id'
import { recordError, recordRequest } from '@/server/telemetry'

/**
 * AUT-04 / SEC-02: cada ruta de API autentica con una llave (hash en la base), revisa el permiso (scope)
 * y deja la validación del cuerpo al dominio. Las respuestas no filtran detalles internos.
 */
export async function apiHandler(request: NextRequest, scope: string, fn: (body: unknown, idempotencyKey: string | null) => Promise<unknown>) {
  // GOB-07: cada llamada lleva su identificador (el que manda quien llama, si tiene forma de identificador, o uno nuevo),
  // vuelve en el encabezado x-request-id y queda en la bitácora y en el registro de errores.
  const requestId = cleanRequestId(request.headers.get('x-request-id'))
  const started = Date.now()
  const response = await withRequestId(requestId, () => handle(request, scope, fn, requestId))
  response.headers.set('x-request-id', requestId)
  await recordRequest('api', scope, Date.now() - started, response.status >= 500, requestId)
  return response
}

async function handle(request: NextRequest, scope: string, fn: (body: unknown, idempotencyKey: string | null) => Promise<unknown>, requestId: string) {
  const auth = request.headers.get('authorization') ?? ''
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!key.startsWith('ctg_')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const clients = await withoutUser((tx) => tx<{ id: string; scopes: string[] }[]>`select id, scopes from app.api_client(${hashKey(key)})`)
  const client = clients[0]
  if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!client.scopes.includes(scope)) return NextResponse.json({ error: 'forbidden', required_scope: scope }, { status: 403 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  try {
    return NextResponse.json(await fn(body, request.headers.get('idempotency-key')))
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.code, message: e.en }, { status: e.status })
    if (e instanceof ZodError) return NextResponse.json({ error: 'invalid' }, { status: 422 })
    const err = e as { code?: string; name?: string }
    console.error(JSON.stringify({ level: 'error', msg: 'api_failed', scope, request_id: requestId, name: err?.name ?? 'Error', code: err?.code ?? null }))
    await recordError('api', scope, requestId, err?.name ?? 'Error', err?.code ?? null)
    return NextResponse.json({ error: 'internal', request_id: requestId }, { status: 500 })
  }
}
