import 'server-only'
import type postgres from 'postgres'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { Role } from '@/domain/policy'
import { addDays, isoDay } from '@/lib/format'
import { isUuid } from '@/lib/ids'
import { resolvePeriod, weekStart, type Period, type PeriodKey } from '@/lib/periods'

type Frag = postgres.Fragment

// ------------------------------------------------------------------ alcance y periodo
/**
 * Hasta dónde llegan los reportes de una persona: mercados completos (administración, leadership, quien lidera el mercado)
 * y mercados donde solo ve a su equipo (supervisión). RLS decide la fila; esto lo repite de forma explícita (AUTHZ-07).
 */
export type ReportScope = { full: string[]; team: string[] }
export function reportScope(ctx: Ctx, own = false): ReportScope {
  const live = ctx.markets.filter((m) => m.status === 'live').map((m) => m.code)
  const has = (code: string, roles: Role[]) => ctx.memberships.some((m) => roles.includes(m.role) && (m.market === null || m.market === code))
  const full = live.filter((c) => has(c, ['admin', 'lt', 'market_lead']))
  // Supervisión ve a su equipo. Con `own` (solo "Mis negocios cerrados"), quien vende ve lo que lleva: app.supervised_user_ids()
  // devuelve a la propia persona y a quienes supervisa. Los demás reportes no le dan alcance a quien vende.
  const team = live.filter((c) => !full.includes(c) && has(c, own ? ['supervisor', 'rep'] : ['supervisor']))
  return { full, team }
}
export const scopeMarkets = (s: ReportScope) => [...s.full, ...s.team]

/** La fila (negocio, comercio, visita o lead) está en el alcance: mercado completo, o mercado de su equipo y dueño supervisado. */
const inScope = (tx: Tx, s: ReportScope, row: string): Frag =>
  tx`(${tx(row)}.market_code = any(${s.full}::text[])
      or (${tx(row)}.market_code = any(${s.team}::text[]) and ${tx(row)}.owner_id = any((select app.supervised_user_ids())::uuid[])))`

/** El periodo, resuelto con el "hoy" de cada mercado: una semana en Nueva York y en Ciudad de México no cambian de día a la misma hora. */
export type MarketPeriods = { key: PeriodKey; first: Period; byMarket: Record<string, Period> }
export function marketPeriods(ctx: Ctx, key: string | undefined, from?: string, to?: string, fallback: PeriodKey = 'mes', now = new Date()): MarketPeriods {
  const live = ctx.markets.filter((m) => m.status === 'live')
  const byMarket: Record<string, Period> = {}
  for (const m of live) byMarket[m.code] = resolvePeriod(key, isoDay(now, m.timezone), from, to, fallback)
  const first = byMarket[live[0]?.code ?? ''] ?? resolvePeriod(key, isoDay(now), from, to, fallback)
  return { key: first.key, first, byMarket }
}
const periodRows = (tx: Tx, p: MarketPeriods): Frag => {
  const codes = Object.keys(p.byMarket)
  return tx`(select * from unnest(${codes}::text[], ${codes.map((c) => p.byMarket[c]!.from)}::date[], ${codes.map((c) => p.byMarket[c]!.to)}::date[]) as x(market, dfrom, dto))`
}

/** Equipo vigente de quien lleva el registro, en el mercado del registro. */
const ownerTeam = (tx: Tx, row: string): Frag =>
  tx`(select t.id, t.name from crm.memberships mm join crm.teams t on t.id = mm.team_id
       where mm.user_id = ${tx(row)}.owner_id and mm.market_code = ${tx(row)}.market_code and mm.valid_from <= now() and (mm.valid_to is null or mm.valid_to > now())
       order by mm.valid_from desc limit 1)`

