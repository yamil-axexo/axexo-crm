import type { Job } from './types'
import { salesFileAdapter } from '@/server/adapters/sales-file'
import { ingestStoreSales } from '@/domain/store-sales'
import { systemCtx } from '@/server/context'
import { watchLateLoads } from '@/server/loads'
import { systemUserId } from '@/server/db'

/**
 * Tareas programadas del paquete integraciones2.
 * - store_sales_nightly (E5.F1/F2): una vez por noche va por el archivo de cifras por tienda y lo carga. Es una carga: queda
 *   con inicio y fin, respeta la ventana de mantenimiento y no corre junto con otra. Apagada, no va a ningún lado.
 * - load_watch (E5.F3): avisa al responsable de cada carga que no llegó a su hora. Segura de correr dos veces.
 */
export const integraciones2Jobs: Job[] = [
  {
    key: 'integraciones2.store_sales_nightly',
    everyMinutes: 1440,
    load: 'store_sales',
    description: {
      es: 'Cada noche va por el archivo de cifras de ventas por tienda (activaciones por carrier y volumen de pago) y lo carga. Con la conexión apagada no va a ningún lado: el archivo entra solo cuando alguien lo entrega por la API.',
      en: 'Every night it fetches the store sales figures file (activations by carrier and payment volume) and loads it. With the connection off it goes nowhere: the file only comes in when someone delivers it through the API.',
    },
    run: async () => {
      const adapter = salesFileAdapter()
      if (adapter.mode === 'off') return { done: 0, note: 'Canal apagado' }
      let n = 0
      for (let file = await adapter.nextStoreSales(); file; file = await adapter.nextStoreSales()) {
        const r = await ingestStoreSales(await systemCtx(), file)
        n += r.matched
      }
      return { done: n, note: 'Simulado' }
    },
  },
  {
    key: 'integraciones2.load_watch',
    everyMinutes: 15,
    description: {
      es: 'Revisa que cada carga con hora esperada haya llegado. Si no, avisa a su responsable una vez al día.',
      en: 'Checks that every load with an expected time arrived. If not, it notifies its owner once a day.',
    },
    run: async (tx) => ({ done: await watchLateLoads(tx, await systemUserId()) }),
  },
]
