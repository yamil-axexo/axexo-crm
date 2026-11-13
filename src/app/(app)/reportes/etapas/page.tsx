import Link from 'next/link'
import { getStagesReport } from '@/dal/reportes'
import { Bar, Card, CardTitle, Empty, NoData } from '@/ui/kit'
import { Def, ReportFilters } from '@/ui/report'
import { DataTable, linkClass } from '@/ui/reportes'
import { qs } from '@/lib/labels'
import { money, num } from '@/lib/format'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'

/** E8.F2: cada embudo con sus etapas, cuántos negocios abiertos tiene cada una, cuánto llevan ahí y cuántos no tienen próximo paso. */
export default async function StagesReportPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('etapas', searchParams)
  const { ctx, f, sel, owners, multi } = r
  const { t, locale } = ctx
  const rows = await getStagesReport(ctx, f)
  const pipelines = [...new Map(rows.map((x) => [x.pipeline_id, x])).values()]
  const params = { mercado: f.market, embudo: f.pipeline, equipo: f.team, persona: f.owner }
  return (
    <>
      <ReportHeader r={r} desc={t('Foto de este momento: no cambia con el periodo. Toca un embudo para abrir su tablero.', 'A snapshot of right now: it does not change with the period. Tap a pipeline to open its board.')} />
      <ReportFilters t={t} locale={locale} base="/reportes/etapas" params={params} selects={[sel.market, sel.pipeline, sel.team, sel.owner]} />
      {pipelines.length === 0 && <Empty title={t('No hay embudos con estos filtros', 'No pipelines with these filters')} hint={t('Quita un filtro para verlos todos.', 'Remove a filter to see them all.')} />}
      {pipelines.map((p) => {
        const stages = rows.filter((x) => x.pipeline_id === p.pipeline_id)
        const total = stages.reduce((n, x) => n + x.deals, 0), noStep = stages.reduce((n, x) => n + x.no_step, 0)
        const max = Math.max(1, ...stages.map((x) => x.deals))
        return (
          <Card key={p.pipeline_id} className="mb-6" pad={false} data-testid="stage-pipeline">
            <div className="px-5 pt-5 md:px-7 md:pt-6">
              <CardTitle title={`${multi ? `${p.market_code} · ` : ''}${p.pipeline_name}`}
                hint={<span data-testid="stage-summary">{t(`${num(total, locale)} negocios abiertos, ${num(noStep, locale)} sin próximo paso.`, `${num(total, locale)} open deals, ${num(noStep, locale)} with no next step.`)}</span>}
                right={<Link href={`/pipelines/${p.pipeline_id}`} className={`text-[14px] font-medium text-brand-text ${linkClass}`} data-testid="stage-board-link">{t('Abrir el tablero', 'Open the board')}</Link>} />
            </div>
            <DataTable testId="stage-table" label={t(`Etapas de ${p.pipeline_name}`, `Stages of ${p.pipeline_name}`)}
              head={[{ label: t('Etapa', 'Stage') }, { label: t('Negocios abiertos', 'Open deals'), num: true }, { label: t('Mediana de días en la etapa', 'Median days in stage'), num: true }, { label: t('El más antiguo', 'The oldest'), num: true }, { label: t('Etapa larga', 'Long in stage'), num: true }, { label: t('Sin próximo paso', 'No next step'), num: true }, { label: t('Monto', 'Amount'), num: true }]}
              rows={stages.map((s) => ({ key: s.stage_id, testId: 'stage-row', cells: [
                <div key="n" className="min-w-[150px]"><span className="font-semibold">{t(s.name_es, s.name_en)}</span><div className="mt-1.5"><Bar value={s.deals} max={max} /></div></div>,
                num(s.deals, locale),
                s.median_days === null ? <NoData locale={locale} /> : t(`${s.median_days} d`, `${s.median_days} d`),
                s.max_days === null ? <NoData locale={locale} /> : t(`${s.max_days} d`, `${s.max_days} d`),
                <span key="l" title={t(`Más de ${s.rot_days} días en la etapa`, `More than ${s.rot_days} days in the stage`)}>{num(s.long, locale)}</span>,
                s.no_step > 0 ? <Link key="p" href={qs(`/pipelines/${s.pipeline_id}`, { paso: 'sin' })} className={linkClass} data-testid="stage-nostep-link">{num(s.no_step, locale)}</Link> : '0',
                Number(s.amount) > 0 ? money(Number(s.amount), s.currency, locale) : <NoData locale={locale} />,
              ] }))} />
          </Card>
        )
      })}
      <div className="grid gap-x-6 md:grid-cols-2"><Def t={t} k="stageTime" named owners={owners} /><Def t={t} k="noNextStep" named owners={owners} /></div>
      {exportNote(r)}
    </>
  )
}
