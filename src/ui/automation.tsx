'use client'

import { useActionState, useState, startTransition, type FormEvent } from 'react'
import { buttonClass } from '@/ui/kit'
import type { ActionResult } from '@/lib/errors'
import type { FormAction } from '@/ui/client'

// Formularios de una automatización: condiciones y acciones se arman con listas y campos, sin dibujar flujos.
// Todos los textos llegan ya traducidos desde el servidor; aquí solo vive lo que cambia mientras la persona elige.

export type Opt = { value: string; label: string }
export type FieldOpt = { key: string; label: string; type: 'number' | 'boolean' | 'choice'; ops: Opt[]; options: Opt[] }
type Cond = { field: string; op: string; value?: string | number | null }
type Act = Record<string, string | number>

export type AutomationLabels = {
  ifTitle: string; ifHint: string; none: string; addCondition: string; remove: string; field: string; compare: string; value: string
  thenTitle: string; thenHint: string; addAction: string; what: string; who: string; textEs: string; textEn: string; days: string; kind: string; urgency: string; stage: string; setField: string; setValue: string
}

const row = 'grid grid-cols-1 gap-3 rounded-[14px] border border-line p-4 sm:grid-cols-12'
const lab = 'mb-1.5 block text-[12.5px] font-semibold text-muted-2'

