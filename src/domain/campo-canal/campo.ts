import 'server-only'
import { z } from 'zod'
import { withUser, marketToday, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { notifyMany, peopleWithRole } from '@/domain/notify'
import { invalid, notFound } from '@/lib/errors'
import { assertTarget, moveAccounts } from '@/domain/reparto'
import { threshold } from './thresholds'

const UUID = /^[0-9a-f-]{36}$/i

// ------------------------------------------------------------------------------------------------ CAMPO-03 cartera
export const DUTIES = ['hunter', 'farmer'] as const
export const PROFILES = ['hunter', 'farmer', 'both'] as const

/** Canal como eje separado del territorio: quién abre (hunter) y quién cuida (farmer) el comercio en un canal, con vigencia. */
export async function setChannelAssignment(ctx: Ctx, raw: { accountId: string; channel: string; userId: string; duty: string; reason: string }): Promise<void> {
  const p = z.object({ accountId: z.guid(), channel: z.string().trim().regex(/^[a-z0-9_]{2,30}$/), userId: z.guid().or(z.literal('')), duty: z.enum(DUTIES), reason: z.string().trim().min(3).max(300) }).safeParse(raw)
  if (!p.success) throw invalid('Elige el comercio, el canal, la persona, si abre o cuida, y el motivo.', 'Choose the merchant, the channel, the person, whether they open or keep it, and the reason.')
  const d = p.data
  assertNoProhibited(d.reason)
  await withUser(ctx.user.id, async (tx) => {
    const acc = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${d.accountId} for update`)[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('portfolio.plan', acc.market_code)
    if (d.userId) await assertTarget(tx, ctx, acc.market_code, d.userId)
    const cur = (await tx<{ id: string; user_id: string | null; channel: string }[]>`select id, user_id, channel from crm.channel_assignments where account_id = ${d.accountId} and duty = ${d.duty} and valid_to is null for update`)[0]
    if (cur) await tx`update crm.channel_assignments set valid_to = now() where id = ${cur.id}`
    await tx`insert into crm.channel_assignments (account_id, market_code, channel, user_id, duty, reason, created_by)
             values (${d.accountId}, ${acc.market_code}, ${d.channel}, ${d.userId || null}, ${d.duty}, ${d.reason}, ${ctx.user.id})`
    await audit(tx, ctx, 'channel.assigned', 'account', d.accountId, acc.market_code, cur ? { channel: cur.channel, user_id: cur.user_id } : null, { channel: d.channel, user_id: d.userId || null, duty: d.duty, reason: d.reason })
  })
}

/** Polo con dueño: un territorio tiene una persona que responde por él, con vigencia. */
export async function setTerritoryOwner(ctx: Ctx, territoryId: string, userId: string): Promise<void> {
  if (!UUID.test(territoryId) || !UUID.test(userId)) throw invalid('Elige el territorio y la persona.', 'Choose the territory and the person.')
  await withUser(ctx.user.id, async (tx) => {
    const t = (await tx<{ market_code: string; name: string }[]>`select market_code, name from crm.territories where id = ${territoryId}`)[0]
    if (!t) throw notFound('No encontramos ese territorio.', 'We could not find that territory.')
    ctx.assert('territory.own', t.market_code)
    const name = await assertTarget(tx, ctx, t.market_code, userId)
    const cur = (await tx<{ id: string; user_id: string }[]>`select id, user_id from crm.territory_owners where territory_id = ${territoryId} and valid_to is null for update`)[0]
    if (cur?.user_id === userId) return
    if (cur) await tx`update crm.territory_owners set valid_to = now() where id = ${cur.id}`
    await tx`insert into crm.territory_owners (territory_id, market_code, user_id, created_by) values (${territoryId}, ${t.market_code}, ${userId}, ${ctx.user.id})`
    await audit(tx, ctx, 'territory.owner_set', 'territory', territoryId, t.market_code, cur ? { user_id: cur.user_id } : null, { user_id: userId, name, territory: t.name })
  })
}

export async function setSellerProfile(ctx: Ctx, market: string, userId: string, profile: string): Promise<void> {
  if (!UUID.test(userId) || !(PROFILES as readonly string[]).includes(profile)) throw invalid('Elige la persona y su perfil.', 'Choose the person and their profile.')
  ctx.assert('territory.own', market)
  await withUser(ctx.user.id, async (tx) => {
    await assertTarget(tx, ctx, market, userId)
    await tx`insert into crm.seller_profiles (user_id, market_code, profile, updated_by) values (${userId}, ${market}, ${profile}, ${ctx.user.id})
             on conflict (user_id, market_code) do update set profile = excluded.profile, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'seller.profile_set', 'user', userId, market, null, { profile })
  })
}

