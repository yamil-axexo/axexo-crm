'use client'

import { useState } from 'react'
import type { FieldDef } from '@/dal/fields'
import { ActionForm, Submit, type FormAction } from '@/ui/client'
import { noData, noDataLabel } from '@/lib/no-data'

type Labels = { filter: string; save: string; yes: string; no: string; currency: string; onlyFilled: string; none: string }

/** Formulario genérico de campos adicionales. El filtro solo esconde filas: todo lo escrito viaja al guardar. */
export function CustomFieldsForm({ id, defs, values, action, locale, labels }: { id: string; defs: FieldDef[]; values: Record<string, unknown>; action: FormAction; locale: 'es' | 'en'; labels: Labels }) {
  const [q, setQ] = useState('')
  const [onlyFilled, setOnlyFilled] = useState(false)
  // Campos condicionados (por ejemplo, los documentos según el tipo de persona): siguen lo que la persona va eligiendo.
  const controls = new Set(defs.flatMap((d) => (d.applies_when ? [d.applies_when.key] : [])))
  const [picked, setPicked] = useState<Record<string, unknown>>(() => Object.fromEntries([...controls].map((k) => [k, values[k]])))
  const applies = (d: FieldDef) => !d.applies_when || picked[d.applies_when.key] === d.applies_when.equals
  const has = (k: string) => {
    const v = values[k]
    return !(v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0))
  }
  const needle = q.trim().toLowerCase()
  const visible = (d: FieldDef) => applies(d) && (!needle || `${d.label_es} ${d.label_en}`.toLowerCase().includes(needle)) && (!onlyFilled || has(d.key))
  const shown = defs.filter(visible).length
  return (
    <ActionForm action={action} testId="custom-form">
      <input type="hidden" name="id" value={id} />
      <div className="sticky top-0 z-10 -mx-2 mb-6 flex flex-wrap items-center gap-4 rounded-2xl bg-surface/95 px-2 py-3 backdrop-blur">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={labels.filter} aria-label={labels.filter} className="input !w-72" data-testid="custom-filter" />
        <label className="flex items-center gap-2 text-[13.5px] text-muted-2"><input type="checkbox" className="h-4 w-4" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} />{labels.onlyFilled}</label>
        <span className="ml-auto text-[12.5px] text-muted">{shown} / {defs.length}</span>
        <Submit testId="custom-save">{labels.save}</Submit>
      </div>
      {shown === 0 && <p className="py-6 text-center text-[14px] text-muted">{labels.none}</p>}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
        {defs.map((d) => {
          const v = values[d.key]
          const name = `f_${d.key}`
          const label = locale === 'en' ? d.label_en : d.label_es
          return (
            <label key={d.key} className={visible(d) ? 'block min-w-0' : 'hidden'} data-testid="custom-input">
              <span className="mb-1.5 block text-[12.5px] font-medium text-muted-2">{label}</span>
              {d.data_type === 'long_text' ? (
                <textarea name={name} defaultValue={typeof v === 'string' ? v : ''} rows={3} className="input !h-auto py-2.5" />
              ) : d.data_type === 'select' ? (
                <select name={name} defaultValue={typeof v === 'string' ? v : ''} className="input" onChange={controls.has(d.key) ? (e) => setPicked((p) => ({ ...p, [d.key]: e.target.value })) : undefined}>
                  <option value="" aria-label={noDataLabel(locale)}>{noData(locale)}</option>
                  {[...new Set([...d.options, ...(typeof v === 'string' && v ? [v] : [])])].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : d.data_type === 'multiselect' ? (
                <span className="flex flex-wrap gap-x-4 gap-y-2 rounded-2xl border border-line px-3 py-2.5">
                  <input type="hidden" name={name} value="" />
                  {d.options.map((o) => (
                    <span key={o} className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" className="h-4 w-4" name={name} value={o} defaultChecked={Array.isArray(v) && v.includes(o)} />{o}</span>
                  ))}
                </span>
              ) : d.data_type === 'boolean' ? (
                <select name={name} defaultValue={v === true ? 'true' : v === false ? 'false' : ''} className="input">
                  <option value="" aria-label={noDataLabel(locale)}>{noData(locale)}</option><option value="true">{labels.yes}</option><option value="false">{labels.no}</option>
                </select>
              ) : d.data_type === 'money' ? (
                <span className="flex gap-2">
                  <input name={name} type="number" step="any" defaultValue={typeof v === 'object' && v !== null ? String((v as { amount?: number }).amount ?? '') : ''} className="input" />
                  <input name={`c_${d.key}`} maxLength={3} placeholder={labels.currency} aria-label={`${label} · ${labels.currency}`} defaultValue={typeof v === 'object' && v !== null ? String((v as { currency?: string | null }).currency ?? '') : ''} className="input !w-24 uppercase" />
                </span>
              ) : (
                <input name={name} type={d.data_type === 'number' ? 'number' : d.data_type === 'date' ? 'date' : 'text'} step={d.data_type === 'number' ? 'any' : undefined}
                  defaultValue={typeof v === 'string' || typeof v === 'number' ? String(v) : ''} className="input" />
              )}
            </label>
          )
        })}
      </div>
    </ActionForm>
  )
}
