import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type FoundAccount = { id: string; name: string; market: string; place: string | null }
export const FIND_LIMIT = 6

/**
 * Buscar el comercio al registrar una actividad desde el dock: por nombre, por teléfono (del comercio o de su contacto,
 * con cualquier formato o los últimos cuatro dígitos) o por su ID en otro sistema. Sin texto, devuelve los comercios
 * con los que la persona trabajó más recientemente. RLS decide qué comercios ve cada quien.
 */
export async function findAccounts(ctx: Ctx, q: string): Promise<FoundAccount[]> {
  const term = q.trim().slice(0, 80)
  const markets = ctx.markets.filter((m) => ctx.can('activity.write', m.code)).map((m) => m.code)
  if (markets.length === 0) return []
  return withUser(ctx.user.id, async (tx) => {
    // Con RLS, el plan de esta búsqueda parece caro y Postgres lo compila al vuelo (JIT): la compilación tarda cerca de
    // un segundo y la consulta, 13 ms. Aquí se apaga solo para esta transacción: quien busca está parado frente al comercio.
    await tx`select set_config('jit', 'off', true)`
    const place = tx`nullif(concat_ws(', ', a.locality, a.region), '') as place`
    if (term.length < 2) {
      const rows = await tx<FoundAccount[]>`
        select a.id, a.name, a.market_code as market, ${place}
          from crm.accounts a
          join lateral (select max(coalesce(x.done_at, x.created_at)) as at from crm.activities x where x.account_id = a.id and x.created_by = ${ctx.user.id}) last on last.at is not null
         where a.archived_at is null and a.market_code = any(${markets}::text[])
         order by last.at desc limit ${FIND_LIMIT}`
      return [...rows]
    }
    const digits = term.replace(/[^\d]/g, '')
    const rows = await tx<FoundAccount[]>`
      select a.id, a.name, a.market_code as market, ${place}
        from crm.accounts a
       where a.archived_at is null and a.market_code = any(${markets}::text[])
         and (a.name_norm like ${'%'} || app.norm(${term}) || ${'%'} or a.name_norm % app.norm(${term})
             ${digits.length >= 4 ? tx`or a.phone like ${'%' + digits + '%'}
               or exists (select 1 from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
                           where ac.account_id = a.id and ac.valid_to is null and c.phone like ${'%' + digits + '%'})` : tx``}
             or exists (select 1 from crm.account_aliases al where al.account_id = a.id and al.valid_to is null and upper(al.external_id) like ${'%' + term.toUpperCase() + '%'}))
       order by (a.owner_id = ${ctx.user.id}) desc nulls last, similarity(a.name_norm, app.norm(${term})) desc, a.name_norm limit ${FIND_LIMIT}`
    return [...rows]
  })
}

/** Nombres de quienes visitan ya usados en ese mercado (requerimiento E16.F3), los más recientes primero. */
export async function visitorNames(ctx: Ctx, market: string): Promise<string[]> {
  if (!ctx.markets.some((m) => m.code === market)) return []
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ name: string }[]>`select name from app.visitor_names(${market})`
    return rows.map((r) => r.name)
  })
}

/** A quién se llama en un comercio: su teléfono y, si no tiene, el de su contacto (primero quien decide). */
export async function accountPhone(ctx: Ctx, accountId: string): Promise<{ phone: string; who: string | null } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ phone: string | null; who: string | null }[]>`
      select coalesce(a.phone, c.phone) as phone, case when a.phone is null then c.full_name end as who
        from crm.accounts a
        left join lateral (select c.phone, c.full_name from crm.account_contacts x join crm.contacts c on c.id = x.contact_id
                            where x.account_id = a.id and x.valid_to is null and c.phone is not null
                            order by (x.role = 'decision_maker') desc, (x.role = 'owner') desc, x.valid_from limit 1) c on true
       where a.id = ${accountId}`
    const r = rows[0]
    return r?.phone ? { phone: r.phone, who: r.who } : null
  })
}

/** Motivos de una visita sin venta: los de calle del catálogo (kind = 'no_sale'), de esos mercados o de todos. */
export async function noSaleReasons(ctx: Ctx, markets: string[]): Promise<{ code: string; label_es: string; label_en: string }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ code: string; label_es: string; label_en: string }[]>`
      select code, label_es, label_en from crm.loss_reasons
       where kind = 'no_sale' and is_active and (market_code is null or market_code = any(${markets}::text[])) order by position, label_es`
    return [...rows]
  })
}
