import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { RouteStore } from '@/server/adapters/routes'

export const ROUTE_STORE_LIMIT = 500

/**
 * E12.F8 / E5.F6: las tiendas que una persona puede poner en su ruta. Son solo las que lleva (nunca las de otra persona):
 * nombre, dirección, contacto, productos aprobados y desempeño reciente. Es la lectura que consume la herramienta de rutas
 * (GET /api/v1/routes/stores, contrato docs/contracts/route-tool-v1.md); el adaptador que la empuja está apagado.
 */
export async function routeStoresOf(tx: Tx, market: string, ownerId: string): Promise<RouteStore[]> {
  const rows = await tx<RouteStore[]>`
    select a.id as account_id, a.name, a.address_line as address, a.locality, a.region, a.postal_code, a.phone, a.merchant_ref,
           (select c.full_name from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
             where ac.account_id = a.id and ac.valid_to is null order by (ac.role = 'decision_maker') desc, c.full_name limit 1) as contact,
           coalesce((select array_agg(distinct x.p order by x.p) from (
                       select jsonb_array_elements_text(case when jsonb_typeof(d.custom -> 'products_requested') = 'array' then d.custom -> 'products_requested' else '[]'::jsonb end) as p
                         from crm.deals d where d.account_id = a.id and d.status = 'won') x), '{}') as approved_products,
           (select m.txn_count_30d from crm.merchant_metrics_daily m where m.account_id = a.id order by m.as_of desc limit 1) as txn_count_30d,
           s.activations_mtd, s.activations_prev_month, s.as_of as sales_as_of,
           (select max((coalesce(v.done_at, v.created_at) at time zone mk.timezone)::date)::text from crm.activities v
             where v.account_id = a.id and v.kind = 'visit' and v.done_at is not null) as last_visit_on
      from crm.accounts a join crm.markets mk on mk.code = a.market_code
      left join lateral (
        select l.as_of::text as as_of, sum(l.mtd)::int as activations_mtd, sum(l.prev_month)::int as activations_prev_month
          from crm.store_sales_lines l
         where l.account_id = a.id and l.line_kind = 'activations'
           and l.as_of = (select max(x.as_of) from crm.store_sales_lines x where x.account_id = a.id)
         group by l.as_of) s on true
     where a.market_code = ${market} and a.owner_id = ${ownerId} and a.archived_at is null and a.kind = 'store'
     order by a.locality nulls last, a.name limit ${ROUTE_STORE_LIMIT}`
  return [...rows]
}

export async function routeStores(ctx: Ctx, market: string): Promise<RouteStore[]> {
  ctx.market(market)
  // La pantalla usa la forma de siempre; las cifras por tienda van a la API de la herramienta de rutas.
  const rows = await withUser(ctx.user.id, (tx) => routeStoresOf(tx, market, ctx.user.id))
  return rows.map(({ activations_mtd: _m, activations_prev_month: _p, sales_as_of: _s, ...r }) => r)
}
