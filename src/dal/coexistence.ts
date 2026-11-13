import 'server-only'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'

type Pair = [es: string, en: string]

/** Un choque por decidir, con los dos valores ya dichos como los lee una persona (nombres, no identificadores). */
export type Conflict = {
  id: string; object: 'account' | 'contact' | 'deal'; record_id: string; market_code: string; record_label: string | null; field: string
  contigo: string | null; pipedrive: string | null; detected_at: Date
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function names(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!ids.length) return out
  for (const r of await tx<{ id: string; name: string }[]>`
    select id, full_name as name from crm.users where id = any(${ids}::uuid[])
    union all select id, name from crm.territories where id = any(${ids}::uuid[])
    union all select s.id, s.name_es || ' / ' || s.name_en from crm.stages s where s.id = any(${ids}::uuid[])`) out.set(r.id, r.name)
  return out
}

export async function getConflicts(ctx: Ctx, limit = 100): Promise<{ rows: Conflict[]; open: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<(Omit<Conflict, 'contigo' | 'pipedrive'> & { contigo_value: unknown; pipedrive_value: unknown })[]>`
      select id, object, record_id, market_code, record_label, field, contigo_value, pipedrive_value, detected_at
        from crm.import_conflicts where status = 'open' order by detected_at desc, id limit ${limit}`
    const total = await tx<{ n: number }[]>`select count(*)::int as n from crm.import_conflicts where status = 'open'`
    const raw = (v: unknown, field: string): string | null => {
      if (v === null || v === undefined) return null
      if (typeof v === 'object') return String((v as Record<string, unknown>)[field] ?? '') || null
      return String(v)
    }
    const ids = rows.flatMap((r) => [raw(r.contigo_value, r.field), raw(r.pipedrive_value, r.field)]).filter((x): x is string => Boolean(x && UUID.test(x)))
    const nm = await names(tx, [...new Set(ids)])
    const say = (v: string | null) => (v && UUID.test(v) ? (nm.get(v) ?? v) : v)
    return {
      open: total[0]?.n ?? 0,
      rows: rows.map((r) => ({ id: r.id, object: r.object, record_id: r.record_id, market_code: r.market_code, record_label: r.record_label, field: r.field,
        detected_at: r.detected_at, contigo: say(raw(r.contigo_value, r.field)), pipedrive: say(raw(r.pipedrive_value, r.field)) })),
    }
  })
}

export type Criterion = { key: string; ok: boolean; label: Pair; detail: Pair }
export type MarketCutover = {
  market: string; name: string; cutoff_on: string | null; frozen_at: Date | null; last_sync_at: Date | null; pipedrive_off_at: Date | null
  loaded: number; open_conflicts: number; pending_rebuild: number; criteria: Criterion[]
}

/**
 * GOB-05: convivencia por mercado. Por cada mercado vivo, los criterios de salida medidos y qué falta para apagar Pipedrive.
 * Los criterios son los mismos para todos los mercados y se miden aquí, no se marcan a mano.
 */
export async function getCutover(ctx: Ctx): Promise<MarketCutover[]> {
  return withUser(ctx.user.id, async (tx) => {
    const lastRun = await tx<{ finished_at: Date | null; skipped: number }[]>`
      select finished_at, coalesce((select sum(value::bigint) from jsonb_each_text(stats -> 'skipped')), 0)::int as skipped
        from crm.import_runs where source = 'pipedrive' and status = 'done' and cursor ->> 'mode' <> 'remap' order by started_at desc limit 1`
    const rows = await tx<{ market: string; name: string; cutoff_on: string | null; frozen_at: Date | null; last_sync_at: Date | null; pipedrive_off_at: Date | null; loaded: number; open_conflicts: number; pending_rebuild: number }[]>`
      select m.code as market, m.name, c.cutoff_on::text, c.frozen_at, c.last_sync_at, c.pipedrive_off_at,
             (select count(*)::int from crm.account_aliases al where al.system = 'pipedrive' and al.market_code = m.code and al.valid_to is null) as loaded,
             (select count(*)::int from crm.import_conflicts x where x.market_code = m.code and x.status = 'open') as open_conflicts,
             (select count(*)::int from crm.pipedrive_rebuild r where r.market_code = m.code and r.status <> 'built') as pending_rebuild
        from crm.markets m left join crm.pipedrive_cutover c on c.market_code = m.code
       where m.status = 'live' order by m.code`
    const run = lastRun[0]
    return rows.map((r) => {
      const criteria: Criterion[] = [
        { key: 'import', ok: Boolean(run), label: ['Importación completa sin errores', 'Full import with no errors'],
          detail: run ? ['Hay una carga terminada.', 'There is a finished load.'] : ['Todavía no termina ninguna carga desde Pipedrive.', 'No load from Pipedrive has finished yet.'] },
        { key: 'loaded', ok: r.loaded > 0, label: ['Comercios del mercado cargados', 'Market merchants loaded'],
          detail: [`${r.loaded} comercios con su referencia de Pipedrive.`, `${r.loaded} merchants with their Pipedrive reference.`] },
        { key: 'conflicts', ok: r.open_conflicts === 0, label: ['Sin choques por decidir', 'No clashes left to decide'],
          detail: [`${r.open_conflicts} por decidir.`, `${r.open_conflicts} to decide.`] },
        { key: 'rebuild', ok: r.pending_rebuild === 0, label: ['Lo armado en Pipedrive ya existe en CONTIGO', 'What was built in Pipedrive exists in CONTIGO'],
          detail: [`${r.pending_rebuild} piezas apagadas o pendientes.`, `${r.pending_rebuild} pieces off or pending.`] },
        { key: 'date', ok: Boolean(r.cutoff_on), label: ['Fecha de corte definida', 'Cutover date set'],
          detail: r.cutoff_on ? [r.cutoff_on, r.cutoff_on] : ['Sin fecha: la decide quien lidera el mercado.', 'No date: the market lead decides it.'] },
        { key: 'freeze', ok: Boolean(r.frozen_at && r.last_sync_at), label: ['Congelado y con última sincronización', 'Frozen, with a last sync'],
          detail: r.frozen_at ? (r.last_sync_at ? ['Última sincronización hecha después de congelar.', 'Last sync done after freezing.'] : ['Congelado: falta correr la última sincronización.', 'Frozen: the last sync still has to run.']) : ['Pipedrive sigue abierto para el equipo.', 'Pipedrive is still open to the team.'] },
      ]
      return { ...r, criteria }
    })
  })
}

