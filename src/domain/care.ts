import 'server-only'
import { z } from 'zod'
import { marketToday, marketWorkday, withUser, type Tx } from '@/server/db'
import { systemCtx, type Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { notify } from '@/domain/notify'
import { DomainError, forbidden, invalid, notFound } from '@/lib/errors'
import { isUuid } from '@/lib/ids'
import { whatsappAdapter } from '@/server/adapters/whatsapp'
import { waTemplateFor } from '@/domain/conectores/whatsapp'
import { pullCareSignals, pullTicketCounts } from '@/server/adapters/care'
import { ALERT, ALERT_KINDS, HANDOFF_ROLE, HANDOFF_ROLES, HEALTH_GROUPS, HEALTH_MIN_SAMPLE, PRODUCT_LINES, STAGE, TIERS, defaultChecklist, type AlertKind, type CheckItem, type HandoffRole } from '@/lib/care'

/**
 * Cuidado del comercio después de la venta (CS-01 a CS-04). Aquí viven las reglas: el ciclo de vida completo con su historial,
 * las entregas con dueño, fecha, lista y acuse, las alertas que crean tarea con guía de acción, el puntaje de salud y el
 * modelo de atención. Lo que corre por horario está en server/jobs/ciclo-cs.ts y llama a estas mismas funciones.
 */
type Actor = { user: { id: string } }
type Account = { id: string; market_code: string; name: string; owner_id: string | null; kind: string; lifecycle: string }

async function loadAccount(tx: Tx, id: string): Promise<Account> {
  if (!isUuid(id)) throw notFound()
  const rows = await tx<Account[]>`select id, market_code, name, owner_id, kind, lifecycle from crm.accounts where id = ${id} and archived_at is null`
  if (!rows[0]) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
  return rows[0]
}

async function personIn(tx: Tx, market: string, userId: string): Promise<{ id: string; full_name: string; locale: string }> {
  const rows = isUuid(userId)
    ? await tx<{ id: string; full_name: string; locale: string }[]>`
        select u.id, u.full_name, u.locale from crm.users u where u.id = ${userId} and u.is_active and not u.is_system
           and u.id in (select user_id from app.people_with_role(${market}, array['ops','rep','supervisor','market_lead']))`
    : []
  if (!rows[0]) throw invalid('Elige a una persona que trabaje en ese mercado.', 'Pick someone who works in that market.')
  return rows[0]
}

const dueAt = (tx: Tx, market: string, plusDays: number) => tx`((${marketWorkday(tx, market, plusDays)} + time '15:00') at time zone 'UTC')`

// ================================================================ CS-01 · ciclo de vida
const windowInput = z.object({
  riskBelow: z.coerce.number().int().min(1).max(20),
  recoverAt: z.coerce.number().int().min(2).max(25),
  habitAt: z.coerce.number().int().min(5).max(31),
  habitBelow: z.coerce.number().int().min(3).max(30),
  churnAfterDays: z.coerce.number().int().min(31).max(365),
  minDaysInStage: z.coerce.number().int().min(0).max(30),
})

/** Ventana de un mercado para una línea de producto. Salir de riesgo pide más días que entrar: así un día bueno no saca a nadie. */
export async function setLifecycleWindow(ctx: Ctx, market: string, line: string, raw: z.input<typeof windowInput>, from: 'manual' | 'backtest' = 'manual', sample: number | null = null): Promise<void> {
  ctx.assert('care.manage', market)
  ctx.market(market)
  if (!(PRODUCT_LINES as readonly string[]).includes(line)) throw invalid('Esa línea de producto no existe.', 'That product line does not exist.')
  const p = windowInput.safeParse(raw)
  if (!p.success) throw invalid('Revisa los días: todos son números enteros dentro de su rango.', 'Check the days: they are all whole numbers within range.')
  const v = p.data
  if (!(v.recoverAt > v.riskBelow)) throw invalid('Para salir de riesgo se piden más días con venta que para entrar. Así un día bueno no cambia la etapa.', 'Leaving at-risk must ask for more selling days than entering it. That way one good day does not change the stage.')
  if (!(v.habitBelow >= v.recoverAt && v.habitAt > v.habitBelow)) throw invalid('El hábito se alcanza con más días de los que lo sostienen, y sostenerlo pide al menos los días de salir de riesgo.', 'Reaching the habit takes more days than keeping it, and keeping it takes at least the days to leave at-risk.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<Record<string, unknown>[]>`select risk_below, recover_at, habit_at, habit_below, churn_after_days, min_days_in_stage from crm.lifecycle_windows where market_code = ${market} and product_line = ${line} for update`
    await tx`insert into crm.lifecycle_windows (market_code, product_line, risk_below, recover_at, habit_at, habit_below, churn_after_days, min_days_in_stage, calibrated_from, sample, updated_by)
             values (${market}, ${line}, ${v.riskBelow}, ${v.recoverAt}, ${v.habitAt}, ${v.habitBelow}, ${v.churnAfterDays}, ${v.minDaysInStage}, ${from}, ${sample}, ${ctx.user.id})
             on conflict (market_code, product_line) do update set risk_below = excluded.risk_below, recover_at = excluded.recover_at, habit_at = excluded.habit_at,
               habit_below = excluded.habit_below, churn_after_days = excluded.churn_after_days, min_days_in_stage = excluded.min_days_in_stage,
               calibrated_from = excluded.calibrated_from, sample = excluded.sample, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'care.window_set', 'market', null, market, before[0] ?? null, { product_line: line, risk_below: v.riskBelow, recover_at: v.recoverAt, habit_at: v.habitAt, habit_below: v.habitBelow, churn_after_days: v.churnAfterDays, min_days_in_stage: v.minDaysInStage, calibrated_from: from })
  })
}

export type BacktestRow = { threshold: number; sample: number; positives: number; hit_precision: string | null; hit_recall: string | null }
/** Con los datos propios del mercado: el umbral de entrada a riesgo que mejor anticipó a los comercios que dejaron de vender. */
export async function lifecycleBacktest(ctx: Ctx, market: string, line: string): Promise<{ rows: BacktestRow[]; best: BacktestRow | null }> {
  ctx.assert('care.manage', market)
  const rows = await withUser(ctx.user.id, (tx) => tx<BacktestRow[]>`select * from app.lifecycle_backtest(${market}, ${line})`)
  const f1 = (r: BacktestRow) => {
    const p = Number(r.hit_precision ?? 0), c = Number(r.hit_recall ?? 0)
    return p + c > 0 ? (2 * p * c) / (p + c) : 0
  }
  const best = rows.length ? [...rows].sort((a, b) => f1(b) - f1(a) || a.threshold - b.threshold)[0]! : null
  return { rows: [...rows], best: best && f1(best) > 0 ? best : null }
}

/** La línea de producto principal del comercio decide qué ventana le toca. */
export async function setProductLine(ctx: Ctx, accountId: string, line: string): Promise<void> {
  if (!(PRODUCT_LINES as readonly string[]).includes(line)) throw invalid('Esa línea de producto no existe.', 'That product line does not exist.')
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, accountId)
    ctx.assert('account.edit', a.market_code)
    const prev = await tx<{ product_line: string }[]>`select product_line from crm.account_care where account_id = ${a.id} for update`
    if (prev[0]?.product_line === line) return
    await tx`insert into crm.account_care (account_id, market_code, stage, product_line) values (${a.id}, ${a.market_code}, ${a.lifecycle}, ${line})
             on conflict (account_id) do update set product_line = excluded.product_line, updated_at = now()`
    await audit(tx, ctx, 'care.product_line_set', 'account', a.id, a.market_code, { product_line: prev[0]?.product_line ?? 'general' }, { product_line: line })
  })
}

/** Recalcula las etapas del mercado ahora, con las mismas reglas que la tarea diaria. */
export async function runLifecycleNow(ctx: Ctx, market: string): Promise<number> {
  ctx.assert('care.manage', market)
  ctx.market(market)
  const sys = await systemCtx()
  const moved = (await withUser(sys.user.id, (tx) => tx<{ n: number }[]>`select app.lifecycle_recalc(${market}, null) as n`))[0]?.n ?? 0
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'care.lifecycle_run', 'market', null, market, null, { moved }))
  return moved
}

/** Una persona marca al comercio como perdido (cerró, se fue con otro) o lo regresa a inactivo. Queda en el historial con su motivo. */
export async function setStageByHand(ctx: Ctx, accountId: string, stage: 'churned' | 'inactive', reason: string): Promise<void> {
  const why = reason.trim().slice(0, 200)
  if (why.length < 3) throw invalid('Escribe el motivo.', 'Enter the reason.')
  assertNoProhibited(why)
  await withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, accountId)
    ctx.assert('care.stage', a.market_code)
    if (a.lifecycle === stage) return
    if (stage === 'inactive' && a.lifecycle !== 'churned') throw invalid('Solo un comercio perdido se regresa a inactivo.', 'Only a lost merchant goes back to inactive.')
    if (stage === 'churned' && (a.lifecycle === 'prospect' || a.lifecycle === 'onboarding')) throw invalid('Un comercio que todavía no vende no se marca como perdido: cierra su negocio con el motivo.', 'A merchant that is not selling yet is not marked as lost: close its deal with the reason.')
    await tx`select set_config('app.lifecycle_stage', ${stage}, true), set_config('app.lifecycle_source', 'manual', true), set_config('app.lifecycle_reason', ${why}, true)`
    await tx`update crm.accounts set lifecycle = ${stage} where id = ${a.id}`
    await tx`select set_config('app.lifecycle_stage', '', true), set_config('app.lifecycle_source', '', true), set_config('app.lifecycle_reason', '', true)`
    await audit(tx, ctx, 'care.stage_set', 'account', a.id, a.market_code, { stage: a.lifecycle }, { stage })
  })
}

// ---------------------------------------------------------------- entregas
const handoffInput = z.object({
  accountId: z.string(),
  toRole: z.enum(HANDOFF_ROLES),
  toUserId: z.string(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional().default(''),
  dealId: z.string().optional(),
})

/** El tramo desde el que entrega una persona: Operaciones entrega como Operaciones; quien cuida la cuenta, desde su papel; los demás, como Ventas. */
async function fromRoleOf(tx: Tx, ctx: Ctx, a: Account): Promise<HandoffRole> {
  const care = await tx<{ care_owner_id: string | null; care_role: HandoffRole | null }[]>`select care_owner_id, care_role from crm.account_care where account_id = ${a.id}`
  if (care[0]?.care_owner_id === ctx.user.id && care[0].care_role) return care[0].care_role
  const roles = ctx.memberships.filter((m) => m.market === null || m.market === a.market_code).map((m) => m.role)
  return roles.includes('ops') && !roles.includes('rep') ? 'ops' : 'sales'
}

/**
 * Entrega de un comercio de un equipo a otro. No es una reasignación: quien vendió sigue siendo quien lo originó y el dueño
 * de ventas no cambia. La entrega nace con quién recibe, para cuándo y la lista de lo que se entrega; se cierra con el acuse.
 */
export async function createHandoff(ctx: Ctx, raw: z.input<typeof handoffInput>): Promise<string> {
  const p = handoffInput.safeParse(raw)
  if (!p.success) throw invalid('Elige a quién se entrega, en qué papel y para cuándo.', 'Choose who receives it, in which role and by when.')
  const v = p.data
  assertNoProhibited(v.note)
  return withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, v.accountId)
    ctx.assert('handoff.create', a.market_code)
    const from = await fromRoleOf(tx, ctx, a)
    if (from === v.toRole) throw invalid('La entrega va a otro equipo, no al mismo.', 'A handoff goes to another team, not the same one.')
    const to = await personIn(tx, a.market_code, v.toUserId)
    if (to.id === ctx.user.id) throw invalid('No te puedes entregar el comercio a ti.', 'You cannot hand the merchant off to yourself.')
    const ok = await tx<{ ok: boolean }[]>`select ${v.dueOn}::date >= ${marketToday(tx, a.market_code)} as ok`
    if (!ok[0]?.ok) throw invalid('La fecha de la entrega es de hoy en adelante.', 'The handoff date is today or later.')
    const open = await tx`select 1 from crm.handoffs where account_id = ${a.id} and from_role = ${from} and to_role = ${v.toRole} and status = 'pending'`
    if (open[0]) throw new DomainError('conflict', 'Ya hay una entrega de ese tramo esperando acuse.', 'There is already a handoff for that leg waiting to be acknowledged.', 409)
    const en = to.locale === 'en'
    const subject = (en ? `Handoff from ${HANDOFF_ROLE[from][1]}: ${a.name}` : `Entrega de ${HANDOFF_ROLE[from][0]}: ${a.name}`).slice(0, 200)
    const act = await tx<{ id: string }[]>`
      insert into crm.activities (market_code, account_id, deal_id, kind, subject, body, due_at, owner_id, created_by, source)
      values (${a.market_code}, ${a.id}, ${v.dealId && isUuid(v.dealId) ? v.dealId : null}, 'handoff', ${subject}, ${clean(v.note)},
              ((${v.dueOn}::date + time '15:00') at time zone 'UTC'), ${to.id}, ${ctx.user.id}, 'user') returning id`
    const rows = await tx<{ id: string }[]>`
      insert into crm.handoffs (account_id, market_code, deal_id, from_role, to_role, from_user_id, to_user_id, due_on, checklist, note, activity_id, created_by)
      values (${a.id}, ${a.market_code}, ${v.dealId && isUuid(v.dealId) ? v.dealId : null}, ${from}, ${v.toRole}, ${ctx.user.id}, ${to.id}, ${v.dueOn},
              ${tx.json(defaultChecklist(v.toRole) as never)}, ${clean(v.note)}, ${act[0]!.id}, ${ctx.user.id}) returning id`
    await notify(tx, ctx, {
      to: to.id, kind: 'handoff', market: a.market_code, link: `/comercios/${a.id}/cuidado`, accountId: a.id, needsAction: true,
      title: [`Te entregan ${a.name}`, `${a.name} is being handed to you`],
      body: [`${ctx.user.name} te lo entrega como ${HANDOFF_ROLE[v.toRole][0]}, para el ${v.dueOn}. Revisa la lista y da el acuse.`, `${ctx.user.name} hands it to you as ${HANDOFF_ROLE[v.toRole][1]}, due ${v.dueOn}. Check the list and acknowledge it.`],
    })
    await audit(tx, ctx, 'care.handoff_created', 'account', a.id, a.market_code, null, { handoff_id: rows[0]!.id, from_role: from, to_role: v.toRole, to_user_id: to.id, due_on: v.dueOn })
    return rows[0]!.id
  })
}

type Handoff = { id: string; account_id: string; market_code: string; from_role: HandoffRole; to_role: HandoffRole; from_user_id: string | null; to_user_id: string; status: string; checklist: CheckItem[]; activity_id: string | null }
async function loadHandoff(tx: Tx, id: string): Promise<Handoff> {
  if (!isUuid(id)) throw notFound()
  const rows = await tx<Handoff[]>`select id, account_id, market_code, from_role, to_role, from_user_id, to_user_id, status, checklist, activity_id from crm.handoffs where id = ${id} for update`
  if (!rows[0]) throw notFound('No encontramos esa entrega.', 'We could not find that handoff.')
  return rows[0]
}

/** Marca un punto de la lista. Lo hace quien entrega o quien recibe, mientras la entrega espera acuse. */
export async function checkHandoffItem(ctx: Ctx, id: string, code: string, done: boolean): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const h = await loadHandoff(tx, id)
    ctx.assert('handoff.create', h.market_code)
    if (h.status !== 'pending') throw invalid('Esa entrega ya tiene acuse.', 'That handoff was already acknowledged.')
    if (![h.from_user_id, h.to_user_id].includes(ctx.user.id) && !ctx.can('care.manage', h.market_code)) throw forbidden()
    if (!h.checklist.some((c) => c.code === code)) throw invalid('Ese punto no está en la lista.', 'That item is not on the list.')
    const next = h.checklist.map((c) => (c.code === code ? { ...c, done } : c))
    await tx`update crm.handoffs set checklist = ${tx.json(next as never)} where id = ${id}`
    await audit(tx, ctx, 'care.handoff_checked', 'account', h.account_id, h.market_code, null, { handoff_id: id, item: code, done })
  })
}

/**
 * Acuse: quien recibe dice "recibido" y desde ese momento cuida el comercio, o lo devuelve con motivo. Con puntos sin marcar
 * se puede recibir solo si se dice qué falta. El dueño de ventas y la atribución de origen no cambian.
 */
export async function ackHandoff(ctx: Ctx, id: string, input: { accept: boolean; note?: string }): Promise<void> {
  const note = (input.note ?? '').trim().slice(0, 500)
  assertNoProhibited(note)
  await withUser(ctx.user.id, async (tx) => {
    const h = await loadHandoff(tx, id)
    ctx.assert('handoff.create', h.market_code)
    if (h.to_user_id !== ctx.user.id && !ctx.can('care.manage', h.market_code)) throw new DomainError('forbidden', 'El acuse lo da quien recibe la entrega.', 'The person receiving the handoff acknowledges it.', 403)
    if (h.status !== 'pending') throw invalid('Esa entrega ya tiene acuse.', 'That handoff was already acknowledged.')
    const missing = h.checklist.filter((c) => !c.done)
    if (!input.accept && note.length < 3) throw invalid('Para devolverla, escribe el motivo.', 'To send it back, enter the reason.')
    if (input.accept && missing.length > 0 && note.length < 3) throw invalid(`Faltan ${missing.length} puntos de la lista. Márcalos, o escribe qué falta y recíbela así.`, `${missing.length} items on the list are not done. Tick them, or write what is missing and accept it as is.`)
    await tx`update crm.handoffs set status = ${input.accept ? 'acknowledged' : 'returned'}, ack_at = now(), ack_by = ${ctx.user.id}, ack_note = ${note || null} where id = ${id}`
    if (h.activity_id) await tx`update crm.activities set done_at = now() where id = ${h.activity_id} and done_at is null`
    const acc = await loadAccount(tx, h.account_id)
    if (input.accept && h.to_role !== 'sales') {
      await tx`insert into crm.account_care (account_id, market_code, stage, care_owner_id, care_role) values (${h.account_id}, ${h.market_code}, ${acc.lifecycle}, ${h.to_user_id}, ${h.to_role})
               on conflict (account_id) do update set care_owner_id = excluded.care_owner_id, care_role = excluded.care_role, updated_at = now()`
    }
    if (h.from_user_id && h.from_user_id !== ctx.user.id) {
      await notify(tx, ctx, {
        to: h.from_user_id, kind: 'handoff', market: h.market_code, link: `/comercios/${h.account_id}/cuidado`, accountId: h.account_id, needsAction: !input.accept,
        title: input.accept ? [`${acc.name}: entrega recibida`, `${acc.name}: handoff acknowledged`] : [`${acc.name}: te devolvieron la entrega`, `${acc.name}: the handoff was sent back`],
        body: input.accept ? [`${ctx.user.name} ya lo cuida.${note ? ` Nota: ${note}` : ''}`, `${ctx.user.name} now looks after it.${note ? ` Note: ${note}` : ''}`] : [`Motivo: ${note}`, `Reason: ${note}`],
      })
    }
    await audit(tx, ctx, input.accept ? 'care.handoff_acknowledged' : 'care.handoff_returned', 'account', h.account_id, h.market_code, null, { handoff_id: id, to_role: h.to_role, missing: missing.length })
  })
}

/**
 * La entrega de Ventas a Operaciones nace sola cuando el negocio se gana con la primera transacción (la llama la carga del
 * archivo de ventas). Va a la misma persona que ya recibía la tarea de bienvenida.
 */
export async function openSalesToOpsHandoffs(tx: Tx, sys: Actor, dealIds: string[]): Promise<number> {
  if (dealIds.length === 0) return 0
  const rows = await tx`
    insert into crm.handoffs (account_id, market_code, deal_id, from_role, to_role, from_user_id, to_user_id, due_on, checklist, activity_id, source, created_by)
    select d.account_id, d.market_code, d.id, 'sales', 'ops', d.owner_id, act.owner_id, (act.due_at at time zone mk.timezone)::date, ${tx.json(defaultChecklist('ops') as never)}, act.id, 'rule', ${sys.user.id}
      from crm.deals d join crm.markets mk on mk.code = d.market_code
      join lateral (select a.id, a.owner_id, a.due_at from crm.activities a where a.deal_id = d.id and a.kind = 'handoff' and a.done_at is null and a.owner_id is not null order by a.created_at desc limit 1) act on true
     where d.id = any(${dealIds}::uuid[]) and act.owner_id is distinct from d.owner_id
    on conflict do nothing returning 1`
  return rows.length
}

// ================================================================ CS-03 · alertas y guías de acción
const settingsInput = z.object({
  alertsOn: z.boolean(),
  ownRulesOn: z.boolean(),
  noFirstSaleDays: z.coerce.number().int().min(1).max(60),
  dropPct: z.coerce.number().int().min(10).max(90),
  lowBalance: z.union([z.literal(''), z.coerce.number().min(0).max(1e9)]),
  holdoutPct: z.coerce.number().int().min(0).max(50),
  escalateDays: z.coerce.number().int().min(1).max(30),
  whatsappCap: z.coerce.number().int().min(0).max(500),
})

/** Los números de las alertas son del mercado: cuántos días sin primera venta, cuánta caída, qué saldo es bajo y qué parte queda como grupo de control. */
export async function saveCareSettings(ctx: Ctx, market: string, raw: z.input<typeof settingsInput>): Promise<void> {
  ctx.assert('care.manage', market)
  ctx.market(market)
  const p = settingsInput.safeParse(raw)
  if (!p.success) throw invalid('Revisa los números: cada uno tiene su rango.', 'Check the numbers: each has its range.')
  const v = p.data
  const low = v.lowBalance === '' ? null : Math.round(Number(v.lowBalance) * 100)
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<Record<string, unknown>[]>`select alerts_on, own_rules_on, no_first_sale_days, drop_pct, low_balance_minor::text, holdout_pct, escalate_days, whatsapp_cap_per_owner from crm.cs_settings where market_code = ${market} for update`
    await tx`insert into crm.cs_settings (market_code, alerts_on, own_rules_on, no_first_sale_days, drop_pct, low_balance_minor, holdout_pct, escalate_days, whatsapp_cap_per_owner, updated_by)
             values (${market}, ${v.alertsOn}, ${v.ownRulesOn}, ${v.noFirstSaleDays}, ${v.dropPct}, ${low}, ${v.holdoutPct}, ${v.escalateDays}, ${v.whatsappCap}, ${ctx.user.id})
             on conflict (market_code) do update set alerts_on = excluded.alerts_on, own_rules_on = excluded.own_rules_on, no_first_sale_days = excluded.no_first_sale_days,
               drop_pct = excluded.drop_pct, low_balance_minor = excluded.low_balance_minor, holdout_pct = excluded.holdout_pct, escalate_days = excluded.escalate_days,
               whatsapp_cap_per_owner = excluded.whatsapp_cap_per_owner, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'care.settings_saved', 'market', null, market, before[0] ?? null, { alerts_on: v.alertsOn, own_rules_on: v.ownRulesOn, no_first_sale_days: v.noFirstSaleDays, drop_pct: v.dropPct, low_balance_minor: low, holdout_pct: v.holdoutPct, escalate_days: v.escalateDays, whatsapp_cap_per_owner: v.whatsappCap })
  })
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const playbookInput = z.object({
  market: z.string().length(2).or(z.literal('')),
  kind: z.enum(ALERT_KINDS),
  tier: z.enum(['any', ...TIERS]),
  titleEs: z.string().trim().min(3).max(120),
  titleEn: z.string().trim().min(3).max(120),
  stepsEs: z.string().transform(lines).pipe(z.array(z.string().max(300)).min(1).max(8)),
  stepsEn: z.string().transform(lines).pipe(z.array(z.string().max(300)).min(1).max(8)),
  messageEs: z.string().trim().max(600).optional().default(''),
  messageEn: z.string().trim().max(600).optional().default(''),
  dueDays: z.coerce.number().int().min(0).max(14),
  isActive: z.boolean(),
})

