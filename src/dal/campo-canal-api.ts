import 'server-only'
import { withUser, marketToday } from '@/server/db'
import { DomainError } from '@/lib/errors'
import type { ApiKey } from '@/dal/api-v1'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bad = (d: string) => new DomainError('invalid_filter', 'Filtro inválido.', `Invalid filter: ${d}`, 400)

/**
 * Señales de campo para la Sales App (API v1, solo lectura): por tienda, la prioridad de hoy (segmento, puntaje y razones)
 * y el último puntaje de punto de venta perfecto. Corre con la identidad de quien creó la llave y se acota a su mercado.
 * Las tiendas del grupo de control no salen con prioridad (holdout), para poder medir el efecto.
 */
export async function readFieldSignals(key: ApiKey, params: URLSearchParams): Promise<{ data: Record<string, unknown>[]; as_of: string | null }> {
  for (const k of params.keys()) if (!['owner_id', 'limit'].includes(k)) throw bad(`unknown parameter ${k.slice(0, 40)}`)
  const owner = params.get('owner_id')
  if (owner && !UUID.test(owner)) throw bad('owner_id must be a uuid')
  const limit = Number(params.get('limit') ?? 200)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw bad('limit must be between 1 and 500')
  if (!key.market || !key.createdBy) return { data: [], as_of: null }
  const market = key.market
  if (key.mode === 'test') return { data: [], as_of: null }
  return withUser(key.createdBy, async (tx) => {
    const day = (await tx<{ d: string | null }[]>`select max(day)::text as d from crm.store_priority where market_code = ${market} and day <= ${marketToday(tx, market)}`)[0]?.d ?? null
    if (!day) return { data: [], as_of: null }
    const rows = await tx<Record<string, unknown>[]>`
      select p.account_id, p.owner_id, p.segment, p.score, p.reasons,
             ps.score as perfect_store_score, ps.observed_at as perfect_store_at
        from crm.store_priority p
        left join lateral (select s.score, s.observed_at from crm.perfect_store_scores s where s.account_id = p.account_id order by s.observed_at desc limit 1) ps on true
       where p.market_code = ${market} and p.day = ${day}::date and not p.holdout ${owner ? tx`and p.owner_id = ${owner}` : tx``}
       order by p.score desc, p.account_id limit ${limit}`
    return { data: rows, as_of: day }
  })
}
