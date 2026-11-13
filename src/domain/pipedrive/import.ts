import 'server-only'
import { withSystem, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid } from '@/lib/errors'
import { pdList, PipedriveError, pipedriveConfigured, type PdItem, type PdMode } from '@/server/adapters/pipedrive'
import { CRM_OBJECT, closesByTransaction, last4, marketFromPipelineName, motorFromPipelineName, normalizeField, planFields, scrub, type PdField, type PdObject } from './mapping'
import { SRC, addIssue, bump, ensureLossReason, rawRows, saveRefs, sid, type Issue, type Json } from './refs'
export type { Issue } from './refs'
import { LOADERS, finish } from './load'

/**
 * Migración desde Pipedrive en tres tiempos, reanudable y repetible (REL-07):
 *   1. config   espejo de usuarios, embudos, etapas y campos.
 *   2. x:*      copia cruda de cada objeto a crm.import_raw (ya sin lo que DATA-06 prohíbe guardar).
 *   3. l:*      traducción de lo crudo al modelo de CONTIGO. Se puede repetir sin volver a llamar a la API.
 * Cada llamada a importStep trabaja unos segundos y devuelve el avance; la pantalla la vuelve a llamar hasta terminar.
 */
export const STEPS = [
  'config',
  'x:organization', 'x:person', 'x:deal', 'x:deal_archived', 'x:lead', 'x:lead_archived', 'x:activity', 'x:note', 'x:product', 'x:deal_product',
  'l:organization', 'l:person', 'l:deal', 'l:lead', 'l:activity', 'l:note', 'l:product', 'l:deal_product',
  'finish',
] as const
export type Step = (typeof STEPS)[number]
export type Mode = 'full' | 'delta' | 'remap'

type Cursor = { mode: Mode; page?: string | null; since?: string | null; after?: string | null; lock_until?: string | null }
type Run = { id: string; status: string; phase: Step; cursor: Cursor; stats: Record<string, unknown>; issues: Issue[] }

type Source = {
  object: string
  path: string
  mode: PdMode
  limit: number
  params?: Record<string, string>
  parent?: string
  mark?: Record<string, unknown>
  delta?: boolean
  scrubKeys?: string[]
  keep?: string[]
}
const SOURCES: Partial<Record<Step, Source>> = {
  'x:organization': { object: 'organization', path: '/api/v2/organizations', mode: 'cursor', limit: 200, delta: true },
  'x:person': { object: 'person', path: '/api/v2/persons', mode: 'cursor', limit: 500, parent: 'org_id', delta: true },
  'x:deal': { object: 'deal', path: '/api/v2/deals', mode: 'cursor', limit: 300, parent: 'org_id', params: { include_fields: 'products_count' }, delta: true },
  'x:deal_archived': { object: 'deal', path: '/api/v2/deals/archived', mode: 'cursor', limit: 300, parent: 'org_id', params: { include_fields: 'products_count' }, mark: { is_archived: true }, delta: true },
  'x:lead': { object: 'lead', path: '/v1/leads', mode: 'offset', limit: 500, parent: 'organization_id', delta: true },
  'x:lead_archived': { object: 'lead', path: '/v1/leads/archived', mode: 'offset', limit: 500, parent: 'organization_id', mark: { is_archived: true }, delta: true },
  'x:activity': { object: 'activity', path: '/api/v2/activities', mode: 'cursor', limit: 500, parent: 'org_id', delta: true, scrubKeys: ['note', 'public_description', 'subject'] },
  'x:note': {
    object: 'note', path: '/v1/notes', mode: 'offset', limit: 500, parent: 'org_id', delta: true, scrubKeys: ['content'],
    keep: ['id', 'content', 'add_time', 'update_time', 'user_id', 'deal_id', 'person_id', 'org_id', 'lead_id', 'active_flag'],
  },
  'x:product': { object: 'product', path: '/api/v2/products', mode: 'cursor', limit: 500, delta: true },
}

// ---------------------------------------------------------------- corridas
const one = async <T>(q: Promise<T[]>): Promise<T | undefined> => (await q)[0]

