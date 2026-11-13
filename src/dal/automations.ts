import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { JOBS } from '@/server/jobs/registry'
import { canDecide } from '@/domain/automation/transitions'
import type { Action, Condition, Source } from '@/domain/automation/catalog'
import type { Role } from '@/domain/policy'

export type AutomationRow = {
  /** GOB-05: lo reconstruido desde Pipedrive lleva el nombre que tenía allá, su explicación y, si nació apagada, por qué. */
  pipedrive_ref: string | null; description_es: string | null; description_en: string | null; off_reason_es: string | null; off_reason_en: string | null

  id: string
  market_code: string
  motor: string | null
  key: string
  name_es: string
  name_en: string
  source: Source
  trigger_kind: 'schedule' | 'event'
  trigger_event: string | null
  conditions: Condition[]
  actions: Action[]
  is_active: boolean
  version: number
  owner_id: string | null
  owner_name: string | null
  /** AUT-03 (embudo2): quedó con administración por no tener dueño; falta que alguien lo confirme. */
  owner_review: boolean
  updated_by_name: string | null
  updated_at: Date
  last_at: Date | null
  done_7d: number
}

const SELECT = (tx: Parameters<Parameters<typeof withUser>[1]>[0]) => tx`
  select a.id, a.market_code, a.motor, a.key, a.name_es, a.name_en, a.source, a.trigger_kind, a.trigger_event, a.conditions, a.actions, a.is_active, a.version,
         a.pipedrive_ref, a.description_es, a.description_en, a.off_reason_es, a.off_reason_en,
         a.owner_id, o.full_name as owner_name, a.owner_review, u.full_name as updated_by_name, a.updated_at,
         (select max(l.at) from crm.automation_log l where l.automation_id = a.id) as last_at,
         (select count(*)::int from crm.automation_log l where l.automation_id = a.id and l.outcome = 'done' and l.at > now() - interval '7 days') as done_7d
    from crm.automations a left join crm.users o on o.id = a.owner_id left join crm.users u on u.id = a.updated_by`

/** Las automatizaciones que la persona puede ver (administración: todas; quien lidera: las de su mercado). */
export async function listAutomations(ctx: Ctx): Promise<AutomationRow[]> {
  return withUser(ctx.user.id, async (tx) => [...(await tx<AutomationRow[]>`${SELECT(tx)} order by a.market_code, a.is_active desc, a.created_at, a.id`)])
}

export type LogRow = { id: string; at: Date; version: number; record_id: string | null; record_label: string | null; object: string; outcome: 'done' | 'skipped' | 'failed' | 'closed'; detail: Record<string, unknown> }
export type Person = { id: string; full_name: string }

export async function getAutomation(ctx: Ctx, id: string): Promise<{ a: AutomationRow; log: LogRow[]; people: Person[]; stages: { code: string; name_es: string; name_en: string }[]; motors: string[] } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<AutomationRow[]>`${SELECT(tx)} where a.id = ${id}`
    const a = rows[0]
    if (!a) return null
    const log = await tx<LogRow[]>`select id, at, version, record_id, record_label, object, outcome, detail from crm.automation_log where automation_id = ${id} order by at desc, id desc limit 50`
    const people = await tx<Person[]>`
      select distinct u.id, u.full_name from crm.users u join crm.memberships m on m.user_id = u.id
       where u.is_active and not u.is_system and (m.valid_to is null or m.valid_to > now()) and (m.market_code = ${a.market_code} or m.role = 'admin') order by u.full_name`
    const stages = await tx<{ code: string; name_es: string; name_en: string }[]>`
      select distinct on (s.code) s.code, s.name_es, s.name_en from crm.stages s join crm.pipelines p on p.id = s.pipeline_id
       where p.market_code = ${a.market_code} and s.archived_at is null and s.kind in ('open', 'awaiting_txn') order by s.code`
    const motors = await tx<{ motor: string }[]>`select distinct motor from crm.pipelines where market_code = ${a.market_code} order by motor`
    return { a, log: [...log], people: [...people], stages: [...stages], motors: motors.map((m) => m.motor) }
  })
}

export type JobRow = { key: string; everyMinutes: number; description: { es: string; en: string }; last: { status: string; started_at: Date; duration_ms: number; done: number; error: string | null; trigger: string } | null; due: boolean }
export type RunRow = { id: string; job_key: string; trigger: string; status: string; started_at: Date; duration_ms: number; done: number; note: string | null; error: string | null; actor: string | null }

