import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

/** La última prueba de conexión de cada conector (Estado de CONTIGO). */
export async function lastConnectorTests(ctx: Ctx): Promise<Record<string, { ok: boolean; mode: string; detail: string; tested_at: Date; who: string | null }>> {
  const rows = await withUser(ctx.user.id, (tx) => tx<{ connector: string; ok: boolean; mode: string; detail: string; tested_at: Date; who: string | null }[]>`
    select distinct on (t.connector) t.connector, t.ok, t.mode, t.detail, t.tested_at, u.full_name as who
      from crm.connector_tests t left join crm.users u on u.id = t.tested_by
     order by t.connector, t.tested_at desc`)
  return Object.fromEntries(rows.map((r) => [r.connector, r]))
}

/** Mi captura de correo y calendario (ACT-03). */
export async function myCapture(ctx: Ctx): Promise<{ gmail: boolean; calendar: boolean; last_pull: Date | null }> {
  const rows = await withUser(ctx.user.id, (tx) => tx<{ gmail: boolean; calendar: boolean; last_pull: Date | null }[]>`select gmail, calendar, last_pull from crm.capture_mailboxes where user_id = ${ctx.user.id}`)
  return rows[0] ?? { gmail: false, calendar: false, last_pull: null }
}

export async function myPushCount(ctx: Ctx): Promise<number> {
  const rows = await withUser(ctx.user.id, (tx) => tx<{ n: number }[]>`select count(*)::int as n from crm.push_subscriptions where user_id = ${ctx.user.id}`)
  return rows[0]?.n ?? 0
}
