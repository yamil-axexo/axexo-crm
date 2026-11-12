'use client'

import { useState, type ReactNode } from 'react'
import { buttonClass, cx } from '@/ui/kit'
import { showToast } from '@/ui/complete'

/** Copiar con un toque (Merchant ID). */
export function CopyValue({ value, label, copied }: { value: string; label: string; copied: string }) {
  return (
    <button type="button" onClick={() => navigator.clipboard?.writeText(value).then(() => showToast(copied))} aria-label={`${label}: ${value}`} title={label}
      className="press inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[15px] font-semibold text-strong hover:bg-green-50" data-testid="merchant-ref-copy">
      <span className="num">{value}</span>
      <span className="text-[13px] font-medium text-brand-text">{label}</span>
    </button>
  )
}

/** Selección múltiple para cerrar en bloque: cuenta lo elegido y permite marcar o desmarcar todo. Las casillas viajan en el formulario que lo envuelve. */
export function BulkPick({ rows, labels, children }: { rows: { id: string; node: ReactNode }[]; labels: { all: string; none: string; picked: string }; children: ReactNode }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} data-testid="bulk-all">{picked.size === rows.length && rows.length > 0 ? labels.none : labels.all}</button>
        <span className="text-[14px] text-muted" data-testid="bulk-count" aria-live="polite">{labels.picked.replace('%n', String(picked.size))}</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className={cx('flex items-center gap-3 px-4 py-2', picked.has(r.id) && 'bg-green-50')} data-testid="bulk-row">
            <label className="flex min-h-11 min-w-11 items-center justify-center">
              <input type="checkbox" name="deal_id" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="h-5 w-5" aria-label={labels.picked.replace('%n', '1')} />
            </label>
            <div className="min-w-0 flex-1">{r.node}</div>
          </li>
        ))}
      </ul>
      {picked.size > 0 && children}
    </>
  )
}
