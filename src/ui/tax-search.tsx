'use client'

import { useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import type { ActionResult } from '@/lib/errors'

export type TaxHit = { id: string; name: string; market_code: string; locality: string | null }
export type TaxSearchLabels = { title: string; hint: string; field: string; search: string; searching: string; none: string; match: string; failed: string }

/**
 * MULTI-03: búsqueda de un comercio por su identificador fiscal completo (coincidencia exacta, por huella).
 * Va en su propio formulario y viaja en el cuerpo de la petición: el identificador no queda en la dirección de la página,
 * ni en el historial del navegador, ni se guarda.
 */
export function TaxSearch({ action, labels, showMarket }: { action: (value: string) => Promise<ActionResult<TaxHit[]>>; labels: TaxSearchLabels; showMarket: boolean }) {
  const [value, setValue] = useState('')
  const [hits, setHits] = useState<TaxHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const term = value.trim()
    if (!term) return
    setError(null)
    start(async () => {
      const res = await action(term)
      if (res.ok) setHits(res.data ?? [])
      else {
        setHits(null)
        setError(res.error || labels.failed)
      }
    })
  }
  return (
    <section className="mt-10 border-t border-line pt-6" data-testid="tax-search">
      <h2 className="text-[15px] leading-6 font-semibold">{labels.title}</h2>
      <p className="mt-1 text-[13.5px] text-muted">{labels.hint}</p>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3" autoComplete="off">
        <label className="block min-w-0 flex-1 text-[13px] font-semibold text-muted-2">{labels.field}
          <input className="input mt-1.5" value={value} onChange={(e) => setValue(e.target.value)} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} data-testid="tax-search-input" />
        </label>
        <button type="submit" disabled={pending} aria-busy={pending} className="press inline-flex min-h-11 items-center rounded-[10px] bg-black px-5 text-[15px] font-semibold text-white disabled:opacity-60" data-testid="tax-search-go">
          {pending ? labels.searching : labels.search}
        </button>
      </form>
      {error && <p role="alert" className="mt-3 rounded-2xl bg-red/10 px-4 py-3 text-[13.5px] font-medium text-red-text" data-testid="tax-search-error">{error}</p>}
      <div role="status" aria-live="polite">
        {hits !== null && hits.length === 0 && <p className="mt-3 text-[14px] text-muted" data-testid="tax-search-none">{labels.none}</p>}
        {hits !== null && hits.length > 0 && (
          <ul className="card mt-3 divide-y divide-line overflow-hidden" data-testid="search-tax">
            {hits.map((a) => (
              <li key={a.id}>
                <Link href={`/comercios/${a.id}?tab=datos`} className="row-hover flex items-center justify-between gap-4 px-4 py-3.5 md:px-5" data-testid="search-tax-hit">
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-strong">{a.name}</span>
                    <span className="block truncate text-[13px] text-muted">{[a.locality, showMarket ? a.market_code : null, labels.match].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
