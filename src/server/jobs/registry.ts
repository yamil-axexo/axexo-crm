import type { Job } from './types'
import { automatizacionesJobs } from './automatizaciones'
import { avisosJobs } from './avisos'
import { eventosApiJobs } from './eventos-api'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [
  ...automatizacionesJobs,
  ...avisosJobs,
  ...eventosApiJobs,
]
