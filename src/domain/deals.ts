import 'server-only'
import { z } from 'zod'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { assertNoProhibited } from '@/domain/guard'
import { audit, emit, newId, clean } from '@/domain/common'
import { DomainError, invalid, notFound } from '@/lib/errors'
import { day as dayLabel, isoDay } from '@/lib/format'

export type StageKind = 'open' | 'awaiting_txn' | 'won' | 'lost'

export type GateDeal = {
  amount_minor: string | number | null
  next_step: string | null
  next_step_due: string | Date | null
  decision_maker_id: string | null
  decision_maker_met: boolean
  /** Cuántas líneas de producto lleva. Solo se revisa cuando la etapa pide 'items'. */
  items_count?: number
}

export const FIELD_LABEL: Record<string, { es: string; en: string }> = {
  amount: { es: 'monto esperado', en: 'expected amount' },
  next_step: { es: 'próximo paso con fecha', en: 'next step with a date' },
  decision_maker: { es: 'quien decide, identificado y contactado', en: 'decision-maker identified and reached' },
  items: { es: 'al menos una línea de producto', en: 'at least one product line' },
}

/** Lo mismo, dicho como lo diría una persona del equipo: es lo que lee quien intenta ganar un negocio y le falta algo. */
export const PLAIN_MISSING: Record<string, { es: string; en: string }> = {
  amount: { es: 'poner el monto esperado', en: 'enter the expected amount' },
  next_step: { es: 'dejar el próximo paso con fecha', en: 'set the next step with a date' },
  decision_maker: { es: 'decir quién decide y marcar que ya hablaste con esa persona', en: 'say who decides and mark that you have spoken with that person' },
  items: { es: 'agregar al menos una línea de producto', en: 'add at least one product line' },
}
const joinList = (parts: string[], and: string) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}`)
/** "Para ganarlo falta decir quién decide y marcar que ya hablaste con esa persona." */
export const winMissingText = (missing: string[]): [es: string, en: string] => [
  `Para ganarlo falta ${joinList(missing.map((m) => PLAIN_MISSING[m]?.es ?? m), 'y')}.`,
  `To win it you still need to ${joinList(missing.map((m) => PLAIN_MISSING[m]?.en ?? m), 'and')}.`,
]

/**
 * PIPE-01 / ACT-02: qué le falta a un deal para entrar a una etapa. Función pura: la usan la UI,
 * la acción de mover etapa y las pruebas, para que la regla exista en un solo lugar (AUT-01).
 */
export function missingForStage(deal: GateDeal, stage: { kind: StageKind; required_fields: string[] }): string[] {
  const need = new Set(stage.required_fields)
  if (stage.kind === 'open') need.add('next_step')
  const missing: string[] = []
  if (need.has('amount') && (deal.amount_minor === null || Number(deal.amount_minor) <= 0)) missing.push('amount')
  if (need.has('next_step') && !(deal.next_step && deal.next_step.trim() && deal.next_step_due)) missing.push('next_step')
  if (need.has('decision_maker') && !(deal.decision_maker_id && deal.decision_maker_met)) missing.push('decision_maker')
  if (need.has('items') && !((deal.items_count ?? 0) > 0)) missing.push('items')
  return missing
}

type DealRow = GateDeal & {
  id: string
  market_code: string
  pipeline_id: string
  stage_id: string
  account_id: string
  owner_id: string | null
  status: 'open' | 'won' | 'lost'
  title: string
  revisit_needed: boolean
  ops_owner_id: string | null
}

/**
 * El próximo paso de un negocio es una tarea de su responsable, para que llegue a Hoy el día que toca.
 * Hay dos carriles: 'sales' (quien vende) y 'ops' (quien lo lleva en Operaciones); cada uno tiene a lo más una tarea abierta.
 */
export async function syncDealStep(tx: Tx, ctx: Ctx, d: { id: string; market_code: string; account_id: string }, lane: 'sales' | 'ops', step: string | null, due: string | null, ownerId: string | null): Promise<void> {
  const open = await tx<{ id: string }[]>`select id from crm.activities where deal_id = ${d.id} and deal_step = ${lane} and done_at is null order by created_at desc for update`
  if (!step || !due || !ownerId) {
    // Sin paso, sin fecha o sin responsable no hay tarea: la que hubiera deja de ser "el próximo paso".
    if (open.length) await tx`update crm.activities set deal_step = null where id = any(${open.map((o) => o.id)}::uuid[])`
    return
  }
  const at = `${due}T15:00:00Z`
  if (open[0]) {
    await tx`update crm.activities set subject = ${step}, due_at = ${at}, owner_id = ${ownerId} where id = ${open[0].id}`
    if (open.length > 1) await tx`update crm.activities set deal_step = null where id = any(${open.slice(1).map((o) => o.id)}::uuid[])`
    return
  }
  await tx`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by, deal_step)
           values (${d.market_code}, ${d.account_id}, ${d.id}, 'task', ${step}, ${at}, ${ownerId}, ${ctx.user.id}, ${lane})`
}

/** ¿Hay una etapa de Operaciones desde la etapa actual (incluida) hasta antes de la de destino? Entonces avanzar es cosa de Operaciones. */
async function crossesOps(tx: Tx, pipelineId: string, fromPos: number, toPos: number): Promise<boolean> {
  if (toPos <= fromPos) return false
  const rows = await tx`select 1 from crm.stages where pipeline_id = ${pipelineId} and is_ops and archived_at is null and position >= ${fromPos} and position < ${toPos} limit 1`
  return rows.length > 0
}

const OPS_ONLY = () => new DomainError('ops_only',
  'Este negocio ya está con Operaciones: desde aquí solo Operaciones lo avanza, y nunca quien lo vendió.',
  'This deal is with Operations now: from here only Operations moves it forward, never the person who sold it.', 403)

async function loadDeal(tx: Tx, id: string): Promise<DealRow> {
  const rows = await tx<DealRow[]>`select id, market_code, pipeline_id, stage_id, account_id, owner_id, status, title, amount_minor, next_step,
    next_step_due, decision_maker_id, decision_maker_met, revisit_needed, ops_owner_id from crm.deals where id = ${id} for update`
  if (!rows[0]) throw notFound('No encontramos ese negocio.', 'We could not find that deal.')
  return rows[0]
}

const editInput = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  amount: z.union([z.number().nonnegative().max(1e12), z.null()]).optional(), // en unidades mayores; se guarda en menores (DATA-03)
  nextStep: z.string().trim().max(200).optional(),
  nextStepDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
  decisionMakerId: z.guid().or(z.literal('')).optional(),
  decisionMakerMet: z.boolean().optional(),
})
export type DealEdit = z.input<typeof editInput>

export async function updateDeal(ctx: Ctx, dealId: string, input: DealEdit): Promise<void> {
  const v = editInput.parse(input)
  assertNoProhibited(v.title, v.nextStep)
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadDeal(tx, dealId)
    ctx.assert('deal.edit', d.market_code)
    if (d.status !== 'open') throw invalid('Un negocio cerrado no se edita.', 'A closed deal cannot be edited.')
    const next = {
      title: v.title ?? d.title,
      amount_minor: v.amount === undefined ? d.amount_minor : v.amount === null ? null : Math.round(v.amount * 100),
      next_step: v.nextStep === undefined ? d.next_step : clean(v.nextStep),
      next_step_due: v.nextStepDue === undefined ? d.next_step_due : v.nextStepDue || null,
      decision_maker_id: v.decisionMakerId === undefined ? d.decision_maker_id : v.decisionMakerId || null,
      decision_maker_met: v.decisionMakerMet ?? d.decision_maker_met,
    }
    if (next.next_step && !next.next_step_due) throw invalid('Ponle fecha al próximo paso.', 'Give the next step a date.')
    if (d.next_step && !next.next_step) throw invalid('Un negocio abierto lleva próximo paso: cámbialo, no lo borres.', 'An open deal carries a next step: change it, do not clear it.')
    if (next.next_step_due && String(next.next_step_due) !== String(d.next_step_due)) {
      const ok = await tx<{ ok: boolean }[]>`select ${String(next.next_step_due)}::date >= ${marketToday(tx, d.market_code)} as ok`
      if (!ok[0]?.ok) throw invalid('La fecha del próximo paso tiene que ser de hoy en adelante.', 'The next step date must be today or later.')
    }
    if (next.decision_maker_id) {
      const ok = await tx`select 1 from crm.account_contacts where account_id = ${d.account_id} and contact_id = ${next.decision_maker_id} and valid_to is null`
      if (!ok[0]) throw invalid('Quien decide tiene que ser un contacto de este comercio.', 'The decision-maker must be a contact of this merchant.')
    } else next.decision_maker_met = false
    const cleared = d.revisit_needed && next.decision_maker_met
    await tx`update crm.deals set title = ${next.title}, amount_minor = ${next.amount_minor}, next_step = ${next.next_step},
              next_step_due = ${next.next_step_due}, decision_maker_id = ${next.decision_maker_id}, decision_maker_met = ${next.decision_maker_met},
              revisit_needed = ${cleared ? false : d.revisit_needed}
              where id = ${dealId}`
    if (v.nextStep !== undefined || v.nextStepDue !== undefined) {
      await syncDealStep(tx, ctx, d, 'sales', next.next_step, next.next_step_due ? isoDate(next.next_step_due) : null, d.owner_id)
    }
    await audit(tx, ctx, 'deal.updated', 'deal', dealId, d.market_code,
      { amount_minor: d.amount_minor === null ? null : Number(d.amount_minor), next_step: d.next_step, decision_maker_met: d.decision_maker_met },
      { amount_minor: next.amount_minor === null ? null : Number(next.amount_minor), next_step: next.next_step, decision_maker_met: next.decision_maker_met })
  })
}

/** Fecha (AAAA-MM-DD) de un valor que puede venir como Date de la base. */
export const isoDate = (v: string | Date | null): string | null => (v === null ? null : v instanceof Date ? isoDay(v, 'UTC') : String(v).slice(0, 10))

export type MoveExtra = {
  /** Día real en que se ganó (AAAA-MM-DD), de hoy hacia atrás en la zona del mercado. Vacío es hoy. */
  wonOn?: string
  /** Motivo al devolver el negocio de Operaciones a Ventas. */
  ret?: { reasonCode: string; note?: string }
}

/**
 * Mover un deal de etapa. `next` deja el próximo paso en la misma transacción: el tablero lo pide cuando falta
 * (handoff, sección 6: "cambiar de etapa pide próximo paso si no hay uno") y así mover y programar no quedan a medias.
 *
 * Entrega a Operaciones: al entrar a una etapa de Operaciones el negocio pasa a su cola y sale de la cancha de quien vende.
 * Dentro de esas etapas solo avanza Operaciones, nunca quien lo vendió (la base lo repite con un trigger).
 * Regresarlo a una etapa de Ventas pide motivo y le deja a quien vende una tarea para hoy.
 */
export async function moveDeal(ctx: Ctx, dealId: string, toStageId: string, loss?: { reasonCode: string; note?: string }, next?: { step: string; due: string }, extra?: MoveExtra): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadDeal(tx, dealId)
    if (next) {
      const step = clean(next.step)
      if (!step || step.length < 2 || step.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(next.due)) throw invalid('Escribe el próximo paso (hasta 200 letras) y su fecha.', 'Enter the next step (up to 200 characters) and its date.')
      assertNoProhibited(step)
      const range = await tx<{ ok: boolean }[]>`select ${next.due}::date >= ${marketToday(tx, d.market_code)} as ok`
      if (!range[0]?.ok) throw invalid('La fecha del próximo paso tiene que ser de hoy en adelante.', 'The next step date must be today or later.')
      ctx.assert('deal.edit', d.market_code)
      await tx`update crm.deals set next_step = ${step}, next_step_due = ${next.due} where id = ${dealId} and status = 'open'`
      await syncDealStep(tx, ctx, d, 'sales', step, next.due, d.owner_id ?? ctx.user.id)
      await audit(tx, ctx, 'deal.updated', 'deal', dealId, d.market_code, { next_step: d.next_step }, { next_step: step, next_step_due: next.due })
      d.next_step = step
      d.next_step_due = next.due
    }
    ctx.assert('deal.move', d.market_code)
    if (d.status !== 'open') throw invalid('Este negocio ya está cerrado.', 'This deal is already closed.')
    if (toStageId === d.stage_id) return
    const stages = await tx<{ id: string; kind: StageKind; required_fields: string[]; name_es: string; name_en: string; position: number; is_ops: boolean }[]>`
      select id, kind, required_fields, name_es, name_en, position, is_ops from crm.stages where id = ${toStageId} and pipeline_id = ${d.pipeline_id} and archived_at is null`
    const stage = stages[0]
    if (!stage) throw invalid('Esa etapa no es de este embudo.', 'That stage is not part of this pipeline.')
    const curs = await tx<{ position: number; is_ops: boolean }[]>`select position, is_ops from crm.stages where id = ${d.stage_id}`
    const cur = curs[0]!
    // Separación de funciones: lo que pasa por una etapa de Operaciones lo avanza Operaciones, y no quien vendió.
    if (stage.kind !== 'lost' && (await crossesOps(tx, d.pipeline_id, cur.position, stage.position))) {
      if (!ctx.can('deal.ops', d.market_code) || d.owner_id === ctx.user.id) throw OPS_ONLY()
    }
    // Operaciones gana lo que ya recibió: un negocio que Ventas no ha entregado (sigue en una etapa de Ventas) no lo gana quien solo opera.
    if (stage.kind === 'won' && !cur.is_ops && ctx.can('deal.ops', d.market_code) && !ctx.can('deal.create', d.market_code)) {
      throw new DomainError('not_handed_over',
        'Ventas todavía no entrega este negocio a Operaciones. Lo puedes marcar como ganado cuando llegue a tu cola.',
        'Sales has not handed this deal over to Operations yet. You can mark it as won once it reaches your queue.', 403)
    }
    const entering = stage.is_ops && !cur.is_ops && stage.kind !== 'lost'
    const returning = cur.is_ops && !stage.is_ops && stage.kind === 'open' && stage.position < cur.position
    let reason: { label_es: string; label_en: string } | undefined
    if (returning) {
      const code = extra?.ret?.reasonCode ?? ''
      const rows = code ? await tx<{ label_es: string; label_en: string }[]>`
        select label_es, label_en from crm.ops_catalog where kind = 'return_reason' and code = ${code} and is_active and (market_code is null or market_code = ${d.market_code})
         order by market_code nulls last limit 1` : []
      reason = rows[0]
      if (!reason) throw new DomainError('return_reason_required', 'Para devolver el negocio a Ventas, elige el motivo.', 'To send the deal back to Sales, pick the reason.')
      assertNoProhibited(extra?.ret?.note)
      if ((extra?.ret?.note ?? '').trim().length > 300) throw invalid('Deja la nota del motivo en 300 caracteres o menos.', 'Keep the reason note to 300 characters or fewer.')
    }
    // Avanzar saltando etapas no evita lo que piden las de en medio: se exige la suma de todas hasta la de destino.
    const skipped = await tx<{ required_fields: string[] }[]>`
      select s.required_fields from crm.stages s
       where s.pipeline_id = ${d.pipeline_id} and s.kind in ('open', 'awaiting_txn') and s.position < ${stage.position}
         and s.position > (select c.position from crm.stages c where c.id = ${d.stage_id})`
    const gate = { kind: stage.kind, required_fields: [...new Set([...stage.required_fields, ...skipped.flatMap((s) => s.required_fields)])] }
    if (gate.required_fields.includes('items')) {
      const n = await tx<{ n: number }[]>`select count(*)::int as n from crm.deal_items where deal_id = ${dealId}`
      d.items_count = n[0]?.n ?? 0
    }

    let wonAt = tx`now()`
    if (stage.kind === 'won') {
      // PIPE-06: "la transacción cierra, no el vendedor".
      const pipe = await tx<{ close_by_transaction: boolean }[]>`select close_by_transaction from crm.pipelines where id = ${d.pipeline_id}`
      if (pipe[0]?.close_by_transaction !== false) {
        throw new DomainError('won_by_transaction',
          'Este negocio se gana solo, cuando los datos de ventas traen la primera transacción del comercio.',
          'This deal is won on its own, when the sales data shows the merchant’s first transaction.')
      }
      // Ganar a mano: la fecha real de cierre es de hoy hacia atrás (en el día del mercado), nunca futura.
      const on = (extra?.wonOn ?? '').trim()
      if (on) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw invalid('Elige la fecha en que se ganó.', 'Choose the date it was won.')
        const chk = await tx<{ ok: boolean; today: boolean }[]>`
          select ${on}::date <= ${marketToday(tx, d.market_code)} and ${on}::date >= ${marketToday(tx, d.market_code)} - 366 as ok, ${on}::date = ${marketToday(tx, d.market_code)} as today`
        if (!chk[0]?.ok) throw invalid('La fecha de cierre es de hoy hacia atrás, nunca futura.', 'The close date is today or earlier, never in the future.')
        if (!chk[0].today) wonAt = tx`(${on}::date + time '12:00') at time zone ${ctx.market(d.market_code).timezone}`
      }
    }
    if (stage.kind === 'lost') {
      // El motivo tiene que ser de los de este embudo: cada tipo de venta tiene su lista (más los que valen para todos).
      const lossReason = loss?.reasonCode
        ? await tx`select 1 from crm.loss_reasons r where r.code = ${loss.reasonCode} and r.kind = 'lost' and r.is_active
                    and (r.market_code is null or r.market_code = ${d.market_code})
                    and (r.motors is null or (select p.motor from crm.pipelines p where p.id = ${d.pipeline_id}) = any(r.motors))`
        : []
      if (!lossReason[0]) throw invalid('Elige el motivo de pérdida.', 'Pick the loss reason.')
      assertNoProhibited(loss?.note)
      await tx`update crm.deals set stage_id = ${toStageId}, status = 'lost', loss_reason_code = ${loss!.reasonCode}, loss_note = ${clean(loss!.note)},
                lost_at = now(), closed_by = 'manual', stage_entered_at = now(), revisit_needed = false where id = ${dealId}`
    } else {
      const missing = missingForStage(d, gate)
      if (missing.length) {
        const es = missing.map((m) => FIELD_LABEL[m]?.es ?? m).join(', ')
        const en = missing.map((m) => FIELD_LABEL[m]?.en ?? m).join(', ')
        // Ganar a mano dice qué falta en lenguaje llano, y la hoja lo deja completar ahí mismo.
        if (stage.kind === 'won') throw new DomainError('stage_gate', ...winMissingText(missing))
        // Cuando lo único que falta es el próximo paso, la pantalla lo puede pedir ahí mismo.
        throw new DomainError(missing.length === 1 && missing[0] === 'next_step' ? 'next_step_required' : 'stage_gate',
          `Para pasar a "${stage.name_es}" falta: ${es}.`, `To move to "${stage.name_en}" you still need: ${en}.`)
      }
      await tx`update crm.deals set stage_id = ${toStageId}, stage_entered_at = now(),
                status = ${stage.kind === 'won' ? 'won' : 'open'}, won_at = ${stage.kind === 'won' ? wonAt : null},
                closed_by = ${stage.kind === 'won' ? 'manual' : null},
                ops_entered_at = ${entering ? tx`now()` : tx`ops_entered_at`} where id = ${dealId}`
    }
    await tx`insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause)
             values (${dealId}, ${d.market_code}, ${d.stage_id}, ${toStageId}, ${ctx.user.id}, 'user')`
    await audit(tx, ctx, 'deal.stage_changed', 'deal', dealId, d.market_code, { stage_id: d.stage_id },
      { stage_id: toStageId, kind: stage.kind, reason: loss?.reasonCode ?? null, ...(stage.kind === 'won' && extra?.wonOn ? { won_on: extra.wonOn } : {}) })
    await emit(tx, 'deal.stage_changed', 'deal', dealId, d.market_code, { from: d.stage_id, to: toStageId, kind: stage.kind })

    if (entering) {
      // Sale de la cancha de quien vende: su próximo paso queda cumplido y el negocio entra a la cola de Operaciones.
      await tx`update crm.activities set done_at = now(), outcome = 'done' where deal_id = ${dealId} and deal_step = 'sales' and done_at is null`
      await audit(tx, ctx, 'deal.handed_to_ops', 'deal', dealId, d.market_code, null, { stage_id: toStageId })
      await syncDealStep(tx, ctx, d, 'ops', (await tx<{ s: string | null }[]>`select ops_next_step as s from crm.deals where id = ${dealId}`)[0]?.s ?? null,
        isoDate((await tx<{ d: string | Date | null }[]>`select ops_next_step_due as d from crm.deals where id = ${dealId}`)[0]?.d ?? null), d.ops_owner_id)
    }
    if (returning && reason) {
      const note = clean(extra?.ret?.note)
      const owner = d.owner_id ? await tx<{ locale: string | null }[]>`select locale from crm.users where id = ${d.owner_id}` : []
      const en = owner[0]?.locale === 'en'
      const why = `${en ? reason.label_en : reason.label_es}${note ? `. ${note}` : ''}`
      const step = (en ? `Operations sent back ${d.title}: ${why}` : `Operaciones devolvió ${d.title}: ${why}`).slice(0, 200)
      const today = (await tx<{ d: string }[]>`select ${marketToday(tx, d.market_code)}::text as d`)[0]!.d
      await tx`update crm.deals set next_step = ${step}, next_step_due = ${today}, ops_next_step = null, ops_next_step_due = null where id = ${dealId}`
      await tx`update crm.activities set done_at = now(), outcome = 'done' where deal_id = ${dealId} and deal_step = 'ops' and done_at is null`
      await syncDealStep(tx, ctx, d, 'sales', step, today, d.owner_id)
      await audit(tx, ctx, 'deal.returned_to_sales', 'deal', dealId, d.market_code, { stage_id: d.stage_id }, { stage_id: toStageId, reason: extra!.ret!.reasonCode, note })
    }
    if (stage.kind === 'won' || stage.kind === 'lost') {
      // Un negocio cerrado no deja nada pendiente: se cierran su próximo paso y las tareas y visitas por hacer que quedaban abiertas.
      // Una visita por hacer que ya no va a pasar queda como tarea cerrada (una visita hecha siempre lleva resultado, y aquí no hubo visita).
      await tx`update crm.activities set kind = case when kind = 'visit' then 'task' else kind end, done_at = now(), outcome = 'done'
                where deal_id = ${dealId} and done_at is null and kind in ('task', 'visit', 'call', 'meeting', 'handoff')`
      await tx`update crm.deals set next_step = null, next_step_due = null, ops_next_step = null, ops_next_step_due = null, revisit_needed = false where id = ${dealId}`
    }
    if (stage.kind === 'won' && d.owner_id && d.owner_id !== ctx.user.id) {
      // Quien vendió se entera en Hoy cuando otra persona (Operaciones) gana su negocio. El aviso va en su idioma.
      const row = await tx<{ locale: string | null; on: string }[]>`
        select (select u.locale from crm.users u where u.id = ${d.owner_id}) as locale,
               (select (x.won_at at time zone ${ctx.market(d.market_code).timezone})::date::text from crm.deals x where x.id = ${dealId}) as on`
      const en = row[0]?.locale === 'en'
      const when = dayLabel(row[0]!.on, en ? 'en' : 'es')
      const body = en ? `${ctx.user.name} marked ${d.title} as won, with close date ${when}.` : `${ctx.user.name} marcó ${d.title} como ganado, con cierre el ${when}.`
      await tx`insert into crm.notices (market_code, user_id, from_user_id, kind, account_id, deal_id, body)
               values (${d.market_code}, ${d.owner_id}, ${ctx.user.id}, 'mention', ${d.account_id}, ${dealId}, ${body.slice(0, 600)})`
    }
  })
}

const createInput = z.object({
  accountId: z.guid(),
  pipelineId: z.guid(),
  title: z.string().trim().min(2).max(160),
  amount: z.number().nonnegative().max(1e12).nullable().optional(),
  nextStep: z.string().trim().min(2).max(200),
  nextStepDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Etapa en la que nace. Vacío es la primera. Tiene que ser una etapa abierta de Ventas del mismo embudo. */
  stageId: z.guid().or(z.literal('')).optional(),
})

export async function createDeal(ctx: Ctx, input: z.input<typeof createInput>): Promise<string> {
  const parsed = createInput.safeParse(input)
  if (!parsed.success) {
    // El error dice qué campo y por qué.
    const field = String(parsed.error.issues[0]?.path[0] ?? '')
    if (field === 'title') throw invalid('Título: escribe entre 2 y 160 letras.', 'Title: enter between 2 and 160 characters.')
    if (field === 'nextStep') throw invalid('Próximo paso: escribe qué sigue (2 a 200 letras). Un negocio nace con próximo paso con fecha.', 'Next step: say what comes next (2 to 200 characters). A deal starts with a dated next step.')
    if (field === 'nextStepDue') throw invalid('Fecha del próximo paso: elige el día.', 'Next step date: pick the day.')
    if (field === 'amount') throw invalid('Monto: escribe un número de cero en adelante, o déjalo vacío.', 'Amount: enter a number, zero or more, or leave it empty.')
    throw invalid('Un negocio nace con título y próximo paso con fecha.', 'A deal starts with a title and a dated next step.')
  }
  const v = parsed.data
  assertNoProhibited(v.title, v.nextStep)
  return withUser(ctx.user.id, async (tx) => {
    const range = await tx<{ ok: boolean }[]>`select ${v.nextStepDue}::date >= ${marketToday(tx, tx`(select market_code from crm.accounts where id = ${v.accountId})`)} as ok`
    if (!range[0]?.ok) throw invalid('La fecha del próximo paso tiene que ser de hoy en adelante.', 'The next step date must be today or later.')
    const accs = await tx<{ market_code: string; owner_id: string | null }[]>`select market_code, owner_id from crm.accounts where id = ${v.accountId} and archived_at is null`
    const acc = accs[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('deal.create', acc.market_code)
    const all = await tx<{ id: string; position: number; kind: StageKind; required_fields: string[]; is_ops: boolean; name_es: string; name_en: string; multi_open: boolean }[]>`
      select s.id, s.position, s.kind, s.required_fields, s.is_ops, s.name_es, s.name_en, p.multi_open from crm.stages s join crm.pipelines p on p.id = s.pipeline_id
      where p.id = ${v.pipelineId} and p.market_code = ${acc.market_code} and s.archived_at is null order by s.position`
    if (!all[0]) throw invalid('Ese embudo no es de este mercado.', 'That pipeline does not belong to this market.')
    const first = v.stageId ? all.find((x) => x.id === v.stageId) : all[0]
    if (!first) throw invalid('Esa etapa no es de este embudo.', 'That stage is not part of this pipeline.')
    // Nace en la etapa que le corresponde, con lo mismo que se pide para llegar ahí. Las etapas de Operaciones no son punto de partida.
    if (first.kind !== 'open' || all.some((x) => x.is_ops && x.position <= first.position)) {
      throw invalid('Un negocio nuevo nace en una etapa de Ventas. A Operaciones llega cuando lo entregas.', 'A new deal starts in a Sales stage. It reaches Operations when you hand it over.')
    }
    const need = [...new Set(all.filter((x) => x.position <= first.position && x.position > all[0]!.position).flatMap((x) => x.required_fields))]
    const missing = missingForStage({ amount_minor: v.amount == null ? null : Math.round(v.amount * 100), next_step: v.nextStep, next_step_due: v.nextStepDue, decision_maker_id: null, decision_maker_met: false, items_count: 0 }, { kind: 'open', required_fields: need })
    if (missing.length) {
      throw new DomainError('stage_gate',
        `Para empezar en "${first.name_es}" falta: ${missing.map((m) => FIELD_LABEL[m]?.es ?? m).join(', ')}. Créalo en una etapa anterior y avánzalo cuando lo tengas.`,
        `To start in "${first.name_en}" you still need: ${missing.map((m) => FIELD_LABEL[m]?.en ?? m).join(', ')}. Create it in an earlier stage and move it once you have that.`)
    }
    // Un comercio lleva un negocio abierto por embudo, salvo en los embudos que admiten varios (pedidos, recompra).
    const open = all[0].multi_open ? [] : await tx`select 1 from crm.deals where account_id = ${v.accountId} and pipeline_id = ${v.pipelineId} and status = 'open'`
    if (open[0]) throw invalid('Este comercio ya tiene un negocio abierto en ese embudo.', 'This merchant already has an open deal in that pipeline.')
    const id = await newId(tx)
    const ownerId = acc.owner_id ?? ctx.user.id
    await tx`insert into crm.deals (id, market_code, pipeline_id, stage_id, account_id, owner_id, title, amount_minor, currency, next_step, next_step_due, created_by)
             values (${id}, ${acc.market_code}, ${v.pipelineId}, ${first.id}, ${v.accountId}, ${ownerId}, ${v.title},
                     ${v.amount == null ? null : Math.round(v.amount * 100)}, ${ctx.market(acc.market_code).currency}, ${v.nextStep}, ${v.nextStepDue}, ${ctx.user.id})`
    await tx`insert into crm.deal_stage_events (deal_id, market_code, to_stage_id, actor_id) values (${id}, ${acc.market_code}, ${first.id}, ${ctx.user.id})`
    await syncDealStep(tx, ctx, { id, market_code: acc.market_code, account_id: v.accountId }, 'sales', v.nextStep, v.nextStepDue, ownerId)
    await audit(tx, ctx, 'deal.created', 'deal', id, acc.market_code, null, { account_id: v.accountId, pipeline_id: v.pipelineId, stage_id: first.id })
    await emit(tx, 'deal.created', 'deal', id, acc.market_code, { account_id: v.accountId })
    return id
  })
}
