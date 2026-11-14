'use client'

import { startTransition, useOptimistic, useState, type ReactNode } from 'react'
import { buttonClass } from '@/ui/kit'
import type { FormAction } from '@/ui/client'

/**
 * UX-02: acción rápida optimista. Al tocar, la pantalla muestra el resultado al instante (la fila se va o el botón cambia a
 * `doneLabel`) mientras el servidor guarda. Si el servidor dice que no, React vuelve todo a como estaba y se muestra por qué.
 * Se usa en las tres acciones rápidas más usadas: "Visto" de un aviso en Hoy, "Tomar este lead" y "Calificar" un lead.
 */
export function OptimisticAction({
  action, fields, label, doneLabel, hideRow = false, children, testId, variant = 'ghost', size = 'sm', rolledBack, className, rowTestId,
}: {
  action: FormAction
  fields: Record<string, string>
  label: string
  doneLabel: string
  hideRow?: boolean
  children?: ReactNode
  testId?: string
  variant?: 'primary' | 'ghost' | 'quiet'
  size?: 'sm' | 'md'
  /** Texto antes del motivo cuando el servidor no guardó, en el idioma de la pantalla. */
  rolledBack: string
  /** Clase y testid del contenedor (la fila completa cuando `hideRow`). */
  className?: string
  rowTestId?: string
}) {
  const [done, setDone] = useOptimistic(false, (_: boolean, next: boolean) => next)
  const [error, setError] = useState<string | null>(null)
  const run = () => {
    setError(null)
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    startTransition(async () => {
      setDone(true)
      const res = await action(null, fd).catch(() => ({ ok: false as const, error: '', code: 'network' }))
      if (!res.ok) setError(res.error || null)
    })
  }
  if (done && hideRow) return null
  return (
    <div className={className ?? 'contents'} data-testid={rowTestId} data-state={done ? 'optimistic' : error !== null ? 'rolled-back' : 'idle'}>
      {children}
      <button type="button" onClick={run} disabled={done} className={buttonClass(variant, size)} data-testid={testId} aria-live="polite">
        {done ? doneLabel : label}
      </button>
      {error !== null && (
        <p role="alert" className="basis-full rounded-2xl bg-red/10 px-4 py-2 text-[13.5px] font-medium text-red-text" data-testid={testId ? `${testId}-error` : undefined}>
          {rolledBack}{error ? ` ${error}` : ''}
        </p>
      )}
    </div>
  )
}
