import type { Job } from './types'
import type { Tx } from '@/server/db'
import { publishDue } from '@/domain/publisher'

/** Un job corre sin persona: toma la identidad del usuario de sistema dentro de su propia transacción (RLS forzado). */
async function asSystem(tx: Tx): Promise<void> {
  await tx`select set_config('app.user_id', coalesce(nullif(current_setting('app.user_id', true), ''), app.system_user_id()::text), true)`
}

/** AUT-02: publica la bandeja de salida a los suscriptores. Con el canal apagado solo reparte: nada sale. */
export const publishEventsJob: Job = {
  key: 'eventos-api.publish',
  everyMinutes: 1,
  description: {
    es: 'Reparte los eventos de dominio a los suscriptores y reintenta los que fallaron. Con el canal apagado quedan listos para publicar.',
    en: 'Hands domain events to subscribers and retries the ones that failed. With the channel off they stay ready to publish.',
  },
  run: async (tx) => {
    await asSystem(tx)
    const r = await publishDue(tx)
    return { done: r.delivered + r.queued, note: `mode=${r.mode} queued=${r.queued} delivered=${r.delivered} failed=${r.failed} dead=${r.dead} waiting=${r.waiting}` }
  },
}

/** AUT-04 / SEG-10: borra los contadores del límite de frecuencia y las llaves de página de más de dos días. */
export const rateCleanupJob: Job = {
  key: 'eventos-api.rate-cleanup',
  everyMinutes: 720,
  description: {
    es: 'Limpia los contadores del límite de frecuencia y las llaves de formularios que ya no sirven.',
    en: 'Cleans up rate limit counters and form page keys that are no longer needed.',
  },
  run: async (tx) => {
    const rows = await tx<{ n: number }[]>`select app.rate_cleanup() as n`
    return { done: rows[0]?.n ?? 0 }
  },
}

export const eventosApiJobs: Job[] = [publishEventsJob, rateCleanupJob]
