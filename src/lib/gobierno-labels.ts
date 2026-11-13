import type { Locale, T } from '@/lib/format'

type Pair = [es: string, en: string]

export const OBJECTIVE_LABEL: Record<string, { label: Pair; hint: Pair }> = {
  availability: { label: ['Disponibilidad', 'Availability'], hint: ['Peticiones que respondieron sin error del servidor.', 'Requests answered with no server error.'] },
  latency_page: { label: ['Abrir una pantalla', 'Opening a screen'], hint: ['Tiempo en el navegador de la persona, el 95% de las veces.', 'Time in the person’s browser, 95% of the time.'] },
  latency_action: { label: ['Guardar un cambio', 'Saving a change'], hint: ['Tiempo en el servidor, el 95% de las veces.', 'Time on the server, 95% of the time.'] },
  latency_api: { label: ['Responder a la API', 'Answering the API'], hint: ['Tiempo en el servidor, el 95% de las veces.', 'Time on the server, 95% of the time.'] },
  rpo_minutes: { label: ['Cuánta información se puede perder como máximo', 'How much data can be lost at most'], hint: ['Punto de recuperación (RPO).', 'Recovery point (RPO).'] },
  rto_minutes: { label: ['En cuánto tiempo vuelve el servicio', 'How long the service takes to come back'], hint: ['Tiempo de recuperación (RTO).', 'Recovery time (RTO).'] },
  restore_test_days: { label: ['Cada cuánto se prueba restaurar', 'How often restoring is tested'], hint: ['Un respaldo que nunca se restauró no cuenta.', 'A backup that was never restored does not count.'] },
}
export const SEVERITY_LABEL: Record<string, Pair> = { high: ['Grave', 'High'], medium: ['Media', 'Medium'], low: ['Leve', 'Low'] }
export const INCIDENT_STATUS_LABEL: Record<string, Pair> = { open: ['Abierto', 'Open'], mitigated: ['Contenido', 'Mitigated'], closed: ['Cerrado', 'Closed'] }
export const COMPONENT_LABEL: Record<string, Pair> = {
  platform: ['Plataforma', 'Platform'], database: ['Base de datos', 'Database'], third_party: ['Terceros', 'Third parties'], ai: ['AI', 'AI'], support: ['Soporte', 'Support'], other: ['Otro', 'Other'],
}
export const REQUEST_KIND_LABEL: Record<string, Pair> = {
  field: ['Campo nuevo', 'New field'], option: ['Opciones de una lista', 'Options of a list'], pipeline: ['Embudo o etapa', 'Pipeline or stage'], report: ['Reporte', 'Report'], other: ['Otra cosa', 'Something else'],
}
export const REQUEST_STATUS_LABEL: Record<string, Pair> = { open: ['En revisión', 'In review'], approved: ['Aprobada', 'Approved'], rejected: ['No se hará', 'Will not be done'], done: ['Hecha', 'Done'] }
export const MATERIAL_LABEL: Record<string, Pair> = { deck: ['Presentación de inicio', 'Onboarding deck'], lead_guide: ['Guía de leads', 'Lead guide'], faq: ['Preguntas frecuentes', 'FAQ'] }

export const usd = (n: number, locale: Locale) => new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { style: 'currency', currency: 'USD', currencyDisplay: 'code', maximumFractionDigits: 2 }).format(n)

/** "2026-11" a "noviembre de 2026" / "November 2026". */
export const monthLabel = (month: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`))

/** El percentil 95 sale de un histograma: se dice el tope del tramo donde cae. */
export const msText = (t: T, p95: number | null) =>
  p95 === null ? t('Sin mediciones todavía', 'No measurements yet') : p95 === Infinity ? t('más de 4,000 ms', 'over 4,000 ms') : t(`hasta ${p95.toLocaleString('es-MX')} ms`, `up to ${p95.toLocaleString('en-US')} ms`)
