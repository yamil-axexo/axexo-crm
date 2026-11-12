'use client'
import Link from 'next/link'
import { useOptimistic, useState } from 'react'
import { ArrowRight, Check, PartyPopper } from 'lucide-react'
import { Ring } from '@/ui/showcase/charts'

export type StepRow = { key: string; title: string; why: string; href: string; cta: string }
export type OnboardingLabels = {
  title: string
  hint: string
  /** "{done} de {total}" */
  progress: string
  progressLabel: string
  /** "Marcar como hecho: {title}" y "Desmarcar: {title}" */
  mark: string
  unmark: string
  doneTitle: string
  doneText: string
}

const SPARKS = ['#3ddc97', '#a8f0d1', '#33b888', '#0e6b5c', '#7fe0b5', '#f5cf7a']

/**
 * La lista de primeros pasos: se marca al instante (la base confirma detrás), el anillo avanza
 * y al completar la lista hay una celebración corta. Sin JavaScript sigue siendo un formulario.
 */
export function OnboardingList({ steps, done, labels, toggle }: { steps: StepRow[]; done: string[]; labels: OnboardingLabels; toggle: (fd: FormData) => Promise<void> }) {
  const [marked, flip] = useOptimistic(done, (state: string[], key: string) => (state.includes(key) ? state.filter((k) => k !== key) : [...state, key]))
  const [just, setJust] = useState<string | null>(null)
  const [party, setParty] = useState(false)
  const count = steps.filter((s) => marked.includes(s.key)).length
  const total = steps.length
  const complete = total > 0 && count === total

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count} aria-label={labels.progressLabel}>
          <Ring id="sc-ring-steps" value={total ? (count / total) * 100 : 0} size={84} stroke={10} track="var(--cg-line-200)" from="#3ddc97" to="#24815f" live>
            {complete ? <Check size={30} strokeWidth={2.75} className="text-[#24815f]" aria-hidden /> : <span className="num text-[22px] font-semibold text-strong" aria-hidden>{count}</span>}
          </Ring>
        </div>
        <div className="min-w-[220px] flex-1">
          <h2 id="steps-title" className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-strong">{labels.title}</h2>
          <p className="mt-1 text-[14.5px] leading-6 text-muted-2">{labels.hint}</p>
        </div>
        <p className="num rounded-full bg-green-100 px-4 py-1.5 text-[15px] font-semibold text-brand-text" data-testid="onboarding-progress">
          {labels.progress.replace('{done}', String(count)).replace('{total}', String(total))}
        </p>
      </div>

      {complete && (
        <div className="stage on-ink relative mt-6 overflow-hidden rounded-[22px] px-6 py-6 md:px-8" role="status" data-testid="onboarding-complete">
          {party && (
            <span aria-hidden className="sc-celebrate pointer-events-none absolute top-1/2 left-[52px]">
              <b />
              <b />
              {Array.from({ length: 14 }, (_, n) => (
                <i key={n} style={{ '--a': `${n * 25.7}deg`, '--d': `${70 + (n % 4) * 26}px`, '--n': n, background: SPARKS[n % SPARKS.length] } as React.CSSProperties} />
              ))}
            </span>
          )}
          <div className="relative flex items-center gap-5">
            <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-neon text-black shadow-[var(--cg-glow-active)]">
              <PartyPopper size={26} strokeWidth={2} />
            </span>
            <div>
              <p className="text-[19px] leading-7 font-semibold text-white">{labels.doneTitle}</p>
              <p className="mt-0.5 text-[14.5px] leading-6 text-[#c5d2cc]">{labels.doneText}</p>
            </div>
          </div>
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {steps.map((s, n) => {
          const isDone = marked.includes(s.key)
          return (
            <li key={s.key} className="sc-step card flex items-start gap-4 p-4 md:p-5" data-testid={`step-${s.key}`} data-done={isDone}>
              <form
                action={async (fd) => {
                  flip(s.key)
                  await toggle(fd)
                }}
              >
                <input type="hidden" name="key" value={s.key} />
                <button
                  aria-pressed={isDone}
                  aria-label={(isDone ? labels.unmark : labels.mark).replace('{title}', s.title)}
                  data-just={just === s.key && isDone ? '' : undefined}
                  onClick={() => {
                    setJust(isDone ? null : s.key)
                    setParty(!isDone && count === total - 1)
                  }}
                  className="sc-check grid h-12 w-12 place-items-center rounded-full border-2 border-line-2 bg-surface text-white"
                  data-testid="step-toggle"
                >
                  <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </button>
              </form>
              <div className="min-w-0 flex-1">
                <h3 className={`text-[16.5px] leading-6 font-semibold ${isDone ? 'text-muted-2 line-through decoration-[#33b888] decoration-2' : 'text-strong'}`}>
                  <span className="num mr-2 text-muted-2 no-underline">{n + 1}.</span>
                  {s.title}
                </h3>
                <p className="mt-1 text-[14.5px] leading-6 text-muted-2">{s.why}</p>
                <Link href={s.href} className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 text-[14.5px] font-semibold text-blue-text underline" data-testid="step-link">
                  {s.cta}
                  <ArrowRight size={16} strokeWidth={2} aria-hidden />
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