/** Guía de acción por tipo de alerta y modelo de atención. La general (sin mercado) la cambia administración; la de un mercado, quien lo lidera. */
export async function savePlaybook(ctx: Ctx, raw: z.input<typeof playbookInput>): Promise<void> {
  const p = playbookInput.safeParse(raw)
  if (!p.success) throw invalid('La guía lleva título y de uno a ocho pasos, uno por renglón, en español y en inglés.', 'A playbook has a title and one to eight steps, one per line, in Spanish and in English.')
  const v = p.data
  const market = v.market || null
  if (market) { ctx.assert('care.manage', market); ctx.market(market) } else if (!ctx.isAdmin) throw forbidden()
  assertNoProhibited(v.titleEs, v.titleEn, ...v.stepsEs, ...v.stepsEn, v.messageEs, v.messageEn)
  if (Boolean(v.messageEs) !== Boolean(v.messageEn)) throw invalid('El mensaje al comercio va en los dos idiomas, o en ninguno.', 'The message to the merchant goes in both languages, or in neither.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ id: string; title_es: string; is_active: boolean }[]>`select id, title_es, is_active from crm.playbooks where coalesce(market_code, '') = ${market ?? ''} and alert_kind = ${v.kind} and tier = ${v.tier} for update`
    if (before[0]) {
      await tx`update crm.playbooks set title_es = ${v.titleEs}, title_en = ${v.titleEn}, steps_es = ${v.stepsEs}, steps_en = ${v.stepsEn}, message_es = ${v.messageEs || null}, message_en = ${v.messageEn || null},
                 due_days = ${v.dueDays}, is_active = ${v.isActive}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${before[0].id}`
    } else {
      await tx`insert into crm.playbooks (market_code, alert_kind, tier, title_es, title_en, steps_es, steps_en, message_es, message_en, due_days, is_active, updated_by)
               values (${market}, ${v.kind}, ${v.tier}, ${v.titleEs}, ${v.titleEn}, ${v.stepsEs}, ${v.stepsEn}, ${v.messageEs || null}, ${v.messageEn || null}, ${v.dueDays}, ${v.isActive}, ${ctx.user.id})`
    }
    await audit(tx, ctx, 'care.playbook_saved', 'market', null, market, before[0] ? { title: before[0].title_es, is_active: before[0].is_active } : null, { alert_kind: v.kind, tier: v.tier, title: v.titleEs, steps: v.stepsEs.length, is_active: v.isActive })
  })
}