export type RebuildRow = { kind: string; pd_name: string; position: number; market_code: string | null; status: 'built' | 'off' | 'pending'; contigo_kind: string; contigo_path: string | null; note_es: string | null; note_en: string | null }
export async function getRebuild(ctx: Ctx): Promise<RebuildRow[]> {
  return withUser(ctx.user.id, (tx) => tx<RebuildRow[]>`
    select kind, pd_name, position, market_code, status, contigo_kind, contigo_path, note_es, note_en from crm.pipedrive_rebuild
     order by array_position(array['automation','assignment','report','dashboard','goal','filter'], kind), position`)
}

export type GoalProgress = { id: string; market_code: string; name_es: string; name_en: string; period: 'month' | 'quarter'; target: number | null; done: number; scope: string; can_edit: boolean }
/** Metas con su avance del periodo en curso (día del mercado). "Negocios ganados" cuenta los cerrados como ganados en el periodo. */
export async function getGoals(ctx: Ctx, market?: string | null): Promise<GoalProgress[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Omit<GoalProgress, 'can_edit'>[]>`
      select g.id, g.market_code, g.name_es, g.name_en, g.period, g.target, g.scope,
             (select count(*)::int from crm.deals d
               where d.market_code = g.market_code and d.status = 'won'
                 and (d.won_at at time zone mk.timezone)::date >= date_trunc(g.period, ${marketToday(tx, tx`g.market_code`)})::date
                 and (g.scope <> 'person' or d.owner_id = g.user_id)
                 and (g.scope <> 'team' or d.owner_id in (select tm.user_id from crm.memberships tm where tm.team_id = g.team_id and (tm.valid_to is null or tm.valid_to > now())))) as done
        from crm.goals g join crm.markets mk on mk.code = g.market_code
       where g.is_active and (${market ?? null}::text is null or g.market_code = ${market ?? null})
       order by g.market_code, g.name_es`
    return rows.map((g) => ({ ...g, can_edit: ctx.can('goal.manage', g.market_code) }))
  })
}

export type Board = { id: string; key: string; market_code: string | null; name_es: string; name_en: string; reports: { id: string; report: string; name: string; params: Record<string, string> }[] }
/** Tableros de fábrica (los de Insights de Pipedrive): cada uno junta reportes guardados de la galería. */
export async function getBoards(ctx: Ctx): Promise<Board[]> {
  return withUser(ctx.user.id, async (tx) => {
    const boards = await tx<{ id: string; key: string; market_code: string | null; name_es: string; name_en: string; report_ids: string[] }[]>`
      select id, key, market_code, name_es, name_en, report_ids from crm.report_boards order by market_code nulls first, position, key`
    const ids = [...new Set(boards.flatMap((b) => b.report_ids))]
    const reps = ids.length ? await tx<{ id: string; report: string; name: string; params: Record<string, string> }[]>`
      select id, report, name, params from crm.saved_reports where id = any(${ids}::uuid[])` : []
    const byId = new Map(reps.map((r) => [r.id, r]))
    return boards.map((b) => ({ id: b.id, key: b.key, market_code: b.market_code, name_es: b.name_es, name_en: b.name_en,
      reports: b.report_ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)) }))
  })
}
