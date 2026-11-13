import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'

/**
 * LEAD-03: ruteo y asignación. Una lista ordenada de reglas por mercado; la primera que coincide con el lead y encuentra a
 * alguien disponible decide. No es un segundo motor de automatizaciones: aquellas reaccionan después (avisan, crean tareas,
 * reasignan lo vencido); esta lista decide en el momento en que el lead entra, en orden, y se puede simular sin gastar turno.
 *
 * Acciones: heredar de quien lleva el comercio (o su cuenta padre), una persona fija, el turno rotativo de siempre
 * (crm.routing_rules, una regla más) o quien cubre el territorio. Tope por persona: con ese número de leads abiertos la
 * regla no le entrega otro. Nunca entrega a quien ya no vende en el mercado. Cada decisión queda en crm.assignment_log.
 */
export const RULE_ACTIONS = ['inherit_account', 'user', 'rotation', 'territory'] as const
export type RuleAction = (typeof RULE_ACTIONS)[number]
export const ACTION_LABEL: Record<RuleAction, { es: string; en: string }> = {
  inherit_account: { es: 'A quien ya lleva el comercio o su cuenta padre', en: 'To whoever already owns the merchant or its parent account' },
  user: { es: 'A una persona', en: 'To one person' },
  rotation: { es: 'Por turno rotativo', en: 'By rotation' },
  territory: { es: 'A quien cubre el territorio', en: 'To whoever covers the territory' },
}
export type RuleMatch = { sources?: string[]; motors?: string[]; form_ids?: string[]; territory_ids?: string[]; size_min?: number; size_max?: number }
export type LeadFacts = {
  market: string
  source: string
  motor: string
  formId?: string | null
  locality?: string | null
  sizeUnits?: number | null
  /** Comercio al que el lead ya está ligado (o del que parece ser), para heredar a quien lo lleva. */
  accountId?: string | null
  /** El turno del formulario: decide si ninguna regla lo hizo (lo de antes sigue valiendo). */
  formRotationId?: string | null
}
export type RouteStep = { rule: string; outcome: 'no_match' | 'assigned' | 'nobody' | 'capped'; note?: string }
export type Routed = {
  ownerId: string | null
  by: 'rule' | 'form_rotation' | 'market_lead' | 'unassigned'
  ruleId: string | null
  ruleName: string | null
  action: string
  slaMinutes: number | null
  steps: RouteStep[]
}
type Rule = { id: string; position: number; name: string; match: RuleMatch; action: RuleAction; user_id: string | null; routing_rule_id: string | null; cap_open: number | null; sla_minutes: number | null }

async function territoryOf(tx: Tx, market: string, locality: string | null | undefined): Promise<string | null> {
  const place = (locality ?? '').trim()
  if (!place) return null
  const rows = await tx<{ id: string }[]>`
    select id from crm.territories where market_code = ${market} and archived_at is null
       and (lower(${place}) like '%' || lower(name) || '%' or lower(name) like '%' || lower(${place}) || '%') order by length(name) desc limit 1`
  return rows[0]?.id ?? null
}

export function ruleMatches(m: RuleMatch, f: LeadFacts, territoryId: string | null): boolean {
  if (m.sources?.length && !m.sources.includes(f.source)) return false
  if (m.motors?.length && !m.motors.includes(f.motor)) return false
  if (m.form_ids?.length && !(f.formId && m.form_ids.includes(f.formId))) return false
  if (m.territory_ids?.length && !(territoryId && m.territory_ids.includes(territoryId))) return false
  if (m.size_min !== undefined && !((f.sizeUnits ?? 0) >= m.size_min)) return false
  if (m.size_max !== undefined && !(f.sizeUnits != null && f.sizeUnits <= m.size_max)) return false
  return true
}

const eligible = async (tx: Tx, userId: string, market: string, cap: number | null): Promise<'ok' | 'inactive' | 'capped'> => {
  const r = await tx<{ sells: boolean; open: number }[]>`select app.can_sell_in(${userId}, ${market}) as sells, app.open_leads_of(${userId}, ${market}) as open`
  if (!r[0]?.sells) return 'inactive'
  if (cap !== null && r[0].open >= cap) return 'capped'
  return 'ok'
}

