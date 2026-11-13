import Link from 'next/link'
import { getFinanceReport } from '@/dal/reportes'
import { Card, CardTitle, Empty, NoData } from '@/ui/kit'
import { Metric, ReportFilters, fxSource } from '@/ui/report'
import { DataTable, linkClass } from '@/ui/reportes'
import { qs } from '@/lib/labels'
import { day, money, monthYear, num } from '@/lib/format'
import { monthEnd } from '@/lib/periods'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'

/** E8.F5: lo que Finanzas necesita ver. Ganados por periodo con monto por moneda y entidad legal, y el consolidado con la tasa a la vista. */
export default async function FinanceReportPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('finanzas', searchParams, 'trimestre')
  const { ctx, period, f, sel, owners, multi } = r
  const { t, locale } = ctx
  const d = await getFinanceReport(ctx, period, f)
  const n = d.totals.reduce((s, x) => s + x.n, 0), withAmount = d.totals.reduce((s, x) => s + x.withAmount, 0)
  return (
    <>
      <ReportHeader r={r} />
      <ReportFilters t={t} locale={locale} base="/reportes/finanzas" params={r.params} period={period.first} selects={[sel.market, sel.pipeline]} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="finance-totals">
        <Metric t={t} k="financeWon" owners={owners} testId="m-finance-won" value={d.totals.filter((x) => x.amount > 0).map((x) => money(x.amount, x.currency, locale)).join(' · ') || <NoData locale={locale} />}
          hint={t(`${num(n, locale)} negocios ganados; ${num(n - withAmount, locale)} sin monto capturado.`, `${num(n, locale)} deals won; ${num(n - withAmount, locale)} with no amount entered.`)}
          href={qs('/reportes/cerrados', { ...r.params, resultado: 'won' })} />
        <Metric t={t} k="financeUsd" owners={owners} testId="m-finance-usd" value={d.usd === null ? <NoData locale={locale} /> : money(Math.round(d.usd), 'USD', locale)}
          hint={d.missing.length ? t(`No se consolida: hay negocios en ${d.missing.join(', ')} sin tasa para su fecha de cierre. Administración la carga y se rellenan solos.`, `Not consolidated: some deals in ${d.missing.join(', ')} have no rate for their close date. Administration loads it and they fill in on their own.`) : undefined} />
      </div>
      {d.rates.length > 0 && (
        <p className="mt-3 text-[13px] text-muted-2" data-testid="finance-rates">
          {t('Cada negocio usa la tasa del día en que se ganó. ', 'Each deal uses the rate of the day it was won. ')}{t('Tasa usada: ', 'Rate used: ')}{d.rates.slice(0, 3).map((x) => t(`1 ${x.currency} = ${Number(x.usd_rate)} USD, del ${day(x.as_of, locale)} (${fxSource(t, x)})`, `1 ${x.currency} = ${Number(x.usd_rate)} USD, dated ${day(x.as_of, locale)} (${fxSource(t, x)})`)).join(' · ')}{d.rates.length > 3 ? t(` y ${d.rates.length - 3} más`, ` and ${d.rates.length - 3} more`) : ''}
        </p>
      )}
      <Card className="mt-6" pad={false}>
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por mes, moneda y entidad legal', 'By month, currency and legal entity')} hint={t('Los montos se suman por moneda, sin convertir. Toca el número de negocios para ver la lista.', 'Amounts add up by currency, with no conversion. Tap the number of deals to see the list.')} /></div>
        <DataTable testId="finance-table" label={t('Ganados por mes, moneda y entidad legal', 'Wins by month, currency and legal entity')}
          empty={<div className="p-7 pt-0"><Empty title={t('Ningún negocio ganado en este periodo', 'No deals won in this period')} hint={t('Prueba con un periodo más largo o quita un filtro.', 'Try a longer period or remove a filter.')} /></div>}
          head={[{ label: t('Mes', 'Month') }, ...(multi ? [{ label: t('Mercado', 'Market') }] : []), { label: t('Entidad legal', 'Legal entity') }, { label: t('Negocios ganados', 'Deals won'), num: true }, { label: t('Con monto', 'With an amount'), num: true }, { label: t('Monto', 'Amount'), num: true }]}
          rows={d.rows.map((x) => ({ key: `${x.month}${x.market_code}${x.currency}${x.entity}`, testId: 'finance-row', cells: [
            monthYear(`${x.month}-15`, locale), ...(multi ? [x.market_code] : []), x.entity ?? t('Sin entidad legal en el comercio', 'No legal entity on the merchant'),
            <Link key="l" href={qs('/reportes/cerrados', { periodo: 'rango', desde: `${x.month}-01`, hasta: monthEnd(x.month), mercado: x.market_code, resultado: 'won' })} className={linkClass} data-testid="finance-row-link">{num(x.n, locale)}</Link>,
            num(x.with_amount, locale), Number(x.amount) > 0 ? money(Number(x.amount), x.currency, locale) : <NoData locale={locale} />,
          ] }))} />
      </Card>
      {exportNote(r)}
    </>
  )
}