type Candidate = { account_id: string; market_code: string; name: string; kind: AlertKind; owner_id: string | null; care_owner_id: string | null; tier: string | null; consent: boolean; wa_phone: string | null; detail: Record<string, unknown>; holdout: boolean; locale: string; escalate_days: number; cap: number }
type Playbook = { id: string; title_es: string; title_en: string; steps_es: string[]; steps_en: string[]; message_es: string | null; message_en: string | null; due_days: number }

async function playbookFor(tx: Tx, market: string, kind: AlertKind, tier: string | null): Promise<Playbook | null> {
  const rows = await tx<Playbook[]>`
    select id, title_es, title_en, steps_es, steps_en, message_es, message_en, due_days from crm.playbooks
     where alert_kind = ${kind} and is_active and (market_code is null or market_code = ${market}) and tier in ('any', ${tier ?? 'any'})
     order by (market_code is not null) desc, (tier <> 'any') desc limit 1`
  return rows[0] ?? null
}

/** Dueño según el modelo de atención: dedicada y en equipo van a quien cuida la cuenta (o a Operaciones del mercado); ligera y digital, a quien lleva el comercio. */
async function alertOwner(tx: Tx, c: Candidate): Promise<string | null> {
  if (c.care_owner_id) return c.care_owner_id
  if (c.tier === 'pooled' || c.tier === 'high') {
    const ops = await tx<{ user_id: string }[]>`select m.user_id from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active
       where m.market_code = ${c.market_code} and m.role = 'ops' and (m.valid_to is null or m.valid_to > now()) order by m.created_at limit 1`
    return c.owner_id ?? ops[0]?.user_id ?? null
  }
  return c.owner_id
}

