import 'server-only'
import type postgres from 'postgres'
import { withUser, marketToday, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { Role } from '@/domain/policy'
import { isUuid } from '@/lib/ids'
import { ownerFilter, teamFilter, type FxRate, type MarketPeriods, type ReportScope } from '@/dal/reports'

type Frag = postgres.Fragment

/**
 * Reportes del paquete `reportes` (E8, REP-01 a REP-04, CANAL-05, CAMPO-05, GOB-03). Cada lectura corre con la identidad
 * de quien mira (RLS decide la fila) y repite el alcance de forma explícita. Las definiciones de las cifras viven en
 * `src/lib/metric-defs.ts`: aquí solo se cuenta lo que la definición dice.
 */

// ------------------------------------------------------------------ alcance
/**
 * Alcance de la página Reportes: todos los roles entran, cada quien con lo suyo. Mercado completo para administración,
 * leadership, quien lidera y Operaciones; equipo para supervisión; lo propio para quien vende (app.supervised_user_ids()
 * devuelve a la persona y a quienes supervisa).
 */
export function wideScope(ctx: Ctx): ReportScope {
  const live = ctx.markets.filter((m) => m.status === 'live').map((m) => m.code)
  const has = (code: string, roles: Role[]) => ctx.memberships.some((m) => roles.includes(m.role) && (m.market === null || m.market === code))
  // reportes2: Finanzas lee su mercado completo; KAM, como quien vende, lo suyo.
  const full = live.filter((c) => has(c, ['admin', 'lt', 'market_lead', 'ops', 'finance']))
  const team = live.filter((c) => !full.includes(c) && has(c, ['supervisor', 'rep', 'kam']))
  return { full, team }
}
const all = (s: ReportScope) => [...s.full, ...s.team]
const inScope = (tx: Tx, s: ReportScope, row: string): Frag =>
  tx`(${tx(row)}.market_code = any(${s.full}::text[])
      or (${tx(row)}.market_code = any(${s.team}::text[]) and ${tx(row)}.owner_id = any((select app.supervised_user_ids())::uuid[])))`
const periodRows = (tx: Tx, p: MarketPeriods): Frag => {
  const codes = Object.keys(p.byMarket)
  return tx`(select * from unnest(${codes}::text[], ${codes.map((c) => p.byMarket[c]!.from)}::date[], ${codes.map((c) => p.byMarket[c]!.to)}::date[]) as x(market, dfrom, dto))`
}
const mkFilter = (tx: Tx, row: string, market?: string): Frag => (market ? tx`and ${tx(row)}.market_code = ${market}` : tx``)
const ownerTeam = (tx: Tx, row: string): Frag =>
  tx`(select t.id, t.name from crm.memberships mm join crm.teams t on t.id = mm.team_id
       where mm.user_id = ${tx(row)}.owner_id and mm.market_code = ${tx(row)}.market_code and mm.valid_from <= now() and (mm.valid_to is null or mm.valid_to > now())
       order by mm.valid_from desc limit 1)`

export type Filters = { market?: string; pipeline?: string; team?: string; owner?: string; source?: string }

// ------------------------------------------------------------------ dueños de indicadores
export async function metricOwners(ctx: Ctx): Promise<Record<string, string>> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ metric_key: string; owner_label: string }[]>`select metric_key, owner_label from crm.metric_owners`
    return Object.fromEntries(rows.map((r) => [r.metric_key, r.owner_label]))
  })
}

// ------------------------------------------------------------------ E8.F1 leads captados y convertidos
export type LeadsRow = { month: string; market_code: string; source: string; leads: number; converted: number }
export async function getLeadsReport(ctx: Ctx, p: MarketPeriods, f: Filters): Promise<LeadsRow[]> {
  const scope = wideScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<LeadsRow[]>`
      select to_char(date_trunc('month', (l.created_at at time zone mk.timezone)), 'YYYY-MM') as month, l.market_code, l.source,
             count(*)::int as leads,
             count(*) filter (where l.status = 'converted' or exists (select 1 from crm.deals d where d.lead_id = l.id))::int as converted
        from crm.leads l join crm.markets mk on mk.code = l.market_code join ${periodRows(tx, p)} pr on pr.market = l.market_code
       where ${inScope(tx, scope, 'l')} and (l.created_at at time zone mk.timezone)::date between pr.dfrom and pr.dto
         ${mkFilter(tx, 'l', f.market)} ${f.source ? tx`and l.source = ${f.source}` : tx``} ${ownerFilter(tx, 'l', f.owner)} ${teamFilter(tx, 'l', f.team)}
       group by 1, 2, 3 order by 1 desc, 2, 3`
    return [...rows]
  })
}

// ------------------------------------------------------------------ E8.F2 negocios por etapa
export type StageRow = {
  pipeline_id: string; pipeline_name: string; market_code: string; motor: string; stage_id: string; position: number; name_es: string; name_en: string; rot_days: number
  deals: number; no_step: number; long: number; median_days: number | null; max_days: number | null; amount: string; currency: string
}
export async function getStagesReport(ctx: Ctx, f: Filters): Promise<StageRow[]> {
  const scope = wideScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<StageRow[]>`
      select p.id as pipeline_id, p.name as pipeline_name, p.market_code, p.motor, s.id as stage_id, s.position, s.name_es, s.name_en, s.rot_days,
             count(d.id)::int as deals,
             count(d.id) filter (where d.next_step is null or d.next_step_due is null)::int as no_step,
             count(d.id) filter (where now() - d.stage_entered_at > make_interval(days => s.rot_days))::int as long,
             round((percentile_cont(0.5) within group (order by extract(epoch from (now() - d.stage_entered_at)) / 86400) filter (where d.id is not null))::numeric)::int as median_days,
             floor(max(extract(epoch from (now() - d.stage_entered_at)) / 86400))::int as max_days,
             coalesce(sum(d.amount_minor), 0)::text as amount, trim(mk.currency) as currency
        from crm.pipelines p
        join crm.stages s on s.pipeline_id = p.id and s.kind in ('open', 'awaiting_txn')
        join crm.markets mk on mk.code = p.market_code
        left join crm.deals d on d.stage_id = s.id and d.status = 'open' and ${inScope(tx, scope, 'd')} ${ownerFilter(tx, 'd', f.owner)} ${teamFilter(tx, 'd', f.team)}
       where p.market_code = any(${all(scope)}::text[]) and (p.is_active or exists (select 1 from crm.deals x where x.pipeline_id = p.id and x.status = 'open'))
         ${mkFilter(tx, 'p', f.market)} ${isUuid(f.pipeline) ? tx`and p.id = ${f.pipeline}` : tx``}
       group by p.id, p.name, p.market_code, p.motor, p.position, s.id, s.position, s.name_es, s.name_en, s.rot_days, mk.currency
       order by p.market_code, p.position, s.position`
    return [...rows]
  })
}

