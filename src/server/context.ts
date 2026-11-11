import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createHash, randomBytes } from 'node:crypto'
import { withUser, withoutUser, systemUserId } from '@/server/db'
import { can, type Capability, type Membership, type Role } from '@/domain/policy'
import { translator, type Locale, type T } from '@/lib/format'
import { messages, type M } from '@/lib/messages'
import { forbidden } from '@/lib/errors'

export const SESSION_COOKIE = 'contigo_session'
export const LOCALE_COOKIE = 'contigo_locale'

export type Market = {
  code: string
  name: string
  currency: string
  locale: Locale
  timezone: string
  phoneCc: string
  status: 'live' | 'planned'
  closeByTransaction: boolean
}

export type Ctx = {
  user: { id: string; name: string; email: string; isSystem: boolean }
  memberships: Membership[]
  markets: Market[]
  locale: Locale
  t: T
  m: M
  isAdmin: boolean
  isGlobal: boolean
  can: (cap: Capability, market?: string | null) => boolean
  assert: (cap: Capability, market?: string | null) => void
  market: (code: string) => Market
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export async function loadCtx(userId: string, localeOverride?: Locale): Promise<Ctx | null> {
  return withUser(userId, async (tx) => {
    const users = await tx<{ id: string; full_name: string; email: string; locale: Locale; is_system: boolean }[]>`
      select id, full_name, email::text, locale, is_system from crm.users where id = ${userId} and is_active`
    const u = users[0]
    if (!u) return null
    const ms = await tx<{ market_code: string | null; role: Role; team_id: string | null }[]>`
      select market_code, role, team_id from app.active_memberships()`
    if (ms.length === 0) return null
    const markets = await tx<
      { code: string; name: string; currency: string; default_locale: Locale; timezone: string; phone_cc: string; status: 'live' | 'planned'; flags: Record<string, unknown> }[]
    >`select code, name, currency, default_locale, timezone, phone_cc, status, flags
        from crm.markets where code = any(app.my_markets()) order by status, code`
    const memberships: Membership[] = ms.map((m) => ({ market: m.market_code, role: m.role, teamId: m.team_id }))
    const locale = localeOverride ?? u.locale
    const list: Market[] = markets.map((m) => ({
      code: m.code,
      name: m.name,
      currency: m.currency.trim(),
      locale: m.default_locale,
      timezone: m.timezone,
      phoneCc: m.phone_cc,
      status: m.status,
      closeByTransaction: m.flags?.close_by_transaction !== false,
    }))
    const ctx: Ctx = {
      user: { id: u.id, name: u.full_name, email: u.email, isSystem: u.is_system },
      memberships,
      markets: list,
      locale,
      t: translator(locale),
      m: messages(locale),
      isAdmin: memberships.some((m) => m.role === 'admin'),
      isGlobal: memberships.some((m) => m.role === 'admin' || m.role === 'lt'),
      can: (cap, market) => can(memberships, cap, market),
      assert: (cap, market) => {
        if (!can(memberships, cap, market)) throw forbidden()
      },
      market: (code) => {
        const m = list.find((x) => x.code === code)
        if (!m) throw forbidden()
        return m
      },
    }
    return ctx
  })
}

/** Contexto de la persona que hace la solicitud, o null si no hay sesión válida. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const rows = await withoutUser((tx) => tx<{ id: string | null }[]>`select app.session_user(${hash(token)}) as id`)
  const userId = rows[0]?.id
  if (!userId) return null
  const raw = jar.get(LOCALE_COOKIE)?.value
  return loadCtx(userId, raw === 'en' || raw === 'es' ? raw : undefined)
})

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  return ctx
}

/** Contexto del usuario de sistema: lo usan las entradas de integración (formularios, Sales App, S5). */
export async function systemCtx(): Promise<Ctx> {
  const ctx = await loadCtx(await systemUserId(), 'es')
  if (!ctx) throw new Error('system user is not provisioned')
  return ctx
}

export async function createSession(userId: string, kind: 'persona' | 'sso'): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  await withoutUser((tx) => tx`select app.session_create(${userId}, ${hash(token)}, ${kind}, ${12})`)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  })
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await withoutUser((tx) => tx`select app.session_delete(${hash(token)})`)
  jar.delete(SESSION_COOKIE)
}

export async function publicLocale(): Promise<Locale> {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value
  return raw === 'en' ? 'en' : 'es'
}
