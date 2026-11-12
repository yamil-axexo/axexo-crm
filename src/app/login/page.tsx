import Image from 'next/image'
import { redirect } from 'next/navigation'
import { ArrowRight, Check, Clock, Phone } from 'lucide-react'
import { getCtx, publicLocale } from '@/server/context'
import { withoutUser } from '@/server/db'
import { personasEnabled, ssoEnabled } from '@/env'
import { translator } from '@/lib/format'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { loginAsPersona, setLocale } from '@/app/session-actions'
import { flat } from '@/server/params'
import { HELP, LANDING, TRACK_LABEL, type L } from '@/content/guide'

const ERRORS: Record<string, [string, string]> = {
  domain: ['Entra con tu cuenta de trabajo.', 'Sign in with your work account.'],
  no_access: ['Tu cuenta todavía no tiene acceso. Pídelo a quien administra CONTIGO.', 'Your account does not have access yet. Ask a CONTIGO admin.'],
  provider: ['No pudimos completar el inicio de sesión. Intenta otra vez.', 'We could not complete the sign-in. Try again.'],
  invalid: ['No pudimos abrir esa sesión.', 'We could not open that session.'],
  disabled: ['Ese modo de entrada está apagado.', 'That sign-in mode is turned off.'],
}

// Tonos de la misma familia de verde para los monogramas de cada rol: variedad sin salir de la marca.
const TONES = ['from-[#3ddc97] to-[#24815f]', 'from-[#a8f0d1] to-[#33b888]', 'from-[#33b888] to-[#0e6b5c]', 'from-[#7fe0b5] to-[#1b6b4e]', 'from-[#3ddc97] to-[#0e6b5c]', 'from-[#a8f0d1] to-[#24815f]']

const WRAP = 'mx-auto w-full max-w-[1160px] px-5 md:px-8'
const CTA = 'press inline-flex h-12 items-center justify-center gap-2 rounded-[12px] bg-[#3ddc97] px-6 text-[15px] font-semibold text-[#04130d] shadow-[var(--cg-glow-ring)] hover:bg-[#a8f0d1]'
const GHOST = 'press inline-flex h-12 items-center justify-center gap-2 rounded-[12px] border border-white/25 px-6 text-[15px] font-semibold text-white hover:bg-white/10'

