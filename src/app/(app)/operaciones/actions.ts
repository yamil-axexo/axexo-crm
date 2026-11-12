'use server'

import { runAction, str } from '@/server/action'
import { moveDeal, updateDeal } from '@/domain/deals'
import { addDealItem, bulkCloseLost, markNoticeSeen, removeDealItem, saveOpsCatalog, saveProduct, setMerchantRef, setOpsCheck, setOpsStep, setPipelineFlags, setTraining, takeDeal } from '@/domain/ops'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>
const number = (raw: string): number => Number(raw.replace(/[, ]/g, ''))

export async function takeDealAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await takeDeal(ctx, str(fd, 'deal_id'))
    return { message: ['Lo tomaste: ahora está en "Míos".', 'You took it: it is now under "Mine".'] }
  })
}

export async function opsStepAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setOpsStep(ctx, str(fd, 'deal_id'), str(fd, 'ops_next_step'), str(fd, 'ops_next_step_due'))
    return { message: ['Próximo paso de Operaciones guardado.', 'Operations next step saved.'] }
  })
}

export async function opsCheckAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setOpsCheck(ctx, str(fd, 'deal_id'), str(fd, 'catalog_id'), { status: str(fd, 'status'), onDate: str(fd, 'on_date'), link: str(fd, 'link') })
    return { message: ['Guardado.', 'Saved.'] }
  })
}

export async function trainingAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setTraining(ctx, str(fd, 'deal_id'), str(fd, 'training_status'), str(fd, 'training_on'))
    return { message: ['Capacitación actualizada.', 'Training updated.'] }
  })
}

export async function merchantRefAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setMerchantRef(ctx, str(fd, 'account_id'), str(fd, 'merchant_ref'))
    return { message: ['Merchant ID guardado.', 'Merchant ID saved.'] }
  })
}

export async function addItemAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const price = str(fd, 'unit_price').trim()
    await addDealItem(ctx, str(fd, 'deal_id'), { productId: str(fd, 'product_id'), quantity: number(str(fd, 'quantity') || '0'), unitPrice: price === '' ? null : number(price) })
    return { message: ['Línea agregada. El monto del negocio es la suma de sus líneas.', 'Line added. The deal amount is the sum of its lines.'] }
  })
}

export async function removeItemAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await removeDealItem(ctx, str(fd, 'deal_id'), str(fd, 'item_id'))
    return { message: ['Línea quitada.', 'Line removed.'] }
  })
}

/** Devolver a Ventas: motivo obligatorio (catálogo y texto) y regreso a la etapa de Ventas anterior. */
export async function returnDealAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await moveDeal(ctx, str(fd, 'deal_id'), str(fd, 'stage_id'), undefined, undefined, { ret: { reasonCode: str(fd, 'reason'), note: str(fd, 'note') } })
    return { message: ['Devuelto a Ventas. A quien lo vendió le aparece hoy con el motivo.', 'Sent back to Sales. The seller sees it today with the reason.'] }
  })
}

/** Ganar a mano, con la fecha real de cierre (hoy o anterior). */
export async function winDealAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await moveDeal(ctx, str(fd, 'deal_id'), str(fd, 'stage_id'), undefined, undefined, { wonOn: str(fd, 'won_on') })
    return { message: ['Negocio ganado.', 'Deal won.'] }
  })
}

/** Resolver el candado de etapa ahí mismo: guarda lo que faltaba y mueve el negocio, sin salir de la pantalla. */
export async function gateMoveAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const id = str(fd, 'deal_id')
    const amount = str(fd, 'amount').trim()
    const patch = {
      amount: fd.has('amount') && amount !== '' ? number(amount) : undefined,
      nextStep: fd.has('next_step') ? str(fd, 'next_step') : undefined,
      nextStepDue: fd.has('next_step_due') ? str(fd, 'next_step_due') : undefined,
      decisionMakerId: fd.has('decision_maker_id') ? str(fd, 'decision_maker_id') : undefined,
      decisionMakerMet: fd.has('decision_maker_id') ? fd.get('decision_maker_met') === 'on' : undefined,
    }
    if (Object.values(patch).some((v) => v !== undefined)) await updateDeal(ctx, id, patch)
    await moveDeal(ctx, id, str(fd, 'stage_id'))
    return { message: ['Etapa actualizada.', 'Stage updated.'] }
  })
}

export async function bulkCloseAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await bulkCloseLost(ctx, fd.getAll('deal_id').map(String), str(fd, 'reason'), str(fd, 'note'))
    return { message: [`${out.closed} ${out.closed === 1 ? 'negocio cerrado' : 'negocios cerrados'} como perdido.`, `${out.closed} ${out.closed === 1 ? 'deal' : 'deals'} closed as lost.`] }
  })
}

export async function noticeSeenAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await markNoticeSeen(ctx, str(fd, 'notice_id'))
  })
}

export async function saveCatalogAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveOpsCatalog(ctx, { id: str(fd, 'id'), market: str(fd, 'market'), kind: str(fd, 'kind') as 'provider', labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en'), active: fd.has('id') && str(fd, 'id') ? fd.get('active') === 'on' : true })
    return { message: ['Catálogo guardado.', 'Catalog saved.'] }
  })
}

export async function saveProductAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveProduct(ctx, { id: str(fd, 'id'), market: str(fd, 'market'), name: str(fd, 'name'), price: number(str(fd, 'price') || 'x'), active: str(fd, 'id') ? fd.get('active') === 'on' : true })
    return { message: ['Producto guardado.', 'Product saved.'] }
  })
}

export async function pipelineFlagsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setPipelineFlags(ctx, str(fd, 'pipeline_id'), { multiOpen: fd.get('multi_open') === 'on', hasItems: fd.get('has_items') === 'on', opsStageIds: fd.getAll('ops_stage').map(String) })
    return { message: ['Embudo actualizado.', 'Pipeline updated.'] }
  })
}
