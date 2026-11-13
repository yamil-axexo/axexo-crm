import 'server-only'
import type { Tx } from '@/server/db'
import { stateZone } from '@/lib/markets'

/** MULTI-02 (datos2). Comercios sin zona propia cuyo estado dice una zona distinta de la del mercado: toman esa zona. No pisa una zona puesta a mano. */
export async function inferAccountTimezones(tx: Tx): Promise<number> {
  const rows = await tx<{ id: string; market_code: string; region: string; market_tz: string }[]>`
    select a.id, a.market_code, a.region, m.timezone as market_tz from crm.accounts a join crm.markets m on m.code = a.market_code
     where a.timezone is null and a.archived_at is null and nullif(btrim(a.region), '') is not null and a.market_code in ('US', 'MX')`
  const set = rows.map((r) => ({ id: r.id, tz: stateZone(r.market_code, r.region) })).filter((r): r is { id: string; tz: string } => !!r.tz && r.tz !== rows.find((x) => x.id === r.id)!.market_tz)
  if (!set.length) return 0
  const res = await tx`update crm.accounts a set timezone = x.tz from jsonb_to_recordset(${tx.json(set)}) as x(id uuid, tz text) where a.id = x.id and a.timezone is null`
  return res.count
}
