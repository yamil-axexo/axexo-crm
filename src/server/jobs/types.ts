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
  /**
   * E5.F3/F4/F5 (integraciones2): si es una carga de datos, cuál. El corredor la anota con inicio y fin, no la corre en la
   * ventana de mantenimiento de su mercado ni junto con otra carga, y avisa a su responsable si falla.
   */
  load?: 'pipedrive' | 'sales_file' | 'store_sales' | 'sales_app' | 'imports'
}
