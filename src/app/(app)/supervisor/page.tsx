import Link from 'next/link'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { requireCtx, systemCtx } from '@/server/context'
import { getLeadWatch, getSupervisorBoard, teamPeople, track, type RepRow } from '@/dal/boards'
import { teamsWithoutSupervisor } from '@/dal/b2b'
import { ROLE_LABEL, rolesIn } from '@/domain/policy'
import { getRepartoSources } from '@/dal/reparto'
import { getReportOptions, getWeeklyResults } from '@/dal/reports'
import { ensureRulesFresh, EXCEPTION_KINDS } from '@/domain/rules'
import { Badge, Card, CardTitle, Empty, LinkButton, PageHeader, Pills, NoData, shown } from '@/ui/kit'
import { Def } from '@/ui/report'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { RepartoForm } from '@/ui/reparto'
import { NavSelect } from '@/ui/board'
import { ago, day, num, pct } from '@/lib/format'
import { holderName, holdsText } from '@/lib/reparto-text'
import { EXCEPTION, MOTOR, lab, qs } from '@/lib/labels'
import { addStreetSellerAction, runRulesAction, updateStreetSellerAction } from './actions'
import { streetSellers, streetSummary } from '@/dal/street'
import { dismissExceptionAction } from '@/app/(app)/actividades/log-actions'
import { ConfirmButton } from '@/ui/confirm'
import { repartoPreviewAction, repartoStepAction } from '@/app/(app)/reparto-actions'
import { flat } from '@/server/params'

/** Columnas de la tabla del equipo. En pantallas angostas cada persona se lee como tarjeta, con el nombre arriba y cada cifra con su etiqueta. */
const COLS: [es: string, en: string][] = [
  ['Persona', 'Person'], ['Leads abiertos', 'Open leads'], ['Primer intento a tiempo', 'First attempt on time'], ['Contacto logrado', 'Reached'], ['Negocios abiertos', 'Open deals'],
  ['Sin próximo paso', 'No next step'], ['Revisitas', 'Revisits'], ['Esperando venta', 'Awaiting sale'], ['Visitas / con venta', 'Visits / with sale'], ['Ventas, 30 días', 'Sales, 30 days'], ['Cartera', 'Book'],
]
// La columna de negocios abiertos es más ancha: lleva la marca de estancados junto a la cifra.
const ROW = '@5xl:grid @5xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_minmax(0,1.15fr)_minmax(0,1.1fr)_minmax(0,0.75fr)] @5xl:items-center @5xl:gap-3'
const WEEK = '@2xl:grid @2xl:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))] @2xl:items-center @2xl:gap-4'
// Marca compacta dentro de una celda angosta de la tabla (más chica que un Badge, para que quepa en su columna).
const CHIP = 'inline-flex items-center rounded-full px-1.5 py-0.5 text-[12px] leading-4 font-medium whitespace-nowrap'
const CARD = 'grid grid-cols-2 gap-x-6 gap-y-1.5 @md:grid-cols-3'

