import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import { loadCtx, type Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { ROLE_LABEL, rolesIn, type Role } from '@/domain/policy'
import { DomainError, forbidden, invalid, notFound } from '@/lib/errors'
import { peopleWithRole } from '@/domain/automation/people'
import { notify } from '@/domain/notify'

// PIPE-02: el paso de una etapa a otra es un dato. Dice quién lo puede dar, si pide evidencia (un enlace con nota,
// nunca el archivo) y si pide la aprobación de alguien, con plazo y suplente. La regla vive aquí y la consulta
// `moveDealTx`, que es el único camino por el que un negocio cambia de etapa (pantalla, aprobación, automatización).

export const STEP_ROLES = ['rep', 'supervisor', 'market_lead', 'ops', 'admin'] as const
export const APPROVER_ROLES = ['supervisor', 'market_lead', 'ops', 'admin'] as const

type Transition = {
  id: string
  allowed_roles: Role[]
  requires_evidence: boolean
  evidence_es: string | null
  evidence_en: string | null
  needs_approval: boolean
  approver_role: Role | null
  approver_id: string | null
  backup_id: string | null
  approval_hours: number
}
type GateDeal = { id: string; market_code: string; pipeline_id: string; stage_id: string; account_id: string; owner_id: string | null; title: string }
type ToStage = { id: string; name_es: string; name_en: string; crossesOps: boolean }
export type Held = { status: 'pending'; approver: string }

const roleList = (roles: readonly string[], lang: 'es' | 'en') => roles.map((r) => ROLE_LABEL[r as Role]?.[lang] ?? r).join(', ')

/** El paso configurado para ir de la etapa actual a la de destino: gana el que nombra la etapa de origen sobre el "desde cualquiera". */
async function findTransition(tx: Tx, d: GateDeal, toStageId: string): Promise<Transition | null> {
  const rows = await tx<Transition[]>`
    select id, allowed_roles, requires_evidence, evidence_es, evidence_en, needs_approval, approver_role, approver_id, backup_id, approval_hours
      from crm.stage_transitions
     where pipeline_id = ${d.pipeline_id} and to_stage_id = ${toStageId} and is_active and (from_stage_id is null or from_stage_id = ${d.stage_id})
     order by from_stage_id nulls last limit 1`
  return rows[0] ?? null
}

async function userName(tx: Tx, id: string): Promise<{ name: string; locale: 'es' | 'en' }> {
  const rows = await tx<{ full_name: string; locale: 'es' | 'en' }[]>`select full_name, locale from crm.users where id = ${id}`
  return { name: rows[0]?.full_name ?? '', locale: rows[0]?.locale ?? 'es' }
}

/** Una tarea en Hoy para quien tiene que aprobar, en su idioma, ligada a la aprobación. */
async function approvalTask(tx: Tx, createdBy: string, d: GateDeal, toName: { es: string; en: string }, approvalId: string, userId: string): Promise<void> {
  const u = await userName(tx, userId)
  const subject = (u.locale === 'en' ? `Approve: ${d.title} moves to "${toName.en}"` : `Aprobar: ${d.title} pasa a "${toName.es}"`).slice(0, 200)
  await tx`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by, source, approval_id)
           values (${d.market_code}, ${d.account_id}, ${d.id}, 'task', ${subject}, now(), ${userId}, ${createdBy}, 'rule', ${approvalId})`
}

/**
 * Lo que el paso pide antes de mover. Devuelve null si el negocio se puede mover ya, o `pending` si quedó esperando
 * la aprobación de alguien (y entonces no se mueve). Lanza un error de dominio si falta el rol o la evidencia.
 */
export async function transitionGate(tx: Tx, ctx: Ctx, d: GateDeal, to: ToStage, moving: { next?: unknown; extra?: { approvalId?: string; byRule?: boolean; wonOn?: string; ret?: unknown } }): Promise<Held | null> {
  const extra = moving.extra
  // Una automatización no hace el trabajo de Operaciones: dentro de sus etapas solo avanza una persona de Operaciones.
  if (extra?.byRule && to.crossesOps) {
    throw new DomainError('rule_ops', 'Una automatización no avanza un negocio dentro de las etapas de Operaciones.', 'An automation does not move a deal forward inside Operations stages.', 403)
  }
  const tr = await findTransition(tx, d, to.id)
  if (!tr) return null
  if (tr.allowed_roles.length && !extra?.byRule) {
    const mine = rolesIn(ctx.memberships, d.market_code)
    if (!tr.allowed_roles.some((r) => mine.includes(r))) {
      throw new DomainError('step_role', `Este paso a "${to.name_es}" lo da: ${roleList(tr.allowed_roles, 'es')}.`, `This step to "${to.name_en}" is taken by: ${roleList(tr.allowed_roles, 'en')}.`, 403)
    }
  }
  if (tr.requires_evidence) {
    const ev = await tx`select 1 from crm.deal_evidence e where e.deal_id = ${d.id} and e.to_stage_id = ${to.id}
                         and e.added_at >= (select x.stage_entered_at from crm.deals x where x.id = ${d.id}) limit 1`
    if (!ev[0]) {
      throw new DomainError('evidence_required',
        `Para pasar a "${to.name_es}" falta la evidencia${tr.evidence_es ? `: ${tr.evidence_es}` : ''}. Agrega el enlace en la ficha del negocio, en "Evidencia y aprobaciones", y vuelve a moverlo.`,
        `To move to "${to.name_en}" the evidence is missing${tr.evidence_en ? `: ${tr.evidence_en}` : ''}. Add the link on the deal page, under "Evidence and approvals", and move it again.`)
    }
  }
  if (!tr.needs_approval) return null
  if (extra?.byRule) {
    throw new DomainError('rule_needs_person', 'Ese paso pide la aprobación de una persona: una automatización no lo da.', 'That step needs a person’s approval: an automation does not take it.', 403)
  }
  if (extra?.approvalId) {
    const ok = await tx`select 1 from crm.approvals where id = ${extra.approvalId} and deal_id = ${d.id} and to_stage_id = ${to.id} and status = 'approved'`
    if (ok[0]) return null
  }
  const open = await tx<{ id: string; to_stage_id: string; approver_id: string | null; approver_role: Role | null }[]>`
    select id, to_stage_id, approver_id, approver_role from crm.approvals where deal_id = ${d.id} and status = 'pending' for update`
  if (open[0]) {
    if (open[0].to_stage_id !== to.id) throw invalid('Este negocio ya espera una aprobación para otro paso. Espera la respuesta o pide que la rechacen.', 'This deal is already waiting on an approval for another step. Wait for the answer or ask for it to be declined.')
    const who = open[0].approver_id ? (await userName(tx, open[0].approver_id)).name : ctx.t(ROLE_LABEL[open[0].approver_role ?? 'supervisor'].es, ROLE_LABEL[open[0].approver_role ?? 'supervisor'].en)
    return { status: 'pending', approver: who }
  }
  // Quién aprueba: la persona nombrada, o quienes tienen el rol en ese mercado. Nadie aprueba lo que pidió.
  let approverId = tr.approver_id
  let backupId = tr.backup_id
  if (approverId === ctx.user.id) {
    approverId = backupId
    backupId = null
  }
  const people = approverId ? [approverId] : (await peopleWithRole(tx, d.market_code, tr.approver_role ?? 'supervisor', d.owner_id ?? ctx.user.id)).filter((id) => id !== ctx.user.id)
  if (people.length === 0) {
    throw invalid('Nadie puede aprobar este paso todavía: no hay otra persona con ese rol en el mercado. Avisa a administración.', 'Nobody can approve this step yet: there is no other person with that role in the market. Tell administration.')
  }
  const rows = await tx<{ id: string }[]>`
    insert into crm.approvals (market_code, deal_id, transition_id, from_stage_id, to_stage_id, requested_by, approver_role, approver_id, backup_id, due_at, params)
    values (${d.market_code}, ${d.id}, ${tr.id}, ${d.stage_id}, ${to.id}, ${ctx.user.id}, ${approverId ? null : tr.approver_role}, ${approverId},
            ${backupId === ctx.user.id ? null : backupId}, app.business_due(${d.market_code}, now(), ${tr.approval_hours * 60}),
            ${tx.json({ wonOn: extra?.wonOn ?? null, ret: (extra?.ret ?? null) as never })})
    returning id`
  const approvalId = rows[0]!.id
  for (const p of people) await approvalTask(tx, ctx.user.id, d, { es: to.name_es, en: to.name_en }, approvalId, p)
  const who = approverId ? (await userName(tx, approverId)).name : ctx.t(ROLE_LABEL[tr.approver_role ?? 'supervisor'].es, ROLE_LABEL[tr.approver_role ?? 'supervisor'].en)
  await audit(tx, ctx, 'deal.approval_requested', 'deal', d.id, d.market_code, { stage_id: d.stage_id }, { to_stage_id: to.id, approver_id: approverId, approver_role: approverId ? null : tr.approver_role })
  return { status: 'pending', approver: who }
}

/** Un negocio que se movió por otro camino (o se cerró) ya no espera la aprobación que tenía pendiente. */
export async function cancelPendingApproval(tx: Tx, dealId: string, keepId: string | null): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    update crm.approvals set status = 'cancelled', decided_at = now()
     where deal_id = ${dealId} and status = 'pending' and id is distinct from ${keepId}::uuid returning id`
  if (rows.length) await tx`update crm.activities set done_at = now(), outcome = 'done' where approval_id = any(${rows.map((r) => r.id)}::uuid[]) and done_at is null`
}

const evidenceInput = z.object({ toStageId: z.guid(), url: z.string().trim().max(480), note: z.string().trim().min(2).max(300) })

/** Evidencia de un paso: un enlace (dónde está el documento) con una nota. CONTIGO no guarda el archivo. */
export async function addEvidence(ctx: Ctx, dealId: string, input: z.input<typeof evidenceInput>): Promise<void> {
  const parsed = evidenceInput.safeParse(input)
  if (!parsed.success) throw invalid('Elige la etapa, pega el enlace y escribe una nota corta (2 a 300 letras).', 'Pick the stage, paste the link and write a short note (2 to 300 characters).')
  const v = parsed.data
  if (!/^https:\/\/\S{4,480}$/.test(v.url) || v.url.length < 12) throw invalid('El enlace tiene que empezar con https:// y no llevar espacios.', 'The link must start with https:// and have no spaces.')
  assertNoProhibited(v.note, v.url)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; pipeline_id: string; status: string }[]>`select market_code, pipeline_id, status from crm.deals where id = ${dealId} for update`
    const d = rows[0]
    if (!d) throw notFound('No encontramos ese negocio.', 'We could not find that deal.')
    ctx.assert('deal.edit', d.market_code)
    if (d.status !== 'open') throw invalid('Un negocio cerrado ya no recibe evidencia.', 'A closed deal no longer takes evidence.')
    const st = await tx`select 1 from crm.stages where id = ${v.toStageId} and pipeline_id = ${d.pipeline_id} and archived_at is null`
    if (!st[0]) throw invalid('Esa etapa no es de este embudo.', 'That stage is not part of this pipeline.')
    await tx`insert into crm.deal_evidence (deal_id, market_code, to_stage_id, url, note, added_by) values (${dealId}, ${d.market_code}, ${v.toStageId}, ${v.url}, ${v.note}, ${ctx.user.id})`
    await audit(tx, ctx, 'deal.evidence_added', 'deal', dealId, d.market_code, null, { to_stage_id: v.toStageId })
  })
}

type ApprovalRow = {
  id: string; market_code: string; deal_id: string; to_stage_id: string; requested_by: string; approver_role: Role | null; approver_id: string | null
  backup_id: string | null; escalated_at: Date | null; status: string; params: { wonOn?: string | null; ret?: { reasonCode: string; note?: string } | null }
}

/** ¿Esta persona puede decidir esta aprobación? El aprobador, quien tiene el rol pedido, o el suplente cuando ya venció el plazo. Nunca quien la pidió. */
export function canDecide(ctx: Pick<Ctx, 'user' | 'memberships'>, a: Pick<ApprovalRow, 'market_code' | 'requested_by' | 'approver_role' | 'approver_id' | 'backup_id' | 'escalated_at'>): boolean {
  if (a.requested_by === ctx.user.id) return false
  if (a.approver_id === ctx.user.id) return true
  if (a.escalated_at && a.backup_id === ctx.user.id) return true
  const mine = rolesIn(ctx.memberships, a.market_code)
  if (a.approver_role && mine.includes(a.approver_role)) return true
  // Vencido el plazo sin suplente nombrado, decide quien lidera el mercado.
  return Boolean(a.escalated_at && !a.backup_id && mine.includes('market_lead'))
}

/**
 * Aprobar o rechazar, de un toque. Aprobar mueve el negocio en la misma transacción, a nombre de quien lo pidió y con
 * sus mismas reglas (lo que la etapa exige, la separación de Operaciones): si ya no se puede mover, la aprobación no se gasta.
 */
export async function decideApproval(ctx: Ctx, approvalId: string, decision: 'approve' | 'reject', rawNote: string, move: (tx: Tx, requester: Ctx, a: ApprovalRow) => Promise<unknown>): Promise<void> {
  const note = rawNote.trim()
  if (decision === 'reject' && note.length < 2) throw invalid('Escribe por qué no lo apruebas, para que quien lo pidió sepa qué corregir.', 'Say why you are declining, so the requester knows what to fix.')
  if (note.length > 300) throw invalid('Deja la nota en 300 letras o menos.', 'Keep the note to 300 characters or fewer.')
  assertNoProhibited(note)
  const pre = await withUser(ctx.user.id, (tx) => tx<{ requested_by: string }[]>`select requested_by from crm.approvals where id = ${approvalId}`)
  if (!pre[0]) throw notFound('No encontramos esa aprobación.', 'We could not find that approval.')
  const requester = await loadCtx(pre[0].requested_by, ctx.locale)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<ApprovalRow[]>`
      select id, market_code, deal_id, to_stage_id, requested_by, approver_role, approver_id, backup_id, escalated_at, status, params from crm.approvals where id = ${approvalId} for update`
    const a = rows[0]
    if (!a) throw notFound('No encontramos esa aprobación.', 'We could not find that approval.')
    if (a.status !== 'pending') throw invalid('Esa aprobación ya se decidió.', 'That approval has already been decided.')
    if (a.requested_by === ctx.user.id) throw new DomainError('own_request', 'Quien pide el paso no lo aprueba: lo decide otra persona.', 'The person who asks for the step does not approve it: someone else decides.', 403)
    if (!canDecide(ctx, a)) throw forbidden()
    const info = await tx<{ title: string; account_id: string; name_es: string; name_en: string; locale: 'es' | 'en' }[]>`
      select d.title, d.account_id, s.name_es, s.name_en, (select u.locale from crm.users u where u.id = ${a.requested_by}) as locale
        from crm.deals d, crm.stages s where d.id = ${a.deal_id} and s.id = ${a.to_stage_id}`
    const i = info[0]!
    await tx`update crm.approvals set status = ${decision === 'approve' ? 'approved' : 'rejected'}, decided_by = ${ctx.user.id}, decided_at = now(), note = ${note || null} where id = ${approvalId}`
    await tx`update crm.activities set done_at = now(), outcome = 'done' where approval_id = ${approvalId} and done_at is null`
    await audit(tx, ctx, decision === 'approve' ? 'deal.approval_approved' : 'deal.approval_rejected', 'deal', a.deal_id, a.market_code, null, { to_stage_id: a.to_stage_id, requested_by: a.requested_by, ...(note ? { note } : {}) })
    if (decision === 'approve') {
      if (!requester) throw invalid('Quien pidió el paso ya no tiene acceso. Pide que alguien más lo mueva.', 'The person who asked for the step no longer has access. Ask someone else to move it.')
      // El movimiento corre con la identidad de quien lo pidió: valen sus permisos y sus límites, no los de quien aprueba.
      await tx`select set_config('app.user_id', ${a.requested_by}, true)`
      await move(tx, requester, a)
      await tx`select set_config('app.user_id', ${ctx.user.id}, true)`
    }
    // Quien lo pidió se entera por el servicio único de avisos (campana, Hoy y los canales que eligió), en su idioma.
    await notify(tx, ctx, {
      to: a.requested_by, kind: 'approval', market: a.market_code, link: `/deals/${a.deal_id}`, accountId: i.account_id, dealId: a.deal_id,
      title: decision === 'approve' ? [`Paso aprobado: ${i.title}`, `Step approved: ${i.title}`] : [`Paso no aprobado: ${i.title}`, `Step declined: ${i.title}`],
      body: decision === 'approve'
        ? [`${ctx.user.name} lo aprobó: ${i.title} pasó a "${i.name_es}".`, `${ctx.user.name} approved it: ${i.title} moved to "${i.name_en}".`]
        : [`${ctx.user.name} no aprobó pasar ${i.title} a "${i.name_es}": ${note}`, `${ctx.user.name} declined moving ${i.title} to "${i.name_en}": ${note}`],
    })
  })
}

/** Vencido el plazo, la aprobación pasa al suplente (o, sin suplente, a quien lidera el mercado). Corre como sistema, por horario. */
export async function escalateApprovals(tx: Tx, sys: Ctx): Promise<number> {
  const due = await tx<{ id: string; market_code: string; deal_id: string; to_stage_id: string; backup_id: string | null; requested_by: string }[]>`
    select id, market_code, deal_id, to_stage_id, backup_id, requested_by from crm.approvals
     where status = 'pending' and escalated_at is null and due_at < now() order by due_at limit 100 for update skip locked`
  for (const a of due) {
    const people = a.backup_id ? [a.backup_id] : (await peopleWithRole(tx, a.market_code, 'market_lead', null)).filter((p) => p !== a.requested_by)
    await tx`update crm.approvals set escalated_at = now() where id = ${a.id}`
    const d = await tx<GateDeal[]>`select id, market_code, pipeline_id, stage_id, account_id, owner_id, title from crm.deals where id = ${a.deal_id}`
    const s = await tx<{ name_es: string; name_en: string }[]>`select name_es, name_en from crm.stages where id = ${a.to_stage_id}`
    for (const p of people) {
      const has = await tx`select 1 from crm.activities where approval_id = ${a.id} and owner_id = ${p} and done_at is null`
      if (!has[0] && d[0] && s[0]) await approvalTask(tx, sys.user.id, d[0], { es: s[0].name_es, en: s[0].name_en }, a.id, p)
    }
    await audit(tx, sys, 'deal.approval_escalated', 'deal', a.deal_id, a.market_code, null, { to_stage_id: a.to_stage_id, backup_id: a.backup_id, people: people.length })
  }
  return due.length
}

const transitionInput = z.object({
  id: z.guid().or(z.literal('')).optional(),
  pipelineId: z.guid(),
  fromStageId: z.guid().or(z.literal('')).optional(),
  toStageId: z.guid(),
  allowedRoles: z.array(z.enum(STEP_ROLES)).max(5),
  requiresEvidence: z.boolean(),
  evidenceEs: z.string().trim().max(160).optional().default(''),
  evidenceEn: z.string().trim().max(160).optional().default(''),
  needsApproval: z.boolean(),
  approver: z.string().trim().max(60).optional().default(''),   // 'role:<rol>' o 'user:<id>'
  backupId: z.guid().or(z.literal('')).optional(),
  approvalHours: z.number().int().min(1).max(240).optional().default(8),
  isActive: z.boolean().optional().default(true),
})

/** Crear o cambiar un paso. Lo hace administración; queda en la bitácora con el antes y el después. */
export async function saveTransition(ctx: Ctx, input: z.input<typeof transitionInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = transitionInput.safeParse(input)
  if (!parsed.success) throw invalid('Revisa el paso: etapa de destino, quién lo da y, si pide aprobación, quién aprueba y en cuántas horas.', 'Check the step: destination stage, who takes it and, if it needs approval, who approves and within how many hours.')
  const v = parsed.data
  if (v.fromStageId && v.fromStageId === v.toStageId) throw invalid('La etapa de origen y la de destino tienen que ser distintas.', 'The origin and destination stages must be different.')
  if (v.requiresEvidence && (v.evidenceEs.length < 3 || v.evidenceEn.length < 3)) throw invalid('Di qué evidencia se pide, en español y en inglés.', 'Say which evidence is required, in Spanish and in English.')
  let approverRole: string | null = null
  let approverId: string | null = null
  if (v.needsApproval) {
    if (v.approver.startsWith('role:') && (APPROVER_ROLES as readonly string[]).includes(v.approver.slice(5))) approverRole = v.approver.slice(5)
    else if (/^user:[0-9a-f-]{36}$/.test(v.approver)) approverId = v.approver.slice(5)
    else throw invalid('Elige quién aprueba: un rol o una persona.', 'Choose who approves: a role or a person.')
    if (v.backupId && v.backupId === approverId) throw invalid('El suplente tiene que ser otra persona.', 'The backup must be a different person.')
  }
  return withUser(ctx.user.id, async (tx) => {
    const st = await tx<{ id: string; market_code: string; kind: string }[]>`
      select s.id, p.market_code, s.kind from crm.stages s join crm.pipelines p on p.id = s.pipeline_id
       where s.pipeline_id = ${v.pipelineId} and s.id = any(${[v.toStageId, ...(v.fromStageId ? [v.fromStageId] : [])]}::uuid[]) and s.archived_at is null`
    const to = st.find((s) => s.id === v.toStageId)
    if (!to || (v.fromStageId && !st.some((s) => s.id === v.fromStageId))) throw invalid('Esas etapas no son de este embudo.', 'Those stages are not part of this pipeline.')
    if (to.kind === 'lost') throw invalid('Perder un negocio no pide evidencia ni aprobación: solo el motivo.', 'Losing a deal needs no evidence or approval: only the reason.')
    for (const person of [approverId, v.needsApproval ? v.backupId || null : null]) {
      if (!person) continue
      const ok = await tx<{ ok: boolean }[]>`select app.works_in(${person}, ${to.market_code}) as ok`
      if (!ok[0]?.ok) throw invalid('Quien aprueba (y su suplente) tiene que trabajar en ese mercado.', 'The approver (and the backup) must work in that market.')
    }
    const row = {
      allowed_roles: v.allowedRoles, requires_evidence: v.requiresEvidence, evidence_es: v.requiresEvidence ? v.evidenceEs : null, evidence_en: v.requiresEvidence ? v.evidenceEn : null,
      needs_approval: v.needsApproval, approver_role: approverRole, approver_id: approverId, backup_id: v.needsApproval ? v.backupId || null : null, approval_hours: v.approvalHours, is_active: v.isActive,
    }
    const before = v.id
      ? await tx<Record<string, unknown>[]>`select allowed_roles, requires_evidence, needs_approval, approver_role, approver_id, backup_id, approval_hours, is_active from crm.stage_transitions where id = ${v.id} for update`
      : await tx<Record<string, unknown>[]>`select id, allowed_roles, requires_evidence, needs_approval, approver_role, approver_id, backup_id, approval_hours, is_active from crm.stage_transitions
          where pipeline_id = ${v.pipelineId} and to_stage_id = ${v.toStageId} and from_stage_id is not distinct from ${v.fromStageId || null}::uuid for update`
    let id = v.id || (before[0]?.id as string | undefined) || ''
    if (id) {
      if (!before[0]) throw notFound('No encontramos ese paso.', 'We could not find that step.')
      await tx`update crm.stage_transitions set allowed_roles = ${row.allowed_roles}, requires_evidence = ${row.requires_evidence}, evidence_es = ${row.evidence_es}, evidence_en = ${row.evidence_en},
                needs_approval = ${row.needs_approval}, approver_role = ${row.approver_role}, approver_id = ${row.approver_id}, backup_id = ${row.backup_id}, approval_hours = ${row.approval_hours},
                is_active = ${row.is_active}, updated_by = ${ctx.user.id}, updated_at = now() where id = ${id}`
    } else {
      const ins = await tx<{ id: string }[]>`
        insert into crm.stage_transitions (pipeline_id, from_stage_id, to_stage_id, allowed_roles, requires_evidence, evidence_es, evidence_en, needs_approval, approver_role, approver_id, backup_id, approval_hours, is_active, updated_by)
        values (${v.pipelineId}, ${v.fromStageId || null}, ${v.toStageId}, ${row.allowed_roles}, ${row.requires_evidence}, ${row.evidence_es}, ${row.evidence_en}, ${row.needs_approval}, ${row.approver_role},
                ${row.approver_id}, ${row.backup_id}, ${row.approval_hours}, ${row.is_active}, ${ctx.user.id}) returning id`
      id = ins[0]!.id
    }
    await audit(tx, ctx, 'pipeline.step_saved', 'stage', v.toStageId, to.market_code, before[0] ? { ...before[0], id: undefined } : null, { ...row, to_stage_id: v.toStageId, from_stage_id: v.fromStageId || null })
    return id
  })
}

const stageTimes = z.object({ slaHours: z.number().int().min(1).max(2000).nullable(), rotDaysWaiting: z.number().int().min(0).max(365).nullable() })

/** Meta de tiempo de una etapa (horas hábiles) y días de estancamiento cuando se espera a un tercero. */
export async function setStageTimes(ctx: Ctx, stageId: string, input: z.input<typeof stageTimes>): Promise<void> {
  ctx.assert('config.manage')
  const parsed = stageTimes.safeParse(input)
  if (!parsed.success) throw invalid('La meta va de 1 a 2000 horas hábiles y la espera de un tercero de 0 a 365 días. Déjalas vacías para no usarlas.', 'The goal goes from 1 to 2000 business hours and the third-party wait from 0 to 365 days. Leave them empty to not use them.')
  const v = parsed.data
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; sla_hours: number | null; rot_days_waiting: number | null; kind: string }[]>`
      select p.market_code, s.sla_hours, s.rot_days_waiting, s.kind from crm.stages s join crm.pipelines p on p.id = s.pipeline_id where s.id = ${stageId} for update of s`
    const s = rows[0]
    if (!s) throw notFound('No encontramos esa etapa.', 'We could not find that stage.')
    if (s.kind === 'won' || s.kind === 'lost') throw invalid('Una etapa de cierre no lleva meta de tiempo.', 'A closing stage has no time goal.')
    await tx`update crm.stages set sla_hours = ${v.slaHours}, rot_days_waiting = ${v.rotDaysWaiting} where id = ${stageId}`
    await audit(tx, ctx, 'pipeline.stage_times', 'stage', stageId, s.market_code, { sla_hours: s.sla_hours, rot_days_waiting: s.rot_days_waiting }, { sla_hours: v.slaHours, rot_days_waiting: v.rotDaysWaiting })
  })
}

const WAITING = ['us', 'customer', 'third_party', ''] as const

/** PIPE-03: a quién espera el negocio. Separa "estancado por nosotros" de "esperando a un tercero". */
export async function setWaitingOnTx(tx: Tx, ctx: Ctx, dealId: string, value: string): Promise<void> {
  if (!(WAITING as readonly string[]).includes(value)) throw invalid('Elige a quién se espera.', 'Choose who the deal is waiting on.')
  const rows = await tx<{ market_code: string; status: string; waiting_on: string | null }[]>`select market_code, status, waiting_on from crm.deals where id = ${dealId} for update`
  const d = rows[0]
  if (!d) throw notFound('No encontramos ese negocio.', 'We could not find that deal.')
  ctx.assert('deal.edit', d.market_code)
  if (d.status !== 'open') throw invalid('Un negocio cerrado no espera a nadie.', 'A closed deal is not waiting on anyone.')
  if ((d.waiting_on ?? '') === value) return
  await tx`update crm.deals set waiting_on = ${value || null} where id = ${dealId}`
  await audit(tx, ctx, 'deal.waiting_on', 'deal', dealId, d.market_code, { waiting_on: d.waiting_on }, { waiting_on: value || null })
}
export const setWaitingOn = (ctx: Ctx, dealId: string, value: string) => withUser(ctx.user.id, (tx) => setWaitingOnTx(tx, ctx, dealId, value))
