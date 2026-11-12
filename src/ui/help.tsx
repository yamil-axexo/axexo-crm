'use client'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Database, Flag, Inbox, Kanban, KeyRound, Search, Settings, Store, Sun, Users, X, type LucideIcon } from 'lucide-react'
import { EmptyArt, HelpArt } from '@/ui/showcase/art'

export type HelpRow = { id: string; topic: string; topicLabel: string; q: string; a: string; mine: boolean }
export type HelpLabels = { title: string; desc: string; search: string; mine: string; all: string; empty: string; emptyTitle: string; clear: string; count: string; topics: string }

const ICON: Record<string, LucideIcon> = { start: Flag, today: Sun, leads: Inbox, deals: Kanban, merchants: Store, team: Users, data: Database, access: KeyRound, admin: Settings }
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Resalta las palabras buscadas sin importar acentos ni mayúsculas. */
function mark(text: string, words: string[]): ReactNode {
  if (!words.length) return text
  const plain = norm(text)
  // norm conserva el largo salvo en letras con acento compuesto; se trabaja letra por letra para no desalinear.
  const map: number[] = []
  let flat = ''
  for (let i = 0; i < text.length; i++) {
    const n = norm(text[i]!)
    for (let k = 0; k < n.length; k++) map.push(i)
    flat += n
  }
  if (flat !== plain) return text
  const hits: [number, number][] = []
  for (const w of words) {
    let at = flat.indexOf(w)
    while (at !== -1) {
      hits.push([map[at]!, map[at + w.length - 1]! + 1])
      at = flat.indexOf(w, at + w.length)
    }
  }
  if (!hits.length) return text
  hits.sort((a, b) => a[0] - b[0])
  const out: ReactNode[] = []
  let pos = 0
  for (const [a, b] of hits) {
    if (a < pos) continue
    if (a > pos) out.push(<Fragment key={`t${pos}`}>{text.slice(pos, a)}</Fragment>)
    out.push(<mark key={`m${a}`} className="sc-mark">{text.slice(a, b)}</mark>)
    pos = b
  }
  if (pos < text.length) out.push(<Fragment key={`t${pos}`}>{text.slice(pos)}</Fragment>)
  return out
}

/** Un trozo de la respuesta alrededor de la primera coincidencia, para verla sin abrir la pregunta. */
function excerpt(text: string, words: string[]): string | null {
  const flat = norm(text)
  const at = Math.min(...words.map((w) => flat.indexOf(w)).filter((n) => n >= 0))
  if (!Number.isFinite(at) || flat.length !== text.length) return null
  const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 48)))
  const to = text.indexOf(' ', Math.min(text.length, at + 90))
  return `${from > 0 ? '… ' : ''}${text.slice(from, to === -1 ? text.length : to).trim()}${to !== -1 ? ' …' : ''}`
}

