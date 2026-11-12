'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clock, Pause, Play, RotateCcw } from 'lucide-react'

export type DemoItem = { title: string; context: string; chip: string; tone: 'clock' | 'late' | 'today' | 'suggested' }
export type DemoLabels = {
  label: string
  tag: string
  screen: string
  pending: string
  pendingOne: string
  now: string
  later: string
  complete: string
  completeOf: string
  result: string
  next: string
  save: string
  cancel: string
  results: string[]
  nexts: string[]
  toast: string
  clock: string
  emptyTitle: string
  emptyText: string
  again: string
  pause: string
  play: string
  note: string
}

const CHIP = {
  clock: 'bg-warn-bg text-amber-text',
  late: 'bg-risk-bg text-red-text',
  today: 'bg-surface-3 text-strong',
  suggested: 'bg-green-100 text-brand-text',
} as const

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const START_CLOCK = 11 * 60 + 42

/**
 * Demo de la cola de Hoy para la entrada: comercios inventados, nada se guarda.
 * Quien visita toca "Completar", dice cómo le fue, deja el próximo paso y ve el aviso.
 * Si nadie la toca, se anima sola; al primer toque o tecla, la persona toma el control. Se puede pausar.
 */
export function HoyDemo({ items, labels }: { items: DemoItem[]; labels: DemoLabels }) {
  const all = items.map((_, i) => i)
  const [queue, setQueue] = useState<number[]>(all)
  const [sheet, setSheet] = useState<number | null>(null)
  const [result, setResult] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [leaving, setLeaving] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [mode, setMode] = useState<'auto' | 'user' | 'paused'>('paused')
  const [phase, setPhase] = useState(0)
  const [tap, setTap] = useState<string | null>(null)
  const [secs, setSecs] = useState(START_CLOCK)
  const [seen, setSeen] = useState(false)
  const [round, setRound] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const focusNext = useRef<'sheet' | 'head' | null>(null)
  const live = useRef({ queue, sheet, next })
  useEffect(() => {
    live.current = { queue, sheet, next }
  })

  // Arranca sola cuando entra en pantalla, salvo que la persona prefiera menos movimiento.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let started = false
    const io = new IntersectionObserver(([e]) => {
      setSeen(Boolean(e?.isIntersecting))
      if (e?.isIntersecting && !calm && !started) {
        started = true
        setMode('auto')
      }
    }, { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // El reloj del lead corre mientras la demo está viva.
  useEffect(() => {
    if (mode === 'paused' || !seen) return
    const id = window.setInterval(() => setSecs((s) => (s > 1 ? s - 1 : START_CLOCK)), 1000)
    return () => window.clearInterval(id)
  }, [mode, seen])

  const open = useCallback((i: number) => {
    setToast(null)
    setResult(0)
    setNext(null)
    setSheet(i)
  }, [])

  const reset = useCallback(() => {
    setQueue(items.map((_, i) => i))
    setSheet(null)
    setToast(null)
    setLeaving(null)
    setSecs(START_CLOCK)
  }, [items])

  const save = useCallback(() => {
    const { sheet: i, next: n } = live.current
    if (i === null || n === null) return
    setSheet(null)
    setLeaving(i)
    setToast(labels.toast.replace('{next}', labels.nexts[n] ?? ''))
    window.setTimeout(() => {
      setQueue((q) => q.filter((x) => x !== i))
      setLeaving(null)
    }, 380)
  }, [labels])

  // Se anima sola: una fase a la vez, con pausas para que se alcance a leer.
  useEffect(() => {
    if (mode !== 'auto' || !seen) return
    const head = live.current.queue[0]
    const steps: [number, () => void][] = [
      [1700, () => { if (head === undefined) { reset(); setPhase(0) } else { setTap('complete'); setPhase(1) } }],
      [620, () => { setTap(null); if (head !== undefined) open(head); setPhase(2) }],
      [950, () => { setTap('r0'); setResult(0); setPhase(3) }],
      [950, () => { setTap(`n${round % labels.nexts.length}`); setNext(round % labels.nexts.length); setPhase(4) }],
      [1050, () => { setTap('save'); setPhase(5) }],
      [520, () => { setTap(null); save(); setRound((r) => r + 1); setPhase(6) }],
      [2700, () => { setToast(null); setPhase(live.current.queue.length ? 0 : 7) }],
      [2600, () => { reset(); setPhase(0) }],
    ]
    const [ms, run] = steps[phase] ?? steps[0]!
    const id = window.setTimeout(run, ms)
    return () => window.clearTimeout(id)
  }, [mode, phase, seen, round, open, save, reset, labels.nexts.length])

  // En cuanto la persona toca o usa el teclado, la demo es suya.
  const takeOver = () => {
    if (mode !== 'auto') return
    setMode('user')
    setTap(null)
    setPhase(0)
  }

  // El aviso se va solo cuando la persona lleva el control.
  useEffect(() => {
    if (mode !== 'user' || !toast) return
    const id = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(id)
  }, [mode, toast])

  // Foco: al abrir la hoja, a su primera opción; al guardar, al siguiente pendiente.
  useEffect(() => {
    const want = focusNext.current
    if (!want || !root.current) return
    if (want === 'sheet' && sheet !== null) {
      root.current.querySelector<HTMLElement>('[data-demo-sheet] button')?.focus()
      focusNext.current = null
    } else if (want === 'head' && sheet === null && leaving === null) {
      root.current.querySelector<HTMLElement>('[data-demo-head]')?.focus()
      focusNext.current = null
    }
  }, [sheet, leaving, queue])

  const userOpen = (i: number) => {
    focusNext.current = 'sheet'
    open(i)
  }
  const userSave = () => {
    focusNext.current = 'head'
    save()
  }
  const userCancel = () => {
    focusNext.current = 'head'
    setSheet(null)
  }

  const head = queue[0]
  const rest = queue.slice(1)
  const count = queue.length
  const current = sheet !== null ? items[sheet] : null
  const choice = 'sc-demo-choice inline-flex min-h-[44px] items-center rounded-full border border-black-line bg-graphite px-4 text-[13.5px] font-medium text-white'

  return (
    <div ref={root} className="mx-auto w-full max-w-[348px]" onPointerDownCapture={takeOver} onKeyDownCapture={takeOver} data-testid="landing-demo" data-mode={mode}>
      <div className="sc-phone">
        <section aria-label={labels.label} className="sc-phone-screen flex h-[620px] flex-col text-fg">
          <div className="px-5 pt-14 pb-3">
            <p className="text-[12.5px] text-muted">{labels.screen}</p>
            <p className="num text-[24px] leading-8 font-semibold text-strong" data-testid="demo-count">
              {count === 0 ? labels.emptyTitle : count === 1 ? labels.pendingOne : labels.pending.replace('{n}', String(count))}
            </p>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden px-4 pb-4">
            {head === undefined ? (
              <div className="flex h-full flex-col items-center justify-center px-4 pb-10 text-center" data-testid="demo-empty">
                <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[#3ddc97] text-[#04130d] shadow-[var(--cg-glow-active)]">
                  <Check size={34} strokeWidth={2.5} aria-hidden />
                </span>
                <p className="mt-5 text-[15px] leading-6 text-muted-2">{labels.emptyText}</p>
                <button type="button" onClick={reset} data-demo-head data-tap={tap === 'again' ? '' : undefined} className="press mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-ink px-5 text-[14px] font-semibold text-white" data-testid="demo-again">
                  <RotateCcw size={16} strokeWidth={2} aria-hidden />
                  {labels.again}
                </button>
              </div>
            ) : (
              <>
                <div key={head} className="sc-demo-now sc-demo-row stage on-ink rounded-[18px] p-4" data-leaving={leaving === head ? '' : undefined}>
                  <p className="text-[12.5px] font-medium text-mint">{labels.now}</p>
                  <p className="mt-0.5 text-[16.5px] leading-6 font-semibold text-white">{items[head]!.title}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-[#c5d2cc]">{items[head]!.context}</p>
                  {items[head]!.tone === 'clock' && (
                    <p className="num mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[#fdf3e1] px-3 py-1 text-[12.5px] font-medium text-[#9a6200]">
                      <Clock size={13} strokeWidth={2} aria-hidden />
                      {labels.clock.replace('{time}', mmss(secs))}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => userOpen(head)}
                    data-demo-head
                    data-tap={tap === 'complete' ? '' : undefined}
                    className="press glow-hover mt-3.5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[10px] bg-neon px-4 text-[14.5px] font-semibold text-black"
                    data-testid="demo-complete"
                  >
                    <Check size={17} strokeWidth={2.5} aria-hidden />
                    {labels.complete}
                  </button>
                </div>

                {rest.length > 0 && <p className="mt-4 mb-2 px-1 text-[13px] font-medium text-strong">{labels.later}</p>}
                <ul className="card divide-y divide-line overflow-hidden">
                  {rest.map((i) => (
                    <li key={i} className="sc-demo-row flex items-center gap-2 py-1.5 pr-3 pl-1.5" data-leaving={leaving === i ? '' : undefined}>
                      <button type="button" onClick={() => userOpen(i)} aria-label={labels.completeOf.replace('{title}', items[i]!.title)} className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full" data-testid="demo-row-complete">
                        <span className="sc-demo-check q-check grid h-[26px] w-[26px] place-items-center rounded-full border-2 border-line-2">
                          <Check size={14} strokeWidth={3} aria-hidden />
                        </span>
                      </button>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] leading-5 font-medium text-strong">{items[i]!.title}</span>
                        <span className={`mt-0.5 inline-flex rounded-full px-2 py-px text-[11.5px] font-medium ${CHIP[items[i]!.tone]}`}>{items[i]!.chip}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {current && (
              <div data-demo-sheet role="group" aria-label={`${labels.complete}: ${current.title}`} className="sc-demo-sheet on-ink absolute inset-x-0 bottom-0 z-10 rounded-t-[24px] border-t border-[#3ddc97]/30 bg-black px-5 pt-3 pb-5 shadow-[0_-20px_50px_rgba(0,0,0,0.35)]" data-testid="demo-sheet">
                <span aria-hidden className="mx-auto block h-1 w-9 rounded-full bg-white/25" />
                <p className="mt-3 text-[12px] text-on-black">{labels.complete}</p>
                <p className="text-[15.5px] leading-[22px] font-semibold text-white">{current.title}</p>
                <p className="mt-3.5 text-[13px] font-medium text-white" id="demo-result">{labels.result}</p>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="demo-result">
                  {labels.results.map((r, k) => (
                    <button key={r} type="button" aria-pressed={result === k} onClick={() => setResult(k)} data-tap={tap === `r${k}` ? '' : undefined} className={choice} data-testid="demo-result">
                      {r}
                    </button>
                  ))}
                </div>
                <p className="mt-3.5 text-[13px] font-medium text-white" id="demo-next">{labels.next}</p>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="demo-next">
                  {labels.nexts.map((n, k) => (
                    <button key={n} type="button" aria-pressed={next === k} onClick={() => setNext(k)} data-tap={tap === `n${k}` ? '' : undefined} className={choice} data-testid="demo-next">
                      {n}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button type="button" onClick={userSave} disabled={next === null} data-tap={tap === 'save' ? '' : undefined} className="press inline-flex min-h-[46px] flex-1 items-center justify-center rounded-[10px] bg-neon px-4 text-[14.5px] font-semibold text-black disabled:bg-[#1c2420] disabled:text-[#9fb0a8]" data-testid="demo-save">
                    {labels.save}
                  </button>
                  <button type="button" onClick={userCancel} className="inline-flex min-h-[46px] items-center rounded-[10px] px-3 text-[13.5px] font-medium text-[#c5d2cc] hover:text-white" data-testid="demo-cancel">
                    {labels.cancel}
                  </button>
                </div>
              </div>
            )}

            <div aria-live={mode === 'user' ? 'polite' : 'off'} className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center">
              {toast && (
                <p className="sc-demo-toast toast rounded-[12px] px-4 py-2.5 text-center text-[13.5px] leading-5 font-medium" data-testid="demo-toast">
                  {toast}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <p className="inline-flex items-center gap-2 rounded-full border border-[#3ddc97]/40 bg-[#3ddc97]/10 px-3.5 py-1.5 text-[13px] font-medium text-mint">
          <span aria-hidden className={`h-2 w-2 rounded-full bg-neon ${mode === 'auto' ? 'animate-pulse-soft' : ''}`} />
          {labels.tag}
        </p>
        <button
          type="button"
          onClick={() => { setTap(null); setPhase(0); setMode(mode === 'paused' ? 'auto' : 'paused') }}
          aria-label={mode === 'paused' ? labels.play : labels.pause}
          className="grid h-[44px] w-[44px] place-items-center rounded-full border border-white/20 text-white hover:bg-white/10"
          data-testid="demo-toggle"
        >
          {mode === 'paused' ? <Play size={16} strokeWidth={2} aria-hidden /> : <Pause size={16} strokeWidth={2} aria-hidden />}
        </button>
      </div>
      <p className="mt-1 text-center text-[12.5px] text-on-black">{labels.note}</p>
    </div>
  )
}
