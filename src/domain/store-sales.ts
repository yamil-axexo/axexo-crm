import 'server-only'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid } from '@/lib/errors'

/**
 * E5.F1 / E5.F2: cifras de ventas por tienda. Data y Reportería deja cada noche un archivo con, por Merchant ID,
 * las activaciones por carrier y el volumen de pago por producto: mes a la fecha, mes anterior y últimos 90 días.
 * Contrato propio (propuesta): docs/contracts/store-sales-daily-v1.md. Se guarda por tienda y por corte.
 * Un carrier o producto sin actividad (0 o sin dato) se guarda vacío: la pantalla lo muestra vacío, nunca en cero.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const count = z.number().int().nonnegative().nullable().optional()
const label = z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N} .&+/_-]+$/u)
const line = z.object({ mtd: count, prev_month: count, d90: count })

export const storeSalesRow = z.object({
  merchant_ref: z.string().trim().min(1).max(80),
  currency: z.string().length(3).optional(),
  activations: z.array(line.extend({ carrier: label })).max(40).default([]),
  payments: z.array(line.extend({ product: label })).max(40).default([]),
})
export const storeSalesFile = z
  .object({
    contract: z.literal('store_sales_daily'),
    version: z.literal(1),
    as_of: day,
    file_name: z.string().min(3).max(160),
    rows: z.array(storeSalesRow).min(1).max(20000),
  })
  .superRefine((f, ctx) => {
    if (new Set(f.rows.map((r) => r.merchant_ref)).size !== f.rows.length) ctx.addIssue({ code: 'custom', message: 'duplicate merchant_ref', path: ['rows'] })
    f.rows.forEach((r, i) => {
      if (r.payments.length && !r.currency) ctx.addIssue({ code: 'custom', message: 'payments need currency', path: ['rows', i, 'currency'] })
      if (new Set(r.activations.map((a) => a.carrier.toLowerCase())).size !== r.activations.length) ctx.addIssue({ code: 'custom', message: 'duplicate carrier', path: ['rows', i] })
      if (new Set(r.payments.map((a) => a.product.toLowerCase())).size !== r.payments.length) ctx.addIssue({ code: 'custom', message: 'duplicate product', path: ['rows', i] })
    })
  })
export type StoreSalesFile = z.infer<typeof storeSalesFile>
export type StoreSalesResult = { status: 'loaded' | 'duplicate'; rows: number; matched: number; unmatched: number; lines: number; batchId?: string }

/** Cero o sin dato es "sin actividad": se guarda vacío. */
export const activity = (n: number | null | undefined): number | null => (n && n > 0 ? n : null)

/** Carga un archivo de cifras por tienda. Idempotente por contenido; un corte que vuelve a llegar reemplaza sus cifras. */
export async function ingestStoreSales(sys: Ctx, raw: unknown): Promise<StoreSalesResult> {
  const parsed = storeSalesFile.safeParse(raw)
  if (!parsed.success) throw invalid('El archivo no cumple el formato store_sales_daily v1.', 'The file does not match store_sales_daily v1.')
  const file = parsed.data
  const checksum = createHash('sha256').update(JSON.stringify(file)).digest('hex')
  return withUser(sys.user.id, async (tx) => {
    const batch = await tx<{ id: string }[]>`
      insert into crm.ingest_batches (source, as_of, file_name, checksum, row_count, mode)
      values ('s5_store_sales', ${file.as_of}, ${file.file_name}, ${checksum}, ${file.rows.length}, 'full')
      on conflict (source, checksum) do nothing returning id`
    if (!batch[0]) return { status: 'duplicate', rows: file.rows.length, matched: 0, unmatched: 0, lines: 0 }
    const batchId = batch[0].id
    const flat = file.rows.flatMap((r) => [
      ...r.activations.map((a) => ({ merchant_ref: r.merchant_ref, kind: 'activations', key: a.carrier, mtd: activity(a.mtd), prev: activity(a.prev_month), d90: activity(a.d90), currency: null })),
      ...r.payments.map((p) => ({ merchant_ref: r.merchant_ref, kind: 'payments', key: p.product, mtd: activity(p.mtd), prev: activity(p.prev_month), d90: activity(p.d90), currency: r.currency!.toUpperCase() })),
    ])
    const refs = file.rows.map((r) => r.merchant_ref)
    const matched = await tx<{ merchant_ref: string; account_id: string; market_code: string }[]>`
      select distinct on (al.external_id) al.external_id as merchant_ref, al.account_id, a.market_code
        from crm.account_aliases al join crm.accounts a on a.id = al.account_id and a.archived_at is null
       where al.external_id = any(${refs}::text[]) and al.system in ('s5','sales_core') and al.valid_to is null
       order by al.external_id, (al.system = 's5') desc`
    const byRef = new Map(matched.map((m) => [m.merchant_ref, m]))
    // El corte completo de una tienda se reemplaza: lo que ya no viene en el archivo deja de mostrarse.
    await tx`delete from crm.store_sales_lines where as_of = ${file.as_of} and account_id = any(${matched.map((m) => m.account_id)}::uuid[])`
    const rows = flat.filter((l) => byRef.has(l.merchant_ref)).map((l) => ({ ...l, account_id: byRef.get(l.merchant_ref)!.account_id, market_code: byRef.get(l.merchant_ref)!.market_code }))
    if (rows.length)
      await tx`
        insert into crm.store_sales_lines (account_id, as_of, market_code, line_kind, line_key, mtd, prev_month, d90, currency, batch_id)
        select x.account_id, ${file.as_of}, x.market_code, x.kind, x.key, x.mtd, x.prev, x.d90, x.currency, ${batchId}
          from jsonb_to_recordset(${tx.json(rows as never)}) as x(account_id uuid, market_code text, kind text, key text, mtd bigint, prev bigint, d90 bigint, currency text)`
    const unmatched = file.rows.length - matched.length
    await tx`update crm.ingest_batches set matched = ${matched.length}, unmatched = ${unmatched} where id = ${batchId}`
    await audit(tx, sys, 'integration.store_sales_loaded', 'ingest_batch', batchId, null, null, { as_of: file.as_of, rows: file.rows.length, matched: matched.length, unmatched, lines: rows.length })
    return { status: 'loaded', rows: file.rows.length, matched: matched.length, unmatched, lines: rows.length, batchId }
  })
}
