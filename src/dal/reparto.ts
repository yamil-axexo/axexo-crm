import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { rolesIn } from '@/domain/policy'
import { ownerKeys } from '@/server/account-filter'

/** Alguien (o nadie: owner_id nulo) que tiene registros en un mercado, con lo que tiene abierto. */
export type Holder = {
  owner_id: string | null
  market_code: string
  full_name: string | null
  is_active: boolean | null
  /** Tiene hoy un rol de ventas o de operaciones en ese mercado. Si es falso, lo suyo no tiene dueño vigente. */
  current: boolean
  accounts: number
  deals: number
  leads: number
}
export type Person = { id: string; full_name: string; market_code: string; team: string | null; mine: boolean }
export type RegionOpt = { market_code: string; region: string; accounts: number }
export type TerritoryOpt = { id: string; market_code: string; name: string }
export type RepartoSources = {
  markets: { code: string; name: string }[]
  holders: Holder[]
  regions: RegionOpt[]
  territories: TerritoryOpt[]
  people: Person[]
}

const OPEN_LEAD = ['new', 'contacted', 'qualified']
const teamOnly = (ctx: Ctx, market: string) => {
  const roles = rolesIn(ctx.memberships, market)
  return !roles.includes('admin') && !roles.includes('market_lead')
}

/** Regiones con más comercios y territorios vigentes de los mercados de la persona: las opciones de los filtros por plaza. */
export async function getPlaceOptions(ctx: Ctx, markets = ctx.markets.map((m) => m.code)): Promise<{ regions: RegionOpt[]; territories: TerritoryOpt[] }> {
  if (markets.length === 0) return { regions: [], territories: [] }
  return withUser(ctx.user.id, async (tx) => {
    const regions = await tx<RegionOpt[]>`
      select a.market_code, a.region, count(*)::int as accounts from crm.accounts a
       where a.archived_at is null and a.region is not null and a.region <> '' and a.market_code = any(${markets}::text[])
       group by 1, 2 order by 1, 3 desc, 2 limit 150`
    const territories = await tx<TerritoryOpt[]>`
      select id, market_code, name from crm.territories where archived_at is null and market_code = any(${markets}::text[]) order by market_code, name`
    return { regions: [...regions], territories: [...territories] }
  })
}

/**
 * Quién tiene qué en los mercados dados, hasta donde la persona alcanza a ver: comercios, negocios abiertos y leads abiertos
 * por dueño, y si ese dueño sigue vigente. Aquí aparecen las cuentas de servicio y las personas que ya no están.
 */
export async function getHolders(ctx: Ctx, markets: string[]): Promise<Holder[]> {
  if (markets.length === 0) return []
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Holder[]>`
      with acc as (select a.market_code, a.owner_id, count(*)::int as n from crm.accounts a
                    where a.archived_at is null and a.market_code = any(${markets}::text[])
                      and (a.owner_id is not null or a.parent_id is null)   -- sin asignar bajo una cadena: lo lleva la cadena
                    group by 1, 2),
           dl as (select d.market_code, d.owner_id, count(*)::int as n from crm.deals d
                   where d.status = 'open' and d.market_code = any(${markets}::text[]) group by 1, 2),
           ld as (select l.market_code, l.owner_id, count(*)::int as n from crm.leads l
                   where l.status = any(${OPEN_LEAD}::text[]) and l.market_code = any(${markets}::text[]) group by 1, 2),
           k as (select market_code, owner_id from acc union select market_code, owner_id from dl union select market_code, owner_id from ld)
      select k.owner_id, k.market_code, u.full_name, u.is_active,
             (k.owner_id is not null and (k.market_code || ':' || k.owner_id::text) = any(${ownerKeys(tx, markets)})) as current,
             coalesce(acc.n, 0) as accounts, coalesce(dl.n, 0) as deals, coalesce(ld.n, 0) as leads
        from k
        left join crm.users u on u.id = k.owner_id
        left join acc on acc.market_code = k.market_code and acc.owner_id is not distinct from k.owner_id
        left join dl on dl.market_code = k.market_code and dl.owner_id is not distinct from k.owner_id
        left join ld on ld.market_code = k.market_code and ld.owner_id is not distinct from k.owner_id
       order by k.market_code, coalesce(acc.n, 0) + coalesce(dl.n, 0) + coalesce(ld.n, 0) desc, u.full_name nulls last`
    return [...rows]
  })
}

