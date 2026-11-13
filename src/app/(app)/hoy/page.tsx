import Link from 'next/link'
import { requireCtx, systemCtx } from '@/server/context'
import { track } from '@/dal/boards'
import { getQueue, getTeamQueue, QUEUE_PAGE, type QueueRow } from '@/dal/queue'
import { ensureRulesFresh } from '@/domain/rules'
import { resultOptions, sheetConfig, taskResults } from '@/server/sheet'
import { ago, clock, daysSince, longDay, weekday } from '@/lib/format'
import type { MessageKey } from '@/lib/messages'
import { cx } from '@/ui/kit'
import { CountUp, Queue, type QueueItem, type QueueLabels } from '@/ui/queue'
import { completeItemAction } from './actions'
import { getOnboarding } from '@/domain/onboarding'
import { Ring } from '@/ui/showcase/charts'
import { hideOnboardingAction } from '@/app/(app)/bienvenida/actions'
import { flat } from '@/server/params'
import { myNotices } from '@/dal/ops'
import { noticeSeenAction } from '@/app/(app)/operaciones/actions'
import { ActionForm, Submit } from '@/ui/client'
import { getSupervisorBoard } from '@/dal/boards'

/** Las tareas con fecha pero sin hora se guardan a esta hora UTC: no se muestran como una hora real. */
const DATE_ONLY = 'T15:00:00.000Z'

