import 'server-only'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit } from '@/domain/common'
import { insertAccountTx } from '@/domain/accounts'
import { accountRule, skipReason } from '@/domain/intake'
import { DomainError, invalid } from '@/lib/errors'
import { toE164 } from '@/lib/format'

// CAMPO-01: contrato de eventos v1 entre la Sales App y CONTIGO (propuesto).
// Los nombres siguen los campos de VisitResponse de Sales Core. La visita se registra una sola vez, allá;
// aquí solo se lee. El PDV nace allá; CONTIGO emite el ID canónico y lo devuelve como alias.
const iso = z.string().datetime({ offset: true })

export const visitEvent = z.object({
  event_id: z.string().min(8).max(80),
  type: z.literal('visit.checked_out'),
  version: z.literal(1),
  occurred_at: iso,
  data: z.object({
    visit_id: z.string().min(1).max(80),
    customer_id: z.string().min(1).max(80),
    salesperson_id: z.string().min(1).max(80),
    salesperson_email: z.string().email().optional(),
    business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checked_in_at: iso,
    checked_out_at: iso.nullable().optional(),
    duration_seconds: z.number().int().nonnegative().nullable().optional(),
    sale: z.boolean(),
    rejection_reason: z.string().max(40).nullable().optional(),
    revisit: z.boolean().default(false),
    revisit_reason: z.string().max(120).nullable().optional(),
    decision_maker_present: z.boolean().nullable().optional(),
    auto_closed: z.boolean().default(false),
    note: z.string().max(500).nullable().optional(),
  }),
})

export const storeEvent = z.object({
  event_id: z.string().min(8).max(80),
  type: z.literal('store.created'),
  version: z.literal(1),
  occurred_at: iso,
  data: z.object({
    customer_id: z.string().min(1).max(80),
    market: z.string().length(2),
    name: z.string().trim().min(2).max(160),
    phone: z.string().max(30).nullable().optional(),
    locality: z.string().max(120).nullable().optional(),
    region: z.string().max(120).nullable().optional(),
    salesperson_email: z.string().email().optional(),
  }),
})

export const salesAppEvent = z.discriminatedUnion('type', [visitEvent, storeEvent])
export type SalesAppEvent = z.infer<typeof salesAppEvent>
export type IngestResult = { status: 'processed' | 'duplicate' | 'unmatched'; detail?: string; accountId?: string }

