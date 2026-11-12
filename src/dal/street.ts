import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type StreetSeller = { id: string; market_code: string; name: string; team_name: string | null; reports_to: string | null; reports_name: string | null }
export type StreetSummary = { name: string; market_code: string; owner_id: string | null; owner_name: string | null; listed: boolean; visits_7d: number; sales_7d: number; stores_30d: number }

/** Catálogo vigente de vendedores de calle de los mercados de la persona. */
export async function streetSellers(ctx: Ctx, market?: string): Promise<StreetSeller[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<StreetSeller[]>`
      select s.id, s.market_code, s.name, t.name as team_name, s.reports_to, u.full_name as reports_name
        from crm.street_sellers s left join crm.teams t on t.id = s.team_id left join crm.users u on u.id = s.reports_to
       where s.is_active ${market ? tx`and s.market_code = ${market}` : tx``}
       order by s.market_code, u.full_name nulls last, s.name`
    return [...rows]
  })
}

/**
 * Resumen por vendedor de calle, bajo la persona que lleva la cartera: visitas y visitas con venta de los últimos 7 días
 * y tiendas distintas visitadas en 30 días. Cuenta las visitas capturadas en CONTIGO con "¿Quién visitó?"; RLS decide el
 * alcance (supervisión ve a su equipo; quien lidera, su mercado). Los del catálogo salen aunque no tengan visitas.
 */
export async function streetSummary(ctx: Ctx): Promise<StreetSummary[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<StreetSummary[]>`
      with v as (
        select x.market_code, btrim(x.visited_by) as name, coalesce(a.owner_id, x.owner_id) as owner_id,
               count(*) filter (where x.done_at > now() - interval '7 days')::int as visits_7d,
               count(*) filter (where x.done_at > now() - interval '7 days' and x.outcome = 'sale')::int as sales_7d,
               count(distinct x.account_id)::int as stores_30d
          from crm.activities x left join crm.accounts a on a.id = x.account_id
         where x.kind = 'visit' and x.done_at is not null and x.visited_by is not null and x.done_at > now() - interval '30 days'
         group by 1, 2, 3
      ), c as (
        select s.market_code, s.name, s.reports_to as owner_id from crm.street_sellers s where s.is_active
      )
      select coalesce(v.name, c.name) as name, coalesce(v.market_code, c.market_code) as market_code, coalesce(v.owner_id, c.owner_id) as owner_id, u.full_name as owner_name,
             exists (select 1 from crm.street_sellers s where s.is_active and s.market_code = coalesce(v.market_code, c.market_code) and lower(btrim(s.name)) = lower(coalesce(v.name, c.name))) as listed,
             coalesce(v.visits_7d, 0) as visits_7d, coalesce(v.sales_7d, 0) as sales_7d, coalesce(v.stores_30d, 0) as stores_30d
        from v full join c on c.market_code = v.market_code and lower(c.name) = lower(v.name) and c.owner_id is not distinct from v.owner_id
        left join crm.users u on u.id = coalesce(v.owner_id, c.owner_id)
       order by u.full_name nulls last, 1`
    return [...rows]
  })
}
