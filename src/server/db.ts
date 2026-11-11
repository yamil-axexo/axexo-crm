import 'server-only'
import postgres from 'postgres'
import { env } from '@/env'

// PORT-01 / PORT-02: este es el único punto de conexión a la base y solo corre en el servidor.
// PERF-04: compatible con pooler en modo transacción (sin prepared statements; la identidad viaja con set_config local).
type Sql = ReturnType<typeof postgres>
export type Tx = postgres.TransactionSql

const g = globalThis as unknown as { __contigoSql?: Sql }

function client(): Sql {
  if (!g.__contigoSql) {
    const url = env().DATABASE_URL
    const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
    g.__contigoSql = postgres(url, {
      ssl: local ? false : 'require', // fuera de la máquina local, siempre cifrado en tránsito
      max: env().APP_ENV === 'test' ? 4 : 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => {},
    })
  }
  return g.__contigoSql
}

/** AUTHZ-04: toda consulta de negocio corre dentro de una transacción con la identidad fijada. */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return client().begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`
    return fn(tx)
  }) as Promise<T>
}

/** Sin identidad: solo sirve para las funciones de sesión (SECURITY DEFINER). RLS niega todo lo demás. */
export function withoutUser<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return client().begin(async (tx) => fn(tx)) as Promise<T>
}

export async function withSystem<T>(fn: (tx: Tx, systemUserId: string) => Promise<T>): Promise<T> {
  const id = await systemUserId()
  return withUser(id, (tx) => fn(tx, id))
}

let sysId: string | undefined
export async function systemUserId(): Promise<string> {
  if (sysId) return sysId
  const rows = await withoutUser((tx) => tx<{ id: string }[]>`select app.system_user_id() as id`)
  const id = rows[0]?.id
  if (!id) throw new Error('system user is missing: run migrations')
  sysId = id
  return id
}

export async function dbHealth(): Promise<{ ok: boolean }> {
  const rows = await withoutUser((tx) => tx<{ ok: boolean }[]>`select app.system_user_id() is not null as ok`)
  return { ok: rows[0]?.ok === true }
}
