import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { forbidden } from '@/lib/errors'
import { marketPeriods, teamFilter } from '@/dal/reports'
import { aiAdapter, AI_FEATURES, PROMPT_VERSION, type AiFeature } from '@/server/adapters/ai'
import { leadFacts, leadWeights, LEAD_FACTS_SQL, logCall, THRESHOLD, type LeadFactRow } from '@/domain/ia/commands'
import { ASKABLE, classifyLead, matchQuestion, nextReason, periodIn, PERIODIC, scoreLead, type Askable, type AskPeriod, type LeadClass, type NextRule, type ScoreFactor } from '@/domain/ia/rules'
import { AGENTS, type Level } from '@/domain/ia/agents'
import type { MarketPeriods } from '@/dal/reports'
import type { PeriodKey } from '@/lib/periods'

type Pair = [es: string, en: string]

// ================================================================ IA-02: sugerencias
export type Rec = {
  id: string; account_id: string; account_name: string; market_code: string; owner_id: string | null; owner_name: string | null
  rule_code: NextRule; signal: { days?: number; dropPct?: number; daysSinceCreated?: number }; created_at: Date; expires_at: Date; reason: Pair
}
const withReason = (r: Omit<Rec, 'reason'>): Rec => ({ ...r, reason: nextReason({ rule: r.rule_code, ...r.signal }) })

export async function openRecommendations(ctx: Ctx, f: { scope: 'mine' | 'all'; account?: string; limit?: number }): Promise<Rec[]> {
  if (!ctx.can('ia.read')) throw forbidden()
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Omit<Rec, 'reason'>[]>`
      select r.id, r.account_id, a.name as account_name, r.market_code, r.owner_id, u.full_name as owner_name, r.rule_code, r.signal, r.created_at, r.expires_at
        from crm.recommendations r join crm.accounts a on a.id = r.account_id left join crm.users u on u.id = r.owner_id
       where r.status = 'open' and not r.holdout and r.expires_at > now()
         ${f.scope === 'mine' ? tx`and r.owner_id = ${ctx.user.id}` : tx``}
         ${f.account ? tx`and r.account_id = ${f.account}` : tx``}
       order by r.created_at desc, r.id limit ${f.limit ?? 100}`
    return rows.map(withReason)
  })
}

/** Resumen de la cuenta, de solo lectura, armado por reglas con datos de CONTIGO (IA-04, primer paso: antes de una visita). */
export type Brief = { days_quiet: number; open_deals: number; open_tasks: number; txn_now: number | null; txn_before: number | null; as_of: string | null; lifecycle: string }
export async function accountBrief(ctx: Ctx, accountId: string): Promise<Brief | null> {
  if (!ctx.can('ia.read')) return null
  return withUser(ctx.user.id, async (tx) => {
    const r = await tx<Brief[]>`
      select a.lifecycle,
             floor(extract(epoch from now() - coalesce(app.last_contact_at(a.id), a.created_at)) / 86400)::int as days_quiet,
             (select count(*)::int from crm.deals d where d.account_id = a.id and d.status = 'open') as open_deals,
             (select count(*)::int from crm.activities x where x.account_id = a.id and x.done_at is null and x.due_at is not null) as open_tasks,
             (select mm.txn_count_30d from crm.merchant_metrics_daily mm where mm.account_id = a.id order by mm.as_of desc limit 1) as txn_now,
             (select mm.txn_count_30d from crm.merchant_metrics_daily mm where mm.account_id = a.id
               and mm.as_of <= (select max(m2.as_of) from crm.merchant_metrics_daily m2 where m2.account_id = a.id) - 28 order by mm.as_of desc limit 1) as txn_before,
             (select max(mm.as_of)::text from crm.merchant_metrics_daily mm where mm.account_id = a.id) as as_of
        from crm.accounts a where a.id = ${accountId}`
    return r[0] ?? null
  })
}

