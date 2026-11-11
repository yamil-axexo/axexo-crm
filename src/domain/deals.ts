import 'server-only'
import { z } from 'zod'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { assertNoProhibited } from '@/domain/guard'
import { audit, emit, newId, clean } from '@/domain/common'
import { DomainError, invalid, notFound } from '@/lib/errors'

export type StageKind = 'open' | 'awaiting_txn' | 'won' | 'lost'

export type GateDeal = {
  amount_minor: string | number | null
  next_step: string | null
  next_step_due: string | Date | null
  decision_maker_id: string | null
  decision_maker_met: boolean
}

export const FIELD_LABEL: Record<string, { es: string; en: string }> = {
  amount: { es: 'monto esperado', en: 'expected amount' },
  next_step: { es: 'próximo paso con fecha', en: 'next step with a date' },
  decision_maker: { es: 'decisor identificado y contactado', en: 'decision-maker identified and reached' },
}

/**
 * PIPE-01 / ACT-02: qué le falta a un deal para entrar a una etapa. Función pura: la usan la UI,
 * la acción de mover etapa y las pruebas, para que la regla exista en un solo lugar (AUT-01).
 */
export function missingForStage(deal: GateDeal, stage: { kind: StageKind; required_fields: string[] }): string[] {
  const need = new Set(stage.required_fields)
  if (stage.kind === 'open') need.add('next_step')
  const missing: string[] = []
  if (need.has('amount') && (deal.amount_minor === null || Number(deal.amount_minor) <= 0)) missing.push('amount')
  if (need.has('next_step') && !(deal.next_step && deal.next_step.trim() && deal.next_step_due)) missing.push('next_step')
  if (need.has('decision_maker') && !(deal.decision_maker_id && deal.decision_maker_met)) missing.push('decision_maker')
  return missing
}

type DealRow = GateDeal & {
  id: string
  market_code: string
  pipeline_id: string
  stage_id: string
  account_id: string
  owner_id: string | null
  status: 'open' | 'won' | 'lost'
  title: string
  revisit_needed: boolean
}

async function loadDeal(tx: Tx, id: string): Promise<DealRow> {
  const rows = await tx<DealRow[]>`select id, market_code, pipeline_id, stage_id, account_id, owner_id, status, title, amount_minor, next_step,
    next_step_due, decision_maker_id, decision_maker_met, revisit_needed from crm.deals where id = ${id} for update`
  if (!rows[0]) throw notFound('No encontramos ese deal.', 'We could not find that deal.')
  return rows[0]
}

const editInput = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  amount: z.union([z.number().nonnegative().max(1e12), z.null()]).optional(), // en unidades mayores; se guarda en menores (DATA-03)
  nextStep: z.string().trim().max(200).optional(),
  nextStepDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
  decisionMakerId: z.guid().or(z.literal('')).optional(),
  decisionMakerMet: z.boolean().optional(),
})
export type DealEdit = z.input<typeof editInput>

export async function updateDeal(ctx: Ctx, dealId: string, input: DealEdit): Promise<void> {
  const v = editInput.parse(input)
  assertNoProhibited(v.title, v.nextStep)
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadDeal(tx, dealId)
    ctx.assert('deal.edit', d.market_code)
    if (d.status !== 'open') throw invalid('Un negocio cerrado no se edita.', 'A closed deal cannot be edited.')
    const next = {
      title: v.title ?? d.title,
      amount_minor: v.amount === undefined ? d.amount_minor : v.amount === null ? null : Math.round(v.amount * 100),
      next_step: v.nextStep === undefined ? d.next_step : clean(v.nextStep),
      next_step_due: v.nextStepDue === undefined ? d.next_step_due : v.nextStepDue || null,
      decision_maker_id: v.decisionMakerId === undefined ? d.decision_maker_id : v.decisionMakerId || null,
      decision_maker_met: v.decisionMakerMet ?? d.decision_maker_met,
    }
    if (next.next_step && !next.next_step_due) throw invalid('Ponle fecha al próximo paso.', 'Give the next step a date.')
    if (d.next_step && !next.next_step) throw invalid('Un negocio abierto lleva próximo paso: cámbialo, no lo borres.', 'An open deal carries a next step: change it, do not clear it.')
    if (next.next_step_due && String(next.next_step_due) !== String(d.next_step_due)) {
      const ok = await tx<{ ok: boolean }[]>`select ${String(next.next_step_due)}::date >= ${marketToday(tx, d.market_code)} as ok`
      if (!ok[0]?.ok) throw invalid('La fecha del próximo paso tiene que ser de hoy en adelante.', 'The next step date must be today or later.')
    }
    if (next.decision_maker_id) {
      const ok = await tx`select 1 from crm.account_contacts where account_id = ${d.account_id} and contact_id = ${next.decision_maker_id} and valid_to is null`
      if (!ok[0]) throw invalid('El decisor tiene que ser un contacto de este comercio.', 'The decision-maker must be a contact of this merchant.')
    } else next.decision_maker_met = false
    const cleared = d.revisit_needed && next.decision_maker_met
    await tx`update crm.deals set title = ${next.title}, amount_minor = ${next.amount_minor}, next_step = ${next.next_step},
              next_step_due = ${next.next_step_due}, decision_maker_id = ${next.decision_maker_id}, decision_maker_met = ${next.decision_maker_met},
              revisit_needed = ${cleared ? false : d.revisit_needed}
              where id = ${dealId}`
    await audit(tx, ctx, 'deal.updated', 'deal', dealId, d.market_code,
      { amount_minor: d.amount_minor === null ? null : Number(d.amount_minor), next_step: d.next_step, decision_maker_met: d.decision_maker_met },
      { amount_minor: next.amount_minor === null ? null : Number(next.amount_minor), next_step: next.next_step, decision_maker_met: next.decision_maker_met })
  })
}

