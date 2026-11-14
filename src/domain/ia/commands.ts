import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { assertNoProhibited, hasProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import { aiAdapter, digest, PROMPT_VERSION, type AiFeature } from '@/server/adapters/ai'
import { asQuotedData } from '@/domain/untrusted'
import { AGENTS, effectiveLevel, LEVELS, type Level } from './agents'
import { agentsWithoutRedteam } from '@/domain/plataforma/admin'
import {
  classifyLead, DISMISS_CODES, LEAD_CLASSES, matchQuestion, NEXT_TITLE, nextActions, scoreLead, SCORE_FACTORS, topAction,
  type LeadClass, type LeadFacts, type NextFacts, type NextRule, type ScoreFactor,
} from './rules'

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Cuánto vive una sugerencia abierta y cuánto se espera para medir qué pasó. */
export const EXPIRES_DAYS = 7
export const MEASURE_DAYS = 14

// ================================================================ registro de cada llamada (IA-07)
export async function logCall(tx: Tx, c: { feature: AiFeature | 'agent_draft' | 'eval'; mode: 'off' | 'simulated' | 'rules' | 'live'; input: unknown; untrusted?: boolean; tool?: Record<string, unknown> | null; diff?: Record<string, unknown> | null; outcome: 'not_sent' | 'answered' | 'refused'; via?: 'screen' | 'job' | 'mcp' | 'eval'; costUsd?: number }) {
  const version = c.feature in PROMPT_VERSION ? PROMPT_VERSION[c.feature as AiFeature] : 'rules-1'
  await tx`insert into crm.ia_calls (feature, mode, prompt_version, input_digest, untrusted_input, tool_call, diff, outcome, cost_usd, actor_id, via)
           values (${c.feature}, ${c.mode}, ${version}, ${digest(c.input)}, ${c.untrusted ?? false}, ${c.tool ? tx.json(c.tool as never) : null},
                   ${c.diff ? tx.json(c.diff as never) : null}, ${c.outcome}, ${c.costUsd ?? 0}, (select app.current_user_id()), ${c.via ?? 'screen'})`
}

// ================================================================ IA-08: regla de encendido
export const THRESHOLD: Record<AiFeature, number> = { next_action: 0.95, lead_class: 0.95, metric_question: 1, capture: 1 }

/** Una función puede usar el modelo solo si el adaptador está encendido Y su última evaluación, con la versión vigente, pasó el umbral. */
export async function featureOn(tx: Tx, feature: AiFeature): Promise<boolean> {
  if (aiAdapter().mode === 'off') return false
  const r = await tx<{ meets_threshold: boolean }[]>`
    select meets_threshold from crm.ia_eval_runs where feature = ${feature} and target = 'adapter' and prompt_version = ${PROMPT_VERSION[feature]}
     order by ran_at desc limit 1`
  return r[0]?.meets_threshold === true
}

// ================================================================ IA-02: generar, expirar y medir sugerencias (tarea programada)
type FactRow = {
  id: string; market_code: string; owner_id: string | null; lifecycle: string; days_created: number; days_quiet: number; first_txn: boolean
  txn_now: number | null; txn_before: number | null; revisit: boolean; holdout: boolean; level: Level; quiet_days: number; locale: string
}

export async function generateRecommendations(tx: Tx): Promise<{ created: number; expired: number; drafts: number }> {
  const expired = await tx`update crm.recommendations set status = 'expired' where status = 'open' and expires_at < now()`
  const rows = await tx<FactRow[]>`
    with s as (select m.code, m.default_locale, coalesce(s.level, 'suggest') as level, coalesce(s.quiet_days, 9) as quiet_days
                 from crm.markets m left join crm.ia_settings s on s.market_code = m.code where m.status = 'live')
    select a.id, a.market_code, a.owner_id, a.lifecycle, s.level, s.quiet_days, s.default_locale as locale,
           floor(extract(epoch from now() - a.created_at) / 86400)::int as days_created,
           floor(extract(epoch from now() - coalesce(app.last_contact_at(a.id), a.created_at)) / 86400)::int as days_quiet,
           exists (select 1 from crm.merchant_metrics_daily mm where mm.account_id = a.id and mm.first_txn_at is not null) as first_txn,
           (select mm.txn_count_30d from crm.merchant_metrics_daily mm where mm.account_id = a.id order by mm.as_of desc limit 1) as txn_now,
           (select mm.txn_count_30d from crm.merchant_metrics_daily mm where mm.account_id = a.id
             and mm.as_of <= (select max(m2.as_of) from crm.merchant_metrics_daily m2 where m2.account_id = a.id) - 28 order by mm.as_of desc limit 1) as txn_before,
           exists (select 1 from crm.deals d where d.account_id = a.id and d.status = 'open' and d.revisit_needed) as revisit,
           exists (select 1 from crm.ia_holdouts h where h.territory_id = a.territory_id) as holdout
      from crm.accounts a join s on s.code = a.market_code
     where a.archived_at is null and a.merged_into is null and a.lifecycle in ('onboarding','active','at_risk') and s.level <> 'off'
     order by a.id limit 5000`
  let created = 0
  let drafts = 0
  const agent = AGENTS[0]!
  for (const r of rows) {
    const facts: NextFacts = { lifecycle: r.lifecycle, daysSinceCreated: r.days_created, firstTxn: r.first_txn, daysQuiet: r.days_quiet, txnNow: r.txn_now, txnBefore: r.txn_before, revisit: r.revisit }
    for (const sig of nextActions(facts, r.quiet_days)) {
      const ins = await tx<{ id: string }[]>`
        insert into crm.recommendations (market_code, account_id, owner_id, rule_code, signal, holdout, expires_at)
        select ${r.market_code}, ${r.id}, ${r.owner_id}, ${sig.rule}, ${tx.json({ ...sig, txn_now: r.txn_now, txn_before: r.txn_before } as never)}, ${r.holdout}, now() + make_interval(days => ${EXPIRES_DAYS})
         where not exists (select 1 from crm.recommendations x where x.account_id = ${r.id} and x.rule_code = ${sig.rule} and x.status = 'open')
           and (select count(*) from crm.recommendations x where x.account_id = ${r.id} and x.status = 'open') < 3
        returning id`
      if (!ins[0]) continue
      created += 1
      const level = effectiveLevel(r.level, agent)
      if (!r.holdout && (level === 'draft' || level === 'execute')) {
        const title = NEXT_TITLE[sig.rule][r.locale === 'en' ? 1 : 0]
        await tx`insert into crm.ia_drafts (market_code, agent, level, recommendation_id, account_id, owner_id, action, subject, due_on)
                 values (${r.market_code}, ${agent.key}, ${level}, ${ins[0].id}, ${r.id}, ${r.owner_id}, 'create_task', ${title},
                         ${level === 'execute' ? tx`(now() at time zone (select timezone from crm.markets where code = ${r.market_code}))::date + 1` : null})`
        drafts += 1
      }
    }
  }
  if (rows.length) await logCall(tx, { feature: 'next_action', mode: 'rules', input: { accounts: rows.length }, outcome: 'answered', via: 'job', diff: { created, drafts } })
  return { created, expired: expired.count, drafts }
}

/** Mide cada sugerencia cerrada (o del grupo de control) después de 14 días: si se siguió y qué pasó. Con las mismas reglas para los dos grupos. */
export async function measureRecommendations(tx: Tx): Promise<number> {
  const res = await tx`
    update crm.recommendations r set
      followed = (r.status = 'accepted' and (exists (select 1 from crm.activities x where x.account_id = r.account_id and x.done_at is not null
                   and x.kind in ('visit','call','note','meeting') and x.done_at >= r.decided_at and x.done_at < r.decided_at + make_interval(days => ${MEASURE_DAYS}))
                   or exists (select 1 from crm.visits v where v.account_id = r.account_id and v.checked_in_at >= r.decided_at and v.checked_in_at < r.decided_at + make_interval(days => ${MEASURE_DAYS})))),
      outcome = case
        when exists (select 1 from crm.merchant_metrics_daily mm where mm.account_id = r.account_id and mm.as_of > r.created_at::date
                      and (mm.txn_count_30d > coalesce((r.signal ->> 'txn_now')::int, 0) or (r.rule_code = 'no_first_sale' and mm.first_txn_at is not null))) then 'sale_up'
        when exists (select 1 from crm.activities x where x.account_id = r.account_id and x.done_at is not null and x.kind in ('visit','call','note','meeting')
                      and x.done_at >= r.created_at and x.done_at < r.created_at + make_interval(days => ${MEASURE_DAYS}))
          or exists (select 1 from crm.visits v where v.account_id = r.account_id and v.checked_in_at >= r.created_at and v.checked_in_at < r.created_at + make_interval(days => ${MEASURE_DAYS})) then 'contacted'
        else 'no_change' end,
      measured_at = now()
     where r.measured_at is null and r.created_at < now() - make_interval(days => ${MEASURE_DAYS}) and (r.status <> 'open' or r.holdout)`
  return res.count
}

// ================================================================ IA-02: aceptar o descartar
type RecRow = { id: string; market_code: string; account_id: string; owner_id: string | null; rule_code: NextRule; status: string; holdout: boolean }

async function openRec(tx: Tx, id: string): Promise<RecRow> {
  const r = (await tx<RecRow[]>`select id, market_code, account_id, owner_id, rule_code, status, holdout from crm.recommendations where id = ${id} for update`)[0]
  if (!r || r.holdout) throw notFound()
  if (r.status !== 'open') throw invalid('Esta sugerencia ya se atendió.', 'This suggestion was already handled.')
  return r
}

/** Aceptar es comprometerse con una fecha: queda una tarea a nombre de quien lleva la cuenta (o de quien acepta). */
export async function acceptRecommendation(ctx: Ctx, id: string, dueOn: string): Promise<string> {
  if (!DAY.test(dueOn)) throw invalid('Elige la fecha en que lo vas a hacer.', 'Choose the date you will do it.')
  return withUser(ctx.user.id, async (tx) => {
    const r = await openRec(tx, id)
    ctx.assert('ia.act', r.market_code)
    const subject = ctx.t(...NEXT_TITLE[r.rule_code])
    const owner = r.owner_id ?? ctx.user.id
    const task = await tx<{ id: string }[]>`
      insert into crm.activities (market_code, account_id, kind, subject, due_at, owner_id, created_by)
      values (${r.market_code}, ${r.account_id}, 'task', ${subject}, ${`${dueOn}T15:00:00Z`}, ${owner}, ${ctx.user.id}) returning id`
    await tx`update crm.recommendations set status = 'accepted', decided_by = ${ctx.user.id}, decided_at = now(), task_id = ${task[0]!.id} where id = ${id}`
    await audit(tx, ctx, 'activity.added', 'activity', task[0]!.id, r.market_code, null, { kind: 'task', subject, due_on: dueOn, account_id: r.account_id })
    await audit(tx, ctx, 'recommendation.accepted', 'recommendation', id, r.market_code, { status: 'open' }, { status: 'accepted', rule: r.rule_code, task_id: task[0]!.id, due_on: dueOn })
    return task[0]!.id
  })
}

const dismissInput = z.object({ code: z.enum(DISMISS_CODES), note: z.string().trim().max(300).optional().default('') })
export async function dismissRecommendation(ctx: Ctx, id: string, raw: z.input<typeof dismissInput>): Promise<void> {
  const p = dismissInput.safeParse(raw)
  if (!p.success) throw invalid('Elige por qué la descartas.', 'Choose why you are dismissing it.')
  if (p.data.code === 'other' && p.data.note.length < 3) throw invalid('Escribe el motivo (al menos 3 letras).', 'Write the reason (at least 3 characters).')
  assertNoProhibited(p.data.note)
  await withUser(ctx.user.id, async (tx) => {
    const r = await openRec(tx, id)
    ctx.assert('ia.act', r.market_code)
    await tx`update crm.recommendations set status = 'dismissed', decided_by = ${ctx.user.id}, decided_at = now(), dismiss_code = ${p.data.code}, dismiss_note = ${clean(p.data.note)} where id = ${id}`
    await audit(tx, ctx, 'recommendation.dismissed', 'recommendation', id, r.market_code, { status: 'open' }, { status: 'dismissed', rule: r.rule_code, reason: p.data.code })
  })
}

// ================================================================ IA-04: nivel por mercado, supervisión y control
const settingsInput = z.object({ level: z.enum(LEVELS), supervisorId: z.guid().or(z.literal('')).optional().default(''), quietDays: z.coerce.number().int().min(3).max(90) })
export async function setIaSettings(ctx: Ctx, market: string, raw: z.input<typeof settingsInput>): Promise<void> {
  ctx.assert('ia.manage', market)
  const p = settingsInput.safeParse(raw)
  if (!p.success) throw invalid('Revisa el nivel y los días sin contacto (de 3 a 90).', 'Check the level and the days without contact (3 to 90).')
  const sup = p.data.supervisorId || null
  if ((p.data.level === 'draft' || p.data.level === 'execute') && !sup) throw invalid('Para redactar o proponer tareas, nombra a la persona que revisa lo que hace cada semana.', 'To draft or propose tasks, name the person who reviews what it does each week.')
  await withUser(ctx.user.id, async (tx) => {
    if (sup && !(await tx`select 1 from crm.users where id = ${sup} and is_active and not is_system`)[0]) throw invalid('Esa persona no está activa en CONTIGO.', 'That person is not active in CONTIGO.')
    // IA-07: un agente que actúa (redacta o propone) no se enciende sin su revisión de red-team aprobada (Administración, IA, Red-team).
    if (p.data.level === 'draft' || p.data.level === 'execute') {
      const missing = await agentsWithoutRedteam(tx, AGENTS.map((a) => a.key))
      if (missing.length > 0) throw invalid('Antes de encender un agente que redacta o propone, deja su revisión de red-team aprobada en Administración, IA.', 'Before turning on an agent that drafts or proposes, record its passed red-team review in Administration, AI.')
    }
    const before = (await tx<{ level: string; supervisor_id: string | null; quiet_days: number }[]>`select level, supervisor_id, quiet_days from crm.ia_settings where market_code = ${market}`)[0] ?? null
    await tx`insert into crm.ia_settings (market_code, level, supervisor_id, quiet_days, updated_by, updated_at)
             values (${market}, ${p.data.level}, ${sup}, ${p.data.quietDays}, ${ctx.user.id}, now())
             on conflict (market_code) do update set level = excluded.level, supervisor_id = excluded.supervisor_id, quiet_days = excluded.quiet_days,
               updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'ia.settings_changed', 'ia_settings', null, market, before, { level: p.data.level, supervisor_id: sup, quiet_days: p.data.quietDays })
  })
}

/** La revisión semanal de lo que propuso el agente: la deja quien supervisa (o administración). */
export async function recordSpotCheck(ctx: Ctx, market: string, note: string): Promise<void> {
  const n = note.trim()
  if (n.length < 5) throw invalid('Escribe qué revisaste (al menos 5 letras).', 'Write what you reviewed (at least 5 characters).')
  assertNoProhibited(n)
  await withUser(ctx.user.id, async (tx) => {
    const s = (await tx<{ supervisor_id: string | null }[]>`select supervisor_id from crm.ia_settings where market_code = ${market}`)[0]
    if (!s) throw notFound()
    if (s.supervisor_id !== ctx.user.id) ctx.assert('ia.manage', market)
    await tx`update crm.ia_settings set last_spot_check_at = now(), last_spot_check_by = ${ctx.user.id}, spot_check_note = ${n.slice(0, 400)} where market_code = ${market}`
    await audit(tx, ctx, 'ia.spot_checked', 'ia_settings', null, market, null, { note_length: n.length })
  })
}

export async function setHoldout(ctx: Ctx, territoryId: string, on: boolean): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const t = (await tx<{ market_code: string }[]>`select market_code from crm.territories where id = ${territoryId}`)[0]
    if (!t) throw notFound()
    ctx.assert('ia.manage', t.market_code)
    if (on) await tx`insert into crm.ia_holdouts (territory_id, market_code, created_by) values (${territoryId}, ${t.market_code}, ${ctx.user.id}) on conflict do nothing`
    else await tx`delete from crm.ia_holdouts where territory_id = ${territoryId}`
    await audit(tx, ctx, on ? 'ia.holdout_added' : 'ia.holdout_removed', 'territory', territoryId, t.market_code, null, { holdout: on })
  })
}

// ================================================================ IA-04: borradores
type DraftRow = { id: string; market_code: string; account_id: string; owner_id: string | null; level: 'draft' | 'execute'; subject: string; due_on: string | null; status: string; recommendation_id: string | null }

export async function decideDraft(ctx: Ctx, id: string, d: { approve: boolean; subject?: string; dueOn?: string; note?: string }): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const r = (await tx<DraftRow[]>`select id, market_code, account_id, owner_id, level, subject, due_on::text, status, recommendation_id from crm.ia_drafts where id = ${id} for update`)[0]
    if (!r) throw notFound()
    ctx.assert('ia.act', r.market_code)
    if (r.status !== 'pending') throw invalid('Este borrador ya se decidió.', 'This draft was already decided.')
    if (!d.approve) {
      const note = (d.note ?? '').trim()
      if (note.length < 3) throw invalid('Escribe por qué lo rechazas (al menos 3 letras).', 'Write why you are rejecting it (at least 3 characters).')
      assertNoProhibited(note)
      await tx`update crm.ia_drafts set status = 'rejected', decided_by = ${ctx.user.id}, decided_at = now(), decision_note = ${note} where id = ${id}`
      await audit(tx, ctx, 'ia.draft_rejected', 'ia_draft', id, r.market_code, { status: 'pending' }, { status: 'rejected' })
      return
    }
    // "Redacta borrador": la persona revisa el texto y pone la fecha. "Ejecuta con aprobación": viene completo y se aprueba como está.
    const subject = (d.subject ?? '').trim() || r.subject
    const dueOn = (d.dueOn ?? '').trim() || r.due_on || ''
    if (subject.length < 2 || subject.length > 200) throw invalid('Escribe de qué se trata la tarea.', 'Say what the task is about.')
    if (!DAY.test(dueOn)) throw invalid('Elige la fecha de la tarea.', 'Choose the task date.')
    assertNoProhibited(subject)
    const task = await tx<{ id: string }[]>`
      insert into crm.activities (market_code, account_id, kind, subject, due_at, owner_id, created_by)
      values (${r.market_code}, ${r.account_id}, 'task', ${subject}, ${`${dueOn}T15:00:00Z`}, ${r.owner_id ?? ctx.user.id}, ${ctx.user.id}) returning id`
    await audit(tx, ctx, 'activity.added', 'activity', task[0]!.id, r.market_code, null, { kind: 'task', subject, due_on: dueOn, account_id: r.account_id })
    await tx`update crm.ia_drafts set status = 'approved', subject = ${subject}, due_on = ${dueOn}, decided_by = ${ctx.user.id}, decided_at = now(), result_ref = ${task[0]!.id} where id = ${id}`
    if (r.recommendation_id) {
      await tx`update crm.recommendations set status = 'accepted', decided_by = ${ctx.user.id}, decided_at = now(), task_id = ${task[0]!.id} where id = ${r.recommendation_id} and status = 'open'`
    }
    await logCall(tx, { feature: 'agent_draft', mode: 'rules', input: { draft: id }, tool: { name: 'create_task', account_id: r.account_id, due_on: dueOn },
      diff: { subject_changed: subject !== r.subject, due_changed: dueOn !== (r.due_on ?? '') }, outcome: 'answered' })
    await audit(tx, ctx, 'ia.draft_approved', 'ia_draft', id, r.market_code, { status: 'pending' }, { status: 'approved', task_id: task[0]!.id, edited: subject !== r.subject })
  })
}

// ================================================================ IA-03: pesos y clasificación
export async function setLeadWeights(ctx: Ctx, market: string, weights: Partial<Record<ScoreFactor, number>>): Promise<void> {
  ctx.assert('ia.manage', market)
  for (const [k, v] of Object.entries(weights)) {
    if (!(SCORE_FACTORS as readonly string[]).includes(k) || !Number.isInteger(v) || v! < -50 || v! > 50) throw invalid('Cada peso va de -50 a 50, en números enteros.', 'Each weight goes from -50 to 50, in whole numbers.')
  }
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ factor: string; weight: number }[]>`select factor, weight from crm.lead_score_weights where market_code = ${market}`
    for (const [k, v] of Object.entries(weights)) {
      await tx`insert into crm.lead_score_weights (market_code, factor, weight, updated_by) values (${market}, ${k}, ${v!}, ${ctx.user.id})
               on conflict (market_code, factor) do update set weight = excluded.weight, updated_by = excluded.updated_by, updated_at = now()`
    }
    await audit(tx, ctx, 'ia.lead_weights_changed', 'lead_score_weights', null, market, Object.fromEntries(before.map((b) => [b.factor, b.weight])), weights)
  })
}

export async function leadWeights(tx: Tx, market: string): Promise<Partial<Record<ScoreFactor, number>>> {
  const rows = await tx<{ factor: ScoreFactor; weight: number }[]>`select factor, weight from crm.lead_score_weights where market_code = ${market}`
  return Object.fromEntries(rows.map((r) => [r.factor, r.weight]))
}

export type LeadFactRow = { id: string; market_code: string; status: string; motor: string | null; account_type: string | null; source: string | null; phone: boolean; email: boolean; business_name: boolean; locality: boolean; consent: boolean; referral: boolean; touched: boolean; duplicate: boolean; message: string | null }
export const leadFacts = (r: LeadFactRow): LeadFacts => ({
  status: r.status, motor: r.motor, accountType: r.account_type, source: r.source, phone: r.phone, email: r.email, businessName: r.business_name,
  locality: r.locality, consent: r.consent, referral: r.referral, touched: r.touched, duplicate: r.duplicate, message: r.message,
})
export const LEAD_FACTS_SQL = (tx: Tx) => tx`
  l.id, l.market_code, l.status, l.motor, l.account_type, l.source, l.message,
  (l.phone is not null) as phone, (l.email is not null) as email, (coalesce(btrim(l.business_name), '') <> '') as business_name,
  (coalesce(btrim(l.locality), '') <> '') as locality, (l.consent_at is not null) as consent, (l.referred_by_account_id is not null) as referral,
  (l.first_touch_at is not null) as touched, (l.duplicate_of is not null) as duplicate`

/**
 * La clasificación la confirma una persona. Si algún día el modelo está encendido y pasó su evaluación, su propuesta llega por el
 * adaptador con el texto del lead citado como dato no confiable y solo puede ser una de las cinco clases; si no, propone la regla.
 */
export async function confirmLeadClass(ctx: Ctx, leadId: string, cls: string): Promise<void> {
  if (!(LEAD_CLASSES as readonly string[]).includes(cls)) throw invalid('Elige una clasificación.', 'Choose a classification.')
  await withUser(ctx.user.id, async (tx) => {
    const r = (await tx<LeadFactRow[]>`select ${LEAD_FACTS_SQL(tx)} from crm.leads l where l.id = ${leadId}`)[0]
    if (!r) throw notFound()
    ctx.assert('lead.work', r.market_code)
    const facts = leadFacts(r)
    const rules = classifyLead(facts).cls
    const proposed = await proposeLeadClass(tx, facts, rules)
    const score = scoreLead(facts, await leadWeights(tx, r.market_code)).score
    await tx`insert into crm.lead_classifications (lead_id, market_code, proposed, confirmed, score, confirmed_by)
             values (${leadId}, ${r.market_code}, ${proposed}, ${cls}, ${score}, ${ctx.user.id})
             on conflict (lead_id) do update set proposed = excluded.proposed, confirmed = excluded.confirmed, score = excluded.score, confirmed_by = excluded.confirmed_by, confirmed_at = now()`
    await audit(tx, ctx, 'ia.lead_classified', 'lead', leadId, r.market_code, null, { proposed, confirmed: cls, score })
  })
}

async function proposeLeadClass(tx: Tx, facts: LeadFacts, rules: LeadClass | null): Promise<LeadClass | null> {
  const ai = aiAdapter()
  const on = await featureOn(tx, 'lead_class')
  const data = facts.message ? [asQuotedData(facts.message, 'web_form')] : []
  if (!on || !rules) {
    await logCall(tx, { feature: 'lead_class', mode: ai.mode === 'off' ? 'off' : 'rules', input: facts, untrusted: data.length > 0, outcome: 'not_sent' })
    return rules
  }
  const res = await ai.ask({ feature: 'lead_class', choices: LEAD_CLASSES, data, rules })
  await logCall(tx, { feature: 'lead_class', mode: ai.mode, input: facts, untrusted: data.length > 0, outcome: res.status === 'off' ? 'not_sent' : res.status, diff: { rules, answer: res.answer }, costUsd: res.costUsd })
  return res.answer
}

// ================================================================ IA-08: evaluación
export type EvalCase = { id: string; feature: AiFeature; label: string; input: Record<string, unknown>; expected: string; adversarial: boolean }
export type EvalOutcome = { target: 'rules' | 'adapter'; total: number; passed: number; meets: boolean; failures: { id: string; label: string; expected: string; got: string }[] }

/** La respuesta de las reglas a un caso. Es lo que hoy usa CONTIGO y lo que el modelo tendría que igualar o mejorar. */
export function rulesAnswer(c: Pick<EvalCase, 'feature' | 'input'>): string {
  const i = c.input as Record<string, string & number & boolean>
  switch (c.feature) {
    case 'lead_class':
      return classifyLead({ status: i.status ?? 'new', motor: i.motor, accountType: i.account_type, message: i.message }).cls ?? 'none'
    case 'next_action':
      return topAction({ lifecycle: String(i.lifecycle ?? ''), daysSinceCreated: i.days_since_created, firstTxn: !!i.first_txn, daysQuiet: i.days_quiet ?? 0, txnNow: i.txn_now, txnBefore: i.txn_before, revisit: !!i.revisit })
    case 'metric_question':
      return matchQuestion(String(i.q ?? ''))
    case 'capture': {
      const text = String(i.text ?? '').replace('{card}', '4' + '1'.repeat(15))
      return hasProhibited(text) ? 'rejected' : 'draft'
    }
  }
}

const CHOICES: Record<AiFeature, readonly string[]> = {
  lead_class: [...LEAD_CLASSES, 'none'],
  next_action: ['no_first_sale', 'quiet_dropping', 'quiet', 'revisit', 'none'],
  metric_question: ['won', 'lost', 'leads', 'qualified', 'open', 'awaiting', 'active', 'risk', 'revisits', 'out_of_scope'],
  capture: ['draft', 'rejected'],
}

/** Corre el banco de casos de una función contra las reglas y contra el adaptador. Con el adaptador apagado, esa corrida no pasa. */
export async function runEvaluation(ctx: Ctx, feature: AiFeature, simulated?: Record<string, string>): Promise<EvalOutcome[]> {
  ctx.assert('ia.manage')
  if (!(feature in THRESHOLD)) throw invalid('Elige una función.', 'Choose a feature.')
  const ai = aiAdapter()
  return withUser(ctx.user.id, async (tx) => {
    const cases = await tx<EvalCase[]>`select id, feature, label, input, expected, adversarial from crm.ia_eval_cases where feature = ${feature} and is_active order by created_at, id`
    if (cases.length === 0) throw invalid('Esta función no tiene casos activos. Agrega al menos uno.', 'This feature has no active cases. Add at least one.')
    const out: EvalOutcome[] = []
    for (const target of ['rules', 'adapter'] as const) {
      const failures: EvalOutcome['failures'] = []
      let cost = 0
      for (const c of cases) {
        const rules = rulesAnswer(c)
        let got = rules
        if (target === 'adapter') {
          if (ai.mode === 'off') got = 'adapter_off'
          else {
            const res = await ai.ask({ feature, choices: CHOICES[feature], data: [asQuotedData(JSON.stringify(c.input), 'api_form')], rules, simulatedAnswer: simulated?.[c.id] })
            got = res.status === 'answered' ? res.answer : `refused:${res.answer}`
            cost += res.costUsd
          }
        }
        if (got !== c.expected) failures.push({ id: c.id, label: c.label, expected: c.expected, got })
      }
      const passed = cases.length - failures.length
      const meets = passed / cases.length >= THRESHOLD[feature] && !(target === 'adapter' && ai.mode === 'off')
      await tx`insert into crm.ia_eval_runs (feature, target, adapter_mode, prompt_version, total, passed, threshold, meets_threshold, failures, cost_usd, ran_by)
               values (${feature}, ${target}, ${ai.mode}, ${PROMPT_VERSION[feature]}, ${cases.length}, ${passed}, ${THRESHOLD[feature]}, ${meets}, ${tx.json(failures as never)}, ${cost}, ${ctx.user.id})`
      out.push({ target, total: cases.length, passed, meets, failures })
    }
    await logCall(tx, { feature: 'eval', mode: ai.mode, input: { feature, cases: cases.length }, outcome: 'answered', via: 'eval', diff: { rules: out[0]!.passed, adapter: out[1]!.passed } })
    await audit(tx, ctx, 'ia.eval_run', 'ia_eval', null, null, null, { feature, total: cases.length, rules_passed: out[0]!.passed, adapter_passed: out[1]!.passed, adapter_mode: ai.mode })
    return out
  })
}

const caseInput = z.object({ feature: z.enum(['next_action', 'lead_class', 'metric_question', 'capture']), label: z.string().trim().min(3).max(120), question: z.string().trim().min(3).max(300), expected: z.string().trim().min(1).max(80), adversarial: z.boolean().optional().default(false) })
/** Desde la pantalla se agregan casos de preguntas y de captura (texto). Los de reglas con datos se agregan con la migración o la API interna. */
export async function addEvalCase(ctx: Ctx, raw: z.input<typeof caseInput>): Promise<void> {
  ctx.assert('ia.manage')
  const p = caseInput.safeParse(raw)
  if (!p.success) throw invalid('El caso lleva nombre, texto y respuesta esperada.', 'A case needs a name, a text and an expected answer.')
  if (!CHOICES[p.data.feature].includes(p.data.expected)) throw invalid('La respuesta esperada tiene que ser una de las que la función puede dar.', 'The expected answer must be one the feature can give.')
  assertNoProhibited(p.data.label, p.data.question)
  const input = p.data.feature === 'metric_question' ? { q: p.data.question } : p.data.feature === 'capture' ? { text: p.data.question } : null
  if (!input) throw invalid('Desde aquí se agregan casos de preguntas y de captura.', 'Question and capture cases are added from here.')
  await withUser(ctx.user.id, async (tx) => {
    const r = await tx<{ id: string }[]>`insert into crm.ia_eval_cases (feature, label, input, expected, adversarial, created_by)
             values (${p.data.feature}, ${p.data.label}, ${tx.json(input)}, ${p.data.expected}, ${p.data.adversarial}, ${ctx.user.id}) returning id`
    await audit(tx, ctx, 'ia.eval_case_added', 'ia_eval', r[0]!.id, null, null, { feature: p.data.feature, expected: p.data.expected })
  })
}

export const EVAL_CHOICES = CHOICES
