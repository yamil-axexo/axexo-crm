import 'server-only'
import type { Tx } from '@/server/db'
import type { Ctx, Market } from '@/server/context'
import { can, type Membership } from '@/domain/policy'
import { translator, type Locale } from '@/lib/format'
import { messages } from '@/lib/messages'
import { forbidden } from '@/lib/errors'

/**
 * El contexto del usuario de sistema, leído dentro de la transacción que ya corre (una tarea programada no abre otra
 * conexión para saber quién es). Solo vale si la transacción corre con la identidad de sistema.
 */
export async function sysCtxOf(tx: Tx): Promise<Ctx> {
  const users = await tx<{ id: string; full_name: string; email: string }[]>`
    select id, full_name, email::text from crm.users where id = app.current_user_id() and is_system and is_active`
  const u = users[0]
  if (!u) throw new Error('scheduled work runs as the system user')
  const rows = await tx<{ code: string; name: string; currency: string; default_locale: Locale; timezone: string; phone_cc: string; status: 'live' | 'planned'; flags: Record<string, unknown>; workdays: number[] | null }[]>`
    select code, name, currency, default_locale, timezone, phone_cc, status, flags,
           (select h.days from crm.market_hours h where h.market_code = crm.markets.code) as workdays from crm.markets order by status, code`
  const memberships: Membership[] = [{ market: null, role: 'admin', teamId: null }]
  const markets: Market[] = rows.map((m) => ({
    code: m.code, name: m.name, currency: m.currency.trim(), locale: m.default_locale, timezone: m.timezone, phoneCc: m.phone_cc, status: m.status,
    closeByTransaction: m.flags?.close_by_transaction !== false, workdays: m.workdays?.length ? m.workdays : [1, 2, 3, 4, 5],
  }))
  return {
    user: { id: u.id, name: u.full_name, email: u.email, isSystem: true },
    memberships, markets, locale: 'es', t: translator('es'), m: messages('es'), isAdmin: true, isGlobal: true,
    can: (cap, market) => can(memberships, cap, market),
    assert: (cap, market) => {
      if (!can(memberships, cap, market)) throw forbidden()
    },
    market: (code) => {
      const m = markets.find((x) => x.code === code)
      if (!m) throw forbidden()
      return m
    },
  }
}
