import 'server-only'
import { z } from 'zod'
import { marketToday, marketWorkday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { notifyMany } from '@/domain/notify'
import { invalid, notFound } from '@/lib/errors'
import { isUuid } from '@/lib/ids'

/**
 * E13.F4: agenda de capacitación del dealer nuevo. Cada sesión tiene fecha, quién la da y cómo terminó.
 * Si el dealer no se presentó, se reagenda en el mismo paso y a quien vendió le queda una tarea de seguimiento.
 * El estado de capacitación del negocio (pendiente, agendada, hecha) se mantiene solo a partir de la agenda.
 */
const scheduleInput = z.object({
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  at: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
  trainerId: z.guid(),
  note: z.string().trim().max(500).optional().default(''),
})

type Deal = { id: string; market_code: string; account_id: string; owner_id: string | null; title: string; account: string; status: string }
async function loadDeal(tx: Tx, id: string): Promise<Deal> {
  if (!isUuid(id)) throw notFound()
  const rows = await tx<Deal[]>`select d.id, d.market_code, d.account_id, d.owner_id, d.title, a.name as account, d.status from crm.deals d join crm.accounts a on a.id = d.account_id where d.id = ${id} for update of d`
  if (!rows[0]) throw notFound('No encontramos ese negocio.', 'We could not find that deal.')
  return rows[0]
}

async function assertTrainer(tx: Tx, market: string, userId: string): Promise<string> {
  const rows = await tx<{ full_name: string }[]>`
    select u.full_name from crm.users u where u.id = ${userId} and u.is_active and not u.is_system
       and u.id in (select user_id from app.people_with_role(${market}, array['ops','rep','supervisor','market_lead']))`
  if (!rows[0]) throw invalid('Elige a una persona del mercado para dar la capacitación.', 'Pick someone from the market to give the training.')
  return rows[0].full_name
}

async function insertSession(tx: Tx, ctx: Ctx, d: Deal, v: { on: string; at: string; trainerId: string; note: string | null }, from: string | null): Promise<string> {
  const ok = await tx<{ ok: boolean }[]>`select ${v.on}::date >= ${marketToday(tx, d.market_code)} as ok`
  if (!ok[0]?.ok) throw invalid('La capacitación se agenda de hoy en adelante.', 'A training is scheduled for today or later.')
  const rows = await tx<{ id: string }[]>`
    insert into crm.training_sessions (deal_id, market_code, on_date, at_time, trainer_id, note, rescheduled_from, created_by)
    values (${d.id}, ${d.market_code}, ${v.on}, ${v.at || null}, ${v.trainerId}, ${v.note}, ${from}, ${ctx.user.id}) returning id`
  await tx`update crm.deals set training_status = 'scheduled', training_on = ${v.on} where id = ${d.id}`
  return rows[0]!.id
}

/** Agenda la capacitación (o cambia la que está agendada). Avisa a quien la da y a quien vendió, con el video de recorrido si existe. */
export async function scheduleTraining(ctx: Ctx, dealId: string, raw: z.input<typeof scheduleInput>): Promise<string> {
  const parsed = scheduleInput.safeParse(raw)
  if (!parsed.success) throw invalid('Elige la fecha y quién da la capacitación.', 'Choose the date and who gives the training.')
  const v = parsed.data
  assertNoProhibited(v.note)
  return withUser(ctx.user.id, async (tx) => {
    const d = await loadDeal(tx, dealId)
    ctx.assert('deal.ops', d.market_code)
    if (d.status === 'lost') throw invalid('Un negocio perdido no lleva capacitación.', 'A lost deal has no training.')
    const trainer = await assertTrainer(tx, d.market_code, v.trainerId)
    const open = await tx<{ id: string }[]>`select id from crm.training_sessions where deal_id = ${dealId} and status = 'scheduled' for update`
    if (open[0]) await tx`update crm.training_sessions set status = 'cancelled', resolved_by = ${ctx.user.id}, resolved_at = now() where id = ${open[0].id}`
    const id = await insertSession(tx, ctx, d, { on: v.on, at: v.at, trainerId: v.trainerId, note: clean(v.note) }, open[0]?.id ?? null)
    const video = (await tx<{ u: string | null }[]>`select walkthrough_url as u from crm.market_comms where market_code = ${d.market_code}`)[0]?.u ?? null
    const when = `${v.on}${v.at ? ` ${v.at}` : ''}`
    await notifyMany(tx, ctx, [v.trainerId, ...(d.owner_id ? [d.owner_id] : [])], {
      kind: 'training', market: d.market_code, link: `/deals/${dealId}`, accountId: d.account_id, dealId, needsAction: false,
      title: [`Capacitación de ${d.account}: ${when}`, `Training for ${d.account}: ${when}`],
      body: [`La da ${trainer}.${video ? ` Video de recorrido: ${video}` : ''}`, `Given by ${trainer}.${video ? ` Walkthrough video: ${video}` : ''}`],
    })
    await audit(tx, ctx, 'training.scheduled', 'deal', dealId, d.market_code, open[0] ? { rescheduled: true } : null, { on: v.on, at: v.at || null, trainer_id: v.trainerId })
    return id
  })
}

const resolveInput = z.object({
  result: z.enum(['done', 'no_show', 'cancelled']),
  note: z.string().trim().max(500).optional().default(''),
  nextOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional().default(''),
  nextAt: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')).optional().default(''),
})

/** Cómo terminó la sesión: hecha, no se presentó (se reagenda con seguimiento) o cancelada. */
export async function resolveTraining(ctx: Ctx, sessionId: string, raw: z.input<typeof resolveInput>): Promise<void> {
  if (!isUuid(sessionId)) throw notFound()
  const parsed = resolveInput.safeParse(raw)
  if (!parsed.success) throw invalid('Elige cómo terminó la capacitación.', 'Choose how the training ended.')
  const v = parsed.data
  assertNoProhibited(v.note)
  if (v.result === 'no_show' && !v.nextOn) throw invalid('Si el dealer no se presentó, elige la nueva fecha.', 'If the dealer missed it, choose the new date.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; deal_id: string; status: string; trainer_id: string; on_date: string }[]>`
      select id, deal_id, status, trainer_id, on_date::text from crm.training_sessions where id = ${sessionId} for update`
    const s = rows[0]
    if (!s) throw notFound('No encontramos esa capacitación.', 'We could not find that training.')
    const d = await loadDeal(tx, s.deal_id)
    ctx.assert('deal.ops', d.market_code)
    if (s.status !== 'scheduled') throw invalid('Esa capacitación ya tiene resultado.', 'That training already has a result.')
    await tx`update crm.training_sessions set status = ${v.result}, note = coalesce(${clean(v.note)}, note), resolved_by = ${ctx.user.id}, resolved_at = now() where id = ${sessionId}`
    if (v.result === 'done') await tx`update crm.deals set training_status = 'done', training_on = ${s.on_date} where id = ${d.id}`
    if (v.result === 'cancelled') await tx`update crm.deals set training_status = 'pending', training_on = null where id = ${d.id}`
    if (v.result === 'no_show') {
      await insertSession(tx, ctx, d, { on: v.nextOn, at: v.nextAt, trainerId: s.trainer_id, note: null }, sessionId)
      // Seguimiento: a quien vendió le queda una tarea para confirmar la nueva fecha con el dealer.
      if (d.owner_id) {
        const en = (await tx<{ locale: string }[]>`select locale from crm.users where id = ${d.owner_id}`)[0]?.locale === 'en'
        await tx`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by, source)
                 values (${d.market_code}, ${d.account_id}, ${d.id}, 'task',
                         ${(en ? `Confirm the new training date with ${d.account}: ${v.nextOn}` : `Confirmar con ${d.account} la nueva fecha de capacitación: ${v.nextOn}`).slice(0, 200)},
                         ((${marketWorkday(tx, d.market_code, 0)} + time '15:00') at time zone 'UTC'), ${d.owner_id}, ${ctx.user.id}, 'rule')`
        await notifyMany(tx, ctx, [d.owner_id], {
          kind: 'training', market: d.market_code, link: `/deals/${d.id}`, accountId: d.account_id, dealId: d.id, needsAction: false,
          title: [`${d.account} no se presentó a la capacitación`, `${d.account} missed the training`],
          body: [`Se reagendó para el ${v.nextOn}. Te quedó una tarea para confirmar la fecha con el dealer.`, `It was rescheduled for ${v.nextOn}. A task is waiting for you to confirm the date with the dealer.`],
        })
      }
    }
    await audit(tx, ctx, v.result === 'done' ? 'training.done' : v.result === 'no_show' ? 'training.no_show' : 'training.cancelled', 'deal', d.id, d.market_code, { on: s.on_date }, v.result === 'no_show' ? { rescheduled_to: v.nextOn } : null)
  })
}
