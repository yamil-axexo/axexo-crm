import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getBoard, listPipelines, BOARD_LIMIT } from '@/dal/pipelines'
import { track } from '@/dal/boards'
import { getReportOptions } from '@/dal/reports'
import { isUuid } from '@/lib/ids'
import { cx, NoData } from '@/ui/kit'
import { Board, FilterFold, NavSelect, type BoardCard, type BoardCol } from '@/ui/board'
import { daysSince, isoDay, money, weekday } from '@/lib/format'
import { qs } from '@/lib/labels'
import { boardMoveAction } from '../actions'
import { bulkCloseAction, gateInfoAction, gateMoveAction, winDealAction } from '@/app/(app)/operaciones/actions'
import { staleDeals } from '@/dal/ops'
import { lossReasonsFor } from '@/dal/b2b'
import { PLAIN_MISSING } from '@/domain/deals'
import { BulkPick } from '@/ui/ops'
import { ActionForm, Submit } from '@/ui/client'
import { day } from '@/lib/format'
import { flat } from '@/server/params'

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ owner?: string; vista?: string; paso?: string; quietos?: string; equipo?: string; orden?: string }> }) {
  const ctx = await requireCtx()
  const { t, m, locale } = ctx
  const { id } = await params
  const sp = flat(await searchParams)
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  // Persona y equipo: filtros para supervisión, quien lidera y leadership, dentro de su alcance.
  const options = ctx.can('report.view') ? await getReportOptions(ctx) : null
  const team = sp.equipo === 'none' ? 'none' : options?.teams.some((x) => x.id === sp.equipo) ? sp.equipo : undefined
  const [board, pipelines] = await Promise.all([getBoard(ctx, id, { owner: sp.owner, noStep: sp.paso === 'sin', paused: sp.paso === 'pausa', team }), listPipelines(ctx)])
  if (!board) notFound()
  await track(ctx, 'view.pipeline')
  const market = ctx.market(board.pipeline.market_code)
  const listView = sp.vista === 'lista'
  // Cerrar en bloque lo que lleva más de N días sin movimiento: Operaciones, supervisión y quien lidera.
  const canBulk = ctx.can('deal.bulk_close', board.pipeline.market_code)
  const quietDays = canBulk && sp.quietos ? Math.min(Math.max(Number(sp.quietos) || 30, 1), 720) : 0
  const [stale, reasons] = quietDays ? await Promise.all([staleDeals(ctx, id, quietDays), lossReasonsFor(ctx, board.pipeline.market_code, board.pipeline.motor)]) : [[], []]
  const stages = board.stages.filter((s) => s.kind === 'open' || s.kind === 'awaiting_txn')
  const total = (stageId: string) => board.totals.find((x) => x.stage_id === stageId)
  const now = new Date()
  const today = isoDay(now, market.timezone)
  const canMove = ctx.can('deal.move', board.pipeline.market_code)
  const open = board.totals.reduce((n, x) => n + x.n, 0)
  const noStep = board.totals.reduce((n, x) => n + x.no_step, 0)
  const revisits = board.totals.reduce((n, x) => n + x.revisits, 0)
  const paused = board.totals.reduce((n, x) => n + x.paused, 0)
  const order = sp.orden === 'monto' || sp.orden === 'dias' ? sp.orden : undefined
  const here = (patch: Record<string, string | undefined>) => qs(`/pipelines/${id}`, { owner: sp.owner, vista: sp.vista, paso: sp.paso, equipo: team, orden: order, quietos: undefined, ...patch })
  const teams = (options?.teams ?? []).filter((x) => x.market_code === board.pipeline.market_code)
  const people = [...new Map((options?.people ?? []).filter((x) => x.market_code === board.pipeline.market_code && (!team || (team === 'none' ? !x.team_id : x.team_id === team))).map((x) => [x.id, x.full_name])).entries()]
  // Un solo control para "de quién": con el selector de persona, "Míos" es una de sus opciones; sin él, quedan las dos pastillas.
  const personSelect = Boolean(options && people.length > 0)
  const personValue = sp.owner === ctx.user.id ? here({ owner: 'me' }) : isUuid(sp.owner) || sp.owner === 'none' || sp.owner === 'me' ? here({}) : here({ owner: undefined })
  // Cuántos filtros están puestos: lo dice el botón "Filtros" del teléfono.
  // "Sin movimiento en más de": en escritorio va bajo el encabezado; en el teléfono, dentro del botón Filtros.
  const quietForm = (suffix: '' | '-m') => (
    <form action={`/pipelines/${id}`} className="mb-4 flex w-full flex-wrap items-end gap-2" data-testid={`quiet-filter${suffix}`}>
      <label className="text-[14px] font-medium">{t('Sin movimiento en más de', 'No movement in more than')}
        <span className="mt-1 flex items-center gap-2">
          <input name="quietos" type="number" min={1} max={720} defaultValue={quietDays || 30} className="input !w-24" data-testid={`quiet-days${suffix}`} />
          <span className="text-[14px] font-normal text-muted">{t('días', 'days')}</span>
        </span>
      </label>
      <button className="press inline-flex h-11 items-center rounded-[10px] border border-line-2 bg-surface px-4 text-[15px] font-medium text-strong hover:bg-green-50" data-testid={`quiet-apply${suffix}`}>{t('Ver negocios quietos', 'Show quiet deals')}</button>
      {quietDays > 0 && <Link href={here({})} className="inline-flex min-h-11 items-center px-2 text-[14px] font-medium text-blue-text underline" data-testid={`quiet-clear${suffix}`}>{t('Volver al tablero', 'Back to the board')}</Link>}
    </form>
  )
  const activeFilters = [team, sp.owner, sp.paso === 'sin' || sp.paso === 'pausa' ? sp.paso : undefined, quietDays > 0 ? 'quietos' : undefined].filter(Boolean).length
  const seg = (on: boolean) => cx('press inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium', on ? 'bg-ink text-white' : 'text-strong hover:bg-green-50')

  const cols: BoardCol[] = stages.map((s, i) => {
    // Con "Sin próximo paso" o "En pausa" la columna cuenta y suma solo lo que muestra.
    const tot = board.shown ? (board.shown.find((x) => x.stage_id === s.id) ?? { n: 0, amount: null }) : total(s.id)
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
    // En una etapa de Operaciones manda el próximo paso de Operaciones: el de quien vende ya salió de su cancha.
    if (board.stages.find((s) => s.id === d.stage_id)?.is_ops) {
      if (d.ops_next_step && d.ops_next_step_due) return { text: `${d.ops_next_step} · ${d.ops_next_step_due === today ? m('complete.when.today').toLowerCase() : weekday(d.ops_next_step_due, locale)}`, tone: d.ops_next_step_due < today ? 'risk' : 'ok', title: d.ops_next_step }
      return d.ops_owner_name ? { text: t(`Con Operaciones: ${d.ops_owner_name}`, `With Operations: ${d.ops_owner_name}`), tone: 'neutral' } : { text: t('Con Operaciones: sin tomar', 'With Operations: not taken'), tone: 'warn' }
    }
    if (!d.next_step || !d.next_step_due) return { text: m('deals.chip.none'), tone: 'warn' }
    if (d.next_step_due < today) return { text: m('deals.chip.late', { step: d.next_step }), tone: 'risk', title: d.next_step }
    return { text: `${d.next_step} · ${d.next_step_due === today ? m('complete.when.today').toLowerCase() : weekday(d.next_step_due, locale)}`, tone: 'ok', title: d.next_step }
  }
  // Ganar a mano desde la tarjeta: solo si el embudo no cierra por transacción y a esta persona le toca
  // (lo que pasa por una etapa de Operaciones lo cierra Operaciones, nunca quien vendió).
  const wonStage = board.pipeline.close_by_transaction ? undefined : board.stages.find((s) => s.kind === 'won')
  const canOps = ctx.can('deal.ops', board.pipeline.market_code)
  const opsOnly = canOps && !ctx.can('deal.create', board.pipeline.market_code)
  const winTo = (d: (typeof board.deals)[number]): string | null => {
    if (!wonStage || !canMove) return null
    const pos = board.stages.find((s) => s.id === d.stage_id)?.position ?? 0
    const opsAhead = board.stages.some((s) => s.is_ops && s.position >= pos)
    // Quien solo opera gana lo que Ventas ya le entregó: en una etapa de Ventas no ve el botón.
    if (opsOnly && !board.stages.find((s) => s.id === d.stage_id)?.is_ops) return null
    return !opsAhead || (canOps && d.owner_id !== ctx.user.id) ? wonStage.id : null
  }
  const generic = (d: (typeof board.deals)[number]) => d.title.trim().toLowerCase() === d.account_name.trim().toLowerCase()
  const cards: BoardCard[] = board.deals.map((d) => ({
    title: generic(d) ? null : d.title, winTo: winTo(d),
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
            options={pipelines.map((p) => ({ href: qs(`/pipelines/${p.id}`, { owner: sp.owner, vista: sp.vista, paso: sp.paso, equipo: team }), label: `${ctx.markets.length > 1 ? `${p.market_code} · ` : ''}${p.name} (${p.open_deals})` }))} />
          <nav aria-label={m('deals.view')} className="inline-flex rounded-full border border-line bg-surface p-1 md:order-last">
            <Link href={here({ vista: undefined })} aria-current={!listView ? 'page' : undefined} className={seg(!listView)} data-testid="view-board">{m('deals.view.board')}</Link>
            <Link href={here({ vista: 'lista' })} aria-current={listView ? 'page' : undefined} className={seg(listView)} data-testid="view-list">{m('deals.view.list')}</Link>
          </nav>
          <FilterFold label={t('Filtros', 'Filters')} active={activeFilters}>
            {options && teams.length > 0 && (
              <NavSelect label={t('Equipo', 'Team')} value={here({})} testId="board-team"
                options={[{ href: here({ equipo: undefined }), label: t('Todos los equipos', 'All teams') }, ...teams.map((x) => ({ href: here({ equipo: x.id, owner: sp.owner === 'me' ? 'me' : undefined }), label: x.name })), { href: here({ equipo: 'none', owner: sp.owner === 'me' ? 'me' : undefined }), label: t('Sin equipo', 'No team') }]} />
            )}
            {personSelect && (
              <NavSelect label={t('Persona', 'Person')} value={personValue} testId="board-person"
                options={[{ href: here({ owner: undefined }), label: t('Todas las personas', 'Everyone') }, { href: here({ owner: 'me' }), label: m('merchants.scope.mine') }, ...people.filter(([pid]) => pid !== ctx.user.id).map(([pid, name]) => ({ href: here({ owner: pid }), label: name })), { href: here({ owner: 'none' }), label: t('Sin asignar', 'No owner') },
                  ...(isUuid(sp.owner) && sp.owner !== ctx.user.id && !people.some(([pid]) => pid === sp.owner) ? [{ href: here({}), label: t('La persona elegida', 'The chosen person') }] : [])]} />
            )}
            {!personSelect && <nav aria-label={m('deals.scope')} className="inline-flex rounded-full border border-line bg-surface p-1">
              <Link href={here({ owner: undefined })} aria-current={sp.owner !== 'me' ? 'page' : undefined} className={seg(sp.owner !== 'me')} data-testid="pill-all">{m('merchants.scope.all')}</Link>
              <Link href={here({ owner: 'me' })} aria-current={sp.owner === 'me' ? 'page' : undefined} className={seg(sp.owner === 'me')} data-testid="pill-me">{m('merchants.scope.mine')}</Link>
            </nav>}
            <nav aria-label={m('deals.filter')} className="inline-flex rounded-full border border-line bg-surface p-1">
              <Link href={here({ paso: undefined })} aria-current={sp.paso !== 'sin' && sp.paso !== 'pausa' ? 'page' : undefined} className={seg(sp.paso !== 'sin' && sp.paso !== 'pausa')} data-testid="filter-all">{m('deals.filter.all')}</Link>
              <Link href={here({ paso: 'sin' })} aria-current={sp.paso === 'sin' ? 'page' : undefined} className={seg(sp.paso === 'sin')} data-testid="filter-no-step">{m('deals.filter.noStep')}</Link>
              <Link href={here({ paso: 'pausa' })} aria-current={sp.paso === 'pausa' ? 'page' : undefined} className={seg(sp.paso === 'pausa')} data-testid="filter-paused">{t(`En pausa (${paused})`, `On hold (${paused})`)}</Link>
            </nav>
            {canBulk && <div className="w-full md:hidden">{quietForm('-m')}</div>}
          </FilterFold>
        </div>
      </header>

      {canBulk && <div className="hidden md:block">{quietForm('')}</div>}
      {quietDays > 0 && <p className="mb-3 md:hidden"><Link href={here({})} className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="quiet-back">{t('Volver al tablero', 'Back to the board')}</Link></p>}
      {quietDays > 0 ? (
        <div className="card overflow-hidden" data-testid="quiet-list">
          <p className="border-b border-line px-4 py-3 text-[14.5px] text-strong">
            {t(`${stale.length} ${stale.length === 1 ? 'negocio abierto lleva' : 'negocios abiertos llevan'} más de ${quietDays} días sin cambio de etapa ni actividad.`, `${stale.length} open ${stale.length === 1 ? 'deal has' : 'deals have'} gone more than ${quietDays} days with no stage change or activity.`)}
          </p>
          {stale.length > 0 && (
            <ActionForm action={bulkCloseAction} onOk="reset">
              <BulkPick
                labels={{ all: t('Elegir todos', 'Select all'), none: t('Quitar selección', 'Clear selection'), picked: t('%n elegidos', '%n selected'), pickedOne: t('1 elegido', '1 selected'), pick: t('Elegir este negocio', 'Select this deal') }}
                rows={stale.map((d) => ({
                  id: d.id,
                  node: (
                    <Link href={`/deals/${d.id}`} className="block py-1">
                      <span className="block truncate text-[15px] font-medium text-strong">{d.title}</span>
                      <span className="block truncate text-[13px] text-muted">{[d.account_name, d.owner_name ?? m('deals.noOwner'), t(d.stage_es, d.stage_en), t(`último movimiento: ${day(d.last_move, locale, market.timezone)}`, `last movement: ${day(d.last_move, locale, market.timezone)}`)].join(' · ')}</span>
                    </Link>
                  ),
                }))}
              >
                <div className="grid grid-cols-1 gap-3 border-t border-line px-4 py-4 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
                  <label className="text-[14px] font-medium">{t('Motivo de pérdida', 'Loss reason')}
                    <select name="reason" required defaultValue="" className="input mt-1.5" data-testid="bulk-reason">
                      <option value="">{t('Elige un motivo', 'Pick a reason')}</option>
                      {reasons.map((r) => <option key={r.code} value={r.code}>{t(r.label_es, r.label_en)}</option>)}
                    </select>
                  </label>
                  <label className="text-[14px] font-medium">{t('Nota (opcional)', 'Note (optional)')}
                    <input name="note" maxLength={300} className="input mt-1.5" data-testid="bulk-note" />
                  </label>
                  <Submit variant="danger" testId="bulk-close">{t('Cerrar como perdido', 'Close as lost')}</Submit>
                </div>
              </BulkPick>
            </ActionForm>
          )}
        </div>
      ) : listView ? (
        <>
        <nav aria-label={t('Orden de la lista', 'List order')} className="mb-3 inline-flex flex-wrap items-center gap-1 rounded-full border border-line bg-surface p-1" data-testid="list-order">
          <Link href={here({ orden: undefined })} aria-current={!order ? 'page' : undefined} className={seg(!order)} data-testid="order-stage">{t('Por etapa', 'By stage')}</Link>
          <Link href={here({ orden: 'monto' })} aria-current={order === 'monto' ? 'page' : undefined} className={seg(order === 'monto')} data-testid="order-amount">{t('Mayor monto', 'Largest amount')}</Link>
          <Link href={here({ orden: 'dias' })} aria-current={order === 'dias' ? 'page' : undefined} className={seg(order === 'dias')} data-testid="order-days">{t('Más días en la etapa', 'Most days in stage')}</Link>
        </nav>
        <div className="card @container overflow-hidden" data-testid="deal-list">
          <div aria-hidden className="hidden border-b border-line px-5 py-3 text-[13px] font-medium text-muted @2xl:grid @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_140px_minmax(0,1.4fr)] @2xl:gap-4">
            <span>{m('deals.col.deal')}</span><span>{m('deals.stage')}</span><span>{m('deals.col.amount')}</span><span>{m('deals.col.next')}</span>
          </div>
          <ul className="divide-y divide-line">
            {board.deals.length === 0 && <li className="px-5 py-10 text-center text-[15px] text-muted">{m('deals.empty')}</li>}
            {[...board.deals].sort((a, b) =>
              order === 'monto' ? Number(b.amount_minor ?? -1) - Number(a.amount_minor ?? -1)
              : order === 'dias' ? new Date(a.stage_entered_at).getTime() - new Date(b.stage_entered_at).getTime()
              : stages.findIndex((s) => s.id === a.stage_id) - stages.findIndex((s) => s.id === b.stage_id)).map((d) => {
              const c = chip(d)
              const st = stages.find((s) => s.id === d.stage_id)
              return (
                <li key={d.id} data-testid="deal-list-row">
                  <Link href={`/deals/${d.id}`} className="row-hover block px-4 py-3.5 @2xl:grid @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_140px_minmax(0,1.4fr)] @2xl:items-center @2xl:gap-4 @2xl:px-5">
                    <span className="block min-w-0">
                      <span className="block truncate text-[15px] font-medium text-strong">{d.account_name}</span>
                      <span className="block truncate text-[13px] text-muted">{[generic(d) ? null : d.title, d.owner_name ?? m('deals.noOwner'), m('deals.days', { count: daysSince(d.stage_entered_at, now) })].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="mt-1 block truncate text-[14px] text-strong @2xl:mt-0">{st ? t(st.name_es, st.name_en) : ''}</span>
                    <span className="num hidden text-[14px] text-strong @2xl:block">{d.amount_minor ? money(Number(d.amount_minor), d.currency, locale) : <NoData locale={locale} />}</span>
                    <span className="mt-1.5 block @2xl:mt-0">
                      <span className={cx('inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-[13px] font-medium', c.tone === 'warn' ? 'bg-warn-bg text-amber-text' : c.tone === 'risk' ? 'bg-risk-bg text-red-text' : 'bg-green-100 text-brand-text')}>{c.text}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
        </>
      ) : (
        <>
          <Board
            key={board.deals.map((d) => `${d.id}:${d.stage_id}:${d.next_step_due ?? ''}`).join('|')}
            id={id}
            cols={cols}
            cards={cards}
            minDate={today}
            action={boardMoveAction}
            ops={{ gateInfo: gateInfoAction, gateMove: gateMoveAction, win: winDealAction }}
            labels={{
              gate: {
                title: t('Para pasar a "%s" falta esto', 'To move to "%s" you still need this'), body: t('Llénalo aquí y %n avanza.', 'Fill it in here and %n moves on.'), save: t('Guardar y mover', 'Save and move'),
                amount: t(`Monto esperado (${market.currency})`, `Expected amount (${market.currency})`), nextStep: m('deals.next.step'), nextDue: m('deals.next.due'),
                decisionMaker: t('Quien decide', 'Decision-maker'), pick: t('Elige quién decide', 'Pick the decision-maker'), met: t('Ya hablé con quien decide', 'I have spoken with the decision-maker'),
                noContacts: t('Este comercio todavía no tiene contactos.', 'This merchant has no contacts yet.'), addContact: t('Agregar el contacto en la ficha', 'Add the contact on the merchant page'),
                items: t('Falta al menos una línea de producto.', 'It needs at least one product line.'), openDeal: t('Agregar líneas en el negocio', 'Add lines on the deal'),
                lang: locale, pickOne: t('Elige una opción', 'Pick an option'),
              },
              win: {
                button: t('Marcar como ganado', 'Mark as won'), title: t('Marcar como ganado: %s', 'Mark as won: %s'),
                rule: t('En el piloto se gana a mano; cuando llegue la primera transacción se confirmará sola.', 'During the pilot a deal is won by hand; when the first transaction arrives it will be confirmed on its own.'),
                date: t('Fecha real de cierre', 'Actual close date'), hint: t('Hoy o un día anterior, nunca futura.', 'Today or an earlier day, never in the future.'), confirm: t('Marcar como ganado', 'Mark as won'),
                needs: t('Para ganarlo falta %s.', 'To win it you still need to %s.'), and: t('y', 'and'),
                plain: Object.fromEntries(Object.entries(PLAIN_MISSING).map(([k, v]) => [k, t(v.es, v.en)])),
              },
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