/** Filtro por equipo sobre el dueño de la fila: un equipo, o 'none' (personas sin equipo y registros sin dueño). */
export const teamFilter = (tx: Tx, row: string, team: string | undefined): Frag => {
  const member = (extra: Frag) => tx`exists (select 1 from crm.memberships mm where mm.user_id = ${tx(row)}.owner_id and mm.market_code = ${tx(row)}.market_code
      and mm.valid_from <= now() and (mm.valid_to is null or mm.valid_to > now()) ${extra})`
  return team === 'none' ? tx`and not ${member(tx`and mm.team_id is not null`)}` : isUuid(team) ? tx`and ${member(tx`and mm.team_id = ${team}`)}` : tx``
}
export const ownerFilter = (tx: Tx, row: string, owner: string | undefined): Frag =>
  owner === 'none' ? tx`and ${tx(row)}.owner_id is null` : isUuid(owner) ? tx`and ${tx(row)}.owner_id = ${owner}` : tx``

// ------------------------------------------------------------------ opciones de filtro
export type ReportOptions = {
  markets: { code: string; name: string }[]
  pipelines: { id: string; market_code: string; name: string; motor: string }[]
  teams: { id: string; market_code: string; name: string }[]
  people: { id: string; full_name: string; market_code: string; team_id: string | null }[]
}

/** Mercados, embudos, equipos y personas que la persona puede elegir en un filtro, dentro de su alcance. */
export async function getReportOptions(ctx: Ctx, scope = reportScope(ctx)): Promise<ReportOptions> {
  const markets = scopeMarkets(scope)
  return withUser(ctx.user.id, async (tx) => {
    const pipelines = await tx<ReportOptions['pipelines']>`
      select id, market_code, name, motor from crm.pipelines where market_code = any(${markets}::text[]) and is_active order by market_code, position`
    const people = await tx<ReportOptions['people']>`
      select distinct on (u.full_name, u.id, m.market_code) u.id, u.full_name, m.market_code, m.team_id
        from crm.users u join crm.memberships m on m.user_id = u.id and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())
       where u.is_active and not u.is_system and m.role in ('rep', 'supervisor', 'market_lead')
         and (m.market_code = any(${scope.full}::text[]) or (m.market_code = any(${scope.team}::text[]) and u.id = any((select app.supervised_user_ids())::uuid[])))
       order by u.full_name, u.id, m.market_code, m.team_id nulls last`
    const teamIds = [...new Set(people.map((p) => p.team_id).filter((x): x is string => !!x))]
    const teams = await tx<ReportOptions['teams']>`
      select id, market_code, name from crm.teams
       where market_code = any(${scope.full}::text[]) or id = any(${teamIds}::uuid[]) order by market_code, name`
    return {
      markets: ctx.markets.filter((m) => markets.includes(m.code)).map((m) => ({ code: m.code, name: m.name })),
      pipelines: [...pipelines], teams: [...teams], people: [...people],
    }
  })
}

// ------------------------------------------------------------------ negocios cerrados
export type ClosedFilters = { market?: string; pipeline?: string; team?: string; owner?: string; result?: string }
export type ClosedRow = {
  id: string
  title: string
  account_id: string
  account_name: string
  market_code: string
  pipeline_name: string
  owner_name: string | null
  team_name: string | null
  status: 'won' | 'lost'
  closed_on: string
  amount_minor: string | null
  currency: string
  reason_es: string | null
  reason_en: string | null
  /** Cómo se cerró: 'manual' (alguien lo marcó) o 'transaction' (lo confirmó la primera venta). */
  closed_by: string | null
  /** Quién lo marcó como ganado o perdido, cuando fue a mano. */
  closed_by_name: string | null
}

const closedBase = (tx: Tx, scope: ReportScope, p: MarketPeriods, f: ClosedFilters): Frag => tx`
    from crm.deals d
    join crm.accounts a on a.id = d.account_id
    join crm.pipelines p on p.id = d.pipeline_id
    join crm.markets mk on mk.code = d.market_code
    join ${periodRows(tx, p)} pr on pr.market = d.market_code
    left join crm.users u on u.id = d.owner_id
    left join crm.loss_reasons r on r.code = d.loss_reason_code
    left join lateral ${ownerTeam(tx, 'd')} tm on true
   where d.status in ('won', 'lost') and ${inScope(tx, scope, 'd')}
     and ((case d.status when 'won' then d.won_at else d.lost_at end) at time zone mk.timezone)::date between pr.dfrom and pr.dto
     ${f.market ? tx`and d.market_code = ${f.market}` : tx``}
     ${isUuid(f.pipeline) ? tx`and d.pipeline_id = ${f.pipeline}` : tx``}
     ${f.result === 'won' || f.result === 'lost' ? tx`and d.status = ${f.result}` : tx``}
     ${ownerFilter(tx, 'd', f.owner)} ${teamFilter(tx, 'd', f.team)}`

