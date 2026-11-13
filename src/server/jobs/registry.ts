import type { Job } from './types'
import { automatizacionesJobs } from './automatizaciones'
import { avisosJobs } from './avisos'
import { eventosApiJobs } from './eventos-api'
import { reportesJobs } from './reportes'
import { datosJobs } from './datos'
import { mercadosJobs } from './mercados'
import { seguridadJobs } from './seguridad'
import { gobiernoJobs } from './gobierno'
import { embudoJobs } from './embudo'
import { partnersJobs } from './partners'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [
  ...automatizacionesJobs,
  ...avisosJobs,
  ...eventosApiJobs,
  ...reportesJobs,
  ...datosJobs,
  ...mercadosJobs,
  ...seguridadJobs,
  ...gobiernoJobs,
  ...embudoJobs,
  ...partnersJobs,
]
