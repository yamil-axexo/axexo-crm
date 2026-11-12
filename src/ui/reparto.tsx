'use client'

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buttonClass, cx } from '@/ui/kit'
import { offlineBlocked } from '@/ui/complete'
import type { ActionResult } from '@/lib/errors'

// Reparto de cartera en pantalla: se elige qué se mueve y a quién, se confirma con el conteo a la vista y se mueve por
// lotes. Lo usan la lista de Comercios (selección o "todos los de este filtro") y Mi equipo ("Reasignar cartera").

type Locale = 'es' | 'en'
export type RepartoFilter = { q?: string; market?: string; lifecycle?: string; owner?: string; kind?: string; ver?: string; region?: string; city?: string; territory?: string; team?: string; pipeline?: string }
export type RepartoPayload = { what: 'accounts' | 'territory' | 'leads' | 'deals'; ids?: string[]; filter?: RepartoFilter; market?: string; from?: string; to: string }
type Count = { count: number; deals: number; tasks: number }
type Progress = { moved: number; left: number }
export type RepartoActions = {
  preview: (p: RepartoPayload) => Promise<ActionResult<Count>>
  step: (p: RepartoPayload) => Promise<ActionResult<Progress>>
}
export type RepartoPerson = { id: string; full_name: string; market_code: string; team: string | null; mine: boolean }
export type RepartoHolder = { owner_id: string | null; market_code: string; full_name: string | null; is_active: boolean | null; current: boolean; accounts: number; deals: number; leads: number }
export type RepartoTerritory = { id: string; market_code: string; name: string }
export type RepartoRegion = { market_code: string; region: string; accounts: number }

const tr = (locale: Locale) => (es: string, en: string) => (locale === 'en' ? en : es)
const fmt = (n: number, locale: Locale) => new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX').format(n)
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** Qué se va a mover, dicho en una frase: es lo que la persona confirma y lo que queda en el aviso final. */
type Plan = { payload: RepartoPayload; count: number; deals?: number; tasks?: number; toLabel: string }
type Phase =
  | { name: 'idle' }
  | { name: 'checking' }
  | { name: 'confirm'; plan: Plan }
  | { name: 'running'; plan: Plan; done: number; total: number }
  | { name: 'done'; plan: Plan; done: number; left: number }
  | { name: 'error'; message: string }

function useReparto(actions: RepartoActions, onDone?: () => void) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const stop = useRef(false)

  /** Cuenta en el servidor lo que el plan movería y pide confirmación. Una selección ya trae su conteo. */
  const review = useCallback(
    async (payload: RepartoPayload, toLabel: string, known?: number) => {
      if (offlineBlocked()) return
      if (known !== undefined) return setPhase({ name: 'confirm', plan: { payload, count: known, toLabel } })
      setPhase({ name: 'checking' })
      const res = await actions.preview(payload)
      if (!res.ok) return setPhase({ name: 'error', message: res.error })
      const c = res.data ?? { count: 0, deals: 0, tasks: 0 }
      setPhase({ name: 'confirm', plan: { payload, count: c.count, deals: c.deals, tasks: c.tasks, toLabel } })
    },
    [actions],
  )

  /** Mueve lote por lote hasta que no quede nada, la persona detenga o algo falle. Lo ya movido se queda movido. */
  const run = useCallback(
    async (plan: Plan) => {
      if (offlineBlocked()) return
      stop.current = false
      let done = 0
      let left = plan.count
      setPhase({ name: 'running', plan, done, total: plan.count })
      for (let i = 0; i < 400 && !stop.current; i++) {
        let res: ActionResult<Progress>
        try {
          res = await actions.step(plan.payload)
        } catch {
          res = { ok: false, code: 'error', error: '' }
        }
        if (!res.ok || !res.data) {
          router.refresh()
          return setPhase({ name: 'error', message: res.ok ? '' : res.error })
        }
        done += res.data.moved
        left = res.data.left
        if (left === 0 || res.data.moved === 0) break
        setPhase({ name: 'running', plan, done, total: Math.max(plan.count, done + left) })
      }
      setPhase({ name: 'done', plan, done, left })
      router.refresh()
      onDone?.()
    },
    [actions, router, onDone],
  )

  return { phase, review, run, reset: () => setPhase({ name: 'idle' }), halt: () => (stop.current = true) }
}

