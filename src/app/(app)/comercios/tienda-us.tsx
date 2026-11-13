import Link from 'next/link'
import type { Ctx } from '@/server/context'
import type { Carrier, StoreRecord } from '@/dal/store-record'
import { PRODUCT_STATUSES } from '@/domain/gobierno'
import { Badge, Field, KeyVal, NoData } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { ago, day, money, num } from '@/lib/format'
import { PRODUCT_STATUS, PRODUCT_TONE } from '@/lib/datos-labels'
import { lab } from '@/lib/labels'
import { ORIGIN, recruiterText } from '@/lib/store-labels'
import { setCarrierDetailAction, setMerchantOriginAction, setRecruiterAction, setStoreProfileAction, setTaxIdAction } from './tienda-actions'

// La ficha de dealer (épica E9): lo que el equipo de campo de US lee primero (ventas e identificadores), los datos de la
// tienda (qué es, tipo de negocio, origen, zona, reclutado por, Tax ID) y su portafolio de carriers.

const section = 'border-t border-line pt-6'
const h3 = 'text-[15px] leading-6 font-semibold'

type Metrics = { as_of: string; last_txn_at: Date | null; txn_count_30d: number; volume_minor_30d: string; currency: string; prev_txn_count_30d?: number | null } | null | undefined

/** E9.F1: la ficha abre con las cifras de venta y los identificadores de la tienda, antes que cualquier otra cosa. */
export function SalesFirst({ ctx, record, metrics }: { ctx: Ctx; record: StoreRecord; metrics: Metrics }) {
  const { t, locale } = ctx
  const live = record.carriers.filter((c) => c.status === 'active' || c.status === 'approved')
  const cell = 'rounded-[12px] border border-line bg-surface px-3 py-2.5'
  const dt = 'text-[12.5px] text-muted-2'
  const dd = 'mt-0.5 text-[15px] leading-5 font-semibold text-strong [overflow-wrap:anywhere]'
  const delta = metrics && metrics.prev_txn_count_30d && metrics.prev_txn_count_30d > 0 ? Math.round(((metrics.txn_count_30d - metrics.prev_txn_count_30d) / metrics.prev_txn_count_30d) * 100) : null
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="sales-first" aria-label={t('Ventas e identificadores', 'Sales and identifiers')}>
      <div className={cell}>
        <dt className={dt}>{t('Ventas, 30 días', 'Sales, 30 days')}</dt>
        <dd className={dd} data-testid="sf-sales">{metrics ? `${num(metrics.txn_count_30d, locale)} · ${money(Number(metrics.volume_minor_30d), metrics.currency, locale, true)}` : t('Todavía no vende', 'Not selling yet')}</dd>
        {metrics && <dd className="text-[12.5px] text-muted-2">{delta === null ? t(`al ${day(metrics.as_of, locale)}`, `as of ${day(metrics.as_of, locale)}`) : t(`${delta > 0 ? '+' : ''}${delta}% contra los 30 días anteriores`, `${delta > 0 ? '+' : ''}${delta}% vs the previous 30 days`)}</dd>}
      </div>
      <div className={cell}>
        <dt className={dt}>{t('Última venta', 'Last sale')}</dt>
        <dd className={dd} data-testid="sf-last">{metrics?.last_txn_at ? ago(metrics.last_txn_at, locale) : <NoData locale={locale} />}</dd>
      </div>
      <div className={cell}>
        <dt className={dt}>Merchant ID</dt>
        <dd className={dd} data-testid="sf-merchant">{record.merchant_ref ?? <NoData locale={locale} />}</dd>
      </div>
      <div className={cell}>
        <dt className={dt}>{t('Número de sitio', 'Site number')}</dt>
        <dd className={dd} data-testid="sf-site">{record.site_ref ?? <NoData locale={locale} />}</dd>
      </div>
      <div className={`${cell} col-span-2`}>
        <dt className={dt}>{t('Operadores aprobados', 'Approved carriers')}</dt>
        <dd className={dd} data-testid="sf-carriers">{live.length ? live.map((c) => t(c.label_es, c.label_en)).join(', ') : t('Ninguno todavía', 'None yet')}</dd>
      </div>
    </dl>
  )
}

