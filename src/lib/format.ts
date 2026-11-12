import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'
import { noData, noDataLabel } from './no-data'
export type Locale = 'es' | 'en'
export type T = (es: string, en: string) => string
export const translator = (locale: Locale): T => (es, en) => (locale === 'en' ? en : es)

const tag = (l: Locale) => (l === 'en' ? 'en-US' : 'es-MX')

// La marca de "sin dato" ("s/d" / "n/a") vive en no-data.ts; se reexporta aquí porque la usan los mismos que formatean.
export { noData, noDataLabel }

/** DATA-03: el dinero viaja en unidades menores (centavos) y con su moneda. */
export function money(minor: number | bigint | null | undefined, currency: string, locale: Locale, compact = false): string {
  if (minor === null || minor === undefined) return noData(locale)
  const value = Number(minor) / 100
  return new Intl.NumberFormat(tag(locale), {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    notation: compact ? 'compact' : 'standard',
    // En compacto, 750 se lee "750", no "750.0": el decimal solo aparece cuando abrevia (3.8K).
    minimumFractionDigits: 0,
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value)
}

export const num = (n: number | null | undefined, locale: Locale) =>
  n === null || n === undefined ? noData(locale) : new Intl.NumberFormat(tag(locale)).format(n)

export const pct = (part: number, whole: number, locale: Locale) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : noData(locale))