// ------------------------------------------------------------------ E8.F3 agencia contra equipo interno
export type AgencyRow = { grp: 'agency' | 'inhouse'; label: string | null; market_code: string; deals: number; won: number; lost: number; open: number }
/** Etiquetas de origen que administración había marcado como agencia (modelo anterior). Ya no deciden el reporte; se muestran para migrarlas. */
export async function agencyLabels(ctx: Ctx): Promise<string[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ value: unknown }[]>`select value from crm.settings where key = 'reports.agency_labels'`
    const v = rows[0]?.value
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  })
}
/**
 * Un solo modelo de agencia (crm.agencies). Un negocio es de agencia si quien lo reclutó es una agencia o un aliado:
 * primero lo que dice el propio negocio ("Reclutado por" o la agencia confinada), luego lo que dice su comercio y, si
 * ninguno lo dice, la capa de canal vigente (el equipo reclutador de CANAL-03). Todo lo demás es equipo propio.
 */
export async function getAgencyReport(ctx: Ctx, p: MarketPeriods, f: Filters): Promise<AgencyRow[]> {
  const scope = wideScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<AgencyRow[]>`
      with chan as (
        select t.account_id, t.party_ref from crm.account_attributions t
         where t.layer = 'channel' and t.effective_to is null and t.party_kind = 'partner'),
      x as (
        select d.*, coalesce(d.recruited_agency_id, a.recruited_agency_id,
                             (select g.id from crm.agencies g join chan c on c.party_ref = g.id::text where c.account_id = d.account_id limit 1)) as agency_id
          from crm.deals d left join crm.accounts a on a.id = d.account_id)
      select case when x.agency_id is not null then 'agency' else 'inhouse' end as grp, g.name as label,
             x.market_code, count(*)::int as deals, count(*) filter (where x.status = 'won')::int as won,
             count(*) filter (where x.status = 'lost')::int as lost, count(*) filter (where x.status = 'open')::int as open
        from x join crm.markets mk on mk.code = x.market_code join ${periodRows(tx, p)} pr on pr.market = x.market_code
        left join crm.agencies g on g.id = x.agency_id
       where ${inScope(tx, scope, 'x')} and (x.created_at at time zone mk.timezone)::date between pr.dfrom and pr.dto
         ${mkFilter(tx, 'x', f.market)} ${isUuid(f.pipeline) ? tx`and x.pipeline_id = ${f.pipeline}` : tx``}
       group by 1, 2, 3 order by 1, 3, 4 desc`
    return [...rows]
  })
}

// ------------------------------------------------------------------ E8.F5 Finanzas
export type FinanceRow = { month: string; market_code: string; currency: string; entity: string | null; n: number; with_amount: number; amount: string; amount_usd: string; unconverted: number }
export async function getFinanceReport(ctx: Ctx, p: MarketPeriods, f: Filters) {
  const scope = wideScope(ctx)
  // MULTI-01, una sola regla para sumar en USD: cada negocio ganado usa la tasa del día en que se ganó, que quedó guardada
  // en él (crm.deals.fx_rate, fx_rate_date, fx_source, amount_usd_minor). No se usa la tasa "de hoy": el total de un mes
  // cerrado no cambia cuando se carga una tasa nueva, y da lo mismo que el Consolidado en USD.
  let rates: FxRate[] = []
  const rows = await withUser(ctx.user.id, async (tx) => {
    const r = await tx<FinanceRow[]>`
      select to_char(date_trunc('month', (d.won_at at time zone mk.timezone)), 'YYYY-MM') as month, d.market_code, trim(d.currency) as currency, le.name as entity,
             count(*)::int as n, count(d.amount_minor)::int as with_amount, coalesce(sum(d.amount_minor), 0)::text as amount,
             coalesce(sum(d.amount_usd_minor), 0)::text as amount_usd,
             count(*) filter (where d.amount_minor is not null and d.amount_usd_minor is null)::int as unconverted
        from crm.deals d join crm.accounts a on a.id = d.account_id join crm.markets mk on mk.code = d.market_code
        join ${periodRows(tx, p)} pr on pr.market = d.market_code
        left join crm.legal_entities le on le.id = a.legal_entity_id
       where d.status = 'won' and d.market_code = any(${scope.full}::text[]) and (d.won_at at time zone mk.timezone)::date between pr.dfrom and pr.dto
         ${mkFilter(tx, 'd', f.market)} ${isUuid(f.pipeline) ? tx`and d.pipeline_id = ${f.pipeline}` : tx``}
       group by 1, 2, 3, 4 order by 1 desc, 2, 3, 4 nulls last`
    // Las tasas que quedaron guardadas en esos negocios, de la más reciente a la más antigua (para decir cuáles se usaron).
    rates = [...(await tx<FxRate[]>`
      select distinct trim(d.currency) as currency, d.fx_rate_date::text as as_of, d.fx_rate::text as usd_rate, d.fx_source as source, null::text as loaded_by, max(d.fx_frozen_at) as loaded_at
        from crm.deals d join crm.markets mk on mk.code = d.market_code
        join ${periodRows(tx, p)} pr on pr.market = d.market_code
       where d.status = 'won' and trim(d.currency) <> 'USD' and d.fx_rate is not null and d.amount_minor is not null
         and d.market_code = any(${scope.full}::text[]) and (d.won_at at time zone mk.timezone)::date between pr.dfrom and pr.dto
         ${mkFilter(tx, 'd', f.market)} ${isUuid(f.pipeline) ? tx`and d.pipeline_id = ${f.pipeline}` : tx``}
       group by 1, 2, 3, 4 order by 1, 2 desc`)]
    return [...r]
  })
  const byCurrency = new Map<string, { n: number; withAmount: number; amount: number; usd: number; unconverted: number }>()
  for (const r of rows) {
    const c = byCurrency.get(r.currency) ?? { n: 0, withAmount: 0, amount: 0, usd: 0, unconverted: 0 }
    c.n += r.n; c.withAmount += r.with_amount; c.amount += Number(r.amount); c.usd += Number(r.amount_usd); c.unconverted += r.unconverted
    byCurrency.set(r.currency, c)
  }
  const totals = [...byCurrency].map(([currency, v]) => ({ currency, ...v }))
  // Consolidado: solo si cada negocio con monto quedó convertido. La tasa nunca se inventa ni se toma prestada de otro día.
  const missing = totals.filter((x) => x.unconverted > 0).map((x) => x.currency)
  const usd = missing.length ? null : totals.reduce((sum, x) => sum + x.usd, 0)
  return { rows, totals, rates, usd, missing }
}

