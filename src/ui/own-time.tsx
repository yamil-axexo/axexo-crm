'use client'

import { useSyncExternalStore } from 'react'
import { ownTime, type Locale } from '@/lib/format'

const never = () => () => {}

/**
 * Entre paréntesis, la hora de quien lee cuando su navegador está en una zona distinta a la del mercado:
 * "(10:00 AM your time)". Se calcula en el navegador, sin recargar la pantalla; con la misma hora no muestra nada.
 */
export function OwnTime({ at, zone, locale }: { at: string; zone: string; locale: Locale }) {
  const browser = useSyncExternalStore(never, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => null)
  const text = browser ? ownTime(new Date(at), locale, zone, browser) : ''
  return text ? <span data-testid="own-time"> ({text})</span> : null
}
