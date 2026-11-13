import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/**
 * GOB-07: el identificador de la petición viaja de punta a punta. Lo pone la entrada (proxy para las pantallas, el manejador
 * para la API), lo lleva cada transacción (`app.request_id`), queda en la bitácora (`audit_events.request_id`), en el registro
 * de errores y en el mensaje que ve la persona cuando algo falla de nuestro lado ("Referencia").
 */
const g = globalThis as unknown as { __contigoRequestScope?: AsyncLocalStorage<{ id: string }> }
const scope = (g.__contigoRequestScope ??= new AsyncLocalStorage<{ id: string }>())

const VALID = /^[A-Za-z0-9._-]{8,80}$/
/** Un identificador que llega de afuera solo se acepta si tiene forma de identificador; si no, se crea uno. */
export const cleanRequestId = (raw: string | null | undefined): string => (raw && VALID.test(raw) ? raw : randomUUID())

export function withRequestId<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return scope.run({ id }, fn)
}

/** El identificador de la petición en curso; cadena vacía fuera de una petición (tareas programadas, pruebas). */
export async function currentRequestId(): Promise<string> {
  const scoped = scope.getStore()?.id
  if (scoped) return scoped
  if (!process.env.NEXT_RUNTIME) return ''
  try {
    const { headers } = await import('next/headers')
    const id = (await headers()).get('x-request-id')
    return id && VALID.test(id) ? id : ''
  } catch {
    return ''
  }
}

/** La referencia corta que ve la persona y que administración busca en Estado de CONTIGO. */
export const shortRef = (id: string) => id.replace(/-/g, '').slice(0, 8)
