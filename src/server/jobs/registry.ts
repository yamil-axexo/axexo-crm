import type { Job } from './types'
import { mercadosJobs } from './mercados'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [...mercadosJobs]
