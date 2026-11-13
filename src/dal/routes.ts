import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { RouteStore } from '@/server/adapters/routes'

export const ROUTE_STORE_LIMIT = 500

/**
 * E12.F8 / E5.F6: las tiendas que una persona puede poner en su ruta. Son solo las que lleva (nunca las de otra persona):
 * nombre, dirección, contacto, productos aprobados y desempeño reciente. Es la lectura que consume la herramienta de rutas
 * cuando se conecte; hoy el adaptador está apagado y esta lista no sale de CONTIGO.
 */
export async function routeStores(ctx: Ctx, market: string): Promise<RouteStore[]> {
  ctx.market(market)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<RouteStore[]>`
      select a.id as account_id, a.name, a.address_line as address, a.locality, a.region, a.postal_code, a.phone, a.merchant_ref,
             (select c.full_name from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
               where ac.account_id = a.id and ac.valid_to is null order by (ac.role = 'decision_maker') desc, c.full_name limit 1) as contact,
             coalesce((select array_agg(distinct x.p order by x.p) from (
                         select jsonb_array_elements_text(case when jsonb_typeof(d.custom -> 'products_requested') = 'array' then d.custom -> 'products_requested' else '[]'::jsonb end) as p
                           from crm.deals d where d.account_id = a.id and d.status = 'won') x), '{}') as approved_products,
             (select m.txn_count_30d from crm.merchant_metrics_daily m where m.account_id = a.id order by m.as_of desc limit 1) as txn_count_30d,
             (select max((coalesce(v.done_at, v.created_at) at time zone mk.timezone)::date)::text from crm.activities v
               where v.account_id = a.id and v.kind = 'visit' and v.done_at is not null) as last_visit_on
        from crm.accounts a join crm.markets mk on mk.code = a.market_code
       where a.market_code = ${market} and a.owner_id = ${ctx.user.id} and a.archived_at is null and a.kind = 'store'
       order by a.locality nulls last, a.name limit ${ROUTE_STORE_LIMIT}`
    return [...rows]
  })
}
