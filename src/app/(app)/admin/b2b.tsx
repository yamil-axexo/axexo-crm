import type { Ctx } from '@/server/context'
import { getB2bConfig } from '@/dal/b2b'
import { FIELD_OBJECTS, FIELD_TYPES, LEVELS, MOTORS } from '@/domain/b2b'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { KIND, MOTOR, lab } from '@/lib/labels'
import {
  archiveStageAction, createAccountTypeAction, createFieldAction, createLossReasonAction, createPipelineAction, createStageAction, moveStageAction,
  toggleAccountTypeAction, toggleFieldAction, updateFormAction, updateLossReasonAction,
} from '@/app/(app)/b2b-actions'

type Pipe = { id: string; market_code: string; motor: string; name: string }
type Stage = { id: string; pipeline_id: string; position: number; name_es: string; name_en: string; kind: string }

const OBJECT: Record<string, [string, string]> = { account: ['Comercio', 'Merchant'], deal: ['Negocio', 'Deal'], lead: ['Lead', 'Lead'] }
const TYPE: Record<string, [string, string]> = { text: ['Texto', 'Text'], number: ['Número', 'Number'], select: ['Lista', 'List'], date: ['Fecha', 'Date'], boolean: ['Sí o no', 'Yes or no'] }

/**
 * Lo que administración crea y ordena desde la pantalla (hallazgo del comité: "casi todo es solo lectura"):
 * etapas (agregar, reordenar, archivar), embudos nuevos, campos, tipos de cuenta, motivos de pérdida y formularios.
 */
