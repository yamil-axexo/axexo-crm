import type { Job } from './types'
import { avisosJobs } from './avisos'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [
  ...avisosJobs,
]
