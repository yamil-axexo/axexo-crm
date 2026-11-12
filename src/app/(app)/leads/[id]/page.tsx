import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getLead, lossReasons, sellers } from '@/dal/leads'
import { Badge, Card, CardTitle, Field, KeyVal, PageHeader } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { ago, dayTime, phoneText } from '@/lib/format'
import { ACTIVITY, LEAD_STATUS, LIFECYCLE, MOTOR, SOURCE, lab } from '@/lib/labels'
import { leadStepAction, takeLeadAction } from '../actions'
import { CompleteButton } from '@/ui/complete'
import { resultOptions, sheetConfig } from '@/server/sheet'
import { buttonClass } from '@/ui/kit'
import { completeItemAction } from '@/app/(app)/hoy/actions'
import { addActivityAction } from '@/app/(app)/actividades/actions'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const data = await getLead(ctx, id)
  if (!data) notFound()
  const { lead, duplicates, activities } = data
  const market = ctx.market(lead.market_code)
  const canWork = ctx.can('lead.work', lead.market_code)
  const canAssign = ctx.can('lead.assign', lead.market_code)
  const reasons = canWork ? await lossReasons(ctx) : []
  const people = canAssign ? await sellers(ctx, lead.market_code) : []
  const open = ['new', 'contacted', 'qualified'].includes(lead.status)
  const waiting = lead.status === 'new' && !lead.first_touch_at
  const late = waiting && !!lead.sla_due_at && new Date(lead.sla_due_at) < new Date()

  return (
    <>
      <PageHeader
        eyebrow={`Lead · ${market.name}`}
        title={lead.business_name}
        desc={[lead.contact_name, lead.locality].filter(Boolean).join(' · ')}
        actions={<Badge tone={LEAD_STATUS[lead.status]?.tone}>{lab(t, LEAD_STATUS[lead.status]?.label)}</Badge>}
      />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          {open && canWork && !lead.owner_id && !canAssign && (
            <Card data-testid="lead-free">
              <CardTitle title={t('Este lead no tiene dueño', 'This lead has no owner')} hint={t('Tómalo para llamarlo y trabajarlo. Queda a tu nombre.', 'Take it to call and work it. It becomes yours.')} />
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
                    : waiting && lead.sla_due_at ? t(`Tiempo de respuesta: ${ago(lead.sla_due_at, locale)}.`, `Response time: ${ago(lead.sla_due_at, locale)}.`)
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
                    item={{ type: 'lead', id: lead.id, title: ctx.m('action.callOf', { name: lead.business_name }), name: lead.business_name, results: resultOptions(ctx, ['reached', 'no_answer']), defaultResult: 'reached' }}
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
                {lead.status === 'qualified' && (
                  <ActionForm action={leadStepAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="id" value={lead.id} />
                    {duplicates.length > 0 && (
                      <Field label={t('Ligar a un comercio existente', 'Link to an existing merchant')}>
                        <select name="link_account_id" className="input" data-testid="lead-link">
                          <option value="">{t('No, crear uno nuevo', 'No, create a new one')}</option>
                          {duplicates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </Field>
                    )}
                    <Submit name="step" value="convert" variant="primary" testId="lead-convert">{t('Convertir en comercio y negocio', 'Convert to merchant and deal')}</Submit>
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
            <CardTitle title={t('Notas del lead', 'Lead notes')} />
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
                    <p className="text-[12.5px] text-muted">{lab(t, ACTIVITY[a.kind])} · {a.author ?? '—'} · {dayTime(a.created_at, locale, market.timezone)}</p>
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
                ) : '—'}
              </KeyVal>
              <KeyVal k={t('Correo', 'Email')}>{lead.email ?? '—'}</KeyVal>
              <KeyVal k={t('Tipo', 'Type')}>{lab(t, MOTOR[lead.motor])}</KeyVal>
              <KeyVal k={t('Origen', 'Source')}>{lead.form_name ?? lab(t, SOURCE[lead.source])}</KeyVal>
              <KeyVal k={t('Llegó', 'Arrived')}>{dayTime(lead.created_at, locale, market.timezone)}</KeyVal>
              <KeyVal k={t('Primer contacto', 'First touch')}>{lead.first_touch_at ? dayTime(lead.first_touch_at, locale, market.timezone) : '—'}</KeyVal>
            </dl>
            {lead.message && <p className="mt-4 rounded-2xl bg-surface-2 p-4 text-[13.5px] text-muted-2">“{lead.message}”</p>}
          </Card>
          <Card data-testid="lead-owner">
            <CardTitle title={t('Dueño', 'Owner')} />
            <p className="text-[15px] font-semibold text-strong">{lead.owner_name ?? t('Sin dueño', 'No owner')}</p>
            {lead.assigned_at && <p className="mt-1 text-[13px] text-muted">{t('Asignado', 'Assigned')} {ago(lead.assigned_at, locale)}</p>}
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
