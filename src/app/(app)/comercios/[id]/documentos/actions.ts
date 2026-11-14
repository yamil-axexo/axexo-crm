'use server'

import { runAction, str } from '@/server/action'
import { emailDocument, generateDocument, type DocKind } from '@/domain/documents'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function generateDocumentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const accountId = str(fd, 'account_id')
    const id = await generateDocument(ctx, { accountId, dealId: str(fd, 'deal_id') || null, kind: str(fd, 'kind') as DocKind, title: str(fd, 'title'), body: String(fd.get('body') ?? '') })
    return { data: { id }, message: ['Documento listo. Ábrelo para imprimirlo, bajar el PDF o mandarlo por correo.', 'Document ready. Open it to print it, download the PDF or email it.'], revalidate: [`/comercios/${accountId}/documentos`] }
  })
}

export async function emailDocumentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const id = str(fd, 'id')
    const st = await emailDocument(ctx, id, str(fd, 'to'))
    return {
      message: st === 'queued_off' ? ['Quedó listo para enviar. El canal de correo está apagado: no salió nada todavía.', 'Ready to send. The email channel is off: nothing has gone out yet.'] : ['Correo registrado.', 'Email recorded.'],
      revalidate: [`/documentos/${id}`],
    }
  })
}
