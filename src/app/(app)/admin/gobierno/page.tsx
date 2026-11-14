import { screenLabel } from '@/lib/screens'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { env } from '@/env'
import { readerTimeZone } from '@/server/timezone'
import { flat } from '@/server/params'
import {
  allConfigRequests, components, configChanges, costBoard, dataRegions, deployments, incidents, maintenance, materials, releases, restoreTests,
  serviceBoard, teamChampions, testData, type Measured,
} from '@/dal/gobierno'
import { COST_COMPONENTS, MATERIAL_KINDS, missingItems, SEVERITIES } from '@/domain/gobierno-ops'
import { RELEASE_CHECKLIST } from '@/content/release-checklist'
import { gobiernoAdapterStatus } from '@/server/gobierno-status'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, Stat, Table, buttonClass } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { actionLabel, zoneLabel } from '@/lib/audit'
import { day, dayTime, isoDay, num } from '@/lib/format'
import { qs } from '@/lib/labels'
import {
  COMPONENT_LABEL, INCIDENT_STATUS_LABEL, MATERIAL_LABEL, OBJECTIVE_LABEL, REQUEST_KIND_LABEL, REQUEST_STATUS_LABEL, SEVERITY_LABEL, monthLabel, msText, usd,
} from '@/lib/gobierno-labels'
import {
  addCostAction, annotateChangeAction, announceReleaseAction, checkReleaseItemAction, createReleaseAction, decideRequestAction, markReleasedAction,
  openIncidentAction, recordChampionReviewAction, recordDeploymentAction, recordRestoreTestAction, removeMaterialAction, saveMaterialAction,
  scheduleMaintenanceAction, setChampionAction, setComponentOwnersAction, setMaintenanceStatusAction, setObjectiveAction, updateIncidentAction, voidCostAction,
} from './actions'

export const dynamic = 'force-dynamic'

const TABS = ['servicio', 'versiones', 'costos', 'datos', 'cambios'] as const
type Tab = (typeof TABS)[number]

/**
 * Gobierno de CONTIGO: cómo está el servicio, quién responde por cada pieza, qué versión salió y con qué lista, cuánto cuesta,
 * de dónde salen los datos de este ambiente, y qué se pidió y por qué se cambió. Lo leen administración y leadership;
 * escribe administración. Lo que nadie ha fijado dice "Por definir": aquí no se inventa un valor.
 */
