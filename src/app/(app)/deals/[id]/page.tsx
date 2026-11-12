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
import { lossReasons } from '@/dal/leads'
import { FIELD_LABEL } from '@/domain/deals'
import { Badge, Card, CardTitle, Field, KeyVal, LinkButton, PageHeader, buttonClass, cx } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { day, dayTime, daysSince, money } from '@/lib/format'
import { ACTIVITY, CONTACT_ROLE, lab } from '@/lib/labels'
import { moveDealAction, updateDealAction } from '@/app/(app)/pipelines/actions'
import { addActivityAction } from '@/app/(app)/actividades/actions'

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const data = await getDeal(ctx, id)
  if (!data) notFound()
  const { deal, stages, contacts, events, activities, items, current, next, missingNext } = data
  const defs = await fieldDefs(ctx, 'deal', deal.market_code)
  const canEditFields = ctx.can('deal.edit', deal.market_code)
  const market = ctx.market(deal.market_code)
  const canEdit = deal.status === 'open' && ctx.can('deal.edit', deal.market_code)
  const reasons = canEdit ? await lossReasons(ctx) : []
  const lost = stages.find((s) => s.kind === 'lost')
  const flow = stages.filter((s) => s.kind !== 'lost')
  const prev = current ? stages.find((s) => s.position === current.position - 1 && s.kind === 'open') : undefined
  const won = stages.find((s) => s.kind === 'won')
  const lastOpen = Boolean(current && current.kind === 'open' && (!next || next.kind === 'won'))
  // Llamar desde el negocio: al comercio o, si no tiene teléfono, a su contacto. Al volver se pregunta cómo fue.
  const callee = await accountPhone(ctx, deal.account_id)
  const canLog = ctx.can('activity.write', deal.market_code)
  const call = <><Phone size={18} strokeWidth={1.75} aria-hidden />{ctx.m('action.call')}</>

  return (
    <>
      <PageHeader
        eyebrow={`Deal · ${deal.pipeline_name}`}
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
              <p className="text-[15px] font-semibold text-amber-text">{t('Hay que volver con el decisor', 'Go back to the decision-maker')}</p>
              <p className="mt-1 text-[13.5px] text-muted-2">
                {t('La última visita no encontró a quien decide.', 'The last visit did not find the person who decides.')}
                {deal.revisit_due ? ` ${t('Fecha sugerida:', 'Suggested date:')} ${day(deal.revisit_due, locale)}.` : ''}
              </p>
            </div>
          )}

          {deal.status === 'open' && current && (
            <Card data-testid="deal-move">
              <CardTitle
                title={current.kind === 'awaiting_txn' ? t('Esperando la primera transacción', 'Waiting for the first transaction') : t('Avanzar el negocio', 'Move the deal forward')}
                hint={
                  current.kind === 'awaiting_txn'
                    ? t(`Lleva ${daysSince(deal.stage_entered_at)} días aquí. Se gana cuando el archivo diario de S5 trae la primera venta de este comercio; nadie lo marca a mano.`, `It has been here ${daysSince(deal.stage_entered_at)} days. It is won when the S5 daily file brings this merchant’s first sale; nobody marks it by hand.`)
                    : current.exit_es
                      ? t(`Criterio de salida: ${current.exit_es}.`, `Exit criteria: ${current.exit_en}.`)
                      : lastOpen && deal.close_by_transaction
                        ? t('Última etapa del embudo. El negocio se gana cuando S5 reporta la primera transacción del comercio; nadie lo marca a mano.', 'Last stage of the pipeline. The deal is won when S5 reports the merchant’s first transaction; nobody marks it by hand.')
                        : undefined
                }
              />
              {next && next.kind !== 'won' && missingNext.length > 0 && (
                <p className="mb-5 rounded-2xl bg-surface-2 px-4 py-3 text-[13.5px] text-muted-2" data-testid="gate-missing">
                  {t(`Para pasar a "${next.name_es}" falta: `, `To move to "${next.name_en}" you still need: `)}
                  <strong className="text-strong">{missingNext.map((m) => t(FIELD_LABEL[m]?.es ?? m, FIELD_LABEL[m]?.en ?? m)).join(', ')}</strong>.
                </p>
              )}
              {canEdit && (
                <div className="flex flex-wrap gap-3">
                  {next && next.kind !== 'won' && (
                    <ActionForm action={moveDealAction}>
                      <input type="hidden" name="deal_id" value={deal.id} /><input type="hidden" name="stage_id" value={next.id} />
                      <Submit testId="deal-advance">{t(`Pasar a "${next.name_es}"`, `Move to "${next.name_en}"`)}</Submit>
                    </ActionForm>
                  )}
                  {won && !deal.close_by_transaction && (
                    <ActionForm action={moveDealAction}>
                      <input type="hidden" name="deal_id" value={deal.id} /><input type="hidden" name="stage_id" value={won.id} />
                      <Submit variant={lastOpen ? 'primary' : 'ghost'} testId="deal-win">{t('Marcar como ganado', 'Mark as won')}</Submit>
                    </ActionForm>
                  )}
                  {prev && (
                    <ActionForm action={moveDealAction}>
                      <input type="hidden" name="deal_id" value={deal.id} /><input type="hidden" name="stage_id" value={prev.id} />
                      <Submit variant="ghost" testId="deal-back">{t(`Regresar a "${prev.name_es}"`, `Back to "${prev.name_en}"`)}</Submit>
                    </ActionForm>
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
            <Card><p className="text-[14.5px]">{t('Motivo: ', 'Reason: ')}<strong>{reasons.find((r) => r.code === deal.loss_reason_code)?.label_es ?? deal.loss_reason_code}</strong>{deal.loss_note ? ` · ${deal.loss_note}` : ''}</p></Card>
          )}

          {canEdit && (
            <Card data-testid="deal-edit">
              <CardTitle title={t('Datos del negocio', 'Deal details')} hint={t('Todo negocio abierto lleva un próximo paso con fecha.', 'Every open deal carries a dated next step.')} />
              <ActionForm action={updateDealAction} className="grid grid-cols-2 gap-4">
                <input type="hidden" name="deal_id" value={deal.id} />
                <Field label={t('Próximo paso', 'Next step')} className="col-span-2"><input name="next_step" className="input" defaultValue={deal.next_step ?? ''} data-testid="next-step" /></Field>
                <Field label={t('Fecha del próximo paso', 'Next step date')}><input name="next_step_due" type="date" className="input" defaultValue={deal.next_step_due ?? ''} data-testid="next-step-due" /></Field>
                <Field label={t(`Monto esperado al mes (${market.currency})`, `Expected monthly amount (${market.currency})`)}><input name="amount" className="input" inputMode="decimal" defaultValue={deal.amount_minor ? String(Number(deal.amount_minor) / 100) : ''} data-testid="amount" /></Field>
                <Field label={t('Decisor', 'Decision-maker')}>
                  <select name="decision_maker_id" className="input" defaultValue={deal.decision_maker_id ?? ''} data-testid="decision-maker">
                    <option value="">{t('Sin identificar', 'Not identified')}</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {lab(t, CONTACT_ROLE[c.role])}</option>)}
                  </select>
                </Field>
                <label className="flex items-center gap-3 self-end pb-3 text-[14px]">
                  <input type="checkbox" name="decision_maker_met" defaultChecked={deal.decision_maker_met} className="h-5 w-5" data-testid="decision-maker-met" />
                  {t('Ya hablé con el decisor', 'I have spoken with the decision-maker')}
                </label>
                <div className="col-span-2 flex justify-end"><Submit variant="ghost" testId="deal-save">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
            </Card>
          )}

          {items.length > 0 && (
            <Card data-testid="deal-items">
              <CardTitle title={t('Productos', 'Products')} />
              <ul>
                {items.map((it) => (
                  <li key={it.id} className="flex items-baseline justify-between gap-4 border-t border-line py-3 text-[14px] first:border-t-0">
                    <span><span className="font-semibold text-strong">{it.name}</span> <span className="text-muted-2">× {Number(it.quantity)}</span>{it.comments ? <span className="block text-[12.5px] text-muted">{it.comments}</span> : null}</span>
                    <span className="num whitespace-nowrap">{money(it.sum_minor ? Number(it.sum_minor) : null, it.currency, locale)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {defs.length > 0 && (
            <Card data-testid="deal-custom">
              <CardTitle title={t('Campos adicionales', 'Additional fields')} />
              <CustomFields defs={defs} values={deal.custom} t={t} locale={locale}
                action={canEditFields ? <LinkButton href={`/deals/${deal.id}/campos`} size="sm" testId="custom-edit">{t('Editar campos', 'Edit fields')}</LinkButton> : undefined} />
            </Card>
          )}

          <Card>
            <CardTitle title="Timeline" />
            {ctx.can('activity.write', deal.market_code) && (
              <ActionForm action={addActivityAction} onOk="reset" className="mb-6">
                <input type="hidden" name="deal_id" value={deal.id} />
                <div className="flex flex-wrap gap-3">
                  <select name="kind" className="input !w-40" aria-label={t('Tipo', 'Type')}>
                    <option value="note">{lab(t, ACTIVITY.note)}</option><option value="call">{lab(t, ACTIVITY.call)}</option><option value="meeting">{lab(t, ACTIVITY.meeting)}</option>
                  </select>
                  <input name="subject" className="input !w-auto min-w-[200px] flex-1" required minLength={2} placeholder={t('¿Qué pasó?', 'What happened?')} data-testid="note-subject" />
                  <Submit variant="ghost" testId="note-add">{t('Agregar', 'Add')}</Submit>
                </div>
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
                  <p className="text-[14px] font-semibold text-strong">{e.from_es ? `${t(e.from_es, e.from_en ?? '')} → ` : ''}{t(e.to_es, e.to_en)}</p>
                  <p className="text-[12.5px] text-muted">{e.cause === 'transaction' ? t('Primera transacción (S5)', 'First transaction (S5)') : (e.actor ?? '—')} · {dayTime(e.at, locale, market.timezone)}</p>
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
              <KeyVal k={t('Dueño', 'Owner')}>{deal.owner_name ?? '—'}</KeyVal>
              <KeyVal k={t('Monto esperado', 'Expected amount')}>{money(deal.amount_minor ? Number(deal.amount_minor) : null, deal.currency, locale)}</KeyVal>
              <KeyVal k={t('Próximo paso', 'Next step')}>{deal.next_step ? `${deal.next_step} · ${day(deal.next_step_due, locale)}` : '—'}</KeyVal>
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
