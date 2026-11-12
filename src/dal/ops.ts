import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { notifiable } from '@/domain/ops'
import { fieldKey, missingForStage, type StageKind } from '@/domain/deals'
import { isUuid } from '@/lib/ids'

export type OpsView = 'unassigned' | 'mine' | 'all'
export type OpsFocus = 'approval' | 'training'
export type OpsRow = {
  id: string
  title: string
  account_id: string
  account_name: string
  merchant_ref: string | null
  market_code: string
  pipeline_name: string
  stage_es: string
  stage_en: string
  since: Date
  seller: string | null
  ops_owner_id: string | null
  ops_owner: string | null
  ops_next_step: string | null
  ops_next_step_due: string | null
  docs_missing: number
  providers_pending: number
  training_status: string
  /** El embudo lleva la lista de alta (documentos, proveedores, capacitación). Un pedido no. */
  checklist: boolean
  /** En pausa (paquete b2b): sigue en la cola, pero no cuenta como pendiente ni como negocio sin movimiento. */
  paused_at: Date | null
  pause_review_on: string | null
}
export type OpsQueue = { rows: OpsRow[]; counts: { unassigned: number; mine: number; all: number; approval: number; training: number }; markets: string[] }

/** Mercados donde la persona trabaja la cola de Operaciones. */
export const opsMarkets = (ctx: Ctx): string[] => ctx.markets.filter((m) => ctx.can('deal.ops', m.code)).map((m) => m.code)

/**
 * Cola de Operaciones: negocios abiertos en etapas de Operaciones de los mercados de la persona, con cuánto llevan ahí,
 * quién vendió y qué falta (documentos por recibir, proveedores sin aprobar, capacitación).
 */
export async function getOpsQueue(ctx: Ctx, f: { view?: OpsView; market?: string; focus?: OpsFocus }): Promise<OpsQueue> {
  const markets = opsMarkets(ctx)
  const scope = f.market && markets.includes(f.market) ? [f.market] : markets
  const empty = { rows: [], counts: { unassigned: 0, mine: 0, all: 0, approval: 0, training: 0 }, markets }
  if (scope.length === 0) return empty
  return withUser(ctx.user.id, async (tx) => {
    const base = tx`
      from crm.deals d join crm.stages s on s.id = d.stage_id and s.is_ops join crm.pipelines p on p.id = d.pipeline_id
      join crm.accounts a on a.id = d.account_id
      left join crm.users u on u.id = d.owner_id left join crm.users o on o.id = d.ops_owner_id
      cross join lateral (
        -- La lista de alta (documentos, proveedores, capacitación) aplica por embudo: un pedido no la lleva ni infla estos contadores.
        select (select count(*)::int from crm.ops_catalog c where p.ops_checklist and c.kind = 'document' and c.is_active and (c.market_code is null or c.market_code = d.market_code)
                  and not exists (select 1 from crm.deal_ops_checks k where k.deal_id = d.id and k.catalog_id = c.id and k.status in ('received', 'validated'))) as docs_missing,
               (select count(*)::int from crm.ops_catalog c where p.ops_checklist and c.kind = 'provider' and c.is_active and (c.market_code is null or c.market_code = d.market_code)
                  and not exists (select 1 from crm.deal_ops_checks k where k.deal_id = d.id and k.catalog_id = c.id and k.status in ('approved', 'rejected'))) as providers_pending) x
     where d.status = 'open' and d.market_code = any(${scope}::text[])`
    const view = f.view === 'mine' ? tx`and d.ops_owner_id = ${ctx.user.id}` : f.view === 'all' ? tx`` : tx`and d.ops_owner_id is null`
    // Un negocio en pausa no cuenta como pendiente de aprobación ni de capacitación: espera a su fecha de revisión.
    const focus = f.focus === 'approval' ? tx`and x.providers_pending > 0 and d.paused_at is null` : f.focus === 'training' ? tx`and p.ops_checklist and d.training_status <> 'done' and d.paused_at is null` : tx``
    const rows = await tx<OpsRow[]>`
      select d.id, d.title, d.account_id, a.name as account_name, a.merchant_ref, d.market_code, p.name as pipeline_name, s.name_es as stage_es, s.name_en as stage_en,
             coalesce(d.ops_entered_at, d.stage_entered_at) as since, u.full_name as seller, d.ops_owner_id, o.full_name as ops_owner,
             d.ops_next_step, d.ops_next_step_due::text, x.docs_missing, x.providers_pending, d.training_status, p.ops_checklist as checklist, d.paused_at, d.pause_review_on::text
        ${base} ${f.focus ? tx`` : view} ${focus}
       order by (d.paused_at is not null), coalesce(d.ops_entered_at, d.stage_entered_at) limit 100`
    const c = await tx<{ unassigned: number; mine: number; all: number; approval: number; training: number }[]>`
      select count(*) filter (where d.ops_owner_id is null)::int as unassigned, count(*) filter (where d.ops_owner_id = ${ctx.user.id})::int as mine, count(*)::int as all,
             count(*) filter (where x.providers_pending > 0 and d.paused_at is null)::int as approval, count(*) filter (where p.ops_checklist and d.training_status <> 'done' and d.paused_at is null)::int as training
        ${base}`
    return { rows: [...rows], counts: c[0] ?? empty.counts, markets }
  })
}