/** E9.F2 a F6, F12 y F13: qué es la tienda y sus datos fijos. Lo que se fija una vez se dice, y solo se ofrece mientras falta. */
export function StoreProfileSection({ ctx, accountId, record, typeName, territory, tz, can }: {
  ctx: Ctx; accountId: string; record: StoreRecord; typeName: string; territory: string | null; tz: string
  can: { ops: boolean; edit: boolean; origin: boolean; recruiter: boolean }
}) {
  const { t, locale } = ctx
  const recruiter = recruiterText(t, record.recruited_by, record.recruited_agency)
  const since = (d: Date | null) => (d ? ` · ${t('desde', 'since')} ${day(d, locale, tz)}` : '')
  return (
    <section className={section} data-testid="store-profile">
      <div className="flex items-center justify-between gap-3">
        <h3 className={h3}>{t('La tienda', 'The store')}</h3>
        {(can.ops || (can.edit && record.takes_business_type)) && (
          <Dialog trigger={t('Editar', 'Edit')} title={t('Datos de la tienda', 'Store details')} size="sm" testId="store-profile-edit">
            <ActionForm action={setStoreProfileAction} onOk="close" className="space-y-4">
              <input type="hidden" name="account_id" value={accountId} />
              {can.ops && (
                <Field label={t('Número de sitio o terminal', 'Site or terminal number')} hint={t('El que la tienda ve en su portal. Sirve a Soporte para encontrarla.', 'The one the store sees in its portal. Support uses it to find the store.')}>
                  <input name="site_ref" className="input" maxLength={40} defaultValue={record.site_ref ?? ''} data-testid="site-ref-input" />
                </Field>
              )}
              {can.edit && record.takes_business_type && (
                <Field label={t('Tipo de negocio', 'Business type')}>
                  <select name="business_type" className="input" defaultValue={record.business_type ?? ''} data-testid="business-type-select">
                    <option value="">{t('Sin definir', 'Not set')}</option>
                    {record.businessTypes.map((b) => <option key={b.code} value={b.code}>{t(b.label_es, b.label_en)}</option>)}
                  </select>
                </Field>
              )}
              <div className="flex justify-end"><Submit testId="store-profile-save">{t('Guardar', 'Save')}</Submit></div>
            </ActionForm>
          </Dialog>
        )}
      </div>
      <dl className="mt-1">
        <KeyVal k="Merchant ID"><span data-testid="sp-merchant">{record.merchant_ref ?? <NoData locale={locale} />}</span></KeyVal>
        <KeyVal k={t('Número de sitio o terminal', 'Site or terminal number')}><span data-testid="sp-site">{record.site_ref ?? <NoData locale={locale} />}</span></KeyVal>
        <KeyVal k={t('Qué es', 'Channel segment')}><span data-testid="sp-segment">{typeName}</span></KeyVal>
        {record.takes_business_type && <KeyVal k={t('Tipo de negocio', 'Business type')}><span data-testid="sp-business">{record.business_es ? t(record.business_es, record.business_en ?? record.business_es) : <NoData locale={locale} />}</span></KeyVal>}
        <KeyVal k={t('Origen del comercio', 'Merchant origin')}><span data-testid="sp-origin">{record.merchant_origin ? `${lab(t, ORIGIN[record.merchant_origin], record.merchant_origin)}${since(record.merchant_origin_at)}` : t('Sin definir', 'Not set')}</span></KeyVal>
        <KeyVal k={t('Zona', 'Zone / Territory')}><span data-testid="sp-zone">{territory ?? <NoData locale={locale} />}</span></KeyVal>
        <KeyVal k={t('Reclutado por', 'Recruited by')}><span data-testid="sp-recruiter">{recruiter ? `${recruiter}${since(record.recruited_at)}` : t('Sin definir', 'Not set')}</span></KeyVal>
        <KeyVal k="Tax ID"><span data-testid="sp-tax">{record.tax_id_last4 ? t(`Termina en ${record.tax_id_last4}`, `Ends in ${record.tax_id_last4}`) : <NoData locale={locale} />}</span></KeyVal>
      </dl>

      {!record.merchant_origin && can.origin && (
        <ActionForm action={setMerchantOriginAction} className="mt-4 flex flex-wrap items-end gap-2" testId="origin-form">
          <input type="hidden" name="account_id" value={accountId} />
          <Field label={t('Origen del comercio', 'Merchant origin')} hint={t('Se fija una vez y no se cambia.', 'It is set once and does not change.')} className="min-w-0 flex-1">
            <select name="merchant_origin" className="input" required defaultValue="" data-testid="origin-select">
              <option value="" disabled>{t('Elige el origen', 'Pick the origin')}</option>
              {Object.entries(ORIGIN).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}
            </select>
          </Field>
          <Submit variant="ghost" testId="origin-save">{t('Fijar origen', 'Set origin')}</Submit>
        </ActionForm>
      )}
      {!record.recruited_by && can.recruiter && (
        <ActionForm action={setRecruiterAction} className="mt-4 flex flex-wrap items-end gap-2" testId="recruiter-form">
          <input type="hidden" name="account_id" value={accountId} />
          <Field label={t('Reclutado por', 'Recruited by')} hint={t('Se fija una vez y no se cambia. También queda en los negocios de la tienda.', 'It is set once and does not change. It also goes on the store’s deals.')} className="min-w-0 flex-1">
            <select name="recruited_by" className="input" required defaultValue="" data-testid="recruiter-select">
              <option value="" disabled>{t('Elige quién la reclutó', 'Pick who recruited it')}</option>
              <option value="field_team">{t('Equipo de campo de axexo', 'axexo field team')}</option>
              {record.agencies.map((g) => <option key={g.id} value={g.id}>{g.kind === 'agency' ? t(`Agencia: ${g.name}`, `Agency: ${g.name}`) : t(`Socio: ${g.name}`, `Partner: ${g.name}`)}</option>)}
            </select>
          </Field>
          <Submit variant="ghost" testId="recruiter-save">{t('Fijar', 'Set')}</Submit>
        </ActionForm>
      )}
      {can.edit && (
        <div className="mt-4">
          <Dialog trigger={record.tax_id_last4 ? t('Cambiar Tax ID', 'Change Tax ID') : t('Agregar Tax ID', 'Add Tax ID')} title="Tax ID" size="sm" variant="quiet" testId="tax-id-edit">
            <ActionForm action={setTaxIdAction} onOk="close" className="space-y-4">
              <input type="hidden" name="account_id" value={accountId} />
              <Field label={t('Últimos 4 del Tax ID', 'Last 4 of the Tax ID')} hint={t('CONTIGO guarda solo los últimos 4. Con eso se reconoce a la tienda en sus documentos. Si escribes el número completo, se guardan solo los últimos 4.', 'CONTIGO keeps only the last 4. That is enough to recognize the store on its documents. If you enter the full number, only the last 4 are kept.')}>
                <input name="tax_id" className="input" maxLength={24} autoComplete="off" defaultValue={record.tax_id_last4 ?? ''} data-testid="tax-id-input" />
              </Field>
              <div className="flex justify-end"><Submit testId="tax-id-save">{t('Guardar', 'Save')}</Submit></div>
            </ActionForm>
          </Dialog>
        </div>
      )}
    </section>
  )
}

