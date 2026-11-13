import 'server-only'
import type postgres from 'postgres'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { ROLLOUT_STEPS } from '@/domain/rollout'
import { winRuleOf, type WinRule } from '@/domain/mx-config'

/** Lo que administración configura de México en Formularios y turnos, Territorios y Embudos (paquete mx). */
export async function getCampaignConfig(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const forms = await tx<{ id: string; slug: string; name: string; market_code: string; motor: string; funnel: string | null; channel_id: string | null; is_campaign: boolean; offer_types: string[] }[]>`
      select id, slug, name, market_code, motor, funnel, channel_id, is_campaign, offer_types from crm.web_forms where is_active order by market_code, name`
    const types = await tx<{ code: string; label_es: string; label_en: string; market_code: string | null }[]>`
      select code, label_es, label_en, market_code from crm.account_types where is_active order by position, code`
    const rules = await tx<{ id: string; name: string; market_code: string; sla_minutes: number; sla_business_days: number | null; day_minutes: number }[]>`
      select r.id, r.name, r.market_code, r.sla_minutes, r.sla_business_days, app.business_day_minutes(r.market_code) as day_minutes
        from crm.routing_rules r where r.is_active order by r.market_code, r.name`
    return { forms: [...forms], types: [...types], rules: [...rules] }
  })
}

export async function getTerritoryManagers(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; market_code: string; name: string; manager_id: string | null; manager_name: string | null; manager_active: boolean; stores: number; unowned: number }[]>`
      select t.id, t.market_code, t.name, t.manager_id, u.full_name as manager_name,
             (t.manager_id is not null and app.can_sell_in(t.manager_id, t.market_code)) as manager_active,
             (select count(*)::int from crm.accounts a where a.territory_id = t.id and a.kind = 'store' and a.segment = 'd2d' and a.archived_at is null) as stores,
             (select count(*)::int from crm.accounts a where a.territory_id = t.id and a.kind = 'store' and a.segment = 'd2d' and a.archived_at is null and a.owner_id is null) as unowned
        from crm.territories t left join crm.users u on u.id = t.manager_id
       where t.archived_at is null order by t.market_code, t.name`
    return [...rows]
  })
}

export async function getWinRules(ctx: Ctx): Promise<{ id: string; market_code: string; name: string; motor: string; rule: WinRule; open_deals: number; has_contract_field: boolean }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; market_code: string; name: string; motor: string; close_by_transaction: boolean; txn_also_wins: boolean; open_deals: number; has_contract_field: boolean }[]>`
      select p.id, p.market_code, p.name, p.motor, p.close_by_transaction, p.txn_also_wins,
             (select count(*)::int from crm.deals d where d.pipeline_id = p.id and d.status = 'open') as open_deals,
             exists (select 1 from crm.field_definitions f where f.object = 'deal' and f.key = 'b2b_contract_signed_on' and f.is_active
                      and (f.market_code is null or f.market_code = p.market_code) and (f.motor is null or f.motor = p.motor)) as has_contract_field
        from crm.pipelines p where p.is_active and exists (select 1 from crm.stages s where s.pipeline_id = p.id) order by p.market_code, p.position`
    return rows.map((r) => ({ id: r.id, market_code: r.market_code, name: r.name, motor: r.motor, rule: winRuleOf(r), open_deals: r.open_deals, has_contract_field: r.has_contract_field }))
  })
}

// ---------------------------------------------------------------- reporte del mercado (E18.F10, E15.F5)

export const REPORT_MONTHS = [3, 6, 12] as const
export type MonthRow = { month: string; leads: number; converted: number; deals_created: number; won: number; lost: number }
export type StageRow = { pipeline: string; motor: string; stage_es: string; stage_en: string; kind: string; position: number; deals: number; amount: string | null; currency: string }
export type TypeRow = { funnel: string | null; account_type: string | null; type_es: string | null; type_en: string | null; bucket: string; leads: number; converted: number; stores: string | null }
export type MarketReport = {
  market: string
  months: number
  from: string
  monthly: MonthRow[]
  stages: StageRow[]
  types: TypeRow[]
  sources: { source: string; funnel: string | null; channel_id: string | null; leads: number; converted: number }[]
  dead: { total: number; with_email: number; with_consent: number }
}

/** Tramos de número de tiendas para el reporte. "none" es sin dato. */
export const STORE_BUCKETS = ['1', '2-5', '6-20', '21-50', '51+', 'none'] as const
const bucketSql = (tx: Tx) => tx`case when app.store_count(l.custom) is null then 'none' when app.store_count(l.custom) <= 1 then '1' when app.store_count(l.custom) <= 5 then '2-5'
                                      when app.store_count(l.custom) <= 20 then '6-20' when app.store_count(l.custom) <= 50 then '21-50' else '51+' end`

