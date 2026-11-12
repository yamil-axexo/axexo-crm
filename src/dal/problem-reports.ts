import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type ReportRow = {
  id: string; kind: string; body: string; screen: string | null; urgency: string; status: string
  answer: string | null; answered_at: Date | null; answered_by_name: string | null; created_at: Date
  user_id: string; user_name: string
}

const COLS = (tx: Parameters<Parameters<typeof withUser>[1]>[0]) => tx`
  r.id, r.kind, r.body, r.screen, r.urgency, r.status, r.answer, r.answered_at, r.created_at, r.user_id,
  u.full_name as user_name, ab.full_name as answered_by_name`

/** Los reportes de la persona, los más recientes primero. RLS no deja ver los de nadie más. */
export async function myReports(ctx: Ctx): Promise<ReportRow[]> {
  return withUser(ctx.user.id, (tx) => tx<ReportRow[]>`
    select ${COLS(tx)}
      from crm.problem_reports r
      join crm.users u on u.id = r.user_id
      left join crm.users ab on ab.id = r.answered_by
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
       where ${status === 'all' ? tx`true` : tx`r.status = ${status}`}
       order by (r.status = 'open') desc, (case r.urgency when 'high' then 0 when 'normal' then 1 else 2 end), r.created_at desc
       limit 200`
    const counts = await tx<{ open: number; answered: number }[]>`
      select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'answered')::int as answered from crm.problem_reports`
    return { rows, open: counts[0]?.open ?? 0, answered: counts[0]?.answered ?? 0 }
  })
}
