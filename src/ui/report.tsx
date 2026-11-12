'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Enlace a "Reportar un problema" que lleva consigo la pantalla donde está la persona, para que el formulario la llene solo. */
export function ReportLink({ className, children, testId }: { className?: string; children: ReactNode; testId?: string }) {
  const path = usePathname()
  const from = path && !path.startsWith('/reportar') ? `?desde=${encodeURIComponent(path)}` : ''
  return (
    <Link href={`/reportar${from}`} role="menuitem" className={className} data-testid={testId}>
      {children}
    </Link>
  )
}
