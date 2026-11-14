'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Clock, MessageCircle, Phone } from 'lucide-react'
import { cx } from '@/ui/kit'
import { CompleteSheet, fill, showToast, type CompleteAction, type SheetConfig } from '@/ui/complete'

export type QueueGroup = 'late' | 'today' | 'suggested'
export type QueueItem = {
  key: string
  type: 'task' | 'lead' | 'suggestion'
  id: string
  group: QueueGroup
  title: string
  context: string
  name: string
  chip: { text: string; tone: 'risk' | 'warn' | 'neutral' | 'suggested' }
  /** Vencimiento del primer contacto de un lead (ISO): alimenta la cuenta regresiva. */
  clock: string | null
  /** Cuando la meta no vence hoy (por ejemplo, el lunes a las 11:00), la fecha y hora de vencimiento en lugar de la cuenta regresiva. */
  clockAt?: string | null
  href: string
  tel: string | null
  wa: string | null
  results: { value: string; label: string }[]
  defaultResult: string | null
  closable?: boolean
  visit?: boolean
  motor?: string | null
}
export type QueueLabels = {
  now: string
  call: string
  whatsapp: string
  open: string
  done: string
  markDone: string
  noPhone: string
  /** Plantillas con %s: el cliente pone el dato que cambia. */
  completeOf: string
  callOf: string
  whatsappOf: string
  clock: string
  clockLate: string
  clockAt?: string
  more: Record<QueueGroup, string | null>
  groups: Record<QueueGroup, string>
  emptyTitle: string
  emptyBody: string
  /** Quien supervisa y no tiene pendientes propios: enlace a los de su equipo. */
  emptyLink?: { href: string; label: string } | null
  backlogLink: string
}

const CHIP = {
  risk: 'bg-risk-bg text-red-text',
  warn: 'bg-warn-bg text-amber-text',
  neutral: 'bg-surface-3 text-strong',
  suggested: 'bg-green-100 text-brand-text',
} as const

/** mm:ss por debajo de una hora; horas y minutos por encima. */
function span(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = total % 60
  // Sin segundos: "07:21" se leía como horas (tercera vuelta del comité). Menos de un minuto cuenta como 1 min.
  void ss
  return h > 0 ? `${h} h ${mm} min` : `${Math.max(1, mm)} min`
}

/**
 * Cola de Hoy (handoff, secciones 5 y 6): tarjeta "Ahora" con lo más urgente, grupos Vencido, Hoy y Sugerido,
 * y la hoja "Completar", que siempre pide el próximo paso.
 */
