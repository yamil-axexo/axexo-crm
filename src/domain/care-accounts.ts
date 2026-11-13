import 'server-only'
import { z } from 'zod'
import { marketToday, marketWorkday, withUser, type Tx } from '@/server/db'
import { systemCtx, type Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { runAlerts } from '@/domain/care'
import { DomainError, invalid, notFound } from '@/lib/errors'
import { isUuid } from '@/lib/ids'
import { aiReviewDraft, pullCompletions } from '@/server/adapters/care'
import { isCorporate } from '@/lib/care'

/**
 * Cuidado del comercio, segunda parte (CS-05 a CS-08): constancias de capacitación y cambio de encargado, oportunidades de
 * expansión, plan de cuenta con relaciones y revisiones, y comentarios de producto desde campo.
 */
type Account = { id: string; market_code: string; name: string; owner_id: string | null; kind: string; lifecycle: string }
async function loadAccount(tx: Tx, id: string): Promise<Account> {
  if (!isUuid(id)) throw notFound()
  const rows = await tx<Account[]>`select id, market_code, name, owner_id, kind, lifecycle from crm.accounts where id = ${id} and archived_at is null`
  if (!rows[0]) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
  return rows[0]
}
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
async function notFuture(tx: Tx, market: string, on: string): Promise<void> {
  const ok = await tx<{ ok: boolean }[]>`select ${on}::date <= ${marketToday(tx, market)} as ok`
  if (!ok[0]?.ok) throw invalid('La fecha no puede ser futura.', 'The date cannot be in the future.')
}

// ================================================================ CS-06 · capacitación y cambio de encargado
const completionInput = z.object({
  accountId: z.string(),
  personName: z.string().trim().min(2).max(120),
  courseKey: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{1,59}$/),
  courseTitle: z.string().trim().min(2).max(160),
  completedOn: day,
})

