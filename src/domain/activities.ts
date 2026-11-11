import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId, clean } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'

const input = z.object({
  accountId: z.guid().optional(),
  dealId: z.guid().optional(),
  leadId: z.guid().optional(),
  kind: z.enum(['note', 'call', 'meeting', 'task']),
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().max(4000).optional().default(''),
  dueAt: z.string().optional().default(''),
})

/** ACT-01: notas, llamadas, reuniones y tareas son registros de primera clase en un solo timeline. */
export async function addActivity(ctx: Ctx, raw: z.input<typeof input>): Promise<string> {
  const parsed = input.safeParse(raw)
  if (!parsed.success) throw invalid('Escribe de qué se trata.', 'Say what this is about.')
  const v = parsed.data
  if (v.kind === 'task' && !v.dueAt) throw invalid('Una tarea necesita fecha.', 'A task needs a date.')
  if (!v.accountId && !v.dealId && !v.leadId) throw invalid('Liga la actividad a un comercio, deal o lead.', 'Link the activity to a merchant, deal or lead.')
  return withUser(ctx.user.id, async (tx) => {
    let market: string | undefined
    let accountId = v.accountId ?? null
    if (v.dealId) {
      const d = await tx<{ market_code: string; account_id: string }[]>`select market_code, account_id from crm.deals where id = ${v.dealId}`
      if (!d[0]) throw notFound()
      market = d[0].market_code
      accountId = d[0].account_id
    } else if (accountId) {
      const a = await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${accountId}`
      if (!a[0]) throw notFound()
      market = a[0].market_code
    } else if (v.leadId) {
      const l = await tx<{ market_code: string }[]>`select market_code from crm.leads where id = ${v.leadId}`
      if (!l[0]) throw notFound()
      market = l[0].market_code
    }
    ctx.assert('activity.write', market)
    const id = await newId(tx)
    const due = v.dueAt ? (v.dueAt.length === 10 ? `${v.dueAt}T15:00:00Z` : v.dueAt) : null
    await tx`insert into crm.activities (id, market_code, account_id, deal_id, lead_id, kind, subject, body, due_at, done_at, owner_id, created_by)
             values (${id}, ${market!}, ${accountId}, ${v.dealId ?? null}, ${v.leadId ?? null}, ${v.kind}, ${v.subject}, ${clean(v.body)},
                     ${due}, ${v.kind === 'task' ? null : tx`now()`}, ${ctx.user.id}, ${ctx.user.id})`
    await audit(tx, ctx, 'activity.added', 'activity', id, market!, null, { kind: v.kind, account_id: accountId })
    return id
  })
}