/**
 * Decide a quién le toca un lead. Con `dryRun` no gasta el turno ni escribe nada: es el simulador "a quién le caería".
 * Con `rulesOnly` solo aplican las reglas escritas (para vías que hoy entran sin dueño a propósito, como la importación).
 */
export async function resolveOwner(tx: Tx, f: LeadFacts, opts: { dryRun?: boolean; rulesOnly?: boolean } = {}): Promise<Routed> {
  const rules = await tx<Rule[]>`
    select id, position, name, match, action, user_id, routing_rule_id, cap_open, sla_minutes from crm.assignment_rules
     where market_code = ${f.market} and is_active order by position, created_at`
  const territoryId = rules.length ? await territoryOf(tx, f.market, f.locality) : null
  const steps: RouteStep[] = []
  for (const r of rules) {
    if (!ruleMatches(r.match ?? {}, f, territoryId)) {
      steps.push({ rule: r.name, outcome: 'no_match' })
      continue
    }
    let pick: string | null = null
    let why: RouteStep['outcome'] = 'nobody'
    if (r.action === 'inherit_account') {
      const owners = f.accountId ? await tx<{ owner_id: string | null }[]>`
        select o.owner_id from (
          select a.owner_id, 0 as depth from crm.accounts a where a.id = ${f.accountId}
          union all
          select p.owner_id, 1 from crm.accounts a join crm.accounts p on p.id = a.parent_id where a.id = ${f.accountId}
        ) o where o.owner_id is not null order by o.depth` : []
      for (const o of owners) {
        const e = await eligible(tx, o.owner_id!, f.market, r.cap_open)
        if (e === 'ok') { pick = o.owner_id; break }
        if (e === 'capped') why = 'capped'
      }
    } else if (r.action === 'user' && r.user_id) {
      const e = await eligible(tx, r.user_id, f.market, r.cap_open)
      if (e === 'ok') pick = r.user_id
      else if (e === 'capped') why = 'capped'
    } else if (r.action === 'rotation' && r.routing_rule_id) {
      const p = await tx<{ owner: string | null }[]>`select app.rr_pick(${r.routing_rule_id}, ${r.cap_open}, ${!opts.dryRun}) as owner`
      pick = p[0]?.owner ?? null
      if (!pick && r.cap_open !== null) why = 'capped'
    } else if (r.action === 'territory' && territoryId) {
      const people = await tx<{ user_id: string; open: number }[]>`
        select ut.user_id, app.open_leads_of(ut.user_id, ${f.market}) as open from crm.user_territories ut
         where ut.territory_id = ${territoryId} and app.can_sell_in(ut.user_id, ${f.market}) order by 2, 1`
      const free = people.find((p) => r.cap_open === null || p.open < r.cap_open)
      pick = free?.user_id ?? null
      if (!pick && people.length) why = 'capped'
    }
    if (pick) {
      steps.push({ rule: r.name, outcome: 'assigned' })
      return { ownerId: pick, by: 'rule', ruleId: r.id, ruleName: r.name, action: r.action, slaMinutes: r.sla_minutes, steps }
    }
    steps.push({ rule: r.name, outcome: why })
  }
  if (opts.rulesOnly) return { ownerId: null, by: 'unassigned', ruleId: null, ruleName: null, action: 'none', slaMinutes: null, steps }
  if (f.formRotationId) {
    const p = await tx<{ owner: string | null; sla: number | null }[]>`
      select app.rr_pick(${f.formRotationId}, null, ${!opts.dryRun}) as owner, (select sla_minutes from crm.routing_rules where id = ${f.formRotationId}) as sla`
    if (p[0]?.owner) return { ownerId: p[0].owner, by: 'form_rotation', ruleId: null, ruleName: null, action: 'form_rotation', slaMinutes: p[0].sla, steps }
  }
  // E3.F10: la última red. Antes de dejar un lead sin dueño, le toca a quien lidera el mercado.
  const lead = await tx<{ id: string | null }[]>`select app.market_lead_of(${f.market}) as id`
  if (lead[0]?.id) return { ownerId: lead[0].id, by: 'market_lead', ruleId: null, ruleName: null, action: 'market_lead', slaMinutes: null, steps }
  return { ownerId: null, by: 'unassigned', ruleId: null, ruleName: null, action: 'none', slaMinutes: null, steps }
}

