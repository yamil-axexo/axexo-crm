import 'server-only'
import { withUser } from '@/server/db'
import { loadCtx } from '@/server/context'
import { homePath, type Home } from '@/domain/policy'

/**
 * A dónde va una persona al iniciar sesión: la primera vez a la bienvenida; después, a la pantalla de su rol, que decide
 * una sola función (`homePath`): Hoy, la cola de Operaciones, Mi equipo, el Panel del LT o Administración.
 */
export async function firstStop(userId: string): Promise<'/bienvenida' | Home> {
  const rows = await withUser(userId, (tx) => tx<{ user_id: string }[]>`
    insert into crm.user_onboarding (user_id) values (${userId}) on conflict (user_id) do nothing returning user_id`)
  if (rows.length > 0) return '/bienvenida'
  const ctx = await loadCtx(userId)
  return ctx ? homePath(ctx.memberships) : '/hoy'
}
