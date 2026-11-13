import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { CONFIG_OBJECTS } from '@/domain/gobierno-ops'

/** Lecturas del paquete gobierno. Todo lo de operación lo leen administración y leadership ('gov.read'); RLS lo repite. */

// ------------------------------------------------------------------ GOB-07: tablero de servicio

/** Tope de cada tramo del histograma, en milisegundos. El último tramo no tiene tope. */
export const BUCKET_LIMITS = [200, 500, 1000, 2000, 4000] as const

/** Percentil 95 a partir del histograma: el tope del tramo donde cae. `null` sin datos; `Infinity` si cae en el último tramo. */
export function p95(buckets: number[]): number | null {
  const n = buckets.reduce((a, b) => a + b, 0)
  if (n === 0) return null
  let acc = 0
  for (let i = 0; i < buckets.length; i++) {
    acc += buckets[i] ?? 0
    if (acc >= 0.95 * n) return BUCKET_LIMITS[i] ?? Infinity
  }
  return Infinity
}

export type Objective = { key: string; kind: 'slo' | 'recovery'; target: number | null; agreed_by: string | null; agreed_on: string | null; updated_at: Date | null }
export type Measured = { n: number; errors: number; p95: number | null }
export type ScreenRow = { screen: string; n: number; avg_ms: number; p95: number | null }
export type ServiceBoard = {
  days: number
  objectives: Objective[]
  /** Peticiones que respondieron sin error del servidor, en porcentaje; `null` si todavía no hay mediciones. */
  availability: number | null
  total: number
  failures: number
  page: Measured
  action: Measured
  api: Measured
  probe: Measured
  screens: ScreenRow[]
  errors: { id: string; at: Date; request_id: string | null; kind: string; screen: string; name: string; code: string | null }[]
  errorCount: number
}

const sum = (rows: { buckets: number[] }[]) => rows.reduce<number[]>((acc, r) => acc.map((v, i) => v + (r.buckets[i] ?? 0)), [0, 0, 0, 0, 0, 0])

export async function serviceBoard(ctx: Ctx, days = 30, ref = ''): Promise<ServiceBoard> {
  ctx.assert('gov.read')
  return withUser(ctx.user.id, async (tx) => {
    const objectives = await tx<Objective[]>`select key, kind, target::float8 as target, agreed_by, agreed_on::text, updated_at from crm.service_objectives order by position`
    const rows = await tx<{ kind: 'page' | 'action' | 'api' | 'probe'; screen: string; n: number; errors: number; total_ms: number; buckets: number[] }[]>`
      select kind, screen, sum(n)::int as n, sum(errors)::int as errors, sum(total_ms)::float8 as total_ms,
             array[sum(buckets[1]), sum(buckets[2]), sum(buckets[3]), sum(buckets[4]), sum(buckets[5]), sum(buckets[6])]::int[] as buckets
        from crm.request_metrics where day > (now() at time zone 'utc')::date - ${days}::int group by kind, screen`
    const pageErrors = await tx<{ n: number }[]>`select count(*)::int as n from crm.error_events where kind = 'page' and at > now() - make_interval(days => ${days})`
    const like = ref.replace(/[^A-Za-z0-9]/g, '').slice(0, 32)
    const errors = await tx<ServiceBoard['errors']>`
      select id, at, request_id, kind, screen, name, code from crm.error_events
       where at > now() - make_interval(days => ${days}) ${like ? tx`and replace(coalesce(request_id, ''), '-', '') like ${like + '%'}` : tx``}
       order by at desc limit 20`
    const errorCount = await tx<{ n: number }[]>`select count(*)::int as n from crm.error_events where at > now() - make_interval(days => ${days})`
    const of = (kind: string): Measured => {
      const r = rows.filter((x) => x.kind === kind)
      return { n: r.reduce((a, x) => a + x.n, 0), errors: r.reduce((a, x) => a + x.errors, 0), p95: p95(sum(r)) }
    }
    const [page, action, api, probe] = [of('page'), of('action'), of('api'), of('probe')]
    const total = page.n + action.n + api.n + probe.n
    const failures = action.errors + api.errors + probe.errors + (pageErrors[0]?.n ?? 0)
    return {
      days, objectives: [...objectives],
      availability: total > 0 ? Math.max(0, Math.round(((total - failures) / total) * 10000) / 100) : null,
      total, failures, page, action, api, probe,
      screens: rows.filter((r) => r.kind === 'page').map((r) => ({ screen: r.screen, n: r.n, avg_ms: r.n ? Math.round(r.total_ms / r.n) : 0, p95: p95(r.buckets) })).sort((a, b) => b.n - a.n).slice(0, 25),
      errors: [...errors], errorCount: errorCount[0]?.n ?? 0,
    }
  })
}