/** La bitácora de la asignación: qué regla decidió, a quién le tocó y qué reglas no pudieron (y por qué). */
export async function logAssignment(tx: Tx, market: string, leadId: string, r: Routed): Promise<void> {
  await tx`insert into crm.assignment_log (market_code, lead_id, rule_id, rule_name, action, owner_id, detail)
           values (${market}, ${leadId}, ${r.ruleId}, ${r.ruleName}, ${r.action}, ${r.ownerId}, ${tx.json({ by: r.by, steps: r.steps } as never)})`
}

const matchInput = z.object({
  sources: z.array(z.string().regex(/^[a-z_]{2,30}$/)).max(12).optional(),
  motors: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,30}$/)).max(12).optional(),
  formIds: z.array(z.guid()).max(20).optional(),
  territoryIds: z.array(z.guid()).max(50).optional(),
  sizeMin: z.number().int().min(1).max(100000).nullable().optional(),
  sizeMax: z.number().int().min(1).max(100000).nullable().optional(),
})
const ruleInput = z.object({
  market: z.string().length(2),
  name: z.string().trim().min(2).max(80),
  action: z.enum(RULE_ACTIONS),
  userId: z.guid().or(z.literal('')).optional(),
  rotationId: z.guid().or(z.literal('')).optional(),
  capOpen: z.number().int().min(1).max(500).nullable().optional(),
  slaMinutes: z.number().int().min(5).max(10080).nullable().optional(),
  match: matchInput,
})
export type RuleInput = z.input<typeof ruleInput>

const toMatch = (m: z.output<typeof matchInput>): RuleMatch => {
  const out: RuleMatch = {}
  if (m.sources?.length) out.sources = m.sources
  if (m.motors?.length) out.motors = m.motors
  if (m.formIds?.length) out.form_ids = m.formIds
  if (m.territoryIds?.length) out.territory_ids = m.territoryIds
  if (m.sizeMin != null) out.size_min = m.sizeMin
  if (m.sizeMax != null) out.size_max = m.sizeMax
  return out
}

export async function createAssignmentRule(ctx: Ctx, input: RuleInput): Promise<string> {
  ctx.assert('config.manage')
  const p = ruleInput.safeParse(input)
  if (!p.success) throw invalid('Ponle nombre a la regla y elige qué hace.', 'Give the rule a name and choose what it does.')
  const v = p.data
  if (v.match.sizeMin != null && v.match.sizeMax != null && v.match.sizeMin > v.match.sizeMax) throw invalid('El tamaño mínimo no puede ser mayor que el máximo.', 'The minimum size cannot be greater than the maximum.')
  return withUser(ctx.user.id, async (tx) => {
    if (v.action === 'user') {
      const ok = v.userId ? await tx<{ ok: boolean }[]>`select app.can_sell_in(${v.userId}, ${v.market}) as ok` : []
      if (!ok[0]?.ok) throw invalid('Elige a una persona que venda en ese mercado.', 'Choose a person who sells in that market.')
    }
    if (v.action === 'rotation') {
      const ok = v.rotationId ? await tx`select 1 from crm.routing_rules where id = ${v.rotationId} and market_code = ${v.market}` : []
      if (!ok[0]) throw invalid('Elige un turno de ese mercado.', 'Choose a rotation from that market.')
    }
    const id = await newId(tx)
    const match = toMatch(v.match)
    await tx`insert into crm.assignment_rules (id, market_code, position, name, match, action, user_id, routing_rule_id, cap_open, sla_minutes, created_by)
             values (${id}, ${v.market}, (select coalesce(max(position), 0) + 1 from crm.assignment_rules where market_code = ${v.market}), ${v.name}, ${tx.json(match as never)},
                     ${v.action}, ${v.action === 'user' ? v.userId! : null}, ${v.action === 'rotation' ? v.rotationId! : null}, ${v.capOpen ?? null}, ${v.slaMinutes ?? null}, ${ctx.user.id})`
    await audit(tx, ctx, 'routing.assignment_rule_created', 'assignment_rule', id, v.market, null, { name: v.name, action: v.action, match, cap_open: v.capOpen ?? null })
    return id
  })
}

