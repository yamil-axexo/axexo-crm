import Link from 'next/link'
import { Horario } from './horario'
import { notFound, redirect } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { env } from '@/env'
import { getConfig, getDataQuality, getIntake, getIntegrations } from '@/dal/admin'
import { sellers } from '@/dal/leads'
import { STAGE_REQUIREMENTS } from '@/domain/admin'
import { StageFieldPicker } from '@/ui/stage-fields'
import { FIELD_LABEL } from '@/domain/deals'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Table, NoData } from '@/ui/kit'
import { AdminNav, type AdminNavItem } from './nav'
import { ActionForm, Dialog, RevealOnce, Submit } from '@/ui/client'
import { CloseDialog, NoticeArea, NoticeForm } from '@/ui/admin'
import { ago, day, isoDay, num } from '@/lib/format'
import { LIFECYCLE, MOTOR, lab, qs } from '@/lib/labels'
import { configurePipelineAction, setRoutingMembersAction, simulateMetricsAction, simulateStoreAction, simulateVisitAction, updateStageAction } from './actions'
import { PipedriveTab } from './pipedrive'
import { B2bConfig } from './b2b'
import { PeopleTab, accessFilter } from './people'
import { AuditTab, type AuditParams } from './audit'
import { TerritoriosTab } from './territorios'
import { ReportesTab, reportFilter } from './reportes'
import { FxCard } from './fx'
import { MercadosTab } from './mercados'
import { CampaignConfig, TerritoryManagers, WinRules } from './mx'
import { targetText } from '@/lib/response-target'
import { mergeAction } from '@/app/(app)/comercios/actions'
import { flat } from '@/server/params'
import { readerTimeZone } from '@/server/timezone'

// La importación corre por pasos cortos; aun así se le da margen a cada llamada.
export const maxDuration = 60

