import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

// ------------------------------------------------------------------ REP-03: envíos del pronóstico
export type Submission = { id: string; version: number; submitter_name: string; period_from: string; period_to: string; n: number; totals: Record<string, { n: number; amount_minor: number }>; submitted_at: string; market_code: string }
/** Los envíos de una persona (o, sin persona, los que quien mira puede ver), del más reciente al más viejo. */
export async function forecastSubmissions(ctx: Ctx, who: string | null, limit = 12): Promise<Submission[]> {
  return withUser(ctx.user.id, (tx) => tx<Submission[]>`
    select id, version, submitter_name, period_from::text, period_to::text, jsonb_array_length(rows)::int as n, totals, submitted_at::text, market_code
      from crm.forecast_submissions where ${who ? tx`submitted_by = ${who}` : tx`true`}
     order by submitted_at desc limit ${limit}`)
}

// ------------------------------------------------------------------ REP-02: cohortes por semana, canal o persona, y foto por equipo
export type CohortCut = 'semana' | 'canal' | 'persona'
export type CohortRow = { key: string; label: string; market_code: string; leads: number; c30: number; c60: number; c90: number; age_days: number }
/**
 * Leads agrupados por semana de alta (en la zona del mercado), por canal (fuente) o por quien los lleva, convertidos a 30/60/90 días.
 * Mismo alcance que el resto del histórico: mercado completo o el equipo de quien supervisa (RLS y el alcance del reporte).
 */
export async function getCohorts(ctx: Ctx, cut: CohortCut, market?: string): Promise<CohortRow[]> {
  const { reportScope } = await import('@/dal/reports')
  const s = reportScope(ctx)
  return withUser(ctx.user.id, async (tx) => {
    const key = cut === 'semana' ? tx`to_char(date_trunc('week', (l.created_at at time zone mk.timezone)), 'YYYY-MM-DD')`
      : cut === 'canal' ? tx`coalesce(l.source, 'unknown')` : tx`coalesce(l.owner_id::text, 'none')`
    const rows = await tx<CohortRow[]>`
      select ${key} as key, max(coalesce(${cut === 'persona' ? tx`u.full_name` : tx`null::text`}, '')) as label, l.market_code, count(*)::int as leads,
             count(*) filter (where dd.at <= l.created_at + interval '30 days')::int as c30,
             count(*) filter (where dd.at <= l.created_at + interval '60 days')::int as c60,
             count(*) filter (where dd.at <= l.created_at + interval '90 days')::int as c90,
             floor(extract(epoch from (now() - max(l.created_at))) / 86400)::int as age_days
        from crm.leads l join crm.markets mk on mk.code = l.market_code left join crm.users u on u.id = l.owner_id
        left join lateral (select min(d.created_at) as at from crm.deals d where d.lead_id = l.id) dd on true
       where l.created_at >= now() - interval '120 days'
         and (l.market_code = any(${s.full}::text[]) or (l.market_code = any(${s.team}::text[]) and l.owner_id = any((select app.supervised_user_ids())::uuid[])))
         ${market ? tx`and l.market_code = ${market}` : tx``}
       group by 1, l.market_code order by 1 desc, l.market_code limit 60`
    return [...rows]
  })
}

export type TeamSnapshot = { day: string; market_code: string; team: string; open_deals: number; no_next_step: number; active_accounts: number; at_risk_accounts: number }
/** La foto diaria por equipo: quien supervisa ve la de su equipo; quien lidera el mercado, todas las de su mercado (RLS). */
export async function teamSnapshots(ctx: Ctx, market?: string): Promise<TeamSnapshot[]> {
  return withUser(ctx.user.id, (tx) => tx<TeamSnapshot[]>`
    select s.snapshot_date::text as day, s.market_code, t.name as team, s.open_deals, s.no_next_step, s.active_accounts, s.at_risk_accounts
      from crm.team_snapshots s join crm.teams t on t.id = s.team_id
     where s.snapshot_date >= (now() - interval '45 days')::date ${market ? tx`and s.market_code = ${market}` : tx``}
     order by s.snapshot_date desc, t.name limit 90`)
}