/** Activar o pausar una regla, o subirla y bajarla en el orden. El orden decide: la primera que coincide gana. */
export async function changeAssignmentRule(ctx: Ctx, id: string, change: { active?: boolean; move?: 'up' | 'down'; capOpen?: number | null }): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; market_code: string; position: number; is_active: boolean; name: string; cap_open: number | null }[]>`
      select id, market_code, position, is_active, name, cap_open from crm.assignment_rules where id = ${id} for update`
    const r = rows[0]
    if (!r) throw notFound('No encontramos esa regla.', 'We could not find that rule.')
    if (change.active !== undefined && change.active !== r.is_active) {
      await tx`update crm.assignment_rules set is_active = ${change.active}, updated_at = now() where id = ${id}`
      await audit(tx, ctx, 'routing.assignment_rule_toggled', 'assignment_rule', id, r.market_code, { is_active: r.is_active }, { is_active: change.active, name: r.name })
    }
    if (change.capOpen !== undefined && change.capOpen !== r.cap_open) {
      if (change.capOpen !== null && (!Number.isInteger(change.capOpen) || change.capOpen < 1 || change.capOpen > 500)) throw invalid('El tope va de 1 a 500 leads abiertos.', 'The cap goes from 1 to 500 open leads.')
      await tx`update crm.assignment_rules set cap_open = ${change.capOpen}, updated_at = now() where id = ${id}`
      await audit(tx, ctx, 'routing.assignment_rule_changed', 'assignment_rule', id, r.market_code, { cap_open: r.cap_open }, { cap_open: change.capOpen, name: r.name })
    }
    if (change.move) {
      const other = await tx<{ id: string; position: number }[]>`
        select id, position from crm.assignment_rules where market_code = ${r.market_code}
           and ${change.move === 'up' ? tx`position < ${r.position} order by position desc` : tx`position > ${r.position} order by position`} limit 1 for update`
      if (!other[0]) return
      await tx`update crm.assignment_rules set position = ${other[0].position}, updated_at = now() where id = ${id}`
      await tx`update crm.assignment_rules set position = ${r.position}, updated_at = now() where id = ${other[0].id}`
      await audit(tx, ctx, 'routing.assignment_rule_moved', 'assignment_rule', id, r.market_code, { position: r.position }, { position: other[0].position, name: r.name })
    }
  })
}

/** El simulador: con estos datos, a quién le caería el lead y por qué. No asigna nada ni gasta el turno. */
export async function simulateAssignment(ctx: Ctx, f: LeadFacts): Promise<Routed & { ownerName: string | null }> {
  if (!ctx.can('config.manage') && !ctx.can('lead.assign', f.market)) ctx.assert('config.manage')
  return withUser(ctx.user.id, async (tx) => {
    const forms = f.formId ? await tx<{ routing_rule_id: string | null }[]>`select routing_rule_id from crm.web_forms where id = ${f.formId} and market_code = ${f.market}` : []
    const out = await resolveOwner(tx, { ...f, formRotationId: forms[0]?.routing_rule_id ?? null }, { dryRun: true })
    const name = out.ownerId ? await tx<{ full_name: string }[]>`select full_name from crm.users where id = ${out.ownerId}` : []
    return { ...out, ownerName: name[0]?.full_name ?? null }
  })
}