async function openEvent(tx: Tx, ev: SalesAppEvent, market: string | null): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    insert into crm.inbound_events (source, event_type, idempotency_key, market_code, payload)
    values ('sales_app', ${ev.type}, ${ev.event_id}, ${market}, ${tx.json(ev as never)})
    on conflict (source, idempotency_key) do nothing returning id`
  return rows[0]?.id ?? null
}

/** REL-07: procesar dos veces el mismo evento no cambia nada. Corre como usuario de sistema. */
export async function ingestSalesAppEvent(sys: Ctx, raw: unknown): Promise<IngestResult> {
  const parsed = salesAppEvent.safeParse(raw)
  if (!parsed.success) throw invalid('El evento no cumple el contrato v1.', 'The event does not match contract v1.')
  const ev = parsed.data
  return withUser(sys.user.id, async (tx) => {
    if (ev.type === 'store.created') return ingestStore(tx, sys, ev)
    return ingestVisit(tx, sys, ev)
  })
}

async function ingestVisit(tx: Tx, sys: Ctx, ev: z.infer<typeof visitEvent>): Promise<IngestResult> {
  const d = ev.data
  const accs = await tx<{ id: string; market_code: string }[]>`
    select a.id, a.market_code from crm.account_aliases al join crm.accounts a on a.id = al.account_id
     where al.system = 'sales_core' and al.external_id = ${d.customer_id} and al.valid_to is null and a.archived_at is null`
  const acc = accs[0]
  const eventId = await openEvent(tx, ev, acc?.market_code ?? null)
  if (!eventId) return { status: 'duplicate' }
  if (!acc) {
    await tx`update crm.inbound_events set status = 'rejected', error = 'unknown customer_id', processed_at = now() where id = ${eventId}`
    const mk = await tx<{ code: string }[]>`select code from crm.markets where status = 'live' order by code limit 1`
    await tx`insert into crm.exceptions (market_code, kind, severity, detail, dedupe_key)
             values (${mk[0]!.code}, 'unmatched_event', 'medium', ${tx.json({ source: 'sales_app', type: ev.type, customer_id: d.customer_id })}, ${'unmatched:' + ev.event_id})
             on conflict do nothing`
    return { status: 'unmatched', detail: 'unknown customer_id' }
  }
  if (!d.sale && d.rejection_reason) {
    const ok = await tx`select 1 from crm.loss_reasons where code = ${d.rejection_reason} and kind = 'no_sale'`
    if (!ok[0]) d.rejection_reason = null
  }
  const users = d.salesperson_email ? await tx<{ id: string }[]>`select id from crm.users where email = ${d.salesperson_email} and is_active` : []
  await tx`insert into crm.visits (market_code, account_id, external_visit_id, salesperson_ref, user_id, business_date, checked_in_at, checked_out_at,
                                   duration_seconds, outcome, rejection_code, revisit, revisit_reason, decision_maker_seen, auto_closed, note, inbound_event_id)
           values (${acc.market_code}, ${acc.id}, ${d.visit_id}, ${d.salesperson_id}, ${users[0]?.id ?? null}, ${d.business_date}, ${d.checked_in_at},
                   ${d.checked_out_at ?? null}, ${d.duration_seconds ?? null}, ${d.sale ? 'sale' : 'no_sale'}, ${d.sale ? null : (d.rejection_reason ?? null)},
                   ${d.revisit}, ${d.revisit_reason ?? null}, ${d.decision_maker_present ?? null}, ${d.auto_closed}, ${d.note ?? null}, ${eventId})
           on conflict (external_visit_id) do nothing`
  // PIPE-05: la revisita al decisor queda visible en el embudo, no escondida en una nota.
  if (d.revisit) {
    await tx`update crm.deals set revisit_needed = true, revisit_reason = ${d.revisit_reason ?? d.rejection_reason ?? 'revisit'},
              revisit_due = ${d.business_date}::date + 2 where account_id = ${acc.id} and status = 'open'`
  } else if (d.decision_maker_present) {
    await tx`update crm.deals set revisit_needed = false, decision_maker_met = (decision_maker_id is not null) where account_id = ${acc.id} and status = 'open'`
  }
  await tx`update crm.inbound_events set status = 'processed', processed_at = now() where id = ${eventId}`
  await audit(tx, sys, 'integration.visit_received', 'account', acc.id, acc.market_code, null, { visit_id: d.visit_id, sale: d.sale, revisit: d.revisit })
  return { status: 'processed', accountId: acc.id }
}

async function ingestStore(tx: Tx, sys: Ctx, ev: z.infer<typeof storeEvent>): Promise<IngestResult> {
  const d = ev.data
  const eventId = await openEvent(tx, ev, d.market)
  if (!eventId) return { status: 'duplicate' }
  const existing = await tx<{ account_id: string }[]>`
    select account_id from crm.account_aliases where system = 'sales_core' and external_id = ${d.customer_id} and valid_to is null`
  let accountId = existing[0]?.account_id
  if (!accountId) {
    const mk = await tx<{ phone_cc: string }[]>`select phone_cc from crm.markets where code = ${d.market}`
    if (!mk[0]) {
      await tx`update crm.inbound_events set status = 'rejected', error = 'unknown market', processed_at = now() where id = ${eventId}`
      return { status: 'unmatched', detail: 'unknown market' }
    }
    const phone = toE164(d.phone ?? null, mk[0].phone_cc)
    // Un solo creador de PDV: si el comercio ya existe como prospecto (mismo teléfono), se liga; no se duplica.
    const match = phone ? await tx<{ id: string }[]>`select id from crm.accounts where market_code = ${d.market} and phone = ${phone} and archived_at is null order by created_at limit 1` : []
    accountId = match[0]?.id
    if (!accountId) {
      const owner = d.salesperson_email ? await tx<{ id: string }[]>`select id from crm.users where email = ${d.salesperson_email} and is_active` : []
      // AUT-01: el punto de venta nace por la misma función que el alta de la pantalla, con sus mismas reglas de entrada.
      const broken = accountRule({ name: d.name, phone })
      if (broken) {
        await tx`update crm.inbound_events set status = 'rejected', error = ${skipReason(broken)}, processed_at = now() where id = ${eventId}`
        return { status: 'unmatched', detail: skipReason(broken) }
      }
      accountId = await insertAccountTx(tx, { market: d.market, kind: 'store', accountType: null, name: d.name, segment: 'd2d', lifecycle: 'onboarding', parentId: null,
        ownerId: owner[0]?.id ?? null, territoryId: null, phone, locality: d.locality ?? null, region: d.region ?? null, createdBy: sys.user.id })
      await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by)
               values (${accountId}, ${d.market}, 'origin', 'import', 'sales_app', 'Sales App', ${sys.user.id})`
    } else {
      await tx`update crm.accounts set lifecycle = 'onboarding' where id = ${accountId} and lifecycle = 'prospect'`
    }
    await tx`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${accountId}, ${d.market}, 'sales_core', ${d.customer_id})`
    await emit(tx, 'account.alias_issued', 'account', accountId, d.market, { system: 'sales_core', external_id: d.customer_id, account_id: accountId })
  }
  await tx`update crm.inbound_events set status = 'processed', processed_at = now() where id = ${eventId}`
  await audit(tx, sys, 'integration.store_received', 'account', accountId, d.market, null, { customer_id: d.customer_id })
  return { status: 'processed', accountId }
}

