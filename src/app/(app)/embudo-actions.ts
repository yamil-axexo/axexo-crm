'use server'

import { runAction, str } from '@/server/action'
import type { ActionResult } from '@/lib/errors'
import { changeAssignmentRule, createAssignmentRule, type RuleAction } from '@/domain/embudo/routing'
import { setStageCondition } from '@/domain/embudo/stage-conditions'
import { correctMilestone } from '@/domain/embudo/closing'
import { createLeadLabel, linkLeadToAccount, setLeadLabels } from '@/domain/embudo/lead-links'
import { addTicketRef, setTicketStatus } from '@/domain/embudo/tickets'
import { ensureReferralCode, setReferralActive } from '@/domain/embudo/referrals'
import { retryIntakeNow } from '@/domain/embudo/intake-retry'

type R = ActionResult<unknown>
const all = (fd: FormData, key: string): string[] => fd.getAll(key).filter((v): v is string => typeof v === 'string' && v !== '')
const int = (v: string): number | null => (/^\d{1,6}$/.test(v.trim()) ? Number(v.trim()) : null)

export async function createAssignmentRuleAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createAssignmentRule(ctx, {
      market: str(fd, 'market'), name: str(fd, 'name'), action: str(fd, 'action') as RuleAction, userId: str(fd, 'user_id'), rotationId: str(fd, 'rotation_id'),
      capOpen: int(str(fd, 'cap_open')), slaMinutes: int(str(fd, 'sla_minutes')),
      match: { sources: all(fd, 'sources'), motors: all(fd, 'motors'), formIds: all(fd, 'form_ids'), territoryIds: all(fd, 'territory_ids'), sizeMin: int(str(fd, 'size_min')), sizeMax: int(str(fd, 'size_max')) },
    })
    return { message: ['Regla creada. Queda al final de la lista: súbela si debe decidir antes.', 'Rule created. It sits at the end of the list: move it up if it should decide earlier.'], revalidate: ['/admin/embudo'] }
  })
}

export async function changeAssignmentRuleAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const op = str(fd, 'op')
    await changeAssignmentRule(ctx, str(fd, 'id'), op === 'up' || op === 'down' ? { move: op } : op === 'cap' ? { capOpen: int(str(fd, 'cap_open')) } : { active: op === 'on' })
    return { message: ['Listo. El cambio quedó en la bitácora.', 'Done. The change is in the audit log.'], revalidate: ['/admin/embudo'] }
  })
}

export async function setStageConditionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const min = str(fd, 'min_amount').trim()
    await setStageCondition(ctx, str(fd, 'stage_id'), { token: str(fd, 'token'), markets: all(fd, 'markets'), accountTypes: all(fd, 'account_types'), minAmount: min && /^\d+(\.\d{1,2})?$/.test(min) ? Number(min) : null })
    return { message: ['Condición guardada. Vale desde ahora en la pantalla y en la base.', 'Condition saved. It applies from now on in the screen and in the database.'], revalidate: ['/admin/embudo'] }
  })
}

export async function correctMilestoneAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await correctMilestone(ctx, str(fd, 'account_id'), { kind: str(fd, 'kind') as 'first_txn', action: str(fd, 'action') as 'void', at: str(fd, 'at'), method: str(fd, 'method') as '', reason: str(fd, 'reason') })
    return { message: ['Corrección guardada. Quedó en la historia del comercio y en la bitácora; nada se editó en sitio.', 'Correction saved. It is in the merchant’s history and the audit log; nothing was edited in place.'] }
  })
}

export async function linkLeadAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const accountId = str(fd, 'account_id')
    await linkLeadToAccount(ctx, str(fd, 'lead_id'), accountId || null)
    return { message: accountId ? ['Lead ligado al comercio. Al convertirlo, el negocio entra en ese comercio.', 'Lead linked to the merchant. When you convert it, the deal goes into that merchant.'] : ['El lead ya no está ligado a un comercio.', 'The lead is no longer linked to a merchant.'] }
  })
}

export async function setLeadLabelsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setLeadLabels(ctx, str(fd, 'lead_id'), all(fd, 'labels'))
    return { message: ['Etiquetas guardadas.', 'Labels saved.'] }
  })
}

export async function createLeadLabelAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createLeadLabel(ctx, { labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en') })
    return { message: ['Etiqueta creada. Ya se puede poner en los leads y filtrar por ella.', 'Label created. It can now be put on leads and used as a filter.'], revalidate: ['/admin/embudo'] }
  })
}

export async function addTicketAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addTicketRef(ctx, str(fd, 'account_id'), { system: str(fd, 'system') as 'zendesk', ref: str(fd, 'ref'), subject: str(fd, 'subject'), status: (str(fd, 'status') || 'unknown') as 'open' })
    return { message: ['Ticket agregado al hilo del comercio.', 'Ticket added to the merchant’s thread.'] }
  })
}

export async function setTicketStatusAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setTicketStatus(ctx, str(fd, 'ticket_id'), str(fd, 'status'))
    return { message: ['Estado del ticket actualizado.', 'Ticket status updated.'] }
  })
}

export async function referralCodeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const op = str(fd, 'op')
    if (op === 'create') {
      const out = await ensureReferralCode(ctx, str(fd, 'account_id'))
      return { message: out.created ? ['Enlace de referido creado.', 'Referral link created.'] : ['Este comercio ya tenía su enlace de referido.', 'This merchant already had its referral link.'] }
    }
    await setReferralActive(ctx, str(fd, 'account_id'), op === 'on')
    return { message: op === 'on' ? ['Enlace de referido activo.', 'Referral link is on.'] : ['Enlace de referido en pausa: quien lo abra ya no llega al formulario.', 'Referral link paused: whoever opens it no longer reaches the form.'] }
  })
}

export async function retryIntakeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await retryIntakeNow(ctx, str(fd, 'id'))
    return { message: out === 'done' ? ['El envío se guardó: el lead ya está en la bandeja.', 'The submission was saved: the lead is now in the inbox.'] : ['El envío sigue sin poder guardarse. Queda en la lista con su motivo.', 'The submission still cannot be saved. It stays in the list with its reason.'], revalidate: ['/admin/embudo'] }
  })
}