/** Para el dock: cuántos negocios esperan en la cola de Operaciones sin que nadie los haya tomado. */
export async function opsWaiting(ctx: Ctx): Promise<number> {
  const markets = opsMarkets(ctx)
  if (markets.length === 0) return 0
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ n: number }[]>`
      select count(*)::int as n from crm.deals d join crm.stages s on s.id = d.stage_id and s.is_ops
       where d.status = 'open' and d.ops_owner_id is null and d.paused_at is null and d.market_code = any(${markets}::text[])`
    return rows[0]?.n ?? 0
  })
}

export type OpsCheck = { catalog_id: string; kind: 'provider' | 'document'; label_es: string; label_en: string; status: string | null; on_date: string | null; link: string | null }

/** Lo que Operaciones mantiene de un negocio: proveedores y documentos del catálogo del mercado con su estado, y el próximo paso de Operaciones. */
export async function getDealOps(ctx: Ctx, dealId: string) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; account_id: string; ops_owner_id: string | null; ops_owner: string | null; ops_next_step: string | null; ops_next_step_due: string | null; training_status: string; training_on: string | null;
      merchant_ref: string | null; is_ops: boolean; has_items: boolean; multi_open: boolean; checklist: boolean; ops_entered_at: Date | null; return_to: string | null }[]>`
      select d.market_code, d.account_id, d.ops_owner_id, o.full_name as ops_owner, d.ops_next_step, d.ops_next_step_due::text, d.training_status, d.training_on::text,
             a.merchant_ref, s.is_ops, p.has_items, p.multi_open, p.ops_checklist as checklist, d.ops_entered_at,
             (select b.id from crm.stages b where b.pipeline_id = d.pipeline_id and b.kind = 'open' and not b.is_ops and b.position < s.position order by b.position desc limit 1) as return_to
        from crm.deals d join crm.stages s on s.id = d.stage_id join crm.pipelines p on p.id = d.pipeline_id join crm.accounts a on a.id = d.account_id
        left join crm.users o on o.id = d.ops_owner_id where d.id = ${dealId}`
    const d = rows[0]
    if (!d) return null
    const checks = await tx<OpsCheck[]>`
      select c.id as catalog_id, c.kind, c.label_es, c.label_en, k.status, k.on_date::text, k.link
        from crm.ops_catalog c left join crm.deal_ops_checks k on k.catalog_id = c.id and k.deal_id = ${dealId}
       where c.kind in ('provider', 'document') and (c.is_active or k.id is not null) and (c.market_code is null or c.market_code = ${d.market_code})
         and (${d.checklist} or k.id is not null)
       order by c.kind desc, c.position, c.label_es`
    const reasons = await tx<{ code: string; label_es: string; label_en: string }[]>`
      select distinct on (code) code, label_es, label_en from crm.ops_catalog
       where kind = 'return_reason' and is_active and (market_code is null or market_code = ${d.market_code}) order by code, market_code nulls last`
    const products = d.has_items ? await tx<{ id: string; name: string; unit_price_minor: string | null }[]>`
      select id, name, unit_price_minor::text from crm.products where is_active and market_code = ${d.market_code} order by name` : []
    const hasOpsStage = await tx`select 1 from crm.stages s join crm.deals x on x.pipeline_id = s.pipeline_id where x.id = ${dealId} and s.is_ops limit 1`
    return { ...d, checks: [...checks], reasons: [...reasons], products: [...products], pipelineHasOps: hasOpsStage.length > 0 }
  })
}

