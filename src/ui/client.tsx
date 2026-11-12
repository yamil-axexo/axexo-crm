'use client'

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { buttonClass, cx } from '@/ui/kit'
import { offlineBlocked } from '@/ui/complete'
import type { ActionResult } from '@/lib/errors'

export type FormAction = (prev: ActionResult<unknown> | null, data: FormData) => Promise<ActionResult<unknown>>

const Pending = createContext(false)

export function Submit({ children, variant = 'primary', size = 'md', testId, name, value }: { children: ReactNode; variant?: 'primary' | 'ghost' | 'quiet' | 'danger'; size?: 'sm' | 'md'; testId?: string; name?: string; value?: string }) {
  const status = useFormStatus()
  const pending = useContext(Pending) || status.pending
  return (
    <button type="submit" disabled={pending} name={name} value={value} className={buttonClass(variant, size)} data-testid={testId} aria-busy={pending}>
      {children}
    </button>
  )
}

/**
 * Formulario ligado a una acción de servidor. Muestra el error o la confirmación que devuelve la acción,
 * y funciona sin JavaScript porque es un <form> real.
 */
export function ActionForm({ action, children, className, onOk, testId }: { action: FormAction; children: ReactNode; className?: string; onOk?: 'reset' | 'close'; testId?: string }) {
  const [state, formAction, pending] = useActionState(action, null)
  const ref = useRef<HTMLFormElement>(null)
  const last = useRef(0)
  useEffect(() => {
    if (state?.ok) {
      last.current = Date.now()
      if (onOk === 'reset' || onOk === 'close') ref.current?.reset()
      if (onOk === 'close') ref.current?.closest('dialog')?.close()
    }
  }, [state, onOk])
  // Se despacha a mano para que un error de validación no borre lo que la persona ya escribió
  // (React reinicia el formulario cuando la acción va por el atributo action). Sin JavaScript, el atributo sigue funcionando.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Un doble clic no dispara dos acciones: justo después de guardar con éxito, el formulario ignora otro envío por un
    // momento (el botón puede cambiar bajo el cursor, por ejemplo al avanzar de etapa).
    if (Date.now() - last.current < 700 || offlineBlocked()) return
    const submitter = (e.nativeEvent as SubmitEvent).submitter
    const data = new FormData(e.currentTarget, submitter)
    startTransition(() => formAction(data))
  }
  return (
    <Pending.Provider value={pending}>
      <form ref={ref} action={formAction} onSubmit={onSubmit} className={className} data-testid={testId} noValidate={false}>
        {children}
        {state && !state.ok && (
          <p role="alert" data-testid="form-error" className="mt-4 rounded-2xl bg-red/10 px-4 py-3 text-[13.5px] font-medium text-red-text">
            {state.error}
          </p>
        )}
        {state?.ok && state.message && (
          <p role="status" data-testid="form-ok" className="mt-4 rounded-[10px] bg-green-100 px-4 py-3 text-[13.5px] font-medium text-brand-text">
            {state.message}
          </p>
        )}
      </form>
    </Pending.Provider>
  )
}

const never = () => () => {}
/** Idioma del documento (el layout lo fija con el de la persona): para etiquetas de componentes cliente que no reciben sus textos. */
const useDocLang = () => useSyncExternalStore(never, () => (document.documentElement.lang === 'en' ? 'en' : 'es'), () => 'es')

export function Dialog({ trigger, title, children, variant = 'ghost', size = 'md', testId, hash, triggerClass }: { trigger: ReactNode; title: string; children: ReactNode; variant?: 'primary' | 'ghost' | 'quiet' | 'danger'; size?: 'sm' | 'md'; testId?: string; hash?: string; triggerClass?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const lang = useDocLang()
  // El botón crear del dock enlaza a la lista con un ancla (#nuevo): el diálogo se abre solo.
  useEffect(() => {
    if (!hash) return
    const check = () => {
      if (window.location.hash === `#${hash}` && ref.current && !ref.current.open) {
        ref.current.showModal()
        history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [hash])
  return (
    <>
      <button type="button" className={triggerClass ?? buttonClass(variant, size)} onClick={() => ref.current?.showModal()} data-testid={testId}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        className="m-auto w-[min(560px,92vw)] animate-pop rounded-[16px] border border-line bg-surface p-0 text-fg shadow-[var(--cg-shadow-float)] backdrop:bg-black/40"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close()
        }}
      >
        <div className="p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <h2 className="text-[20px] font-semibold">{title}</h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label={lang === 'en' ? 'Close' : 'Cerrar'} className="rounded-full px-3 py-1 text-[13px] font-semibold text-muted hover:bg-surface-3">
              ✕
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  )
}

export function NavLink({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  const path = usePathname()
  const active = path === href || path.startsWith(href + '/')
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      className={cx(
        'flex h-11 items-center gap-3 rounded-full px-4 text-[14px] font-medium transition',
        active ? 'grad-bg font-semibold text-on-sun' : 'text-[#c9cde0] hover:bg-white/8 hover:text-white',
      )}
    >
      {children}
    </Link>
  )
}

/** Muestra una sola vez un valor sensible que acaba de crear el servidor (por ejemplo, una llave de API). */
export function RevealOnce({ action, children, label, copyLabel = 'Copy', copiedLabel = '✓' }: { action: FormAction; children: ReactNode; label: string; copyLabel?: string; copiedLabel?: string }) {
  const [state, formAction] = useActionState(action, null)
  const [copied, setCopied] = useState(false)
  const secret = state?.ok && typeof state.data === 'string' ? state.data : null
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter)
        startTransition(() => formAction(data))
      }}
    >
      {children}
      {state && !state.ok && (
        <p role="alert" className="mt-4 rounded-2xl bg-red/10 px-4 py-3 text-[13.5px] font-medium text-red-text">
          {state.error}
        </p>
      )}
      {secret && (
        <div className="mt-4 rounded-2xl bg-surface-2 p-4" data-testid="reveal-once">
          <p className="text-[12.5px] font-semibold text-muted-2">{label}</p>
          <code className="mt-2 block text-[13px] break-all text-strong">{secret}</code>
          <button type="button" className={cx(buttonClass('ghost', 'sm'), 'mt-3')} onClick={() => navigator.clipboard?.writeText(secret).then(() => setCopied(true))}>
            {copied ? copiedLabel : copyLabel}
          </button>
        </div>
      )}
    </form>
  )
}
