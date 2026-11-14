import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type AccountOrder = {
  id: string
  title: string
  status: 'open' | 'won' | 'lost'
  stage_es: string
  stage_en: string
  amount_minor: string | null
  currency: string
  /** Día del pedido: cuándo se capturó (o cuándo lo trajo la importación con su fecha original). */
  ordered_at: Date
  lines: number
  carrier: string | null
  po_number: string | null
  due_on: string | null
}

/**
 * E11.F5: historial de pedidos de un comercio (negocios de embudos con líneas de producto), del más reciente al más antiguo,
 * con la fecha del último. Los pedidos cancelados quedan en la lista pero no cuentan como "último pedido".
 * RLS decide si la persona ve el comercio y sus negocios.
 */
export async function accountOrders(ctx: Ctx, accountId: string): Promise<{ orders: AccountOrder[]; last: Date | null; total: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<AccountOrder[]>`
      select d.id, d.title, d.status, s.name_es as stage_es, s.name_en as stage_en, d.amount_minor::text, d.currency, d.created_at as ordered_at,
             (select count(*)::int from crm.deal_items i where i.deal_id = d.id) as lines, o.carrier, o.po_number, o.due_on::text
        from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.stages s on s.id = d.stage_id
        left join crm.deal_orders o on o.deal_id = d.id
       where d.account_id = ${accountId} and p.has_items
       order by d.created_at desc limit 50`
    const agg = await tx<{ last: Date | null; total: number }[]>`
      select max(d.created_at) filter (where d.status <> 'lost') as last, count(*)::int as total
        from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where d.account_id = ${accountId} and p.has_items`
    return { orders: [...rows], last: agg[0]?.last ?? null, total: agg[0]?.total ?? 0 }
  })
}