export async function startImport(ctx: Ctx, mode: Mode): Promise<string> {
  ctx.assert('integration.operate')
  if (mode !== 'remap' && !pipedriveConfigured()) throw invalid('Falta el token de Pipedrive en el servidor.', 'The Pipedrive token is missing on the server.')
  return withUser(ctx.user.id, async (tx) => {
    const active = await one(tx`select 1 from crm.import_runs where source = ${SRC} and status = 'running'`)
    if (active) throw invalid('Ya hay una importación corriendo.', 'An import is already running.')
    const last = await one(tx<{ started_at: Date }[]>`select started_at from crm.import_runs where source = ${SRC} and status = 'done' and cursor ->> 'mode' <> 'remap' order by started_at desc limit 1`)
    if (mode !== 'full' && !last) throw invalid('Primero corre una importación completa.', 'Run a full import first.')
    const cursor: Cursor = { mode, since: mode === 'delta' ? new Date(last!.started_at.getTime() - 5 * 60_000).toISOString() : null }
    if (mode === 'remap') await tx`update crm.import_raw set loaded_at = null, load_note = null where source = ${SRC} and object not like 'cfg:%'`
    const row = await one(tx<{ id: string }[]>`insert into crm.import_runs (source, phase, cursor, started_by) values (${SRC}, 'config', ${tx.json(cursor as unknown as Json)}, ${ctx.user.id}) returning id`)
    await audit(tx, ctx, 'import.started', 'import_run', row!.id, null, null, { source: SRC, mode })
    return row!.id
  })
}

export async function cancelImport(ctx: Ctx): Promise<void> {
  ctx.assert('integration.operate')
  await withUser(ctx.user.id, async (tx) => {
    const row = await one(tx<{ id: string }[]>`update crm.import_runs set status = 'cancelled', finished_at = now(), updated_at = now()
      where source = ${SRC} and status = 'running' returning id`)
    if (row) await audit(tx, ctx, 'import.cancelled', 'import_run', row.id, null, null, null)
  })
}

/** Reanuda una corrida que se detuvo por un error (por ejemplo, token vencido o límite de la API). */
export async function resumeImport(ctx: Ctx): Promise<void> {
  ctx.assert('integration.operate')
  await withUser(ctx.user.id, async (tx) => {
    const active = await one(tx`select 1 from crm.import_runs where source = ${SRC} and status = 'running'`)
    if (active) return
    const row = await one(tx<{ id: string }[]>`update crm.import_runs set status = 'running', finished_at = null, updated_at = now(),
        cursor = cursor - 'lock_until'
      where id = (select id from crm.import_runs where source = ${SRC} order by started_at desc limit 1) and status = 'failed' returning id`)
    if (!row) throw invalid('No hay una importación detenida que reanudar.', 'There is no stopped import to resume.')
    await audit(tx, ctx, 'import.resumed', 'import_run', row.id, null, null, null)
  })
}

/** Vacía la copia cruda una vez aceptada la migración. Lo ya cargado en CONTIGO no cambia. */
export async function purgeRaw(ctx: Ctx): Promise<number> {
  ctx.assert('integration.operate')
  return withUser(ctx.user.id, async (tx) => {
    const active = await one(tx`select 1 from crm.import_runs where source = ${SRC} and status = 'running'`)
    if (active) throw invalid('Espera a que termine la importación.', 'Wait for the import to finish.')
    const res = await tx`delete from crm.import_raw where source = ${SRC} and object not like 'cfg:%'`
    await audit(tx, ctx, 'import.raw_purged', 'import_run', null, null, null, { rows: res.count })
    return res.count
  })
}

export type StepResult = { status: 'idle' | 'running' | 'done' | 'failed' | 'busy'; phase?: string; waitMs?: number }

