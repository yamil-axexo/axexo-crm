'use server'

import { runAction, str } from '@/server/action'
import { markNoticeSeen } from '@/domain/ops'
import { markAllNoticesSeen, saveComms, saveLesson, savePrefs, saveTemplate } from '@/domain/notices'
import type { ActionResult } from '@/lib/errors'

export async function noticeReadAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await markNoticeSeen(ctx, str(fd, 'notice_id'))
  })
}

export async function allReadAction(_: unknown, _fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    const n = await markAllNoticesSeen(ctx)
    return { message: n ? [`Listo: ${n} ${n === 1 ? 'aviso marcado' : 'avisos marcados'} como leído.`, `Done: ${n} ${n === 1 ? 'notice' : 'notices'} marked as read.`] : ['No tenías avisos sin leer.', 'You had no unread notices.'] }
  })
}

export async function savePrefsAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await savePrefs(ctx, { dailyDigest: fd.get('daily_digest') === 'on', on: fd.getAll('on').map(String) })
    return { message: ['Preferencias guardadas.', 'Preferences saved.'] }
  })
}

export async function saveTemplateAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    const version = await saveTemplate(ctx, {
      key: str(fd, 'key'), market: str(fd, 'market'), active: fd.get('active') === 'on', needsConsent: fd.get('needs_consent') === 'on',
      subjectEs: str(fd, 'subject_es'), bodyEs: str(fd, 'body_es'), subjectEn: str(fd, 'subject_en'), bodyEn: str(fd, 'body_en'),
    })
    return { message: [`Guardada como versión ${version}. La anterior se conserva.`, `Saved as version ${version}. The previous one is kept.`] }
  })
}

export async function saveCommsAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await saveComms(ctx, {
      market: str(fd, 'market'), ordersMailbox: str(fd, 'orders_mailbox'), senderAddress: str(fd, 'sender_address'), walkthroughUrl: str(fd, 'walkthrough_url'),
      supportWhatsapp: str(fd, 'support_whatsapp'), whatsappDailyLimit: str(fd, 'whatsapp_daily_limit'), emailUnitCost: str(fd, 'email_unit_cost'), whatsappUnitCost: str(fd, 'whatsapp_unit_cost'),
      supportHoursHigh: str(fd, 'support_hours_high'), supportHoursNormal: str(fd, 'support_hours_normal'), supportHoursLow: str(fd, 'support_hours_low'),
    })
    return { message: ['Configuración guardada.', 'Settings saved.'] }
  })
}

export async function saveLessonAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await saveLesson(ctx, { screen: str(fd, 'screen'), url: str(fd, 'url') })
    return { message: ['Lección guardada.', 'Lesson saved.'] }
  })
}
