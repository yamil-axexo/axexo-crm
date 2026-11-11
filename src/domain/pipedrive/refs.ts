import 'server-only'
import type postgres from 'postgres'
import type { Tx } from '@/server/db'
import { lossCode, normalizeField, type FieldPlan, type CrmObject, type PdObject, CRM_OBJECT, marketFromPipelineName } from './mapping'

export const SRC = 'pipedrive'
export type Json = postgres.JSONValue
export type Raw = { external_id: string; parent_ref: string | null; payload: Record<string, unknown> }

export type Refs = {
  markets: Map<string, { currency: string; phoneCc: string; live: boolean }>
  users: Map<string, { id: string; name: string }>
  userNames: Map<string, string>
  pipelines: Map<string, { id: string; market: string; motor: string; won: string | null; lost: string | null; first: string | null }>
  stages: Map<string, { id: string; pipelineId: string }>
  pipelineMarket: Map<string, string> // id de pipeline en Pipedrive → mercado (aunque el pipeline no se haya creado)
  plans: Record<CrmObject, FieldPlan[]>
  ownerMarket: Map<string, string> // usuario de Pipedrive → mercado donde lleva más deals
  defaultMotor: Map<string, string>
  activityTypes: Map<string, string>
  leadLabels: Map<string, string>
}

export const sid = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(typeof v === 'object' ? ((v as { value?: unknown; id?: unknown }).value ?? (v as { id?: unknown }).id ?? '') : v) || null)

export async function rawRows(tx: Tx, object: string): Promise<Raw[]> {
  const rows = await tx<Raw[]>`select external_id, parent_ref, payload from crm.import_raw where source = ${SRC} and object = ${object}`
  return [...rows]
}

/** Catálogos que usan todos los cargadores. Son pequeños (usuarios, embudos, campos): se leen una vez por paso. */
export async function loadRefs(tx: Tx): Promise<Refs> {
  const markets = new Map<string, { currency: string; phoneCc: string; live: boolean }>()
  for (const m of await tx<{ code: string; currency: string; phone_cc: string; status: string }[]>`select code, currency, phone_cc, status from crm.markets`) {
    markets.set(m.code, { currency: m.currency.trim(), phoneCc: m.phone_cc, live: m.status === 'live' })
  }
  const users = new Map<string, { id: string; name: string }>()
  const userNames = new Map<string, string>()
  for (const u of await tx<{ external_id: string; id: string; full_name: string }[]>`
    select r.external_id, u.id, u.full_name from crm.external_refs r join crm.users u on u.id = r.internal_id
     where r.system = ${SRC} and r.object = 'user'`) {
    users.set(u.external_id, { id: u.id, name: u.full_name })
    userNames.set(u.external_id, u.full_name)
  }
  for (const u of await rawRows(tx, 'cfg:user')) if (!userNames.has(u.external_id)) userNames.set(u.external_id, String(u.payload.name ?? `#${u.external_id}`))

  const pipelines: Refs['pipelines'] = new Map()
  for (const p of await tx<{ external_id: string; id: string; market_code: string; motor: string; won: string | null; lost: string | null; first: string | null }[]>`
    select r.external_id, p.id, p.market_code, p.motor,
           (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'won' order by s.position limit 1) as won,
           (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'lost' order by s.position limit 1) as lost,
           (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind in ('open','awaiting_txn') order by s.position limit 1) as first
      from crm.external_refs r join crm.pipelines p on p.id = r.internal_id where r.system = ${SRC} and r.object = 'pipeline'`) {
    pipelines.set(p.external_id, { id: p.id, market: p.market_code, motor: p.motor, won: p.won, lost: p.lost, first: p.first })
  }
  const stages: Refs['stages'] = new Map()
  for (const s of await tx<{ external_id: string; id: string; pipeline_id: string }[]>`
    select r.external_id, s.id, s.pipeline_id from crm.external_refs r join crm.stages s on s.id = r.internal_id
     where r.system = ${SRC} and r.object = 'stage'`) {
    stages.set(s.external_id, { id: s.id, pipelineId: s.pipeline_id })
  }
  const pipelineMarket = new Map<string, string>()
  for (const p of await rawRows(tx, 'cfg:pipeline')) {
    const m = marketFromPipelineName(String(p.payload.name ?? ''))
    if (m && markets.get(m)?.live) pipelineMarket.set(p.external_id, m)
  }

  const plans: Refs['plans'] = { account: [], contact: [], deal: [], activity: [], product: [] }
  const defs = await tx<{ object: CrmObject; key: string; label_en: string; data_type: FieldPlan['dataType']; options: string[]; external_ref: string; mapped_to: string | null; data_class: FieldPlan['dataClass']; position: number }[]>`
    select object, key, label_en, data_type, options, external_ref, mapped_to, data_class, position
      from crm.field_definitions where source = ${SRC} and external_ref is not null and is_active order by object, position`
  const pdFields = new Map<string, { type: string; options: { id: string; label: string }[]; custom: boolean }>()
  for (const pd of Object.keys(CRM_OBJECT) as PdObject[]) {
    for (const r of await rawRows(tx, `cfg:field:${pd}`)) {
      const f = normalizeField(r.payload)
      if (f) pdFields.set(`${CRM_OBJECT[pd]}|${f.code}`, { type: f.type, options: f.options, custom: f.custom })
    }
  }
  for (const d of defs) {
    const pd = pdFields.get(`${d.object}|${d.external_ref}`)
    plans[d.object]?.push({
      object: d.object, key: d.key, label: d.label_en, dataType: d.data_type, options: d.options, externalRef: d.external_ref, mappedTo: d.mapped_to,
      dataClass: d.data_class, position: d.position, custom: pd?.custom ?? /^[0-9a-f]{40}$/.test(d.external_ref), pdType: pd?.type ?? 'varchar', pdOptions: pd?.options ?? [],
    })
  }

  const ownerMarket = new Map<string, string>()
  const tally = new Map<string, Map<string, number>>()
  for (const r of await tx<{ owner: string | null; pipeline: string | null; n: number }[]>`
    select payload ->> 'owner_id' as owner, payload ->> 'pipeline_id' as pipeline, count(*)::int as n
      from crm.import_raw where source = ${SRC} and object = 'deal' group by 1, 2`) {
    const m = r.pipeline ? pipelineMarket.get(r.pipeline) : undefined
    if (!r.owner || !m) continue
    const t = tally.get(r.owner) ?? new Map<string, number>()
    t.set(m, (t.get(m) ?? 0) + r.n)
    tally.set(r.owner, t)
  }
  for (const [owner, t] of tally) ownerMarket.set(owner, [...t.entries()].sort((a, b) => b[1] - a[1])[0]![0])

  const defaultMotor = new Map<string, string>()
  for (const p of await tx<{ market_code: string; motor: string }[]>`select market_code, motor from crm.pipelines where is_active order by market_code, position desc`) {
    defaultMotor.set(p.market_code, p.motor)
  }
  const activityTypes = new Map<string, string>()
  for (const t of await rawRows(tx, 'cfg:activity_type')) activityTypes.set(String(t.payload.key_string ?? t.external_id), String(t.payload.name ?? t.payload.key_string ?? ''))
  const leadLabels = new Map<string, string>()
  for (const l of await rawRows(tx, 'cfg:lead_label')) leadLabels.set(l.external_id, String(l.payload.name ?? ''))

  return { markets, users, userNames, pipelines, stages, pipelineMarket, plans, ownerMarket, defaultMotor, activityTypes, leadLabels }
}

