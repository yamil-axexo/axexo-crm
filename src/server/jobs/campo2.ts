import type { Job } from './types'
import { estimateStatementsTx, syncAcademyProgressTx } from '@/domain/campo-canal/canal2'

/**
 * Tareas programadas del paquete campo2. Seguras de correr dos veces: el estimado del mes se reemplaza (lo publicado no se
 * toca) y el avance de Kore Academy entra una sola vez por identificador.
 */
export const campo2Jobs: Job[] = [
  {
    key: 'campo2.statements',
    everyMinutes: 24 * 60,
    description: {
      es: 'Calcula el estado de comisión estimado del mes (altas, primeras ventas y activos a 30, 60 y 90 días, sin montos) por persona y por aliado.',
      en: 'Computes the month’s estimated commission statement (sign-ups, first sales and stores active at 30, 60 and 90 days, no amounts) per person and per partner.',
    },
    run: async (tx) => {
      let n = 0
      for (const { code } of await tx<{ code: string }[]>`select code from crm.markets where status = 'live'`) n += await estimateStatementsTx(tx, code)
      return { done: n }
    },
  },
  {
    key: 'campo2.academy_progress',
    everyMinutes: 24 * 60,
    description: {
      es: 'Trae de Kore Academy el avance de los aliados en el material de su nivel (conexión apagada: no hace nada).',
      en: 'Brings partners’ progress on their tier material from Kore Academy (connection off: does nothing).',
    },
    run: (tx) => syncAcademyProgressTx(tx),
  },
]
