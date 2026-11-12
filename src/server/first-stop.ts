import 'server-only'
import { withUser } from '@/server/db'

/** A dónde va una persona al iniciar sesión: la primera vez a la bienvenida, después a Hoy. */
export async function firstStop(userId: string): Promise<'/bienvenida' | '/hoy'> {
  const rows = await withUser(userId, (tx) => tx<{ user_id: string }[]>`
    insert into crm.user_onboarding (user_id) values (${userId}) on conflict (user_id) do nothing returning user_id`)
  return rows.length > 0 ? '/bienvenida' : '/hoy'
}
