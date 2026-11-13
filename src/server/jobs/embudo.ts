import type { Job } from './types'
import { flushConversions } from '@/domain/embudo/attribution'
import { retryHeldIntake } from '@/domain/embudo/intake-retry'
import { salesFileAdapter } from '@/server/adapters/sales-file'
import { ingestMetricsFile } from '@/domain/integrations'
import { systemCtx } from '@/server/context'

/**
 * Tareas programadas del paquete embudo. Las tres son seguras de correr dos veces: el archivo de ventas es idempotente por
 * contenido, cada conversión tiene su llave propia y cada envío retenido conserva la llave de idempotencia del formulario.
 */
export const embudoJobs: Job[] = [
  {
    key: 'embudo.sales_file_pull',
    everyMinutes: 60,
    load: 'sales_file',
    description: {
      es: 'Va por el archivo diario de ventas (primer fondeo, primera transacción, hábito y correcciones) y lo carga. Con la conexión apagada no va a ningún lado: el archivo entra solo cuando alguien lo entrega por la API.',
      en: 'Fetches the daily sales file (first funding, first transaction, habit and corrections) and loads it. With the connection off it goes nowhere: the file only comes in when someone delivers it through the API.',
    },
    run: async () => {
      const adapter = salesFileAdapter()
      if (adapter.mode === 'off') return { done: 0, note: 'Canal apagado' }
      let n = 0
      for (let file = await adapter.next(); file; file = await adapter.next()) {
        await ingestMetricsFile(await systemCtx(), file)
        n += 1
      }
      return { done: n, note: 'Simulado' }
    },
  },
  {
    key: 'embudo.ad_conversions',
    everyMinutes: 15,
    description: {
      es: 'Entrega a las plataformas de anuncios las conversiones en cola (lead calificado, primera transacción). Con el canal apagado no sale nada y cada una queda marcada como "Canal apagado".',
      en: 'Delivers queued conversions (qualified lead, first transaction) to the ad platforms. With the channel off nothing leaves and each one is marked "Channel off".',
    },
    run: (tx) => flushConversions(tx),
  },
  {
    key: 'embudo.intake_retry',
    everyMinutes: 5,
    description: {
      es: 'Reintenta los envíos de formulario que no se pudieron guardar. Lo que se agota queda a la vista en Administración.',
      en: 'Retries form submissions that could not be saved. Whatever runs out of attempts stays visible in Administration.',
    },
    run: (tx) => retryHeldIntake(tx),
  },
]
