import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { decisionRows, type DecisionRow } from '@/domain/decisions'

export type ContactSide = { id: string; full_name: string; phone: string | null; held_phone: string | null; email: string | null; created_at: string; accounts: string[] }
export type ContactPair = { id: string; market_code: string; source: string; suggested_keep: string; detected_at: string; a: ContactSide; b: ContactSide }
export type ContactMerge = { id: string; market_code: string; source_name: string; target_id: string; target_name: string; merged_by: string | null; merged_at: string; undone_at: string | null; undo_reason: string | null }

/** DAT-02: pares de contactos por decidir (más antiguos primero) y fusiones recientes, en el alcance de quien mira. */
export async function contactQueue(ctx: Ctx, market: string | null): Promise<{ pairs: ContactPair[]; merges: ContactMerge[]; open: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const pairs = await tx<ContactPair[]>`
      select p.id, p.market_code, p.source, p.suggested_keep, p.detected_at::text,
             jsonb_build_object('id', a.id, 'full_name', a.full_name, 'phone', a.phone, 'held_phone', a.held_phone, 'email', a.email::text, 'created_at', a.created_at,
               'accounts', coalesce((select jsonb_agg(distinct x.name) from crm.account_contacts ac join crm.accounts x on x.id = ac.account_id where ac.contact_id = a.id and ac.valid_to is null), '[]'::jsonb)) as a,
             jsonb_build_object('id', b.id, 'full_name', b.full_name, 'phone', b.phone, 'held_phone', b.held_phone, 'email', b.email::text, 'created_at', b.created_at,
               'accounts', coalesce((select jsonb_agg(distinct x.name) from crm.account_contacts ac join crm.accounts x on x.id = ac.account_id where ac.contact_id = b.id and ac.valid_to is null), '[]'::jsonb)) as b
        from crm.contact_pairs p
        join app.contact_brief(p.a_id) a on true
        join app.contact_brief(p.b_id) b on true
       where p.status = 'open' and (${market}::text is null or p.market_code = ${market})
       order by p.detected_at, p.id limit 25`
    const open = Number((await tx<{ n: number }[]>`select count(*)::int as n from crm.contact_pairs where status = 'open' and (${market}::text is null or market_code = ${market})`)[0]?.n ?? 0)
    const merges = await tx<ContactMerge[]>`
      select e.id, e.market_code, e.snapshot -> 'source' ->> 'full_name' as source_name, e.target_id, e.snapshot -> 'target' ->> 'full_name' as target_name,
             u.full_name as merged_by, e.merged_at::text, e.undone_at::text, e.undo_reason
        from crm.contact_merge_events e left join crm.users u on u.id = e.merged_by
       where (${market}::text is null or e.market_code = ${market}) order by e.merged_at desc limit 10`
    return { pairs: [...pairs], merges: [...merges], open }
  })
}

/** Decisiones de negocio con su valor vigente, por mercado cuando aplica. */
export async function decisionsBoard(ctx: Ctx): Promise<DecisionRow[]> {
  return withUser(ctx.user.id, (tx) => decisionRows(tx, ctx.markets.filter((m) => m.status === 'live').map((m) => m.code)))
}
