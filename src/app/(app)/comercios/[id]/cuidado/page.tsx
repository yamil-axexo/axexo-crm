import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, ChevronLeft } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { getAccountCare } from '@/dal/care'
import { reviewDraft } from '@/domain/care-accounts'
import { careAdapterMode } from '@/server/adapters/care'
import { whatsappAdapter } from '@/server/adapters/whatsapp'
import { Badge, Bar, Card, CardTitle, Empty, Field, PageHeader, cx } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { addDays, ago, day, isoDay, num } from '@/lib/format'
import { CONTACT_ROLE, lab } from '@/lib/labels'
import {
  ALERT, ALERT_CLOSE, EXPANSION_STATUS, FEEDBACK_KIND, FEEDBACK_STATUS, HANDOFF_ROLE, HANDOFF_ROLES, HANDOFF_STATUS, HEALTH_BAND, HEALTH_GROUP, MESSAGE_STATUS, PRODUCT_LINE, PRODUCT_LINES,
  REL_HEALTH, STAGE, STAGE_REASON, STAGE_SOURCE, TIER, TIER_BASIS, isCorporate, share, type AlertKind, type HandoffRole, type HealthGroup, type ProductLine, type Stage, type Tier,
} from '@/lib/care'
import {
  alertCloseAction, completionAction, feedbackAction, handoffAckAction, handoffAction, handoffCheckAction, managerChangeAction, opportunityAction, planAction, productLineAction,
  relationshipAction, reviewAction, stageAction,
} from '../../../cuidado/actions'

/**
 * Cuidado del comercio: lo que pasa después de la venta, en una sola pantalla. Etapa de vida con su historial y de dónde
 * salió, entregas con acuse, alertas con su guía de acción, salud explicada, modelo de atención, capacitación y encargado,
 * expansión, plan de cuenta (cuentas corporativas) y comentarios de producto.
 */
