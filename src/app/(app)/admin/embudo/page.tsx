import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { flat } from '@/server/params'
import { embudoAdmin } from '@/dal/embudo'
import { sellers } from '@/dal/leads'
import { accountTypes } from '@/dal/b2b'
import { ACTION_LABEL, RULE_ACTIONS, simulateAssignment, type RuleMatch } from '@/domain/embudo/routing'
import { PLATFORM_LABEL, type Platform } from '@/domain/embudo/attribution'
import { FIELD_LABEL } from '@/domain/deals'
import { Badge, Card, CardTitle, Field, PageHeader, buttonClass } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { DataTable } from '@/ui/reportes'
import { MOTOR, SOURCE, lab } from '@/lib/labels'
import { dayTime, num } from '@/lib/format'
import { changeAssignmentRuleAction, createAssignmentRuleAction, createLeadLabelAction, retryIntakeAction, setStageConditionAction } from '@/app/(app)/embudo-actions'

const SOURCES = ['web_form', 'web_campaign', 'import', 'referral', 'walk_in', 'phone_in', 'event', 'manual'] as const

/**
 * Administración del embudo (paquete embudo): reglas de asignación con su simulador y su bitácora, requisitos de etapa con
 * condición, embudos por tipo de venta con sus variantes por mercado, catálogo de motivos, etiquetas de lead, envíos de
 * formulario retenidos y conversiones en cola. Todo cambio queda en la bitácora.
 */
