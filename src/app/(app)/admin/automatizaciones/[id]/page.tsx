import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getAutomation, type LogRow } from '@/dal/automations'
import { ACTION_LABEL, ACTION_TYPES, EVENTS, FIELDS, NOTICE_KINDS, NOTICE_SOURCE, OP_LABEL, OPS_FOR, SETTABLE, SEVERITIES, SOURCE_LABEL, TARGET_ROLES, describe, type ActionType } from '@/domain/automation/catalog'
import { ROLE_LABEL, type Role } from '@/domain/policy'
import { Badge, Card, CardTitle, Field, PageHeader, Table } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { AutomationFields, AutomationTest } from '@/ui/automation'
import { dayTime } from '@/lib/format'
import { EXCEPTION, MOTOR, lab } from '@/lib/labels'
import { flat } from '@/server/params'
import { readerTimeZone } from '@/server/timezone'
import { saveAutomationAction, testAutomationAction, toggleAutomationAction } from '../actions'

const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export default async function AutomationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('automation.read')) notFound()
  const { id } = await params
  if (!isId(id)) notFound()
  const data = await getAutomation(ctx, id)
  if (!data) notFound()
  const { a, log, people, stages, motors } = data
  const { t, locale } = ctx
  const manage = ctx.can('automation.manage')
  const sp = flat(await searchParams)
  const tz = await readerTimeZone(ctx)
  const names = Object.fromEntries(people.map((p) => [p.id, p.full_name]))
  const trigger = a.trigger_kind === 'event' ? ({ kind: 'event', event: a.trigger_event! } as const) : ({ kind: 'schedule' } as const)
  const stageNames = Object.fromEntries(stages.map((x) => [x.code, { es: x.name_es, en: x.name_en }]))
  const d = describe({ source: a.source, trigger, conditions: a.conditions, actions: a.actions }, names, stageNames)
  const market = ctx.markets.find((m) => m.code === a.market_code)

  // Qué acciones caben según el tipo de registro y el disparador.
  const fits = (type: ActionType): boolean =>
    type === 'open_exception' ? a.trigger_kind === 'schedule'
      : a.source === 'account_pair' ? false
      : type === 'assign' ? a.source === 'lead'
      : type === 'move_stage' ? a.source === 'deal'
      : type === 'set_field' ? Object.values(SETTABLE).some((s) => s.source === a.source)
      : true
  const targets = [
    { value: 'owner', label: t('Quien lleva el registro', 'The record owner') },
    ...TARGET_ROLES.map((r) => ({ value: `role:${r}`, label: t(ROLE_LABEL[r as Role].es, ROLE_LABEL[r as Role].en) })),
    ...people.map((p) => ({ value: `user:${p.id}`, label: p.full_name })),
  ]

  const outcome = (l: LogRow): { tone: 'good' | 'warn' | 'bad' | 'neutral'; text: string } => {
    const det = l.detail as { action?: string; kind?: string; people?: number; reason?: { es: string; en: string }; condition?: { field: string }; error?: string; stage_code?: string }
    const what = det.action && det.action in ACTION_LABEL ? t(ACTION_LABEL[det.action as ActionType].es, ACTION_LABEL[det.action as ActionType].en) : ''
    if (l.outcome === 'done') {
      if (det.action === 'open_exception') return { tone: 'good', text: t(`Abrió el aviso "${lab(t, EXCEPTION[det.kind ?? '']?.label)}"`, `Opened the "${lab(t, EXCEPTION[det.kind ?? '']?.label)}" notice`) }
      if (det.action === 'create_task') return { tone: 'good', text: t(`Creó ${det.people ?? 1} ${det.people === 1 ? 'tarea' : 'tareas'}`, `Created ${det.people ?? 1} ${det.people === 1 ? 'task' : 'tasks'}`) }
      if (det.action === 'notify') return { tone: 'good', text: t(`Avisó a ${det.people ?? 1} ${det.people === 1 ? 'persona' : 'personas'}`, `Notified ${det.people ?? 1} ${det.people === 1 ? 'person' : 'people'}`) }
      return { tone: 'good', text: what }
    }
    if (l.outcome === 'closed') return { tone: 'neutral', text: t('Cerró el aviso: ya no se cumple la condición', 'Closed the notice: the condition no longer holds') }
    if (l.outcome === 'skipped') {
      if (det.reason) return { tone: 'warn', text: t(`No aplicó: ${det.reason.es}`, `Did not apply: ${det.reason.en}`) }
      const f = FIELDS[a.source].find((x) => x.key === det.condition?.field)
      return { tone: 'warn', text: t(`No aplicó: no se cumple "${f?.label.es ?? det.condition?.field ?? ''}"`, `Did not apply: "${f?.label.en ?? det.condition?.field ?? ''}" is not met`) }
    }
    return { tone: 'bad', text: t(`Falló al ${what.toLowerCase() || 'actuar'} (${det.error ?? 'error'})`, `Failed to ${what.toLowerCase() || 'act'} (${det.error ?? 'error'})`) }
  }
  const recordHref = (l: LogRow) => (!l.record_id ? null : l.object === 'deal' ? `/deals/${l.record_id}` : l.object === 'lead' ? `/leads/${l.record_id}` : `/comercios/${l.record_id}`)

  return (
    <>
      <PageHeader
        eyebrow={t('Automatizaciones', 'Automations')}
        title={t(a.name_es, a.name_en)}
        desc={[market?.name ?? a.market_code, a.motor ? lab(t, MOTOR[a.motor]) || a.motor : t('todos los tipos de venta', 'all sales types'), t(SOURCE_LABEL[a.source].es, SOURCE_LABEL[a.source].en), t(`versión ${a.version}`, `version ${a.version}`)].join(' · ')}
        actions={<Link href="/admin/automatizaciones" className="text-[13.5px] font-medium text-blue-text underline">{t('Todas las automatizaciones', 'All automations')}</Link>}
      />
      {sp.nueva && <p role="status" className="mb-6 rounded-[14px] bg-green-100 px-5 py-4 text-[14px] font-medium text-brand-text" data-testid="auto-created">{t('Automatización creada, en pausa. Revísala, pruébala contra un registro y actívala.', 'Automation created, paused. Review it, test it against a record and turn it on.')}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card data-testid="auto-readable">
            <CardTitle title={t('Qué hace', 'What it does')} right={a.is_active ? <Badge tone="good">{t('Activa', 'On')}</Badge> : <Badge tone="warn">{t('En pausa', 'Paused')}</Badge>} />
            <dl className="space-y-3 text-[14.5px]">
              <div><dt className="text-[12.5px] font-semibold uppercase tracking-wide text-muted-2">{t('Cuando', 'When')}</dt><dd data-testid="auto-when">{t(d.when.es, d.when.en)}</dd></div>
              <div><dt className="text-[12.5px] font-semibold uppercase tracking-wide text-muted-2">{t('Si', 'If')}</dt>
                <dd data-testid="auto-if">{d.ifs.length ? <ul className="list-disc pl-5">{d.ifs.map((x, i) => <li key={i}>{t(x.es, x.en)}</li>)}</ul> : t('Siempre (sin condiciones)', 'Always (no conditions)')}</dd></div>
              <div><dt className="text-[12.5px] font-semibold uppercase tracking-wide text-muted-2">{t('Entonces', 'Then')}</dt>
                <dd data-testid="auto-then"><ul className="list-disc pl-5">{d.then.map((x, i) => <li key={i}>{t(x.es, x.en)}</li>)}</ul></dd></div>
            </dl>
            <p className="mt-4 text-[13px] text-muted-2" data-testid="auto-meta">{[a.owner_name ? t(`Responde por ella: ${a.owner_name}`, `Owner: ${a.owner_name}`) : t('Sin dueño: ponle uno al guardar', 'No owner: set one when saving'), a.updated_by_name ? t(`último cambio de ${a.updated_by_name}, ${dayTime(a.updated_at, locale, tz)}`, `last changed by ${a.updated_by_name}, ${dayTime(a.updated_at, locale, tz)}`) : t('creada con el mercado, sin cambios', 'created with the market, unchanged')].join(' · ')}</p>
            {manage && (
              <ActionForm action={toggleAutomationAction} className="mt-4" testId="auto-toggle">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="active" value={a.is_active ? '0' : '1'} />
                <Submit variant={a.is_active ? 'ghost' : 'primary'} testId="auto-toggle-btn">{a.is_active ? t('Pausar', 'Pause') : t('Activar', 'Turn on')}</Submit>
              </ActionForm>
            )}
          </Card>

          {manage && (
            <Card data-testid="auto-edit">
              <CardTitle title={t('Cambiar', 'Edit')} hint={t('El mercado, el tipo de registro y el disparador no cambian: para eso se crea otra automatización. Al guardar sube la versión.', 'The market, the kind of record and the trigger do not change: create another automation for that. Saving raises the version.')} />
              <ActionForm action={saveAutomationAction} className="space-y-6" testId="auto-form">
                <input type="hidden" name="id" value={a.id} />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t('Nombre en español', 'Name in Spanish')}><input name="name_es" className="input" required minLength={3} maxLength={120} defaultValue={a.name_es} data-testid="auto-name-es" /></Field>
                  <Field label={t('Nombre en inglés', 'Name in English')}><input name="name_en" className="input" required minLength={3} maxLength={120} defaultValue={a.name_en} data-testid="auto-name-en" /></Field>
                  <Field label={t('Tipo de venta', 'Sales type')}>
                    <select name="motor" className="input" defaultValue={a.motor ?? ''}><option value="">{t('Todos los de este mercado', 'All in this market')}</option>{motors.map((m) => <option key={m} value={m}>{lab(t, MOTOR[m]) || m}</option>)}</select>
                  </Field>
                  <Field label={t('Quién responde por ella', 'Who owns it')}>
                    <select name="owner_id" className="input" defaultValue={a.owner_id ?? ''} data-testid="auto-owner"><option value="">{t('Sin dueño', 'No owner')}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
                  </Field>
                </div>
                <AutomationFields
                  fields={FIELDS[a.source].map((f) => ({ key: f.key, label: t(f.label.es, f.label.en), type: f.type, ops: OPS_FOR[f.type].map((o) => ({ value: o, label: t(OP_LABEL[o].es, OP_LABEL[o].en) })), options: f.dynamic === 'stage' ? stages.map((x) => ({ value: x.code, label: t(x.name_es, x.name_en) })) : (f.options ?? []).map((o) => ({ value: o.value, label: t(o.label.es, o.label.en) })) }))}
                  actionTypes={ACTION_TYPES.filter(fits).map((x) => ({ value: x, label: t(ACTION_LABEL[x].es, ACTION_LABEL[x].en) }))}
                  targets={targets}
                  kinds={NOTICE_KINDS.filter((k) => NOTICE_SOURCE[k] === a.source).map((k) => ({ value: k, label: lab(t, EXCEPTION[k]?.label) }))}
                  severities={SEVERITIES.map((s) => ({ value: s, label: s === 'high' ? t('Alta', 'High') : s === 'medium' ? t('Media', 'Medium') : t('Baja', 'Low') }))}
                  stages={stages.map((s) => ({ value: s.code, label: t(s.name_es, s.name_en) }))}
                  settable={Object.entries(SETTABLE).filter(([, s]) => s.source === a.source).map(([key, s]) => ({ key, label: t(s.label.es, s.label.en), values: s.values.map((v) => ({ value: v.value, label: t(v.label.es, v.label.en) })) }))}
                  initialConditions={a.conditions}
                  initialActions={a.actions as unknown as Record<string, string | number>[]}
                  labels={{
                    ifTitle: t('Si', 'If'), ifHint: t('Tienen que cumplirse todas. Sin condiciones, aplica a todos los registros de su tipo en este mercado.', 'All of them must hold. With no conditions, it applies to every record of its kind in this market.'),
                    none: t('Sin condiciones.', 'No conditions.'), addCondition: t('Agregar condición', 'Add condition'), remove: t('Quitar', 'Remove'), field: t('Campo', 'Field'), compare: t('Comparación', 'Comparison'), value: t('Valor', 'Value'),
                    thenTitle: t('Entonces', 'Then'), thenHint: t('Entre una y tres acciones. Cada una se hace por las mismas reglas que valen en la pantalla: si una regla no la deja pasar, queda en la bitácora por qué.', 'Between one and three actions. Each one follows the same rules as the screen: if a rule blocks it, the log says why.'),
                    addAction: t('Agregar acción', 'Add action'), what: t('Qué hace', 'What it does'), who: t('Para quién', 'For whom'), textEs: t('Texto en español', 'Text in Spanish'), textEn: t('Texto en inglés', 'Text in English'),
                    days: t('Vence en (días)', 'Due in (days)'), kind: t('Tipo de aviso', 'Kind of notice'), urgency: t('Urgencia', 'Urgency'), stage: t('Etapa de destino', 'Destination stage'), setField: t('Campo', 'Field'), setValue: t('Valor', 'Value'),
                  }}
                />
                <div className="flex justify-end"><Submit testId="auto-save">{t('Guardar automatización', 'Save automation')}</Submit></div>
              </ActionForm>
            </Card>
          )}

          <Card pad={false} data-testid="auto-log">
            <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Bitácora de esta automatización', 'This automation’s log')} hint={t('Cada vez que actuó sobre un registro, y cada vez que no aplicó y por qué. Se muestran las 50 más recientes.', 'Every time it acted on a record, and every time it did not apply and why. The 50 most recent are shown.')} /></div>
            {log.length === 0 ? <p className="px-5 pb-6 text-[13.5px] text-muted md:px-7" data-testid="auto-log-empty">{t('Todavía no ha hecho nada. Aparece aquí en cuanto corra y encuentre un registro.', 'It has not done anything yet. It shows up here as soon as it runs and finds a record.')}</p> : (
              <Table label={t('Bitácora de la automatización', 'Automation log')} head={<><th>{t('Cuándo', 'When')}</th><th>{t('Registro', 'Record')}</th><th>{t('Qué pasó', 'What happened')}</th><th>{t('Versión', 'Version')}</th></>}>
                {log.map((l) => {
                  const o = outcome(l)
                  const href = recordHref(l)
                  return (
                    <tr key={l.id} className="table-row" data-testid="auto-log-row" data-outcome={l.outcome}>
                      <td className="whitespace-nowrap text-[13.5px]">{dayTime(l.at, locale, tz)}</td>
                      <td className="text-[13.5px]">{href ? <Link href={href} className="text-blue-text underline">{l.record_label ?? t('Abrir registro', 'Open record')}</Link> : (l.record_label ?? t('s/d', 'n/a'))}</td>
                      <td className="text-[13.5px]"><Badge tone={o.tone}>{o.text}</Badge></td>
                      <td className="num text-[13.5px] text-muted-2">{l.version}</td>
                    </tr>
                  )
                })}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card data-testid="auto-test-card">
            <CardTitle title={t('Probar contra un registro', 'Test against a record')} hint={t('Dice qué haría, condición por condición. No cambia nada.', 'It says what it would do, condition by condition. It changes nothing.')} />
            <AutomationTest
              action={testAutomationAction}
              id={a.id}
              conditions={d.ifs.map((x) => t(x.es, x.en))}
              labels={{
                record: t('Registro', 'Record'),
                hint: a.source === 'deal' ? t('Pega la dirección de la ficha del negocio, o su identificador.', 'Paste the address of the deal page, or its identifier.') : a.source === 'lead' ? t('Pega la dirección de la ficha del lead, o su identificador.', 'Paste the address of the lead page, or its identifier.') : t('Pega la dirección de la ficha del comercio, o su identificador.', 'Paste the address of the merchant page, or its identifier.'),
                run: t('Probar', 'Test'),
                notFound: t('No encontramos ese registro entre los que esta automatización revisa (por ejemplo, un negocio ya cerrado).', 'We could not find that record among the ones this automation checks (for example, a deal already closed).'),
                outOfScope: t('Es de otro mercado o de otro tipo de venta: esta automatización no lo toca.', 'It belongs to another market or sales type: this automation does not touch it.'),
                would: t('Con este registro, sí actuaría.', 'With this record, it would act.'),
                wouldNot: t('Con este registro, no haría nada.', 'With this record, it would do nothing.'),
                already: t('Cumple las condiciones y ya actuó sobre él: no repite hasta que la condición cambie.', 'It meets the conditions and it already acted on it: it does not repeat until the condition changes.'),
                met: t('Sí:', 'Yes:'), unmet: t('No:', 'No:'),
                noConditions: t('No tiene condiciones: aplica a todos.', 'It has no conditions: it applies to all.'),
              }}
            />
          </Card>
          <Card>
            <CardTitle title={t('Cómo corre', 'How it runs')} />
            <p className="text-[13.5px] text-muted-2">{a.trigger_kind === 'event'
              ? t(`Se dispara con el evento "${EVENTS[a.trigger_event ?? '']?.label.es ?? a.trigger_event}". Los eventos se revisan cada minuto.`, `It is triggered by the "${EVENTS[a.trigger_event ?? '']?.label.en ?? a.trigger_event}" event. Events are checked every minute.`)
              : t('Corre con la revisión por horario, cada 15 minutos. Sobre cada registro actúa una vez mientras la condición siga igual.', 'It runs with the scheduled check, every 15 minutes. It acts once on each record while the condition stays the same.')}</p>
            {ctx.can('status.read') && <p className="mt-3 text-[13.5px]"><Link href="/admin/automatizaciones?v=tareas" className="text-blue-text underline">{t('Ver las tareas programadas y sus corridas', 'See the scheduled jobs and their runs')}</Link></p>}
          </Card>
        </div>
      </div>
    </>
  )
}
