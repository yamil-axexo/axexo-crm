import 'server-only'
import { z } from 'zod'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { notifyMany, peopleWithRole } from '@/domain/notify'
import { invalid, notFound } from '@/lib/errors'
import { threshold } from './thresholds'
import { lakehouseCrossmatch, pullAcademyProgress } from '@/server/adapters/campo2'

const UUID = /^[0-9a-f-]{36}$/i

// ------------------------------------------------------------------------------------------------ CANAL-02 el aliado registra
export type PartnerClaimOutcome = { status: 'registered'; id: string; until: Date } | { status: 'customer' } | { status: 'held'; until: Date | null }
const partnerClaimIn = z.object({ root: z.string().regex(UUID), storeName: z.string().trim().min(2).max(160), city: z.string().trim().min(2).max(80) })

/**
 * El aliado registra una tienda a nombre de su propio nodo, con las mismas reglas que quien lidera el mercado: la tienda
 * que ya es cliente se rechaza, la que tiene registro vigente de otro canal también (sin decir de quién) y la ventana sale
 * del umbral del mercado. La base solo le deja escribir y leer registros de su nodo.
 */
export async function partnerRegisterClaim(ctx: Ctx, raw: Record<string, string>): Promise<PartnerClaimOutcome> {
  const p = partnerClaimIn.safeParse(raw)
  if (!p.success) throw invalid('Escribe el nombre de la tienda y su ciudad.', 'Write the store name and its city.')
  const d = p.data
  assertNoProhibited(d.storeName, d.city)
  return withUser(ctx.user.id, async (tx) => {
    const root = (await tx<{ id: string; name: string; market_code: string }[]>`
      select id, name, market_code from crm.accounts where id = ${d.root} and id = any(app.partner_root_ids())`)[0]
    if (!root) throw notFound('Ese nodo no es tuyo.', 'That node is not yours.')
    ctx.assert('claim.partner_register', root.market_code)
    const key = (await tx<{ k: string }[]>`select app.norm(${d.storeName}) || '|' || app.norm(${d.city}) as k`)[0]!.k
    const chk = (await tx<{ customer: boolean; held_by_other: boolean; until: Date | null }[]>`select * from app.claim_check(${root.market_code}, ${key}, ${d.storeName}, ${root.id})`)[0]
    const reject = async (reason: string, why: string) => {
      await tx`insert into crm.channel_claims (market_code, store_name, store_key, node_ref, node_label, channel, status, expires_at, rejection_reason, registered_by, closed_at, registered_via)
               values (${root.market_code}, ${d.storeName}, ${key}, ${root.id}, ${root.name}, 'partner', 'rejected', now(), ${reason}, ${ctx.user.id}, now(), 'partner')`
      await audit(tx, ctx, 'claim.rejected', 'channel_claim', null, root.market_code, null, { reason: why, node: root.name, via: 'partner' })
    }
    if (chk?.customer) {
      await reject('La tienda ya es cliente', 'customer')
      return { status: 'customer' }
    }
    if (chk?.held_by_other) {
      await reject('Ya tiene registro vigente de otro canal', 'held')
      return { status: 'held', until: chk.until }
    }
    const mine = (await tx<{ id: string; expires_at: Date }[]>`
      select id, expires_at from crm.channel_claims where market_code = ${root.market_code} and store_key = ${key} and status = 'active' and node_ref = ${root.id}`)[0]
    if (mine) return { status: 'registered', id: mine.id, until: mine.expires_at }
    const win = await threshold(tx, root.market_code, 'claim_window_days')
    const rows = await tx<{ id: string; expires_at: Date }[]>`
      insert into crm.channel_claims (market_code, store_name, store_key, node_ref, node_label, channel, expires_at, registered_by, registered_via)
      values (${root.market_code}, ${d.storeName}, ${key}, ${root.id}, ${root.name}, 'partner', now() + make_interval(days => ${win.value}), ${ctx.user.id}, 'partner')
      returning id, expires_at`
    await audit(tx, ctx, 'claim.registered', 'channel_claim', rows[0]!.id, root.market_code, null, { node: root.name, channel: 'partner', window_days: win.value, window_version: win.version, via: 'partner' })
    await notifyMany(tx, ctx, await peopleWithRole(tx, root.market_code, ['market_lead']), {
      kind: 'lifecycle', market: root.market_code, link: '/campo?tab=registros', needsAction: false,
      title: ['Un aliado registró una tienda', 'A partner registered a store'], body: [`${root.name}: ${d.storeName}.`, `${root.name}: ${d.storeName}.`],
    })
    return { status: 'registered', id: rows[0]!.id, until: rows[0]!.expires_at }
  })
}

