import 'server-only'
import { withUser, type Tx } from '@/server/db'
import { API_PAGE, API_RESOURCES, type ApiResource } from '@/domain/api-spec'
import { sandboxCatalogs, sandboxRows } from '@/server/api-sandbox'
import { DomainError } from '@/lib/errors'

// AUT-04: lecturas de la API v1. Corren con la identidad de quien creó la llave (las políticas de la base deciden qué
// filas ve, igual que en su pantalla) y además se acotan al mercado de la llave. Paginación por cursor sobre el id
// (uuid v7: ordena por alta).
export type ApiKey = { id: string; scopes: string[]; market: string | null; mode: 'live' | 'test'; ratePerMinute: number; createdBy: string | null }
export type Page = { data: Record<string, unknown>[]; next_cursor: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bad = (detail: string) => new DomainError('invalid_filter', 'Filtro inválido.', `Invalid filter: ${detail}`, 400)

export const encodeCursor = (id: string) => Buffer.from(id, 'utf8').toString('base64url')
export function decodeCursor(raw: string | null): string | null {
  if (!raw) return null
  const id = Buffer.from(raw, 'base64url').toString('utf8')
  if (!UUID.test(id)) throw bad('cursor')
  return id
}

export type Query = { limit: number; cursor: string | null; filters: Record<string, string> }

/** Valida límite, cursor y filtros contra la definición del recurso. Un filtro que no existe se rechaza: no se ignora. */
export function parseQuery(resource: ApiResource, params: URLSearchParams): Query {
  const filters: Record<string, string> = {}
  let limit: number = API_PAGE.default
  let cursor: string | null = null
  for (const [k, v] of params) {
    if (k === 'limit') {
      limit = Number(v)
      if (!Number.isInteger(limit) || limit < 1 || limit > API_PAGE.max) throw bad(`limit must be between 1 and ${API_PAGE.max}`)
    } else if (k === 'cursor') cursor = decodeCursor(v)
    else {
      const f = resource.filters.find((x) => x.name === k)
      if (!f) throw bad(`unknown parameter ${k.slice(0, 40)}`)
      if (f.values && !f.values.includes(v)) throw bad(`${k} must be one of ${f.values.join(', ')}`)
      if (f.type === 'uuid' && !UUID.test(v)) throw bad(`${k} must be a uuid`)
      if (f.type === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v) || Number.isNaN(Date.parse(v)))) throw bad(`${k} must be an ISO 8601 date-time with offset`)
      if (v.length > 80) throw bad(k)
      filters[k] = v
    }
  }
  return { limit, cursor, filters }
}

const page = (rows: Record<string, unknown>[], limit: number): Page => {
  const data = rows.slice(0, limit)
  return { data, next_cursor: rows.length > limit ? encodeCursor(String(data[data.length - 1]!.id)) : null }
}

/** Juego sintético: mismos filtros y misma paginación, en memoria. */
function sandboxPage(resource: ApiResource, market: string, q: Query): Page {
  let rows = sandboxRows(resource.name, market).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  for (const [k, v] of Object.entries(q.filters)) {
    if (k === 'updated_since') rows = rows.filter((r) => String(r.updated_at) >= new Date(v).toISOString())
    else if (k === 'created_since') rows = rows.filter((r) => String(r.created_at) >= new Date(v).toISOString())
    else rows = rows.filter((r) => String(r[k]) === v)
  }
  if (q.cursor) rows = rows.filter((r) => String(r.id) > q.cursor!)
  return page(rows.slice(0, q.limit + 1), q.limit)
}

async function assertReach(tx: Tx, market: string): Promise<void> {
  const ok = await tx`select 1 from crm.users u where u.id = app.current_user_id() and u.is_active and ${market} = any(app.my_markets())`
  if (!ok[0]) throw new DomainError('forbidden', 'Quien creó la llave ya no tiene acceso a ese mercado.', 'The key’s creator no longer has access to that market.', 403)
}

