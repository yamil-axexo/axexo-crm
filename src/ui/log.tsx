'use client'

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Choices, NextStep, SheetText, VisitorField, fill, nextFor, offlineBlocked, showToast, type SheetConfig } from '@/ui/complete'
import { findAccountsAction, logActivityAction, notifyOptionsAction } from '@/app/(app)/actividades/log-actions'
import type { FoundAccount } from '@/dal/field'

export type LogKind = 'visit' | 'call' | 'note'
export type LogAccount = { id: string; name: string; market?: string; place?: string | null; motor?: string | null }
/** Qué se abre: el tipo, el comercio si ya se sabe (ficha, negocio) y si la hoja llega al volver de una llamada. */
export type LogTarget = { kind: LogKind; account?: LogAccount; dealId?: string; afterCall?: boolean }
export type LogConfig = {
  sheet: SheetConfig
  labels: {
    title: string
    kind: string
    kinds: Record<LogKind, string>
    merchant: string
    search: string
    recent: string
    results: string
    searching: string
    noResults: string
    change: string
    on: string
    yesterday: string
    what: string
    missingMerchant: string
    missingResult: string
    missingDay: string
    /** "Avisar a": a quién le aparece la nota como aviso en Hoy. */
    notify: string
    notifyNone: string
  }
  visitResults: { value: string; label: string }[]
  callResults: { value: string; label: string }[]
  today: string
  yesterday: string
  earliest: string
}

const LOG_EVENT = 'contigo:log'

/** Abre la hoja "Registrar actividad" desde cualquier parte (dock, ficha, detalle del negocio). */
export const openLog = (target: LogTarget) => window.dispatchEvent(new CustomEvent<LogTarget>(LOG_EVENT, { detail: target }))

/**
 * Una sola hoja "Registrar actividad" para toda la app, montada en el layout. Empieza por la actividad (visita, llamada
 * o nota), se busca el comercio ahí mismo y se guarda sin salir de la pantalla en la que la persona estaba.
 */
