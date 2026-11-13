import 'server-only'
import { marketToday, withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isUuid } from '@/lib/ids'

export type ExceptionItem = {
  id: string
  market_code: string
  kind: string
  severity: 'low' | 'medium' | 'high'
  account_id: string | null
  deal_id: string | null
  lead_id: string | null
  owner_id: string | null
  owner_name: string | null
  detail: Record<string, unknown>
  opened_at: Date
}

export type RepRow = {
  id: string
  full_name: string
  market_code: string
  team: string | null
  leads_open: number
  leads_overdue: number
  sla_met: number
  sla_judged: number
  /** De los leads juzgados, con cuántos se logró hablar. Un intento a tiempo no es un contacto. */
  reached: number
  deals_open: number
  no_next_step: number
  stalled: number
  revisits: number
  awaiting: number
  visits_7d: number
  sales_7d: number
  accounts: number
  team_id: string | null
  role: 'rep' | 'supervisor' | 'market_lead'
  /** Ventas de su cartera en los 30 días del archivo de S5 más reciente; null si ningún comercio suyo trae dato. */
  txn_30d: number | null
  /** Lo mismo, 30 días antes. null si S5 no trajo ese archivo: no se inventa la comparación. */
  txn_prev_30d: number | null
  /** Las ventas de hoy de los mismos comercios que sí tienen dato de 30 días antes: la comparación es entre los mismos comercios. */
  txn_cmp_30d: number | null
}

