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
import { cicloCsJobs } from './ciclo-cs'
import { partnersJobs } from './partners'
import { iaJobs } from './ia'

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
  ...cicloCsJobs,
  ...partnersJobs,
  ...iaJobs,
]
