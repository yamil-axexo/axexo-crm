import 'server-only'
import { applyTerritoryOwners } from '@/domain/mx-config'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit } from '@/domain/common'
import { notify } from '@/domain/notify'
import { rolesIn } from '@/domain/policy'
import { invalid, notFound } from '@/lib/errors'
import { isUuid } from '@/lib/ids'
import { accountFilter, narrows, ownerKeys, vacant, type AccountFilters } from '@/server/account-filter'

/**
 * Reparto de cartera. Tres reglas valen para todo lo que vive aquí:
 * 1. Quién reparte: supervisión, líder de mercado y administración (policy.ts). Supervisión reparte lo de su equipo y
 *    lo que no tiene dueño vigente en su mercado, y solo a personas de su equipo. El líder de mercado y administración
 *    reparten todo el mercado a cualquiera que venda en él. La base repite el límite con RLS (0011_distribution).
 * 2. Por lotes: cada llamada mueve hasta REPARTO_BATCH registros en una transacción y dice cuántos quedan.
 *    Así un reparto de miles no deja una transacción larga ni se pierde a la mitad.
 * 3. Todo queda en la bitácora: un evento por lote, con cuántos se movieron, de quién y a quién.
 */
export const REPARTO_BATCH = 500
export type Progress = { moved: number; left: number }

const OPEN_LEAD = ['new', 'contacted', 'qualified']

/** Supervisión sin rol de líder ni de administración en ese mercado: reparte solo dentro de su equipo. */
export function teamOnly(ctx: Ctx, market: string): boolean {
  const roles = rolesIn(ctx.memberships, market)
  return !roles.includes('admin') && !roles.includes('market_lead')
}

function marketOf(ctx: Ctx, market: string | undefined): string {
  if (!market || !ctx.markets.some((m) => m.code === market)) throw invalid('Elige un mercado: se reparte un mercado a la vez.', 'Choose a market: one market is distributed at a time.')
  return market
}

/** Quien recibe tiene que vender hoy en ese mercado y, si reparte supervisión, ser de su equipo. Devuelve su nombre. */
export async function assertTarget(tx: Tx, ctx: Ctx, market: string, toUserId: string): Promise<string> {
  if (!isUuid(toUserId)) throw invalid('Elige a quién se lo pasas.', 'Choose who receives it.')
  const rows = await tx<{ full_name: string; mine: boolean }[]>`
    select u.full_name, (u.id = any(app.supervised_user_ids())
             -- E4.F2 (datos2): quien opera sin supervisar pasa registros dentro de su equipo.
             or exists (select 1 from crm.memberships a join crm.memberships b on b.team_id = a.team_id and b.market_code = a.market_code
                         where a.user_id = app.current_user_id() and b.user_id = u.id and a.market_code = ${market} and a.team_id is not null
                           and a.valid_from <= now() and (a.valid_to is null or a.valid_to > now()))) as mine
      from crm.users u
     where u.id = ${toUserId} and u.is_active and not u.is_system
       and exists (select 1 from crm.memberships m
                    where m.user_id = u.id and m.market_code = ${market} and m.role in ('rep','supervisor','market_lead')
                      and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))`
  const target = rows[0]
  if (!target) throw invalid('Esa persona no vende en este mercado.', 'That person does not sell in this market.')
  if (teamOnly(ctx, market) && !target.mine) {
    throw invalid('Solo puedes pasar registros a personas de tu equipo. Para otro equipo, pídeselo a quien lidera el mercado.', 'You can only pass records to people on your team. For another team, ask the market lead.')
  }
  return target.full_name
}

type Acc = { id: string; owner_id: string | null }

/**
 * CAMPO-03 / CANAL-03: el comercio se va con sus negocios abiertos, sus tareas y visitas por hacer y sus pendientes, y la atribución
 * de dueño queda con fecha efectiva (la anterior se cierra, no se borra).
 */
