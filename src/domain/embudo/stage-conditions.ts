import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'

/**
 * PIPE-01: un requisito de etapa puede llevar condición. Así un mismo embudo por tipo de venta pide cosas distintas según
 * el mercado, el tipo de cuenta o el monto, sin duplicar el embudo ("variaciones de país por metadata").
 * La base aplica la misma lectura en crm.stage_missing (migración 0030): esta función y esa van juntas.
 */
export type StageCondition = { markets?: string[]; account_types?: string[]; min_amount?: number }
export type StageConditions = Record<string, StageCondition>
export type GateFacts = { market: string; accountType: string | null; amountMinor: string | number | null }

export function conditionApplies(cond: StageCondition | undefined, facts: GateFacts): boolean {
  if (!cond) return true
  if (cond.markets && !cond.markets.includes(facts.market)) return false
  if (cond.account_types && !cond.account_types.includes(facts.accountType ?? '')) return false
  if (cond.min_amount !== undefined && Number(facts.amountMinor ?? 0) < cond.min_amount * 100) return false
  return true
}

/** Los requisitos de una etapa que aplican a este negocio. */
export function activeRequirements(required: string[], conditions: StageConditions | null | undefined, facts: GateFacts): string[] {
  return required.filter((tok) => conditionApplies(conditions?.[tok], facts))
}

/** Lo mismo, para varias etapas a la vez (la de destino y las que se saltan), leyendo sus condiciones de la base. */
export async function requirementsFor(tx: Tx, deal: { market_code: string; account_id: string; amount_minor: string | number | null }, stages: { id: string; required_fields: string[] }[]): Promise<string[]> {
  if (stages.length === 0) return []
  const rows = await tx<{ id: string; conditions: StageConditions }[]>`select id, conditions from crm.stages where id = any(${stages.map((s) => s.id)}::uuid[])`
  const cond = new Map(rows.map((r) => [r.id, r.conditions]))
  if ([...cond.values()].every((c) => !c || Object.keys(c).length === 0)) return [...new Set(stages.flatMap((s) => s.required_fields))]
  const acc = await tx<{ account_type: string | null }[]>`select account_type from crm.accounts where id = ${deal.account_id}`
  const facts: GateFacts = { market: deal.market_code, accountType: acc[0]?.account_type ?? null, amountMinor: deal.amount_minor }
  return [...new Set(stages.flatMap((s) => activeRequirements(s.required_fields, cond.get(s.id), facts)))]
}

/**
 * Dentro de esta transacción, lo que entre a una etapa sin lo que la etapa pide no se rechaza: queda anotado en
 * crm.deal_stage_gaps. Solo lo usan la importación histórica y el movimiento forzado al archivar una etapa.
 */
export async function recordStageGaps(tx: Tx): Promise<void> {
  await tx`select set_config('app.stage_gate', 'record', true)`
}

const condInput = z.object({
  token: z.string().regex(/^(amount|decision_maker|items|field:[a-z][a-z0-9_]{1,40})$/),
  markets: z.array(z.string().length(2)).max(20),
  accountTypes: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/)).max(20),
  minAmount: z.number().nonnegative().max(1e12).nullable(),
})

/** Administración pone o quita la condición de un requisito de una etapa. Queda en la bitácora. */
export async function setStageCondition(ctx: Ctx, stageId: string, input: z.input<typeof condInput>): Promise<void> {
  ctx.assert('config.manage')
  const v = condInput.parse(input)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; required_fields: string[]; conditions: StageConditions; market_code: string }[]>`
      select s.id, s.required_fields, s.conditions, p.market_code from crm.stages s join crm.pipelines p on p.id = s.pipeline_id where s.id = ${stageId} for update of s`
    const s = rows[0]
    if (!s) throw notFound('No encontramos esa etapa.', 'We could not find that stage.')
    if (!s.required_fields.includes(v.token)) throw invalid('Esa etapa no pide ese requisito. Agrégalo primero en Embudos y campos.', 'That stage does not ask for that requirement. Add it first under Pipelines and fields.')
    const cond: StageCondition = {}
    if (v.markets.length) cond.markets = v.markets
    if (v.accountTypes.length) cond.account_types = v.accountTypes
    if (v.minAmount !== null && v.minAmount > 0) cond.min_amount = v.minAmount
    const next: StageConditions = { ...s.conditions }
    if (Object.keys(cond).length) next[v.token] = cond
    else delete next[v.token]
    await tx`update crm.stages set conditions = ${tx.json(next as never)}, edited_at = now(), edited_by = ${ctx.user.id} where id = ${stageId}`
    await audit(tx, ctx, 'stage.condition_set', 'stage', stageId, s.market_code, { condition: s.conditions[v.token] ?? null }, { token: v.token, condition: Object.keys(cond).length ? cond : null })
  })
}