function CarrierForm({ ctx, accountId, carrier, providers }: { ctx: Ctx; accountId: string; carrier?: Carrier; providers?: StoreRecord['available'] }) {
  const { t } = ctx
  const refLabel = carrier?.ref_label ?? t('Identificador con el operador', 'Carrier ID')
  return (
    <ActionForm action={setCarrierDetailAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
      <input type="hidden" name="account_id" value={accountId} />
      {carrier ? <input type="hidden" name="provider_id" value={carrier.provider_id} /> : (
        <Field label={t('Operador', 'Carrier')} className="col-span-2">
          <select name="provider_id" className="input" required defaultValue="" data-testid="carrier-pick">
            <option value="" disabled>{t('Elige el operador', 'Pick the carrier')}</option>
            {providers!.map((p) => <option key={p.id} value={p.id}>{t(p.label_es, p.label_en)}</option>)}
          </select>
        </Field>
      )}
      <Field label={t('Estado', 'Status')} className="col-span-2" hint={t('Las fechas de envío y de aprobación se anotan solas al cambiar el estado.', 'Submission and approval dates are recorded when the status changes.')}>
        <select name="status" className="input" defaultValue={carrier?.status ?? 'requested'} data-testid="carrier-status">{PRODUCT_STATUSES.map((k) => <option key={k} value={k}>{t(...PRODUCT_STATUS[k]!)}</option>)}</select>
      </Field>
      <Field label={refLabel} className="col-span-2"><input name="carrier_ref" className="input" maxLength={60} defaultValue={carrier?.carrier_ref ?? ''} data-testid="carrier-ref" /></Field>
      <Field label={t('Kit enviado', 'Kit sent')}><input name="kit_sent_on" type="date" className="input" defaultValue={carrier?.kit_sent_on ?? ''} data-testid="carrier-kit" /></Field>
      <Field label={t('SIMs pedidas', 'SIMs ordered')}><input name="sims_ordered" type="number" min={0} max={100000} className="input" defaultValue={carrier?.sims_ordered ?? ''} data-testid="carrier-sims" /></Field>
      <Field label={t('Capacitación', 'Training')} className="col-span-2"><input name="training_on" type="date" className="input" defaultValue={carrier?.training_on ?? ''} data-testid="carrier-training" /></Field>
      <div className="col-span-2 flex justify-end"><Submit testId="carrier-save">{t('Guardar', 'Save')}</Submit></div>
    </ActionForm>
  )
}

/**
 * E9.F8, F9, F10 y E10.F2: el portafolio de carriers vive en la tienda, lo mantiene Operaciones y corre aparte de las etapas del
 * negocio. Solo aparecen los carriers con los que la tienda trabaja: los demás no ocupan espacio y se ofrecen al agregar.
 */
export function CarrierPortfolio({ ctx, accountId, record, canManage }: { ctx: Ctx; accountId: string; record: StoreRecord; canManage: boolean }) {
  const { t, locale } = ctx
  const fact = (k: string, v: string | number | null) => (v === null || v === '' ? null : `${k}: ${v}`)
  return (
    <section className={section} data-testid="carrier-portfolio">
      <div className="flex items-center justify-between gap-3">
        <h3 className={h3}>{t('Operadores (carriers)', 'Carriers')}</h3>
        {canManage && record.available.length > 0 && (
          <Dialog trigger={t('Agregar operador', 'Add carrier')} title={t('Agregar un operador', 'Add a carrier')} size="sm" testId="carrier-add">
            <CarrierForm ctx={ctx} accountId={accountId} providers={record.available} />
          </Dialog>
        )}
      </div>
      <p className="mt-1 text-[13px] text-muted">{t('Solo aparecen los operadores con los que la tienda trabaja. Operaciones los mantiene aquí; la aprobación corre aparte de las etapas del negocio.', 'Only the carriers this store works with are listed. Operations keeps them here; approval runs alongside the deal stages.')}</p>
      {record.carriers.length === 0 ? (
        <p className="mt-3 text-[15px] text-muted" data-testid="carrier-empty">{canManage ? t('Esta tienda todavía no trabaja con ningún operador. Agrega el primero cuando salga su solicitud.', 'This store does not work with any carrier yet. Add the first one when its request goes out.') : t('Esta tienda todavía no trabaja con ningún operador. Operaciones los agrega cuando sale la primera solicitud.', 'This store does not work with any carrier yet. Operations adds them when the first request goes out.')}</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {record.carriers.map((c) => {
            const facts = [fact(c.ref_label ?? t('Identificador', 'Carrier ID'), c.carrier_ref), fact(t('Kit enviado', 'Kit sent'), c.kit_sent_on ? day(c.kit_sent_on, locale) : null),
              fact(t('SIMs pedidas', 'SIMs ordered'), c.sims_ordered === null ? null : num(c.sims_ordered, locale)), fact(t('Capacitación', 'Training'), c.training_on ? day(c.training_on, locale) : null)].filter(Boolean)
            return (
              <li key={c.provider_id} data-testid="carrier-item" data-carrier={c.label_en}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium text-strong">
                    {t(c.label_es, c.label_en)}
                    <span data-testid="carrier-state"><Badge tone={PRODUCT_TONE[c.status]}>{lab(t, PRODUCT_STATUS[c.status], c.status)}</Badge></span>
                    {!c.is_active && <Badge tone="neutral">{t('Ya no está vigente', 'No longer live')}</Badge>}
                    {c.late && <span data-testid="carrier-late"><Badge tone="bad">{t(`Fuera del plazo de ${c.sla_days} días`, `Past the ${c.sla_days}-day deadline`)}</Badge></span>}
                  </p>
                  {canManage && (
                    <Dialog trigger={t('Editar', 'Edit')} title={t(c.label_es, c.label_en)} size="sm" variant="quiet" testId="carrier-edit">
                      <CarrierForm ctx={ctx} accountId={accountId} carrier={c} />
                    </Dialog>
                  )}
                </div>
                <p className="text-[13px] text-muted-2" data-testid="carrier-dates">
                  {[c.submitted_at ? t(`enviado el ${day(c.submitted_at, locale)}`, `submitted ${day(c.submitted_at, locale)}`) : c.requested_at ? t(`solicitado el ${day(c.requested_at, locale)}`, `requested ${day(c.requested_at, locale)}`) : null,
                    c.decided_at ? (c.status === 'rejected' ? t(`rechazado el ${day(c.decided_at, locale)}`, `rejected ${day(c.decided_at, locale)}`) : t(`aprobado el ${day(c.decided_at, locale)}`, `approved ${day(c.decided_at, locale)}`)) : null,
                    c.activated_at ? t(`activo desde el ${day(c.activated_at, locale)}`, `active since ${day(c.activated_at, locale)}`) : null,
                    c.products > 0 ? t(`${c.products} ${c.products === 1 ? 'producto' : 'productos'}`, `${c.products} ${c.products === 1 ? 'product' : 'products'}`) : null].filter(Boolean).join(' · ')}
                  {c.deal_id && <> · <Link href={`/deals/${c.deal_id}`} className="font-medium text-blue-text underline">{t('ver el negocio', 'see the deal')}</Link></>}
                </p>
                {facts.length > 0 && <p className="text-[13px] text-strong [overflow-wrap:anywhere]" data-testid="carrier-facts">{facts.join(' · ')}</p>}
              </li>
            )
          })}
        </ul>
      )}
      {(record.retired_carriers || canManage) && (
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
          <p className="min-w-0 text-muted-2 [overflow-wrap:anywhere]" data-testid="carrier-retired">{t('Operadores anteriores', 'Earlier carriers')}: {record.retired_carriers ?? t('ninguno anotado', 'none on record')}</p>
          {canManage && (
            <Dialog trigger={t('Anotar anteriores', 'Note earlier ones')} title={t('Operadores anteriores', 'Earlier carriers')} size="sm" variant="quiet" testId="carrier-retired-edit">
              <ActionForm action={setStoreProfileAction} onOk="close" className="space-y-4">
                <input type="hidden" name="account_id" value={accountId} />
                <Field label={t('Operadores con los que trabajó y ya no están vigentes', 'Carriers it worked with that are no longer live')} hint={t('Texto libre, hasta 300 letras.', 'Free text, up to 300 characters.')}>
                  <input name="retired_carriers" className="input" maxLength={300} defaultValue={record.retired_carriers ?? ''} data-testid="carrier-retired-input" />
                </Field>
                <div className="flex justify-end"><Submit testId="carrier-retired-save">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
            </Dialog>
          )}
        </div>
      )}
    </section>
  )
}