type Person = { id: string; name: string; count: number }
export type PlanDiff = { accounts: number; deals: number; tasks: number; lose: Person[]; gain: Person[] }

/** Quién ve un comercio por llevarlo o por supervisar a quien lo lleva (las dos fuentes de visibilidad que cambia un reparto). */
async function watchers(tx: Tx, market: string, userId: string): Promise<{ id: string; name: string }[]> {
  return tx<{ id: string; name: string }[]>`
    select distinct u.id, u.full_name as name from crm.users u where u.id = ${userId}
    union
    select distinct s.user_id, su.full_name from crm.memberships r
      join crm.memberships s on s.team_id = r.team_id and s.role = 'supervisor' and s.market_code = r.market_code and (s.valid_to is null or s.valid_to > now())
      join crm.users su on su.id = s.user_id
     where r.user_id = ${userId} and r.market_code = ${market} and r.team_id is not null and (r.valid_to is null or r.valid_to > now())`
}

async function computeDiff(tx: Tx, market: string, ids: string[], toUserId: string): Promise<PlanDiff> {
  const accs = await tx<{ id: string; owner_id: string | null }[]>`select id, owner_id from crm.accounts where id = any(${ids}::uuid[]) and archived_at is null`
  const moving = accs.filter((a) => a.owner_id !== toUserId)
  const counts = (await tx<{ deals: number; tasks: number }[]>`
    select (select count(*)::int from crm.deals where account_id = any(${moving.map((a) => a.id)}::uuid[]) and status = 'open') as deals,
           (select count(*)::int from crm.activities where account_id = any(${moving.map((a) => a.id)}::uuid[]) and kind in ('task', 'visit') and done_at is null) as tasks`)[0]!
  const gainers = await watchers(tx, market, toUserId)
  const gainIds = new Set(gainers.map((g) => g.id))
  const lose = new Map<string, Person>()
  const byOwner = new Map<string, number>()
  for (const a of moving) if (a.owner_id) byOwner.set(a.owner_id, (byOwner.get(a.owner_id) ?? 0) + 1)
  for (const [owner, n] of byOwner) {
    for (const w of await watchers(tx, market, owner)) {
      if (gainIds.has(w.id)) continue
      const cur = lose.get(w.id) ?? { id: w.id, name: w.name, count: 0 }
      cur.count += n
      lose.set(w.id, cur)
    }
  }
  const prevWatchers = new Set<string>()
  for (const owner of byOwner.keys()) for (const w of await watchers(tx, market, owner)) prevWatchers.add(w.id)
  const unowned = moving.filter((a) => !a.owner_id).length
  return {
    accounts: moving.length, deals: counts.deals, tasks: counts.tasks,
    lose: [...lose.values()].sort((a, b) => b.count - a.count),
    gain: gainers.filter((g) => !prevWatchers.has(g.id) || unowned > 0).map((g) => ({ id: g.id, name: g.name, count: moving.length })),
  }
}

/**
 * Plan de cartera en borrador: se guarda con la lista de comercios y la comparación de quién gana y quién pierde
 * visibilidad. Nada cambia hasta aplicarlo. Origen: todos los comercios que lleva una persona (opcional: de un territorio).
 */