export default async function HoyPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const ctx = await requireCtx()
  const { m, t, locale } = ctx
  const leads = ctx.can('board.supervisor')
  const team = leads && flat(await searchParams).ver === 'equipo'
  await ensureRulesFresh(await systemCtx())
  await track(ctx, team ? 'view.hoy.equipo' : 'view.hoy')
  const tz = ctx.markets[0]?.timezone ?? 'UTC'
  const now = new Date()

  const scope = leads ? (
    <nav aria-label={m('today.scope')} className="inline-flex rounded-full border border-line bg-surface p-1" data-testid="scope">
      {[
        { href: '/hoy', label: m('today.me'), on: !team, id: 'scope-me' },
        { href: '/hoy?ver=equipo', label: m('today.team'), on: team, id: 'scope-team' },
      ].map((s) => (
        <Link key={s.id} href={s.href} aria-current={s.on ? 'page' : undefined} data-testid={s.id} className={cx('press inline-flex h-9 items-center rounded-full px-4 text-[14px] font-medium', s.on ? 'bg-ink text-white' : 'text-strong hover:bg-green-50')}>
          {s.label}
        </Link>
      ))}
    </nav>
  ) : null

  const header = (title: string, value: number, sub: string, id: string) => (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow first-letter:uppercase">{m('today.date', { date: longDay(now, locale, tz) })}</p>
        <h1 className="num mt-1 text-[28px] leading-9 font-semibold" data-testid="today-title">
          <CountUp value={value} text={title} id={id} />
        </h1>
        {sub && <p className="mt-1 text-[15px] text-muted" data-testid="today-breakdown">{sub}</p>}
      </div>
      {scope}
    </header>
  )

  if (team) {
    const rows = (await getTeamQueue(ctx)).sort((a, b) => b.late - a.late || b.leads_waiting - a.leads_waiting || b.cold - a.cold)
    const need = rows.filter((r) => r.late > 2 || r.leads_waiting > 0).length
    const first = (name: string) => name.split(' ')[0]!
    const hint = (r: (typeof rows)[number]) =>
      r.late > 2 ? m('team.hint.late', { name: first(r.full_name) }) : r.leads_waiting > 0 ? m('team.hint.leads') : r.cold > 0 ? m('team.hint.cold') : m('team.hint.ok')
    const cell = 'num text-[15px] md:text-right'
    return (
      <>
        {header(m('team.attention', { count: need }), need, `${m('team.count', { count: rows.length })} · ${m('team.coldNote')}`, 'equipo')}
        {rows.length === 0 ? (
          <div className="card px-8 py-12 text-center text-[15px] text-muted" data-testid="team-empty">{m('team.empty')}</div>
        ) : (
          <div className="card overflow-hidden" data-testid="team-table">
            <div aria-hidden className="hidden grid-cols-[minmax(0,1.4fr)_96px_140px_120px_minmax(0,1.6fr)] gap-4 border-b border-line px-5 py-3 text-[13px] font-medium text-muted md:grid">
              <span>{m('team.person')}</span>
              <span className="text-right">{m('team.late')}</span>
              <span className="text-right">{m('team.leads')}</span>
              <span className="text-right">{m('team.cold')}</span>
              <span>{m('team.hint')}</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} data-testid="team-row">
                  <Link href={r.late <= 2 && r.leads_waiting > 0 ? `/leads?owner=${r.id}&status=new&market=${r.market_code}` : `/supervisor?owner=${r.id}`} data-testid="team-row-link" className="row-hover grid grid-cols-3 gap-x-4 gap-y-2 px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_96px_140px_120px_minmax(0,1.6fr)] md:items-center md:px-5">
                    <span className="col-span-3 min-w-0 md:col-span-1">
                      <span className="block truncate text-[15px] font-medium text-strong">{r.full_name}</span>
                      <span className="block text-[13px] text-muted">{r.market_code}</span>
                    </span>
                    <span className={cell}>
                      <span className="block text-[13px] text-muted md:hidden">{m('team.late')}</span>
                      <span className={cx('inline-flex min-w-8 justify-center rounded-full px-2.5 py-0.5 font-medium', r.late > 2 ? 'bg-risk-bg text-red-text' : 'text-strong')} data-testid="team-late" data-risk={r.late > 2 ? '' : undefined}>{r.late}</span>
                    </span>
                    <span className={cell}>
                      <span className="block text-[13px] text-muted md:hidden">{m('team.leads')}</span>
                      <span className={cx('inline-flex min-w-8 justify-center rounded-full px-2.5 py-0.5 font-medium', r.leads_waiting > 0 ? 'bg-warn-bg text-amber-text' : 'text-strong')}>{r.leads_waiting}</span>
                    </span>
                    <span className={cell}>
                      <span className="block text-[13px] text-muted md:hidden">{m('team.cold')}</span>
                      <span className="inline-flex min-w-8 justify-center px-2.5 py-0.5 font-medium text-strong">{r.cold}</span>
                    </span>
                    <span className="col-span-3 text-[14px] text-muted-2 md:col-span-1">{hint(r)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    )
  }

  const [q, ob, notices] = await Promise.all([getQueue(ctx), getOnboarding(ctx), myNotices(ctx)])
  const href = (r: QueueRow) => (r.type === 'lead' ? `/leads/${r.id}` : r.dealId ? `/deals/${r.dealId}` : r.accountId ? `/comercios/${r.accountId}` : r.leadId ? `/leads/${r.leadId}` : r.type === 'suggestion' ? '/supervisor' : '/actividades')

  const view = (r: QueueRow): QueueItem => {
    const name = r.name ?? r.subject
    const base = { key: `${r.type}:${r.id}`, type: r.type, id: r.id, group: r.group, name, href: href(r), tel: r.phone ? `tel:${r.phone}` : null, wa: r.phone ? `https://wa.me/${r.phone.slice(1)}` : null, clock: null as string | null, motor: r.motor }
    if (r.type === 'lead')
      return {
        ...base,
        title: m('action.callOf', { name }),
        context: `${m(r.kind === 'web_form' ? 'ctx.leadSource.web_form' : 'ctx.leadSource.other')} ${r.market} · ${m('ctx.arrived', { ago: ago(r.created, locale, now) })}`,
        chip: r.group === 'late' ? { text: m('today.chip.late'), tone: 'risk' } : { text: m('today.chip.today'), tone: 'warn' },
        clock: r.due ? r.due.toISOString() : null,
        results: resultOptions(ctx, ['reached', 'no_answer']),
        defaultResult: null,
      }
    if (r.type === 'suggestion')
      return {
        ...base,
        title: m(`suggest.${r.kind}` as MessageKey, { name }),
        context: m(`ctx.${r.kind}` as MessageKey, { days: r.detail.since ? daysSince(String(r.detail.since), now) : 0 }),
        chip: { text: m('today.chip.suggested'), tone: 'suggested' },
        results: resultOptions(ctx, ['done', 'reached', 'no_answer', 'later']),
        defaultResult: 'done',
        closable: false,
      }
    const timed = r.due && !r.due.toISOString().endsWith(DATE_ONLY)
    const parts = [
      r.name && !r.subject.toLowerCase().includes(r.name.toLowerCase()) ? r.name : null,
      r.group === 'late' && r.due ? m('ctx.task.late', { date: weekday(r.due, locale, tz) }) : null,
      r.stage ? m('ctx.task.stage', { stage: r.stage }) : null,
    ].filter(Boolean)
    return {
      ...base,
      title: r.subject,
      context: parts.join(' · '),
      chip:
        r.group === 'late'
          ? { text: m('today.chip.late'), tone: 'risk' }
          : !r.due
            ? { text: m('today.chip.noDate'), tone: 'warn' }
            : timed
              ? { text: clock(r.due, locale, tz), tone: r.due < now ? 'warn' : 'neutral' }
              : { text: m('today.chip.today'), tone: 'neutral' },
      ...taskResults(ctx, r.kind),
    }
  }

  // Orden de urgencia: lead con reloj > vencidos > hoy por hora > sugeridos. El primero es la tarjeta "Ahora".
  const rank = (r: QueueRow) => (r.type === 'lead' ? 0 : r.group === 'late' ? 1 : r.group === 'today' ? 2 : 3)
  const far = 8.64e15
  const items = q.rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || (a.r.due?.getTime() ?? far) - (b.r.due?.getTime() ?? far) || a.i - b.i)
    .map(({ r }) => view(r))

  const total = q.counts.late + q.counts.today + q.counts.suggested
  // Quien supervisa y no tiene pendientes propios no lee "Todo al día": se le dice cuántos tiene su equipo, con enlace.
  const teamOpen = total === 0 && q.rows.length === 0 && ctx.memberships.some((x) => x.role === 'supervisor' || x.role === 'market_lead')
    ? Object.values((await getSupervisorBoard(ctx, {})).byKind).reduce((a, b) => a + b, 0) : null
  // "Todo al día" solo cuando tampoco el equipo tiene pendientes; si los tiene, el título y la tarjeta dicen que lo propio está al día.
  const teamBusy = teamOpen !== null && teamOpen > 0
  const ownClear = t('No tienes pendientes propios', 'Nothing of your own to do')
  const shown = { late: 0, today: 0, suggested: 0 }
  for (const i of items) shown[i.group]++
  const more = (g: keyof typeof shown) => (q.counts[g] > shown[g] && shown[g] >= QUEUE_PAGE ? m('today.more', { count: q.counts[g] - shown[g] }) : null)
  const breakdown = [
    q.counts.late ? m('today.breakdown.late', { count: q.counts.late }) : null,
    q.counts.today ? m('today.breakdown.today', { count: q.counts.today }) : null,
    q.counts.suggested ? m('today.breakdown.suggested', { count: q.counts.suggested }) : null,
  ].filter(Boolean)

  const labels: QueueLabels = {
    now: m('today.now'), call: m('action.call'), whatsapp: m('action.whatsapp'), open: m('action.open'), done: m('action.done'), markDone: m('action.markDone'), noPhone: m('action.noPhone'),
    completeOf: m('action.completeOf', { title: '%s' }), callOf: m('action.callOf', { name: '%s' }), whatsappOf: m('action.whatsappOf', { name: '%s' }),
    clock: m('today.leadClock', { time: '%s' }), clockLate: m('today.leadClockLate', { time: '%s' }),
    more: { late: more('late'), today: more('today'), suggested: q.backlog > 0 ? m('today.backlog', { count: q.backlog }) : null },
    groups: { late: m('today.group.late'), today: m('today.group.today'), suggested: m('today.group.suggested') },
    emptyTitle: teamBusy ? ownClear : m('today.empty.title'),
    emptyBody: !teamBusy ? m('today.empty.body') : t(`Tu equipo tiene ${teamOpen} ${teamOpen === 1 ? 'pendiente abierto' : 'pendientes abiertos'}.`, `Your team has ${teamOpen} open ${teamOpen === 1 ? 'alert' : 'alerts'}.`),
    emptyLink: teamOpen ? { href: '/supervisor', label: t('Ver los pendientes de mi equipo', 'See my team’s alerts') } : null, backlogLink: m('today.backlogLink'),
  }

  return (
    <>
      {header(teamBusy ? ownClear : m('today.pending', { count: total }), total, breakdown.join(' · '), 'hoy')}
      {!ob.hidden && ob.pending > 0 && (
        <aside className="card mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 pr-3 pl-3.5" data-testid="hoy-onboarding">
          <Ring id="sc-ring-hoy" value={((ob.total - ob.pending) / ob.total) * 100} size={44} stroke={13} track="var(--cg-line-200)" from="#3ddc97" to="#24815f">
            <span className="num text-[13px] font-semibold text-strong" aria-hidden>{ob.total - ob.pending}</span>
          </Ring>
          <p className="min-w-[180px] flex-1 text-[14.5px] text-strong">
            <span className="font-semibold">{t('Tus primeros pasos', 'Your first steps')}</span>
            <span className="text-muted-2"> · {t(`${ob.total - ob.pending} de ${ob.total} hechos`, `${ob.total - ob.pending} of ${ob.total} done`)}</span>
          </p>
          <Link href="/bienvenida" className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-green-100 px-4 text-[14.5px] font-semibold text-brand-text hover:bg-[#cfeede]" data-testid="hoy-onboarding-open">{t('Continuar', 'Continue')}</Link>
          <form action={hideOnboardingAction}>
            <button className="inline-flex min-h-11 items-center rounded-full px-3 text-[14.5px] font-medium text-muted-2 underline hover:text-strong" data-testid="hoy-onboarding-hide">{t('Esconder', 'Hide')}</button>
          </form>
        </aside>
      )}
      {notices.length > 0 && (
        <section aria-label={t('Avisos', 'Notices')} className="card mb-6 divide-y divide-line overflow-hidden" data-testid="hoy-notices">
          <h2 className="px-4 py-3 text-[15px] font-semibold text-strong">{t(`Te avisaron (${notices.length})`, `You were notified (${notices.length})`)}</h2>
          {notices.map((n) => (
            <div key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="hoy-notice">
              <p className="min-w-[200px] flex-1 text-[14.5px] text-strong">
                <span className="font-semibold">{n.title ?? n.from_name}</span>{n.record ? <span className="text-muted-2"> · {n.record}</span> : null}
                <span className="block text-muted-2">{n.body}</span>
              </p>
              <Link href={n.link ?? (n.deal_id ? `/deals/${n.deal_id}` : n.account_id ? `/comercios/${n.account_id}` : '/avisos')} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="hoy-notice-open">{t('Abrir', 'Open')}</Link>
              {/* Un anuncio con acuse se confirma en Anuncios: "Visto" no cuenta como acuse. */}
              {n.kind !== 'announcement' && (
                <ActionForm action={noticeSeenAction}>
                  <input type="hidden" name="notice_id" value={n.id} />
                  <Submit variant="ghost" size="sm" testId="hoy-notice-seen">{t('Visto', 'Seen')}</Submit>
                </ActionForm>
              )}
            </div>
          ))}
        </section>
      )}
      <Queue items={items} counts={q.counts} labels={labels} sheet={sheetConfig(ctx, now)} now={now.toISOString()} action={completeItemAction} />
      <p className="mt-8 text-[14px]"><Link href="/actividades" className="font-medium text-blue-text underline" data-testid="all-activities">{m('today.all')}</Link></p>
    </>
  )
}
