import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type SalesLine = { line_kind: 'activations' | 'payments'; line_key: string; mtd: number | null; prev_month: number | null; d90: number | null; currency: string | null }
export type StoreSales = { as_of: string; lines: SalesLine[] } | null

/** E5.F2: las cifras del último corte de una tienda. Null: todavía no llega ningún archivo para ella. */
export async function storeSales(ctx: Ctx, accountId: string): Promise<StoreSales> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<(SalesLine & { as_of: string })[]>`
      select l.as_of::text as as_of, l.line_kind, l.line_key, l.mtd::float8 as mtd, l.prev_month::float8 as prev_month, l.d90::float8 as d90, trim(l.currency) as currency
        from crm.store_sales_lines l
       where l.account_id = ${accountId} and l.as_of = (select max(x.as_of) from crm.store_sales_lines x where x.account_id = ${accountId})
       order by l.line_kind, l.line_key`
    if (!rows[0]) return null
    return { as_of: rows[0].as_of, lines: rows.map((l) => ({ line_kind: l.line_kind, line_key: l.line_key, mtd: l.mtd, prev_month: l.prev_month, d90: l.d90, currency: l.currency })) }
  })
}

export type TeamSales = { user_id: string; stores: number; activations_mtd: number | null; activations_prev_month: number | null; payments_mtd: number | null; currency: string | null; as_of: string | null }

/** E5.F2: por persona del equipo, la suma del último corte de las tiendas que lleva. Sin actividad: null (se muestra vacío). */
export async function teamStoreSales(ctx: Ctx, market: string, userIds: string[]): Promise<Map<string, TeamSales>> {
  if (userIds.length === 0) return new Map()
  const rows = await withUser(ctx.user.id, (tx) => tx<TeamSales[]>`
    with cur as (
      select l.* from crm.store_sales_lines l
       where l.market_code = ${market} and l.as_of = (select max(x.as_of) from crm.store_sales_lines x where x.account_id = l.account_id)
    )
    select a.owner_id as user_id, count(distinct cur.account_id)::int as stores,
           (sum(cur.mtd) filter (where cur.line_kind = 'activations'))::float8 as activations_mtd,
           (sum(cur.prev_month) filter (where cur.line_kind = 'activations'))::float8 as activations_prev_month,
           (sum(cur.mtd) filter (where cur.line_kind = 'payments'))::float8 as payments_mtd,
           max(trim(cur.currency)) as currency, max(cur.as_of)::text as as_of
      from cur join crm.accounts a on a.id = cur.account_id
     where a.owner_id = any(${userIds}::uuid[]) and a.archived_at is null
     group by a.owner_id`)
  return new Map(rows.map((r) => [r.user_id, r]))
}