export async function moveAccounts(tx: Tx, ctx: Ctx, market: string, accs: Acc[], toUserId: string, toName: string): Promise<number> {
  const moved = accs.filter((a) => a.owner_id !== toUserId).map((a) => a.id)
  if (moved.length === 0) return 0
  const from = [...new Set(accs.filter((a) => a.owner_id !== toUserId).map((a) => a.owner_id ?? 'none'))].slice(0, 20)
  // El nombre se lee antes de mover: quien opera deja de ver el comercio al pasarlo.
  const oneName = moved.length === 1 ? (await tx<{ name: string }[]>`select name from crm.accounts where id = ${moved[0]!}`)[0]?.name ?? null : null
  let deals: { count: number }
  let tasks: { count: number }
  if (!ctx.can('account.reassign', market) && ctx.can('operator.reassign', market)) {
    // E4.F2 (datos2): quien opera pasa lo que ve; la base mueve lo mismo de abajo (app.operator_move_accounts) y revisa el mercado.
    const r = (await tx<{ deals: number; tasks: number }[]>`select deals, tasks from app.operator_move_accounts(${moved}::uuid[], ${toUserId}, ${toName})`)[0]!
    deals = { count: r.deals }
    tasks = { count: r.tasks }
  } else {
    await tx`update crm.account_attributions set effective_to = now() where account_id = any(${moved}::uuid[]) and layer = 'owner' and effective_to is null`
    await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by)
             select a.id, a.market_code, 'owner', 'user', ${toUserId}, ${toName}, ${ctx.user.id} from crm.accounts a where a.id = any(${moved}::uuid[])`
    deals = await tx`update crm.deals set owner_id = ${toUserId} where account_id = any(${moved}::uuid[]) and status = 'open'`
    tasks = await tx`update crm.activities set owner_id = ${toUserId} where account_id = any(${moved}::uuid[]) and kind in ('task', 'visit') and done_at is null`
    await tx`update crm.accounts set owner_id = ${toUserId} where id = any(${moved}::uuid[])`
    // Los pendientes abiertos siguen al registro: Mi equipo cuenta por dueño y no debe seguir cargándolos a quien ya no lo lleva.
    await tx`update crm.exceptions set owner_id = ${toUserId} where resolved_at is null and account_id = any(${moved}::uuid[]) and kind not in ('unowned_account', 'duplicate_suspect')`
  }
  await audit(tx, ctx, 'account.reassigned', 'account', null, market, { count: moved.length, from_user_ids: from },
    { to_user_id: toUserId, to_name: toName, deals: deals.count, tasks: tasks.count, account_ids: moved.slice(0, 50) })
  await emit(tx, 'account.reassigned', 'user', toUserId, market, { count: moved.length })
  // E13.F2 (cambio de quién lo lleva): un solo aviso por reparto, no uno por comercio.
  if (toUserId !== ctx.user.id) {
    const one = oneName
    await notify(tx, ctx, {
      to: toUserId, kind: 'lifecycle', market, template: 'owner_changed', link: one ? `/comercios/${moved[0]}` : '/comercios', accountId: one ? moved[0] : null, needsAction: false,
      title: one ? [`Ahora llevas ${one}`, `You now own ${one}`] : [`Ahora llevas ${moved.length} comercios más`, `You now own ${moved.length} more merchants`],
      body: [`${ctx.user.name} te los asignó, con sus negocios abiertos y sus tareas.`, `${ctx.user.name} assigned them to you, with their open deals and tasks.`],
      vars: { comercio: one ?? `${moved.length}`, quien: ctx.user.name },
    })
  }
  return moved.length
}

/**
 * Tomar un comercio que nadie lleva. Quien dirige toma cualquiera de su alcance; quien vende, solo los que están en uno
 * de sus territorios (la base repite ese límite en `accounts_upd`). Se va con sus negocios abiertos y sus pendientes, como
 * en una reasignación, y queda en la bitácora con el mismo evento.
 */
export async function takeAccount(ctx: Ctx, accountId: string): Promise<string> {
  const id = z.guid().parse(accountId)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<(Acc & { market_code: string; name: string; territory_id: string | null })[]>`
      select id, market_code, owner_id, name, territory_id from crm.accounts where id = ${id} and archived_at is null for update`
    const acc = rows[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('account.take', acc.market_code)
    if (acc.owner_id) throw invalid('Ese comercio ya tiene quien lo lleve.', 'That merchant already has an owner.')
    if (!ctx.can('account.reassign', acc.market_code)) {
      const mine = acc.territory_id ? await tx`select 1 from crm.user_territories where user_id = ${ctx.user.id} and territory_id = ${acc.territory_id}` : []
      if (!mine[0]) {
        throw invalid('Esta tienda no está en tus territorios. Pídesela a tu supervisión o a quien lidera tu mercado.',
          'This store is not in your territories. Ask your supervisor or your market lead for it.')
      }
    }
    const toName = await assertTarget(tx, ctx, acc.market_code, ctx.user.id)
    // Primero el comercio: lo demás (negocios, pendientes, atribución) se mueve ya con dueño.
    await tx`update crm.accounts set owner_id = ${ctx.user.id} where id = ${acc.id}`
    await moveAccounts(tx, ctx, acc.market_code, [{ id: acc.id, owner_id: null }], ctx.user.id, toName)
    return acc.name
  })
}

/** Reasignar una selección de comercios (uno desde la ficha, varios desde la lista). */
export async function reassignAccounts(ctx: Ctx, accountIds: string[], toUserId: string): Promise<number> {
  const ids = z.array(z.guid()).min(1).max(REPARTO_BATCH).parse(accountIds)
  return withUser(ctx.user.id, async (tx) => {
    const accs = await tx<(Acc & { market_code: string })[]>`
      select id, market_code, owner_id from crm.accounts where id = any(${ids}::uuid[]) and archived_at is null for update`
    if (accs.length === 0) throw notFound('No encontramos esos comercios.', 'We could not find those merchants.')
    const markets = [...new Set(accs.map((a) => a.market_code))]
    if (markets.length > 1) throw invalid('Reasigna un mercado a la vez.', 'Reassign one market at a time.')
    const market = markets[0]!
    // E4.F2 (datos2): Ventas, Operaciones y Finanzas también, donde la decisión del mercado lo permite.
    if (!ctx.can('account.reassign', market)) ctx.assert('operator.reassign', market)
    const toName = await assertTarget(tx, ctx, market, toUserId)
    return moveAccounts(tx, ctx, market, accs, toUserId, toName)
  })
}

export type RepartoPreview = { accounts: number; deals: number; tasks: number }

/** Cuántos comercios trae un filtro y qué se iría con ellos. Si se dice a quién van, no cuenta los que ya son suyos. */
export async function previewAccounts(ctx: Ctx, f: AccountFilters, toUserId?: string): Promise<RepartoPreview> {
  const market = marketOf(ctx, f.market)
  ctx.assert('account.reassign', market)
  return withUser(ctx.user.id, async (tx) => {
    const { where } = accountFilter(tx, ctx, { ...f, market, after: undefined })
    const rows = await tx<RepartoPreview[]>`
      select count(*)::int as accounts,
             coalesce(sum((select count(*) from crm.deals d where d.account_id = a.id and d.status = 'open')), 0)::int as deals,
             coalesce(sum((select count(*) from crm.activities x where x.account_id = a.id and x.kind in ('task', 'visit') and x.done_at is null)), 0)::int as tasks
        from crm.accounts a where ${where} ${isUuid(toUserId) ? tx`and a.owner_id is distinct from ${toUserId}` : tx``}`
    return rows[0]!
  })
}

/** "Todos los de este filtro": mueve un lote de los comercios que el filtro trae y dice cuántos quedan. Se repite hasta cero. */
export async function reassignByFilter(ctx: Ctx, f: AccountFilters, toUserId: string, batch = REPARTO_BATCH): Promise<Progress> {
  const market = marketOf(ctx, f.market)
  ctx.assert('account.reassign', market)
  if (!narrows(f)) throw invalid('Acota primero: elige quién lo lleva, región, ciudad o territorio.', 'Narrow it down first: choose an owner, region, city or territory.')
  const size = Math.min(Math.max(1, batch), REPARTO_BATCH)
  return withUser(ctx.user.id, async (tx) => {
    const toName = await assertTarget(tx, ctx, market, toUserId)
    const { where } = accountFilter(tx, ctx, { ...f, market, after: undefined })
    const pending = tx`${where} and a.owner_id is distinct from ${toUserId}`
    const accs = await tx<Acc[]>`select a.id, a.owner_id from crm.accounts a where ${pending} order by a.name_norm, a.id limit ${size} for update of a`
    if (accs.length === 0) return { moved: 0, left: 0 }
    const moved = await moveAccounts(tx, ctx, market, accs, toUserId, toName)
    const left = await tx<{ n: number }[]>`select count(*)::int as n from crm.accounts a where ${pending}`
    return { moved, left: left[0]?.n ?? 0 }
  })
}

// ---------------------------------------------------------------- territorio en bloque

/** El territorio tiene que ser del mismo mercado y estar vigente. Vacío quita el territorio. */
async function assertTerritory(tx: Tx, market: string, territoryId: string | null): Promise<string | null> {
  if (!territoryId) return null
  if (!isUuid(territoryId)) throw invalid('Elige un territorio.', 'Choose a territory.')
  const rows = await tx<{ name: string }[]>`select name from crm.territories where id = ${territoryId} and market_code = ${market} and archived_at is null`
  if (!rows[0]) throw invalid('Ese territorio no es de este mercado.', 'That territory does not belong to this market.')
  return rows[0].name
}

async function applyTerritory(tx: Tx, ctx: Ctx, market: string, ids: string[], territoryId: string | null, name: string | null): Promise<number> {
  if (ids.length === 0) return 0
  await tx`update crm.accounts set territory_id = ${territoryId} where id = any(${ids}::uuid[])`
  await audit(tx, ctx, 'account.territory_set', 'account', null, market, { count: ids.length }, { territory_id: territoryId, territory: name, account_ids: ids.slice(0, 50) })
  return ids.length
}

/** Poner (o quitar) el territorio de una selección de comercios. */
export async function setTerritory(ctx: Ctx, accountIds: string[], territoryId: string | null): Promise<number> {
  const ids = z.array(z.guid()).min(1).max(REPARTO_BATCH).parse(accountIds)
  return withUser(ctx.user.id, async (tx) => {
    const accs = await tx<{ id: string; market_code: string; territory_id: string | null }[]>`
      select id, market_code, territory_id from crm.accounts where id = any(${ids}::uuid[]) and archived_at is null for update`
    if (accs.length === 0) throw notFound('No encontramos esos comercios.', 'We could not find those merchants.')
    const markets = [...new Set(accs.map((a) => a.market_code))]
    if (markets.length > 1) throw invalid('Cambia el territorio de un mercado a la vez.', 'Change the territory of one market at a time.')
    const market = markets[0]!
    ctx.assert('account.territory', market)
    const name = await assertTerritory(tx, market, territoryId)
    const changed = accs.filter((a) => a.territory_id !== territoryId).map((a) => a.id)
    const done = await applyTerritory(tx, ctx, market, changed, territoryId, name)
    // E16.F2: al cambiar de territorio, la tienda de venta puerta a puerta pasa al gerente del territorio nuevo (si tiene).
    await applyTerritoryOwners(tx, changed)
    return done
  })
}

/** "Poner este territorio a los comercios de este filtro", por lotes. */
export async function setTerritoryByFilter(ctx: Ctx, f: AccountFilters, territoryId: string | null, batch = REPARTO_BATCH): Promise<Progress> {
  const market = marketOf(ctx, f.market)
  ctx.assert('account.territory', market)
  if (!narrows(f)) throw invalid('Acota primero: elige quién lo lleva, región, ciudad o territorio.', 'Narrow it down first: choose an owner, region, city or territory.')
  const size = Math.min(Math.max(1, batch), REPARTO_BATCH)
  return withUser(ctx.user.id, async (tx) => {
    const name = await assertTerritory(tx, market, territoryId)
    const { where } = accountFilter(tx, ctx, { ...f, market, after: undefined })
    const pending = tx`${where} and a.territory_id is distinct from ${territoryId}`
    const rows = await tx<{ id: string }[]>`select a.id from crm.accounts a where ${pending} order by a.name_norm, a.id limit ${size} for update of a`
    const moved = await applyTerritory(tx, ctx, market, rows.map((r) => r.id), territoryId, name)
    await applyTerritoryOwners(tx, rows.map((r) => r.id))
    const left = await tx<{ n: number }[]>`select count(*)::int as n from crm.accounts a where ${pending}`
    return { moved, left: left[0]?.n ?? 0 }
  })
}

// ---------------------------------------------------------------- leads y negocios en bloque

/** De quién: una persona, 'none' (sin dueño) o 'vacant' (todo lo que no tiene dueño vigente). */
export type Source = { market: string; from: string; to: string }

function sourceCond(tx: Tx, row: 'l' | 'd', market: string, from: string) {
  if (from === 'none') return tx`${tx(row)}.owner_id is null`
  if (from === 'vacant') return vacant(tx, row, ownerKeys(tx, [market]))
  if (isUuid(from)) return tx`${tx(row)}.owner_id = ${from}`
  throw invalid('Elige de quién son.', 'Choose whose they are.')
}

/** Cuántos leads o negocios abiertos tiene esa persona en ese mercado (los que quien pregunta puede ver). */
export async function previewOpen(ctx: Ctx, what: 'leads' | 'deals', s: Omit<Source, 'to'> & { to?: string }): Promise<number> {
  const market = marketOf(ctx, s.market)
  ctx.assert(what === 'leads' ? 'lead.assign' : 'deal.reassign', market)
  return withUser(ctx.user.id, async (tx) => {
    const skip = (row: 'l' | 'd') => (isUuid(s.to) ? tx`and ${tx(row)}.owner_id is distinct from ${s.to}` : tx``)
    const rows = what === 'leads'
      ? await tx<{ n: number }[]>`select count(*)::int as n from crm.leads l where l.market_code = ${market} and l.status = any(${OPEN_LEAD}::text[]) and ${sourceCond(tx, 'l', market, s.from)} ${skip('l')}`
      : await tx<{ n: number }[]>`select count(*)::int as n from crm.deals d where d.market_code = ${market} and d.status = 'open' and ${sourceCond(tx, 'd', market, s.from)} ${skip('d')}`
    return rows[0]?.n ?? 0
  })
}

/** Pasa los leads abiertos de una persona a otra, por ejemplo cuando alguien sale. El reloj de primer contacto no cambia. */
export async function reassignLeads(ctx: Ctx, s: Source, batch = REPARTO_BATCH): Promise<Progress> {
  const market = marketOf(ctx, s.market)
  ctx.assert('lead.assign', market)
  if (s.from === s.to) throw invalid('Elige dos personas distintas.', 'Choose two different people.')
  const size = Math.min(Math.max(1, batch), REPARTO_BATCH)
  return withUser(ctx.user.id, async (tx) => {
    const toName = await assertTarget(tx, ctx, market, s.to)
    const pending = tx`l.market_code = ${market} and l.status = any(${OPEN_LEAD}::text[]) and ${sourceCond(tx, 'l', market, s.from)} and l.owner_id is distinct from ${s.to}`
    const rows = await tx<{ id: string }[]>`select l.id from crm.leads l where ${pending} order by l.created_at, l.id limit ${size} for update of l`
    const ids = rows.map((r) => r.id)
    if (ids.length === 0) return { moved: 0, left: 0 }
    await tx`update crm.leads set owner_id = ${s.to}, assigned_at = now() where id = any(${ids}::uuid[])`
    await tx`update crm.exceptions set owner_id = ${s.to} where resolved_at is null and lead_id = any(${ids}::uuid[])`
    await audit(tx, ctx, 'lead.reassigned', 'lead', null, market, { count: ids.length, from: s.from }, { to_user_id: s.to, to_name: toName, lead_ids: ids.slice(0, 50) })
    await emit(tx, 'lead.reassigned', 'user', s.to, market, { count: ids.length })
    // Uno por lead, con el mismo nombre que la asignación individual: quien conecte un canal de avisos escucha un solo evento.
    for (const id of ids) await emit(tx, 'lead.assigned', 'lead', id, market, { owner_id: s.to, by: 'reassignment' })
    if (ids.length && s.to !== ctx.user.id)
      await notify(tx, ctx, {
        to: s.to, kind: 'lead_arrived', market, link: '/leads', leadId: ids.length === 1 ? ids[0] : null,
        title: [`Te ${ids.length === 1 ? 'pasaron un lead' : `pasaron ${ids.length} leads`}`, `${ids.length === 1 ? 'A lead was' : `${ids.length} leads were`} passed to you`],
        body: [`${ctx.user.name} te los reasignó. Están en Leads y en Hoy.`, `${ctx.user.name} reassigned them to you. They are in Leads and in Today.`],
      })
    const left = await tx<{ n: number }[]>`select count(*)::int as n from crm.leads l where ${pending}`
    return { moved: ids.length, left: left[0]?.n ?? 0 }
  })
}

/**
 * Pasa los negocios abiertos de una persona a otra sin mover el comercio: el comercio se queda con su dueño.
 * Las tareas y las visitas por hacer de quien lo vendía se van con el negocio; las que son de otra persona (Operaciones,
 * una aprobación, una automatización) se quedan con ella.
 */
export async function reassignDeals(ctx: Ctx, s: Source, batch = REPARTO_BATCH): Promise<Progress> {
  const market = marketOf(ctx, s.market)
  if (!ctx.can('deal.reassign', market)) ctx.assert('operator.reassign', market)
  if (s.from === s.to) throw invalid('Elige dos personas distintas.', 'Choose two different people.')
  const size = Math.min(Math.max(1, batch), REPARTO_BATCH)
  return withUser(ctx.user.id, async (tx) => {
    const toName = await assertTarget(tx, ctx, market, s.to)
    const pending = tx`d.market_code = ${market} and d.status = 'open' and ${sourceCond(tx, 'd', market, s.from)} and d.owner_id is distinct from ${s.to}`
    const rows = await tx<{ id: string }[]>`select d.id from crm.deals d where ${pending} order by d.created_at, d.id limit ${size} for update of d`
    const ids = rows.map((r) => r.id)
    if (ids.length === 0) return { moved: 0, left: 0 }
    // Se van con el negocio las tareas y visitas por hacer de quien lo vendía. Lo que es de otra persona se queda con ella:
    // las tareas del carril de Operaciones, una aprobación pendiente de quien supervisa, lo que una automatización le dejó a alguien más.
    const tasks = await tx`
      update crm.activities a set owner_id = ${s.to} from crm.deals d
       where d.id = a.deal_id and a.deal_id = any(${ids}::uuid[]) and a.kind in ('task', 'visit') and a.done_at is null
         and a.owner_id is not distinct from d.owner_id and a.approval_id is null`
    await tx`update crm.deals set owner_id = ${s.to} where id = any(${ids}::uuid[])`
    await tx`update crm.exceptions set owner_id = ${s.to} where resolved_at is null and deal_id = any(${ids}::uuid[])`
    await audit(tx, ctx, 'deal.reassigned', 'deal', null, market, { count: ids.length, from: s.from }, { to_user_id: s.to, to_name: toName, tasks: tasks.count, deal_ids: ids.slice(0, 50) })
    await emit(tx, 'deal.reassigned', 'user', s.to, market, { count: ids.length })
    // Un evento por negocio: las automatizaciones que escuchan "cambia quien lleva un negocio" lo necesitan (GOB-05, automatización 3 de Pipedrive).
    for (const id of ids) await emit(tx, 'deal.owner_changed', 'deal', id, market, { owner_id: s.to })
    const left = await tx<{ n: number }[]>`select count(*)::int as n from crm.deals d where ${pending}`
    return { moved: ids.length, left: left[0]?.n ?? 0 }
  })
}