// ------------------------------------------------------------------------------------------------ CANAL-05 estado de comisión
export type StatementCounts = { enrolled: number; first_sales: number; active_30: number; active_60: number; active_90: number; threshold: number; threshold_pending: string | null; team_active_90?: number }

/**
 * Estimado del mes por persona que lleva cartera y por aliado: solo conteos (altas, primeras ventas y activos a 30, 60 y 90
 * días contra el umbral del premio), nunca montos. Lo publicado no se recalcula. Corre como sistema o desde la pantalla.
 */
export async function estimateStatementsTx(tx: Tx, market: string, month?: string): Promise<number> {
  const m = month ?? (await tx<{ m: string }[]>`select to_char(${marketToday(tx, tx`${market}::text`)}, 'YYYY-MM') as m`)[0]!.m
  const goal = await threshold(tx, market, 'incentive_active_90')
  const pending = (await tx<{ p: string | null }[]>`select pending_owner as p from crm.field_thresholds where market_code = ${market} and key = 'incentive_active_90' and valid_to is null`)[0]?.p ?? null
  const base = tx`
    with mm as (select distinct on (x.account_id) x.account_id, x.first_txn_at, x.txn_count_30d from crm.merchant_metrics_daily x order by x.account_id, x.as_of desc),
    bounds as (select ${m + '-01'}::date as s, (${m + '-01'}::date + interval '1 month' - interval '1 day')::date as e, mk.timezone as tz from crm.markets mk where mk.code = ${market}),
    st as (
      select a.id, a.owner_id, a.ancestor_ids, (a.created_at at time zone b.tz)::date as created_day, (mm.first_txn_at at time zone b.tz)::date as first_day, coalesce(mm.txn_count_30d, 0) as txn, b.s, b.e
        from crm.accounts a cross join bounds b left join mm on mm.account_id = a.id
       where a.market_code = ${market} and a.kind = 'store' and a.archived_at is null and a.merged_into is null)`
  const people = await tx<{ ref: string; label: string; enrolled: number; first_sales: number; a30: number; a60: number; a90: number; team_a90: number }[]>`
    ${base}, per as (
      select st.owner_id as ref,
             count(*) filter (where st.created_day between st.s and st.e)::int as enrolled,
             count(*) filter (where st.first_day between st.s and st.e)::int as first_sales,
             count(*) filter (where st.first_day <= st.e - 30 and st.txn > 0)::int as a30,
             count(*) filter (where st.first_day <= st.e - 60 and st.txn > 0)::int as a60,
             count(*) filter (where st.first_day <= st.e - 90 and st.txn > 0)::int as a90
        from st where st.owner_id is not null group by 1)
    select per.ref::text as ref, u.full_name as label, per.enrolled, per.first_sales, per.a30, per.a60, per.a90,
           coalesce((select sum(p2.a90) from per p2 join crm.memberships m2 on m2.user_id = p2.ref and m2.market_code = ${market} and (m2.valid_to is null or m2.valid_to > now())
                      where m2.team_id is not null and m2.team_id = (select m1.team_id from crm.memberships m1 where m1.user_id = per.ref and m1.market_code = ${market}
                                                                     and (m1.valid_to is null or m1.valid_to > now()) and m1.team_id is not null limit 1)), 0)::int as team_a90
      from per join crm.users u on u.id = per.ref`
  const partners = await tx<{ ref: string; label: string; enrolled: number; first_sales: number; a30: number; a60: number; a90: number }[]>`
    ${base}
    select r.id::text as ref, r.name as label,
           count(st.id) filter (where st.created_day between st.s and st.e)::int as enrolled,
           count(st.id) filter (where st.first_day between st.s and st.e)::int as first_sales,
           count(st.id) filter (where st.first_day <= st.e - 30 and st.txn > 0)::int as a30,
           count(st.id) filter (where st.first_day <= st.e - 60 and st.txn > 0)::int as a60,
           count(st.id) filter (where st.first_day <= st.e - 90 and st.txn > 0)::int as a90
      from crm.partner_profiles pp join crm.accounts r on r.id = pp.account_id
      left join st on st.id = r.id or r.id = any(st.ancestor_ids)
     where pp.market_code = ${market} and pp.ended_at is null group by r.id, r.name`
  let n = 0
  const save = async (kind: 'user' | 'partner', x: { ref: string; label: string; enrolled: number; first_sales: number; a30: number; a60: number; a90: number; team_a90?: number }) => {
    const counts: StatementCounts = { enrolled: x.enrolled, first_sales: x.first_sales, active_30: x.a30, active_60: x.a60, active_90: x.a90, threshold: goal.value, threshold_pending: pending, ...(kind === 'user' ? { team_active_90: x.team_a90 ?? 0 } : {}) }
    const r = await tx`
      insert into crm.commission_statements (market_code, party_kind, party_ref, party_label, month, counts)
      values (${market}, ${kind}, ${x.ref}, ${x.label}, ${m + '-01'}::date, ${tx.json(counts)})
      on conflict (market_code, party_kind, party_ref, month) do update set counts = excluded.counts, party_label = excluded.party_label, updated_at = now()
       where crm.commission_statements.status = 'estimate'`
    n += r.count
  }
  for (const x of people) await save('user', x)
  for (const x of partners) await save('partner', x)
  return n
}

