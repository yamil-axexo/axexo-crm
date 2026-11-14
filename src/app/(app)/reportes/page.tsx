import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { listDeliveries, listSavedReports } from '@/dal/reportes'
import { track } from '@/dal/boards'
import { getBoards } from '@/dal/coexistence'
import { GROUP_LABEL, REPORTS, VIEW_EN, reportByKey, type ReportDef } from '@/lib/report-catalog'
import { Badge, Card, CardTitle, Empty, PageHeader } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { dayTime } from '@/lib/format'
import { readerTimeZone } from '@/server/timezone'
import { deleteReportAction, scheduleReportAction, seenDeliveriesAction } from './actions'

export const dynamic = 'force-dynamic'

/** Reportes: la galería del producto, lo que cada quien guardó y lo que los reportes programados le dejaron. */
export default async function ReportsPage() {
  const ctx = await requireCtx()
  if (!ctx.can('report.gallery')) notFound()
  const { t, locale } = ctx
  const [saved, deliveries, tz, boards] = await Promise.all([listSavedReports(ctx), listDeliveries(ctx), readerTimeZone(ctx), getBoards(ctx)])
  await track(ctx, 'view.reportes')
  // "Negocios cerrados" lo ve quien tiene reportes o quien vende (los suyos).
  // reportes2: quien solo es de Finanzas ve sus reportes (los de Finanzas e Indicadores), no los de ventas.
  const financeOnly = ctx.memberships.every((m) => m.role === 'finance')
  const visible = REPORTS.filter((r) => (r.key === 'cerrados' ? ctx.can('report.view') || ctx.can('report.own') : ctx.can(r.cap)))
    .filter((r) => !financeOnly || r.group === 'finance' || r.key === 'indicadores')
  const groups = (Object.keys(GROUP_LABEL) as ReportDef['group'][]).map((g) => ({ g, items: visible.filter((r) => r.group === g) })).filter((x) => x.items.length > 0)
  const href = (s: { report: string; params: Record<string, string> }) => {
    const def = reportByKey(s.report)
    const sp = new URLSearchParams(s.params).toString()
    return def ? (sp ? `${def.path}?${sp}` : def.path) : '/reportes'
  }
  const unseen = deliveries.filter((d) => !d.seen_at).length
  const canOpen = (key: string) => visible.some((r) => r.key === key)
  const mine = saved.filter((s) => s.mine)
  const shared = saved.filter((s) => !s.mine && canOpen(s.report))
  const when: Record<string, string> = { daily: t('Cada día', 'Every day'), weekly: t('Cada semana', 'Every week') }

  return (
    <>
      <PageHeader title={t('Reportes', 'Reports')} desc={t('Los reportes de CONTIGO en un solo lugar. Cada quien ve lo de su alcance. Cada cifra dice cómo se calcula y quién responde por ella.', 'CONTIGO reports in one place. Everyone sees what is in their scope. Each figure says how it is calculated and who answers for it.')} />

      {deliveries.length > 0 && (
        <Card className="mb-6" data-testid="deliveries">
          <CardTitle title={t('Reportes que te llegaron', 'Reports delivered to you')} hint={unseen > 0 ? t(`${unseen} sin abrir.`, `${unseen} unopened.`) : undefined}
            right={unseen > 0 ? <ActionForm action={seenDeliveriesAction}><Submit variant="ghost" size="sm" testId="deliveries-seen">{t('Marcar como vistos', 'Mark as seen')}</Submit></ActionForm> : undefined} />
          <ul className="divide-y divide-line">
            {deliveries.slice(0, 8).map((d) => (
              <li key={d.id} className="py-3" data-testid="delivery">
                <Link href={d.href} className="text-[15px] font-semibold text-strong underline decoration-line-2 underline-offset-4">{d.title}</Link>
                {!d.seen_at && <span className="ml-2"><Badge tone="good">{t('Nuevo', 'New')}</Badge></span>}
                <p className="mt-0.5 text-[14px] text-muted-2">{d.body}</p>
                <p className="text-[12.5px] text-muted">{dayTime(d.created_at, locale, tz)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {boards.some((b) => b.reports.some((r) => canOpen(r.report))) && (
        <Card className="mb-6" data-testid="report-boards">
          <CardTitle title={t('Tableros', 'Boards')} hint={t('Cada tablero junta los reportes que se revisan juntos. Los de US vienen de los tableros que el equipo tenía en Pipedrive.', 'Each board gathers the reports that are reviewed together. The US ones come from the boards the team had in Pipedrive.')} />
          <div className="grid gap-4 md:grid-cols-2">
            {boards.filter((b) => b.reports.some((r) => canOpen(r.report))).map((b) => (
              <section key={b.id} id={`tablero-${b.key}`} className="rounded-[14px] border border-line-2 p-4" data-testid="report-board" data-key={b.key}>
                <h3 className="mb-2 text-[15px] font-semibold text-strong">{t(b.name_es, b.name_en)}</h3>
                <ul className="space-y-1.5">
                  {b.reports.filter((r) => canOpen(r.report)).map((r) => (
                    <li key={r.id}><Link href={href(r)} className="inline-flex min-h-11 items-center text-[14px] text-strong underline decoration-line-2 underline-offset-4 [overflow-wrap:anywhere]" data-testid="board-report">{t(r.name, VIEW_EN[r.name] ?? r.name)}</Link></li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-6" data-testid="my-reports" id="guardados">
        <CardTitle title={t('Mis reportes', 'My reports')} hint={t('Un reporte guardado abre con el periodo y los filtros con que lo guardaste.', 'A saved report opens with the period and filters you saved it with.')} />
        {mine.length + shared.length === 0 ? (
          <Empty title={t('Todavía no guardas ningún reporte', 'You have not saved any report yet')} hint={t('Abre un reporte de la lista de abajo, pon el periodo y los filtros que usas siempre y toca "Guardar reporte".', 'Open a report from the list below, set the period and filters you always use and tap "Save report".')} />
        ) : (
          <ul className="divide-y divide-line">
            {[...mine, ...shared].map((s) => {
              const def = reportByKey(s.report)
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3" data-testid="saved-report" data-name={s.name}>
                  <div className="min-w-0">
                    <Link href={href(s)} className="text-[15px] font-semibold text-strong underline decoration-line-2 underline-offset-4 [overflow-wrap:anywhere]" data-testid="saved-report-link">{t(s.name, VIEW_EN[s.name] ?? s.name)}</Link>
                    <p className="text-[13px] text-muted">
                      {def ? t(def.title[0], def.title[1]) : s.report}
                      {s.is_shared ? ` · ${s.mine ? t('compartido con tu equipo', 'shared with your team') : t(`lo compartió ${s.owner_name}`, `shared by ${String(s.owner_name ?? '').replace(' (sistema)', ' (system)')}`)}` : ` · ${t('solo tú lo ves', 'only you see it')}`}
                      {s.schedule ? ` · ${when[s.schedule]}` : ''}
                    </p>
                  </div>
                  {s.mine && (
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionForm action={scheduleReportAction} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={s.id} />
                        <select name="schedule" defaultValue={s.schedule ?? ''} className="input !h-11 !w-auto" aria-label={t(`Programar "${s.name}"`, `Schedule "${s.name}"`)} data-testid="saved-report-schedule">
                          <option value="">{t('Sin programar', 'Not scheduled')}</option><option value="daily">{when.daily}</option><option value="weekly">{when.weekly}</option>
                        </select>
                        <Submit variant="ghost" size="sm" testId="saved-report-schedule-save">{t('Aplicar', 'Apply')}</Submit>
                      </ActionForm>
                      <ActionForm action={deleteReportAction}><input type="hidden" name="id" value={s.id} /><Submit variant="quiet" size="sm" testId="saved-report-delete">{t('Borrar', 'Delete')}</Submit></ActionForm>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {groups.map(({ g, items }) => (
        <section key={g} className="mb-7" aria-labelledby={`g-${g}`} data-testid={`gallery-${g}`}>
          <h2 id={`g-${g}`} className="mb-3 text-[17px] font-semibold text-strong">{t(GROUP_LABEL[g][0], GROUP_LABEL[g][1])}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((r) => (
              <li key={r.key}>
                <Link href={r.path} className="card press block h-full p-5 hover:border-brand" data-testid={`report-${r.key}`}>
                  <span className="block text-[16px] font-semibold text-strong">{r.key === 'cerrados' && !ctx.can('report.view') ? t('Mis negocios cerrados', 'My closed deals') : t(r.title[0], r.title[1])}</span>
                  <span className="mt-1 block text-[14px] text-muted-2">{t(r.desc[0], r.desc[1])}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-[13px] text-muted">{t('¿Falta un reporte? Aquí no se arman reportes libres a propósito: así cada cifra tiene una sola definición. Pídelo con "Reportar un problema" y se agrega a esta lista.', 'Is a report missing? Free-form reports are left out here on purpose, so each figure has a single definition. Ask for it with "Report a problem" and it gets added to this list.')}</p>
    </>
  )
}
