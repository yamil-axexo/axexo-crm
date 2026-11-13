import Link from 'next/link'
import { FORECAST_MIN_SAMPLE, getForecast, stageRate } from '@/dal/reportes'
import { Card, CardTitle, Empty } from '@/ui/kit'
import { Def, ReportFilters } from '@/ui/report'
import { DataTable, RangeBar, linkClass } from '@/ui/reportes'
import { MOTOR } from '@/lib/labels'
import { num } from '@/lib/format'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'

/** REP-03: pronóstico por tipo de venta. Negocios abiertos por etapa por su tasa histórica de avance, con el supuesto a la vista y un rango. */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('pronostico', searchParams)
  const { ctx, f, sel, owners, multi } = r
  const { t, locale } = ctx
  const rows = await getForecast(ctx, f)
  const pipelines = [...new Map(rows.map((x) => [x.pipeline_id, x])).values()]
  const params = { mercado: f.market, embudo: f.pipeline, equipo: f.team, persona: f.owner }
  const one = (n: number) => (Math.round(n * 10) / 10).toLocaleString(locale === 'en' ? 'en-US' : 'es-MX', { maximumFractionDigits: 1 })
  return (
    <>
      <ReportHeader r={r} desc={t('Cuántos de los negocios abiertos de hoy se esperan ganar. Es un rango con su supuesto a la vista, no una meta ni una promesa.', 'How many of today’s open deals are expected to be won. It is a range with its assumption in view, not a target or a promise.')} />
      <ReportFilters t={t} locale={locale} base="/reportes/pronostico" params={params} selects={[sel.market, sel.pipeline, sel.team, sel.owner]} />
      {/* E1.F10: el pronóstico en dinero, en USD y con todos los mercados juntos, vive en el Consolidado (una sola regla de conversión). */}
      {ctx.can('board.lt') && <p className="mb-5 text-[13.5px] text-muted-2">{t('Este reporte cuenta negocios. Su monto en USD, ponderado por etapa, está en ', 'This report counts deals. Their amount in USD, weighted by stage, is in ')}<Link href="/reportes/consolidado" className="font-medium text-blue-text underline" data-testid="forecast-usd-link">{t('Consolidado en USD', 'Consolidated in USD')}</Link>.</p>}
      {pipelines.length === 0 && <Empty title={t('No hay embudos con estos filtros', 'No pipelines with these filters')} hint={t('Quita un filtro para verlos todos.', 'Remove a filter to see them all.')} />}
      {pipelines.map((p) => {
        const stages = rows.filter((x) => x.pipeline_id === p.pipeline_id).map((s) => ({ s, rate: stageRate(s) }))
        const open = stages.reduce((n, x) => n + x.s.open, 0)
        const exp = stages.reduce((n, x) => n + x.s.open * x.rate.rate, 0), low = stages.reduce((n, x) => n + x.s.open * x.rate.low, 0), high = stages.reduce((n, x) => n + x.s.open * x.rate.high, 0)
        const configured = stages.filter((x) => !x.rate.historical && x.s.open > 0).length
        return (
          <Card key={p.pipeline_id} className="mb-6" pad={false} data-testid="forecast-pipeline">
            <div className="px-5 pt-5 md:px-7 md:pt-6">
              <CardTitle title={`${multi ? `${p.market_code} · ` : ''}${p.pipeline_name}`} hint={MOTOR[p.motor] ? t(`Tipo de venta: ${MOTOR[p.motor]![0]}`, `Sales type: ${MOTOR[p.motor]![1]}`) : undefined}
                right={<Link href={`/pipelines/${p.pipeline_id}`} className={`text-[14px] font-medium text-brand-text ${linkClass}`}>{t('Abrir el tablero', 'Open the board')}</Link>} />
              {open === 0 ? <p className="pb-5 text-[14px] text-muted" data-testid="forecast-empty">{t('Sin negocios abiertos: no hay nada que pronosticar en este embudo.', 'No open deals: there is nothing to forecast in this pipeline.')}</p> : (
                <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="forecast-total">
                  <p className="text-[15px] text-strong">{t('Se esperan ', 'Expected: ')}<span className="num text-[24px] font-semibold text-brand-text" data-testid="forecast-expected">{one(exp)}</span>{t(' ganados', ' wins')}<span className="text-muted-2" data-testid="forecast-range">{t(` (entre ${one(low)} y ${one(high)})`, ` (between ${one(low)} and ${one(high)})`)}</span>{t(` de ${num(open, locale)} abiertos.`, ` out of ${num(open, locale)} open.`)}</p>
                  <RangeBar low={low} expected={exp} high={high} max={open} label={t(`Rango: de ${one(low)} a ${one(high)}, esperado ${one(exp)}, de ${open} abiertos`, `Range: ${one(low)} to ${one(high)}, expected ${one(exp)}, out of ${open} open`)} />
                </div>
              )}
            </div>
            {open > 0 && (
              <>
                <DataTable testId="forecast-table" label={t(`Pronóstico de ${p.pipeline_name} por etapa`, `Forecast of ${p.pipeline_name} by stage`)}
                  head={[{ label: t('Etapa', 'Stage') }, { label: t('Abiertos', 'Open'), num: true }, { label: t('Tasa de avance', 'Advance rate'), num: true }, { label: t('De dónde sale la tasa', 'Where the rate comes from') }, { label: t('Esperados', 'Expected'), num: true }, { label: t('Rango', 'Range'), num: true }]}
                  rows={stages.map(({ s, rate }) => ({ key: s.stage_id, testId: 'forecast-row', cells: [
                    t(s.name_es, s.name_en), num(s.open, locale), `${Math.round(rate.rate * 100)}%`,
                    rate.historical ? t(`Histórica: ${s.won} ganados de ${s.closed} que pasaron por aquí y ya cerraron`, `Historical: ${s.won} won out of ${s.closed} that passed through and closed`) : t(`La configurada en la etapa: hay menos de ${FORECAST_MIN_SAMPLE} cerrados para medirla`, `The one set on the stage: fewer than ${FORECAST_MIN_SAMPLE} closed deals to measure it`),
                    one(s.open * rate.rate), `${one(s.open * rate.low)} a ${one(s.open * rate.high)}`.replace(' a ', t(' a ', ' to ')),
                  ] }))} />
                {configured > 0 && <p className="px-5 pt-3 pb-4 text-[13px] text-muted md:px-7" data-testid="forecast-assumption">{t(`En ${configured} ${configured === 1 ? 'etapa' : 'etapas'} todavía no hay historia suficiente: se usa la probabilidad configurada en la etapa, con 15 puntos de margen.`, `${configured} ${configured === 1 ? 'stage does' : 'stages do'} not have enough history yet: the probability set on the stage is used, with a 15-point margin.`)}</p>}
              </>
            )}
          </Card>
        )
      })}
      <Def t={t} k="forecast" named owners={owners} />
      {exportNote(r)}
    </>
  )
}