const closedSelect = (tx: Tx): Frag => tx`
  select d.id, d.title, d.account_id, a.name as account_name, d.market_code, p.name as pipeline_name, u.full_name as owner_name, tm.name as team_name, d.status,
         ((case d.status when 'won' then d.won_at else d.lost_at end) at time zone mk.timezone)::date::text as closed_on,
         d.amount_minor::text, d.currency, r.label_es as reason_es, r.label_en as reason_en, d.closed_by,
         (select cu.full_name from crm.deal_stage_events e join crm.stages cs on cs.id = e.to_stage_id left join crm.users cu on cu.id = e.actor_id and not cu.is_system
           where e.deal_id = d.id and cs.kind = d.status order by e.at desc limit 1) as closed_by_name`

export type ClosedPerson = { owner_id: string | null; owner_name: string | null; team_name: string | null; market_code: string; won: number; lost: number; amounts: { currency: string; amount: string }[] }

/**
 * Negocios ganados y perdidos en el periodo, dentro del alcance de quien mira. La fecha de cierre es el día de calendario
 * en la zona del mercado. Los montos se suman por moneda: aquí nunca se convierten.
 */
export async function getClosedDeals(ctx: Ctx, p: MarketPeriods, f: ClosedFilters, limit = 200, own = false) {
  const scope = reportScope(ctx, own)
  return withUser(ctx.user.id, async (tx) => {
    const base = closedBase(tx, scope, p, f)
    const rows = await tx<ClosedRow[]>`${closedSelect(tx)} ${base} order by closed_on desc, d.id desc limit ${limit}`
    const totals = await tx<{ status: 'won' | 'lost'; currency: string; n: number; with_amount: number; amount: string | null }[]>`
      select d.status, d.currency, count(*)::int as n, count(d.amount_minor)::int as with_amount, sum(d.amount_minor)::text as amount ${base} group by d.status, d.currency order by d.status desc, d.currency`
    const people = await tx<{ owner_id: string | null; owner_name: string | null; team_name: string | null; market_code: string; currency: string; won: number; lost: number; amount: string | null }[]>`
      select d.owner_id, u.full_name as owner_name, tm.name as team_name, d.market_code, d.currency,
             count(*) filter (where d.status = 'won')::int as won, count(*) filter (where d.status = 'lost')::int as lost,
             sum(d.amount_minor) filter (where d.status = 'won')::text as amount
        ${base} group by d.owner_id, u.full_name, tm.name, d.market_code, d.currency order by d.market_code, tm.name nulls last, u.full_name nulls last`
    const byPerson = new Map<string, ClosedPerson>()
    for (const r of people) {
      const k = `${r.owner_id}:${r.market_code}`
      const cur = byPerson.get(k) ?? { owner_id: r.owner_id, owner_name: r.owner_name, team_name: r.team_name, market_code: r.market_code, won: 0, lost: 0, amounts: [] }
      cur.won += r.won
      cur.lost += r.lost
      if (r.amount) cur.amounts.push({ currency: r.currency.trim(), amount: r.amount })
      byPerson.set(k, cur)
    }
    const count = (s: 'won' | 'lost') => totals.filter((x) => x.status === s).reduce((n, x) => n + x.n, 0)
    return {
      rows: [...rows], total: count('won') + count('lost'), won: count('won'), lost: count('lost'),
      amounts: totals.filter((x) => x.amount).map((x) => ({ status: x.status, currency: x.currency.trim(), amount: x.amount!, n: x.with_amount })),
      people: [...byPerson.values()],
    }
  })
}

/** Lo mismo que la pantalla, completo, para el archivo. Se llama desde el dominio (que valida el permiso y deja el evento). */
export async function closedDealsForExport(tx: Tx, ctx: Ctx, p: MarketPeriods, f: ClosedFilters, max: number): Promise<ClosedRow[]> {
  const rows = await tx<ClosedRow[]>`${closedSelect(tx)} ${closedBase(tx, reportScope(ctx), p, f)} order by closed_on desc, d.id desc limit ${max}`
  return [...rows]
}

