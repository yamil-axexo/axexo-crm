import type { Job } from './types'
import { pullFxFeed } from '@/domain/markets'

/**
 * MULTI-01: mantiene al día la conversión a USD de los negocios abiertos. Primero pide las tasas del día al adaptador
 * (apagado: no trae nada y administración las sigue cargando a mano); después vuelve a convertir los abiertos con la tasa
 * vigente y rellena los cerrados que quedaron sin tasa. Los cerrados ya convertidos no se tocan. Correrlo dos veces no cambia nada.
 */
export const fxRestampJob: Job = {
  key: 'mercados.fx_restamp',
  everyMinutes: 360,
  description: {
    es: 'Vuelve a convertir a USD los negocios abiertos con la tasa vigente. Los cerrados conservan la tasa de su cierre.',
    en: 'Converts open deals to USD again with the current rate. Closed deals keep the rate of their close date.',
  },
  run: async (tx) => {
    const currencies = (await tx<{ currency: string }[]>`select distinct trim(currency) as currency from crm.markets where trim(currency) <> 'USD'`).map((r) => r.currency)
    const feed = await pullFxFeed(tx, currencies)
    const rows = await tx<{ n: number }[]>`select app.fx_restamp() as n`
    return { done: rows[0]?.n ?? 0, note: feed.off ? 'fx feed off: rates are loaded by hand' : `fx feed loaded ${feed.loaded}` }
  },
}

export const mercadosJobs: Job[] = [fxRestampJob]
