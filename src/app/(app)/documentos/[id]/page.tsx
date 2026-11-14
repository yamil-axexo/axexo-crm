import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getDocument } from '@/dal/documents'
import { DOC_LABEL } from '@/domain/documents'
import { ActionForm, Submit } from '@/ui/client'
import { PrintButton } from '@/ui/orders'
import { PdfButton } from '@/ui/pdf-button'
import { Field } from '@/ui/kit'
import { dayTime } from '@/lib/format'
import { emailDocumentAction } from '@/app/(app)/comercios/[id]/documentos/actions'

export const dynamic = 'force-dynamic'

/**
 * E5.F9: el documento en una hoja lista para imprimir. "Bajar PDF" lo arma el navegador (sin red). En papel solo sale la hoja.
 * La bóveda está apagada: el documento vive en CONTIGO y este es su enlace.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  const d = await getDocument(ctx, id)
  if (!d) notFound()
  const canSend = ctx.can('document.generate', d.market_code)
  const footer = `${d.header ?? 'axexo'} · ${dayTime(d.created_at, locale)}`
  const safeName = d.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'documento'
  return (
    <div data-testid="document-print">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/comercios/${d.account_id}/documentos`} className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="document-back">{t('Volver a los documentos', 'Back to documents')}</Link>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          <PrintButton label={t('Imprimir', 'Print')} />
          <PdfButton label={t('Bajar PDF', 'Download PDF')} title={d.title} body={d.body} footer={footer} fileName={`${safeName}.pdf`} />
        </span>
      </div>
      <article className="card mx-auto max-w-[820px] p-6 md:p-10" data-testid="document-sheet">
        <header className="border-b border-line pb-5">
          <p className="text-[13px] font-semibold tracking-wide text-muted-2 uppercase">{t(...DOC_LABEL[d.kind])}</p>
          <h1 className="text-[24px] leading-8 font-semibold text-strong [overflow-wrap:anywhere]" data-testid="document-title">{d.title}</h1>
        </header>
        <div className="py-5 text-[14.5px] leading-6 whitespace-pre-wrap text-strong [overflow-wrap:anywhere]" data-testid="document-body">{d.body}</div>
        <footer className="border-t border-line pt-4 text-[12.5px] text-muted-2">{footer}</footer>
      </article>
      <section className="mx-auto mt-6 max-w-[820px] space-y-3 print:hidden" data-testid="document-share">
        <p className="text-[13px] text-muted-2" data-testid="document-vault">{t('La bóveda de documentos está apagada: este documento vive en CONTIGO y este es su enlace.', 'The document vault is off: this document lives in CONTIGO and this is its link.')}</p>
        {d.emailed_at && <p className="text-[13px] text-muted-2" data-testid="document-emailed">{t(`Correo a ${d.emailed_to} el ${dayTime(d.emailed_at, locale)}: ${d.email_status === 'queued_off' ? 'en cola, canal apagado' : d.email_status}.`, `Email to ${d.emailed_to} on ${dayTime(d.emailed_at, locale)}: ${d.email_status === 'queued_off' ? 'queued, channel off' : d.email_status}.`)}</p>}
        {canSend && (
          <ActionForm action={emailDocumentAction} className="flex flex-wrap items-end gap-3" testId="document-email-form">
            <input type="hidden" name="id" value={d.id} />
            <Field label={t('Mandar por correo a', 'Email to')}><input type="email" name="to" required maxLength={160} className="input !w-72" data-testid="document-email-to" /></Field>
            <Submit variant="ghost" testId="document-email">{t('Enviar por correo', 'Send by email')}</Submit>
          </ActionForm>
        )}
      </section>
    </div>
  )
}
