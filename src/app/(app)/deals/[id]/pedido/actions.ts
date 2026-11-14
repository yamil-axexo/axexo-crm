'use server'

import { runAction, str } from '@/server/action'
import { receiveOrder, sendOrderToOps } from '@/domain/orders'
import { resolveTraining, scheduleTraining } from '@/domain/training'
import type { ActionResult } from '@/lib/errors'

export async function sendOrderAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    const out = await sendOrderToOps(ctx, str(fd, 'deal_id'))
    return {
      message: out.mailbox
        ? ['Enviado. Operaciones ya lo tiene en su cola dentro de CONTIGO. El correo al buzón de pedidos quedó listo para enviar: el canal de correo está apagado.', 'Sent. Operations already has it in their queue inside CONTIGO. The email to the order mailbox is ready to send: the email channel is turned off.']
        : ['Enviado. Operaciones ya lo tiene en su cola dentro de CONTIGO. Este mercado todavía no tiene buzón de pedidos configurado, así que no hay correo en espera.', 'Sent. Operations already has it in their queue inside CONTIGO. This market has no order mailbox configured yet, so no email is waiting.'],
    }
  })
}

export async function receiveOrderAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await receiveOrder(ctx, str(fd, 'dispatch_id'))
    return { message: ['Pedido recibido.', 'Order received.'] }
  })
}

export async function scheduleTrainingAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await scheduleTraining(ctx, str(fd, 'deal_id'), { on: str(fd, 'on'), at: str(fd, 'at'), trainerId: str(fd, 'trainer_id'), note: str(fd, 'note') })
    return { message: ['Capacitación agendada. Se avisó a quien la da y a quien vendió.', 'Training scheduled. The trainer and the seller were notified.'] }
  })
}

export async function resolveTrainingAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await resolveTraining(ctx, str(fd, 'session_id'), { result: str(fd, 'result') as 'done', note: str(fd, 'note'), nextOn: str(fd, 'next_on'), nextAt: str(fd, 'next_at') })
    return { message: ['Listo.', 'Done.'] }
  })
}