/** La ayuda: encabezado con buscador, temas con icono, resultado al escribir con resaltado y filtro por rol. */
export function HelpList({ rows, labels }: { rows: HelpRow[]; labels: HelpLabels }) {
  const [text, setText] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [topic, setTopic] = useState<string | null>(null)
  const words = useMemo(() => norm(text).split(/\s+/).filter(Boolean), [text])
  const base = useMemo(() => rows.filter((r) => (!onlyMine || r.mine) && words.every((w) => norm(`${r.q} ${r.a} ${r.topicLabel}`).includes(w))), [rows, words, onlyMine])
  const shown = topic ? base.filter((r) => r.topic === topic) : base
  const allTopics = [...new Map(rows.map((r) => [r.topic, r.topicLabel])).entries()]
  const topics = allTopics.filter(([t]) => shown.some((r) => r.topic === t))
  const pill = (on: boolean) => `press inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[14px] font-medium ${on ? 'bg-ink text-white' : 'border border-line-2 bg-surface text-strong hover:bg-green-50'}`
  const reset = () => {
    setText('')
    setTopic(null)
  }

  return (
    <div>
      <header className="sc-dark on-ink overflow-hidden rounded-[28px]">
        <div aria-hidden className="sc-aurora">
          <i className="a4" />
          <i className="a1" />
        </div>
        <div className="grid grid-cols-1 items-center gap-2 px-6 py-8 md:grid-cols-[1fr_260px] md:gap-8 md:px-11 md:py-10">
          <div>
            <p className="sc-kicker text-mint">{labels.topics}</p>
            <h1 className="mt-3 text-[32px] leading-[1.08] font-semibold tracking-[-0.03em] text-white md:text-[42px]">{labels.title}</h1>
            <p className="mt-3 max-w-[48ch] text-[15.5px] leading-6 text-[#c5d2cc]">{labels.desc}</p>
            <label className="relative mt-6 block max-w-[520px]">
              <span className="sr-only">{labels.search}</span>
              <Search size={20} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-[#24815f]" aria-hidden />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={labels.search}
                className="h-[56px] w-full rounded-full border-2 border-transparent bg-white pr-14 pl-[52px] text-[16px] text-[#14201b] shadow-[0_0_0_1px_rgba(168,240,209,0.4),0_18px_40px_-12px_rgba(61,220,151,0.45)] placeholder:text-[#5b6b64] focus:border-[#3ddc97] focus:outline-none"
                data-testid="help-search"
              />
              {text && (
                <button type="button" onClick={() => setText('')} aria-label={labels.clear} className="absolute top-1/2 right-1.5 grid h-[44px] w-[44px] -translate-y-1/2 place-items-center rounded-full text-[#44524c] hover:bg-[#edf1ef]" data-testid="help-clear">
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              )}
            </label>
          </div>
          <div className="mx-auto w-[200px] max-md:hidden md:w-full">
            <HelpArt />
          </div>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex gap-2" role="group" aria-label={labels.mine}>
          <button type="button" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)} className={pill(!onlyMine)} data-testid="help-all">{labels.all}</button>
          <button type="button" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)} className={pill(onlyMine)} data-testid="help-mine">{labels.mine}</button>
        </div>
        <p className="ml-auto text-[13.5px] text-muted-2" aria-live="polite" data-testid="help-count">{labels.count.replace('{n}', String(shown.length))}</p>
      </div>

      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:flex-wrap md:overflow-visible md:px-0" role="group" aria-label={labels.topics} data-testid="help-topics">
        {allTopics.map(([t, label]) => {
          const Icon = ICON[t] ?? Flag
          const n = base.filter((r) => r.topic === t).length
          const on = topic === t
          return (
            <button key={t} type="button" aria-pressed={on} disabled={n === 0 && !on} onClick={() => setTopic(on ? null : t)} className={`press inline-flex min-h-[48px] shrink-0 items-center gap-2.5 rounded-[14px] border py-1.5 pr-4 pl-2 text-[14px] font-medium whitespace-nowrap disabled:opacity-45 ${on ? 'border-[#24815f] bg-green-100 text-brand-text' : 'border-line bg-surface text-strong hover:border-[#33b888]'}`} data-testid={`help-chip-${t}`}>
              <span aria-hidden className={`grid h-9 w-9 place-items-center rounded-[10px] ${on ? 'bg-[#24815f] text-white' : 'bg-ink text-[#3ddc97]'}`}>
                <Icon size={17} strokeWidth={2} />
              </span>
              {label}
              <span className="num text-[12.5px] text-muted-2">{n}</span>
            </button>
          )
        })}
      </div>

      {shown.length === 0 && (
        <div className="card mt-8 flex flex-col items-center px-6 py-10 text-center" data-testid="help-empty">
          <div className="sc-art-light w-[180px]">
            <EmptyArt />
          </div>
          <p className="mt-4 text-[18px] font-semibold text-strong">{labels.emptyTitle}</p>
          <p className="mt-1.5 max-w-[46ch] text-[15px] leading-6 text-muted-2">{labels.empty}</p>
          <button type="button" onClick={reset} className="press mt-5 inline-flex min-h-[44px] items-center rounded-[10px] border border-line-2 bg-surface px-5 text-[14.5px] font-semibold text-strong hover:bg-green-50" data-testid="help-reset">
            {labels.clear}
          </button>
        </div>
      )}

      {topics.map(([t, label]) => {
        const Icon = ICON[t] ?? Flag
        return (
          <section key={t} className="mt-8" data-testid={`help-topic-${t}`}>
            <h2 className="flex items-center gap-3 text-[18px] font-semibold text-strong">
              <span aria-hidden className="grid h-9 w-9 place-items-center rounded-[10px] bg-ink text-[#3ddc97]">
                <Icon size={17} strokeWidth={2} />
              </span>
              {label}
            </h2>
            <div className="card mt-3 divide-y divide-line px-5">
              {shown.filter((r) => r.topic === t).map((r) => {
                const cut = words.length ? excerpt(r.a, words) : null
                return (
                  <details key={r.id} className="sc-faq group" data-testid="help-item">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-4 py-3 text-[15.5px] font-semibold text-strong [&::-webkit-details-marker]:hidden">
                      <span className="flex-1">
                        {mark(r.q, words)}
                        {cut && <span className="mt-1 block text-[13.5px] leading-5 font-normal text-muted-2 group-open:hidden" data-testid="help-excerpt">{mark(cut, words)}</span>}
                      </span>
                      <span aria-hidden className="plus grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-2 text-[18px] leading-none text-blue-text">+</span>
                    </summary>
                    <p className="pr-10 pb-5 text-[14.5px] leading-7 text-muted-2">{mark(r.a, words)}</p>
                  </details>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
