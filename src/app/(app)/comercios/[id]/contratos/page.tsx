import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { accountContracts } from '@/dal/partners'
import { CONTRACT_STATUS_LABEL, SETTLEMENT_LABEL, SETTLEMENTS } from '@/domain/partners'
import { Badge, Card, CardTitle, Empty, Field, LinkButton, PageHeader } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { day, money, num } from '@/lib/format'
import { commissionStatement } from '@/dal/embudo2-terms'
import * as A from '@/app/(app)/partners/actions'

export const dynamic = 'force-dynamic'

const row = 'flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-t border-line py-4 first:border-t-0'
const small = 'text-[13px] text-muted'
const TONE = { draft: 'neutral', sent: 'info', signed: 'accent', active: 'good', expired: 'warn', cancelled: 'neutral' } as const

/** PIPE-07: términos comerciales versionados, propuesta imprimible y contratos con su estado. */
export default async function ContractsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const d = await accountContracts(ctx, id)
  if (!d) notFound()
  const statement = d.account.can_terms_view ? await commissionStatement(ctx, id) : null
  const a = d.account
  const current = d.terms.find((x) => x.is_current)
  const canTerms = a.can_terms_edit && ctx.can('terms.manage', a.market_code)
  const canContract = ctx.can('contract.manage', a.market_code)
  const pct = (n: number) => `${num(n, locale)}%`
  return (
    <div className="mx-auto max-w-[760px] space-y-8">
      <PageHeader
        eyebrow={a.name}
        title={t('Términos y contratos', 'Terms and contracts')}
        desc={t('Los términos se capturan una vez: de ellos salen la propuesta y el contrato. Cada cambio es una versión nueva y la anterior se conserva.', 'Terms are captured once: the proposal and the contract come from them. Each change is a new version and the previous one is kept.')}
        actions={<LinkButton href={`/comercios/${id}?tab=datos`} testId="contracts-back">{t('Volver', 'Back')}</LinkButton>}
      />

      <Card data-testid="terms-card">
        <CardTitle
          title={t('Términos comerciales', 'Commercial terms')}
          hint={a.can_terms_view ? t('Dato reservado: solo lo ven los roles que el campo deja. La bitácora guarda la versión, nunca los porcentajes.', 'Restricted data: only the roles the field allows can see it. The log keeps the version, never the percentages.') : undefined}
          right={current ? <Badge tone="good">{t(`Versión ${current.version} vigente`, `Version ${current.version} current`)}</Badge> : undefined}
        />
        {!a.can_terms_view ? (
          <Empty title={t('Los términos de esta cuenta son reservados', 'This account’s terms are restricted')} hint={t('Tu rol no los ve. Si los necesitas, pídelos a quien lidera el mercado.', 'Your role cannot see them. If you need them, ask the market lead.')} />
        ) : d.terms.length === 0 ? (
          <Empty title={t('Todavía no hay términos', 'No terms yet')} hint={t('Captura la comisión por producto, el tipo de liquidación, el plazo y el aviso de renovación. Con eso sale la propuesta.', 'Capture the commission per product, settlement type, term and renewal notice. The proposal comes from that.')} />
        ) : (
          <ul data-testid="terms-list">
            {d.terms.map((v) => (
              <li key={v.id} className={row} data-testid="terms-row">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-strong">{t(`Versión ${v.version}`, `Version ${v.version}`)} {v.is_current && <Badge tone="good">{t('Vigente', 'Current')}</Badge>}</p>
                  <p className={small}>{v.commission_lines.map((l) => `${l.product}${l.product_code ? ` (${l.product_code})` : ''}: ${pct(l.pct)}`).join(' · ')}</p>
                  <p className={small}>
                    {t(...SETTLEMENT_LABEL[v.settlement as 'prepaid'])} · {t(`${v.term_months} meses`, `${v.term_months} months`)} · {day(v.valid_from, locale)} {t('a', 'to')} {day(v.valid_to, locale)}
                    {' · '}{v.nda ? t('Con acuerdo de confidencialidad', 'With NDA') : t('Sin acuerdo de confidencialidad', 'No NDA')}
                    {v.fees ? ` · ${t('Cargos', 'Fees')}: ${v.fees}` : ''}
                  </p>
                  <p className={small}>{t(`Aviso de renovación ${v.renewal_notice_days} días antes`, `Renewal notice ${v.renewal_notice_days} days before`)}{v.created_by_name ? ` · ${v.created_by_name}` : ''}</p>
                </div>
                <LinkButton href={`/comercios/${id}/contratos/propuesta?v=${v.id}`} size="sm" testId="proposal-open">{t('Ver propuesta', 'View proposal')}</LinkButton>
              </li>
            ))}
          </ul>
        )}
        {canTerms && (
          <ActionForm action={A.saveTermsAction} className="mt-6 border-t border-line pt-6" testId="terms-form">
            <input type="hidden" name="account_id" value={id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Comisión por producto (uno por renglón)', 'Commission per product (one per line)')} hint={t('Ejemplo: "Recargas: 4.5"', 'Example: "Top-ups: 4.5"')} className="sm:col-span-2">
                <textarea name="lines" className="input min-h-24" required defaultValue={current?.commission_lines.map((l) => `${l.product}: ${l.pct}`).join('\n') ?? ''} data-testid="terms-lines" />
              </Field>
              <Field label={t('Liquidación', 'Settlement')}>
                <select name="settlement" className="input" defaultValue={current?.settlement ?? 'prepaid'} data-testid="terms-settlement">
                  {SETTLEMENTS.map((s) => <option key={s} value={s}>{t(...SETTLEMENT_LABEL[s])}</option>)}
                </select>
              </Field>
              <Field label={t('Plazo en meses', 'Term in months')}>
                <input name="term_months" type="number" min={1} max={120} className="input" required defaultValue={current?.term_months ?? 12} data-testid="terms-months" />
              </Field>
              <Field label={t('Vigencia desde', 'Valid from')}>
                <input name="valid_from" type="date" className="input" required defaultValue={current?.valid_from ?? ''} data-testid="terms-from" />
              </Field>
              <Field label={t('Aviso de renovación (días antes)', 'Renewal notice (days before)')}>
                <input name="renewal_notice_days" type="number" min={0} max={365} className="input" defaultValue={current?.renewal_notice_days ?? 30} data-testid="terms-notice" />
              </Field>
              <Field label={t('Cargos (opcional)', 'Fees (optional)')} className="sm:col-span-2">
                <input name="fees" className="input" maxLength={300} defaultValue={current?.fees ?? ''} data-testid="terms-fees" />
              </Field>
              <Field label={t('Notas (opcional)', 'Notes (optional)')} className="sm:col-span-2">
                <input name="note" className="input" maxLength={500} defaultValue={current?.note ?? ''} />
              </Field>
              <label className="flex min-h-11 items-center gap-3 text-[14px] text-strong sm:col-span-2">
                <input type="checkbox" name="nda" defaultChecked={current?.nda ?? false} className="h-5 w-5" data-testid="terms-nda" />
                {t('Hay acuerdo de confidencialidad firmado', 'A signed NDA is in place')}
              </label>
            </div>
            <div className="mt-5"><Submit testId="terms-save">{current ? t('Guardar como versión nueva', 'Save as a new version') : t('Guardar términos', 'Save terms')}</Submit></div>
          </ActionForm>
        )}
      </Card>

      {a.can_terms_view && statement && (
        <Card data-testid="terms-statement">
          <CardTitle title={t('Estado de comisiones del mes (vista previa)', 'Commission statement for the month (preview)')}
            hint={t(`Sale de los términos vigentes (versión ${statement.version}) y de los pagos del mes del archivo de ventas${statement.as_of ? `, corte del ${day(statement.as_of, locale)}` : ''}. Cómo y cuándo se paga lo define el paquete de comisiones [pendiente: Finanzas].`, `It comes from the current terms (version ${statement.version}) and the month's payments in the sales file${statement.as_of ? `, as of ${day(statement.as_of, locale)}` : ''}. How and when it is paid is defined by the commissions package [pending: Finance].`)} />
          <p className={small} data-testid="terms-statement-channel">{statement.channel ? t(`Canal que la gana: ${statement.channel}`, `Channel that earns it: ${statement.channel}`) : t('Sin canal atribuido: la comisión queda sin a quién pagarse hasta que se atribuya.', 'No channel attributed: the commission has nobody to be paid to until it is attributed.')}</p>
          <ul className="mt-2 divide-y divide-line" data-testid="terms-statement-lines">
            {statement.lines.map((l) => (
              <li key={l.product} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[14px]" data-testid="terms-statement-line">
                <span className="text-strong">{l.product}{l.product_code ? ` (${l.product_code})` : ''} · {pct(l.pct)} {!l.linked && <Badge tone="warn">{t('sin ligar al catálogo de productos', 'not linked to the product catalog')}</Badge>}</span>
                <span className="text-muted-2">{l.payments_mtd_minor === null ? t('sin pagos en el archivo de ventas', 'no payments in the sales file') : t(`pagos ${money(l.payments_mtd_minor, l.currency ?? 'USD', locale)} · comisión ${money(l.commission_minor, l.currency ?? 'USD', locale)}`, `payments ${money(l.payments_mtd_minor, l.currency ?? 'USD', locale)} · commission ${money(l.commission_minor, l.currency ?? 'USD', locale)}`)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card data-testid="contracts-card">
        <CardTitle
          title={t('Contratos', 'Contracts')}
          hint={t('La firma electrónica está apagada: al firmarse, márcalo a mano con la fecha, quién firmó y el enlace al documento. Al llegar el plazo de renovación, quien lleva la cuenta recibe un aviso.', 'Electronic signature is off: once signed, mark it by hand with the date, who signed and the document link. When the renewal period arrives, the account owner gets a notice.')}
          right={canContract && current ? (
            <ActionForm action={A.createContractAction}>
              <input type="hidden" name="account_id" value={id} />
              <Submit size="sm" testId="contract-create">{t('Crear contrato', 'Create contract')}</Submit>
            </ActionForm>
          ) : undefined}
        />
        {d.contracts.length === 0 ? (
          <Empty title={t('Sin contratos', 'No contracts')} hint={current ? t('Crea el contrato desde los términos vigentes.', 'Create the contract from the current terms.') : t('Primero se capturan los términos; el contrato sale de ellos.', 'Terms come first; the contract comes from them.')} />
        ) : (
          <ul data-testid="contracts-list">
            {d.contracts.map((c) => (
              <li key={c.id} className={row} data-testid="contract-row">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-strong">
                    {day(c.starts_on, locale)} {t('a', 'to')} {day(c.ends_on, locale)}
                    <Badge tone={TONE[c.status]}>{t(...CONTRACT_STATUS_LABEL[c.status])}</Badge>
                    {c.renewed_from && <Badge tone="neutral">{t('Renovación', 'Renewal')}</Badge>}
                  </p>
                  <p className={small}>
                    {c.terms_version ? t(`Términos versión ${c.terms_version}`, `Terms version ${c.terms_version}`) : t('Términos reservados', 'Restricted terms')}
                    {c.entity_name && <span data-testid="contract-entity">{' · '}{t(`Entidad: ${c.entity_name}`, `Entity: ${c.entity_name}`)}</span>}
                    {c.esign_state === 'channel_off' ? ` · ${t('Firma electrónica: canal apagado', 'Electronic signature: channel off')}` : ''}
                    {c.renewal_noticed_at ? ` · ${t('Aviso de renovación dado', 'Renewal notice given')}` : ''}
                  </p>
                  {c.signed_on && (
                    <p className={small} data-testid="contract-signed">
                      {t(`Firmó ${c.signed_by_name} el ${day(c.signed_on, locale)}`, `Signed by ${c.signed_by_name} on ${day(c.signed_on, locale)}`)}
                      {c.document_url && <> · <a href={c.document_url} target="_blank" rel="noreferrer noopener" className="text-blue-text underline">{t('Documento', 'Document')}</a></>}
                    </p>
                  )}
                </div>
                {canContract && (
                  <div className="flex flex-wrap gap-2">
                    {c.status === 'draft' && (
                      <ActionForm action={A.sendContractAction}>
                        <input type="hidden" name="id" value={c.id} /><input type="hidden" name="account_id" value={id} />
                        <Submit size="sm" variant="ghost" testId="contract-send">{t('Marcar enviado', 'Mark as sent')}</Submit>
                      </ActionForm>
                    )}
                    {(c.status === 'draft' || c.status === 'sent') && (
                      <Dialog trigger={t('Marcar firmado', 'Mark as signed')} title={t('Contrato firmado', 'Signed contract')} size="sm" testId="contract-sign-open">
                        <ActionForm action={A.markSignedAction} onOk="close" testId="contract-sign-form">
                          <input type="hidden" name="id" value={c.id} /><input type="hidden" name="account_id" value={id} />
                          <div className="grid gap-4">
                            <Field label={t('Fecha de firma', 'Signing date')}><input name="signed_on" type="date" className="input" required data-testid="sign-date" /></Field>
                            <Field label={t('Quién firmó del lado del cliente', 'Who signed for the client')}><input name="signed_by" className="input" required maxLength={120} data-testid="sign-by" /></Field>
                            <Field label={t('Enlace al documento firmado', 'Link to the signed document')} hint={t('Donde vive el documento (empieza con https://).', 'Where the document lives (starts with https://).')}><input name="document_url" type="url" className="input" required placeholder="https://" data-testid="sign-url" /></Field>
                          </div>
                          <div className="mt-5"><Submit testId="sign-save">{t('Guardar firma', 'Save signature')}</Submit></div>
                        </ActionForm>
                      </Dialog>
                    )}
                    {(c.status === 'active' || c.status === 'expired' || c.status === 'signed') && (
                      <ActionForm action={A.renewContractAction}>
                        <input type="hidden" name="id" value={c.id} /><input type="hidden" name="account_id" value={id} />
                        <Submit size="sm" variant="ghost" testId="contract-renew">{t('Renovar', 'Renew')}</Submit>
                      </ActionForm>
                    )}
                    {c.status !== 'expired' && c.status !== 'cancelled' && (
                      <ActionForm action={A.cancelContractAction}>
                        <input type="hidden" name="id" value={c.id} /><input type="hidden" name="account_id" value={id} />
                        <Submit size="sm" variant="quiet" testId="contract-cancel">{t('Cancelar', 'Cancel')}</Submit>
                      </ActionForm>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
