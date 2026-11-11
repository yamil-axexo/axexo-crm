'use client'

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import type { ActionResult } from '@/lib/errors'

export type SheetItem = {
  type: 'task' | 'lead' | 'suggestion'
  id: string
  title: string
  name: string
  results: { value: string; label: string }[]
  defaultResult: string | null
  /** Si es falso, la hoja no ofrece "cerrar": el registro se atiende con un próximo paso con fecha. */
  closable?: boolean
}
export type SheetConfig = {
  labels: {
    complete: string
    result: string
    next: string
    when: string
    save: string
    saveClose: string
    cancel: string
    missingNext: string
    other: string
    markDone: string
    /** Plantillas con %s: el cliente pone el dato que cambia. */
    completeOf: string
    afterCall: string
  }
  nextOptions: { value: string; label: string }[]
  whenOptions: { value: string; label: string }[]
  defaultWhen: string
  minDate: string
}
export type CompleteAction = (prev: ActionResult<{ toast: string }> | null, data: FormData) => Promise<ActionResult<{ toast: string }>>

export const fill = (template: string, value: string) => template.replace('%s', value)

/**
 * Hoja "Completar" (handoff, sección 5): tres preguntas con chips. No guarda sin "¿Qué sigue?", salvo que se elija cerrar.
 * Diálogo centrado desde 768 px y hoja inferior en móvil; el foco queda atrapado y Escape la cierra.
 */
export function CompleteSheet({
  target,
  config,
  action,
  onClose,
  onDone,
}: {
  target: { item: SheetItem; afterCall?: boolean } | null
  config: SheetConfig
  action: CompleteAction
  onClose: () => void
  onDone: (toast: string | null) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const key = target ? `${target.item.type}:${target.item.id}` : ''
  useEffect(() => {
    if (key && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [key])
  const close = () => dialog.current?.close()
  return (
    <dialog
      ref={dialog}
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) close()
      }}
      className="sheet on-ink m-auto w-[min(560px,100vw)] rounded-[16px] p-0 max-md:mb-0 max-md:w-full max-md:max-w-none max-md:rounded-b-none"
      data-testid="complete-sheet"
    >
      {/* La llave reinicia las respuestas cada vez que la hoja se abre para otro registro. */}
      {target && (
        <SheetForm
          key={key}
          item={target.item}
          afterCall={!!target.afterCall}
          config={config}
          action={action}
          onCancel={close}
          onSaved={(toast) => {
            close()
            onDone(toast)
          }}
        />
      )}
    </dialog>
  )
}

function SheetForm({ item, afterCall, config, action, onCancel, onSaved }: { item: SheetItem; afterCall: boolean; config: SheetConfig; action: CompleteAction; onCancel: () => void; onSaved: (toast: string | null) => void }) {
  const { labels, nextOptions, whenOptions, defaultWhen, minDate } = config
  const [error, setError] = useState<string | null>(null)
  const [next, setNext] = useState('')
  const [when, setWhen] = useState(defaultWhen)
  const [pending, startTransition] = useTransition()
  const preset = whenOptions.some((o) => o.value === when)

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    if (!data.get('next')) {
      setError(labels.missingNext)
      return
    }
    if (offlineBlocked()) return
    startTransition(async () => {
      const res = await action(null, data)
      if (res.ok) onSaved(res.data?.toast ?? null)
      else setError(res.error)
    })
  }

  return (
    <form onSubmit={submit} className="p-6 pb-[max(24px,env(safe-area-inset-bottom))] md:p-8">
      <span aria-hidden className="mx-auto mb-5 block h-1 w-10 rounded-full bg-black-line md:hidden" />
      <input type="hidden" name="type" value={item.type} />
      <input type="hidden" name="id" value={item.id} />
      <p className="text-[13px] text-on-black">{labels.complete}</p>
      <h2 id="sheet-title" className="mt-0.5 text-[18px] leading-[26px] font-semibold" data-testid="sheet-title">
        {afterCall ? fill(labels.afterCall, item.name) : item.title}
      </h2>

      <Choices name="result" legend={labels.result} options={item.results} defaultValue={item.defaultResult} />
      <Choices name="next" legend={labels.next} options={item.closable === false ? nextOptions.filter((o) => o.value !== 'none') : nextOptions} value={next} onChange={setNext} />
      {next !== 'none' && (
        <>
          <Choices name="when_choice" legend={labels.when} options={[...whenOptions, { value: 'other', label: labels.other }]} value={preset ? when : 'other'} onChange={(v) => setWhen(v === 'other' ? '' : v)} />
          {!preset && (
            <input type="date" required min={minDate} value={when} onChange={(e) => setWhen(e.target.value)} aria-label={labels.other} className="input mt-3 !border-black-line !bg-graphite !text-white [color-scheme:dark]" data-testid="sheet-date" />
          )}
        </>
      )}
      <input type="hidden" name="when" value={next === 'none' ? '' : when} />

      {error && (
        <p role="alert" className="mt-5 rounded-[10px] bg-[#3a1512] px-4 py-3 text-[14px] font-medium text-[#ffb4ab]" data-testid="sheet-error">
          {error}
        </p>
      )}
      <div className="mt-7 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <button type="button" onClick={onCancel} className="press inline-flex h-12 items-center justify-center rounded-[10px] px-5 text-[15px] font-medium text-on-black hover:text-white">
          {labels.cancel}
        </button>
        <button type="submit" disabled={pending} aria-busy={pending} className="press glow-hover inline-flex h-12 items-center justify-center rounded-[10px] bg-neon px-6 text-[15px] font-semibold text-black disabled:opacity-60" data-testid="sheet-save">
          {next === 'none' ? labels.saveClose : labels.save}
        </button>
      </div>
    </form>
  )
}

