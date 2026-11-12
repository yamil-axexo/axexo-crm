import Image from 'next/image'
import { redirect } from 'next/navigation'
import { ArrowRight, Check, CircleDashed, Clock, Phone as PhoneIcon } from 'lucide-react'
import { getCtx, publicLocale } from '@/server/context'
import { withoutUser } from '@/server/db'
import { personasEnabled, ssoEnabled } from '@/env'
import { translator } from '@/lib/format'
import { ROLE_LABEL, homePath, type Role } from '@/domain/policy'
import { loginAsPersona, setLocale } from '@/app/session-actions'
import { flat } from '@/server/params'
import { HELP, LANDING, TRACK_LABEL, type L } from '@/content/guide'
import { MotionRoot } from '@/ui/showcase/motion'
import { HoyDemo } from '@/ui/showcase/demo'
import { ProductTour } from '@/ui/showcase/tour'
import { Ribbon } from '@/ui/showcase/ribbon'
import { Photo } from '@/ui/showcase/frames'
import { Funnel, ResponseBars, Ring } from '@/ui/showcase/charts'
import { Moment, RoleArt, ThreadLine } from '@/ui/showcase/art'

const ERRORS: Record<string, [string, string]> = {
  domain: ['Entra con tu cuenta de trabajo.', 'Sign in with your work account.'],
  no_access: ['Tu cuenta todavía no tiene acceso. Pídelo a quien administra CONTIGO.', 'Your account does not have access yet. Ask a CONTIGO admin.'],
  provider: ['No pudimos completar el inicio de sesión. Intenta otra vez.', 'We could not complete the sign-in. Try again.'],
  invalid: ['No pudimos abrir esa sesión.', 'We could not open that session.'],
  disabled: ['Ese modo de entrada está apagado.', 'That sign-in mode is turned off.'],
}

const WRAP = 'mx-auto w-full max-w-[1200px] px-5 md:px-8'
const SECTION = 'py-20 desk:py-28'
const i = (n: number) => ({ '--i': n }) as React.CSSProperties

