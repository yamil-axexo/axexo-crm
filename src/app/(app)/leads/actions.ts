'use server'

import { redirect } from 'next/navigation'
import { runAction, str } from '@/server/action'
import { assignLead, bulkDisqualify, convertLead, createLead, disqualifyLead, markContacted, passLead, qualifyLead, releaseLead, takeLead, updateLeadDetails, type LeadInput } from '@/domain/leads'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function createLeadAction(_: R | null, fd: FormData): Promise<R> {
  let id = ''
  const res = await runAction(async (ctx) => {
    id = await createLead(ctx, {
      market: str(fd, 'market'),
      motor: str(fd, 'motor'),
      source: (str(fd, 'source') || 'manual') as LeadInput['source'],
      contactRole: (str(fd, 'contact_role') || undefined) as LeadInput['contactRole'],
      alreadyContacted: str(fd, 'already_contacted') === 'on',
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

export async function takeLeadAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await takeLead(ctx, str(fd, 'id'))
  })
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
    if (step === 'details') {
      await updateLeadDetails(ctx, id, { motor: str(fd, 'motor'), accountType: str(fd, 'account_type'), contactRole: str(fd, 'contact_role') })
      return { message: ['Listo, quedó actualizado.', 'Done, it is updated.'] }
    }
    if (step === 'pass') {
      await passLead(ctx, id, str(fd, 'to_id'), str(fd, 'note'))
      goto = '/leads'
      return
    }
    if (step === 'release') {
      await releaseLead(ctx, id, str(fd, 'reason_text'))
      return { message: ['El lead quedó sin asignar.', 'The lead now has no owner.'] }
    }
    if (step === 'convert') {
      const out = await convertLead(ctx, id, {
        linkAccountId: str(fd, 'link_account_id') || null,
        pipelineId: str(fd, 'pipeline_id') || null,
        accountType: str(fd, 'account_type') || null,
        contactRole: str(fd, 'contact_role') || null,
      })
      goto = `/deals/${out.dealId}`
    }
  })
  if (res.ok && goto) redirect(goto)
  return res
}

/** Cerrar varios leads como no calificados, con un motivo para todos (lista de Leads). */
export async function bulkDisqualifyAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const ids = fd.getAll('ids').filter((v): v is string => typeof v === 'string')
    const n = await bulkDisqualify(ctx, ids, str(fd, 'reason'))
    return { message: [n === 1 ? 'Se cerró 1 lead con su motivo.' : `Se cerraron ${n} leads con su motivo.`, n === 1 ? '1 lead closed with its reason.' : `${n} leads closed with their reason.`] }
  })
}
