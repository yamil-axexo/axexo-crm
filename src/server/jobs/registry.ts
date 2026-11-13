import type { Job } from './types'
import { automatizacionesJobs } from './automatizaciones'
import { avisosJobs } from './avisos'
import { eventosApiJobs } from './eventos-api'
import { reportesJobs } from './reportes'
import { datosJobs } from './datos'
import { campoCanalJobs } from './campo-canal'
import { mercadosJobs } from './mercados'
import { seguridadJobs } from './seguridad'
import { gobiernoJobs } from './gobierno'
import { embudoJobs } from './embudo'
import { embudo2Jobs } from './embudo2'
import { cicloCsJobs } from './ciclo-cs'
import { partnersJobs } from './partners'
import { iaJobs } from './ia'
import { integraciones2Jobs } from './integraciones2'
import { campo2Jobs } from './campo2'
import { reportes2Jobs } from './reportes2'

/** Every scheduled job of the app. One line per package: `...packageJobs`. */
export const JOBS: Job[] = [
  ...automatizacionesJobs,
  ...avisosJobs,
  ...eventosApiJobs,
  ...reportesJobs,
  ...datosJobs,
  ...campoCanalJobs,
  ...mercadosJobs,
  ...seguridadJobs,
  ...gobiernoJobs,
  ...embudoJobs,
  ...embudo2Jobs,
  ...cicloCsJobs,
  ...partnersJobs,
  ...iaJobs,
  ...integraciones2Jobs,
  ...campo2Jobs,
  ...reportes2Jobs,
]
