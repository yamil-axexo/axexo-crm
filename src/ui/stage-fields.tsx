'use client'

import { useState } from 'react'

export type StageFieldOption = { key: string; label: string }
type Labels = { legend: string; hint: string; filter: string; required: string; highlight: string; none: string; picked: string }

/**
 * Campos definidos del negocio que una etapa puede pedir para entrar (requisito) o destacar sin exigirlos.
 * El filtro solo esconde renglones: lo marcado viaja al guardar aunque no se vea. Un campo es requisito o destacado, no los dos.
 */
export function StageFieldPicker({ fields, required, highlight, labels }: { fields: StageFieldOption[]; required: string[]; highlight: string[]; labels: Labels }) {
  const [q, setQ] = useState('')
  const [req, setReq] = useState<Set<string>>(() => new Set(required))
  const [hi, setHi] = useState<Set<string>>(() => new Set(highlight.filter((k) => !required.includes(k))))
  const needle = q.trim().toLowerCase()
  const toggle = (which: 'req' | 'hi', key: string) => {
    const a = new Set(req)
    const b = new Set(hi)
    if (which === 'req') {
      if (a.has(key)) a.delete(key)
      else { a.add(key); b.delete(key) }
    } else if (b.has(key)) b.delete(key)
    else { b.add(key); a.delete(key) }
    setReq(a)
    setHi(b)
  }
  return (
    <fieldset className="col-span-2" data-testid="stage-fields">
      <legend className="mb-1 block text-[13px] font-semibold text-muted-2">{labels.legend}</legend>
      <p className="mb-3 text-[13px] text-muted">{labels.hint}</p>
      <input type="hidden" name="fields_offered" value="1" />
      {fields.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[13.5px] text-muted-2" data-testid="stage-fields-empty">{labels.none}</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={labels.filter} aria-label={labels.filter} className="input !w-64 max-w-full" data-testid="stage-fields-filter" />
            <span className="text-[12.5px] text-muted" aria-live="polite" data-testid="stage-fields-count">{labels.picked.replace('%r', String(req.size)).replace('%h', String(hi.size))}</span>
          </div>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-2xl border border-line">
            {fields.map((f) => (
              <li key={f.key} className={!needle || f.label.toLowerCase().includes(needle) ? 'flex flex-wrap items-center justify-between gap-x-4 px-3 py-1' : 'hidden'} data-testid="stage-field-row" data-key={f.key}>
                <span className="min-w-0 flex-1 text-[14px] [overflow-wrap:anywhere]">{f.label}</span>
                <span className="flex shrink-0 gap-4">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px]">
                    <input type="checkbox" name="required_custom" value={f.key} checked={req.has(f.key)} onChange={() => toggle('req', f.key)} className="h-5 w-5" data-testid={`stage-field-req-${f.key}`} />
                    {labels.required}
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px]">
                    <input type="checkbox" name="highlight" value={`field:${f.key}`} checked={hi.has(f.key)} onChange={() => toggle('hi', f.key)} className="h-5 w-5" data-testid={`stage-field-hi-${f.key}`} />
                    {labels.highlight}
                  </label>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  )
}
