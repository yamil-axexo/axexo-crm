'use server'

import { redirect } from 'next/navigation'
import { runAction, str } from '@/server/action'
import { createDeal, moveDeal, updateDeal } from '@/domain/deals'
import type { ActionResult } from '@/lib/errors'
import { moveMessage } from '@/lib/steps'

type R = ActionResult<unknown>

export async function moveDealAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const reason = str(fd, 'reason')
    const out = await moveDeal(ctx, str(fd, 'deal_id'), str(fd, 'stage_id'), reason ? { reasonCode: reason, note: str(fd, 'note') } : undefined)
    return { message: moveMessage(out, ['Etapa actualizada.', 'Stage updated.']) }
  })
}

/** Mover desde el tablero (arrastre en desktop, selector en móvil). Puede traer el próximo paso si el deal no tenía. */
export async function boardMoveAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const step = str(fd, 'next_step')
    const out = await moveDeal(ctx, str(fd, 'deal_id'), str(fd, 'stage_id'), undefined, step ? { step, due: str(fd, 'next_step_due') } : undefined)
    return { message: moveMessage(out, ['Etapa actualizada.', 'Stage updated.']) }
  })
}

export async function updateDealAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const amount = str(fd, 'amount').replace(/[, ]/g, '')
    await updateDeal(ctx, str(fd, 'deal_id'), {
      amount: fd.has('amount') ? (amount === '' ? null : Number(amount)) : undefined,
      nextStep: fd.has('next_step') ? str(fd, 'next_step') : undefined,
      nextStepDue: fd.has('next_step_due') ? str(fd, 'next_step_due') : undefined,
      decisionMakerId: fd.has('decision_maker_id') ? str(fd, 'decision_maker_id') : undefined,
      decisionMakerMet: fd.has('decision_maker_id') ? fd.get('decision_maker_met') === 'on' : undefined,
    })
    return { message: ['Negocio actualizado.', 'Deal updated.'] }
  })
}

export async function createDealAction(_: R | null, fd: FormData): Promise<R> {
  let id = ''
  const res = await runAction(async (ctx) => {
    const amount = str(fd, 'amount').replace(/[, ]/g, '')
    id = await createDeal(ctx, {
      accountId: str(fd, 'account_id'),
      pipelineId: str(fd, 'pipeline_id'),
      title: str(fd, 'title'),
      amount: amount === '' ? null : Number(amount),
      nextStep: str(fd, 'next_step'),
      nextStepDue: str(fd, 'next_step_due'),
      stageId: str(fd, 'stage_id'),
    })
  })
  if (res.ok && id) redirect(`/deals/${id}`)
  return res
}