export async function draftPlan(ctx: Ctx, raw: { market: string; fromUserId: string; toUserId: string; territoryId?: string; note?: string }): Promise<string> {
  const p = z.object({ market: z.string().min(2).max(3), fromUserId: z.guid(), toUserId: z.guid(), territoryId: z.guid().optional().or(z.literal('')), note: z.string().max(300).optional() }).safeParse(raw)
  if (!p.success) throw invalid('Elige de quién salen los comercios y a quién van.', 'Choose whose merchants move and who receives them.')
  const d = p.data
  if (d.fromUserId === d.toUserId) throw invalid('Elige a otra persona: los comercios ya son suyos.', 'Choose someone else: the merchants are already theirs.')
  ctx.assert('portfolio.plan', d.market)
  const note = clean(d.note)
  assertNoProhibited(note)
  return withUser(ctx.user.id, async (tx) => {
    await assertTarget(tx, ctx, d.market, d.toUserId)
    const accs = await tx<{ id: string }[]>`select id from crm.accounts where market_code = ${d.market} and owner_id = ${d.fromUserId} and archived_at is null
                                            ${d.territoryId ? tx`and territory_id = ${d.territoryId}` : tx``} order by id limit 5000`
    if (accs.length === 0) throw invalid('Esa persona no lleva comercios que puedas repartir con ese filtro.', 'That person has no merchants you can move with that filter.')
    const ids = accs.map((a) => a.id)
    const diff = await computeDiff(tx, d.market, ids, d.toUserId)
    const rows = await tx<{ id: string }[]>`insert into crm.reassignment_plans (market_code, to_user_id, account_ids, diff, note, created_by)
      values (${d.market}, ${d.toUserId}, ${ids}::uuid[], ${tx.json(diff)}, ${note}, ${ctx.user.id}) returning id`
    await audit(tx, ctx, 'portfolio.plan_drafted', 'reassignment_plan', rows[0]!.id, d.market, null, { accounts: diff.accounts, to_user_id: d.toUserId, lose: diff.lose.length, gain: diff.gain.length })
    return rows[0]!.id
  })
}

/** Aplicar el plan en UNA transacción: o se mueve todo o nada. Antes recalcula la comparación con lo que hay hoy. */
export async function applyPlan(ctx: Ctx, planId: string): Promise<number> {
  if (!UUID.test(planId)) throw notFound()
  return withUser(ctx.user.id, async (tx) => {
    const plan = (await tx<{ market_code: string; status: string; to_user_id: string; account_ids: string[] }[]>`
      select market_code, status, to_user_id, account_ids from crm.reassignment_plans where id = ${planId} for update`)[0]
    if (!plan) throw notFound('No encontramos ese plan.', 'We could not find that plan.')
    ctx.assert('portfolio.plan', plan.market_code)
    if (plan.status !== 'draft') throw invalid('Ese plan ya se aplicó o se descartó.', 'That plan was already applied or discarded.')
    const toName = await assertTarget(tx, ctx, plan.market_code, plan.to_user_id)
    const diff = await computeDiff(tx, plan.market_code, plan.account_ids, plan.to_user_id)
    const accs = await tx<{ id: string; owner_id: string | null }[]>`select id, owner_id from crm.accounts where id = any(${plan.account_ids}::uuid[]) and archived_at is null for update`
    const moved = await moveAccounts(tx, ctx, plan.market_code, accs, plan.to_user_id, toName)
    await tx`update crm.reassignment_plans set status = 'applied', applied_by = ${ctx.user.id}, applied_at = now(), moved = ${moved}, diff = ${tx.json(diff)} where id = ${planId}`
    await audit(tx, ctx, 'portfolio.plan_applied', 'reassignment_plan', planId, plan.market_code, null, { moved, lose: diff.lose.map((x) => x.id), gain: diff.gain.map((x) => x.id) })
    return moved
  })
}

export async function discardPlan(ctx: Ctx, planId: string): Promise<void> {
  if (!UUID.test(planId)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const plan = (await tx<{ market_code: string; status: string }[]>`select market_code, status from crm.reassignment_plans where id = ${planId} for update`)[0]
    if (!plan) throw notFound('No encontramos ese plan.', 'We could not find that plan.')
    ctx.assert('portfolio.plan', plan.market_code)
    if (plan.status !== 'draft') return
    await tx`update crm.reassignment_plans set status = 'discarded' where id = ${planId}`
    await audit(tx, ctx, 'portfolio.plan_discarded', 'reassignment_plan', planId, plan.market_code, null, null)
  })
}

