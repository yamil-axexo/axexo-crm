import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type LoadRow = {
  key: string; label_es: string; label_en: string; job_key: string | null; owner_id: string | null; owner_name: string | null
  expected_by: string | null; clock_market: string | null
  last_status: string | null; last_started_at: Date | null; last_finished_at: Date | null; last_done: number | null; last_note: string | null; last_error: string | null
  last_ok_at: Date | null; running: boolean
}
export type LoadWindow = { market_code: string; starts_local: string; ends_local: string; is_active: boolean; now_paused: boolean }

/** E5.F3/F5: cada carga con su responsable, su hora y lo que hizo la última vez. */
export async function getLoads(ctx: Ctx): Promise<{ loads: LoadRow[]; windows: LoadWindow[]; people: { id: string; full_name: string }[] }> {
  return withUser(ctx.user.id, async (tx) => {
    const loads = await tx<LoadRow[]>`
      select l.key, l.label_es, l.label_en, l.job_key, l.owner_id, u.full_name as owner_name, to_char(l.expected_by, 'HH24:MI') as expected_by, l.clock_market,
             r.status as last_status, r.started_at as last_started_at, r.finished_at as last_finished_at, r.done as last_done, r.note as last_note, r.error as last_error,
             (select max(x.finished_at) from crm.load_runs x where x.load_key = l.key and x.status = 'ok') as last_ok_at,
             exists (select 1 from crm.load_runs x where x.load_key = l.key and x.status = 'running') as running
        from crm.data_loads l left join crm.users u on u.id = l.owner_id
        left join lateral (select * from crm.load_runs x where x.load_key = l.key order by x.started_at desc limit 1) r on true
       order by array_position(array['pipedrive','sales_file','store_sales','sales_app','imports'], l.key)`
    const windows = await tx<LoadWindow[]>`
      select m.code as market_code, coalesce(to_char(w.starts_local, 'HH24:MI'), '') as starts_local, coalesce(to_char(w.ends_local, 'HH24:MI'), '') as ends_local,
             coalesce(w.is_active, false) as is_active, app.in_maintenance(m.code) as now_paused
        from crm.markets m left join crm.load_windows w on w.market_code = m.code
       where m.code = any(${ctx.markets.map((x) => x.code)}::text[]) order by m.code`
    const people = ctx.can('load.configure')
      ? await tx<{ id: string; full_name: string }[]>`select u.id, u.full_name from crm.users u where u.is_active and not u.is_system
          and exists (select 1 from crm.memberships m where m.user_id = u.id and m.role in ('admin','market_lead','lt','ops') and (m.valid_to is null or m.valid_to > now()))
          order by u.full_name limit 200`
      : []
    return { loads: [...loads], windows: [...windows], people: [...people] }
  })
}
