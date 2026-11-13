import type { Ctx } from '@/server/context'
import { getCampaignConfig, getTerritoryManagers, getWinRules } from '@/dal/mx'
import { sellers } from '@/dal/leads'
import { WIN_RULES, type WinRule } from '@/domain/mx-config'
import { Badge, Card, CardTitle, Empty, Field } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { MOTOR, lab } from '@/lib/labels'
import { num } from '@/lib/format'
import { targetParts, targetText } from '@/lib/response-target'
import { setFormCampaignAction, setResponseTargetAction, setTerritoryManagerAction, setWinRuleAction } from './mx-actions'

/**
 * Formularios de campaña y metas de respuesta (E15). Cada formulario dice a qué embudo de campaña pertenece, su canal y
 * qué tipos de empresa ofrece; cada turno tiene su meta de respuesta en minutos, horas o días hábiles.
 */
export async function CampaignConfig({ ctx }: { ctx: Ctx }) {
  const { t } = ctx
  const d = await getCampaignConfig(ctx)
  return (
    <>
      <Card data-testid="mx-targets">
        <CardTitle title={t('Meta de respuesta por turno', 'Response target per rotation')} hint={t('En cuánto tiempo hábil se contacta un lead que llega por ese turno. Un día hábil dura lo que dure el horario del mercado.', 'How much business time there is to reach a lead that comes in through that rotation. A business day lasts as long as the market’s business hours.')} />
        <ul>
          {d.rules.map((r) => {
            const p = targetParts(r)
            return (
              <li key={r.id} className="border-t border-line py-4 first:border-t-0" data-testid="target-row">
                <ActionForm action={setResponseTargetAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="rule_id" value={r.id} />
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-[15px] font-semibold text-strong">{r.name}</p>
                    <p className="text-[13px] text-muted" data-testid="target-text">{r.market_code} · {t(`hoy: ${targetText(t, r)}`, `now: ${targetText(t, r)}`)}</p>
                  </div>
                  <Field label={t('Cantidad', 'Amount')}><input name="amount" type="number" min={1} max={600} step={1} required defaultValue={p.amount} className="input w-[110px]" data-testid="target-amount" /></Field>
                  <Field label={t('Unidad', 'Unit')}>
                    <select name="unit" className="input" defaultValue={p.unit} data-testid="target-unit">
                      <option value="minutes">{t('minutos hábiles', 'business minutes')}</option>
                      <option value="hours">{t('horas hábiles', 'business hours')}</option>
                      <option value="days">{t('días hábiles', 'business days')}</option>
                    </select>
                  </Field>
                  <Submit variant="ghost" testId="target-save">{t('Guardar meta', 'Save target')}</Submit>
                </ActionForm>
              </li>
            )
          })}
        </ul>
      </Card>
      <Card data-testid="mx-campaigns">
        <CardTitle title={t('Formularios de campaña', 'Campaign forms')} hint={t('Un formulario de campaña deja en cada lead su embudo de campaña, su canal y el origen "Campaña web". Los tipos de empresa que marques se preguntan en la página del formulario.', 'A campaign form leaves its campaign group, its channel and the "Web campaign" source on every lead. The company types you tick are asked on the form page.')} />
        <ul>
          {d.forms.map((f) => {
            const types = d.types.filter((x) => x.market_code === null || x.market_code === f.market_code)
            return (
              <li key={f.id} className="border-t border-line py-5 first:border-t-0" data-testid="campaign-row">
                <ActionForm action={setFormCampaignAction}>
                  <input type="hidden" name="form_id" value={f.id} />
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-semibold text-strong">{f.name}</p>
                    <Badge>{f.market_code}</Badge>
                    <span className="text-[13px] text-muted">{lab(t, MOTOR[f.motor]) || f.motor} · /f/{f.slug}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[160px_minmax(0,1fr)_auto]">
                    <Field label={t('Embudo de campaña', 'Campaign group')} hint={t('Por ejemplo F1 o F2.', 'For example F1 or F2.')}><input name="funnel" className="input" maxLength={20} defaultValue={f.funnel ?? ''} data-testid="campaign-funnel" /></Field>
                    <Field label={t('Identificador de canal', 'Channel identifier')} hint={t('Minúsculas, números y guiones.', 'Lowercase letters, digits and dashes.')}><input name="channel_id" className="input" maxLength={60} defaultValue={f.channel_id ?? ''} data-testid="campaign-channel" /></Field>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-[14px] text-strong">
                      <input type="checkbox" name="is_campaign" defaultChecked={f.is_campaign} className="h-5 w-5 shrink-0" data-testid="campaign-on" />
                      <span>{t('Es de campaña', 'It is a campaign form')}</span>
                    </label>
                  </div>
                  <fieldset className="mt-4">
                    <legend className="mb-2 text-[13px] font-semibold text-muted-2">{t('Tipos de empresa que ofrece', 'Company types it offers')}</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      {types.map((x) => (
                        <label key={`${x.code}:${x.market_code ?? ''}`} className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-strong">
                          <input type="checkbox" name="offer_type" value={x.code} defaultChecked={f.offer_types.includes(x.code)} className="h-5 w-5 shrink-0" data-testid={`campaign-type-${x.code}`} />
                          <span>{t(x.label_es, x.label_en)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="mt-3 flex justify-end"><Submit variant="ghost" testId="campaign-save">{t('Guardar formulario', 'Save form')}</Submit></div>
                </ActionForm>
              </li>
            )
          })}
        </ul>
      </Card>
    </>
  )
}

/** Gerente de cada territorio (E16.F2): es el dueño de las tiendas de venta puerta a puerta de ese territorio. */
export async function TerritoryManagers({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const [rows, people] = await Promise.all([getTerritoryManagers(ctx), sellers(ctx)])
  return (
    <Card className="mt-8" data-testid="mx-managers">
      <CardTitle title={t('Gerente de cada territorio', 'Manager of each territory')} hint={t('Las tiendas de venta puerta a puerta son de la persona que dirige su territorio: una tienda nueva en ese territorio la lleva esa persona desde que nace, y las que nadie llevaba pasan a ella. Un territorio sin gerente no cambia nada.', 'Door-to-door stores belong to the person who manages their territory: a new store in that territory starts with that person as its owner, and the ones nobody had move over. A territory with no manager changes nothing.')} />
      {rows.length === 0 ? (
        <Empty title={t('Todavía no hay territorios', 'No territories yet')} hint={t('Agrega el primero arriba y vuelve para elegir a su gerente.', 'Add the first one above and come back to pick its manager.')} />
      ) : (
        <ul>
          {rows.map((x) => {
            const pool = people.filter((p) => p.market_code === x.market_code)
            return (
              <li key={x.id} className="border-t border-line py-4 first:border-t-0" data-testid="manager-row">
                <ActionForm action={setTerritoryManagerAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="territory_id" value={x.id} />
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-[15px] font-semibold text-strong">{x.name} <span className="font-normal text-muted">· {x.market_code}</span></p>
                    <p className="text-[13px] text-muted">{t(`${num(x.stores, locale)} ${x.stores === 1 ? 'tienda' : 'tiendas'} puerta a puerta · ${num(x.unowned, locale)} sin asignar`, `${num(x.stores, locale)} door-to-door ${x.stores === 1 ? 'store' : 'stores'} · ${num(x.unowned, locale)} with no owner`)}</p>
                    {x.manager_id && !x.manager_active && <p className="mt-1 text-[13px] font-medium text-amber-text" data-testid="manager-gone">{t(`${x.manager_name} ya no vende en este mercado: elige a otra persona.`, `${x.manager_name} no longer sells in this market: pick someone else.`)}</p>}
                  </div>
                  <Field label={t('Gerente', 'Manager')}>
                    <select name="manager_id" className="input" defaultValue={x.manager_id ?? ''} data-testid="manager-select">
                      <option value="">{t('Sin gerente', 'No manager')}</option>
                      {x.manager_id && !pool.some((p) => p.id === x.manager_id) && <option value={x.manager_id}>{x.manager_name}</option>}
                      {pool.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </Field>
                  <Submit variant="ghost" testId="manager-save">{t('Guardar gerente', 'Save manager')}</Submit>
                </ActionForm>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const RULE_TEXT: Record<WinRule, [string, string, string, string]> = {
  transaction: ['Primera transacción', 'First transaction', 'El negocio se gana solo, cuando los datos de ventas traen la primera transacción del comercio.', 'The deal is won on its own, when the sales data shows the merchant’s first transaction.'],
  contract_or_transaction: ['Contrato firmado o primera transacción', 'Signed contract or first transaction', 'Se gana a mano con la fecha del contrato firmado, y también se gana solo con la primera transacción.', 'It is won by hand with the signed-contract date, and it is also won on its own with the first transaction.'],
  manual: ['A mano', 'By hand', 'Lo marca la persona, con lo que pidan las etapas del embudo.', 'A person marks it, with whatever the pipeline stages ask for.'],
}

/** Regla para ganar de cada embudo (E14.F8): una sola regla, la misma para todos sus negocios. */
export async function WinRules({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const rows = await getWinRules(ctx)
  return (
    <Card className="mt-8" data-testid="mx-win-rules">
      <CardTitle title={t('Regla para ganar', 'Win rule')} hint={t('Cada embudo tiene una sola regla y vale para todos sus negocios: así "ganado" significa lo mismo en cada reporte.', 'Each pipeline has a single rule and it applies to all its deals, so "won" means the same in every report.')} />
      <ul>
        {rows.map((p) => (
          <li key={p.id} className="border-t border-line py-4 first:border-t-0" data-testid="win-rule-row">
            <ActionForm action={setWinRuleAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="pipeline_id" value={p.id} />
              <div className="min-w-0 flex-1 basis-64">
                <p className="text-[15px] font-semibold text-strong">{p.name} <span className="font-normal text-muted">· {p.market_code}</span></p>
                <p className="text-[13px] text-muted" data-testid="win-rule-text">{t(RULE_TEXT[p.rule][2], RULE_TEXT[p.rule][3])}</p>
              </div>
              <Field label={t('Regla', 'Rule')}>
                <select name="rule" className="input" defaultValue={p.rule} data-testid="win-rule-select">
                  {WIN_RULES.filter((r) => r !== 'contract_or_transaction' || p.has_contract_field || p.rule === r).map((r) => <option key={r} value={r}>{t(RULE_TEXT[r][0], RULE_TEXT[r][1])}</option>)}
                </select>
              </Field>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13.5px] text-strong">
                <input type="checkbox" name="confirm" className="h-5 w-5 shrink-0" data-testid="win-rule-confirm" />
                <span>{t(`Aplica a ${num(p.open_deals, locale)} ${p.open_deals === 1 ? 'negocio abierto' : 'negocios abiertos'}`, `Applies to ${num(p.open_deals, locale)} open ${p.open_deals === 1 ? 'deal' : 'deals'}`)}</span>
              </label>
              <Submit variant="ghost" testId="win-rule-save">{t('Guardar regla', 'Save rule')}</Submit>
            </ActionForm>
          </li>
        ))}
      </ul>
    </Card>
  )
}