export default async function SupervisorPage({ searchParams }: { searchParams: Promise<{ market?: string; kind?: string; owner?: string; equipo?: string }> }) {
  const ctx = await requireCtx()
  // Operaciones entra solo a la cola de avisos de sus mercados: el tablero del equipo de ventas es de quien supervisa o lidera.
  const teamView = ctx.can('board.supervisor')
  if (!teamView && !ctx.can('exception.read')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  await ensureRulesFresh(await systemCtx())
  const options = await getReportOptions(ctx)
  const teamOptions = options.teams.filter((x) => !sp.market || x.market_code === sp.market)
  const team = sp.equipo === 'none' ? 'none' : teamOptions.some((x) => x.id === sp.equipo) ? sp.equipo : undefined
  const board = await getSupervisorBoard(ctx, { ...sp, team })
  // Uso real (Adopción): cuenta que quien supervisa abrió el tablero de su equipo, no que entró a CONTIGO.
  if (teamView) await track(ctx, 'view.supervisor')
  const canReport = teamView && ctx.can('report.view')
  const weeks = canReport ? await getWeeklyResults(ctx, { market: sp.market, team }) : []
  const live = ctx.markets.filter((m) => m.status === 'live')
  // Vendedores de calle: catálogo y resumen por la persona que lleva la cartera.
  const [street, streetRows] = teamView ? await Promise.all([streetSellers(ctx, sp.market), streetSummary(ctx)]) : [[], []]
  const streetMarkets = live.filter((m) => ctx.can('street.manage', m.code) && (!sp.market || m.code === sp.market))
  const streetByOwner: { key: string; owner: string | null; rows: typeof streetRows }[] = []
  for (const r of streetRows.filter((x) => !sp.market || x.market_code === sp.market)) {
    const key = `${r.market_code}:${r.owner_id ?? 'none'}`
    let g = streetByOwner.find((x) => x.key === key)
    if (!g) streetByOwner.push((g = { key, owner: r.owner_name, rows: [] }))
    g.rows.push(r)
  }
  const canReassign = ctx.can('account.reassign', sp.market)
  const sources = canReassign ? await getRepartoSources(ctx) : null
  // Lo que nadie atiende: sin dueño, o a nombre de una cuenta de servicio o de alguien que ya no vende ni opera en ese mercado.
  const vacantAll = (sources?.holders ?? []).filter((h) => !h.current && (!sp.market || h.market_code === sp.market) && h.accounts + h.deals + h.leads > 0)
  // Con un equipo elegido, "Por repartir" trae solo lo que quedó a nombre de alguien que estuvo en ese equipo. Lo que no tiene dueño no es de ningún equipo.
  const inTeam = team && vacantAll.length > 0 ? await teamPeople(ctx, team) : null
  const vacant = inTeam ? vacantAll.filter((h) => h.owner_id && inTeam.has(h.owner_id)) : vacantAll
  const vacantHidden = vacantAll.length - vacant.length
  // La guardia de leads: meta corriendo y sin intento, con los minutos hábiles que quedan.
  const watch = teamView ? await getLeadWatch(ctx, { market: sp.market, team }) : []
  // Un equipo sin supervisión lo cubre quien lidera el mercado: se le dice aquí, que es la pantalla que sí ve.
  const leads = (code: string) => rolesIn(ctx.memberships, code).some((r) => r === 'market_lead' || r === 'admin')
  const uncovered = teamView ? (await teamsWithoutSupervisor(ctx)).filter((x) => leads(x.market_code) && (!sp.market || x.market_code === sp.market) && live.some((m) => m.code === x.market_code)) : []
  const left = (mins: number) => (mins < 90 ? t(`Quedan ${mins} min hábiles`, `${mins} business min left`) : t(`Quedan ${Math.round(mins / 60)} h hábiles`, `${Math.round(mins / 60)} business h left`))
  const totalOpen = Object.values(board.byKind).reduce((a, b) => a + b, 0)
  const link = (patch: Record<string, string | undefined>) => qs('/supervisor', { market: sp.market, kind: sp.kind, owner: sp.owner, equipo: team, ...patch })
  const href = (e: (typeof board.queue)[number]) => (e.deal_id ? `/deals/${e.deal_id}` : e.lead_id ? `/leads/${e.lead_id}` : e.account_id ? `/comercios/${e.account_id}` : '/admin?tab=integraciones')

  // Por equipo, con subtotal. Quien no tiene equipo va en su propio grupo, al final de su mercado.
  const groups: { key: string; name: string; rows: RepRow[] }[] = []
  for (const r of board.reps) {
    const key = `${r.market_code}:${r.team_id ?? 'none'}`
    let g = groups.find((x) => x.key === key)
    if (!g) groups.push((g = { key, name: `${r.team ?? t('Sin equipo', 'No team')}${live.length > 1 ? ` · ${r.market_code}` : ''}`, rows: [] }))
    g.rows.push(r)
  }
  const tot = (rows: RepRow[], k: 'leads_open' | 'sla_met' | 'sla_judged' | 'reached' | 'deals_open' | 'no_next_step' | 'revisits' | 'awaiting' | 'visits_7d' | 'sales_7d' | 'accounts') => rows.reduce((n, r) => n + r[k], 0)
  const asOf = board.metricsAsOf
  const salesHint: [string, string] = asOf
    ? [`Ventas, 30 días: transacciones de su cartera en los últimos 30 días al ${day(asOf, locale)}, según el archivo diario de ventas; la variación compara con los 30 días anteriores solo cuando ese dato existe.`, `Sales, 30 days: transactions across their book in the last 30 days to ${day(asOf, locale)}, per the daily sales file; the change compares with the previous 30 days only when that data exists.`]
    : ['Ventas, 30 días: todavía no llega ningún archivo diario de ventas.', 'Sales, 30 days: no daily sales file has arrived yet.']
  const sales = (r: RepRow) => {
    if (r.txn_30d === null) return <NoData locale={locale} />
    const delta = r.txn_prev_30d && r.txn_cmp_30d !== null ? Math.round(((r.txn_cmp_30d - r.txn_prev_30d) / r.txn_prev_30d) * 100) : null
    return <>{num(r.txn_30d, locale)}{delta !== null && <span className="text-muted" data-testid="rep-sales-delta"> ({delta > 0 ? '+' : ''}{delta}%)</span>}</>
  }
  const cell = (i: number, value: ReactNode, strong = false) => (
    <span className={`num flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[14px] @5xl:justify-start ${strong ? 'font-semibold' : ''}`}>
      <span className="text-[12.5px] font-normal text-muted @5xl:hidden">{t(COLS[i + 1]![0], COLS[i + 1]![1])}</span>
      <span className="inline-flex min-w-0 flex-wrap items-baseline gap-1.5">{shown(value)}</span>
    </span>
  )

  return (
    <>
      <PageHeader
        title={teamView ? t('Mi equipo', 'My team') : t('Avisos del mercado', 'Market alerts')}
        desc={teamView ? t('El equipo de un vistazo y lo que quedó pendiente de atender. Sale de lo que cada quien ya registra: las visitas se capturan en CONTIGO hasta que se conecte la Sales App.', 'The team at a glance and what still needs attention. It comes from what each person already logs: visits are entered in CONTIGO until the Sales App is connected.') : t('Lo que quedó pendiente de atender en tus mercados.', 'What still needs attention in your markets.')}
        actions={<>
          {canReport && <LinkButton href={qs('/reportes/cerrados', { mercado: sp.market, equipo: team })} testId="team-closed-link">{t('Negocios cerrados', 'Closed deals')}</LinkButton>}
          {canReport && <LinkButton href={qs('/reportes/campo', { mercado: sp.market, equipo: team })} variant="quiet" testId="team-field-link">{t('Reporte de campo', 'Field report')}</LinkButton>}
          {ctx.can('rules.run') && <ActionForm action={runRulesAction}><Submit variant="ghost" testId="run-rules">{t('Actualizar avisos', 'Refresh alerts')}</Submit></ActionForm>}
        </>}
      />
      {live.length > 1 && (
        <div className="mb-6">
          <Pills label={t('Mercado', 'Market')} current={sp.market ?? ''} items={[{ key: '', href: link({ market: undefined, equipo: undefined }), label: t('Todos', 'All') }, ...live.map((m) => ({ key: m.code, href: link({ market: m.code, equipo: undefined }), label: m.name }))]} />
        </div>
      )}
      {teamView && teamOptions.length > 1 && (
        <div className="mb-6" data-testid="team-filter">
          <NavSelect label={t('Equipo', 'Team')} value={link({})} testId="team-select"
            options={[{ href: link({ equipo: undefined }), label: t('Todos los equipos', 'All teams') }, ...teamOptions.map((x) => ({ href: link({ equipo: x.id }), label: `${live.length > 1 && !sp.market ? `${x.market_code} · ` : ''}${x.name}` })), { href: link({ equipo: 'none' }), label: t('Sin equipo', 'No team') }]} />
        </div>
      )}

      {uncovered.length > 0 && (
        <div className="mb-6 rounded-[14px] bg-warn-bg px-5 py-4 text-[14px] text-strong" role="status" data-testid="team-uncovered">
          <ul className="space-y-1">
            {uncovered.map((x) => (
              <li key={x.id} data-testid="team-uncovered-row">
                <strong>{live.length > 1 ? `${x.market_code} · ` : ''}{x.name}</strong>{': '}
                {t('Sin supervisión: lo cubre quien lidera el mercado', 'No supervisor: whoever leads the market covers it')}
                {x.lead ? ` (${x.lead})` : ''}{'. '}
                {t('Sus pendientes y su guardia de leads se revisan en esta pantalla, con el equipo elegido.', 'Its alerts and its lead watch are reviewed on this screen, with the team selected.')}{' '}
                <Link href={link({ equipo: x.id, market: sp.market })} className="font-medium text-blue-text underline" data-testid="team-uncovered-link">{t('Ver este equipo', 'See this team')}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {teamView && (
        <Card className="mb-8" data-testid="lead-watch-card">
          <CardTitle
            title={t('Guardia de leads', 'Lead watch')}
            hint={t('Leads con la meta de primer contacto corriendo, o ya vencida, y sin ningún intento. Los minutos se cuentan en el horario hábil del mercado. CONTIGO no avisa por correo ni por Slack: esta lista es para hacer la guardia.', 'Leads with the first-contact goal running, or already past, and no attempt yet. Minutes are counted in the market’s business hours. CONTIGO does not alert by email or Slack: this list is for keeping watch.')}
            right={<Badge tone={watch.length ? 'warn' : 'good'}>{t(`${watch.length}${watch.length === 25 ? '+' : ''} sin intento`, `${watch.length}${watch.length === 25 ? '+' : ''} with no attempt`)}</Badge>}
          />
          {watch.length === 0 ? <Empty title={t('Ningún lead esperando el primer intento', 'No lead waiting for a first attempt')} /> : (
            <ul>
              {watch.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-line py-3 first:border-t-0" data-testid="watch-row" data-late={l.late ? '1' : '0'}>
                  <Link href={`/leads/${l.id}`} className="min-w-0 flex-1 basis-[240px]">
                    <span className="block text-[14.5px] font-semibold text-strong [overflow-wrap:anywhere]">{l.business_name}</span>
                    <span className="mt-0.5 block text-[13px] text-muted-2">{[l.owner_name ?? t('Sin asignar: lo puede tomar cualquiera que venda', 'No owner: anyone who sells can take it'), lab(t, MOTOR[l.motor]) || null, live.length > 1 ? l.market_code : null, t(`llegó ${ago(l.created_at, locale)}`, `arrived ${ago(l.created_at, locale)}`)].filter(Boolean).join(' · ')}</span>
                  </Link>
                  {l.escalation_level > 0 && <span className={`${CHIP} bg-surface-3 text-strong`} data-testid="watch-escalated" data-level={l.escalation_level}>{l.escalation_level === 1 ? t('Avisado a supervisión', 'Supervisor notified') : t('Avisado a quien lidera', 'Market lead notified')}</span>}
                  <span className={`${CHIP} ${l.late ? 'bg-risk-bg text-red-text' : 'bg-warn-bg text-amber-text'}`} data-testid="watch-left">{l.late ? t('Pasó la meta', 'Past the goal') : left(l.minutes_left)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {teamView && <Card pad={false} data-testid="team-board">
        <div className="px-5 pt-6 md:px-7 md:pt-7">
          <CardTitle
            title={t('Equipo', 'Team')}
            hint={t(`Todas las personas que venden en tu alcance, por equipo y con subtotal. Leads de los últimos 14 días. Primer intento a tiempo: se intentó el contacto dentro del plazo. Contacto logrado: se habló con la persona. Visitas: últimos 7 días, las registradas en CONTIGO y las que lleguen de la Sales App, sin contar dos veces la misma. ${salesHint[0]}`, `Everyone who sells in your scope, by team and with a subtotal. Leads from the last 14 days. First attempt on time: contact was attempted within the deadline. Reached: the person was spoken to. Visits: last 7 days, the ones logged in CONTIGO and the ones that arrive from the Sales App, never counting the same one twice. ${salesHint[1]}`)}
          />
        </div>
        {board.reps.length === 0 ? <div className="p-7"><Empty title={t('Sin vendedores en tu alcance', 'No sales reps in your scope')} /></div> : (
          <div className="@container" data-testid="rep-table">
            <div aria-hidden className={`hidden border-y border-line px-7 py-2.5 text-[12px] leading-4 font-medium text-muted ${ROW}`} data-testid="rep-head">
              {COLS.map((c) => <span key={c[1]}>{t(c[0], c[1])}</span>)}
            </div>
            {groups.map((g) => (
              <section key={g.key} data-testid="team-group" aria-label={g.name}>
                <h3 className="border-b border-line bg-surface-3 px-5 py-2 text-[13px] font-semibold text-strong @5xl:px-7" data-testid="team-name">{g.name}</h3>
                <ul className="divide-y divide-line">
                  {g.rows.map((r) => (
                    <li key={`${r.id}-${r.market_code}`} className={`row-hover px-5 py-3.5 @5xl:px-7 ${CARD} ${ROW}`} data-testid="rep-row">
                      <span className="col-span-2 mb-1 block min-w-0 @5xl:col-span-1 @5xl:mb-0"><span className="block text-[15px] font-semibold text-strong [overflow-wrap:anywhere]" data-testid="rep-name">{r.full_name}</span><span className="text-[12.5px] text-muted-2">{[r.role === 'rep' ? null : t(ROLE_LABEL[r.role].es, ROLE_LABEL[r.role].en), r.team, r.market_code].filter(Boolean).join(' · ')}</span></span>
                      {cell(0, <>{r.leads_open}{r.leads_overdue > 0 && <span className={`${CHIP} bg-risk-bg text-red-text`}>{t(`${r.leads_overdue} tarde`, `${r.leads_overdue} late`)}</span>}</>)}
                      {cell(1, <span data-testid="rep-attempt">{shown(pct(r.sla_met, r.sla_judged, locale))}</span>)}
                      {cell(2, <span data-testid="rep-reached">{shown(pct(r.reached, r.sla_judged, locale))}</span>)}
                      {cell(3, <>{r.deals_open}{r.stalled > 0 && <span className={`${CHIP} bg-warn-bg text-amber-text`}>{t(`${r.stalled} estancados`, `${r.stalled} stalled`)}</span>}</>)}
                      {cell(4, r.no_next_step > 0 ? <Badge tone="bad">{r.no_next_step}</Badge> : 0)}
                      {cell(5, r.revisits > 0 ? <Badge tone="warn">{r.revisits}</Badge> : 0)}
                      {cell(6, r.awaiting)}
                      {cell(7, <span data-testid="rep-visits">{r.visits_7d} / {r.sales_7d}{r.visits_7d > 0 && <span className="text-muted"> ({pct(r.sales_7d, r.visits_7d, locale)})</span>}</span>)}
                      {cell(8, <span data-testid="rep-sales">{sales(r)}</span>)}
                      {cell(9, <Link href={qs('/comercios', { owner: r.id, market: r.market_code })} className="text-blue-text underline">{r.accounts}</Link>)}
                    </li>
                  ))}
                </ul>
                {(groups.length > 1 || g.rows.length > 1) && (
                  <div className={`border-t border-line-2 px-5 py-3 text-strong @5xl:px-7 ${CARD} ${ROW}`} data-testid="team-subtotal">
                    <span className="col-span-2 mb-1 block text-[13.5px] font-semibold @5xl:col-span-1 @5xl:mb-0">{t(`Subtotal · ${g.rows.length} ${g.rows.length === 1 ? 'persona' : 'personas'}`, `Subtotal · ${g.rows.length} ${g.rows.length === 1 ? 'person' : 'people'}`)}</span>
                    {cell(0, tot(g.rows, 'leads_open'), true)}
                    {cell(1, pct(tot(g.rows, 'sla_met'), tot(g.rows, 'sla_judged'), locale), true)}
                    {cell(2, pct(tot(g.rows, 'reached'), tot(g.rows, 'sla_judged'), locale), true)}
                    {cell(3, tot(g.rows, 'deals_open'), true)}
                    {cell(4, tot(g.rows, 'no_next_step'), true)}
                    {cell(5, tot(g.rows, 'revisits'), true)}
                    {cell(6, tot(g.rows, 'awaiting'), true)}
                    {cell(7, `${tot(g.rows, 'visits_7d')} / ${tot(g.rows, 'sales_7d')}`, true)}
                    {cell(8, g.rows.some((r) => r.txn_30d !== null) ? num(g.rows.reduce((n, r) => n + (r.txn_30d ?? 0), 0), locale) : <NoData locale={locale} />, true)}
                    {cell(9, <span data-testid="subtotal-accounts">{tot(g.rows, 'accounts')}</span>, true)}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
        {/* Las cifras de la tabla usan las mismas definiciones del Panel y de Reportes (lib/metric-defs.ts). */}
        {board.reps.length > 0 && (
          <div className="grid gap-x-6 border-t border-line px-5 py-3 sm:grid-cols-2 md:px-7" data-testid="team-defs">
            {(['attempt', 'reached', 'open', 'noNextStep', 'revisits', 'awaiting'] as const).map((k) => <Def key={k} t={t} k={k} named testId={`team-def-${k}`} />)}
          </div>
        )}
        {sources && sources.markets.length > 0 && (
          <div className="border-t border-line px-7 py-5">
            <Dialog trigger={t('Reasignar cartera', 'Reassign book')} title={t('Reasignar cartera', 'Reassign book')} testId="reassign-book">
              <RepartoForm locale={locale} markets={sp.market ? sources.markets.filter((m) => m.code === sp.market) : sources.markets} holders={sources.holders} regions={sources.regions} territories={sources.territories} people={sources.people} actions={{ preview: repartoPreviewAction, step: repartoStepAction }} />
            </Dialog>
          </div>
        )}
      </Card>}

      {canReport && (
        <Card className="mt-8 @container" pad={false} data-testid="team-weeks">
          <div className="px-5 pt-6 md:px-7 md:pt-7">
            <CardTitle title={t('Resultados por semana', 'Results by week')} hint={t('Las últimas 8 semanas, de lunes a domingo, en la zona horaria del mercado. Ganados y perdidos por su fecha de cierre, visitas por el día de la visita y altas por el día en que se creó el punto de venta. La semana en curso va incompleta.', 'The last 8 weeks, Monday to Sunday, in the market’s time zone. Won and lost by close date, visits by the day of the visit and enrollments by the day the store was created. The current week is still incomplete.')} />
          </div>
          <div aria-hidden className={`hidden border-y border-line px-7 py-2.5 text-[13px] font-medium text-muted ${WEEK}`}>
            <span>{t('Semana del', 'Week of')}</span><span>{t('Ganados', 'Won')}</span><span>{t('Perdidos', 'Lost')}</span><span>{t('Visitas', 'Visits')}</span><span>{t('Con venta', 'With a sale')}</span><span>{t('Altas', 'Enrolled')}</span>
          </div>
          <ul className="divide-y divide-line">
            {weeks.map((w, i) => (
              <li key={w.week} className={`grid grid-cols-2 gap-x-6 gap-y-1 px-5 py-3 @2xl:px-7 ${WEEK}`} data-testid="week-row">
                <span className="col-span-2 block text-[14.5px] font-semibold text-strong @2xl:col-span-1">{day(w.week, locale)}{i === 0 ? <span className="ml-2 text-[12.5px] font-normal text-muted">{t('en curso', 'in progress')}</span> : null}</span>
                {([[t('Ganados', 'Won'), w.won, 'week-won'], [t('Perdidos', 'Lost'), w.lost, 'week-lost'], [t('Visitas', 'Visits'), w.visits, 'week-visits'], [t('Con venta', 'With a sale'), w.sales, 'week-sales'], [t('Altas', 'Enrolled'), w.stores, 'week-stores']] as [string, number, string][]).map(([label, v, id]) => (
                  <span key={id} className="num flex justify-between gap-2 text-[14px] text-strong @2xl:block"><span className="text-[12.5px] text-muted @2xl:hidden">{label}</span><span data-testid={id}>{num(v, locale)}</span></span>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {teamView && (
        <Card className="mt-8" data-testid="street-block">
          <CardTitle
            title={t('Vendedores de calle', 'Street sellers')}
            hint={t('Quienes visitan tiendas sin ser usuarios de CONTIGO, bajo la persona que lleva la cartera. Visitas de los últimos 7 días y tiendas distintas visitadas en 30 días, según "¿Quién visitó?" en cada visita.', 'The people who visit stores without being CONTIGO users, under the person who owns the book. Visits in the last 7 days and distinct stores visited in 30 days, from "Who visited?" on each visit.')}
          />
          {streetMarkets.length > 0 && (
            <div className="mb-4">
              <Dialog trigger={t('Agregar vendedor de calle', 'Add street seller')} title={t('Agregar vendedor de calle', 'Add street seller')} testId="street-add">
                <ActionForm action={addStreetSellerAction} onOk="close">
                  {streetMarkets.length > 1
                    ? <label className="block text-[14px] font-medium">{t('Mercado', 'Market')}<select name="market" className="input mt-1.5" defaultValue={streetMarkets[0]!.code}>{streetMarkets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></label>
                    : <input type="hidden" name="market" value={streetMarkets[0]!.code} />}
                  <label className="mt-4 block text-[14px] font-medium">{t('Nombre', 'Name')}<input name="name" required minLength={2} maxLength={80} className="input mt-1.5" data-testid="street-name" /></label>
                  <label className="mt-4 block text-[14px] font-medium">{t('Responde a', 'Reports to')}
                    <select name="reports_to" className="input mt-1.5" defaultValue="" data-testid="street-reports">
                      <option value="">{t('Sin definir', 'Not set')}</option>
                      {board.reps.filter((r) => streetMarkets.some((m) => m.code === r.market_code)).map((r) => <option key={`${r.id}${r.market_code}`} value={r.id}>{r.full_name}{streetMarkets.length > 1 ? ` · ${r.market_code}` : ''}</option>)}
                    </select>
                  </label>
                  <div className="mt-5 flex justify-end"><Submit testId="street-save">{t('Agregar', 'Add')}</Submit></div>
                </ActionForm>
              </Dialog>
            </div>
          )}
          {streetByOwner.length === 0 ? <Empty title={t('Todavía no hay vendedores de calle', 'No street sellers yet')} hint={t('Agrégalos aquí, o aparecerán solos cuando alguien escriba su nombre al registrar una visita.', 'Add them here, or they will show up on their own when someone writes their name while logging a visit.')} /> : (
            <ul>
              {streetByOwner.map((g) => (
                <li key={g.key} className="border-t border-line py-3.5 first:border-t-0" data-testid="street-owner">
                  <p className="text-[14.5px] font-semibold text-strong">{g.owner ?? t('Sin persona de ventas', 'No salesperson')}</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {g.rows.map((r) => {
                      const entry = street.find((x) => x.market_code === r.market_code && x.name.toLowerCase() === r.name.toLowerCase())
                      return (
                        <li key={r.name} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[14px]" data-testid="street-row">
                          <span className="min-w-0 flex-1 basis-[160px] text-strong [overflow-wrap:anywhere]"><Link href={qs('/comercios', { visito: r.name, market: r.market_code })} className="underline-offset-2 hover:underline" data-testid="street-link">{r.name}</Link>{!r.listed && <span className="ml-2 text-[12.5px] text-muted">{t('fuera del catálogo', 'not in the list')}</span>}</span>
                          <span className="num min-w-0 max-w-full text-muted-2 [overflow-wrap:anywhere]" data-testid="street-numbers">{t(`${r.visits_7d} ${r.visits_7d === 1 ? 'visita' : 'visitas'}, ${r.sales_7d} con venta · ${r.stores_30d} ${r.stores_30d === 1 ? 'tienda' : 'tiendas'} en 30 días`, `${r.visits_7d} ${r.visits_7d === 1 ? 'visit' : 'visits'}, ${r.sales_7d} with a sale · ${r.stores_30d} ${r.stores_30d === 1 ? 'store' : 'stores'} in 30 days`)}</span>
                          {entry && ctx.can('street.manage', r.market_code) && (
                            <ConfirmButton action={updateStreetSellerAction} fields={{ id: entry.id, end: '1' }} label={t('Dar de baja', 'Remove')} title={t(`¿Dar de baja a ${r.name}?`, `Remove ${r.name}?`)}
                              body={t('Deja de sugerirse en "¿Quién visitó?". Sus visitas anteriores se conservan.', 'They stop being suggested under "Who visited?". Their earlier visits are kept.')}
                              confirm={t('Sí, dar de baja', 'Yes, remove')} cancel={t('Cancelar', 'Cancel')} variant="quiet" testId="street-end" />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {(vacant.length > 0 || vacantHidden > 0) && (
        <Card className="mt-8" data-testid="vacant-block">
          <CardTitle
            title={t('Por repartir', 'No current owner')}
            hint={t('Lo que nadie atiende hoy: no está asignado a nadie, o está a nombre de una cuenta de servicio o de alguien que ya no vende ni opera en este mercado. Repártelo por quién lo lleva, región, ciudad o territorio.', 'What nobody is working today: it has no owner, or it sits under a service account or someone who no longer sells or runs operations in this market. Distribute it by owner, region, city or territory.')}
          />
          <ul>
            {vacant.slice(0, 20).map((h) => (
              <li key={`${h.owner_id}${h.market_code}`} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-line py-4 first:border-t-0" data-testid="vacant-row">
                <div className="min-w-0 flex-1 basis-[260px]">
                  <p className="text-[15px] font-semibold text-strong [overflow-wrap:anywhere]">{holderName(t, h)}{live.length > 1 ? ` · ${h.market_code}` : ''}</p>
                  <p className="mt-0.5 text-[14px] text-muted-2" data-testid="vacant-holds">{holdsText(t, locale, h)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {h.leads > 0 && <LinkButton href={qs('/leads', { owner: h.owner_id ?? 'none', market: h.market_code, status: 'open' })} variant="quiet" testId="vacant-leads">{t('Ver sus leads', 'See the leads')}</LinkButton>}
                  {h.accounts > 0 && <LinkButton href={qs('/comercios', { owner: h.owner_id ?? 'none', market: h.market_code, repartir: '1' })} testId="vacant-go">{t('Repartir comercios', 'Distribute merchants')}</LinkButton>}
                </div>
              </li>
            ))}
          </ul>
          {vacantHidden > 0 && (
            <p className="mt-3 text-[13px] text-muted" data-testid="vacant-team-note">
              {t(`Con un equipo elegido sale solo lo que quedó a nombre de su gente. Hay ${vacantHidden} más que no son de este equipo.`, `With a team selected, only what was left under its people shows. There are ${vacantHidden} more that do not belong to this team.`)}{' '}
              <Link href={link({ equipo: undefined })} className="font-medium text-blue-text underline">{t('Ver todos los equipos', 'See all teams')}</Link>
            </p>
          )}
          {vacant.length > 20 && <p className="mt-3 text-[13px] text-muted">{t(`Y ${vacant.length - 20} más. Usa "Reasignar cartera" para verlos todos.`, `And ${vacant.length - 20} more. Use "Reassign book" to see them all.`)}</p>}
          <p className="mt-4 border-t border-line pt-4 text-[13px] text-muted">{t('Los leads y los negocios que no se van con un comercio se pasan desde "Reasignar cartera", arriba.', 'Leads and deals that do not move with a merchant are passed from "Reassign book", above.')}</p>
        </Card>
      )}

      <Card className={teamView ? 'mt-8' : undefined} data-testid="exception-queue">
        <CardTitle
          title={t('Pendientes del equipo', 'Team alerts')}
          hint={board.rulesAt ? t(`Actualizado ${ago(board.rulesAt, locale)}. Un pendiente se cierra solo cuando se corrige.`, `Updated ${ago(board.rulesAt, locale)}. An alert clears itself once it is fixed.`) : undefined}
          right={<span data-testid="exception-open"><Badge tone={totalOpen ? 'warn' : 'good'}><span data-testid="exception-total">{t(`${totalOpen} ${totalOpen === 1 ? 'pendiente abierto' : 'pendientes abiertos'}`, `${totalOpen} open ${totalOpen === 1 ? 'alert' : 'alerts'}`)}</span></Badge></span>}
        />
        <Pills
          label={t('Tipo', 'Type')}
          current={sp.kind ?? ''}
          items={[
            { key: '', href: link({ kind: undefined }), label: t('Todos', 'All'), count: totalOpen },
            ...EXCEPTION_KINDS.filter((k) => board.byKind[k]).map((k) => ({ key: k, href: link({ kind: k }), label: lab(t, EXCEPTION[k]?.label), count: board.byKind[k] })),
          ]}
        />
        {board.queue.length === 0 ? <div className="mt-6"><Empty title={t('Nada pendiente en el equipo', 'Nothing pending on the team')} /></div> : (
          <ul className="mt-5">
            {board.queue.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-line py-3.5 first:border-t-0" data-testid="exception-row">
                <Link href={href(e)} className="min-w-0 flex-1 basis-[240px]">
                  <span className="block truncate text-[14.5px] font-semibold text-strong">{String(e.detail.title ?? e.detail.name ?? e.detail.customer_id ?? '')}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted-2">{[lab(t, EXCEPTION[e.kind]?.label), e.owner_name ?? t('Sin asignar', 'No owner'), e.market_code, ago(e.opened_at, locale)].join(' · ')}</span>
                </Link>
                {e.kind === 'unowned_account' && e.account_id && ctx.can('account.reassign', e.market_code)
                  ? <LinkButton href={`/comercios/${e.account_id}?tab=datos`} size="sm" testId="exception-assign">{lab(t, EXCEPTION[e.kind]?.action)}</LinkButton>
                  : <span className={e.severity === 'high' ? 'text-[13px] font-medium text-red-text' : 'text-[13px] text-muted-2'} data-testid="exception-hint">{t('Qué hacer: ', 'What to do: ')}{lab(t, EXCEPTION[e.kind]?.action)}</span>}
                {ctx.can('exception.resolve', e.market_code) && (
                  <ConfirmButton
                    action={dismissExceptionAction}
                    fields={{ id: e.id }}
                    label={t('Descartar', 'Dismiss')}
                    title={t('¿Descartar este pendiente?', 'Dismiss this item?')}
                    body={t(`"${String(e.detail.title ?? e.detail.name ?? lab(t, EXCEPTION[e.kind]?.label))}" sale de la lista del equipo y no vuelve en 7 días, aunque siga sin corregirse. Queda registrado quién lo descartó.`, `"${String(e.detail.title ?? e.detail.name ?? lab(t, EXCEPTION[e.kind]?.label))}" leaves the team list and does not come back for 7 days, even if it is still not fixed. Who dismissed it stays on record.`)}
                    note={{ name: 'note', label: t('Motivo (opcional)', 'Reason (optional)') }}
                    confirm={t('Sí, descartar', 'Yes, dismiss')}
                    cancel={t('Cancelar', 'Cancel')}
                    variant="quiet"
                    testId="exception-dismiss"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
