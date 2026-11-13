import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { flat } from '@/server/params'
import { iaAdmin, LIFT_MIN, recommendationStats } from '@/dal/ia'
import { LEVELS, LEVEL_LABEL, TOOLS } from '@/domain/ia/agents'
import { DEFAULT_WEIGHTS, FACTOR_LABEL, SCORE_FACTORS } from '@/domain/ia/rules'
import { EVAL_CHOICES } from '@/domain/ia/commands'
import { MCP_TOOLS, MCP_ROW_LIMIT } from '@/server/mcp/tools'
import { AI_ENV, AI_EGRESS_ENV, MCP_ENV, mcpMode, type AiFeature } from '@/server/adapters/ai'
import { readerTimeZone } from '@/server/timezone'
import { qs } from '@/lib/labels'
import { dayTime, num } from '@/lib/format'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, Table } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { addEvalCaseAction, recordSpotCheckAction, runEvaluationAction, setHoldoutAction, setIaSettingsAction, setLeadWeightsAction } from './actions'

export const dynamic = 'force-dynamic'

const TABS = ['autonomia', 'calificacion', 'evaluacion', 'mcp'] as const
type Tab = (typeof TABS)[number]
type Pair = [string, string]

const FEATURE_LABEL: Record<AiFeature, Pair> = {
  next_action: ['Siguiente acción', 'Next action'],
  lead_class: ['Clasificación de leads', 'Lead classification'],
  metric_question: ['Preguntas sobre cifras', 'Questions about figures'],
  capture: ['Captura asistida', 'Assisted capture'],
}

/**
 * IA y asistencia (Administración): nivel de autonomía por mercado y quién lo supervisa, grupo de control, pesos de la
 * calificación de leads, evaluación por función (nada se enciende sin pasarla) y las herramientas del servidor MCP.
 * Lo lee leadership; lo cambia administración.
 */