export type Notice = { id: string; body: string; from_name: string; account_id: string | null; deal_id: string | null; record: string | null; created_at: Date }

/** Avisos sin ver de la persona: alguien le avisó desde una nota. */
export async function myNotices(ctx: Ctx): Promise<Notice[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<Notice[]>`
      select n.id, n.body, u.full_name as from_name, n.account_id, n.deal_id, coalesce(d.title, a.name) as record, n.created_at
        from crm.notices n join crm.users u on u.id = n.from_user_id left join crm.deals d on d.id = n.deal_id left join crm.accounts a on a.id = n.account_id
       where n.user_id = ${ctx.user.id} and n.seen_at is null order by n.created_at desc limit 20`
    return [...rows]
  })
}

/** A quién se le puede avisar desde una nota de este comercio o negocio. */
export async function notifyOptions(ctx: Ctx, p: { accountId?: string | null; dealId?: string | null }): Promise<{ id: string; full_name: string }[]> {
  if (!isUuid(p.accountId ?? undefined) && !isUuid(p.dealId ?? undefined)) return []
  return withUser(ctx.user.id, async (tx) => {
    const rec = p.dealId
      ? await tx<{ market_code: string; account_id: string }[]>`select market_code, account_id from crm.deals where id = ${p.dealId}`
      : await tx<{ market_code: string; account_id: string }[]>`select market_code, id as account_id from crm.accounts where id = ${p.accountId!}`
    if (!rec[0]) return []
    return notifiable(tx, ctx, rec[0].market_code, rec[0].account_id, p.dealId ?? null)
  })
}

export type StaleDeal = { id: string; title: string; account_name: string; owner_name: string | null; stage_es: string; stage_en: string; last_move: Date; amount_minor: string | null; currency: string }

/** Negocios abiertos de un embudo sin movimiento (cambio de etapa o actividad) en más de N días. */
export async function staleDeals(ctx: Ctx, pipelineId: string, days: number): Promise<StaleDeal[]> {
  const n = Math.min(Math.max(Math.round(days) || 30, 1), 720)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<StaleDeal[]>`
      select * from (
        select d.id, d.title, a.name as account_name, u.full_name as owner_name, s.name_es as stage_es, s.name_en as stage_en,
               greatest(d.stage_entered_at, d.created_at, coalesce((select max(coalesce(x.done_at, x.created_at)) from crm.activities x where x.deal_id = d.id), d.created_at)) as last_move,
               d.amount_minor::text, d.currency
          from crm.deals d join crm.stages s on s.id = d.stage_id join crm.accounts a on a.id = d.account_id left join crm.users u on u.id = d.owner_id
         where d.pipeline_id = ${pipelineId} and d.status = 'open' and d.paused_at is null and d.market_code = any(app.my_markets())) x
       where x.last_move < now() - make_interval(days => ${n}) order by x.last_move limit 200`
    return [...rows]
  })
}

export type CatalogRow = { id: string; market_code: string | null; kind: string; label_es: string; label_en: string; is_active: boolean }

/** Lo que administración configura para Operaciones: catálogos, productos y propiedades de embudos y etapas. */
export async function getOpsConfig(ctx: Ctx) {
  return withUser(ctx.user.id, async (tx) => {
    const catalog = await tx<CatalogRow[]>`select id, market_code, kind, label_es, label_en, is_active from crm.ops_catalog order by kind, market_code nulls first, position, label_es`
    const products = await tx<{ id: string; market_code: string; name: string; unit_price_minor: string | null; is_active: boolean }[]>`
      select id, market_code, name, unit_price_minor::text, is_active from crm.products where market_code is not null order by market_code, name`
    const pipelines = await tx<{ id: string; market_code: string; name: string; multi_open: boolean; has_items: boolean }[]>`
      select id, market_code, name, multi_open, has_items from crm.pipelines where is_active order by market_code, position`
    const stages = await tx<{ id: string; pipeline_id: string; name_es: string; name_en: string; kind: string; is_ops: boolean }[]>`
      select id, pipeline_id, name_es, name_en, kind, is_ops from crm.stages where kind in ('open', 'awaiting_txn') order by pipeline_id, position`
    return { catalog: [...catalog], products: [...products], pipelines: [...pipelines], stages: [...stages] }
  })
}

