import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid } from '@/lib/errors'
import { pushTo, webPushMode } from '@/server/adapters/web-push'
import { hostAllowed } from '@/server/adapters/live/http'
import { PUSH_HOSTS } from '@/server/adapters/live/providers'

/** AUT-05: la suscripción de push del navegador de una persona. Solo endpoints de los servicios de push conocidos. */
const subInput = z.object({
  endpoint: z.string().url().max(800).refine((u) => u.startsWith('https://') && hostAllowed(new URL(u).hostname, PUSH_HOSTS)),
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
  auth: z.string().regex(/^[A-Za-z0-9_-]{16,30}$/),
})

export async function savePushSubscription(ctx: Ctx, raw: unknown): Promise<void> {
  if (webPushMode() === 'off') throw invalid('Los avisos del navegador están apagados.', 'Browser notices are off.')
  const p = subInput.safeParse(raw)
  if (!p.success) throw invalid('El navegador no entregó una suscripción válida.', 'The browser did not hand over a valid subscription.')
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.push_subscriptions (user_id, endpoint, p256dh, auth) values (${ctx.user.id}, ${p.data.endpoint}, ${p.data.p256dh}, ${p.data.auth})
             on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now()`
    await audit(tx, ctx, 'push.subscribed', 'user', ctx.user.id, null, null, { host: new URL(p.data.endpoint).hostname })
  })
}

export async function removePushSubscriptions(ctx: Ctx): Promise<number> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx`delete from crm.push_subscriptions where user_id = ${ctx.user.id} returning 1`
    await audit(tx, ctx, 'push.unsubscribed', 'user', ctx.user.id, null, null, { removed: rows.length })
    return rows.length
  })
}

/** Manda el aviso a cada navegador suscrito de la persona. Las suscripciones que ya no existen se borran. */
export async function pushNotice(tx: Tx, userId: string, msg: { title: string; body: string; link: string | null }): Promise<number> {
  if (webPushMode() === 'off') return 0
  const subs = await tx<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`select id, endpoint, p256dh, auth from app.push_targets(${userId})`
  let sent = 0
  for (const s of subs) {
    const r = await pushTo(s, msg)
    if (r.result === 'gone') await tx`select app.push_forget(${s.id})`
    if (r.result === 'sent' || r.result === 'simulated') sent++
  }
  return sent
}
