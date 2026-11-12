'use client'
import { useEffect } from 'react'

/**
 * Movimiento de la entrada, la bienvenida y la ayuda, en un solo efecto y sin dependencias:
 *  - [data-reveal]: entra al asomarse en pantalla (lo que ya está a la vista al cargar no se toca).
 *    Se revisa en cada scroll, así que también entra lo que se pasó de largo: nada se queda oculto.
 *  - [data-parallax="0.06"]: escribe --py según la posición en pantalla.
 *  - [data-count="5"]: el número sube desde cero al entrar.
 *  - [data-spot]: la tarjeta sigue al cursor (--mx, --my, --rx, --ry). [data-glow]: brillo que sigue al cursor.
 * Con prefers-reduced-motion no arma nada: el contenido queda completo y quieto.
 */
export function MotionRoot() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    const vh = () => window.innerHeight

    // --- entradas
    const reveals = [...document.querySelectorAll<HTMLElement>('[data-reveal]')]
    const counters = new Set<HTMLElement>()
    const runCount = (el: HTMLElement) => {
      const to = Number(el.dataset.count)
      const t0 = performance.now()
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / 900)
        el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))))
        if (k < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    const show = (el: HTMLElement) => {
      el.classList.add('is-in')
      el.querySelectorAll<HTMLElement>('[data-count]').forEach((c) => {
        if (counters.has(c)) { counters.delete(c); runCount(c) }
      })
    }
    // Lo que ya se ve al cargar entra sin transición, en el mismo cuadro en que se arma.
    let pending: HTMLElement[] = []
    for (const el of reveals) {
      if (el.getBoundingClientRect().top < vh() * 0.92) el.classList.add('is-in')
      else {
        pending.push(el)
        el.querySelectorAll<HTMLElement>('[data-count]').forEach((c) => { counters.add(c); c.textContent = '0' })
      }
    }
    root.classList.add('sc-motion')
    // Entra todo lo que quedó por encima de la línea de entrada: lo que se asoma y también lo que se pasó de largo
    // con un scroll rápido o un salto a un ancla, para que nada se quede oculto.
    const sweep = () => {
      if (!pending.length) return
      const line = vh() * 0.88
      pending = pending.filter((el) => {
        if (el.getBoundingClientRect().top > line) return true
        show(el)
        return false
      })
    }

    // --- paralaje
    const pars = [...document.querySelectorAll<HTMLElement>('[data-parallax]')]
    let raf = 0
    const parallax = () => {
      raf = 0
      sweep()
      const h = vh()
      for (const el of pars) {
        const r = el.getBoundingClientRect()
        if (r.bottom < -200 || r.top > h + 200) continue
        const mid = r.top + r.height / 2 - h / 2
        el.style.setProperty('--py', `${(-mid * Number(el.dataset.parallax || 0.05)).toFixed(1)}px`)
      }
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(parallax) }
    parallax()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    // --- cursor
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const onMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      const spot = target?.closest<HTMLElement>('[data-spot]')
      if (spot) {
        const r = spot.getBoundingClientRect()
        const x = e.clientX - r.left
        const y = e.clientY - r.top
        spot.style.setProperty('--mx', `${x.toFixed(0)}px`)
        spot.style.setProperty('--my', `${y.toFixed(0)}px`)
        spot.style.setProperty('--ry', `${((x / r.width - 0.5) * 5).toFixed(2)}deg`)
        spot.style.setProperty('--rx', `${((0.5 - y / r.height) * 5).toFixed(2)}deg`)
      }
      const glow = target?.closest<HTMLElement>('[data-glow]')
      if (glow) {
        const r = glow.getBoundingClientRect()
        glow.style.setProperty('--gx', `${(e.clientX - r.left).toFixed(0)}px`)
        glow.style.setProperty('--gy', `${(e.clientY - r.top).toFixed(0)}px`)
      }
    }
    const onLeave = (e: PointerEvent) => {
      const spot = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-spot]')
      if (spot && !spot.contains(e.relatedTarget as Node | null)) {
        spot.style.setProperty('--rx', '0deg')
        spot.style.setProperty('--ry', '0deg')
      }
    }
    if (fine) {
      document.addEventListener('pointermove', onMove, { passive: true })
      document.addEventListener('pointerout', onLeave, { passive: true })
    }

    return () => {
      root.classList.remove('sc-motion')
      reveals.forEach((el) => el.classList.remove('is-in'))
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerout', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  return null
}
