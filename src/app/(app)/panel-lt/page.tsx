import { metricOwners } from '@/dal/reportes'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx, systemCtx } from '@/server/context'
import { getFxRates, getLeadershipPanel, marketPeriods, type PanelSlice, closeRules } from '@/dal/reports'
import { track } from '@/dal/boards'
import { ensureRulesFresh } from '@/domain/rules'
import { Bar, Card, CardTitle, Empty, LinkButton, PageHeader, NoData, shown } from '@/ui/kit'
import { Def, Metric, ReportFilters, fxSource, periodText } from '@/ui/report'
import { day, money, num, pct } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'

export default async function PanelLtPage({ searchParams }: { searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string; mercado?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('board.lt')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  await ensureRulesFresh(await systemCtx())
  const period = marketPeriods(ctx, sp.periodo, sp.desde, sp.hasta, '30d')
  const scope = ctx.markets.filter((m) => m.status === 'live' && ctx.can('board.lt', m.code))
  const market = scope.some((m) => m.code === sp.mercado) ? sp.mercado : undefined
  const [data, fx] = await Promise.all([getLeadershipPanel(ctx, period, market), getFxRates(ctx)])
  await track(ctx, 'view.panel-lt')
  // REP-01: cada indicador con su dueño; el que cargó administración manda sobre el dueño por defecto.
  const owners = await metricOwners(ctx)
  // Cómo cuenta un ganado depende de cómo está configurado cada embudo: a mano, o con la primera venta.
  const rules = await closeRules(ctx, market ? [market] : scope.map((m) => m.code))
  const wonRule = rules.byTransaction === 0
    ? t('Hoy todos los embudos se ganan a mano: un negocio cuenta como ganado cuando alguien lo marca, con su fecha de cierre.', 'Today every pipeline is won by hand: a deal counts as won when someone marks it, with its close date.')
    : rules.byHand === 0
      ? t('Un comercio cuenta como ganado cuando hace su primera venta, no cuando firma.', 'A merchant counts as won when it makes its first sale, not when it signs.')
      : t(`${rules.byTransaction} de ${rules.byTransaction + rules.byHand} embudos se ganan con la primera venta del comercio; los demás se ganan a mano.`, `${rules.byTransaction} of ${rules.byTransaction + rules.byHand} pipelines are won by the merchant’s first sale; the rest are won by hand.`)
  const params = { periodo: period.key, desde: period.key === 'rango' ? period.first.from : undefined, hasta: period.key === 'rango' ? period.first.to : undefined, mercado: market }
  const closed = (patch: Record<string, string | undefined>) => qs('/reportes/cerrados', { ...params, ...patch })

  if (data.markets.length === 0) return (<><PageHeader title={t('Panel del LT', 'Leadership panel')} /><Empty title={t('Sin mercados en tu alcance', 'No markets in your scope')} /></>)

  const sum = (k: 'accounts_active' | 'won' | 'lost' | 'awaiting_txn' | 'leads' | 'deals_open' | 'activation_risk' | 'sla_met' | 'sla_judged' | 'reached' | 'accounts_at_risk' | 'accounts_inactive') => data.markets.reduce((s, m) => s + m[k], 0)
  const asOf = data.markets.map((m) => m.as_of).filter(Boolean).sort()[0]
  const rate = (currency: string) => (currency === 'USD' ? 1 : fx.find((r) => r.currency === currency) ? Number(fx.find((r) => r.currency === currency)!.usd_rate) : null)
  const currencies = [...new Set(data.markets.map((m) => m.currency))]
  const missing = currencies.filter((c) => rate(c) === null)
  const used = fx.filter((r) => currencies.includes(r.currency))
  const totalUsd = missing.length ? null : data.markets.reduce((s, m) => s + Number(m.volume_30d) * rate(m.currency)!, 0)
  const maxReason = Math.max(1, ...data.reasons.map((r) => r.n))
  const maxNoSale = Math.max(1, ...data.noSale.map((r) => r.n))
  const when = periodText(t, locale, period.first)
  const multi = data.markets.length > 1
  const sliceGrid = '@2xl:grid @2xl:grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,1fr))] @2xl:items-center @2xl:gap-4'
  const lbl = '@2xl:hidden text-muted'

  const slices = (rows: PanelSlice[], kind: 'embudo' | 'equipo') => (
    <>
      <div aria-hidden className={`hidden border-y border-line px-7 py-2.5 text-[13px] font-medium text-muted ${sliceGrid}`}>
        <span>{kind === 'embudo' ? t('Embudo', 'Pipeline') : t('Equipo', 'Team')}</span><span>{t('Leads', 'Leads')}</span><span>{t('Abiertos hoy', 'Open today')}</span><span>{t('Esperando venta', 'Awaiting sale')}</span><span>{t('Ganados', 'Won')}</span><span>{t('Perdidos', 'Lost')}</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const name = kind === 'equipo' && !r.id ? t('Sin equipo', 'No team') : r.name
          const filter = kind === 'embudo' ? { embudo: r.id ?? undefined, mercado: r.market_code } : { equipo: r.id ?? 'none', mercado: r.market_code }
          return (
            <li key={r.key} className={`px-5 py-3.5 @2xl:px-7 ${sliceGrid}`} data-testid={`lt-${kind}-row`}>
              <span className="block text-[15px] font-semibold text-strong [overflow-wrap:anywhere]">{multi ? `${r.market_code} · ` : ''}{name}</span>
              <span className="num block text-[14px] text-strong"><span className={lbl}>{t('Leads: ', 'Leads: ')}</span>{num(r.leads, locale)}</span>
              <span className="num block text-[14px] text-strong"><span className={lbl}>{t('Abiertos hoy: ', 'Open today: ')}</span>{kind === 'embudo' && r.id ? <Link href={`/pipelines/${r.id}`} className="underline decoration-line-2 underline-offset-4">{num(r.deals_open, locale)}</Link> : num(r.deals_open, locale)}</span>
              <span className="num block text-[14px] text-strong"><span className={lbl}>{t('Esperando venta: ', 'Awaiting sale: ')}</span>{num(r.awaiting_txn, locale)}</span>
              <span className="num block text-[14px] text-strong"><span className={lbl}>{t('Ganados: ', 'Won: ')}</span><Link href={closed({ ...filter, resultado: 'won' })} className="underline decoration-line-2 underline-offset-4" data-testid={`lt-${kind}-won`}>{num(r.won, locale)}</Link></span>
              <span className="num block text-[14px] text-strong"><span className={lbl}>{t('Perdidos: ', 'Lost: ')}</span><Link href={closed({ ...filter, resultado: 'lost' })} className="underline decoration-line-2 underline-offset-4">{num(r.lost, locale)}</Link></span>
            </li>
          )
        })}
      </ul>
    </>
  )

  return (
    <>
      <PageHeader
        eyebrow={asOf ? t(`Ventas con corte al ${day(asOf, locale)} · archivo diario de ventas`, `Sales as of ${day(asOf, locale)} · daily sales file`) : undefined}
        title={t('Panel del LT', 'Leadership panel')}
        desc={<span data-testid="lt-won-rule">{t('Del lead a la primera venta, por mercado, por embudo y por equipo.', 'From lead to first sale, by market, by pipeline and by team.')} {wonRule}</span>}
        actions={<>
          <LinkButton href={closed({})} testId="lt-closed-link">{t('Negocios cerrados', 'Closed deals')}</LinkButton>
          <LinkButton href="/reportes/campo" variant="quiet" testId="lt-field-link">{t('Reporte de campo', 'Field report')}</LinkButton>
          {ctx.can('adoption.read') && <LinkButton href="/reportes/adopcion" variant="quiet" testId="lt-adoption-link">{t('Adopción', 'Adoption')}</LinkButton>}
        </>}
      />
      <ReportFilters t={t} locale={locale} base="/panel-lt" params={params} period={period.first}
        selects={[{ name: 'mercado', label: t('Mercado', 'Market'), all: t('Todos los mercados', 'All markets'), options: scope.length > 1 ? scope.map((m) => ({ value: m.code, label: m.name })) : [] }]} />

      <p className="mb-5 rounded-[14px] bg-surface-3 px-4 py-3 text-[13.5px] text-strong" data-testid="lt-windows">
        {t(`Este panel usa tres ventanas y cada bloque dice la suya: el periodo elegido (${when}), la foto de hoy, y los 30 días del archivo diario de ventas${asOf ? ` con corte al ${day(asOf, locale)}` : ''}. Por eso un ganado del periodo y un comercio activo de hoy no se restan entre sí.`,
          `This panel uses three windows and each block names its own: the chosen period (${when}), today’s snapshot, and the 30 days in the daily sales file${asOf ? ` as of ${day(asOf, locale)}` : ''}. That is why a win in the period and a merchant active today do not subtract from each other.`)}
      </p>

      <h2 className="mb-3 text-[15px] font-semibold text-strong">{t(`En el periodo: ${when}`, `In the period: ${when}`)}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="lt-kpis">
        <Metric t={t} owners={owners} k="leads" testId="lt-leads" value={num(sum('leads'), locale)} href={qs('/leads', { market, status: 'all', from: period.first.from, to: period.first.to })} />
        <Metric t={t} owners={owners} k="won" testId="lt-won" tone="good" value={num(sum('won'), locale)} href={closed({ resultado: 'won' })} />
        <Metric t={t} owners={owners} k="lost" testId="lt-lost" value={num(sum('lost'), locale)} href={closed({ resultado: 'lost' })} />
        <Metric t={t} owners={owners} k="attempt" testId="lt-attempt-all" value={pct(sum('sla_met'), sum('sla_judged'), locale)} hint={t(`${num(sum('sla_met'), locale)} de ${num(sum('sla_judged'), locale)} leads juzgados. Contacto logrado: ${pct(sum('reached'), sum('sla_judged'), locale)}.`, `${num(sum('sla_met'), locale)} of ${num(sum('sla_judged'), locale)} judged leads. Reached: ${pct(sum('reached'), sum('sla_judged'), locale)}.`)} />
      </div>

      <h2 className="mt-8 mb-3 text-[15px] font-semibold text-strong">{t('Hoy (foto de este momento)', 'Today (a snapshot of right now)')}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric t={t} owners={owners} k="active" testId="lt-active" value={num(sum('accounts_active'), locale)} href={qs('/comercios', { market, lifecycle: 'active' })} />
        <Metric t={t} owners={owners} k="open" testId="lt-open" value={num(sum('deals_open'), locale)} href="/pipelines" />
        <Metric t={t} owners={owners} k="awaiting" testId="lt-awaiting" tone={sum('activation_risk') ? 'warn' : undefined} value={num(sum('awaiting_txn'), locale)} hint={t(`${sum('activation_risk')} llevan más de 7 días`, `${sum('activation_risk')} past 7 days`)} />
        <Metric t={t} owners={owners} k="risk" testId="lt-risk" value={`${num(sum('accounts_at_risk'), locale)} / ${num(sum('accounts_inactive'), locale)}`} href={qs('/comercios', { market, ver: 'riesgo' })} />
      </div>

      <h2 className="mt-8 mb-3 text-[15px] font-semibold text-strong">{asOf ? t(`Ventas del archivo diario: 30 días al ${day(asOf, locale)}`, `Sales from the daily file: 30 days to ${day(asOf, locale)}`) : t('Ventas del archivo diario', 'Sales from the daily file')}</h2>
      <Card data-testid="lt-volume">
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div>
            <p className="text-[13px] font-medium text-muted-2">{t('Volumen consolidado (USD)', 'Consolidated volume (USD)')}</p>
            <p className="num mt-1.5 text-[26px] leading-9 font-semibold text-strong" data-testid="lt-volume-usd">{totalUsd === null ? <NoData locale={locale} /> : money(Math.round(totalUsd), 'USD', locale, true)}</p>
            {missing.length > 0 ? (
              <p className="mt-2 rounded-[12px] bg-warn-bg px-3.5 py-2.5 text-[13.5px] font-medium text-amber-text" data-testid="lt-fx-missing">
                {t(`No se consolida: falta la tasa de ${missing.join(', ')} a USD. Administración la carga en Administración, sección Embudos y campos.`, `Not consolidated: the ${missing.join(', ')} to USD rate is missing. Administration loads it in Administration, Pipelines and fields section.`)}
              </p>
            ) : used.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[13.5px] text-strong" data-testid="lt-fx">
                {used.map((r) => (
                  <li key={r.currency}>{t(`Tasa usada: 1 ${r.currency} = ${Number(r.usd_rate)} USD, con fecha del ${day(r.as_of, locale)}. Fuente: ${fxSource(t, r)}.`, `Rate used: 1 ${r.currency} = ${Number(r.usd_rate)} USD, dated ${day(r.as_of, locale)}. Source: ${fxSource(t, r)}.`)}</li>
                ))}
              </ul>
            ) : <p className="mt-2 text-[13.5px] text-muted" data-testid="lt-fx">{t('Todo el volumen ya está en USD: no se usa ninguna tasa.', 'All of the volume is already in USD: no rate is used.')}</p>}
            <Def t={t} owners={owners} k="volumeUsd" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-muted-2">{t('Por mercado, en su moneda', 'By market, in its own currency')}</p>
            <ul className="mt-1.5 divide-y divide-line">
              {data.markets.map((m) => (
                <li key={m.code} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-[14px]"><span className="text-muted-2">{m.name}</span><span className="num font-semibold text-strong">{money(Number(m.volume_30d), m.currency, locale, true)}{m.currency !== 'USD' && rate(m.currency) !== null ? ` · ${money(Math.round(Number(m.volume_30d) * rate(m.currency)!), 'USD', locale, true)}` : ''}</span></li>
              ))}
            </ul>
            <Def t={t} owners={owners} k="volume" />
          </div>
        </div>
      </Card>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {data.markets.map((m) => {
          const steps = [
            { k: t('Leads (periodo)', 'Leads (period)'), v: m.leads },
            { k: t('Calificados (periodo)', 'Qualified (period)'), v: m.leads_qualified },
            { k: t('Negocios abiertos (hoy)', 'Open deals (today)'), v: m.deals_open },
            { k: t('Esperando primera venta (hoy)', 'Awaiting first sale (today)'), v: m.awaiting_txn },
            { k: t('Ganados (periodo)', 'Won (period)'), v: m.won },
          ]
          const max = Math.max(1, ...steps.map((s) => s.v))
          return (
            <Card key={m.code} data-testid={`lt-market-${m.code}`}>
              <CardTitle title={m.name} hint={t(`Volumen 30 días: ${money(Number(m.volume_30d), m.currency, locale, true)}`, `Volume, 30 days: ${money(Number(m.volume_30d), m.currency, locale, true)}`)} />
              <ul className="space-y-3.5">
                {steps.map((s) => (
                  <li key={s.k} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_48px] items-center gap-3 md:grid-cols-[220px_1fr_56px] md:gap-4">
                    <span className="text-[13.5px] text-muted-2">{s.k}</span>
                    <Bar value={s.v} max={max} />
                    <span className="num text-right text-[14px] font-semibold text-strong">{num(s.v, locale)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-3">
                <div><dt className="text-[12.5px] text-muted">{t('Primer intento a tiempo', 'First attempt on time')}</dt><dd className="num mt-1 text-[20px] font-semibold text-strong" data-testid="lt-attempt">{shown(pct(m.sla_met, m.sla_judged, locale))}</dd></div>
                <div><dt className="text-[12.5px] text-muted">{t('Contacto logrado', 'Reached')}</dt><dd className="num mt-1 text-[20px] font-semibold text-strong" data-testid="lt-reached">{shown(pct(m.reached, m.sla_judged, locale))}</dd></div>
                <div><dt className="text-[12.5px] text-muted">{t('Días a la primera venta', 'Days to first sale')}</dt><dd className="num mt-1 text-[20px] font-semibold text-strong">{m.days_to_first_txn ?? t('Sin dato', 'No data')}</dd></div>
                <div><dt className="text-[12.5px] text-muted">{t('Perdidos (periodo)', 'Lost (period)')}</dt><dd className="num mt-1 text-[20px] font-semibold text-strong"><Link href={closed({ mercado: m.code, resultado: 'lost' })} className="underline decoration-line-2 underline-offset-4">{num(m.lost, locale)}</Link></dd></div>
                <div><dt className="text-[12.5px] text-muted">{t('Revisitas pendientes (hoy)', 'Pending revisits (today)')}</dt><dd className="num mt-1 text-[20px] font-semibold text-strong">{m.revisits}</dd></div>
                <div><dt className="text-[12.5px] text-muted">{t('En riesgo / inactivos (hoy)', 'At risk / inactive (today)')}</dt><dd className="num mt-1 text-[20px] font-semibold text-strong">{m.accounts_at_risk} / {m.accounts_inactive}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-x-5">
                <Def t={t} owners={owners} k="reached" testId={`def-reached-${m.code}`} named />
                <Def t={t} owners={owners} k="days" testId={`def-days-${m.code}`} named />
                <Def t={t} owners={owners} k="revisits" testId={`def-revisits-${m.code}`} named />
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="mt-6 @container" pad={false} data-testid="lt-by-pipeline">
        <div className="px-5 pt-5 @2xl:px-7 @2xl:pt-6"><CardTitle title={t('Por embudo', 'By pipeline')} hint={t(`Cada tipo de venta en su línea. Leads, ganados y perdidos: ${when}. Abiertos y esperando venta: hoy.`, `Each sale type on its own line. Leads, won and lost: ${when}. Open and awaiting sale: today.`)} /></div>
        {slices(data.pipelines, 'embudo')}
      </Card>
      <Card className="mt-6 @container" pad={false} data-testid="lt-by-team">
        <div className="px-5 pt-5 @2xl:px-7 @2xl:pt-6"><CardTitle title={t('Por equipo', 'By team')} hint={t('El equipo de quien lleva el lead o el negocio hoy. Lo que no está asignado, o lo lleva alguien sin equipo, va en "Sin equipo".', 'The team of whoever owns the lead or the deal today. Anything with no owner, or whose owner has no team, goes under "No team".')} /></div>
        {data.teams.length === 0 ? <p className="px-7 pb-6 text-[14px] text-muted">{t('Sin movimiento en el periodo.', 'No activity in the period.')}</p> : slices(data.teams, 'equipo')}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card data-testid="lt-loss">
          <CardTitle title={t('Por qué se pierden los negocios', 'Why deals are lost')} hint={t(`Perdidos ${when}. El motivo es obligatorio al cerrar como perdido.`, `Lost ${when}. A reason is required to close as lost.`)} />
          {data.reasons.length === 0 ? <p className="text-[14px] text-muted">{t('Ningún negocio perdido en el periodo.', 'No deals lost in the period.')}</p> : (
            <ul className="space-y-3">
              {data.reasons.map((r) => (
                <li key={`${r.market_code}${r.code}`} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_40px] items-center gap-3 md:grid-cols-[210px_1fr_40px] md:gap-4">
                  <span className="truncate text-[13.5px] text-muted-2">{t(r.label_es, r.label_en)} · {r.market_code}</span><Bar value={r.n} max={maxReason} tone="bad" /><span className="num text-right text-[14px] font-semibold">{r.n}</span>
                </li>
              ))}
            </ul>
          )}
          <Def t={t} owners={owners} k="lossReasons" />
        </Card>
        <Card data-testid="lt-nosale">
          <CardTitle title={t('Por qué una visita no termina en venta', 'Why a visit ends with no sale')} hint={t(`Motivos que captura la Sales App, ${when}.`, `Reasons captured by the Sales App, ${when}.`)} />
          {data.noSale.length === 0 ? <p className="text-[14px] text-muted">{t('Ninguna visita sin venta en el periodo.', 'No visits without a sale in the period.')}</p> : (
            <ul className="space-y-3">
              {data.noSale.map((r) => (
                <li key={r.code} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_40px] items-center gap-3 md:grid-cols-[210px_1fr_40px] md:gap-4">
                  <span className="truncate text-[13.5px] text-muted-2">{t(r.label_es, r.label_en)}</span><Bar value={r.n} max={maxNoSale} /><span className="num text-right text-[14px] font-semibold">{r.n}</span>
                </li>
              ))}
            </ul>
          )}
          <Def t={t} owners={owners} k="noSale" />
        </Card>
      </div>
    </>
  )
}
