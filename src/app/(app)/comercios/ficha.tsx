import Link from 'next/link'
import { CalendarPlus, MessageCircle, Phone, StickyNote, X } from 'lucide-react'
import type { Ctx } from '@/server/context'
import { getAccount, parentOptions } from '@/dal/accounts'
import { sellers } from '@/dal/leads'
import { fieldDefs } from '@/dal/fields'
import { sheetConfig, taskItem } from '@/server/sheet'
import { CustomFields } from '@/ui/fields'
import { Badge, Field, KeyVal, LinkButton, cx } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { CompleteButton } from '@/ui/complete'
import { ago, day, isoDay, offsetMs, money, monthYear, num, phoneText, threadDate, weekday } from '@/lib/format'
import { HEALTH_DOT, healthOf } from '@/lib/health'
import { ACTIVITY, ALIAS_SYSTEM, ATTRIBUTION_LAYER, CONTACT_ROLE, KIND, LIFECYCLE, MOTOR, lab } from '@/lib/labels'
import type { MessageKey } from '@/lib/messages'
import { addContactAction, reassignAction, setParentAction, updateAccountAction } from './actions'
import { addActivityAction } from '@/app/(app)/actividades/actions'
import { createDealAction } from '@/app/(app)/pipelines/actions'
import { completeItemAction } from '@/app/(app)/hoy/actions'

export const FICHA_TABS = ['hilo', 'arbol', 'datos'] as const
export type FichaTab = (typeof FICHA_TABS)[number]
export const fichaTab = (v: string | undefined): FichaTab => (FICHA_TABS as readonly string[]).includes(v ?? '') ? (v as FichaTab) : 'hilo'

type Data = NonNullable<Awaited<ReturnType<typeof getAccount>>>

/** Etiqueta de nivel del árbol: organización y distribuidor en negro con texto neón, cadena en menta, punto de venta en verde claro. */
const LEVEL: Record<string, string> = {
  organization: 'bg-black text-neon',
  distributor: 'bg-black text-neon',
  chain: 'bg-mint text-[#0b3d2c]',
  store: 'bg-green-100 text-brand-text',
}

/**
 * Ficha del comercio (handoff, sección 5): encabezado, "Lo siguiente", cuatro acciones y las pestañas Hilo, Árbol y Datos.
 * La misma ficha se usa como panel sobre la lista (desktop), a un lado de la lista (tablet) y a pantalla completa (móvil y enlaces directos).
 */
