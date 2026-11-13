import 'server-only'
import type postgres from 'postgres'
import { marketToday, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isUuid } from '@/lib/ids'
import { teamFilter } from '@/dal/reports'

/**
 * Filtros de la lista de Comercios. Viven aquí, en un solo lugar, porque los usan la lista (lo que la persona ve)
 * y el reparto (lo que se mueve con "todos los de este filtro"): tienen que ser exactamente la misma consulta.
 * - owner: 'me', 'none' (sin dueño), 'vacant' (sin dueño vigente) o el id de una persona.
 *   Un punto de venta sin dueño que cuelga de una cadena no cuenta como "sin dueño": lo lleva quien lleva la cadena
 *   (la misma regla que usan el aviso "Comercio sin dueño" y Calidad de datos).
 * - region: estado o región, exacto
 * - city: texto que se busca en ciudad y estado
 * - territory: id de un territorio o 'none' (sin territorio)
 */
export type AccountFilters = {
  q?: string
  market?: string
  lifecycle?: string
  owner?: string
  kind?: string
  after?: string
  ver?: string
  region?: string
  city?: string
  territory?: string
  /** Equipo vigente del dueño: el id de un equipo o 'none' (dueño sin equipo, o comercio sin dueño). */
  team?: string
  /** Embudo: comercios que tienen o tuvieron un negocio en ese embudo. */
  pipeline?: string
  /** Visitado por: nombre de quien visitó (vendedor de calle), tal como quedó en "¿Quién visitó?". */
  visito?: string
}

type Frag = postgres.Fragment

/** Quién es dueño vigente hoy en esos mercados (ventas, supervisión, líder u operaciones: app.owner_roles), como llaves 'MX:<id>'. Se evalúa una vez por consulta. */
export const ownerKeys = (tx: Tx, markets: string[]): Frag => tx`(select app.owner_keys(${markets}::text[]))::text[]`

/**
 * "Sin dueño vigente": no tiene dueño, o su dueño no tiene hoy un rol de ventas ni de operaciones en el mercado del registro (una cuenta
 * de servicio, alguien que salió, alguien que cambió de mercado). `row` es el alias de la tabla (comercios, leads o negocios).
 */
export const vacant = (tx: Tx, row: string, keys: Frag): Frag =>
  tx`(${tx(row)}.owner_id is null or not ((${tx(row)}.market_code || ':' || ${tx(row)}.owner_id::text) = any(${keys})))`

/** Tiene dueño, pero no vigente. */
export const heldByNobody = (tx: Tx, row: string, keys: Frag): Frag =>
  tx`(${tx(row)}.owner_id is not null and not ((${tx(row)}.market_code || ':' || ${tx(row)}.owner_id::text) = any(${keys})))`

export function accountFilter(tx: Tx, ctx: Ctx, f: AccountFilters) {
  const q = (f.q ?? '').trim()
  const city = (f.city ?? '').trim()
  const visito = (f.visito ?? '').trim().slice(0, 80)
  const digits = q.replace(/[^\d]/g, '')
  const scope = ctx.markets.map((m) => m.code) // AUTHZ-07: filtro explícito por mercado, además de RLS
  const keys = ownerKeys(tx, scope)
  // Salud (src/lib/health.ts) y "sin próximo paso", en SQL: los filtros de la lista cuentan con la misma regla que pinta cada fila.
  const openDeal = tx`exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open')`
  const risk = tx`a.lifecycle in ('at_risk', 'inactive', 'churned')`
  const idle = tx`(a.lifecycle = 'onboarding' or (a.lifecycle = 'prospect' and ${openDeal}))`
  // Una tienda activa sin negocio abierto está al día (la ficha lo dice así): no cuenta como "sin próximo paso".
  const nostep = tx`(a.lifecycle <> 'churned'
    and not (a.lifecycle = 'active' and not ${openDeal})
    and not exists (select 1 from crm.activities x where x.account_id = a.id and x.done_at is null and x.kind in ('task', 'handoff', 'call', 'meeting', 'email', 'visit'))
    and not exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open' and d.next_step is not null and d.next_step_due >= ${marketToday(tx, tx`a.market_code`)}))`
  const owner =
    f.owner === 'me' ? tx`and a.owner_id = ${ctx.user.id}`
    : f.owner === 'none' ? tx`and a.owner_id is null and a.parent_id is null`
    : f.owner === 'vacant' ? tx`and ((a.owner_id is null and a.parent_id is null) or ${heldByNobody(tx, 'a', keys)})`
    : isUuid(f.owner) ? tx`and a.owner_id = ${f.owner}` : tx``
  const base = tx`
    a.archived_at is null and a.market_code = any(${scope}::text[])
    ${f.market ? tx`and a.market_code = ${f.market}` : tx``}
    ${f.lifecycle ? tx`and a.lifecycle = ${f.lifecycle}` : tx``}
    ${f.kind === 'parents' ? tx`and a.kind <> 'store'` : f.kind ? tx`and a.kind = ${f.kind}` : tx``}
    ${owner}
    ${f.region ? tx`and a.region = ${f.region}` : tx``}
    ${city ? tx`and a.place_norm like ${'%'} || app.norm(${city}) || ${'%'}` : tx``}
    ${f.territory === 'none' ? tx`and a.territory_id is null` : isUuid(f.territory) ? tx`and a.territory_id = ${f.territory}` : tx``}
    ${teamFilter(tx, 'a', f.team)}
    ${isUuid(f.pipeline) ? tx`and exists (select 1 from crm.deals dp where dp.account_id = a.id and dp.pipeline_id = ${f.pipeline})` : tx``}
    ${visito ? tx`and exists (select 1 from crm.activities xv where xv.account_id = a.id and xv.market_code = a.market_code and xv.kind = 'visit' and xv.done_at is not null and lower(btrim(xv.visited_by)) = lower(${visito}))` : tx``}
    ${q ? tx`and (a.name_norm like ${'%'} || app.norm(${q}) || ${'%'}
                  or a.place_norm like ${'%'} || app.norm(${q}) || ${'%'}
                  ${q.length >= 4 ? tx`or a.address_norm like ${'%'} || app.norm(${q}) || ${'%'}` : tx``}
                  ${digits.length >= 4 ? tx`or a.phone like ${'%' + digits + '%'}` : tx``}
                  or exists (select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null and upper(al.external_id) like ${'%' + q.toUpperCase() + '%'}))` : tx``}`
  const where = tx`${base} ${f.ver === 'riesgo' ? tx`and ${risk}` : f.ver === 'sin-transaccionar' ? tx`and ${idle}` : f.ver === 'sin-paso' ? tx`and ${nostep}` : tx``}`
  return { base, where, risk, idle, nostep, openDeal, keys }
}

/** ¿El filtro acota algo además del mercado? Sin esto, "todos los de este filtro" sería el mercado completo. */
export const narrows = (f: AccountFilters): boolean =>
  !!(f.q?.trim() || f.lifecycle || f.owner || f.kind || f.ver || f.region || f.city?.trim() || f.territory || f.team || f.pipeline || f.visito?.trim())