export function Queue({
  items,
  counts,
  labels,
  sheet: config,
  now: serverNow,
  action,
}: {
  items: QueueItem[]
  counts: Record<QueueGroup, number>
  labels: QueueLabels
  sheet: SheetConfig
  now: string
  action: CompleteAction
}) {
  const router = useRouter()
  const [gone, setGone] = useState<string[]>([])
  const [leaving, setLeaving] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ item: QueueItem; afterCall: boolean } | null>(null)
  const [now, setNow] = useState(() => Date.parse(serverNow))
  const awaiting = useRef<{ item: QueueItem; left: boolean } | null>(null)

  const live = items.filter((i) => !gone.includes(i.key))
  const head = live[0]
  const rest = live.slice(1)
  const ticking = live.some((i) => i.clock)

  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])

  const openSheet = useCallback((item: QueueItem, afterCall = false) => setSheet({ item, afterCall }), [])

  // Llamar y WhatsApp sacan a la persona de la app. Al volver, la hoja pregunta cómo le fue.
  useEffect(() => {
    const onVisibility = () => {
      const a = awaiting.current
      if (!a) return
      if (document.visibilityState === 'hidden') a.left = true
      else if (a.left) {
        awaiting.current = null
        openSheet(a.item, true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [openSheet])

  const contacted = (item: QueueItem) => {
    awaiting.current = { item, left: false }
  }

  // Al guardar: la fila se pliega (420 ms), sale de la cola y el servidor manda la cola nueva.
  const done = (text: string | null) => {
    const key = sheet?.item.key
    showToast(text)
    if (!key) return
    setLeaving(key)
    setTimeout(() => {
      setGone((g) => [...g, key])
      setLeaving(null)
      router.refresh()
    }, 420)
  }

  const clockChip = (item: QueueItem, onBlack: boolean) => {
    if (!item.clock) return null
    const left = Date.parse(item.clock) - now
    const late = left < 0
    return (
      <span
        className={cx(
          'num inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium',
          late ? (onBlack ? 'bg-[#3a1512] text-[#ffb4ab]' : 'bg-risk-bg text-red-text') : 'bg-warn-bg text-[#9a6200]',
        )}
        data-testid="lead-clock"
      >
        <Clock size={15} strokeWidth={1.75} aria-hidden />
        {!late && item.clockAt && labels.clockAt ? fill(labels.clockAt, item.clockAt) : fill(late ? labels.clockLate : labels.clock, span(left))}
      </span>
    )
  }

  const contact = (item: QueueItem, kind: 'tel' | 'wa', size: string) => {
    const href = kind === 'tel' ? item.tel : item.wa
    const Icon = kind === 'tel' ? Phone : MessageCircle
    const label = fill(kind === 'tel' ? labels.callOf : labels.whatsappOf, item.name)
    const base = cx('press inline-flex shrink-0 items-center justify-center rounded-[10px] border', size)
    if (!href)
      return (
        <span className={cx(base, 'border-dashed border-line-2 text-muted')} role="img" aria-label={`${label}: ${labels.noPhone}`} title={labels.noPhone}>
          <Icon size={20} strokeWidth={1.75} aria-hidden />
        </span>
      )
    return (
      <a
        href={href}
        {...(kind === 'wa' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        onClick={() => contacted(item)}
        aria-label={label}
        title={label}
        className={cx(base, 'border-line bg-surface text-green-600 hover:bg-green-50')}
        data-testid={kind === 'tel' ? 'row-call' : 'row-whatsapp'}
      >
        <Icon size={20} strokeWidth={1.75} aria-hidden />
      </a>
    )
  }

  const nowButton = 'press inline-flex h-12 items-center justify-center gap-2 rounded-[10px] px-5 text-[15px] font-semibold whitespace-nowrap'

  return (
    <div data-testid="queue">
      {live.length === 0 ? (
        <div className="card flex flex-col items-center px-8 py-14 text-center" data-testid="queue-empty">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden>
            <circle cx="28" cy="28" r="27" fill="var(--cg-green-100)" />
            <path className="drawn" d="M17 29l8 8 15-17" stroke="var(--cg-green-600)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="mt-5 text-[18px] leading-[26px] font-semibold">{labels.emptyTitle}</h2>
          <p className="mt-1 max-w-sm text-[15px] text-muted">{labels.emptyBody}</p>
          {labels.emptyLink && <Link href={labels.emptyLink.href} className="mt-4 inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="queue-empty-team">{labels.emptyLink.label}</Link>}
        </div>
      ) : (
        <>
          {head && (
            <section
              aria-label={labels.now}
              data-testid="now-card"
              data-key={head.key}
              data-leaving={leaving === head.key ? '' : undefined}
              className="now-card stage on-ink flex flex-col gap-5 rounded-[16px] p-5 md:p-8 desk:flex-row desk:items-center desk:justify-between"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-mint">{labels.now}</p>
                <h2 className="mt-1 text-[20px] leading-7 font-semibold md:text-[22px] md:leading-[30px]" data-testid="now-title">
                  {/* En móvil el título abre la ficha: el botón "Abrir ficha" aparece desde tablet. */}
                  <Link href={head.href} className="md:pointer-events-none">{head.title}</Link>
                </h2>
                <p className="mt-1 text-[15px] text-on-black">{head.context}</p>
                {head.clock ? <p className="mt-3">{clockChip(head, true)}</p> : null}
              </div>
              <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap desk:shrink-0 desk:flex-nowrap">
                {head.tel ? (
                  <a href={head.tel} onClick={() => contacted(head)} className={cx(nowButton, 'glow-hover bg-neon text-black')} data-testid="now-call">
                    <Phone size={20} strokeWidth={1.75} aria-hidden />
                    {labels.call}
                  </a>
                ) : (
                  <span className={cx(nowButton, 'border border-dashed border-black-line text-on-black')}>{labels.noPhone}</span>
                )}
                {head.wa ? (
                  <a href={head.wa} target="_blank" rel="noopener noreferrer" onClick={() => contacted(head)} className={cx(nowButton, 'border border-black-line bg-black text-white hover:bg-graphite')} data-testid="now-whatsapp">
                    <MessageCircle size={20} strokeWidth={1.75} aria-hidden />
                    {labels.whatsapp}
                  </a>
                ) : null}
                <Link href={head.href} className={cx(nowButton, 'border border-black-line bg-black text-white hover:bg-graphite max-md:hidden')} data-testid="now-open">
                  {labels.open}
                </Link>
                <button type="button" onClick={() => openSheet(head)} className={cx(nowButton, 'border border-black-line bg-graphite text-white hover:bg-[#1c2420] max-md:col-span-2')} data-testid="now-done">
                  <Check size={20} strokeWidth={1.75} aria-hidden />
                  <span className="md:hidden">{labels.markDone}</span>
                  <span className="hidden md:inline">{labels.done}</span>
                </button>
              </div>
            </section>
          )}

          {(['late', 'today', 'suggested'] as const).map((g) => {
            const rows = rest.filter((i) => i.group === g)
            if (rows.length === 0) return null
            const total = Math.max(rows.length, counts[g] - (head?.group === g ? 1 : 0) - gone.length)
            return (
              <section key={g} className="mt-8" aria-labelledby={`group-${g}`} data-testid={`group-${g}`}>
                <h2 id={`group-${g}`} className="mb-3 flex items-baseline gap-2 text-[15px] leading-6 font-semibold">
                  {labels.groups[g]}
                  <span className="num text-[13px] font-normal text-muted">{total}</span>
                </h2>
                <ul className="card divide-y divide-line overflow-hidden">
                  {rows.map((item) => (
                    <li key={item.key} className="q-row row-hover flex items-center gap-3 px-4 py-3.5 md:gap-4 md:px-5" data-testid="queue-row" data-key={item.key} data-leaving={leaving === item.key ? '' : undefined}>
                      <button
                        type="button"
                        onClick={() => openSheet(item)}
                        aria-label={fill(labels.completeOf, item.title)}
                        title={labels.markDone}
                        className="q-check inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-line-2 text-black md:h-7 md:w-7"
                        data-testid="row-complete"
                      >
                        <Check size={16} strokeWidth={2.5} aria-hidden className="opacity-0" />
                      </button>
                      <span className={cx('num hidden w-[96px] shrink-0 justify-center rounded-full px-2 py-1 text-center text-[13px] font-medium md:inline-flex', CHIP[item.chip.tone])}>{item.chip.text}</span>
                      <Link href={item.href} className="min-w-0 flex-1">
                        <span className="block text-[15px] leading-6 font-medium text-strong md:truncate">{item.title}</span>
                        <span className="block text-[13px] leading-5 text-muted md:truncate">{item.context}</span>
                        <span className={cx('num mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-medium md:hidden', CHIP[item.chip.tone])}>{item.chip.text}</span>
                      </Link>
                      {contact(item, 'tel', 'h-11 w-11 md:h-10 md:w-10')}
                      <span className="hidden md:inline-flex">{contact(item, 'wa', 'h-10 w-10')}</span>
                    </li>
                  ))}
                </ul>
                {labels.more[g] && (
                  <p className="mt-2 px-1 text-[13px] text-muted" data-testid={`more-${g}`}>
                    {labels.more[g]}
                    {g === 'suggested' && <> <Link href="/pipelines?owner=me&vista=lista&paso=sin" className="font-medium text-blue-text underline">{labels.backlogLink}</Link></>}
                  </p>
                )}
              </section>
            )
          })}
        </>
      )}

      <CompleteSheet target={sheet} config={config} action={action} onClose={() => setSheet(null)} onDone={done} />
    </div>
  )
}

/**
 * El número del encabezado cuenta desde 0 en 600 ms, una vez por visita (handoff, sección 5).
 * Con "reducir movimiento" muestra el valor final sin contar.
 */
export function CountUp({ value, text, id }: { value: number; text: string; id: string }) {
  const [shown, setShown] = useState(value)
  useLayoutEffect(() => {
    const key = `cg.count.${id}`
    let seen = true
    try {
      seen = sessionStorage.getItem(key) === '1'
      sessionStorage.setItem(key, '1')
    } catch {
      /* sin almacenamiento: no se anima */
    }
    if (seen || value <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const start = performance.now()
    let frame = requestAnimationFrame(function step(t) {
      const p = Math.min(1, (t - start) / 600)
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [id, value])
  const current = shown === value ? text : text.replace(String(value), String(shown))
  return (
    <>
      <span aria-hidden>{current}</span>
      <span className="sr-only">{text}</span>
    </>
  )
}