// ------------------------------------------------------------------ REP-01 por nodo del árbol y cuentas clave
export type NodeRow = {
  id: string; name: string; kind: string; market_code: string; owner_name: string | null; depth: number
  stores: number; active: number; at_risk: number; inactive: number; open_deals: number; won: number; volume: string; currency: string
}
/** Cada cadena, ISO o distribuidor con el agregado de todo lo que cuelga de él. `mine`: solo las cuentas que lleva la persona (o su equipo). */
export async function getNodeReport(ctx: Ctx, p: MarketPeriods, f: Filters & { mine?: boolean; level?: string }): Promise<NodeRow[]> {
  const scope = wideScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<NodeRow[]>`
      select n.id, n.name, n.kind, n.market_code, u.full_name as owner_name, coalesce(array_length(n.ancestor_ids, 1), 0) as depth,
             x.stores, x.active, x.at_risk, x.inactive,
             (select count(*)::int from crm.deals d where d.account_id = any(x.ids) and d.status = 'open') as open_deals,
             (select count(*)::int from crm.deals d where d.account_id = any(x.ids) and d.status = 'won' and (d.won_at at time zone mk.timezone)::date between pr.dfrom and pr.dto) as won,
             coalesce((select sum(v.volume_minor_30d) from (select distinct on (mm.account_id) mm.volume_minor_30d from crm.merchant_metrics_daily mm
                        where mm.account_id = any(x.ids) order by mm.account_id, mm.as_of desc) v), 0)::text as volume,
             trim(mk.currency) as currency
        from crm.accounts n join crm.markets mk on mk.code = n.market_code join ${periodRows(tx, p)} pr on pr.market = n.market_code
        left join crm.users u on u.id = n.owner_id
        left join lateral (
          select count(*) filter (where c.kind = 'store')::int as stores, count(*) filter (where c.kind = 'store' and c.lifecycle = 'active')::int as active,
                 count(*) filter (where c.kind = 'store' and c.lifecycle = 'at_risk')::int as at_risk, count(*) filter (where c.kind = 'store' and c.lifecycle = 'inactive')::int as inactive,
                 array_agg(c.id) as ids
            from crm.accounts c where (c.id = n.id or c.ancestor_ids @> array[n.id]) and c.archived_at is null) x on true
       where n.kind <> 'store' and n.archived_at is null and n.market_code = any(${all(scope)}::text[])
         ${f.level === 'todos' ? tx`` : tx`and n.parent_id is null`}
         ${f.mine ? tx`and n.owner_id = any((select app.supervised_user_ids())::uuid[])` : tx``}
         ${mkFilter(tx, 'n', f.market)}
       order by x.stores desc, n.name limit 200`
    return [...rows]
  })
}
export type KamDeal = { id: string; title: string; account_id: string; account_name: string; market_code: string; stage_es: string; stage_en: string; days: number; rot_days: number; next_step: string | null; next_step_due: string | null; owner_name: string | null; owner_locale: string | null }
/** Tablero de cuentas clave: negocios de cadenas y distribuidores que llevan demasiado en su etapa, y los próximos hitos (próximos pasos con fecha). */
export async function getKamBoard(ctx: Ctx, f: Filters & { mine?: boolean }) {
  const scope = wideScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<(KamDeal & { is_long: boolean; soon: boolean })[]>`
      select d.id, d.title, a.id as account_id, a.name as account_name, d.market_code, s.name_es as stage_es, s.name_en as stage_en,
             floor(extract(epoch from (now() - d.stage_entered_at)) / 86400)::int as days, s.rot_days, d.next_step, d.next_step_due::text, u.full_name as owner_name, u.locale as owner_locale,
             now() - d.stage_entered_at > make_interval(days => s.rot_days) as is_long,
             d.next_step_due is not null and d.next_step_due between ${marketToday(tx, tx`d.market_code`)} and ${marketToday(tx, tx`d.market_code`)} + 30 as soon
        from crm.deals d join crm.stages s on s.id = d.stage_id join crm.pipelines p on p.id = d.pipeline_id join crm.accounts a on a.id = d.account_id
        left join crm.users u on u.id = d.owner_id
       where d.status = 'open' and p.motor = 'b2b' and ${inScope(tx, scope, 'd')}
         ${f.mine ? tx`and d.owner_id = any((select app.supervised_user_ids())::uuid[])` : tx``} ${mkFilter(tx, 'd', f.market)}
       order by d.next_step_due nulls last, d.stage_entered_at limit 400`
    return {
      long: rows.filter((r) => r.is_long).sort((a, b) => b.days - a.days).slice(0, 50),
      milestones: rows.filter((r) => r.soon).slice(0, 50),
      open: rows.length,
    }
  })
}

// ------------------------------------------------------------------ REP-02 histórico: foto diaria, cohortes, velocidad
export type SnapshotPoint = { day: string; market_code: string; deals: number; no_step: number }
export type PortfolioPoint = { day: string; market_code: string; lifecycle: string; accounts: number }
export type CohortLead = { month: string; market_code: string; leads: number; c30: number; c60: number; c90: number; age_days: number }
export type CohortStore = { month: string; market_code: string; stores: number; first_sale: number }
export type VelocityRow = { pipeline_id: string; pipeline_name: string; market_code: string; stage_id: string; position: number; name_es: string; name_en: string; n: number; p50: number; p90: number }
export type OutboxRow = { id: string; channel: string; ref: string; title: string; row_count: number; status: string; created_at: Date }

