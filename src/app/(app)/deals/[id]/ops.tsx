import type { Ctx } from '@/server/context'
import type { getDealOps } from '@/dal/ops'
import { OPS_LABEL, DOCUMENT_STATUS, PROVIDER_STATUS, TRAINING_STATUS } from '@/domain/ops'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { CopyValue, MerchantRefForm } from '@/ui/ops'
import { day, money, noData } from '@/lib/format'
import { addItemAction, merchantRefAction, opsCheckAction, opsStepAction, removeItemAction, returnDealAction, takeDealAction, trainingAction } from '@/app/(app)/operaciones/actions'

/** Precio unitario con centavos: 2.50 no se muestra como 3. */
const price = (minor: number | null, currency: string, locale: 'es' | 'en') =>
  minor === null ? noData(locale) : new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2 }).format(minor / 100)

type Ops = NonNullable<Awaited<ReturnType<typeof getDealOps>>>
type Item = { id: string; name: string; quantity: string; unit_price_minor: string | null; sum_minor: string | null; currency: string; comments: string | null }

/** Líneas del pedido: producto del catálogo, cantidad, precio unitario y total. El monto del negocio es la suma. */
export function DealItems({ ctx, dealId, open, items, ops, currency }: { ctx: Ctx; dealId: string; open: boolean; items: Item[]; ops: Ops; currency: string }) {
  const { t, locale } = ctx
  const canEdit = open && ops.has_items && ctx.can('deal.edit', ops.market_code)
  const total = items.reduce((n, it) => n + Number(it.sum_minor ?? 0), 0)
  return (
    <Card data-testid="deal-items">
      <CardTitle title={ops.has_items ? t('Líneas del pedido', 'Order lines') : t('Productos', 'Products')}
        hint={ops.has_items ? t('El monto del negocio es la suma de sus líneas.', 'The deal amount is the sum of its lines.') : undefined} />
      {items.length === 0 && <p className="text-[14.5px] text-muted" data-testid="items-empty">{t('Todavía no hay líneas. Agrega el primer producto.', 'No lines yet. Add the first product.')}</p>}
      <ul>
        {items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="item-row">
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-strong">{it.name}</span>
              <span className="num block text-[13px] text-muted-2">{Number(it.quantity)} × {price(it.unit_price_minor ? Number(it.unit_price_minor) : null, it.currency, locale)}</span>
              {it.comments ? <span className="block text-[12.5px] text-muted">{it.comments}</span> : null}
            </span>
            <span className="num font-medium whitespace-nowrap text-strong">{money(it.sum_minor ? Number(it.sum_minor) : null, it.currency, locale)}</span>
            {canEdit && (
              <ActionForm action={removeItemAction}>
                <input type="hidden" name="deal_id" value={dealId} /><input type="hidden" name="item_id" value={it.id} />
                <Submit variant="quiet" size="sm" testId="item-remove">{t('Quitar', 'Remove')}</Submit>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <p className="mt-2 flex items-baseline justify-between border-t border-line pt-3 text-[15px] font-semibold text-strong" data-testid="items-total">
          <span>{t('Total', 'Total')}</span><span className="num">{money(total, currency, locale)}</span>
        </p>
      )}
      {ops.has_items && items.length > 0 && (
        <p className="mt-3 text-[14px]">
          <a href={`/deals/${dealId}/pedido`} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="order-print-link">{t('Ver el pedido para imprimir o enviarlo a Operaciones', 'Open the order to print it or send it to Operations')}</a>
        </p>
      )}
      {canEdit && (ops.products.length > 0 ? (
        <ActionForm action={addItemAction} onOk="reset" className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <input type="hidden" name="deal_id" value={dealId} />
          <Field label={t('Producto', 'Product')} className="col-span-2 md:col-span-1">
            <select name="product_id" className="input" required defaultValue="" data-testid="item-product">
              <option value="">{t('Elige un producto', 'Pick a product')}</option>
              {ops.products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.unit_price_minor ? ` · ${price(Number(p.unit_price_minor), currency, locale)}` : ''}</option>)}
            </select>
          </Field>
          <Field label={t('Cantidad', 'Quantity')}><input name="quantity" className="input" inputMode="decimal" required defaultValue="1" data-testid="item-quantity" /></Field>
          <Field label={t(`Precio unitario (${currency})`, `Unit price (${currency})`)} hint={t('Vacío: el del catálogo', 'Empty: catalog price')}><input name="unit_price" className="input" inputMode="decimal" data-testid="item-price" /></Field>
          <div className="col-span-2 flex justify-end md:col-span-1"><Submit variant="ghost" testId="item-add">{t('Agregar línea', 'Add line')}</Submit></div>
        </ActionForm>
      ) : <p className="mt-4 text-[13.5px] text-muted">{t('El catálogo de productos de este mercado está vacío. Administración lo llena en Administración, Operaciones.', 'This market’s product catalog is empty. Admin fills it in under Administration, Operations.')}</p>)}
    </Card>
  )
}