/** "12 comercios", "1 lead abierto": lo que se mueve, con su número. */
function noun(what: RepartoPayload['what'], count: number, locale: Locale): string {
  const t = tr(locale)
  const n = fmt(count, locale)
  if (what === 'leads') return t(`${n} ${plural(count, 'lead abierto', 'leads abiertos')}`, `${n} open ${plural(count, 'lead', 'leads')}`)
  if (what === 'deals') return t(`${n} ${plural(count, 'negocio abierto', 'negocios abiertos')}`, `${n} open ${plural(count, 'deal', 'deals')}`)
  return t(`${n} ${plural(count, 'comercio', 'comercios')}`, `${n} ${plural(count, 'merchant', 'merchants')}`)
}

/** Lo que se va con los comercios: "con 4 negocios abiertos y 3 tareas abiertas", o sin números cuando no se contaron. */
function carried(plan: Pick<Plan, 'payload' | 'deals' | 'tasks'>, locale: Locale): string {
  const t = tr(locale)
  if (plan.payload.what !== 'accounts') return ''
  if (plan.deals === undefined) return t(', con sus negocios y tareas abiertas', ', with their open deals and tasks')
  const d = fmt(plan.deals, locale)
  const k = fmt(plan.tasks ?? 0, locale)
  return t(
    `, con ${d} ${plural(plan.deals, 'negocio abierto', 'negocios abiertos')} y ${k} ${plural(plan.tasks ?? 0, 'tarea abierta', 'tareas abiertas')}`,
    `, with ${d} open ${plural(plan.deals, 'deal', 'deals')} and ${k} open ${plural(plan.tasks ?? 0, 'task', 'tasks')}`,
  )
}

