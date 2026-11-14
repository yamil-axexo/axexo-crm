'use server'

import { runAction, str } from '@/server/action'
import {
  archiveStage, createAccountType, createField, createLossReason, createPipeline, createStage, moveStage, pauseDeal, resumeDeal,
  setAccountType, setAccountTypeActive, setFieldActive, setPrimaryContact, updateForm, updateLossReason,
} from '@/domain/b2b'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>
const all = (fd: FormData, key: string) => fd.getAll(key).filter((v): v is string => typeof v === 'string' && v.length > 0)
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)

export async function setAccountTypeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setAccountType(ctx, str(fd, 'id'), str(fd, 'account_type'))
    return { message: ['Tipo de cuenta actualizado.', 'Account type updated.'] }
  })
}

export async function setPrimaryContactAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setPrimaryContact(ctx, str(fd, 'account_id'), str(fd, 'contact_id'))
    return { message: ['Contacto principal actualizado.', 'Primary contact updated.'] }
  })
}

export async function pauseDealAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await pauseDeal(ctx, str(fd, 'deal_id'), { reason: str(fd, 'reason'), reviewOn: str(fd, 'review_on') })
    return { message: ['Negocio en pausa. Vuelve a tu lista de Hoy el día de la revisión.', 'Deal on hold. It comes back to your Today list on the review date.'] }
  })
}

export async function resumeDealAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await resumeDeal(ctx, str(fd, 'deal_id'))
    return { message: ['Negocio retomado.', 'Deal resumed.'] }
  })
}

export async function createAccountTypeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createAccountType(ctx, { market: str(fd, 'market'), labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en'), level: str(fd, 'level') as 'store' })
    return { message: ['Tipo de cuenta agregado.', 'Account type added.'] }
  })
}

export async function toggleAccountTypeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const active = str(fd, 'active') === 'true'
    await setAccountTypeActive(ctx, str(fd, 'id'), active)
    return { message: active ? ['Tipo de cuenta activo otra vez.', 'Account type active again.'] : ['Tipo de cuenta retirado: ya no se ofrece.', 'Account type retired: it is no longer offered.'] }
  })
}

export async function createStageAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createStage(ctx, str(fd, 'pipeline_id'), { nameEs: str(fd, 'name_es'), nameEn: str(fd, 'name_en'), rotDays: Number(str(fd, 'rot_days') || '14') })
    return { message: ['Etapa agregada.', 'Stage added.'] }
  })
}

export async function moveStageAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await moveStage(ctx, str(fd, 'stage_id'), str(fd, 'dir') === 'up' ? 'up' : 'down')
    return { message: ['Orden de etapas actualizado.', 'Stage order updated.'] }
  })
}

export async function archiveStageAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const { moved } = await archiveStage(ctx, str(fd, 'stage_id'), str(fd, 'move_to') || null)
    return { message: moved ? [`Etapa archivada. ${moved === 1 ? '1 negocio pasó' : `${moved} negocios pasaron`} a la etapa elegida.`, `Stage archived. ${moved === 1 ? '1 deal moved' : `${moved} deals moved`} to the chosen stage.`] : ['Etapa archivada.', 'Stage archived.'] }
  })
}

export async function createPipelineAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    // Una etapa por renglón: "Nombre en español | Name in English". Sin la barra, el mismo nombre vale para los dos idiomas.
    const stages = lines(str(fd, 'stages')).map((l) => {
      const [es, en] = l.split('|').map((x) => x.trim())
      return { es: es ?? '', en: en || es || '' }
    })
    await createPipeline(ctx, { market: str(fd, 'market'), motor: str(fd, 'motor') as 'b2b', name: str(fd, 'name'), stages })
    return { message: ['Embudo creado, con sus etapas.', 'Pipeline created, with its stages.'] }
  })
}

export async function createFieldAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createField(ctx, {
      object: str(fd, 'object') as 'account', market: str(fd, 'market'), motor: str(fd, 'motor') as 'b2b', labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en'),
      dataType: str(fd, 'data_type') as 'text', options: lines(str(fd, 'options')), inIntake: fd.get('in_intake') === 'on', decision: str(fd, 'decision'), requestId: str(fd, 'request_id'),
    })
    return { message: ['Campo creado. Ya aparece en la ficha.', 'Field created. It now shows on the record.'] }
  })
}

export async function toggleFieldAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const active = str(fd, 'active') === 'true'
    await setFieldActive(ctx, str(fd, 'id'), active)
    return { message: active ? ['Campo activo otra vez.', 'Field active again.'] : ['Campo retirado. Lo capturado no se borra.', 'Field retired. What was captured is not erased.'] }
  })
}

export async function createLossReasonAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createLossReason(ctx, { labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en'), market: str(fd, 'market'), motors: all(fd, 'motor') as 'b2b'[] })
    return { message: ['Motivo agregado.', 'Reason added.'] }
  })
}

export async function updateLossReasonAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateLossReason(ctx, str(fd, 'code'), { motors: all(fd, 'motor'), active: fd.get('active') === 'on' })
    return { message: ['Motivo actualizado.', 'Reason updated.'] }
  })
}

export async function updateFormAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateForm(ctx, str(fd, 'form_id'), { name: str(fd, 'name'), askFields: all(fd, 'ask'), accountType: fd.has('account_type') ? str(fd, 'account_type') : undefined })
    return { message: ['Formulario actualizado.', 'Form updated.'] }
  })
}