const tone = (s: string | null) => (s === 'approved' || s === 'validated' || s === 'done' ? 'good' : s === 'rejected' ? 'bad' : s === 'sent' || s === 'received' || s === 'scheduled' ? 'accent' : 'neutral') as 'good' | 'bad' | 'accent' | 'neutral'

/** Lo que Operaciones lleva del negocio: quién lo tiene, su próximo paso, Merchant ID, proveedores, documentos y capacitación. */
export function DealOpsCard({ ctx, dealId, open, title, ops, today }: { ctx: Ctx; dealId: string; open: boolean; title: string; ops: Ops; today: string }) {
  const { t, locale } = ctx
  const canOps = ctx.can('deal.ops', ops.market_code)
  const edit = canOps && open
  const label = (s: string | null, fallback: string) => (s ? t(OPS_LABEL[s]?.es ?? s, OPS_LABEL[s]?.en ?? s) : fallback)
  const providers = ops.checks.filter((c) => c.kind === 'provider')
  const documents = ops.checks.filter((c) => c.kind === 'document')
  return (
    <Card data-testid="deal-ops">
      <CardTitle title={t('Operaciones', 'Operations')}
        hint={ops.is_ops ? t('Este negocio está con Operaciones. Desde aquí solo Operaciones lo avanza.', 'This deal is with Operations. From here only Operations moves it forward.') : t('Lo que Operaciones mantiene de este negocio.', 'What Operations keeps for this deal.')}
        right={ops.ops_owner ? <Badge tone="accent">{t(`Lo lleva ${ops.ops_owner}`, `Handled by ${ops.ops_owner}`)}</Badge> : ops.is_ops ? <Badge tone="warn">{t('Sin tomar', 'Not taken')}</Badge> : undefined} />

      {edit && ops.is_ops && (
        <div className="mb-6 flex flex-wrap gap-3">
          {ops.ops_owner_id !== ctx.user.id && (
            <ActionForm action={takeDealAction}>
              <input type="hidden" name="deal_id" value={dealId} />
              <Submit testId="ops-take">{t('Tomar', 'Take')}</Submit>
            </ActionForm>
          )}
          {ops.return_to && (
            <Dialog trigger={t('Devolver a Ventas', 'Send back to Sales')} title={t(`Devolver ${title} a Ventas`, `Send ${title} back to Sales`)} variant="ghost" testId="ops-return">
              <ActionForm action={returnDealAction} onOk="close">
                <input type="hidden" name="deal_id" value={dealId} /><input type="hidden" name="stage_id" value={ops.return_to} />
                <p className="mb-4 text-[14px] text-muted-2">{t('El negocio vuelve a la etapa de Ventas anterior y a quien lo vendió le aparece hoy con el motivo.', 'The deal goes back to the previous Sales stage and the seller sees it today with the reason.')}</p>
                <Field label={t('Motivo', 'Reason')}>
                  <select name="reason" className="input" defaultValue="" required data-testid="return-reason">
                    <option value="">{t('Elige un motivo', 'Pick a reason')}</option>
                    {ops.reasons.map((r) => <option key={r.code} value={r.code}>{t(r.label_es, r.label_en)}</option>)}
                  </select>
                </Field>
                <Field label={t('¿Qué falta? (opcional)', 'What is missing? (optional)')} className="mt-4"><textarea name="note" rows={3} maxLength={300} className="input" data-testid="return-note" /></Field>
                <div className="mt-5 flex justify-end"><Submit testId="return-confirm">{t('Devolver a Ventas', 'Send back to Sales')}</Submit></div>
              </ActionForm>
            </Dialog>
          )}
        </div>
      )}

      <section aria-label="Merchant ID" className="border-t border-line py-4">
        <h3 className="mb-2 text-[14px] font-semibold text-strong">Merchant ID</h3>
        <div className="flex flex-wrap items-end gap-3">
          {ops.merchant_ref ? <CopyValue value={ops.merchant_ref} label={t('Copiar', 'Copy')} copied={t('Merchant ID copiado.', 'Merchant ID copied.')} /> : <span className="text-[14.5px] text-muted" data-testid="merchant-ref-empty">{t('Todavía no se ha anotado.', 'Not recorded yet.')}</span>}
          {canOps && (
            <MerchantRefForm action={merchantRefAction} accountId={ops.account_id} value={ops.merchant_ref ?? ''}
              labels={{ save: t('Guardar', 'Save'), anyway: t('Sí, guardar de todos modos', 'Yes, save anyway'), cancel: t('Cancelar', 'Cancel') }} />
          )}
        </div>
      </section>

      {(edit || ops.ops_next_step) && (
        <section className="border-t border-line py-4">
          <h3 className="mb-2 text-[14px] font-semibold text-strong">{t('Próximo paso de Operaciones', 'Operations next step')}</h3>
          {edit ? (
            <ActionForm action={opsStepAction} className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_170px_auto] md:items-end">
              <input type="hidden" name="deal_id" value={dealId} />
              <input name="ops_next_step" aria-label={t('Próximo paso de Operaciones', 'Operations next step')} className="input" maxLength={200} defaultValue={ops.ops_next_step ?? ''} placeholder={t('Por ejemplo: enviar solicitud al proveedor', 'For example: submit the application to the provider')} data-testid="ops-step" />
              <input name="ops_next_step_due" type="date" aria-label={t('Fecha', 'Date')} className="input" min={today} defaultValue={ops.ops_next_step_due ?? today} data-testid="ops-step-due" />
              <Submit variant="ghost" testId="ops-step-save">{t('Guardar', 'Save')}</Submit>
            </ActionForm>
          ) : <p className="text-[14.5px] text-strong">{ops.ops_next_step} · {day(ops.ops_next_step_due, locale)}</p>}
          <p className="mt-2 text-[13px] text-muted">{t('Es aparte del próximo paso de quien vende: cada quien ve el suyo en Hoy.', 'It is separate from the seller’s next step: each person sees their own in Today.')}</p>
        </section>
      )}

      {[{ key: 'provider', title: t('Aprobación por proveedor', 'Provider approval'), list: providers, statuses: PROVIDER_STATUS, none: 'pending' },
        { key: 'document', title: t('Documentos', 'Documents'), list: documents, statuses: DOCUMENT_STATUS, none: 'missing' }].map((g) => g.list.length > 0 && (
        <section key={g.key} className="border-t border-line py-4" data-testid={`ops-${g.key}s`}>
          <h3 className="mb-1 text-[14px] font-semibold text-strong">{g.title}</h3>
          {g.key === 'document' && <p className="mb-2 text-[13px] text-muted">{t('Aquí va dónde está cada documento (un enlace), no el archivo. Identificaciones y datos bancarios no se guardan en CONTIGO.', 'This holds where each document is (a link), not the file. IDs and bank details are not stored in CONTIGO.')}</p>}
          <ul className="divide-y divide-line">
            {g.list.map((c) => (
              <li key={c.catalog_id} className="py-3" data-testid="ops-check">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[14.5px] font-medium text-strong">{t(c.label_es, c.label_en)}</span>
                  <span className="flex items-center gap-2 text-[13px] text-muted">
                    {c.on_date ? day(c.on_date, locale) : null}
                    {c.link ? <a href={c.link} target="_blank" rel="noreferrer noopener" className="font-medium text-blue-text underline">{t('Abrir enlace', 'Open link')}</a> : null}
                    <Badge tone={tone(c.status)}>{label(c.status, t(OPS_LABEL[g.none]!.es, OPS_LABEL[g.none]!.en))}</Badge>
                  </span>
                </div>
                {canOps && (
                  <ActionForm action={opsCheckAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="deal_id" value={dealId} /><input type="hidden" name="catalog_id" value={c.catalog_id} />
                    <select name="status" aria-label={t(`Estado de ${c.label_es}`, `Status of ${c.label_en}`)} className="input !w-40" defaultValue={c.status ?? g.none} data-testid="ops-check-status">
                      {g.statuses.map((s) => <option key={s} value={s}>{t(OPS_LABEL[s]!.es, OPS_LABEL[s]!.en)}</option>)}
                    </select>
                    <input name="on_date" type="date" aria-label={t(`Fecha de ${c.label_es}`, `Date for ${c.label_en}`)} className="input !w-44" max={today} defaultValue={c.on_date ?? ''} />
                    {g.key === 'document' && <input name="link" type="url" aria-label={t(`Enlace de ${c.label_es}`, `Link for ${c.label_en}`)} className="input !w-auto min-w-[200px] flex-1" placeholder="https://" maxLength={500} defaultValue={c.link ?? ''} data-testid="ops-check-link" />}
                    <Submit variant="ghost" size="sm" testId="ops-check-save">{t('Guardar', 'Save')}</Submit>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {ops.checklist && <section className="border-t border-line pt-4" data-testid="ops-training">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-strong">{t('Capacitación', 'Training')}</h3>
          <span className="flex items-center gap-2 text-[13px] text-muted">{ops.training_on ? day(ops.training_on, locale) : null}<Badge tone={tone(ops.training_status)}>{label(ops.training_status, '')}</Badge></span>
        </div>
        {canOps && (
          <ActionForm action={trainingAction} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="deal_id" value={dealId} />
            <select name="training_status" aria-label={t('Estado de la capacitación', 'Training status')} className="input !w-40" defaultValue={ops.training_status} data-testid="training-status">
              {TRAINING_STATUS.map((s) => <option key={s} value={s}>{t(OPS_LABEL[s]!.es, OPS_LABEL[s]!.en)}</option>)}
            </select>
            <input name="training_on" type="date" aria-label={t('Fecha de la capacitación', 'Training date')} className="input !w-44" defaultValue={ops.training_on ?? ''} data-testid="training-on" />
            <Submit variant="ghost" size="sm" testId="training-save">{t('Guardar', 'Save')}</Submit>
          </ActionForm>
        )}
      </section>}
    </Card>
  )
}
