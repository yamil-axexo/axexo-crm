'use client'

import { useEffect, useRef, useState } from 'react'
import { noData, noDataLabel } from '@/lib/no-data'

export type IntakeDef = { key: string; label_es: string; label_en: string; data_type: string; options: string[]; market_code: string | null; motor: string | null }

/**
 * Lo mínimo para calificar, dentro del formulario de alta: muestra los campos que tocan según el mercado y el canal elegidos
 * en ese mismo formulario (por ejemplo, los de B2B). No bloquea el alta: lo que falte se completa después en la ficha.
 */
export function IntakeFields({ defs, locale, legend, yes, no }: { defs: IntakeDef[]; locale: 'es' | 'en'; legend: string; yes: string; no: string }) {
  const anchor = useRef<HTMLFieldSetElement>(null)
  const [scope, setScope] = useState<{ market: string; motor: string }>({ market: '', motor: '' })
  useEffect(() => {
    const form = anchor.current?.closest('form')
    if (!form) return
    const read = () => {
      const value = (name: string) => (form.elements.namedItem(name) as HTMLSelectElement | null)?.value ?? ''
      setScope({ market: value('market'), motor: value('segment') })
    }
    read()
    form.addEventListener('change', read)
    return () => form.removeEventListener('change', read)
  }, [])
  const shown = defs.filter((d) => (d.market_code === null || d.market_code === scope.market) && (d.motor === null || d.motor === scope.motor))
  return (
    <fieldset ref={anchor} className={shown.length ? 'col-span-2 grid grid-cols-2 gap-4 rounded-[12px] bg-surface-3 p-4' : 'hidden'} data-testid="intake-fields">
      <legend className="float-left col-span-2 mb-1 w-full text-[13px] font-semibold text-muted-2">{legend}</legend>
      {shown.map((d) => (
        <label key={d.key} className="col-span-2 block min-w-0 sm:col-span-1" data-testid="intake-field">
          <span className="mb-1.5 block text-[13px] font-semibold text-muted-2">{locale === 'en' ? d.label_en : d.label_es}</span>
          {d.data_type === 'select' ? (
            <select name={`f_${d.key}`} className="input" defaultValue=""><option value="" title={noDataLabel(locale)}>{noData(locale)}</option>{d.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          ) : d.data_type === 'boolean' ? (
            <select name={`f_${d.key}`} className="input" defaultValue=""><option value="" title={noDataLabel(locale)}>{noData(locale)}</option><option value="true">{yes}</option><option value="false">{no}</option></select>
          ) : (
            <input name={`f_${d.key}`} className="input" type={d.data_type === 'number' ? 'number' : d.data_type === 'date' ? 'date' : 'text'} step={d.data_type === 'number' ? 'any' : undefined} min={d.data_type === 'number' ? 0 : undefined} />
          )}
        </label>
      ))}
    </fieldset>
  )
}
