import { DealPeople } from './people'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { Phone } from 'lucide-react'
import { getDeal } from '@/dal/pipelines'
import { accountPhone } from '@/dal/field'
import { CallLink } from '@/ui/log'
import type { MessageKey } from '@/lib/messages'
import { fieldDefs } from '@/dal/fields'
import { CustomFields } from '@/ui/fields'
import { lossReasonsFor } from '@/dal/b2b'
import { pauseDealAction, resumeDealAction } from '@/app/(app)/b2b-actions'
import { FIELD_LABEL, winMissingText } from '@/domain/deals'
import { Badge, Card, CardTitle, Field, KeyVal, LinkButton, PageHeader, buttonClass, cx, NoData } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { addDays, day, dayTime, daysSince, isoDay, money, zoneNote } from '@/lib/format'
import { ACTIVITY, CONTACT_ROLE, lab } from '@/lib/labels'
import { moveDealAction, updateDealAction } from '@/app/(app)/pipelines/actions'
import { gateMoveAction, winDealAction } from '@/app/(app)/operaciones/actions'
import { GateFields } from '@/ui/ops'
import { getDealOps, notifyOptions } from '@/dal/ops'
import { DealItems, DealOpsCard } from './ops'
import { DealSteps } from './steps'
import { TrainingAgenda } from './training'
import { addActivityAction } from '@/app/(app)/actividades/actions'

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const data = await getDeal(ctx, id)
  if (!data) notFound()
  const { deal, stages, contacts, events, activities, items, current, next, missingNext, missingWin, gateDefs } = data
  const defs = await fieldDefs(ctx, 'deal', deal.market_code, deal.motor)
  const ops = (await getDealOps(ctx, id))!
  const canEditFields = ctx.can('deal.edit', deal.market_code)
  const market = ctx.market(deal.market_code)
  const canEdit = deal.status === 'open' && ctx.can('deal.edit', deal.market_code)
  // Cada embudo ofrece los motivos de su tipo de venta, más los que valen para todos.
  const reasons = canEdit || deal.status === 'lost' ? await lossReasonsFor(ctx, deal.market_code, deal.motor) : []
  const tomorrow = addDays(isoDay(new Date(), market.timezone), 1)
  const lost = stages.find((s) => s.kind === 'lost')
  const flow = stages.filter((s) => s.kind !== 'lost')
  const prev = current ? stages.find((s) => s.position === current.position - 1 && s.kind === 'open') : undefined
  const won = stages.find((s) => s.kind === 'won')
  const lastOpen = Boolean(current && current.kind === 'open' && (!next || next.kind === 'won'))
  // Llamar desde el negocio: al comercio o, si no tiene teléfono, a su contacto. Al volver se pregunta cómo fue.
  const callee = await accountPhone(ctx, deal.account_id)
  const canLog = ctx.can('activity.write', deal.market_code)
  const today = isoDay(new Date(), market.timezone)
  // Separación de funciones: lo que pasa por una etapa de Operaciones lo avanza Operaciones, nunca quien lo vendió.
  const opsAhead = Boolean(current && stages.some((s) => s.is_ops && s.position >= current.position))
  const opsMoves = ctx.can('deal.ops', deal.market_code) && deal.owner_id !== ctx.user.id
  const canAdvance = canEdit && (!current?.is_ops || opsMoves)
  // Quien solo opera gana lo que Ventas ya le entregó: en una etapa de Ventas no ve el botón.
  const opsOnly = ctx.can('deal.ops', deal.market_code) && !ctx.can('deal.create', deal.market_code)
  const canWin = canEdit && (!opsAhead || opsMoves) && !(opsOnly && !current?.is_ops)
  const gateLabels = {
    title: '', body: '', save: t('Guardar y mover', 'Save and move'),
    amount: t(`Monto esperado (${market.currency})`, `Expected amount (${market.currency})`), nextStep: t('Próximo paso', 'Next step'), nextDue: t('Fecha del próximo paso', 'Next step date'),
    decisionMaker: t('Quien decide', 'Decision-maker'), pick: t('Elige quién decide', 'Pick the decision-maker'), met: t('Ya hablé con quien decide', 'I have spoken with the decision-maker'),
    noContacts: t('Este comercio todavía no tiene contactos.', 'This merchant has no contacts yet.'), addContact: t('Agregar el contacto en la ficha', 'Add the contact on the merchant page'),
    items: t('Falta al menos una línea de producto: agrégala abajo, en Líneas del pedido.', 'It needs at least one product line: add it below, under Order lines.'), openDeal: '',
    lang: locale, pickOne: t('Elige una opción', 'Pick an option'),
  }
  const defNames = Object.fromEntries(gateDefs.map((f) => [f.ref, { es: f.label_es, en: f.label_en }]))
  const missingName = (k: string) => (defNames[k] ? t(defNames[k].es, defNames[k].en) : t(FIELD_LABEL[k]?.es ?? k, FIELD_LABEL[k]?.en ?? k))
  const gateInfoBase = { amount: deal.amount_minor ? String(Number(deal.amount_minor) / 100) : null, nextStep: deal.next_step, nextStepDue: deal.next_step_due,
    decisionMakerId: deal.decision_maker_id, decisionMakerMet: deal.decision_maker_met, contacts: contacts.map((c) => ({ id: c.id, full_name: c.full_name })), accountId: deal.account_id }
  const people = canLog ? await notifyOptions(ctx, { dealId: deal.id }) : []
  const pilotRule = t('En el piloto se gana a mano; cuando llegue la primera transacción se confirmará sola.', 'During the pilot a deal is won by hand; when the first transaction arrives it will be confirmed on its own.')
  const call = <><Phone size={18} strokeWidth={1.75} aria-hidden />{ctx.m('action.call')}</>

  return (
    <>
      <PageHeader
        eyebrow={`${t('Negocio', 'Deal')} · ${deal.pipeline_name}`}
        title={deal.title}
        actions={<>
          {callee && (canLog
            ? <CallLink href={`tel:${callee.phone}`} account={{ id: deal.account_id, name: deal.account_name, market: deal.market_code }} dealId={deal.id} className={buttonClass('ghost', 'md')} title={callee.who ?? undefined} testId="deal-call">{call}</CallLink>
            : <a href={`tel:${callee.phone}`} className={buttonClass('ghost', 'md')} title={callee.who ?? undefined} data-testid="deal-call">{call}</a>)}
          {deal.status === 'won' ? <Badge tone="good">{deal.closed_by === 'transaction' ? t('Ganado por primera transacción', 'Won by first transaction') : t('Ganado', 'Won')}</Badge>
          : deal.status === 'lost' ? <Badge tone="bad">{t('Perdido', 'Lost')}</Badge>
          : <Badge tone="accent">{t('Abierto', 'Open')}</Badge>}
        </>}
      />

      <ol className="mb-8 flex flex-wrap gap-2" data-testid="stage-path" aria-label={t('Etapas', 'Stages')}>
        {flow.map((s) => {
          const done = current && s.position < current.position
          const here = s.id === deal.stage_id
          return (
            <li key={s.id} aria-current={here ? 'step' : undefined} className={cx('rounded-full px-4 py-2 text-[13px] font-semibold', here ? 'bg-ink text-white' : done ? 'bg-brand/15 text-brand-text' : 'bg-surface text-muted border border-line')}>
              {t(s.name_es, s.name_en)}
            </li>
          )
        })}
      </ol>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          {deal.revisit_needed && deal.status === 'open' && (
            <div className="rounded-[16px] bg-warn-bg px-6 py-5" data-testid="revisit-banner">
              <p className="text-[15px] font-semibold text-amber-text">{t('Hay que volver con quien decide', 'Go back to the decision-maker')}</p>
              <p className="mt-1 text-[13.5px] text-muted-2">
                {t('La última visita no encontró a quien decide.', 'The last visit did not find the person who decides.')}
                {deal.revisit_due ? ` ${t('Fecha sugerida:', 'Suggested date:')} ${day(deal.revisit_due, locale)}.` : ''}
              </p>
            </div>
          )}

          {deal.paused_at && deal.status === 'open' && (
            <div className="rounded-[16px] bg-surface-3 px-6 py-5" data-testid="pause-banner">
              <p className="text-[15px] font-semibold text-strong">{t('En pausa', 'On hold')}{deal.pause_review_on ? ` · ${t('se revisa el', 'review on')} ${day(deal.pause_review_on, locale)}` : ''}</p>
              <p className="mt-1 text-[13.5px] text-muted-2 [overflow-wrap:anywhere]">{deal.pause_reason}</p>
              <p className="mt-1 text-[13px] text-muted">{t('Mientras está en pausa no cuenta como estancado ni sin próximo paso. Vuelve a Hoy el día de la revisión.', 'While on hold it does not count as stalled or as missing a next step. It comes back to Today on the review date.')}</p>
              {canEdit && (
                <ActionForm action={resumeDealAction} className="mt-3">
                  <input type="hidden" name="deal_id" value={deal.id} />
                  <Submit variant="ghost" size="sm" testId="deal-resume">{t('Retomar el negocio', 'Resume the deal')}</Submit>
                </ActionForm>
              )}
            </div>
          )}

          {deal.status === 'open' && <DealSteps ctx={ctx} dealId={deal.id} canEdit={canEdit} market={market} />}

          {deal.status === 'open' && current && (
            <Card data-testid="deal-move">
              <CardTitle
                title={current.kind === 'awaiting_txn' ? t('Esperando la primera transacción', 'Waiting for the first transaction') : t('Avanzar el negocio', 'Move the deal forward')}
                hint={
                  current.kind === 'awaiting_txn' && !deal.close_by_transaction
                    ? t(`Lleva ${daysSince(deal.stage_entered_at)} días aquí. ${pilotRule}`, `It has been here ${daysSince(deal.stage_entered_at)} days. ${pilotRule}`)
                    : current.kind === 'awaiting_txn'
                    ? t(`Lleva ${daysSince(deal.stage_entered_at)} días aquí. Se gana cuando los datos de ventas traen la primera venta de este comercio; nadie lo marca a mano.`, `It has been here ${daysSince(deal.stage_entered_at)} days. It is won when the sales data shows this merchant’s first sale; nobody marks it by hand.`)
                    : current.exit_es
                      ? t(`Para avanzar: ${current.exit_es}.`, `To move on: ${current.exit_en}.`)
                      : lastOpen && deal.close_by_transaction
                        ? t('Última etapa del embudo. El negocio se gana cuando los datos de ventas traen la primera transacción del comercio; nadie lo marca a mano.', 'Last stage of the pipeline. The deal is won when the sales data shows the merchant’s first transaction; nobody marks it by hand.')
                        : undefined
                }
              />
              {next && next.kind !== 'won' && missingNext.length > 0 && (
                <p className="mb-5 rounded-2xl bg-surface-2 px-4 py-3 text-[13.5px] text-muted-2" data-testid="gate-missing">
                  {t(`Para pasar a "${next.name_es}" falta: `, `To move to "${next.name_en}" you still need: `)}
                  <strong className="text-strong">{missingNext.map(missingName).join(', ')}</strong>.
                </p>
              )}
              {next && next.kind !== 'won' && missingNext.length > 0 && canAdvance && (
                <div className="mb-5">
                  <Dialog trigger={t('Completar lo que falta y avanzar', 'Fill in what is missing and move on')} title={t(`Para pasar a "${next.name_es}" falta esto`, `To move to "${next.name_en}" you still need this`)} variant="primary" testId="gate-open">
                    <ActionForm action={gateMoveAction} onOk="close">
                      <input type="hidden" name="deal_id" value={deal.id} /><input type="hidden" name="stage_id" value={next.id} />
                      <GateFields minDate={today} dealHref={`/deals/${deal.id}`} info={{ ...gateInfoBase, missing: missingNext, fields: gateDefs.filter((f) => missingNext.includes(f.ref)), stageName: { es: next.name_es, en: next.name_en } }} labels={gateLabels} />
                      <div className="mt-6 flex justify-end"><Submit testId="gate-save">{t('Guardar y mover', 'Save and move')}</Submit></div>
                    </ActionForm>
                  </Dialog>
                </div>
              )}
              {canEdit && current.is_ops && !opsMoves && (
                <p className="mb-5 rounded-2xl bg-surface-2 px-4 py-3 text-[13.5px] text-muted-2" data-testid="with-ops">
                  {t('Este negocio ya está con Operaciones: desde aquí solo Operaciones lo avanza. Si te lo devuelven, te aparece en Hoy con el motivo.', 'This deal is with Operations now: from here only Operations moves it forward. If they send it back, you will see it in Today with the reason.')}
                </p>
              )}
              {canEdit && (
                <div className="flex flex-wrap gap-3">
                  {next && next.kind !== 'won' && canAdvance && (
                    <ActionForm action={moveDealAction} className="max-w-full [&_button]:h-auto [&_button]:min-h-11 [&_button]:py-2 [&_button]:whitespace-normal">
                      <input type="hidden" name="deal_id" value={deal.id} /><input type="hidden" name="stage_id" value={next.id} />
                      <Submit testId="deal-advance">{t(`Pasar a "${next.name_es}"`, `Move to "${next.name_en}"`)}</Submit>
                    </ActionForm>
                  )}
                  {won && !deal.close_by_transaction && canWin && (
                    <Dialog trigger={t('Marcar como ganado', 'Mark as won')} title={t('Marcar como ganado', 'Mark as won')} variant={lastOpen || current.kind === 'awaiting_txn' ? 'primary' : 'ghost'} testId="deal-win">
                      <ActionForm action={winDealAction} onOk="close">
                        <input type="hidden" name="deal_id" value={deal.id} /><input type="hidden" name="stage_id" value={won.id} />
                        <p className="mb-4 rounded-2xl bg-surface-2 px-4 py-3 text-[13.5px] text-muted-2" data-testid="win-rule">{pilotRule}</p>
                        <Field label={t('Fecha real de cierre', 'Actual close date')} hint={t('Hoy o un día anterior, nunca futura.', 'Today or an earlier day, never in the future.')}>
                          <input name="won_on" type="date" className="input" required max={today} defaultValue={today} data-testid="win-date" />
                        </Field>
                        {won && missingWin.length > 0 && (
                          <div className="mt-4 border-t border-line pt-1" data-testid="win-gate">
                            <p className="mt-4 text-[14px] font-medium text-strong" data-testid="win-needs">{t(...winMissingText(missingWin, defNames))}</p>
                            <GateFields minDate={today} dealHref={`/deals/${deal.id}`} info={{ ...gateInfoBase, missing: missingWin, fields: gateDefs.filter((f) => missingWin.includes(f.ref)), stageName: { es: won.name_es, en: won.name_en } }} labels={gateLabels} />
                          </div>
                        )}
                        <div className="mt-5 flex justify-end"><Submit testId="deal-win-confirm">{t('Marcar como ganado', 'Mark as won')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  )}
                  {prev && !(current.is_ops && !prev.is_ops) && (
                    <ActionForm action={moveDealAction} className="max-w-full [&_button]:h-auto [&_button]:min-h-11 [&_button]:py-2 [&_button]:whitespace-normal">
                      <input type="hidden" name="deal_id" value={deal.id} /><input type="hidden" name="stage_id" value={prev.id} />
                      <Submit variant="ghost" testId="deal-back">{t(`Regresar a "${prev.name_es}"`, `Back to "${prev.name_en}"`)}</Submit>
                    </ActionForm>
                  )}
                  {!deal.paused_at && (
                    <Dialog trigger={t('Poner en pausa', 'Put on hold')} title={t('Poner el negocio en pausa', 'Put the deal on hold')} variant="quiet" testId="deal-pause">
                      <ActionForm action={pauseDealAction} onOk="close">
                        <input type="hidden" name="deal_id" value={deal.id} />
                        <p className="mb-4 text-[13.5px] text-muted-2">{t('Úsalo cuando el cliente pide esperar. El negocio sigue abierto, no cuenta como estancado y vuelve a tu lista de Hoy el día que elijas.', 'Use it when the customer asks to wait. The deal stays open, does not count as stalled and comes back to your Today list on the day you choose.')}</p>
                        <Field label={t('¿Por qué queda en pausa?', 'Why is it on hold?')}><textarea name="reason" rows={2} required minLength={2} maxLength={300} className="input !h-auto py-3" data-testid="pause-reason" /></Field>
                        <Field label={t('¿Cuándo lo revisas?', 'When will you review it?')} className="mt-4"><input name="review_on" type="date" required min={tomorrow} className="input" data-testid="pause-review" /></Field>
                        <div className="mt-5 flex justify-end"><Submit testId="pause-save">{t('Poner en pausa', 'Put on hold')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  )}
                  {lost && (
                    <Dialog trigger={t('Marcar como perdido', 'Mark as lost')} title={t('Cerrar como perdido', 'Close as lost')} variant="quiet" testId="deal-lose">
                      <ActionForm action={moveDealAction} onOk="close">
                        <input type="hidden" name="deal_id" value={deal.id} /><input type="hidden" name="stage_id" value={lost.id} />
                        <Field label={t('Motivo de pérdida', 'Loss reason')}>
                          <select name="reason" className="input" defaultValue="" data-testid="loss-reason">
                            <option value="">{t('Elige un motivo', 'Pick a reason')}</option>
                            {reasons.map((r) => <option key={r.code} value={r.code}>{t(r.label_es, r.label_en)}</option>)}
                          </select>
                        </Field>
                        <Field label={t('Nota (opcional)', 'Note (optional)')} className="mt-4"><textarea name="note" rows={3} className="input" /></Field>
                        <div className="mt-5 flex justify-end"><Submit variant="danger" testId="deal-lose-confirm">{t('Cerrar como perdido', 'Close as lost')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  )}
                </div>
              )}
            </Card>
          )}

          {deal.status === 'lost' && (
            <Card><p className="text-[14.5px]">{t('Motivo: ', 'Reason: ')}<strong>{(() => { const r = reasons.find((x) => x.code === deal.loss_reason_code); return r ? t(r.label_es, r.label_en) : deal.loss_reason_code })()}</strong>{deal.loss_note ? ` · ${deal.loss_note}` : ''}</p></Card>
          )}

          {canEdit && (
            <Card data-testid="deal-edit">
              <CardTitle title={t('Datos del negocio', 'Deal details')} hint={t('Todo negocio abierto lleva un próximo paso con fecha.', 'Every open deal carries a dated next step.')} />
              <ActionForm action={updateDealAction} className="grid grid-cols-2 gap-4">
                <input type="hidden" name="deal_id" value={deal.id} />
                <Field label={t('Próximo paso', 'Next step')} className="col-span-2"><input name="next_step" className="input" defaultValue={deal.next_step ?? ''} data-testid="next-step" /></Field>
                <Field label={t('Fecha del próximo paso', 'Next step date')}><input name="next_step_due" type="date" className="input" defaultValue={deal.next_step_due ?? ''} data-testid="next-step-due" /></Field>
 {!ops.has_items && <Field label={t(`Monto esperado al mes (${market.currency})`, `Expected monthly amount (${market.currency})`)}><input name="amount" className="input" inputMode="decimal" defaultValue={deal.amount_minor ? String(Number(deal.amount_minor) / 100) : ''} data-testid="amount" /></Field>}
                <Field label={t('Quien decide', 'Decision-maker')}>
                  <select name="decision_maker_id" className="input" defaultValue={deal.decision_maker_id ?? ''} data-testid="decision-maker">
                    <option value="">{t('Sin identificar', 'Not identified')}</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {lab(t, CONTACT_ROLE[c.role])}</option>)}
                  </select>
                </Field>
                <label className="flex items-center gap-3 self-end pb-3 text-[14px]">
                  <input type="checkbox" name="decision_maker_met" defaultChecked={deal.decision_maker_met} className="h-5 w-5" data-testid="decision-maker-met" />
                  {t('Ya hablé con quien decide', 'I have spoken with the decision-maker')}
                </label>
                <div className="col-span-2 flex justify-end"><Submit variant="ghost" testId="deal-save">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
            </Card>
          )}

          {(ops.has_items || items.length > 0) && <DealItems ctx={ctx} dealId={deal.id} open={deal.status === 'open'} items={items} ops={ops} currency={deal.currency} />}

          <DealPeople ctx={ctx} dealId={deal.id} accountId={deal.account_id} segment={deal.motor ?? null} canEdit={canEditFields} />

          {(ops.pipelineHasOps || ops.is_ops || ops.merchant_ref || ctx.can('deal.ops', deal.market_code)) && (
            <DealOpsCard ctx={ctx} dealId={deal.id} open={deal.status === 'open'} title={deal.title} ops={ops} today={today} />
          )}
          {ops.checklist && <TrainingAgenda ctx={ctx} dealId={deal.id} market={deal.market_code} open={deal.status !== 'lost'} today={today} />}

          {defs.length > 0 && (
            <Card data-testid="deal-custom">
              <CardTitle title={t('Campos adicionales', 'Additional fields')} />
              <CustomFields defs={defs} values={deal.custom} t={t} locale={locale}
                action={canEditFields ? <LinkButton href={`/deals/${deal.id}/campos`} size="sm" testId="custom-edit">{t('Editar campos', 'Edit fields')}</LinkButton> : undefined} />
            </Card>
          )}

          <Card>
            <CardTitle title={t('Hilo', 'Thread')} hint={<span data-testid="thread-zone">{zoneNote(market, locale)}</span>} />
            {ctx.can('activity.write', deal.market_code) && (
              <ActionForm action={addActivityAction} onOk="reset" className="mb-6">
                <input type="hidden" name="deal_id" value={deal.id} />
                <div className="flex flex-wrap gap-3">
                  <select name="kind" className="input !w-40" aria-label={t('Tipo', 'Type')}>
                    <option value="note">{lab(t, ACTIVITY.note)}</option><option value="call">{lab(t, ACTIVITY.call)}</option><option value="meeting">{lab(t, ACTIVITY.meeting)}</option>
                  </select>
                  <input name="subject" className="input !w-auto min-w-[200px] flex-1" required minLength={2} placeholder={t('¿Qué pasó?', 'What happened?')} data-testid="note-subject" />
                  {people.length > 0 && (
                    <select name="notify" className="input !w-auto min-w-[160px]" aria-label={t('Avisar a', 'Notify')} defaultValue="" data-testid="note-notify">
                      <option value="">{t('Avisar a: nadie', 'Notify: nobody')}</option>
                      {people.map((u) => <option key={u.id} value={u.id}>{t(`Avisar a ${u.full_name}`, `Notify ${u.full_name}`)}</option>)}
                    </select>
                  )}
                  <Submit variant="ghost" testId="note-add">{t('Agregar', 'Add')}</Submit>
                </div>
                {people.length > 0 && <p className="mt-2 text-[13px] text-muted">{t('El aviso sale solo con una nota y le aparece a esa persona en Hoy. No se envía correo.', 'The notice goes out only with a note and shows up in that person’s Today. No email is sent.')}</p>}
              </ActionForm>
            )}
            <ul className="space-y-4" data-testid="deal-timeline">
              {activities.map((a) => (
                <li key={a.id} className="border-l-2 border-line-2 pl-4">
                  <p className="text-[14px] font-semibold text-strong">{a.subject}</p>
                  <p className="text-[12.5px] text-muted">
                    {[lab(t, ACTIVITY[a.kind]), a.outcome && a.outcome !== 'done' ? ctx.m(`complete.result.${a.outcome}` as MessageKey) : null, a.visited_by ? t(`visitó ${a.visited_by}`, `visited by ${a.visited_by}`) : null, a.author, dayTime(a.done_at ?? a.created_at, locale, market.timezone)].filter(Boolean).join(' · ')}
                    {a.kind === 'task' || a.kind === 'visit' ? (a.done_at ? (a.kind === 'task' ? ` · ${t('hecha', 'done')}` : '') : ` · ${t(a.kind === 'visit' ? 'por hacer el' : 'vence', a.kind === 'visit' ? 'planned for' : 'due')} ${day(a.due_at, locale)}`) : ''}
                  </p>
                </li>
              ))}
              {events.map((e, i) => (
                <li key={`e${i}`} className="border-l-2 border-brand/50 pl-4">
                  <p className="text-[14px] font-semibold text-strong">{e.to_kind === 'won' && deal.won_at
                    ? <span data-testid="timeline-won">{t(`Negocio ganado, con cierre el ${day(deal.won_at, locale, market.timezone)}`, `Deal won, with close date ${day(deal.won_at, locale, market.timezone)}`)}</span>
                    : <>{e.from_es ? `${t(e.from_es, e.from_en ?? '')} → ` : ''}{t(e.to_es, e.to_en)}</>}</p>
                  <p className="text-[12.5px] text-muted">{e.cause === 'transaction' ? t('Primera transacción', 'First transaction') : (e.actor ?? <NoData locale={locale} />)} · {dayTime(e.at, locale, market.timezone)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-8">
          <Card>
            <CardTitle title={t('Resumen', 'Summary')} />
            <dl>
              <KeyVal k={t('Comercio', 'Merchant')}><Link href={`/comercios/${deal.account_id}`} className="text-blue-text underline" data-testid="deal-account">{deal.account_name}</Link></KeyVal>
              <KeyVal k={t('Quién lo lleva', 'Owner')}>{deal.owner_name ?? <NoData locale={locale} />}</KeyVal>
              {(ops.is_ops || deal.ops_owner_name) && <KeyVal k={t('En Operaciones', 'In Operations')}>{deal.ops_owner_name ?? t('Sin tomar', 'Not taken')}</KeyVal>}
              {ops.merchant_ref && <KeyVal k="Merchant ID">{ops.merchant_ref}</KeyVal>}
              <KeyVal k={ops.has_items ? t('Monto (suma de líneas)', 'Amount (sum of lines)') : t('Monto esperado', 'Expected amount')}>{money(deal.amount_minor ? Number(deal.amount_minor) : null, deal.currency, locale)}</KeyVal>
              {deal.status === 'open' && <KeyVal k={t('Próximo paso', 'Next step')}>{deal.next_step ? `${deal.next_step} · ${day(deal.next_step_due, locale)}` : <NoData locale={locale} />}</KeyVal>}
              <KeyVal k={t('En esta etapa', 'In this stage')}>{t(`${daysSince(deal.stage_entered_at)} días`, `${daysSince(deal.stage_entered_at)} days`)}</KeyVal>
              <KeyVal k={t('Creado', 'Created')}>{day(deal.created_at, locale, market.timezone)}</KeyVal>
              {deal.won_at && <KeyVal k={deal.closed_by === 'transaction' ? t('Primera transacción', 'First transaction') : t('Ganado', 'Won')}>{day(deal.won_at, locale, market.timezone)}</KeyVal>}
            </dl>
          </Card>
        </div>
      </div>
    </>
  )
}
