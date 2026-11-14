import type { Ctx } from '@/server/context'
import { fieldRegistry, type RegistryField } from '@/dal/datos'
import { MOTORS } from '@/domain/b2b'
import { PII_CLASSES } from '@/domain/gobierno'
import { Badge, Card, CardTitle, Empty, Field, Pills, Table } from '@/ui/kit'
import { Dialog, Submit } from '@/ui/client'
import { NoticeForm } from '@/ui/admin'
import { addDays, ago, day, isoDay, pct } from '@/lib/format'
import { MOTOR, lab, qs } from '@/lib/labels'
import { FIELD_OBJECT, FIELD_TYPE, PII_CLASS } from '@/lib/datos-labels'
import { convertToListAction, decideOverlapAction, closePromotionAction, decideFieldAction, proposeFieldAction, requestPromotionAction, setFieldSchemaAction, updateFieldAction } from './actions'
import { toggleFieldAction } from '@/app/(app)/b2b-actions'

const VIEWS = ['vigentes', 'sin-decision', 'propuestos', 'archivados'] as const
type View = (typeof VIEWS)[number]
export const fieldView = (v: string | undefined): View => ((VIEWS as readonly string[]).includes(v ?? '') ? (v as View) : 'vigentes')

/**
 * GOB-01 / DAT-05: registro de campos. Cada campo tiene dueño, para qué sirve, qué decisión habilita, cuándo se revisa y
 * qué clase de dato es. Quien lidera un mercado propone; administración aprueba. El uso de cada campo sale aquí para
 * retirar lo que nadie llena.
 */
