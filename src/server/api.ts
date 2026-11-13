import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { runVia, withoutUser } from '@/server/db'
import { hashKey } from '@/domain/admin'
import { DomainError } from '@/lib/errors'

/**
 * AUT-04 / SEC-02: cada ruta de API autentica con una llave (hash en la base), revisa el permiso (scope)
 * y deja la validación del cuerpo al dominio. Las respuestas no filtran detalles internos.
 */
export async function apiHandler(request: NextRequest, scope: string, fn: (body: unknown, idempotencyKey: string | null) => Promise<unknown>) {
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
  // SEG-08: cada llamada deja el último uso de la llave y una fila por llave en el registro de lecturas.
  await withoutUser((tx) => tx`select app.api_client_used(${client.id}, ${scope})`)
  try {
    return NextResponse.json(await runVia('api', () => fn(body, request.headers.get('idempotency-key'))))
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.code, message: e.en }, { status: e.status })
    if (e instanceof ZodError) return NextResponse.json({ error: 'invalid' }, { status: 422 })
    console.error(JSON.stringify({ level: 'error', msg: 'api_failed', scope }))
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
