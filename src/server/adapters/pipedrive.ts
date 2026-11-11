import 'server-only'
import { env } from '@/env'

/**
 * PORT-01: única puerta hacia la API de Pipedrive (v2 donde existe, v1 para usuarios, leads y notas).
 * Solo lectura: este adapter no tiene ninguna operación de escritura. El token viaja en el encabezado
 * x-api-token y nunca se registra (OBS-01).
 */
export type PdItem = Record<string, unknown>
export type PdPage = { items: PdItem[]; next: string | null }
export type PdMode = 'cursor' | 'offset' | 'single'

export class PipedriveError extends Error {
  constructor(
    public code: 'not_configured' | 'unauthorized' | 'rate_limited' | 'not_found' | 'upstream',
    public status: number,
    public retryAfterSeconds?: number,
  ) {
    super(`pipedrive_${code}`)
    this.name = 'PipedriveError'
  }
}

export const pipedriveConfigured = () => Boolean(env().PIPEDRIVE_API_TOKEN)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call(path: string, params: Record<string, string | number | undefined>): Promise<Record<string, unknown>> {
  const token = env().PIPEDRIVE_API_TOKEN
  if (!token) throw new PipedriveError('not_configured', 0)
  const url = new URL(path, env().PIPEDRIVE_API_BASE)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  let lastStatus = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { headers: { 'x-api-token': token, accept: 'application/json' }, signal: AbortSignal.timeout(25_000), cache: 'no-store' })
    } catch {
      lastStatus = 0
      await sleep(600 * (attempt + 1))
      continue
    }
    lastStatus = res.status
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset') ?? 2)
      if (wait <= 3 && attempt < 2) {
        await sleep(Math.max(1, wait) * 1000)
        continue
      }
      throw new PipedriveError('rate_limited', 429, Number.isFinite(wait) ? wait : 60)
    }
    if (res.status === 401 || res.status === 403) throw new PipedriveError('unauthorized', res.status)
    if (res.status === 404 || res.status === 410) throw new PipedriveError('not_found', res.status)
    if (res.status >= 500) {
      await sleep(800 * (attempt + 1))
      continue
    }
    if (!res.ok) throw new PipedriveError('upstream', res.status)
    return (await res.json()) as Record<string, unknown>
  }
  throw new PipedriveError('upstream', lastStatus)
}

/**
 * Una página de una lista. `cursor` es opaco para quien llama: en v2 es el next_cursor de Pipedrive,
 * en v1 es la posición (start). Devuelve next = null al llegar al final.
 */
export async function pdList(path: string, mode: PdMode, params: Record<string, string | number | undefined>, cursor: string | null, limit = 500): Promise<PdPage> {
  if (mode === 'single') {
    const body = await call(path, params)
    return { items: asItems(body.data), next: null }
  }
  if (mode === 'cursor') {
    const body = await call(path, { ...params, limit, cursor: cursor ?? undefined })
    const ad = (body.additional_data ?? {}) as { next_cursor?: string | null }
    return { items: asItems(body.data), next: ad.next_cursor || null }
  }
  const start = cursor ? Number(cursor) : 0
  const body = await call(path, { ...params, limit, start })
  const items = asItems(body.data)
  const ad = (body.additional_data ?? {}) as Record<string, unknown>
  const pg = ((ad.pagination as Record<string, unknown> | undefined) ?? ad) as { more_items_in_collection?: boolean; next_start?: number }
  const more = pg.more_items_in_collection === true && items.length > 0
  return { items, next: more ? String(pg.next_start ?? start + items.length) : null }
}

function asItems(data: unknown): PdItem[] {
  if (Array.isArray(data)) return data.filter((x): x is PdItem => typeof x === 'object' && x !== null)
  return []
}
