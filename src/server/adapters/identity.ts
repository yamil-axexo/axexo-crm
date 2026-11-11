import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { env } from '@/env'

// PORT-04: el proveedor de identidad vive detrás de esta interfaz.
// Staging usa Supabase Auth como intermediario OIDC de Google Workspace.
// En AWS la misma interfaz se implementa con Cognito (o OIDC directo); ver docs/adr/ADR-004-identidad.md.
export type VerifiedIdentity = {
  email: string
  subject: string
  name: string
  emailVerified: boolean
}

export interface IdentityProvider {
  /** URL a la que se redirige a la persona para autenticarse. */
  startLogin(callbackUrl: string): Promise<string>
  /** Intercambia el código del callback por una identidad verificada. No deja sesión del proveedor. */
  completeLogin(code: string): Promise<VerifiedIdentity | null>
}

async function supabase() {
  const jar = await cookies()
  return createServerClient(env().SUPABASE_URL!, env().SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        for (const c of list) jar.set(c.name, c.value, c.options)
      },
    },
  })
}

const supabaseProvider: IdentityProvider = {
  async startLogin(callbackUrl) {
    const client = await supabase()
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl,
        skipBrowserRedirect: true,
        queryParams: { hd: env().AUTH_ALLOWED_DOMAIN, prompt: 'select_account' },
      },
    })
    if (error || !data.url) throw new Error('identity provider did not return a login URL')
    return data.url
  },
  async completeLogin(code) {
    const client = await supabase()
    const { data, error } = await client.auth.exchangeCodeForSession(code)
    if (error || !data.user?.email) return null
    const u = data.user
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>
    const identity: VerifiedIdentity = {
      email: u.email!.toLowerCase(),
      subject: u.id,
      name: typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : u.email!,
      emailVerified: Boolean(u.email_confirmed_at) && meta.email_verified !== false,
    }
    // La sesión de CONTIGO es propia (cookie opaca); no conservamos la del proveedor.
    await client.auth.signOut({ scope: 'local' })
    return identity
  },
}

export function identityProvider(): IdentityProvider {
  return supabaseProvider
}

/** AUTHZ-01: el dominio se fuerza en el servidor, no se confía en el parámetro "hd" del navegador. */
export function allowedEmail(identity: VerifiedIdentity): boolean {
  return identity.emailVerified && identity.email.endsWith(`@${env().AUTH_ALLOWED_DOMAIN.toLowerCase()}`)
}
