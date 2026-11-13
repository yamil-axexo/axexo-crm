import type { Job } from './types'
import { reportesJobs } from './reportes'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [
  ...reportesJobs,
]
