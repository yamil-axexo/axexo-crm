import { ProposedTag } from '@/ui/role-board'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getReportOptions } from '@/dal/reports'
import { USAGE_WEEKS, getUsage, metricOwners, teamBoardStreak } from '@/dal/reportes'
import { oneOnOnePeople, rolloutRule, usageExtra } from '@/dal/reportes2'
import { ActionForm, Submit } from '@/ui/client'
import { Field } from '@/ui/kit'
import { oneOnOneAction } from '../kam/actions'
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
  // reportes2 (GOB-03): colas atendidas y 1:1 con el tablero, y la regla de paso a despliegue como dato (propuesta hasta que la fijen).
  const [extra, rule, oooPeople] = await Promise.all([usageExtra(ctx, [...new Set(d.rows.map((r) => r.user_id))]), rolloutRule(ctx), ctx.can('one_on_one.record') ? oneOnOnePeople(ctx) : Promise.resolve([])])
  const ex = (id: string) => extra.find((x) => x.user_id === id)
  const streaks = await teamBoardStreak(ctx, rule.supervisor_weeks)
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.markets[0]?.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
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
          <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por equipo', 'By team')} hint={t('"Listo para ampliar" aplica la regla de paso a despliegue de abajo: semanas seguidas de tablero, 1:1 con cada persona en 30 días y comercios activos. Si falta algo, la fila dice qué.', '"Ready to expand" applies the rollout readiness rule below: weeks in a row of board use, a 1:1 with each person in 30 days and active merchants. If something is missing, the row says what.')} /></div>
          <DataTable testId="usage-team-table" label={t('Uso por equipo', 'Use by team')}
            head={[{ label: t('Equipo', 'Team') }, { label: t('Actividades, tendencia', 'Activities, trend') }, { label: t('Esta semana', 'This week'), num: true }, { label: t('Próximo paso al día', 'Next step up to date'), num: true }, { label: t('Leads a tiempo', 'Leads on time'), num: true }, { label: t('Supervisión usó el tablero', 'Supervisor used the board') }, { label: t('Señal', 'Signal') }]}
            rows={teams.map((tm) => {
              const rows = d.rows.filter((r) => r.team_id === tm.team_id)
              const w = sumWeeks(rows)
              const views = d.views.find((v) => v.team_id === tm.team_id)?.views ?? 0
              const out = d.outcome.find((o) => o.team_id === tm.team_id)
              // La misma regla que se muestra abajo (regla de paso a despliegue): semanas seguidas de tablero, 1:1 con cada
              // persona del equipo en 30 días y resultado (comercios activos). Una sola regla, no dos criterios.
              const streak = streaks.get(tm.team_id!) ?? 0
              const oneOnOnesOk = rows.every((r) => (ex(r.user_id)?.one_on_ones ?? 0) >= rule.one_on_ones_min)
              const ready = streak >= rule.supervisor_weeks && oneOnOnesOk && (out?.active ?? 0) > 0
              const missing = [
                streak < rule.supervisor_weeks ? t(`tablero ${streak} de ${rule.supervisor_weeks} semanas`, `board ${streak} of ${rule.supervisor_weeks} weeks`) : null,
                !oneOnOnesOk ? t('faltan 1:1', '1:1s missing') : null,
                (out?.active ?? 0) === 0 ? t('sin comercios activos', 'no active merchants') : null,
              ].filter(Boolean).join(', ')
              return { key: tm.team_id!, testId: 'usage-team-row', cells: [
                <span key="n" className="font-semibold">{tm.team_name}{multi ? ` · ${tm.market_code}` : ''}</span>,
                <Spark key="s" values={w} label={trend(w)} />, num(w[w.length - 1] ?? 0, locale),
                pct(rows.reduce((n, r) => n + r.step_ok, 0), rows.reduce((n, r) => n + r.open_deals, 0), locale),
                pct(rows.reduce((n, r) => n + r.leads_on_time, 0), rows.reduce((n, r) => n + r.leads_judged, 0), locale),
                views > 0 ? t(`Sí, ${views} ${views === 1 ? 'vez' : 'veces'} esta semana`, `Yes, ${views} ${views === 1 ? 'time' : 'times'} this week`) : t('Todavía no esta semana', 'Not yet this week'),
                <span key="r" data-testid="usage-signal"><Badge tone={ready ? 'good' : 'neutral'}>{ready ? t('Listo para ampliar', 'Ready to expand') : t('Todavía no', 'Not yet')}</Badge>{!ready && missing && <span className="mt-1 block text-[12.5px] text-muted-2" data-testid="usage-signal-missing">{missing}</span>}</span>,
              ] }
            })} />
          <div className="px-5 pb-4 md:px-7"><Def t={t} k="rollout" named owners={owners} /></div>
        </Card>
      )}

      <Card className="mt-6" data-testid="usage-rollout-rule">
        <CardTitle title={t('Regla de paso a despliegue', 'Rollout readiness rule')} right={rule.proposed ? <ProposedTag>{t(`Valor propuesto, [pendiente: ${rule.pending}]`, `Proposed value, [pending: ${rule.pending}]`)}</ProposedTag> : <Badge tone="good">{t('Fijada', 'Set')}</Badge>}
          hint={t(`Quien supervisa abre el tablero ${rule.supervisor_weeks} semanas seguidas, hace al menos ${rule.one_on_ones_min} 1:1 con el tablero en 30 días y el equipo tiene ${rule.result === 'active_30d' ? 'comercios activos a 30 días' : 'visitas por alta'}. Entrar a CONTIGO no cuenta.`, `The supervisor opens the board ${rule.supervisor_weeks} weeks in a row, holds at least ${rule.one_on_ones_min} 1:1 with the board in 30 days and the team has ${rule.result === 'active_30d' ? 'merchants active at 30 days' : 'visits per enrollment'}. Signing in does not count.`)} />
        {oooPeople.length > 0 && (
          <ActionForm action={oneOnOneAction} className="flex flex-wrap items-end gap-3" onOk="reset" testId="one-on-one-form">
            <Field label={t('1:1 con', '1:1 with')}><select name="person" className="input !h-11 !w-auto" required data-testid="one-on-one-person">{oooPeople.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
            <Field label={t('Fecha', 'Date')}><input type="date" name="held_on" className="input !h-11" defaultValue={todayIso} required data-testid="one-on-one-date" /></Field>
            <Field label={t('Nota (opcional)', 'Note (optional)')}><input name="note" className="input !h-11 !w-56" maxLength={300} /></Field>
            <Submit size="sm" testId="one-on-one-save">{t('Anotar 1:1 con el tablero', 'Log a 1:1 with the board')}</Submit>
          </ActionForm>
        )}
      </Card>

      <Card className="mt-6" pad={false} data-testid="adoption-list">
        <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Por persona', 'By person')} hint={<span>{t('Personas de ventas y supervisión: ', 'Sales and supervisor people: ')}<span className="num font-semibold text-strong" data-testid="adoption-people">{num(d.rows.length, locale)}</span></span>} /></div>
        <DataTable testId="usage-table" label={t('Uso por persona', 'Use by person')}
          empty={<div className="p-7 pt-0"><Empty title={t('Nadie con estos filtros', 'No one with these filters')} hint={t('Quita un filtro para ver a todo el equipo.', 'Remove a filter to see the whole team.')} /></div>}
          head={[{ label: t('Persona', 'Person') }, { label: t('Actividades, tendencia', 'Activities, trend') }, { label: t('Esta semana', 'This week'), num: true }, { label: t('Próximo paso al día', 'Next step up to date'), num: true }, { label: t('Leads a tiempo', 'Leads on time'), num: true }, { label: t('Avisos atendidos, 4 semanas', 'Notices handled, 4 weeks'), num: true }, { label: t('1:1 con el tablero, 30 días', '1:1s with the board, 30 days'), num: true }]}
          rows={d.rows.map((r) => ({ key: `${r.user_id}${r.market_code}`, testId: 'adoption-row', cells: [
            <span key="p"><span className="font-semibold">{r.full_name}</span><span className="block text-[12.5px] text-muted">{r.team_name ?? t('Sin equipo', 'No team')}{multi ? ` · ${r.market_code}` : ''}</span></span>,
            <Spark key="s" values={r.weeks} label={trend(r.weeks)} />, <span key="w" data-testid="adoption-week">{num(r.weeks[r.weeks.length - 1] ?? 0, locale)}</span>,
            r.open_deals > 0 ? `${pct(r.step_ok, r.open_deals, locale)} · ${r.step_ok}/${r.open_deals}` : t('Sin negocios abiertos', 'No open deals'),
            r.leads_judged > 0 ? `${pct(r.leads_on_time, r.leads_judged, locale)} · ${r.leads_on_time}/${r.leads_judged}` : t('Sin leads', 'No leads'),
            <span key="q" data-testid="adoption-queue">{num(ex(r.user_id)?.queue_done ?? 0, locale)}</span>, <span key="o" data-testid="adoption-1on1">{num(ex(r.user_id)?.one_on_ones ?? 0, locale)}</span>,
          ] }))} />
      </Card>
      <p className="mt-4 text-[13px] text-muted" data-testid="adoption-note">{t('Esta pantalla sirve para acompañar, no para señalar: si un número está bajo, primero pregunta qué le estorba a la persona. Aquí no se cuentan ingresos a CONTIGO ni se ve lo que cada quien escribió.', 'This screen is for coaching, not for pointing fingers: if a number is low, first ask what is getting in the person’s way. Sign-ins to CONTIGO are not counted here, and nothing anyone wrote is shown.')}</p>
    </>
  )
}
