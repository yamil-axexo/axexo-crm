'use server'

import { runAction, str } from '@/server/action'
import { markAnnouncement, publishAnnouncement, withdrawAnnouncement, type Topic } from '@/domain/announcements'
import type { ActionResult } from '@/lib/errors'

export async function markAnnouncementAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await markAnnouncement(ctx, str(fd, 'announcement_id'), str(fd, 'ack') === '1')
  })
}

export async function publishAnnouncementAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    const out = await publishAnnouncement(ctx, {
      seriesId: str(fd, 'series_id'), topic: str(fd, 'topic') as Topic, title: str(fd, 'title'), body: str(fd, 'body'), titleOther: str(fd, 'title_other'), bodyOther: str(fd, 'body_other'),
      market: str(fd, 'market'), teamId: str(fd, 'team_id'), role: str(fd, 'role') as '', endsOn: str(fd, 'ends_on'), effectiveOn: str(fd, 'effective_on'), requiresAck: fd.get('requires_ack') === 'on',
    })
    const n = out.audience
    return { message: out.version > 1
      ? [`Versión ${out.version} publicada. El acuse vuelve a empezar: ${n} ${n === 1 ? 'persona avisada' : 'personas avisadas'}.`, `Version ${out.version} published. Acknowledgment starts over: ${n} ${n === 1 ? 'person' : 'people'} notified.`]
      : [`Publicado: ${n} ${n === 1 ? 'persona avisada' : 'personas avisadas'}.`, `Published: ${n} ${n === 1 ? 'person' : 'people'} notified.`] }
  })
}

export async function withdrawAnnouncementAction(_: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await withdrawAnnouncement(ctx, str(fd, 'announcement_id'))
    return { message: ['Anuncio retirado.', 'Announcement withdrawn.'] }
  })
}
