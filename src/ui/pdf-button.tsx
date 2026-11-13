'use client'

import { Download } from 'lucide-react'
import { buttonClass } from '@/ui/kit'
import { textPdf } from '@/lib/pdf'

/** E5.F9: arma el PDF en el navegador (sin red) y lo baja. */
export function PdfButton({ label, title, body, footer, fileName, testId = 'doc-pdf' }: { label: string; title: string; body: string; footer?: string; fileName: string; testId?: string }) {
  return (
    <button
      type="button"
      className={buttonClass('ghost', 'md')}
      data-testid={testId}
      onClick={() => {
        const bytes = textPdf(title, body, footer)
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      }}
    >
      <Download size={18} strokeWidth={1.75} aria-hidden className="mr-2" />
      {label}
    </button>
  )
}