// ------------------------------------------------------------------------------------------------ CAMPO-02 prioridad
export type Reason = { code: 'revisit_overdue' | 'no_sale' | 'at_risk' | 'low_balance' | 'never_visited'; days?: number }

/**
 * Prioridad diaria por tienda con reglas explicables (no un modelo): segmento A a D por ventas de 30 días dentro del
 * mercado, frecuencia de visita por segmento (umbral), y razones visibles. Grupo de control: un porcentaje fijo de
 * tiendas de cada territorio (por el id, estable) se marca holdout y no se publica como prioridad, para medir el efecto.
 */
export async function computePriorityTx(tx: Tx): Promise<number> {
  const markets = await tx<{ code: string }[]>`select code from crm.markets`
  let n = 0
  for (const { code } of markets) {
    const t = async (k: Parameters<typeof threshold>[2]) => (await threshold(tx, code, k)).value
    const freq = { a: await t('visit_every_days_a'), b: await t('visit_every_days_b'), c: await t('visit_every_days_c'), d: await t('visit_every_days_d') }
    const noSale = await t('no_sale_days')
    const holdout = await t('holdout_pct')
    const low = await t('low_balance_minor')
    const res = await tx`
      with base as (
        select a.id, a.market_code, a.owner_id, a.lifecycle, coalesce(a.territory_id::text, 'none') as terr,
               coalesce(m.volume_minor_30d, 0) as vol, m.last_txn_at,
               (select max(v.business_date) from crm.visits v where v.account_id = a.id) as last_visit,
               (select f.balance_minor from crm.account_funding f where f.account_id = a.id order by f.as_of desc, f.loaded_at desc limit 1) as balance
          from crm.accounts a
          left join lateral (select x.volume_minor_30d, x.last_txn_at from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
         where a.market_code = ${code} and a.archived_at is null and a.lifecycle in ('onboarding', 'active', 'at_risk')
      ), seg as (
        select b.*, (array['a','b','c','d'])[ntile(4) over (order by b.vol desc, b.id)] as segment, ${marketToday(tx, code)} as today from base b
      ), scored as (
        select s.*, case s.segment when 'a' then ${freq.a}::int when 'b' then ${freq.b}::int when 'c' then ${freq.c}::int else ${freq.d}::int end as every,
               (s.today - s.last_visit) as since_visit,
               case when s.last_txn_at is null then null else (s.today - (s.last_txn_at at time zone 'UTC')::date) end as since_sale
          from seg s
      ), reasons as (
        select sc.*,
          (case when sc.last_visit is null then jsonb_build_array(jsonb_build_object('code', 'never_visited'))
                when sc.since_visit > sc.every then jsonb_build_array(jsonb_build_object('code', 'revisit_overdue', 'days', sc.since_visit - sc.every)) else '[]'::jsonb end)
          || (case when sc.since_sale is not null and sc.since_sale >= ${noSale}::int then jsonb_build_array(jsonb_build_object('code', 'no_sale', 'days', sc.since_sale)) else '[]'::jsonb end)
          || (case when sc.lifecycle = 'at_risk' then jsonb_build_array(jsonb_build_object('code', 'at_risk')) else '[]'::jsonb end)
          || (case when sc.balance is not null and sc.balance < ${low}::bigint then jsonb_build_array(jsonb_build_object('code', 'low_balance')) else '[]'::jsonb end) as why
          from scored sc
      )
      insert into crm.store_priority (account_id, market_code, day, owner_id, segment, score, reasons, holdout)
      select r.id, r.market_code, r.today, r.owner_id, r.segment,
             least(100, (case when r.last_visit is null then 35 when r.since_visit > r.every then least(40, 20 + (r.since_visit - r.every) * 2) else 0 end)
                       + (case when r.since_sale is not null and r.since_sale >= ${noSale}::int then 30 else 0 end)
                       + (case when r.lifecycle = 'at_risk' then 20 else 0 end)
                       + (case when r.balance is not null and r.balance < ${low}::bigint then 10 else 0 end)
                       + (case r.segment when 'a' then 5 when 'b' then 3 else 0 end)),
             r.why,
             (('x' || substr(md5(r.terr || ':' || r.id::text), 1, 8))::bit(32)::bigint % 100) < ${holdout}::int
        from reasons r
      on conflict (account_id, day) do update set score = excluded.score, reasons = excluded.reasons, holdout = excluded.holdout,
        segment = excluded.segment, owner_id = excluded.owner_id, computed_at = now()`
    n += res.count
  }
  return n
}

