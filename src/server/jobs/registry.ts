import type { Job } from './types'
import { datosJobs } from './datos'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [...datosJobs]
