import 'server-only'

/**
 * Cliente HTTP único de los conectores `live` (fetch nativo, sin dependencias).
 * - Solo sale a los hosts permitidos del conector (lista cerrada por proveedor). Cualquier otro host: `egress_blocked`.
 * - Reintenta con espera creciente en errores de red y 5xx; respeta Retry-After en 429 hasta un tope; si no, `rate_limited`.
 * - Espacia las llamadas de un mismo conector (límite de tasa propio) para no pegarle al límite del proveedor.
 * - Nunca registra encabezados ni cuerpos: el error lleva solo un código y el estado HTTP (OBS-01).
 * En pruebas (APP_ENV=test o development) `CONNECTOR_TEST_BASE_URL` puede apuntar a un servidor falso en 127.0.0.1;
 * en staging y producción esa variable no se lee.
 */
export type ConnectorErrorCode = 'egress_blocked' | 'unauthorized' | 'rate_limited' | 'bad_request' | 'not_found' | 'upstream' | 'network' | 'invalid_response' | 'refused'
export class ConnectorError extends Error {
  constructor(
    public connector: string,
    public code: ConnectorErrorCode,
    public status = 0,
    public retryAfterSeconds?: number,
  ) {
    super(`${connector}_${code}${status ? `_${status}` : ''}`)
    this.name = 'ConnectorError'
  }
}

export type HttpResult = { status: number; headers: Headers; text: string; json: <T = unknown>() => T }
export type HttpOptions = {
  connector: string
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string | Uint8Array
  json?: unknown
  /** Hosts a los que este conector puede salir (exacto o subdominio). */
  allowHosts: readonly string[]
  /** Intentos en total (por defecto 3). */
  attempts?: number
  timeoutMs?: number
  /** Mayor Retry-After (segundos) que se espera dentro de la misma llamada. */
  maxRetryAfterSeconds?: number
  /** Separación mínima entre dos llamadas del mismo conector, en milisegundos. */
  minIntervalMs?: number
  /** Estados que no son error para quien llama (por ejemplo 404 al buscar). */
  acceptStatus?: number[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isTestEnv = () => process.env.APP_ENV === 'test' || process.env.APP_ENV === 'development'
const backoffBase = () => (process.env.APP_ENV === 'test' ? 5 : 500)

/** La base de pruebas, solo si es local y el ambiente es de pruebas o desarrollo. */
export function testBase(): URL | null {
  if (!isTestEnv()) return null
  const raw = process.env.CONNECTOR_TEST_BASE_URL
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' ? u : null
  } catch {
    return null
  }
}

export function hostAllowed(host: string, allow: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return allow.some((d) => {
    const a = d.toLowerCase()
    return a.length > 0 && (h === a || h.endsWith(`.${a}`))
  })
}

const lastCall = new Map<string, number>()
async function pace(connector: string, minIntervalMs: number | undefined) {
  if (!minIntervalMs) return
  const prev = lastCall.get(connector) ?? 0
  const wait = prev + minIntervalMs - Date.now()
  lastCall.set(connector, Math.max(Date.now(), prev + minIntervalMs))
  if (wait > 0) await sleep(wait)
}

export async function http(opts: HttpOptions): Promise<HttpResult> {
  let url: URL
  try {
    url = new URL(opts.url)
  } catch {
    throw new ConnectorError(opts.connector, 'egress_blocked')
  }
  if (url.protocol !== 'https:' || !hostAllowed(url.hostname, opts.allowHosts)) throw new ConnectorError(opts.connector, 'egress_blocked')
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) }
  let body: string | Uint8Array | undefined = opts.body
  if (opts.json !== undefined) {
    body = JSON.stringify(opts.json)
    headers['content-type'] ??= 'application/json'
  }
  // Pruebas: el mismo camino y consulta, en el servidor falso local. El host original viaja en un encabezado para revisarlo.
  const base = testBase()
  // En pruebas automáticas nunca se sale a internet: sin servidor falso local, la llamada no sale.
  if (!base && process.env.APP_ENV === 'test') throw new ConnectorError(opts.connector, 'egress_blocked')
  if (base) {
    headers['x-contigo-original-host'] = url.hostname
    url = new URL(`${url.pathname}${url.search}`, base)
  }
  const attempts = Math.max(1, opts.attempts ?? 3)
  const maxWait = opts.maxRetryAfterSeconds ?? 10
  let last: ConnectorError = new ConnectorError(opts.connector, 'network')
  for (let i = 0; i < attempts; i++) {
    await pace(opts.connector, opts.minIntervalMs)
    let res: Response
    try {
      res = await fetch(url, { method: opts.method ?? (body !== undefined ? 'POST' : 'GET'), headers, body: body as BodyInit | undefined, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000), cache: 'no-store', redirect: 'error' })
    } catch {
      last = new ConnectorError(opts.connector, 'network')
      if (i < attempts - 1) await sleep(backoffBase() * 2 ** i)
      continue
    }
    const text = await res.text()
    const out: HttpResult = {
      status: res.status,
      headers: res.headers,
      text,
      json: <T,>() => {
        try {
          return JSON.parse(text) as T
        } catch {
          throw new ConnectorError(opts.connector, 'invalid_response', res.status)
        }
      },
    }
    if (opts.acceptStatus?.includes(res.status)) return out
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'))
      const wait = Number.isFinite(ra) && ra >= 0 ? ra : 1
      last = new ConnectorError(opts.connector, 'rate_limited', 429, wait)
      if (wait <= maxWait && i < attempts - 1) {
        await sleep(Math.max(wait * 1000, backoffBase()))
        continue
      }
      throw last
    }
    if (res.status >= 500) {
      last = new ConnectorError(opts.connector, 'upstream', res.status)
      if (i < attempts - 1) await sleep(backoffBase() * 2 ** i)
      continue
    }
    if (res.status === 401 || res.status === 403) throw new ConnectorError(opts.connector, 'unauthorized', res.status)
    if (res.status === 404) throw new ConnectorError(opts.connector, 'not_found', 404)
    if (res.status >= 400) throw new ConnectorError(opts.connector, 'bad_request', res.status)
    return out
  }
  throw last
}

/** Un texto corto y sin secretos para la bitácora y la pantalla. */
export const errorCode = (e: unknown): string => (e instanceof ConnectorError ? e.message : 'unexpected_error')