const TABS = ['personas', 'territorios', 'mercados', 'embudos', 'entrada', 'integraciones', 'pipedrive', 'calidad', 'reportes', 'auditoria'] as const
type Tab = (typeof TABS)[number]

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; acceso?: string; reportes?: string } & AuditParams> }) {
  const ctx = await requireCtx()
  const admin = ctx.can('config.manage')
  // SEG-01: Administración por partes. Cada sección la abre la parte que le toca; la administración completa las abre todas.
  const sees: Record<Tab, boolean> = {
    personas: ctx.can('access.manage'), territorios: admin, mercados: admin, embudos: admin || ctx.can('audit.read'), entrada: admin,
    integraciones: ctx.can('integration.operate'), pipedrive: ctx.can('integration.operate'), calidad: admin,
    reportes: ctx.can('report.manage'), auditoria: ctx.can('audit.read'),
  }
  const security = ctx.can('security.read') || ctx.can('access.manage') || ctx.can('integration.operate') || ctx.can('access.review')
  const allowed: Tab[] = TABS.filter((k) => sees[k])
  if (allowed.length === 0) {
    if (security) redirect('/admin/seguridad')
    notFound()
  }
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const tab: Tab = allowed.includes(sp.tab as Tab) ? (sp.tab as Tab) : allowed[0]!
  // Pedir una sección que el rol no ve (por un enlace que alguien compartió) lo dice, en vez de abrir otra en silencio.
  const hidden = TABS.includes(sp.tab as Tab) && !allowed.includes(sp.tab as Tab) ? (sp.tab as Tab) : null
  const labels: Record<Tab, string> = {
    personas: t('Personas y acceso', 'People and access'),
    territorios: t('Territorios', 'Territories'),
    mercados: t('Mercados y entidades', 'Markets and entities'),
    embudos: t('Embudos y campos', 'Pipelines and fields'),
    entrada: t('Formularios y turnos', 'Forms and rotation'),
    // Lo que llega de la Sales App y del archivo de ventas, con sus pruebas. Las llaves, los eventos y la API viven en "Eventos, API y datos".
    integraciones: t('Sales App y ventas', 'Sales App and sales data'),
    pipedrive: 'Pipedrive',
    calidad: t('Calidad de datos', 'Data quality'),
    reportes: t('Problemas reportados', 'Reported problems'),
    auditoria: t('Auditoría', 'Audit'),
  }
  const tabItem = (k: Tab): AdminNavItem | null => (allowed.includes(k) ? { key: k, href: qs('/admin', { tab: k }), label: labels[k] } : null)
  const live = ctx.markets.filter((m) => m.status === 'live')
  const staging = env().APP_ENV !== 'production'

  return (
    <>
      <PageHeader title={t('Administración', 'Administration')} desc={t('La configuración se hace aquí y queda en la bitácora. Ventas opera; administración configura.', 'Configuration happens here and is logged. Sales operates; administration configures.')} />
      {/* Administración en secciones: cada tema junta sus pantallas (las pestañas de esta página y las pantallas propias). */}
      <AdminNav label={t('Secciones', 'Sections')} current={tab} groups={[
        { key: 'personas', label: t('Personas y territorios', 'People and territories'), items: [tabItem('personas'), tabItem('territorios')] },
        { key: 'ventas', label: t('Ventas y Operaciones', 'Sales and Operations'), items: [tabItem('embudos'), tabItem('entrada'),
          // Lo que administración mantiene para Operaciones (pedidos, etapas, productos y catálogos) vive aquí, no en otra entrada del menú.
          ...(admin ? [{ key: 'operaciones', href: '/admin/operaciones', label: t('Operaciones', 'Operations') }] : []),
          // Reglas de asignación de leads, requisitos de etapa con condición, motivos, etiquetas y lo que quedó en cola (paquete embudo).
          ...(admin ? [{ key: 'embudo', href: '/admin/embudo', label: t('Asignación y embudo', 'Assignment and pipeline') }] : []),
          // Automatizaciones, pasos con aprobación, escalamiento de leads y tareas programadas: su propia pantalla.
          ...(ctx.can('automation.read') ? [{ key: 'automatizaciones', href: '/admin/automatizaciones', label: t('Automatizaciones', 'Automations') }] : []),
          // Cuidado del comercio después de la venta (ciclo de vida, alertas, salud, modelo de atención, expansión): su propia pantalla.
          ...(ctx.can('care.manage') ? [{ key: 'cuidado', href: '/admin/cuidado', label: t('Cuidado de comercios', 'Merchant care') }] : [])] },
        { key: 'avisos', label: t('Avisos y soporte', 'Notices and support'), items: [
          ...(admin ? [{ key: 'avisos', href: '/admin/avisos', label: t('Avisos y plantillas', 'Notices and templates') }] : []), tabItem('reportes')] },
        { key: 'integraciones', label: t('Integraciones y datos', 'Integrations and data'), items: [tabItem('integraciones'),
          ...(admin ? [{ key: 'eventos-api', href: '/admin/integraciones', label: t('Eventos, API y datos', 'Events, API and data') }] : []), tabItem('pipedrive'), tabItem('calidad'),
          // Datos (duplicados, registro de campos, productos y tablero de calidad): quien administra entra por aquí, no por el menú de la cuenta.
          ...(admin && (ctx.can('data.quality') || ctx.isGlobal) ? [{ key: 'datos', href: '/datos', label: t('Datos', 'Data') }] : [])] },
        { key: 'mercados', label: t('Mercados', 'Markets'), items: admin ? [
          // Entidades legales, festivos, WhatsApp por mercado, datos de arriba de la ficha y secciones de campos (paquete mercados).
          tabItem('mercados'),
          { key: 'mercado', href: '/reportes/mercado', label: t('Reporte del mercado', 'Market report') }, { key: 'arranque', href: '/arranque', label: t('Arranque y hojas', 'Rollout and sheets') },
          // Paquete campo-canal: expedientes, cartera, atribución, registros de canal, crédito, competencia, incidentes y umbrales.
          { key: 'campo', href: '/campo', label: t('Campo y canales', 'Field and channels') },
          // Paquete partners-contratos: partners, niveles, cruce de bases y redes adquiridas.
          { key: 'partners', href: '/partners', label: t('Partners', 'Partners') }] : [] },
        { key: 'control', label: t('Control', 'Oversight'), items: [tabItem('auditoria'),
          ...(ctx.can('status.read') ? [{ key: 'estado', href: '/estado', label: t('Estado de CONTIGO', 'CONTIGO status') }] : []),
          // Paquete datos2: decisiones de negocio con valor propuesto y dueño.
          ...(admin || ctx.can('status.read') ? [{ key: 'decisiones', href: '/admin/decisiones', label: t('Decisiones de negocio', 'Business decisions') }] : []),
          // Seguridad y privacidad: alertas, accesos, datos reservados, llaves y la bitácora que escribe la base.
          ...(security ? [{ key: 'seguridad', href: '/admin/seguridad', label: t('Seguridad', 'Security') }] : []),
          // Gobierno: servicio, versiones, costos, datos de prueba y solicitudes. Lo leen administración y leadership.
          ...(ctx.can('gov.read') ? [{ key: 'gobierno', href: '/admin/gobierno', label: t('Gobierno', 'Governance') }] : []),
          // Paquete ia: nivel de asistencia por mercado, pesos de leads, evaluación y servidor MCP (apagado).
          ...(ctx.can('ia.oversee') ? [{ key: 'ia', href: '/admin/ia', label: t('IA y asistencia', 'AI and assistance') }] : [])] },
      ].map((g) => ({ ...g, items: g.items.filter((x): x is AdminNavItem => x !== null) }))} />
      {hidden && (
        <p role="status" className="mb-6 rounded-[14px] bg-warn-bg px-5 py-4 text-[14px] font-medium text-amber-text" data-testid="tab-hidden">
          {t(`Tu rol no ve la sección "${labels[hidden]}". Esa la lleva administración. Te dejamos en "${labels[tab]}".`, `Your role does not see the "${labels[hidden]}" section. Administration handles that one. You are in "${labels[tab]}".`)}
        </p>
      )}
      {tab === 'personas' && <PeopleTab ctx={ctx} access={accessFilter(sp.acceso)} today={isoDay(new Date(), await readerTimeZone(ctx))} />}
      {tab === 'territorios' && <><TerritoriosTab ctx={ctx} /><TerritoryManagers ctx={ctx} /></>}
      {tab === 'mercados' && <MercadosTab ctx={ctx} />}
      {tab === 'embudos' && <><Config />{admin && <WinRules ctx={ctx} />}</>}
      {tab === 'entrada' && <Intake />}
      {tab === 'integraciones' && <Integrations />}
      {tab === 'pipedrive' && <PipedriveTab ctx={ctx} />}
      {tab === 'calidad' && <Quality />}
      {tab === 'reportes' && <ReportesTab ctx={ctx} filter={reportFilter(sp.reportes)} />}
      {tab === 'auditoria' && <AuditTab ctx={ctx} sp={sp} />}
    </>
  )

  async function Config() {
    const d = await getConfig(ctx)
    return (
      <NoticeArea closeLabel={t('Cerrar aviso', 'Dismiss notice')}>
      <div className="space-y-8" data-testid="admin-config">
        {admin && (
          <p className="text-[13.5px] text-muted-2" data-testid="config-scope">
            {t('Desde aquí cambias el nombre de cada etapa en español y en inglés, a los cuántos días se considera estancada, qué pide para entrar y cómo se gana el embudo. Más abajo agregas, reordenas y archivas etapas, y creas embudos, campos, tipos de cuenta y motivos de pérdida. Cada cambio queda en la bitácora.', 'From here you change each stage’s name in Spanish and in English, after how many days it counts as stalled, what it requires to enter and how the pipeline is won. Further down you add, reorder and archive stages, and create pipelines, fields, account types and loss reasons. Every change is logged.')}
          </p>
        )}
        {d.pipelines.map((p) => (
          <Card key={p.id} pad={false} data-testid="pipeline-card">
            <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={`${p.market_code} · ${p.name}`} hint={`${lab(t, MOTOR[p.motor])} · ${t(`${num(p.open_deals, locale)} ${p.open_deals === 1 ? 'negocio abierto' : 'negocios abiertos'}`, `${num(p.open_deals, locale)} open ${p.open_deals === 1 ? 'deal' : 'deals'}`)}`} /></div>
            <Table label={t(`Etapas de ${p.name}`, `Stages of ${p.name}`)} head={<><th>#</th><th>{t('Etapa', 'Stage')}</th><th>{t('Para entrar hace falta', 'Required to enter')}</th><th data-testid="stage-exit-head">{t('Para avanzar', 'To move on')}</th><th>{t('Se estanca a los', 'Stalls after')}</th>{admin && <th className="relative"><span className="sr-only">{t('Editar', 'Edit')}</span></th>}</>}>
              {d.stages.filter((s) => s.pipeline_id === p.id).map((s) => {
                const closing = s.kind === 'won' || s.kind === 'lost'
                const needs = [...(s.kind === 'open' ? ['next_step'] : []), ...s.required_fields].filter((v, i, a) => a.indexOf(v) === i)
                return (
                <tr key={s.position} className="table-row" data-testid="stage-row">
                  <td className="num text-muted">{s.position}</td>
                  <td><span className="font-semibold text-strong" data-testid="stage-name">{t(s.name_es, s.name_en)}</span>{s.kind === 'awaiting_txn' && <span className="ml-2" data-testid="stage-await"><Badge tone="info">{p.close_by_transaction ? t('espera la primera venta', 'waits for the first sale') : t('desde aquí se gana a mano', 'won by hand from here')}</Badge></span>}{s.kind === 'won' && <span className="ml-2"><Badge tone="good">{p.close_by_transaction ? t('solo por transacción', 'by transaction only') : t('cierre manual', 'closed by hand')}</Badge></span>}</td>
                  <td className="text-[13.5px] text-muted-2" data-testid="stage-needs">{needs.map((f) => { const def = f.startsWith('field:') ? d.dealFields.find((x) => x.key === f.slice(6) && (x.market_code === null || x.market_code === p.market_code)) : undefined; return def ? t(def.label_es, def.label_en) : f.startsWith('field:') ? t('un campo adicional del negocio', 'an additional deal field') : t(FIELD_LABEL[f]?.es ?? f, FIELD_LABEL[f]?.en ?? f) }).join(', ') || (s.kind === 'lost' ? t('motivo de pérdida', 'loss reason') : t('nada', 'nothing'))}
                    {s.highlight_fields.length > 0 && <span className="mt-1 block text-[12.5px] text-muted" data-testid="stage-highlights">{t('Destaca sin exigir: ', 'Highlights without requiring: ')}{s.highlight_fields.map((f) => { const def = f.startsWith('field:') ? d.dealFields.find((x) => x.key === f.slice(6) && (x.market_code === null || x.market_code === p.market_code)) : undefined; return def ? t(def.label_es, def.label_en) : t(FIELD_LABEL[f]?.es ?? f, FIELD_LABEL[f]?.en ?? f) }).join(', ')}</span>}</td>
                  <td className="text-[13.5px] text-muted-2">{t(s.exit_es, s.exit_en) || t('sin nada escrito', 'nothing written')}</td>
                  <td className="num text-[13.5px]" data-testid="stage-rot">{s.rot_days ? t(`${s.rot_days} días`, `${s.rot_days} days`) : t('nunca', 'never')}</td>
                  {admin && (
                    <td className="text-right">
                      <Dialog trigger={t('Editar', 'Edit')} title={t(`Editar la etapa "${s.name_es}"`, `Edit the "${s.name_en}" stage`)} testId="stage-edit">
                        <NoticeForm action={updateStageAction} className="grid grid-cols-2 gap-4 text-left" testId="stage-form">
                          <input type="hidden" name="stage_id" value={s.id} />
                          <Field label={t('Nombre en español', 'Name in Spanish')} className="col-span-2 sm:col-span-1"><input name="name_es" className="input" required minLength={2} maxLength={60} defaultValue={s.name_es} data-testid="stage-name-es" /></Field>
                          <Field label={t('Nombre en inglés', 'Name in English')} className="col-span-2 sm:col-span-1"><input name="name_en" className="input" required minLength={2} maxLength={60} defaultValue={s.name_en} data-testid="stage-name-en" /></Field>
                          {closing ? (
                            <p className="col-span-2 text-[13px] text-muted-2">{t('Una etapa de cierre no se estanca ni pide nada para entrar: solo se le cambia el nombre.', 'A closing stage never stalls and requires nothing to enter: only its name can change.')}</p>
                          ) : (
                            <>
                              <Field label={t('Días para considerarla estancada', 'Days until it counts as stalled')} className="col-span-2" hint={t('Un negocio que lleva más días que estos en la etapa se marca como estancado. Con 0 nunca se marca.', 'A deal that stays longer than this in the stage is flagged as stalled. With 0 it is never flagged.')}>
                                <input name="rot_days" type="number" inputMode="numeric" min={0} max={365} className="input !w-32" required defaultValue={s.rot_days} data-testid="stage-rot-days" />
                              </Field>
                              <fieldset className="col-span-2">
                                <legend className="mb-2 block text-[13px] font-semibold text-muted-2">{t('Para entrar a esta etapa, el negocio tiene que traer', 'To enter this stage, the deal must have')}</legend>
                                <div className="space-y-1">
                                  {STAGE_REQUIREMENTS.map((r) => {
                                    const always = r === 'next_step' && s.kind === 'open'
                                    return (
                                      <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
                                        <input type="checkbox" name="required" value={r} className="h-5 w-5 shrink-0" defaultChecked={always || s.required_fields.includes(r)} disabled={always} data-testid={`stage-req-${r}`} />
                                        <span>{t(FIELD_LABEL[r]?.es ?? r, FIELD_LABEL[r]?.en ?? r)}{always && <span className="text-muted"> {t('(siempre, en toda etapa abierta)', '(always, in every open stage)')}</span>}</span>
                                      </label>
                                    )
                                  })}
                                </div>
                              </fieldset>
                              <fieldset className="col-span-2">
                                <legend className="mb-2 block text-[13px] font-semibold text-muted-2">{t('Destacar en esta etapa, sin exigirlo', 'Highlight in this stage, without requiring it')}</legend>
                                <div className="flex flex-wrap gap-x-6">
                                  {(['amount', 'decision_maker'] as const).map((r) => (
                                    <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
                                      <input type="checkbox" name="highlight" value={r} className="h-5 w-5 shrink-0" defaultChecked={s.highlight_fields.includes(r)} data-testid={`stage-hi-${r}`} />
                                      <span>{t(FIELD_LABEL[r]?.es ?? r, FIELD_LABEL[r]?.en ?? r)}</span>
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                              <StageFieldPicker
                                fields={d.dealFields.filter((x) => (x.market_code === null || x.market_code === p.market_code) && (x.motor === null || x.motor === p.motor)).map((x) => ({ key: x.key, label: t(x.label_es, x.label_en) }))}
                                required={s.required_fields.filter((f) => f.startsWith('field:')).map((f) => f.slice(6))}
                                highlight={s.highlight_fields.filter((f) => f.startsWith('field:')).map((f) => f.slice(6))}
                                labels={{
                                  legend: t('Campos del negocio', 'Deal fields'),
                                  hint: t('Marca "Requisito" para que el negocio no entre a esta etapa sin ese campo, o "Destacado" para pedirlo a la vista sin frenar el avance.', 'Tick "Required" so a deal cannot enter this stage without that field, or "Highlighted" to ask for it in plain sight without holding the deal back.'),
                                  filter: t('Buscar un campo', 'Find a field'), required: t('Requisito', 'Required'), highlight: t('Destacado', 'Highlighted'),
                                  none: t('Este embudo todavía no tiene campos del negocio. Créalos en "Campos creados aquí".', 'This pipeline has no deal fields yet. Create them under "Fields created here".'),
                                  picked: t('%r de requisito, %h destacados', '%r required, %h highlighted'),
                                }}
                              />
                            </>
                          )}
                          <div className="col-span-2 flex flex-wrap justify-end gap-3"><CloseDialog>{t('Cancelar', 'Cancel')}</CloseDialog><Submit testId="stage-save">{t('Guardar etapa', 'Save stage')}</Submit></div>
                        </NoticeForm>
                      </Dialog>
                    </td>
                  )}
                </tr>
                )
              })}
            </Table>
            {admin && (
              <ActionForm action={configurePipelineAction} className="flex flex-wrap items-end gap-5 border-t border-line px-5 py-5 md:px-7" testId="pipeline-config">
                <input type="hidden" name="pipeline_id" value={p.id} />
                <label className="flex items-center gap-2 pb-3 text-[13.5px]"><input type="checkbox" name="close_by_transaction" className="h-4 w-4" defaultChecked={p.close_by_transaction} data-testid="pipeline-cbt" />{t('Se gana con la primera transacción, según los datos de ventas', 'Won by the first transaction, per the sales data')}</label>
                <Field label={t('Etapa que espera la transacción', 'Stage that waits for the transaction')}>
                  <select name="awaiting_stage_id" className="input !w-64" defaultValue={d.stages.find((s) => s.pipeline_id === p.id && s.kind === 'awaiting_txn')?.id ?? ''}>
                    <option value="">{t('Ninguna', 'None')}</option>
                    {d.stages.filter((s) => s.pipeline_id === p.id && (s.kind === 'open' || s.kind === 'awaiting_txn')).map((s) => <option key={s.id} value={s.id}>{t(s.name_es, s.name_en)}</option>)}
                  </select>
                </Field>
                <Submit variant="ghost" size="sm" testId="pipeline-config-save">{t('Guardar', 'Save')}</Submit>
                {p.open_deals > 0 && (
                  <label className="flex min-h-11 w-full cursor-pointer items-center gap-3 text-[13.5px]" data-testid="pipeline-confirm-label">
                    <input type="checkbox" name="confirm" className="h-5 w-5 shrink-0" data-testid="pipeline-confirm" />
                    {t(`Confirmo: si cambio cómo se gana, aplica a ${p.open_deals === 1 ? 'el negocio abierto' : `los ${num(p.open_deals, locale)} negocios abiertos`} de este embudo.`, `I confirm: if I change how it is won, it applies to the ${p.open_deals === 1 ? 'open deal' : `${num(p.open_deals, locale)} open deals`} in this pipeline.`)}
                  </label>
                )}
                {p.open_deals > 0 && <p className="w-full text-[12.5px] text-muted" data-testid="pipeline-impact">{t(`Cambiar cómo se gana aplica desde ese momento a ${p.open_deals === 1 ? 'el negocio abierto' : `los ${num(p.open_deals, locale)} negocios abiertos`} de este embudo.`, `Changing how it is won applies from that moment to the ${p.open_deals === 1 ? 'open deal' : `${num(p.open_deals, locale)} open deals`} in this pipeline.`)}</p>}
              </ActionForm>
            )}
          </Card>
        ))}
        {admin && <B2bConfig ctx={ctx} pipelines={d.pipelines} stages={d.stages} />}
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <Card><CardTitle title={t('Registro de campos', 'Field registry')} hint={t('Cada mercado tiene sus propios campos. Se agregan aquí mismo, sin pedir un cambio al sistema.', 'Each market has its own fields. You add them right here, with no system change needed.')} />
            {d.imported.length > 0 && <p className="mb-4 text-[13.5px] text-muted-2" data-testid="imported-fields">{t('Importados de Pipedrive: ', 'Imported from Pipedrive: ')}{d.imported.map((x) => `${x.object} ${x.n}`).join(' · ')}. <Link href="/admin?tab=pipedrive" className="underline">{t('Ver el mapeo', 'See the mapping')}</Link></p>}
            <ul className="space-y-2.5">{d.fields.map((f) => <li key={`${f.object}${f.key}${f.market_code}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[14px]"><span className="min-w-0 [overflow-wrap:anywhere]"><span className="text-[12.5px] text-muted-2">{f.object === 'deal' ? t('Negocio', 'Deal') : f.object === 'account' ? t('Comercio', 'Merchant') : f.object === 'lead' ? 'Lead' : f.object}</span> <span className="ml-2 font-medium text-strong">{t(f.label_es, f.label_en)}</span></span><span className="flex gap-2"><Badge>{f.market_code ?? t('todos', 'all')}</Badge><Badge>{f.data_class === 'public' ? t('Público', 'Public') : f.data_class === 'confidential' ? t('Confidencial', 'Confidential') : t('Interno', 'Internal')}</Badge></span></li>)}</ul>
          </Card>
          <Card><CardTitle title={t('Motivos codificados', 'Coded reasons')} hint={t('La etiqueta cambia con el idioma. Los de pérdida se ofrecen por tipo de venta: se editan arriba, en "Motivos de pérdida por embudo".', 'The label changes with the language. Loss reasons are offered by sale type: edit them above, under "Loss reasons by pipeline".')} />
            <ul className="space-y-2.5">{d.reasons.map((r) => <li key={r.code} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[14px]"><span className="min-w-0 font-medium text-strong [overflow-wrap:anywhere]">{t(r.label_es, r.label_en)}</span><Badge tone={r.kind === 'lost' ? 'bad' : 'warn'}>{r.kind === 'lost' ? t('pérdida de negocio', 'deal loss') : t('visita sin venta', 'no-sale visit')}</Badge></li>)}</ul>
          </Card>
        </div>
        <FxCard ctx={ctx} />
      </div>
      </NoticeArea>
    )
  }

  async function Intake() {
    const [d, people] = await Promise.all([getIntake(ctx), sellers(ctx)])
    return (
      <div className="space-y-8" data-testid="admin-intake">
        <Horario />
        <CampaignConfig ctx={ctx} />
        <Card pad={false}>
          <div className="px-7 pt-7"><CardTitle title={t('Formularios web', 'Web forms')} hint={t('Cada formulario tiene una página lista para usar y una API para conectarlo desde el sitio web.', 'Each form has a ready-to-use page and an API to connect it from the website.')} /></div>
          <Table testId="form-table" head={<><th>{t('Formulario', 'Form')}</th><th>{t('Página', 'Page')}</th><th>API</th><th>{t('Reparte por', 'Routed by')}</th><th>{t('Leads 30 días', 'Leads, 30 days')}</th></>}>
            {d.forms.map((f) => (
              <tr key={f.id} className="table-row" data-testid="form-row">
                <td><span className="block font-semibold text-strong">{f.name}</span><span className="text-[12.5px] text-muted-2">{f.market_code} · {lab(t, MOTOR[f.motor])}</span></td>
                <td><Link href={`/f/${f.slug}`} className="text-[13.5px] text-blue-text underline" data-testid="form-link">/f/{f.slug}</Link></td>
                <td><code className="text-[12.5px] text-muted-2">POST /api/v1/forms/{f.slug}</code></td>
                <td className="text-[13.5px]">{f.rule ?? <NoData locale={locale} />}</td>
                <td className="num">{f.leads_30d}</td>
              </tr>
            ))}
          </Table>
        </Card>
        {d.rules.map((r) => {
          const pool = people.filter((p) => p.market_code === r.market_code)
          // Quien sigue en el turno pero ya no vende en el mercado (su acceso venció) se muestra aparte: no recibe leads.
          const gone = r.members.filter((m) => !m.active)
          const turn = r.members.filter((m) => m.active)
          const nextId = r.members.length ? [...r.members.slice(r.cursor % r.members.length), ...r.members.slice(0, r.cursor % r.members.length)].find((m) => m.active)?.id : undefined
          const fallback = r.fallback && r.fallback_active ? r.fallback : null
          return (
            <Card key={r.id} data-testid="rule-card">
              <CardTitle
                title={r.name}
                hint={t(
                  `Turno rotativo · respuesta en ${targetText(t, r)} · ${fallback ? `si en el turno no queda nadie, va a ${fallback}` : 'sin respaldo: si en el turno no queda nadie, el lead pasa a quien lidera el mercado; si nadie lo lidera, queda sin asignar y lo ve todo el mercado'}`,
                  `Round robin · response within ${targetText(t, r)} · ${fallback ? `if nobody is left in the rotation, it goes to ${fallback}` : 'no fallback: if nobody is left in the rotation, the lead goes to the market lead; with no market lead, it stays unowned and the whole market sees it'}`,
                )}
                right={<Badge>{r.market_code}</Badge>}
              />
              {(gone.length > 0 || (r.fallback && !r.fallback_active)) && (
                <div className="mb-5 rounded-[10px] bg-risk-bg px-4 py-3 text-[13.5px] font-medium text-red-text" role="status" data-testid="rule-no-access">
                  {gone.length > 0 && <p>{t(`Sin acceso vigente para vender en ${r.market_code}: ${gone.map((m) => m.full_name).join(', ')}. El turno ${gone.length === 1 ? 'la salta' : 'las salta'} y no ${gone.length === 1 ? 'le' : 'les'} entrega leads. Guarda el turno para sacar${gone.length === 1 ? 'la' : 'las'}.`, `No current access to sell in ${r.market_code}: ${gone.map((m) => m.full_name).join(', ')}. The rotation skips them and gives them no leads. Save the rotation to remove them.`)}</p>}
                  {r.fallback && !r.fallback_active && <p>{t(`El respaldo, ${r.fallback}, ya no vende en ${r.market_code}: no recibe leads.`, `The fallback, ${r.fallback}, no longer sells in ${r.market_code}: they get no leads.`)}</p>}
                </div>
              )}
              {turn.length === 0 && <p className="mb-5 text-[13.5px] font-medium text-amber-text" data-testid="rule-empty">{t('Este turno no tiene a nadie. Marca al menos una persona.', 'This rotation has nobody in it. Tick at least one person.')}</p>}
              <ActionForm action={setRoutingMembersAction}>
                <input type="hidden" name="rule_id" value={r.id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pool.map((p) => {
                    const on = r.member_ids.includes(p.id)
                    return (
                      <label key={p.id} className="card-2 flex min-h-11 cursor-pointer items-center gap-3 px-4 py-3">
                        <input type="checkbox" name="member_id" value={p.id} defaultChecked={on} className="h-5 w-5 shrink-0" data-testid="rule-member" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold text-strong">{p.full_name}</span><span className="text-[12.5px] text-muted-2">{t(`${d.load[p.id] ?? 0} leads en 30 días`, `${d.load[p.id] ?? 0} leads in 30 days`)}</span></span>
                        {on && p.id === nextId && <Badge tone="accent">{t('sigue', 'next')}</Badge>}
                      </label>
                    )
                  })}
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12.5px] text-muted">{t('Al guardar, el turno sigue donde iba. Quien entra va al final.', 'Saving keeps the rotation where it was. Whoever joins goes last.')}</p>
                  <Submit variant="ghost" testId="rule-save">{t('Guardar turno', 'Save rotation')}</Submit>
                </div>
              </ActionForm>
            </Card>
          )
        })}
      </div>
    )
  }

  async function Integrations() {
    const d = await getIntegrations(ctx)
    return (
      <div className="space-y-8" data-testid="admin-integrations">
        <div className="rounded-[22px] bg-surface-3 px-6 py-5 text-[14px] text-muted-2" data-testid="integration-status">
          <strong className="text-strong">{t('Estado: contrato propuesto, sin conexión real todavía.', 'Status: proposed contract, no live connection yet.')}</strong>{' '}
          {t('CONTIGO ya recibe eventos de la Sales App y el archivo diario de ventas. Falta que los equipos que llevan esos sistemas acuerden el formato y los conecten.', 'CONTIGO already accepts Sales App events and the daily sales file. The teams that run those systems still need to agree on the format and connect them.')}
        </div>

        <p className="rounded-[14px] border border-line px-5 py-4 text-[14px] text-muted-2" data-testid="integrations-more">
          {t('Las llaves de API (de lectura y de escritura, con rotación) se crean y se revocan en un solo lugar, junto con los suscriptores y el catálogo de eventos, la documentación de la API, los mensajes detenidos de la Sales App, la protección de formularios y las importaciones y exportaciones: ', 'API keys (read and write, with rotation) are created and revoked in one place, together with subscribers and the event catalog, the API documentation, held Sales App messages, form protection and imports and exports: ')}
          <Link href="/admin/integraciones" className="font-medium text-blue-text underline" data-testid="integrations-more-link">{t('abrir Eventos, API y datos', 'open Events, API and data')}</Link>.
        </p>

        {staging && (
          <Card data-testid="integration-lab">
            <CardTitle title={t('Probar el contrato (solo staging)', 'Try the contract (staging only)')} hint={t('Cada botón manda el mismo mensaje que mandaría el sistema real, por el mismo camino.', 'Each button sends the same message the real system would, down the same path.')} />
            <p className="mb-5 rounded-[10px] bg-warn-bg px-4 py-3 text-[13.5px] font-medium text-amber-text" data-testid="sim-warning">{t('Estas pruebas cambian registros de este ambiente: pueden ganar un negocio, marcar una revisita o crear un comercio. Queda en la bitácora quién corrió cada una.', 'These tests change records in this environment: they can win a deal, flag a revisit or create a merchant. The audit log keeps who ran each one.')}</p>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <ActionForm action={simulateMetricsAction} className="card-2 p-5" testId="sim-metrics">
                <p className="text-[14.5px] font-semibold text-strong">{t('Datos de ventas: primera transacción', 'Sales data: first transaction')}</p>
                <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('Carga un archivo diario con la primera venta de un comercio que está esperando. Su negocio se gana solo.', 'Loads a daily file with the first sale of a waiting merchant. Its deal wins on its own.')}</p>
                <Field label={t('Comercio esperando primera venta', 'Merchant awaiting first sale')}>
                  <select name="merchant_ref" className="input" data-testid="sim-metrics-ref">{d.awaiting.map((a) => <option key={a.alias} value={a.alias}>{a.name} · {a.alias}</option>)}</select>
                </Field>
                <input type="hidden" name="currency" value={d.awaiting[0]?.currency ?? 'USD'} />
                <div className="mt-4"><Submit variant="ghost" size="sm" testId="sim-metrics-send">{t('Cargar archivo', 'Load file')}</Submit></div>
              </ActionForm>
              <ActionForm action={simulateVisitAction} className="card-2 p-5" testId="sim-visit">
                <p className="text-[14.5px] font-semibold text-strong">{t('Sales App: visita', 'Sales App: visit')}</p>
                <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('Una visita sin quien decide deja el negocio marcado con revisita.', 'A visit with no decision-maker flags the deal for a revisit.')}</p>
                <Field label={t('Comercio', 'Merchant')}><select name="customer_id" className="input" data-testid="sim-visit-ref">{d.visitable.map((a) => <option key={a.alias} value={a.alias}>{a.name} · {a.alias}</option>)}<option value="SC-XX-000000">{t('ID que no existe', 'An ID that does not exist')}</option></select></Field>
                <Field label={t('Resultado', 'Outcome')} className="mt-3"><select name="outcome" className="input" data-testid="sim-visit-outcome"><option value="revisit">{t('Sin venta: no estaba quien decide', 'No sale: decision-maker absent')}</option><option value="sale">{t('Con venta', 'With a sale')}</option><option value="no_sale">{t('Sin venta: tiene inventario', 'No sale: has stock')}</option></select></Field>
                <div className="mt-4"><Submit variant="ghost" size="sm" testId="sim-visit-send">{t('Enviar evento', 'Send event')}</Submit></div>
              </ActionForm>
              <ActionForm action={simulateStoreAction} onOk="reset" className="card-2 p-5" testId="sim-store">
                <p className="text-[14.5px] font-semibold text-strong">{t('Sales App: tienda nueva', 'Sales App: new store')}</p>
                <p className="mt-1 mb-4 text-[13px] text-muted-2">{t('La tienda nace en la Sales App. CONTIGO le da su ID o la liga al prospecto que ya existía.', 'The store starts in the Sales App. CONTIGO gives it an ID or links it to the prospect that already existed.')}</p>
                <Field label={t('Nombre', 'Name')}><input name="name" className="input" required minLength={2} data-testid="sim-store-name" /></Field>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label={t('Mercado', 'Market')}><select name="market" className="input">{live.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}</select></Field>
                  <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" data-testid="sim-store-phone" /></Field>
                </div>
                <div className="mt-4"><Submit variant="ghost" size="sm" testId="sim-store-send">{t('Enviar evento', 'Send event')}</Submit></div>
              </ActionForm>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <Card data-testid="inbound-log"><CardTitle title={t('Lo que llegó', 'What came in')} hint={t('Cada mensaje lleva una llave: si llega dos veces, se procesa una.', 'Every message carries a key: if it arrives twice, it is processed once.')} />
            {d.events.length === 0 ? <p className="text-[14px] text-muted">{t('Todavía no llega nada.', 'Nothing has arrived yet.')}</p> : (
              <ul className="space-y-2.5">{d.events.map((e) => <li key={e.id} className="flex items-center justify-between gap-3 text-[13.5px]" data-testid="inbound-row"><span><code className="text-[12.5px]">{e.source} · {e.event_type}</code><span className="ml-2 text-muted">{ago(e.received_at, locale)}</span></span><Badge tone={e.status === 'processed' ? 'good' : e.status === 'rejected' ? 'bad' : 'neutral'}>{e.status === 'processed' ? t('procesado', 'processed') : e.status === 'rejected' ? t('sin comercio', 'no merchant') : t('recibido', 'received')}</Badge></li>)}</ul>
            )}
            <p className="eyebrow mt-7 mb-3">{t('Archivos diarios de ventas', 'Daily sales files')}</p>
            <ul className="space-y-2.5">{d.batches.map((b) => <li key={b.id} className="flex items-center justify-between gap-3 text-[13.5px]" data-testid="batch-row"><span className="truncate"><code className="text-[12.5px]">{b.file_name}</code></span><span className="shrink-0 text-muted-2">{t(`${num(b.matched, locale)} de ${num(b.row_count, locale)} filas ligadas`, `${num(b.matched, locale)} of ${num(b.row_count, locale)} rows matched`)} · {day(b.as_of, locale)}</span></li>)}</ul>
          </Card>
          <Card data-testid="outbox-log"><CardTitle title={t('Avisos para otros sistemas', 'Notices for other systems')} hint={t('Eventos que CONTIGO guarda para otros sistemas. El canal de entrega está apagado: quedan listos para publicar y no afectan el trabajo diario.', 'Events CONTIGO keeps for other systems. The delivery channel is off: they stay ready to publish and do not affect daily work.')} right={<Badge tone="neutral">{t(`${num(d.outboxPending, locale)} guardados`, `${num(d.outboxPending, locale)} stored`)}</Badge>} />
            <ul className="space-y-2.5">{d.outbox.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 text-[13.5px]"><code className="text-[12.5px]">{o.event_type}</code><span className="text-muted-2">{o.market_code ?? <NoData locale={locale} />} · {ago(o.created_at, locale)}</span></li>)}</ul>
          </Card>
        </div>

      </div>
    )
  }

  async function Quality() {
    const d = await getDataQuality(ctx)
    return (
      <div className="space-y-8" data-testid="admin-quality">
        <Card pad={false}>
          <div className="px-7 pt-7"><CardTitle title={t('Huecos por mercado', 'Gaps by market')} /></div>
          <Table label={t('Huecos por mercado', 'Gaps by market')} head={<><th>{t('Mercado', 'Market')}</th><th>{t('Comercios', 'Merchants')}</th><th>{t('Comercios sin asignar', 'Merchants with no owner')}</th><th>{t('Negocios abiertos sin asignar', 'Open deals with no owner')}</th><th>{t('Leads abiertos sin asignar', 'Open leads with no owner')}</th><th>{t('Sin teléfono', 'No phone')}</th><th>{t('Sin contacto', 'No contact')}</th><th>{t('Sin ID externo', 'No external ID')}</th></>}>
            {d.gaps.map((g) => <tr key={g.market_code} className="table-row" data-testid="gap-row"><td className="font-semibold text-strong">{g.market_code}</td><td className="num">{num(g.total, locale)}</td><td className="num">{g.no_owner}</td><td className="num">{d.unowned[g.market_code]?.deals ?? 0}</td><td className="num">{d.unowned[g.market_code]?.leads ?? 0}</td><td className="num">{g.no_phone}</td><td className="num">{g.no_contact}</td><td className="num">{g.no_alias}</td></tr>)}
          </Table>
        </Card>
        <Card pad={false} data-testid="orphans">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Por repartir', 'No current owner')} hint={t('Siguen a nombre de una cuenta de servicio o de alguien que ya no vende ni opera en ese mercado. Nadie los va a trabajar hasta que se repartan en Mi equipo. Es la misma regla de "Por repartir" en Mi equipo y en Comercios: tener solo acceso de administración no cuenta como llevar cartera.', 'They still sit under a service account or someone who no longer sells or runs operations in that market. Nobody will work them until they are distributed in My team. It is the same "No current owner" rule used in My team and in Merchants: administration access alone does not count as carrying a book.')} /></div>
          {d.orphans.length === 0 ? <div className="px-5 pb-6 md:px-7 md:pb-7"><Empty title={t('Nada por repartir', 'Nothing to distribute')} hint={t('Todo lo abierto lo lleva alguien que vende u opera en su mercado.', 'Everything open is with someone who sells or runs operations in its market.')} /></div> : (
            <Table label={t('Por repartir', 'No current owner')} head={<><th>{t('Mercado', 'Market')}</th><th>{t('A nombre de', 'Held by')}</th><th>{t('Comercios', 'Merchants')}</th><th>{t('Negocios abiertos', 'Open deals')}</th><th>{t('Leads abiertos', 'Open leads')}</th></>}>
              {d.orphans.map((o) => <tr key={`${o.market_code}${o.owner_id}`} className="table-row" data-testid="orphan-row"><td className="font-semibold text-strong">{o.market_code}</td><td>{o.full_name}</td><td className="num">{num(o.accounts, locale)}</td><td className="num">{num(o.deals, locale)}</td><td className="num">{num(o.leads, locale)}</td></tr>)}
            </Table>
          )}
        </Card>
        <Card data-testid="duplicates">
          <CardTitle title={t('Posibles duplicados', 'Possible duplicates')} hint={t('Fusionar pasa todo al comercio que se queda y archiva el otro. Nada se borra.', 'Merging moves everything to the surviving merchant and archives the other. Nothing is deleted.')} />
          {d.dups.length === 0 ? <Empty title={t('Sin duplicados detectados', 'No duplicates detected')} hint={t('Se detectan por teléfono al capturar y cada vez que corren las reglas.', 'They are detected by phone on entry and every time the rules run.')} /> : (
            <ul>
              {d.dups.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-4 first:border-t-0" data-testid="dup-row">
                  <span className="text-[14px]">
                    <Link href={`/comercios/${x.a_id}`} className="font-semibold text-strong underline">{x.a_name}</Link> <span className="text-muted-2">({lab(t, LIFECYCLE[x.a_lifecycle]?.label)})</span>
                    <span className="mx-2 text-muted">↔</span>
                    <Link href={`/comercios/${x.b_id}`} className="font-semibold text-strong underline">{x.b_name}</Link> <span className="text-muted-2">({lab(t, LIFECYCLE[x.b_lifecycle]?.label)})</span>
                  </span>
                  <ActionForm action={mergeAction} className="flex items-center gap-2">
                    <input type="hidden" name="source_id" value={x.b_id} /><input type="hidden" name="target_id" value={x.a_id} />
                    <Submit variant="ghost" size="sm" testId="merge">{t(`Fusionar en "${x.a_name}"`, `Merge into "${x.a_name}"`)}</Submit>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    )
  }
}