/** CAMPO-04: el tablero es del supervisor; el vendedor no captura nada extra para alimentarlo. */
export async function getSupervisorBoard(ctx: Ctx, f: { market?: string; kind?: string; owner?: string; team?: string }) {
  return withUser(ctx.user.id, async (tx) => {
    // Todos los que venden en el alcance de quien mira: ventas siempre; supervisión y quien lidera, cuando llevan registros propios.
    // Las ventas de la cartera vienen del archivo de S5: el más reciente de cada comercio y, si existe, el de 30 días antes (hasta 7 días de tolerancia).
    const reps = await tx<RepRow[]>`
      select distinct on (x.market_code, x.team, x.full_name, x.id) x.* from (
      select u.id, u.full_name, m.market_code, t.name as team, m.team_id, m.role,
             (select count(*)::int from crm.leads l where l.owner_id = u.id and l.status in ('new','contacted','qualified')) as leads_open,
             (select count(*)::int from crm.leads l where l.owner_id = u.id and l.status = 'new' and l.first_touch_at is null and l.sla_due_at < now()) as leads_overdue,
             (select count(*)::int from crm.leads l where l.owner_id = u.id and l.created_at > now() - interval '14 days' and l.first_touch_at <= l.sla_due_at) as sla_met,
             (select count(*)::int from crm.leads l where l.owner_id = u.id and l.created_at > now() - interval '14 days' and (l.first_touch_at is not null or l.sla_due_at < now())) as sla_judged,
             (select count(*)::int from crm.leads l where l.owner_id = u.id and l.created_at > now() - interval '14 days' and (l.first_touch_at is not null or l.sla_due_at < now()) and (l.status in ('contacted','qualified','converted') or exists (select 1 from crm.activities x where x.lead_id = l.id and x.outcome = 'reached'))) as reached,
             (select count(*)::int from crm.deals d where d.owner_id = u.id and d.status = 'open') as deals_open,
             (select count(*)::int from crm.exceptions e where e.owner_id = u.id and e.resolved_at is null and e.kind = 'no_next_step') as no_next_step,
             (select count(*)::int from crm.exceptions e where e.owner_id = u.id and e.resolved_at is null and e.kind = 'stalled_deal') as stalled,
             (select count(*)::int from crm.deals d where d.owner_id = u.id and d.status = 'open' and d.revisit_needed) as revisits,
             (select count(*)::int from crm.deals d join crm.stages s on s.id = d.stage_id where d.owner_id = u.id and d.status = 'open' and s.kind = 'awaiting_txn') as awaiting,
             -- crm.visit_log: visitas de la Sales App y las capturadas a mano; la manual no cuenta si la Sales App trajo la misma (comercio y día).
             (select count(*)::int from crm.visit_log v where v.owner_id = u.id and v.visited_at > now() - interval '9 days' and v.business_date > ${marketToday(tx, tx`v.market_code`)} - 7) as visits_7d,
             (select count(*)::int from crm.visit_log v where v.owner_id = u.id and v.visited_at > now() - interval '9 days' and v.business_date > ${marketToday(tx, tx`v.market_code`)} - 7 and v.outcome = 'sale') as sales_7d,
             (select count(*)::int from crm.accounts a where a.owner_id = u.id and a.archived_at is null) as accounts,
             s5.txn_30d, s5.txn_prev_30d, s5.txn_cmp_30d
        from crm.users u join crm.memberships m on m.user_id = u.id and m.role in ('rep', 'supervisor', 'market_lead') and (m.valid_to is null or m.valid_to > now())
        left join crm.teams t on t.id = m.team_id
        left join lateral (
          select sum(cur.txn_count_30d)::int as txn_30d, sum(prev.txn_count_30d)::int as txn_prev_30d,
                 (sum(cur.txn_count_30d) filter (where prev.txn_count_30d is not null))::int as txn_cmp_30d
            from crm.accounts a
            join lateral (select mm.as_of, mm.txn_count_30d from crm.merchant_metrics_daily mm where mm.account_id = a.id order by mm.as_of desc limit 1) cur on true
            left join lateral (select mm.txn_count_30d from crm.merchant_metrics_daily mm
                                where mm.account_id = a.id and mm.as_of <= cur.as_of - 30 and mm.as_of >= cur.as_of - 37 order by mm.as_of desc limit 1) prev on true
           where a.owner_id = u.id and a.market_code = m.market_code and a.archived_at is null) s5 on true
       where u.is_active and not u.is_system and (m.market_code = any(app.full_markets()) or u.id = any(app.supervised_user_ids()))
         ${f.market ? tx`and m.market_code = ${f.market}` : tx``}
         ${f.team === 'none' ? tx`and m.team_id is null` : isUuid(f.team) ? tx`and m.team_id = ${f.team}` : tx``}
      ) x
       where x.role = 'rep' or x.accounts + x.deals_open + x.leads_open > 0
       order by x.market_code, x.team nulls last, x.full_name, x.id, (x.role = 'rep') desc`
    const metricsAsOf = await tx<{ as_of: string | null }[]>`
      select max(mm.as_of)::text as as_of from crm.merchant_metrics_daily mm where true ${f.market ? tx`and mm.market_code = ${f.market}` : tx``}`
    const queue = await tx<ExceptionItem[]>`
      select e.id, e.market_code, e.kind, e.severity, e.account_id, e.deal_id, e.lead_id, e.owner_id, u.full_name as owner_name, e.detail, e.opened_at
        from crm.exceptions e left join crm.users u on u.id = e.owner_id
       where e.resolved_at is null
         ${f.market ? tx`and e.market_code = ${f.market}` : tx``}
         ${f.team === 'none'
           ? tx`and exists (select 1 from crm.memberships mm where mm.user_id = e.owner_id and mm.market_code = e.market_code and mm.team_id is null and (mm.valid_to is null or mm.valid_to > now()))`
           : isUuid(f.team) ? tx`and exists (select 1 from crm.memberships mm where mm.user_id = e.owner_id and mm.team_id = ${f.team!} and (mm.valid_to is null or mm.valid_to > now()))` : tx``}
         ${f.kind ? tx`and e.kind = ${f.kind}` : tx``}
         ${f.owner === 'none' ? tx`and e.owner_id is null` : isUuid(f.owner) ? tx`and e.owner_id = ${f.owner}` : tx``}
       order by case e.severity when 'high' then 0 when 'medium' then 1 else 2 end, e.opened_at limit 60`
    const byKind = await tx<{ kind: string; n: number }[]>`
      select e.kind, count(*)::int as n from crm.exceptions e where e.resolved_at is null
        ${f.market ? tx`and e.market_code = ${f.market}` : tx``}
        ${f.team === 'none'
           ? tx`and exists (select 1 from crm.memberships mm where mm.user_id = e.owner_id and mm.market_code = e.market_code and mm.team_id is null and (mm.valid_to is null or mm.valid_to > now()))`
           : isUuid(f.team) ? tx`and exists (select 1 from crm.memberships mm where mm.user_id = e.owner_id and mm.team_id = ${f.team!} and (mm.valid_to is null or mm.valid_to > now()))` : tx``}
       group by e.kind`
    const last = await tx<{ at: string | null }[]>`select value #>> '{}' as at from crm.settings where key = 'rules_last_run'`
    return { reps: [...reps], queue: [...queue], byKind: Object.fromEntries(byKind.map((k) => [k.kind, k.n])) as Record<string, number>, rulesAt: last[0]?.at ?? null, metricsAsOf: metricsAsOf[0]?.as_of ?? null }
  })
}