// ------------------------------------------------------------------ tasa de cambio
export type FxRate = { currency: string; as_of: string; usd_rate: string; source: string; loaded_by: string | null; loaded_at: Date }

/** La tasa vigente por moneda: la de fecha más reciente. USD no necesita tasa. Si una moneda no tiene, no aparece. */
export async function getFxRates(ctx: Ctx): Promise<FxRate[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<FxRate[]>`
      select distinct on (f.currency) trim(f.currency) as currency, f.as_of::text, f.usd_rate::text, f.source, u.full_name as loaded_by, f.loaded_at
        from crm.fx_rates f left join crm.users u on u.id = f.loaded_by
       where f.currency <> 'USD' order by f.currency, f.as_of desc`
    return [...rows]
  })
}

// ------------------------------------------------------------------ panel del LT
export type PanelMarket = {
  code: string
  name: string
  currency: string
  leads: number
  leads_qualified: number
  sla_met: number
  sla_judged: number
  reached: number
  won: number
  lost: number
  deals_open: number
  awaiting_txn: number
  days_to_first_txn: number | null
  revisits: number
  activation_risk: number
  accounts_active: number
  accounts_at_risk: number
  accounts_inactive: number
  volume_30d: string
  as_of: string | null
}
export type PanelSlice = { key: string; id: string | null; market_code: string; name: string; motor: string | null; leads: number; deals_open: number; awaiting_txn: number; won: number; lost: number }

/**
 * REP-01 / REP-04: los números del panel, por mercado, por embudo y por equipo. Tres ventanas, cada una con su nombre en la pantalla:
 * el periodo elegido (leads, ganados, perdidos, primer contacto), la foto de hoy (abiertos, esperando, comercios por estado)
 * y los 30 días del archivo de S5 (volumen). Lo transaccional viene de S5; el CRM no recalcula ventas.
 */
