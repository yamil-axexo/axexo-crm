import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getReportOptions } from '@/dal/reports'
import { USAGE_WEEKS, getUsage, metricOwners } from '@/dal/reportes'
import { track } from '@/dal/boards'
import { Badge, Card, CardTitle, Empty, PageHeader } from '@/ui/kit'
import { Def, Metric, ReportFilters } from '@/ui/report'
import { BackToReports, DataTable, Spark } from '@/ui/reportes'
import { num, pct } from '@/lib/format'
import { flat } from '@/server/params'
import { reportFilters, reportSelects, type ReportParams } from '../params'

export const dynamic = 'force-dynamic'

/**
 * GOB-03: adopción medida con uso real, no con ingresos. Actividades registradas, próximo paso al día y leads atendidos a
 * tiempo, por persona y por equipo, con tendencia semanal. Supervisión ve a su equipo. Entrar a CONTIGO no cuenta.
 */
export default async function AdoptionPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  const ctx = await requireCtx()
  if (!ctx.can('adoption.team')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const options = await getReportOptions(ctx)
  const f = reportFilters(sp, options)
  const [d, owners] = await Promise.all([getUsage(ctx, { market: f.market, team: f.team }), metricOwners(ctx)])
  await track(ctx, 'view.report.adoption')
  const sel = reportSelects(t, options, f)
  const multi = options.markets.length > 1
  const sumWeeks = (rows: typeof d.rows) => Array.from({ length: USAGE_WEEKS }, (_, i) => rows.reduce((n, r) => n + (r.weeks[i] ?? 0), 0))
  const all = sumWeeks(d.rows)
  const thisWeek = all[all.length - 1] ?? 0
  const open = d.rows.reduce((n, r) => n + r.open_deals, 0), ok = d.rows.reduce((n, r) => n + r.step_ok, 0)
  const judged = d.rows.reduce((n, r) => n + r.leads_judged, 0), onTime = d.rows.reduce((n, r) => n + r.leads_on_time, 0)
  const teams = [...new Map(d.rows.filter((r) => r.team_id).map((r) => [r.team_id!, r])).values()]
  const trend = (w: number[]) => t(`Últimas ${USAGE_WEEKS} semanas: ${w.join(', ')}`, `Last ${USAGE_WEEKS} weeks: ${w.join(', ')}`)
  return (
    <>
      <BackToReports t={t} />
      <PageHeader title={t('Adopción', 'Adoption')} desc={t('Uso real de CONTIGO: lo que el equipo deja registrado y mantiene al día. Entrar a la herramienta no cuenta; registrar el trabajo, sí.', 'Real use of CONTIGO: what the team logs and keeps up to date. Signing in does not count; logging the work does.')} />
      <ReportFilters t={t} locale={locale} base="/reportes/adopcion" params={{ mercado: f.market, equipo: f.team }} selects={[sel.market, sel.team]} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="usage-totals">
        <Metric t={t} k="useActivities" value={num(thisWeek, locale)} hint={t('Esta semana.', 'This week.')} owners={owners} testId="usage-activities" />
        <Metric t={t} k="useNextStep" value={pct(ok, open, locale)} hint={t(`${num(ok, locale)} de ${num(open, locale)} negocios abiertos.`, `${num(ok, locale)} of ${num(open, locale)} open deals.`)} owners={owners} testId="usage-next-step" />
        <Metric t={t} k="useLeads" value={pct(onTime, judged, locale)} hint={t(`${num(onTime, locale)} de ${num(judged, locale)} leads.`, `${num(onTime, locale)} of ${num(judged, locale)} leads.`)} owners={owners} testId="usage-leads" />
      </div>
      <Card className="mt-6" data-testid="usage-trend">
        <CardTitle title={t('Actividades registradas por semana', 'Activities logged by week')} hint={trend(all)} />
        <Spark values={all} label={trend(all)} width={320} height={64} testId="usage-trend-chart" />
      </Card>

      {teams.length > 0 && (
        <Card className="mt-6" pad={false} data-testid="usage-teams">
          <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por equipo', 'By team')} hint={t('"Listo para ampliar" junta dos cosas: quien supervisa abrió el tablero de su equipo esta semana, y el equipo ya tiene comercios activos.', '"Ready to expand" puts two things together: the supervisor opened the team board this week, and the team already has active merchants.')} /></div>
          <DataTable testId="usage-team-table" label={t('Uso por equipo', 'Use by team')}
            head={[{ label: t('Equipo', 'Team') }, { label: t('Actividades, tendencia', 'Activities, trend') }, { label: t('Esta semana', 'This week'), num: true }, { label: t('Próximo paso al día', 'Next step up to date'), num: true }, { label: t('Leads a tiempo', 'Leads on time'), num: true }, { label: t('Supervisión usó el tablero', 'Supervisor used the board') }, { label: t('Señal', 'Signal') }]}
            rows={teams.map((tm) => {
              const rows = d.rows.filter((r) => r.team_id === tm.team_id)
              const w = sumWeeks(rows)
              const views = d.views.find((v) => v.team_id === tm.team_id)?.views ?? 0
              const out = d.outcome.find((o) => o.team_id === tm.team_id)
              const ready = views > 0 && (out?.active ?? 0) > 0
              return { key: tm.team_id!, testId: 'usage-team-row', cells: [
                <span key="n" className="font-semibold">{tm.team_name}{multi ? ` · ${tm.market_code}` : ''}</span>,
                <Spark key="s" values={w} label={trend(w)} />, num(w[w.length - 1] ?? 0, locale),
                pct(rows.reduce((n, r) => n + r.step_ok, 0), rows.reduce((n, r) => n + r.open_deals, 0), locale),
                pct(rows.reduce((n, r) => n + r.leads_on_time, 0), rows.reduce((n, r) => n + r.leads_judged, 0), locale),
                views > 0 ? t(`Sí, ${views} ${views === 1 ? 'vez' : 'veces'} esta semana`, `Yes, ${views} ${views === 1 ? 'time' : 'times'} this week`) : t('Todavía no esta semana', 'Not yet this week'),
                <span key="r" data-testid="usage-signal"><Badge tone={ready ? 'good' : 'neutral'}>{ready ? t('Listo para ampliar', 'Ready to expand') : t('Todavía no', 'Not yet')}</Badge></span>,
              ] }
            })} />
          <div className="px-5 pb-4 md:px-7"><Def t={t} k="rollout" named owners={owners} /></div>
        </Card>
      )}

      <Card className="mt-6" pad={false} data-testid="adoption-list">
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por persona', 'By person')} hint={<span>{t('Personas de ventas y supervisión: ', 'Sales and supervisor people: ')}<span className="num font-semibold text-strong" data-testid="adoption-people">{num(d.rows.length, locale)}</span></span>} /></div>
        <DataTable testId="usage-table" label={t('Uso por persona', 'Use by person')}
          empty={<div className="p-7 pt-0"><Empty title={t('Nadie con estos filtros', 'No one with these filters')} hint={t('Quita un filtro para ver a todo el equipo.', 'Remove a filter to see the whole team.')} /></div>}
          head={[{ label: t('Persona', 'Person') }, { label: t('Actividades, tendencia', 'Activities, trend') }, { label: t('Esta semana', 'This week'), num: true }, { label: t('Próximo paso al día', 'Next step up to date'), num: true }, { label: t('Leads a tiempo', 'Leads on time'), num: true }]}
          rows={d.rows.map((r) => ({ key: `${r.user_id}${r.market_code}`, testId: 'adoption-row', cells: [
            <span key="p"><span className="font-semibold">{r.full_name}</span><span className="block text-[12.5px] text-muted">{r.team_name ?? t('Sin equipo', 'No team')}{multi ? ` · ${r.market_code}` : ''}</span></span>,
            <Spark key="s" values={r.weeks} label={trend(r.weeks)} />, <span key="w" data-testid="adoption-week">{num(r.weeks[r.weeks.length - 1] ?? 0, locale)}</span>,
            r.open_deals > 0 ? `${pct(r.step_ok, r.open_deals, locale)} · ${r.step_ok}/${r.open_deals}` : t('Sin negocios abiertos', 'No open deals'),
            r.leads_judged > 0 ? `${pct(r.leads_on_time, r.leads_judged, locale)} · ${r.leads_on_time}/${r.leads_judged}` : t('Sin leads', 'No leads'),
          ] }))} />
      </Card>
      <p className="mt-4 text-[13px] text-muted" data-testid="adoption-note">{t('Esta pantalla sirve para acompañar, no para señalar: si un número está bajo, primero pregunta qué le estorba a la persona. Aquí no se cuentan ingresos a CONTIGO ni se ve lo que cada quien escribió.', 'This screen is for coaching, not for pointing fingers: if a number is low, first ask what is getting in the person’s way. Sign-ins to CONTIGO are not counted here, and nothing anyone wrote is shown.')}</p>
    </>
  )
}
