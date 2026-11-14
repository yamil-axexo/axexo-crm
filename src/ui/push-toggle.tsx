'use client'

import { useState } from 'react'
import type { ActionResult } from '@/lib/errors'
import { buttonClass } from '@/ui/kit'

/** AUT-05: activar o apagar los avisos del navegador en ESTE navegador. Solo aparece con el push web encendido. */
export function PushToggle({ vapidKey, active, labels, save, remove }: {
  vapidKey: string
  active: boolean
  labels: { on: string; off: string; done: string; denied: string; unsupported: string; failed: string }
  save: (sub: { endpoint: string; p256dh: string; auth: string }) => Promise<ActionResult<unknown>>
  remove: () => Promise<ActionResult<unknown>>
}) {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const b64 = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '')
  const key = () => {
    const s = atob(vapidKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (vapidKey.length % 4)) % 4))
    return Uint8Array.from(s, (c) => c.charCodeAt(0))
  }
  const turnOn = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setMsg(labels.unsupported)
    setBusy(true)
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setMsg(labels.denied)
      const reg = await navigator.serviceWorker.register('/sw.js')
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key() })
      const r = await save({ endpoint: sub.endpoint, p256dh: b64(sub.getKey('p256dh')), auth: b64(sub.getKey('auth')) })
      setMsg(r.ok ? labels.done : labels.failed)
    } catch {
      setMsg(labels.failed)
    } finally {
      setBusy(false)
    }
  }
  const turnOff = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker?.getRegistration('/sw.js')
      await (await reg?.pushManager.getSubscription())?.unsubscribe()
      const r = await remove()
      setMsg(r.ok ? labels.done : labels.failed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={buttonClass('ghost', 'sm')} disabled={busy} onClick={active ? turnOff : turnOn} data-testid="push-toggle">{active ? labels.off : labels.on}</button>
      {msg && <span role="status" className="text-[13.5px] text-muted-2">{msg}</span>}
    </div>
  )
}