export async function importStep(ctx: Ctx, budgetMs = 20_000): Promise<StepResult> {
  ctx.assert('integration.operate')
  const deadline = Date.now() + budgetMs
  const run = await withSystem(async (tx) => {
    const active = await one(tx<{ id: string }[]>`select id from crm.import_runs where source = ${SRC} and status = 'running'`)
    if (!active) return null
    const claimed = await one(tx<Run[]>`
      update crm.import_runs set cursor = jsonb_set(cursor, '{lock_until}', to_jsonb(now() + interval '90 seconds')), updated_at = now()
       where id = ${active.id} and coalesce((cursor ->> 'lock_until')::timestamptz, '-infinity') < now()
      returning id, status, phase, cursor, stats, issues`)
    return claimed ?? ('busy' as const)
  })
  if (!run) return { status: 'idle' }
  if (run === 'busy') return { status: 'busy', waitMs: 4000 }

  let phase = run.phase
  let cursor = run.cursor
  try {
    while (Date.now() < deadline) {
      const out = await runStep(run.id, phase, cursor, deadline)
      if (!out.done) {
        cursor = out.cursor
        continue
      }
      const idx = STEPS.indexOf(phase)
      const next = nextStep(idx, cursor.mode)
      if (!next) {
        await withSystem((tx) => tx`update crm.import_runs set status = 'done', finished_at = now(), updated_at = now(), cursor = cursor - 'lock_until' where id = ${run.id}`)
        return { status: 'done', phase }
      }
      phase = next
      cursor = { mode: cursor.mode, since: cursor.since ?? null }
      await withSystem((tx) => tx`update crm.import_runs set phase = ${phase}, updated_at = now(),
        cursor = ${tx.json(cursor as unknown as Json)}::jsonb || jsonb_build_object('lock_until', to_jsonb(now() + interval '90 seconds')) where id = ${run.id}`)
    }
    await withSystem((tx) => tx`update crm.import_runs set cursor = cursor - 'lock_until', updated_at = now() where id = ${run.id}`)
    return { status: 'running', phase }
  } catch (e) {
    if (e instanceof PipedriveError && e.code === 'rate_limited') {
      await withSystem((tx) => tx`update crm.import_runs set cursor = cursor - 'lock_until', updated_at = now() where id = ${run.id}`)
      return { status: 'running', phase, waitMs: Math.min(Math.max(e.retryAfterSeconds ?? 10, 2), 120) * 1000 }
    }
    const pg = e as { code?: string; name?: string; constraint_name?: string; column?: string }
    const issue: Issue = e instanceof PipedriveError
      ? { code: `pipedrive_${e.code}`, step: phase, detail: e.status ? `HTTP ${e.status}` : undefined }
      : { code: 'error', step: phase, detail: [pg?.name, pg?.code, pg?.constraint_name, pg?.column].filter(Boolean).join(' ').slice(0, 160) || 'Error' }
    console.error(JSON.stringify({ level: 'error', msg: 'import_step_failed', step: phase, code: issue.code, detail: issue.detail ?? null }))
    await withSystem((tx) => tx`update crm.import_runs set status = 'failed', finished_at = now(), updated_at = now(), cursor = cursor - 'lock_until',
      issues = issues || ${tx.json([issue] as unknown as Json)} where id = ${run.id}`)
    return { status: 'failed', phase }
  }
}

function nextStep(idx: number, mode: Mode): Step | null {
  for (let i = idx + 1; i < STEPS.length; i++) {
    const s = STEPS[i]!
    if (mode === 'remap' && s.startsWith('x:')) continue
    return s
  }
  return null
}

async function runStep(runId: string, phase: Step, cursor: Cursor, deadline: number): Promise<{ done: boolean; cursor: Cursor }> {
  if (phase === 'config') {
    if (cursor.mode !== 'remap') await fetchConfig(runId)
    await withSystem((tx) => applyConfig(tx, runId))
    return { done: true, cursor }
  }
  if (phase === 'x:deal_product') return extractDealProducts(runId, cursor)
  if (phase.startsWith('x:')) return extractPage(runId, phase, cursor)
  if (phase === 'finish') {
    await withSystem((tx, sysId) => finish(tx, runId, sysId))
    return { done: true, cursor }
  }
  const loader = LOADERS[phase as keyof typeof LOADERS]
  let more = true
  while (more && Date.now() < deadline) {
    more = await withSystem((tx, sysId) => loader(tx, runId, sysId))
  }
  return { done: !more, cursor }
}

/** jsonb_set no crea niveles intermedios: los conteos se inicializan una vez. */
async function initStats(tx: Tx, runId: string): Promise<void> {
  await tx`update crm.import_runs set stats = '{"config":{},"extracted":{},"created":{},"updated":{},"skipped":{},"kept":{},"conflicts":{}}'::jsonb || stats where id = ${runId}`
}

// ---------------------------------------------------------------- 1. configuración
type CfgList = { object: string; path: string; mode: PdMode; optional?: boolean; fallback?: { path: string; mode: PdMode }; shape?: (i: PdItem) => PdItem | null; id?: (i: PdItem) => string }
const pickKeys = (keys: string[]) => (i: PdItem) => Object.fromEntries(keys.filter((k) => k in i).map((k) => [k, i[k]]))
const FIELD_OBJECTS: PdObject[] = ['deal', 'organization', 'person', 'activity', 'product']

