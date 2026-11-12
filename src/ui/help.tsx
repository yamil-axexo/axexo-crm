'use client'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

export type HelpRow = { id: string; topic: string; topicLabel: string; q: string; a: string; mine: boolean }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** La ayuda: se filtra al escribir y se puede limitar a lo del rol de la persona. */
export function HelpList({ rows, labels }: { rows: HelpRow[]; labels: { search: string; mine: string; all: string; empty: string; count: string } }) {
  const [text, setText] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const shown = useMemo(() => {
    const words = norm(text).split(/\s+/).filter(Boolean)
    return rows.filter((r) => (!onlyMine || r.mine) && words.every((w) => norm(`${r.q} ${r.a} ${r.topicLabel}`).includes(w)))
  }, [rows, text, onlyMine])
  const topics = [...new Map(shown.map((r) => [r.topic, r.topicLabel])).entries()]
  const pill = (on: boolean) => `press inline-flex h-11 items-center rounded-full px-4 text-[14px] font-medium ${on ? 'bg-ink text-white' : 'border border-line-2 text-strong hover:bg-green-50'}`

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">{labels.search}</span>
          <Search size={18} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={labels.search} className="input h-12 w-full !pl-11" data-testid="help-search" />
        </label>
        <div className="flex gap-2" role="group" aria-label={labels.mine}>
          <button type="button" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)} className={pill(!onlyMine)} data-testid="help-all">{labels.all}</button>
          <button type="button" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)} className={pill(onlyMine)} data-testid="help-mine">{labels.mine}</button>
        </div>
      </div>
      <p className="mt-4 text-[13.5px] text-muted" aria-live="polite" data-testid="help-count">{labels.count.replace('{n}', String(shown.length))}</p>
      {shown.length === 0 && <p className="mt-6 rounded-2xl bg-surface-2 p-6 text-[15px] text-muted-2" data-testid="help-empty">{labels.empty}</p>}
      {topics.map(([topic, label]) => (
        <section key={topic} className="mt-8" data-testid={`help-topic-${topic}`}>
          <h2 className="text-[18px] font-semibold text-strong">{label}</h2>
          <div className="card mt-3 divide-y divide-line px-5">
            {shown.filter((r) => r.topic === topic).map((r) => (
              <details key={r.id} className="group" data-testid="help-item">
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-4 py-3 text-[15.5px] font-semibold text-strong [&::-webkit-details-marker]:hidden">
                  <span className="flex-1">{r.q}</span>
                  <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-2 text-[17px] leading-none text-blue-text group-open:rotate-45">+</span>
                </summary>
                <p className="pr-10 pb-5 text-[14.5px] leading-7 text-muted-2">{r.a}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
