import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { getAccountHeader, getAccountMarketData } from '@/dal/markets'
import { Badge, Field, KeyVal, cx } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { CopyButton } from '@/ui/confirm'
import { LocationFields } from '@/ui/geo'
import { clock, day, dayTime, money, num, phoneText, zoneName } from '@/lib/format'
import { CONTACT_ROLE, EXCEPTION, lab } from '@/lib/labels'
import { FICHA_FACT_LABEL, MARKET_ZONES, distanceText, type FichaFact } from '@/lib/markets'
import { TAX_ID_TYPES, TAX_STATUS, maskedTaxId, taxIdTypeFor } from '@/lib/tax-id'
import { whatsappMarketMode } from '@/server/adapters/markets'
import {
  captureTaxIdAction, clearLocationAction, openWhatsappWindowAction, reviewTaxIdAction, setAccountProfileAction, setLocationAction, updateAddressAction,
} from './mercados-actions'

/**
 * UX-01: lo importante arriba, según el rol de quien abre la ficha. Qué datos ve cada rol y en qué orden vive en
 * crm.ficha_layouts (se cambia en Administración); todos salen de una sola llamada a la base (app.account_header).
 */
export async function FichaFacts({ ctx, id, treeHref }: { ctx: Ctx; id: string; treeHref: string }) {
  const data = await getAccountHeader(ctx, id)
  if (!data) return null
  const { t, locale } = ctx
  const { header: h, facts, role, units } = data
  const market = ctx.markets.find((m) => m.code === h.market)
  const tz = market?.timezone ?? 'UTC'
  const unit = h.business_unit ? units[h.business_unit] : undefined
  const none = (es: string, en: string) => <span className="font-normal text-muted-2">{t(es, en)}</span>
  const value: Record<FichaFact, React.ReactNode> = {
    next_step: h.next_step ? <>{h.next_step.text}{h.next_step.due ? <span className="font-normal text-muted-2"> · {day(h.next_step.due, locale)}</span> : null}</> : none('Sin próximo paso', 'No next step'),
    owner_team: <>{h.owner ?? t('Sin asignar', 'No owner')}<span className="font-normal text-muted-2"> · {h.team ?? t('sin equipo', 'no team')}</span></>,
    tree: h.path.length > 0 || h.below > 0
      ? <Link href={treeHref} scroll={false} className="text-blue-text underline" data-testid="fact-tree-link">{[...h.path.map((p) => p.name), t('esta cuenta', 'this account')].join(' › ')}{h.below > 0 ? ` · ${t(`${num(h.below, locale)} debajo`, `${num(h.below, locale)} below`)}` : ''}</Link>
      : none('Cuenta independiente', 'Independent account'),
    alerts: h.alerts > 0
      ? <span className="text-amber-text">{t(`${num(h.alerts, locale)} ${h.alerts === 1 ? 'abierto' : 'abiertos'}`, `${num(h.alerts, locale)} open`)}<span className="font-normal"> · {h.alert_kinds.map((k) => lab(t, EXCEPTION[k]?.label, k)).join(', ')}</span></span>
      : none('Ninguno abierto', 'None open'),
    data_as_of: h.data_as_of ? day(h.data_as_of, locale) : none('Sin datos de ventas todavía', 'No sales data yet'),
    sales_30d: h.txn_30d !== null
      ? <>{t(`${num(h.txn_30d, locale)} ${h.txn_30d === 1 ? 'venta' : 'ventas'}`, `${num(h.txn_30d, locale)} ${h.txn_30d === 1 ? 'sale' : 'sales'}`)}{h.volume_minor_30d ? <span className="font-normal text-muted-2"> · {money(h.volume_minor_30d, h.volume_currency ?? market?.currency ?? 'USD', locale, true)}</span> : null}</>
      : none('Sin datos de ventas todavía', 'No sales data yet'),
    open_deal: h.open_deal
      ? <Link href={`/deals/${h.open_deal.id}`} className="text-blue-text underline">{t(h.open_deal.stage_es, h.open_deal.stage_en)}{h.open_deal.amount_minor !== null ? ` · ${money(h.open_deal.amount_minor, h.open_deal.currency, locale, true)}` : ''}{h.open_deal.currency !== 'USD' && h.open_deal.amount_usd_minor !== null ? ` (${money(h.open_deal.amount_usd_minor, 'USD', locale, true)})` : ''}</Link>
      : none('Ninguno abierto', 'None open'),
    contact: h.contact ? <>{h.contact.name}<span className="font-normal text-muted-2"> · {lab(t, CONTACT_ROLE[h.contact.role])}{h.contact.phone ? ` · ${phoneText(h.contact.phone)}` : ''}</span></> : none('Sin contactos todavía', 'No contacts yet'),
    tax_id: h.tax ? <>{maskedTaxId(h.tax.last4)}<span className={cx('font-normal', h.tax.status === 'verified' ? 'text-brand-text' : h.tax.status === 'rejected' ? 'text-red-text' : 'text-amber-text')}> · {t(TAX_STATUS[h.tax.status].es, TAX_STATUS[h.tax.status].en)}</span></> : none('Sin capturar', 'Not captured'),
    entity: <>{h.entity}{h.entity_review ? <span className="font-normal text-amber-text"> · {t('nombre por confirmar', 'name to be confirmed')}</span> : null}<span className="font-normal text-muted-2"> · {unit ? t(unit.es, unit.en) : t('sin unidad de negocio', 'no business unit')}</span></>,
  }
  const now = new Date()
  return (
    <div className="mt-3" data-testid="ficha-facts" data-role={role}>
      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f} className="border-t border-line py-2" data-testid={`fact-${f}`}>
            <dt className="text-[12.5px] text-muted">{t(FICHA_FACT_LABEL[f].es, FICHA_FACT_LABEL[f].en)}</dt>
            <dd className="text-[14px] leading-5 font-medium text-strong [overflow-wrap:anywhere]">{value[f]}</dd>
          </div>
        ))}
      </dl>
      {h.own_timezone && h.timezone !== tz && (
        <p className="mt-1 text-[13px] text-muted-2" data-testid="fact-local-time">{t(`Allá son las ${clock(now, locale, h.timezone)} (${zoneName(h.timezone, locale)}).`, `It is ${clock(now, locale, h.timezone)} there (${zoneName(h.timezone, locale)}).`)}</p>
      )}
      {h.whatsapp_until && (
        <p className="mt-1 text-[13px] font-medium text-brand-text" data-testid="fact-whatsapp-window">{t(`WhatsApp: le puedes responder sin plantilla hasta ${dayTime(h.whatsapp_until, locale, h.timezone)}.`, `WhatsApp: you can reply without a template until ${dayTime(h.whatsapp_until, locale, h.timezone)}.`)}</p>
      )}
    </div>
  )
}

