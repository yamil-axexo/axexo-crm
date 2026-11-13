import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'

/**
 * ACT-01: un ticket de soporte entra al hilo del comercio como referencia (sistema, número y asunto), nunca como copia.
 * La mesa de soporte está fuera de CONTIGO y su conexión está apagada (adaptador support-desk): la referencia la escribe
 * una persona y el estado es el que ella le pone.
 */
export const TICKET_SYSTEMS = ['zendesk', 'zoho', 'other'] as const
export const TICKET_STATUS = ['open', 'pending', 'solved', 'unknown'] as const
export const TICKET_STATUS_LABEL: Record<(typeof TICKET_STATUS)[number], { es: string; en: string }> = {
  open: { es: 'Abierto', en: 'Open' },
  pending: { es: 'En espera', en: 'Pending' },
  solved: { es: 'Resuelto', en: 'Solved' },
  unknown: { es: 'Sin estado', en: 'No status' },
}
const input = z.object({
  system: z.enum(TICKET_SYSTEMS),
  ref: z.string().trim().regex(/^[A-Za-z0-9#_-]{1,40}$/),
  subject: z.string().trim().min(2).max(200),
  status: z.enum(TICKET_STATUS).default('unknown'),
})

export async function addTicketRef(ctx: Ctx, accountId: string, raw: z.input<typeof input>): Promise<string> {
  const p = input.safeParse(raw)
  if (!p.success) throw invalid('Escribe el número del ticket (letras, números, # o guiones) y de qué trata.', 'Enter the ticket number (letters, digits, # or hyphens) and what it is about.')
  const v = p.data
  assertNoProhibited(v.subject)
  return withUser(ctx.user.id, async (tx) => {
    const acc = await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${accountId} and archived_at is null`
    if (!acc[0]) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('activity.write', acc[0].market_code)
    const id = await newId(tx)
    const ins = await tx`insert into crm.ticket_refs (id, market_code, account_id, system, external_ref, subject, status, created_by)
                         values (${id}, ${acc[0].market_code}, ${accountId}, ${v.system}, ${v.ref}, ${v.subject}, ${v.status}, ${ctx.user.id})
                         on conflict (account_id, system, external_ref) do nothing returning id`
    if (!ins[0]) throw invalid('Ese ticket ya está en el hilo de este comercio.', 'That ticket is already in this merchant’s thread.')
    await audit(tx, ctx, 'account.ticket_linked', 'account', accountId, acc[0].market_code, null, { system: v.system, ref: v.ref, status: v.status })
    return id
  })
}

export async function setTicketStatus(ctx: Ctx, ticketId: string, status: string): Promise<void> {
  const s = z.enum(TICKET_STATUS).parse(status)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ account_id: string; market_code: string; status: string; external_ref: string }[]>`select account_id, market_code, status, external_ref from crm.ticket_refs where id = ${ticketId} for update`
    const t = rows[0]
    if (!t) throw notFound('No encontramos ese ticket.', 'We could not find that ticket.')
    ctx.assert('activity.write', t.market_code)
    if (t.status === s) return
    await tx`update crm.ticket_refs set status = ${s} where id = ${ticketId}`
    await audit(tx, ctx, 'account.ticket_status_changed', 'account', t.account_id, t.market_code, { status: t.status }, { status: s, ref: t.external_ref })
  })
}
