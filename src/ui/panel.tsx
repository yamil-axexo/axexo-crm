'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Contenedor de la ficha cuando se abre sobre la lista: panel a la derecha en desktop, columna al lado en tablet
 * y pantalla completa en móvil. Escape la cierra y el foco entra a la ficha al abrirla (o al cambiar de comercio).
 */
export function FichaPanel({ id, closeHref, label, children }: { id: string; closeHref: string; label: string; children: ReactNode }) {
  const router = useRouter()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    ref.current?.scrollTo({ top: 0 })
  }, [id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Un diálogo abierto (nota, actividad, completar) se cierra primero con su propio Escape.
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return
      router.push(closeHref, { scroll: false })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [router, closeHref])
  return (
    <aside ref={ref} tabIndex={-1} aria-label={label} className="ficha-panel outline-none" data-testid="ficha-panel">
      {children}
    </aside>
  )
}