export async function estimateStatements(ctx: Ctx, market: string): Promise<number> {
  ctx.assert('statement.manage', market)
  ctx.market(market)
  return withUser(ctx.user.id, async (tx) => {
    const n = await estimateStatementsTx(tx, market)
    await audit(tx, ctx, 'commission_statement.estimated', 'market', null, market, null, { statements: n })
    return n
  })
}

/** Publicar: solo con las reglas escritas (enlace o referencia del documento aprobado). Lo publicado ya no cambia. */
export async function publishStatement(ctx: Ctx, id: string, rawRules: string): Promise<void> {
  if (!UUID.test(id)) throw notFound()
  const rules = clean(rawRules)
  if (!rules || rules.length < 3) throw invalid('Escribe dónde están las reglas escritas con que se publica (enlace o nombre del documento aprobado).', 'Write where the written rules it is published under are (link or name of the approved document).')
  assertNoProhibited(rules)
  await withUser(ctx.user.id, async (tx) => {
    const s = (await tx<{ market_code: string; status: string; party_label: string }[]>`select market_code, status, party_label from crm.commission_statements where id = ${id} for update`)[0]
    if (!s) throw notFound()
    ctx.assert('statement.manage', s.market_code)
    if (s.status !== 'estimate') throw invalid('Ya está publicado.', 'It is already published.')
    await tx`update crm.commission_statements set status = 'published', rules_ref = ${rules.slice(0, 200)}, published_by = ${ctx.user.id}, published_at = now(), updated_at = now() where id = ${id}`
    await audit(tx, ctx, 'commission_statement.published', 'commission_statement', id, s.market_code, { status: 'estimate' }, { status: 'published', party: s.party_label, rules: rules.slice(0, 200) })
  })
}