/**
 * Mover un deal de etapa. `next` deja el próximo paso en la misma transacción: el tablero lo pide cuando falta
 * (handoff, sección 6: "cambiar de etapa pide próximo paso si no hay uno") y así mover y programar no quedan a medias.
 */
export async function moveDeal(ctx: Ctx, dealId: string, toStageId: string, loss?: { reasonCode: string; note?: string }, next?: { step: string; due: string }): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadDeal(tx, dealId)
    if (next) {
      const step = clean(next.step)
      if (!step || step.length < 2 || step.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(next.due)) throw invalid('Escribe el próximo paso (hasta 200 letras) y su fecha.', 'Enter the next step (up to 200 characters) and its date.')
      assertNoProhibited(step)
      const range = await tx<{ ok: boolean }[]>`select ${next.due}::date >= ${marketToday(tx, d.market_code)} as ok`
      if (!range[0]?.ok) throw invalid('La fecha del próximo paso tiene que ser de hoy en adelante.', 'The next step date must be today or later.')
      ctx.assert('deal.edit', d.market_code)
      await tx`update crm.deals set next_step = ${step}, next_step_due = ${next.due} where id = ${dealId} and status = 'open'`
      await tx`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by)
               values (${d.market_code}, ${d.account_id}, ${dealId}, 'task', ${step}, ${`${next.due}T15:00:00Z`}, ${d.owner_id ?? ctx.user.id}, ${ctx.user.id})`
      await audit(tx, ctx, 'deal.updated', 'deal', dealId, d.market_code, { next_step: d.next_step }, { next_step: step, next_step_due: next.due })
      d.next_step = step
      d.next_step_due = next.due
    }
    ctx.assert('deal.move', d.market_code)
    if (d.status !== 'open') throw invalid('Este negocio ya está cerrado.', 'This deal is already closed.')
    if (toStageId === d.stage_id) return
    const stages = await tx<{ id: string; kind: StageKind; required_fields: string[]; name_es: string; name_en: string; position: number }[]>`
      select id, kind, required_fields, name_es, name_en, position from crm.stages where id = ${toStageId} and pipeline_id = ${d.pipeline_id}`
    const stage = stages[0]
    if (!stage) throw invalid('Esa etapa no es de este pipeline.', 'That stage is not part of this pipeline.')
    // Avanzar saltando etapas no evita lo que piden las de en medio: se exige la suma de todas hasta la de destino.
    const skipped = await tx<{ required_fields: string[] }[]>`
      select s.required_fields from crm.stages s
       where s.pipeline_id = ${d.pipeline_id} and s.kind in ('open', 'awaiting_txn') and s.position < ${stage.position}
         and s.position > (select c.position from crm.stages c where c.id = ${d.stage_id})`
    const gate = { kind: stage.kind, required_fields: [...new Set([...stage.required_fields, ...skipped.flatMap((s) => s.required_fields)])] }

    if (stage.kind === 'won') {
      // PIPE-06: "la transacción cierra, no el vendedor".
      const pipe = await tx<{ close_by_transaction: boolean }[]>`select close_by_transaction from crm.pipelines where id = ${d.pipeline_id}`
      if (pipe[0]?.close_by_transaction !== false) {
        throw new DomainError('won_by_transaction',
          'Un deal se gana solo cuando S5 reporta la primera transacción del comercio.',
          'A deal is won only when S5 reports the merchant’s first transaction.')
      }
    }
    if (stage.kind === 'lost') {
      const reason = loss?.reasonCode ? await tx`select 1 from crm.loss_reasons where code = ${loss.reasonCode} and kind = 'lost' and is_active` : []
      if (!reason[0]) throw invalid('Elige el motivo de pérdida.', 'Pick the loss reason.')
      assertNoProhibited(loss?.note)
      await tx`update crm.deals set stage_id = ${toStageId}, status = 'lost', loss_reason_code = ${loss!.reasonCode}, loss_note = ${clean(loss!.note)},
                lost_at = now(), closed_by = 'manual', stage_entered_at = now(), revisit_needed = false where id = ${dealId}`
    } else {
      const missing = missingForStage(d, gate)
      if (missing.length) {
        const es = missing.map((m) => FIELD_LABEL[m]?.es ?? m).join(', ')
        const en = missing.map((m) => FIELD_LABEL[m]?.en ?? m).join(', ')
        // Cuando lo único que falta es el próximo paso, la pantalla lo puede pedir ahí mismo.
        throw new DomainError(missing.length === 1 && missing[0] === 'next_step' ? 'next_step_required' : 'stage_gate',
          `Para pasar a "${stage.name_es}" falta: ${es}.`, `To move to "${stage.name_en}" you still need: ${en}.`)
      }
      await tx`update crm.deals set stage_id = ${toStageId}, stage_entered_at = now(),
                status = ${stage.kind === 'won' ? 'won' : 'open'}, won_at = ${stage.kind === 'won' ? tx`now()` : null},
                closed_by = ${stage.kind === 'won' ? 'manual' : null} where id = ${dealId}`
    }
    await tx`insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause)
             values (${dealId}, ${d.market_code}, ${d.stage_id}, ${toStageId}, ${ctx.user.id}, 'user')`
    await audit(tx, ctx, 'deal.stage_changed', 'deal', dealId, d.market_code, { stage_id: d.stage_id }, { stage_id: toStageId, kind: stage.kind, reason: loss?.reasonCode ?? null })
    await emit(tx, 'deal.stage_changed', 'deal', dealId, d.market_code, { from: d.stage_id, to: toStageId, kind: stage.kind })
  })
}