export default async function IaAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('ia.oversee') && !ctx.can('ia.manage')) notFound()
  const { t, locale } = ctx
  const manage = ctx.can('ia.manage')
  const sp = flat(await searchParams)
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'autonomia'
  const tz = await readerTimeZone(ctx)
  const now = new Date()
  const d = await iaAdmin(ctx)
  const stats = await recommendationStats(ctx)
  const labels: Record<Tab, string> = { autonomia: t('Autonomía y medición', 'Autonomy and measurement'), calificacion: t('Calificación de leads', 'Lead scoring'), evaluacion: t('Evaluación', 'Evaluation'), mcp: t('Servidor MCP', 'MCP server') }
  const when = (x: Date | null) => (x ? dayTime(x, locale, tz) : t('nunca', 'never'))
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : t('s/d', 'n/a'))

  return (
    <>
      <PageHeader
        title={t('IA y asistencia', 'AI and assistance')}
        desc={t('Ningún modelo de IA está conectado. Las sugerencias, la calificación de leads y las preguntas sobre cifras funcionan con reglas. Aquí se decide qué tanto hace cada mercado y se prueba cada función antes de encender nada.', 'No AI model is connected. Suggestions, lead scoring and questions about figures work with rules. Here you decide how much each market does and each feature is tested before anything is turned on.')}
      />
      <p className="mb-4 text-[14px]"><a href="/asistencia" className="font-medium text-blue-text underline" data-testid="ia-open-assist">{t('Abrir Asistencia', 'Open Assistance')}</a></p>
      <p role="status" className="mb-6 rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-muted-2" data-testid="ia-adapter">
        <Badge tone={d.adapter.mode === 'off' ? 'neutral' : 'warn'}>{d.adapter.mode === 'off' ? t('IA apagada', 'AI off') : t('Simulada (solo pruebas)', 'Simulated (tests only)')}</Badge>{' '}
        {t(`Para encenderla hace falta el proveedor aprobado en la revisión de tecnología, la variable ${AI_ENV}, la lista de dominios de salida (${AI_EGRESS_ENV}, hoy ${d.adapter.egress.length === 0 ? 'vacía: no sale nada' : d.adapter.egress.join(', ')}) y que la función pase su evaluación.`,
          `Turning it on needs the provider approved in the technology review, the ${AI_ENV} variable, the outbound domain list (${AI_EGRESS_ENV}, today ${d.adapter.egress.length === 0 ? 'empty: nothing leaves' : d.adapter.egress.join(', ')}) and the feature passing its evaluation.`)}
      </p>
      <div className="mb-6"><Pills label={t('Secciones', 'Sections')} current={tab} items={TABS.map((k) => ({ key: k, href: qs('/admin/ia', { tab: k }), label: labels[k] }))} /></div>

      {tab === 'autonomia' && (
        <div className="space-y-8">
          <Card data-testid="ia-levels">
            <CardTitle title={t('Nivel por mercado', 'Level per market')} hint={t('Nunca se ejecuta nada sin aprobación de una persona. Para redactar o proponer tareas hace falta nombrar a quien revisa cada semana.', 'Nothing is ever executed without a person’s approval. To draft or propose tasks you must name who reviews each week.')} />
            <ul className="mb-5 grid grid-cols-1 gap-2 text-[13.5px] text-muted-2 md:grid-cols-2">
              {LEVELS.map((l) => <li key={l}><strong className="text-strong">{t(...LEVEL_LABEL[l].name)}:</strong> {t(...LEVEL_LABEL[l].what)}</li>)}
            </ul>
            <div className="space-y-5">
              {d.settings.map((s) => {
                const late = s.level !== 'off' && s.level !== 'suggest' && (!s.last_spot_check_at || now.getTime() - new Date(s.last_spot_check_at).getTime() > 7 * 86400000)
                const dr = d.drafts.find((x) => x.market_code === s.market_code)
                return (
                  <div key={s.market_code} className="rounded-[14px] border border-line px-4 py-4" data-testid={`ia-market-${s.market_code}`}>
                    <p className="text-[15px] font-semibold text-strong">{ctx.markets.find((m) => m.code === s.market_code)?.name ?? s.market_code} · <Badge tone={s.level === 'off' ? 'neutral' : 'good'}>{t(...LEVEL_LABEL[s.level].name)}</Badge></p>
                    <p className="mt-1 text-[13.5px] text-muted-2">
                      {t('Supervisa', 'Supervisor')}: {s.supervisor_name ?? t('sin nombrar', 'not named')} · {t('Última revisión', 'Last review')}: {when(s.last_spot_check_at)}
                      {dr ? ` · ${t(`Borradores: ${dr.pending} por aprobar, ${dr.approved} aprobados, ${dr.rejected} rechazados`, `Drafts: ${dr.pending} pending, ${dr.approved} approved, ${dr.rejected} rejected`)}` : ''}
                    </p>
                    {late && <p className="mt-2 rounded-[10px] bg-warn-bg px-3 py-2 text-[13px] font-medium text-amber-text" data-testid="ia-spot-late">{t('Lleva más de 7 días sin la revisión semanal.', 'More than 7 days without the weekly review.')}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {manage && (
                        <Dialog trigger={t('Cambiar', 'Change')} title={t('Nivel de asistencia', 'Assistance level')} size="sm" testId={`ia-level-${s.market_code}`}>
                          <ActionForm action={setIaSettingsAction} onOk="close" className="space-y-4">
                            <input type="hidden" name="market" value={s.market_code} />
                            <Field label={t('Nivel', 'Level')}>
                              <select name="level" className="input" defaultValue={s.level} data-testid="ia-level-select">{LEVELS.map((l) => <option key={l} value={l}>{t(...LEVEL_LABEL[l].name)}</option>)}</select>
                            </Field>
                            <Field label={t('Quién revisa cada semana', 'Who reviews each week')}>
                              <select name="supervisor" className="input" defaultValue={s.supervisor_id ?? ''} data-testid="ia-supervisor-select">
                                <option value="">{t('Nadie todavía', 'Nobody yet')}</option>
                                {d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                              </select>
                            </Field>
                            <Field label={t('Días sin contacto para sugerir', 'Days without contact to suggest')}><input type="number" name="quiet_days" min={3} max={90} defaultValue={s.quiet_days} className="input" data-testid="ia-quiet-days" /></Field>
                            <div className="flex justify-end"><Submit testId="ia-level-save">{t('Guardar', 'Save')}</Submit></div>
                          </ActionForm>
                        </Dialog>
                      )}
                      {(manage || s.supervisor_id === ctx.user.id) && s.level !== 'off' && (
                        <Dialog trigger={t('Registrar revisión', 'Log review')} title={t('Revisión de la semana', 'This week’s review')} size="sm" testId={`ia-spot-${s.market_code}`}>
                          <ActionForm action={recordSpotCheckAction} onOk="close" className="space-y-4">
                            <input type="hidden" name="market" value={s.market_code} />
                            <Field label={t('Qué revisaste y qué encontraste', 'What you reviewed and found')}><textarea name="note" rows={3} className="input !h-auto py-3" required minLength={5} maxLength={400} data-testid="ia-spot-note" /></Field>
                            <div className="flex justify-end"><Submit testId="ia-spot-save">{t('Guardar', 'Save')}</Submit></div>
                          </ActionForm>
                        </Dialog>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card data-testid="ia-agents">
            <CardTitle title={t('Agentes y lo que pueden hacer', 'Agents and what they can do')} hint={t('Ningún agente lee texto de fuera y además escribe o manda algo. Ninguno manda nada fuera de CONTIGO.', 'No agent reads outside text and also writes or sends something. None sends anything outside CONTIGO.')} />
            <ul className="space-y-2 text-[14px]">
              {d.agents.map((a) => (
                <li key={a.key}>
                  <strong className="text-strong">{t(...a.name)}</strong> · {a.usesModel ? t('usa modelo', 'uses a model') : t('reglas, sin modelo', 'rules, no model')} · {t('herramientas', 'tools')}: {a.tools.map((x) => (TOOLS[x].outbound ? x : `${x} (${t('dentro de CONTIGO', 'inside CONTIGO')})`)).join(', ')} · {t('costo por acción: USD 0', 'cost per action: USD 0')}
                </li>
              ))}
            </ul>
          </Card>

          <Card data-testid="ia-measure">
            <CardTitle title={t('¿Ayudan las sugerencias?', 'Do the suggestions help?')} hint={t(`Se mide a los 14 días. Solo se compara contra el grupo de control cuando los dos grupos tienen al menos ${LIFT_MIN} sugerencias medidas.`, `Measured after 14 days. It is compared against the control group only when both groups have at least ${LIFT_MIN} measured suggestions.`)} />
            {stats.length === 0 ? <Empty title={t('Todavía no hay sugerencias', 'No suggestions yet')} hint={t('La tarea programada las calcula cada 6 horas.', 'The scheduled job works them out every 6 hours.')} /> : (
              <Table label={t('Medición por mercado', 'Measurement per market')} testId="ia-stats" head={<tr><th>{t('Mercado', 'Market')}</th><th>{t('Mostradas', 'Shown')}</th><th>{t('Aceptadas', 'Accepted')}</th><th>{t('Descartadas', 'Dismissed')}</th><th>{t('Vencidas', 'Expired')}</th><th>{t('Se siguieron', 'Followed')}</th><th>{t('Venta arriba', 'Sales up')}</th><th>{t('Contra control', 'Against control')}</th></tr>}>
                {stats.map((s) => {
                  const enough = s.measured >= LIFT_MIN && s.holdout_measured >= LIFT_MIN
                  return (
                    <tr key={s.market_code}>
                      <td>{s.market_code}</td><td className="num">{num(s.shown, locale)}</td><td className="num">{num(s.accepted, locale)}</td><td className="num">{num(s.dismissed, locale)}</td><td className="num">{num(s.expired, locale)}</td>
                      <td className="num">{pct(s.followed, s.measured)}</td><td className="num">{pct(s.sale_up, s.measured)}</td>
                      <td data-testid="ia-lift">{enough ? t(`${pct(s.sale_up, s.measured)} contra ${pct(s.holdout_sale_up, s.holdout_measured)} sin sugerencias`, `${pct(s.sale_up, s.measured)} against ${pct(s.holdout_sale_up, s.holdout_measured)} without suggestions`) : t('Sin grupo de control suficiente: no se puede decir que ayudan', 'Not enough control group: it cannot be said they help')}</td>
                    </tr>
                  )
                })}
              </Table>
            )}
          </Card>

          <Card data-testid="ia-holdouts">
            <CardTitle title={t('Grupo de control por territorio', 'Control group by territory')} hint={t('En estos territorios las sugerencias se calculan y se miden, pero no se muestran. Así se sabe si ayudan.', 'In these territories suggestions are worked out and measured, but not shown. That is how you know whether they help.')} />
            {d.territories.length === 0 ? <Empty title={t('Sin territorios', 'No territories')} /> : (
              <ul className="space-y-2">
                {d.territories.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 text-[14px]" data-testid="ia-territory">
                    <span>{x.market_code} · {x.name} {x.holdout && <Badge tone="warn">{t('control', 'control')}</Badge>}</span>
                    {manage && (
                      <ActionForm action={setHoldoutAction}>
                        <input type="hidden" name="territory" value={x.id} />
                        <input type="hidden" name="on" value={x.holdout ? '0' : '1'} />
                        <Submit size="sm" variant="ghost" testId="ia-holdout-toggle">{x.holdout ? t('Quitar del control', 'Remove from control') : t('Usar como control', 'Use as control')}</Submit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'calificacion' && (
        <div className="space-y-8">
          {d.settings.map((s) => {
            const w = Object.fromEntries(d.weights.filter((x) => x.market_code === s.market_code).map((x) => [x.factor, x.weight]))
            return (
              <Card key={s.market_code} data-testid={`ia-weights-${s.market_code}`}>
                <CardTitle title={`${t('Pesos', 'Weights')} · ${ctx.markets.find((m) => m.code === s.market_code)?.name ?? s.market_code}`} hint={t('Cada lead suma estos puntos (de 0 a 100). Vacío usa el valor de fábrica. El cambio queda en la bitácora.', 'Each lead adds these points (0 to 100). Empty uses the default value. The change is logged.')} />
                <ActionForm action={setLeadWeightsAction} className="space-y-4">
                  <input type="hidden" name="market" value={s.market_code} />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                    {SCORE_FACTORS.map((f) => (
                      <Field key={f} label={t(...FACTOR_LABEL[f])} hint={t(`De fábrica: ${DEFAULT_WEIGHTS[f]}`, `Default: ${DEFAULT_WEIGHTS[f]}`)}>
                        <input name={`w_${f}`} type="number" min={-50} max={50} step={1} className="input" defaultValue={w[f] ?? ''} disabled={!manage} data-testid={`ia-w-${f}`} />
                      </Field>
                    ))}
                  </div>
                  {manage && <div className="flex justify-end"><Submit testId="ia-weights-save">{t('Guardar pesos', 'Save weights')}</Submit></div>}
                </ActionForm>
              </Card>
            )
          })}
          <Card>
            <CardTitle title={t('Clasificación de texto libre', 'Free-text classification')} />
            <p className="text-[14px] text-muted-2">{t('Clasificar un lead leyendo su mensaje necesitaría un modelo de IA: está apagado. Hoy se clasifica con el tipo de cuenta y el tipo de venta, y una persona la confirma en el lead.', 'Classifying a lead by reading its message would need an AI model: it is off. Today it is classified with the account type and the sale type, and a person confirms it on the lead.')}</p>
          </Card>
        </div>
      )}

      {tab === 'evaluacion' && (
        <div className="space-y-8">
          <Card data-testid="ia-evals">
            <CardTitle title={t('Evaluación por función', 'Evaluation per feature')} hint={t('Cada función tiene un banco de casos con su respuesta esperada, incluidos intentos de engaño. Una función solo puede usar IA si su última corrida contra el adaptador, con la versión vigente, pasa el umbral.', 'Each feature has a bank of cases with the expected answer, including manipulation attempts. A feature can use AI only if its latest run against the adapter, with the current version, meets the threshold.')} />
            <Table label={t('Funciones', 'Features')} testId="ia-eval-table" head={<tr><th>{t('Función', 'Feature')}</th><th>{t('Casos', 'Cases')}</th><th>{t('Umbral', 'Threshold')}</th><th>{t('Reglas', 'Rules')}</th><th>{t('Adaptador', 'Adapter')}</th><th>{t('¿Puede encenderse?', 'Can it be turned on?')}</th><th /></tr>}>
              {d.evals.map((e) => (
                <tr key={e.feature} data-testid={`ia-eval-${e.feature}`}>
                  <td>{t(...FEATURE_LABEL[e.feature])}<span className="block text-[12px] text-muted">{t('versión', 'version')} {e.prompt_version}</span></td>
                  <td className="num">{e.cases}{e.adversarial ? ` (${t(`${e.adversarial} de engaño`, `${e.adversarial} adversarial`)})` : ''}</td>
                  <td className="num">{Math.round(e.threshold * 100)}%</td>
                  <td data-testid="ia-eval-rules">{e.rules ? `${e.rules.passed}/${e.rules.total} · ${when(e.rules.ran_at)}` : t('sin correr', 'not run')}</td>
                  <td>{e.adapter ? (e.adapter.adapter_mode === 'off' ? t('apagado: no se corrió', 'off: not run') : `${e.adapter.passed}/${e.adapter.total}`) : t('sin correr', 'not run')}</td>
                  <td data-testid="ia-eval-gate">{e.mayTurnOn ? <Badge tone="good">{t('Sí', 'Yes')}</Badge> : <Badge tone="neutral">{t('No', 'No')}</Badge>}</td>
                  <td>{manage && (
                    <ActionForm action={runEvaluationAction}>
                      <input type="hidden" name="feature" value={e.feature} />
                      <Submit size="sm" variant="ghost" testId={`ia-eval-run-${e.feature}`}>{t('Correr', 'Run')}</Submit>
                    </ActionForm>
                  )}</td>
                </tr>
              ))}
            </Table>
            {d.evals.some((e) => e.rules && e.rules.failures.length > 0) && (
              <div className="mt-5" data-testid="ia-eval-failures">
                <p className="text-[14px] font-semibold text-strong">{t('Casos que fallaron en la última corrida de reglas', 'Cases that failed in the latest rules run')}</p>
                <ul className="mt-2 space-y-1 text-[13.5px]">
                  {d.evals.flatMap((e) => (e.rules?.failures ?? []).map((f) => <li key={`${e.feature}-${f.label}`}>{t(...FEATURE_LABEL[e.feature])}: {f.label} ({t('esperada', 'expected')} {f.expected}, {t('dio', 'got')} {f.got})</li>))}
                </ul>
              </div>
            )}
          </Card>
          {manage && (
            <Card data-testid="ia-case-new">
              <CardTitle title={t('Agregar un caso', 'Add a case')} hint={t('Para preguntas sobre cifras y captura. Usa textos inventados: nunca datos de personas ni de comercios reales.', 'For questions about figures and capture. Use made-up texts: never real people’s or merchants’ data.')} />
              <ActionForm action={addEvalCaseAction} onOk="reset" className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Field label={t('Función', 'Feature')}>
                    <select name="feature" className="input" defaultValue="metric_question" data-testid="ia-case-feature">
                      <option value="metric_question">{t(...FEATURE_LABEL.metric_question)}</option>
                      <option value="capture">{t(...FEATURE_LABEL.capture)}</option>
                    </select>
                  </Field>
                  <Field label={t('Nombre del caso', 'Case name')}><input name="label" className="input" required minLength={3} maxLength={120} data-testid="ia-case-label" /></Field>
                  <Field label={t('Respuesta esperada', 'Expected answer')}>
                    <select name="expected" className="input" data-testid="ia-case-expected">
                      {[...new Set([...EVAL_CHOICES.metric_question, ...EVAL_CHOICES.capture])].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label={t('Texto', 'Text')}><input name="question" className="input" required minLength={3} maxLength={300} data-testid="ia-case-question" /></Field>
                <label className="flex min-h-11 items-center gap-3 text-[14px]"><input type="checkbox" name="adversarial" value="1" />{t('Es un intento de engaño', 'It is a manipulation attempt')}</label>
                <div className="flex justify-end"><Submit testId="ia-case-save">{t('Agregar', 'Add')}</Submit></div>
              </ActionForm>
            </Card>
          )}
          <Card>
            <CardTitle title={t('Llamadas al adaptador, últimos 30 días', 'Adapter calls, last 30 days')} hint={t('Cada llamada queda con su función, versión, si llevaba texto de fuera, la herramienta, lo que cambió y su costo. Se guarda una huella, no el texto.', 'Each call is kept with its feature, version, whether it carried outside text, the tool, what changed and its cost. A fingerprint is kept, not the text.')} />
            {d.calls.length === 0 ? <Empty title={t('Sin llamadas', 'No calls')} /> : (
              <Table label={t('Llamadas', 'Calls')} testId="ia-calls" head={<tr><th>{t('Función', 'Feature')}</th><th>{t('Modo', 'Mode')}</th><th>{t('Resultado', 'Result')}</th><th>{t('Llamadas', 'Calls')}</th><th>USD</th></tr>}>
                {d.calls.map((c) => <tr key={`${c.feature}${c.mode}${c.outcome}`}><td>{c.feature}</td><td>{c.mode === 'off' ? t('apagado', 'off') : c.mode === 'rules' ? t('reglas', 'rules') : t('simulado', 'simulated')}</td><td>{c.outcome === 'not_sent' ? t('no salió', 'not sent') : c.outcome === 'refused' ? t('rechazada', 'refused') : t('contestada', 'answered')}</td><td className="num">{num(c.n, locale)}</td><td className="num">{c.cost}</td></tr>)}
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === 'mcp' && (
        <Card data-testid="ia-mcp">
          <CardTitle title={labels.mcp} hint={t(`Apagado: sin la variable ${MCP_ENV} no existe ninguna ruta. Solo lectura, como la persona que entra, máximo ${MCP_ROW_LIMIT} filas por herramienta y cada llamada en la bitácora. Detalle en docs/mcp.md.`, `Off: without the ${MCP_ENV} variable no route exists. Read-only, as the signed-in person, at most ${MCP_ROW_LIMIT} rows per tool and every call in the audit log. Details in docs/mcp.md.`)}
            right={<Badge tone={mcpMode() === 'off' ? 'neutral' : 'warn'}>{mcpMode() === 'off' ? t('Apagado', 'Off') : t('Simulado (solo pruebas)', 'Simulated (tests only)')}</Badge>} />
          <ul className="space-y-3 text-[14px]">
            {MCP_TOOLS.map((x) => <li key={x.name} data-testid="ia-mcp-tool"><code className="text-[13px]">{x.name}</code> · <span className="text-muted-2">{x.description}</span></li>)}
          </ul>
          <p className="mt-4 text-[13.5px] text-muted">{t('Falta para encenderlo: ingreso por persona (OAuth) para agentes y la revisión de tecnología. El servidor de escritura sería aparte y después.', 'Missing to turn it on: per-person sign-in (OAuth) for agents and the technology review. The write server would be separate and later.')}</p>
        </Card>
      )}
    </>
  )
}
