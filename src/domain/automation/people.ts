import 'server-only'
import type { Tx } from '@/server/db'

/** Quiénes tienen un rol en un mercado. Para supervisión, primero quienes supervisan el equipo de la persona de referencia. */
export async function peopleWithRole(tx: Tx, market: string, role: string, forUserId: string | null): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`select app.people_with_role(${market}, ${role}, ${forUserId}) as id`
  return rows.map((r) => r.id)
}

/** A quién va algo: quien lleva el registro, quienes tienen un rol, o una persona. Sin dueño, sube a supervisión. */
export async function resolveTarget(tx: Tx, to: string, rec: { market_code: string; ball_owner_id: string | null }): Promise<string[]> {
  if (to === 'owner') return rec.ball_owner_id ? [rec.ball_owner_id] : peopleWithRole(tx, rec.market_code, 'supervisor', null)
  if (to.startsWith('role:')) {
    const people = await peopleWithRole(tx, rec.market_code, to.slice(5), rec.ball_owner_id)
    // Un mercado sin supervisión no deja el aviso en el aire: sube a quien lo lidera.
    return people.length || to !== 'role:supervisor' ? people : peopleWithRole(tx, rec.market_code, 'market_lead', null)
  }
  if (to.startsWith('user:')) {
    const id = to.slice(5)
    const ok = await tx<{ ok: boolean }[]>`select app.works_in(${id}, ${rec.market_code}) as ok`
    return ok[0]?.ok ? [id] : []
  }
  return []
}