const createInput = z.object({
  accountId: z.guid(),
  pipelineId: z.guid(),
  title: z.string().trim().min(2).max(160),
  amount: z.number().nonnegative().max(1e12).nullable().optional(),
  nextStep: z.string().trim().min(2).max(200),
  nextStepDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function createDeal(ctx: Ctx, input: z.input<typeof createInput>): Promise<string> {
  const parsed = createInput.safeParse(input)
  if (!parsed.success) throw invalid('Un negocio nace con título y próximo paso con fecha.', 'A deal starts with a title and a dated next step.')
  const v = parsed.data
  assertNoProhibited(v.title, v.nextStep)
  return withUser(ctx.user.id, async (tx) => {
    const range = await tx<{ ok: boolean }[]>`select ${v.nextStepDue}::date >= ${marketToday(tx, tx`(select market_code from crm.accounts where id = ${v.accountId})`)} as ok`
    if (!range[0]?.ok) throw invalid('La fecha del próximo paso tiene que ser de hoy en adelante.', 'The next step date must be today or later.')
    const accs = await tx<{ market_code: string; owner_id: string | null }[]>`select market_code, owner_id from crm.accounts where id = ${v.accountId} and archived_at is null`
    const acc = accs[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('deal.create', acc.market_code)
    const st = await tx<{ id: string }[]>`select s.id from crm.stages s join crm.pipelines p on p.id = s.pipeline_id
      where p.id = ${v.pipelineId} and p.market_code = ${acc.market_code} order by s.position limit 1`
    if (!st[0]) throw invalid('Ese pipeline no es de este mercado.', 'That pipeline does not belong to this market.')
    const open = await tx`select 1 from crm.deals where account_id = ${v.accountId} and pipeline_id = ${v.pipelineId} and status = 'open'`
    if (open[0]) throw invalid('Este comercio ya tiene un negocio abierto en ese embudo.', 'This merchant already has an open deal in that pipeline.')
    const id = await newId(tx)
    const ownerId = acc.owner_id ?? ctx.user.id
    await tx`insert into crm.deals (id, market_code, pipeline_id, stage_id, account_id, owner_id, title, amount_minor, currency, next_step, next_step_due, created_by)
             values (${id}, ${acc.market_code}, ${v.pipelineId}, ${st[0].id}, ${v.accountId}, ${ownerId}, ${v.title},
                     ${v.amount == null ? null : Math.round(v.amount * 100)}, ${ctx.market(acc.market_code).currency}, ${v.nextStep}, ${v.nextStepDue}, ${ctx.user.id})`
    await tx`insert into crm.deal_stage_events (deal_id, market_code, to_stage_id, actor_id) values (${id}, ${acc.market_code}, ${st[0].id}, ${ctx.user.id})`
    await audit(tx, ctx, 'deal.created', 'deal', id, acc.market_code, null, { account_id: v.accountId, pipeline_id: v.pipelineId })
    await emit(tx, 'deal.created', 'deal', id, acc.market_code, { account_id: v.accountId })
    return id
  })
}
