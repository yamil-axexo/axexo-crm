import type { Ctx } from '@/server/context'
import { withUser } from '@/server/db'
import { FUNNEL_SETTINGS, listFunnelSettings } from '@/domain/embudo2/settings'
import type { RuleMatch } from '@/domain/embudo/routing'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { editAssignmentRuleAction, saveFunnelSettingAction } from '@/app/(app)/embudo2-actions'

/** embudo2: valores del embudo que decide el negocio. Cada uno dice si es propuesto y quién lo tiene que confirmar. */
export async function FunnelSettingsCard({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const rows = await listFunnelSettings(ctx)
  const canEdit = ctx.can('config.manage')
  const show = (v: unknown) => (v === null ? t('vacío', 'empty') : typeof v === 'boolean' ? (v ? t('sí', 'yes') : t('no', 'no')) : String(v))
  return (
    <Card data-testid="funnel-settings">
      <CardTitle title={t('Valores del embudo', 'Pipeline settings')} hint={t('Los decide el negocio. Mientras nadie los confirme, se muestran como valor propuesto con quién lo tiene que decidir.', 'The business decides them. Until someone confirms them, they show as a proposed value with who has to decide.')} />
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const def = FUNNEL_SETTINGS.find((d) => d.key === r.key)
          if (!def) return null
          const value = def.kind === 'choice' ? def.options!.find((o) => o.value === r.value)?.label[locale] ?? show(r.value) : show(r.value)
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="funnel-setting" data-key={r.key}>
              <span className="min-w-[220px] flex-1">
                <span className="block text-[14.5px] font-medium text-strong">{def.label[locale]}{r.market_code ? ` · ${r.market_code}` : ''}</span>
                <span className="block text-[12.5px] text-muted-2">{def.help[locale]}</span>
                {r.proposed && <span className="block text-[12.5px] font-medium text-strong" data-testid="funnel-setting-proposed">{t(`Valor propuesto, [pendiente: ${r.pending_owner ?? 'por definir'}]`, `Proposed value, [pending: ${r.pending_owner ?? 'to be defined'}]`)}</span>}
              </span>
              <Badge tone={r.proposed ? 'warn' : 'good'}><span data-testid="funnel-setting-value">{value}</span></Badge>
              {canEdit && (
                <Dialog trigger={t('Cambiar', 'Change')} title={def.label[locale]} size="sm" variant="quiet" testId="funnel-setting-edit">
                  <ActionForm action={saveFunnelSettingAction} onOk="close" className="space-y-4 text-left" testId="funnel-setting-form">
                    <input type="hidden" name="key" value={r.key} /><input type="hidden" name="market" value={r.market_code ?? ''} />
                    <Field label={t('Valor', 'Value')}>
                      {def.kind === 'choice' ? (
                        <select name="value" className="input" defaultValue={String(r.value)} data-testid="funnel-setting-input">{def.options!.map((o) => <option key={o.value} value={o.value}>{o.label[locale]}</option>)}</select>
                      ) : def.kind === 'bool' ? (
                        <select name="value" className="input" defaultValue={String(r.value)} data-testid="funnel-setting-input"><option value="true">{t('sí', 'yes')}</option><option value="false">{t('no', 'no')}</option></select>
                      ) : (
                        <input name="value" type="number" inputMode="numeric" min={def.min} max={def.max} className="input" defaultValue={r.value === null ? '' : String(r.value)} data-testid="funnel-setting-input" />
                      )}
                    </Field>
                    <label className="flex min-h-11 items-center gap-3 text-[14px]"><input type="checkbox" name="confirm" className="h-5 w-5" defaultChecked data-testid="funnel-setting-confirm" />{t('Es la decisión del negocio (deja de ser propuesta)', 'It is the business decision (no longer a proposal)')}</label>
                    <div className="flex justify-end"><Submit testId="funnel-setting-save">{t('Guardar', 'Save')}</Submit></div>
                  </ActionForm>
                </Dialog>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** PIPE-04: cuántos motivos activos hay contra el tope, por tipo y mercado. Quien custodia es C1 (administración). */
export async function ReasonCapsCard({ ctx }: { ctx: Ctx }) {
  const { t } = ctx
  const rows = await withUser(ctx.user.id, (tx) => tx<{ kind: string; scope: string; n: number; cap: number | null }[]>`
    select r.kind, coalesce(r.market_code, '*') as scope, count(*)::int as n,
           (app.funnel_setting(r.market_code, case when r.market_code is null then 'reason_core_max' else 'reason_max_extensions' end))::text::int as cap
      from crm.loss_reasons r where r.is_active group by r.kind, r.market_code order by r.kind, r.market_code nulls first`)
  const kind = (k: string) => (k === 'lost' ? t('Pérdida', 'Loss') : t('No venta', 'No sale'))
  return (
    <Card data-testid="reason-caps">
      <CardTitle title={t('Tope del catálogo de motivos', 'Reason catalog cap')} hint={t('Catálogo corto: motivos de base para todos y unos pocos propios por mercado. Lo custodia C1 desde Administración; ventas propone cambios cada trimestre por Solicitudes. Un motivo usado nunca se borra: se apaga.', 'Short catalog: base reasons for everyone and a few of each market’s own. C1 keeps it from Administration; sales proposes changes every quarter through Requests. A reason in use is never deleted: it is turned off.')} />
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.scope}`} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="reason-cap-row">
            <span className="flex-1 text-[14px] text-strong">{kind(r.kind)} · {r.scope === '*' ? t('base, todos los mercados', 'base, all markets') : t(`propios de ${r.scope}`, `${r.scope} only`)}</span>
            <Badge tone={r.cap !== null && r.n > r.cap ? 'bad' : 'good'}><span data-testid="reason-cap-count">{r.n}{r.cap !== null ? ` / ${r.cap}` : ''}</span></Badge>
            {r.cap !== null && r.n > r.cap && <span className="w-full text-[12.5px] text-muted-2" data-testid="reason-cap-over">{t(`Hay ${r.n - r.cap} de más: apaga los que no se usan. Mientras tanto no se puede agregar otro. [pendiente: Yamil (C1) con ventas]`, `There are ${r.n - r.cap} too many: turn off the ones not in use. Meanwhile no other can be added. [pending: Yamil (C1) with sales]`)}</span>}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** LEAD-03: editar el nombre y la condición de una regla de asignación sin crear otra. */
export function EditRuleDialog({ ctx, rule, sources, motors }: { ctx: Ctx; rule: { id: string; name: string; match: RuleMatch | null }; sources: [string, string][]; motors: [string, string][] }) {
  const { t } = ctx
  const m = rule.match ?? {}
  return (
    <Dialog trigger={t('Editar', 'Edit')} title={t('Editar la regla', 'Edit the rule')} size="sm" variant="ghost" testId="rule-edit">
      <ActionForm action={editAssignmentRuleAction} onOk="close" className="space-y-4 text-left" testId="rule-edit-form">
        <input type="hidden" name="id" value={rule.id} />
        <Field label={t('Nombre de la regla', 'Rule name')}><input name="name" className="input" required minLength={2} maxLength={80} defaultValue={rule.name} data-testid="rule-edit-name" /></Field>
        <fieldset><legend className="mb-1 text-[13px] font-medium text-muted">{t('Origen del lead (vacío: cualquiera)', 'Lead source (empty: any)')}</legend>
          <div className="grid grid-cols-2 gap-x-4">{sources.map(([k, l]) => <label key={k} className="flex min-h-11 items-center gap-3 text-[14px]"><input type="checkbox" name="sources" value={k} defaultChecked={m.sources?.includes(k) ?? false} className="h-5 w-5" data-testid={`rule-edit-source-${k}`} />{l}</label>)}</div>
        </fieldset>
        <fieldset><legend className="mb-1 text-[13px] font-medium text-muted">{t('Tipo de venta (vacío: cualquiera)', 'Sales type (empty: any)')}</legend>
          <div className="grid grid-cols-2 gap-x-4">{motors.map(([k, l]) => <label key={k} className="flex min-h-11 items-center gap-3 text-[14px]"><input type="checkbox" name="motors" value={k} defaultChecked={m.motors?.includes(k) ?? false} className="h-5 w-5" data-testid={`rule-edit-motor-${k}`} />{l}</label>)}</div>
        </fieldset>
        {(m.form_ids ?? []).map((x) => <input key={x} type="hidden" name="form_ids" value={x} />)}
        {(m.territory_ids ?? []).map((x) => <input key={x} type="hidden" name="territory_ids" value={x} />)}
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('Tiendas desde', 'Stores from')}><input name="size_min" type="number" min={1} className="input" defaultValue={m.size_min ?? ''} /></Field>
          <Field label={t('Tiendas hasta', 'Stores up to')}><input name="size_max" type="number" min={1} className="input" defaultValue={m.size_max ?? ''} /></Field>
        </div>
        <div className="flex justify-end"><Submit testId="rule-edit-save">{t('Guardar', 'Save')}</Submit></div>
      </ActionForm>
    </Dialog>
  )
}

/** Estado de CONTIGO: los valores del embudo que siguen como propuesta, con quién los tiene que decidir (ola 6, embudo2). */
export async function ProposedFunnelValues({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const rows = (await listFunnelSettings(ctx)).filter((r) => r.proposed)
  const steps = await withUser(ctx.user.id, (tx) => tx<{ id: string; name_es: string; name_en: string; pending_owner: string }[]>`
    select t.id, p.name || ': ' || s.name_es as name_es, p.name || ': ' || s.name_en as name_en, t.pending_owner
      from crm.stage_transitions t join crm.pipelines p on p.id = t.pipeline_id join crm.stages s on s.id = t.to_stage_id
     where t.pending_owner is not null order by p.name`)
  if (rows.length === 0 && steps.length === 0) return null
  return (
    <Card data-testid="status-proposed">
      <CardTitle title={t('Valores propuestos por decidir', 'Proposed values to decide')} hint={t('Funcionan con un valor conservador que se puede cambiar en Administración, Embudo y Automatizaciones. Falta que su dueño lo confirme.', 'They run on a conservative value that can be changed under Administration, Pipeline and Automations. Their owner still has to confirm it.')} />
      <ul className="divide-y divide-line text-[14px]">
        {rows.map((r) => {
          const def = FUNNEL_SETTINGS.find((d) => d.key === r.key)
          return <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2" data-testid="status-proposed-row"><span className="text-strong">{def?.label[locale] ?? r.key}{r.market_code ? ` · ${r.market_code}` : ''}</span><span className="text-muted-2">{t(`pendiente: ${r.pending_owner ?? 'por definir'}`, `pending: ${r.pending_owner ?? 'to be defined'}`)}</span></li>
        })}
        {steps.map((s) => <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2" data-testid="status-proposed-row"><span className="text-strong">{t(`Paso a "${s.name_es}" (en pausa)`, `Step to "${s.name_en}" (paused)`)}</span><span className="text-muted-2">{t(`pendiente: ${s.pending_owner}`, `pending: ${s.pending_owner}`)}</span></li>)}
      </ul>
    </Card>
  )
}