export default async function GovernancePage({ searchParams }: { searchParams: Promise<{ tab?: string; ref?: string; motivo?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('gov.read')) notFound()
  const { t, locale } = ctx
  const manage = ctx.can('gov.manage')
  const sp = flat(await searchParams)
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'servicio'
  const tz = await readerTimeZone(ctx)
  const today = isoDay(new Date(), tz)
  const labels: Record<Tab, string> = {
    servicio: t('Servicio', 'Service'), versiones: t('Versiones y responsables', 'Releases and owners'), costos: t('Costos', 'Costs'),
    datos: t('Datos de prueba', 'Test data'), cambios: t('Solicitudes y cambios', 'Requests and changes'),
  }
  const pending = <Badge tone="warn">{t('Por definir', 'To be defined')}</Badge>
  const when = (d: Date | string | null) => (d ? dayTime(d, locale, tz) : t('s/d', 'n/a'))
  const marketSelect = (testId: string, all: string) => (
    <select name="market" className="input" defaultValue="" data-testid={testId}>
      <option value="">{all}</option>
      {ctx.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
    </select>
  )

  return (
    <>
      <p className="mb-3"><Link href="/admin" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="gov-back">{t('Volver a Administración', 'Back to Administration')}</Link></p>
      <PageHeader eyebrow={t('Administración', 'Administration')} title={t('Gobierno', 'Governance')}
        desc={t('Cómo está el servicio, quién responde por cada pieza, qué salió en cada versión, cuánto cuesta operar y qué se pidió cambiar. Lo que nadie ha fijado dice "Por definir".', 'How the service is doing, who answers for each piece, what went out in each release, what it costs to run and what was asked to change. Whatever nobody has set says "To be defined".')} />
      <div className="mb-6"><Pills label={t('Secciones de Gobierno', 'Governance sections')} current={tab} items={TABS.map((k) => ({ key: k, href: qs('/admin/gobierno', { tab: k }), label: labels[k] }))} /></div>
      {!manage && <p role="status" className="mb-6 rounded-[14px] bg-surface-2 px-5 py-4 text-[14px] text-muted-2" data-testid="gov-read-only">{t('Tu rol lee esta pantalla y no cambia nada. Los registros los lleva administración.', 'Your role reads this screen and changes nothing. Administration keeps the records.')}</p>}
      <p className="mb-6 text-[13px] text-muted-2">{t(`Las horas están en ${zoneLabel(tz, locale)}.`, `Times are in ${zoneLabel(tz, locale)}.`)}</p>
      {tab === 'servicio' && <Service />}
      {tab === 'versiones' && <Releases />}
      {tab === 'costos' && <Costs />}
      {tab === 'datos' && <TestData />}
      {tab === 'cambios' && <Changes />}
    </>
  )

  // ------------------------------------------------------------------ Servicio (GOB-07)
  async function Service() {
    const [board, inc, tests, regions] = await Promise.all([serviceBoard(ctx, 30, sp.ref ?? ''), incidents(ctx), restoreTests(ctx), dataRegions(ctx)])
    const measured: Record<string, { value: string; n: number; ok: boolean | null }> = {}
    for (const o of board.objectives.filter((x) => x.kind === 'slo')) {
      if (o.key === 'availability') measured[o.key] = { value: board.availability === null ? t('Sin mediciones todavía', 'No measurements yet') : `${board.availability}%`, n: board.total, ok: o.target === null || board.availability === null ? null : board.availability >= o.target }
      else {
        const m: Measured = o.key === 'latency_page' ? board.page : o.key === 'latency_action' ? board.action : board.api
        measured[o.key] = { value: msText(t, m.p95), n: m.n, ok: o.target === null || m.p95 === null ? null : m.p95 <= o.target }
      }
    }
    const lastOk = tests.find((x) => x.result === 'ok')
    return (
      <div className="space-y-8" data-testid="gov-service">
        <Card pad={false} data-testid="slo-board">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Objetivos de servicio, últimos 30 días', 'Service objectives, last 30 days')} hint={t('Lo medido sale de CONTIGO: cada pantalla que se abre, cada cambio que se guarda y cada llamada a la API suman. El objetivo lo fija una persona.', 'What is measured comes from CONTIGO: every screen opened, every change saved and every API call counts. A person sets the objective.')} /></div>
          <Table label={t('Objetivos de servicio', 'Service objectives')} head={<><th>{t('Qué se mide', 'What is measured')}</th><th>{t('Medido', 'Measured')}</th><th>{t('Objetivo', 'Objective')}</th><th>{t('Estado', 'Status')}</th>{manage && <th className="relative"><span className="sr-only">{t('Fijar', 'Set')}</span></th>}</>}>
            {board.objectives.filter((o) => o.kind === 'slo').map((o) => {
              const m = measured[o.key]!
              const unit = o.key === 'availability' ? '%' : ' ms'
              return (
                <tr key={o.key} className="table-row" data-testid={`slo-${o.key}`}>
                  <td><span className="block font-semibold text-strong">{t(...OBJECTIVE_LABEL[o.key]!.label)}</span><span className="text-[12.5px] text-muted-2">{t(...OBJECTIVE_LABEL[o.key]!.hint)}</span></td>
                  <td className="num" data-testid="slo-measured">{m.value}<span className="block text-[12.5px] text-muted-2">{t(`${num(m.n, locale)} mediciones`, `${num(m.n, locale)} measurements`)}</span></td>
                  <td className="num" data-testid="slo-target">{o.target === null ? pending : `${o.key === 'availability' ? '≥' : '≤'} ${num(o.target, locale)}${unit}`}</td>
                  <td data-testid="slo-status">{m.ok === null ? <Badge>{o.target === null ? t('Sin objetivo', 'No objective') : t('Sin mediciones', 'No measurements')}</Badge> : m.ok ? <Badge tone="good">{t('Se cumple', 'Met')}</Badge> : <Badge tone="bad">{t('No se cumple', 'Not met')}</Badge>}</td>
                  {manage && (
                    <td className="text-right">
                      <Dialog trigger={t('Fijar', 'Set')} title={t(`Fijar: ${OBJECTIVE_LABEL[o.key]!.label[0]}`, `Set: ${OBJECTIVE_LABEL[o.key]!.label[1]}`)} size="sm" testId={`slo-set-${o.key}`}>
                        <ActionForm action={setObjectiveAction} onOk="close" className="space-y-4 text-left">
                          <input type="hidden" name="key" value={o.key} />
                          <Field label={o.key === 'availability' ? t('Objetivo, en porcentaje', 'Objective, as a percentage') : t('Objetivo, en milisegundos', 'Objective, in milliseconds')} hint={t('El valor lo decide quien responde por el servicio. CONTIGO no propone uno.', 'Whoever answers for the service decides the value. CONTIGO does not suggest one.')}>
                            <input name="target" inputMode="decimal" required className="input !w-40" defaultValue={o.target ?? ''} data-testid="slo-target-input" />
                          </Field>
                          <div className="flex justify-end"><Submit testId="slo-save">{t('Guardar objetivo', 'Save objective')}</Submit></div>
                        </ActionForm>
                      </Dialog>
                    </td>
                  )}
                </tr>
              )
            })}
          </Table>
        </Card>

        <Card pad={false} data-testid="slo-screens">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Tiempo de respuesta por pantalla', 'Response time per screen')} hint={t('Medido en el navegador de cada persona: de que pide la pantalla a que la tiene. El 95% de las veces tardó eso o menos.', 'Measured in each person’s browser: from asking for the screen to having it. 95% of the time it took that long or less.')} /></div>
          {board.screens.length === 0 ? (
            <div className="px-5 pb-6 md:px-7"><Empty title={t('Todavía no hay mediciones', 'No measurements yet')} hint={t('Aparecen solas en cuanto el equipo usa CONTIGO en este ambiente.', 'They show up on their own as soon as the team uses CONTIGO in this environment.')} /></div>
          ) : (
            <Table label={t('Tiempo por pantalla', 'Time per screen')} head={<><th>{t('Pantalla', 'Screen')}</th><th>{t('Veces', 'Times')}</th><th>{t('Promedio', 'Average')}</th><th>{t('95% de las veces', '95% of the time')}</th></>}>
              {board.screens.map((s) => (
                <tr key={s.screen} className="table-row" data-testid="slo-screen-row">
                  {/* El nombre con el que el equipo conoce la pantalla; la ruta técnica queda en data-route para quien la busque. */}
                  <td className="text-[13.5px] text-strong" data-route={s.screen}>{screenLabel(t, s.screen.split(': ').pop())}</td>
                  <td className="num">{num(s.n, locale)}</td>
                  <td className="num">{num(s.avg_ms, locale)} ms</td>
                  <td className="num">{msText(t, s.p95)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card data-testid="error-log">
          <CardTitle title={t('Errores de los últimos 30 días', 'Errors in the last 30 days')} hint={t('Cada error inesperado deja su referencia: la misma que ve la persona en el mensaje y la que queda en la bitácora. No se guarda el mensaje ni los datos.', 'Every unexpected error leaves its reference: the same one the person sees in the message and the one kept in the audit log. Neither the message nor the data is stored.')}
            right={<span className="text-[13px] text-muted-2" data-testid="error-count">{t(`${num(board.errorCount, locale)} en total`, `${num(board.errorCount, locale)} in total`)}</span>} />
          <form method="get" action="/admin/gobierno" className="mb-4 flex flex-wrap items-end gap-3" data-testid="error-search">
            <input type="hidden" name="tab" value="servicio" />
            <Field label={t('Buscar por referencia', 'Search by reference')}><input name="ref" className="input !w-56" defaultValue={sp.ref ?? ''} maxLength={40} data-testid="error-ref" /></Field>
            <button className={buttonClass('ghost')} data-testid="error-find">{t('Buscar', 'Search')}</button>
          </form>
          {board.errors.length === 0 ? (
            <Empty title={sp.ref ? t('Ningún error con esa referencia', 'No error with that reference') : t('Sin errores registrados', 'No errors recorded')} hint={t('Cuando alguien te pase una referencia, búscala aquí y en Auditoría.', 'When someone gives you a reference, look for it here and in Audit.')} />
          ) : (
            <ul>
              {board.errors.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="error-row">
                  <span className="min-w-0"><code className="text-[13px] font-semibold text-strong" data-testid="error-row-ref">{(e.request_id ?? '').replace(/-/g, '').slice(0, 8) || t('s/d', 'n/a')}</code> <span className="text-muted-2">{e.screen} · {e.name}{e.code ? ` (${e.code})` : ''}</span></span>
                  <span className="text-[13px] text-muted-2">{when(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card data-testid="incidents">
          <CardTitle title={t('Incidentes', 'Incidents')} hint={t('Qué pasó, a quién afectó, por qué y qué se hizo. Un incidente no se cierra sin su causa.', 'What happened, who it affected, why and what was done. An incident is not closed without its cause.')}
            right={manage && (
              <Dialog trigger={t('Abrir incidente', 'Open incident')} title={t('Abrir un incidente', 'Open an incident')} variant="primary" testId="incident-new">
                <ActionForm action={openIncidentAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                  <Field label={t('Qué pasó', 'What happened')} className="col-span-2"><input name="title" className="input" required minLength={5} maxLength={160} data-testid="incident-title" /></Field>
                  <Field label={t('Gravedad', 'Severity')}><select name="severity" className="input" defaultValue="medium" data-testid="incident-severity">{SEVERITIES.map((s) => <option key={s} value={s}>{t(...SEVERITY_LABEL[s]!)}</option>)}</select></Field>
                  <Field label={t('Mercado', 'Market')}>{marketSelect('incident-market', t('Todos', 'All'))}</Field>
                  <Field label={t('Cuándo empezó', 'When it started')} className="col-span-2 sm:col-span-1"><input name="started_at" type="datetime-local" className="input" required data-testid="incident-started" /></Field>
                  <Field label={t('Referencia del error (opcional)', 'Error reference (optional)')} className="col-span-2 sm:col-span-1"><input name="request_id" className="input" maxLength={80} /></Field>
                  <Field label={t('A quién afectó y cómo', 'Who it affected and how')} className="col-span-2"><textarea name="impact" rows={3} className="input !h-auto py-3" required minLength={5} maxLength={2000} data-testid="incident-impact" /></Field>
                  <div className="col-span-2 flex justify-end"><Submit testId="incident-save">{t('Abrir incidente', 'Open incident')}</Submit></div>
                </ActionForm>
              </Dialog>
            )} />
          {inc.length === 0 ? (
            <Empty title={t('Ningún incidente registrado', 'No incidents recorded')} hint={t('Cuando algo afecte al equipo, ábrelo aquí para que quede qué pasó y qué se hizo.', 'When something affects the team, open it here so what happened and what was done stays on record.')} />
          ) : (
            <ul>
              {inc.map((i) => (
                <li key={i.id} className="border-t border-line py-4 first:border-t-0" data-testid="incident-row" data-status={i.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={i.status === 'closed' ? 'good' : i.status === 'mitigated' ? 'info' : 'bad'}>{t(...INCIDENT_STATUS_LABEL[i.status]!)}</Badge>
                    <Badge tone={i.severity === 'high' ? 'bad' : i.severity === 'medium' ? 'warn' : 'neutral'}>{t(...SEVERITY_LABEL[i.severity]!)}</Badge>
                    <span className="text-[15px] font-semibold text-strong">{i.title}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted-2">{t(`Empezó: ${when(i.started_at)}`, `Started: ${when(i.started_at)}`)}{i.resolved_at ? t(` · Resuelto: ${when(i.resolved_at)}`, ` · Resolved: ${when(i.resolved_at)}`) : ''} · {i.market_code ?? t('Todos los mercados', 'All markets')} · {i.created_by_name}</p>
                  <p className="mt-2 text-[14px] whitespace-pre-wrap text-strong">{i.impact}</p>
                  {i.cause && <p className="mt-2 text-[14px] whitespace-pre-wrap text-strong"><span className="font-semibold">{t('Causa: ', 'Cause: ')}</span>{i.cause}</p>}
                  {i.actions && <p className="mt-1 text-[14px] whitespace-pre-wrap text-strong"><span className="font-semibold">{t('Qué se hizo: ', 'What was done: ')}</span>{i.actions}</p>}
                  {manage && i.status !== 'closed' && (
                    <div className="mt-3">
                      <Dialog trigger={t('Actualizar', 'Update')} title={t('Actualizar el incidente', 'Update the incident')} size="sm" testId="incident-update">
                        <ActionForm action={updateIncidentAction} onOk="close" className="space-y-4 text-left">
                          <input type="hidden" name="id" value={i.id} />
                          <Field label={t('Estado', 'Status')}><select name="status" className="input" defaultValue="closed" data-testid="incident-status"><option value="mitigated">{t(...INCIDENT_STATUS_LABEL.mitigated!)}</option><option value="closed">{t(...INCIDENT_STATUS_LABEL.closed!)}</option></select></Field>
                          <Field label={t('Cuándo se resolvió', 'When it was resolved')}><input name="resolved_at" type="datetime-local" className="input" data-testid="incident-resolved" /></Field>
                          <Field label={t('Causa', 'Cause')}><textarea name="cause" rows={2} className="input !h-auto py-3" maxLength={2000} defaultValue={i.cause ?? ''} data-testid="incident-cause" /></Field>
                          <Field label={t('Qué se hizo y qué se cambia para que no se repita', 'What was done and what changes so it does not happen again')}><textarea name="actions" rows={2} className="input !h-auto py-3" maxLength={2000} defaultValue={i.actions ?? ''} data-testid="incident-actions" /></Field>
                          <div className="flex justify-end"><Submit testId="incident-update-save">{t('Guardar', 'Save')}</Submit></div>
                        </ActionForm>
                      </Dialog>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card pad={false} data-testid="recovery">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Respaldo y recuperación', 'Backup and recovery')} hint={t('El respaldo y la restauración son de la plataforma donde corre CONTIGO. Aquí queda lo acordado y la evidencia de cada prueba. Sin acuerdo, dice "Por definir".', 'Backup and restore belong to the platform CONTIGO runs on. What was agreed and the evidence of each test are kept here. With no agreement, it says "To be defined".')} /></div>
          <Table label={t('Objetivos de recuperación', 'Recovery objectives')} head={<><th>{t('Objetivo', 'Objective')}</th><th>{t('Acordado', 'Agreed')}</th><th>{t('Quién y cuándo', 'Who and when')}</th>{manage && <th className="relative"><span className="sr-only">{t('Fijar', 'Set')}</span></th>}</>}>
            {board.objectives.filter((o) => o.kind === 'recovery').map((o) => (
              <tr key={o.key} className="table-row" data-testid={`recovery-${o.key}`}>
                <td><span className="block font-semibold text-strong">{t(...OBJECTIVE_LABEL[o.key]!.label)}</span><span className="text-[12.5px] text-muted-2">{t(...OBJECTIVE_LABEL[o.key]!.hint)}</span></td>
                <td className="num" data-testid="recovery-target">{o.target === null ? pending : o.key === 'restore_test_days' ? t(`cada ${num(o.target, locale)} días`, `every ${num(o.target, locale)} days`) : t(`${num(o.target, locale)} minutos`, `${num(o.target, locale)} minutes`)}</td>
                <td className="text-[13.5px] text-muted-2">{o.target === null ? t('Pendiente: Dan Mulligan (CPTO)', 'Pending: Dan Mulligan (CPTO)') : `${o.agreed_by ?? ''} · ${o.agreed_on ? day(o.agreed_on, locale) : ''}`}</td>
                {manage && (
                  <td className="text-right">
                    <Dialog trigger={t('Fijar', 'Set')} title={t(`Fijar: ${OBJECTIVE_LABEL[o.key]!.label[0]}`, `Set: ${OBJECTIVE_LABEL[o.key]!.label[1]}`)} size="sm" testId={`recovery-set-${o.key}`}>
                      <ActionForm action={setObjectiveAction} onOk="close" className="space-y-4 text-left">
                        <input type="hidden" name="key" value={o.key} />
                        <Field label={o.key === 'restore_test_days' ? t('Cada cuántos días se prueba', 'Every how many days it is tested') : t('Minutos', 'Minutes')}><input name="target" inputMode="numeric" required className="input !w-40" defaultValue={o.target ?? ''} data-testid="recovery-target-input" /></Field>
                        <Field label={t('Quién lo acordó', 'Who agreed to it')} hint={t('Nombre completo de quien firmó el acuerdo.', 'Full name of whoever signed the agreement.')}><input name="agreed_by" className="input" required minLength={2} maxLength={120} defaultValue={o.agreed_by ?? ''} data-testid="recovery-agreed-by" /></Field>
                        <Field label={t('En qué fecha', 'On which date')}><input name="agreed_on" type="date" className="input" required max={today} defaultValue={o.agreed_on ?? ''} data-testid="recovery-agreed-on" /></Field>
                        <div className="flex justify-end"><Submit testId="recovery-save">{t('Guardar', 'Save')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  </td>
                )}
              </tr>
            ))}
          </Table>
          <div className="border-t border-line px-5 py-6 md:px-7" data-testid="restore-tests">
            <CardTitle title={t('Pruebas de restauración', 'Restore tests')} hint={t('La prueba la hace quien opera la plataforma, con el procedimiento escrito de respaldo y restauración (carpeta docs/runbooks del repositorio). Administración anota aquí el resultado y dónde está la evidencia.', 'Whoever operates the platform runs the test, following the written backup and restore procedure (docs/runbooks folder of the repository). Administration records the result and where the evidence is here.')}
              right={manage && (
                <Dialog trigger={t('Anotar una prueba', 'Record a test')} title={t('Anotar una prueba de restauración', 'Record a restore test')} testId="restore-new">
                  <ActionForm action={recordRestoreTestAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                    <Field label={t('Fecha de la prueba', 'Test date')}><input name="tested_on" type="date" className="input" required max={today} data-testid="restore-date" /></Field>
                    <Field label={t('Ambiente', 'Environment')}><select name="environment" className="input" data-testid="restore-env"><option value="staging">Staging</option><option value="production">{t('Producción', 'Production')}</option></select></Field>
                    <Field label={t('Quién la hizo', 'Who ran it')} className="col-span-2"><input name="tested_by" className="input" required minLength={2} maxLength={120} data-testid="restore-by" /></Field>
                    <Field label={t('Minutos que tardó', 'Minutes it took')}><input name="minutes" inputMode="numeric" className="input" data-testid="restore-minutes" /></Field>
                    <Field label={t('Minutos de datos perdidos', 'Minutes of data lost')}><input name="data_loss_minutes" inputMode="numeric" className="input" /></Field>
                    <Field label={t('Resultado', 'Result')}><select name="result" className="input" data-testid="restore-result"><option value="ok">{t('Se restauró bien', 'Restored correctly')}</option><option value="failed">{t('Falló', 'Failed')}</option></select></Field>
                    <Field label={t('Dónde está la evidencia', 'Where the evidence is')} hint={t('Ticket, documento o corrida. Sin contraseñas.', 'Ticket, document or run. No passwords.')} className="col-span-2"><input name="evidence" className="input" required minLength={5} maxLength={500} data-testid="restore-evidence" /></Field>
                    <Field label={t('Notas', 'Notes')} className="col-span-2"><textarea name="notes" rows={2} className="input !h-auto py-3" maxLength={2000} /></Field>
                    <div className="col-span-2 flex justify-end"><Submit testId="restore-save">{t('Anotar prueba', 'Record test')}</Submit></div>
                  </ActionForm>
                </Dialog>
              )} />
            {tests.length === 0 ? (
              <Empty title={t('Todavía no se ha probado restaurar', 'Restoring has not been tested yet')} hint={t('Un respaldo que nunca se restauró no cuenta. La primera prueba se anota aquí cuando exista la plataforma de producción.', 'A backup that was never restored does not count. The first test is recorded here once the production platform exists.')} />
            ) : (
              <>
                <p className="mb-3 text-[13.5px] text-muted-2" data-testid="restore-last">{lastOk ? t(`Última restauración que salió bien: ${day(lastOk.tested_on, locale)}.`, `Last restore that went well: ${day(lastOk.tested_on, locale)}.`) : t('Ninguna prueba ha salido bien todavía.', 'No test has gone well yet.')}</p>
                <ul>
                  {tests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="restore-row">
                      <span className="min-w-0 flex-1 basis-60"><span className="font-semibold text-strong">{day(r.tested_on, locale)} · {r.environment === 'production' ? t('Producción', 'Production') : 'Staging'}</span><span className="block text-[13px] text-muted-2 [overflow-wrap:anywhere]">{r.tested_by} · {r.minutes === null ? t('duración s/d', 'duration n/a') : t(`${r.minutes} min`, `${r.minutes} min`)} · {r.evidence}</span></span>
                      <Badge tone={r.result === 'ok' ? 'good' : 'bad'}>{r.result === 'ok' ? t('Se restauró bien', 'Restored correctly') : t('Falló', 'Failed')}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="border-t border-line px-5 py-6 md:px-7" data-testid="data-regions">
            <CardTitle title={t('Dónde viven los datos de cada mercado', 'Where each market’s data lives')} hint={t('La región la declara la configuración del mercado. El dictamen legal de residencia está por definir.', 'The region is declared in the market’s configuration. The legal opinion on residency is to be defined.')} />
            <ul>
              {regions.map((r) => <li key={r.code} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 text-[14px] first:border-t-0"><span className="font-medium text-strong">{r.name}</span><span className="flex flex-wrap items-center gap-2"><code className="text-[13px]">{r.data_region}</code>{pending}</span></li>)}
            </ul>
          </div>
        </Card>
        <Adapters keys={['traces', 'backup']} />
      </div>
    )
  }

  function Adapters({ keys }: { keys: string[] }) {
    return (
      <Card data-testid="gov-adapters">
        <CardTitle title={t('Conexiones apagadas', 'Connections turned off')} hint={t('Están construidas y no llaman a nada. Cada una dice qué falta para encenderla.', 'They are built and call nothing. Each one says what is missing to turn it on.')} />
        <ul>
          {gobiernoAdapterStatus().filter((a) => keys.includes(a.key)).map((a) => (
            <li key={a.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid={`adapter-${a.key}`}>
              <span className="min-w-0 flex-1 basis-60"><span className="block text-[14px] font-semibold text-strong">{t(...a.name)}</span><span className="text-[13px] text-muted-2">{t(...a.needs)}</span></span>
              <Badge tone={a.mode === 'off' ? 'neutral' : 'info'}>{a.mode === 'off' ? t('Apagado', 'Off') : t('Simulado (pruebas)', 'Simulated (tests)')}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    )
  }

  // ------------------------------------------------------------------ Versiones y responsables (GOB-04)
  async function Releases() {
    const [comp, windows, rel, deps] = await Promise.all([components(ctx), maintenance(ctx), releases(ctx), deployments(ctx)])
    const deploy = comp.find((c) => c.key === 'deploy')
    const twoPeople = !!(deploy?.owner_name && deploy.backup_name)
    return (
      <div className="space-y-8" data-testid="gov-releases">
        <Card pad={false} data-testid="components">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Quién responde por cada pieza', 'Who answers for each piece')} hint={t('Responsable técnico y suplente por componente: dos personas distintas. Antes de salir a producción, todas las piezas tienen las dos.', 'Technical owner and backup per component: two different people. Before going to production, every piece has both.')} /></div>
          {!twoPeople && <p role="status" className="mx-5 mb-4 rounded-[14px] bg-warn-bg px-5 py-3 text-[13.5px] font-medium text-amber-text md:mx-7" data-testid="two-people-warning">{t('Todavía no hay dos personas nombradas para desplegar y volver atrás.', 'There are not yet two people named to deploy and roll back.')}</p>}
          <Table label={t('Componentes', 'Components')} head={<><th>{t('Componente', 'Component')}</th><th>{t('Responsable técnico', 'Technical owner')}</th><th>{t('Suplente', 'Backup')}</th>{manage && <th className="relative"><span className="sr-only">{t('Editar', 'Edit')}</span></th>}</>}>
            {comp.map((c) => (
              <tr key={c.key} className="table-row" data-testid={`component-${c.key}`}>
                <td className="font-semibold text-strong">{t(c.name_es, c.name_en)}</td>
                <td data-testid="component-owner">{c.owner_name ?? pending}</td>
                <td data-testid="component-backup">{c.backup_name ?? pending}</td>
                {manage && (
                  <td className="text-right">
                    <Dialog trigger={t('Editar', 'Edit')} title={t(`Quién responde por: ${c.name_es}`, `Who answers for: ${c.name_en}`)} size="sm" testId="component-edit">
                      <ActionForm action={setComponentOwnersAction} onOk="close" className="space-y-4 text-left">
                        <input type="hidden" name="key" value={c.key} />
                        <Field label={t('Responsable técnico', 'Technical owner')} hint={t('Nombre completo. Déjalo vacío si todavía no se define.', 'Full name. Leave it empty if it is not defined yet.')}><input name="owner" className="input" maxLength={120} defaultValue={c.owner_name ?? ''} data-testid="component-owner-input" /></Field>
                        <Field label={t('Suplente', 'Backup')} hint={t('Otra persona: cubre a quien responde cuando no está.', 'A different person: covers the owner when they are away.')}><input name="backup" className="input" maxLength={120} defaultValue={c.backup_name ?? ''} data-testid="component-backup-input" /></Field>
                        <div className="flex justify-end"><Submit testId="component-save">{t('Guardar', 'Save')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        </Card>

        <Card data-testid="release-list">
          <CardTitle title={t('Versiones', 'Releases')} hint={t('Cada versión lleva sus notas en los dos idiomas y su lista de salida. Primero se anuncia; después se libera. Si toca comisiones o el alta, lleva la fecha desde la que vale.', 'Every release carries its notes in both languages and its go-live checklist. First it is announced; then it is released. If it touches commissions or enrollment, it carries the date it takes effect.')}
            right={manage && (
              <Dialog trigger={t('Nueva versión', 'New release')} title={t('Nueva versión', 'New release')} variant="primary" testId="release-new">
                <ActionForm action={createReleaseAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                  <Field label={t('Número de versión', 'Release number')}><input name="version" className="input" required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" data-testid="release-version" /></Field>
                  <Field label={t('Fecha planeada', 'Planned date')}><input name="planned_for" type="date" className="input" data-testid="release-planned" /></Field>
                  <Field label={t('Título en español', 'Title in Spanish')} className="col-span-2 sm:col-span-1"><input name="title_es" className="input" required minLength={3} maxLength={140} data-testid="release-title-es" /></Field>
                  <Field label={t('Título en inglés', 'Title in English')} className="col-span-2 sm:col-span-1"><input name="title_en" className="input" required minLength={3} maxLength={140} data-testid="release-title-en" /></Field>
                  <Field label={t('Qué cambia para el equipo, en español', 'What changes for the team, in Spanish')} className="col-span-2"><textarea name="notes_es" rows={3} className="input !h-auto py-3" required minLength={5} maxLength={3000} data-testid="release-notes-es" /></Field>
                  <Field label={t('Qué cambia para el equipo, en inglés', 'What changes for the team, in English')} className="col-span-2"><textarea name="notes_en" rows={3} className="input !h-auto py-3" required minLength={5} maxLength={3000} data-testid="release-notes-en" /></Field>
                  <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="touches_money" className="h-5 w-5 shrink-0" data-testid="release-money" />{t('Toca comisiones o el alta de comercios (exige aviso previo y fecha)', 'Touches commissions or merchant enrollment (requires prior notice and a date)')}</label>
                  <div className="col-span-2 flex justify-end"><Submit testId="release-save">{t('Crear borrador', 'Create draft')}</Submit></div>
                </ActionForm>
              </Dialog>
            )} />
          {rel.length === 0 ? (
            <Empty title={t('Todavía no hay versiones registradas', 'No releases recorded yet')} hint={t('Crea la primera antes de la próxima salida: el equipo se entera antes de que cambie algo.', 'Create the first one before the next go-live: the team hears before anything changes.')} />
          ) : (
            <ul>
              {rel.map((r) => {
                const missing = missingItems(r.checklist)
                return (
                  <li key={r.id} className="border-t border-line py-5 first:border-t-0 first:pt-0" data-testid="release-row" data-status={r.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.status === 'released' ? 'good' : r.status === 'announced' ? 'info' : 'neutral'}>{r.status === 'released' ? t('Liberada', 'Released') : r.status === 'announced' ? t('Anunciada', 'Announced') : t('Borrador', 'Draft')}</Badge>
                      {r.touches_money && <Badge tone="warn">{t('Toca comisiones o alta', 'Touches commissions or enrollment')}</Badge>}
                      <span className="text-[15px] font-semibold text-strong">{r.version} · {t(r.title_es, r.title_en)}</span>
                    </div>
                    <p className="mt-1 text-[13px] text-muted-2">{r.planned_for ? t(`Planeada para el ${day(r.planned_for, locale)}`, `Planned for ${day(r.planned_for, locale)}`) : t('Sin fecha planeada', 'No planned date')}{r.announced_at ? t(` · Anunciada: ${when(r.announced_at)}`, ` · Announced: ${when(r.announced_at)}`) : ''}{r.released_at ? t(` · Liberada: ${when(r.released_at)}`, ` · Released: ${when(r.released_at)}`) : ''}</p>
                    <p className="mt-2 text-[14px] whitespace-pre-wrap text-strong">{t(r.notes_es, r.notes_en)}</p>
                    <details className="mt-3" data-testid="release-checklist">
                      <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-strong" data-testid="release-checklist-summary">{t(`Lista de salida: ${RELEASE_CHECKLIST.length - missing.length} de ${RELEASE_CHECKLIST.length}`, `Go-live checklist: ${RELEASE_CHECKLIST.length - missing.length} of ${RELEASE_CHECKLIST.length}`)}</summary>
                      <ul className="mt-2">
                        {RELEASE_CHECKLIST.map((item) => {
                          const done = r.checklist[item.key]
                          return (
                            <li key={item.key} className="border-t border-line py-3 first:border-t-0" data-testid={`check-${item.key}`} data-done={done ? 'yes' : 'no'}>
                              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                                <span className="min-w-0 flex-1 basis-60"><span className="block text-[14px] font-semibold text-strong">{t(...item.label)}</span><span className="text-[13px] text-muted-2">{t(...item.hint)}</span></span>
                                {done ? <Badge tone="good">{t('Cumplido', 'Done')}</Badge> : <Badge tone="warn">{t('Falta', 'Missing')}</Badge>}
                              </div>
                              {done && <p className="mt-1 text-[13px] text-muted-2 [overflow-wrap:anywhere]">{done.by} · {when(done.at)} · {done.evidence}</p>}
                              {!done && manage && r.status !== 'released' && (
                                <ActionForm action={checkReleaseItemAction} className="mt-2 flex flex-wrap items-end gap-3">
                                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="item" value={item.key} />
                                  <Field label={t('Evidencia', 'Evidence')} className="min-w-0 flex-1 basis-60"><input name="evidence" className="input" required minLength={5} maxLength={300} data-testid="check-evidence" /></Field>
                                  <Submit variant="ghost" size="sm" testId="check-save">{t('Dar por cumplido', 'Mark as done')}</Submit>
                                </ActionForm>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </details>
                    {manage && r.status !== 'released' && (
                      <div className="mt-3 flex flex-wrap gap-3">
                        {r.status === 'draft' && <ActionForm action={announceReleaseAction}><input type="hidden" name="id" value={r.id} /><Submit variant="ghost" size="sm" testId="release-announce">{t('Anunciar al equipo', 'Announce to the team')}</Submit></ActionForm>}
                        <ActionForm action={markReleasedAction}><input type="hidden" name="id" value={r.id} /><Submit size="sm" testId="release-mark">{t('Marcar como liberada', 'Mark as released')}</Submit></ActionForm>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card data-testid="maintenance">
          <CardTitle title={t('Calendario de mantenimiento', 'Maintenance calendar')} hint={t('Ventanas en las que CONTIGO puede estar lento o fuera. El equipo las ve en "Pedir un cambio".', 'Windows when CONTIGO may be slow or down. The team sees them in "Request a change".')}
            right={manage && (
              <Dialog trigger={t('Agendar ventana', 'Schedule window')} title={t('Agendar una ventana de mantenimiento', 'Schedule a maintenance window')} testId="maintenance-new">
                <ActionForm action={scheduleMaintenanceAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                  <Field label={t('Qué se va a hacer', 'What will be done')} className="col-span-2"><input name="title" className="input" required minLength={5} maxLength={160} data-testid="maintenance-title" /></Field>
                  <Field label={t('Empieza', 'Starts')} className="col-span-2 sm:col-span-1"><input name="starts_at" type="datetime-local" className="input" required data-testid="maintenance-start" /></Field>
                  <Field label={t('Termina', 'Ends')} className="col-span-2 sm:col-span-1"><input name="ends_at" type="datetime-local" className="input" required data-testid="maintenance-end" /></Field>
                  <Field label={t('Mercado', 'Market')} className="col-span-2">{marketSelect('maintenance-market', t('Todos', 'All'))}</Field>
                  <Field label={t('Qué va a notar el equipo', 'What the team will notice')} className="col-span-2"><textarea name="impact" rows={2} className="input !h-auto py-3" required minLength={5} maxLength={1000} data-testid="maintenance-impact" /></Field>
                  <div className="col-span-2 flex justify-end"><Submit testId="maintenance-save">{t('Agendar', 'Schedule')}</Submit></div>
                </ActionForm>
              </Dialog>
            )} />
          {windows.length === 0 ? (
            <Empty title={t('Sin ventanas agendadas', 'No windows scheduled')} hint={t('Cuando haya un mantenimiento planeado, agéndalo aquí para que el equipo lo sepa antes.', 'When maintenance is planned, schedule it here so the team knows beforehand.')} />
          ) : (
            <ul>
              {windows.map((w) => (
                <li key={w.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="maintenance-row" data-status={w.status}>
                  <span className="min-w-0 flex-1 basis-60"><span className="block font-semibold text-strong">{w.title}</span><span className="block text-[13px] text-muted-2">{when(w.starts_at)} {t('a', 'to')} {when(w.ends_at)} · {w.market_code ?? t('Todos los mercados', 'All markets')}</span><span className="text-[13px] text-muted-2">{w.impact}</span></span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={w.status === 'planned' ? 'info' : w.status === 'done' ? 'good' : 'neutral'}>{w.status === 'planned' ? t('Planeada', 'Planned') : w.status === 'done' ? t('Hecha', 'Done') : t('Cancelada', 'Cancelled')}</Badge>
                    {manage && w.status === 'planned' && (
                      <ActionForm action={setMaintenanceStatusAction} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={w.id} />
                        <Submit variant="quiet" size="sm" name="status" value="done" testId="maintenance-done">{t('Hecha', 'Done')}</Submit>
                        <Submit variant="quiet" size="sm" name="status" value="cancelled" testId="maintenance-cancel">{t('Cancelar', 'Cancel')}</Submit>
                      </ActionForm>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card data-testid="deployments">
          <CardTitle title={t('Registro de despliegues', 'Deployment log')} hint={t('CONTIGO anota solo el commit que está corriendo en cada ambiente. Quién lo desplegó y cómo terminó se anota a mano.', 'CONTIGO records on its own the commit running in each environment. Who deployed it and how it ended is recorded by hand.')}
            right={manage && (
              <Dialog trigger={t('Anotar despliegue', 'Record deployment')} title={t('Anotar un despliegue', 'Record a deployment')} testId="deploy-new">
                <ActionForm action={recordDeploymentAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                  <Field label={t('Ambiente', 'Environment')}><select name="environment" className="input" data-testid="deploy-env"><option value="staging">Staging</option><option value="production">{t('Producción', 'Production')}</option></select></Field>
                  <Field label="Commit"><input name="commit" className="input" required pattern="[0-9a-fA-F]{7,64}" data-testid="deploy-commit" /></Field>
                  <Field label={t('Cuándo', 'When')} className="col-span-2 sm:col-span-1"><input name="deployed_at" type="datetime-local" className="input" required data-testid="deploy-at" /></Field>
                  <Field label={t('Quién desplegó', 'Who deployed')} className="col-span-2 sm:col-span-1"><input name="deployed_by" className="input" required minLength={2} maxLength={120} data-testid="deploy-by" /></Field>
                  <Field label={t('Cómo terminó', 'How it ended')}><select name="result" className="input" data-testid="deploy-result"><option value="ok">{t('Bien', 'Fine')}</option><option value="rolled_back">{t('Se volvió atrás', 'Rolled back')}</option><option value="failed">{t('Falló', 'Failed')}</option></select></Field>
                  <Field label={t('Versión', 'Release')}><select name="release_id" className="input" defaultValue=""><option value="">{t('Ninguna', 'None')}</option>{rel.map((r) => <option key={r.id} value={r.id}>{r.version}</option>)}</select></Field>
                  <Field label={t('Notas', 'Notes')} className="col-span-2"><textarea name="notes" rows={2} className="input !h-auto py-3" maxLength={1000} /></Field>
                  <div className="col-span-2 flex justify-end"><Submit testId="deploy-save">{t('Anotar', 'Record')}</Submit></div>
                </ActionForm>
              </Dialog>
            )} />
          {deps.length === 0 ? (
            <Empty title={t('Sin despliegues registrados', 'No deployments recorded')} hint={t('En staging y producción aparecen solos con cada commit nuevo. En un ambiente local no hay commit que anotar.', 'On staging and production they show up on their own with every new commit. A local environment has no commit to record.')} />
          ) : (
            <ul>
              {deps.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="deploy-row">
                  <span className="min-w-0"><code className="text-[13px] font-semibold text-strong">{d.commit_sha.slice(0, 7)}</code> <span className="text-muted-2">{d.environment}{d.version ? ` · ${d.version}` : ''} · {d.deployed_by ?? t('anotado por CONTIGO', 'recorded by CONTIGO')} · {when(d.deployed_at)}</span></span>
                  <Badge tone={d.result === 'ok' ? 'good' : 'bad'}>{d.result === 'ok' ? t('Bien', 'Fine') : d.result === 'rolled_back' ? t('Se volvió atrás', 'Rolled back') : t('Falló', 'Failed')}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    )
  }

  // ------------------------------------------------------------------ Costos (GOB-09)
  async function Costs() {
    const { months, entries } = await costBoard(ctx)
    const per = (cost: number, n: number) => (n > 0 ? usd(cost / n, locale) : t('n/a', 'n/a'))
    return (
      <div className="space-y-8" data-testid="gov-costs">
        <Card pad={false} data-testid="cost-board">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Costo unitario por mes', 'Unit cost per month')} hint={t('Lo que cuesta operar CONTIGO, dividido entre las personas que entraron ese mes y entre los comercios con alguien a cargo. Los costos los carga administración desde las facturas, en USD. Sin cargas, aquí no aparece ninguna cifra.', 'What it costs to run CONTIGO, divided by the people who signed in that month and by the merchants with someone in charge. Administration loads the costs from the invoices, in USD. With nothing loaded, no figure shows here.')} /></div>
          {months.length === 0 ? (
            <div className="px-5 pb-6 md:px-7"><Empty title={t('Todavía no hay costos cargados', 'No costs loaded yet')} hint={t('Carga el costo de plataforma, base de datos y terceros de un mes para ver el costo por persona activa y por comercio.', 'Load a month’s platform, database and third-party cost to see the cost per active person and per merchant.')} /></div>
          ) : (
            <Table label={t('Costo unitario por mes', 'Unit cost per month')} head={<><th>{t('Mes', 'Month')}</th><th>{t('Costo total', 'Total cost')}</th><th>{t('Personas activas', 'Active people')}</th><th>{t('Por persona activa', 'Per active person')}</th><th>{t('Comercios a cargo', 'Merchants in charge')}</th><th>{t('Por comercio', 'Per merchant')}</th><th>{t('Referencia', 'Reference')}</th></>}>
              {months.map((m) => (
                <tr key={m.month} className="table-row" data-testid="cost-month" data-month={m.month}>
                  <td className="font-semibold text-strong">{monthLabel(m.month, locale)}</td>
                  <td className="num" data-testid="cost-total">{usd(m.cost, locale)}<span className="block text-[12.5px] text-muted-2">{Object.entries(m.by_component).map(([k, v]) => `${t(...COMPONENT_LABEL[k]!)}: ${usd(v, locale)}`).join(' · ')}</span></td>
                  <td className="num">{num(m.active_people, locale)}</td>
                  <td className="num" data-testid="cost-per-person">{per(m.cost, m.active_people)}</td>
                  <td className="num">{num(m.managed_accounts, locale)}</td>
                  <td className="num" data-testid="cost-per-account">{per(m.cost, m.managed_accounts)}</td>
                  <td className="num" data-testid="cost-reference">{m.reference > 0 ? <>{usd(m.reference, locale)}<span className="block text-[12.5px] text-muted-2">{m.cost <= m.reference ? t(`${usd(m.reference - m.cost, locale)} menos`, `${usd(m.reference - m.cost, locale)} less`) : t(`${usd(m.cost - m.reference, locale)} más`, `${usd(m.cost - m.reference, locale)} more`)}</span></> : t('Sin referencia cargada', 'No reference loaded')}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="border-t border-line px-5 py-4 text-[13px] text-muted-2 md:px-7">{t('Costo por acción de IA: n/a. CONTIGO no llama a ningún modelo todavía; cuando lo haga, su costo se carga en el componente IA.', 'Cost per AI action: n/a. CONTIGO calls no model yet; when it does, its cost is loaded under the AI component.')}</p>
        </Card>

        <Card data-testid="cost-entries">
          <CardTitle title={t('Costos cargados', 'Loaded costs')} hint={t('Un renglón por factura o concepto. Un costo mal cargado se anula y se carga de nuevo: el monto no se edita. La referencia es contra qué se compara (por ejemplo, las licencias que se dejan de pagar).', 'One line per invoice or item. A cost loaded wrong is voided and loaded again: the amount is not edited. The reference is what it is compared against (for example, the licences no longer paid).')}
            right={manage && (
              <Dialog trigger={t('Cargar costo', 'Load cost')} title={t('Cargar un costo del mes', 'Load a cost for the month')} variant="primary" testId="cost-new">
                <ActionForm action={addCostAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                  <Field label={t('Mes', 'Month')}><input name="month" type="month" className="input" required max={today.slice(0, 7)} defaultValue={today.slice(0, 7)} data-testid="cost-month-input" /></Field>
                  <Field label={t('Qué es', 'What it is')}><select name="kind" className="input" data-testid="cost-kind"><option value="cost">{t('Costo de operar CONTIGO', 'Cost of running CONTIGO')}</option><option value="reference">{t('Referencia para comparar', 'Reference to compare against')}</option></select></Field>
                  <Field label={t('Componente', 'Component')}><select name="component" className="input" data-testid="cost-component">{COST_COMPONENTS.map((c) => <option key={c} value={c}>{t(...COMPONENT_LABEL[c]!)}</option>)}</select></Field>
                  <Field label={t('Monto en USD', 'Amount in USD')}><input name="amount" inputMode="decimal" className="input" required data-testid="cost-amount" /></Field>
                  <Field label={t('Concepto', 'Item')} hint={t('Proveedor o concepto, como viene en la factura.', 'Provider or item, as it reads on the invoice.')} className="col-span-2"><input name="label" className="input" required minLength={2} maxLength={120} data-testid="cost-label" /></Field>
                  <Field label={t('Nota', 'Note')} className="col-span-2"><input name="note" className="input" maxLength={500} /></Field>
                  <div className="col-span-2 flex justify-end"><Submit testId="cost-save">{t('Cargar', 'Load')}</Submit></div>
                </ActionForm>
              </Dialog>
            )} />
          {entries.length === 0 ? (
            <Empty title={t('Nada cargado', 'Nothing loaded')} hint={t('La lectura automática de facturación está apagada: los costos se cargan a mano.', 'The automatic billing read is off: costs are loaded by hand.')} />
          ) : (
            <ul>
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="cost-row" data-voided={e.voided ? 'yes' : 'no'}>
                  <span className={e.voided ? 'min-w-0 text-muted line-through' : 'min-w-0'}><span className="font-semibold text-strong">{monthLabel(e.month, locale)} · {e.label}</span> <span className="text-muted-2">{t(...COMPONENT_LABEL[e.component]!)}{e.kind === 'reference' ? t(' · referencia', ' · reference') : ''} · {e.created_by_name}</span></span>
                  <span className="flex flex-wrap items-center gap-3"><span className="num font-semibold text-strong">{usd(e.amount_usd, locale)}</span>
                    {e.voided ? <Badge>{t('Anulado', 'Voided')}</Badge> : manage && <ActionForm action={voidCostAction}><input type="hidden" name="id" value={e.id} /><Submit variant="quiet" size="sm" testId="cost-void">{t('Anular', 'Void')}</Submit></ActionForm>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Adapters keys={['billing']} />
      </div>
    )
  }

  // ------------------------------------------------------------------ Datos de prueba (GOB-08)
  async function TestData() {
    const { origin, runs } = await testData(ctx)
    const appEnv = env().APP_ENV
    const real = origin.accounts_imported > 0 || origin.people_real > 0
    const breach = appEnv !== 'production' && origin.accounts_imported > 0
    return (
      <div className="space-y-8" data-testid="gov-data">
        <div className="grid grid-cols-2 gap-4 desk:grid-cols-4">
          <Stat testId="data-total" label={t('Comercios en este ambiente', 'Merchants in this environment')} value={num(origin.accounts_total, locale)} />
          <Stat testId="data-generated" label={t('Del generador', 'From the generator')} value={num(origin.accounts_generated, locale)} />
          <Stat testId="data-imported" label={t('Importados de Pipedrive', 'Imported from Pipedrive')} value={num(origin.accounts_imported, locale)} tone={breach ? 'warn' : undefined} />
          <Stat testId="data-people" label={t('Personas reales con acceso', 'Real people with access')} value={num(origin.people_real, locale)} hint={t(`${num(origin.people_synthetic, locale)} personas de prueba`, `${num(origin.people_synthetic, locale)} test personas`)} />
        </div>
        <Card data-testid="data-rule">
          <CardTitle title={t('La regla: un ambiente de prueba no lleva datos reales', 'The rule: a test environment carries no real data')} hint={t('Staging y las vistas previas corren con datos del generador. Producción es el único ambiente con datos de comercios reales.', 'Staging and previews run on generator data. Production is the only environment with real merchant data.')} />
          {breach ? (
            <p role="status" className="rounded-[14px] bg-warn-bg px-5 py-4 text-[14px] font-medium text-amber-text" data-testid="data-breach">{t('Este ambiente no es producción y tiene comercios importados de Pipedrive. Es una excepción documentada (ADR-005) que sigue sin firma. El procedimiento para pasarlo a datos del generador está en docs/runbooks/staging-a-datos-sinteticos.md; la decisión es de quien revisa tecnología.', 'This environment is not production and holds merchants imported from Pipedrive. It is a documented exception (ADR-005) that is still unsigned. The procedure to move it to generator data is in docs/runbooks/staging-a-datos-sinteticos.md; the decision belongs to whoever reviews technology.')}</p>
          ) : (
            <p role="status" className="rounded-[14px] bg-green-50 px-5 py-4 text-[14px] font-medium text-brand-text" data-testid="data-clean">{appEnv === 'production' ? t('Este es el ambiente de producción.', 'This is the production environment.') : real ? t('Este ambiente no tiene comercios importados. Hay personas reales con acceso para probar.', 'This environment has no imported merchants. Real people have access for testing.') : t('Este ambiente solo tiene datos de prueba.', 'This environment holds test data only.')}</p>
          )}
        </Card>
        <Card data-testid="data-runs">
          <CardTitle title={t('Corridas del generador', 'Generator runs')} hint={t('El generador crea comercios de prueba por mercado: la misma semilla da siempre los mismos datos. Lo corre ingeniería desde la línea de comandos; nunca corre en producción.', 'The generator creates test merchants per market: the same seed always gives the same data. Engineering runs it from the command line; it never runs in production.')} />
          <p className="mb-4 rounded-[10px] bg-surface-2 px-4 py-3 text-[13px] text-strong [overflow-wrap:anywhere]"><code data-testid="data-command">node scripts/synthetic.mjs --market MX --accounts 500 --seed 42 --depth 4</code></p>
          {runs.length === 0 ? (
            <Empty title={t('El generador no ha corrido en este ambiente', 'The generator has not run in this environment')} hint={t('Los datos de prueba que ves vienen de la semilla base. Con el generador se agregan volumen, cadenas con varios niveles y casos límite.', 'The test data you see comes from the base seed. The generator adds volume, chains several levels deep and edge cases.')} />
          ) : (
            <ul>
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="data-run">
                  <span className="min-w-0"><span className="font-semibold text-strong">{r.market_code} · {t(`${num(r.accounts, locale)} comercios`, `${num(r.accounts, locale)} merchants`)}</span> <span className="text-muted-2">{t(`semilla ${r.seed} · ${r.depth} niveles`, `seed ${r.seed} · ${r.depth} levels`)}{r.edge_cases ? t(' · con casos límite', ' · with edge cases') : ''} · {r.run_by}</span></span>
                  <span className="text-[13px] text-muted-2">{when(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    )
  }

  // ------------------------------------------------------------------ Solicitudes y cambios (E7)
  async function Changes() {
    const onlyMissing = sp.motivo === 'falta'
    const [reqs, changes, champs, mats] = await Promise.all([allConfigRequests(ctx), configChanges(ctx, onlyMissing), teamChampions(ctx, true), materials(ctx)])
    const month = today.slice(0, 7)
    return (
      <div className="space-y-8" data-testid="gov-changes">
        <Card data-testid="request-admin">
          <CardTitle title={t('Solicitudes de configuración', 'Configuration requests')} hint={t('Lo que el equipo pidió desde "Pedir un cambio". Un campo nuevo se aprueba antes de crearse; lo compartido entre mercados va primero.', 'What the team asked for from "Request a change". A new field is approved before it is created; what is shared across markets comes first.')} />
          {reqs.length === 0 ? (
            <Empty title={t('Nadie ha pedido nada todavía', 'Nobody has asked for anything yet')} hint={t('Las solicitudes llegan aquí con su porqué.', 'Requests land here with their purpose.')} />
          ) : (
            <ul>
              {reqs.map((r) => (
                <li key={r.id} className="border-t border-line py-4 first:border-t-0 first:pt-0" data-testid="request-admin-row" data-status={r.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.status === 'open' ? 'warn' : r.status === 'rejected' ? 'bad' : 'good'}>{t(...REQUEST_STATUS_LABEL[r.status]!)}</Badge>
                    <Badge>{t(...REQUEST_KIND_LABEL[r.kind]!)}</Badge><Badge>{r.market_code ?? t('Compartido', 'Shared')}</Badge>
                    <span className="text-[15px] font-semibold text-strong">{r.title}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted-2">{r.requested_by_name} · {when(r.created_at)}</p>
                  <p className="mt-2 text-[14px] whitespace-pre-wrap text-strong"><span className="font-semibold">{t('Para qué: ', 'Purpose: ')}</span>{r.purpose}</p>
                  {r.options && <p className="mt-1 text-[14px] whitespace-pre-wrap text-strong"><span className="font-semibold">{t('Opciones: ', 'Options: ')}</span>{r.options}</p>}
                  {r.decision_note && <p className="mt-1 text-[13.5px] text-muted-2">{t(`Respuesta de ${r.decided_by_name ?? 'administración'}: `, `Answer from ${r.decided_by_name ?? 'administration'}: `)}{r.decision_note}</p>}
                  {ctx.can('config.manage') && (r.status === 'open' || r.status === 'approved') && (
                    <ActionForm action={decideRequestAction} className="mt-3 flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={r.id} />
                      <Field label={t('Nota para quien lo pidió', 'Note for the person who asked')} className="min-w-0 flex-1 basis-60"><input name="note" className="input" maxLength={1000} data-testid="request-note" /></Field>
                      {r.status === 'open' && <Submit variant="ghost" size="sm" name="decision" value="approved" testId="request-approve">{t('Aprobar', 'Approve')}</Submit>}
                      {r.status === 'approved' && <Submit variant="ghost" size="sm" name="decision" value="done" testId="request-done">{t('Ya quedó hecho', 'It is done')}</Submit>}
                      <Submit variant="quiet" size="sm" name="decision" value="rejected" testId="request-reject">{t('Rechazar', 'Reject')}</Submit>
                    </ActionForm>
                  )}
                  {r.status === 'approved' && r.kind === 'field' && <p className="mt-2 text-[13px] text-muted-2">{t('Aprobada: créalo en Administración, Embudos y campos, y elige esta solicitud al crearlo.', 'Approved: create it in Administration, Pipelines and fields, and pick this request when you create it.')}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card data-testid="config-changes">
          <CardTitle title={t('Cambios de configuración y su porqué', 'Configuration changes and their reason')} hint={t('Qué cambió sale de la bitácora. El porqué lo anota administración, una vez por cambio, para que el siguiente mercado lo pueda repetir. Un campo nuevo ya trae su porqué.', 'What changed comes from the audit log. Administration records the reason, once per change, so the next market can repeat it. A new field already carries its purpose.')}
            right={<span className="text-[13px] font-semibold text-strong" data-testid="changes-missing">{t(`${num(changes.missing, locale)} sin motivo de ${num(changes.total, locale)}`, `${num(changes.missing, locale)} with no reason out of ${num(changes.total, locale)}`)}</span>} />
          <div className="mb-4"><Pills label={t('Filtro de cambios', 'Change filter')} current={onlyMissing ? 'falta' : 'todos'} items={[{ key: 'todos', href: qs('/admin/gobierno', { tab: 'cambios' }), label: t('Todos', 'All') }, { key: 'falta', href: qs('/admin/gobierno', { tab: 'cambios', motivo: 'falta' }), label: t('Sin motivo', 'No reason'), count: changes.missing }]} /></div>
          {changes.rows.length === 0 ? (
            <Empty title={onlyMissing ? t('Todos los cambios tienen su motivo', 'Every change has its reason') : t('Sin cambios de configuración todavía', 'No configuration changes yet')} hint={t('Cada cambio en embudos, etapas, campos y catálogos aparece aquí solo.', 'Every change to pipelines, stages, fields and catalogs shows up here on its own.')} />
          ) : (
            <ul>
              {changes.rows.map((c) => (
                <li key={c.id} className="border-t border-line py-4 first:border-t-0 first:pt-0" data-testid="change-row" data-reason={c.reason ? 'yes' : 'no'}>
                  <p className="text-[14px]"><span className="font-semibold text-strong">{actionLabel(t, c.action)}</span> <span className="text-muted-2">· {c.actor_name ?? t('CONTIGO', 'CONTIGO')} · {when(c.at)} · {c.market_code ?? t('Todos los mercados', 'All markets')}</span></p>
                  {c.reason ? (
                    <p className="mt-1 text-[14px] text-strong" data-testid="change-reason"><span className="font-semibold">{t('Por qué: ', 'Why: ')}</span>{c.reason}</p>
                  ) : ctx.can('config.manage') ? (
                    <ActionForm action={annotateChangeAction} className="mt-2 flex flex-wrap items-end gap-3">
                      <input type="hidden" name="event_id" value={c.id} />
                      <Field label={t('¿Por qué se hizo este cambio?', 'Why was this change made?')} className="min-w-0 flex-1 basis-60"><input name="reason" className="input" required minLength={5} maxLength={1000} data-testid="change-reason-input" /></Field>
                      <Submit variant="ghost" size="sm" testId="change-reason-save">{t('Anotar motivo', 'Record reason')}</Submit>
                    </ActionForm>
                  ) : <p className="mt-1 text-[13px] text-muted-2">{t('Sin motivo anotado.', 'No reason recorded.')}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card pad={false} data-testid="champions">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Champion por equipo', 'Champion per team')} hint={t('La persona de cada equipo a quien se le pregunta primero y con quien administración revisa cada mes. Tener el rol no cambia sus permisos.', 'The person on each team to ask first and with whom administration reviews every month. Holding the role does not change their permissions.')} /></div>
          {champs.length === 0 ? (
            <div className="px-5 pb-6 md:px-7"><Empty title={t('No hay equipos', 'There are no teams')} hint={t('Los equipos se crean en Personas y acceso.', 'Teams are created in People and access.')} /></div>
          ) : (
            <Table label={t('Champion por equipo', 'Champion per team')} head={<><th>{t('Equipo', 'Team')}</th><th>{t('Champion', 'Champion')}</th><th>{t('Última revisión', 'Last review')}</th>{ctx.can('config.manage') && <th className="relative"><span className="sr-only">{t('Acciones', 'Actions')}</span></th>}</>}>
              {champs.map((c) => (
                <tr key={c.team_id} className="table-row" data-testid="champion-row">
                  <td><span className="font-semibold text-strong">{c.team}</span> <span className="text-muted-2">· {c.market_code}</span></td>
                  <td data-testid="champion-name">{c.champion ?? pending}</td>
                  <td data-testid="champion-review">{c.last_review ? <>{monthLabel(c.last_review, locale)}{c.last_review < month && <span className="ml-2"><Badge tone="warn">{t('Falta la de este mes', 'This month’s is missing')}</Badge></span>}</> : t('Ninguna todavía', 'None yet')}</td>
                  {ctx.can('config.manage') && (
                    <td className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        <Dialog trigger={c.champion ? t('Cambiar', 'Change') : t('Nombrar', 'Name')} title={t(`Champion de ${c.team}`, `Champion of ${c.team}`)} size="sm" testId="champion-set">
                          <ActionForm action={setChampionAction} onOk="close" className="space-y-4 text-left">
                            <input type="hidden" name="team_id" value={c.team_id} />
                            <Field label={t('Persona del equipo', 'Person on the team')}><select name="user_id" className="input" defaultValue={c.champion_id ?? ''} data-testid="champion-user"><option value="">{t('Nadie por ahora', 'Nobody for now')}</option>{c.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                            <div className="flex justify-end"><Submit testId="champion-save">{t('Guardar', 'Save')}</Submit></div>
                          </ActionForm>
                        </Dialog>
                        {c.champion && (
                          <Dialog trigger={t('Anotar revisión', 'Record review')} title={t(`Revisión mensual con ${c.champion}`, `Monthly review with ${c.champion}`)} size="sm" testId="champion-review-new">
                            <ActionForm action={recordChampionReviewAction} onOk="close" className="space-y-4 text-left">
                              <input type="hidden" name="team_id" value={c.team_id} />
                              <Field label={t('Mes', 'Month')}><input name="month" type="month" className="input" required max={month} defaultValue={month} data-testid="champion-review-month" /></Field>
                              <Field label={t('Qué se revisó y qué quedó acordado', 'What was reviewed and what was agreed')}><textarea name="notes" rows={3} className="input !h-auto py-3" required minLength={5} maxLength={2000} data-testid="champion-review-notes" /></Field>
                              <div className="flex justify-end"><Submit testId="champion-review-save">{t('Anotar', 'Record')}</Submit></div>
                            </ActionForm>
                          </Dialog>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card data-testid="materials-admin">
          <CardTitle title={t('Material de capacitación por mercado', 'Training material per market')} hint={t('Cada mercado tiene su presentación de inicio, su guía de leads y sus preguntas frecuentes, en su idioma. Aquí va el enlace y si ya está publicado en el portal de aprendizaje y fijado en el canal del mercado. El archivo no se guarda en CONTIGO.', 'Each market has its onboarding deck, its lead guide and its FAQ, in its language. The link goes here, and whether it is already published in the learning portal and pinned in the market’s channel. The file is not stored in CONTIGO.')}
            right={ctx.can('config.manage') && (
              <Dialog trigger={t('Agregar material', 'Add material')} title={t('Agregar o actualizar un material', 'Add or update a material')} testId="material-new">
                <ActionForm action={saveMaterialAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                  <Field label={t('Mercado', 'Market')}><select name="market" className="input" data-testid="material-market">{ctx.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
                  <Field label={t('Tipo', 'Type')}><select name="kind" className="input" data-testid="material-kind">{MATERIAL_KINDS.map((k) => <option key={k} value={k}>{t(...MATERIAL_LABEL[k]!)}</option>)}</select></Field>
                  <Field label={t('Idioma', 'Language')}><select name="locale" className="input" data-testid="material-locale"><option value="es">{t('Español', 'Spanish')}</option><option value="en">{t('Inglés', 'English')}</option></select></Field>
                  <Field label={t('Título', 'Title')}><input name="title" className="input" required minLength={3} maxLength={140} data-testid="material-title" /></Field>
                  <Field label={t('Enlace', 'Link')} hint={t('Empieza con https://', 'Starts with https://')} className="col-span-2"><input name="url" type="url" className="input" required pattern="https://.+" maxLength={490} data-testid="material-url" /></Field>
                  <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="in_portal" className="h-5 w-5 shrink-0" data-testid="material-portal" />{t('Ya está publicado en el portal de aprendizaje', 'It is already published in the learning portal')}</label>
                  <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="pinned" className="h-5 w-5 shrink-0" data-testid="material-pinned" />{t('Ya está fijado en el canal del mercado', 'It is already pinned in the market’s channel')}</label>
                  <div className="col-span-2 flex justify-end"><Submit testId="material-save">{t('Guardar material', 'Save material')}</Submit></div>
                </ActionForm>
              </Dialog>
            )} />
          <ul>
            {ctx.markets.filter((m) => m.status === 'live').flatMap((m) => MATERIAL_KINDS.map((k) => {
              const have = mats.filter((x) => x.market_code === m.code && x.kind === k)
              return (
                <li key={`${m.code}-${k}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="material-slot" data-market={m.code} data-kind={k} data-have={have.length > 0 ? 'yes' : 'no'}>
                  <span className="font-semibold text-strong">{m.name} · {t(...MATERIAL_LABEL[k]!)}</span>
                  <span className="flex min-w-0 flex-col items-end gap-1">
                    {have.length === 0 ? <Badge tone="warn">{t('Falta', 'Missing')}</Badge> : have.map((x) => (
                      <span key={x.id} className="flex flex-wrap items-center justify-end gap-2">
                        <a href={x.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-text underline [overflow-wrap:anywhere]">{x.title} ({x.locale.toUpperCase()})</a>
                        <Badge tone={x.in_portal ? 'good' : 'warn'}>{x.in_portal ? t('En el portal', 'In the portal') : t('Falta publicarlo', 'Not published yet')}</Badge>
                        <Badge tone={x.pinned ? 'good' : 'warn'}>{x.pinned ? t('Fijado', 'Pinned') : t('Falta fijarlo', 'Not pinned yet')}</Badge>
                        {ctx.can('config.manage') && <ActionForm action={removeMaterialAction}><input type="hidden" name="id" value={x.id} /><Submit variant="quiet" size="sm" testId="material-remove">{t('Quitar', 'Remove')}</Submit></ActionForm>}
                      </span>
                    ))}
                  </span>
                </li>
              )
            }))}
          </ul>
        </Card>
      </div>
    )
  }
}
