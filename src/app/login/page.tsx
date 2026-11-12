import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getCtx, publicLocale } from '@/server/context'
import { withoutUser } from '@/server/db'
import { personasEnabled, ssoEnabled } from '@/env'
import { translator } from '@/lib/format'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { loginAsPersona, setLocale } from '@/app/session-actions'
import { buttonClass } from '@/ui/kit'
import { flat } from '@/server/params'

const ERRORS: Record<string, [string, string]> = {
  domain: ['Entra con tu cuenta de trabajo.', 'Sign in with your work account.'],
  no_access: ['Tu cuenta todavía no tiene acceso. Pídelo a quien administra CONTIGO.', 'Your account does not have access yet. Ask a CONTIGO admin.'],
  provider: ['No pudimos completar el inicio de sesión. Intenta otra vez.', 'We could not complete the sign-in. Try again.'],
  invalid: ['No pudimos abrir esa sesión.', 'We could not open that session.'],
  disabled: ['Ese modo de entrada está apagado.', 'That sign-in mode is turned off.'],
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCtx()) redirect('/hoy')
  const { error } = flat(await searchParams)
  const locale = await publicLocale()
  const t = translator(locale)
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

  return (
    <main className="mx-auto flex min-h-full max-w-[1080px] flex-col justify-center px-8 py-14">
      <section className="stage on-ink rounded-[34px] px-12 py-14">
        <div className="flex items-start justify-between gap-6">
          <Image src="/contigo-on-dark.png" alt="axexo CONTIGO" width={260} height={64} priority className="h-12 w-auto" />
          <form action={setLocale}>
            <input type="hidden" name="locale" value={locale === 'es' ? 'en' : 'es'} />
            <button className="rounded-full border border-white/20 px-4 py-2 text-[13px] font-semibold text-white/80 hover:bg-white/10" data-testid="locale-toggle">
              {locale === 'es' ? 'English' : 'Español'}
            </button>
          </form>
        </div>
        <h1 className="mt-12 max-w-2xl text-[46px] leading-[1.05] font-bold">
          {t('Cada comercio, de la primera visita a la primera venta.', 'Every merchant, from the first visit to the first sale.')}
        </h1>
        <p className="mt-5 max-w-xl text-[16px] text-muted-2">
          {t(
            'Un solo lugar para leads, embudos, cuentas y seguimiento. Las visitas llegan de la Sales App y las ventas de S5.',
            'One place for leads, pipelines, accounts and follow-up. Visits arrive from the Sales App and sales from S5.',
          )}
        </p>
        {error && ERRORS[error] && (
          <p role="alert" data-testid="login-error" className="mt-8 inline-block rounded-2xl bg-red/20 px-5 py-3 text-[14px] font-medium text-white">
            {t(ERRORS[error][0], ERRORS[error][1])}
          </p>
        )}
        <div className="mt-10">
          {ssoEnabled() ? (
            <a href="/auth/login" className={buttonClass('primary')} data-testid="sso-login">
              {t('Entrar con Google', 'Sign in with Google')}
            </a>
          ) : (
            <p className="text-[14px] text-muted-2" data-testid="sso-off">
              {t('El inicio de sesión con Google todavía no está conectado en este ambiente.', 'Google sign-in is not connected in this environment yet.')}
            </p>
          )}
        </div>
      </section>

      {personas.length > 0 && (
        <section className="mt-10" data-testid="personas">
          <p className="eyebrow">{t('Ambiente de staging · datos sintéticos', 'Staging environment · synthetic data')}</p>
          <h2 className="mt-2 text-[22px] font-semibold">{t('Entra como una persona de prueba', 'Sign in as a test persona')}</h2>
          <p className="mt-2 max-w-2xl text-[14px] text-muted-2">
            {t('Cada persona ve solo lo que su rol y su mercado permiten. Sirve para revisar los permisos sin tocar datos reales.', 'Each persona sees only what their role and market allow. Use it to review permissions without touching real data.')}
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {personas.map((p) => (
              <form key={p.id} action={loginAsPersona}>
                <input type="hidden" name="user_id" value={p.id} />
                <button className="card lift w-full cursor-pointer p-5 text-left" data-testid={`persona-${p.email.split('@')[0]}`}>
                  <span className="block text-[15px] font-semibold text-strong">{p.full_name}</span>
                  <span className="mt-1 block text-[13px] text-muted-2">{describe(p.roles)}</span>
                </button>
              </form>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
