import postgres from 'postgres'
import { withUser, withoutUser } from '@/server/db'
import { loadCtx, type Ctx } from '@/server/context'

/** Mismo ID determinista que usa el seed: md5('contigo:' || clave). */
export async function personaId(key: string): Promise<string> {
  const rows = await withoutUser((tx) => tx<{ id: string }[]>`select md5(${'contigo:' + key})::uuid as id`)
  return rows[0]!.id
}

export async function ctxFor(key: string): Promise<Ctx> {
  const ctx = await loadCtx(await personaId(key), 'es')
  if (!ctx) throw new Error(`persona ${key} not found`)
  return ctx
}

export async function systemContext(): Promise<Ctx> {
  const rows = await withoutUser((tx) => tx<{ id: string }[]>`select app.system_user_id() as id`)
  return (await loadCtx(rows[0]!.id, 'es'))!
}

/** Corre SQL como la persona (rol de la app + identidad) y revierte al final: las pruebas de permisos no ensucian la base. */
export async function asPersona<T>(key: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const id = await personaId(key)
  let out: T
  try {
    await withUser(id, async (tx) => {
      out = await fn(tx)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  return out!
}
class Rollback extends Error {}

/** Devuelve el código de error de Postgres de una sentencia, o 'ok'/'0 rows'. Usa savepoint para no abortar la transacción. */
export async function attempt(tx: postgres.TransactionSql, run: (sp: postgres.TransactionSql) => Promise<{ count: number }>): Promise<string> {
  try {
    const res = await tx.savepoint((sp) => run(sp as unknown as postgres.TransactionSql))
    return res.count === 0 ? '0 rows' : 'ok'
  } catch (e) {
    return (e as { code?: string }).code ?? 'error'
  }
}

export const owner = () => postgres(process.env.UNIT_MIGRATION_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/contigo_unit', { max: 1, onnotice: () => {} })

/** E4.F9 (datos2): la aprobación del asiento que todo acceso nuevo necesita en las pruebas. */
export const SEAT = { seatApprover: 'Responsable del presupuesto (prueba)', seatApprovedOn: new Date().toISOString().slice(0, 10) }
