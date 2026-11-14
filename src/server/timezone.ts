import 'server-only'
import { cookies } from 'next/headers'
import type { Ctx } from '@/server/context'
import { validTimeZone } from '@/lib/audit'

export const TZ_COOKIE = 'contigo_tz'

/**
 * La zona horaria de quien lee. El navegador la deja en una cookie (`TimezoneSync`); mientras no exista se usa la del
 * mercado de la persona y, para roles globales sin mercado propio, UTC. La pantalla siempre escribe qué zona usó.
 */
export async function readerTimeZone(ctx: Ctx): Promise<string> {
  const raw = (await cookies()).get(TZ_COOKIE)?.value
  const fromBrowser = raw ? decodeURIComponent(raw) : null
  if (validTimeZone(fromBrowser)) return fromBrowser
  const own = ctx.memberships.find((m) => m.market)?.market
  return (own && ctx.markets.find((m) => m.code === own)?.timezone) || 'UTC'
}