export function day(d: Date | string | null | undefined, locale: Locale, timeZone = 'UTC'): string {
  if (!d) return noData(locale)
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d
  return new Intl.DateTimeFormat(tag(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(date)
}

/** Fecha corta con día de la semana, para elegir o confirmar un próximo paso: "jue 12 nov" o "Thu, Nov 12". */
export function weekday(d: Date | string | null | undefined, locale: Locale, timeZone = 'UTC'): string {
  if (!d) return noData(locale)
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d
  const parts = new Intl.DateTimeFormat(tag(locale), { weekday: 'short', day: 'numeric', month: 'short', timeZone }).formatToParts(date)
  const get = (type: string) => (parts.find((p) => p.type === type)?.value ?? '').replace('.', '')
  return locale === 'en' ? `${get('weekday')}, ${get('month')} ${get('day')}` : `${get('weekday')} ${get('day')} ${get('month')}`
}

/** Fecha larga del encabezado de Hoy: "miércoles 11 de noviembre". */
export function longDay(d: Date, locale: Locale, timeZone = 'UTC'): string {
  const text = new Intl.DateTimeFormat(tag(locale), { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(d)
  return locale === 'es' ? text.replace(',', '') : text
}

/** Fecha de un evento del hilo: "Hoy, 09:12" si fue hoy; si no, "lun 9 nov" (con año cuando no es el actual). */
export function threadDate(d: Date | string, locale: Locale, timeZone = 'UTC', now = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (isoDay(date, timeZone) === isoDay(now, timeZone)) return `${locale === 'en' ? 'Today' : 'Hoy'}, ${clock(date, locale, timeZone)}`
  const label = weekday(date, locale, timeZone)
  return date.getUTCFullYear() === now.getUTCFullYear() ? label : `${label} ${date.getUTCFullYear()}`
}

/** "nov 2026": desde cuándo vale una atribución. */
export const monthYear = (d: Date | string, locale: Locale, timeZone = 'UTC') =>
  new Intl.DateTimeFormat(tag(locale), { month: 'short', year: 'numeric', timeZone }).format(typeof d === 'string' ? new Date(d) : d).replace('.', '').replace(' de ', ' ')

export function clock(d: Date, locale: Locale, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat(tag(locale), { hour: 'numeric', minute: '2-digit', timeZone }).format(d)
}

/** La fecha de hoy (AAAA-MM-DD) en una zona horaria, y esa fecha más n días. */
export const isoDay = (d: Date, timeZone = 'UTC') => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
/** El primer día (AAAA-MM-DD) desde `iso` en que el mercado trabaja; `workdays` usa 1 = lunes ... 7 = domingo. */
export function workday(iso: string, workdays: readonly number[] = [1, 2, 3, 4, 5]): string {
  for (let i = 0; i < 7; i++) {
    const d = addDays(iso, i)
    if (workdays.includes(new Date(`${d}T12:00:00Z`).getUTCDay() || 7)) return d
  }
  return iso
}

export function dayTime(d: Date | string | null | undefined, locale: Locale, timeZone = 'UTC'): string {
  if (!d) return noData(locale)
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat(tag(locale), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone }).format(date)
}

/** Zonas que se dicen por su nombre y no por una ciudad o un país: el mercado US corre en hora del Este. */
const ZONE_NAMES: Record<string, [es: string, en: string]> = {
  'America/New_York': ['hora del Este', 'Eastern'],
}

/**
 * El nombre con el que se dice una zona: "hora del Este" / "Eastern"; si no tiene nombre propio, "hora de México" / "Mexico time".
 * `long` es para frases como "Times are in Eastern time".
 */
export function zoneName(timeZone: string, locale: Locale, place?: string, long = false): string {
  const named = ZONE_NAMES[timeZone]
  if (named) return locale === 'en' ? (long ? `${named[1]} time` : named[1]) : named[0]
  if (timeZone === 'UTC') return locale === 'en' ? 'UTC time' : 'hora UTC'
  const where = place ?? (timeZone.split('/').pop() ?? timeZone).replaceAll('_', ' ')
  return locale === 'en' ? `${where} time` : `hora de ${where}`
}

/** "Las horas están en hora del Este." / "Times are in Eastern time.": lo que dice un hilo o una lista sobre la zona que usa. */
export const zoneNote = (market: { timezone: string; name: string }, locale: Locale): string =>
  locale === 'en' ? `Times are in ${zoneName(market.timezone, 'en', market.name, true)}.` : `Las horas están en ${zoneName(market.timezone, 'es', market.name)}.`

/** "10:00 AM your time" cuando quien lee está en una zona con otra hora que la del mercado en ese instante; si no, nada. */
export function ownTime(date: Date, locale: Locale, marketZone: string, readerZone?: string | null): string {
  if (!readerZone || offsetMs(date, readerZone) === offsetMs(date, marketZone)) return ''
  const own = isoDay(date, readerZone) === isoDay(date, marketZone) ? clock(date, locale, readerZone) : dayTime(date, locale, readerZone)
  return `${own} ${locale === 'en' ? 'your time' : 'tu hora'}`
}

/**
 * La hora de un mercado con su zona escrita y, cuando quien lee está en otra zona, también su hora entre paréntesis:
 * "Nov 12, 11:00 AM Eastern (10:00 AM your time)" / "12 nov, 11:00 a.m., hora del Este (10:00 a.m. tu hora)".
 */
export function marketTime(d: Date | string | null | undefined, locale: Locale, market: { timezone: string; name: string }, readerZone?: string | null): string {
  if (!d) return noData(locale)
  const date = typeof d === 'string' ? new Date(d) : d
  const base = `${dayTime(date, locale, market.timezone)}${locale === 'en' ? ' ' : ', '}${zoneName(market.timezone, locale, market.name)}`
  const own = ownTime(date, locale, market.timezone, readerZone)
  return own ? `${base} (${own})` : base
}

export function ago(d: Date | string | null | undefined, locale: Locale, now = new Date()): string {
  if (!d) return noData(locale)
  const date = typeof d === 'string' ? new Date(d) : d
  const mins = Math.round((now.getTime() - date.getTime()) / 60000)
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto' })
  if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute')
  const hours = Math.round(mins / 60)
  if (Math.abs(hours) < 36) return rtf.format(-hours, 'hour')
  return rtf.format(-Math.round(hours / 24), 'day')
}

export const daysSince = (d: Date | string, now = new Date()) =>
  Math.floor((now.getTime() - (typeof d === 'string' ? new Date(d) : d).getTime()) / 86400000)

/** Desfase de una zona horaria contra UTC en un instante, en milisegundos (negativo al oeste de Greenwich). */
export function offsetMs(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(d.getTime() / 1000) * 1000
}

/** DATA-05: el teléfono se guarda en E.164 y se muestra con el formato de su país ("+52 55 1234 5678"). */
export const phoneText = (e164: string) => parsePhoneNumberFromString(e164)?.formatInternational() ?? e164

const COUNTRY_BY_CC: Record<string, CountryCode> = { '52': 'MX', '1': 'US', '503': 'SV', '57': 'CO', '55': 'BR' }

/**
 * DATA-05: normaliza a E.164 validando contra el plan de numeración del país (libphonenumber).
 * Devuelve null si el número no es posible en ese país.
 */
export function toE164(raw: string | null | undefined, countryCode: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  if (!digits) return null
  const cc = countryCode.replace('+', '')
  const country = COUNTRY_BY_CC[cc]
  const candidates = trimmed.startsWith('+') ? [`+${digits}`] : [digits, ...(digits.startsWith(cc) ? [`+${digits}`] : [])]
  for (const c of candidates) {
    const parsed = parsePhoneNumberFromString(c, country)
    if (parsed?.isPossible() && /^\+[1-9]\d{6,14}$/.test(parsed.number)) return parsed.number
  }
  return null
}
