import type { T } from '@/lib/format'

/** La meta de respuesta de un turno, en palabras: "1 día hábil", "3 horas hábiles", "45 minutos hábiles". */
export function targetText(t: T, r: { sla_minutes: number; sla_business_days: number | null }): string {
  if (r.sla_business_days) return r.sla_business_days === 1 ? t('1 día hábil', '1 business day') : t(`${r.sla_business_days} días hábiles`, `${r.sla_business_days} business days`)
  if (r.sla_minutes % 60 === 0) {
    const h = r.sla_minutes / 60
    return h === 1 ? t('1 hora hábil', '1 business hour') : t(`${h} horas hábiles`, `${h} business hours`)
  }
  return t(`${r.sla_minutes} minutos hábiles`, `${r.sla_minutes} business minutes`)
}

/** Cantidad y unidad con las que se muestra la meta en el formulario. */
export function targetParts(r: { sla_minutes: number; sla_business_days: number | null }): { amount: number; unit: 'minutes' | 'hours' | 'days' } {
  if (r.sla_business_days) return { amount: r.sla_business_days, unit: 'days' }
  if (r.sla_minutes % 60 === 0) return { amount: r.sla_minutes / 60, unit: 'hours' }
  return { amount: r.sla_minutes, unit: 'minutes' }
}
