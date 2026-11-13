import 'server-only'
import { createHash } from 'node:crypto'
import { withoutUser } from '@/server/db'

// AUT-04 / SEG-10: límite de frecuencia hecho en la base (ventana deslizante, app.rate_hit). No depende del borde ni de
// memoria del proceso: vale igual con una instancia o con veinte.
export const LIMITS = {
  /** Solicitudes a la API por IP, por minuto (además del límite propio de cada llave). */
  apiPerIp: 300,
  /** Intentos con llave inválida por IP, por minuto. Pasado el tope, la respuesta es 429 y ya no 401. */
  apiAuthFailPerIp: 20,
  /** Veces que una IP puede abrir la página de un formulario público, por minuto. */
  formViewsPerIp: 40,
  /** Envíos de un formulario público por IP, por minuto (cada formulario puede traer el suyo). */
  formSubmitsPerIp: 10,
  /** Segundos mínimos entre que se muestra el formulario y se envía (cada formulario puede traer el suyo). */
  formMinFillSeconds: 3,
} as const

/** La IP de quien llama, según el primer salto que reporta la plataforma. Nunca se guarda: solo su huella. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (fwd || headers.get('x-real-ip') || 'unknown').slice(0, 64)
}
export const ipHash = (ip: string) => createHash('sha256').update(`contigo-ip:${ip}`).digest('hex').slice(0, 32)

export type RateResult = { allowed: boolean; retryAfter: number }

/** Cuenta una solicitud en su cubeta y dice si pasa. Va en su propia transacción: lo rechazado también cuenta. */
export async function rateHit(bucket: string, limit: number, windowSeconds = 60): Promise<RateResult> {
  const rows = await withoutUser((tx) => tx<{ allowed: boolean; retry_after: number }[]>`select allowed, retry_after from app.rate_hit(${bucket.slice(0, 200)}, ${limit}, ${windowSeconds})`)
  return { allowed: rows[0]?.allowed === true, retryAfter: rows[0]?.retry_after ?? windowSeconds }
}

/**
 * Envíos por IP y por minuto de un formulario sin límite propio. Las pruebas de punta a punta mandan decenas de
 * formularios desde la misma dirección y lo suben con PUBLIC_FORM_SUBMITS_PER_MINUTE; en producción rige el valor de la app.
 */
export function defaultFormSubmitsPerIp(): number {
  const raw = process.env.PUBLIC_FORM_SUBMITS_PER_MINUTE
  const n = raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 600 && process.env.APP_ENV !== 'production' ? n : LIMITS.formSubmitsPerIp
}

/** Tiempo mínimo de llenado por defecto. Las pruebas automáticas de punta a punta lo bajan a 0 con PUBLIC_FORM_MIN_SECONDS. */
export function defaultMinFillSeconds(): number {
  const raw = process.env.PUBLIC_FORM_MIN_SECONDS
  const n = raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 120 && process.env.APP_ENV !== 'production' ? n : LIMITS.formMinFillSeconds
}
