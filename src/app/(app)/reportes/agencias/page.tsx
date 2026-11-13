import { agencyLabels, getAgencyReport } from '@/dal/reportes'
import { Card, CardTitle, Empty } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { Def, ReportFilters } from '@/ui/report'
import { DataTable } from '@/ui/reportes'
import { num, pct } from '@/lib/format'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'
import { agencyLabelsAction } from '../actions'

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
          {t('En este periodo ningún negocio viene de un comercio cuyo origen esté a nombre de una agencia. Si las agencias aparecen con otro nombre en el origen del comercio, administración las puede marcar abajo.', 'In this period no deal comes from a merchant whose origin is under an agency. If agencies show up under another name in the merchant origin, administration can flag them below.')}
        </p>
      )}
      <Card className="mt-6" pad={false}>
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Detalle', 'Detail')} /></div>
        <DataTable testId="agency-table" label={t('Agencia y equipo interno, detalle', 'Agency and in-house team, detail')}
          empty={<div className="p-7 pt-0"><Empty title={t('Ningún negocio creado en este periodo', 'No deals created in this period')} hint={t('Prueba con un periodo más largo.', 'Try a longer period.')} /></div>}
          head={[...(multi ? [{ label: t('Mercado', 'Market') }] : []), { label: t('Quién lo trajo', 'Brought in by') }, { label: t('Negocios', 'Deals'), num: true }, { label: t('Ganados', 'Won'), num: true }, { label: t('Perdidos', 'Lost'), num: true }, { label: t('Abiertos', 'Open'), num: true }]}
          rows={rows.map((x) => ({ key: `${x.grp}${x.label}${x.market_code}`, testId: 'agency-row', cells: [...(multi ? [x.market_code] : []), x.grp === 'agency' ? `${t('Agencia', 'Agency')}: ${x.label ?? ''}` : t('Equipo interno', 'In-house team'), num(x.deals, locale), num(x.won, locale), num(x.lost, locale), num(x.open, locale)] }))} />
      </Card>
      {ctx.can('config.manage') && (
        <Card className="mt-6" data-testid="agency-config">
          <CardTitle title={t('Quién cuenta como agencia', 'Who counts as an agency')} hint={t('Siempre cuenta el origen registrado a nombre de un aliado. Además, puedes escribir aquí los nombres de origen que también son agencia, separados por coma, tal como aparecen en la ficha del comercio.', 'An origin recorded under a partner always counts. You can also write here the origin names that are agencies too, separated by commas, exactly as they appear on the merchant page.')} />
          <ActionForm action={agencyLabelsAction} className="flex flex-wrap items-end gap-3">
            <label className="block min-w-0 flex-1 basis-72"><span className="mb-1 block text-[12.5px] font-semibold text-muted-2">{t('Nombres de origen', 'Origin names')}</span><input name="labels" defaultValue={labels.join(', ')} className="input" maxLength={600} data-testid="agency-labels" /></label>
            <Submit variant="ghost" testId="agency-labels-save">{t('Guardar', 'Save')}</Submit>
          </ActionForm>
        </Card>
      )}
      {exportNote(r)}
    </>
  )
}
