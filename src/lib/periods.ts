import { addDays } from '@/lib/format'

/** Periodos de los reportes. Las fechas son días de calendario en la zona del mercado, las dos incluidas. */
export const PERIOD_KEYS = ['semana', 'mes', 'mes-pasado', 'trimestre', '30d', 'rango'] as const
export type PeriodKey = (typeof PERIOD_KEYS)[number]
export type Period = { key: PeriodKey; from: string; to: string }

export const PERIOD_LABEL: Record<PeriodKey, [es: string, en: string]> = {
  semana: ['Esta semana', 'This week'],
  mes: ['Este mes', 'This month'],
  'mes-pasado': ['Mes pasado', 'Last month'],
  trimestre: ['Este trimestre', 'This quarter'],
  '30d': ['Últimos 30 días', 'Last 30 days'],
  rango: ['Rango', 'Range'],
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const valid = (s: string | undefined): s is string => !!s && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
export const isPeriodKey = (v: string | undefined): v is PeriodKey => !!v && (PERIOD_KEYS as readonly string[]).includes(v)

/** Lunes de la semana de una fecha (la semana va de lunes a domingo). */
export function weekStart(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay() // 0 = domingo
  return addDays(iso, -((dow + 6) % 7))
}

/**
 * Convierte un periodo con nombre en fechas concretas a partir del "hoy" de un mercado.
 * Un rango incompleto o inválido cae en el periodo por defecto; un rango invertido se voltea; nunca pasa de 366 días.
 */
export function resolvePeriod(key: string | undefined, today: string, from?: string, to?: string, fallback: PeriodKey = 'mes'): Period {
  const k: PeriodKey = isPeriodKey(key) ? key : fallback
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))]
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`
  if (k === 'semana') return { key: k, from: weekStart(today), to: today }
  if (k === 'mes') return { key: k, from: first(y, m), to: today }
  if (k === 'mes-pasado') {
    const start = m === 1 ? first(y - 1, 12) : first(y, m - 1)
    return { key: k, from: start, to: addDays(first(y, m), -1) }
  }
  if (k === 'trimestre') return { key: k, from: first(y, m - ((m - 1) % 3)), to: today }
  if (k === '30d') return { key: k, from: addDays(today, -29), to: today }
  if (!valid(from) || !valid(to)) return resolvePeriod(fallback === 'rango' ? 'mes' : fallback, today)
  const [a, b] = from <= to ? [from, to] : [to, from]
  return { key: 'rango', from: a, to: addDays(a, 365) < b ? addDays(a, 365) : b }
}

/** Texto seguro para una celda de CSV: comillas dobladas, y sin fórmulas (una celda que empieza con = + - @ se abre como texto). */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  let s = String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (head: string[], rows: (string | number | null | undefined)[][]): string =>
  '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

/** Último día de un mes dado como 'AAAA-MM'. Aritmética de calendario pura: no depende de la hora ni de la zona del servidor. */
export function monthEnd(month: string): string {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(days).padStart(2, '0')}`
}