async function taskFor(tx: Tx, actor: Actor, c: Candidate, pb: Playbook | null, owner: string): Promise<string> {
  const en = (await tx<{ locale: string }[]>`select locale from crm.users where id = ${owner}`)[0]?.locale === 'en'
  const title = pb ? (en ? pb.title_en : pb.title_es) : (en ? ALERT[c.kind].label[1] : ALERT[c.kind].label[0])
  const steps = pb ? (en ? pb.steps_en : pb.steps_es) : []
  const body = steps.map((s, i) => `${i + 1}. ${s}`).join('\n') || null
  const rows = await tx<{ id: string }[]>`
    insert into crm.activities (market_code, account_id, kind, subject, body, due_at, owner_id, created_by, source)
    values (${c.market_code}, ${c.account_id}, 'task', ${`${title}: ${c.name}`.slice(0, 200)}, ${body}, ${dueAt(tx, c.market_code, pb?.due_days ?? 2)}, ${owner}, ${actor.user.id}, 'rule') returning id`
  return rows[0]!.id
}

/**
 * Evalúa las alertas (todas, un mercado o un comercio). En los mercados con las alertas encendidas:
 * cierra las que ya no aplican, mide si el comercio volvió a vender a 14 y 30 días, abre las nuevas con su tarea y su guía,
 * y pasa a una persona las que iban solo por mensaje y siguen abiertas. El grupo de control queda anotado y sin tarea.
 */
