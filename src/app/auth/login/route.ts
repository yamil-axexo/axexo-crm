import { NextResponse, type NextRequest } from 'next/server'
import { ssoEnabled } from '@/env'
import { identityProvider } from '@/server/adapters/identity'

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  if (!ssoEnabled()) return NextResponse.redirect(new URL('/login?error=disabled', origin))
  try {
    const url = await identityProvider().startLogin(`${origin}/auth/callback`)
    return NextResponse.redirect(url)
  } catch {
    return NextResponse.redirect(new URL('/login?error=provider', origin))
  }
}