/**
 * Bloques de mercados en la pestaña Datos: entidad legal, unidad de negocio y zona horaria; identificador fiscal;
 * dirección con el formato del país y ubicación; y la ventana de WhatsApp.
 */
export async function FichaMercados({ ctx, id, market, archived, name }: { ctx: Ctx; id: string; market: string; archived: boolean; name: string }) {
  const d = await getAccountMarketData(ctx, id)
  if (!d) return null
  const { t, locale } = ctx
  const p = d.profile
  const canEdit = !archived && ctx.can('account.edit', market)
  const canEntity = !archived && ctx.can('account.entity', market)
  const canTax = !archived && ctx.can('taxid.capture', market)
  const canReview = !archived && ctx.can('taxid.review', market)
  const canWrite = !archived && ctx.can('activity.write', market)
  const section = 'border-t border-line pt-6'
  const h3 = 'text-[15px] leading-6 font-semibold'
  const unit = d.units.find((u) => u.code === p.business_unit)
  const zones = [...new Set([p.market_timezone, ...(MARKET_ZONES[market] ?? []), ...(p.timezone ? [p.timezone] : [])])]
  const tz = p.timezone ?? p.market_timezone
  const defaultType = taxIdTypeFor(p.country)
  const tax = d.tax
  const layerName: Record<string, [string, string]> = { format: ['Formato y dígito verificador', 'Format and check digit'], registry: ['Registro oficial', 'Official registry'], risk_list: ['Listas de riesgo', 'Risk lists'], human: ['Revisión de una persona', 'Review by a person'] }
  const resultName: Record<string, [string, string]> = { pass: ['Pasó', 'Passed'], fail: ['No pasó', 'Failed'], review: ['Pide revisión', 'Needs review'], queued_off: ['Canal apagado', 'Channel off'] }
  const wa = whatsappMarketMode()
  const geoSource: Record<string, [string, string]> = { manual: ['escrita a mano', 'typed by hand'], device: ['tomada con el teléfono', 'taken with the phone'], sales_app: ['de la Sales App', 'from the Sales App'], geocoder: ['calculada desde la dirección', 'worked out from the address'], import: ['importada', 'imported'] }

  return (
    <>
      <section className={section} data-testid="account-entity">
        <h3 className={h3}>{t('Entidad, unidad de negocio y hora', 'Entity, business unit and time')}</h3>
        <dl className="mt-2">
          <KeyVal k={t('Entidad legal', 'Legal entity')}><span data-testid="entity-name">{p.entity_name}</span>{p.entity_review ? <span className="ml-2"><Badge tone="warn">{t('nombre por confirmar', 'name to be confirmed')}</Badge></span> : null}</KeyVal>
          <KeyVal k={t('Unidad de negocio', 'Business unit')}><span data-testid="unit-name">{unit ? t(unit.label_es, unit.label_en) : t('Sin dato', 'Not set')}</span></KeyVal>
          <KeyVal k={t('Zona horaria', 'Time zone')}><span data-testid="zone-name">{zoneName(tz, locale)} · {clock(new Date(), locale, tz)}{p.timezone ? '' : ` · ${t('la del mercado', 'the market’s')}`}</span></KeyVal>
        </dl>
        {canEdit && (
          <ActionForm action={setAccountProfileAction} className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2" testId="profile-form">
            <input type="hidden" name="id" value={id} />
            {canEntity && d.entities.length > 1 ? (
              <Field label={t('Entidad legal', 'Legal entity')} className="sm:col-span-2" hint={t('Los negocios abiertos de este comercio la siguen; los cerrados conservan la suya.', 'This merchant’s open deals follow it; closed deals keep theirs.')}>
                <select name="entity_id" className="input" defaultValue={p.legal_entity_id} data-testid="entity-select">{d.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              </Field>
            ) : <input type="hidden" name="entity_id" value={p.legal_entity_id} />}
            <Field label={t('Unidad de negocio', 'Business unit')}>
              <select name="business_unit" className="input" defaultValue={p.business_unit ?? ''} data-testid="unit-select"><option value="">{t('Sin dato', 'Not set')}</option>{d.units.map((u) => <option key={u.code} value={u.code}>{t(u.label_es, u.label_en)}</option>)}</select>
            </Field>
            <Field label={t('Zona horaria del comercio', 'Merchant’s time zone')}>
              <select name="timezone" className="input" defaultValue={p.timezone ?? ''} data-testid="zone-select"><option value="">{t(`La del mercado (${zoneName(p.market_timezone, locale)})`, `The market’s (${zoneName(p.market_timezone, locale)})`)}</option>{zones.filter((z) => z !== p.market_timezone).map((z) => <option key={z} value={z}>{zoneName(z, locale, undefined, true)}</option>)}</select>
            </Field>
            <div className="flex justify-end sm:col-span-2"><Submit variant="ghost" size="sm" testId="profile-save">{t('Guardar', 'Save')}</Submit></div>
          </ActionForm>
        )}
      </section>

      <section className={section} data-testid="account-tax">
        <h3 className={h3}>{t('Identificador fiscal', 'Tax ID')}</h3>
        {tax ? (
          <>
            <dl className="mt-2">
              <KeyVal k={lab(t, [TAX_ID_TYPES.find((x) => x.type === tax.id_type)?.es ?? tax.id_type, TAX_ID_TYPES.find((x) => x.type === tax.id_type)?.en ?? tax.id_type])}><span className="num" data-testid="tax-masked">{maskedTaxId(tax.last4)}</span></KeyVal>
              <KeyVal k={t('Estado', 'Status')}><span data-testid="tax-status" data-status={tax.status}><Badge tone={TAX_STATUS[tax.status].tone}>{t(TAX_STATUS[tax.status].es, TAX_STATUS[tax.status].en)}</Badge></span></KeyVal>
              {tax.legal_name && <KeyVal k={t('Nombre o razón social', 'Legal name')}>{tax.legal_name}</KeyVal>}
              {tax.tax_regime && <KeyVal k={t('Régimen fiscal', 'Tax regime')}>{tax.tax_regime}</KeyVal>}
              {tax.tax_postal_code && <KeyVal k={t('Código postal fiscal', 'Tax postal code')}>{tax.tax_postal_code}</KeyVal>}
              <KeyVal k={t('Lo capturó', 'Captured by')}>{tax.captured_by ?? t('Sin dato', 'Not set')} · {day(tax.captured_at, locale, tz)}</KeyVal>
            </dl>
            <ul className="mt-2 space-y-1.5" data-testid="tax-checks">
              {d.checks.map((c, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]" data-testid={`tax-check-${c.layer}`} data-result={c.result}>
                  <span className="text-muted-2">{lab(t, layerName[c.layer], c.layer)}</span>
                  <span className={cx('font-medium', c.result === 'pass' ? 'text-brand-text' : c.result === 'fail' ? 'text-red-text' : c.result === 'review' ? 'text-amber-text' : 'text-muted-2')}>
                    {lab(t, resultName[c.result], c.result)}{c.layer === 'human' && c.actor ? ` · ${c.actor}` : ''}{c.layer === 'human' && c.detail ? ` · ${c.detail}` : ''}
                    {c.layer === 'format' && c.detail === 'checksum_mismatch' ? ` · ${t('el dígito verificador no cuadra', 'the check digit does not add up')}` : ''}
                    {c.layer === 'format' && c.detail === 'no_check_digit' ? ` · ${t('este tipo no trae dígito verificador', 'this type has no check digit')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {d.taxRepeats.length > 0 && (
              <div className="mt-3 rounded-[12px] bg-warn-bg px-4 py-3 text-[13.5px] text-amber-text" role="status" data-testid="tax-repeats">
                <p className="font-medium">{t('El mismo identificador está en:', 'The same identifier is on:')}</p>
                <ul className="mt-1">{d.taxRepeats.map((r) => <li key={r.account_id}>{r.name}{r.locality ? ` · ${r.locality}` : ''} · {r.owner_name ? t(`lo lleva ${r.owner_name}`, `owned by ${r.owner_name}`) : t('sin asignar', 'no owner')}</li>)}</ul>
              </div>
            )}
            {!tax.fingerprint && <p className="mt-2 text-[13px] text-muted-2" data-testid="tax-no-fingerprint">{t('En este ambiente no se revisa si el identificador se repite en otro comercio: falta una llave que pone administración.', 'This environment does not check whether the identifier repeats on another merchant: a key set by administration is missing.')}</p>}
          </>
        ) : <p className="mt-2 text-[15px] text-muted" data-testid="tax-none">{t('Sin capturar todavía. Se captura una sola vez y sirve para todos los documentos.', 'Not captured yet. It is captured once and serves every document.')}</p>}
        <p className="mt-2 text-[13px] text-muted" data-testid="tax-privacy">{t('CONTIGO valida el identificador y guarda solo los últimos 4. El valor completo no se guarda.', 'CONTIGO validates the identifier and stores only the last 4. The full value is not stored.')}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {canTax && (
            <Dialog trigger={tax ? t('Capturar de nuevo', 'Capture again') : t('Capturar identificador', 'Capture tax ID')} title={t(`Identificador fiscal de ${name}`, `Tax ID for ${name}`)} size="sm" testId="tax-capture">
              <ActionForm action={captureTaxIdAction} onOk="close" className="grid grid-cols-1 gap-4" testId="tax-form">
                <input type="hidden" name="id" value={id} />
                <Field label={t('Tipo', 'Type')}><select name="type" className="input" defaultValue={defaultType} data-testid="tax-type">{TAX_ID_TYPES.map((x) => <option key={x.type} value={x.type}>{t(x.es, x.en)}</option>)}</select></Field>
                <Field label={t('Identificador', 'Identifier')} hint={t('Escríbelo como viene en el documento. Un SSN no se captura: pide el EIN.', 'Enter it as it appears on the document. An SSN is not captured: ask for the EIN.')}>
                  <input name="value" className="input" required maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} data-testid="tax-value" />
                </Field>
                <Field label={t('Nombre o razón social', 'Legal name')} hint={t('En México, exacto como en la constancia fiscal.', 'In Mexico, exactly as on the tax certificate.')}><input name="legal_name" className="input" maxLength={160} defaultValue={tax?.legal_name ?? ''} data-testid="tax-legal-name" /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t('Régimen fiscal', 'Tax regime')}><input name="tax_regime" className="input" maxLength={80} defaultValue={tax?.tax_regime ?? ''} data-testid="tax-regime" /></Field>
                  <Field label={t('Código postal fiscal', 'Tax postal code')}><input name="tax_postal_code" className="input" maxLength={12} inputMode="numeric" defaultValue={tax?.tax_postal_code ?? ''} data-testid="tax-postal" /></Field>
                </div>
                <div className="flex justify-end"><Submit testId="tax-save">{t('Validar y guardar', 'Validate and save')}</Submit></div>
              </ActionForm>
            </Dialog>
          )}
          {canReview && tax && tax.status !== 'verified' && (
            <Dialog trigger={t('Revisar', 'Review')} title={t('Revisar contra el documento', 'Check against the document')} size="sm" variant="quiet" testId="tax-review">
              <ActionForm action={reviewTaxIdAction} onOk="close" className="grid grid-cols-1 gap-4" testId="tax-review-form">
                <input type="hidden" name="id" value={id} />
                <p className="text-[14px] text-muted-2">{t(`Compara los últimos 4 (${tax.last4}) y el nombre con el documento del comercio.`, `Compare the last 4 (${tax.last4}) and the name with the merchant’s document.`)}</p>
                <Field label={t('Qué documento revisaste', 'Which document you checked')}><input name="note" className="input" required minLength={3} maxLength={300} data-testid="tax-review-note" /></Field>
                <div className="flex flex-wrap justify-end gap-3">
                  <Submit variant="danger" name="decision" value="reject" testId="tax-reject">{t('Rechazar', 'Reject')}</Submit>
                  <Submit name="decision" value="approve" testId="tax-approve">{t('Aprobar', 'Approve')}</Submit>
                </div>
              </ActionForm>
            </Dialog>
          )}
        </div>
      </section>

      <section className={section} data-testid="account-address">
        <h3 className={h3}>{t('Dirección y ubicación', 'Address and location')}</h3>
        {canEdit ? (
          <ActionForm action={updateAddressAction} className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2" testId="address-form">
            <input type="hidden" name="id" value={id} /><input type="hidden" name="country" value={p.country} />
            {d.format.fields.map((f) => {
              const v = (p as unknown as Record<string, string | null>)[f.key] ?? ''
              const label = `${t(f.es, f.en)}${f.required ? '' : ` ${t('(opcional)', '(optional)')}`}`
              return (
                <Field key={f.key} label={label} className={f.key === 'address_line' ? 'sm:col-span-2' : undefined} hint={f.key === 'postal_code' && d.format.postal_example ? t(`Por ejemplo, ${d.format.postal_example}.`, `For example, ${d.format.postal_example}.`) : undefined}>
                  {f.key === 'region' && d.format.regions.length > 0 ? (
                    <select name="region" className="input" defaultValue={d.format.regions.find((r) => r.toUpperCase() === v.toUpperCase()) ?? ''} required={f.required} data-testid="address-region">
                      <option value="">{t('Elige', 'Pick one')}</option>
                      {v && !d.format.regions.some((r) => r.toUpperCase() === v.toUpperCase()) && <option value={v}>{v}</option>}
                      {d.format.regions.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : <input name={f.key} className="input" defaultValue={v} required={f.required} maxLength={f.key === 'address_line' ? 200 : 120} data-testid={`address-${f.key}`} />}
                </Field>
              )
            })}
            <div className="flex justify-end sm:col-span-2"><Submit variant="ghost" size="sm" testId="address-save">{t('Guardar dirección', 'Save address')}</Submit></div>
          </ActionForm>
        ) : (
          <dl className="mt-2">{d.format.fields.map((f) => <KeyVal key={f.key} k={t(f.es, f.en)}>{(p as unknown as Record<string, string | null>)[f.key] ?? t('Sin dato', 'Not set')}</KeyVal>)}</dl>
        )}

        <div className="mt-5 rounded-[12px] bg-surface-2 px-4 py-4" data-testid="account-location">
          <p className="text-[14px] font-semibold text-strong">{t('Ubicación', 'Location')}</p>
          {p.latitude ? (
            <p className="mt-1 text-[13.5px] text-muted-2" data-testid="location-current">
              <span className="num">{Number(p.latitude).toFixed(5)}, {Number(p.longitude).toFixed(5)}</span> · {lab(t, geoSource[p.geo_source ?? 'manual'])}{p.geo_accuracy_m !== null ? ` (±${p.geo_accuracy_m} m)` : ''}{p.geo_by ? ` · ${p.geo_by}` : ''}{p.geo_at ? ` · ${day(p.geo_at, locale, tz)}` : ''}
            </p>
          ) : <p className="mt-1 text-[13.5px] text-muted-2" data-testid="location-none">{t('Sin ubicación. Con ella el comercio aparece en "Cerca de mí" y se detectan comercios repetidos en el mismo lugar.', 'No location. With it the merchant shows up in "Near me" and repeated merchants in the same spot are detected.')}</p>}
          {d.near.length > 0 && (
            <div className="mt-3 rounded-[10px] bg-warn-bg px-4 py-3 text-[13.5px] text-amber-text" role="status" data-testid="location-near">
              <p className="font-medium">{t('A menos de 60 metros hay otro comercio. ¿Es el mismo?', 'There is another merchant within 60 meters. Is it the same one?')}</p>
              <ul className="mt-1">{d.near.map((n) => <li key={n.id} data-testid="location-near-row">{n.name} · {distanceText(n.distance_m, locale)} · {n.owner_name ? t(`lo lleva ${n.owner_name}`, `owned by ${n.owner_name}`) : t('sin asignar', 'no owner')}</li>)}</ul>
            </div>
          )}
          {canEdit && (
            <ActionForm action={setLocationAction} className="mt-3" testId="location-form">
              <input type="hidden" name="id" value={id} />
              <LocationFields latitude={p.latitude ?? ''} longitude={p.longitude ?? ''} labels={{
                latitude: t('Latitud', 'Latitude'), longitude: t('Longitud', 'Longitude'), use: t('Usar la ubicación de este teléfono', 'Use this phone’s location'), locating: t('Buscando tu ubicación', 'Finding your location'),
                denied: t('El navegador no dio permiso de ubicación. Actívalo en los ajustes del navegador o escribe los números a mano.', 'The browser did not allow location. Turn it on in the browser settings or type the numbers by hand.'),
                unavailable: t('No se pudo leer la ubicación. Intenta otra vez o escribe los números a mano.', 'The location could not be read. Try again or type the numbers by hand.'),
                got: t('Ubicación del teléfono lista: revisa que estés en el comercio y guarda', 'Phone location ready: check you are at the merchant and save'),
                hint: t('Estando en el comercio, usa la ubicación del teléfono. O escribe la latitud y la longitud.', 'While at the merchant, use the phone’s location. Or type the latitude and longitude.'),
              }} />
              <div className="mt-3 flex flex-wrap justify-end gap-3"><Submit variant="ghost" size="sm" testId="location-save">{t('Guardar ubicación', 'Save location')}</Submit></div>
            </ActionForm>
          )}
          {canEdit && p.latitude && (
            <ActionForm action={clearLocationAction} className="mt-1 flex justify-end">
              <input type="hidden" name="id" value={id} />
              <Submit variant="quiet" size="sm" testId="location-clear">{t('Quitar ubicación', 'Remove location')}</Submit>
            </ActionForm>
          )}
          <p className="mt-2 text-[12.5px] text-muted" data-testid="location-map-off">{t('El mapa y la búsqueda de coordenadas por dirección están apagados; la distancia se calcula aquí mismo.', 'The map and address lookup for coordinates are off; distance is calculated right here.')}</p>
        </div>
      </section>

      <section className={section} data-testid="account-whatsapp">
        <h3 className={h3}>WhatsApp</h3>
        <p className="mt-2 text-[14px] text-strong" data-testid="wa-window" data-open={d.window ? 'yes' : 'no'}>
          {d.window
            ? t(`Ventana abierta hasta ${dayTime(d.window.expires_at, locale, tz)}: se le puede responder sin plantilla.`, `Window open until ${dayTime(d.window.expires_at, locale, tz)}: you can reply without a template.`)
            : t('Sin ventana abierta. Cuando el comercio escribe primero, hay 24 horas para responderle sin plantilla ni costo.', 'No open window. When the merchant writes first, there are 24 hours to reply with no template and no cost.')}
        </p>
        <p className="mt-1 text-[13px] text-muted-2" data-testid="wa-channel">
          {d.whatsapp ? t(`Número de este mercado: ${d.whatsapp.display_name}${d.whatsapp.phone ? ` (${phoneText(d.whatsapp.phone)})` : ''}. `, `This market’s number: ${d.whatsapp.display_name}${d.whatsapp.phone ? ` (${phoneText(d.whatsapp.phone)})` : ''}. `) : t('Este mercado todavía no tiene número de WhatsApp configurado. ', 'This market has no WhatsApp number set up yet. ')}
          {wa.mode === 'off' ? t('El envío desde CONTIGO está apagado: hoy se escribe desde el teléfono, con el botón de arriba.', 'Sending from CONTIGO is off: today you write from your phone, with the button above.') : t('Envío simulado (pruebas).', 'Simulated sending (tests).')}
        </p>
        {d.whatsapp?.phone && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-2" data-testid="wa-me">
            <span>{t('Para que el comercio escriba primero, compártele este enlace (también sirve impreso en el mostrador):', 'So the merchant writes first, share this link (it also works printed at the counter):')}</span>
            <span className="num font-medium text-strong [overflow-wrap:anywhere]" data-testid="wa-me-link">wa.me/{d.whatsapp.phone.replace(/\D/g, '')}</span>
            <CopyButton value={`https://wa.me/${d.whatsapp.phone.replace(/\D/g, '')}`} label={t('Copiar el enlace de WhatsApp del mercado', 'Copy the market’s WhatsApp link')} done={t('Enlace copiado.', 'Link copied.')} />
          </p>
        )}
        {canWrite && (
          <ActionForm action={openWhatsappWindowAction} className="mt-3 flex flex-wrap items-end gap-3" testId="wa-form">
            <input type="hidden" name="id" value={id} />
            <Field label={t('El comercio me escribió', 'The merchant wrote to me')}>
              <select name="kind" className="input !w-64" defaultValue="service_24h" data-testid="wa-kind"><option value="service_24h">{t('Por su cuenta (24 horas)', 'On their own (24 hours)')}</option><option value="ad_72h">{t('Desde un anuncio (72 horas)', 'From an ad (72 hours)')}</option></select>
            </Field>
            <Submit variant="ghost" size="sm" testId="wa-open">{t('Anotar', 'Note it')}</Submit>
          </ActionForm>
        )}
      </section>
    </>
  )
}