export type MarketKpis = {
  code: string
  name: string
  currency: string
  leads_30d: number
  leads_qualified_30d: number
  sla_met: number
  sla_judged: number
  /** De los leads juzgados, con cuántos se logró hablar. Un intento a tiempo no es un contacto. */
  reached: number
  deals_open: number
  awaiting_txn: number
  won_30d: number
  lost_30d: number
  days_to_first_txn: number | null
  revisits: number
  activation_risk: number
  accounts_active: number
  accounts_at_risk: number
  accounts_inactive: number
  accounts_onboarding: number
  volume_30d: string
  usd_rate: string | null
  as_of: string | null
}

/**
 * REP-01 / REP-04: los números del LT salen de una sola consulta y llevan fecha de corte.
 * Lo transaccional (volumen, actividad) viene del archivo diario de S5; el CRM no recalcula ventas.
 */
export async function getLtPanel(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<MarketKpis[]>`
      select m.code, m.name, m.currency,
             (select count(*)::int from crm.leads l where l.market_code = m.code and l.created_at > now() - interval '30 days') as leads_30d,
             (select count(*)::int from crm.leads l where l.market_code = m.code and l.created_at > now() - interval '30 days' and l.status in ('qualified','converted')) as leads_qualified_30d,
             (select count(*)::int from crm.leads l where l.market_code = m.code and l.created_at > now() - interval '30 days' and l.first_touch_at <= l.sla_due_at) as sla_met,
             (select count(*)::int from crm.leads l where l.market_code = m.code and l.created_at > now() - interval '30 days' and (l.first_touch_at is not null or l.sla_due_at < now())) as sla_judged,
             (select count(*)::int from crm.leads l where l.market_code = m.code and l.created_at > now() - interval '30 days' and (l.first_touch_at is not null or l.sla_due_at < now()) and (l.status in ('contacted','qualified','converted') or exists (select 1 from crm.activities x where x.lead_id = l.id and x.outcome = 'reached'))) as reached,
             (select count(*)::int from crm.deals d where d.market_code = m.code and d.status = 'open') as deals_open,
             (select count(*)::int from crm.deals d join crm.stages s on s.id = d.stage_id where d.market_code = m.code and d.status = 'open' and s.kind = 'awaiting_txn') as awaiting_txn,
             (select count(*)::int from crm.deals d where d.market_code = m.code and d.status = 'won' and d.won_at > now() - interval '30 days') as won_30d,
             (select count(*)::int from crm.deals d where d.market_code = m.code and d.status = 'lost' and d.lost_at > now() - interval '30 days') as lost_30d,
             (select round(avg(extract(epoch from (d.won_at - d.created_at)) / 86400))::int from crm.deals d
               where d.market_code = m.code and d.status = 'won' and d.closed_by = 'transaction' and d.won_at > now() - interval '90 days' and d.won_at > d.created_at) as days_to_first_txn,
             (select count(*)::int from crm.deals d where d.market_code = m.code and d.status = 'open' and d.revisit_needed) as revisits,
             (select count(*)::int from crm.exceptions e where e.market_code = m.code and e.resolved_at is null and e.kind = 'activation_risk') as activation_risk,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null and a.lifecycle = 'active') as accounts_active,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null and a.lifecycle = 'at_risk') as accounts_at_risk,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null and a.lifecycle = 'inactive') as accounts_inactive,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null and a.lifecycle = 'onboarding') as accounts_onboarding,
             coalesce((select sum(x.volume_minor_30d) from (
                 select distinct on (mm.account_id) mm.volume_minor_30d from crm.merchant_metrics_daily mm
                  where mm.market_code = m.code order by mm.account_id, mm.as_of desc) x), 0)::text as volume_30d,
             -- MULTI-01 (0026_markets): la tasa vigente en la fecha de corte del archivo de ventas, no la de hoy: el consolidado se reproduce.
             (select r.usd_rate::text from app.fx_at(m.currency, coalesce((select max(mm.as_of) from crm.merchant_metrics_daily mm where mm.market_code = m.code), ${marketToday(tx, tx`m.code`)})) r
               where trim(m.currency) <> 'USD') as usd_rate,
             (select max(mm.as_of)::text from crm.merchant_metrics_daily mm where mm.market_code = m.code) as as_of
        from crm.markets m
       where m.code = any(app.full_markets()) and m.status = 'live' order by m.code`
    const reasons = await tx<{ market_code: string; code: string; label_es: string; label_en: string; n: number }[]>`
      select d.market_code, r.code, r.label_es, r.label_en, count(*)::int as n
        from crm.deals d join crm.loss_reasons r on r.code = d.loss_reason_code
       where d.status = 'lost' and d.market_code = any(app.full_markets()) group by 1, 2, 3, 4 order by n desc limit 8`
    const noSale = await tx<{ code: string; label_es: string; label_en: string; n: number }[]>`
      select r.code, r.label_es, r.label_en, count(*)::int as n from crm.visits v join crm.loss_reasons r on r.code = v.rejection_code
       where v.business_date > ${marketToday(tx, tx`v.market_code`)} - 14 and v.market_code = any(app.full_markets()) group by 1, 2, 3 order by n desc limit 6`
    return { markets: [...rows], reasons: [...reasons], noSale: [...noSale] }
  })
}

