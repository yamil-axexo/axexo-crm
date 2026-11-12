import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getAdoption } from '@/dal/reports'
import { resolvePeriod } from '@/lib/periods'
import { track } from '@/dal/boards'
import { ROLE_LABEL } from '@/domain/policy'
import { Card, CardTitle, Empty, PageHeader, Pills } from '@/ui/kit'
import { ReportFilters, periodText } from '@/ui/report'
import { dayTime, isoDay, num } from '@/lib/format'
import { zoneLabel } from '@/lib/audit'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { readerTimeZone } from '@/server/timezone'

const GRID = '@3xl:grid @3xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_110px_110px] @3xl:items-center @3xl:gap-4'

export default async function AdoptionPage({ searchParams }: { searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string; ver?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('adoption.read')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const tz = await readerTimeZone(ctx)
  // Los ingresos se cuentan por hora, así que el periodo se resuelve con el día de quien lee: es la misma zona en la que se muestran las horas.
  const period = resolvePeriod(sp.periodo, isoDay(new Date(), tz), sp.desde, sp.hasta, '30d')
  const all = await getAdoption(ctx, period, tz)
  await track(ctx, 'view.report.adoption')
  const never = all.filter((r) => !r.last_login)
  const entered = all.filter((r) => r.logins > 0)
  const view = sp.ver === 'nunca' ? 'nunca' : sp.ver === 'sin-uso' ? 'sin-uso' : ''
  const idle = all.filter((r) => r.last_login && r.logins === 0)
  const rows = view === 'nunca' ? never : view === 'sin-uso' ? idle : all
  const params = { periodo: period.key, desde: period.key === 'rango' ? period.from : undefined, hasta: period.key === 'rango' ? period.to : undefined, ver: view || undefined }
  const lbl = '@3xl:hidden text-muted'
  const stat = (label: string, value: number, id: string) => (
    <div className="card p-4 md:p-5"><p className="text-[13px] font-medium text-muted-2">{label}</p><p className="num mt-1.5 text-[26px] leading-9 font-semibold text-strong" data-testid={id}>{num(value, locale)}</p></div>
  )

  return (
    <>
      <PageHeader
        title={t('Adopción', 'Adoption')}
        desc={t('Quién entra a CONTIGO y cuánto lo usa. Solo conteos: cuándo entró y cuántas actividades registró, nunca lo que escribió. La ven leadership, quien lidera el mercado y administración.', 'Who signs in to CONTIGO and how much they use it. Counts only: when they signed in and how many activities they logged, never what they wrote. Leadership, market leads and administration see it.')}
      />
      <ReportFilters t={t} locale={locale} base="/reportes/adopcion" params={params} period={period} selects={[]} zone={zoneLabel(tz, locale)} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="adoption-totals">
        {stat(t('Personas con acceso', 'People with access'), all.length, 'adoption-people')}
        {stat(t('Entraron en el periodo', 'Signed in during the period'), entered.length, 'adoption-entered')}
        {stat(t('Con acceso y sin entrar en el periodo', 'With access, no sign-in in the period'), idle.length, 'adoption-idle')}
        {stat(t('Nunca han entrado', 'Never signed in'), never.length, 'adoption-never')}
      </div>
      <div className="mt-6 mb-4">
        <Pills label={t('Ver', 'Show')} current={view} items={[
          { key: '', href: qs('/reportes/adopcion', { ...params, ver: undefined }), label: t('Todas', 'Everyone'), count: all.length },
          { key: 'sin-uso', href: qs('/reportes/adopcion', { ...params, ver: 'sin-uso' }), label: t('Sin entrar en el periodo', 'No sign-in in the period'), count: idle.length },
          { key: 'nunca', href: qs('/reportes/adopcion', { ...params, ver: 'nunca' }), label: t('Nunca han entrado', 'Never signed in'), count: never.length },
        ]} />
      </div>
      <Card pad={false} className="@container" data-testid="adoption-list">
        <div className="px-5 pt-5 @3xl:px-7 @3xl:pt-6">
          <CardTitle title={t('Por persona', 'By person')} hint={t(`Ingresos y actividades ${periodText(t, locale, period)}. El último ingreso es el más reciente que existe, aunque sea de antes del periodo. Hora en ${zoneLabel(tz, locale)}.`, `Sign-ins and activities ${periodText(t, locale, period)}. The last sign-in is the most recent on record, even if it is from before the period. Time in ${zoneLabel(tz, locale)}.`)} />
        </div>
        {rows.length === 0 ? <div className="p-7 pt-0"><Empty title={t('Nadie en esta vista', 'Nobody in this view')} /></div> : (
          <>
            <div aria-hidden className={`hidden border-y border-line px-7 py-2.5 text-[13px] font-medium text-muted ${GRID}`}>
              <span>{t('Persona', 'Person')}</span><span>{t('Rol y equipo', 'Role and team')}</span><span>{t('Último ingreso', 'Last sign-in')}</span><span>{t('Ingresos', 'Sign-ins')}</span><span>{t('Actividades', 'Activities')}</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.user_id} className={`px-5 py-3.5 @3xl:px-7 ${GRID}`} data-testid="adoption-row">
                  <span className="block text-[15px] font-semibold text-strong [overflow-wrap:anywhere]" data-testid="adoption-name">{r.full_name}</span>
                  <span className="block text-[13.5px] text-muted-2">{[r.roles.map((x) => t(ROLE_LABEL[x].es, ROLE_LABEL[x].en)).join(', '), r.markets.join(', '), r.teams.join(', ')].filter(Boolean).join(' · ')}</span>
                  <span className="mt-1 block text-[14px] text-strong @3xl:mt-0" data-testid="adoption-last"><span className={lbl}>{t('Último ingreso: ', 'Last sign-in: ')}</span>{r.last_login ? dayTime(r.last_login, locale, tz) : <span className="font-semibold text-amber-text">{t('Nunca ha entrado', 'Never signed in')}</span>}</span>
                  <span className="num block text-[14px] text-strong" data-testid="adoption-logins"><span className={lbl}>{t('Ingresos en el periodo: ', 'Sign-ins in the period: ')}</span>{num(r.logins, locale)}</span>
                  <span className="num block text-[14px] text-strong" data-testid="adoption-activities"><span className={lbl}>{t('Actividades en el periodo: ', 'Activities in the period: ')}</span>{num(r.activities, locale)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <p className="mt-4 text-[13px] text-muted">{t('Una actividad es una nota, llamada, reunión, tarea, correo o visita que la persona registró a mano. Lo que llega solo de la Sales App, de los datos de ventas o de una importación no cuenta.', 'An activity is a note, call, meeting, task, email or visit the person logged by hand. Anything that arrives on its own from the Sales App, S5 or an import does not count.')}</p>
    </>
  )
}
