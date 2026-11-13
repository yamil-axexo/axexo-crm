import type { Tx } from '@/server/db'
import type { Job } from './types'

/** GOB-04: anota el commit que está corriendo, una vez por ambiente y commit. Así cada despliegue deja registro aunque nadie lo anote. */
export async function deployWatch(tx: Tx, environment: string, commit: string | null, ref: string | null): Promise<{ done: number; note?: string }> {
  if (!commit) return { done: 0, note: 'no commit in the environment' }
  const rows = await tx<{ recorded: boolean }[]>`select app.record_deployment(${environment}, ${commit}, ${ref}) as recorded`
  return { done: rows[0]?.recorded ? 1 : 0 }
}

/** GOB-07: sondeo interno. Mide cuánto tarda la base en responder y lo suma a la disponibilidad del día. */
export async function healthProbe(tx: Tx): Promise<{ done: number; note?: string }> {
  const started = Date.now()
  let failed = false
  try {
    await tx`select app.system_user_id()`
  } catch {
    failed = true
  }
  await tx`select app.record_request('probe', 'db', ${Date.now() - started}, ${failed})`
  return { done: 1 }
}

export const gobiernoJobs: Job[] = [
  {
    key: 'gobierno.deploy_watch',
    everyMinutes: 10,
    description: { es: 'Anota en el registro de despliegues el commit que está corriendo', en: 'Records the running commit in the deployment log' },
    run: async (tx) => {
      const { deployedVersion, env } = await import('@/env')
      const v = deployedVersion()
      return deployWatch(tx, env().APP_ENV, v.commit, v.ref)
    },
  },
  {
    key: 'gobierno.health_probe',
    everyMinutes: 5,
    description: { es: 'Sondeo interno de la base para medir la disponibilidad', en: 'Internal database probe to measure availability' },
    run: healthProbe,
  },
]
