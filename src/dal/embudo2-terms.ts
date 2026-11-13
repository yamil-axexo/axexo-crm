import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { CommissionLine } from '@/domain/partners'

/**
 * PIPE-07 (embudo2): los términos vigentes alimentan el estado de comisiones y la atribución. Por cada línea de comisión se
 * buscan los pagos del mes del último corte del archivo de ventas (por código o nombre del producto) y se calcula la comisión.
 * Es una vista previa: quién cobra (atribución de canal) sale de la ficha; cómo se paga lo define el paquete de comisiones.
 * Los términos son dato reservado: la base solo los devuelve a quien el campo deja (RLS), igual que la pantalla de contratos.
 */
export type StatementLine = { product: string; product_code: string | null; linked: boolean; pct: number; payments_mtd_minor: number | null; commission_minor: number | null; currency: string | null }
export type Statement = { version: number; settlement: string; as_of: string | null; channel: string | null; lines: StatementLine[] }

export async function commissionStatement(ctx: Ctx, accountId: string): Promise<Statement | null> {
  return withUser(ctx.user.id, async (tx) => {
    const terms = await tx<{ version: number; settlement: string; commission_lines: CommissionLine[] }[]>`
      select version, settlement, commission_lines from crm.commercial_terms where account_id = ${accountId} and is_current`
    const t = terms[0]
    if (!t) return null
    const asOf = await tx<{ as_of: string | null }[]>`select max(as_of)::text as as_of from crm.store_sales_lines where account_id = ${accountId} and line_kind = 'payments'`
    const sales = asOf[0]?.as_of ? await tx<{ line_key: string; mtd: string | null; currency: string | null }[]>`
      select line_key, mtd::text, currency from crm.store_sales_lines where account_id = ${accountId} and line_kind = 'payments' and as_of = ${asOf[0].as_of}::date` : []
    const channel = await tx<{ party_label: string }[]>`
      select party_label from crm.account_attributions where account_id = ${accountId} and layer = 'channel' and effective_to is null order by effective_from desc limit 1`
    const lines = t.commission_lines.map((l): StatementLine => {
      const keys = [l.product_code, l.product].filter(Boolean).map((k) => k!.trim().toLowerCase())
      const s = sales.find((x) => keys.includes(x.line_key.trim().toLowerCase()))
      const mtd = s?.mtd ? Number(s.mtd) : null
      return { product: l.product, product_code: l.product_code ?? null, linked: Boolean(l.product_id), pct: l.pct, payments_mtd_minor: mtd, commission_minor: mtd === null ? null : Math.round((mtd * l.pct) / 100), currency: s?.currency ?? null }
    })
    return { version: t.version, settlement: t.settlement, as_of: asOf[0]?.as_of ?? null, channel: channel[0]?.party_label ?? null, lines }
  })
}