/** Medición: cuántas se aceptaron, descartaron o vencieron, si se siguieron y qué pasó, contra el grupo de control. */
export type RecStats = {
  market_code: string; shown: number; accepted: number; dismissed: number; expired: number; open: number
  measured: number; followed: number; sale_up: number; contacted: number
  holdout_measured: number; holdout_sale_up: number; holdout_contacted: number
}
export const LIFT_MIN = 30
export async function recommendationStats(ctx: Ctx): Promise<RecStats[]> {
  if (!ctx.can('ia.oversee') && !ctx.can('ia.manage')) throw forbidden()
  return withUser(ctx.user.id, (tx) => tx<RecStats[]>`
    select r.market_code,
           count(*) filter (where not r.holdout)::int as shown,
           count(*) filter (where not r.holdout and r.status = 'accepted')::int as accepted,
           count(*) filter (where not r.holdout and r.status = 'dismissed')::int as dismissed,
           count(*) filter (where not r.holdout and r.status = 'expired')::int as expired,
           count(*) filter (where not r.holdout and r.status = 'open')::int as open,
           count(*) filter (where not r.holdout and r.measured_at is not null)::int as measured,
           count(*) filter (where not r.holdout and r.followed)::int as followed,
           count(*) filter (where not r.holdout and r.outcome = 'sale_up')::int as sale_up,
           count(*) filter (where not r.holdout and r.outcome = 'contacted')::int as contacted,
           count(*) filter (where r.holdout and r.measured_at is not null)::int as holdout_measured,
           count(*) filter (where r.holdout and r.outcome = 'sale_up')::int as holdout_sale_up,
           count(*) filter (where r.holdout and r.outcome = 'contacted')::int as holdout_contacted
      from crm.recommendations r group by r.market_code order by r.market_code`.then((x) => [...x]))
}

// ================================================================ IA-04: borradores
export type Draft = { id: string; market_code: string; account_id: string; account_name: string; owner_name: string | null; level: 'draft' | 'execute'; subject: string; due_on: string | null; created_at: Date; rule_code: NextRule | null; signal: Rec['signal'] | null; reason: Pair | null }
export async function pendingDrafts(ctx: Ctx, f: { scope: 'mine' | 'all' }): Promise<Draft[]> {
  if (!ctx.can('ia.read')) throw forbidden()
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Omit<Draft, 'reason'>[]>`
      select d.id, d.market_code, d.account_id, a.name as account_name, u.full_name as owner_name, d.level, d.subject, d.due_on::text, d.created_at, r.rule_code, r.signal
        from crm.ia_drafts d join crm.accounts a on a.id = d.account_id left join crm.users u on u.id = d.owner_id
        left join crm.recommendations r on r.id = d.recommendation_id
       where d.status = 'pending' ${f.scope === 'mine' ? tx`and d.owner_id = ${ctx.user.id}` : tx``}
       order by d.created_at, d.id limit 100`
    return rows.map((d) => ({ ...d, reason: d.rule_code ? nextReason({ rule: d.rule_code, ...(d.signal ?? {}) }) : null }))
  })
}

// ================================================================ IA-03: puntaje del lead
export type LeadScore = { score: number; parts: { factor: ScoreFactor; points: number }[]; proposed: LeadClass | null; why: Pair; confirmed: LeadClass | null; confirmed_by: string | null; confirmed_at: Date | null; hasMessage: boolean }
export async function leadScore(ctx: Ctx, leadId: string): Promise<LeadScore | null> {
  return withUser(ctx.user.id, async (tx) => {
    const r = (await tx<LeadFactRow[]>`select ${LEAD_FACTS_SQL(tx)} from crm.leads l where l.id = ${leadId}`)[0]
    if (!r) return null
    const facts = leadFacts(r)
    const s = scoreLead(facts, await leadWeights(tx, r.market_code))
    const c = classifyLead(facts)
    const conf = (await tx<{ confirmed: LeadClass; name: string | null; confirmed_at: Date }[]>`
      select lc.confirmed, u.full_name as name, lc.confirmed_at from crm.lead_classifications lc left join crm.users u on u.id = lc.confirmed_by where lc.lead_id = ${leadId}`)[0]
    return { ...s, proposed: c.cls, why: c.why, confirmed: conf?.confirmed ?? null, confirmed_by: conf?.name ?? null, confirmed_at: conf?.confirmed_at ?? null, hasMessage: !!r.message }
  })
}

/** Puntaje y clase propuesta de varios leads a la vez (lista de leads). */
export async function leadScores(ctx: Ctx, ids: string[]): Promise<Record<string, { score: number; proposed: LeadClass | null; confirmed: LeadClass | null }>> {
  if (ids.length === 0) return {}
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<(LeadFactRow & { confirmed: LeadClass | null })[]>`
      select ${LEAD_FACTS_SQL(tx)}, (select lc.confirmed from crm.lead_classifications lc where lc.lead_id = l.id) as confirmed from crm.leads l where l.id = any(${ids}::uuid[])`
    const w: Record<string, Partial<Record<ScoreFactor, number>>> = {}
    const out: Record<string, { score: number; proposed: LeadClass | null; confirmed: LeadClass | null }> = {}
    for (const r of rows) {
      w[r.market_code] ??= await leadWeights(tx, r.market_code)
      const f = leadFacts(r)
      out[r.id] = { score: scoreLead(f, w[r.market_code]).score, proposed: classifyLead(f).cls, confirmed: r.confirmed }
    }
    return out
  })
}

