import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { getOnboarding } from '@/domain/onboarding'
import { HABITS, INTRO, STEPS, TRACK_LABEL, trackOf, type L, type Photo as PhotoName, type Track } from '@/content/guide'
import { homePath, type Home } from '@/domain/policy'
import { buttonClass } from '@/ui/kit'
import { MotionRoot } from '@/ui/showcase/motion'
import { Phone, Photo } from '@/ui/showcase/frames'
import { LogArt, ReadonlyArt, RoleArt } from '@/ui/showcase/art'
import { OnboardingList } from '@/ui/showcase/onboarding'
import { hideOnboardingAction, showOnboardingAction, toggleStepAction } from './actions'

/** La foto que acompaña la bienvenida de cada rol. Administración va solo con su ilustración. */
const TRACK_PHOTO: Record<Track, { name: PhotoName; pos: string } | null> = {
  rep: { name: 'calle', pos: '58% 22%' },
  supervisor: { name: 'equipo', pos: '55% 35%' },
  lead: { name: 'equipo', pos: '55% 35%' },
  ops: { name: 'mostrador', pos: '66% 40%' },
  lt: { name: 'equipo', pos: '55% 35%' },
  admin: null,
}
const i = (n: number) => ({ '--i': n }) as React.CSSProperties

/** El botón del final lleva a la pantalla donde cada rol empieza a trabajar (la misma que decide homePath). */
const GO_HOME: Record<Home, L> = {
  '/hoy': { es: 'Ir a Hoy', en: 'Go to Today' },
  '/operaciones': { es: 'Ir a mi cola', en: 'Go to my queue' },
  '/supervisor': { es: 'Ir a Mi equipo', en: 'Go to My team' },
  '/panel-lt': { es: 'Ir al Panel del LT', en: 'Go to the Leadership panel' },
  '/admin': { es: 'Ir a Administración', en: 'Go to Administration' },
  '/partners': { es: 'Ir a mi portal', en: 'Go to my portal' },
  '/reportes/finanzas': { es: 'Ir a mis reportes', en: 'Go to my reports' },
}

