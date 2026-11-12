'use client'

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { buttonClass, cx } from '@/ui/kit'
import { offlineBlocked } from '@/ui/complete'
import type { FormAction } from '@/ui/client'

const TZ_COOKIE = 'contigo_tz'

/**
 * Deja en una cookie la zona horaria del navegador, para que el servidor muestre las horas en la zona de quien lee.
 * Solo vuelve a pedir la página cuando la zona guardada es otra (primera visita, o la persona viajó).
 */
export function TimezoneSync({ current }: { current: string }) {
  const router = useRouter()
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz || tz === current) return
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    router.refresh()
  }, [current, router])
  return null
}

// ------------------------------------------------------------------ aviso que sobrevive a la fila que lo causó
export type NoticeLink = { href: string; label: string }
type NoticeState = { text: string; link?: NoticeLink }
const Notice = createContext<(notice: NoticeState) => void>(() => {})
const linkOf = (data: unknown): NoticeLink | undefined => {
  const link = (data as { link?: Partial<NoticeLink> } | null | undefined)?.link
  return link && typeof link.href === 'string' && link.href.startsWith('/') && typeof link.label === 'string' ? { href: link.href, label: link.label } : undefined
}

/**
 * Zona con un aviso arriba. Al quitar un acceso, la fila (y su diálogo) desaparece: el resultado se muestra aquí,
 * se queda hasta que la persona lo cierra y lo anuncia un lector de pantalla.
 */
export function NoticeArea({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  const [notice, setNotice] = useState<NoticeState | null>(null)
  return (
    <Notice.Provider value={setNotice}>
      <div aria-live="polite">
        {notice && (
          <div role="status" data-testid="admin-notice" className="mb-5 flex items-start gap-3 rounded-[14px] bg-green-100 px-5 py-4 text-[14px] font-medium text-brand-text">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3">
              <p className="min-w-0 flex-1 basis-[240px] [overflow-wrap:anywhere]">{notice.text}</p>
              {/* El aviso lleva a lo que sigue: al quitar un acceso, a repartir lo que quedó sin dueño vigente. */}
              {notice.link && <Link href={notice.link.href} className={buttonClass('ghost')} data-testid="admin-notice-link">{notice.link.label}</Link>}
            </div>
            <button type="button" onClick={() => setNotice(null)} aria-label={closeLabel} className="press -my-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-green-50" data-testid="admin-notice-close">
              <X size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        )}
      </div>
      {children}
    </Notice.Provider>
  )
}

/**
 * Formulario de una acción de administración. El error se queda junto al formulario; el resultado va al aviso de la zona
 * y, si el formulario vive en un diálogo, lo cierra.
 */
export function NoticeForm({ action, children, className, testId }: { action: FormAction; children: ReactNode; className?: string; testId?: string }) {
  const notify = useContext(Notice)
  const ref = useRef<HTMLFormElement>(null)
  const last = useRef(0)
  // El resultado se entrega al aviso y el diálogo se cierra aquí, al volver la acción, y no en un efecto: cuando la acción
  // quita la fila en la que vive este formulario (quitar un acceso, revocar una llave), el formulario se desmonta en el
  // mismo render en que llega la respuesta y un efecto ya no alcanzaría a correr.
  const run: FormAction = async (prev, data) => {
    const res = await action(prev, data)
    if (res.ok) {
      last.current = Date.now()
      if (res.message) notify({ text: res.message, link: linkOf(res.data) })
      ref.current?.closest('dialog')?.close()
    }
    return res
  }
  const [state, formAction] = useActionState(run, null)
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (Date.now() - last.current < 700 || offlineBlocked()) return
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter)
    startTransition(() => formAction(data))
  }
  return (
    <form ref={ref} onSubmit={onSubmit} className={className} data-testid={testId}>
      {children}
      {state && !state.ok && (
        <p role="alert" data-testid="form-error" className="mt-4 rounded-2xl bg-red/10 px-4 py-3 text-[13.5px] font-medium text-red-text">
          {state.error}
        </p>
      )}
    </form>
  )
}

/** Botón que cierra el diálogo en el que vive, sin enviar nada. */
export function CloseDialog({ children }: { children: ReactNode }) {
  return (
    <button type="button" className={buttonClass('ghost')} onClick={(e) => e.currentTarget.closest('dialog')?.close()} data-testid="dialog-cancel">
      {children}
    </button>
  )
}

