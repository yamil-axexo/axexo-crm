import 'server-only'
import postgres from 'postgres'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { env } from '@/env'
import { currentRequestId } from '@/server/request-id'

/**
 * SEG-03: por dónde entra cada cambio. La bitácora que escribe la base lo guarda en cada fila (app.via).
 * Sin declarar, un cambio con identidad es de la pantalla; uno del usuario de sistema, de una integración o tarea.
 */
export type Via = 'screen' | 'api' | 'form' | 'import' | 'job'
const viaStore = new AsyncLocalStorage<{ via: Via; requestId: string }>()
export function runVia<T>(via: Via, fn: () => Promise<T>): Promise<T> {
  return viaStore.run({ via, requestId: randomUUID() }, fn)
}

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
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  // GOB-07: el identificador de la petición viaja con la transacción y queda en cada evento de la bitácora.
  const requestId = await currentRequestId()
  return client().begin(async (tx) => {
    // SEG-03 y GOB-07: la vía de entrada y un solo identificador de petición (el de la entrada; si no hay, el de la vía).
    const v = viaStore.getStore()
    await tx`select set_config('app.user_id', ${userId}, true), set_config('app.via', ${v?.via ?? ''}, true), set_config('app.request_id', ${requestId || v?.requestId || ''}, true)`
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

/**
 * "Hoy" de un mercado, en SQL: la fecha de calendario en su zona horaria (DATA-04) y no la del servidor.
 * El servidor corre en UTC y cambia de día a las 18:00 de Ciudad de México: con `current_date`, una tarea de hoy
 * salía vencida y un próximo paso de hoy contaba como faltante durante toda la tarde.
 * `market` es una columna (fragmento de SQL) o un código de mercado.
 */
export const marketToday = (tx: Tx, market: postgres.Fragment | string) =>
  tx`(now() at time zone coalesce((select mk.timezone from crm.markets mk where mk.code = ${market}), 'UTC'))::date`

/**
 * El día hábil del mercado que cae `plus` días después de hoy: si ese día el mercado no trabaja (su horario hábil, por
 * defecto lunes a viernes) o es festivo en ese mercado (crm.market_holidays), el siguiente que sí. Un próximo paso por
 * defecto no cae en sábado, en domingo ni en festivo.
 */
export const marketWorkday = (tx: Tx, market: string, plus: number) =>
  tx`(select g::date from generate_series(${marketToday(tx, market)} + ${plus}::int, ${marketToday(tx, market)} + ${plus}::int + 14, interval '1 day') g
       where extract(isodow from g)::int = any(coalesce((select h.days from crm.market_hours h where h.market_code = ${market}), '{1,2,3,4,5}'::int[]))
         and not exists (select 1 from crm.market_holidays f where f.market_code = ${market} and f.day = g::date)
       order by g limit 1)`
