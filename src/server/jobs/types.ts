import type { Tx } from '@/server/db'

/**
 * A scheduled job. Each package that needs something to run on a schedule (rules, snapshots,
 * event publishing, digests) exports its jobs from `src/server/jobs/<package>.ts` and adds them
 * to `registry.ts`. The runner decides when a job is due; a job must be safe to run twice.
 */
export type Job = {
  /** Stable key, `<package>.<name>`; it is what the run log and the admin screen show. */
  key: string
  /** Minimum minutes between two runs. */
  everyMinutes: number
  description: { es: string; en: string }
  /** Runs without a signed-in user. Returns how many records it touched and an optional note for the log. */
  run: (tx: Tx) => Promise<{ done: number; note?: string }>
}
