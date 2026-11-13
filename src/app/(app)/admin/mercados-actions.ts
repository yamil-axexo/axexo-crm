'use server'

import { runAction, str } from '@/server/action'
import {
  addHoliday, createEntity, createFieldSection, removeHoliday, saveWhatsappAccount, saveWhatsappRate, saveWhatsappTemplate, setFichaLayout, setFieldSection,
  setUserEntity, setWhatsappTemplateStatus, updateEntity,
} from '@/domain/markets'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function addHolidayAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addHoliday(ctx, { market: str(fd, 'market'), day: str(fd, 'day'), name: str(fd, 'name') })
    return { message: ['Día festivo guardado.', 'Holiday saved.'] }
  })
}

export async function removeHolidayAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await removeHoliday(ctx, str(fd, 'market'), str(fd, 'day'))
    return { message: ['Día festivo quitado.', 'Holiday removed.'] }
  })
}

export async function createEntityAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createEntity(ctx, { market: str(fd, 'market'), name: str(fd, 'name'), makeDefault: fd.get('make_default') === 'on' })
    return { message: ['Entidad legal agregada.', 'Legal entity added.'] }
  })
}

export async function updateEntityAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateEntity(ctx, str(fd, 'id'), { name: str(fd, 'name'), makeDefault: fd.get('make_default') === 'on' })
    return { message: ['Entidad legal guardada.', 'Legal entity saved.'] }
  })
}

export async function setUserEntityAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setUserEntity(ctx, str(fd, 'user_id'), { entityId: str(fd, 'entity_id') || null, limit: fd.get('limit') === 'on' })
    return { message: ['Entidad de la persona guardada.', 'Person’s entity saved.'] }
  })
}

export async function saveWhatsappAccountAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveWhatsappAccount(ctx, { market: str(fd, 'market'), entityId: str(fd, 'entity_id'), displayName: str(fd, 'display_name'), phone: str(fd, 'phone'), externalRef: str(fd, 'external_ref'), dailyLimit: str(fd, 'daily_limit') })
    return { message: ['Número guardado. El canal sigue apagado: no sale ningún mensaje.', 'Number saved. The channel is still off: no message goes out.'] }
  })
}

export async function saveWhatsappTemplateAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveWhatsappTemplate(ctx, { accountId: str(fd, 'account_id'), key: str(fd, 'key'), locale: str(fd, 'locale') as 'es', category: str(fd, 'category') as 'utility', body: str(fd, 'body') })
    return { message: ['Plantilla guardada como borrador.', 'Template saved as a draft.'] }
  })
}

export async function setWhatsappTemplateStatusAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setWhatsappTemplateStatus(ctx, str(fd, 'id'), str(fd, 'status'))
    return { message: ['Estado de la plantilla guardado.', 'Template status saved.'] }
  })
}

export async function saveWhatsappRateAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveWhatsappRate(ctx, { market: str(fd, 'market'), category: str(fd, 'category'), currency: str(fd, 'currency'), cost: str(fd, 'cost'), effectiveFrom: str(fd, 'effective_from'), source: str(fd, 'source') })
    return { message: ['Costo por mensaje guardado.', 'Cost per message saved.'] }
  })
}

export async function setFichaLayoutAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setFichaLayout(ctx, str(fd, 'role'), fd.getAll('fact').map(String))
    return { message: ['Listo: ese rol ya ve esos datos arriba en la ficha.', 'Done: that role now sees those facts at the top of the merchant page.'] }
  })
}

export async function createFieldSectionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createFieldSection(ctx, { market: str(fd, 'market'), labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en'), team: str(fd, 'team') as 'sales' })
    return { message: ['Sección agregada. Ya puedes mover campos a ella.', 'Section added. You can now move fields into it.'] }
  })
}

export async function setFieldSectionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setFieldSection(ctx, str(fd, 'field_id'), str(fd, 'section'))
    return { message: ['Campo movido de sección.', 'Field moved to the section.'] }
  })
}
