import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

// ------------------------------------------------------------------ REP-03: envíos del pronóstico
export type Submission = { id: string; version: number; submitter_name: string; period_from: string; period_to: string; n: number; totals: Record<string, { n: number; amount_minor: number }>; submitted_at: string; market_code: string }
/** Los envíos de una persona (o, sin persona, los que quien mira puede ver), del más reciente al más viejo. */
export async function forecastSubmissions(ctx: Ctx, who: string | null, limit = 12): Promise<Submission[]> {
  return withUser(ctx.user.id, (tx) => tx<Submission[]>`
    select id, version, submitter_name, period_from::text, period_to::text, jsonb_array_length(rows)::int as n, totals, submitted_at::text, market_code
      from crm.forecast_submissions where ${who ? tx`submitted_by = ${who}` : tx`true`}
     order by submitted_at desc limit ${limit}`)
}