/** Una pregunta de la hoja: chips de una sola elección (radios reales, se operan con teclado). */
function Choices({
  name,
  legend,
  options,
  value,
  defaultValue,
  onChange,
}: {
  name: string
  legend: string
  options: { value: string; label: string }[]
  value?: string
  defaultValue?: string | null
  onChange?: (v: string) => void
}) {
  return (
    <fieldset className="mt-6" data-testid={`choices-${name}`}>
      <legend className="mb-2.5 text-[15px] font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="choice inline-flex h-11 cursor-pointer items-center rounded-full border border-black-line px-4 text-[15px] font-medium md:h-10">
            <input
              type="radio"
              name={name}
              value={o.value}
              className="sr-only"
              {...(value !== undefined ? { checked: value === o.value, onChange: () => onChange?.(o.value) } : { defaultChecked: defaultValue === o.value })}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const TOAST_EVENT = 'contigo:toast'

/**
 * Sin señal, una acción que no es un formulario (mover una tarjeta, tomar un lead) no se intenta: se avisa y ya.
 * El texto lo deja el aviso sin conexión en el documento, en el idioma de la persona.
 */
export function offlineBlocked(): boolean {
  if (typeof navigator === 'undefined' || navigator.onLine) return false
  showToast(document.documentElement.dataset.offlineMsg ?? 'Sin señal / No signal')
  return true
}

/** Muestra un aviso desde cualquier parte. Vive fuera de la fila que lo dispara: la fila puede desaparecer al guardar. */
export const showToast = (text: string | null) => {
  if (text) window.dispatchEvent(new CustomEvent<string>(TOAST_EVENT, { detail: text }))
}

/** Aviso negro con anillo neón que entra desde abajo y se va solo a los 2.6 s. Una sola instancia, montada en el layout. */
export function ToastHost() {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onToast = (e: Event) => {
      setText((e as CustomEvent<string>).detail)
      clearTimeout(timer)
      timer = setTimeout(() => setText(null), 2600)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast)
      clearTimeout(timer)
    }
  }, [])
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[104px] z-[60] flex justify-center px-4 md:bottom-[112px]">
      {text && (
        <p className="toast pointer-events-auto max-w-[560px] rounded-[12px] px-5 py-3 text-[15px] font-medium" data-testid="toast">
          {text}
        </p>
      )}
    </div>
  )
}

/** Círculo de completar para un registro fuera de la cola (ficha, negocio): abre la misma hoja y refresca al guardar. */
export function CompleteButton({ item, config, action, label, className, testId }: { item: SheetItem; config: SheetConfig; action: CompleteAction; label?: string; className?: string; testId?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      {label ? (
        <button type="button" onClick={() => setOpen(true)} className={className} data-testid={testId}>
          {label}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={fill(config.labels.completeOf, item.title)}
          title={config.labels.markDone}
          className="q-check inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-line-2 text-black md:h-7 md:w-7"
          data-testid="row-complete"
        >
          <Check size={16} strokeWidth={2.5} aria-hidden className="opacity-0" />
        </button>
      )}
      <CompleteSheet
        target={open ? { item } : null}
        config={config}
        action={action}
        onClose={() => setOpen(false)}
        onDone={(t) => {
          showToast(t)
          router.refresh()
        }}
      />
    </>
  )
}
