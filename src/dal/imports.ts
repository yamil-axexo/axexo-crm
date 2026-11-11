import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { pipedriveConfigured } from '@/server/adapters/pipedrive'

export type ImportRun = {
  id: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  phase: string
  mode: string | null
  stats: { config?: Record<string, number>; extracted?: Record<string, number>; created?: Record<string, number>; updated?: Record<string, number>; skipped?: Record<string, number> }
  issues: { code: string; step: string; detail?: string }[]
  started_at: Date
  updated_at: Date
  finished_at: Date | null
}

/** Estado de la migración para Administración → Pipedrive. Solo conteos y configuración: ningún dato de cliente. */
export async function getImportStatus(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const runs = await tx<ImportRun[]>`
      select id, status, phase, cursor ->> 'mode' as mode, stats, issues, started_at, updated_at, finished_at
        from crm.import_runs where source = 'pipedrive' order by started_at desc limit 5`
    const raw = await tx<{ object: string; total: number; pending: number; skipped: number }[]>`
      select object, count(*)::int as total, count(*) filter (where loaded_at is null)::int as pending,
             count(*) filter (where load_note is not null)::int as skipped
        from crm.import_raw where source = 'pipedrive' and object not like 'cfg:%' group by object order by object`
    const fields = await tx<{ object: string; label_en: string; key: string; data_type: string; mapped_to: string | null; data_class: string }[]>`
      select object, label_en, key, data_type, mapped_to, data_class from crm.field_definitions
       where source = 'pipedrive' and is_active order by object, position`
    const pipelines = await tx<{ id: string; market_code: string; name: string; motor: string; close_by_transaction: boolean; stages: number; open: number; won: number; lost: number }[]>`
      select p.id, p.market_code, p.name, p.motor, p.close_by_transaction,
             (select count(*)::int from crm.stages s where s.pipeline_id = p.id and s.kind in ('open','awaiting_txn')) as stages,
             (select count(*)::int from crm.deals d where d.pipeline_id = p.id and d.status = 'open') as open,
             (select count(*)::int from crm.deals d where d.pipeline_id = p.id and d.status = 'won') as won,
             (select count(*)::int from crm.deals d where d.pipeline_id = p.id and d.status = 'lost') as lost
        from crm.pipelines p join crm.external_refs r on r.internal_id = p.id and r.system = 'pipedrive' and r.object = 'pipeline'
       order by p.market_code, p.position`
    const totals = await tx<{ market_code: string; accounts: number; contacts: number; deals: number; leads: number; activities: number }[]>`
      select m.code as market_code,
             (select count(*)::int from crm.accounts a where a.market_code = m.code and a.archived_at is null) as accounts,
             (select count(*)::int from crm.contacts c where c.market_code = m.code) as contacts,
             (select count(*)::int from crm.deals d where d.market_code = m.code) as deals,
             (select count(*)::int from crm.leads l where l.market_code = m.code) as leads,
             (select count(*)::int from crm.activities x where x.market_code = m.code) as activities
        from crm.markets m where m.status = 'live' order by m.code`
    const users = await tx<{ total: number; with_access: number }[]>`
      select count(*)::int as total,
             count(*) filter (where exists (select 1 from crm.memberships m where m.user_id = r.internal_id and (m.valid_to is null or m.valid_to > now())))::int as with_access
        from crm.external_refs r where r.system = 'pipedrive' and r.object = 'user'`
    const webhooks = await tx<{ id: string; name: string | null; event: string; target: string | null; active: boolean; last_status: string | null }[]>`
      select external_id as id, payload ->> 'name' as name,
             coalesce(payload ->> 'event_action', '*') || '.' || coalesce(payload ->> 'event_object', '*') as event,
             payload ->> 'target' as target, coalesce(payload ->> 'is_active', '1') in ('1', 'true') as active, payload ->> 'last_http_status' as last_status
        from crm.import_raw where source = 'pipedrive' and object = 'cfg:webhook' order by external_id::bigint`
    const inventory = await tx<{ object: string; n: number }[]>`
      select replace(object, 'cfg:', '') as object, count(*)::int as n from crm.import_raw
       where source = 'pipedrive' and object in ('cfg:filter', 'cfg:role', 'cfg:permission_set', 'cfg:activity_type', 'cfg:lead_label') group by object order by object`
    return {
      configured: pipedriveConfigured(),
      run: runs[0] ?? null,
      history: [...runs],
      raw: [...raw],
      fields: [...fields],
      pipelines: [...pipelines],
      totals: [...totals],
      users: users[0] ?? { total: 0, with_access: 0 },
      webhooks: [...webhooks],
      inventory: [...inventory],
    }
  })
}