export async function runAlerts(tx: Tx, actor: Actor, scope: { market?: string; accountId?: string } = {}): Promise<{ opened: number; closed: number; tasks: number; messages: number }> {
  const mk = scope.market ?? null
  const acc = scope.accountId ?? null
  // 1) las que ya no aplican se cierran solas, con su tarea
  const closed = await tx<{ activity_id: string | null }[]>`
    update crm.cs_alerts al set status = 'closed', closed_at = now(), close_reason = 'recovered'
      from crm.accounts a
     where a.id = al.account_id and al.status = 'open' and (${mk}::text is null or al.market_code = ${mk}) and (${acc}::uuid is null or al.account_id = ${acc})
       and case al.kind
             when 'no_first_sale' then a.lifecycle <> 'onboarding'
             when 'inactive' then a.lifecycle <> 'inactive'
             when 'drop_vs_baseline' then a.lifecycle in ('inactive','churned') or exists (
               select 1 from crm.merchant_metrics_daily m where m.account_id = a.id and m.as_of > (al.opened_at)::date and m.txn_count_30d >= coalesce((al.detail ->> 'baseline')::numeric, 0) * 0.8)
             when 'low_balance' then exists (select 1 from crm.account_balance_latest s join crm.cs_settings st on st.market_code = a.market_code
                                              where s.account_id = a.id and s.as_of > (al.opened_at)::date and s.balance_minor >= coalesce(st.low_balance_minor, 0))
             when 'manager_change' then not exists (select 1 from crm.manager_changes mc where mc.account_id = a.id and mc.trained_at is null)
           end
    returning al.activity_id`
  const closedTasks = closed.map((c) => c.activity_id).filter((x): x is string => !!x)
  if (closedTasks.length) await tx`update crm.activities set done_at = now() where id = any(${closedTasks}::uuid[]) and done_at is null`

  // 2) medición: ¿volvió a vender después de la alerta? Se anota a los 14 y a los 30 días, también para el grupo de control.
  await tx`update crm.cs_alerts al set returned_14d = exists (select 1 from crm.merchant_metrics_daily m where m.account_id = al.account_id and m.last_txn_at > al.opened_at and m.last_txn_at <= al.opened_at + interval '14 days')
            where al.returned_14d is null and al.opened_at <= now() - interval '14 days' and (${mk}::text is null or al.market_code = ${mk})`
  await tx`update crm.cs_alerts al set returned_30d = exists (select 1 from crm.merchant_metrics_daily m where m.account_id = al.account_id and m.last_txn_at > al.opened_at and m.last_txn_at <= al.opened_at + interval '30 days')
            where al.returned_30d is null and al.opened_at <= now() - interval '30 days' and (${mk}::text is null or al.market_code = ${mk})`

  // 3) nuevas
  const cands = await tx<Candidate[]>`
    with a as (
      select a.id, a.market_code, a.name, a.owner_id, a.lifecycle, a.lifecycle_at, c.care_owner_id, c.service_tier as tier, (wa.phone is not null) as consent, wa.phone as wa_phone,
             st.no_first_sale_days, st.drop_pct, st.low_balance_minor, st.holdout_pct, st.escalate_days, st.whatsapp_cap_per_owner as cap, mkt.default_locale as locale
        from crm.accounts a
        join crm.cs_settings st on st.market_code = a.market_code and st.alerts_on
        join crm.markets mkt on mkt.code = a.market_code
        left join crm.account_care c on c.account_id = a.id
        -- Permiso para mensajes: un contacto vigente del comercio con teléfono, con consentimiento de WhatsApp sin retirar y sin baja
        -- (el registro único de consentimientos y bajas es el de Seguridad: crm.consents y app.may_contact).
        left join lateral (
          select ct.phone from crm.account_contacts ac join crm.contacts ct on ct.id = ac.contact_id
           where ac.account_id = a.id and (ac.valid_to is null or ac.valid_to > now()) and ct.phone is not null
             and exists (select 1 from crm.consents cs where cs.contact_id = ct.id and cs.channel = 'whatsapp' and cs.revoked_at is null)
             and (select mc.ok from app.may_contact('whatsapp', ct.phone, 'service') mc)
           order by (ac.role = 'manager') desc, ac.valid_from desc limit 1) wa on true
       where a.archived_at is null and a.merged_into is null and (${mk}::text is null or a.market_code = ${mk}) and (${acc}::uuid is null or a.id = ${acc})
    ), hit as (
      select a.*, 'no_first_sale'::text as kind, jsonb_build_object('days', extract(day from now() - a.lifecycle_at)::int, 'limit', a.no_first_sale_days) as detail
        from a where a.lifecycle = 'onboarding' and a.lifecycle_at <= now() - make_interval(days => a.no_first_sale_days)
      union all
      select a.*, 'inactive', jsonb_build_object('since', a.lifecycle_at::date) from a where a.lifecycle = 'inactive'
      union all
      select a.*, 'drop_vs_baseline', jsonb_build_object('baseline', round(b.baseline, 1), 'now', m.txn_count_30d, 'as_of', m.as_of, 'drop_pct', a.drop_pct)
        from a
        join lateral (select x.* from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
        join lateral (select avg(h.txn_count_30d)::numeric as baseline from crm.merchant_metrics_daily h where h.account_id = a.id and h.as_of between m.as_of - 120 and m.as_of - 28) b on true
       where a.lifecycle in ('active','at_risk') and b.baseline >= 5 and m.txn_count_30d < b.baseline * (100 - a.drop_pct) / 100.0
      union all
      select a.*, 'low_balance', jsonb_build_object('balance_minor', s.balance_minor, 'limit_minor', a.low_balance_minor, 'as_of', s.as_of)
        -- un solo saldo: el más reciente entre fondeo (CANAL-07) y señales de cuidado
        from a join crm.account_balance_latest s on s.account_id = a.id
       where a.low_balance_minor is not null and a.lifecycle in ('active','at_risk') and s.balance_minor < a.low_balance_minor and s.as_of >= (now() - interval '7 days')::date
      union all
      select a.*, 'manager_change', jsonb_build_object('changed_on', mc.changed_on, 'new_name', mc.new_name)
        from a join lateral (select x.* from crm.manager_changes x where x.account_id = a.id and x.trained_at is null and x.changed_on >= (now() - interval '60 days')::date order by x.changed_on desc limit 1) mc on true
    )
    select h.id as account_id, h.market_code, h.name, h.kind, h.owner_id, h.care_owner_id, h.tier, h.consent, h.wa_phone, h.detail, app.in_holdout(h.id, h.holdout_pct) as holdout, h.locale, h.escalate_days, h.cap
      from hit h
     where not exists (select 1 from crm.cs_alerts x where x.account_id = h.id and x.kind = h.kind
                        and (x.status = 'open' or (x.close_reason in ('done','dismissed') and x.closed_at > now() - interval '14 days')))
     order by h.market_code, h.id`
  const wa = whatsappAdapter()
  let tasks = 0, messages = 0, opened = 0
  for (const c of cands) {
    const pb = await playbookFor(tx, c.market_code, c.kind, c.tier)
    const owner = await alertOwner(tx, c)
    const text = pb ? (c.locale === 'en' ? pb.message_en : pb.message_es) : null
    // Digital primero: solo cuando el canal está encendido, el comercio dio permiso y su modelo de atención es ligero o digital.
    const digitalOnly = !c.holdout && wa.mode !== 'off' && c.consent && !!text && (c.tier === 'low' || c.tier === 'tech')
    const ins = await tx<{ id: string }[]>`
      insert into crm.cs_alerts (account_id, market_code, kind, owner_id, playbook_id, in_holdout, digital_only, detail)
      values (${c.account_id}, ${c.market_code}, ${c.kind}, ${owner}, ${pb?.id ?? null}, ${c.holdout}, ${digitalOnly}, ${tx.json(c.detail as never)})
      on conflict do nothing returning id`
    if (!ins[0]) continue
    opened++
    if (c.holdout) continue
    if (text) {
      const body = text.replaceAll('{comercio}', c.name).slice(0, 600)
      let status: string
      if (!c.consent) status = 'skipped_consent'
      else {
        const today = await tx<{ n: number }[]>`select count(*)::int as n from crm.cs_messages m join crm.cs_alerts x on x.id = m.alert_id
           where x.owner_id is not distinct from ${owner} and m.market_code = ${c.market_code} and m.status in ('queued_off','simulated','sent') and m.created_at > now() - interval '24 hours'`
        status = (today[0]?.n ?? 0) >= c.cap ? 'held_limit' : (await wa.send({ to: c.wa_phone ?? '', subject: ALERT[c.kind].label[0], body, ...(await waTemplateFor(tx, c.market_code, `cs_${c.kind}`, c.locale, [c.name])) })).status
      }
      await tx`insert into crm.cs_messages (alert_id, account_id, market_code, body, status) values (${ins[0].id}, ${c.account_id}, ${c.market_code}, ${body}, ${status})`
      messages++
    }
    if (!digitalOnly && owner) {
      const taskId = await taskFor(tx, actor, c, pb, owner)
      await tx`update crm.cs_alerts set activity_id = ${taskId} where id = ${ins[0].id}`
      tasks++
    }
  }
  // 4) humano por excepción: lo que iba solo por mensaje y sigue abierto pasa a una persona
  const stuck = await tx<(Candidate & { alert_id: string; playbook_id: string | null })[]>`
    select al.id as alert_id, al.playbook_id, al.account_id, al.market_code, a.name, al.kind, a.owner_id, c.care_owner_id, c.service_tier as tier, true as consent, null::text as wa_phone, al.detail, false as holdout, 'es' as locale, st.escalate_days, 0 as cap
      from crm.cs_alerts al join crm.accounts a on a.id = al.account_id join crm.cs_settings st on st.market_code = al.market_code
      left join crm.account_care c on c.account_id = a.id
     where al.status = 'open' and al.digital_only and al.activity_id is null and al.opened_at <= now() - make_interval(days => st.escalate_days)
       and (${mk}::text is null or al.market_code = ${mk}) and (${acc}::uuid is null or al.account_id = ${acc})`
  for (const s of stuck) {
    const owner = s.care_owner_id ?? s.owner_id
    if (!owner) continue
    const pb = s.playbook_id ? (await tx<Playbook[]>`select id, title_es, title_en, steps_es, steps_en, message_es, message_en, due_days from crm.playbooks where id = ${s.playbook_id}`)[0] ?? null : null
    const taskId = await taskFor(tx, actor, s, pb, owner)
    await tx`update crm.cs_alerts set activity_id = ${taskId}, owner_id = ${owner}, digital_only = false where id = ${s.alert_id}`
    tasks++
  }
  return { opened, closed: closed.length, tasks, messages }
}