export async function getHistory(ctx: Ctx, f: Filters) {
  const scope = wideScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const pipeline = await tx<SnapshotPoint[]>`
      select s.snapshot_date::text as day, s.market_code, sum(s.deals)::int as deals, sum(s.no_next_step)::int as no_step
        from crm.pipeline_snapshots s where s.snapshot_date >= (now() - interval '45 days')::date ${mkFilter(tx, 's', f.market)}
       group by 1, 2 order by 1, 2`
    const portfolio = await tx<PortfolioPoint[]>`
      select s.snapshot_date::text as day, s.market_code, s.lifecycle, s.accounts
        from crm.portfolio_snapshots s where s.snapshot_date >= (now() - interval '45 days')::date ${mkFilter(tx, 's', f.market)} order by 1, 2, 3`
    const leads = await tx<CohortLead[]>`
      select to_char(date_trunc('month', (l.created_at at time zone mk.timezone)), 'YYYY-MM') as month, l.market_code, count(*)::int as leads,
             count(*) filter (where dd.at <= l.created_at + interval '30 days')::int as c30,
             count(*) filter (where dd.at <= l.created_at + interval '60 days')::int as c60,
             count(*) filter (where dd.at <= l.created_at + interval '90 days')::int as c90,
             floor(extract(epoch from (now() - max(l.created_at))) / 86400)::int as age_days
        from crm.leads l join crm.markets mk on mk.code = l.market_code
        left join lateral (select min(d.created_at) as at from crm.deals d where d.lead_id = l.id) dd on true
       where l.created_at >= date_trunc('month', now()) - interval '5 months' and ${inScope(tx, scope, 'l')} ${mkFilter(tx, 'l', f.market)}
       group by 1, 2 order by 1 desc, 2`
    const stores = await tx<CohortStore[]>`
      select to_char(date_trunc('month', (a.created_at at time zone mk.timezone)), 'YYYY-MM') as month, a.market_code, count(*)::int as stores,
             count(*) filter (where exists (select 1 from crm.merchant_metrics_daily mm where mm.account_id = a.id and mm.first_txn_at is not null))::int as first_sale
        from crm.accounts a join crm.markets mk on mk.code = a.market_code
       where a.kind = 'store' and a.archived_at is null and a.created_at >= date_trunc('month', now()) - interval '5 months' and ${inScope(tx, scope, 'a')} ${mkFilter(tx, 'a', f.market)}
       group by 1, 2 order by 1 desc, 2`
    const velocity = await tx<VelocityRow[]>`
      with ev as (
        select e.deal_id, e.to_stage_id as stage_id, e.at, lead(e.at) over (partition by e.deal_id order by e.at, e.id) as next_at
          from crm.deal_stage_events e join crm.deals d on d.id = e.deal_id where ${inScope(tx, scope, 'd')} ${mkFilter(tx, 'd', f.market)})
      select p.id as pipeline_id, p.name as pipeline_name, p.market_code, s.id as stage_id, s.position, s.name_es, s.name_en, count(*)::int as n,
             round((percentile_cont(0.5) within group (order by extract(epoch from (ev.next_at - ev.at)) / 86400))::numeric, 1)::float as p50,
             round((percentile_cont(0.9) within group (order by extract(epoch from (ev.next_at - ev.at)) / 86400))::numeric, 1)::float as p90
        from ev join crm.stages s on s.id = ev.stage_id and s.kind in ('open', 'awaiting_txn') join crm.pipelines p on p.id = s.pipeline_id
       where ev.next_at is not null and ev.next_at >= now() - interval '180 days' ${isUuid(f.pipeline) ? tx`and p.id = ${f.pipeline}` : tx``}
       group by p.id, p.name, p.market_code, p.position, s.id, s.position, s.name_es, s.name_en order by p.market_code, p.position, s.position`
    const outbox = await tx<OutboxRow[]>`select id, channel, ref, title, row_count, status, created_at from crm.report_outbox order by created_at desc limit 20`
    return { pipeline: [...pipeline], portfolio: [...portfolio], leads: [...leads], stores: [...stores], velocity: [...velocity], outbox: [...outbox], snapshotScope: scope.full.length > 0 }
  })
}

// ------------------------------------------------------------------ REP-04 conciliación
export type ReconRun = { market_code: string; as_of: string | null; won_by_txn: number; first_txn_in_file: number; won_without_txn: number; txn_without_won: number; date_mismatch: number; status_mismatch: number; threshold_pct: string; breached: boolean; ran_at: Date }
export type ReconDiff = { account_id: string; market_code: string; name: string; as_of: string | null; first_txn_at: Date | null; deal_id: string | null; won_at: Date | null; kind: string }
export async function getReconciliation(ctx: Ctx, f: Filters & { kind?: string }) {
  const scope = wideScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const runs = await tx<ReconRun[]>`
      select distinct on (r.market_code) r.market_code, r.as_of::text, r.won_by_txn, r.first_txn_in_file, r.won_without_txn, r.txn_without_won, r.date_mismatch, r.status_mismatch,
             r.threshold_pct::text, r.breached, r.ran_at
        from crm.reconciliation_runs r where r.market_code = any(${scope.full}::text[]) ${mkFilter(tx, 'r', f.market)} order by r.market_code, r.ran_at desc`
    const counts = await tx<{ market_code: string; kind: string; n: number }[]>`
      select r.market_code, r.kind, count(*)::int as n from crm.reconciliation_diffs r
       where r.kind is not null and r.market_code = any(${scope.full}::text[]) ${mkFilter(tx, 'r', f.market)} group by 1, 2`
    const totals = await tx<{ market_code: string; won_by_txn: number; first_txn: number; as_of: string | null; with_status: number }[]>`
      select mk.code as market_code,
             (select count(*)::int from crm.deals d where d.market_code = mk.code and d.status = 'won' and d.closed_by = 'transaction') as won_by_txn,
             (select count(distinct mm.account_id)::int from crm.merchant_metrics_daily mm where mm.market_code = mk.code and mm.first_txn_at is not null) as first_txn,
             (select max(mm.as_of)::text from crm.merchant_metrics_daily mm where mm.market_code = mk.code) as as_of,
             (select count(*)::int from crm.merchant_metrics_daily mm where mm.market_code = mk.code and mm.status is not null
                 and mm.as_of = (select max(m2.as_of) from crm.merchant_metrics_daily m2 where m2.market_code = mk.code)) as with_status
        from crm.markets mk where mk.code = any(${scope.full}::text[]) and mk.status = 'live' ${f.market ? tx`and mk.code = ${f.market}` : tx``} order by mk.code`
    const diffs = await tx<ReconDiff[]>`
      select r.account_id, r.market_code, r.name, r.as_of::text, r.first_txn_at, r.deal_id, r.won_at, r.kind from crm.reconciliation_diffs r
       where r.kind is not null and r.market_code = any(${scope.full}::text[]) ${mkFilter(tx, 'r', f.market)} ${f.kind ? tx`and r.kind = ${f.kind}` : tx``}
       order by r.kind, r.name limit 200`
    return { runs: [...runs], counts: [...counts], totals: [...totals], diffs: [...diffs] }
  })
}

