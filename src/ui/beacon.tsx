'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/**
 * GOB-07: mide cuánto tarda en abrir cada pantalla, en el navegador de la persona. En la primera carga usa el tiempo de
 * navegación del navegador; al pasar de una pantalla a otra, el tiempo entre el clic y la pantalla nueva.
 * Manda la ruta y los milisegundos, nada más.
 */
export function Beacon() {
  const pathname = usePathname()
  const first = useRef(true)
  const click = useRef<number | null>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (a && a.origin === window.location.origin && !a.target && !e.metaKey && !e.ctrlKey) click.current = performance.now()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  useEffect(() => {
    let ms: number | null = null
    if (first.current) {
      first.current = false
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      if (nav && nav.responseEnd > 0) ms = nav.domContentLoadedEventEnd > 0 ? nav.domContentLoadedEventEnd : nav.responseEnd
    } else if (click.current !== null) {
      const elapsed = performance.now() - click.current
      if (elapsed < 60_000) ms = elapsed
    }
    click.current = null
    if (ms === null || !navigator.sendBeacon) return
    navigator.sendBeacon('/api/telemetry', new Blob([JSON.stringify({ p: pathname, ms: Math.round(ms) })], { type: 'text/plain' }))
  }, [pathname])

  return null
}
