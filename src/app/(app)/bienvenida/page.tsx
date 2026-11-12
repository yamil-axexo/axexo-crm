import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { getOnboarding } from '@/domain/onboarding'
import { INTRO, STEPS, TRACK_LABEL, trackOf, type L } from '@/content/guide'
import { buttonClass } from '@/ui/kit'
import { hideOnboardingAction, showOnboardingAction, toggleStepAction } from './actions'

/** Primer ingreso: cómo se usa CONTIGO, paso a paso, y la lista de primeros pasos de la persona según su rol. */
export default async function WelcomePage() {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const l = (x: L) => x[locale === 'en' ? 'en' : 'es']
  const track = trackOf(ctx.memberships)
  const intro = INTRO[track]
  const steps = STEPS[track]
  const ob = await getOnboarding(ctx)
  const first = ctx.user.name.split(' ')[0]
  const doneCount = ob.total - ob.pending
  const pct = ob.total ? Math.round((doneCount / ob.total) * 100) : 0

  return (
    <div className="mx-auto max-w-[980px] pb-10" data-testid="welcome">
      <section className="stage on-ink rounded-[24px] px-6 py-9 md:px-10 md:py-12">
        <p className="text-[13px] font-semibold tracking-[0.12em] text-[#3ddc97] uppercase" data-testid="welcome-track">{l(TRACK_LABEL[track])}</p>
        <h1 className="mt-3 max-w-[20ch] text-[32px] leading-[1.1] font-bold md:text-[42px]" data-testid="welcome-title">
          {t(`Te damos la bienvenida a CONTIGO, ${first}.`, `Welcome to CONTIGO, ${first}.`)}
        </h1>
        <p className="mt-4 max-w-[58ch] text-[16px] leading-7 text-[#c5d2cc]">{l(intro.lead)}</p>
      </section>

      <section className="mt-10" aria-labelledby="how-title">
        <h2 id="how-title" className="text-[22px] font-semibold text-strong">{t('Así se usa, paso a paso', 'How it works, step by step')}</h2>
        <ol className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          {intro.how.map((h, i) => (
            <li key={h.title.es} className="card flex gap-4 p-5" data-testid="how-step">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-[15px] font-bold text-[#3ddc97]">{i + 1}</span>
              <div>
                <h3 className="text-[16.5px] leading-6 font-semibold text-strong">{l(h.title)}</h3>
                <p className="mt-1.5 text-[14.5px] leading-6 text-muted-2">{l(h.text)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="steps-title" data-testid="onboarding">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="flex-1">
            <h2 id="steps-title" className="text-[22px] font-semibold text-strong">{t('Tus primeros pasos', 'Your first steps')}</h2>
            <p className="mt-1 text-[14.5px] text-muted-2">{t('Márcalos conforme los hagas. Cuando termines, puedes esconder la lista.', 'Tick them off as you go. When you are done, you can hide the list.')}</p>
          </div>
          <p className="num text-[15px] font-semibold text-strong" data-testid="onboarding-progress">{t(`${doneCount} de ${ob.total}`, `${doneCount} of ${ob.total}`)}</p>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={ob.total} aria-valuenow={doneCount} aria-label={t('Avance de tus primeros pasos', 'Progress of your first steps')}>
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#3ddc97,#24815f)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <ul className="mt-5 space-y-3">
          {steps.map((s) => {
            const done = ob.done.includes(s.key)
            return (
              <li key={s.key} className="card flex items-start gap-4 p-4 md:p-5" data-testid={`step-${s.key}`} data-done={done}>
                <form action={toggleStepAction}>
                  <input type="hidden" name="key" value={s.key} />
                  <button
                    aria-pressed={done}
                    aria-label={t(`${done ? 'Desmarcar' : 'Marcar como hecho'}: ${l(s.title)}`, `${done ? 'Untick' : 'Mark as done'}: ${l(s.title)}`)}
                    className={`press grid h-11 w-11 place-items-center rounded-full border-2 ${done ? 'border-primary bg-primary text-white' : 'border-line-2 bg-surface text-transparent hover:border-primary'}`}
                    data-testid="step-toggle"
                  >
                    <Check size={20} strokeWidth={2.5} aria-hidden />
                  </button>
                </form>
                <div className="min-w-0 flex-1">
                  <h3 className={`text-[16px] leading-6 font-semibold ${done ? 'text-muted line-through' : 'text-strong'}`}>{l(s.title)}</h3>
                  <p className="mt-1 text-[14.5px] leading-6 text-muted-2">{l(s.why)}</p>
                  <Link href={s.href} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14.5px] font-semibold text-blue-text underline" data-testid="step-link">
                    {l(s.cta)}
                    <ArrowRight size={16} strokeWidth={2} aria-hidden />
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href="/hoy" className={buttonClass('primary')} data-testid="welcome-go">{t('Ir a Hoy', 'Go to Today')}</Link>
          <Link href="/ayuda" className={buttonClass('ghost')} data-testid="welcome-help">{t('Abrir la Ayuda', 'Open Help')}</Link>
          {ob.hidden ? (
            <form action={showOnboardingAction} className="md:ml-auto">
              <button className={buttonClass('ghost')} data-testid="onboarding-show">{t('Volver a mostrar la lista en Hoy', 'Show the list in Today again')}</button>
            </form>
          ) : (
            <form action={hideOnboardingAction} className="md:ml-auto">
              <input type="hidden" name="then" value="hoy" />
              <button className={buttonClass('ghost')} data-testid="onboarding-hide">{t('Esconder esta lista', 'Hide this list')}</button>
            </form>
          )}
        </div>
        <p className="mt-3 text-[13.5px] text-muted">{t('Esta página queda en tu menú, en "Primeros pasos".', 'This page stays in your menu, under "First steps".')}</p>
      </section>
    </div>
  )
}
