import type { Tx } from '@/server/db'
import type { Job } from './types'
import { notifyMany, peopleWithRole } from '@/domain/notify'
import { OBJECTIVE_LABEL } from '@/lib/gobierno-labels'

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

/**
 * GOB-07: alerta. Si un objetivo de servicio no se cumple con lo medido ayer y hoy, administración recibe un aviso,
 * uno por objetivo y por día. Sin objetivo fijado o con pocas mediciones no avisa.
 */
export async function sloWatch(tx: Tx): Promise<{ done: number; note?: string }> {
  const who = await tx<{ me: string | null; sys: string }[]>`select app.current_user_id() as me, app.system_user_id() as sys`
  const id = who[0]!.me ?? who[0]!.sys
  if (!who[0]!.me) await tx`select set_config('app.user_id', ${id}, true)`
  const rows = await tx<{ key: string; target: number; measured: number }[]>`select key, target::float8 as target, measured::float8 as measured from app.slo_check()`
  if (rows.length === 0) return { done: 0 }
  const admins = await peopleWithRole(tx, null, ['admin'])
  for (const r of rows) {
    const label = OBJECTIVE_LABEL[r.key]?.label ?? [r.key, r.key]
    const unit = r.key === 'availability' ? '%' : ' ms'
    await notifyMany(tx, { user: { id } }, admins, {
      kind: 'service_alert', market: null, link: '/admin/gobierno',
      title: [`No se cumple un objetivo de servicio: ${label[0]}`, `A service objective is not met: ${label[1]}`],
      body: [`Medido ayer y hoy: ${r.measured}${unit}. Objetivo: ${r.target}${unit}. Revisa Gobierno, Servicio y abre un incidente si hace falta.`, `Measured yesterday and today: ${r.measured}${unit}. Objective: ${r.target}${unit}. Check Governance, Service and open an incident if needed.`],
    })
  }
  return { done: rows.length, note: rows.map((r) => r.key).join(', ') }
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
  {
    key: 'gobierno.slo_watch',
    everyMinutes: 60,
    description: { es: 'Avisa a administración cuando un objetivo de servicio no se cumple', en: 'Notifies administration when a service objective is not met' },
    run: sloWatch,
  },
]
