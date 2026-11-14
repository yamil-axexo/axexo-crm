import 'server-only'
import { withUser, marketWorkday } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'

/** DAT-07 (datos2): la entidad legal que vende el producto. La elige administración entre las del mercado del producto. */
export async function setProductEntity(ctx: Ctx, productId: string, entityId: string | null): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const p = (await tx<{ market_code: string | null; legal_entity_id: string | null; name: string }[]>`select market_code, legal_entity_id, name from crm.products where id = ${productId} for update`)[0]
    if (!p) throw notFound()
    if (entityId) {
      const e = await tx`select 1 from crm.legal_entities where id = ${entityId} and (${p.market_code}::text is null or market_code = ${p.market_code})`
      if (!e[0]) throw invalid('Esa entidad legal no es del mercado del producto.', 'That legal entity does not belong to the product’s market.')
    }
    await tx`update crm.products set legal_entity_id = ${entityId} where id = ${productId}`
    await audit(tx, ctx, 'product.entity_set', 'product', productId, p.market_code, { legal_entity_id: p.legal_entity_id }, { legal_entity_id: entityId, name: p.name })
  })
}

/**
 * DAT-07 (datos2): de la base de expansión a negocios. Por cada comercio elegido que todavía no tiene el producto (ni en trámite)
 * se abre un negocio de expansión en su embudo, a nombre de quien lleva el comercio, y el producto queda "pedido" y ligado al
 * negocio en la matriz. Lo hace quien trabaja expansión en ese mercado.
 */
export async function openExpansionDeals(ctx: Ctx, productId: string, accountIds: string[]): Promise<{ opened: number; skipped: number }> {
  const ids = [...new Set(accountIds)].slice(0, 100)
  if (ids.length === 0) throw invalid('Elige al menos un comercio.', 'Pick at least one merchant.')
  return withUser(ctx.user.id, async (tx) => {
    const product = (await tx<{ id: string; name: string; market_code: string | null; provider_id: string | null }[]>`select id, name, market_code, provider_id from crm.products where id = ${productId} and is_active`)[0]
    if (!product) throw notFound()
    const accounts = await tx<{ id: string; market_code: string; owner_id: string | null; segment: string | null; name: string; currency: string; locale: string }[]>`
      select a.id, a.market_code, a.owner_id, a.segment, a.name, mk.currency::text as currency, mk.default_locale as locale
        from crm.accounts a join crm.markets mk on mk.code = a.market_code
       where a.id = any(${ids}::uuid[]) and a.archived_at is null and (${product.market_code}::text is null or a.market_code = ${product.market_code})`
    let opened = 0
    for (const a of accounts) {
      ctx.assert('expansion.work', a.market_code)
      const has = await tx`select 1 from crm.account_products where account_id = ${a.id} and product_id = ${productId} and status <> 'rejected'`
      if (has[0]) continue
      const pipe = (await tx<{ id: string; stage_id: string }[]>`
        select p.id, (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'open' and s.archived_at is null order by s.position limit 1) as stage_id
          from crm.pipelines p where p.market_code = ${a.market_code} and p.is_active
         order by (p.motor = ${a.segment}) desc nulls last, p.position nulls last, p.name limit 1`)[0]
      if (!pipe?.stage_id) continue
      const en = a.locale === 'en'
      const dealId = await newId(tx)
      const owner = a.owner_id ?? ctx.user.id
      const step = en ? `Offer ${product.name}` : `Ofrecer ${product.name}`
      await tx`insert into crm.deals (id, market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due, created_by)
               values (${dealId}, ${a.market_code}, ${pipe.id}, ${pipe.stage_id}, ${a.id}, ${owner}, ${(en ? 'Expansion: ' : 'Expansión: ') + product.name}, ${a.currency}, ${step},
                       ${marketWorkday(tx, a.market_code, 2)}, ${ctx.user.id})`
      await tx`insert into crm.deal_stage_events (deal_id, market_code, to_stage_id, actor_id) values (${dealId}, ${a.market_code}, ${pipe.stage_id}, ${ctx.user.id})`
      await tx`insert into crm.account_products (account_id, market_code, product_id, provider_id, status, deal_id, note, updated_by)
               values (${a.id}, ${a.market_code}, ${productId}, ${product.provider_id}, 'requested', ${dealId}, ${en ? 'Expansion deal' : 'Negocio de expansión'}, ${ctx.user.id})`
      await audit(tx, ctx, 'expansion.deal_opened', 'deal', dealId, a.market_code, null, { account_id: a.id, product_id: productId })
      opened++
    }
    return { opened, skipped: ids.length - opened }
  })
}