export type Incident = { id: string; title: string; severity: string; status: string; started_at: Date; resolved_at: Date | null; market_code: string | null; impact: string; cause: string | null; actions: string | null; request_id: string | null; created_by_name: string }
export type RestoreTest = { id: string; tested_on: string; tested_by: string; environment: string; minutes: number | null; data_loss_minutes: number | null; result: string; evidence: string; notes: string | null; recorded_by_name: string }

export async function incidents(ctx: Ctx): Promise<Incident[]> {
  ctx.assert('gov.read')
  return withUser(ctx.user.id, (tx) => tx<Incident[]>`
    select i.id, i.title, i.severity, i.status, i.started_at, i.resolved_at, i.market_code, i.impact, i.cause, i.actions, i.request_id, u.full_name as created_by_name
      from crm.incidents i join crm.users u on u.id = i.created_by
     order by (i.status <> 'closed') desc, i.started_at desc limit 100`)
}

export async function restoreTests(ctx: Ctx): Promise<RestoreTest[]> {
  ctx.assert('gov.read')
  return withUser(ctx.user.id, (tx) => tx<RestoreTest[]>`
    select r.id, r.tested_on::text, r.tested_by, r.environment, r.minutes, r.data_loss_minutes, r.result, r.evidence, r.notes, u.full_name as recorded_by_name
      from crm.restore_tests r join crm.users u on u.id = r.recorded_by order by r.tested_on desc, r.created_at desc limit 50`)
}

export async function dataRegions(ctx: Ctx): Promise<{ code: string; name: string; data_region: string }[]> {
  ctx.assert('gov.read')
  return withUser(ctx.user.id, (tx) => tx<{ code: string; name: string; data_region: string }[]>`select code, name, data_region from crm.markets order by status, code`)
}

// ------------------------------------------------------------------ GOB-04

export type Component = { key: string; name_es: string; name_en: string; owner_name: string | null; backup_name: string | null }
export type Maintenance = { id: string; title: string; starts_at: Date; ends_at: Date; market_code: string | null; impact: string; status: string }
export type Release = {
  id: string; version: string; title_es: string; title_en: string; notes_es: string; notes_en: string; planned_for: string | null; touches_money: boolean
  status: 'draft' | 'announced' | 'released'; announced_at: Date | null; released_at: Date | null; checklist: Record<string, { by: string; at: string; evidence: string }>
}
export type Deployment = { id: string; environment: string; commit_sha: string; ref: string | null; version: string | null; deployed_at: Date; deployed_by: string | null; result: string; source: string; notes: string | null }

export async function components(ctx: Ctx): Promise<Component[]> {
  ctx.assert('gov.read')
  return withUser(ctx.user.id, (tx) => tx<Component[]>`select key, name_es, name_en, owner_name, backup_name from crm.components order by position`)
}

/** El calendario de mantenimiento que le toca a la persona: lo que viene y lo último que pasó. Lo ve cualquiera con acceso. */
export async function maintenance(ctx: Ctx, upcomingOnly = false): Promise<Maintenance[]> {
  return withUser(ctx.user.id, (tx) => tx<Maintenance[]>`
    select id, title, starts_at, ends_at, market_code, impact, status from crm.maintenance_windows
     where ${upcomingOnly ? tx`status = 'planned' and ends_at > now()` : tx`true`}
     order by (status = 'planned' and ends_at > now()) desc, starts_at ${upcomingOnly ? tx`asc` : tx`desc`} limit 50`)
}

/** Versiones. Quien no gobierna solo recibe las anunciadas o liberadas (RLS); los borradores son de administración y leadership. */
export async function releases(ctx: Ctx, limit = 30): Promise<Release[]> {
  return withUser(ctx.user.id, (tx) => tx<Release[]>`
    select id, version, title_es, title_en, notes_es, notes_en, planned_for::text, touches_money, status, announced_at, released_at, checklist
      from crm.releases order by coalesce(released_at, announced_at, created_at) desc limit ${limit}`)
}

export async function deployments(ctx: Ctx): Promise<Deployment[]> {
  ctx.assert('gov.read')
  return withUser(ctx.user.id, (tx) => tx<Deployment[]>`
    select d.id, d.environment, d.commit_sha, d.ref, r.version, d.deployed_at, d.deployed_by, d.result, d.source, d.notes
      from crm.deployments d left join crm.releases r on r.id = d.release_id order by d.deployed_at desc limit 50`)
}