// ================================================================ IA-05: preguntas sobre las cifras definidas
export type Answer =
  | { kind: 'answer'; key: Askable; value: number; market: string | null; team: string | null; period: { key: PeriodKey; from: string; to: string } | null; asOf: Date; fileAsOf: string | null }
  | { kind: 'out_of_scope' }

const metricSql = (tx: Tx, key: Askable, p: MarketPeriods, market: string | null, team: string | null) => {
  const codes = market ? [market] : Object.keys(p.byMarket)
  const from = codes.map((c) => p.byMarket[c]?.from ?? p.first.from)
  const to = codes.map((c) => p.byMarket[c]?.to ?? p.first.to)
  const per = (row: string, col: string) => tx`exists (select 1 from unnest(${codes}::text[], ${from}::date[], ${to}::date[]) x(m, f, t) join crm.markets mk on mk.code = x.m
     where x.m = ${tx(row)}.market_code and (${tx(row)}.${tx(col)} at time zone mk.timezone)::date between x.f and x.t)`
  const mk = (row: string) => tx`${tx(row)}.market_code = any(${codes}::text[])`
  const tf = (row: string) => teamFilter(tx, row, team ?? undefined)
  switch (key) {
    case 'won': return tx`select count(*)::int as n from crm.deals d where d.status = 'won' and ${mk('d')} and ${per('d', 'won_at')} ${tf('d')}`
    case 'lost': return tx`select count(*)::int as n from crm.deals d where d.status = 'lost' and ${mk('d')} and ${per('d', 'lost_at')} ${tf('d')}`
    case 'leads': return tx`select count(*)::int as n from crm.leads l where ${mk('l')} and ${per('l', 'created_at')} ${tf('l')}`
    case 'qualified': return tx`select count(*)::int as n from crm.leads l where l.status in ('qualified','converted') and ${mk('l')} and ${per('l', 'created_at')} ${tf('l')}`
    case 'open': return tx`select count(*)::int as n from crm.deals d where d.status = 'open' and ${mk('d')} ${tf('d')}`
    case 'awaiting': return tx`select count(*)::int as n from crm.deals d join crm.stages s on s.id = d.stage_id where d.status = 'open' and s.kind = 'awaiting_txn' and ${mk('d')} ${tf('d')}`
    case 'revisits': return tx`select count(*)::int as n from crm.deals d where d.status = 'open' and d.revisit_needed and ${mk('d')} ${tf('d')}`
    case 'active': return tx`select count(*)::int as n from crm.accounts a where a.archived_at is null and a.lifecycle = 'active' and ${mk('a')} ${tf('a')}`
    case 'risk': return tx`select count(*)::int as n from crm.accounts a where a.archived_at is null and a.lifecycle = 'at_risk' and ${mk('a')} ${tf('a')}`
  }
}

/**
 * Responde SOLO con una cifra definida en lib/metric-defs.ts, con los permisos de la persona (la base filtra lo que no ve).
 * Si el texto no corresponde a una pregunta definida, contesta "fuera de lo definido": no se adivina ni se arma una consulta libre.
 */
export async function askMetric(ctx: Ctx, q: { text?: string; key?: string; period?: string; market?: string; team?: string }): Promise<Answer> {
  if (!ctx.can('ia.ask')) throw forbidden()
  const key: Askable | 'out_of_scope' = q.key && (ASKABLE as readonly string[]).includes(q.key) ? (q.key as Askable) : matchQuestion(q.text ?? '')
  const market = q.market && ctx.markets.some((m) => m.code === q.market) ? q.market : null
  const team = q.team && /^[0-9a-f-]{36}$|^none$/.test(q.team) ? q.team : null
  const periodKey: AskPeriod = (q.period as AskPeriod) || periodIn(q.text ?? '') || 'mes'
  return withUser(ctx.user.id, async (tx) => {
    await logCall(tx, { feature: 'metric_question', mode: aiAdapter().mode === 'off' ? 'off' : 'rules', input: { key, market, team, periodKey }, outcome: key === 'out_of_scope' ? 'refused' : 'answered' })
    if (key === 'out_of_scope') return { kind: 'out_of_scope' as const }
    const p = marketPeriods(ctx, periodKey)
    const n = (await metricSql(tx, key, p, market, team))[0] as { n: number } | undefined
    const periodic = PERIODIC.includes(key)
    const per = market ? p.byMarket[market] ?? p.first : p.first
    const file = (await tx<{ as_of: string | null }[]>`select max(as_of)::text as as_of from crm.merchant_metrics_daily ${market ? tx`where market_code = ${market}` : tx``}`)[0]
    return { kind: 'answer' as const, key, value: n?.n ?? 0, market, team, period: periodic ? { key: per.key, from: per.from, to: per.to } : null, asOf: new Date(), fileAsOf: key === 'active' || key === 'risk' ? file?.as_of ?? null : null }
  })
}

