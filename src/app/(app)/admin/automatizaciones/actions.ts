'use server'

import { redirect } from 'next/navigation'
import { runAction, str } from '@/server/action'
import { invalid, type ActionResult } from '@/lib/errors'
import { createFromTemplate, runJobNow, saveAutomation, setAutomationActive, testAutomation, type AutomationInput } from '@/domain/automation/admin'
import { addEvidence, saveTransition, setStageTimes, setWaitingOn, STEP_ROLES } from '@/domain/automation/transitions'
import { decide } from '@/domain/automation/approvals'
import { saveLeadEscalation } from '@/domain/automation/lead-escalation'

type R = ActionResult<unknown>

export async function createAutomationAction(_: R | null, fd: FormData): Promise<R> {
  const out = await runAction(async (ctx) => ({ data: await createFromTemplate(ctx, str(fd, 'market'), str(fd, 'template')) }))
  if (out.ok && typeof out.data === 'string') redirect(`/admin/automatizaciones/${out.data}?nueva=1`)
  return out
}

const list = (raw: string): unknown[] => {
  try {
    const v: unknown = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    throw invalid('No pudimos leer las condiciones y las acciones. Recarga la página e intenta de nuevo.', 'We could not read the conditions and actions. Reload the page and try again.')
  }
}

export async function saveAutomationAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveAutomation(ctx, str(fd, 'id'), {
      nameEs: str(fd, 'name_es'), nameEn: str(fd, 'name_en'), motor: str(fd, 'motor'), ownerId: str(fd, 'owner_id'),
      conditions: list(str(fd, 'conditions')) as AutomationInput['conditions'], actions: list(str(fd, 'actions')) as AutomationInput['actions'],
    })
    return { message: ['Automatización guardada. Sube de versión y vuelve a revisar cada registro con las condiciones nuevas.', 'Automation saved. Its version goes up and every record is checked again with the new conditions.'] }
  })
}

export async function toggleAutomationAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const active = str(fd, 'active') === '1'
    await setAutomationActive(ctx, str(fd, 'id'), active)
    return { message: active ? ['Automatización activa. Corre en la próxima revisión.', 'Automation on. It runs at the next check.'] : ['Automatización en pausa. No hace nada hasta que la actives.', 'Automation paused. It does nothing until you turn it on.'] }
  })
}

export async function testAutomationAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    // Se acepta el identificador o la dirección completa de la ficha.
    const raw = str(fd, 'record').trim()
    const id = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? raw
    return { data: await testAutomation(ctx, str(fd, 'id'), id), revalidate: [] }
  })
}

export async function runJobAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await runJobNow(ctx, str(fd, 'key'))
    if (out.status === 'busy') return { message: ['Esa tarea ya está corriendo. Espera a que termine.', 'That job is already running. Wait for it to finish.'] }
    if (out.status === 'failed') throw invalid('La tarea falló. Quedó anotada en las corridas con el código del error.', 'The job failed. It is recorded in the runs with the error code.')
    return { message: [`Tarea corrida: ${out.done ?? 0} ${out.done === 1 ? 'registro' : 'registros'}.`, `Job ran: ${out.done ?? 0} ${out.done === 1 ? 'record' : 'records'}.`] }
  })
}

export async function saveStepAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const roles = fd.getAll('roles').map(String).filter((r): r is (typeof STEP_ROLES)[number] => (STEP_ROLES as readonly string[]).includes(r))
    await saveTransition(ctx, {
      id: str(fd, 'id'), pipelineId: str(fd, 'pipeline_id'), fromStageId: str(fd, 'from_stage_id'), toStageId: str(fd, 'to_stage_id'), allowedRoles: roles,
      requiresEvidence: fd.get('requires_evidence') === 'on', evidenceEs: str(fd, 'evidence_es'), evidenceEn: str(fd, 'evidence_en'),
      needsApproval: fd.get('needs_approval') === 'on', approver: str(fd, 'approver'), backupId: str(fd, 'backup_id'),
      approvalHours: Number(str(fd, 'approval_hours') || 8), isActive: fd.get('is_active') !== 'off',
    })
    return { message: ['Paso guardado. Vale desde el próximo movimiento.', 'Step saved. It applies from the next move.'] }
  })
}

export async function stageTimesAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const n = (k: string) => (str(fd, k).trim() === '' ? null : Number(str(fd, k)))
    await setStageTimes(ctx, str(fd, 'stage_id'), { slaHours: n('sla_hours'), rotDaysWaiting: n('rot_days_waiting'), rotDaysCustomer: n('rot_days_customer'), rotDaysCarrier: n('rot_days_carrier') })
    return { message: ['Tiempos de la etapa guardados.', 'Stage times saved.'] }
  })
}

export async function escalationAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const active = fd.get('active') === 'on'
    await saveLeadEscalation(ctx, str(fd, 'market'), { active, hours: Number(str(fd, 'hours') || 4) })
    return { message: active ? ['Escalamiento encendido para este mercado.', 'Escalation turned on for this market.'] : ['Escalamiento apagado para este mercado.', 'Escalation turned off for this market.'] }
  })
}

// ---------------------------------------------------------------- en la ficha del negocio

export async function addEvidenceAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addEvidence(ctx, str(fd, 'deal_id'), { toStageId: str(fd, 'to_stage_id'), url: str(fd, 'url'), note: str(fd, 'note') })
    return { message: ['Evidencia agregada. Ya puedes mover el negocio a esa etapa.', 'Evidence added. You can now move the deal to that stage.'] }
  })
}

export async function decideApprovalAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const approve = str(fd, 'decision') === 'approve'
    await decide(ctx, str(fd, 'approval_id'), approve ? 'approve' : 'reject', str(fd, 'note'))
    return { message: approve ? ['Aprobado. El negocio ya se movió y quien lo pidió recibe el aviso.', 'Approved. The deal has moved and the requester is notified.'] : ['No aprobado. Quien lo pidió recibe el aviso con tu nota.', 'Declined. The requester is notified with your note.'] }
  })
}

export async function waitingOnAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setWaitingOn(ctx, str(fd, 'deal_id'), str(fd, 'waiting_on'))
    return { message: ['Guardado.', 'Saved.'] }
  })
}
