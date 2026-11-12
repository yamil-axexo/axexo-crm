'use client'
import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import type { Shot } from '@/content/guide'
import { Browser, Phone } from '@/ui/showcase/frames'

export type TourScreen = { shot: Shot; label: string; caption: string }
const MS = 6500

/**
 * Recorrido por el producto con capturas reales: pestañas que se operan con teclado (flechas, Inicio, Fin)
 * y que avanzan solas mientras nadie las toca. Se pausa con el botón, al pasar el cursor o al enfocar,
 * y no avanza sola con prefers-reduced-motion.
 */
export function ProductTour({ screens, lang, labels }: { screens: TourScreen[]; lang: 'es' | 'en'; labels: { tabs: string; pause: string; play: string } }) {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(false)
  const [hold, setHold] = useState(false)
  const [seen, setSeen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let started = false
    const io = new IntersectionObserver(([e]) => {
      setSeen(Boolean(e?.isIntersecting))
      if (e?.isIntersecting && !calm && !started) {
        started = true
        setAuto(true)
      }
    }, { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const running = auto && seen
  const go = (i: number, focus = false) => {
    const n = (i + screens.length) % screens.length
    setActive(n)
    if (focus) tabs.current[n]?.focus()
  }
  const onKey = (e: React.KeyboardEvent) => {
    const move: Record<string, number> = { ArrowRight: active + 1, ArrowDown: active + 1, ArrowLeft: active - 1, ArrowUp: active - 1, Home: 0, End: screens.length - 1 }
    if (!(e.key in move)) return
    e.preventDefault()
    setAuto(false)
    go(move[e.key]!, true)
  }

  return (
    <div ref={root} data-testid="landing-tour" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)} onFocusCapture={() => setHold(true)} onBlurCapture={() => setHold(false)}>
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label={labels.tabs} onKeyDown={onKey} className="-mx-5 flex flex-1 gap-2 overflow-x-auto px-5 py-2 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
          {screens.map((s, i) => (
            <button
              key={s.shot}
              ref={(el) => { tabs.current[i] = el }}
              role="tab"
              type="button"
              id={`tour-tab-${s.shot}`}
              aria-selected={active === i}
              aria-controls={`tour-panel-${s.shot}`}
              tabIndex={active === i ? 0 : -1}
              onClick={() => { setAuto(false); go(i) }}
              className="sc-tab inline-flex min-h-[48px] shrink-0 items-center rounded-full border border-white/15 px-5 text-[14.5px] font-medium text-[#c5d2cc] hover:text-white"
              data-testid={`tour-tab-${s.shot}`}
            >
              {s.label}
              {active === i && (
                <span aria-hidden className="sc-tab-progress" data-run={running ? '' : undefined} data-hold={hold ? '' : undefined}>
                  <i key={`${i}-${running}`} onAnimationEnd={() => go(active + 1)} style={{ '--tour-ms': `${MS}ms` } as React.CSSProperties} />
                </span>
              )}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setAuto((a) => !a)} aria-label={auto ? labels.pause : labels.play} className="grid h-[48px] w-[48px] shrink-0 place-items-center rounded-full border border-white/20 text-white hover:bg-white/10" data-testid="tour-toggle">
          {auto ? <Pause size={17} strokeWidth={2} aria-hidden /> : <Play size={17} strokeWidth={2} aria-hidden />}
        </button>
      </div>

      <div className="relative mt-6">
        {screens.map((s, i) => (
          <div key={s.shot} role="tabpanel" id={`tour-panel-${s.shot}`} aria-labelledby={`tour-tab-${s.shot}`} className="sc-panel" data-active={active === i ? '' : undefined} data-testid={`tour-panel-${s.shot}`}>
            <p className="min-h-[56px] max-w-[52ch] text-[17px] leading-7 text-white md:text-[19px]">{s.caption}</p>
            <div className="sc-stage relative mt-6 md:pb-10 md:pl-[4%]" data-parallax="0.035">
              <Browser shot={s.shot} lang={lang} className="sc-stage-desk hidden md:block md:w-[86%] desk:w-[82%]" />
              <Phone shot={s.shot} lang={lang} sizes="(min-width: 768px) 230px, 270px" decorative className="sc-stage-phone mx-auto w-[270px] md:absolute md:right-0 md:bottom-0 md:mx-0 md:w-[200px] desk:w-[236px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