export async function getLeadershipPanel(ctx: Ctx, p: MarketPeriods, market?: string) {
  return withUser(ctx.user.id, async (tx) => {
    const pr = periodRows(tx, p)
    const inPeriod = (expr: Frag) => tx`(${expr} at time zone m.timezone)::date between pr.dfrom and pr.dto`
    const markets = await tx<PanelMarket[]>`
      select m.code, m.name, trim(m.currency) as currency,
             (select count(*)::int from crm.leads l where l.market_code = m.code and ${inPeriod(tx`l.created_at`)}) as leads,
             (select count(*)::int from crm.leads l where l.market_code = m.code and ${inPeriod(tx`l.created_at`)} and l.status in ('qualified','converted')) as leads_qualified,
             (select count(*)::int from crm.leads l where l.market_code = m.code and ${inPeriod(tx`l.created_at`)} and l.first_touch_at <= l.sla_due_at) as sla_met,
             (select count(*)::int from crm.leads l where l.market_code = m.code and ${inPeriod(tx`l.created_at`)} and (l.first_touch_at is not null or l.sla_due_at < now())) as sla_judged,
             (select count(*)::int from crm.leads l where l.market_code = m.code and ${inPeriod(tx`l.created_at`)} and (l.first_touch_at is not null or l.sla_due_at < now())
                 and (l.status in ('contacted','qualified','converted') or exists (select 1 from crm.activities x where x.lead_id = l.id and x.outcome = 'reached'))) as reached,
             (select count(*)::int from crm.deals d where d.market_code = m.code and d.status = 'won' and ${inPeriod(tx`d.won_at`)}) as won,
             (select count(*)::int from crm.deals d where d.market_code = m.code and d.status = 'lost' and ${inPeriod(tx`d.lost_at`)}) as lost,
             (select count(*)::int from crm.deals d where d.market_code = m.code and d.status = 'open') as deals_open,
             (select count(*)::int from crm.deals d join crm.stages s on s.id = d.stage_id where d.market_code = m.code and d.status = 'open' and s.kind = 'awaiting_txn') as awaiting_txn,
             (select round(avg(extract(epoch from (d.won_at - d.created_at)) / 86400))::int from crm.deals d
               where d.market_code = m.code and d.status = 'won' and d.closed_by = 'transaction' and ${inPeriod(tx`d.won_at`)} and d.won_at > d.created_at) as days_to_first_txn,
             (select count(*)::int from crm.deals d where d.market_code = m.code and d.status = 'open' and d.revisit_needed) as revisits,
             (select count(*)::int from crm.exceptions e where e.market_code = m.code and e.resolved_at is null and e.kind = 'activation_risk') as activation_risk,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null and a.lifecycle = 'active') as accounts_active,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null and a.lifecycle = 'at_risk') as accounts_at_risk,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null and a.lifecycle = 'inactive') as accounts_inactive,
             coalesce((select sum(x.volume_minor_30d) from (
                 select distinct on (mm.account_id) mm.volume_minor_30d from crm.merchant_metrics_daily mm
                  where mm.market_code = m.code order by mm.account_id, mm.as_of desc) x), 0)::text as volume_30d,
             (select max(mm.as_of)::text from crm.merchant_metrics_daily mm where mm.market_code = m.code) as as_of
        from crm.markets m join ${pr} pr on pr.market = m.code
       where m.code = any(app.full_markets()) and m.status = 'live' ${market ? tx`and m.code = ${market}` : tx``} order by m.code`
    const codes = markets.map((m) => m.code)
    // Por embudo: los leads se cuentan por su tipo de venta, que es el mismo del embudo al que entran.
    // Un embudo retirado que todavía tiene negocios sigue en el desglose: si no, las partes no suman el total del mercado.
    const pipelines = await tx<PanelSlice[]>`
      select p.id::text as key, p.id, p.market_code, p.name, p.motor,
             (select count(*)::int from crm.leads l where l.market_code = p.market_code and l.motor = p.motor and ${inPeriod(tx`l.created_at`)}) as leads,
             (select count(*)::int from crm.deals d where d.pipeline_id = p.id and d.status = 'open') as deals_open,
             (select count(*)::int from crm.deals d join crm.stages s on s.id = d.stage_id where d.pipeline_id = p.id and d.status = 'open' and s.kind = 'awaiting_txn') as awaiting_txn,
             (select count(*)::int from crm.deals d where d.pipeline_id = p.id and d.status = 'won' and ${inPeriod(tx`d.won_at`)}) as won,
             (select count(*)::int from crm.deals d where d.pipeline_id = p.id and d.status = 'lost' and ${inPeriod(tx`d.lost_at`)}) as lost
        from crm.pipelines p join crm.markets m on m.code = p.market_code join ${pr} pr on pr.market = p.market_code
       where p.market_code = any(${codes}::text[])
         and (p.is_active or exists (select 1 from crm.deals d where d.pipeline_id = p.id))
       order by p.market_code, p.is_active desc, p.position`
    // Por equipo: el equipo vigente de quien lleva el registro. Lo que no tiene dueño, o cuyo dueño no tiene equipo, va en su propia línea.
    const teams = await tx<PanelSlice[]>`
      with own as (
        select 'lead' as what, l.market_code, tm.id as team_id, tm.name as team_name, ${inPeriod(tx`l.created_at`)} as in_period, false as is_open, false as awaiting, null::text as status
          from crm.leads l join crm.markets m on m.code = l.market_code join ${pr} pr on pr.market = l.market_code left join lateral ${ownerTeam(tx, 'l')} tm on true
         where l.market_code = any(${codes}::text[])
        union all
        select 'deal', d.market_code, tm.id, tm.name,
               case d.status when 'won' then ${inPeriod(tx`d.won_at`)} when 'lost' then ${inPeriod(tx`d.lost_at`)} else false end,
               d.status = 'open', d.status = 'open' and s.kind = 'awaiting_txn', d.status
          from crm.deals d join crm.stages s on s.id = d.stage_id join crm.markets m on m.code = d.market_code join ${pr} pr on pr.market = d.market_code
          left join lateral ${ownerTeam(tx, 'd')} tm on true
         where d.market_code = any(${codes}::text[])
      )
      select coalesce(team_id::text, 'none:' || market_code) as key, team_id as id, market_code, coalesce(team_name, '') as name, null::text as motor,
             count(*) filter (where what = 'lead' and in_period)::int as leads,
             count(*) filter (where what = 'deal' and is_open)::int as deals_open,
             count(*) filter (where what = 'deal' and awaiting)::int as awaiting_txn,
             count(*) filter (where what = 'deal' and status = 'won' and in_period)::int as won,
             count(*) filter (where what = 'deal' and status = 'lost' and in_period)::int as lost
        from own group by team_id, team_name, market_code order by market_code, team_name nulls last`
    const reasons = await tx<{ market_code: string; code: string; label_es: string; label_en: string; n: number }[]>`
      select d.market_code, r.code, r.label_es, r.label_en, count(*)::int as n
        from crm.deals d join crm.loss_reasons r on r.code = d.loss_reason_code join crm.markets m on m.code = d.market_code join ${pr} pr on pr.market = d.market_code
       where d.status = 'lost' and d.market_code = any(${codes}::text[]) and ${inPeriod(tx`d.lost_at`)} group by 1, 2, 3, 4 order by n desc limit 8`
    const noSale = await tx<{ code: string; label_es: string; label_en: string; n: number }[]>`
      select r.code, r.label_es, r.label_en, count(*)::int as n from crm.visits v join crm.loss_reasons r on r.code = v.rejection_code join ${pr} pr on pr.market = v.market_code
       where v.business_date between pr.dfrom and pr.dto and v.market_code = any(${codes}::text[]) group by 1, 2, 3 order by n desc limit 6`
    return { markets: [...markets], pipelines: [...pipelines], teams: teams.filter((x) => x.leads + x.deals_open + x.won + x.lost > 0), reasons: [...reasons], noSale: [...noSale] }
  })
}