/**
 * Reporte de un mercado: leads capturados y convertidos, negocios por etapa y conteos por mes (E18.F10), y leads por tipo de
 * empresa y número de tiendas (E15.F5). Los meses son meses de calendario en la zona horaria del mercado. Cada persona ve
 * lo de su alcance (la base decide las filas): supervisión, lo de su equipo.
 */
export async function getMarketReport(ctx: Ctx, market: string, months: number): Promise<MarketReport> {
  const mk = ctx.market(market)
  const span = (REPORT_MONTHS as readonly number[]).includes(months) ? months : 6
  return withUser(ctx.user.id, async (tx) => {
    const tz = mk.timezone
    const first = tx`(date_trunc('month', now() at time zone ${tz}) - make_interval(months => ${span - 1}))`
    const monthOf = (col: postgres.Fragment) => tx`to_char(date_trunc('month', ${col} at time zone ${tz}), 'YYYY-MM')`
    const monthly = await tx<MonthRow[]>`
      with m as (select to_char(g, 'YYYY-MM') as month from generate_series(${first}, date_trunc('month', now() at time zone ${tz}), interval '1 month') g),
      le as (select ${monthOf(tx`l.created_at`)} as month, count(*)::int as n from crm.leads l
              where l.market_code = ${market} and l.created_at at time zone ${tz} >= ${first} group by 1),
      cv as (select ${monthOf(tx`c.at`)} as month, count(*)::int as n
               from (select min(d.created_at) as at from crm.deals d where d.market_code = ${market} and d.lead_id is not null group by d.lead_id) c
              where c.at at time zone ${tz} >= ${first} group by 1),
      dc as (select ${monthOf(tx`d.created_at`)} as month, count(*)::int as n from crm.deals d
              where d.market_code = ${market} and d.created_at at time zone ${tz} >= ${first} group by 1),
      wn as (select ${monthOf(tx`d.won_at`)} as month, count(*)::int as n from crm.deals d
              where d.market_code = ${market} and d.status = 'won' and d.won_at at time zone ${tz} >= ${first} group by 1),
      ls as (select ${monthOf(tx`d.lost_at`)} as month, count(*)::int as n from crm.deals d
              where d.market_code = ${market} and d.status = 'lost' and d.lost_at at time zone ${tz} >= ${first} group by 1)
      select m.month, coalesce(le.n, 0) as leads, coalesce(cv.n, 0) as converted, coalesce(dc.n, 0) as deals_created, coalesce(wn.n, 0) as won, coalesce(ls.n, 0) as lost
        from m left join le using (month) left join cv using (month) left join dc using (month) left join wn using (month) left join ls using (month)
       order by m.month`
    const stages = await tx<StageRow[]>`
      select p.name as pipeline, p.motor, s.name_es as stage_es, s.name_en as stage_en, s.kind, s.position,
             count(d.id)::int as deals, sum(d.amount_minor)::text as amount, ${mk.currency} as currency
        from crm.pipelines p join crm.stages s on s.pipeline_id = p.id and s.archived_at is null and s.kind in ('open', 'awaiting_txn')
        left join crm.deals d on d.stage_id = s.id and d.status = 'open'
       where p.market_code = ${market} and p.is_active
       group by p.id, p.name, p.motor, p.position, s.id, s.name_es, s.name_en, s.kind, s.position
       order by p.position, s.position`
    const types = await tx<TypeRow[]>`
      select l.funnel, l.account_type,
             (select t.label_es from crm.account_types t where t.code = l.account_type and (t.market_code is null or t.market_code = ${market}) order by t.market_code nulls last limit 1) as type_es,
             (select t.label_en from crm.account_types t where t.code = l.account_type and (t.market_code is null or t.market_code = ${market}) order by t.market_code nulls last limit 1) as type_en,
             ${bucketSql(tx)} as bucket, count(*)::int as leads, count(*) filter (where l.status = 'converted')::int as converted,
             sum(app.store_count(l.custom))::text as stores
        from crm.leads l
       where l.market_code = ${market} and l.created_at at time zone ${tz} >= ${first}
       group by 1, 2, 5 order by l.funnel nulls last, l.account_type nulls last, min(coalesce(app.store_count(l.custom), 1e12))`
    const sources = await tx<{ source: string; funnel: string | null; channel_id: string | null; leads: number; converted: number }[]>`
      select l.source, l.funnel, l.channel_id, count(*)::int as leads, count(*) filter (where l.status = 'converted')::int as converted
        from crm.leads l where l.market_code = ${market} and l.created_at at time zone ${tz} >= ${first}
       group by 1, 2, 3 order by count(*) desc, l.source`
    const dead = await tx<{ total: number; with_email: number; with_consent: number }[]>`
      select count(*)::int as total, count(*) filter (where l.email is not null)::int as with_email,
             count(*) filter (where l.email is not null and l.consent_at is not null)::int as with_consent
        from crm.leads l where l.market_code = ${market} and l.status = 'disqualified'`
    const from = await tx<{ d: string }[]>`select to_char(${first}, 'YYYY-MM-DD') as d`
    return { market, months: span, from: from[0]!.d, monthly: [...monthly], stages: [...stages], types: [...types], sources: [...sources], dead: dead[0] ?? { total: 0, with_email: 0, with_consent: 0 } }
  })
}