export default async function AccountCarePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const d = await getAccountCare(ctx, id)
  if (!d) notFound()
  const a = d.account
  const market = ctx.market(a.market_code)
  const tz = market.timezone
  const today = isoDay(new Date(), tz)
  const canHandoff = ctx.can('handoff.create', a.market_code)
  const canEdit = ctx.can('account.edit', a.market_code)
  const canAlert = ctx.can('alert.work', a.market_code)
  const canManage = ctx.can('care.manage', a.market_code)
  const stage = STAGE[d.care.stage as Stage]
  const corporate = isCorporate(a.kind, d.care.service_tier)
  const canPlan = corporate && ctx.can('account.plan', a.market_code)
  const draft = canPlan ? await reviewDraft(ctx, a.id) : null
  const showScore = d.settings.health_published || canManage || ctx.isGlobal
  const openAlerts = d.alerts.filter((x) => x.status === 'open')
  const hidden = <input type="hidden" name="accountId" value={a.id} />
  const reasonText = (r: string | null) => (r ? (STAGE_REASON[r] ? lab(t, STAGE_REASON[r]) : r) : null)
  const detailText = (kind: string, det: Record<string, unknown>) =>
    kind === 'no_first_sale' ? t(`Lleva ${String(det.days)} días en alta sin vender (el límite del mercado es ${String(det.limit)}).`, `It has been onboarding for ${String(det.days)} days with no sale (the market limit is ${String(det.limit)}).`)
    : kind === 'drop_vs_baseline' ? t(`Vendía ${String(det.baseline)} transacciones en 30 días y ahora lleva ${String(det.now)}, con corte al ${String(det.as_of)}.`, `It used to make ${String(det.baseline)} transactions in 30 days and now has ${String(det.now)}, as of ${String(det.as_of)}.`)
    : kind === 'low_balance' ? t(`Su saldo está por debajo del mínimo del mercado, con corte al ${String(det.as_of)}.`, `Its balance is below the market minimum, as of ${String(det.as_of)}.`)
    : kind === 'manager_change' ? t(`Encargado nuevo desde el ${String(det.changed_on)}: ${String(det.new_name)}. Todavía sin capacitación.`, `New manager since ${String(det.changed_on)}: ${String(det.new_name)}. No training yet.`)
    : t(`Sin ventas desde el ${String(det.since)}.`, `No sales since ${String(det.since)}.`)

  return (
    <div className="mx-auto max-w-[860px]">
      <Link href={`/comercios/${a.id}`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-blue-text hover:underline" data-testid="care-back">
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
        {t('Volver a la ficha', 'Back to the merchant page')}
      </Link>
      <PageHeader title={t(`Cuidado de ${a.name}`, `Care for ${a.name}`)} desc={t('Lo que pasa después de la venta: en qué etapa está, quién lo cuida, qué alertas tiene y qué sigue.', 'What happens after the sale: which stage it is in, who looks after it, which alerts it has and what comes next.')} />

      {/* ------------------------------------------------ etapa de vida */}
      <Card data-testid="care-stage">
        <CardTitle title={t('Etapa de vida', 'Lifecycle stage')} right={<Badge tone={stage?.tone ?? 'neutral'}><span data-testid="stage-now">{lab(t, stage?.label, d.care.stage)}</span></Badge>} />
        <p className="text-[14.5px] text-strong">{lab(t, stage?.hint)} {t(`Desde el ${day(d.care.stage_at, locale, tz)}.`, `Since ${day(d.care.stage_at, locale, tz)}.`)}</p>
        <p className="mt-1 text-[13.5px] text-muted" data-testid="stage-source">
          {t('De dónde salió:', 'Where it came from:')} <span className="font-medium text-strong">{lab(t, STAGE_SOURCE[d.care.stage_source], d.care.stage_source)}</span>
          {reasonText(d.care.stage_reason) ? ` (${reasonText(d.care.stage_reason)})` : ''}
        </p>
        <p className="mt-1 text-[13.5px] text-muted" data-testid="stage-metrics">
          {d.metrics
            ? t(`Archivo de ventas con corte al ${d.metrics.as_of}: ${d.metrics.active_days_30d} días con venta y ${num(d.metrics.txn_count_30d, locale)} transacciones en 30 días.`, `Sales file as of ${d.metrics.as_of}: ${d.metrics.active_days_30d} selling days and ${num(d.metrics.txn_count_30d, locale)} transactions in 30 days.`)
            : t('Este comercio todavía no aparece en el archivo de ventas. Su etapa se mueve con lo que CONTIGO sabe de él.', 'This merchant is not in the sales file yet. Its stage moves with what CONTIGO knows about it.')}
        </p>
        <p className="mt-3 rounded-[10px] bg-surface-2 px-4 py-3 text-[13.5px] text-strong" data-testid="stage-window">
          {t(`Ventana de ${lab(t, PRODUCT_LINE[d.care.product_line as ProductLine])}: entra a riesgo con menos de ${d.window.risk_below} días con venta en 30 y sale con ${d.window.recover_at} o más. Tiene hábito desde ${d.window.habit_at} días y lo conserva mientras no baje de ${d.window.habit_below}. Se da por perdido a los ${d.window.churn_after_days} días sin vender. Un cambio necesita ${d.window.min_days_in_stage} días en la etapa: un día bueno o malo no lo mueve.`,
             `${lab(t, PRODUCT_LINE[d.care.product_line as ProductLine])} window: at risk below ${d.window.risk_below} selling days in 30, out of risk at ${d.window.recover_at} or more. Habit from ${d.window.habit_at} days, kept while it stays at ${d.window.habit_below} or above. Counted as lost after ${d.window.churn_after_days} days with no sale. A change needs ${d.window.min_days_in_stage} days in the stage: one good or bad day does not move it.`)}
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {canEdit && (
            <ActionForm action={productLineAction} className="flex flex-wrap items-end gap-3">
              {hidden}
              <Field label={t('Línea de producto principal', 'Main product line')}>
                <select name="line" defaultValue={d.care.product_line} className="input" data-testid="line-select">
                  {PRODUCT_LINES.map((l) => <option key={l} value={l}>{lab(t, PRODUCT_LINE[l])}</option>)}
                </select>
              </Field>
              <Submit variant="ghost" testId="line-save">{t('Guardar', 'Save')}</Submit>
            </ActionForm>
          )}
          {ctx.can('care.stage', a.market_code) && !['prospect', 'onboarding'].includes(a.lifecycle) && (
            <Dialog trigger={a.lifecycle === 'churned' ? t('Regresar a inactivo', 'Move back to inactive') : t('Marcar como perdido', 'Mark as lost')} title={a.lifecycle === 'churned' ? t('Regresar a inactivo', 'Move back to inactive') : t('Marcar como perdido', 'Mark as lost')} variant="quiet" testId="stage-manual">
              <ActionForm action={stageAction} onOk="close">
                {hidden}<input type="hidden" name="stage" value={a.lifecycle === 'churned' ? 'inactive' : 'churned'} />
                <Field label={t('Motivo', 'Reason')} hint={t('Queda en el historial, con tu nombre.', 'It stays in the history, with your name.')}><input name="reason" required minLength={3} maxLength={200} className="input" data-testid="stage-reason" /></Field>
                <div className="mt-4 flex justify-end"><Submit testId="stage-manual-save">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
            </Dialog>
          )}
        </div>
        <section className="mt-6 border-t border-line pt-4" data-testid="stage-history">
          <h3 className="mb-2 text-[14px] font-semibold text-strong">{t('Historial de etapas', 'Stage history')}</h3>
          {d.history.length === 0 ? (
            <p className="text-[13.5px] text-muted">{t('Todavía no hay cambios registrados. El primero aparece aquí con su fecha y su origen.', 'No changes recorded yet. The first one shows up here with its date and source.')}</p>
          ) : (
            <ol>
              {d.history.map((h) => (
                <li key={h.id} className="border-t border-line py-2.5 text-[13.5px] first:border-t-0" data-testid="stage-event">
                  <span className="font-medium text-strong">{h.from_stage ? `${lab(t, STAGE[h.from_stage as Stage]?.label, h.from_stage)} → ` : ''}{lab(t, STAGE[h.to_stage as Stage]?.label, h.to_stage)}</span>
                  <span className="text-muted"> · {day(h.at, locale, tz)} · {lab(t, STAGE_SOURCE[h.source], h.source)}{h.actor ? ` (${h.actor})` : ''}{reasonText(h.reason) ? ` · ${reasonText(h.reason)}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </Card>

      {/* ------------------------------------------------ entregas */}
      <Card className="mt-6" data-testid="care-handoffs">
        <CardTitle title={t('Entregas entre equipos', 'Handoffs between teams')} hint={t('Cada entrega tiene quién recibe, para cuándo, la lista de lo que se entrega y el acuse. Quien vendió sigue siendo quien originó el comercio.', 'Each handoff has a receiver, a date, the list of what is handed over and the acknowledgment. Whoever sold it remains the one who originated the merchant.')} />
        <p className="mb-4 text-[14px] text-strong" data-testid="care-owner">
          {d.care.care_owner ? t(`Lo cuida ${d.care.care_owner}, como ${lab(t, HANDOFF_ROLE[d.care.care_role as HandoffRole])}.`, `${d.care.care_owner} looks after it, as ${lab(t, HANDOFF_ROLE[d.care.care_role as HandoffRole])}.`) : t('Todavía nadie lo cuida después de la venta. Se define con el acuse de una entrega.', 'Nobody looks after it post-sale yet. That is set when a handoff is acknowledged.')}
          {a.owner_name ? ` ${t(`Ventas: ${a.owner_name}.`, `Sales: ${a.owner_name}.`)}` : ''}
        </p>
        {d.handoffs.length === 0 ? (
          <Empty title={t('Sin entregas todavía', 'No handoffs yet')} hint={t('La primera nace sola cuando el negocio se gana con su primera venta, o la creas aquí abajo.', 'The first one is created on its own when the deal is won by its first sale, or you create it below.')} />
        ) : (
          <ul>
            {d.handoffs.map((h) => {
              const mine = h.to_user_id === ctx.user.id
              const party = mine || h.from_user_id === ctx.user.id || canManage
              return (
                <li key={h.id} className="border-t border-line py-4 first:border-t-0" data-testid="handoff" data-status={h.status}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-[15px] font-medium text-strong">{lab(t, HANDOFF_ROLE[h.from_role as HandoffRole])} → {lab(t, HANDOFF_ROLE[h.to_role as HandoffRole])}</p>
                    <Badge tone={HANDOFF_STATUS[h.status]?.tone ?? 'neutral'}>{lab(t, HANDOFF_STATUS[h.status]?.label, h.status)}</Badge>
                  </div>
                  <p className="text-[13.5px] text-muted">{t(`Recibe ${h.to_name}, para el ${h.due_on}.`, `Receiver: ${h.to_name}, due ${h.due_on}.`)} {h.from_name ? t(`Entrega ${h.from_name}.`, `From ${h.from_name}.`) : t('La abrió CONTIGO con la primera venta.', 'CONTIGO opened it on the first sale.')}</p>
                  {h.note && <p className="mt-1 text-[14px] text-strong">{h.note}</p>}
                  <ul className="mt-2">
                    {h.checklist.map((c) => (
                      <li key={c.code} className="flex flex-wrap items-center justify-between gap-2 py-1 text-[14px]" data-testid="handoff-item" data-done={c.done ? '1' : '0'}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={cx('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', c.done ? 'border-transparent bg-green-100 text-brand-text' : 'border-line-2 text-transparent')} aria-hidden><Check size={13} strokeWidth={2.5} /></span>
                          <span className="text-strong">{t(c.es, c.en)} <span className="sr-only">{c.done ? t('(listo)', '(done)') : t('(falta)', '(missing)')}</span></span>
                        </span>
                        {h.status === 'pending' && party && canHandoff && (
                          <ActionForm action={handoffCheckAction}>
                            {hidden}<input type="hidden" name="id" value={h.id} /><input type="hidden" name="code" value={c.code} /><input type="hidden" name="done" value={c.done ? '0' : '1'} />
                            <Submit variant="quiet" size="sm" testId="handoff-check">{c.done ? t('Desmarcar', 'Untick') : t('Marcar', 'Tick')}</Submit>
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                  {h.status !== 'pending' && <p className="mt-2 text-[13.5px] text-muted" data-testid="handoff-ack">{h.status === 'acknowledged' ? t(`Acuse de ${h.ack_name ?? 's/d'} el ${day(h.ack_at, locale, tz)}.`, `Acknowledged by ${h.ack_name ?? 'n/a'} on ${day(h.ack_at, locale, tz)}.`) : t(`Devuelta por ${h.ack_name ?? 's/d'} el ${day(h.ack_at, locale, tz)}.`, `Sent back by ${h.ack_name ?? 'n/a'} on ${day(h.ack_at, locale, tz)}.`)}{h.ack_note ? ` ${h.ack_note}` : ''}</p>}
                  {h.status === 'pending' && (mine || canManage) && canHandoff && (
                    <ActionForm action={handoffAckAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" testId="handoff-ack-form">
                      {hidden}<input type="hidden" name="id" value={h.id} />
                      <Field label={t('Nota del acuse (qué falta, o por qué la devuelves)', 'Acknowledgment note (what is missing, or why you send it back)')}><input name="note" maxLength={500} className="input" data-testid="handoff-note" /></Field>
                      <div className="flex flex-wrap gap-2">
                        <Submit name="intent" value="accept" testId="handoff-accept">{t('Dar acuse', 'Acknowledge')}</Submit>
                        <Submit name="intent" value="return" variant="quiet" testId="handoff-return">{t('Devolver', 'Send back')}</Submit>
                      </div>
                    </ActionForm>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {canHandoff && (
          <section className="mt-5 border-t border-line pt-5">
            <h3 className="mb-3 text-[14px] font-semibold text-strong">{t('Entregar este comercio', 'Hand this merchant off')}</h3>
            <ActionForm action={handoffAction} onOk="reset" className="grid grid-cols-1 gap-3 sm:grid-cols-2" testId="handoff-form">
              {hidden}
              <Field label={t('A qué equipo', 'To which team')}>
                <select name="toRole" required className="input" defaultValue="cs" data-testid="handoff-role">
                  {HANDOFF_ROLES.map((r) => <option key={r} value={r}>{lab(t, HANDOFF_ROLE[r])}</option>)}
                </select>
              </Field>
              <Field label={t('Quién recibe', 'Who receives')}>
                <select name="toUserId" required className="input" defaultValue="" data-testid="handoff-person">
                  <option value="" disabled>{t('Elige a una persona', 'Pick a person')}</option>
                  {d.people.filter((p) => p.id !== ctx.user.id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </Field>
              <Field label={t('Para cuándo', 'Due date')}><input type="date" name="dueOn" required min={today} defaultValue={addDays(today, 2)} className="input" data-testid="handoff-due" /></Field>
              <Field label={t('Nota para quien recibe (opcional)', 'Note for the receiver (optional)')}><input name="note" maxLength={500} className="input" data-testid="handoff-new-note" /></Field>
              <div className="sm:col-span-2 flex justify-end"><Submit testId="handoff-save">{t('Crear entrega', 'Create handoff')}</Submit></div>
            </ActionForm>
          </section>
        )}
      </Card>

      {/* ------------------------------------------------ alertas */}
      <Card className="mt-6" data-testid="care-alerts">
        <CardTitle title={t('Alertas y guía de acción', 'Alerts and playbook')} hint={t('Cada alerta llega como tarea a quien le toca, con los pasos a seguir. Se cierra sola cuando el comercio se recupera.', 'Each alert arrives as a task for whoever it belongs to, with the steps to follow. It closes on its own when the merchant recovers.')}
          right={<Badge tone={d.settings.alerts_on ? 'good' : 'neutral'}>{d.settings.alerts_on ? t('Alertas encendidas', 'Alerts on') : t('Alertas apagadas', 'Alerts off')}</Badge>} />
        {!d.settings.alerts_on && <p className="mb-4 rounded-[10px] bg-surface-2 px-4 py-3 text-[13.5px] text-strong" data-testid="alerts-off">{t('En este mercado las alertas todavía no crean tareas. Las enciende quien lidera el mercado, en Administración, Cuidado de comercios.', 'Alerts do not create tasks in this market yet. The market lead turns them on under Administration, Merchant care.')}</p>}
        {d.alerts.length === 0 ? (
          <Empty title={t('Sin alertas', 'No alerts')} hint={t('Cuando este comercio pase días sin su primera venta, venda menos que antes, tenga saldo bajo o cambie de encargado, la alerta aparece aquí con su tarea.', 'When this merchant goes days without its first sale, sells less than before, runs low on balance or gets a new manager, the alert shows up here with its task.')} />
        ) : (
          <ul>
            {d.alerts.map((al) => (
              <li key={al.id} className="border-t border-line py-4 first:border-t-0" data-testid="alert" data-kind={al.kind} data-status={al.status}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-[15px] font-medium text-strong">{lab(t, ALERT[al.kind as AlertKind]?.label, al.kind)}</p>
                  <Badge tone={al.status === 'open' ? 'warn' : 'neutral'}>{al.status === 'open' ? t('Abierta', 'Open') : lab(t, ALERT_CLOSE[al.close_reason ?? ''], t('Cerrada', 'Closed'))}</Badge>
                </div>
                <p className="text-[13.5px] text-muted">{detailText(al.kind, al.detail)} {t(`Abierta ${ago(al.opened_at, locale)}.`, `Opened ${ago(al.opened_at, locale)}.`)}</p>
                <p className="text-[13.5px] text-muted" data-testid="alert-owner">
                  {al.in_holdout ? t('Grupo de control: queda anotada y sin tarea, para medir si la guía sirve.', 'Control group: it is recorded with no task, to measure whether the playbook works.')
                    : al.digital_only ? t('Va primero por mensaje. Si sigue abierta, pasa a una persona.', 'It goes by message first. If it stays open, it goes to a person.')
                    : al.owner_name ? t(`Tarea para ${al.owner_name}${al.task_done ? ' (hecha)' : ''}.`, `Task for ${al.owner_name}${al.task_done ? ' (done)' : ''}.`) : t('Sin dueño: el comercio no tiene quién lo lleve.', 'No owner: nobody carries this merchant.')}
                  {al.message_status ? ` ${t('Mensaje al comercio:', 'Message to the merchant:')} ${lab(t, MESSAGE_STATUS[al.message_status], al.message_status)}.` : ''}
                </p>
                {al.steps_es && al.status === 'open' && !al.in_holdout && (
                  <div className="mt-2 rounded-[10px] bg-surface-2 px-4 py-3" data-testid="alert-playbook">
                    <p className="text-[13.5px] font-semibold text-strong">{t(al.title_es ?? '', al.title_en ?? '')}</p>
                    <ol className="mt-1 list-decimal pl-5 text-[13.5px] text-strong">{(locale === 'en' ? al.steps_en ?? [] : al.steps_es).map((s) => <li key={s}>{s}</li>)}</ol>
                  </div>
                )}
                {al.close_note && <p className="mt-1 text-[13.5px] text-strong">{al.close_note}</p>}
                {al.status === 'open' && canAlert && (
                  <ActionForm action={alertCloseAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" testId="alert-close-form">
                    {hidden}<input type="hidden" name="id" value={al.id} />
                    <Field label={t('Qué pasó (obligatorio si la descartas)', 'What happened (required if you dismiss it)')}><input name="note" maxLength={300} className="input" data-testid="alert-note" /></Field>
                    <div className="flex flex-wrap gap-2">
                      <Submit name="intent" value="done" testId="alert-done">{t('Atendida', 'Handled')}</Submit>
                      <Submit name="intent" value="dismiss" variant="quiet" testId="alert-dismiss">{t('Descartar', 'Dismiss')}</Submit>
                    </div>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        <section className="mt-5 border-t border-line pt-4" data-testid="care-consent">
          <h3 className="text-[14px] font-semibold text-strong">{t('Mensajes al comercio', 'Messages to the merchant')}</h3>
          <p className="mt-1 text-[13.5px] text-muted">
            {d.waConsent ? t(`${d.waConsent.full_name} dio permiso para recibir mensajes por WhatsApp el ${day(d.waConsent.granted_at, locale, tz)}.`, `${d.waConsent.full_name} gave permission to receive WhatsApp messages on ${day(d.waConsent.granted_at, locale, tz)}.`) : t('Ningún contacto de este comercio ha dado permiso para recibir mensajes por WhatsApp: no sale ninguno. El permiso se anota en el contacto, en la ficha.', 'No contact at this merchant has given permission to receive WhatsApp messages: none goes out. Permission is recorded on the contact, on the merchant page.')}
            {' '}{whatsappAdapter().mode === 'off' ? t('WhatsApp está apagado: los mensajes quedan en la cola, listos para enviar.', 'WhatsApp is off: messages stay in the queue, ready to send.') : t('WhatsApp está en simulación de pruebas.', 'WhatsApp is in test simulation.')}
          </p>
          <Link href={`/comercios/${a.id}?tab=datos`} className="mt-1 inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="consent-link">{t('Ver contactos en la ficha', 'See contacts on the merchant page')}</Link>
        </section>
      </Card>

      {/* ------------------------------------------------ salud y modelo de atención */}
      <Card className="mt-6" data-testid="care-health">
        <CardTitle title={t('Salud', 'Health')} hint={t('Un puntaje de 0 a 100 hecho con reglas, no con un modelo. Cada grupo de señales aporta como mucho su peso, y aquí se ve cuánto aportó y por qué.', 'A score from 0 to 100 built with rules, not a model. Each signal group adds at most its weight, and here you see how much it added and why.')}
          right={d.health && showScore ? <Badge tone={HEALTH_BAND[d.health.band]?.tone ?? 'neutral'}>{lab(t, HEALTH_BAND[d.health.band]?.label)}</Badge> : undefined} />
        {!d.health ? (
          <Empty title={t('Todavía no hay puntaje', 'No score yet')} hint={t('El puntaje se calcula cada día para los comercios que ya venden y aparecen en el archivo de ventas.', 'The score is calculated daily for merchants that already sell and appear in the sales file.')} />
        ) : !showScore ? (
          <p className="text-[14px] text-strong" data-testid="health-pending">{t('El puntaje de este mercado está en validación: se publica cuando se compruebe contra lo que pasó con los comercios.', 'This market’s score is being validated: it is published once it is checked against what happened to the merchants.')}</p>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="num text-[40px] leading-none font-semibold text-strong" data-testid="health-score">{d.health.score}</span>
              <span className="text-[13.5px] text-muted">{t(`de 100, con corte al ${d.health.as_of}`, `out of 100, as of ${d.health.as_of}`)}</span>
              {!d.settings.health_published && <Badge tone="warn"><span data-testid="health-unvalidated">{t('Sin publicar: en validación', 'Not published: being validated')}</span></Badge>}
            </p>
            {d.health.lowest && <p className="mt-2 text-[14px] text-strong" data-testid="health-lowest">{t(`Lo que más le resta hoy: ${lab(t, HEALTH_GROUP[d.health.lowest as HealthGroup]?.label, d.health.lowest)}.`, `What costs it the most today: ${lab(t, HEALTH_GROUP[d.health.lowest as HealthGroup]?.label, d.health.lowest)}.`)}</p>}
            <ul className="mt-4">
              {d.health.groups.map((g) => (
                <li key={g.grp} className="border-t border-line py-3 first:border-t-0" data-testid="health-group" data-grp={g.grp}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <p className="text-[14.5px] font-medium text-strong">{lab(t, HEALTH_GROUP[g.grp as HealthGroup]?.label, g.grp)}</p>
                    <p className="num text-[14px] text-strong">{g.points === null ? t('no cuenta', 'not counted') : t(`${g.points} de ${g.weight} puntos`, `${g.points} of ${g.weight} points`)}</p>
                  </div>
                  {g.points !== null && <div className="mt-1.5"><Bar value={g.points} max={g.weight} tone={g.points / Math.max(1, g.weight) >= 0.7 ? 'good' : g.points / Math.max(1, g.weight) < 0.4 ? 'bad' : 'accent'} /></div>}
                  <p className="mt-1 text-[13px] text-muted">
                    {g.points === null ? lab(t, HEALTH_GROUP[g.grp as HealthGroup]?.off)
                      : g.grp === 'transactions' ? (g.basis === 'vs_baseline' ? t(`${g.raw} transacciones en 30 días contra ${g.baseline} que vendía antes. Corte al ${g.as_of}.`, `${g.raw} transactions in 30 days against ${g.baseline} it used to sell. As of ${g.as_of}.`) : t(`${g.raw} transacciones en 30 días. Sin historia propia todavía: se compara con los días que marcan hábito. Corte al ${g.as_of}.`, `${g.raw} transactions in 30 days. No own history yet: compared with the days that mark a habit. As of ${g.as_of}.`))
                      : `${lab(t, HEALTH_GROUP[g.grp as HealthGroup]?.hint)} ${t(`Dato al ${g.as_of}.`, `Data as of ${g.as_of}.`)}`}
                  </p>
                </li>
              ))}
            </ul>
            {d.validation && <p className="mt-3 text-[13px] text-muted" data-testid="health-validation">{t(`Última validación (${day(d.validation.run_at, locale, tz)}, ${d.validation.sample} comercios): de los que el puntaje marcó en riesgo, ${share(d.validation.hit_precision, 's/d')} dejó de vender; de los que dejaron de vender, había marcado a ${share(d.validation.hit_recall, 's/d')}.`, `Last validation (${day(d.validation.run_at, locale, tz)}, ${d.validation.sample} merchants): of those the score flagged at risk, ${share(d.validation.hit_precision, 'n/a')} stopped selling; of those that stopped selling, it had flagged ${share(d.validation.hit_recall, 'n/a')}.`)}</p>}
          </>
        )}
        <section className="mt-5 border-t border-line pt-4" data-testid="care-tier">
          <h3 className="text-[14px] font-semibold text-strong">{t('Modelo de atención', 'Service model')}</h3>
          {d.care.service_tier ? (
            <p className="mt-1 text-[14px] text-strong"><span className="font-medium" data-testid="tier-now">{lab(t, TIER[d.care.service_tier as Tier]?.label)}</span>, {lab(t, TIER_BASIS[d.care.service_tier_basis ?? ''])}. {lab(t, TIER[d.care.service_tier as Tier]?.hint)}</p>
          ) : (
            <p className="mt-1 text-[13.5px] text-muted">{t('Todavía sin modelo de atención: se calcula cuando el comercio tiene ventas en el archivo.', 'No service model yet: it is calculated once the merchant has sales in the file.')}</p>
          )}
        </section>
      </Card>

      {/* ------------------------------------------------ capacitación y encargado */}
      <Card className="mt-6" data-testid="care-training">
        <CardTitle title={t('Capacitación y encargado', 'Training and manager')} hint={t('Aquí solo se anota qué curso terminó el encargado y cuándo. El contenido vive en Kore Academy.', 'Only which course the manager finished and when is noted here. The content lives in Kore Academy.')}
          right={<Badge tone="neutral">{careAdapterMode('kore_academy') === 'off' ? t('Kore Academy: conexión apagada', 'Kore Academy: connection off') : t('Kore Academy: simulación', 'Kore Academy: simulation')}</Badge>} />
        {d.completions.length === 0 ? <p className="text-[13.5px] text-muted" data-testid="completions-empty">{t('Sin constancias todavía.', 'No completions yet.')}</p> : (
          <ul data-testid="completions">
            {d.completions.map((c) => (
              <li key={c.id} className="border-t border-line py-2.5 text-[14px] first:border-t-0" data-testid="completion">
                <span className="font-medium text-strong">{c.course_title}</span> <span className="text-muted">· {c.person_name} · {c.completed_on} · {c.source === 'kore_academy' ? 'Kore Academy' : t('registrada a mano', 'recorded by hand')}</span>
              </li>
            ))}
          </ul>
        )}
        {ctx.can('training.record', a.market_code) && (
          <ActionForm action={completionAction} onOk="reset" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" testId="completion-form">
            {hidden}
            <Field label={t('Quién terminó el curso', 'Who finished the course')}><input name="personName" required minLength={2} maxLength={120} className="input" data-testid="completion-person" /></Field>
            <Field label={t('Curso', 'Course')}><input name="courseTitle" required minLength={2} maxLength={160} className="input" data-testid="completion-title" /></Field>
            <Field label={t('Clave del curso en Kore Academy', 'Course key in Kore Academy')} hint={t('En minúsculas, sin espacios. Ejemplo: intro-ventas', 'Lowercase, no spaces. Example: intro-ventas')}><input name="courseKey" required pattern="[a-z0-9][a-z0-9_.\-]{1,59}" className="input" data-testid="completion-key" /></Field>
            <Field label={t('Fecha en que lo terminó', 'Date completed')}><input type="date" name="completedOn" required max={today} defaultValue={today} className="input" data-testid="completion-date" /></Field>
            <div className="sm:col-span-2 flex justify-end"><Submit variant="ghost" testId="completion-save">{t('Registrar constancia', 'Record completion')}</Submit></div>
          </ActionForm>
        )}
        <section className="mt-5 border-t border-line pt-4" data-testid="manager-changes">
          <h3 className="mb-2 text-[14px] font-semibold text-strong">{t('Cambio de encargado', 'Manager change')}</h3>
          {d.managerChanges.length === 0 ? <p className="text-[13.5px] text-muted">{t('Sin cambios de encargado registrados.', 'No manager changes recorded.')}</p> : (
            <ul>
              {d.managerChanges.map((mc) => (
                <li key={mc.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-2.5 text-[14px] first:border-t-0" data-testid="manager-change">
                  <span><span className="font-medium text-strong">{mc.new_name}</span> <span className="text-muted">· {t('desde', 'since')} {mc.changed_on}{mc.by ? ` · ${t('lo anotó', 'noted by')} ${mc.by}` : ''}{mc.note ? ` · ${mc.note}` : ''}</span></span>
                  <Badge tone={mc.trained_at ? 'good' : 'warn'}>{mc.trained_at ? t('Capacitado', 'Trained') : t('Sin capacitar', 'Not trained')}</Badge>
                </li>
              ))}
            </ul>
          )}
          {ctx.can('manager.change', a.market_code) && (
            <ActionForm action={managerChangeAction} onOk="reset" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" testId="manager-form">
              {hidden}
              <Field label={t('Nombre del encargado nuevo', 'New manager’s name')}><input name="newName" required minLength={2} maxLength={120} className="input" data-testid="manager-name" /></Field>
              <Field label={t('Cómo lo supiste', 'How you found out')}>
                <select name="source" className="input" defaultValue="visit" data-testid="manager-source">
                  <option value="visit">{t('En la visita', 'On the visit')}</option><option value="call">{t('Por llamada', 'On a call')}</option><option value="other">{t('De otra forma', 'Another way')}</option>
                </select>
              </Field>
              <Field label={t('Desde cuándo', 'Since when')}><input type="date" name="changedOn" required max={today} defaultValue={today} className="input" data-testid="manager-date" /></Field>
              <Field label={t('Nota (opcional)', 'Note (optional)')}><input name="note" maxLength={300} className="input" data-testid="manager-note" /></Field>
              <div className="sm:col-span-2 flex justify-end"><Submit variant="ghost" testId="manager-save">{t('Registrar cambio de encargado', 'Record manager change')}</Submit></div>
            </ActionForm>
          )}
        </section>
      </Card>

      {/* ------------------------------------------------ expansión */}
      <Card className="mt-6" data-testid="care-expansion">
        <CardTitle title={t('Expansión', 'Expansion')} hint={t('Productos que este comercio todavía no tiene y ya puede aprovechar, por lo que de verdad vende. Solo se abren para comercios activos.', 'Products this merchant does not have yet and can already use, based on what it really sells. They only open for active merchants.')} />
        {d.opportunities.length === 0 ? (
          <Empty title={t('Sin oportunidades por ahora', 'No opportunities for now')} hint={t('Aparecen cuando el comercio cumple una regla de expansión de su mercado.', 'They show up when the merchant meets one of its market’s expansion rules.')} />
        ) : (
          <ul>
            {d.opportunities.map((o) => (
              <li key={o.id} className="border-t border-line py-3.5 first:border-t-0" data-testid="opportunity" data-status={o.status}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-[15px] font-medium text-strong">{o.product_label}</p>
                  <Badge tone={EXPANSION_STATUS[o.status]?.tone ?? 'neutral'}>{lab(t, EXPANSION_STATUS[o.status]?.label, o.status)}</Badge>
                </div>
                <p className="text-[13.5px] text-muted">{t(`Por qué: ${String(o.evidence.active_days_30d ?? 's/d')} días con venta y ${String(o.evidence.txn_count_30d ?? 's/d')} transacciones en 30 días, con corte al ${String(o.evidence.as_of ?? 's/d')}.`, `Why: ${String(o.evidence.active_days_30d ?? 'n/a')} selling days and ${String(o.evidence.txn_count_30d ?? 'n/a')} transactions in 30 days, as of ${String(o.evidence.as_of ?? 'n/a')}.`)}{o.owner_name ? ` ${t(`La lleva ${o.owner_name}.`, `Owned by ${o.owner_name}.`)}` : ''}</p>
                {o.close_note && <p className="mt-1 text-[13.5px] text-strong">{o.close_note}</p>}
                {ctx.can('expansion.work', a.market_code) && (o.status === 'open' || o.status === 'working') && (
                  <ActionForm action={opportunityAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    {hidden}<input type="hidden" name="id" value={o.id} />
                    {o.status === 'working' ? <Field label={t('Nota (obligatoria si no aceptó)', 'Note (required if declined)')}><input name="note" maxLength={300} className="input" data-testid="opp-note" /></Field> : <span className="hidden sm:block" />}
                    <div className="flex flex-wrap gap-2">
                      {o.status === 'open' && <Submit name="intent" value="take" testId="opp-take">{t('Tomarla', 'Take it')}</Submit>}
                      {o.status === 'working' && <Submit name="intent" value="won" testId="opp-won">{t('Aceptó', 'Accepted')}</Submit>}
                      {o.status === 'working' && <Submit name="intent" value="lost" variant="quiet" testId="opp-lost">{t('No aceptó', 'Declined')}</Submit>}
                    </div>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------------------------ plan de cuenta */}
      {corporate && (
        <Card className="mt-6" data-testid="care-plan">
          <CardTitle title={t('Plan de cuenta', 'Account plan')} hint={t('Para cadenas, distribuidores y cuentas de atención dedicada: contactos por papel, relación por producto, plan y revisiones con minuta.', 'For chains, distributors and dedicated accounts: contacts by role, relationship by product, plan and reviews with minutes.')} />
          <section data-testid="plan-contacts">
            <h3 className="mb-2 text-[14px] font-semibold text-strong">{t('Contactos por papel', 'Contacts by role')}</h3>
            {d.contacts.length === 0 ? <p className="text-[13.5px] text-muted">{t('Sin contactos todavía. Se agregan en la ficha del comercio.', 'No contacts yet. They are added on the merchant page.')}</p> : (
              <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">{d.contacts.map((c) => <li key={`${c.role}:${c.full_name}`} className="border-t border-line py-2 text-[14px]"><span className="text-muted">{lab(t, CONTACT_ROLE[c.role], c.role)}:</span> <span className="font-medium text-strong">{c.full_name}</span></li>)}</ul>
            )}
          </section>
          <section className="mt-5 border-t border-line pt-4" data-testid="plan-relationships">
            <h3 className="mb-2 text-[14px] font-semibold text-strong">{t('Relación por producto', 'Relationship by product')}</h3>
            {d.relationships.length > 0 && (
              <>
                <p className="mb-2 text-[13.5px] text-strong" data-testid="rel-rollup">{t('La cuenta en conjunto:', 'The account as a whole:')} <Badge tone={REL_HEALTH[d.relationships.some((r) => r.health === 'risk') ? 'risk' : d.relationships.some((r) => r.health === 'watch') ? 'watch' : 'good']!.tone}>{lab(t, REL_HEALTH[d.relationships.some((r) => r.health === 'risk') ? 'risk' : d.relationships.some((r) => r.health === 'watch') ? 'watch' : 'good']!.label)}</Badge> <span className="text-muted">{t('(tan bien como su relación más débil)', '(as good as its weakest relationship)')}</span></p>
                <ul>{d.relationships.map((r) => <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-line py-2 text-[14px] first:border-t-0" data-testid="relationship"><span><span className="font-medium text-strong">{r.product_label}</span>{r.note ? <span className="text-muted"> · {r.note}</span> : null}</span><Badge tone={REL_HEALTH[r.health]?.tone ?? 'neutral'}>{lab(t, REL_HEALTH[r.health]?.label)}</Badge></li>)}</ul>
              </>
            )}
            {canPlan && (
              <ActionForm action={relationshipAction} onOk="reset" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:items-end" testId="rel-form">
                {hidden}
                <Field label={t('Producto', 'Product')}><input name="productLabel" required minLength={2} maxLength={80} className="input" data-testid="rel-product" /></Field>
                <Field label={t('Cómo va', 'How it is going')}><select name="health" className="input" defaultValue="good" data-testid="rel-health">{Object.keys(REL_HEALTH).map((k) => <option key={k} value={k}>{lab(t, REL_HEALTH[k]!.label)}</option>)}</select></Field>
                <Field label={t('Nota (opcional)', 'Note (optional)')}><input name="note" maxLength={300} className="input" /></Field>
                <Submit variant="ghost" testId="rel-save">{t('Guardar', 'Save')}</Submit>
              </ActionForm>
            )}
          </section>
          <section className="mt-5 border-t border-line pt-4" data-testid="plan-body">
            <h3 className="mb-2 text-[14px] font-semibold text-strong">{t('Plan', 'Plan')}</h3>
            {canPlan ? (
              <ActionForm action={planAction} className="grid grid-cols-1 gap-3" testId="plan-form">
                {hidden}
                <Field label={t('Objetivos con la cuenta', 'Goals with the account')}><textarea name="goals" rows={3} maxLength={2000} className="input" defaultValue={d.plan?.goals ?? ''} data-testid="plan-goals" /></Field>
                <Field label={t('Riesgos', 'Risks')}><textarea name="risks" rows={2} maxLength={2000} className="input" defaultValue={d.plan?.risks ?? ''} /></Field>
                <Field label={t('Próximos pasos', 'Next steps')}><textarea name="nextSteps" rows={2} maxLength={2000} className="input" defaultValue={d.plan?.next_steps ?? ''} /></Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('Revisión cada cuántos días', 'Review every how many days')}><input type="number" name="reviewEveryDays" min={7} max={365} required className="input" defaultValue={d.plan?.review_every_days ?? 90} /></Field>
                  <Field label={t('Próxima revisión', 'Next review')}><input type="date" name="nextReviewOn" className="input" defaultValue={d.plan?.next_review_on ?? ''} data-testid="plan-next" /></Field>
                </div>
                <div className="flex justify-end"><Submit variant="ghost" testId="plan-save">{t('Guardar plan', 'Save plan')}</Submit></div>
              </ActionForm>
            ) : d.plan ? (
              <div className="text-[14px] text-strong">{d.plan.goals && <p>{d.plan.goals}</p>}{d.plan.next_review_on && <p className="mt-1 text-muted">{t(`Próxima revisión: ${d.plan.next_review_on}.`, `Next review: ${d.plan.next_review_on}.`)}</p>}</div>
            ) : <p className="text-[13.5px] text-muted">{t('Sin plan todavía.', 'No plan yet.')}</p>}
          </section>
          <section className="mt-5 border-t border-line pt-4" data-testid="plan-reviews">
            <h3 className="mb-2 text-[14px] font-semibold text-strong">{t('Revisiones', 'Reviews')}</h3>
            {d.reviews.length === 0 ? <p className="text-[13.5px] text-muted">{t('Sin revisiones todavía.', 'No reviews yet.')}</p> : (
              <ul>
                {d.reviews.map((r) => (
                  <li key={r.id} className="border-t border-line py-3 first:border-t-0" data-testid="review">
                    <p className="text-[14.5px] font-medium text-strong">{r.held_on}{r.by ? ` · ${r.by}` : ''}{r.draft_source === 'data' ? ` · ${t('a partir del borrador con datos', 'from the data draft')}` : ''}</p>
                    {r.attendees && <p className="text-[13.5px] text-muted">{t('Asistieron:', 'Attendees:')} {r.attendees}</p>}
                    <p className="mt-1 text-[14px] whitespace-pre-line text-strong">{r.minutes}</p>
                    {r.agreements && <p className="mt-1 text-[14px] whitespace-pre-line text-strong"><span className="font-medium">{t('Acuerdos:', 'Agreements:')}</span> {r.agreements}</p>}
                  </li>
                ))}
              </ul>
            )}
            {canPlan && draft && (
              <ActionForm action={reviewAction} onOk="reset" className="mt-4 grid grid-cols-1 gap-3" testId="review-form">
                {hidden}<input type="hidden" name="draft" value={draft.text} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('Fecha de la revisión', 'Review date')}><input type="date" name="heldOn" required max={today} defaultValue={today} className="input" data-testid="review-date" /></Field>
                  <Field label={t('Quiénes asistieron (opcional)', 'Attendees (optional)')}><input name="attendees" maxLength={300} className="input" /></Field>
                </div>
                <Field label={t('Minuta', 'Minutes')} hint={t('Empieza con un borrador hecho con los datos que CONTIGO ya tiene. Cámbialo como haga falta.', 'It starts with a draft built from the data CONTIGO already has. Change it as needed.')}>
                  <textarea name="minutes" rows={6} required minLength={3} maxLength={4000} className="input" defaultValue={draft.ai ?? draft.text} data-testid="review-minutes" />
                </Field>
                <p className="text-[13px] text-muted" data-testid="review-ai">{careAdapterMode('ai_draft') === 'off' ? t('Borrador con IA: apagado. El de arriba son hechos puestos en orden, sin IA.', 'AI draft: off. The one above is facts put in order, with no AI.') : t('Borrador con IA: simulación de pruebas.', 'AI draft: test simulation.')}</p>
                <Field label={t('Acuerdos (opcional)', 'Agreements (optional)')}><textarea name="agreements" rows={2} maxLength={2000} className="input" data-testid="review-agreements" /></Field>
                <div className="flex justify-end"><Submit variant="ghost" testId="review-save">{t('Guardar revisión', 'Save review')}</Submit></div>
              </ActionForm>
            )}
          </section>
        </Card>
      )}

      {/* ------------------------------------------------ comentarios de producto */}
      <Card className="mt-6" data-testid="care-feedback">
        <CardTitle title={t('Comentarios de producto', 'Product feedback')} hint={t('Lo que el comercio dice o lo que ves en campo sobre el producto. Siempre con tema, para que Producto y Tecnología lo pueda contar.', 'What the merchant says or what you see in the field about the product. Always with a topic, so Product and Technology can count it.')} />
        {ctx.can('feedback.create', a.market_code) && (
          <ActionForm action={feedbackAction} onOk="reset" className="grid grid-cols-1 gap-3 sm:grid-cols-2" testId="feedback-form">
            {hidden}
            <Field label={t('Tema', 'Topic')}>
              <select name="topic" required defaultValue="" className="input" data-testid="feedback-topic">
                <option value="" disabled>{t('Elige un tema', 'Pick a topic')}</option>
                {d.topics.map((tp) => <option key={tp.code} value={tp.code}>{t(tp.label_es, tp.label_en)}</option>)}
              </select>
            </Field>
            <Field label={t('Qué es', 'What it is')}>
              <select name="kind" className="input" defaultValue="friction" data-testid="feedback-kind">{Object.keys(FEEDBACK_KIND).map((k) => <option key={k} value={k}>{lab(t, FEEDBACK_KIND[k])}</option>)}</select>
            </Field>
            <Field label={t('Detalle (opcional)', 'Detail (optional)')} className="sm:col-span-2"><textarea name="note" rows={2} maxLength={500} className="input" data-testid="feedback-note" /></Field>
            <div className="sm:col-span-2 flex justify-end"><Submit variant="ghost" testId="feedback-save">{t('Registrar comentario', 'Log feedback')}</Submit></div>
          </ActionForm>
        )}
        {d.feedback.length === 0 ? <p className="mt-4 text-[13.5px] text-muted" data-testid="feedback-empty">{t('Sin comentarios de este comercio todavía.', 'No feedback from this merchant yet.')}</p> : (
          <ul className="mt-4">
            {d.feedback.map((f) => {
              const tp = d.topics.find((x) => x.code === f.topic)
              return (
                <li key={f.id} className="border-t border-line py-3 first:border-t-0" data-testid="feedback-item">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-[14.5px] font-medium text-strong">{tp ? t(tp.label_es, tp.label_en) : f.topic} <span className="font-normal text-muted">· {lab(t, FEEDBACK_KIND[f.kind])}</span></p>
                    <Badge tone={FEEDBACK_STATUS[f.status]?.tone ?? 'neutral'}>{lab(t, FEEDBACK_STATUS[f.status]?.label, f.status)}</Badge>
                  </div>
                  {f.note && <p className="text-[14px] text-strong">{f.note}</p>}
                  <p className="text-[13px] text-muted">{f.by ?? t('s/d', 'n/a')} · {ago(f.created_at, locale)}</p>
                  {f.response && <p className="mt-1 rounded-[10px] bg-surface-2 px-3 py-2 text-[13.5px] text-strong">{t('Respuesta de Producto:', 'Answer from Product:')} {f.response}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