// ------------------------------------------------------------------------------------------------ CAMPO-07 competencia
export async function addCompetitor(ctx: Ctx, market: string, rawName: string): Promise<string> {
  const name = clean(rawName)
  if (!name || name.length < 2 || name.length > 80) throw invalid('Escribe el nombre del competidor.', 'Write the competitor name.')
  ctx.assert('competitor.record', market)
  assertNoProhibited(name)
  return withUser(ctx.user.id, async (tx) => {
    const ex = (await tx<{ id: string }[]>`select id from crm.competitors where market_code = ${market} and lower(name) = lower(${name})`)[0]
    if (ex) return ex.id
    const rows = await tx<{ id: string }[]>`insert into crm.competitors (market_code, name, created_by) values (${market}, ${name}, ${ctx.user.id}) returning id`
    await audit(tx, ctx, 'competitor.added', 'competitor', rows[0]!.id, market, null, { name })
    return rows[0]!.id
  })
}

const obsIn = z.object({
  accountId: z.guid(), competitorId: z.guid(), product: z.string().trim().max(80).optional().default(''),
  price: z.string().trim().optional().default(''), observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.enum(['visit', 'onboarding', 'dealer_tabs']),
})
/** Observación estructurada con fecha y fuente: qué competidor, qué producto y a qué precio. No es texto libre en notas. */
export async function recordCompetitor(ctx: Ctx, raw: Record<string, string>): Promise<string> {
  const p = obsIn.safeParse(raw)
  if (!p.success) throw invalid('Elige el competidor, la fecha y dónde lo viste.', 'Choose the competitor, the date and where you saw it.')
  const d = p.data
  const price = d.price ? Number(d.price.replace(',', '.')) : null
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1e7)) throw invalid('El precio tiene que ser un número.', 'The price must be a number.')
  assertNoProhibited(d.product)
  return withUser(ctx.user.id, async (tx) => {
    const acc = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${d.accountId}`)[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('competitor.record', acc.market_code)
    const comp = await tx`select 1 from crm.competitors where id = ${d.competitorId} and market_code = ${acc.market_code} and is_active`
    if (!comp[0]) throw invalid('Elige un competidor de la lista de este mercado.', 'Choose a competitor from this market’s list.')
    const future = (await tx<{ f: boolean }[]>`select ${d.observedOn}::date > ${marketToday(tx, acc.market_code)} as f`)[0]!.f
    if (future) throw invalid('La fecha no puede ser futura.', 'The date cannot be in the future.')
    const rows = await tx<{ id: string }[]>`insert into crm.account_competitors (account_id, market_code, competitor_id, product, price_minor, observed_on, source, recorded_by)
      values (${d.accountId}, ${acc.market_code}, ${d.competitorId}, ${d.product || null}, ${price === null ? null : Math.round(price * 100)}, ${d.observedOn}::date, ${d.source}, ${ctx.user.id}) returning id`
    await audit(tx, ctx, 'competitor.observed', 'account', d.accountId, acc.market_code, null, { competitor_id: d.competitorId, source: d.source, observed_on: d.observedOn })
    return rows[0]!.id
  })
}

// ------------------------------------------------------------------------------------------------ CAMPO-08 punto de venta perfecto
export type PerfectStoreSignal = { account_id: string; score?: number; items_ok: number; items_total: number; observed_at: string; visit_ref?: string | null }
/** Guarda el puntaje que manda la Sales App con la visita. El checklist vive en la Sales App; aquí solo puntaje y fecha. */
export async function ingestPerfectStoreTx(tx: Tx, s: PerfectStoreSignal, source: 'sales_app' | 'test' = 'sales_app'): Promise<boolean> {
  const p = z.object({ account_id: z.guid(), items_ok: z.number().int().min(0).max(10), items_total: z.number().int().min(1).max(10), observed_at: z.string().min(10).max(40), visit_ref: z.string().max(80).nullish() }).safeParse(s)
  if (!p.success || p.data.items_ok > p.data.items_total || Number.isNaN(Date.parse(p.data.observed_at))) throw invalid('Puntaje de punto de venta inválido.', 'Invalid perfect store score.')
  const acc = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${p.data.account_id}`)[0]
  if (!acc) return false
  const score = Math.round((p.data.items_ok / p.data.items_total) * 100)
  const res = await tx`insert into crm.perfect_store_scores (account_id, market_code, score, items_ok, items_total, observed_at, source, visit_ref)
    values (${p.data.account_id}, ${acc.market_code}, ${score}, ${p.data.items_ok}, ${p.data.items_total}, ${p.data.observed_at}::timestamptz, ${source}, ${p.data.visit_ref ?? null})
    on conflict (account_id, observed_at) do nothing`
  return res.count > 0
}

