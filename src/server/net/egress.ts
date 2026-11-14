import 'server-only'

/**
 * IA-07: allowlist de salida aplicada en código. TODA llamada de red que sale de CONTIGO pasa por `egressFetch`; una prueba
 * (tests/db/plataforma.test.ts) falla si aparece un `fetch(` del lado del servidor fuera de este archivo.
 * - Solo https, y solo a un host de la lista cerrada `EGRESS_ALLOWLIST` (exacto o subdominio). Lo demás: `EgressBlocked`,
 *   sin llamar a nada, y queda contado en `blockedEgress()` para Estado de CONTIGO.
 * - Quien llama puede acotar más con `allowHosts` (los hosts de su proveedor): el host tiene que estar en las dos listas.
 * - Los destinos de suscriptores de eventos (AUT-02) no son proveedores fijos: se agregan con EVENT_DELIVERY_HOSTS
 *   (lista separada por comas que pone quien opera la plataforma, no la aplicación).
 * - En pruebas y desarrollo se permite 127.0.0.1 / localhost por http (servidores falsos locales). Nunca en staging ni producción.
 * El control a nivel de red de la plataforma (egress de Vercel/Supabase) queda como paso de quien opera: docs/egress.md.
 */
export const EGRESS_ALLOWLIST: Record<string, readonly string[]> = {
  pipedrive: ['api.pipedrive.com', 'pipedrive.com'],
  supabase: ['supabase.co'],
  google: ['googleapis.com', 'oauth2.googleapis.com'],
  slack: ['slack.com'],
  whatsapp: ['graph.facebook.com'],
  anthropic: ['api.anthropic.com'],
  dropbox_sign: ['api.hellosign.com'],
  zendesk: ['zendesk.com'],
  zoho: ['zoho.com'],
  vercel: ['api.vercel.com'],
  web_push: ['fcm.googleapis.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'],
  // Integración ola 7: proveedores de los conectores live (paquete conectores).
  zoho_api: ['zohoapis.com'],
  ad_conversions: ['graph.facebook.com', 'googleapis.com', 'api.linkedin.com', 'business-api.tiktok.com'],
  antibot: ['challenges.cloudflare.com'],
}

/**
 * Servicios con contrato propio cuyo host lo pone quien opera la plataforma en la URL del conector (Kore Academy, herramienta
 * de rutas, registro fiscal, trazas, resumen hacia P&T). Igual que EVENT_DELIVERY_HOSTS: es configuración del ambiente, no de
 * la aplicación, y solo el host de esa URL entra a la lista.
 */
export const CONTRACT_URL_VARS = ['KORE_ACADEMY_URL', 'ROUTE_TOOL_URL', 'TAX_REGISTRY_URL', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'FEEDBACK_TO_PT_URL'] as const
const contractHosts = (): string[] => CONTRACT_URL_VARS.flatMap((v) => {
  try { const u = new URL(process.env[v] ?? ''); return u.protocol === 'https:' ? [u.hostname.toLowerCase()] : [] } catch { return [] }
})

export class EgressBlocked extends Error {
  constructor(public host: string, public purpose: string) {
    super(`egress_blocked:${purpose}`)
    this.name = 'EgressBlocked'
  }
}

const g = globalThis as unknown as { __contigoBlockedEgress?: { at: string; host: string; purpose: string }[] }
/** Intentos de salida bloqueados en este proceso (los últimos 50). Sin rutas ni parámetros: solo host y propósito. */
export const blockedEgress = () => (g.__contigoBlockedEgress ??= [])

const isLocalEnv = () => process.env.APP_ENV === 'test' || process.env.APP_ENV === 'development'
const matches = (host: string, list: readonly string[]) => list.some((d) => d && (host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`)))

/** Todos los hosts permitidos: los de proveedores más los destinos de eventos que puso quien opera. */
export function allowedHosts(): string[] {
  const extra = (process.env.EVENT_DELIVERY_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]{3,253}$/.test(h))
  return [...new Set([...Object.values(EGRESS_ALLOWLIST).flat(), ...extra, ...contractHosts()])]
}

/** ¿Puede salir esta URL? Devuelve el motivo si no. */
export function egressCheck(raw: string | URL, purpose: string, allowHosts?: readonly string[]): { ok: true; url: URL } | { ok: false; host: string; reason: 'invalid' | 'protocol' | 'host' } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, host: '', reason: 'invalid' }
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const loopback = host === '127.0.0.1' || host === 'localhost'
  if (loopback) return isLocalEnv() ? { ok: true, url } : { ok: false, host, reason: 'host' }
  if (url.protocol !== 'https:') return { ok: false, host, reason: 'protocol' }
  if (!matches(host, allowedHosts())) return { ok: false, host, reason: 'host' }
  if (allowHosts && !matches(host, allowHosts)) return { ok: false, host, reason: 'host' }
  return { ok: true, url }
}

/** El único `fetch` del servidor. `purpose` dice para qué sale (queda en el registro si se bloquea). */
export async function egressFetch(raw: string | URL, init: RequestInit, rule: { purpose: string; allowHosts?: readonly string[] }): Promise<Response> {
  const check = egressCheck(raw, rule.purpose, rule.allowHosts)
  if (!check.ok) {
    const list = blockedEgress()
    list.push({ at: new Date().toISOString(), host: check.host, purpose: rule.purpose })
    if (list.length > 50) list.splice(0, list.length - 50)
    throw new EgressBlocked(check.host, rule.purpose)
  }
  // Sin redirecciones automáticas: una redirección podría llevar a un host fuera de la lista.
  return fetch(check.url, { ...init, redirect: 'manual' })
}
