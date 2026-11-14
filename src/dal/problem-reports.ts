import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type ReportRow = {
  id: string; kind: string; body: string; screen: string | null; urgency: string; status: string
  answer: string | null; answered_at: Date | null; answered_by_name: string | null; created_at: Date
  user_id: string; user_name: string
  taken_at: Date | null; taken_by_name: string | null
  /** Plazo de respuesta en horas según la urgencia, si administración lo definió para algún mercado de quien reportó. */
  target_hours: number | null
}

const COLS = (tx: Parameters<Parameters<typeof withUser>[1]>[0]) => tx`
  r.id, r.kind, r.body, r.screen, r.urgency, r.status, r.answer, r.answered_at, r.created_at, r.user_id,
  u.full_name as user_name, ab.full_name as answered_by_name, r.taken_at, tb.full_name as taken_by_name,
  (select min(case r.urgency when 'high' then c.support_hours_high when 'normal' then c.support_hours_normal else c.support_hours_low end)
     from crm.market_comms c
    where c.market_code in (select m.market_code from crm.memberships m where m.user_id = r.user_id and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
       or not exists (select 1 from crm.memberships m where m.user_id = r.user_id and m.market_code is not null and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())))::int as target_hours`

/** Los reportes de la persona, los más recientes primero. RLS no deja ver los de nadie más. */
export async function myReports(ctx: Ctx): Promise<ReportRow[]> {
  return withUser(ctx.user.id, (tx) => tx<ReportRow[]>`
    select ${COLS(tx)}
      from crm.problem_reports r
      join crm.users u on u.id = r.user_id
      left join crm.users ab on ab.id = r.answered_by
      left join crm.users tb on tb.id = r.taken_by
     where r.user_id = ${ctx.user.id}
     order by r.created_at desc
     limit 50`)
}

/** Todos los reportes, para administración: primero los abiertos, con los urgentes arriba. */
export async function allReports(ctx: Ctx, status: 'open' | 'answered' | 'all'): Promise<{ rows: ReportRow[]; open: number; answered: number }> {
  ctx.assert('report.manage')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<ReportRow[]>`
      select ${COLS(tx)}
        from crm.problem_reports r
        join crm.users u on u.id = r.user_id
        left join crm.users ab on ab.id = r.answered_by
      left join crm.users tb on tb.id = r.taken_by
       where ${status === 'all' ? tx`true` : tx`r.status = ${status}`}
       order by (r.status = 'open') desc, (case r.urgency when 'high' then 0 when 'normal' then 1 else 2 end), r.created_at desc
       limit 200`
    const counts = await tx<{ open: number; answered: number }[]>`
      select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'answered')::int as answered from crm.problem_reports`
    return { rows, open: counts[0]?.open ?? 0, answered: counts[0]?.answered ?? 0 }
  })
}