// AUT-06 / REP-04: archivo diario de agregados del lakehouse (S5). Nunca transacciones individuales.
const metricRow = z.object({
  merchant_ref: z.string().min(1).max(80),
  first_txn_at: iso.nullable().optional(),
  last_txn_at: iso.nullable().optional(),
  txn_count_30d: z.number().int().nonnegative(),
  volume_minor_30d: z.number().int().nonnegative(),
  currency: z.string().length(3),
  active_days_30d: z.number().int().min(0).max(31),
})
export const metricsFile = z
  .object({
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    file_name: z.string().min(3).max(160),
    // "full" = el archivo trae todos los comercios del corte; "delta" = solo los que cambiaron.
    mode: z.enum(['full', 'delta']).default('full'),
    rows: z.array(metricRow).min(1).max(20000),
  })
  .superRefine((f, ctx) => {
    // REL-10: llave única dentro del archivo.
    if (new Set(f.rows.map((r) => r.merchant_ref)).size !== f.rows.length) ctx.addIssue({ code: 'custom', message: 'duplicate merchant_ref', path: ['rows'] })
  })
export type MetricsFile = z.infer<typeof metricsFile>
export type MetricsResult = { status: 'loaded' | 'duplicate' | 'quarantined'; rows: number; matched: number; unmatched: number; dealsWon: number; batchId?: string }

export const AT_RISK_BELOW_ACTIVE_DAYS = 5
export const MAX_ROW_DELTA = 0.2

