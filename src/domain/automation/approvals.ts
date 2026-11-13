import 'server-only'
import type { Ctx } from '@/server/context'
import { moveDealTx } from '@/domain/deals'
import { decideApproval } from '@/domain/automation/transitions'

/** Aprobar o rechazar un paso. Aprobar mueve el negocio con la misma función de siempre, a nombre de quien lo pidió. */
export const decide = (ctx: Ctx, approvalId: string, decision: 'approve' | 'reject', note: string): Promise<void> =>
  decideApproval(ctx, approvalId, decision, note, (tx, requester, a) =>
    moveDealTx(tx, requester, a.deal_id, a.to_stage_id, undefined, undefined, { approvalId: a.id, wonOn: a.params?.wonOn ?? undefined, ret: a.params?.ret ?? undefined }))