// ------------------------------------------------------------------ CANAL-05 lo que llevo
export type Carry = { stores: number; first_sales: number; windows: { days: 30 | 60 | 90; active: number; judged: number }[]; as_of: string | null }
/** Los números de la cartera de UNA persona. Sin montos ni comisión: eso lo calcula otro sistema. */
export async function getCarry(ctx: Ctx, p: MarketPeriods, ownerId: string): Promise<Carry> {
  return withUser(ctx.user.id, async (tx) => {
    const pr = periodRows(tx, p)
    const head = await tx<{ stores: number; as_of: string | null }[]>`
      select (select count(*)::int from crm.accounts a join crm.markets mk on mk.code = a.market_code join ${pr} pr on pr.market = a.market_code
               where a.owner_id = ${ownerId} and a.kind = 'store' and a.archived_at is null and (a.created_at at time zone mk.timezone)::date between pr.dfrom and pr.dto) as stores,
             (select max(mm.as_of)::text from crm.merchant_metrics_daily mm join crm.accounts a on a.id = mm.account_id where a.owner_id = ${ownerId}) as as_of`
    const rows = await tx<{ first_sales: number; a30: number; j30: number; a60: number; j60: number; a90: number; j90: number }[]>`
      with first as (
        select a.id, (min(mm.first_txn_at) at time zone mk.timezone)::date as day
          from crm.accounts a join crm.markets mk on mk.code = a.market_code join crm.merchant_metrics_daily mm on mm.account_id = a.id and mm.first_txn_at is not null
         where a.owner_id = ${ownerId} and a.kind = 'store' and a.archived_at is null group by a.id, mk.timezone),
      inp as (select f.id, f.day from first f join crm.accounts a on a.id = f.id join ${pr} pr on pr.market = a.market_code where f.day between pr.dfrom and pr.dto),
      w as (
        select i.id, n.days,
               (select mm.txn_count_30d from crm.merchant_metrics_daily mm where mm.account_id = i.id and mm.as_of between i.day + n.days - 7 and i.day + n.days + 7
                 order by abs(mm.as_of - (i.day + n.days)) limit 1) as txn
          from inp i cross join (values (30), (60), (90)) n(days))
      select (select count(*)::int from inp) as first_sales,
             count(*) filter (where days = 30 and txn > 0)::int as a30, count(*) filter (where days = 30 and txn is not null)::int as j30,
             count(*) filter (where days = 60 and txn > 0)::int as a60, count(*) filter (where days = 60 and txn is not null)::int as j60,
             count(*) filter (where days = 90 and txn > 0)::int as a90, count(*) filter (where days = 90 and txn is not null)::int as j90
        from w`
    const r = rows[0]!
    return { stores: head[0]!.stores, first_sales: r.first_sales, as_of: head[0]!.as_of, windows: [{ days: 30, active: r.a30, judged: r.j30 }, { days: 60, active: r.a60, judged: r.j60 }, { days: 90, active: r.a90, judged: r.j90 }] }
  })
}

// ------------------------------------------------------------------ CAMPO-05 indicadores de campo
/**
 * Respaldo del mínimo de señal (trust score) con que una visita de la Sales App cuenta. El vigente es el umbral
 * trust_min_score del mercado (valor propuesto en 0039, pendiente de Ventas); la visita que llega sin señal cuenta.
 */
