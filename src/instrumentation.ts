// GOB-07: un error que nadie atrapó (al armar una pantalla, en una ruta o en una acción) deja su registro con el
// identificador de la petición y la pantalla. Nunca el mensaje ni los datos (OBS-01).
type RequestInfo = { path: string; method: string; headers: Record<string, string | string[] | undefined> }
type ErrorContext = { routerKind: string; routePath: string; routeType: 'render' | 'route' | 'action' | 'middleware' | 'proxy' }

export async function onRequestError(err: unknown, request: RequestInfo, context: ErrorContext): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { withoutUser } = await import('@/server/db')
    const { screenKey } = await import('@/lib/screen-key')
    const raw = request.headers['x-request-id']
    const requestId = (Array.isArray(raw) ? raw[0] : raw) ?? ''
    const e = err as { name?: string; code?: string }
    const kind = context.routeType === 'route' ? 'api' : context.routeType === 'action' ? 'action' : 'page'
    const screen = screenKey(context.routePath || request.path)
    console.error(JSON.stringify({ level: 'error', msg: 'request_failed', kind, screen, request_id: requestId || null, name: e?.name ?? 'Error', code: e?.code ?? null }))
    await withoutUser((tx) => tx`select app.record_error(${requestId || null}, ${kind}, ${screen}, ${e?.name ?? 'Error'}, ${typeof e?.code === 'string' ? e.code : null})`)
  } catch {
    // La medición nunca tapa el error original.
  }
}
