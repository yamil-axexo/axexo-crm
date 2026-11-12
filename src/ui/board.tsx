'use client'

import { useRef, useState, useSyncExternalStore, useTransition, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cx } from '@/ui/kit'
import { offlineBlocked, showToast } from '@/ui/complete'
import type { ActionResult } from '@/lib/errors'
import { GateFields, type GateLabels } from '@/ui/ops'
import type { GateInfo } from '@/dal/ops'

export type BoardCol = { id: string; code: string; name: string; color: string; count: number; amount: string | null; note: string | null; more: string | null }
export type BoardCard = {
  id: string
  stageId: string
  name: string
  sub: string
  chip: { text: string; tone: 'ok' | 'warn' | 'risk' | 'neutral'; title?: string }
  extra: string | null
  href: string
  canMove: boolean
  /** Título del negocio, cuando dice algo distinto del nombre del comercio. */
  title?: string | null
  /** Etapa "ganado" a la que esta persona puede llevarlo a mano; nulo si no le toca o el embudo cierra por transacción. */
  winTo?: string | null
}
export type BoardLabels = { stages: string; stage: string; moveTo: string; moved: string; empty: string; nextTitle: string; nextBody: string; nextStep: string; nextDue: string; nextSave: string; cancel: string; gate: GateLabels; win: { button: string; title: string; rule: string; date: string; hint: string; confirm: string; needs: string; and: string; plain: Record<string, string> } }
type MoveAction = (prev: ActionResult<unknown> | null, data: FormData) => Promise<ActionResult<unknown>>
export type BoardOps = { gateInfo: (dealId: string, stageId: string) => Promise<GateInfo | null>; gateMove: MoveAction; win: MoveAction }

const CHIP = { ok: 'bg-green-100 text-brand-text', warn: 'bg-warn-bg text-amber-text', risk: 'bg-risk-bg text-red-text', neutral: 'bg-surface-3 text-strong' } as const
const DESKTOP = '(min-width: 1200px) and (pointer: fine)'
/** La etapa que la persona estaba viendo en móvil, por tablero: mover una tarjeta refresca el tablero y no debe perder el lugar. */
const lastActive = new Map<string, string>()
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(DESKTOP)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/**
 * Tablero de Negocios (handoff, sección 5). Arrastre solo en desktop con mouse; en tablet y móvil cada tarjeta trae
 * un selector de etapa. Si al negocio le falta el próximo paso, mover lo pide antes de guardar.
 */