export type DeadLead = { business_name: string; contact_name: string; email: string; locality: string | null; reason_es: string | null; reason_en: string | null; source: string; funnel: string | null; consent_on: string; created_on: string }

/**
 * Los leads descartados como base de correo (E18.F9): viven aparte de los embudos, conservan identidad y motivo, y solo
 * entran los que dieron su consentimiento para recibir correos y dejaron uno.
 */
export async function deadLeadsForMailing(tx: Tx, market: string, tz: string, limit: number): Promise<DeadLead[]> {
  const rows = await tx<DeadLead[]>`
    select l.business_name, l.contact_name, l.email::text as email, l.locality, r.label_es as reason_es, r.label_en as reason_en, l.source, l.funnel,
           to_char(l.consent_at at time zone ${tz}, 'YYYY-MM-DD') as consent_on, to_char(l.created_at at time zone ${tz}, 'YYYY-MM-DD') as created_on
      from crm.leads l left join crm.loss_reasons r on r.code = l.disqualify_code
     where l.market_code = ${market} and l.status = 'disqualified' and l.email is not null and l.consent_at is not null
     order by l.created_at desc, l.id limit ${limit}`
  return [...rows]
}

// ---------------------------------------------------------------- arranque del mercado (E18.F2, F5, F6)

export type RolloutPerson = { user_id: string; full_name: string; role: string; team: string | null; since: Date; last_login: Date | null; is_key: boolean }

export async function getRollout(ctx: Ctx, market: string) {
  ctx.market(market)
  return withUser(ctx.user.id, async (tx) => {
    const state = await tx<{ leaders_first: boolean; team_opened_at: Date | null }[]>`select leaders_first, team_opened_at from crm.market_rollout where market_code = ${market}`
    const rows = await tx<{ step: string; done_at: Date | null; done_by: string | null; note: string | null; link: string | null }[]>`
      select s.step, s.done_at, u.full_name as done_by, s.note, s.link from crm.rollout_steps s left join crm.users u on u.id = s.done_by where s.market_code = ${market}`
    const key = await tx<{ email: string }[]>`select email::text as email from crm.rollout_key_people where market_code = ${market} order by email`
    // Quién ya tiene acceso al mercado, con su rol de mayor alcance, y cuándo entró por última vez.
    const people = await tx<RolloutPerson[]>`select user_id, full_name, role, team, since, last_login, is_key from app.rollout_people(${market})`
    const steps = ROLLOUT_STEPS.map((s) => ({ ...s, ...(rows.find((r) => r.step === s.code) ?? { done_at: null, done_by: null, note: null, link: null }) }))
    return {
      leadersFirst: state[0]?.leaders_first ?? false,
      teamOpenedAt: state[0]?.team_opened_at ?? null,
      steps,
      keyPeople: key.map((k) => k.email),
      people: [...people].sort((a, b) => a.full_name.localeCompare(b.full_name)),
    }
  })
}

export async function getSheetLoads(ctx: Ctx, market: string) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; kind: string; label: string | null; rows_total: number; rows_loaded: number; rows_known: number; rows_failed: number; problems: { row: number; es: string; en: string }[]; created_at: Date; by: string | null }[]>`
      select l.id, l.kind, l.label, l.rows_total, l.rows_loaded, l.rows_known, l.rows_failed, l.problems, l.created_at, u.full_name as by
        from crm.sheet_loads l left join crm.users u on u.id = l.created_by
       where l.market_code = ${market} order by l.created_at desc limit 20`
    return [...rows]
  })
}
