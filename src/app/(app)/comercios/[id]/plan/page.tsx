import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { accountPlans } from '@/dal/partners'
import { MILESTONE_STATUSES, MILESTONE_STATUS_LABEL, PLAN_PHASES, PLAN_PHASE_LABEL } from '@/domain/partners'
import { Badge, Card, CardTitle, Empty, Field, LinkButton, PageHeader } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { day, num } from '@/lib/format'
import * as A from '@/app/(app)/partners/actions'

export const dynamic = 'force-dynamic'

const small = 'text-[13px] text-muted'
const TONE = { pending: 'neutral', in_progress: 'info', done: 'good', blocked: 'bad' } as const

/** PIPE-08: plan compartido de integración. Hitos con dueño de cada lado, fechas y estado; los días a certificación como línea base. */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const d = await accountPlans(ctx, id)
  if (!d) notFound()
  const a = d.account
  const can = ctx.can('plan.manage', a.market_code)
  return (
    <div className="mx-auto max-w-[860px] space-y-8">
      <PageHeader
        eyebrow={a.name}
        title={t('Plan de integración', 'Integration plan')}
        desc={t('Especificaciones, ambiente de pruebas y certificación, con un dueño por hito de cada lado. El cliente todavía no entra a CONTIGO: compártele el avance por tu medio.', 'Specs, sandbox and certification, with one owner per milestone on each side. The client cannot sign in to CONTIGO yet: share progress your usual way.')}
        actions={<LinkButton href={`/comercios/${id}?tab=datos`} testId="plan-back">{t('Volver', 'Back')}</LinkButton>}
      />

      {d.plans.length === 0 && (
        <Empty title={t('Sin plan de integración', 'No integration plan')} hint={t('Para cuentas corporativas que se integran por API: el plan nace con los hitos de siempre y tú pones dueños y fechas.', 'For corporate accounts integrating by API: the plan starts with the usual milestones and you set owners and dates.')} />
      )}

      {d.plans.map((p) => {
        const done = p.milestones.filter((m) => m.status === 'done').length
        return (
          <Card key={p.id} data-testid="plan-card">
            <CardTitle
              title={p.title}
              hint={
                <>
                  {p.deal_title ? `${t('Negocio', 'Deal')}: ${p.deal_title} · ` : ''}
                  {t(`Empezó el ${day(p.started_on, locale)}`, `Started on ${day(p.started_on, locale)}`)} · {t(`${done} de ${p.milestones.length} hitos hechos`, `${done} of ${p.milestones.length} milestones done`)}
                </>
              }
              right={p.certified_on
                ? <Badge tone="good">{t(`Certificado en ${num(p.days_to_cert ?? 0, locale)} días`, `Certified in ${num(p.days_to_cert ?? 0, locale)} days`)}</Badge>
                : <Badge tone="neutral">{t(`${num(p.days_open, locale)} días sin certificar`, `${num(p.days_open, locale)} days without certification`)}</Badge>}
            />
            <ol className="space-y-3" data-testid="plan-milestones">
              {p.milestones.map((m) => (
                <li key={m.id} className="rounded-[14px] border border-line p-4" data-testid="milestone-row">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-muted-2">{t(...PLAN_PHASE_LABEL[m.phase as 'specs'])} · {m.side === 'client' ? t('Cliente', 'Client') : 'axexo'}</p>
                      <p className="text-[15px] font-semibold text-strong">{m.title}</p>
                      <p className={small}>
                        {t('Dueño', 'Owner')}: {m.owner}
                        {m.due_on ? ` · ${t('para el', 'due')} ${day(m.due_on, locale)}` : ` · ${t('sin fecha', 'no date')}`}
                        {m.done_on ? ` · ${t('hecho el', 'done on')} ${day(m.done_on, locale)}` : ''}
                        {m.note ? ` · ${m.note}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {m.overdue && <Badge tone="bad">{t('Vencido', 'Overdue')}</Badge>}
                      <Badge tone={TONE[m.status as 'pending']}>{t(...MILESTONE_STATUS_LABEL[m.status as 'pending'])}</Badge>
                    </div>
                  </div>
                  {can && (
                    <ActionForm action={A.updateMilestoneAction} className="mt-3 flex flex-wrap items-end gap-3" testId="milestone-form">
                      <input type="hidden" name="id" value={m.id} /><input type="hidden" name="account_id" value={id} />
                      <Field label={t('Estado', 'Status')}>
                        <select name="status" className="input" defaultValue={m.status} data-testid="milestone-status">
                          {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{t(...MILESTONE_STATUS_LABEL[s])}</option>)}
                        </select>
                      </Field>
                      <Field label={t('Fecha', 'Date')}><input name="due_on" type="date" className="input" defaultValue={m.due_on ?? ''} data-testid="milestone-due" /></Field>
                      <Field label={t('Nota', 'Note')}><input name="note" className="input" maxLength={300} defaultValue={m.note ?? ''} /></Field>
                      <Submit size="sm" variant="ghost" testId="milestone-save">{t('Guardar', 'Save')}</Submit>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ol>
            {can && (
              <div className="mt-5 flex flex-wrap gap-3">
                <Dialog trigger={t('Agregar hito', 'Add milestone')} title={t('Hito nuevo', 'New milestone')} size="sm" testId="milestone-add-open">
                  <ActionForm action={A.addMilestoneAction} onOk="close">
                    <input type="hidden" name="plan_id" value={p.id} /><input type="hidden" name="account_id" value={id} />
                    <div className="grid gap-4">
                      <Field label={t('Hito', 'Milestone')}><input name="title" className="input" required maxLength={160} /></Field>
                      <Field label={t('Fase', 'Phase')}>
                        <select name="phase" className="input" defaultValue="other">{PLAN_PHASES.map((x) => <option key={x} value={x}>{t(...PLAN_PHASE_LABEL[x])}</option>)}</select>
                      </Field>
                      <Field label={t('Lado', 'Side')}>
                        <select name="side" className="input" defaultValue="axexo"><option value="axexo">axexo</option><option value="client">{t('Cliente', 'Client')}</option></select>
                      </Field>
                      <Field label={t('Dueño de axexo', 'axexo owner')} hint={t('Si el hito es de axexo.', 'If the milestone is axexo’s.')}>
                        <select name="owner_user_id" className="input" defaultValue=""><option value="">{t('Elige a quién', 'Choose who')}</option>{d.people.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
                      </Field>
                      <Field label={t('Dueño del cliente', 'Client owner')} hint={t('Si el hito es del cliente: su nombre.', 'If the milestone is the client’s: their name.')}><input name="owner_name" className="input" maxLength={120} /></Field>
                      <Field label={t('Fecha', 'Date')}><input name="due_on" type="date" className="input" /></Field>
                    </div>
                    <div className="mt-5"><Submit>{t('Agregar', 'Add')}</Submit></div>
                  </ActionForm>
                </Dialog>
                {p.client_access === 'off' ? (
                  <ActionForm action={A.sharePlanAction}>
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="account_id" value={id} />
                    <Submit variant="ghost" testId="plan-share">{t('Compartir con el cliente', 'Share with the client')}</Submit>
                  </ActionForm>
                ) : (
                  <Badge tone="neutral">{t('Acceso del cliente pedido: canal apagado', 'Client access requested: channel off')}</Badge>
                )}
              </div>
            )}
          </Card>
        )
      })}

      {can && (
        <Card data-testid="plan-new">
          <CardTitle title={t('Plan nuevo', 'New plan')} hint={t('Nace con seis hitos: especificaciones, ambiente de pruebas, certificación y salida a producción, cada uno con su lado.', 'It starts with six milestones: specs, sandbox, certification and go-live, each with its side.')} />
          <ActionForm action={A.createPlanAction} onOk="reset" testId="plan-form">
            <input type="hidden" name="account_id" value={id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Nombre del plan', 'Plan name')} className="sm:col-span-2"><input name="title" className="input" required maxLength={120} defaultValue={t(`Integración ${a.name}`, `${a.name} integration`)} data-testid="plan-title" /></Field>
              <Field label={t('Negocio (opcional)', 'Deal (optional)')}>
                <select name="deal_id" className="input" defaultValue=""><option value="">{t('Sin negocio', 'No deal')}</option>{d.deals.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
              </Field>
              <Field label={t('Quién lo lleva en axexo', 'Who owns it at axexo')}>
                <select name="axexo_owner" className="input" required defaultValue="" data-testid="plan-owner">
                  <option value="" disabled>{t('Elige a quién', 'Choose who')}</option>
                  {d.people.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </Field>
              <Field label={t('Contacto del cliente', 'Client contact')} className="sm:col-span-2"><input name="client_owner" className="input" required maxLength={120} data-testid="plan-client" /></Field>
            </div>
            <div className="mt-5"><Submit testId="plan-create">{t('Crear plan', 'Create plan')}</Submit></div>
          </ActionForm>
        </Card>
      )}
    </div>
  )
}
