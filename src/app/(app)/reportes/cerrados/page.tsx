import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getClosedDeals, getReportOptions, marketPeriods, reportScope } from '@/dal/reports'
import { EXPORT_MAX } from '@/domain/reports'
import { track } from '@/dal/boards'
import { Badge, Card, CardTitle, Empty, PageHeader, NoData } from '@/ui/kit'
import { ExportLink, ReportFilters, periodText } from '@/ui/report'
import { day, money, noData, num } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { reportFilters, reportSelects, type ReportParams } from '../params'

const LIMIT = 100
const GRID = '@4xl:grid @4xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_104px_112px_minmax(0,1.1fr)] @4xl:items-center @4xl:gap-4'

export default async function ClosedDealsPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  const ctx = await requireCtx()
  // Quien vende entra a ver SUS cerrados; el resto de los reportes sigue siendo de supervisión, quien lidera y leadership.
  const own = !ctx.can('report.view')
  if (own && !ctx.can('report.own')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const period = marketPeriods(ctx, sp.periodo, sp.desde, sp.hasta, 'mes')
  const options = await getReportOptions(ctx, reportScope(ctx, own))
  const f = reportFilters(sp, options)
  const data = await getClosedDeals(ctx, period, f, LIMIT, own)
  await track(ctx, 'view.report.closed')
  const params = { periodo: period.key, desde: period.key === 'rango' ? period.first.from : undefined, hasta: period.key === 'rango' ? period.first.to : undefined, mercado: f.market, embudo: f.pipeline, equipo: f.team, persona: f.owner, resultado: f.result }
  const sel = reportSelects(t, options, f)
  const canExport = ctx.can('report.export', f.market)
  const sums = (status: 'won' | 'lost') => data.amounts.filter((a) => a.status === status)
  // Sin montos en el periodo, la marca de sin dato va con su explicación ("Sin dato"), igual que en las filas.
  const sumText = (status: 'won' | 'lost') => sums(status).map((a) => money(Number(a.amount), a.currency, locale)).join(' · ') || <NoData locale={locale} />
  const mobile = '@4xl:hidden text-muted'

  return (
    <>
      <PageHeader
        title={own ? t('Mis negocios cerrados', 'My closed deals') : t('Negocios cerrados', 'Closed deals')}
        desc={t('Ganados y perdidos por persona y periodo. La fecha de cierre es el día en la zona horaria del mercado. Los montos se suman por moneda, sin convertir.', 'Won and lost by person and period. The close date is the day in the market’s time zone. Amounts add up by currency, with no conversion.')}
        actions={canExport ? <ExportLink t={t} href={qs('/reportes/cerrados/export', params)}>{t('Exportar CSV', 'Export CSV')}</ExportLink> : undefined}
      />
      <ReportFilters t={t} locale={locale} base="/reportes/cerrados" params={params} period={period.first} selects={[sel.market, sel.pipeline, sel.team, sel.owner, sel.result]} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="closed-totals">
        <div className="card p-4 md:p-5"><p className="text-[13px] font-medium text-muted-2">{t('Ganados', 'Won')}</p><p className="num mt-1.5 text-[26px] leading-9 font-semibold text-brand-text" data-testid="closed-won">{num(data.won, locale)}</p></div>
        <div className="card p-4 md:p-5"><p className="text-[13px] font-medium text-muted-2">{t('Perdidos', 'Lost')}</p><p className="num mt-1.5 text-[26px] leading-9 font-semibold text-strong" data-testid="closed-lost">{num(data.lost, locale)}</p></div>
        <div className="card min-w-0 p-4 md:p-5"><p className="text-[13px] font-medium text-muted-2">{t('Monto ganado', 'Amount won')}</p><p className="num mt-1.5 text-[18px] leading-7 font-semibold text-strong [overflow-wrap:anywhere]" data-testid="closed-won-amount">{sumText('won')}</p><p className="mt-1 text-[12.5px] text-muted">{t('Solo negocios con monto capturado.', 'Only deals with an amount entered.')}</p></div>
        <div className="card min-w-0 p-4 md:p-5"><p className="text-[13px] font-medium text-muted-2">{t('Monto perdido', 'Amount lost')}</p><p className="num mt-1.5 text-[18px] leading-7 font-semibold text-strong [overflow-wrap:anywhere]">{sumText('lost')}</p><p className="mt-1 text-[12.5px] text-muted">{t('Solo negocios con monto capturado.', 'Only deals with an amount entered.')}</p></div>
      </div>

      {data.people.length > 0 && (
        <Card className="mt-6 @container" pad={false} data-testid="closed-people">
          <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por persona', 'By person')} hint={t(`Negocios cerrados ${periodText(t, locale, period.first)}, con los filtros de arriba.`, `Deals closed ${periodText(t, locale, period.first)}, with the filters above.`)} /></div>
          <div aria-hidden className="hidden border-y border-line px-7 py-2.5 text-[13px] font-medium text-muted @2xl:grid @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_90px_90px_minmax(0,1.4fr)] @2xl:gap-4">
            <span>{t('Persona', 'Person')}</span><span>{t('Equipo', 'Team')}</span><span>{t('Ganados', 'Won')}</span><span>{t('Perdidos', 'Lost')}</span><span>{t('Monto ganado', 'Amount won')}</span>
          </div>
          <ul className="divide-y divide-line">
            {data.people.map((p) => (
              <li key={`${p.owner_id}${p.market_code}`} className="px-5 py-3.5 @2xl:grid @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_90px_90px_minmax(0,1.4fr)] @2xl:items-center @2xl:gap-4 @2xl:px-7" data-testid="closed-person">
                <Link href={qs('/reportes/cerrados', { ...params, persona: p.owner_id ?? 'none', mercado: p.market_code })} className="block text-[15px] font-semibold text-strong underline decoration-line-2 underline-offset-4 [overflow-wrap:anywhere]">{p.owner_name ?? t('Sin asignar', 'No owner')}{options.markets.length > 1 ? ` · ${p.market_code}` : ''}</Link>
                <span className="block text-[14px] text-muted-2">{p.team_name ?? t('Sin equipo', 'No team')}</span>
                <span className="num block text-[14px] text-strong"><span className="text-muted @2xl:hidden">{t('Ganados: ', 'Won: ')}</span>{p.won}</span>
                <span className="num block text-[14px] text-strong"><span className="text-muted @2xl:hidden">{t('Perdidos: ', 'Lost: ')}</span>{p.lost}</span>
                <span className="num block text-[14px] text-strong"><span className="text-muted @2xl:hidden">{t('Monto ganado: ', 'Amount won: ')}</span>{p.amounts.map((a) => money(Number(a.amount), a.currency, locale)).join(' · ') || <NoData locale={locale} />}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6 @container" pad={false} data-testid="closed-list">
        <div className="px-5 pt-5 md:px-7 md:pt-6">
          <CardTitle title={t('Negocios', 'Deals')} />
          {/* Cuántos hay en total, cuántos se ven y cuántos trae el archivo: la pantalla nunca deja creer que la lista está completa. */}
          <p className="-mt-4 mb-5 text-[13px] text-muted" data-testid="closed-count">
            {data.total > data.rows.length
              ? t(`${num(data.total, locale)} en total. Aquí se ven los ${num(data.rows.length, locale)} más recientes.`, `${num(data.total, locale)} in total. The ${num(data.rows.length, locale)} most recent are shown here.`)
              : t(`${num(data.total, locale)} en total.`, `${num(data.total, locale)} in total.`)}
            {data.total > data.rows.length && canExport && (data.total <= EXPORT_MAX
              ? t(` El archivo CSV trae los ${num(data.total, locale)}.`, ` The CSV file has all ${num(data.total, locale)}.`)
              : t(` El archivo CSV trae hasta ${num(EXPORT_MAX, locale)}: acota el periodo o los filtros para bajarlos todos.`, ` The CSV file holds up to ${num(EXPORT_MAX, locale)}: narrow the period or the filters to get them all.`))}
          </p>
        </div>
        {data.rows.length === 0 ? <div className="p-7 pt-0"><Empty title={t('Ningún negocio cerrado con estos filtros', 'No closed deals with these filters')} hint={t('Prueba con un periodo más largo o quita un filtro.', 'Try a longer period or remove a filter.')} /></div> : (
          <>
            <div aria-hidden className={`hidden border-y border-line px-7 py-2.5 text-[13px] font-medium text-muted ${GRID}`}>
              <span>{t('Comercio', 'Merchant')}</span><span>{t('Negocio', 'Deal')}</span><span>{t('Embudo', 'Pipeline')}</span><span>{t('Quién', 'Owner')}</span><span>{t('Cierre', 'Closed')}</span><span>{t('Monto', 'Amount')}</span><span>{t('Cómo se ganó o motivo de pérdida', 'How it was won, or loss reason')}</span>
            </div>
            <ul className="divide-y divide-line">
              {data.rows.map((r) => (
                <li key={r.id} className={`px-5 py-3.5 @4xl:px-7 ${GRID}`} data-testid="closed-row" data-status={r.status}>
                  <Link href={`/comercios/${r.account_id}`} className="block text-[15px] font-semibold text-strong underline decoration-line-2 underline-offset-4 [overflow-wrap:anywhere]">{r.account_name}</Link>
                  <span className="mt-1 flex min-w-0 flex-wrap items-center gap-2 @4xl:mt-0">
                    <Badge tone={r.status === 'won' ? 'good' : 'neutral'}>{r.status === 'won' ? t('Ganado', 'Won') : t('Perdido', 'Lost')}</Badge>
                    <Link href={`/deals/${r.id}`} className="min-w-0 text-[14px] text-strong underline decoration-line-2 underline-offset-4 [overflow-wrap:anywhere]">{r.title}</Link>
                  </span>
                  <span className="mt-1 block text-[14px] text-muted-2 @4xl:mt-0"><span className={mobile}>{t('Embudo: ', 'Pipeline: ')}</span>{options.markets.length > 1 ? `${r.market_code} · ` : ''}{r.pipeline_name}</span>
                  <span className="block text-[14px] text-strong"><span className={mobile}>{t('Quién: ', 'Owner: ')}</span>{r.owner_name ?? t('Sin asignar', 'No owner')}</span>
                  <span className="num block text-[14px] text-strong"><span className={mobile}>{t('Cierre: ', 'Closed: ')}</span>{day(r.closed_on, locale)}</span>
                  <span className="num block text-[14px] text-strong"><span className={mobile}>{t('Monto: ', 'Amount: ')}</span>{r.amount_minor ? money(Number(r.amount_minor), r.currency.trim(), locale) : <NoData locale={locale} />}</span>
                  <span className="block text-[14px] text-muted-2">{r.status === 'lost' ? <><span className={mobile}>{t('Motivo: ', 'Reason: ')}</span>{r.reason_es ? t(r.reason_es, r.reason_en ?? r.reason_es) : <NoData locale={locale} />}</>
                    : <span data-testid="closed-how"><span className={mobile}>{t('Cómo se ganó: ', 'How it was won: ')}</span>{r.closed_by === 'transaction' ? t('Por primera venta', 'By first sale') : t(`A mano${r.closed_by_name ? `, lo marcó ${r.closed_by_name}` : ''}`, `By hand${r.closed_by_name ? `, marked by ${r.closed_by_name}` : ''}`)}</span>}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {canExport && <p className="mt-4 text-[13px] text-muted" data-testid="export-note">{t('El archivo trae las mismas columnas de esta tabla, sin teléfonos, correos ni contactos. Cada exportación pide un motivo y queda en la bitácora con tu nombre, los filtros y el número de filas.', 'The file has the same columns as this table, with no phones, emails or contacts. Each export asks for a reason and is logged with your name, the filters and the number of rows.')}</p>}
    </>
  )
}
