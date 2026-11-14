'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * AUT-02: la pantalla se actualiza sola cuando otra persona cambia algo de sus temas (por ejemplo "MX:deal").
 * Pregunta cada `every` segundos, solo con la pestaña visible, y refresca los datos del servidor sin perder lo que la persona
 * está escribiendo. Si Broadcast se enciende, la señal llega igual por la cola; esta consulta queda como respaldo.
 */
export function LiveRefresh({ topics, every = 20 }: { topics: string[]; every?: number }) {
  const router = useRouter()
  const last = useRef<string | null>(null)
  const key = topics.join(',')
  useEffect(() => {
    if (!key) return
    let stop = false
    const tick = async () => {
      if (stop || document.visibilityState !== 'visible') return
      try {
        const res = await fetch(`/api/live?t=${encodeURIComponent(key)}`, { cache: 'no-store', credentials: 'same-origin' })
        if (!res.ok) return
        const { marks } = (await res.json()) as { marks: Record<string, string> }
        const stamp = Object.values(marks).sort().at(-1) ?? ''
        if (last.current !== null && stamp && stamp !== last.current) router.refresh()
        last.current = stamp
      } catch {
        // Sin red: se vuelve a intentar en la siguiente vuelta.
      }
    }
    void tick()
    const id = window.setInterval(tick, every * 1000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [key, every, router])
  return <span hidden data-testid="live-refresh" data-topics={key} />
}