/** Las tareas programadas con su última corrida, y las corridas recientes. */
export async function jobsPanel(ctx: Ctx): Promise<{ jobs: JobRow[]; runs: RunRow[] }> {
  return withUser(ctx.user.id, async (tx) => {
    const last = await tx<{ job_key: string; status: string; started_at: Date; duration_ms: number; done: number; error: string | null; trigger: string; recent: boolean }[]>`
      select distinct on (job_key) job_key, status, started_at, duration_ms, done, error, trigger, false as recent from crm.job_runs order by job_key, started_at desc`
    const runs = await tx<RunRow[]>`
      select r.id, r.job_key, r.trigger, r.status, r.started_at, r.duration_ms, r.done, r.note, r.error, u.full_name as actor
        from crm.job_runs r left join crm.users u on u.id = r.actor_id order by r.started_at desc limit 30`
    const now = Date.now()
    const jobs = JOBS.map((j): JobRow => {
      const l = last.find((x) => x.job_key === j.key) ?? null
      return { key: j.key, everyMinutes: j.everyMinutes, description: j.description, last: l, due: !l || now - new Date(l.started_at).getTime() > j.everyMinutes * 60_000 }
    })
    return { jobs, runs: [...runs] }
  })
}

export type StepStage = { id: string; pipeline_id: string; position: number; name_es: string; name_en: string; kind: string; is_ops: boolean; sla_hours: number | null; rot_days: number; rot_days_waiting: number | null; rot_days_customer: number | null; rot_days_carrier: number | null }
export type StepRow = {
  id: string; pipeline_id: string; from_stage_id: string | null; to_stage_id: string; allowed_roles: Role[]; requires_evidence: boolean; evidence_es: string | null; evidence_en: string | null
  needs_approval: boolean; approver_role: Role | null; approver_id: string | null; approver_name: string | null; backup_id: string | null; backup_name: string | null; approval_hours: number; is_active: boolean; pending_owner: string | null
}

/** Embudos con sus etapas, los pasos configurados y las personas que pueden aprobar, por mercado. */
export async function stepsConfig(ctx: Ctx): Promise<{ pipelines: { id: string; market_code: string; name: string }[]; stages: StepStage[]; steps: StepRow[]; people: (Person & { market_code: string | null })[] }> {
  return withUser(ctx.user.id, async (tx) => {
    const pipelines = await tx<{ id: string; market_code: string; name: string }[]>`select id, market_code, name from crm.pipelines where market_code = any(${ctx.markets.map((m) => m.code)}::text[]) order by market_code, position, name`
    const stages = await tx<StepStage[]>`select id, pipeline_id, position, name_es, name_en, kind, is_ops, sla_hours, rot_days, rot_days_waiting, rot_days_customer, rot_days_carrier from crm.stages where archived_at is null order by pipeline_id, position`
    const steps = await tx<StepRow[]>`
      select t.id, t.pipeline_id, t.from_stage_id, t.to_stage_id, t.allowed_roles, t.requires_evidence, t.evidence_es, t.evidence_en, t.needs_approval, t.approver_role,
             t.approver_id, a.full_name as approver_name, t.backup_id, b.full_name as backup_name, t.approval_hours, t.is_active, t.pending_owner
        from crm.stage_transitions t left join crm.users a on a.id = t.approver_id left join crm.users b on b.id = t.backup_id order by t.updated_at`
    const people = await tx<(Person & { market_code: string | null })[]>`
      select distinct u.id, u.full_name, m.market_code from crm.users u join crm.memberships m on m.user_id = u.id
       where u.is_active and not u.is_system and (m.valid_to is null or m.valid_to > now()) and m.role <> 'lt' order by u.full_name`
    return { pipelines: [...pipelines], stages: [...stages], steps: [...steps], people: [...people] }
  })
}

export async function escalationConfig(ctx: Ctx): Promise<{ market_code: string; name: string; is_active: boolean; level2_hours: number; escalated_open: number }[]> {
  return withUser(ctx.user.id, async (tx) => [...(await tx<{ market_code: string; name: string; is_active: boolean; level2_hours: number; escalated_open: number }[]>`
    select m.code as market_code, m.name, coalesce(e.is_active, false) as is_active, coalesce(e.level2_hours, 4) as level2_hours,
           (select count(*)::int from crm.leads l where l.market_code = m.code and l.status = 'new' and l.first_touch_at is null and l.escalation_level > 0) as escalated_open
      from crm.markets m left join crm.lead_escalation e on e.market_code = m.code
     where m.status = 'live' and m.code = any(${ctx.markets.map((x) => x.code)}::text[]) order by m.code`)])
}

export type DealSteps = {
  waiting_on: string | null
  /** Meta de tiempo de la etapa actual: cuándo vence (horas hábiles del mercado) y si ya venció. */
  goal: { due_at: Date; late: boolean; hours: number } | null
  /** Pasos configurados desde la etapa actual que piden algo. */
  steps: { to_stage_id: string; to_es: string; to_en: string; requires_evidence: boolean; evidence_es: string | null; evidence_en: string | null; needs_approval: boolean; has_evidence: boolean }[]
  evidence: { id: string; to_es: string; to_en: string; url: string; note: string; added_by: string | null; added_at: Date }[]
  pending: { id: string; to_es: string; to_en: string; requested_by: string; requester: string | null; approver: string | null; approver_role: Role | null; due_at: Date; late: boolean; escalated: boolean; backup: string | null; mine: boolean; can_decide: boolean } | null
  last: { status: string; to_es: string; to_en: string; decided_by: string | null; decided_at: Date | null; note: string | null } | null
}

