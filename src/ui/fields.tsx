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

const SECTION: Record<string, [string, string]> = {
  qualify: ['Para calificar', 'To qualify'],
  terms: ['Términos comerciales', 'Commercial terms'],
  file: ['Expediente', 'Contract file'],
}

/**
 * Bloques de la venta B2B (para calificar, términos comerciales y expediente): se ven completos, también lo que falta,
 * para que el equipo sepa qué le falta a la cuenta. El expediente guarda el estado de cada documento, nunca el documento.
 */
export function FieldSections({ defs, values, t, locale }: { defs: FieldDef[]; values: Record<string, unknown>; t: T; locale: Locale }) {
  const groups = (['qualify', 'terms', 'file'] as const).map((k) => ({ k, items: defs.filter((d) => d.section === k) })).filter((g) => g.items.length > 0)
  if (groups.length === 0) return null
  return (
    <div className="space-y-5" data-testid="field-sections">
      {groups.map((g) => {
        const docs = g.k === 'file' ? g.items.filter((d) => d.applies_when) : []
        const ready = docs.filter((d) => values[d.key] === 'Validado').length
        return (
          <section key={g.k} data-testid={`field-section-${g.k}`}>
            <h4 className="text-[13px] font-semibold text-muted-2">
              {t(...SECTION[g.k]!)}
              {g.k === 'file' && docs.length > 0 && <span className="ml-2 font-normal text-muted" data-testid="file-progress">{t(`${ready} de ${docs.length} documentos validados`, `${ready} of ${docs.length} documents validated`)}</span>}
            </h4>
            {g.k === 'file' && <p className="text-[13px] text-muted">{t('Aquí va el estado de cada documento. El documento se guarda fuera de CONTIGO.', 'This holds the status of each document. The document itself is kept outside CONTIGO.')}</p>}
            <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {g.items.map((d) => {
                const text = fieldText(d, values[d.key], t, locale)
                return (
                  <div key={d.key} className="min-w-0 border-t border-line pt-2" data-testid="section-field" data-key={d.key}>
                    <dt className="text-[12.5px] font-medium text-muted">{t(d.label_es, d.label_en)}</dt>
                    <dd className={text ? 'mt-0.5 text-[14px] break-words text-strong' : 'mt-0.5 text-[14px] text-amber-text'}>{text || (d.applies_when ? t('Pendiente', 'Pending') : t('Falta', 'Missing'))}</dd>
                  </div>
                )
              })}
            </dl>
          </section>
        )
      })}
    </div>
  )
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
