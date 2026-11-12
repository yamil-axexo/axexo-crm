'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, BellOff, Inbox, Kanban, ListTodo, Plus, Search, Store, Sun } from 'lucide-react'
import { cx } from '@/ui/kit'
import { showToast } from '@/ui/complete'
import { openLog } from '@/ui/log'

const ICONS = { today: Sun, leads: Inbox, deals: Kanban, merchants: Store, queue: ListTodo } as const
export type DockItem = { key: keyof typeof ICONS; href: string; label: string; match: string[]; badge?: number; badgeLabel?: string }

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, close])
  return ref
}

/**
 * Dock: la misma navegación en desktop, tablet y móvil (handoff, secciones 4 y 5).
 * Cuatro destinos y crear. En móvil es la barra inferior; desde 768 px flota abajo al centro.
 */
export function Dock({ items, label, createLabel, create, logLabel }: { items: DockItem[]; label: string; createLabel: string; create: { href: string; label: string }[]; /** "Registrar actividad": empieza por la actividad y busca el comercio ahí mismo. */ logLabel?: string }) {
  const path = usePathname()
  const active = items.findIndex((i) => i.match.some((m) => path === m || path.startsWith(m + '/')))
  const [open, setOpen] = useState(false)
  const menu = useDismiss(open, () => setOpen(false))
  return (
    <nav
      aria-label={label}
      data-testid="dock"
      className="dock on-ink fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 px-2 pt-2 pb-[max(10px,env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-6 md:left-1/2 md:-translate-x-1/2 md:gap-2 md:rounded-full md:p-2"
    >
      <div className="relative flex flex-1 md:flex-none">
        <span
          aria-hidden
          className="dock-pill absolute inset-y-0 left-0 w-1/4 rounded-[14px] md:rounded-full"
          style={{ transform: `translateX(${Math.max(active, 0) * 100}%)`, opacity: active < 0 ? 0 : 1 }}
        />
        {items.map((it, i) => {
          const Icon = ICONS[it.key]
          const on = i === active
          return (
            <Link
              key={it.key}
              href={it.href}
              aria-current={on ? 'page' : undefined}
              data-testid={`nav-${it.key}`}
              className={cx(
                'dock-item press relative z-10 flex h-[62px] w-1/4 flex-col items-center justify-center gap-1 rounded-[14px] text-[12px] md:h-[52px] md:w-[112px] md:flex-row md:gap-2 md:rounded-full md:text-[14px] desk:w-[128px]',
                on ? 'font-semibold text-black' : 'font-medium text-on-black hover:text-white',
              )}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden />
              <span>{it.label}</span>
              {it.badge ? (
                <span className="absolute top-1.5 right-3 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warn-bg px-1 text-[12px] font-semibold text-[#9a6200] md:static" aria-label={it.badgeLabel} data-testid={`nav-${it.key}-badge`}>
                  {it.badge > 99 ? '99+' : it.badge}
                </span>
              ) : null}
            </Link>
          )
        })}
      </div>
      {(create.length > 0 || logLabel) && (
        <div ref={menu} className="relative flex shrink-0 items-center md:pl-2">
          <span aria-hidden className="mr-2 hidden h-7 w-px bg-black-line md:block" />
          <button
            type="button"
            aria-label={createLabel}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((v) => !v)}
            data-testid="dock-create"
            className="press glow-hover inline-flex h-12 w-12 items-center justify-center rounded-full bg-neon text-black shadow-[var(--cg-glow-ring)] md:h-[52px] md:w-[52px]"
          >
            <Plus size={22} strokeWidth={2} aria-hidden className={cx('transition-transform duration-200', open && 'rotate-45')} />
          </button>
          {open && (
            <div role="menu" className="on-ink absolute right-0 bottom-[calc(100%+12px)] w-56 animate-pop rounded-[16px] bg-black p-2 shadow-[var(--cg-shadow-float)]" data-testid="dock-create-menu">
              {logLabel && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    openLog({ kind: 'visit' })
                  }}
                  className="flex h-11 w-full items-center rounded-[10px] px-3 text-left text-[15px] font-medium text-white hover:bg-graphite"
                  data-testid="dock-log"
                >
                  {logLabel}
                </button>
              )}
              {create.map((c) => (
                <Link key={c.href} href={c.href} role="menuitem" onClick={() => setOpen(false)} className="flex h-11 items-center rounded-[10px] px-3 text-[15px] font-medium text-white hover:bg-graphite">
                  {c.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  )
}

/** Buscar: un campo arriba; en desktop la tecla "/" lleva el cursor ahí. */
export function SearchBox({ placeholder, label }: { placeholder: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      ref.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <form action="/buscar" method="get" role="search" className="relative hidden w-full max-w-[424px] md:block">
      <Search size={18} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
      <input ref={ref} name="q" type="search" className="input !bg-surface-2 !pr-12 !pl-11" placeholder={placeholder} aria-label={label} data-testid="global-search" />
      <kbd aria-hidden className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-line bg-surface px-2 text-[12px] font-medium text-muted desk:block">/</kbd>
    </form>
  )
}

/** Cuenta: lo que no es un destino del dock vive aquí (equipo, panel del LT, administración, salir). */
export function AccountMenu({ initials, label, children }: { initials: string; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        data-testid="me-menu"
        className="press inline-flex h-10 w-10 items-center justify-center rounded-full bg-teal text-[13px] font-semibold text-white"
      >
        {initials}
      </button>
      <div
        role="menu"
        hidden={!open}
        onClick={(e) => {
          // Elegir un destino cierra el menú; los formularios (idioma, salir) siguen su envío normal.
          if ((e.target as HTMLElement).closest('a')) setOpen(false)
        }}
        className="absolute top-[calc(100%+10px)] right-0 z-50 w-72 animate-pop rounded-[16px] border border-line bg-surface p-2 shadow-[var(--cg-shadow-lift)]"
        data-testid="me-panel"
      >
        {children}
      </div>
    </div>
  )
}

const onNetwork = (cb: () => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

/**
 * Aviso sin conexión (handoff, sección 5). Mientras no hay señal, guardar queda deshabilitado con borde punteado
 * y la etiqueta "sin señal" (regla en globals.css sobre html[data-offline]).
 * La lectura sin conexión con datos guardados en el equipo no está construida: requiere decisión explícita (ADR-006).
 */
export function OfflineBanner({ text, tag, blocked }: { text: string; tag: string; blocked: string }) {
  const offline = useSyncExternalStore(onNetwork, () => !navigator.onLine, () => false)
  useEffect(() => {
    const root = document.documentElement
    if (offline) {
      root.setAttribute('data-offline', '')
      root.style.setProperty('--offline-tag', JSON.stringify(` · ${tag}`))
      root.dataset.offlineMsg = blocked
    } else root.removeAttribute('data-offline')
    // Sin señal, abrir otra pantalla dejaría la página de error del navegador: el enlace no navega y se avisa por qué.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null
      if (!offline || !a || a.origin !== window.location.origin) return
      e.preventDefault()
      e.stopPropagation()
      showToast(blocked)
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      root.removeAttribute('data-offline')
    }
  }, [offline, tag, blocked])
  if (!offline) return null
  return (
    <p role="status" className="border-b border-[#f0d9a8] bg-warn-bg px-4 py-2.5 text-center text-[14px] font-medium text-amber-text" data-testid="offline-banner">
      {text}
    </p>
  )
}

const ALERT_KEY = 'contigo.leadAlert'
const alertOn = () => {
  try {
    return window.localStorage.getItem(ALERT_KEY) === '1' && 'Notification' in window && Notification.permission === 'granted'
  } catch {
    return false
  }
}
const onAlertChange = (cb: () => void) => {
  window.addEventListener('contigo:lead-alert', cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener('contigo:lead-alert', cb)
    window.removeEventListener('storage', cb)
  }
}

export type LeadWatchLabels = { one: string; many: string; toast: string; notifyTitle: string; notifyBody: string }

/**
 * Con CONTIGO abierto, pregunta cada minuto si llegó un lead. Si llegó uno nuevo: actualiza el contador del dock y la pantalla,
 * lo pone en el título de la pestaña ("(1) Lead nuevo") y, si la persona lo activó en su menú, lanza el aviso del navegador.
 * No hay servidor de push: con la pestaña cerrada no avisa. Sin correo ni Slack.
 */
export function LeadWatch({ initial, labels, everyMs = 60_000 }: { initial: { leadsWaiting: number; latest: string | null }; labels: LeadWatchLabels; everyMs?: number }) {
  const router = useRouter()
  const path = usePathname()
  const seen = useRef(initial)
  const fresh = useRef(0)
  const baseTitle = useRef<string | null>(null)
  const guard = useRef<MutationObserver | null>(null)
  const labelsRef = useRef(labels)
  useEffect(() => {
    labelsRef.current = labels
  }, [labels])

  // Al cambiar de pantalla el aviso del título ya cumplió: se quita, y se deja de vigilar el título.
  useEffect(() => {
    guard.current?.disconnect()
    guard.current = null
    if (fresh.current > 0 && baseTitle.current !== null) document.title = baseTitle.current
    fresh.current = 0
    baseTitle.current = null
  }, [path])
  useEffect(() => () => guard.current?.disconnect(), [])

  useEffect(() => {
    let stop = false
    /**
     * Escribe "(n) Lead nuevo · título" y lo sostiene: al refrescar la pantalla, Next vuelve a escribir el título de la página y
     * el aviso duraba menos de medio segundo. Mientras haya leads nuevos sin ver, si el título cambia y pierde el prefijo, ese
     * título pasa a ser la base y el prefijo se vuelve a poner.
     */
    const holdTitle = () => {
      const write = () => {
        const n = fresh.current
        if (n <= 0) return
        const prefix = `(${n}) ${n === 1 ? labelsRef.current.one : labelsRef.current.many} · `
        if (document.title.startsWith(prefix)) return
        // Un título con el prefijo de un conteo anterior no es la base: la base es lo que escribió la página.
        if (baseTitle.current === null || !/^\(\d+\) /.test(document.title)) baseTitle.current = document.title
        document.title = `${prefix}${baseTitle.current}`
      }
      write()
      if (!guard.current) {
        guard.current = new MutationObserver(write)
        guard.current.observe(document.head, { childList: true, subtree: true, characterData: true })
      }
    }
    const check = async () => {
      if (stop || !navigator.onLine) return
      try {
        const res = await fetch('/api/me/counts', { cache: 'no-store', credentials: 'same-origin' })
        if (!res.ok) return
        const now = (await res.json()) as { leadsWaiting: number; latest: string | null; latestName: string | null }
        const before = seen.current
        const arrived = !!now.latest && (!before.latest || now.latest > before.latest)
        const changed = arrived || now.leadsWaiting !== before.leadsWaiting
        seen.current = { leadsWaiting: now.leadsWaiting, latest: now.latest ?? before.latest }
        if (arrived) {
          fresh.current += Math.max(1, now.leadsWaiting - before.leadsWaiting)
          holdTitle()
          showToast(labels.toast.replace('{name}', now.latestName ?? ''))
          if (alertOn()) {
            try {
              const note = new Notification(labels.notifyTitle, { body: labels.notifyBody.replace('{name}', now.latestName ?? ''), tag: 'contigo-lead', icon: '/contigo-mark-on-light.png' })
              note.onclick = () => {
                window.focus()
                router.push('/leads')
                note.close()
              }
            } catch {
              // Algunos navegadores móviles no dejan crear el aviso desde la página: queda el título y el contador.
            }
          }
        }
        if (changed) router.refresh()
      } catch {
        // Sin red o con la sesión vencida: se intenta de nuevo en la siguiente vuelta.
      }
    }
    const id = window.setInterval(check, everyMs)
    const onVisible = () => document.visibilityState === 'visible' && void check()
    const onAsk = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('contigo:poll', onAsk)
    return () => {
      stop = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('contigo:poll', onAsk)
    }
  }, [everyMs, labels, router])
  return <span hidden data-testid="lead-watch" data-every={everyMs} />
}

/** "Avisarme cuando llegue un lead": aviso del navegador, por persona y por equipo (queda guardado en este navegador). */
export function LeadAlertToggle({ labels }: { labels: { on: string; off: string; hint: string; blocked: string; unsupported: string; enabled: string; disabled: string } }) {
  const on = useSyncExternalStore(onAlertChange, alertOn, () => false)
  const set = async () => {
    if (on) {
      window.localStorage.setItem(ALERT_KEY, '0')
      window.dispatchEvent(new Event('contigo:lead-alert'))
      showToast(labels.disabled)
      return
    }
    if (!('Notification' in window)) return showToast(labels.unsupported)
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    if (permission !== 'granted') return showToast(labels.blocked)
    window.localStorage.setItem(ALERT_KEY, '1')
    window.dispatchEvent(new Event('contigo:lead-alert'))
    showToast(labels.enabled)
  }
  const Icon = on ? Bell : BellOff
  return (
    <div className="border-t border-line py-1">
      <button type="button" role="menuitemcheckbox" aria-checked={on} onClick={set} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[15px] font-medium text-strong hover:bg-green-50" data-testid="lead-alert-toggle" data-on={on ? '1' : '0'}>
        <Icon size={20} strokeWidth={1.75} aria-hidden className="shrink-0" />
        <span className="min-w-0">
          {on ? labels.on : labels.off}
          <span className="block text-[12.5px] font-normal text-muted">{labels.hint}</span>
        </span>
      </button>
    </div>
  )
}