// ------------------------------------------------------------------------------------------------ CAMPO-04 metas y avisos
export async function setRepPlan(ctx: Ctx, raw: { market: string; userId: string; month: string; target: string | number }): Promise<void> {
  const p = z.object({ market: z.string().min(2).max(3), userId: z.guid(), month: z.string().regex(/^\d{4}-\d{2}$/), target: z.coerce.number().int().min(1).max(1000) }).safeParse(raw)
  if (!p.success) throw invalid('Elige la persona, el mes y la meta de altas ganadas.', 'Choose the person, the month and the won sign-up target.')
  const d = p.data
  ctx.assert('plan.set', d.market)
  await withUser(ctx.user.id, async (tx) => {
    await assertTarget(tx, ctx, d.market, d.userId)
    await tx`insert into crm.rep_plans (market_code, user_id, month, target_won, set_by) values (${d.market}, ${d.userId}, ${d.month + '-01'}::date, ${d.target}, ${ctx.user.id})
             on conflict (user_id, market_code, month) do update set target_won = excluded.target_won, set_by = excluded.set_by, updated_at = now()`
    await audit(tx, ctx, 'plan.set', 'user', d.userId, d.market, null, { month: d.month, target_won: d.target })
  })
}

/**
 * Avisos de saldo bajo, de punto de venta por debajo del mínimo y de quien va bajo su meta. Abre y cierra solo, con dueño
 * (quien lleva el comercio; en metas, la persona misma) y con la versión del umbral que lo abrió. Corre como sistema.
 */