export function AutomationFields({
  fields, actionTypes, targets, kinds, severities, stages, settable, initialConditions, initialActions, labels, disabled,
}: {
  fields: FieldOpt[]; actionTypes: Opt[]; targets: Opt[]; kinds: Opt[]; severities: Opt[]; stages: Opt[]; settable: { key: string; label: string; values: Opt[] }[]
  initialConditions: Cond[]; initialActions: Act[]; labels: AutomationLabels; disabled?: boolean
}) {
  const [conds, setConds] = useState<Cond[]>(initialConditions)
  const [acts, setActs] = useState<Act[]>(initialActions)
  const setCond = (i: number, patch: Partial<Cond>) => setConds((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const setAct = (i: number, patch: Act) => setActs((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const fresh = (type: string): Act => {
    if (type === 'open_exception') return { type, kind: kinds[0]?.value ?? '', severity: 'medium' }
    if (type === 'create_task') return { type, to: 'owner', text_es: '', text_en: '', due_days: 1 }
    if (type === 'notify') return { type, to: targets[1]?.value ?? 'role:supervisor', text_es: '', text_en: '' }
    if (type === 'assign') return { type, to: targets[1]?.value ?? 'role:supervisor' }
    if (type === 'move_stage') return { type, stage_code: stages[0]?.value ?? '' }
    return { type, field: settable[0]?.key ?? '', value: settable[0]?.values[0]?.value ?? '' }
  }
  return (
    <div className="space-y-8">
      <input type="hidden" name="conditions" value={JSON.stringify(conds)} />
      <input type="hidden" name="actions" value={JSON.stringify(acts)} />
      <fieldset disabled={disabled} data-testid="auto-conditions">
        <legend className="text-[15px] font-semibold text-strong">{labels.ifTitle}</legend>
        <p className="mb-3 mt-1 text-[13px] text-muted-2">{labels.ifHint}</p>
        <div className="space-y-3">
          {conds.length === 0 && <p className="text-[13.5px] text-muted">{labels.none}</p>}
          {conds.map((c, i) => {
            const f = fields.find((x) => x.key === c.field) ?? fields[0]
            if (!f) return null
            const needsValue = f.type === 'number' || (f.type === 'choice' && (c.op === 'eq' || c.op === 'ne'))
            return (
              <div key={i} className={row} data-testid="auto-condition">
                <label className="sm:col-span-5"><span className={lab}>{labels.field}</span>
                  <select className="input" value={f.key} data-testid="cond-field" onChange={(e) => { const nf = fields.find((x) => x.key === e.target.value)!; setCond(i, { field: nf.key, op: nf.ops[0]!.value, value: nf.type === 'choice' ? nf.options[0]?.value : nf.type === 'number' ? 0 : null }) }}>
                    {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                </label>
                <label className="sm:col-span-3"><span className={lab}>{labels.compare}</span>
                  <select className="input" value={c.op} data-testid="cond-op" onChange={(e) => setCond(i, { op: e.target.value })}>
                    {f.ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <div className="sm:col-span-3">
                  {needsValue && (
                    <label><span className={lab}>{labels.value}</span>
                      {f.type === 'number'
                        ? <input className="input" type="number" inputMode="decimal" step="any" value={String(c.value ?? '')} data-testid="cond-value" onChange={(e) => setCond(i, { value: e.target.value === '' ? '' : Number(e.target.value) })} />
                        : <select className="input" value={String(c.value ?? '')} data-testid="cond-value" onChange={(e) => setCond(i, { value: e.target.value })}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
                    </label>
                  )}
                </div>
                <div className="flex items-end sm:col-span-1"><button type="button" className={buttonClass('quiet', 'sm')} onClick={() => setConds((l) => l.filter((_, j) => j !== i))} aria-label={`${labels.remove}: ${f.label}`}>{labels.remove}</button></div>
              </div>
            )
          })}
        </div>
        {conds.length < 6 && fields.length > 0 && (
          <button type="button" className={`${buttonClass('ghost', 'sm')} mt-3`} data-testid="cond-add" onClick={() => { const f = fields[0]!; setConds((l) => [...l, { field: f.key, op: f.ops[0]!.value, value: f.type === 'choice' ? f.options[0]?.value : f.type === 'number' ? 0 : null }]) }}>{labels.addCondition}</button>
        )}
      </fieldset>

      <fieldset disabled={disabled} data-testid="auto-actions">
        <legend className="text-[15px] font-semibold text-strong">{labels.thenTitle}</legend>
        <p className="mb-3 mt-1 text-[13px] text-muted-2">{labels.thenHint}</p>
        <div className="space-y-3">
          {acts.map((a, i) => (
            <div key={i} className={row} data-testid="auto-action">
              <label className="sm:col-span-4"><span className={lab}>{labels.what}</span>
                <select className="input" value={String(a.type)} data-testid="act-type" onChange={(e) => setActs((l) => l.map((x, j) => (j === i ? fresh(e.target.value) : x)))}>
                  {actionTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {(a.type === 'create_task' || a.type === 'notify' || a.type === 'assign') && (
                <label className="sm:col-span-4"><span className={lab}>{labels.who}</span>
                  <select className="input" value={String(a.to)} data-testid="act-to" onChange={(e) => setAct(i, { to: e.target.value })}>
                    {targets.filter((o) => a.type !== 'assign' || o.value !== 'owner').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
              {a.type === 'create_task' && (
                <label className="sm:col-span-3"><span className={lab}>{labels.days}</span>
                  <input className="input" type="number" inputMode="numeric" min={0} max={30} value={String(a.due_days ?? 0)} data-testid="act-days" onChange={(e) => setAct(i, { due_days: Number(e.target.value) })} />
                </label>
              )}
              {a.type === 'open_exception' && (<>
                <label className="sm:col-span-4"><span className={lab}>{labels.kind}</span>
                  <select className="input" value={String(a.kind)} onChange={(e) => setAct(i, { kind: e.target.value })}>{kinds.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                </label>
                <label className="sm:col-span-3"><span className={lab}>{labels.urgency}</span>
                  <select className="input" value={String(a.severity)} onChange={(e) => setAct(i, { severity: e.target.value })}>{severities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                </label>
              </>)}
              {a.type === 'move_stage' && (
                <label className="sm:col-span-7"><span className={lab}>{labels.stage}</span>
                  <select className="input" value={String(a.stage_code)} onChange={(e) => setAct(i, { stage_code: e.target.value })}>{stages.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                </label>
              )}
              {a.type === 'set_field' && (<>
                <label className="sm:col-span-4"><span className={lab}>{labels.setField}</span>
                  <select className="input" value={String(a.field)} onChange={(e) => setAct(i, { field: e.target.value, value: settable.find((s) => s.key === e.target.value)?.values[0]?.value ?? '' })}>{settable.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
                </label>
                <label className="sm:col-span-3"><span className={lab}>{labels.setValue}</span>
                  <select className="input" value={String(a.value)} onChange={(e) => setAct(i, { value: e.target.value })}>{(settable.find((s) => s.key === a.field)?.values ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                </label>
              </>)}
              <div className="flex items-end justify-end sm:col-span-1 sm:col-start-12">{acts.length > 1 && <button type="button" className={buttonClass('quiet', 'sm')} onClick={() => setActs((l) => l.filter((_, j) => j !== i))}>{labels.remove}</button>}</div>
              {(a.type === 'create_task' || a.type === 'notify') && (<>
                <label className="sm:col-span-6"><span className={lab}>{labels.textEs}</span>
                  <input className="input" maxLength={160} value={String(a.text_es ?? '')} data-testid="act-es" onChange={(e) => setAct(i, { text_es: e.target.value })} />
                </label>
                <label className="sm:col-span-6"><span className={lab}>{labels.textEn}</span>
                  <input className="input" maxLength={160} value={String(a.text_en ?? '')} data-testid="act-en" onChange={(e) => setAct(i, { text_en: e.target.value })} />
                </label>
              </>)}
            </div>
          ))}
        </div>
        {acts.length < 3 && <button type="button" className={`${buttonClass('ghost', 'sm')} mt-3`} data-testid="act-add" onClick={() => setActs((l) => [...l, fresh(actionTypes[0]!.value)])}>{labels.addAction}</button>}
      </fieldset>
    </div>
  )
}

export type TestLabels = { record: string; hint: string; run: string; notFound: string; outOfScope: string; would: string; wouldNot: string; already: string; met: string; unmet: string; noConditions: string }
type TestData = { found: boolean; label: string | null; inScope: boolean; checks: boolean[]; wouldAct: boolean; alreadyDone: boolean }

/** "Probar contra un registro": dice qué haría la automatización, condición por condición, sin cambiar nada. */
export function AutomationTest({ action, id, conditions, labels }: { action: FormAction; id: string; conditions: string[]; labels: TestLabels }) {
  const [state, run, pending] = useActionState<ActionResult<unknown> | null, FormData>(action, null)
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    startTransition(() => run(data))
  }
  const d = state?.ok ? (state.data as TestData | undefined) : undefined
  return (
    <form onSubmit={onSubmit} data-testid="auto-test">
      <input type="hidden" name="id" value={id} />
      <label className="block"><span className={lab}>{labels.record}</span>
        <input name="record" className="input" required data-testid="auto-test-record" autoComplete="off" />
        <span className="mt-1.5 block text-[12px] text-muted">{labels.hint}</span>
      </label>
      <div className="mt-4"><button type="submit" disabled={pending} aria-busy={pending} className={buttonClass('ghost')} data-testid="auto-test-run">{labels.run}</button></div>
      {state && !state.ok && <p role="alert" className="mt-4 rounded-2xl bg-red/10 px-4 py-3 text-[13.5px] font-medium text-red-text" data-testid="auto-test-error">{state.error}</p>}
      {d && (
        <div role="status" className="mt-4 rounded-[14px] border border-line p-4 text-[14px]" data-testid="auto-test-result" data-would={d.wouldAct ? '1' : '0'}>
          {!d.found ? <p>{labels.notFound}</p> : (
            <>
              <p className="font-semibold text-strong">{d.label}</p>
              {!d.inScope && <p className="mt-2 text-amber-text">{labels.outOfScope}</p>}
              {conditions.length === 0 ? <p className="mt-2 text-muted-2">{labels.noConditions}</p> : (
                <ul className="mt-2 space-y-1">
                  {conditions.map((c, i) => <li key={i} data-met={d.checks[i] ? '1' : '0'}><span className={d.checks[i] ? 'font-semibold text-brand-text' : 'font-semibold text-red-text'}>{d.checks[i] ? labels.met : labels.unmet}</span> {c}</li>)}
                </ul>
              )}
              <p className="mt-3 font-semibold">{d.wouldAct ? (d.alreadyDone ? labels.already : labels.would) : labels.wouldNot}</p>
            </>
          )}
        </div>
      )}
    </form>
  )
}
