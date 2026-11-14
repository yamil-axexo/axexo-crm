import 'server-only'
import { withoutUser } from '@/server/db'
import { tracesAdapter } from '@/server/adapters/traces'

/**
 * GOB-07: medición interna. Cada petición suma a su renglón del día (conteo, errores, tiempos) y cada error inesperado deja
 * su registro con el identificador de la petición. No guarda quién, qué registro ni el mensaje del error (OBS-01).
 * Nunca rompe la petición: si la medición falla, se pierde ese dato y nada más.
 */
type Kind = 'page' | 'action' | 'api' | 'probe'

async function later(fn: () => Promise<unknown>): Promise<void> {
  const safe = () => fn().catch(() => {})
  try {
    // Después de responder, para no sumar tiempo a la persona. Fuera de una petición (pruebas, tareas) corre en el momento.
    const { after } = await import('next/server')
    after(safe)
  } catch {
    await safe()
  }
}

export async function recordRequest(kind: Kind, screen: string, ms: number, error: boolean, requestId = ''): Promise<void> {
  if (kind !== 'probe') tracesAdapter().export({ requestId, kind, screen, ms: Math.round(ms), error })
  await later(() => withoutUser((tx) => tx`select app.record_request(${kind}, ${screen}, ${Math.round(ms)}, ${error})`))
}

export async function recordError(kind: 'page' | 'action' | 'api' | 'job', screen: string, requestId: string, name: string, code: string | null): Promise<void> {
  await later(() => withoutUser((tx) => tx`select app.record_error(${requestId || null}, ${kind}, ${screen}, ${name}, ${code})`))
}