// ------------------------------------------------------------------ dar acceso
export type GrantLabels = {
  email: string
  emailHint: string
  name: string
  role: string
  market: string
  team: string
  teamHint: string
  noTeam: string
  expires: string
  expiresHint: string
  adminConfirm: string
  adminHint: string
  supervisorWarn: string
  globalHint: string
}

/**
 * Campos de "Dar acceso". Lo que se pide depende del rol: Administración y Leadership no llevan mercado ni equipo;
 * Administración pide una confirmación aparte; una supervisión sin equipo avisa antes de guardar.
 */
export function GrantFields({ roles, markets, teams, labels, today }: { roles: { value: string; label: string }[]; markets: { code: string; name: string }[]; teams: { id: string; name: string; market: string }[]; labels: GrantLabels; today: string }) {
  // De entrada, el rol más común y el de menor alcance: Ventas. Administración se elige a propósito.
  const [role, setRole] = useState(roles.some((r) => r.value === 'rep') ? 'rep' : (roles[0]?.value ?? 'rep'))
  const [market, setMarket] = useState(markets[0]?.code ?? '')
  const [team, setTeam] = useState('')
  const global = role === 'admin' || role === 'lt'
  const options = teams.filter((x) => x.market === market)
  const field = 'mb-2 block text-[13px] font-semibold text-muted-2'
  return (
    <>
      <label className="col-span-2 block">
        <span className={field}>{labels.email}</span>
        <input name="email" type="email" className="input" required data-testid="grant-email" />
        <span className="mt-1.5 block text-[12px] text-muted">{labels.emailHint}</span>
      </label>
      <label className="col-span-2 block">
        <span className={field}>{labels.name}</span>
        <input name="full_name" className="input" required minLength={2} data-testid="grant-name" />
      </label>
      <label className={cx('block', global ? 'col-span-2' : 'col-span-2 sm:col-span-1')}>
        <span className={field}>{labels.role}</span>
        <select name="role" className="input" value={role} onChange={(e) => setRole(e.target.value)} data-testid="grant-role">
          {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {global && <span className="mt-1.5 block text-[12px] text-muted">{labels.globalHint}</span>}
      </label>
      {!global && (
        <label className="col-span-2 block sm:col-span-1">
          <span className={field}>{labels.market}</span>
          <select name="market" className="input" value={market} onChange={(e) => { setMarket(e.target.value); setTeam('') }} data-testid="grant-market">
            {markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>
        </label>
      )}
      {!global && (
        <label className="col-span-2 block">
          <span className={field}>{labels.team}</span>
          <select name="team_id" className="input" value={team} onChange={(e) => setTeam(e.target.value)} data-testid="grant-team">
            <option value="">{labels.noTeam}</option>
            {options.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <span className="mt-1.5 block text-[12px] text-muted">{labels.teamHint}</span>
        </label>
      )}
      {role === 'supervisor' && !team && (
        <p role="status" className="col-span-2 rounded-[10px] bg-warn-bg px-4 py-3 text-[13.5px] font-medium text-amber-text" data-testid="grant-supervisor-warn">{labels.supervisorWarn}</p>
      )}
      <label className="col-span-2 block">
        <span className={field}>{labels.expires}</span>
        <input name="expires" type="date" className="input" min={today} data-testid="grant-expires" />
        <span className="mt-1.5 block text-[12px] text-muted">{labels.expiresHint}</span>
      </label>
      {role === 'admin' && (
        <div className="col-span-2 rounded-[10px] bg-warn-bg px-4 py-3" data-testid="grant-admin-confirm">
          <p className="text-[13.5px] font-medium text-amber-text">{labels.adminHint}</p>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] font-semibold text-strong">
            <input type="checkbox" name="confirm_admin" className="h-5 w-5 shrink-0" data-testid="grant-admin-check" />
            {labels.adminConfirm}
          </label>
        </div>
      )}
    </>
  )
}

/** Envía el formulario de filtros en cuanto cambia un selector: sin JavaScript queda el botón "Aplicar". */
export function AutoSubmit({ children, className, action, testId }: { children: ReactNode; className?: string; action: string; testId?: string }) {
  return (
    <form
      method="get"
      action={action}
      className={className}
      data-testid={testId}
      onChange={(e) => {
        const el = e.target as HTMLElement
        if (el.tagName === 'SELECT') e.currentTarget.requestSubmit()
      }}
    >
      {children}
    </form>
  )
}