export async function ingestMetricsFile(sys: Ctx, raw: unknown): Promise<MetricsResult> {
  const parsed = metricsFile.safeParse(raw)
  if (!parsed.success) throw invalid('El archivo no cumple el formato merchant_metrics_daily v1.', 'The file does not match merchant_metrics_daily v1.')
  const file = parsed.data
  const checksum = createHash('sha256').update(JSON.stringify(file)).digest('hex')
  const result = await loadMetrics(sys, file, checksum)
  if (result.status === 'quarantined') {
    await withUser(sys.user.id, async (tx) => {
      await tx`insert into crm.ingest_batches (source, as_of, file_name, checksum, row_count, mode, status, reject_reason)
               values ('s5', ${file.as_of}, ${file.file_name}, ${checksum}, ${file.rows.length}, ${file.mode}, 'rejected', 'row_delta')
               on conflict (source, checksum) do nothing`
      await audit(tx, sys, 'integration.metrics_quarantined', 'ingest_batch', null, null, null, { as_of: file.as_of, rows: file.rows.length, reason: 'row_delta' })
    })
    throw new DomainError('quarantined',
      'El archivo cambió más de 20% de tamaño contra el anterior y quedó en cuarentena. No se aplicó nada.',
      'The file size changed more than 20% versus the previous one and was quarantined. Nothing was applied.', 409)
  }
  return result
}

