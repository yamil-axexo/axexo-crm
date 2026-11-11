'use server'

import { redirect } from 'next/navigation'
import { runAction, str } from '@/server/action'
import { assignLead, convertLead, createLead, disqualifyLead, markContacted, qualifyLead, MOTORS } from '@/domain/leads'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function createLeadAction(_: R | null, fd: FormData): Promise<R> {
  let id = ''
  const res = await runAction(async (ctx) => {
    id = await createLead(ctx, {
      market: str(fd, 'market'),
      motor: str(fd, 'motor') as (typeof MOTORS)[number],
      businessName: str(fd, 'business_name'),
      contactName: str(fd, 'contact_name'),
      phone: str(fd, 'phone'),
      email: str(fd, 'email'),
      locality: str(fd, 'locality'),
      message: str(fd, 'message'),
    })
  })
  if (res.ok && id) redirect(`/leads/${id}`)
  return res
}

export async function leadStepAction(_: R | null, fd: FormData): Promise<R> {
  const id = str(fd, 'id')
  const step = str(fd, 'step')
  let goto = ''
  const res = await runAction(async (ctx) => {
    if (step === 'contacted') {
      await markContacted(ctx, id)
      return { message: ['Marcado como contactado.', 'Marked as contacted.'] }
    }
    if (step === 'qualify') {
      await qualifyLead(ctx, id)
      return { message: ['Lead calificado. Ya puedes convertirlo.', 'Lead qualified. You can convert it now.'] }
    }
    if (step === 'disqualify') {
      await disqualifyLead(ctx, id, str(fd, 'reason'))
      return { message: ['Lead descartado con motivo.', 'Lead disqualified with a reason.'] }
    }
    if (step === 'assign') {
      await assignLead(ctx, id, str(fd, 'owner_id'))
      return { message: ['Lead reasignado.', 'Lead reassigned.'] }
    }
    if (step === 'convert') {
      const out = await convertLead(ctx, id, { linkAccountId: str(fd, 'link_account_id') || null })
      goto = `/deals/${out.dealId}`
    }
  })
  if (res.ok && goto) redirect(goto)
  return res
}
