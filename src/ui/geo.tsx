'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { LocateFixed } from 'lucide-react'
import type { ActionResult } from '@/lib/errors'
import { distanceText } from '@/lib/markets'

type Coords = { latitude: number; longitude: number; accuracy: number }

/** Pide la ubicación al navegador. El navegador le pregunta a la persona; si dice que no, se captura a mano. */
function locate(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('unsupported'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'denied' : 'unavailable')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  })
}

export type LocationLabels = { latitude: string; longitude: string; use: string; locating: string; denied: string; unavailable: string; got: string; hint: string }

/** Latitud y longitud de un comercio: se escriben a mano o se llenan con la ubicación del teléfono (estando en el comercio). */
export function LocationFields({ latitude, longitude, labels }: { latitude: string; longitude: string; labels: LocationLabels }) {
  const [lat, setLat] = useState(latitude)
  const [lon, setLon] = useState(longitude)
  const [source, setSource] = useState<'manual' | 'device'>('manual')
  const [accuracy, setAccuracy] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'denied' | 'unavailable' | 'got'>('idle')
  const use = async () => {
    setState('busy')
    try {
      const c = await locate()
      setLat(c.latitude.toFixed(6))
      setLon(c.longitude.toFixed(6))
      setSource('device')
      setAccuracy(String(Math.round(c.accuracy)))
      setState('got')
    } catch (e) {
      setState((e as Error).message === 'denied' ? 'denied' : 'unavailable')
    }
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-[13px] font-semibold text-muted-2">{labels.latitude}
          <input name="latitude" className="input mt-1.5" inputMode="decimal" required value={lat} onChange={(e) => { setLat(e.target.value); setSource('manual'); setAccuracy('') }} data-testid="geo-lat" />
        </label>
        <label className="block text-[13px] font-semibold text-muted-2">{labels.longitude}
          <input name="longitude" className="input mt-1.5" inputMode="decimal" required value={lon} onChange={(e) => { setLon(e.target.value); setSource('manual'); setAccuracy('') }} data-testid="geo-lon" />
        </label>
      </div>
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="accuracy" value={accuracy} />
      <button type="button" onClick={use} disabled={state === 'busy'} className="press inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[14px] font-medium text-strong hover:bg-green-50" data-testid="geo-use">
        <LocateFixed size={18} strokeWidth={1.75} aria-hidden />{state === 'busy' ? labels.locating : labels.use}
      </button>
      <p className="text-[13px] text-muted-2" role="status" data-testid="geo-state" data-state={state}>
        {state === 'denied' ? labels.denied : state === 'unavailable' ? labels.unavailable : state === 'got' ? `${labels.got}${accuracy ? ` (±${accuracy} m)` : ''}` : labels.hint}
      </p>
    </div>
  )
}

export type NearItem = { id: string; name: string; lifecycle: string; locality: string | null; address_line: string | null; owner_name: string | null; phone: string | null; distance_m: number }
export type NearLabels = {
  search: string; locating: string; denied: string; unavailable: string; failed: string; empty: string; emptyHint: string; radius: string; noOwner: string; call: string
  foundOne: string; foundMany: string
  lifecycle: Record<string, string>
}

/** "Cerca de mí": lista los comercios del alcance de la persona por distancia. La ubicación se usa para la consulta y no se guarda. */
export function NearMe({ action, labels, locale, radii }: { action: (lat: number, lon: number, radius: number) => Promise<ActionResult<NearItem[]>>; labels: NearLabels; locale: 'es' | 'en'; radii: { value: number; label: string }[] }) {
  const [items, setItems] = useState<NearItem[] | null>(null)
  const [radius, setRadius] = useState(radii[1]?.value ?? 2000)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setError(null)
    setBusy(true)
    let c: Coords
    try {
      c = await locate()
    } catch (e) {
      setBusy(false)
      setError((e as Error).message === 'denied' ? labels.denied : labels.unavailable)
      return
    }
    setBusy(false)
    start(async () => {
      const res = await action(c.latitude, c.longitude, radius)
      if (res.ok) setItems(res.data ?? [])
      else setError(res.error || labels.failed)
    })
  }
  const working = busy || pending
  return (
    <div data-testid="near-me">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-[13px] font-semibold text-muted-2">{labels.radius}
          <select className="input mt-1.5 !w-40" value={radius} onChange={(e) => setRadius(Number(e.target.value))} data-testid="near-radius">
            {radii.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={run} disabled={working} className="press inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-black px-5 text-[15px] font-semibold text-white disabled:opacity-60" data-testid="near-search">
          <LocateFixed size={18} strokeWidth={1.75} aria-hidden />{working ? labels.locating : labels.search}
        </button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-[12px] bg-warn-bg px-4 py-3 text-[14px] font-medium text-amber-text" data-testid="near-error">{error}</p>}
      {items && items.length === 0 && (
        <div className="mt-5 rounded-[12px] bg-surface-2 px-4 py-4" data-testid="near-empty">
          <p className="text-[15px] font-medium text-strong">{labels.empty}</p>
          <p className="mt-1 text-[13.5px] text-muted-2">{labels.emptyHint}</p>
        </div>
      )}
      {items && items.length > 0 && (
        <>
          <p className="mt-5 text-[13.5px] text-muted-2" role="status" data-testid="near-count">{(items.length === 1 ? labels.foundOne : labels.foundMany).replace('{n}', String(items.length))}</p>
          <ul className="mt-2 divide-y divide-line" data-testid="near-list">
            {items.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-3" data-testid="near-row">
                <Link href={`/comercios/${a.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-strong">{a.name}</span>
                  <span className="block truncate text-[13px] text-muted-2">{[labels.lifecycle[a.lifecycle] ?? a.lifecycle, a.address_line ?? a.locality, a.owner_name ?? labels.noOwner].filter(Boolean).join(' · ')}</span>
                </Link>
                <span className="num shrink-0 text-[14px] font-semibold text-strong" data-testid="near-distance">{distanceText(a.distance_m, locale)}</span>
                {a.phone && <a href={`tel:${a.phone}`} className="inline-flex min-h-11 shrink-0 items-center text-[14px] font-medium text-blue-text underline">{labels.call}</a>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