export function LogHost({ config }: { config: LogConfig }) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [target, setTarget] = useState<(LogTarget & { n: number }) | null>(null)
  useEffect(() => {
    let n = 0
    const onLog = (e: Event) => setTarget({ ...(e as CustomEvent<LogTarget>).detail, n: ++n })
    window.addEventListener(LOG_EVENT, onLog)
    return () => window.removeEventListener(LOG_EVENT, onLog)
  }, [])
  useEffect(() => {
    if (target && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [target])
  const close = () => dialog.current?.close()
  return (
    <dialog
      ref={dialog}
      aria-labelledby="log-title"
      onClose={() => setTarget(null)}
      onClick={(e) => {
        if (e.target === dialog.current) close()
      }}
      className="sheet on-ink m-auto max-h-[92dvh] w-[min(560px,100vw)] overflow-y-auto rounded-[16px] p-0 max-md:mb-0 max-md:w-full max-md:max-w-none max-md:rounded-b-none"
      data-testid="log-sheet"
    >
      {target && (
        <LogForm
          key={target.n}
          target={target}
          config={config}
          onCancel={close}
          onSaved={(toast) => {
            close()
            showToast(toast)
            router.refresh()
          }}
        />
      )}
    </dialog>
  )
}

/** "Avisar a": personas que ven este comercio. Se cargan al elegir el comercio; sin nadie a quien avisar, no se muestra. */
function NotifyPicker({ accountId, dealId, label, none }: { accountId: string; dealId: string | null; label: string; none: string }) {
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  useEffect(() => {
    let alive = true
    notifyOptionsAction(accountId, dealId).then((list) => { if (alive) setPeople(list) }).catch(() => {})
    return () => { alive = false }
  }, [accountId, dealId])
  if (people.length === 0) return null
  return (
    <label className="mt-5 block text-[14px] font-medium text-white">{label}
      <select name="notify" defaultValue="" className="input mt-1.5 !border-black-line !bg-graphite !text-white" data-testid="log-notify">
        <option value="">{none}</option>
        {people.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
    </label>
  )
}

function LogForm({ target, config, onCancel, onSaved }: { target: LogTarget; config: LogConfig; onCancel: () => void; onSaved: (toast: string | null) => void }) {
  const { labels, sheet } = config
  const [kind, setKind] = useState<LogKind>(target.kind)
  const [account, setAccount] = useState<LogAccount | null>(target.account ?? null)
  const [next, setNext] = useState('')
  const [when, setWhen] = useState(sheet.defaultWhen)
  const [on, setOn] = useState(config.today)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const onPreset = on === config.today || on === config.yesterday

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    if (!account) return setError(labels.missingMerchant)
    if (kind !== 'note' && !data.get('result')) return setError(labels.missingResult)
    if (kind === 'visit' && !on) return setError(labels.missingDay)
    if (kind !== 'note' && !data.get('next')) return setError(sheet.labels.missingNext)
    if (offlineBlocked()) return
    startTransition(async () => {
      const res = await logActivityAction(null, data)
      if (res.ok) onSaved(res.data?.toast ?? null)
      else setError(res.error)
    })
  }

  return (
    <form onSubmit={submit} className="px-6 pt-6 md:px-8 md:pt-8" data-testid="log-form">
      <span aria-hidden className="mx-auto mb-5 block h-1 w-10 rounded-full bg-black-line md:hidden" />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="account_id" value={account?.id ?? ''} />
      {target.dealId && <input type="hidden" name="deal_id" value={target.dealId} />}
      {target.account && <p className="text-[13px] text-on-black">{labels.title}</p>}
      <h2 id="log-title" className="mt-0.5 text-[18px] leading-[26px] font-semibold [overflow-wrap:anywhere]" data-testid="log-title">
        {target.account ? (target.afterCall ? fill(sheet.labels.afterCall, target.account.name) : target.account.name) : labels.title}
      </h2>

      {!target.afterCall && (
        <Choices name="kind_choice" legend={labels.kind} options={(['visit', 'call', 'note'] as const).map((k) => ({ value: k, label: labels.kinds[k] }))} value={kind} onChange={(v) => { setKind(v as LogKind); setError(null) }} />
      )}

      {!target.account && <MerchantPicker labels={labels} account={account} onPick={(a) => { setAccount(a); setError(null) }} />}

      {account && kind === 'note' && <SheetText name="subject" label={labels.what} maxLength={200} required testId="log-subject" />}
      {account && kind === 'note' && <NotifyPicker key={account.id} accountId={account.id} dealId={target.dealId ?? null} label={labels.notify} none={labels.notifyNone} />}

      {account && kind !== 'note' && (
        <>
          {/* Si hay que volver con quien decide, lo que sigue es visitar: queda elegido y la persona lo puede cambiar. */}
          <Choices key={kind} name="result" legend={sheet.labels.result} options={kind === 'visit' ? config.visitResults : config.callResults} onPick={(v) => v === 'revisit' && !next && setNext('visit')} />
          {kind === 'visit' && (
            <>
              <Choices
                name="on_choice"
                legend={labels.on}
                options={[{ value: config.today, label: sheet.whenOptions[0]?.label ?? '' }, { value: config.yesterday, label: labels.yesterday }, { value: 'other', label: sheet.labels.other }]}
                value={onPreset ? on : 'other'}
                onChange={(v) => setOn(v === 'other' ? '' : v)}
              />
              {!onPreset && (
                <input type="date" required min={config.earliest} max={config.today} value={on} onChange={(e) => setOn(e.target.value)} aria-label={labels.on} className="input mt-3 !border-black-line !bg-graphite !text-white [color-scheme:dark]" data-testid="log-date" />
              )}
              <input type="hidden" name="on" value={on} />
              <VisitorField label={sheet.labels.visitedBy} hint={sheet.labels.visitedByHint} market={account.market} />
            </>
          )}
          <SheetText name="note" label={sheet.labels.note} maxLength={500} testId="log-note" />
          <NextStep labels={sheet.labels} options={nextFor(sheet, account?.motor)} whenOptions={sheet.whenOptions} minDate={sheet.minDate} next={next} onNext={setNext} when={when} onWhen={setWhen} />
        </>
      )}

      {/* Guardar y el aviso de lo que falta quedan siempre a la vista al pie: la hoja de una visita es más alta que un teléfono o una tablet acostada. */}
      <div className="sticky bottom-0 -mx-6 mt-7 border-t border-black-line bg-black px-6 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] md:-mx-8 md:px-8 md:pb-6">
        {error && (
          <p role="alert" className="mb-3 rounded-[10px] bg-[#3a1512] px-4 py-3 text-[14px] font-medium text-[#ffb4ab]" data-testid="log-error">
            {error}
          </p>
        )}
        <div className="flex gap-2 md:justify-end">
          <button type="button" onClick={onCancel} className="press inline-flex h-12 items-center justify-center rounded-[10px] px-4 text-[15px] font-medium text-on-black hover:text-white md:px-5">
            {sheet.labels.cancel}
          </button>
          <button type="submit" disabled={pending} aria-busy={pending} className="press glow-hover inline-flex h-12 flex-1 items-center justify-center rounded-[10px] bg-neon px-6 text-[15px] font-semibold text-black disabled:opacity-60 md:flex-none" data-testid="log-save">
            {kind === 'note' || next === 'none' || !next ? sheet.labels.saveClose : sheet.labels.save}
          </button>
        </div>
      </div>
    </form>
  )
}

/** Buscar el comercio dentro de la hoja: por nombre o teléfono. Antes de escribir, ofrece los últimos con los que se trabajó. */
function MerchantPicker({ labels, account, onPick }: { labels: LogConfig['labels']; account: LogAccount | null; onPick: (a: LogAccount | null) => void }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ q: string; rows: FoundAccount[] } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const term = q.trim()
  useEffect(() => {
    if (account) return
    let live = true
    const timer = setTimeout(() => {
      findAccountsAction(term).then((rows) => live && setFound({ q: term, rows }), () => live && setFound({ q: term, rows: [] }))
    }, term.length < 2 ? 0 : 220)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [term, account])
  useEffect(() => {
    if (!account) input.current?.focus()
  }, [account])

  if (account)
    return (
      <div className="mt-6" data-testid="log-merchant">
        <p className="mb-2.5 text-[15px] font-semibold">{labels.merchant}</p>
        <div className="flex items-center justify-between gap-3 rounded-[12px] border border-black-line bg-graphite px-4 py-3">
          <p className="min-w-0">
            <span className="block text-[15px] font-medium [overflow-wrap:anywhere]">{account.name}</span>
            {account.place && <span className="block text-[13px] text-on-black">{account.place}</span>}
          </p>
          <button type="button" onClick={() => onPick(null)} className="press inline-flex h-11 shrink-0 items-center rounded-[10px] px-3 text-[14px] font-medium text-mint underline" data-testid="log-change">
            {labels.change}
          </button>
        </div>
      </div>
    )

  // Con menos de dos letras se ofrecen los últimos comercios; la lista vale cuando responde a lo que está escrito.
  const searching = term.length >= 2
  const current = found && (searching ? found.q === term : found.q.length < 2) ? found.rows : null
  return (
    <div className="mt-6" data-testid="log-merchant">
      <label className="block">
        <span className="mb-2.5 block text-[15px] font-semibold">{labels.merchant}</span>
        <input
          ref={input}
          type="text"
          role="searchbox"
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={labels.search}
          autoComplete="off"
          enterKeyHint="search"
          className="input !border-black-line !bg-graphite !text-white placeholder:!text-on-black"
          data-testid="log-search"
        />
      </label>
      <div aria-live="polite" className="mt-3">
        {current === null ? (
          searching && <p className="text-[14px] text-on-black">{labels.searching}</p>
        ) : current.length === 0 ? (
          searching && <p className="text-[14px] text-on-black" data-testid="log-empty">{labels.noResults}</p>
        ) : (
          <>
            <p className="mb-1.5 text-[13px] text-on-black">{searching ? labels.results : labels.recent}</p>
            <ul className="overflow-hidden rounded-[12px] border border-black-line" data-testid="log-results">
              {current.map((a) => (
                <li key={a.id} className="border-t border-black-line first:border-t-0">
                  <button type="button" onClick={() => onPick(a)} className="flex min-h-12 w-full flex-col justify-center px-4 py-2 text-left hover:bg-graphite" data-testid="log-result">
                    <span className="text-[15px] font-medium [overflow-wrap:anywhere]">{a.name}</span>
                    {a.place && <span className="text-[13px] text-on-black">{a.place}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

/** Botón que abre la hoja ya con el tipo y, si se sabe, el comercio (por ejemplo "Visita" en la ficha). */
export function LogButton({ target, className, testId, children, role, onOpen }: { target: LogTarget; className?: string; testId?: string; children: ReactNode; role?: string; onOpen?: () => void }) {
  return (
    <button
      type="button"
      role={role}
      className={className}
      data-testid={testId}
      onClick={() => {
        onOpen?.()
        openLog(target)
      }}
    >
      {children}
    </button>
  )
}

/**
 * Llamar desde la ficha o desde el detalle del negocio. Al volver a la app, la hoja pregunta cómo te fue y la llamada
 * queda en el hilo con su resultado (igual que ya pasaba en Hoy y en Leads).
 */
export function CallLink({ href, account, dealId, className, title, testId, children }: { href: string; account: LogAccount; dealId?: string; className?: string; title?: string; testId?: string; children: ReactNode }) {
  const away = useRef<{ left: boolean } | null>(null)
  useEffect(() => {
    const onVisibility = () => {
      const a = away.current
      if (!a) return
      if (document.visibilityState === 'hidden') a.left = true
      else if (a.left) {
        away.current = null
        openLog({ kind: 'call', account, dealId, afterCall: true })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [account, dealId])
  return (
    <a href={href} className={className} title={title} data-testid={testId} onClick={() => (away.current = { left: false })}>
      {children}
    </a>
  )
}
