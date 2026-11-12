import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'

/**
 * Territorios: un catálogo por mercado que mantiene administración. Un territorio se pone a comercios (en bloque, desde
 * la lista) y se asigna a personas: quien vende ve los comercios sin dueño de sus territorios, y un comercio nuevo nace
 * con el territorio de su dueño cuando el dueño tiene uno solo (0011_distribution).
 * La lista real de cada mercado la decide el negocio: aquí no viene cargada.
 */
const nameInput = z.string().trim().min(2).max(60)

/** Clave corta y estable a partir del nombre ("Nuevo León" -> "NUEVO-LEON"). La unicidad por mercado la exige la base. */
export const territoryCode = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

export async function createTerritory(ctx: Ctx, input: { market: string; name: string }): Promise<string> {
  ctx.assert('config.manage')
  const name = nameInput.safeParse(input.name)
  const code = name.success ? territoryCode(name.data) : ''
  if (!name.success || !code) throw invalid('Ponle un nombre de al menos dos letras.', 'Give it a name of at least two letters.')
  return withUser(ctx.user.id, async (tx) => {
    const mk = await tx`select 1 from crm.markets where code = ${input.market}`
    if (!mk[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    const prev = await tx<{ id: string; archived_at: Date | null }[]>`
      select id, archived_at from crm.territories where market_code = ${input.market} and (code = ${code} or lower(name) = lower(${name.data})) limit 1 for update`
    if (prev[0] && !prev[0].archived_at) throw invalid('Ya hay un territorio con ese nombre en ese mercado.', 'There is already a territory with that name in that market.')
    if (prev[0]) {
      // Existía y estaba archivado: vuelve a ofrecerse, con los comercios que ya lo tenían.
      await tx`update crm.territories set archived_at = null, name = ${name.data} where id = ${prev[0].id}`
      await audit(tx, ctx, 'territory.restored', 'territory', prev[0].id, input.market, null, { name: name.data })
      return prev[0].id
    }
    const rows = await tx<{ id: string }[]>`insert into crm.territories (market_code, code, name) values (${input.market}, ${code}, ${name.data}) returning id`
    await audit(tx, ctx, 'territory.created', 'territory', rows[0]!.id, input.market, null, { name: name.data, code })
    return rows[0]!.id
  })
}

export async function renameTerritory(ctx: Ctx, id: string, rawName: string): Promise<void> {
  ctx.assert('config.manage')
  const name = nameInput.safeParse(rawName)
  if (!name.success) throw invalid('Ponle un nombre de al menos dos letras.', 'Give it a name of at least two letters.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; name: string }[]>`select market_code, name from crm.territories where id = ${id} for update`
    const t = rows[0]
    if (!t) throw notFound('No encontramos ese territorio.', 'We could not find that territory.')
    if (t.name === name.data) return
    const dup = await tx`select 1 from crm.territories where market_code = ${t.market_code} and lower(name) = lower(${name.data}) and id <> ${id}`
    if (dup[0]) throw invalid('Ya hay un territorio con ese nombre en ese mercado.', 'There is already a territory with that name in that market.')
    await tx`update crm.territories set name = ${name.data} where id = ${id}`
    await audit(tx, ctx, 'territory.renamed', 'territory', id, t.market_code, { name: t.name }, { name: name.data })
  })
}

/** Archivar no borra: el territorio deja de ofrecerse y los comercios que lo tenían lo conservan. */
export async function archiveTerritory(ctx: Ctx, id: string, archived: boolean): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; name: string; archived_at: Date | null }[]>`select market_code, name, archived_at from crm.territories where id = ${id} for update`
    const t = rows[0]
    if (!t) throw notFound('No encontramos ese territorio.', 'We could not find that territory.')
    if (!!t.archived_at === archived) return
    await tx`update crm.territories set archived_at = ${archived ? tx`now()` : null} where id = ${id}`
    await audit(tx, ctx, archived ? 'territory.archived' : 'territory.restored', 'territory', id, t.market_code, null, { name: t.name })
  })
}

/** Deja a una persona con exactamente esos territorios en ese mercado. Solo entra quien vende hoy en el mercado. */
export async function setUserTerritories(ctx: Ctx, userId: string, market: string, territoryIds: string[]): Promise<void> {
  ctx.assert('config.manage')
  const ids = [...new Set(z.array(z.guid()).max(100).parse(territoryIds))]
  if (!z.guid().safeParse(userId).success) throw invalid('Elige a una persona.', 'Choose a person.')
  await withUser(ctx.user.id, async (tx) => {
    const seller = await tx`select 1 from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
      where m.user_id = ${userId} and m.market_code = ${market} and m.role in ('rep','supervisor','market_lead')
        and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())`
    if (!seller[0]) throw invalid('Esa persona no vende en este mercado.', 'That person does not sell in this market.')
    const valid = await tx<{ id: string }[]>`select id from crm.territories where id = any(${ids}::uuid[]) and market_code = ${market} and archived_at is null`
    if (valid.length !== ids.length) throw invalid('Algún territorio no es de este mercado.', 'One of the territories does not belong to this market.')
    const before = await tx<{ territory_id: string }[]>`
      select ut.territory_id from crm.user_territories ut join crm.territories t on t.id = ut.territory_id
       where ut.user_id = ${userId} and t.market_code = ${market}`
    const had = before.map((r) => r.territory_id)
    const drop = had.filter((t) => !ids.includes(t))
    const add = ids.filter((t) => !had.includes(t))
    if (drop.length === 0 && add.length === 0) return
    if (drop.length) await tx`delete from crm.user_territories where user_id = ${userId} and territory_id = any(${drop}::uuid[])`
    for (const t of add) await tx`insert into crm.user_territories (user_id, territory_id) values (${userId}, ${t}) on conflict do nothing`
    await audit(tx, ctx, 'user.territories_changed', 'user', userId, market, { territory_ids: had }, { territory_ids: ids })
  })
}