const CONFIG_LISTS: CfgList[] = [
  { object: 'cfg:user', path: '/v1/users', mode: 'single', shape: pickKeys(['id', 'name', 'email', 'active_flag', 'lang', 'locale', 'timezone_name', 'is_deleted']) },
  { object: 'cfg:pipeline', path: '/api/v2/pipelines', mode: 'cursor' },
  { object: 'cfg:stage', path: '/api/v2/stages', mode: 'cursor' },
  ...FIELD_OBJECTS.map<CfgList>((o) => ({
    object: `cfg:field:${o}`, path: `/api/v2/${o}Fields`, mode: 'cursor', fallback: { path: `/v1/${o}Fields`, mode: 'offset' },
    id: (i) => String(i.field_code ?? i.key ?? i.id),
  })),
  { object: 'cfg:activity_type', path: '/v1/activityTypes', mode: 'single', id: (i) => String(i.key_string ?? i.id) },
  { object: 'cfg:lead_label', path: '/v1/leadLabels', mode: 'single', optional: true },
  // Inventario de conexiones: solo lo necesario para saber qué reemplazar. Sin credenciales ni parámetros de URL.
  {
    object: 'cfg:webhook', path: '/v1/webhooks', mode: 'single', optional: true,
    shape: (i) => ({ ...pickKeys(['id', 'name', 'event_action', 'event_object', 'is_active', 'version', 'type', 'user_id', 'add_time', 'last_delivery_time', 'last_http_status'])(i), target: safeUrl(i.subscription_url) }),
  },
  { object: 'cfg:filter', path: '/v1/filters', mode: 'single', optional: true, shape: pickKeys(['id', 'name', 'type', 'active_flag', 'user_id', 'visible_to', 'update_time']) },
  { object: 'cfg:role', path: '/v1/roles', mode: 'offset', optional: true, shape: pickKeys(['id', 'name', 'parent_role_id', 'active_flag', 'level']) },
  { object: 'cfg:permission_set', path: '/v1/permissionSets', mode: 'single', optional: true, shape: pickKeys(['id', 'name', 'app', 'type', 'assignment_count']) },
]

function safeUrl(v: unknown): string | null {
  try {
    const u = new URL(String(v))
    return `${u.protocol}//${u.host}${u.pathname.length > 1 ? '/…' : ''}`
  } catch {
    return null
  }
}

async function listAll(path: string, mode: PdMode, params: Record<string, string> = {}): Promise<PdItem[]> {
  const out: PdItem[] = []
  let cursor: string | null = null
  for (let i = 0; i < 200; i++) {
    const page = await pdList(path, mode, params, cursor, 500)
    out.push(...page.items)
    if (!page.next) break
    cursor = page.next
  }
  return out
}

async function fetchConfig(runId: string): Promise<void> {
  const collected: { object: string; rows: { external_id: string; parent_ref: null; payload: PdItem }[] }[] = []
  const issues: Issue[] = []
  for (const l of CONFIG_LISTS) {
    let items: PdItem[]
    try {
      items = await listAll(l.path, l.mode)
    } catch (e) {
      if (e instanceof PipedriveError && e.code === 'not_found' && l.fallback) items = await listAll(l.fallback.path, l.fallback.mode)
      else if (e instanceof PipedriveError && l.optional && e.code !== 'rate_limited' && e.code !== 'not_configured') {
        issues.push({ code: 'config_unavailable', step: 'config', detail: l.object.replace('cfg:', '') })
        continue
      } else throw e
    }
    const rows = items
      .map((i) => ({ id: (l.id ?? ((x: PdItem) => String(x.id)))(i), payload: l.shape ? l.shape(i) : i }))
      .filter((r): r is { id: string; payload: PdItem } => Boolean(r.id) && r.id !== 'undefined' && r.payload !== null)
      .map((r) => ({ external_id: r.id, parent_ref: null, payload: r.payload }))
    collected.push({ object: l.object, rows })
  }
  await withSystem(async (tx) => {
    await initStats(tx, runId)
    for (const c of collected) {
      await tx`delete from crm.import_raw where source = ${SRC} and object = ${c.object}`
      if (c.rows.length) await upsertRaw(tx, c.object, c.rows)
      await bump(tx, runId, ['config', c.object.replace('cfg:', '')], c.rows.length)
    }
    for (const i of issues) await addIssue(tx, runId, i)
  })
}