// ------------------------------------------------------------------ adopción
export type AdoptionRow = { user_id: string; full_name: string; roles: Role[]; markets: string[]; teams: string[]; last_login: Date | null; logins: number; activities: number }

/** Conteos de uso por persona en el periodo. El alcance lo decide la función de la base (app.adoption): aquí no hay contenido de nadie. */
export async function getAdoption(ctx: Ctx, p: Period, timeZone: string): Promise<AdoptionRow[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<AdoptionRow[]>`
      select user_id, full_name, roles, markets, teams, last_login, logins, activities
        from app.adoption((${p.from}::date)::timestamp at time zone ${timeZone}, ((${p.to}::date + 1))::timestamp at time zone ${timeZone})`
    return [...rows]
  })
}

// ------------------------------------------------------------------ resultados del equipo, semana a semana
export type WeekRow = { week: string; won: number; lost: number; visits: number; sales: number; stores: number }

/** Las últimas `n` semanas (de lunes a domingo, en la zona de cada mercado), de la más reciente a la más antigua. */
export function lastWeeks(ctx: Ctx, n: number, now = new Date()): string[] {
  const tz = ctx.markets.find((m) => m.status === 'live')?.timezone ?? 'UTC'
  const start = weekStart(isoDay(now, tz))
  return Array.from({ length: n }, (_, i) => addDays(start, -7 * i))
}

/**
 * Resultados por semana dentro del alcance: negocios ganados y perdidos (por fecha de cierre), visitas y visitas con venta
 * (por día de la visita) y puntos de venta dados de alta (por fecha de creación). Supervisión ve a su equipo; quien lidera, su mercado.
 */