export async function CamposTab({ ctx, view }: { ctx: Ctx; view: View }) {
  const { t, locale } = ctx
  const d = await fieldRegistry(ctx, view)
  const admin = ctx.can('config.manage')
  const proposeIn = ctx.markets.filter((m) => m.status === 'live' && ctx.can('field.propose', m.code))
  const today = isoDay(new Date())
  const labels: Record<View, string> = { vigentes: t('Vigentes', 'In use'), 'sin-decision': t('Sin decisión o con revisión vencida', 'No decision or past review'), propuestos: t('Propuestas', 'Proposals'), archivados: t('Archivados', 'Archived') }
  const counts: Record<View, number> = { vigentes: d.counts.vigentes, 'sin-decision': d.counts.sin_decision, propuestos: d.counts.propuestos, archivados: d.counts.archivados }

  const governance = (f?: RegistryField) => (
    <>
      <Field label={t('¿Qué decisión habilita?', 'Which decision does it enable?')} className="col-span-2" hint={t('Sin una decisión escrita no hay campo.', 'No written decision, no field.')}>
        <textarea name="decision" rows={2} required minLength={10} maxLength={400} className="input !h-auto py-3" defaultValue={f?.decision ?? ''} data-testid="field-decision" />
      </Field>
      <Field label={t('¿Para qué sirve?', 'What is it for?')} className="col-span-2"><input name="purpose" className="input" required minLength={5} maxLength={400} defaultValue={f?.purpose ?? ''} data-testid="field-purpose" /></Field>
      <Field label={t('Responde por el campo', 'Field owner')}><select name="owner_id" className="input" required defaultValue={f?.owner_id ?? ctx.user.id} data-testid="field-owner">{d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
      <Field label={t('Se revisa el', 'Review on')}><input name="review_on" type="date" className="input" required min={addDays(today, 1)} defaultValue={f?.review_on && f.review_on > today ? f.review_on : addDays(today, 180)} data-testid="field-review" /></Field>
      <Field label={t('Clase de dato', 'Data class')}><select name="pii_class" className="input" defaultValue={f?.pii_class ?? 'none'} data-testid="field-pii">{PII_CLASSES.map((k) => <option key={k} value={k}>{t(...PII_CLASS[k]!)}</option>)}</select></Field>
      <Field label={t('Quién lo ve', 'Who sees it')}><select name="data_class" className="input" defaultValue={f?.data_class ?? 'internal'}><option value="public">{t('Se puede compartir fuera', 'Can be shared outside')}</option><option value="internal">{t('Interno', 'Internal')}</option><option value="confidential">{t('Confidencial', 'Confidential')}</option></select></Field>
      <Field label={t('De dónde viene el dato', 'Where the data comes from')}><input name="origin" className="input" maxLength={200} defaultValue={f?.origin ?? ''} placeholder={t('Lo captura quien vende', 'Captured by sales')} /></Field>
      <Field label={t('Quién lo usa', 'Who uses it')}><input name="used_by" className="input" maxLength={200} defaultValue={f?.used_by ?? ''} placeholder={t('Operaciones, reportes', 'Operations, reports')} /></Field>
      <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="untrusted" className="h-5 w-5 shrink-0" defaultChecked={f?.untrusted ?? false} disabled={f?.data_type === 'text'} data-testid="field-untrusted" />{f?.data_type === 'text' ? t('Llega de fuera sin validar: un campo de texto libre siempre lleva esta marca', 'Comes from outside without validation: a free-text field always carries this mark') : t('Llega de fuera sin validar (un formulario web, una importación). El texto libre la lleva siempre.', 'Comes from outside without validation (a web form, an import). Free text always carries it.')}</label>
    </>
  )

  return (
    <div className="space-y-8" data-testid="fields-tab">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Pills label={t('Vista', 'View')} current={view} items={VIEWS.map((k) => ({ key: k, href: qs('/datos', { tab: 'campos', vista: k === 'vigentes' ? undefined : k }), label: labels[k], count: counts[k] }))} />
        {proposeIn.length > 0 && (
          <Dialog trigger={t('Proponer campo', 'Propose a field')} title={t('Proponer un campo', 'Propose a field')} variant="primary" testId="field-propose">
            <NoticeForm action={proposeFieldAction} className="grid grid-cols-2 gap-4 text-left" testId="propose-form">
              <Field label={t('Nombre en español', 'Name in Spanish')}><input name="label_es" className="input" required minLength={2} maxLength={60} data-testid="propose-label-es" /></Field>
              <Field label={t('Nombre en inglés', 'Name in English')}><input name="label_en" className="input" required minLength={2} maxLength={60} data-testid="propose-label-en" /></Field>
              <Field label={t('Para', 'For')}><select name="object" className="input" data-testid="propose-object">{(['account', 'deal', 'lead', 'contact', 'activity'] as const).map((k) => <option key={k} value={k}>{t(...FIELD_OBJECT[k]!)}</option>)}</select></Field>
              <Field label={t('Tipo de dato', 'Data type')}><select name="data_type" className="input" data-testid="propose-type">{(['text', 'number', 'select', 'date', 'boolean'] as const).map((k) => <option key={k} value={k}>{t(...FIELD_TYPE[k]!)}</option>)}</select></Field>
              <Field label={t('Mercado', 'Market')}><select name="market" className="input" data-testid="propose-market">{proposeIn.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
              <Field label={t('Tipo de venta', 'Sale type')}><select name="motor" className="input"><option value="">{t('Todos', 'All')}</option>{MOTORS.map((k) => <option key={k} value={k}>{lab(t, MOTOR[k])}</option>)}</select></Field>
              <Field label={t('Opciones (solo para listas), una por renglón', 'Options (lists only), one per line')} className="col-span-2"><textarea name="options" rows={2} className="input !h-auto py-3" /></Field>
              {governance()}
              <p className="col-span-2 text-[13px] text-muted">{t(`Administración responde en ${d.sla} días. Mientras tanto el campo no aparece en ninguna ficha.`, `Administration answers within ${d.sla} days. Until then the field shows on no record.`)}</p>
              <div className="col-span-2 flex justify-end"><Submit testId="propose-save">{t('Enviar propuesta', 'Send proposal')}</Submit></div>
            </NoticeForm>
          </Dialog>
        )}
      </div>

      <p className="text-[13.5px] text-muted-2" data-testid="field-sla-stats">
        {d.slaStats.decided === 0
          ? t(`Plazo para decidir una propuesta: ${d.sla} días. En los últimos 90 días no se decidió ninguna.`, `Deadline to decide a proposal: ${d.sla} days. None was decided in the last 90 days.`)
          : t(`Plazo para decidir una propuesta: ${d.sla} días. En los últimos 90 días, ${d.slaStats.on_time} de ${d.slaStats.decided} se decidieron a tiempo; la mitad tardó ${d.slaStats.median_days ?? '0'} días o menos.`,
              `Deadline to decide a proposal: ${d.sla} days. In the last 90 days, ${d.slaStats.on_time} of ${d.slaStats.decided} were decided on time; half took ${d.slaStats.median_days ?? '0'} days or less.`)}
        {d.slaStats.open_late > 0 && <span className="ml-2"><Badge tone="warn">{t(`${d.slaStats.open_late} fuera de plazo`, `${d.slaStats.open_late} past deadline`)}</Badge></span>}
      </p>

      {d.overlaps.length > 0 && (
        <Card data-testid="field-overlaps">
          <CardTitle title={t('Campos de la tienda de Estados Unidos que se parecen a uno importado', 'US store fields that look like an imported one')} hint={t('Para no tener el mismo dato dos veces. Si es el mismo, se usa el de Pipedrive y los valores pasan a él; el otro se archiva.', 'So the same data does not live twice. If it is the same, the Pipedrive one is used and the values move to it; the other one is archived.')} />
          <ul>
            {d.overlaps.map((o) => (
              <li key={`${o.kept_id}-${o.imported_id}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0" data-testid="overlap-row">
                <span className="min-w-0 text-[14px]"><span className="font-semibold text-strong">{o.kept_label}</span> <span className="text-muted-2">{t('y', 'and')}</span> <span className="font-semibold text-strong">{o.imported_label}</span> <Badge>Pipedrive</Badge></span>
                {admin && (
                  <span className="flex flex-wrap gap-2">
                    <NoticeForm action={decideOverlapAction}><input type="hidden" name="kept_id" value={o.kept_id} /><input type="hidden" name="imported_id" value={o.imported_id} /><input type="hidden" name="decision" value="same" /><Submit size="sm" testId="overlap-same">{t('Es el mismo', 'Same field')}</Submit></NoticeForm>
                    <NoticeForm action={decideOverlapAction}><input type="hidden" name="kept_id" value={o.kept_id} /><input type="hidden" name="imported_id" value={o.imported_id} /><input type="hidden" name="decision" value="different" /><Submit size="sm" variant="ghost" testId="overlap-different">{t('Son distintos', 'Different')}</Submit></NoticeForm>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {d.promotions.length > 0 && (
        <Card data-testid="field-promotions">
          <CardTitle title={t('Campos que pasan a columna', 'Fields moving to a column')} hint={t('Un campo que se filtra, entra a un permiso o a una métrica deja de vivir en campos adicionales. CONTIGO arma el cambio; lo aplica una migración con revisión técnica y aquí se marca hecho solo.', 'A field used in a filter, a permission or a metric stops living in additional fields. CONTIGO prepares the change; a migration with technical review applies it and it is marked done here automatically.')} />
          <ul>
            {d.promotions.map((p) => (
              <li key={p.id} className="border-t border-line py-4 first:border-t-0" data-testid="promotion-row" data-status={p.status}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span className="min-w-0 text-[14px]"><span className="font-semibold text-strong">{t(p.label_es, p.label_en)}</span> <span className="text-muted-2">({lab(t, FIELD_OBJECT[p.object], p.object)})</span>
                    <span className="block text-[13px] text-muted-2 [overflow-wrap:anywhere]">{p.reason}</span>
                    <span className="block text-[13px] text-muted">{[p.requested_by, day(p.requested_at, locale)].filter(Boolean).join(' · ')}{p.close_note && p.status === 'rejected' ? ` · ${p.close_note}` : ''}</span></span>
                  <Badge tone={p.status === 'done' ? 'good' : p.status === 'rejected' ? 'neutral' : 'warn'}>{p.status === 'done' ? t('Hecho', 'Done') : p.status === 'rejected' ? t('Cerrado', 'Closed') : t('Esperando la migración', 'Waiting for the migration')}</Badge>
                </div>
                {p.status === 'requested' && (
                  <details className="mt-2 text-[13px]"><summary className="cursor-pointer font-medium text-strong">{t('Ver el cambio preparado', 'See the prepared change')}</summary><pre className="mt-2 overflow-x-auto rounded-[10px] bg-surface-2 p-3 text-[12px]" data-testid="promotion-sql">{p.migration_sql}</pre></details>
                )}
                {p.status === 'requested' && admin && (
                  <NoticeForm action={closePromotionAction} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={p.id} />
                    <Field label={t('Cerrar sin hacer: ¿por qué?', 'Close without doing it: why?')} className="min-w-56 flex-1"><input name="note" className="input" required minLength={5} maxLength={300} /></Field>
                    <Submit size="sm" variant="quiet">{t('Cerrar', 'Close')}</Submit></NoticeForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card pad={false}>
        <div className="px-5 pt-6 md:px-7 md:pt-7">
          <CardTitle title={t('Registro de campos', 'Field registry')} hint={view === 'propuestos'
            ? t(`Quien lidera un mercado propone; administración aprueba o rechaza en ${d.sla} días.`, `Market leads propose; administration approves or rejects within ${d.sla} days.`)
            : t('Cada campo existe porque habilita una decisión. El uso dice cuántos registros lo traen: un campo que nadie llena se retira.', 'Each field exists because it enables a decision. Usage says how many records carry it: a field nobody fills gets retired.')} />
        </div>
        {d.fields.length === 0 ? (
          <div className="px-5 pb-6 md:px-7 md:pb-7"><Empty title={view === 'propuestos' ? t('No hay propuestas', 'No proposals') : view === 'sin-decision' ? t('Todos los campos tienen su decisión y su revisión al día', 'Every field has its decision and an up-to-date review') : t('No hay campos en esta vista', 'No fields in this view')}
            hint={view === 'propuestos' ? t('Con "Proponer campo", quien lidera un mercado pide uno nuevo para su mercado.', 'With "Propose a field", a market lead asks for a new one for their market.') : t('Los campos se crean en Administración, Embudos y campos, o se proponen desde aquí.', 'Fields are created under Administration, Pipelines and fields, or proposed from here.')} /></div>
        ) : (
          <Table testId="registry-table" label={t('Registro de campos', 'Field registry')} head={<><th>{t('Campo', 'Field')}</th><th>{t('Mercado', 'Market')}</th><th>{t('Responde', 'Owner')}</th><th className="min-w-[220px]">{t('Decisión que habilita', 'Decision it enables')}</th><th>{t('Revisión', 'Review')}</th><th>{t('Uso', 'Usage')}</th><th className="relative"><span className="sr-only">{t('Acciones', 'Actions')}</span></th></>}>
            {d.fields.map((f) => (
              <tr key={f.id} className="table-row align-top" data-testid="registry-row" data-status={f.status}>
                <td>
                  <span className="font-semibold text-strong" data-testid="registry-name">{t(f.label_es, f.label_en)}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5"><Badge>{lab(t, FIELD_OBJECT[f.object], f.object)}</Badge><Badge>{lab(t, FIELD_TYPE[f.data_type], t('Otro tipo', 'Other type'))}</Badge>
                    {f.pii_class !== 'none' && <Badge tone="warn">{lab(t, PII_CLASS[f.pii_class])}</Badge>}{f.untrusted && <Badge tone="warn" title={t('Llega de fuera sin validar', 'Comes from outside without validation')}>{t('Sin validar', 'Unvalidated')}</Badge>}
                    {f.source === 'pipedrive' && <Badge>Pipedrive</Badge>}</span>
                  {f.stages.length > 0 && <span className="mt-1 block text-[13px] text-muted-2">{t('Obligatorio en', 'Required at')}: {f.stages.map((s) => t(s.split(' | ')[0]!, s.split(' | ')[1] ?? s)).join(', ')}</span>}
                </td>
                <td className="text-[13.5px]">{f.market_code ?? t('Todos', 'All')}{f.motor && <span className="block text-[13px] text-muted">{lab(t, MOTOR[f.motor])}</span>}</td>
                <td className="text-[13.5px]" data-testid="registry-owner">{f.owner_name ?? <span className="text-amber-text">{t('Sin responsable', 'No owner')}</span>}</td>
                <td className="text-[13.5px]" data-testid="registry-decision">
                  {f.decision ? <span className="[overflow-wrap:anywhere]">{f.decision}</span> : <span className="text-amber-text">{t('Sin decisión documentada', 'No documented decision')}</span>}
                  {(f.origin || f.used_by) && <span className="mt-1 block text-[13px] text-muted">{[f.origin ? t(`Viene de: ${f.origin}`, `Comes from: ${f.origin}`) : null, f.used_by ? t(`Lo usa: ${f.used_by}`, `Used by: ${f.used_by}`) : null].filter(Boolean).join(' · ')}</span>}
                  {f.status !== 'approved' && <span className="mt-1 block text-[13px] text-muted">{t('Propuso', 'Proposed by')}: {f.proposed_by ?? t('s/d', 'n/a')}{f.proposed_at ? ` · ${ago(f.proposed_at, locale)}` : ''}</span>}
                  {f.status === 'rejected' && <span className="mt-1 block text-[13px] text-red-text">{t('Rechazada', 'Rejected')}: {f.decision_note}</span>}
                </td>
                <td className="text-[13.5px] whitespace-nowrap">
                  {f.status === 'proposed' ? (f.overdue ? <Badge tone="warn">{t('Fuera de plazo', 'Past deadline')}</Badge> : <Badge>{t('Por decidir', 'To decide')}</Badge>)
                    : f.review_on ? <span className={f.review_due ? 'font-medium text-amber-text' : undefined}>{day(f.review_on, locale)}{f.review_due ? ` · ${t('vencida', 'overdue')}` : ''}</span> : <span className="text-amber-text">{t('Sin fecha', 'No date')}</span>}
                </td>
                <td className="num text-[13.5px] whitespace-nowrap" data-testid="registry-usage">
                  {f.status !== 'approved' ? <span className="text-muted">{t('No aplica', 'n/a')}</span> : f.total === 0 ? <span className="text-muted">{t('s/d', 'n/a')}</span> : f.filled === 0 ? <Badge tone="warn">{t('Sin uso', 'Unused')}</Badge> : <>{pct(f.filled, f.total, locale)} <span className="text-muted">({f.filled})</span></>}
                </td>
                <td className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {admin && f.status === 'proposed' && (
                      <>
                        <NoticeForm action={decideFieldAction}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="approve" value="true" /><input type="hidden" name="note" value="" /><Submit size="sm" testId="registry-approve">{t('Aprobar', 'Approve')}</Submit></NoticeForm>
                        <Dialog trigger={t('Rechazar', 'Reject')} title={t('Rechazar la propuesta', 'Reject the proposal')} size="sm" testId="registry-reject">
                          <NoticeForm action={decideFieldAction} className="space-y-4 text-left">
                            <input type="hidden" name="id" value={f.id} /><input type="hidden" name="approve" value="false" />
                            <Field label={t('¿Por qué no?', 'Why not?')} hint={t('Lo lee quien lo propuso.', 'The person who proposed it will read this.')}><input name="note" className="input" required minLength={5} maxLength={400} data-testid="reject-note" /></Field>
                            <div className="flex justify-end"><Submit variant="danger" testId="reject-confirm">{t('Rechazar', 'Reject')}</Submit></div>
                          </NoticeForm>
                        </Dialog>
                      </>
                    )}
                    {admin && f.status === 'approved' && (
                      <>
                        <Dialog trigger={t('Editar', 'Edit')} title={t(`Campo: ${f.label_es}`, `Field: ${f.label_en}`)} testId="registry-edit">
                          <NoticeForm action={updateFieldAction} className="grid grid-cols-2 gap-4 text-left" testId="registry-form">
                            <input type="hidden" name="id" value={f.id} />
                            <Field label={t('Nombre en español', 'Name in Spanish')}><input name="label_es" className="input" required minLength={2} maxLength={60} defaultValue={f.label_es} data-testid="field-label-es" /></Field>
                            <Field label={t('Nombre en inglés', 'Name in English')}><input name="label_en" className="input" required minLength={2} maxLength={60} defaultValue={f.label_en} data-testid="field-label-en" /></Field>
                            {f.data_type === 'select' && <Field label={t('Opciones, una por renglón (se pueden agregar, no quitar)', 'Options, one per line (you can add, not remove)')} className="col-span-2"><textarea name="options" rows={3} className="input !h-auto py-3" defaultValue={f.options.join('\n')} /></Field>}
                            {governance(f)}
                            <div className="col-span-2 flex justify-end"><Submit testId="registry-save">{t('Guardar', 'Save')}</Submit></div>
                          </NoticeForm>
                        </Dialog>
                        {(f.data_type === 'number' || f.data_type === 'text') && f.object !== 'product' && (
                          <Dialog trigger={t('Reglas', 'Rules')} title={t(`Reglas del valor: ${f.label_es}`, `Value rules: ${f.label_en}`)} size="sm" testId="registry-rules">
                            <NoticeForm action={setFieldSchemaAction} className="grid grid-cols-2 gap-4 text-left" testId="rules-form">
                              <input type="hidden" name="id" value={f.id} />
                              {f.data_type === 'number' ? (
                                <>
                                  <Field label={t('Mínimo', 'Minimum')}><input name="minimum" className="input" inputMode="decimal" defaultValue={String(f.value_schema.minimum ?? '')} data-testid="rules-min" /></Field>
                                  <Field label={t('Máximo', 'Maximum')}><input name="maximum" className="input" inputMode="decimal" defaultValue={String(f.value_schema.maximum ?? '')} data-testid="rules-max" /></Field>
                                </>
                              ) : (
                                <>
                                  <Field label={t('Largo mínimo', 'Minimum length')}><input name="min_length" className="input" inputMode="numeric" defaultValue={String(f.value_schema.minLength ?? '')} /></Field>
                                  <Field label={t('Largo máximo', 'Maximum length')}><input name="max_length" className="input" inputMode="numeric" defaultValue={String(f.value_schema.maxLength ?? '')} /></Field>
                                  <Field label={t('Forma (expresión regular)', 'Format (regular expression)')} className="col-span-2" hint={t('Opcional. Por ejemplo, [0-9]{10} para diez números.', 'Optional. For example, [0-9]{10} for ten digits.')}><input name="pattern" className="input" maxLength={200} defaultValue={String(f.value_schema.pattern ?? '')} /></Field>
                                </>
                              )}
                              <div className="col-span-2 flex justify-end"><Submit testId="rules-save">{t('Guardar reglas', 'Save rules')}</Submit></div>
                            </NoticeForm>
                          </Dialog>
                        )}
                        {f.data_type === 'text' && f.object === 'account' && (
                          <Dialog trigger={t('Pasar a lista', 'Make it a list')} title={t(`Lista de opciones: ${f.label_es}`, `Option list: ${f.label_en}`)} size="sm" testId="registry-to-list">
                            <NoticeForm action={convertToListAction} className="space-y-4 text-left">
                              <input type="hidden" name="id" value={f.id} />
                              <Field label={t('Opciones, una por renglón', 'Options, one per line')} hint={t('Si algún comercio tiene un valor fuera de la lista, no se cambia y se dice cuál.', 'If a merchant has a value outside the list, nothing changes and you are told which one.')}><textarea name="options" rows={4} required className="input !h-auto py-3" data-testid="to-list-options" /></Field>
                              <div className="flex justify-end"><Submit testId="to-list-save">{t('Pasar a lista', 'Make it a list')}</Submit></div>
                            </NoticeForm>
                          </Dialog>
                        )}
                        <NoticeForm action={toggleFieldAction}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="active" value={f.is_active ? 'false' : 'true'} /><Submit variant="quiet" size="sm" testId="registry-archive">{f.is_active ? t('Archivar', 'Archive') : t('Activar', 'Activate')}</Submit></NoticeForm>
                      </>
                    )}
                    {f.status === 'approved' && f.is_active && !f.mapped_to && ['account', 'deal', 'lead', 'contact', 'activity'].includes(f.object) && (f.market_code ? ctx.can('field.propose', f.market_code) : admin) && (
                      <Dialog trigger={t('Pasar a columna', 'Move to a column')} title={t('Pasar el campo a columna', 'Move the field to a column')} size="sm" testId="registry-promote">
                        <NoticeForm action={requestPromotionAction} className="space-y-4 text-left">
                          <input type="hidden" name="id" value={f.id} />
                          <p className="text-[14px] text-muted-2">{t('Hace falta cuando el campo se usa para filtrar, para dar permisos o en una métrica. CONTIGO prepara el cambio y lo aplica una migración revisada.', 'It is needed when the field is used to filter, to grant access or in a metric. CONTIGO prepares the change and a reviewed migration applies it.')}</p>
                          <Field label={t('¿Para qué hace falta?', 'What is it needed for?')}><input name="reason" className="input" required minLength={10} maxLength={400} data-testid="promote-reason" /></Field>
                          <div className="flex justify-end"><Submit testId="promote-save">{t('Pedir el cambio', 'Request the change')}</Submit></div>
                        </NoticeForm>
                      </Dialog>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
