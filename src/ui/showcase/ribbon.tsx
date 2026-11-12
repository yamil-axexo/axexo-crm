'use client'
import { useState } from 'react'
import { Check, Pause, Play } from 'lucide-react'

/** Cinta con lo que ya funciona. Se detiene con el botón; con prefers-reduced-motion queda fija y completa. */
export function Ribbon({ items, labels }: { items: string[]; labels: { label: string; pause: string; play: string } }) {
  const [paused, setPaused] = useState(false)
  const row = (dup: boolean) =>
    items.map((it) => (
      <li key={`${dup}-${it}`} data-dup={dup ? '' : undefined} aria-hidden={dup || undefined} className="mr-3 inline-flex shrink-0 items-center gap-2.5 rounded-full border border-white/12 bg-white/[0.04] py-2 pr-5 pl-2.5 text-[14.5px] font-medium whitespace-nowrap text-white">
        <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-[#3ddc97] text-[#04130d]">
          <Check size={14} strokeWidth={3} />
        </span>
        {it}
      </li>
    ))
  return (
    <div className="flex items-center gap-3" data-testid="landing-ribbon">
      <div className="sc-ribbon-mask min-w-0 flex-1">
        <ul aria-label={labels.label} className="sc-ribbon" data-paused={paused ? '' : undefined}>
          {row(false)}
          {row(true)}
        </ul>
      </div>
      <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? labels.play : labels.pause} className="mr-4 grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full border border-white/20 text-white hover:bg-white/10 motion-reduce:hidden" data-testid="ribbon-toggle">
        {paused ? <Play size={15} strokeWidth={2} aria-hidden /> : <Pause size={15} strokeWidth={2} aria-hidden />}
      </button>
    </div>
  )
}