/** Lo que la ficha del negocio muestra de sus pasos: evidencia, aprobación pendiente, meta de la etapa y a quién se espera. */
export async function dealSteps(ctx: Ctx, dealId: string): Promise<DealSteps | null> {
  return withUser(ctx.user.id, async (tx) => {
    const d = await tx<{ market_code: string; pipeline_id: string; stage_id: string; status: string; waiting_on: string | null; stage_entered_at: Date; sla_hours: number | null; due_at: Date | null; late: boolean | null }[]>`
      select d.market_code, d.pipeline_id, d.stage_id, d.status, d.waiting_on, d.stage_entered_at, s.sla_hours,
             case when s.sla_hours is not null then app.business_due(d.market_code, d.stage_entered_at, s.sla_hours * 60) end as due_at,
             case when s.sla_hours is not null then app.business_due(d.market_code, d.stage_entered_at, s.sla_hours * 60) < now() end as late
        from crm.deals d join crm.stages s on s.id = d.stage_id where d.id = ${dealId}`
    const deal = d[0]
    if (!deal) return null
    const steps = await tx<DealSteps['steps']>`
      select distinct on (t.to_stage_id) t.to_stage_id, s.name_es as to_es, s.name_en as to_en, t.requires_evidence, t.evidence_es, t.evidence_en, t.needs_approval,
             exists (select 1 from crm.deal_evidence e where e.deal_id = ${dealId} and e.to_stage_id = t.to_stage_id and e.added_at >= ${deal.stage_entered_at}) as has_evidence
        from crm.stage_transitions t join crm.stages s on s.id = t.to_stage_id
       where t.pipeline_id = ${deal.pipeline_id} and t.is_active and (t.from_stage_id is null or t.from_stage_id = ${deal.stage_id}) and t.to_stage_id <> ${deal.stage_id}
         and (t.requires_evidence or t.needs_approval) and s.archived_at is null
       order by t.to_stage_id, t.from_stage_id nulls last`
    const evidence = await tx<DealSteps['evidence']>`
      select e.id, s.name_es as to_es, s.name_en as to_en, e.url, e.note, u.full_name as added_by, e.added_at
        from crm.deal_evidence e join crm.stages s on s.id = e.to_stage_id left join crm.users u on u.id = e.added_by where e.deal_id = ${dealId} order by e.added_at desc limit 20`
    const ap = await tx<{ id: string; market_code: string; status: string; to_es: string; to_en: string; requested_by: string; requester: string | null; approver_id: string | null; approver: string | null; approver_role: Role | null
      backup_id: string | null; backup: string | null; due_at: Date; late: boolean; escalated_at: Date | null; decided_by: string | null; decided_at: Date | null; note: string | null }[]>`
      select a.id, a.market_code, a.status, s.name_es as to_es, s.name_en as to_en, a.requested_by, r.full_name as requester, a.approver_id, p.full_name as approver, a.approver_role,
             a.backup_id, b.full_name as backup, a.due_at, (a.due_at < now()) as late, a.escalated_at, k.full_name as decided_by, a.decided_at, a.note
        from crm.approvals a join crm.stages s on s.id = a.to_stage_id
        left join crm.users r on r.id = a.requested_by left join crm.users p on p.id = a.approver_id left join crm.users b on b.id = a.backup_id left join crm.users k on k.id = a.decided_by
       where a.deal_id = ${dealId} order by a.requested_at desc limit 2`
    const open = ap.find((x) => x.status === 'pending')
    const closed = ap.find((x) => x.status !== 'pending' && x.status !== 'cancelled')
    return {
      waiting_on: deal.waiting_on,
      goal: deal.status === 'open' && deal.due_at && deal.sla_hours ? { due_at: deal.due_at, late: Boolean(deal.late), hours: deal.sla_hours } : null,
      steps: [...steps],
      evidence: [...evidence],
      pending: open ? {
        id: open.id, to_es: open.to_es, to_en: open.to_en, requested_by: open.requested_by, requester: open.requester, approver: open.approver, approver_role: open.approver_role, due_at: open.due_at,
        late: open.late, escalated: Boolean(open.escalated_at), backup: open.backup, mine: open.requested_by === ctx.user.id,
        can_decide: canDecide(ctx, { market_code: open.market_code, requested_by: open.requested_by, approver_role: open.approver_role, approver_id: open.approver_id, backup_id: open.backup_id, escalated_at: open.escalated_at }),
      } : null,
      last: closed ? { status: closed.status, to_es: closed.to_es, to_en: closed.to_en, decided_by: closed.decided_by, decided_at: closed.decided_at, note: closed.note } : null,
    }
  })
}
