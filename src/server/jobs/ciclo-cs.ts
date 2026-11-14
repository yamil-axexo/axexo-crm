import type { Job } from './types'
import { pullSignals, runAlerts } from '@/domain/care'
import { feedbackDigest, pullAcademy } from '@/domain/care-accounts'

/**
 * Tareas programadas del paquete ciclo-cs. Todas son seguras de correr dos veces: una etapa que ya cambió no vuelve a cambiar,
 * el corte de salud del día se reemplaza, una alerta abierta no se abre otra vez y una oportunidad abierta tampoco.
 * El orden importa dentro del día: primero señales, luego etapas, modelo de atención, salud, alertas y expansión.
 */
const sysActor = async (tx: Parameters<Job['run']>[0]) => ({ user: { id: (await tx<{ id: string }[]>`select app.system_user_id() as id`)[0]!.id } })

export const cicloCsJobs: Job[] = [
  {
    key: 'ciclo-cs.signals',
    everyMinutes: 24 * 60,
    description: {
      es: 'Lee saldo, comisión, productos y conteo de solicitudes por comercio, y las constancias de Kore Academy. Con las conexiones apagadas no trae nada.',
      en: 'Reads balance, commission, products and request counts per merchant, and Kore Academy completions. With the connections off it brings nothing.',
    },
    run: async (tx) => {
      const a = await pullSignals(tx)
      const b = await pullAcademy(tx, await sysActor(tx))
      return { done: a.done + b.done, note: `${a.note}; academy ${b.note}` }
    },
  },
  {
    key: 'ciclo-cs.lifecycle',
    everyMinutes: 24 * 60,
    description: {
      es: 'Recalcula la etapa de vida de cada comercio (hábito, riesgo, inactivo, reactivado, perdido) con las ventanas del mercado y deja el cambio en su historial. También recalcula el modelo de atención.',
      en: 'Recalculates each merchant’s lifecycle stage (habit, at risk, inactive, reactivated, lost) with the market windows and logs the change in its history. It also recalculates the service model.',
    },
    run: async (tx) => {
      const moved = (await tx<{ n: number }[]>`select app.lifecycle_recalc(null, null) as n`)[0]?.n ?? 0
      const tiers = (await tx<{ n: number }[]>`select app.service_tier_recalc(null) as n`)[0]?.n ?? 0
      return { done: moved + tiers, note: `stages ${moved}, tiers ${tiers}` }
    },
  },
  {
    key: 'ciclo-cs.health',
    everyMinutes: 24 * 60,
    description: {
      es: 'Guarda el puntaje de salud del día de cada comercio que ya vende, con su explicación por grupo de señales.',
      en: 'Saves the day’s health score for each merchant that already sells, with its explanation by signal group.',
    },
    run: async (tx) => ({ done: (await tx<{ n: number }[]>`select app.health_snapshot_run(null) as n`)[0]?.n ?? 0 }),
  },
  {
    key: 'ciclo-cs.alerts',
    everyMinutes: 6 * 60,
    description: {
      es: 'En los mercados con las alertas encendidas: abre las alertas nuevas con su tarea y su guía de acción, cierra las que ya no aplican y mide si el comercio volvió a vender.',
      en: 'In markets with alerts turned on: opens new alerts with their task and playbook, closes the ones that no longer apply and measures whether the merchant sold again.',
    },
    run: async (tx) => {
      const out = await runAlerts(tx, await sysActor(tx))
      return { done: out.opened + out.closed, note: `opened ${out.opened}, closed ${out.closed}, tasks ${out.tasks}, messages ${out.messages}` }
    },
  },
  {
    key: 'ciclo-cs.expansion',
    everyMinutes: 24 * 60,
    description: {
      es: 'Abre oportunidades de expansión para los comercios activos que cumplen las reglas del mercado y todavía no tienen ese producto.',
      en: 'Opens expansion opportunities for active merchants that meet the market rules and do not have that product yet.',
    },
    run: async (tx) => ({ done: (await tx<{ n: number }[]>`select app.expansion_run(null) as n`)[0]?.n ?? 0 }),
  },
  {
    key: 'ciclo-cs.feedback_digest',
    everyMinutes: 24 * 60,
    description: {
      es: 'Arma el resumen semanal de comentarios de producto por tema y mercado, para Producto y Tecnología.',
      en: 'Builds the weekly product feedback summary by topic and market, for Product and Technology.',
    },
    run: (tx) => feedbackDigest(tx),
  },
]
