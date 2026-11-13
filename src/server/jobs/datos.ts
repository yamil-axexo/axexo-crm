import type { Job } from './types'

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
]