/** La entrada de CONTIGO: lo que el equipo ve antes de iniciar sesión. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCtx()) redirect('/hoy')
  const { error } = flat(await searchParams)
  const locale = await publicLocale()
  const t = translator(locale)
  const l = (x: L) => x[locale === 'en' ? 'en' : 'es']
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
  const signIn = (testId: string, className: string) =>
    sso ? (
      <a href="/auth/login" className={className} data-testid={testId}>
        {t('Entrar con Google', 'Sign in with Google')}
        <ArrowRight size={18} strokeWidth={2} aria-hidden />
      </a>
    ) : (
      <a href={personas.length ? '#personas' : '#preguntas'} className={className} data-testid={testId}>
        {personas.length ? t('Entrar con una persona de prueba', 'Sign in as a test persona') : t('Leer las preguntas', 'Read the questions')}
        <ArrowRight size={18} strokeWidth={2} aria-hidden />
      </a>
    )

  return (
    <div className="landing bg-black text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 backdrop-blur" data-testid="landing-nav">
        <div className={`${WRAP} flex h-16 items-center gap-6`}>
          <Image src="/contigo-on-dark.png" alt="axexo CONTIGO" width={208} height={52} priority className="h-9 w-auto" />
          <nav aria-label={t('Secciones', 'Sections')} className="ml-4 hidden items-center gap-6 desk:flex">
            {LANDING.nav.map((n) => (
              <a key={n.href} href={n.href} className="text-[14px] font-medium text-white/80 hover:text-white">
                {l(n.label)}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <form action={setLocale}>
              <input type="hidden" name="locale" value={locale === 'es' ? 'en' : 'es'} />
              <button className="rounded-full border border-white/25 px-4 py-2 text-[13px] font-semibold text-white/90 hover:bg-white/10" data-testid="locale-toggle">
                {locale === 'es' ? 'English' : 'Español'}
              </button>
            </form>
            <a href="#entrar" className="hidden h-10 items-center rounded-[10px] bg-white px-4 text-[14px] font-semibold text-black hover:bg-[#a8f0d1] md:inline-flex">
              {t('Entrar', 'Sign in')}
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* 1. Entrada */}
        <section id="entrar" className="relative isolate overflow-hidden" data-testid="landing-hero">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_85%_10%,rgba(61,220,151,0.28),transparent_60%),radial-gradient(50%_60%_at_0%_100%,rgba(14,107,92,0.45),transparent_65%)]" />
          <div className={`${WRAP} grid grid-cols-1 items-center gap-12 py-16 desk:grid-cols-[1.05fr_0.95fr] desk:py-24`}>
            <div>
              <p className="text-[13px] font-semibold tracking-[0.14em] text-[#3ddc97] uppercase">{l(LANDING.hero.eyebrow)}</p>
              <h1 className="mt-4 max-w-[17ch] text-[42px] leading-[1.04] font-bold text-white md:text-[58px]">{l(LANDING.hero.title)}</h1>
              <p className="mt-6 max-w-[52ch] text-[17px] leading-7 text-[#c5d2cc]">{l(LANDING.hero.sub)}</p>
              {error && ERRORS[error] && (
                <p role="alert" data-testid="login-error" className="mt-8 inline-block rounded-2xl bg-[#b42318] px-5 py-3 text-[14px] font-medium text-white">
                  {t(ERRORS[error][0], ERRORS[error][1])}
                </p>
              )}
              <div className="mt-9 flex flex-wrap items-center gap-3">
                {signIn(sso ? 'sso-login' : 'landing-enter', CTA)}
                <a href="#como" className={GHOST}>
                  {l(LANDING.hero.secondary)}
                </a>
              </div>
              {!sso && (
                <p className="mt-5 text-[14px] text-[#9fb0a8]" data-testid="sso-off">
                  {t('El inicio de sesión con Google todavía no está conectado en este ambiente.', 'Google sign-in is not connected in this environment yet.')}
                </p>
              )}
            </div>

            {/* Muestra de la cola de Hoy, con comercios de ejemplo */}
            <div aria-hidden className="mx-auto w-full max-w-[420px] rounded-[28px] border border-white/12 bg-[#0b100e] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
              <div className="rounded-[20px] border border-[#3ddc97]/30 bg-[radial-gradient(120%_160%_at_100%_0%,rgba(61,220,151,0.28),rgba(61,220,151,0)_55%)] p-5">
                <p className="text-[12px] font-semibold tracking-[0.12em] text-[#3ddc97] uppercase">{t('Lo siguiente', 'Up next')}</p>
                <p className="mt-2 text-[20px] leading-7 font-semibold text-white">{t('Abarrotes La Esquina', 'Corner Market')}</p>
                <p className="mt-1 text-[13.5px] text-[#c5d2cc]">{t('Llamar para confirmar la visita', 'Call to confirm the visit')}</p>
                <div className="mt-4 flex gap-2">
                  <span className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#3ddc97] px-4 text-[14px] font-semibold text-[#04130d]">
                    <Phone size={16} strokeWidth={2} />
                    {t('Llamar', 'Call')}
                  </span>
                  <span className="inline-flex h-10 items-center rounded-[10px] border border-white/25 px-4 text-[14px] font-semibold text-white">WhatsApp</span>
                </div>
              </div>
              {[
                { name: t('Miscelánea Don Beto', 'Sunrise Wireless'), what: t('Enviar propuesta', 'Send proposal'), tag: t('Vencido', 'Overdue'), tone: 'text-[#ffb4a8]' },
                { name: t('Súper El Mirador', 'Bayview Grocery'), what: t('Primer contacto', 'First contact'), tag: t('12 min', '12 min'), tone: 'text-[#f5cf7a]', clock: true },
                { name: t('Recargas El Sol', 'Main Street Cellular'), what: t('Sin próximo paso', 'No next step'), tag: t('Sugerencia', 'Suggestion'), tone: 'text-[#a8f0d1]' },
              ].map((r) => (
                <div key={r.name} className="mt-2.5 flex items-center gap-3 rounded-[16px] border border-white/10 bg-[#141a17] px-4 py-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/30" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium text-white">{r.name}</span>
                    <span className="block truncate text-[12.5px] text-[#9fb0a8]">{r.what}</span>
                  </span>
                  <span className={`inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold ${r.tone}`}>
                    {r.clock && <Clock size={13} strokeWidth={2} />}
                    {r.tag}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 2. Tu día */}
        <section id="como" className="scroll-mt-20 bg-[#f5f7f6] text-[#14201b]">
          <div className={`${WRAP} py-16 desk:py-20`}>
            <p className="text-[13px] font-semibold tracking-[0.14em] text-[#1b6b4e] uppercase">{l(LANDING.day.eyebrow)}</p>
            <h2 className="mt-3 max-w-[22ch] text-[32px] leading-[1.1] font-bold text-[#14201b] md:text-[40px]">{l(LANDING.day.title)}</h2>
            <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
              {LANDING.day.steps.map((s, i) => (
                <li key={s.title.es} className="rounded-[20px] border border-[#e4eae6] bg-white p-6">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#14201b] text-[16px] font-bold text-[#3ddc97]">{i + 1}</span>
                  <h3 className="mt-5 text-[19px] leading-6 font-semibold text-[#14201b]">{l(s.title)}</h3>
                  <p className="mt-2 text-[15px] leading-6 text-[#44524c]">{l(s.text)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 3. Por rol */}
        <section id="roles" className="scroll-mt-20 bg-white text-[#14201b]" data-testid="landing-roles">
          <div className={`${WRAP} py-16 desk:py-20`}>
            <p className="text-[13px] font-semibold tracking-[0.14em] text-[#1b6b4e] uppercase">{l(LANDING.roles.eyebrow)}</p>
            <h2 className="mt-3 max-w-[24ch] text-[32px] leading-[1.1] font-bold text-[#14201b] md:text-[40px]">{l(LANDING.roles.title)}</h2>
            <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 desk:grid-cols-3">
              {LANDING.roles.cards.map((c, i) => (
                <li key={c.track} className="lift rounded-[20px] border border-[#e4eae6] bg-[#f7f9f8] p-6">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-11 w-11 place-items-center rounded-[14px] bg-gradient-to-br text-[18px] font-bold text-[#04130d] ${TONES[i % TONES.length]}`}>{l(TRACK_LABEL[c.track]).charAt(0)}</span>
                    <h3 className="text-[18px] font-semibold text-[#14201b]">{l(TRACK_LABEL[c.track])}</h3>
                  </div>
                  <ul className="mt-5 space-y-2.5">
                    {c.points.map((p) => (
                      <li key={p.es} className="flex gap-2.5 text-[14.5px] leading-6 text-[#44524c]">
                        <Check size={18} strokeWidth={2.25} className="mt-[3px] shrink-0 text-[#24815f]" aria-hidden />
                        {l(p)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 4. Qué ya funciona */}
        <section id="estado" className="scroll-mt-20 bg-[#0b100e]" data-testid="landing-status">
          <div className={`${WRAP} grid grid-cols-1 gap-10 py-16 desk:grid-cols-2 desk:py-20`}>
            <div>
              <p className="text-[13px] font-semibold tracking-[0.14em] text-[#3ddc97] uppercase">{l(LANDING.status.eyebrow)}</p>
              <h2 className="mt-3 max-w-[18ch] text-[32px] leading-[1.1] font-bold text-white md:text-[40px]">{l(LANDING.status.title)}</h2>
              <p className="mt-5 max-w-[46ch] text-[16px] leading-7 text-[#c5d2cc]">{l(LANDING.status.text)}</p>
            </div>
            <ul className="space-y-2.5">
              {LANDING.status.rows.map((r) => (
                <li key={r.label.es} className="flex items-center gap-4 rounded-[16px] border border-white/10 bg-[#141a17] px-5 py-4">
                  <span className="flex-1 text-[15px] leading-6 text-white">{l(r.label)}</span>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] font-semibold ${r.state === 'on' ? 'bg-[#3ddc97] text-[#04130d]' : 'border border-white/25 text-[#c5d2cc]'}`}>
                    {l(r.state === 'on' ? LANDING.status.on : LANDING.status.soon)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 5. Datos del producto */}
        <section className="bg-[#f5f7f6] text-[#14201b]">
          <div className={`${WRAP} py-16 desk:py-20`}>
            <h2 className="max-w-[22ch] text-[32px] leading-[1.1] font-bold text-[#14201b] md:text-[40px]">{l(LANDING.facts.title)}</h2>
            <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 desk:grid-cols-4">
              {LANDING.facts.cards.map((c) => (
                <li key={c.title.es} className="rounded-[20px] border border-[#e4eae6] bg-white p-6">
                  <p className="text-[52px] leading-none font-bold text-[#24815f]">{c.figure}</p>
                  <h3 className="mt-3 text-[17px] font-semibold text-[#14201b]">{l(c.title)}</h3>
                  <p className="mt-2 text-[14.5px] leading-6 text-[#44524c]">{l(c.text)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 6. Entrar */}
        <section className="relative isolate overflow-hidden bg-black">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_120%_at_50%_120%,rgba(61,220,151,0.3),transparent_60%)]" />
          <div className={`${WRAP} flex flex-col items-center py-16 text-center desk:py-20`}>
            <h2 className="max-w-[20ch] text-[32px] leading-[1.1] font-bold text-white md:text-[40px]">{l(LANDING.cta.title)}</h2>
            <p className="mt-4 max-w-[48ch] text-[16px] leading-7 text-[#c5d2cc]">{l(LANDING.cta.text)}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {signIn('landing-enter-2', CTA)}
              <a href="#preguntas" className={GHOST}>
                {l(LANDING.cta.secondary)}
              </a>
            </div>
          </div>
        </section>

        {/* 7. Preguntas */}
        <section id="preguntas" className="scroll-mt-20 bg-white text-[#14201b]" data-testid="landing-faq">
          <div className={`${WRAP} max-w-[860px] py-16 desk:py-20`}>
            <p className="text-[13px] font-semibold tracking-[0.14em] text-[#1b6b4e] uppercase">{l(LANDING.faq.eyebrow)}</p>
            <h2 className="mt-3 text-[32px] leading-[1.1] font-bold text-[#14201b] md:text-[40px]">{l(LANDING.faq.title)}</h2>
            <div className="mt-8 divide-y divide-[#e4eae6] border-y border-[#e4eae6]">
              {faq.map((f) => (
                <details key={f.id} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center gap-4 py-4 text-[17px] font-semibold text-[#14201b] [&::-webkit-details-marker]:hidden">
                    <span className="flex-1">{l(f.q)}</span>
                    <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#d3dcd7] text-[18px] leading-none text-[#24815f] group-open:rotate-45">+</span>
                  </summary>
                  <p className="pr-12 pb-5 text-[15.5px] leading-7 text-[#44524c]">{l(f.a)}</p>
                </details>
              ))}
            </div>
            <div className="mt-10 rounded-[20px] bg-[#f2faf6] p-6">
              <h3 className="text-[18px] font-semibold text-[#14201b]">{l(LANDING.help.title)}</h3>
              <p className="mt-1.5 text-[15px] leading-6 text-[#44524c]">{l(LANDING.help.text)}</p>
            </div>
          </div>
        </section>

        {/* Personas de prueba: solo fuera de producción */}
        {personas.length > 0 && (
          <section id="personas" className="scroll-mt-20 bg-[#f5f7f6] text-[#14201b]" data-testid="personas">
            <div className={`${WRAP} py-16`}>
              <p className="text-[13px] font-semibold tracking-[0.14em] text-[#1b6b4e] uppercase">{t('Ambiente de prueba · datos sintéticos', 'Test environment · synthetic data')}</p>
              <h2 className="mt-3 text-[28px] font-bold text-[#14201b]">{t('Entra como una persona de prueba', 'Sign in as a test persona')}</h2>
              <p className="mt-3 max-w-2xl text-[15px] leading-6 text-[#44524c]">
                {t('Cada persona ve solo lo que su rol y su mercado permiten. Sirve para revisar los permisos sin tocar datos reales.', 'Each persona sees only what their role and market allow. Use it to review permissions without touching real data.')}
              </p>
              <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {personas.map((p) => (
                  <form key={p.id} action={loginAsPersona}>
                    <input type="hidden" name="user_id" value={p.id} />
                    <button className="lift w-full cursor-pointer rounded-[16px] border border-[#e4eae6] bg-white p-5 text-left" data-testid={`persona-${p.email.split('@')[0]}`}>
                      <span className="block text-[15px] font-semibold text-[#14201b]">{p.full_name}</span>
                      <span className="mt-1 block text-[13px] text-[#44524c]">{describe(p.roles)}</span>
                    </button>
                  </form>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-white/10 bg-black">
        <div className={`${WRAP} flex flex-col gap-6 py-10 md:flex-row md:items-center`}>
          <div>
            <Image src="/contigo-on-dark.png" alt="axexo CONTIGO" width={176} height={44} className="h-8 w-auto" />
            <p className="mt-3 text-[14px] text-[#c5d2cc]">{l(LANDING.footer.tagline)}</p>
          </div>
          <p className="text-[13px] text-[#9fb0a8] md:ml-auto">{l(LANDING.footer.note)}</p>
        </div>
      </footer>
    </div>
  )
}