export async function evaluateFieldExceptionsTx(tx: Tx): Promise<{ opened: number; closed: number }> {
  let opened = 0
  let closed = 0
  for (const { code } of await tx<{ code: string }[]>`select code from crm.markets`) {
    const low = await threshold(tx, code, 'low_balance_minor')
    const ps = await threshold(tx, code, 'perfect_store_min')
    const pct = await threshold(tx, code, 'under_plan_pct')
    const o1 = await tx`
      insert into crm.exceptions (market_code, kind, severity, account_id, owner_id, detail, dedupe_key, rule_key, rule_version)
      select a.market_code, 'low_balance', 'medium', a.id, a.owner_id, jsonb_build_object('name', a.name, 'balance_minor', f.balance_minor, 'as_of', f.as_of, 'source', f.source),
             'low_balance:' || a.id, 'low_balance_minor', ${low.version}
        from crm.accounts a
        join lateral (select x.balance_minor, x.as_of, x.source from crm.account_funding x where x.account_id = a.id order by x.as_of desc, x.loaded_at desc limit 1) f on true
       where a.market_code = ${code} and a.archived_at is null and f.balance_minor < ${low.value}::bigint
      on conflict (dedupe_key) where resolved_at is null do nothing`
    const c1 = await tx`
      update crm.exceptions e set resolved_at = now(), resolution = 'auto_closed'
       where e.kind = 'low_balance' and e.market_code = ${code} and e.resolved_at is null
         and coalesce((select x.balance_minor from crm.account_funding x where x.account_id = e.account_id order by x.as_of desc, x.loaded_at desc limit 1), ${low.value}::bigint) >= ${low.value}::bigint`
    const o2 = await tx`
      insert into crm.exceptions (market_code, kind, severity, account_id, owner_id, detail, dedupe_key, rule_key, rule_version)
      select a.market_code, 'perfect_store_low', 'low', a.id, a.owner_id, jsonb_build_object('name', a.name, 'score', s.score, 'observed_at', s.observed_at),
             'perfect_store_low:' || a.id, 'perfect_store_min', ${ps.version}
        from crm.accounts a
        join lateral (select x.score, x.observed_at from crm.perfect_store_scores x where x.account_id = a.id order by x.observed_at desc limit 1) s on true
       where a.market_code = ${code} and a.archived_at is null and s.score < ${ps.value}::int
      on conflict (dedupe_key) where resolved_at is null do nothing`
    const c2 = await tx`
      update crm.exceptions e set resolved_at = now(), resolution = 'auto_closed'
       where e.kind = 'perfect_store_low' and e.market_code = ${code} and e.resolved_at is null
         and coalesce((select x.score from crm.perfect_store_scores x where x.account_id = e.account_id order by x.observed_at desc limit 1), 100) >= ${ps.value}::int`
    // Bajo meta: altas ganadas en el mes contra lo esperado a la fecha (meta × días transcurridos / días del mes × %).
    const planRows = `
      select p.user_id, p.market_code, p.target_won, u.full_name,
             (select count(*)::int from crm.deals d where d.owner_id = p.user_id and d.market_code = p.market_code and d.status = 'won'
                and (d.won_at at time zone mk.timezone)::date >= p.month) as won,
             p.target_won * (extract(day from (now() at time zone mk.timezone))::numeric / extract(day from (p.month + interval '1 month' - interval '1 day'))::numeric) as expected,
             to_char(p.month, 'YYYY-MM') as ym
        from crm.rep_plans p join crm.users u on u.id = p.user_id join crm.markets mk on mk.code = p.market_code
       where p.market_code = $1 and p.month = date_trunc('month', now() at time zone mk.timezone)::date`
    const plans = await tx.unsafe<{ user_id: string; market_code: string; target_won: number; full_name: string; won: number; expected: string; ym: string }[]>(planRows, [code])
    for (const r of plans) {
      const below = r.won < Number(r.expected) * (pct.value / 100)
      const key = `under_plan:${r.user_id}:${r.ym}`
      if (below) {
        const res = await tx`insert into crm.exceptions (market_code, kind, severity, owner_id, detail, dedupe_key, rule_key, rule_version)
          values (${code}, 'under_plan', 'medium', ${r.user_id}, ${tx.json({ name: r.full_name, won: r.won, target: r.target_won, expected: Math.round(Number(r.expected) * 10) / 10, month: r.ym })}, ${key}, 'under_plan_pct', ${pct.version})
          on conflict (dedupe_key) where resolved_at is null do nothing`
        opened += res.count
      } else {
        const res = await tx`update crm.exceptions set resolved_at = now(), resolution = 'auto_closed' where dedupe_key = ${key} and resolved_at is null`
        closed += res.count
      }
    }
    opened += o1.count + o2.count
    closed += c1.count + c2.count
  }
  return { opened, closed }
}

// ------------------------------------------------------------------------------------------------ SEG-06 incidentes
export const INCIDENT_TYPES = ['conduct', 'complaint', 'fraud_suspicion', 'equipment', 'other'] as const
const incIn = z.object({
  market: z.string().min(2).max(3), accountId: z.guid().optional().or(z.literal('')), partyKind: z.enum(['user', 'street_seller', 'partner', 'other']),
  partyLabel: z.string().trim().min(2).max(120), type: z.enum(INCIDENT_TYPES), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string().trim().min(10).max(2000),
})

