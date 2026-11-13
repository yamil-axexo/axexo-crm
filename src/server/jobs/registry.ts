import type { Job } from './types'
import { eventosApiJobs } from './eventos-api'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [
  ...eventosApiJobs,
]