export const TRUST_MIN = 50
export type FieldKpiRow = {
  market_code: string; owner_id: string | null; owner_name: string | null; team_name: string | null
  visits: number; sales: number; visited: number; confirmed: number; manual: number; low: number; book: number; enrolled: number
  /** Ruta del día: tiendas que tocaban (las primeras de la prioridad diaria) y cuántas se visitaron ese día. */
  planned: number; planned_visited: number
  /** Distribución numérica: tiendas de la cartera que están activas. */
  active_book: number
  trust_min: number
}
export async function getFieldKpis(ctx: Ctx, p: MarketPeriods, f: Filters): Promise<FieldKpiRow[]> {
  const scope = wideScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const pr = periodRows(tx, p)
    const rows = await tx<FieldKpiRow[]>`
      with tm as (
        select m.code as market, coalesce((select f.value::int from crm.field_thresholds f where f.market_code = m.code and f.key = 'trust_min_score' and f.valid_to is null), ${TRUST_MIN}) as trust_min,
               coalesce((select f.value::int from crm.field_thresholds f where f.market_code = m.code and f.key = 'route_daily_stores' and f.valid_to is null), 10) as route_n
          from crm.markets m),
      v as (
        select v.market_code, v.owner_id,
               count(*) filter (where coalesce(sv.trust_score, 100) >= tm.trust_min)::int as visits,
               count(*) filter (where v.outcome = 'sale' and coalesce(sv.trust_score, 100) >= tm.trust_min)::int as sales,
               count(distinct v.account_id) filter (where coalesce(sv.trust_score, 100) >= tm.trust_min)::int as visited,
               count(*) filter (where v.origin = 'sales_app' and coalesce(sv.trust_score, 100) >= tm.trust_min)::int as confirmed,
               count(*) filter (where v.origin = 'manual')::int as manual,
               count(*) filter (where sv.trust_score < tm.trust_min)::int as low
          from crm.visit_log v join ${pr} pr on pr.market = v.market_code join tm on tm.market = v.market_code
          left join crm.visits sv on sv.id = v.id and v.origin = 'sales_app'
         where v.business_date between pr.dfrom and pr.dto and ${inScope(tx, scope, 'v')} ${mkFilter(tx, 'v', f.market)} ${ownerFilter(tx, 'v', f.owner)} ${teamFilter(tx, 'v', f.team)}
         group by 1, 2),
      rt as (
        select r.market_code, r.owner_id, count(*)::int as planned,
               count(*) filter (where exists (select 1 from crm.visit_log x where x.account_id = r.account_id and x.business_date = r.day
                                               and (x.origin <> 'sales_app' or coalesce((select sv.trust_score from crm.visits sv where sv.id = x.id), 100) >= tm.trust_min)))::int as planned_visited
          from (select p.*, row_number() over (partition by p.market_code, p.owner_id, p.day order by p.score desc, p.account_id) as rn
                  from crm.store_priority p join ${pr} pr on pr.market = p.market_code
                 where p.day between pr.dfrom and pr.dto and not p.holdout and p.owner_id is not null and p.score > 0 and jsonb_array_length(p.reasons) > 0) r
          join tm on tm.market = r.market_code join crm.accounts a on a.id = r.account_id
         where r.rn <= tm.route_n and ${inScope(tx, scope, 'a')} ${mkFilter(tx, 'r', f.market)} ${ownerFilter(tx, 'r', f.owner)} ${teamFilter(tx, 'r', f.team)}
         group by 1, 2),
      b as (
        select a.market_code, a.owner_id, count(*)::int as book, count(*) filter (where a.lifecycle = 'active')::int as active_book,
               count(*) filter (where (a.created_at at time zone mk.timezone)::date between pr.dfrom and pr.dto)::int as enrolled
          from crm.accounts a join crm.markets mk on mk.code = a.market_code join ${pr} pr on pr.market = a.market_code
         where a.kind = 'store' and a.archived_at is null and ${inScope(tx, scope, 'a')} ${mkFilter(tx, 'a', f.market)} ${ownerFilter(tx, 'a', f.owner)} ${teamFilter(tx, 'a', f.team)}
         group by 1, 2)
      select x.market_code, x.owner_id, u.full_name as owner_name, tm.name as team_name,
             coalesce(v.visits, 0) as visits, coalesce(v.sales, 0) as sales, coalesce(v.visited, 0) as visited, coalesce(v.confirmed, 0) as confirmed,
             coalesce(v.manual, 0) as manual, coalesce(v.low, 0) as low, coalesce(b.book, 0) as book, coalesce(b.enrolled, 0) as enrolled,
             coalesce(rt.planned, 0) as planned, coalesce(rt.planned_visited, 0) as planned_visited, coalesce(b.active_book, 0) as active_book,
             (select tm.trust_min from tm where tm.market = x.market_code) as trust_min
        from (select market_code, owner_id from v union select market_code, owner_id from b) x
        left join rt on rt.market_code = x.market_code and rt.owner_id is not distinct from x.owner_id
        left join v on v.market_code = x.market_code and v.owner_id is not distinct from x.owner_id
        left join b on b.market_code = x.market_code and b.owner_id is not distinct from x.owner_id
        left join crm.users u on u.id = x.owner_id
        left join lateral ${ownerTeam(tx, 'x')} tm on true
       where coalesce(v.visits, 0) + coalesce(v.low, 0) > 0 or x.owner_id is not null
       order by x.market_code, tm.name nulls last, u.full_name nulls last`
    return [...rows]
  })
}

// ------------------------------------------------------------------ REP-03 pronóstico
export type ForecastStage = { pipeline_id: string; pipeline_name: string; market_code: string; motor: string; stage_id: string; position: number; name_es: string; name_en: string; probability: number; open: number; amount: string; currency: string; won: number; closed: number }
export const FORECAST_MIN_SAMPLE = 5
/** Tasa de una etapa con su rango. Con muestra suficiente, la histórica con intervalo de Wilson al 80%; si no, la configurada en la etapa, con 15 puntos de margen. */
export function stageRate(s: { won: number; closed: number; probability: number }): { rate: number; low: number; high: number; historical: boolean } {
  if (s.closed >= FORECAST_MIN_SAMPLE) {
    const z = 1.2816, n = s.closed, ph = s.won / n
    const denom = 1 + (z * z) / n
    const centre = (ph + (z * z) / (2 * n)) / denom
    const half = (z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n))) / denom
    return { rate: ph, low: Math.max(0, centre - half), high: Math.min(1, centre + half), historical: true }
  }
  const r = s.probability / 100
  return { rate: r, low: Math.max(0, r - 0.15), high: Math.min(1, r + 0.15), historical: false }
}
export async function getForecast(ctx: Ctx, f: Filters): Promise<ForecastStage[]> {
  const scope = wideScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<ForecastStage[]>`
      with passed as (select distinct e.to_stage_id as stage_id, e.deal_id from crm.deal_stage_events e where e.at >= now() - interval '365 days'),
      hist as (
        select ps.stage_id, count(*) filter (where d.status = 'won')::int as won, count(*) filter (where d.status in ('won', 'lost'))::int as closed
          from passed ps join crm.deals d on d.id = ps.deal_id where ${inScope(tx, scope, 'd')} group by 1)
      select p.id as pipeline_id, p.name as pipeline_name, p.market_code, p.motor, s.id as stage_id, s.position, s.name_es, s.name_en, s.probability,
             count(d.id)::int as open, coalesce(sum(d.amount_minor), 0)::text as amount, trim(mk.currency) as currency,
             coalesce(max(h.won), 0)::int as won, coalesce(max(h.closed), 0)::int as closed
        from crm.pipelines p join crm.stages s on s.pipeline_id = p.id and s.kind in ('open', 'awaiting_txn') join crm.markets mk on mk.code = p.market_code
        left join crm.deals d on d.stage_id = s.id and d.status = 'open' and ${inScope(tx, scope, 'd')} ${ownerFilter(tx, 'd', f.owner)} ${teamFilter(tx, 'd', f.team)}
        left join hist h on h.stage_id = s.id
       where p.market_code = any(${all(scope)}::text[]) and p.is_active ${mkFilter(tx, 'p', f.market)} ${isUuid(f.pipeline) ? tx`and p.id = ${f.pipeline}` : tx``}
       group by p.id, p.name, p.market_code, p.motor, p.position, s.id, s.position, s.name_es, s.name_en, s.probability, mk.currency
       order by p.market_code, p.position, s.position`
    return [...rows]
  })
}

