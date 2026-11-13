import Link from 'next/link'
import { getReconciliation } from '@/dal/reportes'
import { RECONCILE_THRESHOLD_PCT } from '@/domain/reportes'
import { Badge, Card, CardTitle, Empty, NoData, Pills } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { Def, ReportFilters } from '@/ui/report'
import { DataTable, linkClass } from '@/ui/reportes'
import { qs } from '@/lib/labels'
import { day, dayTime, num } from '@/lib/format'
import { readerTimeZone } from '@/server/timezone'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'
import { runReportJobAction } from '../actions'

const KINDS: Record<string, [string, string]> = {
  won_without_txn: ['Ganado en CONTIGO sin primera venta en el archivo', 'Won in CONTIGO with no first sale in the file'],
  txn_without_won: ['Primera venta en el archivo y el negocio sigue abierto', 'First sale in the file and the deal is still open'],
  date_mismatch: ['La fecha en que se ganó no es la de la primera venta', 'The win date is not the first-sale date'],
  status_mismatch: ['El estado del comercio no es el que manda el archivo', 'The merchant status is not the one the file sends'],
}

/** REP-04: lo que dice CONTIGO contra lo que dice el archivo diario de ventas, con la lista de diferencias. */
export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('conciliacion', searchParams)
  const { ctx, f, sel, owners, multi } = r
  const { t, locale } = ctx
  const kind = r.sp.tipo && r.sp.tipo in KINDS ? r.sp.tipo : undefined
  const [d, tz] = await Promise.all([getReconciliation(ctx, { ...f, kind }), readerTimeZone(ctx)])
  const params = { mercado: f.market, tipo: kind }
  const count = (k: string, market?: string) => d.counts.filter((c) => c.kind === k && (!market || c.market_code === market)).reduce((n, c) => n + c.n, 0)
  return (
    <>
      <ReportHeader r={r} extra={{ tipo: kind }}>
        {ctx.can('integration.operate') && <ActionForm action={runReportJobAction}><input type="hidden" name="job" value="reconcile" /><Submit variant="ghost" testId="reconcile-now">{t('Conciliar ahora', 'Reconcile now')}</Submit></ActionForm>}
      </ReportHeader>
      <ReportFilters t={t} locale={locale} base="/reportes/conciliacion" params={params} selects={[sel.market]} />
      <div className="grid gap-4 md:grid-cols-2" data-testid="recon-markets">
        {d.totals.map((m) => {
          const diffs = count('won_without_txn', m.market_code) + count('txn_without_won', m.market_code) + count('date_mismatch', m.market_code)
          const base = Math.max(m.won_by_txn, m.first_txn, 1)
          const over = diffs * 100 > RECONCILE_THRESHOLD_PCT * base
          const run = d.runs.find((x) => x.market_code === m.market_code)
          return (
            <Card key={m.market_code} data-testid="recon-market">
              <CardTitle title={multi ? ctx.market(m.market_code).name : t('Resumen', 'Summary')} right={<Badge tone={diffs === 0 ? 'good' : over ? 'warn' : 'neutral'}>{diffs === 0 ? t('Cuadra', 'Matches') : over ? t('Arriba del umbral', 'Over the threshold') : t('Dentro del umbral', 'Within the threshold')}</Badge>}
                hint={m.as_of ? t(`Archivo de ventas con corte al ${day(m.as_of, locale)}.`, `Sales file with cutoff ${day(m.as_of, locale)}.`) : t('Todavía no ha llegado ningún archivo de ventas.', 'No sales file has arrived yet.')} />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
                <div><dt className="text-muted-2">{t('Ganados por primera venta en CONTIGO', 'Won by first sale in CONTIGO')}</dt><dd className="num text-[20px] font-semibold text-strong" data-testid="recon-won">{num(m.won_by_txn, locale)}</dd></div>
                <div><dt className="text-muted-2">{t('Comercios con primera venta en el archivo', 'Merchants with a first sale in the file')}</dt><dd className="num text-[20px] font-semibold text-strong" data-testid="recon-file">{num(m.first_txn, locale)}</dd></div>
                <div><dt className="text-muted-2">{t('Diferencias', 'Differences')}</dt><dd className="num text-[20px] font-semibold text-strong" data-testid="recon-diffs">{num(diffs, locale)}</dd></div>
                <div><dt className="text-muted-2">{t('Estado distinto al del archivo', 'Status differs from the file')}</dt><dd className="num text-[20px] font-semibold text-strong">{m.with_status === 0 ? <NoData locale={locale} /> : num(count('status_mismatch', m.market_code), locale)}</dd></div>
              </dl>
              <p className="mt-3 text-[13px] text-muted">
                {t(`Umbral: ${RECONCILE_THRESHOLD_PCT}% de diferencias.`, `Threshold: ${RECONCILE_THRESHOLD_PCT}% of differences.`)}{' '}
                {m.with_status === 0 && t('El archivo no trae el estado del comercio: activo y en riesgo salen de la regla de respaldo. ', 'The file does not carry the merchant status: active and at risk come from the fallback rule. ')}
                {run ? t(`Última conciliación guardada: ${dayTime(run.ran_at, locale, tz)}.`, `Last stored reconciliation: ${dayTime(run.ran_at, locale, tz)}.`) : t('Todavía no hay una conciliación guardada: corre una vez al día.', 'No reconciliation stored yet: it runs once a day.')}
              </p>
            </Card>
          )
        })}
      </div>
      <Def t={t} k="reconcile" named owners={owners} />

      <div className="mt-6 mb-4"><Pills label={t('Tipo de diferencia', 'Kind of difference')} current={kind ?? ''} items={[{ key: '', href: qs('/reportes/conciliacion', { ...params, tipo: undefined }), label: t('Todas', 'All') }, ...Object.entries(KINDS).map(([k, p]) => ({ key: k, href: qs('/reportes/conciliacion', { ...params, tipo: k }), label: t(p[0], p[1]), count: count(k) }))]} /></div>
      <Card pad={false} data-testid="recon-list">
        <DataTable testId="recon-table" label={t('Diferencias', 'Differences')}
          empty={<div className="p-7"><Empty title={t('CONTIGO y el archivo de ventas dicen lo mismo', 'CONTIGO and the sales file say the same thing')} hint={t('Cuando un negocio ganado no tenga su primera venta en el archivo, o al revés, aparece aquí con su comercio.', 'When a won deal has no first sale in the file, or the other way round, it shows up here with its merchant.')} /></div>}
          head={[{ label: t('Comercio', 'Merchant') }, { label: t('Diferencia', 'Difference') }, { label: t('Primera venta en el archivo', 'First sale in the file') }, { label: t('Ganado en CONTIGO', 'Won in CONTIGO') }]}
          rows={d.diffs.map((x, i) => ({ key: `${x.account_id}${x.kind}${i}`, testId: 'recon-row', cells: [
            <Link key="a" href={`/comercios/${x.account_id}?tab=datos`} className={`font-semibold ${linkClass}`}>{x.name}</Link>, KINDS[x.kind] ? t(KINDS[x.kind]![0], KINDS[x.kind]![1]) : x.kind,
            x.first_txn_at ? day(x.first_txn_at, locale) : <NoData locale={locale} />, x.deal_id && x.won_at ? <Link key="d" href={`/deals/${x.deal_id}`} className={linkClass}>{day(x.won_at, locale)}</Link> : <NoData locale={locale} />,
          ] }))} />
      </Card>
      {d.diffs.length >= 200 && <p className="mt-3 text-[13px] text-muted">{t('Aquí se ven las primeras 200. Filtra por tipo o por mercado para ver el resto.', 'The first 200 are shown here. Filter by kind or market to see the rest.')}</p>}
      {exportNote(r)}
    </>
  )
}
