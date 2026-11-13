'use client'

import { startTransition, useActionState, useRef, useState, type FormEvent } from 'react'
import type { ActionResult } from '@/lib/errors'
import type { ImportState } from '@/app/(app)/importar/actions'
import { buttonClass, cx } from '@/ui/kit'

type Action = (prev: ActionResult<ImportState> | null, data: FormData) => Promise<ActionResult<ImportState>>
export type ImportLabels = {
  kind: string; market: string; file: string; fileHint: string; check: string; checking: string; run: (n: number) => string; running: string; template: string
  summary: (s: { total: number; ok: number; duplicates: number; errors: number }) => string; nothing: string; row: string; what: string; why: string
  duplicate: string; error: string; more: (n: number) => string; changed: string; allGood: string; again: string
}

/**
 * AUT-07: importar un CSV en dos pasos dentro del mismo formulario. "Revisar" valida todo y no escribe nada; "Importar"
 * vuelve a mandar el mismo archivo con la huella de la revisión. El archivo vive en el navegador y en la solicitud: no se guarda.
 */
export function ImportCsv({ action, kinds, markets, initialKind, labels }: { action: Action; kinds: { value: string; label: string }[]; markets: { code: string; name: string }[]; initialKind: string; labels: ImportLabels }) {
  const [state, formAction, pending] = useActionState(action, null)
  const [kind, setKind] = useState(initialKind)
  const [dirty, setDirty] = useState(false)
  const intent = useRef<'check' | 'run'>('check')
  const form = useRef<HTMLFormElement>(null)
  const preview = state?.ok && state.data?.step === 'preview' && !dirty ? state.data : null
  const done = state?.ok && state.data?.step === 'done' && !dirty ? state.data : null

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    data.set('intent', intent.current)
    if (intent.current === 'run' && preview) data.set('checksum', preview.checksum)
    setDirty(false)
    startTransition(() => formAction(data))
  }
  const touched = () => setDirty(true)

  return (
    <form ref={form} action={formAction} onSubmit={submit} className="space-y-5" data-testid="import-form">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold text-muted-2">{labels.kind}
          <select name="kind" className="input mt-1.5" value={kind} onChange={(e) => { setKind(e.target.value); touched() }} data-testid="import-kind">
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="block text-[13px] font-semibold text-muted-2">{labels.market}
          <select name="market" className="input mt-1.5" onChange={touched} data-testid="import-market">
            {markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-[13px] font-semibold text-muted-2">{labels.file}
        <input type="file" name="file" accept=".csv,text/csv" required onChange={touched} className="input mt-1.5 h-auto min-h-11 py-2" data-testid="import-file" />
        <span className="mt-1.5 block text-[12.5px] font-normal text-muted">{labels.fileHint}</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} onClick={() => { intent.current = 'check' }} className={buttonClass(preview ? 'ghost' : 'primary')} data-testid="import-check">{pending && intent.current === 'check' ? labels.checking : preview ? labels.again : labels.check}</button>
        <a href={`/importar/plantilla?tipo=${kind}`} download className={cx(buttonClass('ghost'))} data-testid="import-template">{labels.template}</a>
      </div>

      {state && !state.ok && <p role="alert" className="rounded-2xl bg-red/10 px-4 py-3 text-[13.5px] font-medium text-red-text" data-testid="import-error">{state.error}</p>}
      {dirty && state?.ok && <p className="text-[13px] text-muted" data-testid="import-changed">{labels.changed}</p>}

      {preview && (
        <section className="rounded-[18px] border border-line p-5" aria-live="polite" data-testid="import-preview">
          {preview.fileProblem ? (
            <p role="alert" className="text-[14px] font-medium text-red-text" data-testid="import-file-problem">{preview.fileProblem}</p>
          ) : (
            <>
              <p className="text-[15px] font-semibold text-strong" data-testid="import-summary">{labels.summary(preview)}</p>
              {preview.rows.length === 0 ? <p className="mt-2 text-[13.5px] text-muted-2">{labels.allGood}</p> : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-[13.5px]" data-testid="import-problems">
                    <thead><tr className="text-[12.5px] text-muted-2"><th className="py-2 pr-3 font-semibold">{labels.row}</th><th className="py-2 pr-3 font-semibold">{labels.what}</th><th className="py-2 font-semibold">{labels.why}</th></tr></thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={r.rowNo} className="border-t border-line align-top" data-testid="import-problem-row">
                          <td className="num py-2 pr-3">{r.rowNo}</td>
                          <td className="py-2 pr-3 [overflow-wrap:anywhere]"><span className="font-medium text-strong">{r.label}</span><span className={cx('ml-2 rounded-full px-2 py-0.5 text-[12px] font-semibold', r.status === 'error' ? 'bg-risk-bg text-red-text' : 'bg-warn-bg text-amber-text')}>{r.status === 'error' ? labels.error : labels.duplicate}</span></td>
                          <td className="py-2 text-muted-2">{r.problems.join(' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.more > 0 && <p className="mt-3 text-[12.5px] text-muted">{labels.more(preview.more)}</p>}
                </div>
              )}
              <div className="mt-5">
                {preview.ok > 0
                  ? <button type="submit" disabled={pending} onClick={() => { intent.current = 'run' }} className={buttonClass('primary')} data-testid="import-run">{pending && intent.current === 'run' ? labels.running : labels.run(preview.ok)}</button>
                  : <p className="text-[13.5px] font-medium text-amber-text" data-testid="import-nothing">{labels.nothing}</p>}
              </div>
            </>
          )}
        </section>
      )}
      {done && state?.ok && <p role="status" className="rounded-[10px] bg-green-100 px-4 py-3 text-[13.5px] font-medium text-brand-text" data-testid="import-done">{state.message}</p>}
    </form>
  )
}
