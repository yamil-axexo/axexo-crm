import type { Job } from './types'
import { iaRegression, openQualityExceptions, teamSnapshotAndWindow } from '@/domain/reportes2-jobs'

/** Tareas programadas del paquete `reportes2`. Las tres se pueden correr dos veces sin daño. */
export const reportes2Jobs: Job[] = [
  {
    key: 'reportes2.team_snapshot', everyMinutes: 60 * 24,
    description: { es: 'Foto diaria por equipo (supervisión ve la de su equipo) y ventana corta: borra solo fotos ya entregadas al lakehouse.', en: 'Daily snapshot by team (supervisors see their team’s) and short window: only removes snapshots already delivered to the lakehouse.' },
    run: (tx) => teamSnapshotAndWindow(tx),
  },
  {
    key: 'reportes2.quality_notices', everyMinutes: 60 * 24,
    description: { es: 'Las reglas de calidad elegidas en Administración abren un aviso en la cola del equipo para quien tiene registros por corregir.', en: 'The data quality rules chosen in Administration open a notice in the team queue for whoever has records to fix.' },
    run: (tx) => openQualityExceptions(tx),
  },
  {
    key: 'reportes2.ia_regression', everyMinutes: 60,
    description: { es: 'Si cambió la versión de las instrucciones o el modo del modelo de una función de IA, corre su evaluación sola.', en: 'If an AI feature’s prompt version or model mode changed, runs its evaluation on its own.' },
    run: (tx) => iaRegression(tx),
  },
]
