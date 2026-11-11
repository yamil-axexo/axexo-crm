'use server'

import { redirect } from 'next/navigation'
import { runAction, str } from '@/server/action'
import { createDeal, moveDeal, updateDeal } from '@/domain/deals'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function moveDealAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const reason = str(fd, 'reason')
    await moveDeal(ctx, str(fd, 'deal_id'), str(fd, 'stage_id'), reason ? { reasonCode: reason, note: str(fd, 'note') } : undefined)
    return { message: ['Etapa actualizada.', 'Stage updated.'] }
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
    return { message: ['Deal actualizado.', 'Deal updated.'] }
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
    })
  })
  if (res.ok && id) redirect(`/deals/${id}`)
  return res
}
