import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import { scrub } from '@/domain/pipedrive/mapping'
import type postgres from 'postgres'

type Def = { key: string; label_es: string; label_en: string; data_type: string; options: string[] }
export type CustomInput = Record<string, string | string[] | { amount: string; currency: string } | undefined>

/** Un campo es editable aquí si vive en `custom`: los que alimentan columnas del modelo o están restringidos no se tocan por esta vía. */
export const isEditable = (d: { mapped_to: string | null; data_class: string }) => d.mapped_to === null && d.data_class !== 'confidential'

function coerce(def: Def, raw: CustomInput[string]): unknown {
  const bad = () => invalid(`Revisa el campo "${def.label_es}".`, `Check the "${def.label_en}" field.`)
  if (def.data_type === 'multiselect') {
    const list = (Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : []).filter(Boolean)
    if (list.some((x) => !def.options.includes(x))) throw bad()
    return list.length ? list : undefined
  }
  if (def.data_type === 'money') {
    const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : { amount: typeof raw === 'string' ? raw : '', currency: '' }
    if (!o.amount.trim()) return undefined
    const amount = Number(o.amount)
    const currency = o.currency.trim().toUpperCase()
    if (!Number.isFinite(amount) || (currency && !/^[A-Z]{3}$/.test(currency))) throw bad()
    return { amount, currency: currency || null }
  }
  const s = (typeof raw === 'string' ? raw : '').trim()
  if (!s) return undefined
  switch (def.data_type) {
    case 'number': {
      const n = Number(s)
      if (!Number.isFinite(n)) throw bad()
      return n
    }
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad()
      return s
    case 'boolean':
      if (s !== 'true' && s !== 'false') throw bad()
      return s === 'true'
    case 'select':
      if (!def.options.includes(s)) throw bad()
      return s
    default:
      // SEC-08: una tarjeta o un SSN no entran por un campo de texto libre.
      if (scrub(s) !== s) throw invalid('Ese texto parece traer un número de tarjeta o un SSN. Ese dato no se guarda en CONTIGO.', 'That text looks like it holds a card number or an SSN. That data is not stored in CONTIGO.')
      return s.slice(0, 4000)
  }
}

/** DATA-08: edita los campos adicionales de una cuenta o un deal. Solo audita lo que cambió. */
export async function updateCustom(ctx: Ctx, object: 'account' | 'deal', id: string, input: CustomInput): Promise<number> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = object === 'account'
      ? await tx<{ market_code: string; custom: Record<string, unknown>; locked: boolean }[]>`select market_code, custom, archived_at is not null as locked from crm.accounts where id = ${id} for update`
      : await tx<{ market_code: string; custom: Record<string, unknown>; locked: boolean }[]>`select market_code, custom, false as locked from crm.deals where id = ${id} for update`
    const row = rows[0]
    if (!row) throw notFound()
    ctx.assert(object === 'account' ? 'account.edit' : 'deal.edit', row.market_code)
    if (row.locked) throw invalid('Un comercio archivado no se edita.', 'An archived merchant cannot be edited.')
    const defs = await tx<(Def & { mapped_to: string | null; data_class: string })[]>`
      select key, label_es, label_en, data_type, options, mapped_to, data_class from crm.field_definitions
       where object = ${object} and is_active and (market_code is null or market_code = ${row.market_code})`
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    const remove: string[] = []
    const patch: Record<string, unknown> = {}
    for (const d of defs) {
      if (!isEditable(d) || !(d.key in input)) continue
      const next = coerce(d, input[d.key])
      const prev = row.custom[d.key]
      if (JSON.stringify(next ?? null) === JSON.stringify(prev ?? null)) continue
      before[d.key] = prev ?? null
      after[d.key] = next ?? null
      if (next === undefined) remove.push(d.key)
      else patch[d.key] = next
    }
    const changed = Object.keys(after).length
    if (!changed) return 0
    const json = tx.json(patch as postgres.JSONValue)
    if (object === 'account') await tx`update crm.accounts set custom = (custom - ${remove}::text[]) || ${json} where id = ${id}`
    else await tx`update crm.deals set custom = (custom - ${remove}::text[]) || ${json} where id = ${id}`
    await audit(tx, ctx, `${object}.custom_updated`, object, id, row.market_code, before, after)
    return changed
  })
}

/** Configuración de un embudo: si cierra por primera transacción y qué etapa es la de espera. Solo administración (P11). */
export async function configurePipeline(ctx: Ctx, pipelineId: string, input: { closeByTransaction: boolean; awaitingStageId: string | null }): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; close_by_transaction: boolean }[]>`select market_code, close_by_transaction from crm.pipelines where id = ${pipelineId} for update`
    const p = rows[0]
    if (!p) throw notFound()
    const prev = await tx<{ id: string }[]>`select id from crm.stages where pipeline_id = ${pipelineId} and kind = 'awaiting_txn'`
    let awaiting: string | null = null
    if (input.closeByTransaction && input.awaitingStageId) {
      const ok = await tx`select 1 from crm.stages where id = ${input.awaitingStageId} and pipeline_id = ${pipelineId} and kind in ('open','awaiting_txn')`
      if (!ok[0]) throw invalid('Esa etapa no es de este embudo.', 'That stage does not belong to this pipeline.')
      awaiting = input.awaitingStageId
    }
    await tx`update crm.pipelines set close_by_transaction = ${input.closeByTransaction} where id = ${pipelineId}`
    await tx`update crm.stages set kind = 'open' where pipeline_id = ${pipelineId} and kind = 'awaiting_txn' and id is distinct from ${awaiting}`
    if (awaiting) await tx`update crm.stages set kind = 'awaiting_txn' where id = ${awaiting}`
    await audit(tx, ctx, 'pipeline.configured', 'pipeline', pipelineId, p.market_code,
      { close_by_transaction: p.close_by_transaction, awaiting_stage_id: prev[0]?.id ?? null },
      { close_by_transaction: input.closeByTransaction, awaiting_stage_id: awaiting })
  })
}
