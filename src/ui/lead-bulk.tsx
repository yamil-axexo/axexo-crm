'use client'

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { buttonClass } from '@/ui/kit'
import { offlineBlocked, showToast } from '@/ui/complete'
import type { FormAction } from '@/ui/client'

export const BULK_FORM = 'lead-bulk'


/**
 * Cierre en bloque de la lista de Leads. Las casillas de cada fila viven fuera del formulario y se ligan a él con el
 * atributo form: así la fila sigue siendo un enlace y la hoja de llamada no queda dentro de otro formulario.
 */
export function LeadBulk({ action, reasons, labels }: { action: FormAction; reasons: { code: string; label: string }[]; labels: { selectAll: string; one: string; many: string; reason: string; pick: string; close: string; hint: string } }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(action, null)
  const [count, setCount] = useState(0)
  const all = useRef<HTMLInputElement>(null)
  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form=${BULK_FORM}]`))

  useEffect(() => {
    // Un solo oyente para todo: la casilla "seleccionar todos" marca las de la página, y cualquier cambio vuelve a contar.
    const sync = (e?: Event) => {
      const list = boxes()
      const master = all.current
      if (master && (e ? e.target === master : master.checked)) for (const b of list) b.checked = master.checked
      const n = list.filter((b) => b.checked).length
      setCount(n)
      if (master) {
        master.checked = n > 0 && n === list.length
        master.indeterminate = n > 0 && n < list.length
      }
    }
    document.addEventListener('change', sync)
    sync()
    return () => document.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!state?.ok) return
    // La confirmación va en el aviso de la pantalla: si se cerraron todos, la lista queda vacía y esta barra desaparece.
    if (state.message) showToast(state.message)
    for (const b of boxes()) b.checked = false
    // El conteo se actualiza por el mismo camino que un clic: el oyente de "change" del documento.
    document.dispatchEvent(new Event('change'))
    router.refresh()
  }, [state, router])

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (offlineBlocked()) return
    const data = new FormData(e.currentTarget)
    startTransition(() => formAction(data))
  }

  return (
    <form id={BULK_FORM} action={formAction} onSubmit={onSubmit} className="border-b border-line px-4 py-2 @3xl:px-5" data-testid="lead-bulk">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-[13px] font-medium text-strong">
          <input
            ref={all}
            type="checkbox"
            className="h-5 w-5 shrink-0"
            data-testid="lead-select-all"
          />
          {count > 0 ? (count === 1 ? labels.one : labels.many.replace('{n}', String(count))) : labels.selectAll}
        </label>
        {count > 0 && (
          <>
            <select name="reason" required defaultValue="not_qualified" aria-label={labels.reason} className="input !h-11 !w-auto min-w-[180px]" data-testid="lead-bulk-reason">
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass('danger')} data-testid="lead-bulk-close">{labels.close}</button>
          </>
        )}
      </div>
      {count > 0 && <p className="pb-1 text-[13px] text-muted">{labels.hint}</p>}
      {state && !state.ok && <p role="alert" data-testid="lead-bulk-error" className="my-2 rounded-[10px] bg-risk-bg px-3 py-2 text-[13px] font-medium text-red-text">{state.error}</p>}
    </form>
  )
}
