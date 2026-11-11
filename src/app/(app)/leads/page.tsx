import Link from 'next/link'
import { Check } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { listLeads, type LeadListItem } from '@/dal/leads'
import { track } from '@/dal/boards'
import { resultOptions, sheetConfig } from '@/server/sheet'
import { Empty, Field, Pills, LinkButton, cx } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { LeadCall } from '@/ui/lead-call'
import { LEAD_STATUS, MOTOR, SOURCE, lab, qs } from '@/lib/labels'
import { createLeadAction, takeLeadAction } from './actions'
import { completeItemAction } from '@/app/(app)/hoy/actions'
import { flat } from '@/server/params'

/** Anillo de reloj: cuánto de la meta de primer contacto ya se consumió. Lleno y en rojo si se pasó; verde con palomita si ya hubo contacto. */
function Ring({ fraction, tone }: { fraction: number; tone: 'warn' | 'risk' | 'ok' | 'idle' }) {
  const r = 15
  const c = 2 * Math.PI * r
  const color = tone === 'risk' ? 'var(--cg-risk-text)' : tone === 'warn' ? 'var(--cg-health-idle)' : tone === 'ok' ? 'var(--cg-green-500)' : 'var(--cg-health-new)'
  return (
    <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden data-testid="lead-ring" data-tone={tone}>
      <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--cg-line-200)" strokeWidth="3" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0.04, fraction)))} />
      </svg>
      {tone === 'ok' && <Check size={16} strokeWidth={2.5} className="absolute text-green-600" />}
    </span>
  )
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ market?: string; status?: string; owner?: string; q?: string; before?: string }> }) {
  const ctx = await requireCtx()
  const { t, m } = ctx
  const sp = flat(await searchParams)
  const status = sp.status ?? 'open'
  const data = await listLeads(ctx, { ...sp, status: status === 'all' ? undefined : status })
  await track(ctx, 'view.leads')
  const live = ctx.markets.filter((x) => x.status === 'live')
  const link = (patch: Record<string, string | undefined>) => qs('/leads', { market: sp.market, status, owner: sp.owner, q: sp.q, ...patch, before: undefined })
  const now = new Date()
  const config = sheetConfig(ctx, now)
  const seg = (on: boolean) => cx('press inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium', on ? 'bg-ink text-white' : 'text-strong hover:bg-green-50')
  const span = (ms: number) => {
    const mins = Math.max(1, Math.round(Math.abs(ms) / 60000))
    return mins < 90 ? m('leads.minutes', { count: mins }) : mins < 48 * 60 ? m('leads.hours', { count: Math.round(mins / 60) }) : m('leads.days', { count: Math.round(mins / 1440) })
  }

  // Estado de primer contacto de un lead (handoff, sección 6): siempre con texto, nunca solo color.
  const state = (l: LeadListItem) => {
    const due = l.sla_due_at ? new Date(l.sla_due_at).getTime() : null
    const who = l.owner_name ?? m('leads.someone')
    if (l.status === 'new' && !l.first_touch_at) {
      const late = due !== null && due < now.getTime()
      const total = due !== null ? due - new Date(l.created_at).getTime() : 0
      return {
        waiting: true, late, ring: late ? ('risk' as const) : due === null ? ('idle' as const) : ('warn' as const), fraction: late || total <= 0 ? 1 : (now.getTime() - new Date(l.created_at).getTime()) / total,
        chip: late ? m('leads.state.late') : m('leads.state.waiting'), chipClass: late ? 'bg-risk-bg text-red-text' : 'bg-warn-bg text-amber-text',
        note: due === null ? '' : late ? m('leads.clock.late', { time: span(now.getTime() - due) }) : m('leads.clock.left', { time: span(due - now.getTime()) }),
      }
    }
    const onTime = l.first_touch_at && due !== null ? new Date(l.first_touch_at).getTime() <= due : null
    const note = onTime === null ? '' : onTime ? m('leads.clock.onTime') : m('leads.clock.lateTouch')
    if (l.status === 'new') return { waiting: false, late: false, ring: 'idle' as const, fraction: 1, chip: m('leads.state.attempted', { name: who }), chipClass: 'bg-surface-3 text-strong', note }
    if (l.status === 'contacted') return { waiting: false, late: false, ring: 'ok' as const, fraction: 1, chip: m('leads.state.contacted', { name: who }), chipClass: 'bg-green-100 text-brand-text', note }
    return { waiting: false, late: false, ring: l.status === 'disqualified' ? ('idle' as const) : ('ok' as const), fraction: 1, chip: lab(t, LEAD_STATUS[l.status]?.label), chipClass: l.status === 'disqualified' ? 'bg-surface-3 text-strong' : 'bg-green-100 text-brand-text', note }
  }
  const cols = '@3xl:grid @3xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_170px] @3xl:items-center @3xl:gap-4'

  return (
    <div className="@container">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-9 font-semibold">{m('leads.title')}</h1>
          <p className="mt-1 max-w-[640px] text-[15px] text-muted">{m('leads.subtitle')}</p>
        </div>
        {ctx.can('lead.create') && (
          <Dialog trigger={t('Nuevo lead', 'New lead')} title={t('Nuevo lead', 'New lead')} variant="primary" testId="new-lead" hash="nuevo">
            <ActionForm action={createLeadAction} className="grid grid-cols-2 gap-4">
              <Field label={t('Mercado', 'Market')}>
                <select name="market" className="input" defaultValue={live[0]?.code}>
                  {live.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                </select>
              </Field>
              <Field label={t('Tipo de negocio', 'Business type')}>
                <select name="motor" className="input">
                  {Object.entries(MOTOR).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}
                </select>
              </Field>
              <Field label={t('Nombre del negocio', 'Business name')} className="col-span-2"><input name="business_name" className="input" required minLength={2} /></Field>
              <Field label={t('Persona de contacto', 'Contact person')}><input name="contact_name" className="input" required minLength={2} /></Field>
              <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" /></Field>
              <Field label={t('Correo', 'Email')}><input name="email" type="email" className="input" /></Field>
              <Field label={t('Ciudad', 'City')}><input name="locality" className="input" /></Field>
              <div className="col-span-2 mt-2 flex justify-end"><Submit testId="save-lead">{t('Guardar lead', 'Save lead')}</Submit></div>
            </ActionForm>
          </Dialog>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pills
          label={t('Estado', 'Status')}
          current={status}
          items={[
            { key: 'open', href: link({ status: 'open' }), label: t('Abiertos', 'Open'), count: data.counts.open ?? 0 },
            { key: 'overdue', href: link({ status: 'overdue' }), label: m('leads.state.late'), count: data.counts.overdue ?? 0 },
            { key: 'new', href: link({ status: 'new' }), label: t('Nuevos', 'New'), count: data.counts.new ?? 0 },
            { key: 'qualified', href: link({ status: 'qualified' }), label: t('Calificados', 'Qualified'), count: data.counts.qualified ?? 0 },
            { key: 'converted', href: link({ status: 'converted' }), label: t('Convertidos', 'Converted'), count: data.counts.converted ?? 0 },
            { key: 'all', href: link({ status: 'all' }), label: t('Todos', 'All') },
          ]}
        />
        <nav aria-label={m('merchants.scope')} className="inline-flex rounded-full border border-line bg-surface p-1">
          <Link href={link({ owner: undefined })} aria-current={sp.owner !== 'me' ? 'page' : undefined} className={seg(sp.owner !== 'me')}>{m('merchants.scope.all')}</Link>
          <Link href={link({ owner: 'me' })} aria-current={sp.owner === 'me' ? 'page' : undefined} className={seg(sp.owner === 'me')} data-testid="pill-me">{m('merchants.scope.mine')}</Link>
        </nav>
      </div>

      <div className="card mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-6"><Empty title={m('leads.empty.title')} hint={m('leads.empty.body')} /></div>
        ) : (
          <>
            <div aria-hidden className={cx('hidden border-b border-line px-5 py-3 text-[13px] font-medium text-muted', cols)}>
              <span className="pl-12">{m('leads.col.lead')}</span><span>{m('leads.col.state')}</span><span>{m('leads.col.owner')}</span><span />
            </div>
            <ul className="divide-y divide-line" data-testid="lead-table">
              {data.items.map((l) => {
                const s = state(l)
                const mine = l.owner_id === ctx.user.id
                const canCall = s.waiting && !!l.phone && ctx.can('lead.work', l.market_code) && (mine || !l.owner_id)
                return (
                  <li key={l.id} className={cx('row-hover relative px-4 py-3.5 @3xl:px-5', cols)} data-testid="lead-row" data-state={s.waiting ? (s.late ? 'late' : 'waiting') : l.status}>
                    <div className="flex min-w-0 items-center gap-3">
                      <Ring fraction={s.fraction} tone={s.ring} />
                      <span className="min-w-0">
                        <Link href={`/leads/${l.id}`} className="block truncate text-[15px] leading-6 font-medium text-strong after:absolute after:inset-0">{l.business_name}</Link>
                        <span className="block truncate text-[13px] text-muted">{[l.contact_name, l.locality, ctx.markets.length > 1 ? l.market_code : null, lab(t, SOURCE[l.source])].filter(Boolean).join(' · ')}</span>
                      </span>
                    </div>
                    <div className="mt-2 min-w-0 pl-12 @3xl:mt-0 @3xl:pl-0">
                      <span className={cx('inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-[13px] font-medium', s.chipClass)} data-testid="lead-state">{s.chip}</span>
                      {l.duplicate_of && <span className="ml-1.5 inline-flex rounded-full bg-warn-bg px-2.5 py-0.5 text-[13px] font-medium text-amber-text">{m('leads.dup')}</span>}
                      {s.note && <span className={cx('mt-0.5 block text-[13px]', s.late ? 'font-medium text-red-text' : 'text-muted')} data-testid="lead-clock-text">{s.note}</span>}
                    </div>
                    <div className={cx('hidden truncate text-[15px] @3xl:block', l.owner_name ? 'text-strong' : 'text-amber-text')} data-testid="lead-owner-cell">{l.owner_name ?? m('leads.noOwner')}</div>
                    <div className="mt-3 flex pl-12 @3xl:mt-0 @3xl:justify-end @3xl:pl-0">
                      {canCall && (
                        <LeadCall
                          item={{ type: 'lead', id: l.id, title: m('action.callOf', { name: l.business_name }), name: l.business_name, results: resultOptions(ctx, ['reached', 'no_answer']), defaultResult: null }}
                          tel={`tel:${l.phone}`}
                          take={!l.owner_id}
                          label={l.owner_id ? m('action.call') : m('leads.takeAndCall')}
                          takeAction={takeLeadAction}
                          config={config}
                          completeAction={completeItemAction}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
      {data.next && <div className="mt-5 flex justify-center"><LinkButton href={qs('/leads', { market: sp.market, status, owner: sp.owner, q: sp.q, before: data.next })} testId="more">{m('merchants.more')}</LinkButton></div>}
    </div>
  )
}
