import Link from 'next/link'
import { getLeadsReport } from '@/dal/reportes'
import { Card, CardTitle, Empty } from '@/ui/kit'
import { Metric, ReportFilters } from '@/ui/report'
import { Columns, DataTable, linkClass } from '@/ui/reportes'
import { SOURCE, qs } from '@/lib/labels'
import { monthYear, num, pct } from '@/lib/format'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'

/** E8.F1: leads captados y convertidos por mes, fuente y mercado, con tasa de conversión. Cada fila abre sus leads. */
export default async function LeadsReportPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('leads', searchParams, 'trimestre')
  const { ctx, period, f, sel, owners, multi } = r
  const { t, locale } = ctx
  const source = r.sp.fuente && r.sp.fuente in SOURCE ? r.sp.fuente : undefined
  const rows = await getLeadsReport(ctx, period, { ...f, source })
  const leads = rows.reduce((n, x) => n + x.leads, 0), converted = rows.reduce((n, x) => n + x.converted, 0)
  const months = [...new Set(rows.map((x) => x.month))].sort()
  const last = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const listHref = (x: { month: string; market_code: string; source: string }) => qs('/leads', { status: 'all', market: x.market_code, source: x.source, from: `${x.month}-01` < period.byMarket[x.market_code]!.from ? period.byMarket[x.market_code]!.from : `${x.month}-01`, to: last(x.month) > period.byMarket[x.market_code]!.to ? period.byMarket[x.market_code]!.to : last(x.month) })
  const extra = { fuente: source }
  return (
    <>
      <ReportHeader r={r} extra={extra} />
      <ReportFilters t={t} locale={locale} base="/reportes/leads" params={{ ...r.params, ...extra }} period={period.first}
        selects={[sel.market, { name: 'fuente', label: t('Fuente', 'Source'), all: t('Todas las fuentes', 'All sources'), options: Object.entries(SOURCE).map(([value, p]) => ({ value, label: t(p[0], p[1]) })) }, sel.team, sel.owner]} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="leads-totals">
        <Metric t={t} k="leads" value={num(leads, locale)} owners={owners} testId="m-leads" />
        <Metric t={t} k="leadsConverted" value={num(converted, locale)} tone="good" owners={owners} testId="m-converted" />
        <Metric t={t} k="conversion" value={pct(converted, leads, locale)} owners={owners} testId="m-conversion" />
      </div>
      {months.length > 1 && (
        <Card className="mt-6">
          <CardTitle title={t('Leads por mes', 'Leads by month')} />
          <Columns label={t('Leads por mes', 'Leads by month')} testId="leads-chart" points={months.map((m) => { const v = rows.filter((x) => x.month === m).reduce((n, x) => n + x.leads, 0); return { key: m, value: v, title: `${monthYear(`${m}-15`, locale)}: ${v}` } })} />
        </Card>
      )}
      <Card className="mt-6" pad={false} data-testid="leads-table-card">
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por mes, mercado y fuente', 'By month, market and source')} hint={t('Toca el número de leads para abrir la lista.', 'Tap the number of leads to open the list.')} /></div>
        <DataTable testId="leads-table" label={t('Leads por mes, mercado y fuente', 'Leads by month, market and source')}
          empty={<div className="p-7 pt-0"><Empty title={t('Ningún lead en este periodo', 'No leads in this period')} hint={t('Prueba con un periodo más largo o quita un filtro.', 'Try a longer period or remove a filter.')} /></div>}
          head={[{ label: t('Mes', 'Month') }, ...(multi ? [{ label: t('Mercado', 'Market') }] : []), { label: t('Fuente', 'Source') }, { label: t('Leads', 'Leads'), num: true }, { label: t('Convertidos', 'Converted'), num: true }, { label: t('Conversión', 'Conversion'), num: true }]}
          rows={rows.map((x) => ({ key: `${x.month}${x.market_code}${x.source}`, testId: 'leads-row', cells: [
            monthYear(`${x.month}-15`, locale), ...(multi ? [x.market_code] : []), SOURCE[x.source] ? t(SOURCE[x.source]![0], SOURCE[x.source]![1]) : x.source,
            <Link key="l" href={listHref(x)} className={linkClass} data-testid="leads-row-link">{num(x.leads, locale)}</Link>, num(x.converted, locale), pct(x.converted, x.leads, locale),
          ] }))} />
      </Card>
      {exportNote(r)}
    </>
  )
}
