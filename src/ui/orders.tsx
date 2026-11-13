'use client'

import { Printer } from 'lucide-react'
import { buttonClass } from '@/ui/kit'

/** Abre el diálogo de impresión del navegador: desde ahí se imprime o se guarda como PDF. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass('ghost', 'md')} data-testid="order-print-button">
      <Printer size={18} strokeWidth={1.75} aria-hidden className="mr-2" />
      {label}
    </button>
  )
}