// ------------------------------------------------------------------ GOB-03 uso real
export type UsageRow = {
  user_id: string; full_name: string; market_code: string; team_id: string | null; team_name: string | null; role: string
  weeks: number[]; open_deals: number; step_ok: number; leads_judged: number; leads_on_time: number
}
export type TeamSignal = { team_id: string; views: number }
export const USAGE_WEEKS = 8
/** Uso real por persona: actividades registradas por semana, próximo paso al día y leads atendidos a tiempo. Nunca ingresos. */
/**
 * Semanas seguidas (contando la actual) en que quien supervisa abrió el tablero de su equipo, hasta `weeks`.
 * Es lo que pide la regla de paso a despliegue; "Listo para ampliar" se calcula con la misma regla que muestra la pantalla.
 */
export async function teamBoardStreak(ctx: Ctx, weeks: number): Promise<Map<string, number>> {
  return withUser(ctx.user.id, async (tx) => {
    const n = Math.max(1, Math.min(12, Math.round(weeks)))
    const cum: Map<string, number>[] = []
    for (let k = 1; k <= n; k++) {
      const rows = await tx<TeamSignal[]>`select team_id, views from app.team_board_views(now() - make_interval(days => ${k * 7}))`
      cum.push(new Map(rows.map((r) => [r.team_id, Number(r.views)])))
    }
    const out = new Map<string, number>()
    for (const team of new Set(cum.flatMap((m) => [...m.keys()]))) {
      let streak = 0
      for (let k = 0; k < n; k++) {
        const inWeek = (cum[k]!.get(team) ?? 0) - (k > 0 ? cum[k - 1]!.get(team) ?? 0 : 0)
        if (inWeek <= 0) break
        streak++
      }
      out.set(team, streak)
    }
    return out
  })
}

export async function getUsage(ctx: Ctx, f: Filters) {
  const live = ctx.markets.filter((m) => m.status === 'live').map((m) => m.code)
  const has = (code: string, roles: Role[]) => ctx.memberships.some((m) => roles.includes(m.role) && (m.market === null || m.market === code))
  const full = live.filter((c) => has(c, ['admin', 'lt', 'market_lead']))
  const team = live.filter((c) => !full.includes(c) && has(c, ['supervisor']))
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<UsageRow[]>`
      select u.id as user_id, u.full_name, m.market_code, t.id as team_id, t.name as team_name, m.role,
             (select array_agg(x.n order by x.w) from (
                select w, (select count(*)::int from crm.activities a where a.created_by = u.id and a.source = 'user'
                             and a.created_at >= (w at time zone mk.timezone) and a.created_at < ((w + interval '7 days') at time zone mk.timezone)) as n
                  from generate_series(date_trunc('week', now() at time zone mk.timezone) - make_interval(weeks => ${USAGE_WEEKS - 1}), date_trunc('week', now() at time zone mk.timezone), interval '1 week') w) x) as weeks,
             (select count(*)::int from crm.deals d where d.owner_id = u.id and d.market_code = m.market_code and d.status = 'open') as open_deals,
             (select count(*)::int from crm.deals d where d.owner_id = u.id and d.market_code = m.market_code and d.status = 'open' and d.next_step_due >= ${marketToday(tx, tx`m.market_code`)}) as step_ok,
             (select count(*)::int from crm.leads l where l.owner_id = u.id and l.market_code = m.market_code and l.created_at >= now() - make_interval(weeks => ${USAGE_WEEKS})
                 and (l.first_touch_at is not null or l.sla_due_at < now())) as leads_judged,
             (select count(*)::int from crm.leads l where l.owner_id = u.id and l.market_code = m.market_code and l.created_at >= now() - make_interval(weeks => ${USAGE_WEEKS})
                 and l.first_touch_at <= l.sla_due_at) as leads_on_time
        from crm.users u
        join crm.memberships m on m.user_id = u.id and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()) and m.role in ('rep', 'supervisor')
        join crm.markets mk on mk.code = m.market_code
        left join crm.teams t on t.id = m.team_id
       where u.is_active and not u.is_system
         and (m.market_code = any(${full}::text[]) or (m.market_code = any(${team}::text[]) and u.id = any((select app.supervised_user_ids())::uuid[])))
         ${f.market ? tx`and m.market_code = ${f.market}` : tx``}
         ${f.team === 'none' ? tx`and m.team_id is null` : isUuid(f.team) ? tx`and m.team_id = ${f.team}` : tx``}
       order by m.market_code, t.name nulls last, u.full_name`
    const views = await tx<TeamSignal[]>`select team_id, views from app.team_board_views(now() - interval '7 days')`
    const outcome = await tx<{ team_id: string; active: number; stores: number }[]>`
      select m.team_id, count(*) filter (where a.lifecycle = 'active')::int as active, count(*)::int as stores
        from crm.accounts a join crm.memberships m on m.user_id = a.owner_id and m.market_code = a.market_code and m.team_id is not null
             and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
       where a.kind = 'store' and a.archived_at is null group by 1`
    return { rows: [...rows], views: [...views], outcome: [...outcome] }
  })
}

// ------------------------------------------------------------------ reportes guardados y entregas
export type SavedReport = { id: string; report: string; name: string; params: Record<string, string>; is_shared: boolean; market_code: string | null; schedule: 'daily' | 'weekly' | null; last_run_at: Date | null; mine: boolean; owner_name: string }
export async function listSavedReports(ctx: Ctx): Promise<SavedReport[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<SavedReport[]>`
      select r.id, r.report, r.name, r.params, r.is_shared, r.market_code, r.schedule, r.last_run_at, r.user_id = ${ctx.user.id} as mine, u.full_name as owner_name
        from crm.saved_reports r join crm.users u on u.id = r.user_id order by (r.user_id = ${ctx.user.id}) desc, r.name`
    return [...rows]
  })
}
export type Delivery = { id: string; title: string; body: string; href: string; seen_at: Date | null; created_at: Date }
export async function listDeliveries(ctx: Ctx): Promise<Delivery[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Delivery[]>`select id, title, body, href, seen_at, created_at from crm.report_deliveries where user_id = ${ctx.user.id} order by created_at desc limit 20`
    return [...rows]
  })
}
export async function adapterQueue(ctx: Ctx): Promise<{ channel: string; n: number; last: Date | null }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ channel: string; n: number; last: Date | null }[]>`select channel, count(*)::int as n, max(created_at) as last from crm.report_outbox group by 1`
    return [...rows]
  })
}

