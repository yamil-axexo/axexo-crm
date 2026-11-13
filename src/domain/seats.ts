import 'server-only'
import { z } from 'zod'
import type { Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid } from '@/lib/errors'

/**
 * E4.F9 (datos2): el asiento se aprueba ANTES de dar el acceso. Quien da el acceso escribe quién tiene el presupuesto y aprobó el
 * asiento, cuándo y con qué referencia; sin eso no hay acceso. La aprobación queda en crm.seat_approvals en la misma transacción.
 */
export const seatFields = {
  seatApprover: z.string().trim().min(2).max(120),
  seatApprovedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seatReference: z.string().trim().max(200).optional(),
}
export type SeatInput = { seatApprover: string; seatApprovedOn: string; seatReference?: string }
export const SEAT_MISSING: [string, string] = [
  'Antes de dar acceso, escribe quién aprobó el asiento (quien tiene el presupuesto) y en qué fecha.',
  'Before giving access, write who approved the seat (the budget holder) and on what date.',
]

/** Revisa la aprobación (no futura, sin datos prohibidos) y la guarda para la membresía recién creada. */
export async function recordSeatAtGrant(tx: Tx, ctx: Ctx, membershipId: string, userId: string, market: string | null, role: string, s: SeatInput): Promise<void> {
  assertNoProhibited(s.seatApprover, s.seatReference)
  const ok = (await tx<{ ok: boolean }[]>`select ${s.seatApprovedOn}::date <= (now() at time zone 'UTC')::date + 1 as ok`)[0]?.ok
  if (ok !== true) throw invalid('La fecha de aprobación del asiento no puede ser futura.', 'The seat approval date cannot be in the future.')
  const ref = s.seatReference?.trim() || null
  await tx`insert into crm.seat_approvals (membership_id, approver_name, approved_on, reference, recorded_by)
           values (${membershipId}, ${s.seatApprover.trim()}, ${s.seatApprovedOn}, ${ref}, ${ctx.user.id})`
  await audit(tx, ctx, 'seat.approved', 'user', userId, market, null, { role, approver: s.seatApprover.trim(), approved_on: s.seatApprovedOn, reference: ref, at: 'grant' })
}
