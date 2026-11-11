import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'
export type Locale = 'es' | 'en'
export type T = (es: string, en: string) => string
export const translator = (locale: Locale): T => (es, en) => (locale === 'en' ? en : es)

const tag = (l: Locale) => (l === 'en' ? 'en-US' : 'es-MX')

/** DATA-03: el dinero viaja en unidades menores (centavos) y con su moneda. */
export function money(minor: number | bigint | null | undefined, currency: string, locale: Locale, compact = false): string {
  if (minor === null || minor === undefined) return '—'
  const value = Number(minor) / 100
  return new Intl.NumberFormat(tag(locale), {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value)
}

export const num = (n: number | null | undefined, locale: Locale) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat(tag(locale)).format(n)

export const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—')

export function day(d: Date | string | null | undefined, locale: Locale, timeZone = 'UTC'): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d
  return new Intl.DateTimeFormat(tag(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(date)
}

export function dayTime(d: Date | string | null | undefined, locale: Locale, timeZone = 'UTC'): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat(tag(locale), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone }).format(date)
}

export function ago(d: Date | string | null | undefined, locale: Locale, now = new Date()): string {
  if (!d) return '—'
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