export function Board({ id, cols, cards: initial, labels, minDate, action, ops }: { id: string; cols: BoardCol[]; cards: BoardCard[]; labels: BoardLabels; minDate: string; action: MoveAction; ops: BoardOps }) {
  const router = useRouter()
  const drag = useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP).matches, () => false)
  const [cards, setCards] = useState(initial)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [active, setActiveState] = useState(() => (cols.some((c) => c.id === lastActive.get(id)) ? lastActive.get(id)! : (cols.find((c) => c.count > 0)?.id ?? cols[0]?.id ?? '')))
  const setActive = (stage: string) => {
    lastActive.set(id, stage)
    setActiveState(stage)
  }
  const [ask, setAsk] = useState<{ card: BoardCard; to: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dialog = useRef<HTMLDialogElement>(null)
  const gateDialog = useRef<HTMLDialogElement>(null)
  const winDialog = useRef<HTMLDialogElement>(null)
  const [gate, setGate] = useState<{ card: BoardCard; to: string; info: GateInfo } | null>(null)
  const [win, setWin] = useState<BoardCard | null>(null)
  // Lo que falta para ganar (quien decide, monto): la hoja lo pide ahí mismo, igual que el cambio de etapa.
  const [winInfo, setWinInfo] = useState<GateInfo | null>(null)
  const openWin = (card: BoardCard) => {
    setError(null)
    setWinInfo(null)
    setWin(card)
    winDialog.current?.showModal()
    if (card.winTo) void ops.gateInfo(card.id, card.winTo).then((info) => setWinInfo(info && info.missing.length > 0 ? info : null), () => {})
  }
  const winNeeds = (info: GateInfo) => {
    const fieldName = (k: string) => { const f = (info.fields ?? []).find((x) => x.ref === k); return f ? (labels.gate.lang === 'en' ? f.label_en : f.label_es) : k }
    const parts = info.missing.map((k) => labels.win.plain[k] ?? fieldName(k))
    return labels.win.needs.replace('%s', parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} ${labels.win.and} ${parts[parts.length - 1]}`)
  }
  const stageName = (id: string) => cols.find((c) => c.id === id)?.name ?? ''

  const move = (card: BoardCard, to: string, next?: { step: string; due: string }) => {
    if (to === card.stageId || offlineBlocked()) return
    const from = card.stageId
    setCards((list) => list.map((c) => (c.id === card.id ? { ...c, stageId: to } : c)))
    startTransition(async () => {
      const data = new FormData()
      data.set('deal_id', card.id)
      data.set('stage_id', to)
      if (next) {
        data.set('next_step', next.step)
        data.set('next_step_due', next.due)
      }
      const res = await action(null, data)
      if (res.ok) {
        dialog.current?.close()
        showToast(labels.moved.replace('%n', card.name).replace('%s', stageName(to)))
        router.refresh()
        return
      }
      setCards((list) => list.map((c) => (c.id === card.id ? { ...c, stageId: from } : c)))
      if (res.code === 'next_step_required' && !next) {
        setError(null)
        setAsk({ card, to })
        dialog.current?.showModal()
      } else if (res.code === 'stage_gate' && !next) {
        // El candado de etapa se resuelve aquí mismo: una hoja con lo que falta, sin mandar a otra pantalla.
        const info = await ops.gateInfo(card.id, to)
        if (info && info.missing.length > 0) {
          setError(null)
          setGate({ card, to, info })
          gateDialog.current?.showModal()
        } else showToast(res.error)
      } else if (next) setError(res.error)
      else showToast(res.error)
    })
  }

  const submitExtra = (e: FormEvent<HTMLFormElement>, run: MoveAction, ref: { current: HTMLDialogElement | null }, card: BoardCard, to: string) => {
    e.preventDefault()
    if (offlineBlocked()) return
    const data = new FormData(e.currentTarget)
    data.set('deal_id', card.id)
    data.set('stage_id', to)
    startTransition(async () => {
      const res = await run(null, data)
      if (res.ok) {
        ref.current?.close()
        // Ganar dice su propio aviso ("Negocio ganado, con cierre el ..."), no "pasó a ...".
        showToast(run === ops.win && res.message ? `${card.name}: ${res.message}` : labels.moved.replace('%n', card.name).replace('%s', stageName(to)))
        router.refresh()
      } else {
        setError(res.error)
        // Si al ganar todavía falta algo, la hoja lo muestra para completarlo sin salir.
        if (run === ops.win && res.code === 'stage_gate') void ops.gateInfo(card.id, to).then((info) => setWinInfo(info && info.missing.length > 0 ? info : null), () => {})
      }
    })
  }

  const submitNext = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!ask) return
    const data = new FormData(e.currentTarget)
    move(ask.card, ask.to, { step: String(data.get('next_step') ?? ''), due: String(data.get('next_step_due') ?? '') })
  }

  return (
    <>
      <nav aria-label={labels.stages} className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden" data-testid="stage-nav">
        {cols.map((c) => (
          <button key={c.id} type="button" onClick={() => setActive(c.id)} aria-pressed={active === c.id} className={cx('press inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-medium', active === c.id ? 'bg-ink text-white' : 'border border-line bg-surface text-strong')} data-testid={`stage-tab-${c.code}`}>
            {c.name}
            <span className={cx('num text-[13px]', active === c.id ? 'text-on-black' : 'text-muted')}>{c.count}</span>
          </button>
        ))}
      </nav>

      <div className="flex gap-3 md:-mx-2 md:overflow-x-auto md:px-2 md:pb-4" data-testid="board">
        {cols.map((col) => {
          const list = cards.filter((c) => c.stageId === col.id)
          return (
            <section
              key={col.id}
              aria-label={col.name}
              data-testid={`stage-${col.code}`}
              data-over={over === col.id ? '' : undefined}
              onDragOver={drag ? (e) => { e.preventDefault(); if (over !== col.id) setOver(col.id) } : undefined}
              onDragLeave={drag ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) } : undefined}
              onDrop={drag ? (e) => {
                e.preventDefault()
                setOver(null)
                const card = cards.find((c) => c.id === e.dataTransfer.getData('text/plain'))
                if (card) move(card, col.id)
              } : undefined}
              className={cx('board-col w-full min-w-0 flex-col overflow-hidden rounded-[16px] bg-surface-3 md:flex md:w-auto md:min-w-[220px] md:flex-1 md:basis-0', active === col.id ? 'flex' : 'hidden')}
            >
              <span aria-hidden className="block h-1.5 w-full" style={{ background: col.color }} />
              <header className="px-4 pt-3 pb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[15px] leading-6 font-semibold">{col.name}</h2>
                  <span className="num text-[13px] text-muted" data-testid={`stage-count-${col.code}`}>{col.count}</span>
                </div>
                <p className="num truncate text-[13px] text-muted">{col.amount ?? col.note ?? ' '}</p>
              </header>
              <ul className="flex min-h-[96px] flex-1 flex-col gap-2 px-2 pb-3">
                {list.map((card) => (
                  <li
                    key={card.id}
                    draggable={drag && card.canMove}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', card.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setDragging(card.id)
                    }}
                    onDragEnd={() => { setDragging(null); setOver(null) }}
                    data-dragging={dragging === card.id ? '' : undefined}
                    data-warn={card.chip.tone === 'warn' ? '' : undefined}
                    data-card={card.id}
                    className={cx('board-card relative rounded-[12px] border bg-surface p-3', card.chip.tone === 'warn' ? 'border-[#f0d9a8]' : 'border-line', drag && card.canMove && 'cursor-grab')}
                  >
                    <Link href={card.href} draggable={false} className="block text-[15px] leading-[22px] font-medium text-strong after:absolute after:inset-0 after:rounded-[12px]" data-testid="deal-card">{card.name}</Link>
                    {card.title && <p className="mt-0.5 truncate text-[13.5px] text-strong" data-testid="deal-card-title">{card.title}</p>}
                    <p className="num mt-0.5 truncate text-[13px] text-muted">{card.sub}</p>
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      <span title={card.chip.title} className={cx('inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-[13px] font-medium', CHIP[card.chip.tone])} data-testid="deal-chip">{card.chip.text}</span>
                      {card.extra && <span className={cx('inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-medium', CHIP.warn)}>{card.extra}</span>}
                    </p>
                    {card.canMove && (
                      <label className="board-select relative z-10 mt-3">
                        <span className="sr-only">{labels.moveTo.replace('%s', card.name)}</span>
                        <select value={card.stageId} disabled={pending} onChange={(e) => move(card, e.target.value)} className="input !h-11 !text-[14px]" data-testid="deal-stage-select">
                          {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </label>
                    )}
                    {card.winTo && (
                      <button type="button" disabled={pending} onClick={() => openWin(card)} className="press relative z-10 mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-[10px] border border-line-2 bg-surface px-3 text-[14px] font-semibold text-brand-text hover:bg-green-50" data-testid="deal-card-win">{labels.win.button}</button>
                    )}
                  </li>
                ))}
                {list.length === 0 && <li className="flex flex-1 items-center justify-center rounded-[12px] border border-dashed border-line-2 px-3 py-6 text-center text-[13px] text-muted">{labels.empty}</li>}
                {col.more && <li className="px-1 text-[13px] text-muted">{col.more}</li>}
              </ul>
            </section>
          )
        })}
      </div>

      <dialog ref={dialog} aria-labelledby="next-title" onClose={() => setAsk(null)} onClick={(e) => { if (e.target === dialog.current) dialog.current?.close() }} className="m-auto w-[min(480px,92vw)] rounded-[16px] border border-line bg-surface p-0 text-fg shadow-[var(--cg-shadow-float)] backdrop:bg-black/40" data-testid="next-dialog">
        {ask && (
          <form onSubmit={submitNext} className="p-6 md:p-8">
            <h2 id="next-title" className="text-[18px] leading-[26px] font-semibold">{labels.nextTitle.replace('%s', ask.card.name)}</h2>
            <p className="mt-1 text-[14px] text-muted">{labels.nextBody}</p>
            <label className="mt-5 block text-[14px] font-medium">{labels.nextStep}
              <input name="next_step" required minLength={2} maxLength={200} className="input mt-1.5" data-testid="next-dialog-step" />
            </label>
            <label className="mt-4 block text-[14px] font-medium">{labels.nextDue}
              <input name="next_step_due" type="date" required min={minDate} defaultValue={minDate} className="input mt-1.5" data-testid="next-dialog-due" />
            </label>
            {error && <p role="alert" className="mt-4 rounded-[10px] bg-risk-bg px-4 py-3 text-[14px] font-medium text-red-text">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => dialog.current?.close()} className="press inline-flex h-11 items-center rounded-[10px] px-4 text-[15px] font-medium text-strong hover:bg-green-50">{labels.cancel}</button>
              <button type="submit" disabled={pending} aria-busy={pending} className="press grad-bg inline-flex h-11 items-center rounded-[10px] px-5 text-[15px] font-semibold text-on-sun disabled:opacity-60" data-testid="next-dialog-save">{labels.nextSave}</button>
            </div>
          </form>
        )}
      </dialog>

      <dialog ref={gateDialog} aria-labelledby="gate-title" onClose={() => setGate(null)} onClick={(e) => { if (e.target === gateDialog.current) gateDialog.current?.close() }} className="m-auto w-[min(480px,92vw)] rounded-[16px] border border-line bg-surface p-0 text-fg shadow-[var(--cg-shadow-float)] backdrop:bg-black/40" data-testid="gate-dialog">
        {gate && (
          <form onSubmit={(e) => submitExtra(e, ops.gateMove, gateDialog, gate.card, gate.to)} className="p-6 md:p-8">
            <h2 id="gate-title" className="text-[18px] leading-[26px] font-semibold">{labels.gate.title.replace('%s', stageName(gate.to))}</h2>
            <p className="mt-1 text-[14px] text-muted">{labels.gate.body.replace('%n', gate.card.name)}</p>
            <GateFields info={gate.info} labels={labels.gate} minDate={minDate} dealHref={gate.card.href} />
            {error && <p role="alert" className="mt-4 rounded-[10px] bg-risk-bg px-4 py-3 text-[14px] font-medium text-red-text" data-testid="gate-error">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => gateDialog.current?.close()} className="press inline-flex h-11 items-center rounded-[10px] px-4 text-[15px] font-medium text-strong hover:bg-green-50">{labels.cancel}</button>
              <button type="submit" disabled={pending} aria-busy={pending} className="press grad-bg inline-flex h-11 items-center rounded-[10px] px-5 text-[15px] font-semibold text-on-sun disabled:opacity-60" data-testid="gate-save">{labels.gate.save}</button>
            </div>
          </form>
        )}
      </dialog>

      <dialog ref={winDialog} aria-labelledby="win-title" onClose={() => { setWin(null); setWinInfo(null) }} onClick={(e) => { if (e.target === winDialog.current) winDialog.current?.close() }} className="m-auto w-[min(480px,92vw)] rounded-[16px] border border-line bg-surface p-0 text-fg shadow-[var(--cg-shadow-float)] backdrop:bg-black/40" data-testid="win-dialog">
        {win && win.winTo && (
          <form onSubmit={(e) => submitExtra(e, ops.win, winDialog, win, win.winTo!)} className="p-6 md:p-8">
            <h2 id="win-title" className="text-[18px] leading-[26px] font-semibold">{labels.win.title.replace('%s', win.title ?? win.name)}</h2>
            <p className="mt-3 rounded-[10px] bg-surface-2 px-4 py-3 text-[14px] text-muted-2" data-testid="win-rule">{labels.win.rule}</p>
            <label className="mt-5 block text-[14px] font-medium">{labels.win.date}
              <input name="won_on" type="date" required max={minDate} defaultValue={minDate} className="input mt-1.5" data-testid="win-date" />
              <span className="mt-1 block text-[13px] font-normal text-muted">{labels.win.hint}</span>
            </label>
            {winInfo && (
              <div className="mt-5 border-t border-line pt-1" data-testid="win-gate">
                <p className="mt-4 text-[14px] font-medium text-strong" data-testid="win-needs">{winNeeds(winInfo)}</p>
                <GateFields info={winInfo} labels={labels.gate} minDate={minDate} dealHref={win.href} />
              </div>
            )}
            {error && !winInfo && <p role="alert" className="mt-4 rounded-[10px] bg-risk-bg px-4 py-3 text-[14px] font-medium text-red-text" data-testid="win-error">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => winDialog.current?.close()} className="press inline-flex h-11 items-center rounded-[10px] px-4 text-[15px] font-medium text-strong hover:bg-green-50">{labels.cancel}</button>
              <button type="submit" disabled={pending} aria-busy={pending} className="press grad-bg inline-flex h-11 items-center rounded-[10px] px-5 text-[15px] font-semibold text-on-sun disabled:opacity-60" data-testid="win-confirm">{labels.win.confirm}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  )
}

/**
 * Filtros del tablero. En computadora y tableta van a la vista; en el teléfono se guardan detrás de un botón "Filtros"
 * que dice cuántos están puestos, para que el encabezado no empuje las tarjetas fuera de la pantalla.
 */
export function FilterFold({ label, active, children }: { label: string; active: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls="board-filter-fold" onClick={() => setOpen((v) => !v)}
        className={cx('press inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-medium md:hidden', open || active ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-strong')} data-testid="board-filters">
        {label}{active > 0 && <span className="num" data-testid="board-filters-count">({active})</span>}
      </button>
      <div id="board-filter-fold" className={cx(open ? 'flex' : 'hidden', 'w-full flex-wrap items-center gap-2 md:flex md:w-auto')} data-testid="board-filter-fold">{children}</div>
    </>
  )
}

/** Selector que navega al elegir (pipeline). Las opciones son enlaces: el estado vive en la URL. */
export function NavSelect({ label, value, options, testId }: { label: string; value: string; options: { href: string; label: string }[]; testId?: string }) {
  const router = useRouter()
  return (
    <select aria-label={label} value={value} onChange={(e) => router.push(e.target.value)} className="input !w-auto max-w-full !pr-9 font-medium" data-testid={testId}>
      {options.map((o) => <option key={o.href} value={o.href}>{o.label}</option>)}
    </select>
  )
}