async function insertCompletion(tx: Tx, a: Account, v: { personName: string; courseKey: string; courseTitle: string; completedOn: string }, source: 'kore_academy' | 'manual', externalId: string | null, by: string): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    insert into crm.training_completions (account_id, market_code, person_name, course_key, course_title, completed_on, source, external_id, recorded_by)
    values (${a.id}, ${a.market_code}, ${v.personName}, ${v.courseKey}, ${v.courseTitle}, ${v.completedOn}, ${source}, ${externalId}, ${by})
    on conflict (external_id) do nothing returning id`
  if (!rows[0]) return null
  // Un encargado nuevo deja de ser señal de riesgo cuando termina su capacitación.
  await tx`update crm.manager_changes set trained_at = now() where account_id = ${a.id} and trained_at is null and changed_on <= ${v.completedOn}::date`
  return rows[0].id
}

/**
 * Constancia de capacitación del encargado. La fuente es Kore Academy: aquí solo se guarda qué curso terminó, quién y cuándo,
 * nunca el contenido. Mientras la conexión está apagada, la registra a mano quien atiende al comercio.
 */
export async function recordCompletion(ctx: Ctx, raw: z.input<typeof completionInput>): Promise<string> {
  const p = completionInput.safeParse(raw)
  if (!p.success) throw invalid('Escribe quién terminó el curso, qué curso y en qué fecha. La clave del curso va en minúsculas, sin espacios.', 'Enter who completed the course, which course and on what date. The course key is lowercase, with no spaces.')
  const v = p.data
  assertNoProhibited(v.personName, v.courseTitle)
  return withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, v.accountId)
    ctx.assert('training.record', a.market_code)
    await notFuture(tx, a.market_code, v.completedOn)
    const id = (await insertCompletion(tx, a, v, 'manual', null, ctx.user.id))!
    await audit(tx, ctx, 'care.training_recorded', 'account', a.id, a.market_code, null, { course_key: v.courseKey, completed_on: v.completedOn, source: 'manual' })
    await runAlerts(tx, ctx, { accountId: a.id })
    return id
  })
}

/** Lee los cursos terminados que avisa Kore Academy. Con la conexión apagada no trae nada. Repetir un aviso no duplica la constancia. */
export async function pullAcademy(tx: Tx, sys: { user: { id: string } }): Promise<{ done: number; note: string }> {
  const refs = await tx<{ merchant_ref: string; id: string; market_code: string; name: string; today: string }[]>`
    select a.merchant_ref, a.id, a.market_code, a.name, (now() at time zone mk.timezone)::date::text as today
      from crm.accounts a join crm.markets mk on mk.code = a.market_code
     where a.merchant_ref is not null and a.archived_at is null and exists (select 1 from crm.manager_changes mc where mc.account_id = a.id and mc.trained_at is null) limit 500`
  const events = await pullCompletions(refs.map((r) => r.merchant_ref), refs[0]?.today ?? '1970-01-01')
  if (!events) return { done: 0, note: 'adapter off' }
  let done = 0
  for (const e of events) {
    const a = refs.find((r) => r.merchant_ref === e.merchantRef)
    if (!a) continue
    const id = await insertCompletion(tx, { ...a, owner_id: null, kind: 'store', lifecycle: 'active' }, { personName: e.personName.slice(0, 120), courseKey: e.courseKey, courseTitle: e.courseTitle.slice(0, 160), completedOn: e.completedOn }, 'kore_academy', e.externalId, sys.user.id)
    if (id) done++
  }
  return { done, note: 'simulated' }
}

const managerInput = z.object({
  accountId: z.string(),
  changedOn: day,
  newName: z.string().trim().min(2).max(120),
  note: z.string().trim().max(300).optional().default(''),
  source: z.enum(['visit', 'call', 'other']).default('visit'),
})

/**
 * Cambio de encargado visto en la visita. Es una señal de riesgo: el encargado nuevo no ha sido capacitado. Queda en el hilo
 * del comercio y, con las alertas encendidas, abre la alerta con su tarea y su guía.
 */
export async function recordManagerChange(ctx: Ctx, raw: z.input<typeof managerInput>): Promise<string> {
  const p = managerInput.safeParse(raw)
  if (!p.success) throw invalid('Escribe el nombre del encargado nuevo y la fecha en que lo supiste.', 'Enter the new manager’s name and the date you found out.')
  const v = p.data
  assertNoProhibited(v.newName, v.note)
  return withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, v.accountId)
    ctx.assert('manager.change', a.market_code)
    return recordManagerChangeTx(tx, ctx, a, v)
  })
}

/**
 * CS-06: el mismo registro cuando el cambio llega en la visita de la Sales App (visit.checked_out, campo manager_change).
 * Corre como sistema dentro de la transacción del evento; el nombre ya llega limpio.
 */
export async function recordManagerChangeTx(tx: Tx, ctx: Ctx, a: { id: string; market_code: string }, v: { changedOn: string; newName: string; note?: string; source: 'visit' | 'call' | 'other' }): Promise<string> {
  await notFuture(tx, a.market_code, v.changedOn)
  const rows = await tx<{ id: string }[]>`
    insert into crm.manager_changes (account_id, market_code, changed_on, new_name, note, source, recorded_by)
    values (${a.id}, ${a.market_code}, ${v.changedOn}, ${v.newName}, ${clean(v.note ?? '')}, ${v.source}, ${ctx.user.id}) returning id`
  const en = ctx.market(a.market_code).locale === 'en'
  await tx`insert into crm.activities (market_code, account_id, kind, subject, body, done_at, owner_id, created_by, source)
           values (${a.market_code}, ${a.id}, 'note', ${(en ? `New manager: ${v.newName}` : `Cambió el encargado: ${v.newName}`).slice(0, 200)}, ${clean(v.note ?? '')}, now(), ${ctx.user.id}, ${ctx.user.id}, 'user')`
  await audit(tx, ctx, 'care.manager_changed', 'account', a.id, a.market_code, null, { changed_on: v.changedOn, source: v.source })
  await runAlerts(tx, ctx, { accountId: a.id })
  return rows[0]!.id
}

// ================================================================ CS-07 · expansión
const ruleInput = z.object({
  market: z.string().length(2),
  productLabel: z.string().trim().min(2).max(80),
  productId: z.string().optional().default(''),
  minActiveDays: z.coerce.number().int().min(1).max(31),
  minDaysSinceFirst: z.coerce.number().int().min(0).max(720),
  minTxn30d: z.coerce.number().int().min(1).max(100000),
  isActive: z.boolean(),
})

/** Regla de elegibilidad: a qué comercio activo se le ofrece un producto más, según lo que de verdad vende. */
export async function saveExpansionRule(ctx: Ctx, raw: z.input<typeof ruleInput>): Promise<void> {
  const p = ruleInput.safeParse(raw)
  if (!p.success) throw invalid('La regla lleva producto, días con venta, antigüedad y ventas mínimas (al menos una).', 'A rule has a product, selling days, tenure and minimum sales (at least one).')
  const v = p.data
  ctx.assert('care.manage', v.market)
  ctx.market(v.market)
  assertNoProhibited(v.productLabel)
  await withUser(ctx.user.id, async (tx) => {
    const product = v.productId && isUuid(v.productId) ? (await tx<{ id: string }[]>`select id from crm.products where id = ${v.productId} and is_active`)[0]?.id ?? null : null
    const before = await tx<{ id: string; is_active: boolean }[]>`select id, is_active from crm.expansion_rules where market_code = ${v.market} and lower(product_label) = lower(${v.productLabel}) for update`
    if (before[0]) {
      await tx`update crm.expansion_rules set product_id = ${product}, min_active_days = ${v.minActiveDays}, min_days_since_first = ${v.minDaysSinceFirst}, min_txn_30d = ${v.minTxn30d},
                 is_active = ${v.isActive}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${before[0].id}`
    } else {
      await tx`insert into crm.expansion_rules (market_code, product_id, product_label, min_active_days, min_days_since_first, min_txn_30d, is_active, updated_by)
               values (${v.market}, ${product}, ${v.productLabel}, ${v.minActiveDays}, ${v.minDaysSinceFirst}, ${v.minTxn30d}, ${v.isActive}, ${ctx.user.id})`
    }
    await audit(tx, ctx, 'care.expansion_rule_saved', 'market', null, v.market, before[0] ? { is_active: before[0].is_active } : null, { product: v.productLabel, min_active_days: v.minActiveDays, min_days_since_first: v.minDaysSinceFirst, min_txn_30d: v.minTxn30d, is_active: v.isActive })
  })
}

export async function runExpansionNow(ctx: Ctx, market: string): Promise<number> {
  ctx.assert('care.manage', market)
  ctx.market(market)
  const sys = await systemCtx()
  const n = (await withUser(sys.user.id, (tx) => tx<{ n: number }[]>`select app.expansion_run(${market}) as n`))[0]?.n ?? 0
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'care.expansion_run', 'market', null, market, null, { opened: n }))
  return n
}

type Opp = { id: string; account_id: string; market_code: string; product_label: string; status: string; owner_id: string | null; activity_id: string | null; name: string; lifecycle: string }
async function loadOpp(tx: Tx, id: string): Promise<Opp> {
  if (!isUuid(id)) throw notFound()
  const rows = await tx<Opp[]>`select o.id, o.account_id, o.market_code, o.product_label, o.status, o.owner_id, o.activity_id, a.name, a.lifecycle
    from crm.expansion_opportunities o join crm.accounts a on a.id = o.account_id where o.id = ${id} for update of o`
  if (!rows[0]) throw notFound('No encontramos esa oportunidad.', 'We could not find that opportunity.')
  return rows[0]
}

/** Tomar la oportunidad: queda a tu nombre, en conversación, con una tarea para ofrecer el producto. A un comercio que dejó de vender no se le ofrece. */
export async function takeOpportunity(ctx: Ctx, id: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const o = await loadOpp(tx, id)
    ctx.assert('expansion.work', o.market_code)
    if (o.status !== 'open') throw invalid('Esa oportunidad ya la tomó alguien o ya se cerró.', 'Someone already took that opportunity, or it is closed.')
    if (o.lifecycle !== 'active') throw new DomainError('not_active', 'Este comercio dejó de vender. Primero hay que recuperarlo; la oportunidad se ofrece a comercios que venden.', 'This merchant stopped selling. Win it back first; the opportunity is offered to merchants that sell.', 409)
    const en = ctx.locale === 'en'
    const act = await tx<{ id: string }[]>`
      insert into crm.activities (market_code, account_id, kind, subject, due_at, owner_id, created_by, source)
      values (${o.market_code}, ${o.account_id}, 'task', ${(en ? `Offer ${o.product_label} to ${o.name}` : `Ofrecer ${o.product_label} a ${o.name}`).slice(0, 200)},
              ((${marketWorkday(tx, o.market_code, 2)} + time '15:00') at time zone 'UTC'), ${ctx.user.id}, ${ctx.user.id}, 'user') returning id`
    await tx`update crm.expansion_opportunities set status = 'working', owner_id = ${ctx.user.id}, activity_id = ${act[0]!.id} where id = ${id}`
    await audit(tx, ctx, 'care.expansion_taken', 'account', o.account_id, o.market_code, null, { opportunity_id: id, product: o.product_label })
  })
}

/** Cómo terminó: aceptó, no aceptó o se descarta, con nota. Si no aceptó o se descartó, no se vuelve a abrir en 90 días. */
export async function closeOpportunity(ctx: Ctx, id: string, result: 'won' | 'lost' | 'dismissed', note: string): Promise<void> {
  const text = note.trim().slice(0, 300)
  assertNoProhibited(text)
  if (result !== 'won' && text.length < 3) throw invalid('Escribe el motivo.', 'Enter the reason.')
  await withUser(ctx.user.id, async (tx) => {
    const o = await loadOpp(tx, id)
    ctx.assert('expansion.work', o.market_code)
    if (!['open', 'working'].includes(o.status)) return
    await tx`update crm.expansion_opportunities set status = ${result}, close_note = ${text || null}, closed_at = now(), closed_by = ${ctx.user.id} where id = ${id}`
    if (o.activity_id) await tx`update crm.activities set done_at = now() where id = ${o.activity_id} and done_at is null`
    await audit(tx, ctx, result === 'won' ? 'care.expansion_won' : result === 'lost' ? 'care.expansion_lost' : 'care.expansion_dismissed', 'account', o.account_id, o.market_code, null, { opportunity_id: id, product: o.product_label })
  })
}

// ================================================================ CS-05 · plan de cuenta, relaciones y revisiones
async function corporate(tx: Tx, ctx: Ctx, accountId: string): Promise<Account> {
  const a = await loadAccount(tx, accountId)
  ctx.assert('account.plan', a.market_code)
  const tier = (await tx<{ service_tier: string | null }[]>`select service_tier from crm.account_care where account_id = ${a.id}`)[0]?.service_tier ?? null
  if (!isCorporate(a.kind, tier)) throw invalid('El plan de cuenta es para cadenas, distribuidores y cuentas de atención dedicada.', 'The account plan is for chains, distributors and dedicated accounts.')
  return a
}

const planInput = z.object({
  goals: z.string().trim().max(2000),
  risks: z.string().trim().max(2000),
  nextSteps: z.string().trim().max(2000),
  reviewEveryDays: z.coerce.number().int().min(7).max(365),
  nextReviewOn: day.or(z.literal('')),
})
export async function savePlan(ctx: Ctx, accountId: string, raw: z.input<typeof planInput>): Promise<void> {
  const p = planInput.safeParse(raw)
  if (!p.success) throw invalid('Revisa el plan: cada texto hasta 2000 letras y la revisión cada 7 a 365 días.', 'Check the plan: each text up to 2000 characters and a review every 7 to 365 days.')
  const v = p.data
  assertNoProhibited(v.goals, v.risks, v.nextSteps)
  await withUser(ctx.user.id, async (tx) => {
    const a = await corporate(tx, ctx, accountId)
    await tx`insert into crm.account_plans (account_id, market_code, goals, risks, next_steps, review_every_days, next_review_on, updated_by)
             values (${a.id}, ${a.market_code}, ${clean(v.goals)}, ${clean(v.risks)}, ${clean(v.nextSteps)}, ${v.reviewEveryDays}, ${v.nextReviewOn || null}, ${ctx.user.id})
             on conflict (account_id) do update set goals = excluded.goals, risks = excluded.risks, next_steps = excluded.next_steps, review_every_days = excluded.review_every_days,
               next_review_on = excluded.next_review_on, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'care.plan_saved', 'account', a.id, a.market_code, null, { review_every_days: v.reviewEveryDays, next_review_on: v.nextReviewOn || null })
  })
}

