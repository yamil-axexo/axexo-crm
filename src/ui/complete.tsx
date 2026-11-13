'use client'

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import type { ActionResult } from '@/lib/errors'
import { noSaleReasonsAction, visitReasonsAction, visitorNamesAction } from '@/app/(app)/actividades/log-actions'

export type SheetItem = {
  type: 'task' | 'lead' | 'suggestion'
  id: string
  title: string
  name: string
  results: { value: string; label: string }[]
  defaultResult: string | null
  /** Si es falso, la hoja no ofrece "cerrar": el registro se atiende con un próximo paso con fecha. */
  closable?: boolean
  /** Es una visita por hacer: se completa con el resultado de la visita y, opcional, quién visitó. */
  visit?: boolean
  /** Tipo de venta del registro: decide qué próximos pasos se ofrecen (los de B2B no son los de tienda). */
  motor?: string | null
}

/**
 * Los próximos pasos que tocan: a Operaciones se le ofrecen los suyos (documentos, proveedor, capacitación) sin importar el
 * negocio; a quien vende, los del tipo de venta del registro (los de B2B no son los de tienda).
 */
export const nextFor = (config: Pick<SheetConfig, 'nextOptions' | 'nextSets' | 'voice'>, motor: string | null | undefined) => {
  const set = config.nextSets[config.voice === 'ops' ? 'ops' : motor === 'b2b' ? 'b2b' : 'default']
  return config.nextOptions.filter((o) => set.includes(o.value))
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
    /** Nota corta al completar, qué es "Otra tarea" y quién visitó (los tres opcionales). */
    note: string
    nextText: string
    visitedBy: string
    visitedByHint: string
    noSaleReason: string
    pickReason: string
    /** Propósito de la visita (E12.F1): se pregunta cuando el mercado tiene lista. */
    visitReason: string
    pickVisitReason: string
    /** A cuál negocio pertenece la visita cuando el comercio tiene más de uno abierto (E10.F3). */
    whichDeal: string
    noDeal: string
  }
  nextOptions: { value: string; label: string }[]
  nextSets: { default: string[]; b2b: string[]; ops: string[] }
  /** Quién completa: Operaciones ('ops') o ventas ('sales'). */
  voice: 'ops' | 'sales'
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
      className="sheet on-ink m-auto max-h-[92dvh] w-[min(560px,100vw)] overflow-y-auto rounded-[16px] p-0 max-md:mb-0 max-md:w-full max-md:max-w-none max-md:rounded-b-none"
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
  const { labels, whenOptions, defaultWhen, minDate } = config
  const nextOptions = nextFor(config, item.motor)
  const [error, setError] = useState<string | null>(null)
  const [next, setNext] = useState('')
  const [picked, setPicked] = useState(item.defaultResult ?? '')
  const [when, setWhen] = useState(defaultWhen)
  const [pending, startTransition] = useTransition()

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
    <form onSubmit={submit} className="px-6 pt-6 md:px-8 md:pt-8">
      <span aria-hidden className="mx-auto mb-5 block h-1 w-10 rounded-full bg-black-line md:hidden" />
      <input type="hidden" name="type" value={item.type} />
      <input type="hidden" name="id" value={item.id} />
      <p className="text-[13px] text-on-black">{labels.complete}</p>
      <h2 id="sheet-title" className="mt-0.5 text-[18px] leading-[26px] font-semibold" data-testid="sheet-title">
        {afterCall ? fill(labels.afterCall, item.name) : item.title}
      </h2>

      {/* Si hay que volver con quien decide, lo que sigue es visitar: queda elegido y la persona lo puede cambiar. */}
      <Choices name="result" legend={labels.result} options={item.results} defaultValue={item.defaultResult} onPick={(v) => { setPicked(v); if (v === 'revisit' && !next) setNext('visit') }} />
      {item.visit && <VisitReason label={labels.visitReason} pick={labels.pickVisitReason} activityId={item.id} />}
      {item.visit && picked === 'no_sale' && <NoSaleReason label={labels.noSaleReason} pick={labels.pickReason} />}
      {item.visit && <VisitorField label={labels.visitedBy} hint={labels.visitedByHint} />}
      <SheetText name="note" label={labels.note} maxLength={500} testId="sheet-note" />
      <NextStep labels={labels} options={item.closable === false ? nextOptions.filter((o) => o.value !== 'none') : nextOptions} whenOptions={whenOptions} minDate={minDate} next={next} onNext={setNext} when={when} onWhen={setWhen} />

      {/* Guardar y el aviso de lo que falta quedan a la vista al pie de la hoja, aunque la hoja sea más alta que la pantalla. */}
      <div className="sticky bottom-0 -mx-6 mt-7 border-t border-black-line bg-black px-6 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] md:-mx-8 md:px-8 md:pb-6">
        {error && (
          <p role="alert" className="mb-3 rounded-[10px] bg-[#3a1512] px-4 py-3 text-[14px] font-medium text-[#ffb4ab]" data-testid="sheet-error">
            {error}
          </p>
        )}
        <div className="flex gap-2 md:justify-end">
          <button type="button" onClick={onCancel} className="press inline-flex h-12 items-center justify-center rounded-[10px] px-4 text-[15px] font-medium text-on-black hover:text-white md:px-5">
            {labels.cancel}
          </button>
          <button type="submit" disabled={pending} aria-busy={pending} className="press glow-hover inline-flex h-12 flex-1 items-center justify-center rounded-[10px] bg-neon px-6 text-[15px] font-semibold text-black disabled:opacity-60 md:flex-none" data-testid="sheet-save">
            {next === 'none' ? labels.saveClose : labels.save}
          </button>
        </div>
      </div>
    </form>
  )
}

