import 'server-only'
import { withUser } from '@/server/db'

/** A dónde va una persona al iniciar sesión: la primera vez a la bienvenida, después a Hoy; Operaciones, a su cola. */
export async function firstStop(userId: string): Promise<'/bienvenida' | '/hoy' | '/operaciones'> {
  const rows = await withUser(userId, (tx) => tx<{ user_id: string }[]>`
    insert into crm.user_onboarding (user_id) values (${userId}) on conflict (user_id) do nothing returning user_id`)
  if (rows.length > 0) return '/bienvenida'
  // Quien es de Operaciones (y no vende ni dirige) empieza en su cola.
  const ops = await withUser(userId, (tx) => tx<{ ops: boolean }[]>`
    select coalesce(bool_or(role = 'ops'), false) and not coalesce(bool_or(role in ('admin', 'market_lead', 'supervisor', 'rep')), false) as ops from app.active_memberships()`)
  return ops[0]?.ops ? '/operaciones' : '/hoy'
}
