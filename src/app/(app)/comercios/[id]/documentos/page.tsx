import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { getAccount } from '@/dal/accounts'
import { accountDealsForDocs, accountDocuments } from '@/dal/documents'
import { DOC_KINDS, DOC_LABEL, documentDraft, type DocKind } from '@/domain/documents'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { dayTime } from '@/lib/format'
import { flat } from '@/server/params'
import { generateDocumentAction } from './actions'

export const dynamic = 'force-dynamic'

/** E5.F9: documentos de plantilla del comercio. Se generan desde aquí y cada uno se abre imprimible, en PDF o para mandarlo. */
export default async function AccountDocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; negocio?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const data = await getAccount(ctx, id)
  if (!data) notFound()
  const a = data.account
  const sp = flat(await searchParams)
  const kind: DocKind = (DOC_KINDS as readonly string[]).includes(sp.tipo ?? '') ? (sp.tipo as DocKind) : 'proposal'
  const deals = await accountDealsForDocs(ctx, id)
  const dealId = deals.some((d) => d.id === sp.negocio) ? sp.negocio! : kind === 'order' ? (deals[0]?.id ?? null) : null
  const canMake = ctx.can('document.generate', a.market_code)
  const draft = canMake ? await documentDraft(ctx, id, kind, dealId) : null
  const docs = await accountDocuments(ctx, id)
  const href = (k: DocKind) => `/comercios/${id}/documentos?tipo=${k}${dealId ? `&negocio=${dealId}` : ''}`
  return (
    <div className="mx-auto max-w-[860px]" data-testid="documents-page">
      <Link href={`/comercios/${id}?tab=datos`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-blue-text hover:underline" data-testid="documents-back">
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />{a.name}
      </Link>
      <PageHeader title={t('Documentos', 'Documents')} desc={t('Pedido, propuesta o carta con los datos del comercio. Ajusta el texto, guárdalo y ábrelo para imprimirlo, bajar el PDF o mandarlo por correo.', 'Order, proposal or letter with the merchant’s data. Adjust the text, save it and open it to print it, download the PDF or email it.')} />
      <div className="space-y-6">
        {draft && (
          <Card data-testid="documents-new">
            <CardTitle title={t('Nuevo documento', 'New document')} />
            <Pills label={t('Tipo de documento', 'Document type')} current={kind} items={DOC_KINDS.map((k) => ({ key: k, href: href(k), label: t(...DOC_LABEL[k]) }))} />
            {deals.length > 0 && (
              <nav aria-label={t('Negocio', 'Deal')} className="mt-4 flex flex-wrap items-center gap-2 text-[13.5px]">
                <span className="text-muted-2">{t('Negocio:', 'Deal:')}</span>
                {kind !== 'order' && <Link href={`/comercios/${id}/documentos?tipo=${kind}`} aria-current={!dealId ? 'page' : undefined} className="inline-flex min-h-11 items-center underline">{t('Ninguno', 'None')}</Link>}
                {deals.map((d) => <Link key={d.id} href={`/comercios/${id}/documentos?tipo=${kind}&negocio=${d.id}`} aria-current={d.id === dealId ? 'page' : undefined} className={`inline-flex min-h-11 items-center underline ${d.id === dealId ? 'font-semibold text-strong' : 'text-blue-text'}`}>{d.title}</Link>)}
              </nav>
            )}
            <ActionForm action={generateDocumentAction} className="mt-4 space-y-4" testId="documents-form">
              <input type="hidden" name="account_id" value={id} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="deal_id" value={draft.dealId ?? ''} />
              <Field label={t('Título', 'Title')}><input name="title" defaultValue={draft.title} required minLength={3} maxLength={160} className="input" data-testid="doc-title" /></Field>
              <Field label={t('Texto', 'Text')} hint={t('No escribas datos de tarjetas, cuentas bancarias ni identificaciones.', 'Do not write card, bank account or ID numbers.')}>
                <textarea name="body" defaultValue={draft.body} required rows={14} maxLength={8000} className="input min-h-72 font-[inherit]" data-testid="doc-body" />
              </Field>
              <Submit testId="doc-generate">{t('Generar documento', 'Generate document')}</Submit>
            </ActionForm>
          </Card>
        )}
        <Card data-testid="documents-list">
          <CardTitle title={t('Documentos de este comercio', 'This merchant’s documents')} />
          {docs.length === 0 ? <Empty title={t('Todavía no hay documentos', 'No documents yet')} hint={canMake ? t('Genera el primero arriba.', 'Generate the first one above.') : undefined} /> : (
            <ul>
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid="document-row">
                  <Link href={`/documentos/${d.id}`} className="min-w-0 flex-1 basis-60">
                    <span className="block text-[14.5px] font-semibold text-blue-text underline [overflow-wrap:anywhere]" data-testid="document-link">{d.title}</span>
                    <span className="text-[12.5px] text-muted-2">{[t(...DOC_LABEL[d.kind]), dayTime(d.created_at, locale), d.created_by_name].filter(Boolean).join(' · ')}</span>
                  </Link>
                  {d.email_status === 'queued_off' && <Badge>{t('Correo en cola, canal apagado', 'Email queued, channel off')}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
