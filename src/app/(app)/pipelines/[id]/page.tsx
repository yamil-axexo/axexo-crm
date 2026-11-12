import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getBoard, listPipelines, BOARD_LIMIT } from '@/dal/pipelines'
import { track } from '@/dal/boards'
import { cx } from '@/ui/kit'
import { Board, NavSelect, type BoardCard, type BoardCol } from '@/ui/board'
import { daysSince, isoDay, money, weekday } from '@/lib/format'
import { qs } from '@/lib/labels'
import { boardMoveAction } from '../actions'
import { flat } from '@/server/params'

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ owner?: string; vista?: string; paso?: string }> }) {
  const ctx = await requireCtx()
  const { t, m, locale } = ctx
  const { id } = await params
  const sp = flat(await searchParams)
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const [board, pipelines] = await Promise.all([getBoard(ctx, id, { owner: sp.owner, noStep: sp.paso === 'sin', paused: sp.paso === 'pausa' }), listPipelines(ctx)])
  if (!board) notFound()
  await track(ctx, 'view.pipeline')
  const market = ctx.market(board.pipeline.market_code)
  const listView = sp.vista === 'lista'
  const stages = board.stages.filter((s) => s.kind === 'open' || s.kind === 'awaiting_txn')
  const total = (stageId: string) => board.totals.find((x) => x.stage_id === stageId)
  const now = new Date()
  const today = isoDay(now, market.timezone)
  const canMove = ctx.can('deal.move', board.pipeline.market_code)
  const open = board.totals.reduce((n, x) => n + x.n, 0)
  const noStep = board.totals.reduce((n, x) => n + x.no_step, 0)
  const revisits = board.totals.reduce((n, x) => n + x.revisits, 0)
  const paused = board.totals.reduce((n, x) => n + x.paused, 0)
  const here = (patch: Record<string, string | undefined>) => qs(`/pipelines/${id}`, { owner: sp.owner, vista: sp.vista, paso: sp.paso, ...patch })
  const seg = (on: boolean) => cx('press inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium', on ? 'bg-ink text-white' : 'text-strong hover:bg-green-50')

  const cols: BoardCol[] = stages.map((s, i) => {
    const tot = total(s.id)
    return {
      id: s.id, code: s.code, name: t(s.name_es, s.name_en),
      // La franja va del menta al teal a lo largo del embudo, tenga 3 etapas o 9.
      color: `var(--cg-stage-${1 + Math.round((i * 4) / Math.max(1, stages.length - 1))})`,
      count: tot?.n ?? 0,
      amount: tot?.amount ? money(Number(tot.amount), market.currency, locale) : null,
      note: null,
      more: (tot?.n ?? 0) > BOARD_LIMIT ? m('deals.more', { shown: BOARD_LIMIT, total: tot?.n ?? 0 }) : null,
    }
  })
  const chip = (d: (typeof board.deals)[number]): BoardCard['chip'] => {
    // En pausa: no es un negocio sin próximo paso ni vencido; dice cuándo se revisa.
    if (d.paused_at) return { text: t(`En pausa${d.pause_review_on ? ` · se revisa ${weekday(d.pause_review_on, locale)}` : ''}`, `On hold${d.pause_review_on ? ` · review ${weekday(d.pause_review_on, locale)}` : ''}`), tone: 'ok' }
    if (!d.next_step || !d.next_step_due) return { text: m('deals.chip.none'), tone: 'warn' }
    if (d.next_step_due < today) return { text: m('deals.chip.late', { step: d.next_step }), tone: 'risk', title: d.next_step }
    return { text: `${d.next_step} · ${d.next_step_due === today ? m('complete.when.today').toLowerCase() : weekday(d.next_step_due, locale)}`, tone: 'ok', title: d.next_step }
  }
  const cards: BoardCard[] = board.deals.map((d) => ({
    id: d.id, stageId: d.stage_id, name: d.account_name,
    sub: [d.amount_minor ? money(Number(d.amount_minor), d.currency, locale) : null, m('deals.days', { count: daysSince(d.stage_entered_at, now) }), sp.owner === 'me' ? null : (d.owner_name ?? m('deals.noOwner'))].filter(Boolean).join(' · '),
    chip: chip(d), extra: d.revisit_needed ? m('deals.chip.revisit') : null, href: `/deals/${d.id}`, canMove,
  }))

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-9 font-semibold">{m('deals.title')}</h1>
          <p className="mt-1 text-[15px] text-muted" data-testid="board-summary">
            {[m('deals.summary.open', { count: open }), ...board.amounts.map((a) => money(Number(a.amount), a.currency, locale, true))].join(' · ')}
            {' · '}
            <span className={noStep ? 'font-medium text-amber-text' : undefined} data-testid="summary-no-step">{m('deals.summary.noStep', { count: noStep })}</span>
            <span className="block text-[13px]">
              {[m('deals.summary.revisits', { count: revisits }), m('deals.summary.won', { count: board.closed.won }), m('deals.summary.lost', { count: board.closed.lost })].join(' · ')}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NavSelect label={m('deals.pipeline')} value={here({})} testId="pipeline-select"
            options={pipelines.map((p) => ({ href: qs(`/pipelines/${p.id}`, { owner: sp.owner, vista: sp.vista, paso: sp.paso }), label: `${ctx.markets.length > 1 ? `${p.market_code} · ` : ''}${p.name} (${p.open_deals})` }))} />
          <nav aria-label={m('deals.scope')} className="inline-flex rounded-full border border-line bg-surface p-1">
            <Link href={here({ owner: undefined })} aria-current={sp.owner !== 'me' ? 'page' : undefined} className={seg(sp.owner !== 'me')} data-testid="pill-all">{m('merchants.scope.all')}</Link>
            <Link href={here({ owner: 'me' })} aria-current={sp.owner === 'me' ? 'page' : undefined} className={seg(sp.owner === 'me')} data-testid="pill-me">{m('merchants.scope.mine')}</Link>
          </nav>
          <nav aria-label={m('deals.filter')} className="inline-flex rounded-full border border-line bg-surface p-1">
            <Link href={here({ paso: undefined })} aria-current={sp.paso !== 'sin' && sp.paso !== 'pausa' ? 'page' : undefined} className={seg(sp.paso !== 'sin' && sp.paso !== 'pausa')} data-testid="filter-all">{m('deals.filter.all')}</Link>
            <Link href={here({ paso: 'sin' })} aria-current={sp.paso === 'sin' ? 'page' : undefined} className={seg(sp.paso === 'sin')} data-testid="filter-no-step">{m('deals.filter.noStep')}</Link>
            <Link href={here({ paso: 'pausa' })} aria-current={sp.paso === 'pausa' ? 'page' : undefined} className={seg(sp.paso === 'pausa')} data-testid="filter-paused">{t(`En pausa (${paused})`, `On hold (${paused})`)}</Link>
          </nav>
          <nav aria-label={m('deals.view')} className="inline-flex rounded-full border border-line bg-surface p-1">
            <Link href={here({ vista: undefined })} aria-current={!listView ? 'page' : undefined} className={seg(!listView)} data-testid="view-board">{m('deals.view.board')}</Link>
            <Link href={here({ vista: 'lista' })} aria-current={listView ? 'page' : undefined} className={seg(listView)} data-testid="view-list">{m('deals.view.list')}</Link>
          </nav>
        </div>
      </header>

      {listView ? (
        <div className="card @container overflow-hidden" data-testid="deal-list">
          <div aria-hidden className="hidden border-b border-line px-5 py-3 text-[13px] font-medium text-muted @2xl:grid @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_140px_minmax(0,1.4fr)] @2xl:gap-4">
            <span>{m('deals.col.deal')}</span><span>{m('deals.stage')}</span><span>{m('deals.col.amount')}</span><span>{m('deals.col.next')}</span>
          </div>
          <ul className="divide-y divide-line">
            {board.deals.length === 0 && <li className="px-5 py-10 text-center text-[15px] text-muted">{m('deals.empty')}</li>}
            {[...board.deals].sort((a, b) => (stages.findIndex((s) => s.id === a.stage_id) - stages.findIndex((s) => s.id === b.stage_id))).map((d) => {
              const c = chip(d)
              const st = stages.find((s) => s.id === d.stage_id)
              return (
                <li key={d.id} data-testid="deal-list-row">
                  <Link href={`/deals/${d.id}`} className="row-hover block px-4 py-3.5 @2xl:grid @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_140px_minmax(0,1.4fr)] @2xl:items-center @2xl:gap-4 @2xl:px-5">
                    <span className="block min-w-0">
                      <span className="block truncate text-[15px] font-medium text-strong">{d.account_name}</span>
                      <span className="block truncate text-[13px] text-muted">{[d.owner_name ?? m('deals.noOwner'), m('deals.days', { count: daysSince(d.stage_entered_at, now) })].join(' · ')}</span>
                    </span>
                    <span className="mt-1 block truncate text-[14px] text-strong @2xl:mt-0">{st ? t(st.name_es, st.name_en) : ''}</span>
                    <span className="num hidden text-[14px] text-strong @2xl:block">{d.amount_minor ? money(Number(d.amount_minor), d.currency, locale) : '—'}</span>
                    <span className="mt-1.5 block @2xl:mt-0">
                      <span className={cx('inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-[13px] font-medium', c.tone === 'warn' ? 'bg-warn-bg text-amber-text' : c.tone === 'risk' ? 'bg-risk-bg text-red-text' : 'bg-green-100 text-brand-text')}>{c.text}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <>
          <Board
            key={board.deals.map((d) => `${d.id}:${d.stage_id}:${d.next_step_due ?? ''}`).join('|')}
            id={id}
            cols={cols}
            cards={cards}
            minDate={today}
            action={boardMoveAction}
            labels={{
              stages: m('deals.stages'), stage: m('deals.stage'), moveTo: m('deals.moveTo', { name: '%s' }), moved: m('deals.moved', { name: '%n', stage: '%s' }), empty: m('deals.empty'),
              nextTitle: m('deals.next.title', { name: '%s' }), nextBody: m('deals.next.body'), nextStep: m('deals.next.step'), nextDue: m('deals.next.due'), nextSave: m('deals.next.save'), cancel: m('action.cancel'),
            }}
          />
          {canMove && <p className="mt-3 text-[13px] text-muted">{m('deals.hint')}</p>}
        </>
      )}
    </>
  )
}
