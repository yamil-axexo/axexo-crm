'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { screenHelpFor } from '@/content/screen-help'

/** "¿Cómo se usa esto?": lleva a las preguntas de la pantalla donde está la persona. En pantallas sin tema propio no aparece. */
export function ScreenHelpLink({ label, className, testId, role }: { label: string; className?: string; testId?: string; role?: string }) {
  const path = usePathname()
  const screen = screenHelpFor(path)
  if (!screen || path?.startsWith('/como-se-usa')) return null
  return (
    <Link href={`/como-se-usa?pantalla=${encodeURIComponent(screen.prefix)}`} className={className} data-testid={testId} role={role}>
      {label}
    </Link>
  )
}

/** Muestra su contenido salvo en las pantallas indicadas (el anuncio no se repite dentro de Anuncios). */
export function HideOn({ prefixes, children }: { prefixes: string[]; children: ReactNode }) {
  const path = usePathname() ?? ''
  if (prefixes.some((p) => path === p || path.startsWith(`${p}/`))) return null
  return <>{children}</>
}

/** Pie de cada pantalla con la ayuda contextual. No se imprime. */
export function ScreenHelpFooter({ label, children }: { label: string; children?: ReactNode }) {
  const path = usePathname()
  if (!screenHelpFor(path)) return null
  return (
    <p className="mt-10 text-center text-[14px] print:hidden" data-testid="screen-help">
      <ScreenHelpLink label={label} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" testId="screen-help-link" />
      {children}
    </p>
  )
}
