import { TRUST_MIN, getFieldKpis } from '@/dal/reportes'
import { Card, CardTitle, Empty, NoData } from '@/ui/kit'
import { Metric, ReportFilters } from '@/ui/report'
import { DataTable } from '@/ui/reportes'
import { addDays, num, pct } from '@/lib/format'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader, exportNote } from '../shell'

/** CAMPO-05: indicadores de ejecución en campo, con la señal de confianza de la visita a la vista (a mano o confirmada por la Sales App). */
export default async function FieldKpisPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('indicadores-campo', searchParams, '30d')
  const { ctx, period, f, sel, owners, multi } = r
  const { t, locale } = ctx
  const rows = await getFieldKpis(ctx, period, f)
  // Días hábiles del periodo en cada mercado (su horario hábil), para "visitas por día".
  const workdays = (code: string) => {
    const p = period.byMarket[code]
    if (!p) return 0
    const days = ctx.market(code).workdays
    let n = 0
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) if (days.includes(((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1)) n++
    return n
  }
  const wd = Object.fromEntries([...new Set(rows.map((x) => x.market_code))].map((c) => [c, workdays(c)]))
  const sum = (k: 'visits' | 'sales' | 'visited' | 'confirmed' | 'manual' | 'low' | 'book' | 'enrolled') => rows.reduce((n, x) => n + x[k], 0)
  const people = rows.filter((x) => x.owner_id && x.visits > 0)
  const personDays = people.reduce((n, x) => n + (wd[x.market_code] ?? 0), 0)
  const perDay = (visits: number, days: number) => (days > 0 ? (visits / days).toFixed(1) : null)
  const ratio = (a: number, b: number) => (b > 0 ? (a / b).toFixed(1) : null)
  const nd = <NoData locale={locale} />
  return (
    <>
      <ReportHeader r={r} />
      <ReportFilters t={t} locale={locale} base="/reportes/indicadores-campo" params={r.params} period={period.first} selects={[sel.market, sel.team, sel.owner]} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="field-kpis">
        <Metric t={t} k="fieldPerDay" owners={owners} testId="kpi-per-day" value={perDay(sum('visits'), personDays) ?? nd} hint={t(`${num(sum('visits'), locale)} visitas de ${people.length} ${people.length === 1 ? 'persona' : 'personas'}.`, `${num(sum('visits'), locale)} visits by ${people.length} ${people.length === 1 ? 'person' : 'people'}.`)} />
        <Metric t={t} k="fieldCoverage" owners={owners} testId="kpi-coverage" value={pct(Math.min(sum('visited'), sum('book')), sum('book'), locale)} hint={t(`${num(sum('visited'), locale)} de ${num(sum('book'), locale)} tiendas.`, `${num(sum('visited'), locale)} of ${num(sum('book'), locale)} stores.`)} />
        <Metric t={t} k="fieldEffect" owners={owners} testId="kpi-effect" value={pct(sum('sales'), sum('visits'), locale)} hint={t(`${num(sum('sales'), locale)} visitas con venta.`, `${num(sum('sales'), locale)} visits with a sale.`)} />
        <Metric t={t} k="fieldPerStore" owners={owners} testId="kpi-per-store" value={ratio(sum('visits'), sum('enrolled')) ?? nd} hint={t(`${num(sum('enrolled'), locale)} altas en el periodo.`, `${num(sum('enrolled'), locale)} stores enrolled in the period.`)} />
      </div>

      <Card className="mt-6" data-testid="trust-card">
        <CardTitle title={t('Qué tan confirmadas están las visitas', 'How confirmed the visits are')} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div data-testid="trust-confirmed"><p className="text-[13px] font-medium text-muted-2">{t('Confirmadas por la Sales App', 'Confirmed by the Sales App')}</p><p className="num text-[24px] font-semibold text-brand-text">{num(sum('confirmed'), locale)}</p><p className="text-[13px] text-muted">{pct(sum('confirmed'), sum('visits'), locale)}</p></div>
          <div data-testid="trust-manual"><p className="text-[13px] font-medium text-muted-2">{t('Registradas a mano', 'Logged by hand')}</p><p className="num text-[24px] font-semibold text-strong">{num(sum('manual'), locale)}</p><p className="text-[13px] text-muted">{t('Cuentan, pero nadie más las respalda.', 'They count, but no one else backs them up.')}</p></div>
          <div data-testid="trust-low"><p className="text-[13px] font-medium text-muted-2">{t('Fuera de la cuenta por señal baja', 'Left out for a low signal')}</p><p className="num text-[24px] font-semibold text-strong">{num(sum('low'), locale)}</p><p className="text-[13px] text-muted">{t(`Señal de la Sales App por debajo de ${TRUST_MIN}. Hoy la Sales App todavía no la manda.`, `Sales App signal below ${TRUST_MIN}. The Sales App does not send it yet.`)}</p></div>
        </div>
        <p className="mt-4 text-[13.5px] text-muted-2" data-testid="trust-note">{t('Mientras las visitas se registren a mano, estos indicadores sirven para conversar con el equipo, no para pagar. Ninguna visita se paga desde CONTIGO, y aquí no se guarda ubicación ni fotos de nadie.', 'While visits are logged by hand, these indicators are for a conversation with the team, not for paying. No visit is paid from CONTIGO, and no one’s location or photos are stored here.')}</p>
      </Card>

      <Card className="mt-6" pad={false}>
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por persona', 'By person')} hint={t('Las visitas se cuentan por quien lleva la tienda.', 'Visits are counted under whoever owns the store.')} /></div>
        <DataTable testId="field-kpi-table" label={t('Indicadores de campo por persona', 'Field indicators by person')}
          empty={<div className="p-7 pt-0"><Empty title={t('Sin visitas ni cartera con estos filtros', 'No visits or book with these filters')} hint={t('Las visitas se registran desde la ficha del comercio o con "Registrar actividad".', 'Visits are logged from the merchant page or with "Log activity".')} /></div>}
          head={[{ label: t('Persona', 'Person') }, { label: t('Visitas', 'Visits'), num: true }, { label: t('Por día', 'Per day'), num: true }, { label: t('Cobertura', 'Coverage'), num: true }, { label: t('Efectividad', 'Effectiveness'), num: true }, { label: t('Visitas por alta', 'Visits per enrolled store'), num: true }, { label: t('Confirmadas', 'Confirmed'), num: true }]}
          rows={rows.map((x) => ({ key: `${x.market_code}${x.owner_id}`, testId: 'field-kpi-row', cells: [
            <span key="p"><span className="font-semibold">{x.owner_name ?? t('Sin asignar', 'No owner')}</span><span className="block text-[12.5px] text-muted">{x.team_name ?? t('Sin equipo', 'No team')}{multi ? ` · ${x.market_code}` : ''}</span></span>,
            num(x.visits, locale), perDay(x.visits, wd[x.market_code] ?? 0) ?? nd, x.book > 0 ? `${pct(Math.min(x.visited, x.book), x.book, locale)} · ${x.visited}/${x.book}` : nd,
            pct(x.sales, x.visits, locale), ratio(x.visits, x.enrolled) ?? nd, pct(x.confirmed, x.visits, locale),
          ] }))} />
      </Card>
      {exportNote(r)}
    </>
  )
}