export async function B2bConfig({ ctx, pipelines, stages }: { ctx: Ctx; pipelines: Pipe[]; stages: Stage[] }) {
  const { t } = ctx
  const d = await getB2bConfig(ctx)
  const live = ctx.markets.filter((m) => m.status === 'live')
  const marketSelect = (testId: string, all = true) => (
    <select name="market" className="input" defaultValue={all ? '' : live[0]?.code} data-testid={testId}>
      {all && <option value="">{t('Todos los mercados', 'All markets')}</option>}
      {live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
    </select>
  )
  const motorSelect = (testId: string, all = true) => (
    <select name="motor" className="input" defaultValue={all ? '' : 'b2b'} data-testid={testId}>
      {all && <option value="">{t('Todos los tipos de venta', 'All sale types')}</option>}
      {MOTORS.map((k) => <option key={k} value={k}>{lab(t, MOTOR[k])}</option>)}
    </select>
  )
  const names = (
    <>
      <Field label={t('Nombre en español', 'Name in Spanish')} className="col-span-2 sm:col-span-1"><input name="label_es" className="input" required minLength={2} maxLength={60} data-testid="b2b-label-es" /></Field>
      <Field label={t('Nombre en inglés', 'Name in English')} className="col-span-2 sm:col-span-1"><input name="label_en" className="input" required minLength={2} maxLength={60} data-testid="b2b-label-en" /></Field>
    </>
  )
  const row = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line py-2 first:border-t-0 text-[14px]'

  return (
    <div className="space-y-8" data-testid="b2b-config">
      <Card data-testid="stage-admin">
        <CardTitle
          title={t('Orden de las etapas', 'Stage order')}
          hint={t('Agrega, sube, baja o archiva etapas de trabajo. Una etapa con negocios no se borra: se archiva y eliges a cuál pasan.', 'Add, move up, move down or archive working stages. A stage with deals is never deleted: it is archived and you choose where they go.')}
          right={
            <Dialog trigger={t('Crear embudo', 'Create pipeline')} title={t('Crear un embudo', 'Create a pipeline')} variant="primary" testId="pipeline-new">
              <ActionForm action={createPipelineAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                <Field label={t('Nombre del embudo', 'Pipeline name')} className="col-span-2"><input name="name" className="input" required minLength={2} maxLength={80} data-testid="pipeline-new-name" /></Field>
                <Field label={t('Mercado', 'Market')}>{marketSelect('pipeline-new-market', false)}</Field>
                <Field label={t('Tipo de venta', 'Sale type')}>{motorSelect('pipeline-new-motor', false)}</Field>
                <Field label={t('Etapas, una por renglón', 'Stages, one per line')} className="col-span-2" hint={t('Escribe "Nombre en español | Name in English". "Ganado" y "Perdido" se agregan solos. El embudo nace con cierre a mano.', 'Write "Nombre en español | Name in English". "Won" and "Lost" are added for you. The pipeline starts as won by hand.')}>
                  <textarea name="stages" rows={5} required className="input !h-auto py-3" data-testid="pipeline-new-stages" />
                </Field>
                <div className="col-span-2 flex justify-end"><Submit testId="pipeline-new-save">{t('Crear embudo', 'Create pipeline')}</Submit></div>
              </ActionForm>
            </Dialog>
          }
        />
        <div className="space-y-6">
          {pipelines.map((p) => {
            const own = stages.filter((s) => s.pipeline_id === p.id)
            const work = own.filter((s) => s.kind === 'open' || s.kind === 'awaiting_txn')
            return (
              <section key={p.id} data-testid="stage-admin-pipeline" data-pipeline={p.name}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-strong">{p.market_code} · {p.name}</h3>
                  <Dialog trigger={t('Agregar etapa', 'Add stage')} title={t(`Agregar una etapa a "${p.name}"`, `Add a stage to "${p.name}"`)} size="sm" testId="stage-add">
                    <ActionForm action={createStageAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                      <input type="hidden" name="pipeline_id" value={p.id} />
                      <Field label={t('Nombre en español', 'Name in Spanish')} className="col-span-2 sm:col-span-1"><input name="name_es" className="input" required minLength={2} maxLength={60} data-testid="stage-add-es" /></Field>
                      <Field label={t('Nombre en inglés', 'Name in English')} className="col-span-2 sm:col-span-1"><input name="name_en" className="input" required minLength={2} maxLength={60} data-testid="stage-add-en" /></Field>
                      <Field label={t('Días para considerarla estancada', 'Days until it counts as stalled')} className="col-span-2"><input name="rot_days" type="number" min={0} max={365} defaultValue={14} required className="input !w-32" /></Field>
                      <p className="col-span-2 text-[13px] text-muted-2">{t('Entra al final de las etapas de trabajo. Después la subes o la bajas.', 'It is added after the last working stage. You can move it up or down afterwards.')}</p>
                      <div className="col-span-2 flex justify-end"><Submit testId="stage-add-save">{t('Agregar etapa', 'Add stage')}</Submit></div>
                    </ActionForm>
                  </Dialog>
                </div>
                <ul className="mt-2">
                  {work.map((s, i) => {
                    const n = d.stageDeals[s.id] ?? 0
                    return (
                      <li key={s.id} className={row} data-testid="stage-admin-row">
                        <span className="min-w-0"><span className="num mr-2 text-muted">{i + 1}</span><span className="font-medium text-strong" data-testid="stage-admin-name">{t(s.name_es, s.name_en)}</span>
                          <span className="ml-2 text-[13px] text-muted">{t(`${n} ${n === 1 ? 'negocio abierto' : 'negocios abiertos'}`, `${n} open ${n === 1 ? 'deal' : 'deals'}`)}</span></span>
                        <span className="flex flex-wrap items-center gap-2">
                          {i > 0 && (
                            <ActionForm action={moveStageAction}><input type="hidden" name="stage_id" value={s.id} /><input type="hidden" name="dir" value="up" />
                              <Submit variant="quiet" size="sm" testId="stage-up">{t('Subir', 'Move up')}</Submit></ActionForm>
                          )}
                          {i < work.length - 1 && (
                            <ActionForm action={moveStageAction}><input type="hidden" name="stage_id" value={s.id} /><input type="hidden" name="dir" value="down" />
                              <Submit variant="quiet" size="sm" testId="stage-down">{t('Bajar', 'Move down')}</Submit></ActionForm>
                          )}
                          {s.kind === 'open' && (
                            <Dialog trigger={t('Archivar', 'Archive')} title={t(`Archivar la etapa "${s.name_es}"`, `Archive the "${s.name_en}" stage`)} size="sm" variant="quiet" testId="stage-archive">
                              <ActionForm action={archiveStageAction} onOk="close" className="space-y-4 text-left">
                                <input type="hidden" name="stage_id" value={s.id} />
                                {n > 0 ? (
                                  <Field label={t(`Esta etapa tiene ${n === 1 ? '1 negocio abierto' : `${n} negocios abiertos`}. ¿A qué etapa pasan?`, `This stage has ${n === 1 ? '1 open deal' : `${n} open deals`}. Which stage do they move to?`)}>
                                    <select name="move_to" className="input" required defaultValue="" data-testid="stage-archive-to">
                                      <option value="" disabled>{t('Elige una etapa', 'Pick a stage')}</option>
                                      {work.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{t(x.name_es, x.name_en)}</option>)}
                                    </select>
                                  </Field>
                                ) : (
                                  <p className="text-[14px] text-muted-2">{t('No tiene negocios abiertos. Deja de aparecer en el tablero; la historia de los negocios que pasaron por ella se conserva.', 'It has no open deals. It stops showing on the board; the history of the deals that went through it is kept.')}</p>
                                )}
                                <div className="flex justify-end"><Submit variant="danger" testId="stage-archive-save">{t('Archivar etapa', 'Archive stage')}</Submit></div>
                              </ActionForm>
                            </Dialog>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                {d.archived.some((x) => x.pipeline_id === p.id) && (
                  <p className="mt-2 text-[13px] text-muted" data-testid="stage-archived">{t('Archivadas: ', 'Archived: ')}{d.archived.filter((x) => x.pipeline_id === p.id).map((x) => t(x.name_es, x.name_en)).join(', ')}</p>
                )}
              </section>
            )
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <Card data-testid="type-admin">
          <CardTitle title={t('Tipos de cuenta', 'Account types')} hint={t('Lo que se puede elegir en la ficha de un comercio. Retirar un tipo no cambia las cuentas que ya lo tienen.', 'What can be chosen on a merchant record. Retiring a type does not change the accounts that already have it.')}
            right={
              <Dialog trigger={t('Agregar tipo', 'Add type')} title={t('Agregar un tipo de cuenta', 'Add an account type')} size="sm" testId="type-new">
                <ActionForm action={createAccountTypeAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                  {names}
                  <Field label={t('Mercado', 'Market')}>{marketSelect('type-new-market')}</Field>
                  <Field label={t('Nivel en el árbol', 'Level in the tree')} hint={t('Una tienda no puede tener cuentas debajo; los demás niveles sí.', 'A store cannot have accounts under it; the other levels can.')}>
                    <select name="level" className="input" defaultValue="distributor">{LEVELS.map((k) => <option key={k} value={k}>{lab(t, KIND[k])}</option>)}</select>
                  </Field>
                  <div className="col-span-2 flex justify-end"><Submit testId="type-new-save">{t('Agregar tipo', 'Add type')}</Submit></div>
                </ActionForm>
              </Dialog>
            } />
          <ul>
            {d.types.map((x) => (
              <li key={x.id} className={row} data-testid="type-row">
                <span className={x.is_active ? 'font-medium text-strong' : 'text-muted line-through'}>{t(x.label_es, x.label_en)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge>{x.market_code ?? t('todos', 'all')}</Badge><Badge>{lab(t, KIND[x.kind])}</Badge>
                  <span className="text-[13px] text-muted">{t(`${x.in_use} en uso`, `${x.in_use} in use`)}</span>
                  <ActionForm action={toggleAccountTypeAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="active" value={x.is_active ? 'false' : 'true'} />
                    <Submit variant="quiet" size="sm" testId="type-toggle">{x.is_active ? t('Retirar', 'Retire') : t('Activar', 'Activate')}</Submit></ActionForm>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card data-testid="reason-admin">
          <CardTitle title={t('Motivos de pérdida por embudo', 'Loss reasons by pipeline')} hint={t('Cada tipo de venta ofrece sus motivos, más los que valen para todos.', 'Each sale type offers its own reasons, plus the ones that apply to all.')}
            right={
              <Dialog trigger={t('Agregar motivo', 'Add reason')} title={t('Agregar un motivo de pérdida', 'Add a loss reason')} size="sm" testId="reason-new">
                <ActionForm action={createLossReasonAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                  {names}
                  <Field label={t('Mercado', 'Market')} className="col-span-2">{marketSelect('reason-new-market')}</Field>
                  <fieldset className="col-span-2">
                    <legend className="mb-1 block text-[13px] font-semibold text-muted-2">{t('Se ofrece en (sin marcar nada, en todos)', 'Offered in (tick nothing for all)')}</legend>
                    <div className="grid grid-cols-2 gap-x-4">{MOTORS.map((k) => <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="motor" value={k} className="h-5 w-5 shrink-0" data-testid={`reason-new-${k}`} />{lab(t, MOTOR[k])}</label>)}</div>
                  </fieldset>
                  <div className="col-span-2 flex justify-end"><Submit testId="reason-new-save">{t('Agregar motivo', 'Add reason')}</Submit></div>
                </ActionForm>
              </Dialog>
            } />
          <ul>
            {d.reasons.map((r) => (
              <li key={r.code} className={row} data-testid="reason-row">
                <span className={r.is_active ? 'font-medium text-strong' : 'text-muted line-through'}>{t(r.label_es, r.label_en)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {r.market_code && <Badge>{r.market_code}</Badge>}
                  <span className="text-[13px] text-muted" data-testid="reason-scope">{r.motors ? r.motors.map((k) => lab(t, MOTOR[k])).join(', ') : t('Todos los embudos', 'All pipelines')}</span>
                  <Dialog trigger={t('Editar', 'Edit')} title={t(`Dónde se ofrece "${r.label_es}"`, `Where "${r.label_en}" is offered`)} size="sm" variant="quiet" testId="reason-edit">
                    <ActionForm action={updateLossReasonAction} onOk="close" className="space-y-3 text-left">
                      <input type="hidden" name="code" value={r.code} />
                      <fieldset>
                        <legend className="mb-1 block text-[13px] font-semibold text-muted-2">{t('Se ofrece en (sin marcar nada, en todos)', 'Offered in (tick nothing for all)')}</legend>
                        <div className="grid grid-cols-2 gap-x-4">{MOTORS.map((k) => <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="motor" value={k} defaultChecked={r.motors?.includes(k) ?? false} className="h-5 w-5 shrink-0" data-testid={`reason-edit-${k}`} />{lab(t, MOTOR[k])}</label>)}</div>
                      </fieldset>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="active" defaultChecked={r.is_active} className="h-5 w-5 shrink-0" />{t('Vigente (se puede elegir)', 'Active (can be chosen)')}</label>
                      <div className="flex justify-end"><Submit testId="reason-edit-save">{t('Guardar', 'Save')}</Submit></div>
                    </ActionForm>
                  </Dialog>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card data-testid="field-admin">
        <CardTitle title={t('Campos creados aquí', 'Fields created here')} hint={t('Un campo aparece en la ficha de su mercado y su tipo de venta. Nunca se piden tarjetas, cuentas bancarias, contraseñas ni identificaciones completas.', 'A field shows on records of its market and sale type. Cards, bank accounts, passwords and full IDs are never asked for.')}
          right={
            <Dialog trigger={t('Crear campo', 'Create field')} title={t('Crear un campo', 'Create a field')} variant="primary" testId="field-new">
              <ActionForm action={createFieldAction} onOk="close" className="grid grid-cols-2 gap-4 text-left">
                {names}
                <Field label={t('Para', 'For')}><select name="object" className="input" data-testid="field-new-object">{FIELD_OBJECTS.map((k) => <option key={k} value={k}>{t(...OBJECT[k]!)}</option>)}</select></Field>
                <Field label={t('Tipo de dato', 'Data type')}><select name="data_type" className="input" data-testid="field-new-type">{FIELD_TYPES.map((k) => <option key={k} value={k}>{t(...TYPE[k]!)}</option>)}</select></Field>
                <Field label={t('Mercado', 'Market')}>{marketSelect('field-new-market')}</Field>
                <Field label={t('Tipo de venta', 'Sale type')}>{motorSelect('field-new-motor')}</Field>
                <Field label={t('Opciones (solo para listas), una por renglón', 'Options (lists only), one per line')} className="col-span-2"><textarea name="options" rows={3} className="input !h-auto py-3" data-testid="field-new-options" /></Field>
                <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="in_intake" className="h-5 w-5 shrink-0" data-testid="field-new-intake" />{t('Pedirlo al dar de alta un comercio', 'Ask for it when a merchant is created')}</label>
                <div className="col-span-2 flex justify-end"><Submit testId="field-new-save">{t('Crear campo', 'Create field')}</Submit></div>
              </ActionForm>
            </Dialog>
          } />
        <ul>
          {d.fields.map((f) => (
            <li key={f.id} className={row} data-testid="field-row">
              <span className={f.is_active ? 'font-medium text-strong' : 'text-muted line-through'}>{t(f.label_es, f.label_en)}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge>{t(...OBJECT[f.object]!)}</Badge><Badge>{f.market_code ?? t('todos', 'all')}</Badge>{f.motor && <Badge>{lab(t, MOTOR[f.motor])}</Badge>}
                <span className="text-[13px] text-muted">{TYPE[f.data_type] ? t(...TYPE[f.data_type]!) : f.data_type}</span>
                <ActionForm action={toggleFieldAction}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="active" value={f.is_active ? 'false' : 'true'} />
                  <Submit variant="quiet" size="sm" testId="field-toggle">{f.is_active ? t('Retirar', 'Retire') : t('Activar', 'Activate')}</Submit></ActionForm>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card data-testid="form-admin">
        <CardTitle title={t('Qué pide cada formulario web', 'What each web form asks for')} hint={t('Nombre, teléfono y negocio se piden siempre. Aquí eliges el nombre visible, qué campos de lead se suman y con qué tipo de cuenta nacen sus leads.', 'Name, phone and business are always asked. Here you choose the visible name, which lead fields are added and which account type its leads start with.')} />
        <ul>
          {d.forms.map((f) => {
            const options = d.fields.filter((x) => x.object === 'lead' && x.is_active && (x.market_code === null || x.market_code === f.market_code) && (x.motor === null || x.motor === f.motor))
            // Tipos de cuenta del mercado del formulario: el mismo catálogo de la ficha del comercio y de la hoja de conversión.
            const formTypes = d.types.filter((x) => (x.is_active || x.code === f.account_type) && (x.market_code === null || x.market_code === f.market_code))
            const formType = d.types.find((x) => x.code === f.account_type && (x.market_code === null || x.market_code === f.market_code))
            return (
              <li key={f.id} className={row} data-testid="form-admin-row">
                <span className="min-w-0"><span className="font-medium text-strong">{f.name}</span> <span className="text-[13px] text-muted">/f/{f.slug} · {f.market_code} · {lab(t, MOTOR[f.motor])}</span>
                  <span className="block text-[13px] text-muted-2" data-testid="form-asks">{f.ask_fields.length ? t('Además pide: ', 'It also asks for: ') + f.ask_fields.map((k) => { const x = d.fields.find((y) => y.object === 'lead' && y.key === k); return x ? t(x.label_es, x.label_en) : k }).join(', ') : t('Solo pide lo básico.', 'It asks for the basics only.')}</span>
                  <span className="block text-[13px] text-muted-2" data-testid="form-type">{formType ? t(`Sus leads nacen como: ${formType.label_es}`, `Its leads start as: ${formType.label_en}`) : t('Sus leads toman el tipo de cuenta del tipo de venta.', 'Its leads take the account type of the sale type.')}</span></span>
                <Dialog trigger={t('Editar', 'Edit')} title={t(`Editar el formulario "${f.name}"`, `Edit the "${f.name}" form`)} size="sm" variant="quiet" testId="form-edit">
                  <ActionForm action={updateFormAction} onOk="close" className="space-y-4 text-left">
                    <input type="hidden" name="form_id" value={f.id} />
                    <Field label={t('Nombre visible', 'Visible name')}><input name="name" className="input" required minLength={2} maxLength={80} defaultValue={f.name} data-testid="form-edit-name" /></Field>
                    <Field label={t('Tipo de cuenta con el que nacen sus leads', 'Account type its leads start with')} hint={t('Se puede corregir en el lead y se confirma al convertir.', 'It can be fixed on the lead and is confirmed when converting.')}>
                      <select name="account_type" className="input" defaultValue={f.account_type ?? ''} data-testid="form-edit-type">
                        <option value="">{t('Según el tipo de venta', 'By sale type')}</option>
                        {formTypes.map((x) => <option key={x.id} value={x.code}>{t(x.label_es, x.label_en)}</option>)}
                      </select>
                    </Field>
                    <fieldset>
                      <legend className="mb-1 block text-[13px] font-semibold text-muted-2">{t('Campos adicionales que pide', 'Extra fields it asks for')}</legend>
                      {options.length === 0 && <p className="text-[13.5px] text-muted-2">{t('No hay campos de lead para este mercado y tipo de venta. Crea uno arriba.', 'There are no lead fields for this market and sale type. Create one above.')}</p>}
                      {options.map((x) => <label key={x.key} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="ask" value={x.key} defaultChecked={f.ask_fields.includes(x.key)} className="h-5 w-5 shrink-0" data-testid="form-edit-ask" />{t(x.label_es, x.label_en)}</label>)}
                    </fieldset>
                    <div className="flex justify-end"><Submit testId="form-edit-save">{t('Guardar formulario', 'Save form')}</Submit></div>
                  </ActionForm>
                </Dialog>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