export async function refMap(tx: Tx, object: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!ids.length) return out
  for (const r of await tx<{ external_id: string; internal_id: string }[]>`
    select external_id, internal_id from crm.external_refs where system = ${SRC} and object = ${object} and external_id = any(${ids}::text[])`) {
    out.set(r.external_id, r.internal_id)
  }
  return out
}

export async function accountsByOrg(tx: Tx, orgIds: string[]): Promise<Map<string, { id: string; market: string }>> {
  const out = new Map<string, { id: string; market: string }>()
  if (!orgIds.length) return out
  for (const r of await tx<{ external_id: string; id: string; market_code: string }[]>`
    select al.external_id, coalesce(a.merged_into, a.id) as id, a.market_code
      from crm.account_aliases al join crm.accounts a on a.id = al.account_id
     where al.system = ${SRC} and al.valid_to is null and al.external_id = any(${orgIds}::text[])`) {
    out.set(r.external_id, { id: r.id, market: r.market_code })
  }
  return out
}

export async function newIds(tx: Tx, n: number): Promise<string[]> {
  if (n <= 0) return []
  const rows = await tx<{ id: string }[]>`select app.uuid_v7() as id from generate_series(1, ${n})`
  return rows.map((r) => r.id)
}

export async function markLoaded(tx: Tx, object: string, done: { id: string; note: string | null }[]): Promise<void> {
  if (!done.length) return
  await tx`update crm.import_raw r set loaded_at = now(), load_note = x.note
             from jsonb_to_recordset(${tx.json(done as unknown as Json)}) as x(id text, note text)
            where r.source = ${SRC} and r.object = ${object} and r.external_id = x.id`
}

export async function saveRefs(tx: Tx, object: string, pairs: { ext: string; id: string }[]): Promise<void> {
  if (!pairs.length) return
  await tx`insert into crm.external_refs (system, object, external_id, internal_id)
           select ${SRC}, ${object}, x.ext, x.id from jsonb_to_recordset(${tx.json(pairs as unknown as Json)}) as x(ext text, id uuid)
           on conflict (system, object, external_id) do nothing`
}

export type Issue = { code: string; step: string; detail?: string; n?: number }

export async function bump(tx: Tx, runId: string, path: string[], n: number): Promise<void> {
  if (!n) return
  await tx`update crm.import_runs set updated_at = now(),
             stats = jsonb_set(stats, ${path}::text[], to_jsonb(coalesce((stats #>> ${path}::text[])::bigint, 0) + ${n}), true)
            where id = ${runId}`
}

export async function addIssue(tx: Tx, runId: string, issue: Issue): Promise<void> {
  const probe = issue.detail ? { code: issue.code, step: issue.step, detail: issue.detail } : { code: issue.code, step: issue.step }
  await tx`update crm.import_runs set issues = issues || ${tx.json([issue] as unknown as Json)}
            where id = ${runId} and not issues @> ${tx.json([probe] as unknown as Json)} and jsonb_array_length(issues) < 200`
}


export async function ensureLossReason(tx: Tx, label: string): Promise<string> {
  const text = label.trim().slice(0, 80)
  if (!text) return 'pd_unspecified'
  const code = lossCode(text)
  await tx`insert into crm.loss_reasons (code, kind, label_es, label_en) values (${code}, 'lost', ${text}, ${text}) on conflict (code) do nothing`
  return code
}