const relInput = z.object({ productLabel: z.string().trim().min(2).max(80), health: z.enum(['good', 'watch', 'risk']), note: z.string().trim().max(300).optional().default('') })
/** Cómo va la relación con la cuenta en cada producto. La cuenta entera se ve tan bien como su relación más débil. */
export async function saveRelationship(ctx: Ctx, accountId: string, raw: z.input<typeof relInput>): Promise<void> {
  const p = relInput.safeParse(raw)
  if (!p.success) throw invalid('Escribe el producto y elige cómo va la relación.', 'Enter the product and choose how the relationship is going.')
  const v = p.data
  assertNoProhibited(v.productLabel, v.note)
  await withUser(ctx.user.id, async (tx) => {
    const a = await corporate(tx, ctx, accountId)
    const prev = await tx<{ id: string; health: string }[]>`select id, health from crm.account_relationships where account_id = ${a.id} and lower(product_label) = lower(${v.productLabel}) for update`
    if (prev[0]) await tx`update crm.account_relationships set health = ${v.health}, note = ${clean(v.note)}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${prev[0].id}`
    else await tx`insert into crm.account_relationships (account_id, market_code, product_label, health, note, updated_by) values (${a.id}, ${a.market_code}, ${v.productLabel}, ${v.health}, ${clean(v.note)}, ${ctx.user.id})`
    await audit(tx, ctx, 'care.relationship_saved', 'account', a.id, a.market_code, prev[0] ? { health: prev[0].health } : null, { product: v.productLabel, health: v.health })
  })
}

