import type { Job } from './types'
import { computePriorityTx, evaluateFieldExceptionsTx } from '@/domain/campo-canal/campo'
import { expireClaimsTx, pullFundingTx } from '@/domain/campo-canal/canal'

/**
 * Tareas programadas del paquete campo-canal. Todas son seguras de correr dos veces: la prioridad reemplaza la del día,
 * los avisos no se duplican (clave única mientras estén abiertos), un registro vencido no vuelve a vencer y el fondeo
 * repetido del mismo corte no entra dos veces.
 */
export const campoCanalJobs: Job[] = [
  {
    key: 'campo-canal.store_priority',
    everyMinutes: 24 * 60,
    description: {
      es: 'Calcula la prioridad de hoy de cada tienda (segmento, frecuencia de visita y razones) y marca el grupo de control por territorio.',
      en: 'Computes today’s priority for each store (segment, visit frequency and reasons) and marks the control group per territory.',
    },
    run: async (tx) => ({ done: await computePriorityTx(tx) }),
  },
  {
    key: 'campo-canal.field_exceptions',
    everyMinutes: 60,
    description: {
      es: 'Abre y cierra los avisos de punto de venta por debajo del mínimo y de personas por debajo de su meta del mes (el saldo bajo lo avisa Cuidado de comercios).',
      en: 'Opens and closes the notices for stores below the minimum score and people behind on their monthly target (low balance is raised by Merchant care).',
    },
    run: async (tx) => {
      const r = await evaluateFieldExceptionsTx(tx)
      return { done: r.opened + r.closed, note: `opened ${r.opened}, closed ${r.closed}` }
    },
  },
  {
    key: 'campo-canal.claims_expiry',
    everyMinutes: 60,
    description: {
      es: 'Vence los registros de canal cuya ventana de protección ya pasó: la tienda vuelve a quedar libre.',
      en: 'Expires channel registrations whose protection window has passed: the store is free again.',
    },
    run: async (tx) => ({ done: await expireClaimsTx(tx) }),
  },
  {
    key: 'campo-canal.funding_pull',
    everyMinutes: 24 * 60,
    description: {
      es: 'Lee fondeo, saldo y límite de crédito del archivo de ventas. Conexión apagada: no entra nada hasta que se encienda.',
      en: 'Reads funding, balance and credit limit from the sales file. Connection off: nothing comes in until it is turned on.',
    },
    run: async (tx) => ({ done: await pullFundingTx(tx) }),
  },
]
