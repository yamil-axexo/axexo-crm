import { getHistory } from '@/dal/reportes'
import { getCohorts, teamSnapshots, type CohortCut } from '@/dal/reportes2'
import { NavSelect } from '@/ui/board'
import { SOURCE, qs } from '@/lib/labels'
import { REPORT_ADAPTERS } from '@/server/adapters/report-channels'
import { Badge, Card, CardTitle, Empty } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { Def, ReportFilters } from '@/ui/report'
import { Columns, DataTable } from '@/ui/reportes'
import { LIFECYCLE } from '@/lib/labels'
import { day, dayTime, monthYear, num, pct } from '@/lib/format'
import { readerTimeZone } from '@/server/timezone'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'
import { runReportJobAction } from '../actions'

/** REP-02: la foto diaria de negocios y cartera, cohortes de leads y de altas, y velocidad por etapa. */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('historico', searchParams)
  const { ctx, f, sel, owners, multi } = r
  const { t, locale } = ctx
  const [d, tz] = await Promise.all([getHistory(ctx, f), readerTimeZone(ctx)])
  const params = { mercado: f.market, embudo: f.pipeline }
  const days = [...new Set(d.pipeline.map((x) => x.day))].sort()
  const perDay = days.map((k) => ({ key: k, value: d.pipeline.filter((x) => x.day === k).reduce((n, x) => n + x.deals, 0) }))
  const lastDay = days[days.length - 1]
  const portfolioLast = d.portfolio.filter((x) => x.day === d.portfolio[d.portfolio.length - 1]?.day)
  const part = (age: number, n: number) => (age < n ? t(' (parcial)', ' (partial)') : '')
  const fileAdapter = REPORT_ADAPTERS.find((a) => a.key === 'snapshot_file')!
  // reportes2 (REP-02): cohortes por semana de alta, canal o persona, y la foto diaria por equipo.
  const cut: CohortCut = r.sp.por === 'canal' || r.sp.por === 'persona' ? r.sp.por : 'semana'
  const [cohorts, teams] = await Promise.all([getCohorts(ctx, cut, f.market), teamSnapshots(ctx, f.market)])
  const cutHref = (c: CohortCut) => qs('/reportes/historico', { ...params, por: c })
  const cutLabel = (x: { key: string; label: string }) => cut === 'semana' ? t(`Semana del ${day(x.key, locale)}`, `Week of ${day(x.key, locale)}`)
    : cut === 'canal' ? (SOURCE[x.key] ? t(SOURCE[x.key]![0], SOURCE[x.key]![1]) : x.key) : x.label || t('Sin persona asignada', 'No one assigned')
  return (
    <>
      <ReportHeader r={r} />
      <ReportFilters t={t} locale={locale} base="/reportes/historico" params={params} selects={[sel.market, sel.pipeline]} />

      <Card data-testid="snapshot-card">
        <CardTitle title={t('Foto diaria de negocios abiertos', 'Daily snapshot of open deals')}
          hint={lastDay ? t(`Última foto: ${day(lastDay, locale)}. ${days.length} ${days.length === 1 ? 'día guardado' : 'días guardados'} en los últimos 45.`, `Latest snapshot: ${day(lastDay, locale)}. ${days.length} ${days.length === 1 ? 'day' : 'days'} kept in the last 45.`) : undefined}
          right={ctx.can('integration.operate') ? <ActionForm action={runReportJobAction}><input type="hidden" name="job" value="snapshot" /><Submit variant="ghost" size="sm" testId="snapshot-now">{t('Tomar la foto ahora', 'Take the snapshot now')}</Submit></ActionForm> : undefined} />
        {!d.snapshotScope ? <Empty title={t('La foto diaria cuenta el mercado completo', 'The daily snapshot counts the whole market')} hint={t('La ven quien lidera el mercado, leadership y administración. Las cohortes y la velocidad de abajo sí son de tu equipo.', 'Market leads, leadership and administration see it. The cohorts and velocity below are for your team.')} />
          : perDay.length === 0 ? <Empty title={t('Todavía no hay ninguna foto', 'There is no snapshot yet')} hint={t('La foto se toma una vez al día, sola. A partir de la primera, aquí se ve cómo cambian los negocios abiertos día a día.', 'The snapshot is taken once a day, on its own. From the first one on, this shows how open deals change day by day.')} />
          : (
            <>
              <Columns label={t('Negocios abiertos por día', 'Open deals by day')} testId="snapshot-chart" points={perDay.map((p) => ({ ...p, title: `${day(p.key, locale)}: ${p.value}` }))} />
              <p className="mt-2 text-[14px] text-strong" data-testid="snapshot-last">{t(`${day(lastDay!, locale)}: ${num(perDay[perDay.length - 1]!.value, locale)} negocios abiertos.`, `${day(lastDay!, locale)}: ${num(perDay[perDay.length - 1]!.value, locale)} open deals.`)}{' '}
                {portfolioLast.length > 0 && t('Cartera: ', 'Merchants: ') + [...new Set(portfolioLast.map((x) => x.lifecycle))].map((lc) => `${LIFECYCLE[lc] ? t(LIFECYCLE[lc]!.label[0], LIFECYCLE[lc]!.label[1]) : lc} ${num(portfolioLast.filter((x) => x.lifecycle === lc).reduce((n, x) => n + x.accounts, 0), locale)}`).join(' · ')}</p>
            </>
          )}
        <Def t={t} k="snapshot" owners={owners} />
      </Card>

      <Card className="mt-6" pad={false} data-testid="team-snapshot">
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Foto diaria por equipo', 'Daily snapshot by team')} hint={t('Quien supervisa ve la de su equipo; quien lidera el mercado, la de todos sus equipos.', 'Supervisors see their team’s; market leads see all their teams.')} /></div>
        <DataTable testId="team-snapshot-table" label={t('Foto diaria por equipo', 'Daily snapshot by team')}
          empty={<div className="p-7 pt-0"><Empty title={t('Todavía no hay foto por equipo', 'No team snapshot yet')} hint={t('Se toma una vez al día, sola, junto con la foto del mercado.', 'It is taken once a day, on its own, with the market snapshot.')} /></div>}
          head={[{ label: t('Día', 'Day') }, { label: t('Equipo', 'Team') }, { label: t('Negocios abiertos', 'Open deals'), num: true }, { label: t('Sin próximo paso', 'No next step'), num: true }, { label: t('Comercios activos', 'Active merchants'), num: true }, { label: t('En riesgo', 'At risk'), num: true }]}
          rows={teams.map((x) => ({ key: `${x.day}${x.team}`, testId: 'team-snapshot-row', cells: [day(x.day, locale), x.team, num(x.open_deals, locale), num(x.no_next_step, locale), num(x.active_accounts, locale), num(x.at_risk_accounts, locale)] }))} />
      </Card>

      <Card className="mt-6" pad={false} data-testid="cohort-cut">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 md:px-7 md:pt-6">
          <CardTitle title={t('Leads convertidos a 30, 60 y 90 días, por corte', 'Leads converted within 30, 60 and 90 days, by cut')} hint={t('Últimos 120 días. Un corte reciente todavía no llega a 90 días: se marca como parcial.', 'Last 120 days. A recent cut has not reached 90 days yet: it is marked partial.')} />
          <NavSelect label={t('Cortar por', 'Cut by')} value={cutHref(cut)} testId="cohort-cut-select"
            options={[{ href: cutHref('semana'), label: t('Semana de alta', 'Week created') }, { href: cutHref('canal'), label: t('Canal', 'Channel') }, { href: cutHref('persona'), label: t('Persona', 'Person') }]} />
        </div>
        <DataTable testId="cohort-cut-table" label={t('Cohortes por corte', 'Cohorts by cut')}
          empty={<div className="p-7 pt-0"><Empty title={t('Sin leads en los últimos 120 días', 'No leads in the last 120 days')} /></div>}
          head={[{ label: cut === 'semana' ? t('Semana', 'Week') : cut === 'canal' ? t('Canal', 'Channel') : t('Persona', 'Person') }, ...(multi ? [{ label: t('Mercado', 'Market') }] : []), { label: t('Leads', 'Leads'), num: true }, { label: t('A 30 días', 'Within 30 days'), num: true }, { label: t('A 60 días', 'Within 60 days'), num: true }, { label: t('A 90 días', 'Within 90 days'), num: true }]}
          rows={cohorts.map((x) => ({ key: `${x.key}${x.market_code}`, testId: 'cohort-cut-row', cells: [cutLabel(x), ...(multi ? [x.market_code] : []), num(x.leads, locale),
            pct(x.c30, x.leads, locale) + part(x.age_days, 30), pct(x.c60, x.leads, locale) + part(x.age_days, 60), pct(x.c90, x.leads, locale) + part(x.age_days, 90)] }))} />
      </Card>

      <Card className="mt-6" pad={false} data-testid="cohort-leads">
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Leads del mes: convertidos a 30, 60 y 90 días', 'Leads of the month: converted within 30, 60 and 90 days')} /></div>
        <DataTable testId="cohort-leads-table" label={t('Cohortes de leads', 'Lead cohorts')}
          empty={<div className="p-7 pt-0"><Empty title={t('Sin leads en los últimos seis meses', 'No leads in the last six months')} hint={t('Cuando lleguen leads, aquí se ve cuántos de cada mes terminan en negocio.', 'Once leads arrive, this shows how many from each month end up as a deal.')} /></div>}
          head={[{ label: t('Mes del lead', 'Lead month') }, ...(multi ? [{ label: t('Mercado', 'Market') }] : []), { label: t('Leads', 'Leads'), num: true }, { label: t('A 30 días', 'Within 30 days'), num: true }, { label: t('A 60 días', 'Within 60 days'), num: true }, { label: t('A 90 días', 'Within 90 days'), num: true }]}
          rows={d.leads.map((x) => ({ key: `${x.month}${x.market_code}`, testId: 'cohort-lead-row', cells: [monthYear(`${x.month}-15`, locale), ...(multi ? [x.market_code] : []), num(x.leads, locale),
            `${x.c30} · ${pct(x.c30, x.leads, locale)}${part(x.age_days, 30)}`, `${x.c60} · ${pct(x.c60, x.leads, locale)}${part(x.age_days, 60)}`, `${x.c90} · ${pct(x.c90, x.leads, locale)}${part(x.age_days, 90)}`] }))} />
        <div className="px-5 pb-4 md:px-7"><Def t={t} k="cohortLeads" owners={owners} /></div>
      </Card>

      <Card className="mt-6" pad={false} data-testid="cohort-stores">
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Altas del mes con primera venta', 'Stores enrolled in the month with a first sale')} /></div>
        <DataTable testId="cohort-stores-table" label={t('Cohortes de altas', 'Enrollment cohorts')}
          empty={<div className="p-7 pt-0"><Empty title={t('Sin altas en los últimos seis meses', 'No stores enrolled in the last six months')} hint={t('Cuando se den de alta tiendas, aquí se ve cuántas llegan a su primera venta.', 'Once stores are enrolled, this shows how many reach a first sale.')} /></div>}
          head={[{ label: t('Mes de alta', 'Enrollment month') }, ...(multi ? [{ label: t('Mercado', 'Market') }] : []), { label: t('Altas', 'Enrolled'), num: true }, { label: t('Con primera venta', 'With a first sale'), num: true }, { label: t('Parte', 'Share'), num: true }]}
          rows={d.stores.map((x) => ({ key: `${x.month}${x.market_code}`, testId: 'cohort-store-row', cells: [monthYear(`${x.month}-15`, locale), ...(multi ? [x.market_code] : []), num(x.stores, locale), num(x.first_sale, locale), pct(x.first_sale, x.stores, locale)] }))} />
        <div className="px-5 pb-4 md:px-7"><Def t={t} k="cohortStores" owners={owners} /></div>
      </Card>

      <Card className="mt-6" pad={false} data-testid="velocity">
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Velocidad por etapa', 'Stage velocity')} hint={t('Días que tarda un negocio en salir de cada etapa.', 'Days a deal takes to leave each stage.')} /></div>
        <DataTable testId="velocity-table" label={t('Velocidad por etapa', 'Stage velocity')}
          empty={<div className="p-7 pt-0"><Empty title={t('Todavía no hay cambios de etapa que medir', 'There are no stage changes to measure yet')} hint={t('Cada vez que un negocio cambia de etapa queda guardado: con los primeros cambios aparece la velocidad.', 'Every time a deal changes stage it is kept: velocity shows up with the first changes.')} /></div>}
          head={[{ label: t('Embudo', 'Pipeline') }, { label: t('Etapa', 'Stage') }, { label: t('Salidas medidas', 'Exits measured'), num: true }, { label: t('Mediana (días)', 'Median (days)'), num: true }, { label: t('Percentil 90 (días)', '90th percentile (days)'), num: true }]}
          rows={d.velocity.map((x) => ({ key: x.stage_id, testId: 'velocity-row', cells: [`${multi ? `${x.market_code} · ` : ''}${x.pipeline_name}`, t(x.name_es, x.name_en), num(x.n, locale), x.p50.toFixed(1), x.p90.toFixed(1)] }))} />
        <div className="px-5 pb-4 md:px-7"><Def t={t} k="velocity" owners={owners} /></div>
      </Card>

      {ctx.isGlobal && (
        <Card className="mt-6" data-testid="snapshot-file">
          <CardTitle title={t(fileAdapter.name[0], fileAdapter.name[1])} right={<Badge tone="neutral">{t('Canal apagado', 'Channel off')}</Badge>} hint={t(fileAdapter.what[0], fileAdapter.what[1])} />
          <p className="text-[14px] text-muted-2">{t('Para encenderlo hace falta: ', 'To turn it on it needs: ')}{t(fileAdapter.needs[0], fileAdapter.needs[1])}</p>
          {d.outbox.filter((o) => o.channel === 'snapshot_file').length > 0 && (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {d.outbox.filter((o) => o.channel === 'snapshot_file').slice(0, 5).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]" data-testid="outbox-row"><span className="text-strong [overflow-wrap:anywhere]">{o.title} · {t(`${o.row_count} filas`, `${o.row_count} rows`)}</span><span className="text-muted">{o.status === 'simulated' ? t('Simulado en pruebas', 'Simulated in tests') : t('Canal apagado: no salió', 'Channel off: not sent')} · {dayTime(o.created_at, locale, tz)}</span></li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {exportNote(r)}
    </>
  )
}
