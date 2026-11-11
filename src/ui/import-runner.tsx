'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Step = { status: 'idle' | 'running' | 'done' | 'failed' | 'busy'; phase?: string; waitMs?: number }

/**
 * Mantiene viva una importación: llama al paso del servidor, refresca los conteos y repite hasta que termine.
 * Si la pestaña se cierra, la corrida queda en pausa y sigue donde iba cuando alguien vuelve a abrir esta pantalla.
 */
export function ImportRunner({ active, step, labels }: { active: boolean; step: () => Promise<Step>; labels: { working: string; waiting: string; paused: string } }) {
  const router = useRouter()
  const [note, setNote] = useState<string>('')
  const alive = useRef(false)
  useEffect(() => {
    if (!active) return
    alive.current = true
    let fails = 0
    ;(async () => {
      while (alive.current) {
        setNote(labels.working)
        let res: Step
        try {
          res = await step()
          fails = 0
        } catch {
          fails++
          if (fails > 5) {
            setNote(labels.paused)
            break
          }
          await new Promise((r) => setTimeout(r, 3000 * fails))
          continue
        }
        router.refresh()
        if (res.status !== 'running' && res.status !== 'busy') break
        if (res.waitMs) {
          setNote(labels.waiting)
          await new Promise((r) => setTimeout(r, res.waitMs))
        }
      }
    })()
    return () => {
      alive.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  if (!active) return null
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-2" role="status" data-testid="import-runner">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
      {note}
    </p>
  )
}