/** Registro confidencial, separado de las notas comerciales. Lo ve quien lo reporta y quien lidera o administra el mercado. */
export async function reportIncident(ctx: Ctx, raw: Record<string, string>): Promise<string> {
  const p = incIn.safeParse(raw)
  if (!p.success) throw invalid('Di de quién se trata, qué tipo de incidente es, cuándo pasó y descríbelo (al menos una frase).', 'Say who it is about, what type of incident it is, when it happened and describe it (at least one sentence).')
  const d = p.data
  ctx.assert('incident.report', d.market)
  assertNoProhibited(d.partyLabel, d.description)
  return withUser(ctx.user.id, async (tx) => {
    if (d.accountId) {
      const acc = await tx`select 1 from crm.accounts where id = ${d.accountId} and market_code = ${d.market}`
      if (!acc[0]) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    }
    const rows = await tx<{ id: string }[]>`insert into crm.field_incidents (market_code, account_id, party_kind, party_label, type, occurred_on, description, reported_by)
      values (${d.market}, ${d.accountId || null}, ${d.partyKind}, ${d.partyLabel}, ${d.type}, ${d.occurredOn}::date, ${d.description}, ${ctx.user.id}) returning id`
    const id = rows[0]!.id
    // La bitácora no copia la descripción ni a quién señala: solo que existe, de qué tipo y en qué mercado.
    await audit(tx, ctx, 'incident.reported', 'field_incident', id, d.market, null, { type: d.type })
    await notifyMany(tx, ctx, (await peopleWithRole(tx, d.market, ['market_lead'])).filter((u) => u !== ctx.user.id), {
      kind: 'lifecycle', market: d.market, link: '/campo?tab=incidentes', needsAction: true,
      title: ['Incidente de campo por atender', 'Field incident to handle'], body: ['Es confidencial: el detalle está en Campo y canales.', 'It is confidential: the detail is under Field and channels.'],
    })
    return id
  })
}

export async function handleIncident(ctx: Ctx, id: string, action: string, rawResolution: string): Promise<void> {
  if (!UUID.test(id)) throw notFound()
  if (action !== 'take' && action !== 'close') throw invalid('Elige tomar o cerrar.', 'Choose take or close.')
  const resolution = clean(rawResolution)
  if (action === 'close' && (!resolution || resolution.length < 3)) throw invalid('Escribe cómo se atendió.', 'Write how it was handled.')
  assertNoProhibited(resolution)
  await withUser(ctx.user.id, async (tx) => {
    const r = (await tx<{ market_code: string; status: string }[]>`select market_code, status from crm.field_incidents where id = ${id} for update`)[0]
    if (!r) throw notFound('No encontramos ese incidente.', 'We could not find that incident.')
    ctx.assert('incident.manage', r.market_code)
    if (r.status === 'closed') throw invalid('Ese incidente ya está cerrado.', 'That incident is already closed.')
    if (action === 'take') await tx`update crm.field_incidents set status = 'in_review', assigned_to = ${ctx.user.id} where id = ${id}`
    else await tx`update crm.field_incidents set status = 'closed', resolution = ${resolution}, closed_at = now(), assigned_to = coalesce(assigned_to, ${ctx.user.id}) where id = ${id}`
    await audit(tx, ctx, action === 'take' ? 'incident.taken' : 'incident.closed', 'field_incident', id, r.market_code, { status: r.status }, { status: action === 'take' ? 'in_review' : 'closed' })
  })
}

/** Abrir el detalle de un incidente deja huella: el acceso restringido también es auditado. */
export async function logIncidentView(ctx: Ctx, id: string): Promise<void> {
  if (!UUID.test(id)) return
  await withUser(ctx.user.id, async (tx) => {
    const r = (await tx<{ market_code: string }[]>`select market_code from crm.field_incidents where id = ${id}`)[0]
    if (r) await audit(tx, ctx, 'incident.viewed', 'field_incident', id, r.market_code, null, null)
  })
}
