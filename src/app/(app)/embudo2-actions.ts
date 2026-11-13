'use server'

import { runAction, str } from '@/server/action'
import type { ActionResult } from '@/lib/errors'
import { decideRoutingSuggestion, editAssignmentRule } from '@/domain/embudo/routing'
import { saveFunnelSetting } from '@/domain/embudo2/settings'
import { correctActivity } from '@/domain/embudo2/activities'
import { setAutomationOwner } from '@/domain/automation/admin'
import { setTransitionActive } from '@/domain/embudo2/transitions'

type R = ActionResult<unknown>
const all = (fd: FormData, key: string): string[] => fd.getAll(key).filter((v): v is string => typeof v === 'string' && v !== '')
const int = (v: string): number | null => (/^\d{1,6}$/.test(v.trim()) ? Number(v.trim()) : null)

export async function saveFunnelSettingAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveFunnelSetting(ctx, { key: str(fd, 'key'), market: str(fd, 'market') || null, value: str(fd, 'value'), confirm: fd.get('confirm') === 'on' })
    return { message: ['Valor guardado. El cambio quedó en la bitácora.', 'Value saved. The change is in the audit log.'], revalidate: ['/admin/embudo'] }
  })
}

export async function editAssignmentRuleAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await editAssignmentRule(ctx, str(fd, 'id'), {
      name: str(fd, 'name'),
      match: { sources: all(fd, 'sources'), motors: all(fd, 'motors'), formIds: all(fd, 'form_ids'), territoryIds: all(fd, 'territory_ids'), sizeMin: int(str(fd, 'size_min')), sizeMax: int(str(fd, 'size_max')) },
    })
    return { message: ['Regla actualizada. Vale desde el próximo lead.', 'Rule updated. It applies from the next lead.'], revalidate: ['/admin/embudo'] }
  })
}

export async function decideSuggestionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const confirm = str(fd, 'decision') === 'confirm'
    await decideRoutingSuggestion(ctx, str(fd, 'id'), { confirm, note: str(fd, 'note') })
    return { message: confirm ? ['Confirmado. La tarea de pasar el lead quedó en tu Hoy.', 'Confirmed. The task to hand over the lead is in your Today.'] : ['Descartado. El lead sigue con quien lo tiene.', 'Dismissed. The lead stays with its owner.'], revalidate: ['/supervisor'] }
  })
}

export async function correctActivityAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await correctActivity(ctx, str(fd, 'id'), { subject: str(fd, 'subject'), body: str(fd, 'body'), reason: str(fd, 'reason') })
    return { message: ['Corrección agregada. La original sigue en el hilo, marcada como corregida.', 'Correction added. The original stays in the thread, marked as corrected.'], revalidate: [`/comercios/${str(fd, 'account_id')}/hilo`] }
  })
}

export async function setAutomationOwnerAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setAutomationOwner(ctx, str(fd, 'id'), str(fd, 'owner_id'))
    return { message: ['Responsable confirmado.', 'Owner confirmed.'], revalidate: ['/admin/automatizaciones'] }
  })
}

export async function setTransitionActiveAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setTransitionActive(ctx, str(fd, 'id'), str(fd, 'active') === 'true')
    return { message: ['Listo. El paso quedó como lo elegiste y el cambio está en la bitácora.', 'Done. The step is set as you chose and the change is in the audit log.'], revalidate: ['/admin/automatizaciones'] }
  })
}
