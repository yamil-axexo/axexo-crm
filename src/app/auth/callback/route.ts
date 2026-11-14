import { NextResponse, type NextRequest } from 'next/server'
import { ssoEnabled, bootstrapAdmins } from '@/env'
import { allowedEmail, identityProvider } from '@/server/adapters/identity'
import { firstStop } from '@/server/first-stop'
import { createSession } from '@/server/context'
import { withoutUser } from '@/server/db'

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, origin))
  const code = request.nextUrl.searchParams.get('code')
  if (!ssoEnabled() || !code) return fail('provider')
  const identity = await identityProvider().completeLogin(code).catch(() => null)
  if (!identity) return fail('provider')
  if (!allowedEmail(identity)) return fail('domain') // AUTHZ-01
  const bootstrap = bootstrapAdmins().includes(identity.email)
  const rows = await withoutUser((tx) =>
    tx<{ id: string | null }[]>`select app.sso_user(${identity.email}, ${identity.subject}, ${identity.name}, ${bootstrap}) as id`,
  )
  const userId = rows[0]?.id
  if (!userId) return fail('no_access')
  await createSession(userId, 'sso')
  return NextResponse.redirect(new URL(await firstStop(userId), origin))
}
