'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

export type PaletteItem = { href: string; label: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * UX-02: paleta de comandos. Ctrl+K (o Cmd+K) la abre desde cualquier pantalla: escribir filtra los destinos que la persona
 * ya tiene en su menú, y Enter sobre un texto que no es un destino lo busca. Solo navega: no cambia datos.
 */
export function CommandPalette({ items, labels }: { items: PaletteItem[]; labels: { title: string; placeholder: string; search: string; hint: string; close: string } }) {
  const ref = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      const d = ref.current
      if (!d) return
      if (d.open) d.close()
      else {
        setQ('')
        setAt(0)
        d.showModal()
        input.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const text = q.trim()
  const found = useMemo(() => {
    const n = norm(text)
    return (n ? items.filter((i) => norm(i.label).includes(n)) : items).slice(0, 8)
  }, [items, text])
  // La última opción siempre es buscar lo escrito (cuando hay dos letras o más).
  const options: PaletteItem[] = text.length >= 2 ? [...found, { href: `/buscar?q=${encodeURIComponent(text)}`, label: `${labels.search} "${text}"` }] : found
  const current = Math.min(at, Math.max(options.length - 1, 0))

  const go = (href: string) => {
    ref.current?.close()
    router.push(href)
  }

  return (
    <dialog
      ref={ref}
      aria-label={labels.title}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close()
      }}
      className="m-auto mt-[12vh] w-[min(560px,92vw)] animate-pop rounded-[16px] border border-line bg-surface p-0 text-fg shadow-[var(--cg-shadow-float)] backdrop:bg-black/40"
      data-testid="palette"
    >
      <div className="p-4">
        <div className="relative">
          <Search size={18} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setAt(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setAt(Math.min(current + 1, options.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setAt(Math.max(current - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const o = options[current]
                if (o) go(o.href)
              }
            }}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={options[current] ? `palette-${current}` : undefined}
            aria-label={labels.title}
            placeholder={labels.placeholder}
            className="input !pl-11"
            data-testid="palette-input"
          />
        </div>
        <ul id="palette-list" role="listbox" aria-label={labels.title} className="mt-3 max-h-[50vh] overflow-y-auto">
          {options.map((o, i) => (
            <li key={o.href} id={`palette-${i}`} role="option" aria-selected={i === current}>
              <button
                type="button"
                onClick={() => go(o.href)}
                onMouseEnter={() => setAt(i)}
                className={`flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-[15px] font-medium text-strong ${i === current ? 'bg-green-50' : ''}`}
                data-testid="palette-option"
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-[12.5px] text-muted">{labels.hint}</p>
          <button type="button" onClick={() => ref.current?.close()} className="inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-semibold text-muted hover:bg-surface-3" data-testid="palette-close">
            {labels.close}
          </button>
        </div>
      </div>
    </dialog>
  )
}