export async function getWeeklyResults(ctx: Ctx, f: { market?: string; team?: string; owner?: string }, n = 8): Promise<WeekRow[]> {
  const scope = reportScope(ctx)
  const weeks = lastWeeks(ctx, n)
  const since = weeks[weeks.length - 1]!
  return withUser(ctx.user.id, async (tx) => {
    const mk = (row: string) => (f.market ? tx`and ${tx(row)}.market_code = ${f.market}` : tx``)
    const deals = await tx<{ week: string; won: number; lost: number }[]>`
      select date_trunc('week', ((case d.status when 'won' then d.won_at else d.lost_at end) at time zone mk.timezone))::date::text as week,
             count(*) filter (where d.status = 'won')::int as won, count(*) filter (where d.status = 'lost')::int as lost
        from crm.deals d join crm.markets mk on mk.code = d.market_code
       where d.status in ('won', 'lost') and ${inScope(tx, scope, 'd')} ${mk('d')} ${ownerFilter(tx, 'd', f.owner)} ${teamFilter(tx, 'd', f.team)}
         and (case d.status when 'won' then d.won_at else d.lost_at end) >= (${since}::date - 1)
       group by 1`
    const visits = await tx<{ week: string; visits: number; sales: number }[]>`
      select date_trunc('week', v.business_date)::date::text as week, count(*)::int as visits, count(*) filter (where v.outcome = 'sale')::int as sales
        from crm.visit_log v
       where v.business_date >= ${since}::date and ${inScope(tx, scope, 'v')} ${mk('v')} ${ownerFilter(tx, 'v', f.owner)} ${teamFilter(tx, 'v', f.team)}
       group by 1`
    const stores = await tx<{ week: string; stores: number }[]>`
      select date_trunc('week', (a.created_at at time zone mk.timezone))::date::text as week, count(*)::int as stores
        from crm.accounts a join crm.markets mk on mk.code = a.market_code
       where a.kind = 'store' and a.archived_at is null and a.created_at >= (${since}::date - 1) and ${inScope(tx, scope, 'a')} ${mk('a')} ${ownerFilter(tx, 'a', f.owner)} ${teamFilter(tx, 'a', f.team)}
       group by 1`
    return weeks.map((w) => ({
      week: w,
      won: deals.find((x) => x.week === w)?.won ?? 0, lost: deals.find((x) => x.week === w)?.lost ?? 0,
      visits: visits.find((x) => x.week === w)?.visits ?? 0, sales: visits.find((x) => x.week === w)?.sales ?? 0,
      stores: stores.find((x) => x.week === w)?.stores ?? 0,
    }))
  })
}

// ------------------------------------------------------------------ reporte semanal de campo
export type FieldBy = 'territorio' | 'plaza'
export type FieldPlaceRow = { week: string; market_code: string; place: string | null; stores: number; won: number }
export type FieldVisitRow = { week: string; market_code: string; owner_id: string | null; owner_name: string | null; team_name: string | null; visits: number; sales: number }
export type FieldFilters = { market?: string; team?: string; owner?: string; by?: string; weeks?: number }

const fieldPlaces = async (tx: Tx, scope: ReportScope, f: FieldFilters, since: string): Promise<FieldPlaceRow[]> => {
  const place = f.by === 'plaza' ? tx`nullif(btrim(a.locality), '')` : tx`(select t.name from crm.territories t where t.id = a.territory_id)`
  const mk = f.market ? tx`and a.market_code = ${f.market}` : tx``
  const rows = await tx<FieldPlaceRow[]>`
    select week, market_code, place, sum(stores)::int as stores, sum(won)::int as won from (
      select date_trunc('week', (a.created_at at time zone mk.timezone))::date::text as week, a.market_code, ${place} as place, 1 as stores, 0 as won
        from crm.accounts a join crm.markets mk on mk.code = a.market_code
       where a.kind = 'store' and a.archived_at is null and a.created_at >= (${since}::date - 1) and ${inScope(tx, scope, 'a')} ${mk} ${ownerFilter(tx, 'a', f.owner)} ${teamFilter(tx, 'a', f.team)}
      union all
      select date_trunc('week', (d.won_at at time zone mk.timezone))::date::text, a.market_code, ${place}, 0, 1
        from crm.deals d join crm.accounts a on a.id = d.account_id join crm.markets mk on mk.code = d.market_code
       where d.status = 'won' and d.won_at >= (${since}::date - 1) and ${inScope(tx, scope, 'd')} ${f.market ? tx`and d.market_code = ${f.market}` : tx``} ${ownerFilter(tx, 'd', f.owner)} ${teamFilter(tx, 'd', f.team)}
    ) x where week >= ${since} group by week, market_code, place order by week desc, market_code, place nulls last`
  return [...rows]
}
const fieldVisits = async (tx: Tx, scope: ReportScope, f: FieldFilters, since: string): Promise<FieldVisitRow[]> => {
  const rows = await tx<FieldVisitRow[]>`
    select date_trunc('week', v.business_date)::date::text as week, v.market_code, v.owner_id, u.full_name as owner_name, tm.name as team_name,
           count(*)::int as visits, count(*) filter (where v.outcome = 'sale')::int as sales
      from crm.visit_log v left join crm.users u on u.id = v.owner_id left join lateral ${ownerTeam(tx, 'v')} tm on true
     where v.business_date >= ${since}::date and ${inScope(tx, scope, 'v')} ${f.market ? tx`and v.market_code = ${f.market}` : tx``} ${ownerFilter(tx, 'v', f.owner)} ${teamFilter(tx, 'v', f.team)}
     group by 1, v.market_code, v.owner_id, u.full_name, tm.name order by week desc, v.market_code, tm.name nulls last, u.full_name nulls last`
  return [...rows]
}

