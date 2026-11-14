'use server'

import { runAction, str } from '@/server/action'
import { setFormCampaign, setResponseTarget, setTerritoryManager, setWinRule } from '@/domain/mx-config'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function setFormCampaignAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setFormCampaign(ctx, str(fd, 'form_id'), {
      funnel: str(fd, 'funnel'), channelId: str(fd, 'channel_id'), isCampaign: fd.get('is_campaign') === 'on',
      offerTypes: fd.getAll('offer_type').filter((v): v is string => typeof v === 'string'),
    })
    return { message: ['Formulario guardado. Aplica a los leads que lleguen desde ahora.', 'Form saved. It applies to leads that arrive from now on.'] }
  })
}

export async function setResponseTargetAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setResponseTarget(ctx, str(fd, 'rule_id'), { amount: Number(str(fd, 'amount')), unit: str(fd, 'unit') })
    return { message: ['Meta guardada. Aplica a los leads que lleguen desde ahora.', 'Target saved. It applies to leads that arrive from now on.'] }
  })
}

export async function setTerritoryManagerAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await setTerritoryManager(ctx, str(fd, 'territory_id'), str(fd, 'manager_id') || null)
    return {
      message: out.moved === 0 ? ['Gerente guardado.', 'Manager saved.']
        : [`Gerente guardado. ${out.moved === 1 ? 'Pasó 1 tienda' : `Pasaron ${out.moved} tiendas`} que nadie llevaba.`, `Manager saved. ${out.moved === 1 ? '1 store' : `${out.moved} stores`} with no owner moved over.`],
    }
  })
}

export async function setWinRuleAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setWinRule(ctx, str(fd, 'pipeline_id'), str(fd, 'rule'), fd.get('confirm') === 'on')
    return { message: ['Regla para ganar guardada.', 'Win rule saved.'] }
  })
}