/** La entrada de CONTIGO: lo que el equipo ve antes de iniciar sesión. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Quien ya tiene sesión va a la pantalla de su rol, la misma que decide la raíz.
  const signedIn = await getCtx()
  if (signedIn) redirect(homePath(signedIn.memberships))
  const { error } = flat(await searchParams)
  const locale = await publicLocale()
  const lang = locale === 'en' ? 'en' : 'es'
  const t = translator(locale)
  const l = (x: L) => x[lang]
  const sso = ssoEnabled()
  const personas = personasEnabled()
    ? await withoutUser((tx) => tx<{ id: string; full_name: string; email: string; roles: string }[]>`select id, full_name, email, roles from app.persona_list()`)
    : []
  const describe = (roles: string) =>
    roles
      .split(', ')
      .map((r) => {
        const [role, market] = r.split(':')
        const label = ROLE_LABEL[role as Role]
        return `${label ? t(label.es, label.en) : role}${market ? ` · ${market}` : ''}`
      })
      .join(', ')
  const faq = LANDING.faq.ids.map((id) => HELP.find((h) => h.id === id)!).filter(Boolean)
  const signIn = (testId: string) =>
    sso ? (
      <a href="/auth/login" className="sc-cta" data-testid={testId}>
        {t('Entrar con Google', 'Sign in with Google')}
        <ArrowRight size={18} strokeWidth={2.25} aria-hidden />
      </a>
    ) : (
      <a href={personas.length ? '#personas' : '#preguntas'} className="sc-cta" data-testid={testId}>
        {personas.length ? t('Entrar con una persona de prueba', 'Sign in as a test persona') : t('Leer las preguntas', 'Read the questions')}
        <ArrowRight size={18} strokeWidth={2.25} aria-hidden />
      </a>
    )
  const d = LANDING.demo
  const n = LANDING.numbers

  return (
    <div className="sc landing bg-black text-white">
      <MotionRoot />
      <header className="on-ink sticky top-0 z-40 border-b border-white/10 bg-black/75 backdrop-blur-xl" data-testid="landing-nav">
        <div className={`${WRAP} flex h-[68px] items-center gap-6`}>
          <Image src="/contigo-on-dark.png" alt="axexo CONTIGO" width={208} height={52} priority className="h-9 w-auto" />
          <nav aria-label={t('Secciones', 'Sections')} className="ml-4 hidden items-center gap-1 lg:flex">
            {LANDING.nav.map((x) => (
              <a key={x.href} href={x.href} className="inline-flex min-h-[44px] items-center rounded-full px-3.5 text-[14.5px] font-medium text-white/80 hover:bg-white/[0.07] hover:text-white">
                {l(x.label)}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <form action={setLocale}>
              <input type="hidden" name="locale" value={locale === 'es' ? 'en' : 'es'} />
              <button className="inline-flex min-h-[44px] items-center rounded-full border border-white/25 px-4 text-[13.5px] font-semibold text-white/90 hover:bg-white/10" data-testid="locale-toggle">
                {locale === 'es' ? 'English' : 'Español'}
              </button>
            </form>
            <a href="#entrar" className="hidden min-h-[44px] items-center rounded-full bg-white px-5 text-[14.5px] font-semibold text-black hover:bg-[#a8f0d1] md:inline-flex">
              {t('Entrar', 'Sign in')}
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* 1. Entrada con la demo viva */}
        <section id="entrar" className="sc-dark on-ink overflow-hidden" data-testid="landing-hero" data-glow>
          <div aria-hidden className="sc-aurora">
            <i className="a4" />
            <i className="a2" />
            <i className="a1" />
            <i className="a3" />
          </div>
          <div aria-hidden className="sc-grain" />
          <div aria-hidden className="sc-glow" />
          <ThreadLine className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[110px] w-full opacity-70" />
          <div className={`${WRAP} grid grid-cols-1 items-center gap-14 pt-14 pb-24 lg:grid-cols-[1.08fr_0.92fr] lg:gap-8 lg:pt-20 lg:pb-32`}>
            <div>
              <p className="sc-kicker sc-in text-mint" style={i(0)}>{l(LANDING.hero.eyebrow)}</p>
              <h1 className="sc-display sc-in mt-5 max-w-[640px] text-white" style={i(1)}>{l(LANDING.hero.title)}</h1>
              <p className="sc-lead sc-in mt-6 max-w-[50ch] text-[#c5d2cc]" style={i(2)}>{l(LANDING.hero.sub)}</p>
              {error && ERRORS[error] && (
                <p role="alert" data-testid="login-error" className="mt-8 inline-block rounded-2xl bg-[#b42318] px-5 py-3 text-[14.5px] font-medium text-white">
                  {t(ERRORS[error][0], ERRORS[error][1])}
                </p>
              )}
              <div className="sc-in-rise mt-9 flex flex-wrap items-center gap-3" style={i(3)}>
                {signIn(sso ? 'sso-login' : 'landing-enter')}
                <a href="#como" className="sc-ghost">{l(LANDING.hero.secondary)}</a>
              </div>
              {!sso && (
                <p className="mt-5 max-w-[46ch] text-[14px] leading-6 text-on-black" data-testid="sso-off">
                  {t('El inicio de sesión con Google todavía no está conectado en este ambiente.', 'Google sign-in is not connected in this environment yet.')}
                </p>
              )}
              <ol aria-hidden className="sc-in-rise relative mt-11 hidden max-w-[540px] grid-cols-3 md:grid" style={i(4)}>
                <li className="absolute top-[9px] right-2 left-2 h-0.5 rounded-full bg-[linear-gradient(90deg,#0e6b5c,#33b888_60%,#a8f0d1)]" />
                {LANDING.hero.thread.map((x, k) => (
                  <li key={x.when.es} className={`relative flex flex-col gap-1 ${k === 1 ? 'items-center text-center' : k === 2 ? 'items-end text-right' : ''}`}>
                    <span className={`mb-2 h-5 w-5 rounded-full ${x.done ? 'border-[5px] border-black bg-[#33b888] shadow-[0_0_0_1px_#33b888]' : 'border-[3px] border-[#a8f0d1] bg-black shadow-[var(--cg-glow-active)]'}`} />
                    <span className="text-[12.5px] leading-4 text-on-black">{l(x.when)}</span>
                    <span className={`text-[14px] leading-5 font-medium ${x.done ? 'text-[#c5d2cc]' : 'text-mint'}`}>{l(x.what)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="sc-in-rise" style={i(2)}>
              <HoyDemo
                items={d.items.map((x) => ({ title: l(x.title), context: l(x.context), chip: l(x.chip), tone: x.tone }))}
                labels={{
                  label: l(d.label), tag: l(d.tag), screen: l(d.screen), pending: l(d.pending), pendingOne: l(d.pendingOne), now: l(d.now), later: l(d.later),
                  complete: l(d.complete), completeOf: l(d.completeOf), result: l(d.result), next: l(d.next), save: l(d.save), cancel: l(d.cancel),
                  results: d.results.map(l), nexts: d.nexts.map(l), toast: l(d.toast), clock: l(d.clock),
                  emptyTitle: l(d.empty.title), emptyText: l(d.empty.text), again: l(d.again), pause: l(d.pause), play: l(d.play), note: l(d.note),
                }}
              />
            </div>
          </div>
        </section>

        {/* Cinta: lo que ya funciona */}
        <div className="on-ink border-y border-white/10 bg-[#050807] py-4">
          <Ribbon items={LANDING.ribbon.items.map(l)} labels={{ label: l(LANDING.ribbon.label), pause: l(LANDING.ribbon.pause), play: l(LANDING.ribbon.play) }} />
        </div>

        {/* 2. Tu día, en tres pasos unidos por el hilo */}
        <section id="como" className="scroll-mt-20 bg-[#f5f7f6] text-[#14201b]">
          <div className={`${WRAP} ${SECTION} grid grid-cols-1 items-center gap-12 lg:grid-cols-[0.82fr_1fr] lg:gap-14 desk:gap-20`}>
            <div className="relative" data-reveal="left">
              <Photo name="seguimiento" lang={lang} sizes="(min-width: 1200px) 460px, 92vw" className="aspect-[4/5] w-full max-lg:aspect-[16/10] max-md:aspect-[4/3.4]" position="60% 35%" />
              <div aria-hidden className="sc-par toast absolute -right-2 bottom-8 max-w-[260px] rounded-[14px] px-4 py-3 text-[13.5px] leading-5 font-medium md:-right-8" data-parallax="0.08">
                <span className="mb-1 flex items-center gap-2 text-mint">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#3ddc97] text-[#04130d]"><Check size={12} strokeWidth={3} /></span>
                  {l(d.results[0]!)}
                </span>
                {l(d.toast).replace('{next}', l(d.nexts[0]!))}
              </div>
            </div>
            <div>
              <div data-reveal>
                <p className="sc-kicker text-[#1b6b4e]">{l(LANDING.day.eyebrow)}</p>
                <h2 className="sc-h2 mt-4 max-w-[16ch] text-[#14201b]">{l(LANDING.day.title)}</h2>
              </div>
              <ol className="mt-10">
                {LANDING.day.steps.map((s, k) => (
                  <li key={s.title.es} className="relative flex gap-5 pb-9 last:pb-0" data-reveal style={i(k)}>
                    {k < LANDING.day.steps.length - 1 && <span aria-hidden className="absolute top-[52px] bottom-1 left-[23px] w-0.5 rounded-full bg-[linear-gradient(#33b888,#a8f0d1)]" />}
                    <span className="num grid h-12 w-12 shrink-0 place-items-center rounded-full bg-black text-[18px] font-semibold text-[#3ddc97] shadow-[0_0_0_5px_rgba(51,184,136,0.16)]">{k + 1}</span>
                    <div className="min-w-0 flex-1 pt-1">
                      <h3 className="text-[21px] leading-7 font-semibold text-[#14201b]">{l(s.title)}</h3>
                      <p className="mt-1.5 max-w-[44ch] text-[16px] leading-7 text-[#44524c]">{l(s.text)}</p>
                      <div aria-hidden className="mt-4 flex flex-wrap gap-2">
                        {k === 0 && (
                          <>
                            <span className="inline-flex h-9 items-center gap-2 rounded-full bg-black px-4 text-[13px] font-medium text-white"><Clock size={14} className="text-[#f5cf7a]" />{l(d.items[0]!.title)}</span>
                            <span className="inline-flex h-9 items-center rounded-full bg-risk-bg px-3.5 text-[13px] font-medium text-red-text">{l(d.items[1]!.chip)}</span>
                            <span className="inline-flex h-9 items-center rounded-full bg-green-100 px-3.5 text-[13px] font-medium text-brand-text">{l(d.items[3]!.chip)}</span>
                          </>
                        )}
                        {k === 1 && d.results.map((r, x) => (
                          <span key={r.es} className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium ${x === 0 ? 'bg-[#3ddc97] text-[#04130d] shadow-[var(--cg-glow-active)]' : 'bg-black text-white'}`}>
                            {x === 0 && <PhoneIcon size={14} strokeWidth={2.25} />}
                            {l(r)}
                          </span>
                        ))}
                        {k === 2 && (
                          <>
                            <span className="inline-flex h-9 items-center gap-2 rounded-full bg-black px-4 text-[13px] font-medium text-white"><CircleDashed size={14} className="text-[#3ddc97]" />{l(d.nexts[0]!)}</span>
                            <span className="inline-flex h-9 items-center rounded-full border border-[#24815f] px-3.5 text-[13px] font-medium text-[#1b6b4e]">{t('Mañana', 'Tomorrow')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* 3. El producto por dentro, con capturas reales */}
        <section id="producto" className="sc-dark on-ink scroll-mt-20 overflow-hidden" data-testid="landing-product">
          <div aria-hidden className="sc-aurora">
            <i className="a2" />
            <i className="a3" />
          </div>
          <div className={`${WRAP} ${SECTION}`}>
            <div className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-4" data-reveal>
              <div>
                <p className="sc-kicker text-mint">{l(LANDING.tour.eyebrow)}</p>
                <h2 className="sc-h2 mt-4 text-white">{l(LANDING.tour.title)}</h2>
              </div>
              <p className="max-w-[34ch] text-[14.5px] leading-6 text-on-black">{l(LANDING.tour.note)}</p>
            </div>
            <div data-reveal="zoom">
              <ProductTour
                lang={lang}
                screens={LANDING.tour.screens.map((s) => ({ shot: s.shot, label: l(s.label), caption: l(s.caption) }))}
                labels={{ tabs: l(LANDING.tour.tabs), pause: l(LANDING.tour.pause), play: l(LANDING.tour.play) }}
              />
            </div>
          </div>
        </section>

        {/* 4. Lo que hace por ti: cuatro momentos ilustrados */}
        <section className="bg-white text-[#14201b]" data-testid="landing-moments">
          <div className={`${WRAP} ${SECTION}`}>
            <div data-reveal>
              <p className="sc-kicker text-[#1b6b4e]">{l(LANDING.moments.eyebrow)}</p>
              <h2 className="sc-h2 mt-4 max-w-[22ch] text-[#14201b]">{l(LANDING.moments.title)}</h2>
            </div>
            <ul className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
              {LANDING.moments.cards.map((c, k) => (
                <li key={c.art} data-reveal style={i(k % 2)}>
                  <div className="sc-live sc-spot h-full rounded-[28px] border border-[#e4eae6] bg-[#f7f9f8] p-3" data-spot>
                    <div className="stage rounded-[20px] px-6 py-5 md:px-10">
                      <Moment art={c.art} />
                    </div>
                    <div className="px-4 pt-5 pb-4 md:px-5">
                      <h3 className="text-[21px] leading-7 font-semibold text-[#14201b]">{l(c.title)}</h3>
                      <p className="mt-1.5 max-w-[48ch] text-[15.5px] leading-7 text-[#44524c]">{l(c.text)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 5. Del otro lado: los comercios */}
        <section className="sc-dark on-ink overflow-hidden" data-testid="landing-people">
          <div aria-hidden className="sc-aurora">
            <i className="a4" />
            <i className="a1" />
          </div>
          <div className={`${WRAP} ${SECTION}`}>
            <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5" data-reveal>
              <div>
                <p className="sc-kicker text-mint">{l(LANDING.people.eyebrow)}</p>
                <h2 className="sc-h2 mt-4 max-w-[17ch] text-white">{l(LANDING.people.title)}</h2>
              </div>
              <p className="sc-lead max-w-[34ch] text-[#c5d2cc]">{l(LANDING.people.text)}</p>
            </div>
            <ul className="mt-12 grid grid-cols-2 gap-3 md:gap-5 lg:grid-cols-4">
              {(
                [
                  { name: 'llamada', pos: '38% 30%', par: '0.05', chip: l(d.results[0]!), dot: 'call' },
                  { name: 'retrato', pos: '52% 30%', par: '-0.04', chip: t('Próximo paso: mañana', 'Next step: tomorrow'), dot: 'ring' },
                  { name: 'asesor', pos: '50% 22%', par: '0.07', chip: t('Lead nuevo', 'New lead'), dot: 'clock' },
                  { name: 'mostrador', pos: '68% 40%', par: '-0.02', chip: t('Activo', 'Active'), dot: 'on' },
                ] as const
              ).map((ph, k) => (
                <li key={ph.name} className={`sc-par ${k % 2 ? 'mt-8 lg:mt-16' : ''}`} data-parallax={ph.par}>
                  <div data-reveal style={i(k)}>
                    <Photo name={ph.name} lang={lang} sizes="(min-width: 1024px) 280px, 46vw" className="aspect-[3/4] md:max-lg:aspect-[4/4.2]" position={ph.pos}>
                      <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-[12.5px] leading-4 font-medium text-white backdrop-blur md:text-[13.5px]">
                        {ph.dot === 'call' && <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#3ddc97] text-[#04130d]"><PhoneIcon size={11} strokeWidth={2.5} /></span>}
                        {ph.dot === 'ring' && <span aria-hidden className="h-3 w-3 shrink-0 rounded-full border-2 border-[#3ddc97]" />}
                        {ph.dot === 'clock' && <Clock aria-hidden size={14} strokeWidth={2.25} className="shrink-0 text-[#f5cf7a]" />}
                        {ph.dot === 'on' && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#33b888]" />}
                        {ph.chip}
                      </span>
                    </Photo>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-[13px] text-on-black">{l(LANDING.people.credit)}</p>
          </div>
        </section>

        {/* 6. Por rol */}
        <section id="roles" className="scroll-mt-20 bg-[#f5f7f6] text-[#14201b]" data-testid="landing-roles">
          <div className={`${WRAP} ${SECTION}`}>
            <div data-reveal>
              <p className="sc-kicker text-[#1b6b4e]">{l(LANDING.roles.eyebrow)}</p>
              <h2 className="sc-h2 mt-4 max-w-[26ch] text-[#14201b]">{l(LANDING.roles.title)}</h2>
            </div>
            <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
              {LANDING.roles.cards.map((c, k) => (
                <li key={c.track} data-reveal style={i(k % 3)}>
                  <div className="sc-live sc-spot h-full rounded-[28px] border border-[#e4eae6] bg-white p-3 max-md:flex max-md:items-start max-md:gap-1" data-spot>
                    <div className="stage rounded-[20px] px-8 py-4 max-md:w-[104px] max-md:shrink-0 max-md:rounded-[18px] max-md:px-2 max-md:py-3">
                      <RoleArt track={c.track} />
                    </div>
                    <div className="min-w-0 px-4 pt-5 pb-4 max-md:px-3 max-md:pt-2 max-md:pb-2">
                      <h3 className="text-[20px] leading-7 font-semibold text-[#14201b]">{l(TRACK_LABEL[c.track])}</h3>
                      <ul className="mt-3.5 space-y-2.5">
                        {c.points.map((p) => (
                          <li key={p.es} className="flex gap-2.5 text-[15px] leading-6 text-[#44524c]">
                            <Check size={18} strokeWidth={2.5} className="mt-[3px] shrink-0 text-[#24815f]" aria-hidden />
                            {l(p)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 7. Para quien dirige: gráficas de ejemplo */}
        <section className="sc-dark on-ink overflow-hidden" data-testid="landing-numbers">
          <div aria-hidden className="sc-aurora">
            <i className="a2" />
            <i className="a1" />
          </div>
          <div className={`${WRAP} ${SECTION} grid grid-cols-1 items-start gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-10 desk:gap-16`}>
            <div data-reveal>
              <p className="sc-kicker text-mint">{l(n.eyebrow)}</p>
              <h2 className="sc-h2 mt-4 max-w-[16ch] text-white">{l(n.title)}</h2>
              <p className="sc-lead mt-5 max-w-[42ch] text-[#c5d2cc]">{l(n.text)}</p>
              <Photo name="equipo" lang={lang} sizes="(min-width: 1024px) 420px, 92vw" className="mt-9 aspect-[16/10] md:max-lg:aspect-[16/7]" position="50% 30%" fade />
            </div>
            <div className="rounded-[28px] border border-white/12 bg-[#0b100e]/85 p-5 backdrop-blur md:p-7" data-reveal="right">
              <p className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] leading-5 text-[#c5d2cc]">
                <span className="rounded-full bg-[#f5cf7a] px-3 py-1 text-[12.5px] font-semibold text-[#3d2a00]" data-testid="numbers-example">{l(n.badge)}</span>
                {l(n.note)}
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-4">
                  <div className="rounded-[20px] border border-white/10 bg-black/60 p-5">
                    <h3 className="mb-4 text-[16px] font-semibold text-white">{l(n.funnel.title)}</h3>
                    <Funnel stages={n.funnel.stages.map((s) => ({ label: l(s.label), value: s.value }))} />
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-4">
                    {n.rings.map((r, k) => (
                      <div key={r.label.es} className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-white/10 bg-black/60 p-4 text-center">
                        <Ring id={`sc-ring-${k}`} value={r.value} size={88} from={k ? '#7fe0b5' : '#a8f0d1'} to={k ? '#0e6b5c' : '#33b888'}>
                          <span className="num text-[19px] font-semibold text-white"><span data-count={r.value}>{r.value}</span>%</span>
                        </Ring>
                        <p className="text-[14px] leading-5 font-medium text-white">{l(r.label)}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-black/60 p-5">
                  <h3 className="mb-4 text-[16px] font-semibold text-white">{l(n.response.title)}</h3>
                  <ResponseBars teams={n.response.teams.map((x) => ({ label: l(x.label), first: x.first, reached: x.reached }))} first={l(n.response.first)} reached={l(n.response.reached)} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 8. Qué ya funciona y qué viene */}
        <section id="estado" className="on-ink scroll-mt-20 border-t border-white/10 bg-[#070b09]" data-testid="landing-status">
          <div className={`${WRAP} ${SECTION} grid grid-cols-1 gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12 desk:gap-16`}>
            <div data-reveal>
              <p className="sc-kicker text-mint">{l(LANDING.status.eyebrow)}</p>
              <h2 className="sc-h2 mt-4 max-w-[16ch] text-white">{l(LANDING.status.title)}</h2>
              <p className="sc-lead mt-5 max-w-[42ch] text-[#c5d2cc]">{l(LANDING.status.text)}</p>
              <p className="mt-4 max-w-[42ch] border-l-2 border-[#3ddc97]/60 pl-4 text-[15px] leading-6 text-[#c5d2cc]" data-testid="landing-rule">{l(LANDING.status.rule)}</p>
            </div>
            <ul className="space-y-2.5">
              {LANDING.status.rows.map((r, k) => (
                <li key={r.label.es} className={`grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-[18px] border px-4 py-4 md:flex md:px-5 ${r.state === 'on' ? 'border-[#3ddc97]/25 bg-[linear-gradient(90deg,rgba(61,220,151,0.12),rgba(14,107,92,0.06))]' : 'border-dashed border-white/15 bg-white/[0.02]'}`} data-reveal style={i(k)}>
                  <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${r.state === 'on' ? 'bg-[#3ddc97] text-[#04130d] shadow-[var(--cg-glow-active)]' : 'border-2 border-dashed border-white/35 text-white/60'}`}>
                    {r.state === 'on' ? <Check size={18} strokeWidth={3} /> : <Clock size={16} strokeWidth={2} />}
                  </span>
                  <span className="min-w-0 flex-1 text-[15.5px] leading-6 text-white">{l(r.label)}</span>
                  <span className={`col-start-2 w-fit shrink-0 rounded-full px-3 py-1 text-[12.5px] font-semibold ${r.state === 'on' ? 'bg-[#3ddc97] text-[#04130d]' : 'border border-white/25 text-[#c5d2cc]'}`}>
                    {l(r.state === 'on' ? LANDING.status.on : LANDING.status.soon)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 9. Datos del producto */}
        <section className="bg-[#f5f7f6] text-[#14201b]" data-testid="landing-facts">
          <div className={`${WRAP} ${SECTION}`}>
            <h2 className="sc-h2 max-w-[24ch] text-[#14201b]" data-reveal>{l(LANDING.facts.title)}</h2>
            <ul className="mt-10 grid grid-cols-2 gap-3 md:mt-12 md:gap-5 lg:grid-cols-4">
              {LANDING.facts.cards.map((c, k) => (
                <li key={c.title.es} data-reveal style={i(k)}>
                  <div className="sc-spot relative h-full overflow-hidden rounded-[24px] border border-[#e4eae6] bg-white p-4 md:rounded-[28px] md:p-7" data-spot>
                    <span aria-hidden className="absolute -top-9 -right-9 h-24 w-24 rounded-full border-[10px] border-[#e3f4ec] md:-top-10 md:-right-10 md:h-32 md:w-32 md:border-[14px]" />
                    <p className="num relative text-[56px] leading-none font-semibold tracking-[-0.04em] text-[#24815f] md:text-[76px]" data-count={c.figure}>{c.figure}</p>
                    <h3 className="relative mt-3 text-[16px] leading-[22px] font-semibold text-[#14201b] md:text-[18px] md:leading-6">{l(c.title)}</h3>
                    <p className="mt-2 text-[13.5px] leading-5 text-[#44524c] md:text-[15px] md:leading-6">{l(c.text)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 10. Entrar */}
        <section className="sc-dark on-ink overflow-hidden" data-glow>
          <div aria-hidden className="sc-aurora">
            <i className="a2" />
            <i className="a1" />
            <i className="a3" />
          </div>
          <div aria-hidden className="sc-glow" />
          <ThreadLine className="pointer-events-none absolute inset-x-0 top-8 -z-10 h-[120px] w-full opacity-60" />
          <div className={`${WRAP} flex flex-col items-center py-24 text-center desk:py-32`} data-reveal>
            <h2 className="sc-display max-w-[18ch] text-white">{l(LANDING.cta.title)}</h2>
            <p className="sc-lead mt-5 max-w-[46ch] text-[#c5d2cc]">{l(LANDING.cta.text)}</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              {signIn('landing-enter-2')}
              <a href="#preguntas" className="sc-ghost">{l(LANDING.cta.secondary)}</a>
            </div>
          </div>
        </section>

        {/* 11. Preguntas */}
        <section id="preguntas" className="scroll-mt-20 bg-white text-[#14201b]" data-testid="landing-faq">
          <div className={`${WRAP} ${SECTION} grid grid-cols-1 gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-12 desk:gap-16`}>
            <div data-reveal>
              <p className="sc-kicker text-[#1b6b4e]">{l(LANDING.faq.eyebrow)}</p>
              <h2 className="sc-h2 mt-4 text-[#14201b]">{l(LANDING.faq.title)}</h2>
              <div className="mt-8 rounded-[24px] bg-[#f2faf6] p-6">
                <h3 className="text-[18px] font-semibold text-[#14201b]">{l(LANDING.help.title)}</h3>
                <p className="mt-1.5 text-[15px] leading-6 text-[#44524c]">{l(LANDING.help.text)}</p>
              </div>
            </div>
            <div className="space-y-3" data-reveal>
              {faq.map((f) => (
                <details key={f.id} className="sc-faq group rounded-[20px] border border-[#e4eae6] bg-[#f7f9f8] px-5 open:bg-white open:shadow-[0_18px_40px_-24px_rgba(14,107,92,0.45)] md:px-6">
                  <summary className="flex min-h-[64px] cursor-pointer list-none items-center gap-4 py-3 text-[17px] leading-6 font-semibold text-[#14201b] [&::-webkit-details-marker]:hidden">
                    <span className="flex-1">{l(f.q)}</span>
                    <span aria-hidden className="plus grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#d3dcd7] text-[20px] leading-none text-[#24815f]">+</span>
                  </summary>
                  <p className="pr-10 pb-6 text-[15.5px] leading-7 text-[#44524c]">{l(f.a)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Personas de prueba: solo fuera de producción */}
        {personas.length > 0 && (
          <section id="personas" className="scroll-mt-20 border-t border-[#e4eae6] bg-[#f5f7f6] text-[#14201b]" data-testid="personas">
            <div className={`${WRAP} py-16`}>
              <p className="sc-kicker text-[#1b6b4e]">{t('Ambiente de prueba, con datos sintéticos', 'Test environment, with synthetic data')}</p>
              <h2 className="mt-4 text-[30px] leading-9 font-semibold tracking-[-0.02em] text-[#14201b]">{t('Entra como una persona de prueba', 'Sign in as a test persona')}</h2>
              <p className="mt-3 max-w-2xl text-[15.5px] leading-6 text-[#44524c]">
                {t('Cada persona ve solo lo que su rol y su mercado permiten. Sirve para revisar los permisos sin tocar datos reales.', 'Each persona sees only what their role and market allow. Use it to review permissions without touching real data.')}
              </p>
              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {personas.map((p) => (
                  <form key={p.id} action={loginAsPersona}>
                    <input type="hidden" name="user_id" value={p.id} />
                    <button className="lift group flex w-full cursor-pointer items-center gap-4 rounded-[18px] border border-[#e4eae6] bg-white p-4 text-left hover:border-[#33b888]" data-testid={`persona-${p.email.split('@')[0]}`}>
                      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black text-[14px] font-semibold text-[#3ddc97]">
                        {p.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15.5px] font-semibold text-[#14201b]">{p.full_name}</span>
                        <span className="mt-0.5 block text-[13.5px] leading-5 text-[#44524c]">{describe(p.roles)}</span>
                      </span>
                      <ArrowRight size={18} strokeWidth={2} className="shrink-0 text-[#24815f]" aria-hidden />
                    </button>
                  </form>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="on-ink border-t border-white/10 bg-black">
        <div className={`${WRAP} flex flex-col gap-6 py-12 md:flex-row md:items-center`}>
          <div>
            <Image src="/contigo-on-dark.png" alt="axexo CONTIGO" width={176} height={44} className="h-8 w-auto" />
            <p className="mt-3 text-[14.5px] text-[#c5d2cc]">{l(LANDING.footer.tagline)}</p>
          </div>
          <p className="text-[13.5px] text-on-black md:ml-auto">{l(LANDING.footer.note)}</p>
        </div>
      </footer>
    </div>
  )
}