// ------------------------------------------------------------------------------------------------ CANAL-08 política de reversos
const policyIn = z.object({
  market: z.string().min(2).max(3),
  clawbackDays: z.coerce.number().int().min(0).max(365),
  policyEs: z.string().trim().min(20).max(2000),
  policyEn: z.string().trim().min(20).max(2000),
  arbiterId: z.string().regex(UUID).optional().or(z.literal('')),
  financeBy: z.string().trim().max(120).optional().default(''),
  salesBy: z.string().trim().max(120).optional().default(''),
  reason: z.string().trim().min(3).max(300),
})

/**
 * Nueva versión de la política: se cierra la vigente y se abre otra. Queda "aprobada" solo cuando trae quién la aprobó por
 * Finanzas y por Ventas; si no, sigue como propuesta con el dueño pendiente a la vista.
 */
export async function setChannelPolicy(ctx: Ctx, raw: Record<string, string>): Promise<number> {
  const p = policyIn.safeParse(raw)
  if (!p.success) throw invalid('Escribe la política en los dos idiomas (al menos 20 letras), los días y el motivo del cambio.', 'Write the policy in both languages (at least 20 characters), the days and the reason for the change.')
  const d = p.data
  ctx.assert('channel_policy.manage', d.market)
  ctx.market(d.market)
  assertNoProhibited(d.policyEs, d.policyEn, d.financeBy, d.salesBy, d.reason)
  const approved = d.financeBy.length >= 2 && d.salesBy.length >= 2
  return withUser(ctx.user.id, async (tx) => {
    if (d.arbiterId) {
      const ok = await tx`select 1 from crm.memberships m where m.user_id = ${d.arbiterId} and (m.market_code = ${d.market} or m.role = 'admin') and m.role in ('admin', 'market_lead') and (m.valid_to is null or m.valid_to > now())`
      if (!ok[0]) throw invalid('Quien arbitra tiene que liderar este mercado o administrar.', 'The arbiter must lead this market or be an administrator.')
    }
    const cur = (await tx<{ id: string; version: number; clawback_days: number; status: string }[]>`
      select id, version, clawback_days, status from crm.channel_policies where market_code = ${d.market} and valid_to is null for update`)[0]
    if (cur) await tx`update crm.channel_policies set valid_to = now() where id = ${cur.id}`
    const version = (cur?.version ?? 0) + 1
    await tx`insert into crm.channel_policies (market_code, version, clawback_days, policy_es, policy_en, arbiter_id, status, pending_owner, approved_finance_by, approved_sales_by, reason, set_by)
             values (${d.market}, ${version}, ${d.clawbackDays}, ${d.policyEs}, ${d.policyEn}, ${d.arbiterId || null}, ${approved ? 'approved' : 'proposed'},
                     ${approved ? null : 'Finanzas y Ventas'}, ${approved ? d.financeBy : null}, ${approved ? d.salesBy : null}, ${d.reason}, ${ctx.user.id})`
    await audit(tx, ctx, 'channel_policy.changed', 'market', null, d.market, cur ? { version: cur.version, clawback_days: cur.clawback_days, status: cur.status } : null,
      { version, clawback_days: d.clawbackDays, status: approved ? 'approved' : 'proposed', arbiter: d.arbiterId || null, reason: d.reason })
    return version
  })
}

export type ChannelPolicy = { version: number; clawback_days: number; policy_es: string; policy_en: string; arbiter_id: string | null; arbiter: string | null; status: string; pending_owner: string | null; approved_finance_by: string | null; approved_sales_by: string | null; valid_from: Date }
export async function channelPolicyTx(tx: Tx, market: string): Promise<ChannelPolicy | null> {
  const rows = await tx<ChannelPolicy[]>`
    select p.version, p.clawback_days, p.policy_es, p.policy_en, p.arbiter_id, u.full_name as arbiter, p.status, p.pending_owner, p.approved_finance_by, p.approved_sales_by, p.valid_from
      from crm.channel_policies p left join crm.users u on u.id = p.arbiter_id where p.market_code = ${market} and p.valid_to is null`
  return rows[0] ?? null
}