/** Primer ingreso: cómo se usa CONTIGO, paso a paso, y la lista de primeros pasos de la persona según su rol. */
export default async function WelcomePage() {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const lang = locale === 'en' ? 'en' : 'es'
  const l = (x: L) => x[lang]
  const track = trackOf(ctx.memberships)
  const intro = INTRO[track]
  const home = homePath(ctx.memberships)
  const steps = STEPS[track]
  const habits = HABITS[track]
  const ob = await getOnboarding(ctx)
  const first = ctx.user.name.split(' ')[0]
  const photo = TRACK_PHOTO[track]

  return (
    <div className="sc mx-auto max-w-[1080px] pb-10" data-testid="welcome">
      <MotionRoot />
      <section className="sc-dark on-ink overflow-hidden rounded-[28px]">
        <div aria-hidden className="sc-aurora">
          <i className="a4" />
          <i className="a2" />
          <i className="a1" />
        </div>
        <div className="grid grid-cols-1 items-center gap-8 px-6 py-9 md:grid-cols-[1.1fr_0.9fr] md:gap-6 md:px-11 md:py-12">
          <div>
            <p className="sc-kicker sc-in text-mint" style={i(0)} data-testid="welcome-track">{l(TRACK_LABEL[track])}</p>
            <h1 className="sc-in mt-4 max-w-[19ch] text-[34px] leading-[1.06] font-semibold tracking-[-0.03em] text-balance text-white md:text-[46px]" style={i(1)} data-testid="welcome-title">
              {t(`Te damos la bienvenida a CONTIGO, ${first}.`, `Welcome to CONTIGO, ${first}.`)}
            </h1>
            <p className="sc-in mt-5 max-w-[46ch] text-[16.5px] leading-7 text-[#c5d2cc]" style={i(2)}>{l(intro.lead)}</p>
            <div className="sc-in-rise mt-7 flex flex-wrap gap-3" style={i(3)}>
              <a href="#primeros-pasos" className="sc-cta !min-h-[48px] !text-[15px]">{t('Ver mis primeros pasos', 'See my first steps')}</a>
              <Link href="/ayuda" className="sc-ghost !min-h-[48px] !text-[15px]" data-testid="welcome-help">{t('Abrir la Ayuda', 'Open Help')}</Link>
            </div>
          </div>
          <div className="sc-in-rise relative mx-auto w-full max-w-[400px] md:mr-0" style={i(2)}>
            {photo ? (
              <>
                <Photo name={photo.name} lang={lang} sizes="(min-width: 768px) 400px, 92vw" className="aspect-[4/3.5] w-full" position={photo.pos} priority />
                <div className="sc-par stage absolute -bottom-5 -left-4 w-[52%] rounded-[20px] p-3 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.8)] md:-left-9" data-parallax="0.05">
                  <RoleArt track={track} />
                </div>
              </>
            ) : (
              <div className="stage rounded-[24px] p-6">
                <RoleArt track={track} />
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="how-title">
        <h2 id="how-title" className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-strong">{t('Así se usa, paso a paso', 'How it works, step by step')}</h2>
        <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {intro.how.map((h, n) => (
            <li key={h.title.es} className="card relative grid grid-cols-[1fr_124px] overflow-hidden md:grid-cols-[1fr_186px]" data-reveal style={i(n % 2)} data-testid="how-step">
              <div className="p-5 md:p-6">
                <span className="num grid h-10 w-10 place-items-center rounded-full bg-ink text-[16px] font-semibold text-[#3ddc97] shadow-[0_0_0_5px_rgba(51,184,136,0.16)]">{n + 1}</span>
                <h3 className="mt-4 text-[17.5px] leading-6 font-semibold text-strong">{l(h.title)}</h3>
                <p className="mt-2 text-[14.5px] leading-6 text-muted-2">{l(h.text)}</p>
              </div>
              <div className="relative overflow-hidden bg-[linear-gradient(160deg,#e3f4ec,#f2faf6_55%,#cfeede)]">
                <span aria-hidden className="absolute -top-8 -right-8 h-28 w-28 rounded-full border-[12px] border-white/60" />
                {'shot' in h.visual ? (
                  <Phone shot={h.visual.shot} lang={lang} small sizes="190px" className="absolute top-6 left-3 w-[150px] md:left-4 md:w-[190px]" />
                ) : (
                  <div className="sc-art-light absolute inset-0 flex items-center p-2 md:p-3">{h.visual.art === 'log' ? <LogArt /> : <ReadonlyArt />}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="primeros-pasos" className="mt-12 scroll-mt-24" aria-labelledby="steps-title" data-testid="onboarding">
        <OnboardingList
          steps={steps.map((s) => ({ key: s.key, title: l(s.title), why: l(s.why), href: s.href, cta: l(s.cta) }))}
          done={ob.done}
          toggle={toggleStepAction}
          labels={{
            title: t('Tus primeros pasos', 'Your first steps'),
            hint: t('Márcalos conforme los hagas. Cuando termines, puedes esconder la lista.', 'Tick them off as you go. When you are done, you can hide the list.'),
            progress: t('{done} de {total}', '{done} of {total}'),
            progressLabel: t('Avance de tus primeros pasos', 'Progress of your first steps'),
            mark: t('Marcar como hecho: {title}', 'Mark as done: {title}'),
            unmark: t('Desmarcar: {title}', 'Untick: {title}'),
            doneTitle: t(`Listo, ${first}. Ya diste tus primeros pasos.`, `Done, ${first}. You have taken your first steps.`),
            doneText: t('Puedes esconder la lista. Queda en tu menú por si quieres volver.', 'You can hide the list. It stays in your menu in case you want to come back.'),
          }}
        />

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href={home} className={buttonClass('primary')} data-testid="welcome-go">{l(GO_HOME[home])}</Link>
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

      <section className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2" aria-label={t('Lo que cambia y lo que te pedimos', 'What changes and what we ask of you')} data-testid="habits">
        <div className="card px-5 py-6 md:px-7" data-testid="habits-changes">
          <h2 className="text-[19px] leading-7 font-semibold text-strong">{t('Lo que cambia frente a Pipedrive', 'What changes from Pipedrive')}</h2>
          <ul className="mt-4 space-y-3">
            {habits.changes.map((x) => (
              <li key={x.es} className="grid grid-cols-[10px_1fr] items-start gap-3 text-[14.5px] leading-6 text-muted-2">
                <span aria-hidden className="mt-2 h-2.5 w-2.5 rounded-full bg-[#33b888]" />
                {l(x)}
              </li>
            ))}
          </ul>
        </div>
        <div className="card px-5 py-6 md:px-7" data-testid="habits-asks">
          <h2 className="text-[19px] leading-7 font-semibold text-strong">{t('Lo que te vamos a pedir', 'What we will ask of you')}</h2>
          <ol className="mt-4 space-y-3">
            {habits.asks.map((x, n) => (
              <li key={x.es} className="grid grid-cols-[32px_1fr] items-start gap-3 text-[14.5px] leading-6 text-muted-2">
                <span aria-hidden className="num grid h-8 w-8 place-items-center rounded-full bg-ink text-[13.5px] font-semibold text-[#3ddc97]">{n + 1}</span>
                <span className="pt-1">{l(x)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  )
}