/** Confirmación, avance y resultado. Vive donde estaban los controles para que el conteo quede a la vista al confirmar. */
function Steps({ locale, phase, onConfirm, onCancel, onStop, listHref }: { locale: Locale; phase: Phase; onConfirm: (p: Plan) => void; onCancel: () => void; onStop: () => void; listHref?: string }) {
  const t = tr(locale)
  if (phase.name === 'checking') return <p role="status" className="text-[14px] text-muted-2" data-testid="reparto-checking">{t('Contando…', 'Counting…')}</p>
  if (phase.name === 'error') {
    return (
      <div data-testid="reparto-error">
        <p role="alert" className="rounded-[10px] bg-risk-bg px-4 py-3 text-[14px] font-medium text-red-text">{phase.message || t('Algo falló de nuestro lado. Lo que ya se movió se quedó movido. Intenta otra vez.', 'Something failed on our side. What was already moved stays moved. Try again.')}</p>
        <div className="mt-3 flex justify-end"><button type="button" className={buttonClass('ghost')} onClick={onCancel} data-testid="reparto-back">{t('Volver', 'Back')}</button></div>
      </div>
    )
  }
  if (phase.name === 'confirm') {
    const { plan } = phase
    const what = noun(plan.payload.what, plan.count, locale)
    const territory = plan.payload.what === 'territory'
    if (plan.count === 0) {
      return (
        <div data-testid="reparto-empty">
          <p role="status" className="rounded-[10px] bg-surface-3 px-4 py-3 text-[14px] text-strong">{territory ? t('No hay comercios que cambiar con eso: ya tienen ese territorio o el filtro no trae ninguno.', 'There are no merchants to change with that: they already have that territory or the filter returns none.') : t('No hay nada que pasar con eso: el filtro no trae registros o ya son de esa persona.', 'There is nothing to move with that: the filter returns no records or they already belong to that person.')}</p>
          <div className="mt-3 flex justify-end"><button type="button" className={buttonClass('ghost')} onClick={onCancel} data-testid="reparto-back">{t('Volver', 'Back')}</button></div>
        </div>
      )
    }
    return (
      <div data-testid="reparto-confirm">
        <p role="status" className="rounded-[10px] bg-green-50 px-4 py-3 text-[15px] text-strong">
          {territory
            ? plan.payload.to
              ? t(`Vas a poner el territorio ${plan.toLabel} a ${what}.`, `You are about to set the territory ${plan.toLabel} on ${what}.`)
              : t(`Vas a quitar el territorio a ${what}.`, `You are about to remove the territory from ${what}.`)
            : t(`Vas a pasar ${what} a ${plan.toLabel}${carried(plan, locale)}.`, `You are about to move ${what} to ${plan.toLabel}${carried(plan, locale)}.`)}
        </p>
        {!territory && <p className="mt-2 text-[13px] text-muted">{t('CONTIGO no le avisa a nadie: avísale a quien los recibe antes de moverlos. El cambio queda en la bitácora con tu nombre.', 'CONTIGO does not notify anyone: tell whoever receives them before you move them. The change is logged with your name.')}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          {listHref && <Link href={listHref} className={buttonClass('quiet')} data-testid="reparto-list">{t('Ver la lista', 'See the list')}</Link>}
          <button type="button" className={buttonClass('ghost')} onClick={onCancel} data-testid="reparto-cancel">{t('Cancelar', 'Cancel')}</button>
          <button type="button" className={buttonClass('primary')} onClick={() => onConfirm(plan)} data-testid="reparto-go">
            {territory ? t(`Sí, cambiar ${fmt(plan.count, locale)}`, `Yes, change ${fmt(plan.count, locale)}`) : t(`Sí, pasar ${fmt(plan.count, locale)}`, `Yes, move ${fmt(plan.count, locale)}`)}
          </button>
        </div>
      </div>
    )
  }
  if (phase.name === 'running') {
    return (
      <div data-testid="reparto-running">
        <p role="status" className="text-[15px] font-medium text-strong">{t(`Van ${fmt(phase.done, locale)} de ${fmt(phase.total, locale)}. Deja esta pantalla abierta.`, `${fmt(phase.done, locale)} of ${fmt(phase.total, locale)} so far. Keep this screen open.`)}</p>
        <progress className="mt-3 block h-2 w-full" value={phase.done} max={Math.max(phase.total, 1)} aria-label={t('Avance del reparto', 'Distribution progress')} />
        <div className="mt-3 flex justify-end"><button type="button" className={buttonClass('ghost')} onClick={onStop} data-testid="reparto-stop">{t('Detener', 'Stop')}</button></div>
      </div>
    )
  }
  if (phase.name === 'done') {
    const { plan } = phase
    const moved = noun(plan.payload.what, phase.done, locale)
    const territory = plan.payload.what === 'territory'
    return (
      <div data-testid="reparto-done">
        <p role="status" className="rounded-[10px] bg-green-100 px-4 py-3 text-[15px] font-medium text-brand-text">
          {territory
            ? plan.payload.to
              ? t(`Listo. ${moved} ${plural(phase.done, 'quedó', 'quedaron')} en el territorio ${plan.toLabel}.`, `Done. ${moved} ${plural(phase.done, 'is', 'are')} now in the territory ${plan.toLabel}.`)
              : t(`Listo. ${moved} ${plural(phase.done, 'quedó', 'quedaron')} sin territorio.`, `Done. ${moved} ${plural(phase.done, 'has', 'have')} no territory now.`)
            : t(`Listo. ${moved} ${plural(phase.done, 'pasó', 'pasaron')} a ${plan.toLabel}${carried({ payload: plan.payload }, locale)}.`, `Done. ${moved} moved to ${plan.toLabel}${carried({ payload: plan.payload }, locale)}.`)}
          {phase.left > 0 && <span className="mt-1 block font-normal" data-testid="reparto-left">{t(`Quedan ${fmt(phase.left, locale)} por mover con esta selección.`, `${fmt(phase.left, locale)} are still left to move with this selection.`)}</span>}
        </p>
        <div className="mt-3 flex justify-end"><button type="button" className={buttonClass('ghost')} onClick={onCancel} data-testid="reparto-again">{phase.left > 0 ? t('Seguir', 'Continue') : t('Repartir más', 'Distribute more')}</button></div>
      </div>
    )
  }
  return null
}

function PeopleOptions({ people, locale }: { people: RepartoPerson[]; locale: Locale }) {
  const t = tr(locale)
  const groups = useMemo(() => {
    const out = new Map<string, RepartoPerson[]>()
    for (const p of people) {
      const key = p.mine ? t('Tu equipo', 'Your team') : p.team ?? t('Sin equipo', 'No team')
      out.set(key, [...(out.get(key) ?? []), p])
    }
    return [...out.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, locale])
  if (groups.length <= 1) return <>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</>
  return <>{groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</optgroup>)}</>
}

const ROW = 'input[type="checkbox"][data-reparto-row]'

// Las casillas viven en el DOM de la lista (las pinta el servidor). La barra las lee como un almacén externo:
// se entera cuando alguien marca una y cuando ella misma las limpia.
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())
function subscribe(fn: () => void) {
  listeners.add(fn)
  document.addEventListener('change', fn)
  return () => {
    listeners.delete(fn)
    document.removeEventListener('change', fn)
  }
}
/** "filas|id,id,id": un texto, para que React compare por valor. */
function snapshot(): string {
  const all = [...document.querySelectorAll<HTMLInputElement>(ROW)]
  return `${all.length}|${all.filter((el) => el.checked).map((el) => el.value).join(',')}`
}
const setRows = (on: boolean) => {
  document.querySelectorAll<HTMLInputElement>(ROW).forEach((el) => (el.checked = on))
  notify()
}
const clearRows = () => setRows(false)

