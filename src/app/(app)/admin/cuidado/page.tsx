import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getCareAdmin } from '@/dal/care'
import { careAdapterStatus } from '@/server/adapters/care'
import { whatsappAdapter } from '@/server/adapters/whatsapp'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { day } from '@/lib/format'
import { lab, qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { ALERT, ALERT_KINDS, HEALTH_GROUP, HEALTH_GROUPS, HEALTH_MIN_SAMPLE, PRODUCT_LINE, PRODUCT_LINES, TIER, share, type Tier } from '@/lib/care'
import { careSettingsAction, expansionRuleAction, healthPublishAction, healthWeightsAction, playbookAction, runNowAction, tierRulesAction, windowAction } from '../../cuidado/actions'

const major = (minor: string | null) => (minor === null ? '' : String(Number(minor) / 100))

/**
 * Administración > Cuidado de comercios. Todo lo que decide cómo se cuida un comercio después de la venta es un dato que
 * se cambia aquí, por mercado: ventanas del ciclo de vida, alertas y guías de acción, pesos del puntaje de salud,
 * modelo de atención y reglas de expansión. Lo cambia quien lidera el mercado o administración.
 */
export default async function CareAdminPage({ searchParams }: { searchParams: Promise<{ mercado?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const markets = ctx.markets.filter((m) => ctx.can('care.manage', m.code))
  if (markets.length === 0) notFound()
  const sp = flat(await searchParams)
  const market = markets.find((m) => m.code === sp.mercado) ?? markets.find((m) => m.status === 'live') ?? markets[0]!
  const c = await getCareAdmin(ctx, market.code)
  const s = c.settings
  const mk = <input type="hidden" name="market" value={market.code} />
  const win = (line: string) => c.windows.find((w) => w.product_line === line) ?? (line === 'general' ? null : c.windows.find((w) => w.product_line === 'general')) ?? null
  const runNow = (what: string, label: string, testId: string, extra?: React.ReactNode) => (
    <ActionForm action={runNowAction} className="flex min-w-0 max-w-full flex-wrap items-end gap-3">
      {mk}<input type="hidden" name="what" value={what} />{extra}
      <Submit variant="ghost" testId={testId}>{label}</Submit>
    </ActionForm>
  )
  const allValidation = c.validations.find((v) => v.tier === 'all')

  return (
    <>
      <PageHeader
        eyebrow={t('Administración', 'Administration')}
        title={t(`Cuidado de comercios: ${market.name}`, `Merchant care: ${market.name}`)}
        desc={t('Las reglas con las que CONTIGO cuida a un comercio después de la venta. Son del mercado y se cambian aquí, sin tocar código.', 'The rules CONTIGO uses to look after a merchant after the sale. They belong to the market and are changed here, with no code.')}
        actions={<Link href={qs('/cuidado', { mercado: market.code })} className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="care-board-link">{t('Ver la mesa de trabajo', 'Open the workbench')}</Link>}
      />
      {markets.length > 1 && <div className="mb-6"><Pills label={t('Mercado', 'Market')} current={market.code} items={markets.map((m) => ({ key: m.code, href: qs('/admin/cuidado', { mercado: m.code }), label: m.name }))} /></div>}

      {/* ------------------------------------------------ ciclo de vida */}
      <Card data-testid="admin-windows">
        <CardTitle title={t('Ventanas del ciclo de vida', 'Lifecycle windows')} hint={t('Días con venta en los últimos 30. Salir de riesgo pide más días que entrar, y todo cambio necesita unos días en la etapa: así un día bueno o malo no mueve a nadie. Cada línea de producto puede tener su ventana; sin una propia usa la general.', 'Selling days in the last 30. Leaving at-risk asks for more days than entering it, and every change needs a few days in the stage: one good or bad day moves nobody. Each product line can have its own window; with none of its own it uses the general one.')} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {PRODUCT_LINES.map((line) => {
            const w = win(line)
            const own = c.windows.some((x) => x.product_line === line)
            return (
              <section key={line} className="rounded-[12px] border border-line p-4" data-testid={`window-${line}`}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-strong">{lab(t, PRODUCT_LINE[line])}</h3>
                  <Badge tone={own && w?.calibrated_from === 'backtest' ? 'good' : 'neutral'}><span data-testid="window-origin">{!own ? (line === 'general' ? t('Valores de fábrica', 'Factory values') : t('Usa la general', 'Uses the general one')) : w?.calibrated_from === 'backtest' ? t(`Calibrada con datos propios (${w.sample ?? 0} comercios)`, `Calibrated with own data (${w.sample ?? 0} merchants)`) : t('Definida a mano', 'Set by hand')}</span></Badge>
                </div>
                <ActionForm action={windowAction} className="grid grid-cols-2 gap-3">
                  {mk}<input type="hidden" name="line" value={line} />
                  <Field label={t('Entra a riesgo con menos de', 'At risk below')}><input type="number" name="riskBelow" min={1} max={20} required className="input" defaultValue={w?.risk_below ?? 5} data-testid="w-risk" /></Field>
                  <Field label={t('Sale de riesgo con', 'Out of risk at')}><input type="number" name="recoverAt" min={2} max={25} required className="input" defaultValue={w?.recover_at ?? 8} data-testid="w-recover" /></Field>
                  <Field label={t('Hábito desde', 'Habit from')}><input type="number" name="habitAt" min={5} max={31} required className="input" defaultValue={w?.habit_at ?? 20} data-testid="w-habit" /></Field>
                  <Field label={t('Pierde el hábito con menos de', 'Habit lost below')}><input type="number" name="habitBelow" min={3} max={30} required className="input" defaultValue={w?.habit_below ?? 15} /></Field>
                  <Field label={t('Perdido tras días sin vender', 'Lost after days with no sale')}><input type="number" name="churnAfterDays" min={31} max={365} required className="input" defaultValue={w?.churn_after_days ?? 90} /></Field>
                  <Field label={t('Días mínimos en la etapa', 'Minimum days in the stage')}><input type="number" name="minDaysInStage" min={0} max={30} required className="input" defaultValue={w?.min_days_in_stage ?? 3} /></Field>
                  <div className="col-span-2 flex flex-wrap justify-end gap-2">
                    <Submit name="intent" value="backtest" variant="quiet" size="sm" testId="w-backtest">{t('Calibrar con datos propios', 'Calibrate with own data')}</Submit>
                    <Submit name="intent" value="save" variant="ghost" size="sm" testId="w-save">{t('Guardar', 'Save')}</Submit>
                  </div>
                </ActionForm>
              </section>
            )
          })}
        </div>
        <div className="mt-5 border-t border-line pt-4">{runNow('lifecycle', t('Recalcular etapas', 'Recalculate stages'), 'run-lifecycle')}</div>
      </Card>

      {/* ------------------------------------------------ alertas */}
      <Card className="mt-6" data-testid="admin-alerts">
        <CardTitle title={t('Alertas tempranas', 'Early alerts')} hint={t('Con las alertas encendidas, cada una llega como tarea a quien le toca según el modelo de atención, con su guía de acción. Una parte queda sin tarea como grupo de control, para medir si la guía sirve.', 'With alerts on, each one arrives as a task for whoever it belongs to under the service model, with its playbook. A share gets no task, as a control group, to measure whether the playbook works.')}
          right={<Badge tone={s.alerts_on ? 'good' : 'neutral'}><span data-testid="alerts-state">{s.alerts_on ? t('Encendidas', 'On') : t('Apagadas', 'Off')}</span></Badge>} />
        <ActionForm action={careSettingsAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" testId="settings-form">
          {mk}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-strong sm:col-span-2 lg:col-span-3"><input type="checkbox" name="alertsOn" defaultChecked={s.alerts_on} className="h-5 w-5 shrink-0" data-testid="alerts-on" /><span>{t('Crear tareas de alerta en este mercado', 'Create alert tasks in this market')}</span></label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-strong sm:col-span-2 lg:col-span-3"><input type="checkbox" name="ownRulesOn" defaultChecked={s.own_rules_on} className="h-5 w-5 shrink-0" data-testid="own-rules-on" /><span>{t('Mientras un comercio no aparezca en el archivo de ventas, mover su etapa con las ventas que CONTIGO conoce (visitas con venta y negocios ganados)', 'While a merchant is not in the sales file, move its stage with the sales CONTIGO knows about (visits with a sale and won deals)')}</span></label>
          <Field label={t('Días en alta sin primera venta', 'Onboarding days with no first sale')}><input type="number" name="noFirstSaleDays" min={1} max={60} required className="input" defaultValue={s.no_first_sale_days} data-testid="s-first-sale" /></Field>
          <Field label={t('Caída contra su línea base (%)', 'Drop against its baseline (%)')}><input type="number" name="dropPct" min={10} max={90} required className="input" defaultValue={s.drop_pct} /></Field>
          <Field label={t(`Saldo bajo, en ${market.currency}`, `Low balance, in ${market.currency}`)} hint={t('Vacío: sin alerta de saldo.', 'Empty: no balance alert.')}><input type="number" name="lowBalance" min={0} step="0.01" className="input" defaultValue={major(s.low_balance_minor)} data-testid="s-balance" /></Field>
          <Field label={t('Grupo de control (%)', 'Control group (%)')}><input type="number" name="holdoutPct" min={0} max={50} required className="input" defaultValue={s.holdout_pct} data-testid="s-holdout" /></Field>
          <Field label={t('Días antes de pasar un mensaje a una persona', 'Days before a message goes to a person')}><input type="number" name="escalateDays" min={1} max={30} required className="input" defaultValue={s.escalate_days} /></Field>
          <Field label={t('Mensajes por día por cartera', 'Messages per day per portfolio')}><input type="number" name="whatsappCap" min={0} max={500} required className="input" defaultValue={s.whatsapp_cap_per_owner} /></Field>
          <div className="flex justify-end sm:col-span-2 lg:col-span-3"><Submit testId="settings-save">{t('Guardar alertas', 'Save alerts')}</Submit></div>
        </ActionForm>
        <p className="mt-3 text-[13px] text-muted" data-testid="whatsapp-state">{whatsappAdapter().mode === 'off' ? t('WhatsApp está apagado: los mensajes a comercios quedan en la cola como "Listo para enviar. Canal apagado" y toda alerta va a una persona. Solo salen a comercios que dieron permiso.', 'WhatsApp is off: messages to merchants stay in the queue as "Ready to send. Channel off" and every alert goes to a person. They only go to merchants that gave permission.') : t('WhatsApp está en simulación de pruebas.', 'WhatsApp is in test simulation.')}</p>
        <div className="mt-4 border-t border-line pt-4">{runNow('alerts', t('Evaluar alertas ahora', 'Evaluate alerts now'), 'run-alerts')}</div>
      </Card>

      {/* ------------------------------------------------ guías de acción */}
      <Card className="mt-6" data-testid="admin-playbooks">
        <CardTitle title={t('Guías de acción', 'Playbooks')} hint={t('Qué hacer en cada tipo de alerta. Los pasos van en la tarea, uno por renglón. El mensaje al comercio es opcional y usa {comercio} para su nombre.', 'What to do for each kind of alert. The steps go in the task, one per line. The message to the merchant is optional and uses {comercio} for its name.')} />
        <div className="grid grid-cols-1 gap-6">
          {ALERT_KINDS.map((kind) => {
            const pb = c.playbooks.find((p) => p.alert_kind === kind && p.tier === 'any')
            const extra = c.playbooks.filter((p) => p.alert_kind === kind && p.tier !== 'any')
            return (
              <section key={kind} className="rounded-[12px] border border-line p-4" data-testid={`playbook-${kind}`}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-strong">{lab(t, ALERT[kind].label)}</h3>
                  <span className="text-[13px] text-muted">{pb?.market_code ? t('Guía de este mercado', 'This market’s playbook') : t('Guía general', 'General playbook')}{extra.length ? ` · ${t('con variantes para', 'with variants for')} ${extra.map((x) => lab(t, TIER[x.tier as Tier]?.label)).join(', ')}` : ''}</span>
                </div>
                <ActionForm action={playbookAction} className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {mk}<input type="hidden" name="kind" value={kind} />
                  <Field label={t('Título (español)', 'Title (Spanish)')}><input name="titleEs" required minLength={3} maxLength={120} className="input" defaultValue={pb?.title_es ?? ''} data-testid="pb-title-es" /></Field>
                  <Field label={t('Título (inglés)', 'Title (English)')}><input name="titleEn" required minLength={3} maxLength={120} className="input" defaultValue={pb?.title_en ?? ''} /></Field>
                  <Field label={t('Pasos (español), uno por renglón', 'Steps (Spanish), one per line')}><textarea name="stepsEs" rows={4} required className="input" defaultValue={(pb?.steps_es ?? []).join('\n')} data-testid="pb-steps-es" /></Field>
                  <Field label={t('Pasos (inglés), uno por renglón', 'Steps (English), one per line')}><textarea name="stepsEn" rows={4} required className="input" defaultValue={(pb?.steps_en ?? []).join('\n')} /></Field>
                  <Field label={t('Mensaje al comercio (español, opcional)', 'Message to the merchant (Spanish, optional)')}><textarea name="messageEs" rows={2} maxLength={600} className="input" defaultValue={pb?.message_es ?? ''} /></Field>
                  <Field label={t('Mensaje al comercio (inglés, opcional)', 'Message to the merchant (English, optional)')}><textarea name="messageEn" rows={2} maxLength={600} className="input" defaultValue={pb?.message_en ?? ''} /></Field>
                  <Field label={t('Para qué modelo de atención', 'For which service model')}>
                    <select name="tier" className="input" defaultValue="any"><option value="any">{t('Todos', 'All')}</option>{(Object.keys(TIER) as Tier[]).map((k) => <option key={k} value={k}>{lab(t, TIER[k].label)}</option>)}</select>
                  </Field>
                  <Field label={t('Días hábiles para la tarea', 'Business days for the task')}><input type="number" name="dueDays" min={0} max={14} required className="input" defaultValue={pb?.due_days ?? 2} /></Field>
                  <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="isActive" defaultChecked={pb?.is_active ?? true} className="h-5 w-5 shrink-0" /><span>{t('Guía activa', 'Playbook active')}</span></label>
                    <Submit variant="ghost" size="sm" testId="pb-save">{t('Guardar guía para este mercado', 'Save playbook for this market')}</Submit>
                  </div>
                </ActionForm>
              </section>
            )
          })}
        </div>
      </Card>

      {/* ------------------------------------------------ salud */}
      <Card className="mt-6" data-testid="admin-health">
        <CardTitle title={t('Puntaje de salud', 'Health score')} hint={t('Reglas con pesos, sin modelo. Cada grupo aporta como mucho su peso; un grupo sin dato no cuenta. Antes de publicarlo al equipo hay que validarlo contra lo que pasó.', 'Rules with weights, no model. Each group adds at most its weight; a group with no data is not counted. Before publishing it to the team it must be validated against what happened.')}
          right={<Badge tone={s.health_published ? 'good' : 'warn'}><span data-testid="health-state">{s.health_published ? t('Publicado', 'Published') : t('En validación', 'Being validated')}</span></Badge>} />
        <ActionForm action={healthWeightsAction} className="grid grid-cols-1 gap-3" testId="weights-form">
          {mk}
          {HEALTH_GROUPS.map((g) => {
            const w = c.weights.find((x) => x.grp === g)
            return (
              <div key={g} className="grid grid-cols-[minmax(0,1fr)_96px] items-end gap-3 border-t border-line pt-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_120px_auto]" data-testid={`weight-${g}`}>
                <div className="min-w-0"><p className="text-[14.5px] font-medium text-strong">{lab(t, HEALTH_GROUP[g].label)}</p><p className="text-[13px] text-muted">{lab(t, HEALTH_GROUP[g].hint)}</p></div>
                <Field label={t('Peso', 'Weight')}><input type="number" name={`w_${g}`} min={0} max={100} required className="input" defaultValue={w?.weight ?? 0} data-testid={`w-${g}`} /></Field>
                <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-strong sm:col-span-1"><input type="checkbox" name={`a_${g}`} defaultChecked={w?.is_active ?? true} className="h-5 w-5 shrink-0" /><span>{t('Cuenta', 'Counts')}</span></label>
              </div>
            )
          })}
          <div className="flex justify-end"><Submit variant="ghost" testId="weights-save">{t('Guardar pesos', 'Save weights')}</Submit></div>
        </ActionForm>
        <section className="mt-5 border-t border-line pt-4" data-testid="health-validation-admin">
          <h3 className="mb-2 text-[14px] font-semibold text-strong">{t('Validación contra lo que pasó', 'Validation against what happened')}</h3>
          {c.validations.length === 0 ? (
            <p className="text-[13.5px] text-muted">{t(`Todavía no se ha validado. Hacen falta al menos ${HEALTH_MIN_SAMPLE} comercios con puntaje de hace 14 días o más.`, `Not validated yet. At least ${HEALTH_MIN_SAMPLE} merchants scored 14 or more days ago are needed.`)}</p>
          ) : (
            <ul>
              {c.validations.map((v) => (
                <li key={v.id} className="border-t border-line py-2 text-[13.5px] first:border-t-0" data-testid="validation-row">
                  <span className="font-medium text-strong">{v.tier === 'all' ? t('Todos', 'All') : v.tier === 'none' ? t('Sin modelo de atención', 'No service model') : lab(t, TIER[v.tier as Tier]?.label, v.tier)}</span>
                  <span className="text-muted"> · {t(`${v.sample} comercios, ${v.positives} dejaron de vender · de los marcados en riesgo dejó de vender ${share(v.hit_precision, 's/d')} · de los que dejaron de vender había marcado a ${share(v.hit_recall, 's/d')} · a ${v.horizon_days} días, en riesgo por debajo de ${v.threshold} · ${day(v.run_at, locale, market.timezone)}`, `${v.sample} merchants, ${v.positives} stopped selling · of those flagged at risk, ${share(v.hit_precision, 'n/a')} stopped selling · of those that stopped selling, it had flagged ${share(v.hit_recall, 'n/a')} · at ${v.horizon_days} days, at risk below ${v.threshold} · ${day(v.run_at, locale, market.timezone)}`)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {runNow('health', t('Calcular puntaje de hoy', 'Score today'), 'run-health')}
            {runNow('validate', t('Validar', 'Validate'), 'run-validate', <Field label={t('A cuántos días', 'At how many days')}><input type="number" name="horizon" min={0} max={90} defaultValue={30} className="input w-28" data-testid="validate-horizon" /></Field>)}
            {ctx.can('health.publish', market.code) && (
              <ActionForm action={healthPublishAction}>
                {mk}<input type="hidden" name="on" value={s.health_published ? '0' : '1'} />
                <Submit variant={s.health_published ? 'quiet' : 'primary'} testId="health-publish">{s.health_published ? t('Dejar de publicar', 'Stop publishing') : t('Publicar al equipo', 'Publish to the team')}</Submit>
              </ActionForm>
            )}
          </div>
          {allValidation && allValidation.sample < HEALTH_MIN_SAMPLE && <p className="mt-2 text-[13px] text-amber-text">{t(`La última validación tuvo ${allValidation.sample} comercios: todavía no alcanza para publicar.`, `The last validation had ${allValidation.sample} merchants: not enough to publish yet.`)}</p>}
        </section>
      </Card>

      {/* ------------------------------------------------ modelo de atención */}
      <Card className="mt-6" data-testid="admin-tiers">
        <CardTitle title={t('Modelo de atención', 'Service model')} hint={t('Cada comercio queda en dedicada, en equipo, ligera o digital según la comisión que genera en 30 días. Si no hay dato de comisión, se estima con su volumen y la tasa de abajo. Cadenas, distribuidores y organizaciones son siempre de atención dedicada.', 'Each merchant lands in dedicated, pooled, light or digital by the commission it generates in 30 days. With no commission data, it is estimated from its volume and the rate below. Chains, distributors and organizations are always dedicated.')} />
        <ActionForm action={tierRulesAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" testId="tier-form">
          {mk}
          <Field label={t(`Dedicada desde (${market.currency})`, `Dedicated from (${market.currency})`)}><input type="number" name="high" min={0.01} step="0.01" required className="input" defaultValue={major(s.tier_high_commission)} data-testid="t-high" /></Field>
          <Field label={t(`En equipo desde (${market.currency})`, `Pooled from (${market.currency})`)}><input type="number" name="pooled" min={0.01} step="0.01" required className="input" defaultValue={major(s.tier_pooled_commission)} /></Field>
          <Field label={t(`Ligera desde (${market.currency})`, `Light from (${market.currency})`)}><input type="number" name="low" min={0.01} step="0.01" required className="input" defaultValue={major(s.tier_low_commission)} /></Field>
          <Field label={t('Tasa para estimar la comisión (puntos base)', 'Rate to estimate commission (basis points)')} hint={t('100 puntos base es 1% del volumen.', '100 basis points is 1% of volume.')}><input type="number" name="rateBp" min={1} max={1000} required className="input" defaultValue={s.tier_commission_rate_bp} /></Field>
          <Field label={t('Margen para no brincar de nivel (%)', 'Margin so the level does not jump (%)')} hint={t('Para bajar de nivel hay que caer este porcentaje por debajo del umbral.', 'To go down a level it must fall this far below the threshold.')}><input type="number" name="hysteresisPct" min={0} max={50} required className="input" defaultValue={s.tier_hysteresis_pct} /></Field>
          <div className="flex items-end justify-end"><Submit variant="ghost" testId="tier-save">{t('Guardar reglas', 'Save rules')}</Submit></div>
        </ActionForm>
        <div className="mt-4 border-t border-line pt-4">{runNow('tiers', t('Recalcular ahora', 'Recalculate now'), 'run-tiers')}</div>
      </Card>

      {/* ------------------------------------------------ expansión */}
      <Card className="mt-6" data-testid="admin-expansion">
        <CardTitle title={t('Reglas de expansión', 'Expansion rules')} hint={t('A qué comercio activo se le ofrece un producto más. La regla mira lo que de verdad vende: nunca abre una oportunidad para un comercio que no vende ni para uno que ya tiene el producto.', 'Which active merchant is offered one more product. The rule looks at what it really sells: it never opens an opportunity for a merchant that does not sell, or for one that already has the product.')} />
        {c.rules.length === 0 ? <Empty title={t('Sin reglas todavía', 'No rules yet')} hint={t('Agrega la primera aquí abajo.', 'Add the first one below.')} /> : (
          <ul>
            {c.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-2.5 text-[14px] first:border-t-0" data-testid="expansion-rule">
                <span><span className="font-medium text-strong">{r.product_label}</span> <span className="text-muted">· {t(`${r.min_active_days} días con venta o más · ${r.min_txn_30d} transacciones o más en 30 días · ${r.min_days_since_first} días desde su primera venta`, `${r.min_active_days}+ selling days · ${r.min_txn_30d}+ transactions in 30 days · ${r.min_days_since_first} days since its first sale`)} · {t(`${r.open} abiertas`, `${r.open} open`)}</span></span>
                <Badge tone={r.is_active ? 'good' : 'neutral'}>{r.is_active ? t('Activa', 'Active') : t('Pausada', 'Paused')}</Badge>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={expansionRuleAction} onOk="reset" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" testId="rule-form">
          {mk}
          <Field label={t('Producto que se ofrece', 'Product offered')} hint={t('Con el mismo nombre, cambia la regla que ya existe.', 'With the same name, it changes the existing rule.')}><input name="productLabel" required minLength={2} maxLength={80} className="input" data-testid="rule-product" /></Field>
          <Field label={t('Producto del catálogo (opcional)', 'Catalog product (optional)')} hint={t('Si lo eliges, no se ofrece a quien ya lo tiene.', 'If you pick it, it is not offered to those that already have it.')}>
            <select name="productId" className="input" defaultValue=""><option value="">{t('Ninguno', 'None')}</option>{c.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Field>
          <Field label={t('Días con venta en 30, mínimo', 'Selling days in 30, minimum')}><input type="number" name="minActiveDays" min={1} max={31} required defaultValue={10} className="input" data-testid="rule-days" /></Field>
          <Field label={t('Transacciones en 30 días, mínimo', 'Transactions in 30 days, minimum')}><input type="number" name="minTxn30d" min={1} required defaultValue={20} className="input" data-testid="rule-txn" /></Field>
          <Field label={t('Días desde su primera venta, mínimo', 'Days since its first sale, minimum')}><input type="number" name="minDaysSinceFirst" min={0} max={720} required defaultValue={60} className="input" data-testid="rule-tenure" /></Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-strong"><input type="checkbox" name="isActive" defaultChecked className="h-5 w-5 shrink-0" /><span>{t('Activa', 'Active')}</span></label>
            <Submit variant="ghost" testId="rule-save">{t('Guardar regla', 'Save rule')}</Submit>
          </div>
        </ActionForm>
        <div className="mt-4 border-t border-line pt-4">{runNow('expansion', t('Buscar oportunidades', 'Find opportunities'), 'run-expansion')}</div>
      </Card>

      {/* ------------------------------------------------ conexiones */}
      <Card className="mt-6" data-testid="admin-care-adapters">
        <CardTitle title={t('Conexiones apagadas', 'Connections that are off')} hint={t('Están construidas y no llaman a nada fuera de CONTIGO. Encender cualquiera pasa primero por la revisión de tecnología.', 'They are built and call nothing outside CONTIGO. Turning any of them on goes through the technology review first.')} />
        <ul>
          {careAdapterStatus().map((ad) => (
            <li key={ad.key} className="border-t border-line py-3 first:border-t-0" data-testid="care-adapter">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[14.5px] font-medium text-strong">{lab(t, ad.name)}</p>
                <Badge tone="neutral">{ad.mode === 'off' ? t('Conexión apagada', 'Connection off') : t('Simulada (solo pruebas)', 'Simulated (tests only)')}</Badge>
              </div>
              <p className="text-[13px] text-muted">{lab(t, ad.needs)}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