// ------------------------------------------------------------------ GOB-09

export type CostEntry = { id: string; month: string; kind: 'cost' | 'reference'; component: string; label: string; amount_usd: number; note: string | null; source: string; voided: boolean; created_by_name: string }
export type CostMonth = { month: string; cost: number; reference: number; by_component: Record<string, number>; active_people: number; managed_accounts: number }

/** Costo por mes, con sus denominadores. Solo meses con algo cargado: sin cargas, la lista viene vacía. */
export async function costBoard(ctx: Ctx): Promise<{ months: CostMonth[]; entries: CostEntry[] }> {
  ctx.assert('gov.read')
  return withUser(ctx.user.id, async (tx) => {
    const entries = await tx<CostEntry[]>`
      select c.id, to_char(c.month, 'YYYY-MM') as month, c.kind, c.component, c.label, c.amount_usd::float8 as amount_usd, c.note, c.source,
             (c.voided_at is not null) as voided, u.full_name as created_by_name
        from crm.cost_entries c join crm.users u on u.id = c.created_by order by c.month desc, c.created_at desc limit 300`
    const live = entries.filter((e) => !e.voided)
    const months: CostMonth[] = []
    for (const month of [...new Set(live.map((e) => e.month))].slice(0, 12)) {
      const den = await tx<{ active_people: number | null; managed_accounts: number | null }[]>`select * from app.cost_denominators(${`${month}-01`}::date)`
      const of = live.filter((e) => e.month === month)
      const by: Record<string, number> = {}
      for (const e of of.filter((x) => x.kind === 'cost')) by[e.component] = (by[e.component] ?? 0) + e.amount_usd
      months.push({
        month, cost: Object.values(by).reduce((a, b) => a + b, 0), reference: of.filter((x) => x.kind === 'reference').reduce((a, x) => a + x.amount_usd, 0),
        by_component: by, active_people: den[0]?.active_people ?? 0, managed_accounts: den[0]?.managed_accounts ?? 0,
      })
    }
    return { months, entries: [...entries] }
  })
}

// ------------------------------------------------------------------ GOB-08

export type DataOrigin = { accounts_total: number; accounts_generated: number; accounts_imported: number; people_real: number; people_synthetic: number }
export type SyntheticRun = { id: string; market_code: string; seed: number; accounts: number; depth: number; edge_cases: boolean; created: Record<string, number>; run_by: string; at: Date }

export async function testData(ctx: Ctx): Promise<{ origin: DataOrigin; runs: SyntheticRun[] }> {
  ctx.assert('gov.read')
  return withUser(ctx.user.id, async (tx) => {
    const origin = await tx<DataOrigin[]>`select * from app.data_origin()`
    const runs = await tx<SyntheticRun[]>`select id, market_code, seed, accounts, depth, edge_cases, created, run_by, at from crm.synthetic_runs order by at desc limit 30`
    return { origin: origin[0] ?? { accounts_total: 0, accounts_generated: 0, accounts_imported: 0, people_real: 0, people_synthetic: 0 }, runs: [...runs] }
  })
}

// ------------------------------------------------------------------ E7

export type ConfigRequest = { id: string; kind: string; title: string; purpose: string; market_code: string | null; options: string | null; status: string; created_at: Date; decided_at: Date | null; decision_note: string | null; requested_by_name: string; decided_by_name: string | null }

const REQUEST_COLS = (tx: Parameters<Parameters<typeof withUser>[1]>[0]) => tx`
  r.id, r.kind, r.title, r.purpose, r.market_code, r.options, r.status, r.created_at, r.decided_at, r.decision_note, u.full_name as requested_by_name, d.full_name as decided_by_name`

export async function myConfigRequests(ctx: Ctx): Promise<ConfigRequest[]> {
  return withUser(ctx.user.id, (tx) => tx<ConfigRequest[]>`
    select ${REQUEST_COLS(tx)} from crm.config_requests r join crm.users u on u.id = r.requested_by left join crm.users d on d.id = r.decided_by
     where r.requested_by = ${ctx.user.id} order by r.created_at desc limit 50`)
}

export async function allConfigRequests(ctx: Ctx): Promise<ConfigRequest[]> {
  ctx.assert('gov.read')
  return withUser(ctx.user.id, (tx) => tx<ConfigRequest[]>`
    select ${REQUEST_COLS(tx)} from crm.config_requests r join crm.users u on u.id = r.requested_by left join crm.users d on d.id = r.decided_by
     order by (case r.status when 'open' then 0 when 'approved' then 1 else 2 end), r.created_at desc limit 200`)
}

