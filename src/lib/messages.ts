import { IntlMessageFormat } from 'intl-messageformat'
import es from '@/messages/es.json'
import en from '@/messages/en.json'
import type { Locale } from '@/lib/format'

// Handoff de diseño, sección 7: los textos de UI viven en archivos de mensajes ES y EN con formato ICU
// (plurales incluidos). Las pantallas nuevas no llevan textos en el código; las anteriores migran con su rediseño.
export type MessageKey = keyof typeof es
export type Values = Record<string, string | number | Date>
export type M = (key: MessageKey, values?: Values) => string

const CATALOG: Record<Locale, Record<string, string>> = { es, en }
const FORMAT_LOCALE: Record<Locale, string> = { es: 'es-MX', en: 'en-US' }
const cache = new Map<string, IntlMessageFormat>()

export function messages(locale: Locale): M {
  return (key, values) => {
    const id = `${locale}:${key}`
    let f = cache.get(id)
    if (!f) {
      f = new IntlMessageFormat(CATALOG[locale][key] ?? CATALOG.es[key] ?? key, FORMAT_LOCALE[locale])
      cache.set(id, f)
    }
    return String(f.format(values))
  }
}

export const messageKeys = () => ({ es: Object.keys(es), en: Object.keys(en) })