export type GateField = { token: string; key: string; label_es: string; label_en: string; data_type: string; options: string[] }
export type GateInfo = { /** Campos adicionales que la etapa pide y faltan: se llenan en la misma hoja. */ fields?: GateField[]; missing: string[]; stageName: { es: string; en: string }; amount: string | null; nextStep: string | null; nextStepDue: string | null; decisionMakerId: string | null; decisionMakerMet: boolean; contacts: { id: string; full_name: string }[]; accountId: string }

/** Definición de los campos adicionales que faltan ('field:<clave>'), para pedirlos en la hoja del candado. */
export async function gateFields(tx: Tx, market: string, missing: string[]): Promise<GateField[]> {
  const keys = missing.map(fieldKey).filter((k): k is string => Boolean(k))
  if (keys.length === 0) return []
  const rows = await tx<{ key: string; label_es: string; label_en: string; data_type: string; options: string[] | null }[]>`
    select distinct on (key) key, label_es, label_en, data_type, options from crm.field_definitions
     where object = 'deal' and is_active and key = any(${keys}::text[]) and (market_code is null or market_code = ${market}) order by key, market_code nulls last`
  return rows.map((r) => ({ token: `field:${r.key}`, key: r.key, label_es: r.label_es, label_en: r.label_en, data_type: r.data_type, options: Array.isArray(r.options) ? r.options.map(String) : [] }))
}

/** Qué le falta a un negocio para entrar a una etapa, con lo necesario para resolverlo ahí mismo (candado de etapa). */
export async function gateInfo(ctx: Ctx, dealId: string, toStageId: string): Promise<GateInfo | null> {
  if (!isUuid(dealId) || !isUuid(toStageId)) return null
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ account_id: string; pipeline_id: string; stage_id: string; amount_minor: string | null; next_step: string | null; next_step_due: string | null; decision_maker_id: string | null; decision_maker_met: boolean; items: number; custom: Record<string, unknown>; market_code: string }[]>`
      select d.account_id, d.pipeline_id, d.stage_id, d.amount_minor::text, d.next_step, d.next_step_due::text, d.decision_maker_id, d.decision_maker_met, d.custom, d.market_code,
             (select count(*)::int from crm.deal_items i where i.deal_id = d.id) as items
        from crm.deals d where d.id = ${dealId} and d.status = 'open'`
    const d = rows[0]
    if (!d) return null
    const stages = await tx<{ id: string; position: number; kind: StageKind; required_fields: string[]; name_es: string; name_en: string }[]>`
      select id, position, kind, required_fields, name_es, name_en from crm.stages where pipeline_id = ${d.pipeline_id} order by position`
    const to = stages.find((s) => s.id === toStageId)
    const from = stages.find((s) => s.id === d.stage_id)
    if (!to || !from) return null
    const need = [...new Set(stages.filter((s) => (s.kind === 'open' || s.kind === 'awaiting_txn' || s.id === to.id) && s.position > from.position && s.position <= to.position).flatMap((s) => s.required_fields))]
    const missing = missingForStage({ ...d, items_count: d.items }, { kind: to.kind, required_fields: need })
    const contacts = await tx<{ id: string; full_name: string }[]>`
      select c.id, c.full_name from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id where ac.account_id = ${d.account_id} and ac.valid_to is null order by c.full_name`
    const fields = await gateFields(tx, d.market_code, missing)
    return { fields, missing, stageName: { es: to.name_es, en: to.name_en }, amount: d.amount_minor ? String(Number(d.amount_minor) / 100) : null, nextStep: d.next_step, nextStepDue: d.next_step_due,
      decisionMakerId: d.decision_maker_id, decisionMakerMet: d.decision_maker_met, contacts: [...contacts], accountId: d.account_id }
  })
}
