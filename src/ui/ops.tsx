'use client'

import { useState, type ReactNode } from 'react'
import { buttonClass, cx } from '@/ui/kit'
import { showToast } from '@/ui/complete'
import type { GateInfo } from '@/dal/ops'

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
export function BulkPick({ rows, labels, children }: { rows: { id: string; node: ReactNode }[]; labels: { all: string; none: string; picked: string; pickedOne: string; pick: string }; children: ReactNode }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} data-testid="bulk-all">{picked.size === rows.length && rows.length > 0 ? labels.none : labels.all}</button>
        <span className="text-[14px] text-muted" data-testid="bulk-count" aria-live="polite">{picked.size === 1 ? labels.pickedOne : labels.picked.replace('%n', String(picked.size))}</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className={cx('flex items-center gap-3 px-4 py-2', picked.has(r.id) && 'bg-green-50')} data-testid="bulk-row">
            <label className="flex min-h-11 min-w-11 items-center justify-center">
              <input type="checkbox" name="deal_id" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="h-5 w-5" aria-label={labels.pick} />
            </label>
            <div className="min-w-0 flex-1">{r.node}</div>
          </li>
        ))}
      </ul>
      {picked.size > 0 && children}
    </>
  )
}

/** Embudo y etapa inicial de un negocio nuevo: la lista de etapas sigue al embudo elegido. */
export function StagePicker({ pipelines, labels }: { pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[]; labels: { pipeline: string; stage: string; hint: string } }) {
  const [pipe, setPipe] = useState(pipelines[0]?.id ?? '')
  const stages = pipelines.find((p) => p.id === pipe)?.stages ?? []
  return (
    <>
      <label className="col-span-2 block text-[14px] font-medium">{labels.pipeline}
        <select name="pipeline_id" className="input mt-1.5" value={pipe} onChange={(e) => setPipe(e.target.value)} data-testid="new-deal-pipeline">
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {stages.length > 1 && (
        <label className="col-span-2 block text-[14px] font-medium">{labels.stage}
          <select key={pipe} name="stage_id" className="input mt-1.5" defaultValue={stages[0]!.id} data-testid="new-deal-stage">
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="mt-1 block text-[13px] font-normal text-muted">{labels.hint}</span>
        </label>
      )}
    </>
  )
}

export type GateLabels = { title: string; body: string; save: string; amount: string; nextStep: string; nextDue: string; decisionMaker: string; pick: string; met: string; noContacts: string; addContact: string; items: string; openDeal: string }

/** Campos del candado de etapa: solo lo que falta (monto, próximo paso con fecha, decisor), para llenarlo ahí mismo. */
export function GateFields({ info, labels, minDate, dealHref }: { info: GateInfo; labels: GateLabels; minDate: string; dealHref: string }) {
  const has = (k: string) => info.missing.includes(k)
  return (
    <div data-testid="gate-fields">
      {has('amount') && (
        <label className="mt-5 block text-[14px] font-medium">{labels.amount}
          <input name="amount" required inputMode="decimal" defaultValue={info.amount ?? ''} className="input mt-1.5" data-testid="gate-amount" />
        </label>
      )}
      {has('next_step') && (
        <>
          <label className="mt-5 block text-[14px] font-medium">{labels.nextStep}
            <input name="next_step" required minLength={2} maxLength={200} defaultValue={info.nextStep ?? ''} className="input mt-1.5" data-testid="gate-step" />
          </label>
          <label className="mt-4 block text-[14px] font-medium">{labels.nextDue}
            <input name="next_step_due" type="date" required min={minDate} defaultValue={info.nextStepDue && info.nextStepDue >= minDate ? info.nextStepDue : minDate} className="input mt-1.5" data-testid="gate-due" />
          </label>
        </>
      )}
      {has('decision_maker') && (info.contacts.length > 0 ? (
        <>
          <label className="mt-5 block text-[14px] font-medium">{labels.decisionMaker}
            <select name="decision_maker_id" required defaultValue={info.decisionMakerId ?? ''} className="input mt-1.5" data-testid="gate-decision-maker">
              <option value="">{labels.pick}</option>
              {info.contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </label>
          <label className="mt-3 flex min-h-11 items-center gap-3 text-[14px]">
            <input type="checkbox" name="decision_maker_met" required defaultChecked={info.decisionMakerMet} className="h-5 w-5" data-testid="gate-met" />
            {labels.met}
          </label>
        </>
      ) : (
        <p className="mt-5 rounded-[10px] bg-warn-bg px-4 py-3 text-[14px] text-amber-text" data-testid="gate-no-contacts">
          {labels.noContacts} <a href={`/comercios/${info.accountId}?tab=datos`} className="font-semibold underline">{labels.addContact}</a>
        </p>
      ))}
      {has('items') && (
        <p className="mt-5 rounded-[10px] bg-warn-bg px-4 py-3 text-[14px] text-amber-text" data-testid="gate-items">
          {labels.items} <a href={dealHref} className="font-semibold underline">{labels.openDeal}</a>
        </p>
      )}
    </div>
  )
}
