import 'server-only'
import type { Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid } from '@/lib/errors'
import type { MessageKey } from '@/lib/messages'

/** Cómo terminó una tarea o un contacto. */
export const RESULTS = ['reached', 'no_answer', 'later', 'done'] as const
/** Cómo terminó una visita: hubo venta o alta, no hubo, o hay que volver con quien decide. */
export const VISIT_RESULTS = ['sale', 'no_sale', 'revisit'] as const
/** Qué sigue. "visit" deja una visita por hacer; "task" acepta un texto libre. */
export const NEXTS = ['call', 'visit', 'proposal', 'meeting', 'task', 'none', 'docs', 'provider', 'training'] as const
/** Lo que ofrece la hoja según quién completa: ventas habla de llamadas y propuestas; Operaciones, de documentos, proveedores y capacitación. */
export const SALES_NEXTS = ['call', 'visit', 'proposal', 'meeting', 'task', 'none'] as const
export const OPS_NEXTS = ['docs', 'provider', 'training', 'task', 'none'] as const
/** Cómo terminó una tarea de Operaciones. */
export const OPS_RESULTS = ['docs_received', 'sent_provider', 'approved', 'rejected', 'training_done', 'waiting', 'done'] as const
export type OpsResult = (typeof OPS_RESULTS)[number]
export type Result = (typeof RESULTS)[number]
export type VisitResult = (typeof VISIT_RESULTS)[number]
export type Next = (typeof NEXTS)[number]

export const isOneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v)

/** Nota corta que acompaña a lo que se completa o se registra. Vacía es "sin nota". */
export function shortNote(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (v.length > 500) throw invalid('La nota es muy larga: déjala en 500 caracteres o menos.', 'The note is too long: keep it to 500 characters or fewer.')
  assertNoProhibited(v)
  return v
}

/** Texto de "Otra tarea": lo que la persona escribe queda como el próximo paso, tal cual. */
export function nextText(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (v.length < 2 || v.length > 120) throw invalid('Escribe la tarea en 120 caracteres o menos.', 'Write the task in 120 characters or fewer.')
  assertNoProhibited(v)
  return v
}

/**
 * Quién visitó, como nombre aparte del dueño (requerimiento E16.F3): los vendedores de calle no son usuarios.
 * Es un nombre de persona: sin números ni datos que no se guardan.
 */
export function visitorName(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!v) return null
  if (v.length < 2 || v.length > 80 || /\d/.test(v)) throw invalid('Escribe el nombre de quien visitó, sin números.', 'Write the name of who visited, with no numbers.')
  assertNoProhibited(v)
  return v
}

/** La fecha del próximo paso es de hoy en adelante (en el día del mercado) y dentro de un año. */
export async function assertNextDate(tx: Tx, tz: string, when: string | null | undefined): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(when ?? '')) throw invalid('Elige cuándo es el próximo paso.', 'Choose when the next step is.')
  const ok = await tx<{ ok: boolean }[]>`select ${when!}::date >= (now() at time zone ${tz})::date and ${when!}::date <= (now() at time zone ${tz})::date + 366 as ok`
  if (!ok[0]?.ok) throw invalid('La fecha del próximo paso tiene que ser de hoy en adelante y dentro de un año.', 'The next step date must be today or later, within a year.')
  return when!
}

export type NextStep = { market: string; accountId: string | null; dealId: string | null; leadId: string | null; name: string; next: Exclude<Next, 'none'>; when: string; text?: string | null; follows: string; /** De qué carril era lo que se completó ('sales' u 'ops'); sin dato, lo decide el rol. */ lane?: 'sales' | 'ops' | null }

/**
 * Deja programado el próximo paso: una tarea con fecha o, si lo que sigue es visitar, una visita por hacer.
 * Si viene de un negocio abierto, el negocio queda con ese mismo próximo paso.
 */