/** Convierte la configuración cruda en usuarios, embudos, etapas, campos y motivos. Idempotente. */
export async function applyConfig(tx: Tx, runId: string): Promise<void> {
  await initStats(tx, runId)
  // Usuarios: solo se crean; nunca se cambia a alguien que ya existe en CONTIGO.
  const userRefs: { ext: string; id: string }[] = []
  for (const u of await rawRows(tx, 'cfg:user')) {
    const email = String(u.payload.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
    const locale = /^es/i.test(String(u.payload.locale ?? '')) ? 'es' : 'en'
    const active = u.payload.active_flag !== false && u.payload.is_deleted !== true
    const row = await one(tx<{ id: string }[]>`
      with ins as (
        insert into crm.users (email, full_name, locale, is_active) values (${email}, ${String(u.payload.name ?? email)}, ${locale}, ${active})
        on conflict (email) do nothing returning id)
      select id from ins union all select id from crm.users where email = ${email} limit 1`)
    if (row) userRefs.push({ ext: u.external_id, id: row.id })
  }
  await saveRefs(tx, 'user', userRefs)

  // Embudos y etapas.
  const markets = new Set((await tx<{ code: string }[]>`select code from crm.markets where status = 'live'`).map((m) => m.code))
  const pipeRefs = new Map((await tx<{ external_id: string; internal_id: string }[]>`select external_id, internal_id from crm.external_refs where system = ${SRC} and object = 'pipeline'`).map((r) => [r.external_id, r.internal_id]))
  const stageRefs = new Map((await tx<{ external_id: string; internal_id: string }[]>`select external_id, internal_id from crm.external_refs where system = ${SRC} and object = 'stage'`).map((r) => [r.external_id, r.internal_id]))
  const stagesRaw = await rawRows(tx, 'cfg:stage')
  for (const p of await rawRows(tx, 'cfg:pipeline')) {
    if (p.payload.is_deleted === true) continue
    const name = String(p.payload.name ?? '')
    const market = marketFromPipelineName(name)
    if (!market || !markets.has(market)) {
      await addIssue(tx, runId, { code: 'pipeline_out_of_scope', step: 'config', detail: name.slice(0, 80) })
      continue
    }
    const motor = motorFromPipelineName(name)
    const position = Number(p.payload.order_nr ?? 0)
    let pipelineId = pipeRefs.get(p.external_id)
    if (pipelineId) {
      await tx`update crm.pipelines set name = ${name}, position = ${position}, market_code = ${market} where id = ${pipelineId}`
    } else {
      const row = await one(tx<{ id: string }[]>`insert into crm.pipelines (market_code, motor, name, position, close_by_transaction, multi_open, has_items)
        values (${market}, ${motor}, ${name}, ${position}, ${closesByTransaction(motor)}, ${motor === 'orders'}, ${motor === 'orders'}) returning id`)
      pipelineId = row!.id
      await saveRefs(tx, 'pipeline', [{ ext: p.external_id, id: pipelineId }])
    }
    const mine = stagesRaw.filter((s) => sid(s.payload.pipeline_id) === p.external_id && s.payload.is_deleted !== true)
      .sort((a, b) => Number(a.payload.order_nr ?? 0) - Number(b.payload.order_nr ?? 0))
    await tx`update crm.stages set position = position + 1000 where pipeline_id = ${pipelineId}`
    let pos = 0
    for (const s of mine) {
      pos++
      const sname = String(s.payload.name ?? `Stage ${pos}`)
      const prob = Math.min(100, Math.max(0, Math.round(Number(s.payload.deal_probability ?? 0))))
      const rot = s.payload.is_deal_rot_enabled ? Math.max(0, Math.round(Number(s.payload.days_to_rotten ?? 0))) : 0
      const existing = stageRefs.get(s.external_id)
      if (existing) {
        // Una etapa que administración ya corrigió (nombre en español, días) conserva lo corregido: solo se mueve de lugar.
        await tx`update crm.stages set position = ${pos}, probability = ${prob},
                  name_es = case when edited_at is null then ${sname} else name_es end,
                  name_en = case when edited_at is null then ${sname} else name_en end,
                  rot_days = case when edited_at is null then ${rot} else rot_days end
                 where id = ${existing}`
      } else {
        const row = await one(tx<{ id: string }[]>`insert into crm.stages (pipeline_id, position, code, name_es, name_en, kind, probability, rot_days)
          values (${pipelineId}, ${pos}, ${'pd_' + s.external_id}, ${sname}, ${sname}, 'open', ${prob}, ${rot}) returning id`)
        await saveRefs(tx, 'stage', [{ ext: s.external_id, id: row!.id }])
      }
    }
    // En Pipedrive ganado y perdido son estados; en CONTIGO son etapas de cierre del embudo.
    for (const [code, kind, es, en, prob] of [['won', 'won', 'Ganado', 'Won', 100], ['lost', 'lost', 'Perdido', 'Lost', 0]] as const) {
      pos++
      const has = await one(tx<{ id: string }[]>`select id from crm.stages where pipeline_id = ${pipelineId} and kind = ${kind} order by position limit 1`)
      if (has) await tx`update crm.stages set position = ${pos} where id = ${has.id}`
      else await tx`insert into crm.stages (pipeline_id, position, code, name_es, name_en, kind, probability, rot_days) values (${pipelineId}, ${pos}, ${code}, ${es}, ${en}, ${kind}, ${prob}, 0)`
    }
    // Etapas que ya no existen en Pipedrive se quedan al final: pueden tener deals.
    const rest = await tx<{ id: string }[]>`select id from crm.stages where pipeline_id = ${pipelineId} and position > 1000 order by position`
    for (const r of rest) await tx`update crm.stages set position = ${++pos} where id = ${r.id}`
  }

  // Campos.
  for (const pd of FIELD_OBJECTS) {
    const object = CRM_OBJECT[pd]
    const fields = (await rawRows(tx, `cfg:field:${pd}`)).map((r) => normalizeField(r.payload)).filter((f): f is PdField => f !== null)
    const current = await tx<{ key: string; external_ref: string | null; source: string }[]>`select key, external_ref, source from crm.field_definitions where object = ${object}`
    const existing = new Map(current.filter((c) => c.source === SRC && c.external_ref).map((c) => [c.external_ref!, c.key]))
    const taken = new Set(current.filter((c) => !(c.source === SRC && c.external_ref)).map((c) => c.key))
    const plans = planFields(pd, fields, existing, taken)
    for (const f of plans) {
      await tx`insert into crm.field_definitions (object, key, label_es, label_en, data_type, options, data_class, position, source, external_ref, mapped_to)
               values (${object}, ${f.key}, ${f.label}, ${f.label}, ${f.dataType}, ${tx.json(f.options)}, ${f.dataClass}, ${f.position}, ${SRC}, ${f.externalRef}, ${f.mappedTo})
               on conflict (source, object, external_ref) where external_ref is not null
               do update set label_es = excluded.label_es, label_en = excluded.label_en, data_type = excluded.data_type, options = excluded.options,
                             data_class = excluded.data_class, position = excluded.position, mapped_to = excluded.mapped_to, is_active = true`
    }
    await bump(tx, runId, ['config', `fields_${object}`], plans.length)
    // Motivos de pérdida predefinidos en Pipedrive.
    if (pd === 'deal') {
      const lost = fields.find((f) => f.code === 'lost_reason')
      for (const o of lost?.options ?? []) await ensureLossReason(tx, o.label)
    }
  }
  await tx`insert into crm.loss_reasons (code, kind, label_es, label_en) values
    ('pd_unspecified', 'lost', 'Sin motivo registrado', 'No reason recorded'), ('pd_archived', 'lost', 'Archivado en Pipedrive', 'Archived in Pipedrive')
    on conflict (code) do nothing`
}

// ---------------------------------------------------------------- 2. extracción
type RawRow = { external_id: string; parent_ref: string | null; payload: PdItem }

async function upsertRaw(tx: Tx, object: string, rows: RawRow[]): Promise<void> {
  await tx`insert into crm.import_raw (source, object, external_id, parent_ref, payload)
           select ${SRC}, ${object}, x.external_id, x.parent_ref, x.payload
             from jsonb_to_recordset(${tx.json(rows as unknown as Json)}) as x(external_id text, parent_ref text, payload jsonb)
           on conflict (source, object, external_id) do update
             set payload = excluded.payload, parent_ref = excluded.parent_ref, fetched_at = now(), loaded_at = null, load_note = null`
}

type Redaction = Map<string, 'last4' | 'omit'>
async function redactions(object: string): Promise<Redaction> {
  const crm = (CRM_OBJECT as Record<string, string>)[object] ?? (object === 'lead' ? 'deal' : null)
  if (!crm) return new Map()
  const rows = await withSystem((tx) => tx<{ external_ref: string; mapped_to: string }[]>`
    select external_ref, mapped_to from crm.field_definitions where source = ${SRC} and object = ${crm} and mapped_to like 'policy:%'`)
  return new Map(rows.map((r) => [r.external_ref, r.mapped_to === 'policy:last4' ? 'last4' : 'omit']))
}

/** Lo que no debe guardarse se quita antes de escribir la copia cruda; los campos vacíos tampoco ocupan espacio. */
function prepare(item: PdItem, src: Source, red: Redaction): PdItem {
  let out: PdItem = src.keep ? Object.fromEntries(src.keep.filter((k) => k in item).map((k) => [k, item[k]])) : { ...item }
  const clean = (bag: Record<string, unknown>) => {
    for (const k of Object.keys(bag)) {
      const v = bag[k]
      if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete bag[k]
      else if (red.has(k)) {
        if (red.get(k) === 'last4') bag[k] = { __last4: last4(typeof v === 'object' ? (v as { value?: unknown }).value : v) }
        else delete bag[k]
      }
    }
  }
  if (out.custom_fields && typeof out.custom_fields === 'object') {
    const cf = { ...(out.custom_fields as Record<string, unknown>) }
    clean(cf)
    out.custom_fields = cf
  }
  if (red.size) clean(out)
  for (const k of src.scrubKeys ?? []) if (typeof out[k] === 'string') out[k] = scrub(out[k] as string)
  if (src.mark) out = { ...out, ...src.mark }
  return out
}

async function extractPage(runId: string, phase: Step, cursor: Cursor): Promise<{ done: boolean; cursor: Cursor }> {
  const src = SOURCES[phase]!
  const params: Record<string, string> = { ...(src.params ?? {}) }
  if (cursor.since && src.delta) params.updated_since = cursor.since
  const page = await pdList(src.path, src.mode, params, cursor.page ?? null, src.limit)
  const red = await redactions(src.object)
  const rows: RawRow[] = page.items
    .filter((i) => i.id !== undefined && i.id !== null && i.is_deleted !== true && i.active_flag !== false)
    .map((i) => ({ external_id: String(i.id), parent_ref: src.parent ? sid(i[src.parent]) : null, payload: prepare(i, src, red) }))
  const next: Cursor = { ...cursor, page: page.next }
  await withSystem(async (tx) => {
    if (rows.length) await upsertRaw(tx, src.object, rows)
    await bump(tx, runId, ['extracted', src.object], rows.length)
    await tx`update crm.import_runs set cursor = cursor || ${tx.json({ page: page.next } as unknown as Json)}, updated_at = now() where id = ${runId}`
  })
  return { done: page.next === null, cursor: next }
}

/** Las partidas se piden por lotes de deals que sí tienen productos. */
async function extractDealProducts(runId: string, cursor: Cursor): Promise<{ done: boolean; cursor: Cursor }> {
  const after = cursor.after ?? ''
  const ids = await withSystem((tx) => tx<{ external_id: string }[]>`
    select external_id from crm.import_raw
     where source = ${SRC} and object = 'deal' and loaded_at is null and coalesce((payload ->> 'products_count')::int, 0) > 0 and external_id > ${after}
     order by external_id limit 100`)
  if (!ids.length) return { done: true, cursor }
  const items: PdItem[] = []
  let page: string | null = null
  for (let i = 0; i < 50; i++) {
    const res = await pdList('/api/v2/deals/products', 'cursor', { deal_ids: ids.map((r) => r.external_id).join(',') }, page, 500)
    items.push(...res.items)
    if (!res.next) break
    page = res.next
  }
  const rows: RawRow[] = items.filter((i) => i.id != null).map((i) => ({ external_id: String(i.id), parent_ref: sid(i.deal_id), payload: i }))
  const last = ids[ids.length - 1]!.external_id
  await withSystem(async (tx) => {
    if (rows.length) await upsertRaw(tx, 'deal_product', rows)
    await bump(tx, runId, ['extracted', 'deal_product'], rows.length)
    await tx`update crm.import_runs set cursor = cursor || ${tx.json({ after: last } as unknown as Json)}, updated_at = now() where id = ${runId}`
  })
  return { done: false, cursor: { ...cursor, after: last } }
}
