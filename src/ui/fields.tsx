import type { ReactNode } from 'react'
import type { FieldDef } from '@/dal/fields'
import type { Locale, T } from '@/lib/format'
import { day } from '@/lib/format'

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

export function fieldText(def: Pick<FieldDef, 'data_type'>, v: unknown, t: T, locale: Locale): string {
  if (empty(v)) return ''
  if (Array.isArray(v)) return v.map(String).join(', ')
  if (def.data_type === 'boolean') return v === true ? t('Sí', 'Yes') : t('No', 'No')
  if (def.data_type === 'date' && typeof v === 'string') return day(v, locale)
  if (typeof v === 'object') {
    const o = v as { amount?: unknown; currency?: unknown }
    if (typeof o.amount === 'number') return `${new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { maximumFractionDigits: 2 }).format(o.amount)}${o.currency ? ` ${String(o.currency)}` : ''}`
    return JSON.stringify(v)
  }
  if (typeof v === 'number') return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { maximumFractionDigits: 6 }).format(v)
  return String(v)
}

/** DATA-08: muestra los campos adicionales que tienen valor. Los que no tienen no ocupan pantalla. */
export function CustomFields({ defs, values, t, locale, action }: { defs: FieldDef[]; values: Record<string, unknown>; t: T; locale: Locale; action?: ReactNode }) {
  const filled = defs.filter((d) => !empty(values[d.key]))
  // Los campos que alimentan una columna del modelo solo cuentan aquí si traen un valor que no cupo en ella.
  const total = defs.filter((d) => d.mapped_to === null || !empty(values[d.key])).length
  return (
    <div data-testid="custom-fields">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-2" data-testid="custom-count">
          {t(`${filled.length} de ${total} campos con dato`, `${filled.length} of ${total} fields have a value`)}
        </p>
        {action}
      </div>
      {filled.length > 0 && (
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {filled.map((d) => (
            <div key={d.key} className="min-w-0 border-t border-line pt-2.5" data-testid="custom-field">
              <dt className="text-[12px] font-medium text-muted">{t(d.label_es, d.label_en)}</dt>
              <dd className="mt-0.5 text-[14px] break-words whitespace-pre-line text-strong">{fieldText(d, values[d.key], t, locale)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
