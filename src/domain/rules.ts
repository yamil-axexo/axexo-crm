import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { notFound } from '@/lib/errors'

export const EXCEPTION_KINDS = ['lead_sla', 'revisit_due', 'activation_risk', 'no_next_step', 'stalled_deal', 'reactivation', 'unowned_account', 'duplicate_suspect', 'unmatched_event'] as const
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]

export const ACTIVATION_GRACE_DAYS = 7

/**
 * CAMPO-04 / CS-03 / PIPE-03: las reglas viven aquí, en un solo lugar (AUT-01), y producen la cola de excepciones.
 * Cada regla abre la excepción si la condición existe y la cierra sola cuando deja de existir.
 * Corre como usuario de sistema dentro de una transacción.
 */
export async function evaluateRules(tx: Tx): Promise<{ opened: number; closed: number }> {
  const before = await tx<{ n: number }[]>`select count(*)::int as n from crm.exceptions where resolved_at is null`

  await tx`
    with cond as (
      select 'lead_sla'::text as kind, 'high'::text as severity, l.market_code, null::uuid as account_id, null::uuid as deal_id, l.id as lead_id, l.owner_id,
             jsonb_build_object('name', l.business_name, 'due', l.sla_due_at) as detail, 'lead_sla:' || l.id as dedupe_key
        from crm.leads l where l.status = 'new' and l.first_touch_at is null and l.sla_due_at < now()
      union all
      select 'revisit_due', 'high', d.market_code, d.account_id, d.id, null, d.owner_id,
             jsonb_build_object('title', d.title, 'due', d.revisit_due, 'reason', d.revisit_reason), 'revisit_due:' || d.id
        from crm.deals d where d.status = 'open' and d.revisit_needed and d.revisit_due <= current_date
      union all
      select 'activation_risk', 'high', d.market_code, d.account_id, d.id, null, d.owner_id,
             jsonb_build_object('title', d.title, 'since', d.stage_entered_at), 'activation_risk:' || d.id
        from crm.deals d join crm.stages s on s.id = d.stage_id
       where d.status = 'open' and s.kind = 'awaiting_txn' and d.stage_entered_at < now() - make_interval(days => ${ACTIVATION_GRACE_DAYS})
      union all
      select 'no_next_step', 'medium', d.market_code, d.account_id, d.id, null, d.owner_id,
             jsonb_build_object('title', d.title), 'no_next_step:' || d.id
        from crm.deals d join crm.stages s on s.id = d.stage_id
       where d.status = 'open' and s.kind = 'open' and (d.next_step is null or d.next_step_due is null or d.next_step_due < current_date - 2)
      union all
      select 'stalled_deal', 'medium', d.market_code, d.account_id, d.id, null, d.owner_id,
             jsonb_build_object('title', d.title, 'since', d.stage_entered_at, 'limit_days', s.rot_days), 'stalled_deal:' || d.id
        from crm.deals d join crm.stages s on s.id = d.stage_id
       where d.status = 'open' and s.kind = 'open' and s.rot_days > 0 and d.stage_entered_at < now() - make_interval(days => s.rot_days)
      union all
      select 'reactivation', 'medium', a.market_code, a.id, null, null, a.owner_id,
             jsonb_build_object('name', a.name, 'since', a.lifecycle_at), 'reactivation:' || a.id
        from crm.accounts a where a.lifecycle = 'at_risk' and a.archived_at is null
      union all
      select 'unowned_account', 'low', a.market_code, a.id, null, null, null,
             jsonb_build_object('name', a.name, 'lifecycle', a.lifecycle), 'unowned_account:' || a.id
        from crm.accounts a
       where a.owner_id is null and a.parent_id is null and a.archived_at is null and a.lifecycle in ('active','at_risk','onboarding')
      union all
      -- un aviso por comercio repetido (contra el más antiguo con ese teléfono), no uno por cada par
      select 'duplicate_suspect', 'medium', b.market_code, a.id, null, null, b.owner_id,
             jsonb_build_object('name', a.name, 'other_id', b.id, 'other_name', b.name, 'match', 'phone'), 'duplicate_suspect:' || a.id || ':' || b.id
        from crm.accounts b
        join lateral (select o.id, o.name from crm.accounts o
                       where o.market_code = b.market_code and o.phone = b.phone and o.id < b.id and o.archived_at is null
                       order by o.id limit 1) a on true
       where b.phone is not null and b.archived_at is null
    ),
    closed as (
      update crm.exceptions e set resolved_at = now(), resolution = 'auto'
       where e.resolved_at is null and e.kind <> 'unmatched_event'
         and not exists (select 1 from cond c where c.dedupe_key = e.dedupe_key)
      returning 1
    )
    insert into crm.exceptions (market_code, kind, severity, account_id, deal_id, lead_id, owner_id, detail, dedupe_key)
    select c.market_code, c.kind, c.severity, c.account_id, c.deal_id, c.lead_id, c.owner_id, c.detail, c.dedupe_key
      from cond c
     where not exists (select 1 from crm.exceptions e where e.dedupe_key = c.dedupe_key and e.resolved_at is null)
       and not exists (select 1 from crm.exceptions e where e.dedupe_key = c.dedupe_key and e.resolution in ('dismissed', 'scheduled') and e.resolved_at > now() - interval '7 days')
    on conflict do nothing`

  await tx`update crm.settings set value = to_jsonb(now()) where key = 'rules_last_run'`
  const after = await tx<{ n: number; auto: number }[]>`
    select count(*) filter (where resolved_at is null)::int as n,
           count(*) filter (where resolution = 'auto' and resolved_at > now() - interval '5 seconds')::int as auto from crm.exceptions`
  const closed = after[0]?.auto ?? 0
  return { opened: Math.max(0, (after[0]?.n ?? 0) - (before[0]?.n ?? 0) + closed), closed }
}

/** Las reglas se reevalúan a lo sumo cada 15 minutos cuando alguien abre un tablero. */
export async function ensureRulesFresh(sys: Ctx, maxAgeMinutes = 15): Promise<void> {
  await withUser(sys.user.id, async (tx) => {
    const rows = await tx<{ stale: boolean }[]>`
      select coalesce((value #>> '{}')::timestamptz < now() - make_interval(mins => ${maxAgeMinutes}), true) as stale
        from crm.settings where key = 'rules_last_run' for update`
    if (rows[0]?.stale ?? true) await evaluateRules(tx)
  })
}

export async function runRulesNow(ctx: Ctx, sys: Ctx): Promise<{ opened: number; closed: number }> {
  ctx.assert('board.supervisor')
  return withUser(sys.user.id, (tx) => evaluateRules(tx))
}

/** Descartar una excepción no la borra: queda cerrada, con quién y por qué, y no reaparece por 7 días. */
export async function resolveException(ctx: Ctx, id: string, note: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; kind: string; resolved_at: Date | null }[]>`
      select market_code, kind, resolved_at from crm.exceptions where id = ${id} for update`
    const e = rows[0]
    if (!e) throw notFound()
    ctx.assert('exception.resolve', e.market_code)
    if (e.resolved_at) return
    await tx`update crm.exceptions set resolved_at = now(), resolved_by = ${ctx.user.id}, resolution = 'dismissed',
              detail = detail || ${tx.json({ note: note.trim().slice(0, 300) })} where id = ${id}`
    await audit(tx, ctx, 'exception.dismissed', 'exception', id, e.market_code, null, { kind: e.kind })
  })
}
