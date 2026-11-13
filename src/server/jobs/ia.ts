import type { Job } from './types'
import { generateRecommendations, measureRecommendations } from '@/domain/ia/commands'

/**
 * Tareas programadas del paquete ia. Las dos son seguras de correr dos veces: una regla no se repite abierta sobre la misma
 * cuenta (índice único) y una sugerencia se mide una sola vez (measured_at).
 */
export const iaJobs: Job[] = [
  {
    key: 'ia.next_actions',
    everyMinutes: 360,
    description: {
      es: 'Calcula la siguiente acción sugerida de cada comercio con reglas (sin primera venta, días sin contacto, venta a la baja, revisita), hasta 3 por comercio, vence las de más de 7 días y, si el mercado lo tiene, deja el borrador de la tarea para aprobar.',
      en: 'Works out each merchant’s suggested next action with rules (no first sale, days without contact, falling sales, revisit), up to 3 per merchant, expires those older than 7 days and, if the market has it on, leaves the task draft for approval.',
    },
    run: async (tx) => {
      const r = await generateRecommendations(tx)
      return { done: r.created + r.expired, note: `${r.created} nuevas, ${r.expired} vencidas, ${r.drafts} borradores` }
    },
  },
  {
    key: 'ia.measure',
    everyMinutes: 1440,
    description: {
      es: 'Mide cada sugerencia 14 días después: si se siguió y qué pasó (subió la venta, hubo contacto o nada), igual para el grupo de control.',
      en: 'Measures each suggestion 14 days later: whether it was followed and what happened (sales went up, there was contact or nothing), the same for the control group.',
    },
    run: async (tx) => ({ done: await measureRecommendations(tx) }),
  },
]