export async function track(ctx: Ctx, event: string): Promise<void> {
  // Quien ve como otra persona no deja uso a nombre de esa persona.
  if (ctx.user.isSystem || ctx.viewAs) return
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.usage_events (user_id, event)
             select ${ctx.user.id}, ${event} where not exists (
               select 1 from crm.usage_events where user_id = ${ctx.user.id} and event = ${event} and at > now() - interval '1 hour')`
  })
}

/**
 * Lo que el dock necesita saber en cada pantalla: cuántos leads propios o sin dueño (los que la persona puede tomar) tienen el reloj
 * de primer contacto corriendo. Los que llegaron de una importación no traen reloj y no cuentan aquí.
 * `latest` es cuándo llegó (o se le asignó) el más reciente: con eso la app abierta sabe que entró uno nuevo aunque el total no cambie.
 */
export async function dockCounts(ctx: Ctx): Promise<{ leadsWaiting: number; latest: string | null; latestName: string | null }> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ n: number; latest: Date | null; name: string | null }[]>`
      select count(*)::int as n, max(greatest(l.created_at, coalesce(l.assigned_at, l.created_at))) as latest,
             (array_agg(l.business_name order by greatest(l.created_at, coalesce(l.assigned_at, l.created_at)) desc))[1] as name
        from crm.leads l
       where l.status = 'new' and l.first_touch_at is null and l.sla_due_at is not null and (l.owner_id = ${ctx.user.id} or (l.owner_id is null and ${ctx.can('lead.work')}))`
    return { leadsWaiting: rows[0]?.n ?? 0, latest: rows[0]?.latest ? new Date(rows[0].latest).toISOString() : null, latestName: rows[0]?.name ?? null }
  })
}

export type LeadWatchRow = {
  /** LEAD-04: 0 sin escalar, 1 avisado a supervisión, 2 avisado a quien lidera. */
  escalation_level: number
  escalated_at: Date | null
  id: string
  business_name: string
  market_code: string
  motor: string
  owner_id: string | null
  owner_name: string | null
  created_at: Date
  sla_due_at: Date
  /** Minutos de horario hábil del mercado que quedan para la meta de primer contacto. 0 si ya pasó. */
  minutes_left: number
  late: boolean
}

/**
 * La guardia de leads: los que tienen la meta de primer contacto corriendo (o ya vencida) y nadie ha intentado, con los minutos
 * que quedan contados en el horario hábil del mercado, igual que la fecha de vencimiento (app.business_due).
 * Con un equipo elegido salen solo los de su gente; sin equipo elegido también salen los que nadie lleva.
 */
export async function getLeadWatch(ctx: Ctx, f: { market?: string; team?: string }): Promise<LeadWatchRow[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<LeadWatchRow[]>`
      select l.id, l.business_name, l.market_code, l.motor, l.owner_id, u.full_name as owner_name, l.created_at, l.sla_due_at,
             (l.sla_due_at < now()) as late, l.escalation_level, l.escalated_at,
             coalesce((
               select round(sum(greatest(0, extract(epoch from (
                        least(l.sla_due_at at time zone mk.timezone, g.d + coalesce(h.closes, time '18:00'))
                        - greatest(now() at time zone mk.timezone, g.d + coalesce(h.opens, time '09:00'))))) / 60.0))::int
                 from generate_series((now() at time zone mk.timezone)::date::timestamp, (l.sla_due_at at time zone mk.timezone)::date::timestamp, interval '1 day') g(d)
                where extract(isodow from g.d)::int = any(coalesce(h.days, '{1,2,3,4,5}'::int[]))), 0) as minutes_left
        from crm.leads l
        join crm.markets mk on mk.code = l.market_code
        left join crm.market_hours h on h.market_code = l.market_code
        left join crm.users u on u.id = l.owner_id
       where l.status = 'new' and l.first_touch_at is null and l.sla_due_at is not null
         and l.sla_due_at > now() - interval '7 days'
         ${f.market ? tx`and l.market_code = ${f.market}` : tx``}
         ${f.team === 'none'
           ? tx`and exists (select 1 from crm.memberships mm where mm.user_id = l.owner_id and mm.market_code = l.market_code and mm.team_id is null and (mm.valid_to is null or mm.valid_to > now()))`
           : isUuid(f.team) ? tx`and exists (select 1 from crm.memberships mm where mm.user_id = l.owner_id and mm.team_id = ${f.team!} and (mm.valid_to is null or mm.valid_to > now()))` : tx``}
       order by l.sla_due_at limit 25`
    return [...rows]
  })
}

/** Quién está o estuvo en un equipo ("none": quien vende sin equipo). Sirve para filtrar por equipo lo que quedó a nombre de alguien que ya no está. */
export async function teamPeople(ctx: Ctx, team: string): Promise<Set<string>> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ user_id: string }[]>`
      select distinct m.user_id from crm.memberships m
       where ${team === 'none' ? tx`m.team_id is null and m.role in ('rep', 'supervisor', 'market_lead')` : isUuid(team) ? tx`m.team_id = ${team}` : tx`false`}`
    return new Set(rows.map((r) => r.user_id))
  })
}