/**
 * Barra de reparto de la lista de Comercios. Las casillas de cada fila son del servidor (no dependen de esta barra para
 * pintarse); aquí se cuentan, se elige a quién van o qué territorio llevan, y se mueve la selección o todo el filtro.
 */
export function RepartoBar({ locale, market, filter, narrowed, total, people, territories, actions }: {
  locale: Locale
  /** Mercado en el que se reparte. Nulo cuando la persona ve varios y no ha elegido uno. */
  market: string | null
  filter: RepartoFilter
  /** El filtro acota algo además del mercado: sin eso no se ofrece "todos los de este filtro". */
  narrowed: boolean
  total: number
  people: RepartoPerson[]
  territories: RepartoTerritory[]
  actions: RepartoActions
}) {
  const t = tr(locale)
  const [scope, setScope] = useState<'sel' | 'all'>('sel')
  const [to, setTo] = useState('')
  const [territory, setTerritory] = useState('')
  const snap = useSyncExternalStore(subscribe, snapshot, () => '0|')
  const [rowCount, picked] = snap.split('|')
  const selected = useMemo(() => (picked ? picked.split(',') : []), [picked])
  const rows = Number(rowCount)
  const { phase, review, run, reset, halt } = useReparto(actions, clearRows)

  const canAll = narrowed && !!market && total > 0
  const all = scope === 'all' && canAll
  const count = all ? total : selected.length
  const start = (what: 'accounts' | 'territory') => {
    const target = what === 'accounts' ? to : territory
    const label = what === 'accounts' ? people.find((p) => p.id === to)?.full_name ?? '' : territories.find((x) => x.id === territory)?.name ?? ''
    const payload: RepartoPayload = all ? { what, filter: { ...filter, market: market ?? undefined }, to: target } : { what, ids: selected, to: target }
    void review(payload, label, all ? undefined : selected.length)
  }
  const none = count === 0

  return (
    <section className="card mt-4 p-4 md:p-5" aria-label={t('Repartir', 'Distribute')} data-testid="reparto-bar">
      {phase.name !== 'idle' ? (
        <Steps locale={locale} phase={phase} onConfirm={run} onCancel={reset} onStop={halt} />
      ) : (
        <>
          <fieldset>
            <legend className="text-[15px] font-semibold text-strong">{t('Qué quieres repartir', 'What you want to distribute')}</legend>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
              <label className="flex min-h-11 items-center gap-2 text-[14px] text-strong">
                <input type="radio" name="reparto-scope" className="h-4 w-4" checked={!all} onChange={() => setScope('sel')} data-testid="reparto-scope-sel" />
                <span data-testid="reparto-selected">{t(`Los que marque (${selected.length})`, `The ones I tick (${selected.length})`)}</span>
              </label>
              <label className={cx('flex min-h-11 items-center gap-2 text-[14px]', canAll ? 'text-strong' : 'text-muted')}>
                <input type="radio" name="reparto-scope" className="h-4 w-4" checked={all} disabled={!canAll} onChange={() => setScope('all')} data-testid="reparto-scope-all" />
                <span>{t(`Todos los de este filtro (${fmt(total, locale)})`, `Everything in this filter (${fmt(total, locale)})`)}</span>
              </label>
            </div>
            {!canAll && <p className="text-[13px] text-muted" data-testid="reparto-narrow">{!market ? t('Elige un mercado para repartir todo un filtro.', 'Choose a market to distribute a whole filter.') : t('Para repartir todo de una vez, filtra primero por dueño, región, ciudad o territorio.', 'To distribute everything at once, filter first by owner, region, city or territory.')}</p>}
            {!all && (
              <label className="mt-1 flex min-h-11 w-fit items-center gap-2 text-[14px] text-muted-2">
                <input type="checkbox" className="h-4 w-4" onChange={(e) => setRows(e.target.checked)} checked={selected.length > 0 && selected.length === rows} data-testid="reparto-page" />
                {t('Marcar los de esta página', 'Tick the ones on this page')}
              </label>
            )}
          </fieldset>
          <div className="mt-3 grid grid-cols-1 gap-4 border-t border-line pt-4 md:grid-cols-2">
            <div>
              <label className="block text-[13px] font-semibold text-muted-2" htmlFor="reparto-to">{t('Pasar a', 'Move to')}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <select id="reparto-to" className="input min-w-0 flex-1 basis-44" value={to} onChange={(e) => setTo(e.target.value)} data-testid="reparto-to">
                  <option value="">{t('Elige a una persona', 'Choose a person')}</option>
                  <PeopleOptions people={people} locale={locale} />
                </select>
                <button type="button" className={buttonClass('primary')} disabled={none || !to} onClick={() => start('accounts')} data-testid="reparto-assign">{t('Reasignar', 'Reassign')}</button>
              </div>
              <p className="mt-1.5 text-[12px] text-muted">{people.length === 0 ? t('No hay a quién pasarle en este mercado.', 'There is nobody to move them to in this market.') : t('Cada comercio se va con sus negocios y tareas abiertas.', 'Each merchant moves with its open deals and tasks.')}</p>
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-muted-2" htmlFor="reparto-territory">{t('Poner territorio', 'Set territory')}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <select id="reparto-territory" className="input min-w-0 flex-1 basis-44" value={territory} onChange={(e) => setTerritory(e.target.value)} data-testid="reparto-territory" disabled={territories.length === 0}>
                  <option value="">{territories.length === 0 ? t('Todavía no hay territorios', 'No territories yet') : t('Elige un territorio', 'Choose a territory')}</option>
                  {territories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <button type="button" className={buttonClass('ghost')} disabled={none || !territory} onClick={() => start('territory')} data-testid="reparto-set-territory">{t('Poner', 'Set')}</button>
              </div>
              <p className="mt-1.5 text-[12px] text-muted">{territories.length === 0 ? t('Los crea administración, en Administración, Territorios.', 'Administration creates them, under Administration, Territories.') : t('No cambia quién lleva el comercio.', 'It does not change who owns the merchant.')}</p>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

type What = 'accounts' | 'leads' | 'deals'

/**
 * "Reasignar cartera" de Mi equipo: de quién, qué parte (por región, ciudad o territorio) y a quién. También pasa solo
 * los leads abiertos o solo los negocios abiertos de una persona, sin mover sus comercios.
 */
export function RepartoForm({ locale, markets, holders, regions, territories, people, actions }: {
  locale: Locale
  markets: { code: string; name: string }[]
  holders: RepartoHolder[]
  regions: RepartoRegion[]
  territories: RepartoTerritory[]
  people: RepartoPerson[]
  actions: RepartoActions
}) {
  const t = tr(locale)
  const [what, setWhat] = useState<What>('accounts')
  const [market, setMarket] = useState(markets[0]?.code ?? '')
  const [from, setFrom] = useState('vacant')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [territory, setTerritory] = useState('')
  const [to, setTo] = useState('')
  const { phase, review, run, reset, halt } = useReparto(actions)

  const n = (h: RepartoHolder) => (what === 'accounts' ? h.accounts : what === 'leads' ? h.leads : h.deals)
  const inMarket = holders.filter((h) => h.market_code === market && n(h) > 0)
  const nobody = inMarket.find((h) => h.owner_id === null)
  const vacantTotal = inMarket.filter((h) => !h.current).reduce((a, h) => a + n(h), 0)
  const named = inMarket.filter((h) => h.owner_id !== null).sort((a, b) => Number(a.current) - Number(b.current) || n(b) - n(a))
  const targets = people.filter((p) => p.market_code === market)
  const tag = (h: RepartoHolder) => (h.is_active === false ? t(' (inactiva)', ' (inactive)') : !h.current ? t(' (sin rol de ventas)', ' (no sales role)') : '')
  const filter: RepartoFilter = { market, owner: from, region: region || undefined, city: city.trim() || undefined, territory: territory || undefined }
  const listHref = what === 'accounts' ? `/comercios?${new URLSearchParams(Object.entries({ ...filter, repartir: '1' }).filter((e): e is [string, string] => !!e[1])).toString()}` : undefined

  const pick = (w: What) => {
    setWhat(w)
    setFrom('vacant')
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const label = targets.find((p) => p.id === to)?.full_name ?? ''
    void review(what === 'accounts' ? { what, filter, to } : { what, market, from, to }, label)
  }
  const WHAT: { key: What; label: string; hint: string }[] = [
    { key: 'accounts', label: t('Comercios', 'Merchants'), hint: t('Con sus negocios y tareas abiertas.', 'With their open deals and tasks.') },
    { key: 'leads', label: t('Leads abiertos', 'Open leads'), hint: t('Por ejemplo, cuando alguien sale.', 'For example, when someone leaves.') },
    { key: 'deals', label: t('Negocios abiertos', 'Open deals'), hint: t('El comercio se queda con quien lo lleva.', 'The merchant stays with its owner.') },
  ]

  if (phase.name !== 'idle') return <Steps locale={locale} phase={phase} onConfirm={run} onCancel={reset} onStop={halt} listHref={phase.name === 'confirm' ? listHref : undefined} />
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="reparto-form">
      <fieldset>
        <legend className="mb-2 block text-[13px] font-semibold text-muted-2">{t('Qué quieres pasar', 'What you want to move')}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {WHAT.map((w) => (
            <label key={w.key} className={cx('flex min-h-11 cursor-pointer items-start gap-2 rounded-[10px] border px-3 py-2.5', what === w.key ? 'border-green-600 bg-green-50' : 'border-line')}>
              <input type="radio" name="reparto-what" className="mt-1 h-4 w-4 shrink-0" checked={what === w.key} onChange={() => pick(w.key)} data-testid={`reparto-what-${w.key}`} />
              <span><span className="block text-[14px] font-semibold text-strong">{w.label}</span><span className="block text-[12px] text-muted">{w.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {markets.length > 1 && (
        <label className="block"><span className="mb-2 block text-[13px] font-semibold text-muted-2">{t('Mercado', 'Market')}</span>
          <select className="input" value={market} onChange={(e) => { setMarket(e.target.value); setFrom('vacant'); setRegion(''); setTerritory(''); setTo('') }} data-testid="reparto-market">{markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
        </label>
      )}
      <label className="block"><span className="mb-2 block text-[13px] font-semibold text-muted-2">{t('De', 'From')}</span>
        <select className="input" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="reparto-from">
          <option value="vacant">{t(`Todo lo que no tiene dueño vigente (${fmt(vacantTotal, locale)})`, `Everything with no current owner (${fmt(vacantTotal, locale)})`)}</option>
          {nobody && <option value="none">{t(`Sin dueño (${fmt(n(nobody), locale)})`, `No owner (${fmt(n(nobody), locale)})`)}</option>}
          {named.map((h) => <option key={h.owner_id} value={h.owner_id!}>{h.full_name}{tag(h)} ({fmt(n(h), locale)})</option>)}
        </select>
        <span className="mt-1.5 block text-[12px] text-muted">{t('Sin dueño vigente: no tiene dueño, o su dueño es una cuenta de servicio o alguien que ya no vende ni opera en este mercado.', 'No current owner: it has no owner, or its owner is a service account or someone who no longer sells or runs operations in this market.')}</span>
      </label>
      {what === 'accounts' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block"><span className="mb-2 block text-[13px] font-semibold text-muted-2">{t('Región o estado', 'Region or state')}</span>
            <select className="input" value={region} onChange={(e) => setRegion(e.target.value)} data-testid="reparto-region"><option value="">{t('Todas', 'All')}</option>{regions.filter((r) => r.market_code === market).map((r) => <option key={r.region} value={r.region}>{r.region} ({fmt(r.accounts, locale)})</option>)}</select>
          </label>
          <label className="block"><span className="mb-2 block text-[13px] font-semibold text-muted-2">{t('Ciudad o localidad', 'City or town')}</span>
            <input className="input" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} placeholder={t('Escribe una ciudad', 'Type a city')} data-testid="reparto-city" />
          </label>
          <label className="block"><span className="mb-2 block text-[13px] font-semibold text-muted-2">{t('Territorio', 'Territory')}</span>
            <select className="input" value={territory} onChange={(e) => setTerritory(e.target.value)} data-testid="reparto-form-territory"><option value="">{t('Todos', 'All')}</option><option value="none">{t('Sin territorio', 'No territory')}</option>{territories.filter((x) => x.market_code === market).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
        </div>
      )}
      <label className="block"><span className="mb-2 block text-[13px] font-semibold text-muted-2">{t('A', 'To')}</span>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)} required data-testid="reparto-form-to">
          <option value="">{t('Elige a una persona', 'Choose a person')}</option>
          <PeopleOptions people={targets} locale={locale} />
        </select>
      </label>
      <div className="flex justify-end"><button type="submit" className={buttonClass('primary')} disabled={!to} data-testid="reparto-review">{t('Ver cuántos son', 'See how many')}</button></div>
    </form>
  )
}
