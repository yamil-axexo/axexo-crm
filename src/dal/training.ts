import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { isUuid } from '@/lib/ids'

export type TrainingSession = { id: string; on_date: string; at_time: string | null; trainer_name: string; status: string; note: string | null; rescheduled_from: string | null; created_at: Date }

/** La agenda de capacitación de un negocio, quién puede darla en su mercado y el video de recorrido si está configurado. */
export async function trainingFor(ctx: Ctx, dealId: string, market: string): Promise<{ sessions: TrainingSession[]; trainers: { id: string; full_name: string }[]; video: string | null }> {
  if (!isUuid(dealId)) return { sessions: [], trainers: [], video: null }
  return withUser(ctx.user.id, async (tx) => {
    const sessions = await tx<TrainingSession[]>`
      select s.id, s.on_date::text, to_char(s.at_time, 'HH24:MI') as at_time, u.full_name as trainer_name, s.status, s.note, s.rescheduled_from, s.created_at
        from crm.training_sessions s join crm.users u on u.id = s.trainer_id where s.deal_id = ${dealId} order by s.created_at desc`
    const trainers = await tx<{ id: string; full_name: string }[]>`
      select u.id, u.full_name from crm.users u where u.is_active and not u.is_system
         and u.id in (select user_id from app.people_with_role(${market}, array['ops','rep','supervisor','market_lead'])) order by u.full_name`
    const video = await tx<{ u: string | null }[]>`select walkthrough_url as u from crm.market_comms where market_code = ${market}`
    return { sessions: [...sessions], trainers: [...trainers], video: video[0]?.u ?? null }
  })
}
