import { agencyLabels, getAgencyReport } from '@/dal/reportes'
import { Card, CardTitle, Empty } from '@/ui/kit'
import { Def, ReportFilters } from '@/ui/report'
import { DataTable } from '@/ui/reportes'
import { num, pct } from '@/lib/format'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'

/** E8.F3: los negocios que trajo una agencia junto a los del equipo interno, en el mismo periodo. */
export default async function AgencyReportPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('agencias', searchParams, 'trimestre')
  const { ctx, period, f, sel, owners, multi } = r
  const { t, locale } = ctx
  const [rows, labels] = await Promise.all([getAgencyReport(ctx, period, f), agencyLabels(ctx)])
  const sum = (g: 'agency' | 'inhouse') => rows.filter((x) => x.grp === g).reduce((a, x) => ({ deals: a.deals + x.deals, won: a.won + x.won, lost: a.lost + x.lost, open: a.open + x.open }), { deals: 0, won: 0, lost: 0, open: 0 })
  const [ag, ih] = [sum('agency'), sum('inhouse')]
  const side = (title: string, v: typeof ag, testId: string) => (
    <div className="card min-w-0 p-5" data-testid={testId}>
      <p className="text-[13px] font-medium text-muted-2">{title}</p>
      <p className="num mt-1 text-[26px] leading-9 font-semibold text-strong">{num(v.deals, locale)}</p>
      <p className="text-[13px] text-muted">{t(`${v.won} ganados, ${v.lost} perdidos, ${v.open} abiertos`, `${v.won} won, ${v.lost} lost, ${v.open} open`)}</p>
      <p className="mt-1 text-[13px] text-muted-2">{t('Ganados de los cerrados: ', 'Won out of closed: ')}<span className="num font-semibold text-strong">{pct(v.won, v.won + v.lost, locale)}</span></p>
    </div>
  )
  return (
    <>
      <ReportHeader r={r} />
      <ReportFilters t={t} locale={locale} base="/reportes/agencias" params={r.params} period={period.first} selects={[sel.market, sel.pipeline]} />
      <div className="grid gap-4 sm:grid-cols-2">{side(t('Agencia', 'Agency'), ag, 'agency-side')}{side(t('Equipo interno', 'In-house team'), ih, 'inhouse-side')}</div>
      <Def t={t} k="agency" named owners={owners} />
      {ag.deals === 0 && (
        <p role="status" className="mt-4 rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong" data-testid="agency-none">
          {t('En este periodo ningún negocio fue reclutado por una agencia o un aliado.', 'In this period no deal was recruited by an agency or a partner.')}
        </p>
      )}
      <Card className="mt-6" pad={false}>
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Detalle', 'Detail')} /></div>
        <DataTable testId="agency-table" label={t('Agencia y equipo interno, detalle', 'Agency and in-house team, detail')}
          empty={<div className="p-7 pt-0"><Empty title={t('Ningún negocio creado en este periodo', 'No deals created in this period')} hint={t('Prueba con un periodo más largo.', 'Try a longer period.')} /></div>}
          head={[...(multi ? [{ label: t('Mercado', 'Market') }] : []), { label: t('Quién lo trajo', 'Brought in by') }, { label: t('Negocios', 'Deals'), num: true }, { label: t('Ganados', 'Won'), num: true }, { label: t('Perdidos', 'Lost'), num: true }, { label: t('Abiertos', 'Open'), num: true }]}
          rows={rows.map((x) => ({ key: `${x.grp}${x.label}${x.market_code}`, testId: 'agency-row', cells: [...(multi ? [x.market_code] : []), x.grp === 'agency' ? `${t('Agencia', 'Agency')}: ${x.label ?? ''}` : t('Equipo interno', 'In-house team'), num(x.deals, locale), num(x.won, locale), num(x.lost, locale), num(x.open, locale)] }))} />
      </Card>
      <Card className="mt-6" data-testid="agency-config">
        <CardTitle title={t('Quién cuenta como agencia', 'Who counts as an agency')} hint={t('Un solo modelo: las agencias y aliados dados de alta en Administración. Un negocio es de agencia si "Reclutado por" dice una agencia o un aliado (en el negocio o en su comercio), o si la capa de canal del comercio está a nombre de una. Lo demás es equipo interno.', 'A single model: the agencies and partners set up in Administration. A deal belongs to an agency if "Recruited by" names an agency or partner (on the deal or its merchant), or if the merchant’s channel layer is under one. Everything else is the in-house team.')} />
        {labels.length > 0 && <p className="text-[13.5px] text-muted-2" data-testid="agency-legacy">{t(`Nombres del modelo anterior que ya no deciden este reporte: ${labels.join(', ')}. Si alguno es una agencia, dala de alta en Administración y corrige la capa de canal del comercio.`, `Names from the previous model that no longer decide this report: ${labels.join(', ')}. If any is an agency, set it up in Administration and correct the merchant’s channel layer.`)}</p>}
      </Card>
      {exportNote(r)}
    </>
  )
}