export default async function EmbudoAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx()
  if (!ctx.can('config.manage')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const cfg = await embudoAdmin(ctx)
  const live = ctx.markets.filter((m) => m.status === 'live')
  const people = await sellers(ctx)
  const types = await accountTypes(ctx, live[0]?.code ?? 'MX')
  const motors = [...new Set(cfg.stages.map((s) => s.motor))]
  const tokenLabel = (tok: string) => (FIELD_LABEL[tok] ? t(FIELD_LABEL[tok]!.es, FIELD_LABEL[tok]!.en) : tok.replace(/^field:/, ''))
  const matchText = (m: RuleMatch): string => {
    const parts: string[] = []
    if (m.sources?.length) parts.push(`${t('origen', 'source')}: ${m.sources.map((s) => lab(t, SOURCE[s], s)).join(', ')}`)
    if (m.motors?.length) parts.push(`${t('tipo de venta', 'sales type')}: ${m.motors.map((s) => lab(t, MOTOR[s], s)).join(', ')}`)
    if (m.form_ids?.length) parts.push(`${t('formulario', 'form')}: ${m.form_ids.map((id) => cfg.forms.find((f) => f.id === id)?.name ?? '?').join(', ')}`)
    if (m.territory_ids?.length) parts.push(`${t('territorio', 'territory')}: ${m.territory_ids.map((id) => cfg.territories.find((x) => x.id === id)?.name ?? '?').join(', ')}`)
    if (m.size_min !== undefined || m.size_max !== undefined) parts.push(`${t('tiendas', 'stores')}: ${m.size_min ?? 1} ${t('a', 'to')} ${m.size_max ?? t('más', 'more')}`)
    return parts.length ? parts.join(' · ') : t('Cualquier lead del mercado', 'Any lead in the market')
  }
  const stepText = (o: string) => o === 'no_match' ? t('no coincide', 'no match') : o === 'capped' ? t('coincide, pero todos llegaron a su tope', 'matches, but everyone hit their cap') : o === 'nobody' ? t('coincide, pero no hay a quién darlo', 'matches, but there is nobody to give it to') : t('decide', 'decides')
  const byText = (a: string) => a === 'form_rotation' ? t('Turno del formulario', 'Form rotation') : a === 'market_lead' ? t('Quien lidera el mercado (última red)', 'Market lead (last resort)') : a === 'none' ? t('Sin asignar', 'No owner') : ACTION_LABEL[a as keyof typeof ACTION_LABEL] ? t(ACTION_LABEL[a as keyof typeof ACTION_LABEL].es, ACTION_LABEL[a as keyof typeof ACTION_LABEL].en) : a

  // Simulador: "a quién le caería". Es una lectura: no asigna nada ni gasta el turno.
  const simMarket = live.some((m) => m.code === sp.sim_mercado) ? sp.sim_mercado! : null
  const simForm = cfg.forms.find((f) => f.id === sp.sim_formulario && f.market_code === simMarket)
  const sim = simMarket ? await simulateAssignment(ctx, {
    market: simMarket, source: simForm ? 'web_form' : (SOURCES as readonly string[]).includes(sp.sim_origen ?? '') ? sp.sim_origen! : 'web_form',
    motor: simForm?.motor ?? (sp.sim_tipo || 'd2d'), formId: simForm?.id ?? null, locality: sp.sim_ciudad ?? null, sizeUnits: /^\d{1,6}$/.test(sp.sim_tiendas ?? '') ? Number(sp.sim_tiendas) : null,
  }) : null

  return (
    <>
      <p className="mb-3"><Link href="/admin" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="embudo-admin-back">{t('Volver a Administración', 'Back to Administration')}</Link></p>
      <PageHeader eyebrow={t('Administración', 'Administration')} title={t('Asignación y embudo', 'Assignment and pipeline')}
        desc={t('A quién le toca cada lead, qué pide cada etapa según el caso, motivos, etiquetas y lo que quedó en cola. Todo cambio queda en la bitácora.', 'Who gets each lead, what each stage asks for depending on the case, reasons, labels and what is queued. Every change is logged.')} />
      <div className="space-y-8">
        <Card pad={false} data-testid="assignment-rules">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Reglas de asignación de leads', 'Lead assignment rules')}
            hint={t('Se revisan en orden: la primera que coincide y encuentra a alguien disponible decide. Si ninguna decide, vale el turno del formulario; y antes de dejar un lead sin asignar, le toca a quien lidera el mercado. Nunca se entrega a quien ya no vende en el mercado.', 'They are checked in order: the first one that matches and finds someone available decides. If none decides, the form rotation applies; and before leaving a lead with no owner, it goes to the market lead. Nothing is handed to someone who no longer sells in the market.')} /></div>
          <DataTable testId="rules-table" label={t('Reglas de asignación', 'Assignment rules')} empty={<p className="px-5 pb-5 text-[14px] text-muted md:px-7" data-testid="rules-empty">{t('Todavía no hay reglas: los leads web se reparten por el turno de su formulario. Crea la primera abajo.', 'There are no rules yet: web leads are shared out by their form rotation. Create the first one below.')}</p>}
            head={[{ label: t('Orden', 'Order') }, { label: t('Regla', 'Rule') }, { label: t('Cuándo aplica', 'When it applies') }, { label: t('Qué hace', 'What it does') }, { label: t('Tope', 'Cap'), num: true }, { label: t('Estado', 'Status') }, { label: t('Acciones', 'Actions') }]}
            rows={cfg.rules.map((r) => ({ key: r.id, testId: 'rule-row', cells: [
              `${r.market_code} · ${r.position}`, r.name, matchText(r.match ?? {}),
              `${t(ACTION_LABEL[r.action as keyof typeof ACTION_LABEL].es, ACTION_LABEL[r.action as keyof typeof ACTION_LABEL].en)}${r.user_name ? `: ${r.user_name}` : r.rotation_name ? `: ${r.rotation_name}` : ''}`,
              r.cap_open ?? t('sin tope', 'no cap'), <Badge key="b" tone={r.is_active ? 'good' : 'neutral'}>{r.is_active ? t('Activa', 'Active') : t('En pausa', 'Paused')}</Badge>,
              <div key="a" className="flex flex-wrap gap-2">
                {(['up', 'down', r.is_active ? 'off' : 'on'] as const).map((op) => (
                  <ActionForm key={op} action={changeAssignmentRuleAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value={op} />
                    <Submit variant="ghost" size="sm" testId={`rule-${op}`}>{op === 'up' ? t('Subir', 'Move up') : op === 'down' ? t('Bajar', 'Move down') : op === 'off' ? t('Pausar', 'Pause') : t('Activar', 'Turn on')}</Submit></ActionForm>
                ))}
              </div>] }))} />
          <ActionForm action={createAssignmentRuleAction} className="border-t border-line px-5 py-5 md:px-7" onOk="reset" testId="rule-form">
            <p className="mb-3 text-[15px] font-semibold text-strong">{t('Nueva regla', 'New rule')}</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t('Mercado', 'Market')}><select name="market" className="input" required data-testid="rule-market">{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
              <Field label={t('Nombre de la regla', 'Rule name')}><input name="name" className="input" required minLength={2} maxLength={80} data-testid="rule-name" /></Field>
              <Field label={t('Qué hace', 'What it does')}><select name="action" className="input" required data-testid="rule-action">{RULE_ACTIONS.map((a) => <option key={a} value={a}>{t(ACTION_LABEL[a].es, ACTION_LABEL[a].en)}</option>)}</select></Field>
              <Field label={t('Persona (si va a una persona)', 'Person (if it goes to one person)')}><select name="user_id" className="input" defaultValue="" data-testid="rule-user"><option value="">{t('Ninguna', 'None')}</option>{people.map((u) => <option key={`${u.id}-${u.market_code}`} value={u.id}>{u.full_name} · {u.market_code}</option>)}</select></Field>
              <Field label={t('Turno (si va por turno rotativo)', 'Rotation (if it goes by rotation)')}><select name="rotation_id" className="input" defaultValue="" data-testid="rule-rotation"><option value="">{t('Ninguno', 'None')}</option>{cfg.rotations.map((r) => <option key={r.id} value={r.id}>{r.market_code} · {r.name}</option>)}</select></Field>
              <Field label={t('Tope de leads abiertos por persona', 'Cap of open leads per person')} hint={t('Vacío: sin tope. Con tope, quien ya lo alcanzó no recibe otro y la regla pasa a la siguiente persona o regla.', 'Empty: no cap. With a cap, whoever reached it gets no more and the rule moves on to the next person or rule.')}><input name="cap_open" className="input" inputMode="numeric" pattern="[0-9]*" data-testid="rule-cap" /></Field>
              <Field label={t('Solo si entra por este formulario', 'Only if it comes through this form')}><select name="form_ids" className="input" defaultValue="" data-testid="rule-form-id"><option value="">{t('Cualquiera', 'Any')}</option>{cfg.forms.map((f) => <option key={f.id} value={f.id}>{f.market_code} · {f.name}</option>)}</select></Field>
              <Field label={t('Solo de este origen', 'Only from this source')}><select name="sources" className="input" defaultValue=""><option value="">{t('Cualquiera', 'Any')}</option>{SOURCES.map((s) => <option key={s} value={s}>{lab(t, SOURCE[s], s)}</option>)}</select></Field>
              <Field label={t('Solo de este tipo de venta', 'Only this sales type')}><select name="motors" className="input" defaultValue=""><option value="">{t('Cualquiera', 'Any')}</option>{motors.map((s) => <option key={s} value={s}>{lab(t, MOTOR[s], s)}</option>)}</select></Field>
              <Field label={t('Solo de este territorio', 'Only this territory')} hint={t('Se reconoce por la ciudad que escribe el lead.', 'It is recognized by the city the lead writes.')}><select name="territory_ids" className="input" defaultValue=""><option value="">{t('Cualquiera', 'Any')}</option>{cfg.territories.map((x) => <option key={x.id} value={x.id}>{x.market_code} · {x.name}</option>)}</select></Field>
              <Field label={t('Tiendas: desde', 'Stores: from')}><input name="size_min" className="input" inputMode="numeric" pattern="[0-9]*" data-testid="rule-size-min" /></Field>
              <Field label={t('Tiendas: hasta', 'Stores: up to')}><input name="size_max" className="input" inputMode="numeric" pattern="[0-9]*" /></Field>
            </div>
            <div className="mt-4 flex justify-end"><Submit testId="rule-save">{t('Crear regla', 'Create rule')}</Submit></div>
          </ActionForm>
        </Card>

        <Card data-testid="assignment-simulator">
          <CardTitle title={t('¿A quién le caería?', 'Who would get it?')} hint={t('Prueba las reglas con un lead imaginario. No asigna nada ni gasta el turno de nadie.', 'Try the rules with an imaginary lead. It assigns nothing and uses up nobody’s turn.')} />
          <form method="get" action="/admin/embudo" className="grid gap-4 md:grid-cols-5" data-testid="sim-form">
            <Field label={t('Mercado', 'Market')}><select name="sim_mercado" className="input" defaultValue={simMarket ?? live[0]?.code} data-testid="sim-market">{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
            <Field label={t('Formulario', 'Form')}><select name="sim_formulario" className="input" defaultValue={sp.sim_formulario ?? ''} data-testid="sim-form-id"><option value="">{t('Ninguno', 'None')}</option>{cfg.forms.map((f) => <option key={f.id} value={f.id}>{f.market_code} · {f.name}</option>)}</select></Field>
            <Field label={t('Tipo de venta', 'Sales type')}><select name="sim_tipo" className="input" defaultValue={sp.sim_tipo ?? ''}><option value="">{t('El del formulario', 'The form’s')}</option>{motors.map((s) => <option key={s} value={s}>{lab(t, MOTOR[s], s)}</option>)}</select></Field>
            <Field label={t('Ciudad', 'City')}><input name="sim_ciudad" className="input" defaultValue={sp.sim_ciudad ?? ''} maxLength={120} /></Field>
            <Field label={t('Número de tiendas', 'Number of stores')}><input name="sim_tiendas" className="input" inputMode="numeric" pattern="[0-9]*" defaultValue={sp.sim_tiendas ?? ''} data-testid="sim-size" /></Field>
            <div className="md:col-span-5 flex justify-end"><button type="submit" className={buttonClass('ghost', 'md')} data-testid="sim-run">{t('Simular', 'Simulate')}</button></div>
          </form>
          {sim && (
            <div className="mt-4 rounded-[14px] bg-surface-2 px-5 py-4" role="status" data-testid="sim-result">
              <p className="text-[15px] font-semibold text-strong" data-testid="sim-owner">{sim.ownerName ? t(`Le caería a ${sim.ownerName}.`, `It would go to ${sim.ownerName}.`) : t('Quedaría sin asignar: no hay nadie disponible ni quien lidere el mercado.', 'It would have no owner: nobody is available and the market has no lead.')}</p>
              <p className="mt-1 text-[13.5px] text-muted-2" data-testid="sim-why">{sim.by === 'rule' ? t(`Decide la regla "${sim.ruleName}".`, `The rule "${sim.ruleName}" decides.`) : byText(sim.action)}</p>
              {sim.steps.length > 0 && <ul className="mt-2 text-[13px] text-muted-2">{sim.steps.map((s, i) => <li key={i}>{s.rule}: {stepText(s.outcome)}</li>)}</ul>}
            </div>
          )}
        </Card>

        <Card pad={false} data-testid="assignment-log">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Últimas asignaciones', 'Latest assignments')} hint={t('Qué regla decidió cada lead, a quién le tocó y qué reglas no pudieron.', 'Which rule decided each lead, who got it and which rules could not.')} /></div>
          <DataTable testId="log-table" label={t('Bitácora de asignación', 'Assignment log')} empty={<p className="px-5 pb-5 text-[14px] text-muted md:px-7">{t('Todavía no entra ningún lead por las reglas.', 'No lead has come in through the rules yet.')}</p>}
            head={[{ label: t('Cuándo', 'When') }, { label: t('Lead', 'Lead') }, { label: t('Decidió', 'Decided by') }, { label: t('Le tocó a', 'Went to') }, { label: t('Reglas que no pudieron', 'Rules that could not') }]}
            rows={cfg.log.map((g) => ({ key: g.id, cells: [dayTime(g.created_at, locale, ctx.market(g.market_code).timezone), g.lead_id ? <Link key="l" href={`/leads/${g.lead_id}`} className="underline">{g.lead ?? t('Lead', 'Lead')}</Link> : t('n/a', 'n/a'),
              g.rule_name ?? byText(g.action), g.owner ?? t('Sin asignar', 'No owner'), (g.detail.steps ?? []).filter((s) => s.outcome === 'capped' || s.outcome === 'nobody').map((s) => `${s.rule}: ${stepText(s.outcome)}`).join(' · ') || t('ninguna', 'none')] }))} />
        </Card>

        <Card pad={false} data-testid="stage-conditions">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Embudos por tipo de venta y requisitos con condición', 'Pipelines by sales type and conditional requirements')}
            hint={t('Cada tipo de venta con sus variantes por mercado. Un requisito puede aplicar solo en ciertos mercados, tipos de cuenta o desde cierto monto; sin condición, aplica siempre. La regla vale igual en la pantalla, en la API y en la base.', 'Each sales type with its variants per market. A requirement can apply only in certain markets, account types or above a certain amount; with no condition, it always applies. The rule holds the same in the screen, the API and the database.')} /></div>
          {motors.map((motor) => (
            <div key={motor} className="border-t border-line px-5 py-4 md:px-7" data-testid="motor-group">
              <p className="text-[15px] font-semibold text-strong">{lab(t, MOTOR[motor], motor)} <span className="font-normal text-muted">· {[...new Set(cfg.stages.filter((s) => s.motor === motor).map((s) => s.market_code))].join(', ')}</span></p>
              <ul className="mt-2 space-y-3">
                {cfg.stages.filter((s) => s.motor === motor && s.required_fields.length > 0).map((s) => (
                  <li key={s.id} className="text-[14px]" data-testid="stage-req">
                    <span className="font-medium text-strong">{s.market_code} · {t(s.name_es, s.name_en)}</span>
                    <ul className="mt-1 space-y-2">
                      {s.required_fields.map((tok) => {
                        const c = s.conditions?.[tok]
                        return (
                          <li key={tok} className="rounded-[12px] bg-surface-2 px-4 py-3">
                            <p className="text-[13.5px] text-strong">{tokenLabel(tok)}: <span className="text-muted-2" data-testid="cond-text">{c ? [c.markets?.length ? `${t('solo en', 'only in')} ${c.markets.join(', ')}` : '', c.account_types?.length ? `${t('solo tipo de cuenta', 'only account type')} ${c.account_types.join(', ')}` : '', c.min_amount !== undefined ? `${t('desde un monto de', 'from an amount of')} ${num(c.min_amount, locale)}` : ''].filter(Boolean).join(' · ') : t('siempre', 'always')}</span></p>
                            <ActionForm action={setStageConditionAction} className="mt-2 flex flex-wrap items-end gap-3" testId="cond-form">
                              <input type="hidden" name="stage_id" value={s.id} /><input type="hidden" name="token" value={tok} />
                              <label className="text-[13px] text-muted-2">{t('Tipo de cuenta', 'Account type')}<select name="account_types" className="input mt-1 !w-auto min-w-[160px]" defaultValue={c?.account_types?.[0] ?? ''} data-testid="cond-type"><option value="">{t('Cualquiera', 'Any')}</option>{types.map((x) => <option key={x.code} value={x.code}>{t(x.label_es, x.label_en)}</option>)}</select></label>
                              <label className="text-[13px] text-muted-2">{t('Monto mínimo', 'Minimum amount')}<input name="min_amount" className="input mt-1 !w-[130px]" inputMode="decimal" defaultValue={c?.min_amount ?? ''} data-testid="cond-min" /></label>
                              <Submit variant="ghost" size="sm" testId="cond-save">{t('Guardar condición', 'Save condition')}</Submit>
                            </ActionForm>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>

        <Card data-testid="reason-catalog">
          <CardTitle title={t('Catálogo de motivos', 'Reason catalog')} hint={t('Los motivos se agregan y se apagan en Embudos y campos. Aquí está su versión (sube sola con cada cambio; la lee quien consume el catálogo por la API) y los códigos que llegaron de otro sistema y CONTIGO no conoce.', 'Reasons are added and turned off under Pipelines and fields. Here is their version (it goes up on every change; whoever reads the catalog through the API sees it) and the codes that arrived from another system and CONTIGO does not know.')} />
          <p className="text-[14.5px] text-strong" data-testid="reason-version">{t(`Versión ${cfg.version?.version ?? 1}`, `Version ${cfg.version?.version ?? 1}`)} · {cfg.reasonCounts.map((r) => `${r.kind === 'lost' ? t('pérdida', 'loss') : t('no venta', 'no sale')} ${r.scope === '*' ? t('general', 'global') : r.scope}: ${r.n}`).join(' · ')}</p>
          {cfg.unknown.length === 0
            ? <p className="mt-3 text-[14px] text-muted" data-testid="unknown-empty">{t('No ha llegado ningún código desconocido.', 'No unknown code has arrived.')}</p>
            : <ul className="mt-3 space-y-1 text-[14px]" data-testid="unknown-codes">{cfg.unknown.map((u) => <li key={`${u.source}-${u.code}`}><strong>{u.code}</strong> · {u.source === 'sales_app' ? 'Sales App' : u.source} · {t(`${u.hits} veces`, `${u.hits} times`)} · {dayTime(u.last_seen, locale)}</li>)}</ul>}
        </Card>

        <Card data-testid="lead-labels">
          <CardTitle title={t('Etiquetas de lead', 'Lead labels')} hint={t('Sirven para marcar leads y filtrar la bandeja.', 'They are used to mark leads and filter the inbox.')} />
          <ul className="mb-4 flex flex-wrap gap-2">{cfg.labels.map((b) => <li key={b.code}><Badge>{t(b.label_es, b.label_en)} · {b.used}</Badge></li>)}</ul>
          <ActionForm action={createLeadLabelAction} className="flex flex-wrap items-end gap-3" onOk="reset" testId="label-form">
            <Field label={t('Etiqueta en español', 'Label in Spanish')}><input name="label_es" className="input" required minLength={2} maxLength={40} data-testid="label-es" /></Field>
            <Field label={t('Etiqueta en inglés', 'Label in English')}><input name="label_en" className="input" required minLength={2} maxLength={40} data-testid="label-en" /></Field>
            <Submit variant="ghost" testId="label-save">{t('Agregar etiqueta', 'Add label')}</Submit>
          </ActionForm>
        </Card>

        <Card pad={false} data-testid="intake-retries">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Envíos de formulario retenidos', 'Held form submissions')} hint={t('Un envío que no se pudo guardar por una falla nuestra queda aquí y se reintenta solo. Lo que se agota se puede reintentar a mano.', 'A submission that could not be saved because of a failure on our side stays here and is retried automatically. Whatever runs out can be retried by hand.')} /></div>
          <DataTable testId="retries-table" label={t('Envíos retenidos', 'Held submissions')} empty={<p className="px-5 pb-5 text-[14px] text-muted md:px-7" data-testid="retries-empty">{t('No hay envíos retenidos: todo lo que llegó se guardó.', 'There are no held submissions: everything that arrived was saved.')}</p>}
            head={[{ label: t('Llegó', 'Arrived') }, { label: t('Formulario', 'Form') }, { label: t('Estado', 'Status') }, { label: t('Intentos', 'Attempts'), num: true }, { label: t('Acciones', 'Actions') }]}
            rows={cfg.retries.map((r) => ({ key: r.id, cells: [dayTime(r.created_at, locale), r.slug, r.status === 'failed' ? t('Agotado', 'Out of attempts') : t('Pendiente de reintento', 'Waiting to retry'), r.attempts,
              <ActionForm key="a" action={retryIntakeAction}><input type="hidden" name="id" value={r.id} /><Submit variant="ghost" size="sm" testId="retry-now">{t('Reintentar ahora', 'Retry now')}</Submit></ActionForm>] }))} />
        </Card>

        <Card pad={false} data-testid="conversion-queue">
          <div className="px-5 pt-5 md:px-7 md:pt-7"><CardTitle title={t('Conversiones para plataformas de anuncios', 'Conversions for ad platforms')} hint={t('Lead calificado y primera transacción, por la plataforma de la que vino el clic. El envío está apagado: se guardan y no sale nada hasta que se apruebe y se conecte cada plataforma.', 'Qualified lead and first transaction, by the platform the click came from. Sending is off: they are stored and nothing leaves until each platform is approved and connected.')} /></div>
          <DataTable testId="conversions-table" label={t('Conversiones en cola', 'Queued conversions')} empty={<p className="px-5 pb-5 text-[14px] text-muted md:px-7" data-testid="conversions-empty">{t('Todavía no hay conversiones: ningún lead con clic de anuncio se ha calificado.', 'There are no conversions yet: no lead with an ad click has been qualified.')}</p>}
            head={[{ label: t('Plataforma', 'Platform') }, { label: t('Evento', 'Event') }, { label: t('Estado', 'Status') }, { label: t('Cuántas', 'How many'), num: true }]}
            rows={cfg.conversions.map((c) => ({ key: `${c.platform}-${c.event_name}-${c.status}`, cells: [PLATFORM_LABEL[c.platform as Platform] ?? c.platform, c.event_name === 'purchase' ? t('Primera transacción', 'First transaction') : t('Lead calificado', 'Qualified lead'),
              c.status === 'channel_off' ? t('Canal apagado', 'Channel off') : c.status === 'queued' ? t('En cola', 'Queued') : c.status === 'simulated' ? t('Simulado (pruebas)', 'Simulated (tests)') : c.status, num(c.n, locale)] }))} />
        </Card>
      </div>
    </>
  )
}
