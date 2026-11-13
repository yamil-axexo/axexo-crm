import { NextResponse, type NextRequest } from 'next/server'
import { runVia, withUser, withoutUser } from '@/server/db'
import { partnerTokenHash } from '@/domain/partners'
import { LIMITS, clientIp, ipHash, rateHit } from '@/server/protect'

export const dynamic = 'force-dynamic'

/**
 * CANAL-01: API de lectura para partners, primero API. El token (Bearer cpt_...) está atado a una persona de partner y a su nodo;
 * la consulta corre con la identidad de esa persona, así que lo que regresa lo decide RLS: su nodo y lo que cuelga de él.
 * Si su acceso termina o el nodo se archiva o se fusiona, el token deja de servir.
 */
export async function GET(request: NextRequest) {
  const ip = ipHash(clientIp(request.headers))
  const byIp = await rateHit(`partner-api:ip:${ip}`, LIMITS.apiPerIp)
  if (!byIp.allowed) return NextResponse.json({ error: 'rate_limited', retry_after: byIp.retryAfter }, { status: 429, headers: { 'retry-after': String(byIp.retryAfter) } })
  const auth = request.headers.get('authorization') ?? ''
  const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const rows = raw.startsWith('cpt_')
    ? await withoutUser((tx) => tx<{ token_id: string; user_id: string; scope_account_id: string }[]>`select token_id, user_id, scope_account_id from app.partner_token_user(${partnerTokenHash(raw)})`)
    : []
  const tok = rows[0]
  if (!tok) {
    const fails = await rateHit(`partner-api:authfail:${ip}`, LIMITS.apiAuthFailPerIp)
    if (!fails.allowed) return NextResponse.json({ error: 'rate_limited', retry_after: fails.retryAfter }, { status: 429 })
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const data = await runVia('api', () => withUser(tok.user_id, (tx) => tx<{ id: string; parent_id: string | null; name: string; kind: string; lifecycle: string; open_deals: number; stage: string | null; updated_at: string }[]>`
    select a.id, a.parent_id, a.name, a.kind, a.lifecycle,
           (select count(*)::int from crm.deals d where d.account_id = a.id and d.status = 'open') as open_deals,
           (select s.code from crm.deals d join crm.stages s on s.id = d.stage_id where d.account_id = a.id order by d.updated_at desc limit 1) as stage,
           a.updated_at::text
      from crm.accounts a
     where a.archived_at is null and a.merged_into is null
       and (a.id = ${tok.scope_account_id} or a.ancestor_ids @> array[${tok.scope_account_id}::uuid])
     order by a.ancestor_ids, a.name limit 2000`))
  return NextResponse.json({ data, scope: tok.scope_account_id }, { headers: { 'cache-control': 'no-store' } })
}
