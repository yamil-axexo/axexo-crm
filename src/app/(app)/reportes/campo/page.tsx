import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getFieldReport, getReportOptions } from '@/dal/reports'
import { track } from '@/dal/boards'
import { Card, CardTitle, Empty, PageHeader, Pills } from '@/ui/kit'
import { ExportLink, ReportFilters } from '@/ui/report'
import { day, num, pct } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { reportFilters, reportSelects, type ReportParams } from '../params'

const PLACE = '@2xl:grid @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] @2xl:items-center @2xl:gap-4'
const VISIT = '@2xl:grid @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] @2xl:items-center @2xl:gap-4'

export default async function FieldReportPage({ searchParams }: { searchParams: Promise<ReportParams & { semana?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('report.view')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const options = await getReportOptions(ctx)
  const f = reportFilters(sp, options)
  const by = sp.por === 'plaza' ? 'plaza' : 'territorio'
  const data = await getFieldReport(ctx, { market: f.market, team: f.team, owner: f.owner, by })
  await track(ctx, 'view.report.field')
  const week = data.weeks.includes(sp.semana ?? '') ? sp.semana! : data.weeks[0]!
  const prev = data.weeks[data.weeks.indexOf(week) + 1]
  const params = { mercado: f.market, equipo: f.team, persona: f.owner, por: by === 'plaza' ? 'plaza' : undefined, semana: week === data.weeks[0] ? undefined : week }
  const sel = reportSelects(t, options, f)
  const multi = options.markets.length > 1 && !f.market
  const places = data.places.filter((x) => x.week === week)
  const visits = data.visits.filter((x) => x.week === week)
  const total = (w: string | undefined, k: 'stores' | 'won') => (w ? data.places.filter((x) => x.week === w).reduce((n, x) => n + x[k], 0) : 0)
  const visitTotal = (w: string | undefined, k: 'visits' | 'sales') => (w ? data.visits.filter((x) => x.week === w).reduce((n, x) => n + x[k], 0) : 0)
  const canExport = ctx.can('report.export', f.market)
  const exportHref = (tipo: string) => qs('/reportes/campo/export', { mercado: f.market, equipo: f.team, persona: f.owner, por: by === 'plaza' ? 'plaza' : undefined, tipo })
  const weekName = (w: string) => t(`Semana del ${day(w, locale)}`, `Week of ${day(w, locale)}`)
  const stat = (label: string, now: number, before: number, id: string) => (
    <div className="card p-4 md:p-5">
      <p className="text-[13px] font-medium text-muted-2">{label}</p>
      <p className="num mt-1.5 text-[26px] leading-9 font-semibold text-strong" data-testid={id}>{num(now, locale)}</p>
      {prev && <p className="mt-1 text-[12.5px] text-muted">{t(`Semana anterior: ${num(before, locale)}`, `Week before: ${num(before, locale)}`)}</p>}
    </div>
  )
  const lbl = '@2xl:hidden text-muted'

  return (
    <>
      <PageHeader
        title={t('Reporte semanal de campo', 'Weekly field report')}
        desc={t('Puntos de venta dados de alta y negocios ganados por semana y por territorio o plaza, y visitas por persona. La semana va de lunes a domingo, en la zona horaria del mercado.', 'Stores enrolled and deals won by week and by territory or city, and visits by person. The week runs Monday to Sunday, in the market’s time zone.')}
        actions={canExport ? <>
          <ExportLink href={exportHref('comercios')} testId="export-stores">{t('Exportar altas y ganados', 'Export enrollments and wins')}</ExportLink>
          <ExportLink href={exportHref('visitas')} testId="export-visits">{t('Exportar visitas', 'Export visits')}</ExportLink>
        </> : undefined}
      />
      <ReportFilters t={t} locale={locale} base="/reportes/campo" params={params} selects={[sel.market, sel.team, sel.owner]} />
      <div className="mb-5 space-y-3">
        <Pills label={t('Semana', 'Week')} current={week} items={data.weeks.map((w, i) => ({ key: w, href: qs('/reportes/campo', { ...params, semana: i === 0 ? undefined : w }), label: i === 0 ? t(`Esta semana (${day(w, locale)})`, `This week (${day(w, locale)})`) : day(w, locale) }))} />
        <Pills label={t('Agrupar por', 'Group by')} current={by} items={[
          { key: 'territorio', href: qs('/reportes/campo', { ...params, por: undefined }), label: t('Por territorio', 'By territory') },
          { key: 'plaza', href: qs('/reportes/campo', { ...params, por: 'plaza' }), label: t('Por plaza', 'By city') },
        ]} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="field-totals">
        {stat(t('Puntos de venta dados de alta', 'Stores enrolled'), total(week, 'stores'), total(prev, 'stores'), 'field-stores')}
        {stat(t('Negocios ganados', 'Deals won'), total(week, 'won'), total(prev, 'won'), 'field-won')}
        {stat(t('Visitas', 'Visits'), visitTotal(week, 'visits'), visitTotal(prev, 'visits'), 'field-visits')}
        {stat(t('Visitas con venta', 'Visits with a sale'), visitTotal(week, 'sales'), visitTotal(prev, 'sales'), 'field-sales')}
      </div>
      <p className="mt-3 text-[13px] text-muted">{t('Dado de alta: el punto de venta se creó en CONTIGO esa semana. Ganado: el negocio se ganó esa semana (con la primera transacción del archivo diario de ventas, o a mano si el embudo así está configurado). Visitas: las registradas en CONTIGO y las que llegan de la Sales App, sin contar dos veces la misma.', 'Enrolled: the store was created in CONTIGO that week. Won: the deal was won that week (with the first transaction in the daily sales file, or by hand if the pipeline is set up that way). Visits: the ones logged in CONTIGO and the ones that arrive from the Sales App, never counting the same one twice.')}</p>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card pad={false} className="@container" data-testid="field-places">
          <div className="px-5 pt-5 @2xl:px-7 @2xl:pt-6"><CardTitle title={by === 'plaza' ? t('Por plaza', 'By city') : t('Por territorio', 'By territory')} hint={weekName(week)} /></div>
          {places.length === 0 ? <div className="p-7 pt-0"><Empty title={t('Sin altas ni ganados esa semana', 'No enrollments or wins that week')} /></div> : (
            <>
              <div aria-hidden className={`hidden border-y border-line px-7 py-2.5 text-[13px] font-medium text-muted ${PLACE}`}><span>{by === 'plaza' ? t('Plaza', 'City') : t('Territorio', 'Territory')}</span><span>{t('Altas', 'Enrolled')}</span><span>{t('Ganados', 'Won')}</span></div>
              <ul className="divide-y divide-line">
                {places.map((r) => (
                  <li key={`${r.market_code}${r.place}`} className={`px-5 py-3 @2xl:px-7 ${PLACE}`} data-testid="field-place-row">
                    <span className="block text-[14.5px] font-semibold text-strong [overflow-wrap:anywhere]">{multi ? `${r.market_code} · ` : ''}{r.place ?? (by === 'plaza' ? t('Sin plaza', 'No city') : t('Sin territorio', 'No territory'))}</span>
                    <span className="num block text-[14px] text-strong"><span className={lbl}>{t('Altas: ', 'Enrolled: ')}</span>{num(r.stores, locale)}</span>
                    <span className="num block text-[14px] text-strong"><span className={lbl}>{t('Ganados: ', 'Won: ')}</span>{num(r.won, locale)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card pad={false} className="@container" data-testid="field-people">
          <div className="px-5 pt-5 @2xl:px-7 @2xl:pt-6"><CardTitle title={t('Visitas por persona', 'Visits by person')} hint={t(`${weekName(week)}. La visita cuenta para quien lleva el comercio.`, `${weekName(week)}. The visit counts for whoever owns the merchant.`)} /></div>
          {visits.length === 0 ? <div className="p-7 pt-0"><Empty title={t('Sin visitas esa semana', 'No visits that week')} /></div> : (
            <>
              <div aria-hidden className={`hidden border-y border-line px-7 py-2.5 text-[13px] font-medium text-muted ${VISIT}`}><span>{t('Persona', 'Person')}</span><span>{t('Equipo', 'Team')}</span><span>{t('Visitas', 'Visits')}</span><span>{t('Con venta', 'With a sale')}</span></div>
              <ul className="divide-y divide-line">
                {visits.map((r) => (
                  <li key={`${r.market_code}${r.owner_id}`} className={`px-5 py-3 @2xl:px-7 ${VISIT}`} data-testid="field-person-row">
                    <span className="block text-[14.5px] font-semibold text-strong [overflow-wrap:anywhere]">{r.owner_name ?? t('Sin asignar', 'No owner')}{multi ? ` · ${r.market_code}` : ''}</span>
                    <span className="block text-[13.5px] text-muted-2">{r.team_name ?? t('Sin equipo', 'No team')}</span>
                    <span className="num block text-[14px] text-strong"><span className={lbl}>{t('Visitas: ', 'Visits: ')}</span>{num(r.visits, locale)}</span>
                    <span className="num block text-[14px] text-strong"><span className={lbl}>{t('Con venta: ', 'With a sale: ')}</span>{num(r.sales, locale)}{r.visits > 0 && <span className="text-muted"> ({pct(r.sales, r.visits, locale)})</span>}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
      {canExport && <p className="mt-4 text-[13px] text-muted">{t('Los archivos traen las 8 semanas con los filtros de arriba. Cada exportación queda en la bitácora con tu nombre, los filtros y el número de filas.', 'The files hold the 8 weeks with the filters above. Each export is logged with your name, the filters and the number of rows.')}</p>}
    </>
  )
}