// ------------------------------------------------------------------------------------------------ CANAL-06 avance y cruce
const progressIn = z.object({ partner: z.string().regex(UUID), material: z.string().regex(UUID), learner: z.string().trim().min(2).max(80), pct: z.coerce.number().int().min(0).max(100) })

/** A mano mientras Kore Academy no manda el avance (adaptador apagado). */
export async function recordEnablementProgress(ctx: Ctx, raw: Record<string, string>): Promise<void> {
  const p = progressIn.safeParse(raw)
  if (!p.success) throw invalid('Elige el aliado, el material, quién lo toma y el avance (0 a 100).', 'Choose the partner, the material, who takes it and the progress (0 to 100).')
  const d = p.data
  assertNoProhibited(d.learner)
  await withUser(ctx.user.id, async (tx) => {
    const pp = (await tx<{ market_code: string }[]>`
      select pp.market_code from crm.partner_profiles pp join crm.partner_enablement e on e.market_code = pp.market_code and e.id = ${d.material}
       where pp.account_id = ${d.partner} and pp.ended_at is null`)[0]
    if (!pp) throw notFound('Ese aliado o ese material no existen en el mercado.', 'That partner or material does not exist in the market.')
    ctx.assert('enablement.record', pp.market_code)
    const today = (await tx<{ d: string }[]>`select ${marketToday(tx, tx`${pp.market_code}::text`)}::text as d`)[0]!.d
    await tx`insert into crm.enablement_progress (market_code, partner_account_id, material_id, learner_ref, progress_pct, completed_on, source, recorded_by)
             values (${pp.market_code}, ${d.partner}, ${d.material}, ${d.learner}, ${d.pct}, ${d.pct === 100 ? today : null}::date, 'manual', ${ctx.user.id})`
    await audit(tx, ctx, 'enablement.progress_recorded', 'account', d.partner, pp.market_code, null, { material_id: d.material, progress: d.pct, source: 'manual' })
  })
}

/** Tarea programada: trae el avance de Kore Academy si la conexión está encendida. Apagada: no hace nada y lo dice. */
export async function syncAcademyProgressTx(tx: Tx): Promise<{ done: number; note: string }> {
  const pairs = await tx<{ partnerAccountId: string; materialId: string; market_code: string }[]>`
    select pp.account_id as "partnerAccountId", e.id as "materialId", pp.market_code
      from crm.partner_profiles pp join crm.partner_enablement e on e.market_code = pp.market_code and e.tier_code = pp.tier_code and e.is_active
     where pp.ended_at is null`
  const today = new Date().toISOString().slice(0, 10)
  const rows = await pullAcademyProgress(pairs, today)
  if (!rows) return { done: 0, note: 'academy_progress adapter off' }
  let n = 0
  for (const r of rows) {
    const mk = pairs.find((x) => x.partnerAccountId === r.partnerAccountId && x.materialId === r.materialId)?.market_code
    if (!mk) continue
    const res = await tx`insert into crm.enablement_progress (market_code, partner_account_id, material_id, learner_ref, progress_pct, completed_on, source, external_id)
                         values (${mk}, ${r.partnerAccountId}, ${r.materialId}, ${r.learnerRef}, ${r.progressPct}, ${r.completedOn}::date, 'kore_academy', ${r.externalId})
                         on conflict (external_id) do nothing`
    n += res.count
  }
  return { done: n, note: 'academy progress' }
}

/** Dónde corre el cruce de bases hoy: en el lakehouse si la conexión está encendida; si no, dentro de CONTIGO. */
export async function crossmatchWhere(market: string): Promise<'lakehouse' | 'contigo'> {
  return (await lakehouseCrossmatch(market)) === null ? 'contigo' : 'lakehouse'
}
