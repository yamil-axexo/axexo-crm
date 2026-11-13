import { LeadEmbudoPanel } from '@/app/(app)/embudo-panels'
import Link from 'next/link'
import { untrustedMark } from '@/dal/untrusted'
import { UntrustedTag } from '@/ui/untrusted'
import { isWebSource } from '@/lib/lead-source'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getLead, marketPipelines, sellers, territoriesOf } from '@/dal/leads'
import { territoryFor } from '@/lib/territory'
import { CONTACT_ROLES, typeForMotor } from '@/domain/leads'
import { accountTypes, lossReasonsFor } from '@/dal/b2b'
import { LeadCall } from '@/ui/lead-call'
import { Badge, Card, CardTitle, Field, KeyVal, NoData, PageHeader } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { ago, dayTime, marketTime, num, phoneText, zoneNote } from '@/lib/format'
import { OwnTime } from '@/ui/own-time'
import { ACTIVITY, CONTACT_ROLE, LEAD_STATUS, LIFECYCLE, MOTOR, SOURCE, lab } from '@/lib/labels'
import { leadStepAction, takeLeadAction } from '../actions'
import { CompleteButton } from '@/ui/complete'
import { resultOptions, sheetConfig } from '@/server/sheet'
import { buttonClass } from '@/ui/kit'
import { completeItemAction } from '@/app/(app)/hoy/actions'
import { addActivityAction } from '@/app/(app)/actividades/actions'
import { LeadAnswers } from '../answers'
import { LeadScoreCard } from '@/app/(app)/asistencia/panels'

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ comercio?: string | string[] }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  const linkSearch = [(await searchParams).comercio].flat()[0]
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const data = await getLead(ctx, id)
  // IA-07: si el texto del lead llegó de fuera (formulario, archivo), se dice junto al texto.
  const untrusted = data ? await untrustedMark(ctx, 'lead', id) : null
  if (!data) notFound()
  const { lead, duplicates, activities } = data
  const market = ctx.market(lead.market_code)
  const canWork = ctx.can('lead.work', lead.market_code)
  const canAssign = ctx.can('lead.assign', lead.market_code)
  const reasons = canWork ? await lossReasonsFor(ctx, lead.market_code, lead.motor) : []
  const open = ['new', 'contacted', 'qualified'].includes(lead.status)
  const mine = lead.owner_id === ctx.user.id
  const canPass = open && mine && ctx.can('lead.pass', lead.market_code)
  const people = canAssign || canPass ? await sellers(ctx, lead.market_code) : []
  const peers = people.filter((p) => p.id !== ctx.user.id)
  // Embudos que existen en el mercado del lead: de ahí se elige al convertir. El del tipo de venta del lead va primero.
  const pipes = open ? await marketPipelines(ctx, lead.market_code) : []
  const pipe = pipes.find((p) => p.motor === lead.motor) ?? pipes[0]
  const motors = [...new Set([...pipes.map((p) => p.motor), lead.motor])]
  // Territorio del comercio que nace: el único de quien lleva el lead o el de la ciudad del lead. Si lleva dos o más, la hoja
  // lo muestra para confirmarlo, y lo pide cuando la ciudad no dice cuál.
  const territories = lead.status === 'qualified' && canWork ? await territoriesOf(ctx, lead.market_code, lead.owner_id ?? ctx.user.id) : []
  const ownTerritories = territories.filter((x) => x.own)
  const territory = territoryFor(ownTerritories, territories, lead.locality)
  // Tipo de cuenta: el catálogo del mercado (el mismo de la ficha del comercio). Si el del lead ya no está, vale el del tipo de venta.
  const types = await accountTypes(ctx, lead.market_code)
  const fallbackType = typeForMotor(pipe?.motor ?? lead.motor)
  const kind = lead.account_type && types.some((x) => x.code === lead.account_type) ? lead.account_type : fallbackType
  const kindLabel = ((x) => (x ? t(x.label_es, x.label_en) : kind))(types.find((x) => x.code === kind))
  const canEdit = open && canWork && (!!lead.owner_id || canAssign)
  const canCallNow = ['new', 'contacted'].includes(lead.status) && canWork && !!lead.phone && (mine || !lead.owner_id)
  const waiting = lead.status === 'new' && !lead.first_touch_at
  const late = waiting && !!lead.sla_due_at && new Date(lead.sla_due_at) < new Date()
  // Origen del lead web: solo se muestran los datos que llegaron.
  const origin = ([
    ['utm_source', t('Fuente (utm_source)', 'Source (utm_source)'), lead.utm_source],
    ['utm_medium', t('Medio (utm_medium)', 'Medium (utm_medium)'), lead.utm_medium],
    ['utm_campaign', t('Campaña (utm_campaign)', 'Campaign (utm_campaign)'), lead.utm_campaign],
    ['utm_content', t('Anuncio (utm_content)', 'Ad (utm_content)'), lead.utm_content],
    ['utm_term', t('Término (utm_term)', 'Term (utm_term)'), lead.utm_term],
    ['gclid', t('Clic de Google (gclid)', 'Google click (gclid)'), lead.gclid],
    ['fbclid', t('Clic de Meta (fbclid)', 'Meta click (fbclid)'), lead.fbclid],
  ] as const).filter((row): row is readonly [typeof row[0], string, string] => !!row[2])

  return (
    <>
      <PageHeader
        eyebrow={`Lead · ${market.name}`}
        title={lead.business_name}
        desc={[lead.contact_name, lead.locality].filter(Boolean).join(' · ')}
        actions={<Badge tone={LEAD_STATUS[lead.status]?.tone}>{lab(t, LEAD_STATUS[lead.status]?.label)}</Badge>}
      />
      {lead.phone && (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 px-5 py-4" data-testid="lead-callbar">
          <div className="min-w-0">
            <p className="text-[13px] text-muted">{t('Teléfono', 'Phone')}</p>
            <p className="num text-[18px] leading-7 font-semibold text-strong" data-testid="lead-phone-top">{phoneText(lead.phone)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canCallNow ? (
              <LeadCall
                key={`${lead.status}:${lead.first_touch_at ? 1 : 0}`}
                item={{ type: 'lead', id: lead.id, title: ctx.m('action.callOf', { name: lead.business_name }), name: lead.business_name, results: resultOptions(ctx, ['reached', 'no_answer']), defaultResult: null }}
                tel={`tel:${lead.phone}`}
                take={!lead.owner_id}
                label={lead.owner_id ? ctx.m('action.call') : ctx.m('leads.takeAndCall')}
                takeAction={takeLeadAction}
                config={sheetConfig(ctx)}
                completeAction={completeItemAction}
              />
            ) : (
              <a href={`tel:${lead.phone}`} className={buttonClass('primary')} data-testid="lead-call-plain">{ctx.m('action.call')}</a>
            )}
            <a href={`https://wa.me/${lead.phone.slice(1)}`} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost')}>WhatsApp</a>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          {open && canWork && !lead.owner_id && !canAssign && (
            <Card data-testid="lead-free">
              <CardTitle title={t('Nadie lleva este lead', 'This lead has no owner')} hint={t('Tómalo para llamarlo y trabajarlo. Queda a tu nombre.', 'Take it to call and work it. It becomes yours.')} />
              <ActionForm action={takeLeadAction}><input type="hidden" name="id" value={lead.id} /><Submit testId="lead-take">{t('Tomar este lead', 'Take this lead')}</Submit></ActionForm>
            </Card>
          )}
          {open && canWork && (lead.owner_id || canAssign) && (
            <Card data-testid="lead-steps">
              <CardTitle
                title={lead.status === 'qualified' ? t('Listo para convertir', 'Ready to convert') : t('Siguiente paso', 'Next step')}
                hint={
                  lead.status === 'qualified'
                    ? t('Al convertir se crea el comercio como prospecto, su contacto y un negocio con próximo paso.', 'Converting creates the merchant as a prospect, its contact and a deal with a next step.')
                    : late ? t('Este lead ya pasó su tiempo de respuesta.', 'This lead is past its response time.')
                    : waiting && lead.sla_due_at ? <>{t(`Primer contacto: vence el ${marketTime(lead.sla_due_at, locale, market)}`, `First contact: due ${marketTime(lead.sla_due_at, locale, market)}`)}<OwnTime at={new Date(lead.sla_due_at).toISOString()} zone={market.timezone} locale={locale} />{t('. El reloj solo corre en horario hábil.', '. The clock only runs during business hours.')}</>
                    : lead.status === 'new' && lead.first_touch_at ? t('Ya hubo un intento de contacto, sin respuesta.', 'There was a contact attempt, with no answer.')
                    : t('Decide si este lead avanza.', 'Decide whether this lead moves forward.')
                }
              />
              {duplicates.length > 0 && (
                <div className="mb-5 rounded-2xl bg-amber/12 p-4" data-testid="lead-duplicates">
                  <p className="text-[13.5px] font-semibold text-amber-text">{t('Puede que este comercio ya exista:', 'This merchant may already exist:')}</p>
                  <ul className="mt-2 space-y-1.5 text-[13.5px]">
                    {duplicates.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2">
                        <Link href={`/comercios/${d.id}`} className="font-semibold text-strong underline">{d.name}</Link>
                        <span className="text-muted-2">{[d.locality, d.owner_name, lab(t, LIFECYCLE[d.lifecycle]?.label)].filter(Boolean).join(' · ')}</span>
                        <Badge tone="warn">{d.match === 'phone' ? t('mismo teléfono', 'same phone') : t('nombre parecido', 'similar name')}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                {lead.status === 'new' && (
                  <CompleteButton
                    item={{ type: 'lead', id: lead.id, title: ctx.m('action.callOf', { name: lead.business_name }), name: lead.business_name, results: resultOptions(ctx, ['reached', 'no_answer']), defaultResult: 'reached', motor: lead.motor }}
                    config={sheetConfig(ctx)}
                    action={completeItemAction}
                    label={t('Registrar contacto', 'Log contact')}
                    className={buttonClass('primary')}
                    testId="lead-contacted"
                  />
                )}
                {['new', 'contacted'].includes(lead.status) && (
                  <ActionForm action={leadStepAction}><input type="hidden" name="id" value={lead.id} /><Submit name="step" value="qualify" variant={lead.status === 'contacted' ? 'primary' : 'ghost'} testId="lead-qualify">{t('Calificar', 'Qualify')}</Submit></ActionForm>
                )}
                {lead.status === 'qualified' && pipes.length === 0 && (
                  <p className="w-full rounded-[10px] bg-warn-bg px-4 py-3 text-[14px] font-medium text-amber-text" data-testid="lead-no-pipeline">
                    {t(`${market.name} todavía no tiene un embudo de ventas, así que este lead no se puede convertir hoy. Queda calificado y no se pierde: pide a administración que lo configure en Administración, Embudos y campos.`,
                       `${market.name} has no sales pipeline yet, so this lead cannot be converted today. It stays qualified and is not lost: ask administration to set one up in Administration, Pipelines and fields.`)}
                  </p>
                )}
                {lead.status === 'qualified' && pipes.length > 0 && (
                  <ActionForm action={leadStepAction} className="w-full" testId="lead-convert-form">
                    <input type="hidden" name="id" value={lead.id} />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {pipes.length > 1 ? (
                        <Field label={t('Embudo', 'Pipeline')}>
                          <select name="pipeline_id" className="input" defaultValue={pipe?.id} data-testid="lead-pipeline">
                            {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </Field>
                      ) : (
                        <input type="hidden" name="pipeline_id" value={pipe?.id ?? ''} />
                      )}
                      <Field label={t('Tipo de cuenta', 'Account type')}>
                        <select name="account_type" className="input" defaultValue={kind} data-testid="lead-kind">
                          {types.map((x) => <option key={x.code} value={x.code}>{t(x.label_es, x.label_en)}</option>)}
                        </select>
                      </Field>
                      <Field label={t(`Qué hace ${lead.contact_name} en el negocio`, `${lead.contact_name}'s role in the business`)}>
                        <select name="contact_role" className="input" defaultValue={lead.contact_role ?? 'staff'} data-testid="lead-contact-role">
                          {CONTACT_ROLES.map((r) => <option key={r} value={r}>{lab(t, CONTACT_ROLE[r])}</option>)}
                        </select>
                      </Field>
                      {ownTerritories.length > 1 && (
                        <Field label={t('Territorio del comercio', 'Merchant territory')} hint={territory.id ? undefined : t(`${mine ? 'Llevas' : 'Quien lleva este lead cubre'} más de un territorio y la ciudad del lead no dice cuál.`, `${mine ? 'You cover' : 'The owner of this lead covers'} more than one territory and the lead’s city does not say which.`)}>
                          <select name="territory_id" className="input" required defaultValue={territory.id ?? ''} data-testid="lead-territory">
                            {!territory.id && <option value="" disabled>{t('Elige un territorio', 'Pick a territory')}</option>}
                            {ownTerritories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </Field>
                      )}
                      {duplicates.length > 0 && (
                        <Field label={t('Ligar a un comercio existente', 'Link to an existing merchant')}>
                          <select name="link_account_id" className="input" data-testid="lead-link">
                            <option value="">{t('No, crear uno nuevo', 'No, create a new one')}</option>
                            {duplicates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </Field>
                      )}
                    </div>
                    <p className="mt-3 text-[13px] text-muted">{t('Las notas, llamadas y tareas de este lead pasan al hilo del comercio y del negocio.', 'This lead’s notes, calls and tasks move to the merchant and deal thread.')}</p>
                    <div className="mt-4"><Submit name="step" value="convert" variant="primary" testId="lead-convert">{t('Convertir en comercio y negocio', 'Convert to merchant and deal')}</Submit></div>
                  </ActionForm>
                )}
                <Dialog trigger={t('Descartar', 'Disqualify')} title={t('Descartar lead', 'Disqualify lead')} variant="quiet" testId="lead-disqualify">
                  <ActionForm action={leadStepAction} onOk="close">
                    <input type="hidden" name="id" value={lead.id} />
                    <Field label={t('Motivo', 'Reason')}>
                      <select name="reason" className="input" required defaultValue="">
                        <option value="" disabled>{t('Elige un motivo', 'Pick a reason')}</option>
                        {reasons.map((r) => <option key={r.code} value={r.code}>{t(r.label_es, r.label_en)}</option>)}
                      </select>
                    </Field>
                    <div className="mt-5 flex justify-end"><Submit name="step" value="disqualify" variant="danger" testId="lead-disqualify-confirm">{t('Descartar', 'Disqualify')}</Submit></div>
                  </ActionForm>
                </Dialog>
              </div>
            </Card>
          )}
          {lead.status === 'converted' && lead.account_id && (
            <Card><p className="text-[14.5px]">{t('Este lead ya es un comercio: ', 'This lead is now a merchant: ')}<Link href={`/comercios/${lead.account_id}`} className="font-semibold text-blue-text underline" data-testid="lead-account">{t('abrir ficha', 'open record')}</Link></p></Card>
          )}

          <Card>
            <CardTitle title={t('Notas del lead', 'Lead notes')} hint={zoneNote(market, locale)} />
            {canWork && open && (
              <ActionForm action={addActivityAction} onOk="reset" className="mb-6">
                <input type="hidden" name="lead_id" value={lead.id} />
                <div className="flex flex-wrap gap-3">
                  <select name="kind" className="input !w-40" aria-label={t('Tipo', 'Type')}>
                    <option value="note">{lab(t, ACTIVITY.note)}</option><option value="call">{lab(t, ACTIVITY.call)}</option>
                  </select>
                  <input name="subject" className="input !w-auto min-w-[200px] flex-1" required minLength={2} placeholder={t('¿Qué pasó?', 'What happened?')} />
                  <Submit variant="ghost">{t('Agregar', 'Add')}</Submit>
                </div>
              </ActionForm>
            )}
            {activities.length === 0 ? <p className="text-[14px] text-muted">{t('Todavía no hay notas.', 'No notes yet.')}</p> : (
              <ul className="space-y-4">
                {activities.map((a) => (
                  <li key={a.id} className="border-l-2 border-line-2 pl-4">
                    <p className="text-[14px] font-semibold text-strong">{a.subject}</p>
                    {a.body && <p className="mt-0.5 text-[13.5px] whitespace-pre-line text-muted-2 [overflow-wrap:anywhere]">{a.body}</p>}
                    <p className="text-[12.5px] text-muted"><span data-testid="lead-activity-kind">{a.type_label === 'in_person' ? t('En persona', 'In person') : lab(t, ACTIVITY[a.kind])}</span> · {a.author ?? <NoData locale={locale} />} · {dayTime(a.created_at, locale, market.timezone)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-8">
          <Card>
            <CardTitle title={t('Datos', 'Details')} />
            <dl>
              <KeyVal k={t('Teléfono', 'Phone')}>
                {lead.phone ? (
                  <span className="inline-flex flex-wrap justify-end gap-x-3">
                    <a href={`tel:${lead.phone}`} className="font-medium text-blue-text underline" data-testid="lead-tel">{phoneText(lead.phone)}</a>
                    <a href={`https://wa.me/${lead.phone.slice(1)}`} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-text underline">WhatsApp</a>
                  </span>
                ) : <NoData locale={locale} />}
              </KeyVal>
              <KeyVal k={t('Correo', 'Email')}>{lead.email ?? <NoData locale={locale} />}</KeyVal>
              <KeyVal k={t('Tipo de negocio', 'Business type')}><span data-testid="lead-motor">{lab(t, MOTOR[lead.motor]) || lead.motor}</span></KeyVal>
              <KeyVal k={t('Tipo de cuenta', 'Account type')}><span data-testid="lead-kind-text">{kindLabel}</span></KeyVal>
              <KeyVal k={t('Persona de contacto', 'Contact person')}>{[lead.contact_name, lead.contact_role ? lab(t, CONTACT_ROLE[lead.contact_role]) : null].filter(Boolean).join(' · ')}</KeyVal>
              {lead.extra_contacts.length > 0 && (
                <KeyVal k={t('También escribió', 'Also wrote in')}><span data-testid="lead-extra">{lead.extra_contacts.map((c) => [c.name, c.phone ? phoneText(c.phone) : c.email].filter(Boolean).join(' · ')).join('; ')}</span></KeyVal>
              )}
              <KeyVal k={t('Origen', 'Source')}><span data-testid="lead-source-text">{[lab(t, SOURCE[lead.source]), lead.form_name].filter(Boolean).join(' · ')}</span></KeyVal>
              {lead.funnel && <KeyVal k={t('Embudo de campaña', 'Campaign group')}><span data-testid="lead-funnel">{lead.funnel}</span></KeyVal>}
              {lead.channel_id && <KeyVal k={t('Canal de origen', 'Source channel')}><span data-testid="lead-channel">{lead.channel_id}</span></KeyVal>}
              {lead.store_count !== null && <KeyVal k={t('Número de tiendas', 'Number of stores')}><span data-testid="lead-stores">{num(Number(lead.store_count), locale)}</span></KeyVal>}
              <KeyVal k={t('Llegó', 'Arrived')}><span data-testid="lead-arrived">{marketTime(lead.created_at, locale, market)}<OwnTime at={new Date(lead.created_at).toISOString()} zone={market.timezone} locale={locale} /></span></KeyVal>
              <KeyVal k={t('Primer contacto', 'First touch')}>{lead.first_touch_at ? <>{marketTime(lead.first_touch_at, locale, market)}<OwnTime at={new Date(lead.first_touch_at).toISOString()} zone={market.timezone} locale={locale} /></> : <NoData locale={locale} />}</KeyVal>
            </dl>
            {lead.message && <p className="mt-4 rounded-2xl bg-surface-2 p-4 text-[13.5px] text-muted-2">“{lead.message}”</p>}
            {untrusted && <UntrustedTag t={t} origin={untrusted.origin} />}
            {canEdit && (
              <div className="mt-4">
                <Dialog trigger={t('Corregir tipo o rol', 'Fix type or role')} title={t('Tipo de negocio, de cuenta y rol', 'Business type, account type and role')} size="sm" testId="lead-edit-type">
                  <ActionForm action={leadStepAction} onOk="close" className="grid grid-cols-1 gap-4">
                    <input type="hidden" name="id" value={lead.id} />
                    <Field label={t('Tipo de negocio', 'Business type')} hint={t('Solo aparecen los que tienen embudo en este mercado.', 'Only the ones with a pipeline in this market are listed.')}>
                      <select name="motor" className="input" defaultValue={lead.motor} data-testid="lead-edit-motor">
                        {motors.map((k) => <option key={k} value={k}>{lab(t, MOTOR[k]) || k}</option>)}
                      </select>
                    </Field>
                    <Field label={t('Tipo de cuenta', 'Account type')}>
                      <select name="account_type" className="input" defaultValue={kind} data-testid="lead-edit-kind">
                        {types.map((x) => <option key={x.code} value={x.code}>{t(x.label_es, x.label_en)}</option>)}
                      </select>
                    </Field>
                    <Field label={t(`Qué hace ${lead.contact_name} en el negocio`, `${lead.contact_name}'s role in the business`)}>
                      <select name="contact_role" className="input" defaultValue={lead.contact_role ?? ''} data-testid="lead-edit-role">
                        <option value="">{t('Todavía no sé', 'Not sure yet')}</option>
                        {CONTACT_ROLES.map((r) => <option key={r} value={r}>{lab(t, CONTACT_ROLE[r])}</option>)}
                      </select>
                    </Field>
                    <div className="flex justify-end"><Submit name="step" value="details" testId="lead-edit-save">{t('Guardar', 'Save')}</Submit></div>
                  </ActionForm>
                </Dialog>
              </div>
            )}
          </Card>
          {isWebSource(lead.source) && (
            <Card data-testid="lead-origin">
              <CardTitle title={t('De dónde vino', 'Where it came from')} hint={t('Lo que traía la dirección de la página cuando la persona llenó el formulario.', 'What the page address carried when the person filled in the form.')} />
              {origin.length === 0 ? (
                <p className="text-[14px] text-muted-2" data-testid="lead-origin-empty">{t('Llegó sin datos de campaña: la dirección de la página no traía ninguno.', 'It arrived with no campaign data: the page address carried none.')}</p>
              ) : (
                <dl>{origin.map(([k, label, v]) => <KeyVal key={k} k={label}><span data-testid={`origin-${k}`}>{v}</span></KeyVal>)}</dl>
              )}
              <div className="mt-4 border-t border-line pt-4" data-testid="lead-consent">
                <p className="text-[13px] text-muted">{t('Consentimiento para recibir correos', 'Consent to receive emails')}</p>
                {lead.consent_at ? (
                  <>
                    <p className="mt-1 text-[14px] font-medium text-strong">{t(`Sí, el ${marketTime(lead.consent_at, locale, market)}`, `Yes, on ${marketTime(lead.consent_at, locale, market)}`)}<OwnTime at={new Date(lead.consent_at).toISOString()} zone={market.timezone} locale={locale} /></p>
                    {lead.consent_text && <p className="mt-1 text-[13px] text-muted-2">{t('Aceptó: ', 'Accepted: ')}“{lead.consent_text}”</p>}
                  </>
                ) : (
                  <p className="mt-1 text-[14px] font-medium text-strong">{t('No lo dio. No le escribas correos de promoción.', 'Not given. Do not send them promotional emails.')}</p>
                )}
              </div>
            </Card>
          )}
          <LeadScoreCard ctx={ctx} leadId={lead.id} canWork={canWork && (mine || !lead.owner_id || canAssign)} />
          <LeadAnswers ctx={ctx} leadId={lead.id} />
          <LeadEmbudoPanel ctx={ctx} leadId={lead.id} canWork={canWork && (mine || !lead.owner_id || canAssign)} search={linkSearch} />
          <Card data-testid="lead-owner">
            <CardTitle title={t('Quién lo lleva', 'Owner')} />
            <p className="text-[15px] font-semibold text-strong">{lead.owner_name ?? t('Sin asignar', 'No owner')}</p>
            {lead.owner_id && !lead.owner_active && open && <p className="mt-2 rounded-[10px] bg-warn-bg px-3 py-2 text-[13px] font-medium text-amber-text" data-testid="lead-owner-gone">{t('Esta persona ya no tiene acceso en este mercado. Pide que reasignen el lead.', 'This person no longer has access in this market. Ask for the lead to be reassigned.')}</p>}
            {lead.assigned_at && <p className="mt-1 text-[13px] text-muted">{t('Asignado', 'Assigned')} {ago(lead.assigned_at, locale)}</p>}
            {open && lead.owner_id && canWork && (mine || canAssign) && (
              <div className="mt-5 flex flex-wrap gap-3">
                {canPass && peers.length > 0 && (
                  <Dialog trigger={t('Pasar a un compañero', 'Pass to a teammate')} title={t('Pasar este lead', 'Pass this lead')} size="sm" testId="lead-pass">
                    <ActionForm action={leadStepAction} className="grid grid-cols-1 gap-4">
                      <input type="hidden" name="id" value={lead.id} />
                      <Field label={t('A quién', 'To whom')}>
                        <select name="to_id" className="input" required defaultValue="" data-testid="lead-pass-to">
                          <option value="" disabled>{t('Elige a una persona', 'Pick a person')}</option>
                          {peers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                        </select>
                      </Field>
                      <Field label={t('Nota para quien lo recibe', 'Note for the person receiving it')} hint={t('Deja de ser tuyo y sale de tu lista. Si ya hubo contacto, el reloj no vuelve a empezar.', 'It stops being yours and leaves your list. If there was contact already, the clock does not restart.')}>
                        <textarea name="note" rows={3} required minLength={3} maxLength={500} className="input !h-auto py-3" data-testid="lead-pass-note" />
                      </Field>
                      <div className="flex justify-end"><Submit name="step" value="pass" testId="lead-pass-confirm">{t('Pasar lead', 'Pass lead')}</Submit></div>
                    </ActionForm>
                  </Dialog>
                )}
                <Dialog trigger={t('Soltar', 'Release')} title={t('Soltar este lead', 'Release this lead')} variant="quiet" size="sm" testId="lead-release">
                  <ActionForm action={leadStepAction} onOk="close" className="grid grid-cols-1 gap-4">
                    <input type="hidden" name="id" value={lead.id} />
                    <Field label={t('Por qué lo sueltas', 'Why you are releasing it')} hint={t('Queda sin asignar y lo puede tomar cualquiera que venda en este mercado.', 'It is left with no owner and anyone who sells in this market can take it.')}>
                      <textarea name="reason_text" rows={3} required minLength={3} maxLength={500} className="input !h-auto py-3" data-testid="lead-release-reason" />
                    </Field>
                    <div className="flex justify-end"><Submit name="step" value="release" variant="danger" testId="lead-release-confirm">{t('Soltar lead', 'Release lead')}</Submit></div>
                  </ActionForm>
                </Dialog>
              </div>
            )}
            {canAssign && open && (
              <ActionForm action={leadStepAction} className="mt-5">
                <input type="hidden" name="id" value={lead.id} />
                <div className="flex flex-wrap gap-3">
                  <select name="owner_id" className="input" defaultValue={lead.owner_id ?? ''} aria-label={t('Reasignar a', 'Reassign to')}>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                  <Submit name="step" value="assign" variant="ghost" testId="lead-assign">{t('Reasignar', 'Reassign')}</Submit>
                </div>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
