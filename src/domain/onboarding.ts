import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { invalid } from '@/lib/errors'
import { STEPS, trackOf } from '@/content/guide'

export type Onboarding = { done: string[]; hidden: boolean; total: number; pending: number }

/** La lista de primeros pasos de la persona, según su rol. Solo cuenta los pasos que existen hoy para ese rol. */
export async function getOnboarding(ctx: Ctx): Promise<Onboarding> {
  const keys = STEPS[trackOf(ctx.memberships)].map((s) => s.key)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ done: string[]; hidden_at: Date | null }[]>`select done, hidden_at from crm.user_onboarding where user_id = ${ctx.user.id}`
    const done = (rows[0]?.done ?? []).filter((k) => keys.includes(k))
    return { done, hidden: Boolean(rows[0]?.hidden_at), total: keys.length, pending: keys.length - done.length }
  })
}

/** Marcar o desmarcar un paso. La lista es de la persona: la base no deja tocar la de nadie más. */
export async function toggleStep(ctx: Ctx, key: string): Promise<void> {
  if (!STEPS[trackOf(ctx.memberships)].some((s) => s.key === key)) throw invalid('Ese paso no es de tu lista.', 'That step is not on your list.')
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.user_onboarding (user_id) values (${ctx.user.id}) on conflict (user_id) do nothing`
    await tx`update crm.user_onboarding
                set done = case when ${key} = any(done) then array_remove(done, ${key}) else array_append(done, ${key}) end
              where user_id = ${ctx.user.id}`
  })
}

/** Esconder la lista (deja de salir en Hoy) o volver a mostrarla. Lo marcado se conserva. */
export async function setOnboardingHidden(ctx: Ctx, hidden: boolean): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.user_onboarding (user_id) values (${ctx.user.id}) on conflict (user_id) do nothing`
    await tx`update crm.user_onboarding set hidden_at = ${hidden ? tx`now()` : null} where user_id = ${ctx.user.id}`
  })
}