export async function scheduleNext(tx: Tx, ctx: Ctx, p: NextStep): Promise<string> {
  ctx.assert('activity.write', p.market)
  const subject = p.next === 'task' && p.text ? p.text : ctx.m(`complete.nextTitle.${p.next}` as MessageKey, { name: p.name })
  const kind = p.next === 'visit' ? 'visit' : 'task'
  const id = await newId(tx)
  // Dos carriles por negocio: el próximo paso de Operaciones no pisa el de quien vende.
  const lane: 'sales' | 'ops' | null = !p.dealId ? null : p.lane ?? (ctx.can('deal.ops', p.market) && !ctx.can('deal.create', p.market) ? 'ops' : 'sales')
  const editable = Boolean(p.dealId && ctx.can('deal.edit', p.market))
  if (lane && editable) await tx`update crm.activities set deal_step = null where deal_id = ${p.dealId} and deal_step = ${lane} and done_at is null`
  await tx`insert into crm.activities (id, market_code, account_id, deal_id, lead_id, kind, subject, due_at, owner_id, created_by, deal_step)
           values (${id}, ${p.market}, ${p.accountId}, ${p.dealId}, ${p.leadId}, ${kind}, ${subject}, ${`${p.when}T15:00:00Z`}, ${ctx.user.id}, ${ctx.user.id}, ${lane && editable ? lane : null})`
  await audit(tx, ctx, 'activity.added', 'activity', id, p.market, null, { kind, account_id: p.accountId, follows: p.follows })
  if (p.dealId && editable) {
    const d = lane === 'ops'
      ? await tx<{ next_step: string | null }[]>`
          update crm.deals set ops_next_step = ${subject}, ops_next_step_due = ${p.when}, ops_owner_id = coalesce(ops_owner_id, ${ctx.user.id}) where id = ${p.dealId} and status = 'open' returning ops_next_step as next_step`
      : await tx<{ next_step: string | null }[]>`
          update crm.deals set next_step = ${subject}, next_step_due = ${p.when} where id = ${p.dealId} and status = 'open' returning next_step`
    if (d[0]) await audit(tx, ctx, 'deal.updated', 'deal', p.dealId, p.market, null, lane === 'ops' ? { ops_next_step: subject, ops_next_step_due: p.when } : { next_step: subject, next_step_due: p.when })
  }
  return subject
}

/**
 * Lo que una visita capturada a mano le hace al negocio abierto del comercio, igual que una visita de la Sales App (PIPE-05):
 * si hay que volver con quien decide, el negocio queda marcado con revisita; si la visita se hizo, la marca se quita.
 * `day` es el día de la visita y `returnOn` la fecha del próximo paso, si la persona ya la eligió.
 */
export async function applyVisitOutcome(tx: Tx, ctx: Ctx, p: { market: string; accountId: string | null; outcome: VisitResult; day: string | null; returnOn: string | null }): Promise<void> {
  if (!p.accountId || !ctx.can('deal.edit', p.market)) return
  const deals =
    p.outcome === 'revisit'
      ? await tx<{ id: string }[]>`
          update crm.deals set revisit_needed = true, revisit_reason = 'decision_maker_absent',
                 revisit_due = coalesce(${p.returnOn}::date, coalesce(${p.day}::date, (now() at time zone ${ctx.market(p.market).timezone})::date) + 2)
           where account_id = ${p.accountId} and status = 'open' returning id`
      : await tx<{ id: string }[]>`
          update crm.deals set revisit_needed = false where account_id = ${p.accountId} and status = 'open' and revisit_needed returning id`
  for (const d of deals) await audit(tx, ctx, 'deal.updated', 'deal', d.id, p.market, null, { revisit_needed: p.outcome === 'revisit', by: 'manual_visit' })
  // La revisita ya se hizo: el aviso abierto se cierra con la visita, no espera a la siguiente evaluación de reglas.
  if (p.outcome !== 'revisit' && deals.length > 0) {
    await tx`update crm.exceptions set resolved_at = now(), resolved_by = ${ctx.user.id}, resolution = 'auto'
              where kind = 'revisit_due' and resolved_at is null and deal_id = any(${deals.map((d) => d.id)}::uuid[])`
  }
}
