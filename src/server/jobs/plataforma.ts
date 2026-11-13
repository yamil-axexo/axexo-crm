import 'server-only'
import type { Job } from './types'
import { sysCtxOf } from '@/domain/automation/sys'
import { liveSignals, noticesFromOutbox } from '@/domain/plataforma/feed'
import { rotationReminders } from '@/domain/plataforma/admin'

/** Tareas del paquete plataforma. Las tres se pueden correr dos veces sin repetir efectos (la cola se lee por consumidor). */
export const plataformaJobs: Job[] = [
  {
    key: 'plataforma.en_vivo',
    everyMinutes: 1,
    description: {
      es: 'Marca qué cambió en la cola de eventos para que las pantallas abiertas se actualicen solas (y lo manda por Broadcast si está encendido).',
      en: 'Marks what changed in the event queue so open screens refresh by themselves (and sends it over Broadcast when it is on).',
    },
    run: async (tx) => {
      const out = await liveSignals(tx)
      return { done: out.events, note: `topics ${out.topics}, broadcast ${out.broadcast}` }
    },
  },
  {
    key: 'plataforma.avisos_eventos',
    everyMinutes: 1,
    description: {
      es: 'Manda los avisos que piden las reglas por evento, leyendo la cola de eventos.',
      en: 'Sends the notices that the event rules ask for, reading the event queue.',
    },
    run: async (tx) => {
      const out = await noticesFromOutbox(tx, await sysCtxOf(tx))
      return { done: out.notices, note: `events ${out.events}, notices ${out.notices}` }
    },
  },
  {
    key: 'plataforma.rotacion',
    everyMinutes: 1440,
    description: {
      es: 'Avisa a quien responde por cada conexión cuando su llave ya debió rotarse, y a su suplente si no hay responsable.',
      en: 'Tells whoever owns each connection when its key should already have been rotated, and the backup if there is no owner.',
    },
    run: async (tx) => {
      const n = await rotationReminders(tx, await sysCtxOf(tx))
      return { done: n }
    },
  },
]