const reviewInput = z.object({
  heldOn: day,
  attendees: z.string().trim().max(300).optional().default(''),
  minutes: z.string().trim().min(3).max(4000),
  agreements: z.string().trim().max(2000).optional().default(''),
  draftSource: z.enum(['manual', 'data', 'ai']).default('manual'),
})
/** Revisión periódica con su minuta. Al guardarla, la siguiente queda con fecha según la frecuencia del plan. */
export async function addReview(ctx: Ctx, accountId: string, raw: z.input<typeof reviewInput>): Promise<string> {
  const p = reviewInput.safeParse(raw)
  if (!p.success) throw invalid('La revisión lleva fecha y minuta.', 'A review has a date and minutes.')
  const v = p.data
  assertNoProhibited(v.attendees, v.minutes, v.agreements)
  return withUser(ctx.user.id, async (tx) => {
    const a = await corporate(tx, ctx, accountId)
    await notFuture(tx, a.market_code, v.heldOn)
    const rows = await tx<{ id: string }[]>`
      insert into crm.account_reviews (account_id, market_code, held_on, attendees, minutes, agreements, draft_source, created_by)
      values (${a.id}, ${a.market_code}, ${v.heldOn}, ${clean(v.attendees)}, ${v.minutes}, ${clean(v.agreements)}, ${v.draftSource}, ${ctx.user.id}) returning id`
    await tx`insert into crm.account_plans (account_id, market_code, next_review_on, updated_by) values (${a.id}, ${a.market_code}, ${v.heldOn}::date + 90, ${ctx.user.id})
             on conflict (account_id) do update set next_review_on = ${v.heldOn}::date + crm.account_plans.review_every_days, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'care.review_added', 'account', a.id, a.market_code, null, { held_on: v.heldOn, draft_source: v.draftSource })
    return rows[0]!.id
  })
}

/**
 * Borrador de la minuta con los datos que CONTIGO ya tiene (ventas del último corte, etapa, salud, alertas, relaciones).
 * No usa AI: son hechos puestos en orden. Con la conexión de AI apagada (lo normal), `ai` viene vacío.
 */
export async function reviewDraft(ctx: Ctx, accountId: string): Promise<{ text: string; ai: string | null }> {
  return withUser(ctx.user.id, async (tx) => {
    const a = await corporate(tx, ctx, accountId)
    const en = ctx.locale === 'en'
    const m = (await tx<{ as_of: string; txn: number; days: number; stores: number }[]>`
      select max(x.as_of)::text as as_of, coalesce(sum(x.txn_count_30d), 0)::int as txn, coalesce(max(x.active_days_30d), 0)::int as days, count(*)::int as stores
        from crm.accounts s join lateral (select y.* from crm.merchant_metrics_daily y where y.account_id = s.id order by y.as_of desc limit 1) x on true
       where s.id = ${a.id} or ${a.id} = any(s.ancestor_ids)`)[0]
    const alerts = (await tx<{ n: number }[]>`select count(*)::int as n from crm.cs_alerts al join crm.accounts s on s.id = al.account_id where al.status = 'open' and (s.id = ${a.id} or ${a.id} = any(s.ancestor_ids))`)[0]?.n ?? 0
    const rels = await tx<{ product_label: string; health: string }[]>`select product_label, health from crm.account_relationships where account_id = ${a.id} order by product_label`
    const facts: string[] = []
    if (m && m.stores > 0) facts.push(en ? `Sales, as of ${m.as_of}: ${m.txn} transactions in 30 days across ${m.stores} ${m.stores === 1 ? 'store' : 'stores'} with data.` : `Ventas, con corte al ${m.as_of}: ${m.txn} transacciones en 30 días en ${m.stores} ${m.stores === 1 ? 'tienda' : 'tiendas'} con datos.`)
    else facts.push(en ? 'Sales: no sales data for this account yet.' : 'Ventas: todavía no hay datos de ventas de esta cuenta.')
    facts.push(en ? `Open alerts: ${alerts}.` : `Alertas abiertas: ${alerts}.`)
    if (rels.length) facts.push((en ? 'Relationship by product: ' : 'Relación por producto: ') + rels.map((r) => `${r.product_label} (${r.health === 'good' ? (en ? 'good' : 'bien') : r.health === 'watch' ? (en ? 'watch' : 'para vigilar') : (en ? 'at risk' : 'en riesgo')})`).join(', ') + '.')
    facts.push(en ? 'Agreements and next steps: to be filled in at the review.' : 'Acuerdos y próximos pasos: se llenan en la revisión.')
    return { text: facts.join('\n'), ai: await aiReviewDraft(facts) }
  })
}

// ================================================================ CS-08 · comentarios de producto
const feedbackInput = z.object({ accountId: z.string(), topic: z.string().regex(/^[a-z_]{3,30}$/), kind: z.enum(['friction', 'request']), note: z.string().trim().max(500).optional().default('') })

/** Lo que el comercio dijo o lo que se vio en campo sobre el producto. Siempre con tema de la lista: sin tema no se guarda. */
export async function addFeedback(ctx: Ctx, raw: z.input<typeof feedbackInput>): Promise<string> {
  const p = feedbackInput.safeParse(raw)
  if (!p.success) throw invalid('Elige el tema y si es algo que le estorba o algo que pide.', 'Choose the topic and whether it gets in the way or is something they ask for.')
  const v = p.data
  assertNoProhibited(v.note)
  return withUser(ctx.user.id, async (tx) => {
    const a = await loadAccount(tx, v.accountId)
    ctx.assert('feedback.create', a.market_code)
    const topic = await tx<{ label_es: string; label_en: string }[]>`select label_es, label_en from crm.feedback_topics where code = ${v.topic} and is_active`
    if (!topic[0]) throw invalid('Ese tema no está en la lista.', 'That topic is not on the list.')
    const rows = await tx<{ id: string }[]>`
      insert into crm.product_feedback (account_id, market_code, topic, kind, note, created_by, updated_by)
      values (${a.id}, ${a.market_code}, ${v.topic}, ${v.kind}, ${clean(v.note)}, ${ctx.user.id}, ${ctx.user.id}) returning id`
    const en = ctx.market(a.market_code).locale === 'en'
    await tx`insert into crm.activities (market_code, account_id, kind, subject, body, done_at, owner_id, created_by, source)
             values (${a.market_code}, ${a.id}, 'note', ${en ? `Product feedback: ${topic[0].label_en}` : `Comentario de producto: ${topic[0].label_es}`}, ${clean(v.note)}, now(), ${ctx.user.id}, ${ctx.user.id}, 'user')`
    await audit(tx, ctx, 'care.feedback_added', 'account', a.id, a.market_code, null, { feedback_id: rows[0]!.id, topic: v.topic, kind: v.kind })
    return rows[0]!.id
  })
}

/** Producto responde: visto, en plan, resuelto o no se hará, con una línea para quien lo reportó. */
export async function setFeedbackStatus(ctx: Ctx, id: string, status: 'seen' | 'planned' | 'done' | 'declined', response: string): Promise<void> {
  if (!isUuid(id)) throw notFound()
  const text = response.trim().slice(0, 500)
  assertNoProhibited(text)
  if (status === 'declined' && text.length < 3) throw invalid('Si no se hará, escribe por qué.', 'If it will not be done, say why.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; account_id: string; market_code: string; status: string }[]>`select id, account_id, market_code, status from crm.product_feedback where id = ${id} for update`
    const f = rows[0]
    if (!f) throw notFound('No encontramos ese comentario.', 'We could not find that feedback.')
    ctx.assert('feedback.manage', f.market_code)
    await tx`update crm.product_feedback set status = ${status}, response = ${text || null}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${id}`
    await audit(tx, ctx, 'care.feedback_status_set', 'account', f.account_id, f.market_code, { status: f.status }, { feedback_id: id, status })
  })
}

/** Resumen semanal para Producto y Tecnología: conteo por tema y mercado de la semana que terminó. Correrlo dos veces no duplica. */
export async function feedbackDigest(tx: Tx): Promise<{ done: number; note: string }> {
  const rows = await tx<{ id: string; total: number }[]>`
    with w as (select (date_trunc('week', now()) - interval '7 days')::date as s, (date_trunc('week', now()) - interval '1 day')::date as e),
    c as (
      select f.market_code, f.topic, f.kind, count(*)::int as n from crm.product_feedback f, w
       where f.created_at >= w.s and f.created_at < w.e + 1 group by 1, 2, 3
    )
    insert into crm.feedback_digests (period_start, period_end, total, counts)
    select w.s, w.e, coalesce((select sum(n) from c), 0)::int, coalesce((select jsonb_agg(jsonb_build_object('market', market_code, 'topic', topic, 'kind', kind, 'count', n) order by n desc) from c), '[]'::jsonb) from w
    on conflict (period_start, period_end) do update set total = excluded.total, counts = excluded.counts, created_at = now()
    returning id, total`
  return { done: rows[0]?.total ?? 0, note: 'weekly digest' }
}
