import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { notFound } from '@/lib/errors'

/**
 * PIPE-02 / AUT-03 (embudo2): los pasos de alta y de crédito ACH nacen configurados y en pausa, como valor propuesto
 * (crm.stage_transitions.pending_owner = quien debe confirmarlos). Activarlos es un clic de administración; queda en la bitácora.
 */
export async function setTransitionActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  ctx.assert('automation.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ is_active: boolean; market_code: string; pending_owner: string | null }[]>`
      select t.is_active, p.market_code, t.pending_owner from crm.stage_transitions t join crm.pipelines p on p.id = t.pipeline_id where t.id = ${id} for update of t`
    const r = rows[0]
    if (!r) throw notFound()
    ctx.market(r.market_code)
    if (r.is_active === active) return
    await tx`update crm.stage_transitions set is_active = ${active}, pending_owner = case when ${active} then null else pending_owner end, updated_by = ${ctx.user.id}, updated_at = now() where id = ${id}`
    await audit(tx, ctx, 'transition.activated', 'stage_transition', id, r.market_code, { is_active: r.is_active, pending_owner: r.pending_owner }, { is_active: active })
  })
}
