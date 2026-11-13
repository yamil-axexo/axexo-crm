import type { Job } from './types'
import { seguridadJobs } from './seguridad'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [...seguridadJobs]
