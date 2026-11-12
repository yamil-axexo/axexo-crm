import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import { visitorName } from '@/domain/followup'
import { isUuid } from '@/lib/ids'

/**
 * Catálogo de vendedores de calle (E16.F3). No son usuarios de CONTIGO: son las personas que visitan tiendas y que
 * responden a alguien de ventas. Lo mantienen supervisión (en su equipo) y quien lidera el mercado. No se borra nada:
 * una baja deja el registro con su fecha, y las visitas que ya llevan su nombre no cambian.
 */
const teamOf = (ctx: Ctx, market: string): string | null =>
  ctx.memberships.find((m) => m.role === 'supervisor' && m.market === market && m.teamId)?.teamId ?? null
const leadsMarket = (ctx: Ctx, market: string): boolean =>
  ctx.memberships.some((m) => m.role === 'admin' || (m.role === 'market_lead' && m.market === market))

export async function addStreetSeller(ctx: Ctx, input: { market: string; name: string; reportsTo?: string | null }): Promise<string> {
  const name = visitorName(input.name)
  if (!name) throw invalid('Escribe el nombre del vendedor de calle.', 'Write the street seller’s name.')
  ctx.assert('street.manage', input.market)
  const reportsTo = input.reportsTo && isUuid(input.reportsTo) ? input.reportsTo : null
  return withUser(ctx.user.id, async (tx) => {
    const dup = await tx`select 1 from crm.street_sellers where market_code = ${input.market} and is_active and lower(btrim(name)) = lower(${name})`
    if (dup[0]) throw invalid('Ya hay un vendedor de calle con ese nombre en este mercado.', 'There is already a street seller with that name in this market.')
    let team = leadsMarket(ctx, input.market) ? null : teamOf(ctx, input.market)
    if (reportsTo) {
      const ok = await tx<{ ok: boolean; team_id: string | null }[]>`
        select app.can_sell_in(${reportsTo}, ${input.market}) as ok,
               (select mm.team_id from crm.memberships mm where mm.user_id = ${reportsTo} and mm.market_code = ${input.market} and mm.team_id is not null
                   and mm.valid_from <= now() and (mm.valid_to is null or mm.valid_to > now()) order by mm.valid_from desc limit 1) as team_id`
      if (!ok[0]?.ok) throw invalid('Elige a una persona de ventas de este mercado.', 'Pick a salesperson from this market.')
      if (team && ok[0].team_id !== team) throw invalid('Esa persona no es de tu equipo.', 'That person is not on your team.')
      team = team ?? ok[0].team_id
    }
    const id = await newId(tx)
    await tx`insert into crm.street_sellers (id, market_code, team_id, name, reports_to, created_by) values (${id}, ${input.market}, ${team}, ${name}, ${reportsTo}, ${ctx.user.id})`
    await audit(tx, ctx, 'street_seller.added', 'street_seller', id, input.market, null, { name, team_id: team, reports_to: reportsTo })
    return id
  })
}

/** Cambiar a quién responde, o darlo de baja (`end`). RLS repite el límite: supervisión solo toca los de su equipo. */
export async function updateStreetSeller(ctx: Ctx, id: string, patch: { reportsTo?: string | null; end?: boolean }): Promise<void> {
  if (!isUuid(id)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; team_id: string | null; name: string; reports_to: string | null; is_active: boolean }[]>`
      select market_code, team_id, name, reports_to, is_active from crm.street_sellers where id = ${id} for update`
    const s = rows[0]
    if (!s) throw notFound('No encontramos a ese vendedor de calle.', 'We could not find that street seller.')
    ctx.assert('street.manage', s.market_code)
    if (!s.is_active) throw invalid('Ese vendedor de calle ya está de baja.', 'That street seller was already removed.')
    if (patch.end) {
      const done = await tx`update crm.street_sellers set is_active = false, ended_at = now() where id = ${id} returning id`
      if (!done[0]) throw notFound('Ese vendedor de calle no es de tu equipo.', 'That street seller is not on your team.')
      await audit(tx, ctx, 'street_seller.ended', 'street_seller', id, s.market_code, { name: s.name }, { is_active: false })
      return
    }
    const to = patch.reportsTo && isUuid(patch.reportsTo) ? patch.reportsTo : null
    if (to) {
      const ok = await tx<{ ok: boolean }[]>`select app.can_sell_in(${to}, ${s.market_code}) as ok`
      if (!ok[0]?.ok) throw invalid('Elige a una persona de ventas de este mercado.', 'Pick a salesperson from this market.')
    }
    const done = await tx`update crm.street_sellers set reports_to = ${to} where id = ${id} returning id`
    if (!done[0]) throw notFound('Ese vendedor de calle no es de tu equipo.', 'That street seller is not on your team.')
    await audit(tx, ctx, 'street_seller.updated', 'street_seller', id, s.market_code, { reports_to: s.reports_to }, { reports_to: to })
  })
}
