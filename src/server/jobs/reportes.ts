import type { Job } from './types'
import { deliverScheduled, runReconciliation, takeSnapshot } from '@/domain/reportes'

/** Tareas programadas del paquete `reportes`. Las tres se pueden correr dos veces sin daño. */
export const reportesJobs: Job[] = [
  {
    key: 'reportes.snapshot', everyMinutes: 60 * 24,
    description: { es: 'Foto diaria de negocios abiertos por etapa y de la cartera por estado.', en: 'Daily snapshot of open deals by stage and of merchants by status.' },
    run: (tx) => takeSnapshot(tx),
  },
  {
    key: 'reportes.reconcile', everyMinutes: 60 * 24,
    description: { es: 'Conciliación de los ganados de CONTIGO con las primeras ventas del archivo diario.', en: 'Reconciliation of CONTIGO wins with the first sales in the daily file.' },
    run: (tx) => runReconciliation(tx),
  },
  {
    key: 'reportes.scheduled', everyMinutes: 60,
    description: { es: 'Entrega de los reportes programados a su dueño dentro de CONTIGO.', en: 'Delivery of scheduled reports to their owner inside CONTIGO.' },
    run: (tx) => deliverScheduled(tx),
  },
]