export type FieldVisitorRow = { week: string; market_code: string; visited_by: string | null; owner_name: string | null; team_name: string | null; visits: number; sales: number }
/** Visitas por quien visitó (vendedor de calle), bajo quien lleva el comercio. Las de la Sales App y las que no dicen quién fue van como "sin nombre". */
const fieldVisitors = async (tx: Tx, scope: ReportScope, f: FieldFilters, since: string): Promise<FieldVisitorRow[]> => {
  const rows = await tx<FieldVisitorRow[]>`
    select date_trunc('week', v.business_date)::date::text as week, v.market_code, nullif(btrim(v.visited_by), '') as visited_by, u.full_name as owner_name, tm.name as team_name,
           count(*)::int as visits, count(*) filter (where v.outcome = 'sale')::int as sales
      from crm.visit_log v left join crm.users u on u.id = v.owner_id left join lateral ${ownerTeam(tx, 'v')} tm on true
     where v.business_date >= ${since}::date and ${inScope(tx, scope, 'v')} ${f.market ? tx`and v.market_code = ${f.market}` : tx``} ${ownerFilter(tx, 'v', f.owner)} ${teamFilter(tx, 'v', f.team)}
     group by 1, v.market_code, 3, u.full_name, tm.name order by week desc, v.market_code, 3 nulls last, u.full_name nulls last`
  return [...rows]
}

/**
 * El número de los viernes: puntos de venta dados de alta y negocios ganados por semana y por territorio (o plaza),
 * y visitas por persona. Semana de lunes a domingo en la zona del mercado.
 */
export async function getFieldReport(ctx: Ctx, f: FieldFilters) {
  const scope = reportScope(ctx)
  const weeks = lastWeeks(ctx, f.weeks ?? 8)
  const since = weeks[weeks.length - 1]!
  return withUser(ctx.user.id, async (tx) => ({ weeks, places: await fieldPlaces(tx, scope, f, since), visits: await fieldVisits(tx, scope, f, since), visitors: await fieldVisitors(tx, scope, f, since) }))
}
export async function fieldReportForExport(tx: Tx, ctx: Ctx, f: FieldFilters) {
  const scope = reportScope(ctx)
  const weeks = lastWeeks(ctx, f.weeks ?? 8)
  const since = weeks[weeks.length - 1]!
  return { weeks, places: await fieldPlaces(tx, scope, f, since), visits: await fieldVisits(tx, scope, f, since), visitors: await fieldVisitors(tx, scope, f, since) }
}

/** Cómo se gana cada embudo activo de los mercados dados: el texto del panel sale de esta configuración, no de una frase fija. */
export async function closeRules(ctx: Ctx, markets: string[]): Promise<{ byTransaction: number; byHand: number }> {
  if (markets.length === 0) return { byTransaction: 0, byHand: 0 }
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ by_txn: number; by_hand: number }[]>`
      select count(*) filter (where p.close_by_transaction)::int as by_txn, count(*) filter (where not p.close_by_transaction)::int as by_hand
        from crm.pipelines p where p.is_active and p.market_code = any(${markets}::text[])`
    return { byTransaction: rows[0]?.by_txn ?? 0, byHand: rows[0]?.by_hand ?? 0 }
  })
}
