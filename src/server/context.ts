import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createHash, randomBytes } from 'node:crypto'
import { withUser, withoutUser, systemUserId } from '@/server/db'
import { can, isFullAdmin, READ_CAPS, type AdminArea, type Capability, type Membership, type Role } from '@/domain/policy'
import { translator, type Locale, type T } from '@/lib/format'
import { messages, type M } from '@/lib/messages'
import { forbidden } from '@/lib/errors'

export const SESSION_COOKIE = 'contigo_session'
export const LOCALE_COOKIE = 'contigo_locale'
export const VIEW_AS_COOKIE = 'contigo_view_as'

/** SEG-07: quien administra accesos está viendo CONTIGO como otra persona, en solo lectura y por tiempo limitado. */
export type ViewAs = { id: string; actorId: string; actorName: string; until: string }

export type Market = {
  code: string
  name: string
  currency: string
  locale: Locale
  timezone: string
  phoneCc: string
  status: 'live' | 'planned'
  closeByTransaction: boolean
  /** E9: el mercado lleva la ficha de dealer (ventas e identificadores primero, carriers, origen, reclutado por). */
  dealerRecord: boolean
  /** Días en que el mercado trabaja (1 = lunes ... 7 = domingo), de su horario hábil. */
  workdays: number[]
}

export type Ctx = {
  /** `locale` es el idioma guardado de la persona (los avisos se escriben en ese idioma), que puede no ser el de la pantalla. */
  user: { id: string; name: string; email: string; isSystem: boolean; locale?: Locale }
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
  /** Presente solo mientras alguien "ve como" esta persona: nada se puede cambiar. */
  viewAs?: ViewAs
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export async function loadCtx(userId: string, localeOverride?: Locale, viewAs?: ViewAs): Promise<Ctx | null> {
  return withUser(userId, async (tx) => {
    const users = await tx<{ id: string; full_name: string; email: string; locale: Locale; is_system: boolean }[]>`
      select id, full_name, email::text, locale, is_system from crm.users where id = ${userId} and is_active`
    const u = users[0]
    if (!u) return null
    const ms = await tx<{ market_code: string | null; role: Role; team_id: string | null; admin_areas: AdminArea[] | null }[]>`
      select market_code, role, team_id, admin_areas from app.active_memberships_x()`
    if (ms.length === 0) return null
    const markets = await tx<
      { code: string; name: string; currency: string; default_locale: Locale; timezone: string; phone_cc: string; status: 'live' | 'planned'; flags: Record<string, unknown>; workdays: number[] | null }[]
    >`select code, name, currency, default_locale, timezone, phone_cc, status, flags,
             (select h.days from crm.market_hours h where h.market_code = crm.markets.code) as workdays
        from crm.markets where code = any(app.my_markets()) order by status, code`
    const memberships: Membership[] = ms.map((m) => ({ market: m.market_code, role: m.role, teamId: m.team_id, areas: m.admin_areas }))
    // Mientras alguien ve como otra persona solo quedan vivas las capacidades de lectura: no cambia, no exporta, no revela.
    const allowed = (cap: Capability, market?: string | null) => (!viewAs || READ_CAPS.includes(cap)) && can(memberships, cap, market)
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
      dealerRecord: m.flags?.dealer_record === true,
      workdays: m.workdays?.length ? m.workdays : [1, 2, 3, 4, 5],
    }))
    const ctx: Ctx = {
      user: { id: u.id, name: u.full_name, email: u.email, isSystem: u.is_system, locale: u.locale },
      memberships,
      markets: list,
      locale,
      t: translator(locale),
      m: messages(locale),
      isAdmin: isFullAdmin(memberships),
      isGlobal: memberships.some((m) => m.role === 'admin' || m.role === 'lt'),
      can: allowed,
      assert: (cap, market) => {
        if (!allowed(cap, market)) throw forbidden()
      },
      market: (code) => {
        const m = list.find((x) => x.code === code)
        if (!m) throw forbidden()
        return m
      },
      viewAs,
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
  const viewId = jar.get(VIEW_AS_COOKIE)?.value
  if (viewId && /^[0-9a-f-]{36}$/i.test(viewId)) {
    // La base decide si la sesión de "ver como" sigue viva: de quien la abrió, sin terminar, sin vencer y con su permiso vigente.
    const v = await withoutUser((tx) => tx<{ target_id: string; expires_at: Date; actor_name: string }[]>`
      select target_id, expires_at, actor_name from app.view_as_current(${viewId}, ${userId})`)
    if (v[0]) {
      const seen = await loadCtx(v[0].target_id, await sessionLocale(), { id: viewId, actorId: userId, actorName: v[0].actor_name, until: v[0].expires_at.toISOString() })
      if (seen) return seen
    }
  }
  return loadCtx(userId, await sessionLocale())
})

/** La persona real detrás de la sesión, sin importar si está viendo como otra. */
export async function sessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const rows = await withoutUser((tx) => tx<{ id: string | null }[]>`select app.session_user(${hash(token)}) as id`)
  return rows[0]?.id ?? null
}

/** En modo "ver como" nada cambia: lo usan las acciones que no pasan por runAction. */
export function assertNotViewAs(ctx: Ctx): void {
  if (ctx.viewAs) throw forbidden()
}

/**
 * Idioma de una persona con sesión. Manda lo que eligió con el interruptor (la cookie). Si todavía no ha elegido,
 * la app hereda el del navegador, igual que la entrada, para que el primer ingreso no cambie de idioma al pasar de
 * /login a la app. Solo cuando la solicitud no dice qué idioma quiere (una llamada sin Accept-Language) vale el
 * idioma guardado en su usuario.
 */
export async function sessionLocale(): Promise<Locale | undefined> {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value
  if (raw === 'en' || raw === 'es') return raw
  const accept = (await headers()).get('accept-language')
  return accept?.trim() ? browserLocale(accept) : undefined
}

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

/**
 * El idioma del navegador, leído de Accept-Language: inglés si es el primero que el navegador pide (el caso de US);
 * español en todo lo demás, también cuando el encabezado no viene.
 */
export function browserLocale(acceptLanguage: string | null | undefined): Locale {
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='))
      const weight = q ? Number(q.slice(2)) : 1
      return { tag: tag.toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, i }
    })
    .filter((x) => x.tag && x.tag !== '*' && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
  const first = ranked[0]?.tag ?? ''
  return first === 'en' || first.startsWith('en-') ? 'en' : 'es'
}

/** Idioma de las páginas sin sesión (la entrada): gana lo que la persona eligió con el interruptor; si no ha elegido, el del navegador. */
export async function publicLocale(): Promise<Locale> {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value
  if (raw === 'en' || raw === 'es') return raw
  return browserLocale((await headers()).get('accept-language'))
}