export async function readResource(key: ApiKey, name: ApiResource['name'], params: URLSearchParams): Promise<Page> {
  const resource = API_RESOURCES.find((r) => r.name === name)!
  const q = parseQuery(resource, params)
  const market = key.market
  if (!market || !key.createdBy) throw new DomainError('forbidden', 'La llave no tiene mercado.', 'The key has no market.', 403)
  if (key.mode === 'test') return sandboxPage(resource, market, q)
  const f = q.filters
  const n = q.limit + 1
  return withUser(key.createdBy, async (tx) => {
    await assertReach(tx, market)
    const after = q.cursor ? tx`and x.id > ${q.cursor}` : tx``
    if (name === 'accounts') {
      const rows = await tx<Record<string, unknown>[]>`
        select x.id, x.market_code as market, x.kind, x.account_type, x.name, x.segment, x.lifecycle, x.parent_id, x.owner_id, x.territory_id, x.locality, x.region,
               x.merchant_ref, x.created_at, x.updated_at
          from crm.accounts x
         where x.market_code = ${market} and x.archived_at is null ${after}
           ${f.lifecycle ? tx`and x.lifecycle = ${f.lifecycle}` : tx``} ${f.kind ? tx`and x.kind = ${f.kind}` : tx``}
           ${f.updated_since ? tx`and x.updated_at >= ${f.updated_since}::timestamptz` : tx``}
         order by x.id limit ${n}`
      return page([...rows], q.limit)
    }
    if (name === 'deals') {
      const rows = await tx<Record<string, unknown>[]>`
        select x.id, x.market_code as market, x.account_id, x.pipeline_id, x.stage_id, x.owner_id, x.status, x.amount_minor::float8 as amount_minor, trim(x.currency) as currency,
               x.loss_reason_code, x.next_step_due::text as next_step_due, x.won_at, x.lost_at, x.closed_by, x.created_at, x.updated_at
          from crm.deals x
         where x.market_code = ${market} ${after}
           ${f.status ? tx`and x.status = ${f.status}` : tx``} ${f.pipeline_id ? tx`and x.pipeline_id = ${f.pipeline_id}` : tx``}
           ${f.account_id ? tx`and x.account_id = ${f.account_id}` : tx``} ${f.updated_since ? tx`and x.updated_at >= ${f.updated_since}::timestamptz` : tx``}
         order by x.id limit ${n}`
      return page([...rows], q.limit)
    }
    if (name === 'leads') {
      const rows = await tx<Record<string, unknown>[]>`
        select x.id, x.market_code as market, x.source, x.motor, x.status, x.business_name, x.locality, x.owner_id, x.sla_due_at, x.first_touch_at,
               exists (select 1 from crm.untrusted_marks um where um.object = 'lead' and um.object_id = x.id) as untrusted, x.created_at, x.updated_at
          from crm.leads x
         where x.market_code = ${market} ${after}
           ${f.status ? tx`and x.status = ${f.status}` : tx``} ${f.source ? tx`and x.source = ${f.source}` : tx``}
           ${f.updated_since ? tx`and x.updated_at >= ${f.updated_since}::timestamptz` : tx``}
         order by x.id limit ${n}`
      return page([...rows], q.limit)
    }
    const rows = await tx<Record<string, unknown>[]>`
      select x.id, x.market_code as market, x.account_id, x.deal_id, x.lead_id, x.kind, x.due_at, x.done_at, x.owner_id, x.source, x.created_at
        from crm.activities x
       where x.market_code = ${market} ${after}
         ${f.kind ? tx`and x.kind = ${f.kind}` : tx``} ${f.account_id ? tx`and x.account_id = ${f.account_id}` : tx``}
         ${f.deal_id ? tx`and x.deal_id = ${f.deal_id}` : tx``} ${f.created_since ? tx`and x.created_at >= ${f.created_since}::timestamptz` : tx``}
       order by x.id limit ${n}`
    return page([...rows], q.limit)
  })
}

export async function readCatalogs(key: ApiKey): Promise<Record<string, unknown>> {
  const market = key.market
  if (!market || !key.createdBy) throw new DomainError('forbidden', 'La llave no tiene mercado.', 'The key has no market.', 403)
  if (key.mode === 'test') return sandboxCatalogs(market)
  return withUser(key.createdBy, async (tx) => {
    await assertReach(tx, market)
    const pipelines = await tx<{ id: string; name: string; motor: string }[]>`select id, name, motor from crm.pipelines where market_code = ${market} and is_active order by name`
    const stages = await tx<{ id: string; pipeline_id: string; position: number; name_es: string; name_en: string; kind: string }[]>`
      select s.id, s.pipeline_id, s.position, s.name_es, s.name_en, s.kind from crm.stages s join crm.pipelines p on p.id = s.pipeline_id
       where p.market_code = ${market} and p.is_active order by s.position`
    const reasons = await tx`select code, kind, label_es, label_en from crm.loss_reasons where market_code is null or market_code = ${market} order by code`
    const types = await tx`select code, kind, label_es, label_en from crm.account_types where is_active and (market_code is null or market_code = ${market}) order by code`
    const territories = await tx`select id, name from crm.territories where market_code = ${market} and archived_at is null order by name`
    return {
      market,
      pipelines: pipelines.map((p) => ({ ...p, stages: stages.filter((s) => s.pipeline_id === p.id).map(({ pipeline_id: _p, ...s }) => s) })),
      loss_reasons: [...reasons], account_types: [...types], territories: [...territories],
    }
  })
}