/** "Evaluar ahora" desde la pantalla: mismas reglas que la tarea programada, a nombre de quien la corrió. */
export async function runAlertsNow(ctx: Ctx, market: string): Promise<{ opened: number; closed: number; tasks: number; messages: number }> {
  ctx.assert('care.manage', market)
  ctx.market(market)
  const sys = await systemCtx()
  const out = await withUser(sys.user.id, (tx) => runAlerts(tx, sys, { market }))
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'care.alerts_run', 'market', null, market, null, out))
  return out
}

/** Cerrar una alerta: atendida (se hizo la guía) o descartada con motivo. Su tarea se cierra con ella y no reaparece en 14 días. */
export async function closeAlert(ctx: Ctx, id: string, reason: 'done' | 'dismissed', note: string): Promise<void> {
  if (!isUuid(id)) throw notFound()
  const text = note.trim().slice(0, 300)
  assertNoProhibited(text)
  if (reason === 'dismissed' && text.length < 3) throw invalid('Para descartarla, escribe el motivo.', 'To dismiss it, enter the reason.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; account_id: string; market_code: string; kind: string; status: string; activity_id: string | null }[]>`select id, account_id, market_code, kind, status, activity_id from crm.cs_alerts where id = ${id} for update`
    const al = rows[0]
    if (!al) throw notFound('No encontramos esa alerta.', 'We could not find that alert.')
    ctx.assert('alert.work', al.market_code)
    if (al.status !== 'open') return
    await tx`update crm.cs_alerts set status = 'closed', closed_at = now(), close_reason = ${reason}, closed_by = ${ctx.user.id}, close_note = ${text || null} where id = ${id}`
    if (al.activity_id) await tx`update crm.activities set done_at = now() where id = ${al.activity_id} and done_at is null`
    await audit(tx, ctx, reason === 'done' ? 'care.alert_done' : 'care.alert_dismissed', 'account', al.account_id, al.market_code, null, { alert_id: id, kind: al.kind })
  })
}