const SHEET_INPUT = 'input !border-black-line !bg-graphite !text-white placeholder:!text-on-black'

/** Un renglón de texto opcional de la hoja (nota, qué es la tarea). */
export function SheetText({ name, label, maxLength, testId, placeholder, required, defaultValue }: { name: string; label: string; maxLength: number; testId?: string; placeholder?: string; required?: boolean; defaultValue?: string }) {
  return (
    <label className="mt-6 block">
      <span className="mb-2.5 block text-[15px] font-semibold">{label}</span>
      <input name={name} maxLength={maxLength} placeholder={placeholder} required={required} defaultValue={defaultValue} autoComplete="off" enterKeyHint="done" className={SHEET_INPUT} data-testid={testId} />
    </label>
  )
}

/**
 * Propósito de la visita, de la lista del mercado (E12.F1, E12.F2): un toque en el teléfono. Si el mercado no tiene lista,
 * no se pregunta. Va antes del resultado para que la visita quede clasificada desde el primer toque.
 */
export function VisitReason({ label, pick, market, activityId }: { label: string; pick: string; market?: string; activityId?: string }) {
  const [reasons, setReasons] = useState<{ value: string; label: string }[]>([])
  useEffect(() => {
    let live = true
    visitReasonsAction({ market, activityId }).then((list) => live && setReasons(list), () => {})
    return () => {
      live = false
    }
  }, [market, activityId])
  if (reasons.length === 0) return null
  return (
    <label className="mt-6 block">
      <span className="mb-2.5 block text-[15px] font-semibold">{label}</span>
      <select name="visit_reason" required defaultValue="" className={SHEET_INPUT} data-testid="sheet-visit-reason">
        <option value="">{pick}</option>
        {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </label>
  )
}

/** Por qué no hubo venta: lo pide toda visita que termina sin venta. Los motivos son los de calle del catálogo del mercado. */
export function NoSaleReason({ label, pick, market }: { label: string; pick: string; market?: string }) {
  const [reasons, setReasons] = useState<{ value: string; label: string }[]>([])
  useEffect(() => {
    let live = true
    noSaleReasonsAction(market).then((list) => live && setReasons(list), () => {})
    return () => {
      live = false
    }
  }, [market])
  return (
    <label className="mt-6 block">
      <span className="mb-2.5 block text-[15px] font-semibold">{label}</span>
      <select name="no_sale_reason" required defaultValue="" className={SHEET_INPUT} data-testid="sheet-no-sale-reason">
        <option value="">{pick}</option>
        {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </label>
  )
}

/**
 * Quién visitó, cuando no fue quien captura (los vendedores de calle no son usuarios). Sugiere los nombres ya usados
 * en el mercado para que la misma persona no quede escrita de tres maneras.
 */
export function VisitorField({ label, hint, market }: { label: string; hint: string; market?: string }) {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let live = true
    visitorNamesAction(market).then((list) => live && setNames(list), () => {})
    return () => {
      live = false
    }
  }, [market])
  return (
    <label className="mt-6 block">
      <span className="mb-2.5 block text-[15px] font-semibold">{label}</span>
      <input name="visited_by" maxLength={80} list="visitor-names" placeholder={hint} autoComplete="off" autoCapitalize="words" enterKeyHint="done" className={SHEET_INPUT} data-testid="sheet-visitor" />
      <datalist id="visitor-names" data-testid="visitor-names">
        {names.map((n) => <option key={n} value={n} />)}
      </datalist>
    </label>
  )
}

/** "¿Qué sigue?" y "¿Cuándo?": las dos preguntas del próximo paso. "Otra tarea" deja escribir cuál. */
export function NextStep({
  labels,
  options,
  whenOptions,
  minDate,
  next,
  onNext,
  when,
  onWhen,
}: {
  labels: SheetConfig['labels']
  options: { value: string; label: string }[]
  whenOptions: { value: string; label: string }[]
  minDate: string
  next: string
  onNext: (v: string) => void
  when: string
  onWhen: (v: string) => void
}) {
  const preset = whenOptions.some((o) => o.value === when)
  return (
    <>
      <Choices name="next" legend={labels.next} options={options} value={next} onChange={onNext} />
      {next === 'task' && <SheetText name="next_text" label={labels.nextText} maxLength={120} required testId="sheet-next-text" />}
      {next !== 'none' && (
        <>
          <Choices name="when_choice" legend={labels.when} options={[...whenOptions, { value: 'other', label: labels.other }]} value={preset ? when : 'other'} onChange={(v) => onWhen(v === 'other' ? '' : v)} />
          {!preset && (
            <input type="date" required min={minDate} value={when} onChange={(e) => onWhen(e.target.value)} aria-label={labels.other} className="input mt-3 !border-black-line !bg-graphite !text-white [color-scheme:dark]" data-testid="sheet-date" />
          )}
        </>
      )}
      <input type="hidden" name="when" value={next === 'none' ? '' : when} />
    </>
  )
}

/** Una pregunta de la hoja: chips de una sola elección (radios reales, se operan con teclado). */
export function Choices({
  name,
  legend,
  options,
  value,
  defaultValue,
  onChange,
  onPick,
}: {
  name: string
  legend: string
  options: { value: string; label: string }[]
  value?: string
  defaultValue?: string | null
  onChange?: (v: string) => void
  /** Avisa de la elección sin tomar el control del grupo (los radios siguen sin estado). */
  onPick?: (v: string) => void
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
              {...(value !== undefined ? { checked: value === o.value, onChange: () => onChange?.(o.value) } : { defaultChecked: defaultValue === o.value, onChange: () => onPick?.(o.value) })}
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
          className="q-check inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-line-2 text-black md:h-7 md:w-7"
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