async function loadMetrics(sys: Ctx, file: MetricsFile, checksum: string): Promise<MetricsResult> {
  return withUser(sys.user.id, async (tx) => {
    const seen = await tx`select 1 from crm.ingest_batches where source = 's5' and checksum = ${checksum}`
    if (seen[0]) return { status: 'duplicate', rows: file.rows.length, matched: 0, unmatched: 0, dealsWon: 0 }
    // REL-10: un archivo completo cuyo tamaño cambia más de ±20% contra el anterior no se aplica: queda en cuarentena.
    if (file.mode === 'full') {
      const prev = await tx<{ row_count: number }[]>`select row_count from crm.ingest_batches
        where source = 's5' and mode = 'full' and status = 'loaded' order by as_of desc, loaded_at desc limit 1`
      const before = prev[0]?.row_count
      if (before && Math.abs(file.rows.length - before) / before > MAX_ROW_DELTA) return { status: 'quarantined', rows: file.rows.length, matched: 0, unmatched: 0, dealsWon: 0 }
    }
    const batch = await tx<{ id: string }[]>`
      insert into crm.ingest_batches (source, as_of, file_name, checksum, row_count, mode)
      values ('s5', ${file.as_of}, ${file.file_name}, ${checksum}, ${file.rows.length}, ${file.mode})
      on conflict (source, checksum) do nothing returning id`
    if (!batch[0]) return { status: 'duplicate', rows: file.rows.length, matched: 0, unmatched: 0, dealsWon: 0 }
    const batchId = batch[0].id
    const rows = tx.json(file.rows as never)

    const loaded = await tx<{ account_id: string }[]>`
      with r as (
        select * from jsonb_to_recordset(${rows}) as x(merchant_ref text, first_txn_at timestamptz, last_txn_at timestamptz,
               txn_count_30d int, volume_minor_30d bigint, currency text, active_days_30d int)
      ), m as (
        select distinct on (al.account_id) r.*, al.account_id, a.market_code
          from r join crm.account_aliases al on al.external_id = r.merchant_ref and al.system in ('s5','sales_core') and al.valid_to is null
                 join crm.accounts a on a.id = al.account_id and a.archived_at is null
      )
      insert into crm.merchant_metrics_daily (account_id, as_of, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d, batch_id)
      select account_id, ${file.as_of}, market_code, first_txn_at, last_txn_at, txn_count_30d, volume_minor_30d, currency, active_days_30d, ${batchId} from m
      on conflict (account_id, as_of) do update set first_txn_at = coalesce(crm.merchant_metrics_daily.first_txn_at, excluded.first_txn_at),
        last_txn_at = excluded.last_txn_at, txn_count_30d = excluded.txn_count_30d, volume_minor_30d = excluded.volume_minor_30d,
        active_days_30d = excluded.active_days_30d, batch_id = excluded.batch_id
      returning account_id`
    const ids = loaded.map((r) => r.account_id)
    const unmatched = file.rows.length - ids.length

    // PIPE-06: el deal se gana con la primera transacción real, con la fecha de esa transacción.
    const won = await tx<{ id: string; account_id: string; market_code: string }[]>`
      with target as (
        select d.id, d.stage_id as from_stage, w.id as to_stage, d.market_code, d.account_id, mm.first_txn_at
          from crm.deals d
          join crm.merchant_metrics_daily mm on mm.account_id = d.account_id and mm.as_of = ${file.as_of} and mm.first_txn_at is not null
          join crm.pipelines p on p.id = d.pipeline_id and (p.close_by_transaction or p.txn_also_wins)   -- E14.F8: contrato firmado, o primera transacción
          join lateral (select s.id from crm.stages s where s.pipeline_id = d.pipeline_id and s.kind = 'won' limit 1) w on true
         where d.status = 'open' and d.account_id = any(${ids}::uuid[])
      ), ev as (
        insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause)
        select id, market_code, from_stage, to_stage, ${sys.user.id}, 'transaction' from target
      )
      update crm.deals d set status = 'won', stage_id = t.to_stage, won_at = t.first_txn_at, closed_by = 'transaction',
             stage_entered_at = now(), revisit_needed = false
        from target t where d.id = t.id
      returning d.id, d.account_id, d.market_code`

    // CS-01: al activarse, el comercio cambia de etapa de vida y el handoff a operaciones nace con dueño y fecha.
    await tx`
      insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by, source)
      select d.market_code, d.account_id, d.id, 'handoff',
             case when mk.default_locale = 'en' then 'Handoff: welcome call and activation follow-up' else 'Entrega a Operaciones: bienvenida y seguimiento de activación' end,
             now() + interval '2 days',
             coalesce((select m.user_id from crm.memberships m where m.market_code = d.market_code and m.role = 'ops' and (m.valid_to is null or m.valid_to > now()) order by m.created_at limit 1), d.owner_id),
             ${sys.user.id}, 's5'
        from crm.deals d join crm.markets mk on mk.code = d.market_code
       where d.id = any(${won.map((w) => w.id)}::uuid[])`
    await tx`update crm.accounts a set lifecycle = 'active'
              from crm.merchant_metrics_daily mm
             where mm.account_id = a.id and mm.as_of = ${file.as_of} and a.id = any(${ids}::uuid[])
               and ((a.lifecycle in ('prospect','onboarding') and mm.first_txn_at is not null)
                    or (a.lifecycle in ('at_risk','inactive') and mm.active_days_30d >= ${AT_RISK_BELOW_ACTIVE_DAYS}))`
    await tx`update crm.accounts a set lifecycle = case when mm.txn_count_30d = 0 then 'inactive' else 'at_risk' end
              from crm.merchant_metrics_daily mm
             where mm.account_id = a.id and mm.as_of = ${file.as_of} and a.id = any(${ids}::uuid[])
               and a.lifecycle in ('active','at_risk') and mm.active_days_30d < ${AT_RISK_BELOW_ACTIVE_DAYS}
               and a.lifecycle <> case when mm.txn_count_30d = 0 then 'inactive' else 'at_risk' end
               and mm.first_txn_at < now() - interval '14 days'`

    await tx`update crm.ingest_batches set matched = ${ids.length}, unmatched = ${unmatched} where id = ${batchId}`
    for (const w of won) {
      await audit(tx, sys, 'deal.won_by_transaction', 'deal', w.id, w.market_code, { status: 'open' }, { status: 'won', as_of: file.as_of })
      await emit(tx, 'deal.won', 'deal', w.id, w.market_code, { account_id: w.account_id, closed_by: 'transaction' })
    }
    await audit(tx, sys, 'integration.metrics_loaded', 'ingest_batch', batchId, null, null,
      { as_of: file.as_of, rows: file.rows.length, matched: ids.length, unmatched, deals_won: won.length })
    return { status: 'loaded', rows: file.rows.length, matched: ids.length, unmatched, dealsWon: won.length, batchId }
  })
}