/** Solicitudes de campo aprobadas y todavía sin crear: de ahí se elige al crear un campo. */
export async function approvedFieldRequests(ctx: Ctx): Promise<{ id: string; title: string; purpose: string; market_code: string | null }[]> {
  ctx.assert('config.manage')
  return withUser(ctx.user.id, (tx) => tx<{ id: string; title: string; purpose: string; market_code: string | null }[]>`
    select id, title, purpose, market_code from crm.config_requests where kind = 'field' and status = 'approved' and field_id is null order by created_at`)
}

export type ConfigChange = { id: string; at: Date; action: string; object: string; market_code: string | null; actor_name: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null; reason_by: string | null; request_id: string | null }

/** Cambios de configuración de la bitácora, con su motivo si ya se anotó. `missing`: cuántos siguen sin motivo. */
export async function configChanges(ctx: Ctx, onlyMissing: boolean): Promise<{ rows: ConfigChange[]; missing: number; total: number }> {
  ctx.assert('gov.read')
  const objects = [...CONFIG_OBJECTS]
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<ConfigChange[]>`
      select e.id, e.at, e.action, e.object, e.market_code, u.full_name as actor_name, e.before, e.after, c.reason, cb.full_name as reason_by, e.request_id
        from crm.audit_events e left join crm.users u on u.id = e.actor_id
        left join crm.change_reasons c on c.event_id = e.id left join crm.users cb on cb.id = c.created_by
       where e.object = any(${objects}) ${onlyMissing ? tx`and c.event_id is null` : tx``}
       order by e.at desc limit 60`
    const counts = await tx<{ total: number; missing: number }[]>`
      select count(*)::int as total, count(*) filter (where c.event_id is null)::int as missing
        from crm.audit_events e left join crm.change_reasons c on c.event_id = e.id where e.object = any(${objects})`
    return { rows: [...rows], missing: counts[0]?.missing ?? 0, total: counts[0]?.total ?? 0 }
  })
}

export type TeamChampion = { team_id: string; team: string; market_code: string; champion_id: string | null; champion: string | null; last_review: string | null; members: { id: string; name: string }[] }

/** Equipos con su champion y la última revisión mensual. Los miembros solo se cargan para quien administra (para elegir). */
export async function teamChampions(ctx: Ctx, withMembers: boolean): Promise<TeamChampion[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Omit<TeamChampion, 'members'>[]>`
      select t.id as team_id, t.name as team, t.market_code, c.user_id as champion_id, u.full_name as champion,
             (select to_char(max(r.month), 'YYYY-MM') from crm.champion_reviews r where r.team_id = t.id) as last_review
        from crm.teams t left join crm.team_champions c on c.team_id = t.id left join crm.users u on u.id = c.user_id
       where t.market_code = any(${ctx.markets.map((m) => m.code)}) order by t.market_code, t.name`
    const members = withMembers && ctx.can('config.manage')
      ? await tx<{ team_id: string; id: string; name: string }[]>`
          select distinct m.team_id, u.id, u.full_name as name from crm.memberships m join crm.users u on u.id = m.user_id
           where m.team_id is not null and u.is_active and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()) order by 3`
      : []
    return rows.map((r) => ({ ...r, members: members.filter((m) => m.team_id === r.team_id).map((m) => ({ id: m.id, name: m.name })) }))
  })
}

/** Los equipos de la persona con su champion: para decirle a quién preguntar primero. */
export async function myChampions(ctx: Ctx): Promise<{ team: string; champion: string | null }[]> {
  const teamIds = ctx.memberships.map((m) => m.teamId).filter((v): v is string => !!v)
  if (teamIds.length === 0) return []
  return withUser(ctx.user.id, (tx) => tx<{ team: string; champion: string | null }[]>`
    select t.name as team, u.full_name as champion from crm.teams t left join crm.team_champions c on c.team_id = t.id left join crm.users u on u.id = c.user_id
     where t.id = any(${teamIds}::uuid[]) order by t.name`)
}

export type Material = { id: string; market_code: string; kind: string; locale: string; title: string; url: string; in_portal: boolean; pinned: boolean; updated_at: Date }

/** Material de capacitación de los mercados de la persona (RLS no deja ver el de otro mercado). */
export async function materials(ctx: Ctx): Promise<Material[]> {
  return withUser(ctx.user.id, (tx) => tx<Material[]>`
    select id, market_code, kind, locale, title, url, in_portal, pinned, updated_at from crm.training_materials order by market_code, kind, locale`)
}
