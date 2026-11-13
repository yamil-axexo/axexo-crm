import type { Job } from './types'
import type { Tx } from '@/server/db'
import { stateZone } from '@/lib/markets'

/**
 * Tareas programadas del paquete datos. Las dos son seguras de correr dos veces: la búsqueda de duplicados no reabre un par
 * ya decidido y el corte de calidad reemplaza el del mismo día.
 */
export const datosJobs: Job[] = [
  {
    key: 'datos.duplicate_scan',
    everyMinutes: 24 * 60,
    description: {
      es: 'Busca comercios que parecen el mismo (teléfono, correo, nombre y dirección, nombre parecido) y los deja en la cola de duplicados.',
      en: 'Looks for merchants that seem to be the same (phone, email, name and address, similar name) and puts them in the duplicates queue.',
    },
    run: async (tx) => {
      const rows = await tx<{ n: number }[]>`select app.scan_duplicates(null) as n`
      return { done: rows[0]?.n ?? 0 }
    },
  },
  {
    key: 'datos.quality_snapshot',
    everyMinutes: 24 * 60,
    description: {
      es: 'Guarda el corte diario de calidad de datos por mercado, equipo y regla. De ahí sale la tendencia del tablero.',
      en: 'Saves the daily data quality snapshot by market, team and rule. The board trend comes from it.',
    },
    run: async (tx) => {
      const rows = await tx<{ n: number }[]>`select app.quality_snapshot() as n`
      return { done: rows[0]?.n ?? 0 }
    },
  },
  // Paquete datos2 (MULTI-02): la zona del estado para los comercios nuevos que no tienen una propia.
  {
    key: 'datos.account_timezones',
    everyMinutes: 24 * 60,
    description: {
      es: 'Pone la zona horaria de su estado a los comercios que no tienen una propia, solo donde el estado entero está en una zona.',
      en: 'Gives merchants with no time zone of their own the zone of their state, only where the whole state is in one zone.',
    },
    run: async (tx) => ({ done: await inferAccountTimezones(tx) }),
  },
]

/** Comercios sin zona propia cuyo estado dice una zona distinta de la del mercado: toman esa zona. No pisa una zona puesta a mano. */
export async function inferAccountTimezones(tx: Tx): Promise<number> {
  const rows = await tx<{ id: string; market_code: string; region: string; market_tz: string }[]>`
    select a.id, a.market_code, a.region, m.timezone as market_tz from crm.accounts a join crm.markets m on m.code = a.market_code
     where a.timezone is null and a.archived_at is null and nullif(btrim(a.region), '') is not null and a.market_code in ('US', 'MX')`
  const set = rows.map((r) => ({ id: r.id, tz: stateZone(r.market_code, r.region) })).filter((r): r is { id: string; tz: string } => !!r.tz && r.tz !== rows.find((x) => x.id === r.id)!.market_tz)
  if (!set.length) return 0
  const res = await tx`update crm.accounts a set timezone = x.tz from jsonb_to_recordset(${tx.json(set)}) as x(id uuid, tz text) where a.id = x.id and a.timezone is null`
  return res.count
}
