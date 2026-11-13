import type { Job } from './types'
import { applyActivityRetention, weeklySalesSummary } from '@/domain/embudo2/activities'

/** Tareas programadas del paquete embudo2 (ACT-01). Las dos son seguras de correr dos veces. */
export const embudo2Jobs: Job[] = [
  {
    key: 'embudo2.weekly_sales_summary',
    everyMinutes: 360,
    description: {
      es: 'Deja en el hilo de cada comercio un resumen semanal del archivo de ventas: una entrada por semana, nunca fila a fila.',
      en: 'Leaves a weekly sales file summary in each merchant thread: one entry per week, never row by row.',
    },
    run: async (tx) => {
      const sys = await tx<{ id: string }[]>`select app.system_user_id() as id`
      return { done: await weeklySalesSummary(tx, sys[0]!.id) }
    },
  },
  {
    key: 'embudo2.activity_retention',
    everyMinutes: 1440,
    description: {
      es: 'Quita las actividades terminadas más viejas que la retención del mercado. Sin retención definida no quita nada.',
      en: 'Removes finished activities older than the market retention. With no retention set it removes nothing.',
    },
    run: async (tx) => {
      const n = await applyActivityRetention(tx)
      return { done: n, note: n === 0 ? 'Sin retención definida o nada que quitar' : undefined }
    },
  },
]