// ================================================================ CS-02 · puntaje de salud
/** Pesos por grupo de señales. Cada grupo aporta como mucho su peso; con peso cero o apagado, no cuenta. */
export async function saveHealthWeights(ctx: Ctx, market: string | null, weights: Record<string, { weight: number; active: boolean }>): Promise<void> {
  if (market) { ctx.assert('care.manage', market); ctx.market(market) } else if (!ctx.isAdmin) throw forbidden()
  // Un grupo que no viene en el formulario conserva lo que tenía (campo2 sumó el punto de venta perfecto).
  const list = HEALTH_GROUPS.filter((g) => weights[g] !== undefined).map((g) => ({ grp: g, weight: Math.round(Number(weights[g]?.weight)), active: weights[g]?.active !== false }))
  if (list.some((w) => !Number.isFinite(w.weight) || w.weight < 0 || w.weight > 100)) throw invalid('Cada peso va de 0 a 100.', 'Each weight goes from 0 to 100.')
  if (!list.some((w) => w.active && w.weight > 0)) throw invalid('Al menos un grupo tiene que pesar.', 'At least one group must carry weight.')
  await withUser(ctx.user.id, async (tx) => {
    for (const w of list) {
      const prev = await tx<{ id: string }[]>`select id from crm.health_config where coalesce(market_code, '') = ${market ?? ''} and grp = ${w.grp} for update`
      if (prev[0]) await tx`update crm.health_config set weight = ${w.weight}, is_active = ${w.active}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${prev[0].id}`
      else await tx`insert into crm.health_config (market_code, grp, weight, is_active, updated_by) values (${market}, ${w.grp}, ${w.weight}, ${w.active}, ${ctx.user.id})`
    }
    await audit(tx, ctx, 'care.health_weights_saved', 'market', null, market, null, Object.fromEntries(list.map((w) => [w.grp, w.active ? w.weight : 0])))
  })
}

/** Calcula el puntaje de hoy para el mercado. */
export async function runHealthNow(ctx: Ctx, market: string): Promise<number> {
  ctx.assert('care.manage', market)
  ctx.market(market)
  const sys = await systemCtx()
  const n = (await withUser(sys.user.id, (tx) => tx<{ n: number }[]>`select app.health_snapshot_run(${market}) as n`))[0]?.n ?? 0
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'care.health_run', 'market', null, market, null, { scored: n }))
  return n
}

export type ValidationRow = { tier: string; threshold: number; sample: number; positives: number; hit_precision: string | null; hit_recall: string | null }
/** Validación contra lo que pasó después: precisión y recall por modelo de atención. Se guarda cada corrida. */
export async function validateHealth(ctx: Ctx, market: string, horizonDays = 30): Promise<ValidationRow[]> {
  ctx.assert('care.manage', market)
  ctx.market(market)
  const horizon = Math.min(90, Math.max(0, Math.round(horizonDays)))
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<ValidationRow[]>`select * from app.health_backtest(${market}, ${horizon})`
    for (const r of rows) {
      await tx`insert into crm.health_validations (market_code, tier, horizon_days, threshold, sample, positives, hit_precision, hit_recall, run_by)
               values (${market}, ${r.tier}, ${horizon}, ${r.threshold}, ${r.sample}, ${r.positives}, ${r.hit_precision}, ${r.hit_recall}, ${ctx.user.id})`
    }
    const all = rows.find((r) => r.tier === 'all')
    await audit(tx, ctx, 'care.health_validated', 'market', null, market, null, { horizon_days: horizon, sample: all?.sample ?? 0, precision: all?.hit_precision ?? null, recall: all?.hit_recall ?? null })
    return [...rows]
  })
}

