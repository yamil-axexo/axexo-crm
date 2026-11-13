import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { runVia, withSystem } from '@/server/db'
import { env } from '@/env'
import { JOBS } from './registry'
import type { Job } from './types'
import { finishLoad, startLoad, type LoadStart } from '@/domain/loads'

// El corredor de las tareas programadas. Decide a cuál le toca, no deja que la misma corra dos veces a la vez
// (candado de la base, por transacción: sirve también detrás de un pooler) y deja cada corrida en `crm.job_runs`:
// cuándo, cuánto tardó, cuántos registros tocó y, si falló, el código del error (nunca datos de personas).
// Se dispara de tres formas: POST /api/cron/run (con CRON_SECRET), con la app en uso (después de responder) y
// "Correr ahora" desde Administración.

export type Trigger = 'cron' | 'visit' | 'manual'
export type RunOutcome = { key: string; status: 'ok' | 'failed' | 'busy' | 'not_due'; done?: number; note?: string; error?: string; ms?: number }

export const findJob = (key: string): Job | undefined => JOBS.find((j) => j.key === key)

/** Lo que se guarda de un error: su código o su tipo. El mensaje puede traer datos de un registro y no se guarda (OBS-01). */
const safeError = (e: unknown): string => {
  const x = e as { code?: unknown; name?: unknown }
  return String(x?.code ?? x?.name ?? 'error').replace(/[^\w.:-]/g, '').slice(0, 80) || 'error'
}

/**
 * Corre una tarea si le toca (o siempre, con `force`). El trabajo y su registro van en la misma transacción: si la tarea
 * falla no deja nada a medias, y la falla queda anotada aparte.
 */
export async function runJob(job: Job, trigger: Trigger, opts: { force?: boolean; actorId?: string | null } = {}): Promise<RunOutcome> {
  if (job.load) return runLoadJob(job, trigger, opts)
  return runPlain(job, trigger, opts)
}

/**
 * E5.F3/F4/F5: una carga de datos. Antes de abrir el trabajo: ¿le toca?, ¿su mercado está en ventana de mantenimiento?
 * (no corre), ¿otra carga está corriendo? (espera su turno: "busy"). Al terminar, la carga queda cerrada y avisada.
 */
async function runLoadJob(job: Job, trigger: Trigger, opts: { force?: boolean; actorId?: string | null }): Promise<RunOutcome> {
  if (!opts.force) {
    const recent = await withSystem((tx) => tx<{ recent: boolean }[]>`
      select coalesce(max(started_at) > now() - make_interval(mins => ${job.everyMinutes}), false) as recent from crm.job_runs where job_key = ${job.key}`)
    if (recent[0]?.recent) return { key: job.key, status: 'not_due' }
  }
  let start: LoadStart
  try {
    start = await withSystem((tx) => startLoad(tx, job.load!, trigger, opts.actorId ?? null))
  } catch (e) {
    return { key: job.key, status: 'failed', error: safeError(e) }
  }
  if (start.status === 'busy') return { key: job.key, status: 'busy', note: `load_running:${start.running}` }
  if (start.status === 'paused') return { key: job.key, status: 'not_due', note: `maintenance_window:${start.markets.join(',')}` }
  const out = await runPlain(job, trigger, { ...opts, force: true })
  try {
    await withSystem((tx, sys) => finishLoad(tx, start.runId, out.status === 'ok' || out.status === 'busy' ? { ok: true, done: out.done ?? 0, note: out.note } : { ok: false, error: out.error ?? out.status }, sys))
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'load_finish_failed', job: job.key, code: safeError(e) }))
  }
  return out
}

async function runPlain(job: Job, trigger: Trigger, opts: { force?: boolean; actorId?: string | null }): Promise<RunOutcome> {
  const t0 = Date.now()
  try {
    // SEG-03: lo que cambie una tarea programada queda en la bitácora de la base con la vía "tarea programada".
    return await runVia('job', () => withSystem(async (tx) => {
      const lock = await tx<{ ok: boolean }[]>`select pg_try_advisory_xact_lock(hashtext(${'contigo.job:' + job.key})) as ok`
      if (!lock[0]?.ok) return { key: job.key, status: 'busy' as const }
      if (!opts.force) {
        const recent = await tx<{ recent: boolean }[]>`
          select coalesce(max(started_at) > now() - make_interval(mins => ${job.everyMinutes}), false) as recent from crm.job_runs where job_key = ${job.key}`
        if (recent[0]?.recent) return { key: job.key, status: 'not_due' as const }
      }
      const started = (await tx<{ at: Date }[]>`select clock_timestamp() as at`)[0]!.at
      const out = await job.run(tx)
      const ms = Date.now() - t0
      await tx`insert into crm.job_runs (job_key, trigger, actor_id, status, started_at, finished_at, duration_ms, done, note)
               values (${job.key}, ${trigger}, ${opts.actorId ?? null}, 'ok', ${started}, clock_timestamp(), ${ms}, ${out.done}, ${out.note?.slice(0, 500) ?? null})`
      return { key: job.key, status: 'ok' as const, done: out.done, note: out.note, ms }
    }))
  } catch (e) {
    const ms = Date.now() - t0
    const error = safeError(e)
    console.error(JSON.stringify({ level: 'error', msg: 'job_failed', job: job.key, code: error }))
    try {
      await withSystem((tx) => tx`insert into crm.job_runs (job_key, trigger, actor_id, status, started_at, finished_at, duration_ms, done, error)
                                  values (${job.key}, ${trigger}, ${opts.actorId ?? null}, 'failed', now() - make_interval(secs => ${ms / 1000}), now(), ${ms}, 0, ${error})`)
    } catch {
      // Si ni la falla se puede anotar (la base no responde), queda en el log del servidor.
    }
    return { key: job.key, status: 'failed', error, ms }
  }
}

/** Corre, una tras otra, todas las tareas a las que ya les toca. */
export async function runDue(trigger: Trigger): Promise<RunOutcome[]> {
  const out: RunOutcome[] = []
  for (const job of JOBS) out.push(await runJob(job, trigger))
  return out
}

const g = globalThis as unknown as { __contigoJobsTick?: number }

/**
 * Disparo oportunista: se llama después de responder una petición con sesión. Como mucho una vez por minuto en toda la
 * instalación (lo decide la base, no cada servidor), y nunca tumba la petición que lo disparó.
 */
export async function tickJobs(): Promise<RunOutcome[]> {
  if (env().JOBS_ON_VISIT === '0' || JOBS.length === 0) return []
  const now = Date.now()
  if (g.__contigoJobsTick && now - g.__contigoJobsTick < 60_000) return []
  g.__contigoJobsTick = now
  try {
    const turn = await withSystem((tx) => tx`
      update crm.settings set value = to_jsonb(now()) where key = 'jobs_last_tick' and (value #>> '{}')::timestamptz < now() - interval '1 minute' returning 1`)
    if (turn.length === 0) return []
    return await runDue('visit')
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'jobs_tick_failed', code: safeError(e) }))
    return []
  }
}

/** ¿El secreto que llegó es el configurado? Sin secreto configurado nadie pasa. Comparación en tiempo constante. */
export function cronAuthorized(header: string | null): 'off' | 'no' | 'yes' {
  const secret = env().CRON_SECRET
  if (!secret) return 'off'
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(secret)
  return given.length === want.length && timingSafeEqual(given, want) ? 'yes' : 'no'
}
