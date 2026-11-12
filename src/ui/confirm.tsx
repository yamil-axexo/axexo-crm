'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy } from 'lucide-react'
import { buttonClass } from '@/ui/kit'
import { fill, offlineBlocked, showToast } from '@/ui/complete'
import type { ActionResult } from '@/lib/errors'

type ConfirmAction = (prev: ActionResult<{ toast: string }> | null, data: FormData) => Promise<ActionResult<{ toast: string }>>

/**
 * Un cambio que mueve trabajo de otras personas (reasignar, descartar un pendiente del equipo) pide confirmación
 * y avisa lo que pasó. El botón abre un diálogo que dice qué va a ocurrir; al confirmar corre la acción y el aviso
 * queda en pantalla aunque la fila desaparezca.
 *
 * Si vive dentro de un <form>, manda sus campos (por ejemplo, a quién se reasigna). `nameFrom` es el nombre de un
 * <select> de ese formulario: su opción elegida entra en el texto donde va %s.
 */
export function ConfirmButton({
  action,
  fields,
  label,
  title,
  body,
  confirm,
  cancel,
  nameFrom,
  note,
  variant = 'ghost',
  size = 'sm',
  testId,
}: {
  action: ConfirmAction
  fields?: Record<string, string>
  label: string
  title: string
  body: string
  confirm: string
  cancel: string
  nameFrom?: string
  /** Renglón opcional para decir por qué (queda con el registro). */
  note?: { name: string; label: string }
  variant?: 'primary' | 'ghost' | 'quiet' | 'danger'
  size?: 'sm' | 'md'
  testId: string
}) {
  const router = useRouter()
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  // El diálogo solo existe mientras está abierto: en una lista larga no se monta uno por fila.
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [open])
  const [pending, startTransition] = useTransition()

  const ask = () => {
    const form = trigger.current?.closest('form')
    const field = nameFrom && form ? form.elements.namedItem(nameFrom) : null
    // Sin elegir a quién, no hay nada que confirmar: el campo lo dice.
    if (field instanceof HTMLSelectElement && !field.value) {
      field.reportValidity()
      return
    }
    setName(field instanceof HTMLSelectElement ? (field.selectedOptions[0]?.textContent ?? '').trim() : '')
    setError(null)
    setOpen(true)
  }
  const close = () => dialog.current?.close()
  const run = () => {
    if (offlineBlocked()) return
    const form = trigger.current?.closest('form')
    const data = form ? new FormData(form) : new FormData()
    for (const [k, v] of Object.entries(fields ?? {})) data.set(k, v)
    const why = dialog.current?.querySelector<HTMLInputElement>('input[data-note]')
    if (note && why) data.set(note.name, why.value)
    startTransition(async () => {
      const res = await action(null, data)
      if (!res.ok) return setError(res.error)
      close()
      showToast(res.data?.toast ?? null)
      router.refresh()
    })
  }

  return (
    <>
      <button ref={trigger} type="button" onClick={ask} className={buttonClass(variant, size)} data-testid={testId}>
        {label}
      </button>
      {open && (
      <dialog
        ref={dialog}
        role="alertdialog"
        aria-labelledby={`${testId}-title`}
        aria-describedby={`${testId}-body`}
        className="m-auto w-[min(440px,92vw)] animate-pop rounded-[16px] border border-line bg-surface p-0 text-fg shadow-[var(--cg-shadow-float)] backdrop:bg-black/40"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current) close()
        }}
        data-testid={`${testId}-dialog`}
      >
        <div className="p-6">
          <h2 id={`${testId}-title`} className="text-[18px] leading-[26px] font-semibold">{title}</h2>
          <p id={`${testId}-body`} className="mt-2 text-[15px] leading-6 text-muted-2 [overflow-wrap:anywhere]">{nameFrom ? fill(body, name) : body}</p>
          {note && (
            <label className="mt-4 block">
              <span className="mb-2 block text-[13px] font-semibold text-muted-2">{note.label}</span>
              <input data-note maxLength={200} autoComplete="off" className="input" data-testid={`${testId}-note`} />
            </label>
          )}
          {error && (
            <p role="alert" className="mt-4 rounded-[10px] bg-risk-bg px-4 py-3 text-[14px] font-medium text-red-text" data-testid={`${testId}-error`}>
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} className={buttonClass('quiet', 'md')} data-testid={`${testId}-cancel`}>
              {cancel}
            </button>
            <button type="button" onClick={run} disabled={pending} aria-busy={pending} className={buttonClass('primary', 'md')} data-testid={`${testId}-confirm`}>
              {confirm}
            </button>
          </div>
        </div>
      </dialog>
      )}
    </>
  )
}

/** Copiar un dato de la ficha (el ID del comercio en otro sistema) sin seleccionarlo a mano en el teléfono. */
export function CopyButton({ value, label, done }: { value: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      showToast(done)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Sin permiso para el portapapeles, el dato sigue a la vista para copiarlo a mano.
    }
  }
  const Icon = copied ? Check : Copy
  return (
    <button type="button" onClick={copy} aria-label={label} title={label} className="press ml-1 inline-flex h-11 w-11 items-center justify-center rounded-[10px] align-middle text-green-600 hover:bg-green-50" data-testid="copy-id">
      <Icon size={18} strokeWidth={1.75} aria-hidden />
    </button>
  )
}