// ------------------------------------------------------------------ UX-03 vistas guardadas como colas
export type ViewObject = import('@/lib/report-catalog').ViewObject
export type SavedView = { id: string; object: ViewObject; name: string; filters: Record<string, string>; is_shared: boolean; team_id: string | null; mine: boolean; pinned: boolean }
export async function listViews(ctx: Ctx, object?: ViewObject): Promise<SavedView[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<SavedView[]>`
      select v.id, v.object, v.name, v.filters, v.is_shared, v.team_id, v.user_id = ${ctx.user.id} as mine,
             exists (select 1 from crm.saved_view_pins p where p.view_id = v.id and p.user_id = ${ctx.user.id}) as pinned
        from crm.saved_views v where ${object ? tx`v.object = ${object}` : tx`true`} order by v.is_shared, v.name`
    // Una vista compartida de otro mercado no le sirve a quien no trabaja ahí ("Organizaciones de US" en Comercios de México).
    const mine = new Set(ctx.memberships.map((m) => m.market).filter(Boolean))
    const global = ctx.memberships.some((m) => !m.market)
    return [...rows].filter((v) => v.mine || global || !v.filters?.market || mine.has(String(v.filters.market)))
  })
}
export async function pinnedViews(ctx: Ctx): Promise<SavedView[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<SavedView[]>`
      select v.id, v.object, v.name, v.filters, v.is_shared, v.team_id, v.user_id = ${ctx.user.id} as mine, true as pinned
        from crm.saved_view_pins p join crm.saved_views v on v.id = p.view_id where p.user_id = ${ctx.user.id} order by p.pinned_at limit 5`
    return [...rows]
  })
}

/** Las colas fijadas de la persona, con su contador: cuántos registros cumplen hoy el filtro de cada una. */
export async function pinnedQueues(ctx: Ctx): Promise<(SavedView & { count: number | null })[]> {
  return countViews(ctx, await pinnedViews(ctx))
}

/**
 * UX-03 (embudo2): las colas oficiales del rol de la persona (las publica administración). Administración ve todas.
 * Cada una con su contador: la meta es llegar en cero al cierre de la semana.
 */
export async function officialQueues(ctx: Ctx): Promise<(SavedView & { count: number | null; role: string })[]> {
  const roles = ctx.memberships.map((m) => m.role as string)
  const all = roles.includes('admin')
  const rows = await withUser(ctx.user.id, (tx) => tx<(SavedView & { role: string })[]>`
    select v.id, v.object, v.name, v.filters, v.is_shared, v.team_id, v.user_id = ${ctx.user.id} as mine, false as pinned, v.official_role as role
      from crm.saved_views v where v.official_role is not null and v.is_shared ${all ? tx`` : tx`and v.official_role = any(${roles}::text[])`}
     order by v.official_role, v.name`)
  const counted = await countViews(ctx, [...rows])
  return counted.map((v, i) => ({ ...v, role: rows[i]!.role }))
}

async function countViews<V extends SavedView>(ctx: Ctx, pins: V[]): Promise<(V & { count: number | null })[]> {
  if (pins.length === 0) return []
  const { listAccounts } = await import('@/dal/accounts')
  const { listLeads } = await import('@/dal/leads')
  return Promise.all(pins.map(async (v) => {
    const f = v.filters
    let count: number | null = null
    if (v.object === 'account') count = (await listAccounts(ctx, f)).total
    else if (v.object === 'lead') {
      const c = (await listLeads(ctx, { ...f, status: undefined, team: f.equipo })).counts
      const status = f.status ?? 'open'
      count = status === 'all' ? ['new', 'contacted', 'qualified', 'disqualified', 'converted'].reduce((n, k) => n + (c[k] ?? 0), 0) : (c[status] ?? 0)
    } else if (v.object === 'deal') {
      count = await withUser(ctx.user.id, async (tx) => {
        const rows = await tx<{ n: number }[]>`
          select count(*)::int as n from crm.deals d where d.status = 'open'
            ${isUuid(f.pipeline) ? tx`and d.pipeline_id = ${f.pipeline}` : tx``}
            ${f.owner === 'me' ? tx`and d.owner_id = ${ctx.user.id}` : f.owner === 'none' ? tx`and d.owner_id is null` : isUuid(f.owner) ? tx`and d.owner_id = ${f.owner}` : tx``}
            ${f.paso === 'sin' ? tx`and (d.next_step is null or d.next_step_due is null)` : tx``}
            ${f.paso === 'revisita' ? tx`and d.revisit_needed` : tx``}
            ${f.paso === 'revisita-vencida' ? tx`and d.revisit_needed and d.revisit_due < ${marketToday(tx, tx`d.market_code`)}` : tx``}`
        return rows[0]?.n ?? 0
      })
    } else if (f.view !== 'done') {
      count = await withUser(ctx.user.id, async (tx) => {
        const rows = await tx<{ n: number }[]>`
          select count(*)::int as n from crm.activities a where a.kind in ('task', 'handoff', 'visit') and a.done_at is null ${f.view === 'team' ? tx`` : tx`and a.owner_id = ${ctx.user.id}`}`
        return rows[0]?.n ?? 0
      })
    }
    return { ...v, count }
  }))
}

/** Fecha de corte del archivo diario de ventas más reciente que la persona puede ver (REP-04: fecha de corte a la vista). */
export async function salesCutoff(ctx: Ctx, market?: string): Promise<string | null> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ as_of: string | null }[]>`select app.sales_cutoff(${market ?? null})::text as as_of`
    return rows[0]?.as_of ?? null
  })
}