/** Publicar el puntaje al equipo. Solo con una validación guardada sobre una muestra suficiente: un puntaje sin validar no se enseña como bueno. */
export async function publishHealth(ctx: Ctx, market: string, on: boolean): Promise<void> {
  ctx.assert('health.publish', market)
  ctx.market(market)
  await withUser(ctx.user.id, async (tx) => {
    if (on) {
      const v = await tx<{ sample: number }[]>`select sample from crm.health_validations where market_code = ${market} and tier = 'all' and horizon_days >= 14 order by run_at desc limit 1`
      if (!v[0] || v[0].sample < HEALTH_MIN_SAMPLE) {
        throw new DomainError('not_validated',
          `Antes de publicarlo hay que validarlo contra lo que pasó: al menos ${HEALTH_MIN_SAMPLE} comercios con puntaje de hace 14 días o más.${v[0] ? ` La última validación tuvo ${v[0].sample}.` : ' Todavía no hay ninguna validación.'}`,
          `Before publishing, validate it against what happened: at least ${HEALTH_MIN_SAMPLE} merchants scored 14 or more days ago.${v[0] ? ` The last validation had ${v[0].sample}.` : ' There is no validation yet.'}`, 409)
      }
    }
    await tx`insert into crm.cs_settings (market_code, health_published, health_published_at, updated_by) values (${market}, ${on}, ${on ? tx`now()` : null}, ${ctx.user.id})
             on conflict (market_code) do update set health_published = excluded.health_published, health_published_at = excluded.health_published_at, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, on ? 'care.health_published' : 'care.health_unpublished', 'market', null, market, null, { published: on })
  })
}

/** Señales que no trae el archivo de ventas v1 (saldo, comisión, productos, solicitudes). Entrada única para la conexión futura y para las pruebas. */
const signalsFile = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(['sales_file', 'zendesk', 'simulated', 'manual']).default('manual'),
  rows: z.array(z.object({
    account_id: z.guid(),
    balance_minor: z.number().int().nonnegative().nullable().optional(),
    commission_minor_30d: z.number().int().nonnegative().nullable().optional(),
    product_count_30d: z.number().int().min(0).max(50).nullable().optional(),
    open_tickets: z.number().int().nonnegative().nullable().optional(),
    urgent_tickets: z.number().int().nonnegative().nullable().optional(),
  })).min(1).max(20000),
})
export async function ingestCareSignals(tx: Tx, raw: z.input<typeof signalsFile>): Promise<number> {
  const p = signalsFile.safeParse(raw)
  if (!p.success) throw invalid('El archivo de señales no cumple el formato.', 'The signals file does not match the format.')
  const f = p.data
  const rows = await tx`
    insert into crm.care_signals (account_id, as_of, market_code, balance_minor, commission_minor_30d, product_count_30d, open_tickets, urgent_tickets, source)
    select a.id, ${f.as_of}, a.market_code, x.balance_minor, x.commission_minor_30d, x.product_count_30d, x.open_tickets, x.urgent_tickets, ${f.source}
      from jsonb_to_recordset(${tx.json(f.rows as never)}) as x(account_id uuid, balance_minor bigint, commission_minor_30d bigint, product_count_30d int, open_tickets int, urgent_tickets int)
      join crm.accounts a on a.id = x.account_id and a.archived_at is null
    on conflict (account_id, as_of) do update set balance_minor = coalesce(excluded.balance_minor, crm.care_signals.balance_minor),
      commission_minor_30d = coalesce(excluded.commission_minor_30d, crm.care_signals.commission_minor_30d), product_count_30d = coalesce(excluded.product_count_30d, crm.care_signals.product_count_30d),
      open_tickets = coalesce(excluded.open_tickets, crm.care_signals.open_tickets), urgent_tickets = coalesce(excluded.urgent_tickets, crm.care_signals.urgent_tickets), source = excluded.source, loaded_at = now()
    returning 1`
  return rows.length
}

/** Lee las dos conexiones de señales. Apagadas (lo normal) no traen nada y no se escribe nada. */
export async function pullSignals(tx: Tx): Promise<{ done: number; note: string }> {
  const accounts = await tx<{ id: string; volume: string; today: string }[]>`
    select a.id, m.volume_minor_30d::text as volume, (now() at time zone mk.timezone)::date::text as today
      from crm.accounts a join crm.markets mk on mk.code = a.market_code
      join lateral (select x.volume_minor_30d from crm.merchant_metrics_daily x where x.account_id = a.id order by x.as_of desc limit 1) m on true
     where a.archived_at is null and a.lifecycle in ('active','at_risk','inactive') limit 20000`
  const signals = await pullCareSignals(accounts.map((a) => ({ id: a.id, volumeMinor30d: Number(a.volume) })))
  const tickets = await pullTicketCounts(accounts.map((a) => a.id))
  if (!signals && !tickets) return { done: 0, note: 'adapters off' }
  const byId = new Map<string, Record<string, unknown>>()
  for (const s of signals ?? []) byId.set(s.accountId, { account_id: s.accountId, balance_minor: s.balanceMinor, commission_minor_30d: s.commissionMinor30d, product_count_30d: s.productCount30d })
  for (const t of tickets ?? []) byId.set(t.accountId, { ...(byId.get(t.accountId) ?? { account_id: t.accountId }), open_tickets: t.open, urgent_tickets: t.urgent })
  if (byId.size === 0) return { done: 0, note: 'no rows' }
  const done = await ingestCareSignals(tx, { as_of: accounts[0]!.today, source: 'simulated', rows: [...byId.values()] as never })
  return { done, note: `signals ${signals ? 'simulated' : 'off'}, tickets ${tickets ? 'simulated' : 'off'}` }
}

// ================================================================ CS-04 · modelo de atención
const tierInput = z.object({
  high: z.coerce.number().positive().max(1e9),
  pooled: z.coerce.number().positive().max(1e9),
  low: z.coerce.number().positive().max(1e9),
  rateBp: z.coerce.number().int().min(1).max(1000),
  hysteresisPct: z.coerce.number().int().min(0).max(50),
})

/** Umbrales del modelo de atención: comisión de 30 días para cada nivel, tasa para estimarla cuando no hay dato y margen para no brincar de nivel. */
export async function saveTierRules(ctx: Ctx, market: string, raw: z.input<typeof tierInput>): Promise<void> {
  ctx.assert('care.manage', market)
  ctx.market(market)
  const p = tierInput.safeParse(raw)
  if (!p.success) throw invalid('Revisa los montos y los porcentajes.', 'Check the amounts and the percentages.')
  const v = p.data
  if (!(v.high > v.pooled && v.pooled > v.low)) throw invalid('Los montos van de mayor a menor: dedicada, en equipo, ligera.', 'The amounts go from highest to lowest: dedicated, pooled, light.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<Record<string, unknown>[]>`select tier_high_commission::text, tier_pooled_commission::text, tier_low_commission::text, tier_commission_rate_bp, tier_hysteresis_pct from crm.cs_settings where market_code = ${market} for update`
    const vals = { hi: Math.round(v.high * 100), mid: Math.round(v.pooled * 100), lo: Math.round(v.low * 100) }
    await tx`insert into crm.cs_settings (market_code, tier_high_commission, tier_pooled_commission, tier_low_commission, tier_commission_rate_bp, tier_hysteresis_pct, updated_by)
             values (${market}, ${vals.hi}, ${vals.mid}, ${vals.lo}, ${v.rateBp}, ${v.hysteresisPct}, ${ctx.user.id})
             on conflict (market_code) do update set tier_high_commission = excluded.tier_high_commission, tier_pooled_commission = excluded.tier_pooled_commission,
               tier_low_commission = excluded.tier_low_commission, tier_commission_rate_bp = excluded.tier_commission_rate_bp, tier_hysteresis_pct = excluded.tier_hysteresis_pct,
               updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'care.tier_rules_saved', 'market', null, market, before[0] ?? null, { high_minor: vals.hi, pooled_minor: vals.mid, low_minor: vals.lo, rate_bp: v.rateBp, hysteresis_pct: v.hysteresisPct })
  })
}

export async function runTiersNow(ctx: Ctx, market: string): Promise<number> {
  ctx.assert('care.manage', market)
  ctx.market(market)
  const sys = await systemCtx()
  const n = (await withUser(sys.user.id, (tx) => tx<{ n: number }[]>`select app.service_tier_recalc(${market}) as n`))[0]?.n ?? 0
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'care.tiers_run', 'market', null, market, null, { moved: n }))
  return n
}

export const stageLabel = (stage: string, en: boolean) => STAGE[stage as keyof typeof STAGE]?.label[en ? 1 : 0] ?? stage