/** A quién se le puede pasar cartera: quien vende hoy en el mercado. Supervisión solo reparte a su equipo. */
export async function getTargets(ctx: Ctx, markets: string[]): Promise<Person[]> {
  if (markets.length === 0) return []
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Person[]>`
      select distinct on (u.id, m.market_code) u.id, u.full_name, m.market_code, t.name as team, u.id = any(app.supervised_user_ids()) as mine
        from crm.users u join crm.memberships m on m.user_id = u.id
        left join crm.teams t on t.id = m.team_id
       where u.is_active and not u.is_system and m.role in ('rep','supervisor','market_lead')
         and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()) and m.market_code = any(${markets}::text[])
       order by u.id, m.market_code, (m.team_id is null), m.role`
    return [...rows]
      .filter((p) => p.mine || !teamOnly(ctx, p.market_code))
      .sort((a, b) => a.market_code.localeCompare(b.market_code) || Number(b.mine) - Number(a.mine) || (a.team ?? '~').localeCompare(b.team ?? '~') || a.full_name.localeCompare(b.full_name))
  })
}

/** Todo lo que necesita la pantalla de reparto, en los mercados donde la persona puede reasignar. */
export async function getRepartoSources(ctx: Ctx): Promise<RepartoSources> {
  const markets = ctx.markets.filter((m) => m.status === 'live' && ctx.can('account.reassign', m.code))
  const codes = markets.map((m) => m.code)
  const [holders, place, people] = await Promise.all([getHolders(ctx, codes), getPlaceOptions(ctx, codes), getTargets(ctx, codes)])
  return { markets: markets.map((m) => ({ code: m.code, name: m.name })), holders, regions: place.regions, territories: place.territories, people }
}

export type TerritoryRow = { id: string; market_code: string; name: string; code: string; archived_at: Date | null; accounts: number; people: number }
export type TerritoryPerson = { id: string; full_name: string; market_code: string; role: string; team: string | null; territory_ids: string[] }

/** Administración: el catálogo de territorios con cuántos comercios y personas tiene cada uno, y qué territorios tiene cada quien. */
export async function getTerritoryAdmin(ctx: Ctx): Promise<{ territories: TerritoryRow[]; people: TerritoryPerson[]; unassigned: { market_code: string; accounts: number }[] }> {
  return withUser(ctx.user.id, async (tx) => {
    const territories = await tx<TerritoryRow[]>`
      select t.id, t.market_code, t.name, t.code, t.archived_at,
             (select count(*)::int from crm.accounts a where a.territory_id = t.id and a.archived_at is null) as accounts,
             (select count(*)::int from crm.user_territories ut where ut.territory_id = t.id) as people
        from crm.territories t order by t.market_code, (t.archived_at is not null), t.name`
    const people = await tx<TerritoryPerson[]>`
      select distinct on (u.full_name, u.id, m.market_code) u.id, u.full_name, m.market_code, m.role, tm.name as team,
             coalesce(array(select ut.territory_id from crm.user_territories ut join crm.territories t on t.id = ut.territory_id
                             where ut.user_id = u.id and t.market_code = m.market_code), '{}') as territory_ids
        from crm.users u join crm.memberships m on m.user_id = u.id
        left join crm.teams tm on tm.id = m.team_id
       where u.is_active and not u.is_system and m.role in ('rep','supervisor','market_lead')
         and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
       order by u.full_name, u.id, m.market_code, (m.team_id is null), m.role`
    const unassigned = await tx<{ market_code: string; accounts: number }[]>`
      select a.market_code, count(*)::int as accounts from crm.accounts a
       where a.archived_at is null and a.territory_id is null group by 1 order by 1`
    return { territories: [...territories], people: [...people], unassigned: [...unassigned] }
  })
}
