import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { UntrustedObject, UntrustedOrigin } from '@/domain/untrusted'

export type UntrustedMark = { origin: UntrustedOrigin; fields: string[]; created_at: Date }

/** La marca de texto no confiable de un registro, si la tiene. */
export async function untrustedMark(ctx: Ctx, object: UntrustedObject, id: string): Promise<UntrustedMark | null> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<UntrustedMark[]>`select origin, fields, created_at from crm.untrusted_marks where object = ${object} and object_id = ${id}`
    return rows[0] ?? null
  })
}