// ================================================================ Administración: IA y asistencia
export type IaSetting = { market_code: string; level: Level; supervisor_id: string | null; supervisor_name: string | null; last_spot_check_at: Date | null; spot_check_note: string | null; quiet_days: number }
export type EvalRow = { feature: AiFeature; cases: number; adversarial: number; threshold: number; prompt_version: string; rules: RunRow | null; adapter: RunRow | null; mayTurnOn: boolean }
type RunRow = { total: number; passed: number; meets_threshold: boolean; adapter_mode: string; ran_at: Date; ran_by_name: string | null; failures: { label: string; expected: string; got: string }[] }

export async function iaAdmin(ctx: Ctx) {
  if (!ctx.can('ia.oversee') && !ctx.can('ia.manage')) throw forbidden()
  return withUser(ctx.user.id, async (tx) => {
    const settings = await tx<IaSetting[]>`
      select m.code as market_code, coalesce(s.level, 'suggest') as level, s.supervisor_id, u.full_name as supervisor_name, s.last_spot_check_at, s.spot_check_note, coalesce(s.quiet_days, 9) as quiet_days
        from crm.markets m left join crm.ia_settings s on s.market_code = m.code left join crm.users u on u.id = s.supervisor_id
       where m.status = 'live' and m.code = any(app.my_markets()) order by m.code`
    const weights = await tx<{ market_code: string; factor: ScoreFactor; weight: number }[]>`select market_code, factor, weight from crm.lead_score_weights`
    const territories = await tx<{ id: string; market_code: string; name: string; holdout: boolean }[]>`
      select t.id, t.market_code, t.name, exists (select 1 from crm.ia_holdouts h where h.territory_id = t.id) as holdout from crm.territories t order by t.market_code, t.name`
    const cases = await tx<{ feature: AiFeature; n: number; adv: number }[]>`select feature, count(*)::int as n, count(*) filter (where adversarial)::int as adv from crm.ia_eval_cases where is_active group by feature`
    const runs = await tx<(RunRow & { feature: AiFeature; target: 'rules' | 'adapter'; prompt_version: string })[]>`
      select distinct on (r.feature, r.target) r.feature, r.target, r.prompt_version, r.total, r.passed, r.meets_threshold, r.adapter_mode, r.ran_at, u.full_name as ran_by_name, r.failures
        from crm.ia_eval_runs r left join crm.users u on u.id = r.ran_by order by r.feature, r.target, r.ran_at desc`
    const calls = await tx<{ feature: string; mode: string; outcome: string; n: number; cost: string }[]>`
      select feature, mode, outcome, count(*)::int as n, coalesce(sum(cost_usd), 0)::text as cost from crm.ia_calls where created_at > now() - interval '30 days' group by 1, 2, 3 order by 1, 2, 3`
    const drafts = await tx<{ market_code: string; pending: number; approved: number; rejected: number }[]>`
      select market_code, count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'approved')::int as approved,
             count(*) filter (where status = 'rejected')::int as rejected from crm.ia_drafts group by market_code`
    const ai = aiAdapter()
    const evals: EvalRow[] = AI_FEATURES.map((f) => {
      const c = cases.find((x) => x.feature === f)
      const r = runs.find((x) => x.feature === f && x.target === 'rules') ?? null
      const a = runs.find((x) => x.feature === f && x.target === 'adapter') ?? null
      return {
        feature: f, cases: c?.n ?? 0, adversarial: c?.adv ?? 0, threshold: THRESHOLD[f], prompt_version: PROMPT_VERSION[f], rules: r, adapter: a,
        mayTurnOn: ai.mode !== 'off' && !!a && a.meets_threshold && a.prompt_version === PROMPT_VERSION[f],
      }
    })
    const people = await tx<{ id: string; full_name: string }[]>`
      select distinct u.id, u.full_name from crm.users u join crm.memberships m on m.user_id = u.id
       where u.is_active and not u.is_system and m.role in ('admin','market_lead','supervisor') and (m.valid_to is null or m.valid_to > now()) order by u.full_name`
    return { settings: [...settings], weights: [...weights], territories: [...territories], evals, calls: [...calls], drafts: [...drafts], agents: AGENTS, adapter: { mode: ai.mode, egress: ai.egress }, people: [...people] }
  })
}
