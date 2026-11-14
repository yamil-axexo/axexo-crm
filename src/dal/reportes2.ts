import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { ROLE_LABEL, type Role } from '@/domain/policy'

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

// ------------------------------------------------------------------ valores propuestos y personas con su ID en S5
/** Los valores que dependen de otra persona, como están guardados (con `proposed` y `pending`). */
export async function proposedValues(tx: import('@/server/db').Tx): Promise<Record<string, Record<string, unknown> & { proposed?: boolean; pending?: string; value?: unknown }>> {
  const rows = await tx<{ key: string; value: Record<string, unknown> }[]>`
    select key, value from crm.settings where key in ('ingest.require_manifest','snapshots.window_days','quality.exception_rules','adoption.rollout_rule','orders.brand')`
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** Lo que sigue como propuesta, con quién lo tiene: lo lista Estado de CONTIGO. Incluye los tableros por rol sin confirmar. */
export async function pendingDecisions(ctx: Ctx): Promise<{ key: string; label: [string, string]; pending: string }[]> {
  return withUser(ctx.user.id, async (tx) => {
    const pv = await proposedValues(tx)
    const LABEL: Record<string, [string, string]> = {
      'ingest.require_manifest': ['Manifiesto obligatorio en el archivo de ventas', 'Manifest required in the sales file'],
      'snapshots.window_days': ['Ventana corta de la foto diaria', 'Short window of the daily snapshot'],
      'quality.exception_rules': ['Reglas de calidad que abren avisos', 'Data quality rules that open notices'],
      'adoption.rollout_rule': ['Regla de paso a despliegue', 'Rollout readiness rule'],
      'orders.brand': ['Plantilla de marca del pedido (logotipo y encabezado)', 'Order brand template (logo and header)'],
    }
    const out = Object.entries(pv).filter(([, v]) => v.proposed !== false).map(([k, v]) => ({ key: k, label: LABEL[k] ?? [k, k], pending: String(v.pending ?? '') }))
    const boards = await tx<{ role: string; pending_owner: string }[]>`select role, min(pending_owner) as pending_owner from crm.role_boards where not confirmed group by role order by role`
    for (const b of boards) {
      const r = ROLE_LABEL[b.role as Role] ?? { es: b.role, en: b.role }
      out.push({ key: `role_board.${b.role}`, label: [`Indicadores del tablero: ${r.es}`, `Board indicators: ${r.en}`], pending: b.pending_owner })
    }
    return out
  })
}

export async function peopleAliases(ctx: Ctx): Promise<{ id: string; full_name: string; s5: string | null; since: string | null }[]> {
  return withUser(ctx.user.id, (tx) => tx<{ id: string; full_name: string; s5: string | null; since: string | null }[]>`
    select u.id, u.full_name, al.external_id as s5, al.valid_from::text as since
      from crm.users u left join crm.user_aliases al on al.user_id = u.id and al.system = 's5' and al.valid_to is null
     where u.is_active and not u.is_system
       and exists (select 1 from crm.memberships m where m.user_id = u.id and m.role = any(app.owner_roles()) and (m.valid_to is null or m.valid_to > now()))
     order by u.full_name limit 300`)
}

// ------------------------------------------------------------------ GOB-03: colas atendidas y 1:1 con el tablero
export type UsageExtra = { user_id: string; queue_done: number; one_on_ones: number }
/** Por persona: avisos de su cola que atendió a mano (4 semanas) y 1:1 hechas con el tablero (30 días, como quien supervisa o como persona). */
export async function usageExtra(ctx: Ctx, userIds: string[]): Promise<UsageExtra[]> {
  if (!userIds.length) return []
  return withUser(ctx.user.id, (tx) => tx<UsageExtra[]>`
    select u.id as user_id,
           (select count(*)::int from crm.exceptions e where e.resolved_by = u.id and e.resolved_at > now() - interval '28 days' and coalesce(e.resolution, '') not in ('auto', 'auto_cleared', 'merged')) as queue_done,
           (select count(*)::int from crm.one_on_ones o where (o.person_id = u.id or o.supervisor_id = u.id) and o.created_at > now() - interval '30 days') as one_on_ones
      from crm.users u where u.id = any(${userIds}::uuid[])`)
}
export async function rolloutRule(ctx: Ctx): Promise<{ supervisor_weeks: number; one_on_ones_min: number; result: string; proposed: boolean; pending: string }> {
  return withUser(ctx.user.id, async (tx) => {
    const r = await tx<{ value: Record<string, unknown> }[]>`select value from crm.settings where key = 'adoption.rollout_rule'`
    const v = r[0]?.value ?? {}
    return { supervisor_weeks: Number(v.supervisor_weeks ?? 3), one_on_ones_min: Number(v.one_on_ones_min ?? 1), result: String(v.result ?? 'active_30d'), proposed: v.proposed !== false, pending: String(v.pending ?? '') }
  })
}
/** Personas que quien supervisa puede anotar en una 1:1 (su equipo, sin incluirse). */
export async function oneOnOnePeople(ctx: Ctx): Promise<{ id: string; full_name: string }[]> {
  return withUser(ctx.user.id, (tx) => tx<{ id: string; full_name: string }[]>`
    select u.id, u.full_name from crm.users u where u.id = any(app.supervised_user_ids()) and u.id <> app.current_user_id() and u.is_active order by u.full_name`)
}

// ------------------------------------------------------------------ REP-01: el Panel del LT por tipo de venta (los cuatro motores)
export type MotorSlice = { motor: string; leads: number; open: number; awaiting: number; won: number; lost: number }
/** Por tipo de venta, sumando todos los mercados que ve quien mira (RLS). Ganados, perdidos y leads: últimos 30 días; abiertos: hoy. */
export async function motorSlices(ctx: Ctx, market?: string): Promise<MotorSlice[]> {
  return withUser(ctx.user.id, (tx) => tx<MotorSlice[]>`
    with m as (select distinct motor from crm.pipelines ${market ? tx`where market_code = ${market}` : tx``})
    select m.motor,
           (select count(*)::int from crm.leads l where l.motor = m.motor and l.created_at > now() - interval '30 days' ${market ? tx`and l.market_code = ${market}` : tx``}) as leads,
           (select count(*)::int from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.stages s on s.id = d.stage_id where p.motor = m.motor and d.status = 'open' ${market ? tx`and d.market_code = ${market}` : tx``}) as open,
           (select count(*)::int from crm.deals d join crm.pipelines p on p.id = d.pipeline_id join crm.stages s on s.id = d.stage_id where p.motor = m.motor and d.status = 'open' and s.kind = 'awaiting_txn' ${market ? tx`and d.market_code = ${market}` : tx``}) as awaiting,
           (select count(*)::int from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where p.motor = m.motor and d.status = 'won' and d.won_at > now() - interval '30 days' ${market ? tx`and d.market_code = ${market}` : tx``}) as won,
           (select count(*)::int from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where p.motor = m.motor and d.status = 'lost' and d.lost_at > now() - interval '30 days' ${market ? tx`and d.market_code = ${market}` : tx``}) as lost
      from m order by m.motor`)
}

// ------------------------------------------------------------------ E8.F4: personas de los comercios (contactos) como lista con vistas
export type ContactRow = { id: string; full_name: string; role: string; account_id: string; account: string; market_code: string; owner_name: string | null; has_phone: boolean; has_email: boolean }
/**
 * Las personas de los comercios que quien mira puede ver (la RLS de comercios decide). No muestra teléfonos ni correos en la lista:
 * solo si los tiene; el dato se ve en la ficha del comercio.
 */
export async function contactList(ctx: Ctx, f: { q?: string; market?: string; role?: string; owner?: string }): Promise<ContactRow[]> {
  const q = (f.q ?? '').trim().slice(0, 60)
  return withUser(ctx.user.id, (tx) => tx<ContactRow[]>`
    select c.id, c.full_name, ac.role, a.id as account_id, a.name as account, a.market_code, u.full_name as owner_name,
           c.phone is not null as has_phone, c.email is not null as has_email
      from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id join crm.accounts a on a.id = ac.account_id
      left join crm.users u on u.id = a.owner_id
     where ac.valid_to is null and a.archived_at is null
       ${q ? tx`and (c.full_name ilike ${'%' + q + '%'} or a.name ilike ${'%' + q + '%'})` : tx``}
       ${f.market ? tx`and a.market_code = ${f.market}` : tx``}
       ${f.role ? tx`and ac.role = ${f.role}` : tx``}
       ${f.owner === 'me' ? tx`and a.owner_id = ${ctx.user.id}` : tx``}
     order by c.full_name, a.name limit 200`)
}