export async function Ficha({ ctx, data, tab, mode, href, closeHref }: { ctx: Ctx; data: Data; tab: FichaTab; mode: 'panel' | 'page'; href: (id: string, tab?: FichaTab) => string; closeHref: string }) {
  const { t, m, locale } = ctx
  const { account: a, ancestors, rollup, children, contacts, aliases, attributions, deals, metrics, tasks, timeline, pipelines } = data
  const market = ctx.market(a.market_code)
  const tz = market.timezone
  const now = new Date()
  const canWrite = !a.archived_at && ctx.can('activity.write', a.market_code)
  const canEdit = !a.archived_at && ctx.can('account.edit', a.market_code)
  const canReassign = !a.archived_at && ctx.can('account.reassign', a.market_code)
  const canSell = !a.archived_at && ctx.can('deal.create', a.market_code)
  const isParent = a.kind !== 'store'
  const openDeal = deals.find((d) => d.status === 'open')
  const lastDeal = deals[0]
  const health = healthOf(a.lifecycle, !!openDeal)
  const today = isoDay(now, tz)
  const parent = ancestors[ancestors.length - 1]
  const size = isParent ? m('merchants.size.children', { count: rollup.stores }) : parent ? m('merchants.size.under', { name: parent.name }) : m('merchants.size.independent')
  // Para llamar: el teléfono del comercio y, si no tiene, el de su contacto (primero quien decide).
  const callee = a.phone
    ? { phone: a.phone, who: null as string | null }
    : (() => {
        const c = contacts.find((x) => x.role === 'decision_maker' && x.phone) ?? contacts.find((x) => x.role === 'owner' && x.phone) ?? contacts.find((x) => x.phone)
        return c?.phone ? { phone: c.phone, who: c.full_name } : null
      })()
  const owner = a.owner_name ?? (ancestors.length ? m('merchants.viaChain') : m('merchants.noOwner'))
  const Title = mode === 'page' ? 'h1' : 'h2'

  // Lo siguiente: la actividad abierta más próxima; si no hay, el próximo paso del negocio abierto.
  const step = tasks[0]
    ? { text: tasks[0].subject, due: tasks[0].due_at }
    : openDeal?.next_step
      ? { text: openDeal.next_step, due: openDeal.next_step_due ? new Date(`${openDeal.next_step_due}T15:00:00Z`) : null }
      : null
  const startOfToday = new Date(new Date(`${today}T00:00:00Z`).getTime() - offsetMs(now, tz))
  const stepLate = !!step?.due && step.due < startOfToday
  const dueLabel = (due: Date | null, late: boolean) => (due ? m(late ? 'record.next.late' : 'record.next.due', { date: weekday(due, locale, tz) }) : '')

  const tile = 'press flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-[12px] border border-line bg-surface text-[13px] font-medium text-green-600 hover:bg-green-50'
  const tileOff = 'flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-line-2 text-[13px] font-medium text-muted'
  const section = 'border-t border-line pt-6'
  const h3 = 'text-[15px] leading-6 font-semibold'

  const visitText = (it: (typeof timeline)[number]) => {
    const v = it.meta as { rejection?: string | null; revisit?: boolean; minutes?: number | null }
    const base = it.title === 'sale' ? t('Visita con venta', 'Visit with a sale') : t('Visita sin venta', 'Visit with no sale')
    return `${base}${v.rejection ? ` · ${v.rejection}` : ''}${v.revisit ? ` · ${t('pide revisita', 'needs a revisit')}` : ''}${v.minutes ? ` · ${v.minutes} min` : ''}`
  }
  const threadTitle = (it: (typeof timeline)[number]) =>
    it.kind === 'visit' ? visitText(it) : it.kind === 'stage' ? `${t('Pasó a', 'Moved to')} "${t(it.title, it.body ?? it.title)}"` : it.kind === 'attribution' ? t(`Dueño: ${it.title}`, `Owner: ${it.title}`) : it.title
  const threadWho = (it: (typeof timeline)[number]) =>
    it.kind === 'stage' && (it.meta as { cause?: string }).cause === 'transaction' ? t('Primera transacción (S5)', 'First transaction (S5)') : it.kind === 'visit' ? `Sales App${it.actor ? ` · ${it.actor}` : ''}` : it.actor

  const [people, parents] = tab === 'datos' && canReassign ? await Promise.all([sellers(ctx, a.market_code), parentOptions(ctx, a.market_code)]) : [[], []]
  const defs = tab === 'datos' ? await fieldDefs(ctx, 'account', a.market_code) : []
  const config = tab === 'hilo' && canWrite && tasks.length ? sheetConfig(ctx, now) : null

  return (
    <article data-testid="ficha" data-mode={mode} aria-labelledby="ficha-title" className="flex flex-col gap-5">
      <div data-testid="account-facts">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">{[lab(t, KIND[a.kind]), size, ctx.markets.length > 1 ? market.name : null].filter(Boolean).join(' · ')}</p>
            <Title id="ficha-title" className="mt-0.5 text-[22px] leading-[30px] font-semibold break-words">{a.name}</Title>
          </div>
          <Link href={closeHref} aria-label={m('record.close')} title={m('record.close')} className="press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface text-strong hover:bg-green-50" data-testid="ficha-close">
            <X size={20} strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-strong">
          <span className="inline-flex items-center gap-2" data-testid="health" data-health={health}>
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: HEALTH_DOT[health] }} />
            {m(`health.${health}` as MessageKey)}
          </span>
          <span aria-hidden className="text-muted">·</span>
          <span className={!a.owner_name && !ancestors.length ? 'text-amber-text' : undefined}>{m('record.owner', { name: owner })}</span>
          {a.archived_at && <Badge tone="bad">{m('record.archived')}</Badge>}
        </p>

        <div className={cx('mt-4 rounded-[12px] px-4 py-3.5', step ? 'bg-green-100' : 'bg-warn-bg')} data-testid="ficha-next" data-state={step ? (stepLate ? 'late' : 'set') : 'none'}>
          <p className={cx('text-[13px]', step ? 'text-brand-text' : 'text-amber-text')}>{m('record.next')}</p>
          <p className="mt-0.5 text-[15px] leading-6 font-medium text-strong">{step ? step.text : m('record.next.none')}</p>
          <p className={cx('text-[13px]', stepLate ? 'font-medium text-red-text' : 'text-muted-2')}>
            {step ? dueLabel(step.due, stepLate) : m('record.next.noneHint')}
            {(openDeal || lastDeal) && (
              <>
                {step?.due ? ' · ' : step ? '' : ' '}
                <Link href={`/deals/${(openDeal ?? lastDeal)!.id}`} className="font-medium text-blue-text underline" data-testid="deal-link">
                  {openDeal ? m('record.next.deal', { stage: t(openDeal.stage_es, openDeal.stage_en) }) : m('record.next.dealClosed', { status: lastDeal!.status === 'won' ? t('ganado', 'won') : t('perdido', 'lost') })}
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2" data-testid="ficha-actions">
        {callee ? (
          <a href={`tel:${callee.phone}`} className={tile} title={callee.who ?? undefined} data-testid="action-call"><Phone size={20} strokeWidth={1.75} aria-hidden />{m('action.call')}</a>
        ) : (
          <span className={tileOff} title={m('action.noPhone')}><Phone size={20} strokeWidth={1.75} aria-hidden />{m('action.noPhone')}</span>
        )}
        {callee ? (
          <a href={`https://wa.me/${callee.phone.slice(1)}`} target="_blank" rel="noopener noreferrer" className={tile} title={callee.who ?? undefined} data-testid="action-whatsapp"><MessageCircle size={20} strokeWidth={1.75} aria-hidden />{m('action.whatsapp')}</a>
        ) : (
          <span className={tileOff} aria-hidden><MessageCircle size={20} strokeWidth={1.75} aria-hidden />{m('action.whatsapp')}</span>
        )}
        {canWrite ? (
          <>
            <Dialog trigger={<><StickyNote size={20} strokeWidth={1.75} aria-hidden />{m('record.note')}</>} title={m('record.note')} triggerClass={tile} testId="action-note">
              <ActionForm action={addActivityAction} onOk="close" className="space-y-4">
                <input type="hidden" name="account_id" value={a.id} />
                <input type="hidden" name="kind" value="note" />
                <Field label={t('¿Qué pasó?', 'What happened?')}><input name="subject" className="input" required minLength={2} data-testid="note-subject" /></Field>
                <Field label={t('Detalle (opcional)', 'Details (optional)')}><textarea name="body" rows={3} className="input !h-auto py-3" /></Field>
                <div className="flex justify-end"><Submit testId="note-add">{t('Guardar nota', 'Save note')}</Submit></div>
              </ActionForm>
            </Dialog>
            <Dialog trigger={<><CalendarPlus size={20} strokeWidth={1.75} aria-hidden />{m('record.activity')}</>} title={m('record.activity')} triggerClass={tile} testId="action-activity">
              <ActionForm action={addActivityAction} onOk="close" className="space-y-4" testId="activity-form">
                <input type="hidden" name="account_id" value={a.id} />
                <Field label={t('Tipo', 'Type')}>
                  <select name="kind" className="input" defaultValue="task" data-testid="activity-kind">
                    <option value="task">{t('Tarea con fecha', 'Task with a date')}</option><option value="call">{lab(t, ACTIVITY.call)}</option><option value="meeting">{lab(t, ACTIVITY.meeting)}</option>
                  </select>
                </Field>
                <Field label={t('¿Qué pasó o qué sigue?', 'What happened or what is next?')}><input name="subject" className="input" required minLength={2} data-testid="activity-subject" /></Field>
                <Field label={t('Fecha (para tareas)', 'Date (for tasks)')}><input name="due_at" type="date" className="input" min={today} data-testid="activity-due" /></Field>
                <div className="flex justify-end"><Submit testId="activity-add">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
            </Dialog>
          </>
        ) : null}
      </div>

      {callee?.who && <p className="-mt-2 text-[13px] text-muted" data-testid="callee">{m('record.callee', { name: callee.who })}</p>}

      {canSell && !openDeal && pipelines.length > 0 && (
        <Dialog trigger={t('Nuevo negocio', 'New deal')} title={t('Nuevo negocio', 'New deal')} variant="ghost" testId="new-deal">
          <ActionForm action={createDealAction} className="grid grid-cols-2 gap-4">
            <input type="hidden" name="account_id" value={a.id} />
            <Field label="Pipeline" className="col-span-2"><select name="pipeline_id" className="input">{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label={t('Título', 'Title')} className="col-span-2"><input name="title" className="input" required defaultValue={`${t('Alta', 'Onboarding')}: ${a.name}`} /></Field>
            <Field label={t('Próximo paso', 'Next step')} className="col-span-2"><input name="next_step" className="input" required minLength={2} data-testid="new-deal-step" /></Field>
            <Field label={t('Fecha', 'Date')}><input name="next_step_due" type="date" className="input" required defaultValue={today} /></Field>
            <Field label={t(`Monto (${market.currency})`, `Amount (${market.currency})`)}><input name="amount" className="input" inputMode="decimal" /></Field>
            <div className="col-span-2 flex justify-end"><Submit testId="save-deal">{t('Crear negocio', 'Create deal')}</Submit></div>
          </ActionForm>
        </Dialog>
      )}

      <nav aria-label={m('record.tabs')} className="flex gap-6 border-b border-line" data-testid="ficha-tabs">
        {FICHA_TABS.map((k) => (
          <Link key={k} href={href(a.id, k)} scroll={false} aria-current={tab === k ? 'page' : undefined} data-testid={`tab-${k}`}
            className={cx('-mb-px border-b-2 pb-2.5 text-[15px]', tab === k ? 'border-green-600 font-semibold text-strong' : 'border-transparent font-medium text-muted hover:text-strong')}>
            {m(k === 'hilo' ? 'record.tab.thread' : k === 'arbol' ? 'record.tab.tree' : 'record.tab.data')}
          </Link>
        ))}
      </nav>

      {tab === 'hilo' && (
        <div data-testid="account-timeline">
          {tasks.length + timeline.length === 0 ? (
            <p className="text-[15px] text-muted">{m('record.thread.empty')}</p>
          ) : (
            <>
              {tasks.length > 0 && (
                <ol className="thread" data-testid="account-tasks">
                  {tasks.map((task) => {
                    const late = !!task.due_at && task.due_at < startOfToday
                    return (
                      <li key={task.id} className="thread-item thread-open !pb-5" data-testid="thread-next">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={cx('text-[13px] font-medium', late ? 'text-red-text' : 'text-green-600')}>
                              {m('record.thread.next')}{task.due_at ? ` · ${dueLabel(task.due_at, late).toLowerCase()}` : ''}
                            </p>
                            <p className="text-[15px] leading-6 font-medium text-strong">{task.subject}</p>
                            {task.owner_name && task.owner_name !== ctx.user.name && <p className="text-[13px] text-muted">{task.owner_name}</p>}
                          </div>
                          {config && <CompleteButton item={taskItem(ctx, task, a.name)} config={config} action={completeItemAction} />}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
              <ol className="thread">
              {timeline.map((it, i) => (
                <li key={i} className="thread-item" data-testid={`tl-${it.kind}`}>
                  <p className="text-[13px] text-muted">{[threadDate(it.at, locale, tz, now), threadWho(it)].filter(Boolean).join(' · ')}</p>
                  <p className="text-[15px] leading-6 font-medium text-strong">{threadTitle(it)}</p>
                  {it.body && it.kind !== 'stage' && <p className="text-[13px] leading-5 text-muted-2">{it.body}</p>}
                </li>
              ))}
              </ol>
            </>
          )}
        </div>
      )}

      {tab === 'arbol' && (
        <div data-testid="account-children">
          {isParent && (
            <div className="mb-5 rounded-[12px] bg-surface-3 px-4 py-3" data-testid="rollup-stores">
              <p className="text-[15px] font-medium text-strong">{m('record.tree.network', { stores: rollup.stores })}</p>
              <p className="text-[13px] text-muted-2">
                {t(`${rollup.active} activos · ${rollup.onboarding} en alta · ${rollup.at_risk} en riesgo`, `${rollup.active} active · ${rollup.onboarding} onboarding · ${rollup.at_risk} at risk`)}
                {` · ${t(`${num(rollup.txn_30d, locale)} ventas en 30 días`, `${num(rollup.txn_30d, locale)} sales in 30 days`)}`}
                {rollup.volume_30d ? ` · ${money(Number(rollup.volume_30d), rollup.currency ?? market.currency, locale, true)}` : ''}
              </p>
            </div>
          )}
          {ancestors.length + children.length === 0 ? (
            <p className="text-[15px] text-muted">{m('record.tree.alone')}</p>
          ) : (
            <ul className="space-y-1">
              <li>
                <nav aria-label={t('Jerarquía', 'Hierarchy')} data-testid="breadcrumb">
                  <ul className="space-y-1">
                    {ancestors.map((p, i) => (
                      <li key={p.id} style={{ paddingLeft: i * 24 }}>
                        <Link href={href(p.id, 'arbol')} className="row-hover flex items-center gap-3 rounded-[10px] px-2 py-2">
                          <span className={cx('rounded-full px-2.5 py-0.5 text-[13px] font-medium', LEVEL[p.kind] ?? LEVEL.store)}>{lab(t, KIND[p.kind])}</span>
                          <span className="min-w-0 truncate text-[15px] font-medium text-strong">{p.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              </li>
              <li style={{ paddingLeft: ancestors.length * 24 }} aria-current="true">
                <div className="flex items-center gap-3 rounded-[10px] bg-green-50 px-2 py-2">
                  <span className={cx('rounded-full px-2.5 py-0.5 text-[13px] font-medium', LEVEL[a.kind] ?? LEVEL.store)}>{lab(t, KIND[a.kind])}</span>
                  <span className="min-w-0 truncate text-[15px] font-semibold text-strong">{a.name}</span>
                  <span className="ml-auto shrink-0 text-[13px] text-muted">{m('record.tree.here')}</span>
                </div>
              </li>
              {children.map((c) => (
                <li key={c.id} style={{ paddingLeft: (ancestors.length + 1) * 24 }}>
                  <Link href={href(c.id, 'arbol')} className="row-hover flex items-center gap-3 rounded-[10px] px-2 py-2" data-testid="child-row">
                    <span className={cx('rounded-full px-2.5 py-0.5 text-[13px] font-medium', LEVEL[c.kind] ?? LEVEL.store)}>{lab(t, KIND[c.kind])}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-strong">{c.name}</span>
                      <span className="flex items-center gap-1.5 text-[13px] text-muted">
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: HEALTH_DOT[healthOf(c.lifecycle, c.has_deal)] }} />
                        {m(`health.${healthOf(c.lifecycle, c.has_deal)}` as MessageKey)}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 text-[13px] text-muted">{m('record.tree.since', { date: monthYear(c.since, locale, tz) })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'datos' && (
        <div className="space-y-6" data-testid="account-data">
          <section>
            <h3 className={h3}>{isParent ? t('Ventas de su red', 'Network sales') : t('Ventas', 'Sales')}</h3>
            <dl className="mt-2">
              <KeyVal k={t('Etapa de vida', 'Lifecycle')}>{lab(t, LIFECYCLE[a.lifecycle]?.label)} · {t('desde', 'since')} {day(a.lifecycle_at, locale, tz)}</KeyVal>
              {isParent ? (
                <KeyVal k={t('Ventas, 30 días', 'Sales, 30 days')}>{num(rollup.txn_30d, locale)}{rollup.volume_30d ? ` · ${money(Number(rollup.volume_30d), rollup.currency ?? market.currency, locale, true)}` : ''}</KeyVal>
              ) : (
                <>
                  <KeyVal k={t('Ventas, 30 días', 'Sales, 30 days')}><span data-testid="fact-sales">{metrics ? `${num(metrics.txn_count_30d, locale)} · ${money(Number(metrics.volume_minor_30d), metrics.currency, locale, true)} · ${t(`${metrics.active_days_30d} días activos`, `${metrics.active_days_30d} active days`)}` : t('Todavía no transacciona', 'Not transacting yet')}</span></KeyVal>
                  <KeyVal k={t('Primera venta', 'First sale')}>{metrics?.first_txn_at ? day(metrics.first_txn_at, locale, tz) : '—'}</KeyVal>
                  <KeyVal k={t('Última venta', 'Last sale')}>{metrics?.last_txn_at ? ago(metrics.last_txn_at, locale, now) : '—'}</KeyVal>
                </>
              )}
              {a.territory && <KeyVal k={t('Territorio', 'Territory')}>{a.territory}</KeyVal>}
              {a.segment && <KeyVal k={t('Canal', 'Channel')}>{lab(t, MOTOR[a.segment])}</KeyVal>}
            </dl>
            {metrics && <p className="mt-2 text-[13px] text-muted" data-testid="metrics-asof">{t(`Ventas según S5, con corte al ${day(metrics.as_of, locale)}.`, `Sales per S5, as of ${day(metrics.as_of, locale)}.`)}</p>}
          </section>

          {deals.length > 0 && (
            <section className={section} data-testid="account-deals">
              <h3 className={h3}>{t('Negocios', 'Deals')}</h3>
              <ul className="mt-2 divide-y divide-line">
                {deals.map((d) => (
                  <li key={d.id}>
                    <Link href={`/deals/${d.id}`} className="row-hover -mx-2 flex items-center justify-between gap-3 rounded-[10px] px-2 py-2.5">
                      <span className="min-w-0"><span className="block truncate text-[15px] font-medium text-strong">{d.title}</span><span className="text-[13px] text-muted">{[d.owner_name, d.amount_minor ? money(Number(d.amount_minor), d.currency, locale) : null].filter(Boolean).join(' · ')}</span></span>
                      <Badge tone={d.status === 'won' ? 'good' : d.status === 'lost' ? 'bad' : 'neutral'}>{d.status === 'open' ? t(d.stage_es, d.stage_en) : d.status === 'won' ? t('Ganado', 'Won') : t('Perdido', 'Lost')}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={section} data-testid="account-contacts">
            <div className="flex items-center justify-between gap-3">
              <h3 className={h3}>{t('Contactos', 'Contacts')}</h3>
              {canEdit && (
                <Dialog trigger={t('Agregar', 'Add')} title={t('Nuevo contacto', 'New contact')} size="sm" testId="add-contact">
                  <ActionForm action={addContactAction} onOk="close" className="grid grid-cols-2 gap-4">
                    <input type="hidden" name="account_id" value={a.id} />
                    <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="full_name" className="input" required minLength={2} data-testid="contact-name" /></Field>
                    <Field label={t('Rol', 'Role')}><select name="role" className="input" data-testid="contact-role">{Object.entries(CONTACT_ROLE).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></Field>
                    <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" /></Field>
                    <Field label={t('Correo', 'Email')} className="col-span-2"><input name="email" type="email" className="input" /></Field>
                    <div className="col-span-2 flex justify-end"><Submit testId="save-contact">{t('Guardar', 'Save')}</Submit></div>
                  </ActionForm>
                </Dialog>
              )}
            </div>
            <ul className="mt-2 space-y-3">
              {contacts.map((c) => (
                <li key={c.id} data-testid="contact-row">
                  <p className="text-[15px] font-medium text-strong">{c.full_name} <span className="ml-1 text-[13px] font-normal text-muted">{lab(t, CONTACT_ROLE[c.role])}</span></p>
                  <p className="text-[13px] text-muted-2">
                    {c.phone ? <a href={`tel:${c.phone}`} className="font-medium text-blue-text underline" data-testid="contact-call">{phoneText(c.phone)}</a> : null}
                    {c.phone ? <> · <a href={`https://wa.me/${c.phone.slice(1)}`} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-text underline">WhatsApp</a></> : null}
                    {c.phone && c.email ? ' · ' : ''}{c.email ?? (c.phone ? '' : '—')}
                  </p>
                </li>
              ))}
              {contacts.length === 0 && <li className="text-[15px] text-muted">{t('Sin contactos todavía.', 'No contacts yet.')}</li>}
            </ul>
          </section>

          <section className={section} data-testid="account-attribution">
            <h3 className={h3}>{t('Atribución', 'Attribution')}</h3>
            <p className="text-[13px] text-muted">{t('Tres capas, cada una con fecha. Lo anterior no se borra.', 'Three layers, each one dated. Nothing earlier is erased.')}</p>
            <ul className="mt-3 space-y-3">
              {attributions.map((at, i) => (
                <li key={i} className={at.effective_to ? 'text-muted' : ''}>
                  <p className="text-[13px] text-muted">{lab(t, ATTRIBUTION_LAYER[at.layer])}</p>
                  <p className={cx('text-[15px] font-medium', at.effective_to ? 'text-muted-2' : 'text-strong')}>{at.party_label}</p>
                  <p className="text-[13px] text-muted-2">{t('desde', 'since')} {day(at.effective_from, locale, tz)}{at.effective_to ? ` ${t('hasta', 'until')} ${day(at.effective_to, locale, tz)}` : ''}</p>
                </li>
              ))}
            </ul>
            {canReassign && (
              <ActionForm action={reassignAction} className="mt-5">
                <input type="hidden" name="account_id" value={a.id} />
                <Field label={t('Reasignar dueño', 'Reassign owner')}>
                  <select name="to_user_id" className="input" defaultValue={a.owner_id ?? ''} data-testid="reassign-to">
                    {!a.owner_id && <option value="" disabled>{t('Elige a alguien', 'Pick someone')}</option>}
                    {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </Field>
                <div className="mt-3 flex justify-end"><Submit variant="ghost" size="sm" testId="reassign-save">{t('Reasignar', 'Reassign')}</Submit></div>
              </ActionForm>
            )}
          </section>

          <section className={section} data-testid="account-aliases">
            <h3 className={h3}>{t('IDs en otros sistemas', 'IDs in other systems')}</h3>
            <p className="text-[13px] text-muted">{t('Este comercio tiene un solo ID en CONTIGO; los demás sistemas se ligan como alias.', 'This merchant has one ID in CONTIGO; other systems link to it as aliases.')}</p>
            <dl className="mt-2">
              <KeyVal k="CONTIGO"><code className="text-[13px]">{a.id.slice(0, 13)}…</code></KeyVal>
              {aliases.map((al, i) => <KeyVal key={i} k={ALIAS_SYSTEM[al.system] ?? al.system}><code className="text-[13px]" data-testid="alias-value">{al.external_id}</code></KeyVal>)}
            </dl>
            {aliases.length === 0 && <p className="mt-2 text-[13px] text-muted">{t('Todavía no existe en la Sales App ni en S5.', 'It does not exist in the Sales App or S5 yet.')}</p>}
          </section>

          {defs.length > 0 && (
            <section className={section} data-testid="account-custom">
              <h3 className={cx(h3, 'mb-2')}>{t('Campos adicionales', 'Additional fields')}</h3>
              <CustomFields defs={defs} values={a.custom} t={t} locale={locale}
                action={canEdit ? <LinkButton href={`/comercios/${a.id}/campos`} size="sm" testId="custom-edit">{t('Editar campos', 'Edit fields')}</LinkButton> : undefined} />
            </section>
          )}

          {canEdit && (
            <section className={section}>
              <h3 className={cx(h3, 'mb-3')}>{t('Datos del comercio', 'Merchant details')}</h3>
              <ActionForm action={updateAccountAction} className="space-y-4">
                <input type="hidden" name="id" value={a.id} />
                <Field label={t('Nombre', 'Name')}><input name="name" className="input" defaultValue={a.name} required data-testid="edit-name" /></Field>
                <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" defaultValue={a.phone ?? ''} data-testid="edit-phone" /></Field>
                <Field label={t('Correo', 'Email')}><input name="email" className="input" defaultValue={a.email ?? ''} /></Field>
                <Field label={t('Dirección', 'Address')}><input name="address_line" className="input" defaultValue={a.address_line ?? ''} /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t('Ciudad', 'City')}><input name="locality" className="input" defaultValue={a.locality ?? ''} /></Field>
                  <Field label={t('Estado o región', 'State or region')}><input name="region" className="input" defaultValue={a.region ?? ''} /></Field>
                </div>
                <input type="hidden" name="postal_code" value={a.postal_code ?? ''} />
                <div className="flex justify-end"><Submit variant="ghost" testId="edit-save">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
              {canReassign && (
                <ActionForm action={setParentAction} className="mt-6 border-t border-line pt-5">
                  <input type="hidden" name="id" value={a.id} />
                  <Field label={t('Pertenece a', 'Belongs to')}>
                    <select name="parent_id" className="input" defaultValue={a.parent_id ?? ''} data-testid="parent-select">
                      <option value="">{t('Independiente', 'Independent')}</option>
                      {parents.filter((p) => p.id !== a.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <div className="mt-3 flex justify-end"><Submit variant="ghost" size="sm" testId="parent-save">{t('Mover en el árbol', 'Move in the tree')}</Submit></div>
                </ActionForm>
              )}
            </section>
          )}
        </div>
      )}
    </article>
  )
}
