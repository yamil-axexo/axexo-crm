import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type StoreProvider = { catalog_id: string; label_es: string; label_en: string; status: string; on_date: string | null; deal_id: string; deal_title: string; updated_at: Date }

/**
 * E10.F2: la aprobación por proveedor corre en paralelo a la venta y se ve en la tienda, no como etapa del embudo.
 * Por cada proveedor del catálogo del mercado, el estado más reciente que Operaciones anotó en cualquiera de los negocios
 * de la tienda. Los proveedores sin movimiento no aparecen (no estorban). RLS decide si la persona ve la tienda.
 */
export async function storeProviders(ctx: Ctx, accountId: string): Promise<StoreProvider[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<StoreProvider[]>`
      select distinct on (c.id) c.id as catalog_id, c.label_es, c.label_en, k.status, k.on_date::text, d.id as deal_id, d.title as deal_title, k.updated_at
        from crm.deal_ops_checks k join crm.ops_catalog c on c.id = k.catalog_id and c.kind = 'provider' join crm.deals d on d.id = k.deal_id
       where d.account_id = ${accountId}
       order by c.id, k.updated_at desc`
    return [...rows].sort((a, b) => a.label_en.localeCompare(b.label_en))
  })
}
