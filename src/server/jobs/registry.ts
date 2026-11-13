import type { Job } from './types'
import { automatizacionesJobs } from './automatizaciones'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [
  ...automatizacionesJobs,
]
