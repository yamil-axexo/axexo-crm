'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Phone } from 'lucide-react'
import { CompleteSheet, showToast, type CompleteAction, type SheetConfig, type SheetItem } from '@/ui/complete'
import type { ActionResult } from '@/lib/errors'

type TakeAction = (prev: ActionResult<unknown> | null, data: FormData) => Promise<ActionResult<unknown>>

/**
 * Llamar a un lead (handoff, sección 6). Si no tiene dueño, "Tomar y llamar" lo asigna y abre la llamada en un paso.
 * Al volver a la app, la hoja pregunta cómo fue y registra el primer contacto.
 */
export function LeadCall({ item, tel, take, label, takeAction, config, completeAction }: { item: SheetItem; tel: string; take: boolean; label: string; takeAction: TakeAction; config: SheetConfig; completeAction: CompleteAction }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [sheet, setSheet] = useState(false)
  const away = useRef<{ left: boolean } | null>(null)

  useEffect(() => {
    const onVisibility = () => {
      const a = away.current
      if (!a) return
      if (document.visibilityState === 'hidden') a.left = true
      else if (a.left) {
        away.current = null
        setSheet(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const call = () =>
    startTransition(async () => {
      if (take) {
        const data = new FormData()
        data.set('id', item.id)
        const res = await takeAction(null, data)
        if (!res.ok) {
          showToast(res.error)
          return
        }
      }
      away.current = { left: false }
      if (take) router.refresh()
      // Se abre como un enlace tel: (el teléfono decide con qué app llamar).
      const a = document.createElement('a')
      a.href = tel
      document.body.appendChild(a)
      a.click()
      a.remove()
    })

  return (
    <>
      <button type="button" onClick={call} disabled={pending} aria-busy={pending} className="press grad-bg relative z-10 inline-flex h-11 shrink-0 items-center gap-2 rounded-[10px] px-4 text-[14px] font-semibold whitespace-nowrap text-on-sun disabled:opacity-60" data-testid={take ? 'lead-take-call' : 'lead-call'} data-tel={tel}>
        <Phone size={18} strokeWidth={1.75} aria-hidden />
        {label}
      </button>
      <CompleteSheet
        target={sheet ? { item, afterCall: true } : null}
        config={config}
        action={completeAction}
        onClose={() => setSheet(false)}
        onDone={(t) => {
          showToast(t)
          router.refresh()
        }}
      />
    </>
  )
}
