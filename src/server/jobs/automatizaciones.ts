import 'server-only'
import type { Job } from './types'
import { runEvents, runSchedule } from '@/domain/automation/engine'
import { escalateApprovals } from '@/domain/automation/transitions'
import { escalateLeads } from '@/domain/automation/lead-escalation'
import { sysCtxOf } from '@/domain/automation/sys'

/** Las tareas programadas del paquete automatizaciones. Cada una se puede correr dos veces sin repetir efectos. */
export const automatizacionesJobs: Job[] = [
  {
    key: 'automatizaciones.reglas',
    everyMinutes: 15,
    description: {
      es: 'Revisa las automatizaciones por horario: abre y cierra los avisos de la cola (negocios estancados, también en Operaciones; sin próximo paso; leads sin atender) y crea las tareas y avisos que definan.',
      en: 'Checks the scheduled automations: opens and closes queue notices (stalled deals, including Operations; no next step; unattended leads) and creates the tasks and notices they define.',
    },
    run: async (tx) => {
      const out = await runSchedule(tx, await sysCtxOf(tx))
      return { done: out.opened + out.closed + out.acted, note: `opened ${out.opened}, closed ${out.closed}, acted ${out.acted}` }
    },
  },
  {
    key: 'automatizaciones.eventos',
    everyMinutes: 1,
    description: {
      es: 'Corre las automatizaciones que se disparan con un evento (un negocio nuevo, un cambio de etapa, un lead que entra).',
      en: 'Runs the automations triggered by an event (a new deal, a stage change, an incoming lead).',
    },
    run: async (tx) => {
      const out = await runEvents(tx, await sysCtxOf(tx))
      return { done: out.acted, note: `events ${out.events}, acted ${out.acted}` }
    },
  },
  {
    key: 'automatizaciones.escalamiento',
    everyMinutes: 5,
    description: {
      es: 'Escala lo que venció: el primer contacto de un lead (a supervisión y luego a quien lidera) y las aprobaciones sin respuesta (al suplente).',
      en: 'Escalates what is overdue: a lead’s first contact (to the supervisor, then to the market lead) and unanswered approvals (to the backup).',
    },
    run: async (tx) => {
      const sys = await sysCtxOf(tx)
      const leads = await escalateLeads(tx, sys)
      const approvals = await escalateApprovals(tx, sys)
      return { done: leads + approvals, note: `leads ${leads}, approvals ${approvals}` }
    },
  },
]
