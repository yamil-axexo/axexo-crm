import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { env } from '@/env'
import { escalationConfig, jobsPanel, listAutomations, stepsConfig, type StepRow, type StepStage } from '@/dal/automations'
import { allTemplates, installDefaults } from '@/domain/automation/admin'
import { describe, SOURCE_LABEL } from '@/domain/automation/catalog'
import { APPROVER_ROLES, STEP_ROLES } from '@/domain/automation/transitions'
import { ROLE_LABEL } from '@/domain/policy'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, Table } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { CloseDialog, NoticeArea, NoticeForm } from '@/ui/admin'
import { ago, dayTime } from '@/lib/format'
import { MOTOR, lab, qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { readerTimeZone } from '@/server/timezone'
import { setAutomationOwnerAction, setTransitionActiveAction } from '@/app/(app)/embudo2-actions'
import { createAutomationAction, escalationAction, runJobAction, saveStepAction, stageTimesAction, toggleAutomationAction } from './actions'

export const maxDuration = 60

const VIEWS = ['reglas', 'pasos', 'leads', 'tareas'] as const
type View = (typeof VIEWS)[number]

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const ctx = await requireCtx()
  const manage = ctx.can('automation.manage')
  if (!ctx.can('automation.read') && !ctx.can('status.read')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const allowed: View[] = manage ? [...VIEWS] : ctx.can('automation.read') ? (ctx.can('status.read') ? ['reglas', 'tareas'] : ['reglas']) : ['tareas']
  const view: View = allowed.includes(sp.v as View) ? (sp.v as View) : allowed[0]!
  const labels: Record<View, string> = {
    reglas: t('Automatizaciones', 'Automations'),
    pasos: t('Pasos de etapa y aprobaciones', 'Stage steps and approvals'),
    leads: t('Escalamiento de leads', 'Lead escalation'),
    tareas: t('Tareas programadas', 'Scheduled jobs'),
  }
  const tz = await readerTimeZone(ctx)

  return (
    <>
      <PageHeader
        eyebrow={t('Administración', 'Administration')}
        title={t('Automatizaciones', 'Automations')}
        desc={t('Lo que CONTIGO hace solo: qué revisa, cuándo, y qué hace cuando lo encuentra. Cada automatización es de un mercado, tiene responsable y deja su propia bitácora.', 'What CONTIGO does on its own: what it checks, when, and what it does when it finds it. Each automation belongs to one market, has an owner and keeps its own log.')}
        actions={<Link href="/admin" className="text-[13.5px] font-medium text-blue-text underline">{t('Volver a Administración', 'Back to Administration')}</Link>}
      />
      <div className="mb-8"><Pills label={t('Secciones', 'Sections')} current={view} items={allowed.map((k) => ({ key: k, href: qs('/admin/automatizaciones', { v: k === 'reglas' ? undefined : k }), label: labels[k] }))} /></div>
      {view === 'reglas' && <Rules />}
      {view === 'pasos' && <Steps />}
      {view === 'leads' && <Leads />}
      {view === 'tareas' && <Jobs />}
    </>
  )

  async function Rules() {
    await installDefaults(ctx)
    const all = await listAutomations(ctx)
    const live = ctx.markets.filter((m) => m.status === 'live')
    const templates = allTemplates()
    // GOB-05: lo reconstruido desde Pipedrive va en su propia sección, con el nombre que tenía allá y por qué está apagado si lo está.
    const rebuilt = all.filter((r) => r.pipedrive_ref)
    const rows = all.filter((r) => !r.pipedrive_ref)
    return (
      <NoticeArea closeLabel={t('Cerrar aviso', 'Dismiss notice')}>
        <div className="space-y-8" data-testid="auto-list">
          {manage && (
            <Card data-testid="auto-new">
              <CardTitle title={t('Crear desde una plantilla', 'Create from a template')} hint={t('La automatización nace en pausa. La revisas, la pruebas contra un registro y la activas cuando esté lista.', 'The automation starts paused. You review it, test it against a record and turn it on when it is ready.')} />
              <ActionForm action={createAutomationAction} className="grid grid-cols-1 gap-4 sm:grid-cols-12" testId="auto-new-form">
                <Field label={t('Mercado', 'Market')} className="sm:col-span-3">
                  <select name="market" className="input" required data-testid="auto-new-market">{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
                </Field>
                <Field label={t('Plantilla', 'Template')} className="sm:col-span-7">
                  <select name="template" className="input" required data-testid="auto-new-template">{templates.map((x) => <option key={x.key} value={x.key}>{t(x.name.es, x.name.en)}</option>)}</select>
                </Field>
                <div className="flex items-end sm:col-span-2"><Submit testId="auto-new-create">{t('Crear', 'Create')}</Submit></div>
              </ActionForm>
            </Card>
          )}
          {rebuilt.length > 0 && (
            <Card data-testid="auto-pipedrive">
              <CardTitle title={t('Reconstruidas desde Pipedrive', 'Rebuilt from Pipedrive')} hint={t('Las automatizaciones y la asignación automática que el equipo tenía en Pipedrive, con las mismas condiciones. Las que no tienen todavía su embudo o su campo en CONTIGO esperan apagadas.', 'The automations and the automatic assignment the team had in Pipedrive, with the same conditions. Those whose pipeline or field does not exist in CONTIGO yet wait switched off.')} />
              <ul className="divide-y divide-line">
                {rebuilt.map((r) => {
                  const d = describe({ source: r.source, trigger: r.trigger_kind === 'event' ? { kind: 'event', event: r.trigger_event! } : { kind: 'schedule' }, conditions: r.conditions, actions: r.actions })
                  return (
                    <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3" data-testid="auto-pd-row" data-key={r.key} data-active={r.is_active ? '1' : '0'}>
                      <div className="min-w-0 max-w-[70ch]">
                        <Link href={`/admin/automatizaciones/${r.id}`} className="font-semibold text-strong underline" data-testid="auto-open">{t(r.name_es, r.name_en)}</Link>
                        <span className="mt-0.5 block text-[12.5px] text-muted-2">{t('En Pipedrive: ', 'In Pipedrive: ')}<span lang="en">{r.pipedrive_ref}</span> · {r.market_code}</span>
                        <p className="mt-1 text-[13.5px] text-muted-2">{d.then.map((x) => t(x.es, x.en)).join('. ')}</p>
                        {!r.is_active && r.off_reason_es && <p className="mt-1 text-[13px] text-muted" data-testid="auto-pd-off">{t(r.off_reason_es, r.off_reason_en ?? r.off_reason_es)}</p>}
                      </div>
                      <span className="flex items-center gap-2">
                        {r.is_active ? <Badge tone="good">{t('Activa', 'On')}</Badge> : <Badge tone="warn">{t('Apagada', 'Off')}</Badge>}
                        {manage && (
                          <NoticeForm action={toggleAutomationAction} testId="auto-toggle">
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="active" value={r.is_active ? '0' : '1'} />
                            <Submit variant="ghost" size="sm" testId="auto-pd-toggle-btn">{r.is_active ? t('Pausar', 'Pause') : t('Activar', 'Turn on')}</Submit>
                          </NoticeForm>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
          {rows.length === 0 ? <Empty title={t('Todavía no hay automatizaciones', 'There are no automations yet')} hint={t('Se crean solas la primera vez que corre la revisión por horario.', 'They are created on their own the first time the scheduled check runs.')} /> : (
            ctx.markets.filter((m) => rows.some((r) => r.market_code === m.code)).map((m) => (
              <Card key={m.code} pad={false} data-testid="auto-market" data-market={m.code}>
                <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={m.name} hint={t('Estas automatizaciones solo ven registros de este mercado.', 'These automations only see records from this market.')} /></div>
                <Table label={t(`Automatizaciones de ${m.name}`, `Automations for ${m.name}`)} head={<><th>{t('Automatización', 'Automation')}</th><th>{t('Qué hace', 'What it does')}</th><th>{t('Estado', 'Status')}</th><th>{t('Última vez', 'Last time')}</th>{manage && <th className="relative"><span className="sr-only">{t('Acciones', 'Actions')}</span></th>}</>}>
                  {rows.filter((r) => r.market_code === m.code).map((r) => {
                    const d = describe({ source: r.source, trigger: r.trigger_kind === 'event' ? { kind: 'event', event: r.trigger_event! } : { kind: 'schedule' }, conditions: r.conditions, actions: r.actions })
                    return (
                      <tr key={r.id} className="table-row" data-testid="auto-row" data-key={r.key} data-active={r.is_active ? '1' : '0'}>
                        <td>
                          <Link href={`/admin/automatizaciones/${r.id}`} className="font-semibold text-strong underline" data-testid="auto-open">{t(r.name_es, r.name_en)}</Link>
                          <span className="mt-0.5 block text-[12.5px] text-muted-2">{[t(SOURCE_LABEL[r.source].es, SOURCE_LABEL[r.source].en), r.motor ? lab(t, MOTOR[r.motor]) || r.motor : t('todos los tipos de venta', 'all sales types'), t(`versión ${r.version}`, `version ${r.version}`), r.owner_name ? t(`la lleva ${r.owner_name}`, `owned by ${r.owner_name}`) : t('sin responsable', 'nobody answers for it yet')].join(' · ')}</span>
                        </td>
                        <td className="text-[13.5px] text-muted-2">{d.then.map((x) => t(x.es, x.en)).join('. ')}</td>
                        <td>
                          {r.is_active ? <Badge tone="good">{t('Activa', 'On')}</Badge> : <Badge tone="warn">{t('En pausa', 'Paused')}</Badge>}
                          {r.owner_review && (
                            <span className="mt-1 flex flex-wrap items-center gap-2" data-testid="auto-owner-review">
                              <Badge tone="info">{t('Responsable por confirmar', 'Owner to confirm')}</Badge>
                              {manage && r.owner_id && (
                                <NoticeForm action={setAutomationOwnerAction} testId="auto-owner-confirm">
                                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="owner_id" value={r.owner_id} />
                                  <Submit variant="ghost" size="sm" testId="auto-owner-confirm-btn">{t('Confirmar', 'Confirm')}</Submit>
                                </NoticeForm>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="text-[13.5px] text-muted-2">{r.last_at ? `${ago(r.last_at, locale)} · ${t(`${r.done_7d} en 7 días`, `${r.done_7d} in 7 days`)}` : t('todavía no ha hecho nada', 'it has not done anything yet')}</td>
                        {manage && (
                          <td className="text-right">
                            <NoticeForm action={toggleAutomationAction} testId="auto-toggle">
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="active" value={r.is_active ? '0' : '1'} />
                              <Submit variant="ghost" size="sm" testId="auto-toggle-btn">{r.is_active ? t('Pausar', 'Pause') : t('Activar', 'Turn on')}</Submit>
                            </NoticeForm>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </Table>
              </Card>
            ))
          )}
        </div>
      </NoticeArea>
    )
  }

  async function Steps() {
    const d = await stepsConfig(ctx)
    const stageName = (id: string | null) => { const s = d.stages.find((x) => x.id === id); return s ? t(s.name_es, s.name_en) : t('cualquier etapa', 'any stage') }
    const who = (s: StepRow) => (s.approver_name ?? (s.approver_role ? t(ROLE_LABEL[s.approver_role].es, ROLE_LABEL[s.approver_role].en) : ''))
    const StepForm = ({ pipelineId, market, stages, step }: { pipelineId: string; market: string; stages: StepStage[]; step?: StepRow }) => {
      const people = d.people.filter((p) => p.market_code === market || p.market_code === null).filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i)
      const targets = stages.filter((s) => s.kind !== 'lost')
      return (
        <NoticeForm action={saveStepAction} className="grid grid-cols-2 gap-4 text-left" testId="step-form">
          <input type="hidden" name="pipeline_id" value={pipelineId} />
          {step && <input type="hidden" name="id" value={step.id} />}
          <Field label={t('Desde la etapa', 'From stage')} className="col-span-2 sm:col-span-1">
            <select name="from_stage_id" className="input" defaultValue={step?.from_stage_id ?? ''} data-testid="step-from"><option value="">{t('Cualquier etapa', 'Any stage')}</option>{stages.filter((s) => s.kind === 'open' || s.kind === 'awaiting_txn').map((s) => <option key={s.id} value={s.id}>{t(s.name_es, s.name_en)}</option>)}</select>
          </Field>
          <Field label={t('Hacia la etapa', 'To stage')} className="col-span-2 sm:col-span-1">
            <select name="to_stage_id" className="input" required defaultValue={step?.to_stage_id ?? targets[1]?.id ?? targets[0]?.id} data-testid="step-to">{targets.map((s) => <option key={s.id} value={s.id}>{t(s.name_es, s.name_en)}</option>)}</select>
          </Field>
          <fieldset className="col-span-2">
            <legend className="mb-2 block text-[13px] font-semibold text-muted-2">{t('Quién puede dar este paso (sin marcar nada, quien ya puede mover el negocio)', 'Who can take this step (with nothing ticked, whoever can already move the deal)')}</legend>
            <div className="flex flex-wrap gap-x-6">
              {STEP_ROLES.map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="roles" value={r} className="h-5 w-5 shrink-0" defaultChecked={step?.allowed_roles.includes(r)} /><span>{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</span></label>
              ))}
            </div>
          </fieldset>
          <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="requires_evidence" className="h-5 w-5 shrink-0" defaultChecked={step?.requires_evidence} data-testid="step-evidence" /><span>{t('Pide evidencia: un enlace con nota (CONTIGO no guarda el archivo)', 'Requires evidence: a link with a note (CONTIGO does not store the file)')}</span></label>
          <Field label={t('Qué evidencia, en español', 'Which evidence, in Spanish')} className="col-span-2 sm:col-span-1"><input name="evidence_es" className="input" maxLength={160} defaultValue={step?.evidence_es ?? ''} data-testid="step-evidence-es" /></Field>
          <Field label={t('Qué evidencia, en inglés', 'Which evidence, in English')} className="col-span-2 sm:col-span-1"><input name="evidence_en" className="input" maxLength={160} defaultValue={step?.evidence_en ?? ''} data-testid="step-evidence-en" /></Field>
          <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="needs_approval" className="h-5 w-5 shrink-0" defaultChecked={step?.needs_approval} data-testid="step-approval" /><span>{t('Pide aprobación: el negocio no se mueve hasta que alguien lo apruebe', 'Requires approval: the deal does not move until someone approves it')}</span></label>
          <Field label={t('Quién aprueba', 'Who approves')} className="col-span-2 sm:col-span-1">
            <select name="approver" className="input" defaultValue={step?.approver_id ? `user:${step.approver_id}` : step?.approver_role ? `role:${step.approver_role}` : 'role:supervisor'} data-testid="step-approver">
              <optgroup label={t('Un rol del mercado', 'A role in the market')}>{APPROVER_ROLES.map((r) => <option key={r} value={`role:${r}`}>{t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</option>)}</optgroup>
              <optgroup label={t('Una persona', 'A person')}>{people.map((p) => <option key={p.id} value={`user:${p.id}`}>{p.full_name}</option>)}</optgroup>
            </select>
          </Field>
          <Field label={t('Suplente, si vence el plazo', 'Backup, if time runs out')} className="col-span-2 sm:col-span-1" hint={t('Sin suplente, pasa a quien lidera el mercado.', 'With no backup, it goes to the market lead.')}>
            <select name="backup_id" className="input" defaultValue={step?.backup_id ?? ''} data-testid="step-backup"><option value="">{t('Sin suplente', 'No backup')}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
          </Field>
          <Field label={t('Plazo para aprobar, en horas hábiles', 'Time to approve, in business hours')} className="col-span-2 sm:col-span-1"><input name="approval_hours" type="number" inputMode="numeric" min={1} max={240} className="input !w-32" defaultValue={step?.approval_hours ?? 8} data-testid="step-hours" /></Field>
          {step && <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] sm:col-span-1"><input type="checkbox" name="is_active" value="off" className="h-5 w-5 shrink-0" defaultChecked={!step.is_active} /><span>{t('Dejar este paso sin efecto', 'Turn this step off')}</span></label>}
          <div className="col-span-2 flex flex-wrap justify-end gap-3"><CloseDialog>{t('Cancelar', 'Cancel')}</CloseDialog><Submit testId="step-save">{t('Guardar paso', 'Save step')}</Submit></div>
        </NoticeForm>
      )
    }
    return (
      <NoticeArea closeLabel={t('Cerrar aviso', 'Dismiss notice')}>
        <div className="space-y-8" data-testid="steps-config">
          <p className="text-[13.5px] text-muted-2">{t('Un paso es ir de una etapa a otra. Aquí dices quién lo puede dar, si pide evidencia y si pide la aprobación de alguien, con plazo y suplente. Un embudo sin pasos configurados se mueve como siempre. Perder un negocio nunca pide aprobación.', 'A step is going from one stage to another. Here you say who can take it, whether it requires evidence and whether it needs someone’s approval, with a time limit and a backup. A pipeline with no configured steps moves as usual. Losing a deal never needs approval.')}</p>
          {d.pipelines.map((p) => {
            const stages = d.stages.filter((s) => s.pipeline_id === p.id)
            const steps = d.steps.filter((s) => s.pipeline_id === p.id)
            return (
              <Card key={p.id} pad={false} data-testid="steps-pipeline" data-pipeline={p.name}>
                <div className="px-5 pt-6 md:px-7 md:pt-7">
                  <CardTitle title={`${p.market_code} · ${p.name}`} right={<Dialog trigger={t('Agregar paso', 'Add step')} title={t(`Nuevo paso en ${p.name}`, `New step in ${p.name}`)} testId="step-add"><StepForm pipelineId={p.id} market={p.market_code} stages={stages} /></Dialog>} />
                </div>
                {steps.length === 0 ? <p className="px-5 pb-6 text-[13.5px] text-muted md:px-7" data-testid="steps-empty">{t('Sin pasos configurados: este embudo se mueve con las reglas de siempre.', 'No configured steps: this pipeline moves with the usual rules.')}</p> : (
                  <Table label={t(`Pasos de ${p.name}`, `Steps of ${p.name}`)} head={<><th>{t('Paso', 'Step')}</th><th>{t('Quién lo da', 'Who takes it')}</th><th>{t('Qué pide', 'What it requires')}</th><th className="relative"><span className="sr-only">{t('Editar', 'Edit')}</span></th></>}>
                    {steps.map((s) => (
                      <tr key={s.id} className="table-row" data-testid="step-row">
                        <td><span className="font-semibold text-strong">{stageName(s.from_stage_id)} → {stageName(s.to_stage_id)}</span>{!s.is_active && <span className="ml-2"><Badge tone="warn">{t('sin efecto', 'off')}</Badge></span>}
                          {s.pending_owner && <span className="mt-1 block text-[12.5px] text-muted-2" data-testid="step-proposed">{t(`Valor propuesto, [pendiente: ${s.pending_owner}]`, `Proposed value, [pending: ${s.pending_owner}]`)}</span>}
                          {s.pending_owner && !s.is_active && (
                            <NoticeForm action={setTransitionActiveAction} testId="step-activate">
                              <input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value="true" />
                              <Submit variant="ghost" size="sm" testId="step-activate-btn">{t('Activar este paso', 'Turn this step on')}</Submit>
                            </NoticeForm>
                          )}</td>
                        <td className="text-[13.5px] text-muted-2">{s.allowed_roles.length ? s.allowed_roles.map((r) => t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)).join(', ') : t('quien ya puede mover el negocio', 'whoever can already move the deal')}</td>
                        <td className="text-[13.5px] text-muted-2" data-testid="step-needs">{[s.requires_evidence ? t(`Evidencia: ${s.evidence_es ?? ''}`, `Evidence: ${s.evidence_en ?? ''}`) : null, s.needs_approval ? t(`Aprueba ${who(s)} en ${s.approval_hours} h hábiles${s.backup_name ? `; suplente, ${s.backup_name}` : ''}`, `${who(s)} approves within ${s.approval_hours} business hours${s.backup_name ? `; backup, ${s.backup_name}` : ''}`) : null].filter(Boolean).join(' · ') || t('nada más', 'nothing else')}</td>
                        <td className="text-right"><Dialog trigger={t('Editar', 'Edit')} title={t('Editar paso', 'Edit step')} size="sm" testId="step-edit"><StepForm pipelineId={p.id} market={p.market_code} stages={stages} step={s} /></Dialog></td>
                      </tr>
                    ))}
                  </Table>
                )}
                <div className="border-t border-line px-5 py-5 md:px-7">
                  <h3 className="text-[14px] font-semibold text-strong">{t('Tiempos por etapa', 'Times per stage')}</h3>
                  <p className="mb-3 mt-1 text-[13px] text-muted-2">{t('La meta es cuánto puede estar un negocio en la etapa, en horas hábiles: la ficha muestra el reloj. Los días de espera de un tercero reemplazan a los de estancamiento cuando el negocio espera a alguien de fuera.', 'The goal is how long a deal may stay in the stage, in business hours: the deal page shows the clock. The third-party wait days replace the stall days when the deal is waiting on someone outside.')}</p>
                  <ul className="divide-y divide-line">
                    {stages.filter((s) => s.kind === 'open' || s.kind === 'awaiting_txn').map((s) => (
                      <li key={s.id} className="py-3" data-testid="stage-times-row">
                        <NoticeForm action={stageTimesAction} className="flex flex-wrap items-end gap-4" testId="stage-times-form">
                          <input type="hidden" name="stage_id" value={s.id} />
                          <span className="min-w-[180px] flex-1 text-[14px] font-medium text-strong">{t(s.name_es, s.name_en)}{s.is_ops && <span className="ml-2 text-[12.5px] text-muted-2">{t('Operaciones', 'Operations')}</span>}<span className="block text-[12.5px] font-normal text-muted-2">{s.rot_days ? t(`se estanca a los ${s.rot_days} días`, `stalls after ${s.rot_days} days`) : t('nunca se marca como estancada', 'never flagged as stalled')}</span></span>
                          <Field label={t('Meta (horas hábiles)', 'Goal (business hours)')}><input name="sla_hours" type="number" inputMode="numeric" min={1} max={2000} className="input !w-28" defaultValue={s.sla_hours ?? ''} data-testid="stage-sla" /></Field>
                          <Field label={t('Espera de un tercero (días)', 'Third-party wait (days)')}><input name="rot_days_waiting" type="number" inputMode="numeric" min={0} max={365} className="input !w-28" defaultValue={s.rot_days_waiting ?? ''} data-testid="stage-wait" /></Field>
                          <Field label={t('Espera del cliente (días)', 'Customer wait (days)')}><input name="rot_days_customer" type="number" inputMode="numeric" min={1} max={365} className="input !w-28" defaultValue={s.rot_days_customer ?? ''} data-testid="stage-wait-customer" /></Field>
                          <Field label={t('Espera del carrier (días)', 'Carrier wait (days)')}><input name="rot_days_carrier" type="number" inputMode="numeric" min={1} max={365} className="input !w-28" defaultValue={s.rot_days_carrier ?? ''} data-testid="stage-wait-carrier" /></Field>
                          <Submit variant="ghost" size="sm" testId="stage-times-save">{t('Guardar', 'Save')}</Submit>
                        </NoticeForm>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            )
          })}
        </div>
      </NoticeArea>
    )
  }

  async function Leads() {
    const rows = await escalationConfig(ctx)
    return (
      <NoticeArea closeLabel={t('Cerrar aviso', 'Dismiss notice')}>
        <Card data-testid="escalation-config">
          <CardTitle title={t('Escalamiento del primer contacto', 'First-contact escalation')} hint={t('Cuando vence la meta de primer contacto de un lead y nadie lo ha intentado, CONTIGO le deja una tarea en Hoy a supervisión. Si pasan más horas hábiles sin intento, a quien lidera el mercado. Cada mercado lo enciende cuando ya fijó su meta con sus propios datos. El aviso llega dentro de CONTIGO, no por correo ni por Slack.', 'When a lead’s first-contact goal passes and nobody has tried, CONTIGO leaves a task in Today for the supervisor. If more business hours go by with no attempt, for the market lead. Each market turns it on once it has set its goal with its own data. The notice arrives inside CONTIGO, not by email or Slack.')} />
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.market_code} className="py-4" data-testid="escalation-row" data-market={r.market_code}>
                <NoticeForm action={escalationAction} className="flex flex-wrap items-end gap-5" testId="escalation-form">
                  <input type="hidden" name="market" value={r.market_code} />
                  <span className="min-w-[160px] flex-1 text-[14.5px] font-semibold text-strong">{r.name}<span className="block text-[12.5px] font-normal text-muted-2" data-testid="escalation-open">{t(`${r.escalated_open} ${r.escalated_open === 1 ? 'lead escalado' : 'leads escalados'} sin atender`, `${r.escalated_open} escalated ${r.escalated_open === 1 ? 'lead' : 'leads'} still unattended`)}</span></span>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="active" className="h-5 w-5 shrink-0" defaultChecked={r.is_active} data-testid="escalation-active" /><span>{t('Encendido', 'On')}</span></label>
                  <Field label={t('Segundo aviso, horas hábiles después', 'Second notice, business hours later')}><input name="hours" type="number" inputMode="numeric" min={1} max={72} className="input !w-28" required defaultValue={r.level2_hours} data-testid="escalation-hours" /></Field>
                  <Submit variant="ghost" size="sm" testId="escalation-save">{t('Guardar', 'Save')}</Submit>
                </NoticeForm>
              </li>
            ))}
          </ul>
        </Card>
      </NoticeArea>
    )
  }

  async function Jobs() {
    const d = await jobsPanel(ctx)
    const cron = Boolean(env().CRON_SECRET)
    const TRIGGER: Record<string, [string, string]> = { cron: ['disparo externo', 'external trigger'], visit: ['con la app en uso', 'while the app is in use'], manual: ['a mano', 'by hand'], api: ['por la API', 'through the API'], watch: ['vigilancia de cargas', 'load watch'] }
    return (
      <NoticeArea closeLabel={t('Cerrar aviso', 'Dismiss notice')}>
        <div className="space-y-8" data-testid="jobs-panel">
          <Card data-testid="jobs-triggers">
            <CardTitle title={t('Cómo se disparan', 'How they are triggered')} />
            <ul className="space-y-2 text-[14px]">
              <li><Badge tone="good">{t('Encendido', 'On')}</Badge> <span className="ml-2">{t('Con la app en uso: cuando alguien abre una pantalla, lo que ya toca corre después de responder, como mucho una vez por minuto.', 'While the app is in use: when someone opens a screen, whatever is due runs after responding, at most once a minute.')}</span></li>
              <li data-testid="jobs-cron" data-on={cron ? '1' : '0'}>{cron ? <Badge tone="good">{t('Encendido', 'On')}</Badge> : <Badge tone="warn">{t('Apagado', 'Off')}</Badge>} <span className="ml-2">{cron ? t('Disparo externo por horario: recibe llamadas con el secreto configurado.', 'External scheduled trigger: it accepts calls with the configured secret.') : t('Disparo externo por horario: falta configurar el secreto (CRON_SECRET) y que la plataforma llame a la ruta cada minuto. Sin eso, de noche o en fin de semana las tareas corren hasta que alguien abre la app.', 'External scheduled trigger: the secret (CRON_SECRET) is not set and the platform is not calling the route every minute. Without that, at night or on weekends jobs run only once someone opens the app.')}</span></li>
            </ul>
          </Card>
          <Card pad={false}>
            <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Tareas', 'Jobs')} hint={t('Una tarea nunca corre dos veces a la vez. "Correr ahora" no espera su turno y queda en la bitácora con tu nombre.', 'A job never runs twice at the same time. "Run now" does not wait for its turn and is logged under your name.')} /></div>
            <Table label={t('Tareas programadas', 'Scheduled jobs')} head={<><th>{t('Tarea', 'Job')}</th><th>{t('Cada cuánto', 'How often')}</th><th>{t('Última corrida', 'Last run')}</th>{ctx.can('job.run') && <th className="relative"><span className="sr-only">{t('Correr', 'Run')}</span></th>}</>}>
              {d.jobs.map((j) => (
                <tr key={j.key} className="table-row" data-testid="job-row" data-key={j.key}>
                  <td><span className="font-semibold text-strong">{j.key}</span><span className="mt-0.5 block max-w-xl text-[13px] text-muted-2">{t(j.description.es, j.description.en)}</span></td>
                  <td className="num text-[13.5px]">{j.everyMinutes < 60 ? t(`${j.everyMinutes} min`, `${j.everyMinutes} min`) : j.everyMinutes % 1440 === 0 ? t(`${j.everyMinutes / 1440} ${j.everyMinutes === 1440 ? 'día' : 'días'}`, `${j.everyMinutes / 1440} ${j.everyMinutes === 1440 ? 'day' : 'days'}`) : t(`${Math.round(j.everyMinutes / 60)} h`, `${Math.round(j.everyMinutes / 60)} h`)}</td>
                  <td className="text-[13.5px]" data-testid="job-last">{j.last ? <>{j.last.status === 'ok' ? <Badge tone="good">{t('Bien', 'OK')}</Badge> : <Badge tone="bad">{t('Falló', 'Failed')}</Badge>} <span className="ml-1 text-muted-2">{ago(j.last.started_at, locale)} · {j.last.duration_ms} ms · {t(`${j.last.done} ${j.last.done === 1 ? 'registro' : 'registros'}`, `${j.last.done} ${j.last.done === 1 ? 'record' : 'records'}`)}</span></> : <span className="text-muted-2">{t('todavía no ha corrido', 'it has not run yet')}</span>}</td>
                  {ctx.can('job.run') && <td className="text-right"><NoticeForm action={runJobAction} testId="job-run"><input type="hidden" name="key" value={j.key} /><Submit variant="ghost" size="sm" testId="job-run-btn">{t('Correr ahora', 'Run now')}</Submit></NoticeForm></td>}
                </tr>
              ))}
            </Table>
          </Card>
          <Card pad={false}>
            <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Corridas recientes', 'Recent runs')} /></div>
            {d.runs.length === 0 ? <p className="px-5 pb-6 text-[13.5px] text-muted md:px-7">{t('Todavía no hay corridas.', 'There are no runs yet.')}</p> : (
              <Table label={t('Corridas recientes', 'Recent runs')} testId="job-runs" head={<><th>{t('Cuándo', 'When')}</th><th>{t('Tarea', 'Job')}</th><th>{t('Cómo', 'How')}</th><th>{t('Resultado', 'Result')}</th><th>{t('Duración', 'Duration')}</th></>}>
                {d.runs.map((r) => (
                  <tr key={r.id} className="table-row" data-testid="job-run-row">
                    <td className="text-[13.5px]">{dayTime(r.started_at, locale, tz)}</td>
                    <td className="text-[13.5px]">{r.job_key}</td>
                    <td className="text-[13.5px] text-muted-2">{t(TRIGGER[r.trigger]?.[0] ?? r.trigger, TRIGGER[r.trigger]?.[1] ?? r.trigger)}{r.actor ? ` · ${r.actor}` : ''}</td>
                    <td className="text-[13.5px]">{r.status === 'ok' ? t(`${r.done} ${r.done === 1 ? 'registro' : 'registros'}`, `${r.done} ${r.done === 1 ? 'record' : 'records'}`) : r.status === 'running' ? t('Corriendo', 'Running') : r.status === 'paused' ? t('En pausa por mantenimiento', 'Paused for maintenance') : r.status === 'late' ? t('No llegó a su hora', 'Did not arrive on time') : <span className="font-semibold text-red-text">{t(`Falló (${r.error ?? 'error'})`, `Failed (${r.error ?? 'error'})`)}</span>}</td>
                    <td className="num text-[13.5px]">{r.duration_ms} ms</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      </NoticeArea>
    )
  }
}
