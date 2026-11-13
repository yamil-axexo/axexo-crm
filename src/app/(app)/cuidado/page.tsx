import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getCareBoard } from '@/dal/care'
import { track } from '@/dal/boards'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, Table, cx } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { ago, num, pct } from '@/lib/format'
import { lab, qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { ALERT, EXPANSION_STATUS, FEEDBACK_KIND, FEEDBACK_STATUS, HANDOFF_ROLE, HEALTH_BAND, HEALTH_GROUP, MESSAGE_STATUS, STAGE, STAGES, TIER, TIERS, type AlertKind, type HandoffRole, type HealthGroup, type Stage, type Tier } from '@/lib/care'
import { feedbackStatusAction } from './actions'

const VIEWS = ['entregas', 'alertas', 'salud', 'expansion', 'comentarios'] as const
type View = (typeof VIEWS)[number]

/**
 * Cuidado de comercios: la mesa de trabajo de lo que pasa después de la venta en un mercado. Entregas esperando acuse,
 * alertas abiertas con su dueño, salud, oportunidades de expansión y comentarios de producto. Cada quien ve lo de los
 * comercios que ya ve.
 */
export default async function CareBoardPage({ searchParams }: { searchParams: Promise<{ mercado?: string; vista?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  if (ctx.markets.length === 0) notFound()
  const sp = flat(await searchParams)
  const market = ctx.markets.find((m) => m.code === sp.mercado) ?? ctx.markets.find((m) => m.status === 'live') ?? ctx.markets[0]!
  const view: View = (VIEWS as readonly string[]).includes(sp.vista ?? '') ? (sp.vista as View) : 'entregas'
  const b = await getCareBoard(ctx, market.code)
  await track(ctx, 'view.care')
  const canManage = ctx.can('care.manage', market.code)
  const showScore = b.settings.health_published || canManage || ctx.isGlobal
  const href = (v: View) => qs('/cuidado', { mercado: ctx.markets.length > 1 ? market.code : undefined, vista: v === 'entregas' ? undefined : v })
  const acc = (id: string, name: string) => <Link href={`/comercios/${id}/cuidado`} className="font-medium text-blue-text underline [overflow-wrap:anywhere]" data-testid="care-link">{name}</Link>
  const stageCount = (s: Stage) => b.stages.find((x) => x.stage === s)?.n ?? 0
  const topic = (code: string) => { const tp = b.topics.find((x) => x.code === code); return tp ? t(tp.label_es, tp.label_en) : code }
  const withGuide = (kind: string, holdout: boolean) => b.measure.find((m) => m.kind === kind && m.in_holdout === holdout)

  return (
    <>
      <PageHeader
        title={t('Cuidado de comercios', 'Merchant care')}
        desc={t('Lo que pasa después de la venta: quién recibe cada comercio, qué alertas hay que atender, cómo está su salud y qué más se le puede ofrecer.', 'What happens after the sale: who receives each merchant, which alerts need attention, how healthy it is and what else can be offered.')}
        actions={canManage ? <Link href={qs('/admin/cuidado', { mercado: market.code })} className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="care-admin-link">{t('Configurar', 'Settings')}</Link> : undefined}
      />
      {ctx.markets.length > 1 && <div className="mb-4"><Pills label={t('Mercado', 'Market')} current={market.code} items={ctx.markets.map((m) => ({ key: m.code, href: qs('/cuidado', { mercado: m.code, vista: view === 'entregas' ? undefined : view }), label: m.name }))} /></div>}

      <section className="mb-6 card p-5" aria-label={t('Comercios por etapa de vida', 'Merchants by lifecycle stage')} data-testid="care-stages">
        <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {STAGES.map((s) => (
            <li key={s} className="min-w-0" data-testid={`stage-count-${s}`}>
              <p className="text-[12.5px] font-medium text-muted-2">{lab(t, STAGE[s].label)}</p>
              <p className="num text-[22px] leading-7 font-semibold text-strong">{num(stageCount(s), locale)}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mb-6">
        <Pills label={t('Vista', 'View')} current={view} items={[
          { key: 'entregas', href: href('entregas'), label: t('Entregas', 'Handoffs'), count: b.handoffs.length },
          { key: 'alertas', href: href('alertas'), label: t('Alertas', 'Alerts'), count: b.alerts.length },
          { key: 'salud', href: href('salud'), label: t('Salud', 'Health') },
          { key: 'expansion', href: href('expansion'), label: t('Expansión', 'Expansion'), count: b.opportunities.filter((o) => o.status === 'open' || o.status === 'working').length },
          { key: 'comentarios', href: href('comentarios'), label: t('Comentarios de producto', 'Product feedback'), count: b.feedback.filter((f) => f.status === 'new').length },
        ]} />
      </div>

      {view === 'entregas' && (
        <Card data-testid="board-handoffs">
          <CardTitle title={t('Entregas esperando acuse', 'Handoffs waiting for acknowledgment')} hint={t('Una entrega no está hecha hasta que quien recibe da el acuse. Las vencidas van primero.', 'A handoff is not done until the receiver acknowledges it. Overdue ones come first.')} />
          {b.handoffs.length === 0 ? (
            <Empty title={t('Nada esperando acuse', 'Nothing waiting for acknowledgment')} hint={t('Las entregas se crean en la pantalla de cuidado de cada comercio, o solas cuando un negocio se gana con su primera venta.', 'Handoffs are created on each merchant’s care page, or on their own when a deal is won by its first sale.')} />
          ) : (
            <ul>
              {b.handoffs.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid="board-handoff">
                  <span className="min-w-0 text-[14.5px]">{acc(h.account_id, h.account)} <span className="text-muted">· {lab(t, HANDOFF_ROLE[h.from_role as HandoffRole])} → {lab(t, HANDOFF_ROLE[h.to_role as HandoffRole])} · {t(`recibe ${h.to_name}`, `receiver: ${h.to_name}`)} · {t(`${h.done} de ${h.total} puntos listos`, `${h.done} of ${h.total} items done`)}</span></span>
                  <Badge tone={h.late ? 'bad' : 'neutral'}>{h.late ? t(`Venció el ${h.due_on}`, `Was due ${h.due_on}`) : t(`Para el ${h.due_on}`, `Due ${h.due_on}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {view === 'alertas' && (
        <>
          <Card data-testid="board-alerts">
            <CardTitle title={t('Alertas abiertas', 'Open alerts')} hint={t('Cada una tiene a quién le toca y su tarea con la guía de acción, salvo las del grupo de control.', 'Each one has an owner and a task with its playbook, except the control group.')}
 />
            <p className="-mt-3 mb-4"><Badge tone={b.settings.alerts_on ? 'good' : 'neutral'}>{b.settings.alerts_on ? t('Alertas encendidas', 'Alerts on') : t('Alertas apagadas', 'Alerts off')}</Badge></p>
            {!b.settings.alerts_on && <p className="mb-4 rounded-[10px] bg-surface-2 px-4 py-3 text-[13.5px] text-strong" data-testid="board-alerts-off">{t('En este mercado las alertas todavía no crean tareas. Las enciende quien lidera el mercado, en Administración, Cuidado de comercios.', 'Alerts do not create tasks in this market yet. The market lead turns them on under Administration, Merchant care.')}</p>}
            {b.alerts.length === 0 ? (
              <Empty title={t('Sin alertas abiertas', 'No open alerts')} hint={t('Aquí aparecen los comercios en alta sin primera venta, los que venden menos que antes, los de saldo bajo, los que dejaron de vender y los que cambiaron de encargado.', 'Merchants onboarded with no first sale, selling less than before, low on balance, no longer selling or with a new manager show up here.')} />
            ) : (
              <ul>
                {b.alerts.map((al) => (
                  <li key={al.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid="board-alert" data-kind={al.kind}>
                    <span className="min-w-0 text-[14.5px]">{acc(al.account_id, al.account)} <span className="text-muted">· {lab(t, ALERT[al.kind as AlertKind]?.label, al.kind)} · {ago(al.opened_at, locale)}{al.tier ? ` · ${lab(t, TIER[al.tier as Tier]?.label)}` : ''}{al.message_status ? ` · ${lab(t, MESSAGE_STATUS[al.message_status], al.message_status)}` : ''}</span></span>
                    <span className="text-[13.5px] text-strong">{al.in_holdout ? t('Grupo de control', 'Control group') : al.digital_only ? t('Por mensaje primero', 'By message first') : al.owner_name ?? t('Sin asignar', 'Unassigned')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="mt-6" data-testid="board-measure">
            <CardTitle title={t('¿Sirve la guía de acción?', 'Does the playbook work?')} hint={t(`De cada 100 comercios con alerta, ${b.settings.holdout_pct} quedan sin tarea como grupo de control. Aquí se compara qué parte volvió a vender a 14 y 30 días, con guía y sin guía.`, `Out of every 100 merchants with an alert, ${b.settings.holdout_pct} get no task, as a control group. This compares how many sold again at 14 and 30 days, with and without the playbook.`)} />
            {b.measure.every((m) => m.n14 === 0) ? (
              <Empty title={t('Todavía no hay medición', 'No measurement yet')} hint={t('La primera aparece cuando una alerta cumpla 14 días.', 'The first one shows up when an alert turns 14 days old.')} />
            ) : (
              <Table label={t('Regreso a vender por tipo de alerta', 'Return to selling by alert type')} testId="measure-table" head={<><th>{t('Alerta', 'Alert')}</th><th>{t('Con guía, 14 días', 'With playbook, 14 days')}</th><th>{t('Sin guía, 14 días', 'No playbook, 14 days')}</th><th>{t('Con guía, 30 días', 'With playbook, 30 days')}</th><th>{t('Sin guía, 30 días', 'No playbook, 30 days')}</th></>}>
                {[...new Set(b.measure.map((m) => m.kind))].map((k) => {
                  const g = withGuide(k, false), h = withGuide(k, true)
                  const cell = (back: number | undefined, n: number | undefined) => (n ? `${pct(back ?? 0, n, locale)} (${back ?? 0} ${t('de', 'of')} ${n})` : t('s/d', 'n/a'))
                  return <tr key={k} className="table-row"><td>{lab(t, ALERT[k as AlertKind]?.label, k)}</td><td className="num">{cell(g?.back14, g?.n14)}</td><td className="num">{cell(h?.back14, h?.n14)}</td><td className="num">{cell(g?.back30, g?.n30)}</td><td className="num">{cell(h?.back30, h?.n30)}</td></tr>
                })}
              </Table>
            )}
            {b.messages.length > 0 && <p className="mt-4 text-[13.5px] text-muted" data-testid="board-messages">{t('Mensajes a comercios:', 'Messages to merchants:')} {b.messages.map((m) => `${lab(t, MESSAGE_STATUS[m.status], m.status)}: ${m.n}`).join(' · ')}</p>}
          </Card>
        </>
      )}

      {view === 'salud' && (
        <>
          <Card data-testid="board-tiers">
            <CardTitle title={t('Modelo de atención', 'Service model')} hint={t('Se calcula solo con la comisión que genera cada comercio (o su volumen, si no hay ese dato) y el tipo de cuenta. No brinca de nivel por una semana distinta.', 'It is derived from the commission each merchant generates (or its volume, when that is missing) and the account type. One odd week does not change the level.')} />
            <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {TIERS.map((tr) => <li key={tr} data-testid={`tier-count-${tr}`}><p className="text-[12.5px] font-medium text-muted-2">{lab(t, TIER[tr].label)}</p><p className="num text-[22px] leading-7 font-semibold text-strong">{num(b.tiers.find((x) => x.tier === tr)?.n ?? 0, locale)}</p></li>)}
            </ul>
            <p className="mt-3 text-[13px] text-muted">{t(`Sin modelo todavía: ${num(b.tiers.find((x) => x.tier === null)?.n ?? 0, locale)} (comercios sin ventas en el archivo).`, `No model yet: ${num(b.tiers.find((x) => x.tier === null)?.n ?? 0, locale)} (merchants with no sales in the file).`)}</p>
          </Card>
          <Card className="mt-6" data-testid="board-health">
            <CardTitle title={t('Salud: los que más atención piden', 'Health: the ones that need the most attention')} hint={t('Ordenados del puntaje más bajo al más alto. En cada comercio se ve qué grupo de señales le resta.', 'Sorted from the lowest score to the highest. On each merchant you can see which signal group costs it.')}
              right={<Badge tone={b.settings.health_published ? 'good' : 'warn'}>{b.settings.health_published ? t('Publicado', 'Published') : t('En validación', 'Being validated')}</Badge>} />
            {!showScore ? (
              <p className="text-[14px] text-strong" data-testid="board-health-pending">{t('El puntaje de este mercado está en validación: se publica cuando se compruebe contra lo que pasó con los comercios.', 'This market’s score is being validated: it is published once it is checked against what happened to the merchants.')}</p>
            ) : b.health.length === 0 ? (
              <Empty title={t('Todavía no hay puntajes', 'No scores yet')} hint={t('Se calculan cada día para los comercios que ya venden. Quien lidera el mercado puede calcularlos ahora en Administración, Cuidado de comercios.', 'They are calculated daily for merchants that already sell. The market lead can calculate them now under Administration, Merchant care.')} />
            ) : (
              <Table label={t('Puntaje de salud por comercio', 'Health score by merchant')} testId="health-table" head={<><th>{t('Comercio', 'Merchant')}</th><th>{t('Puntaje', 'Score')}</th><th>{t('Estado', 'Status')}</th><th>{t('Lo que más le resta', 'What costs it the most')}</th><th>{t('Etapa', 'Stage')}</th></>}>
                {b.health.map((h) => (
                  <tr key={h.account_id} className="table-row" data-testid="health-row">
                    <td>{acc(h.account_id, h.account)}</td>
                    <td className="num font-semibold">{h.score}</td>
                    <td><Badge tone={HEALTH_BAND[h.band]?.tone ?? 'neutral'}>{lab(t, HEALTH_BAND[h.band]?.label)}</Badge></td>
                    <td>{h.lowest ? lab(t, HEALTH_GROUP[h.lowest as HealthGroup]?.label, h.lowest) : t('s/d', 'n/a')}</td>
                    <td>{lab(t, STAGE[h.stage as Stage]?.label, h.stage)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}

      {view === 'expansion' && (
        <Card data-testid="board-expansion">
          <CardTitle title={t('Oportunidades de expansión', 'Expansion opportunities')} hint={t('Comercios activos que ya pueden aprovechar un producto más, por lo que de verdad venden. Tómala desde el comercio.', 'Active merchants that can already use one more product, based on what they really sell. Take it from the merchant.')} />
          {b.opportunities.length === 0 ? (
            <Empty title={t('Sin oportunidades por ahora', 'No opportunities for now')} hint={t('Aparecen cuando un comercio activo cumple una regla de expansión del mercado. Las reglas se definen en Administración, Cuidado de comercios.', 'They show up when an active merchant meets one of the market’s expansion rules. Rules are set under Administration, Merchant care.')} />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {(['open', 'working', 'closed'] as const).map((col) => {
                const rows = b.opportunities.filter((o) => (col === 'closed' ? !['open', 'working'].includes(o.status) : o.status === col))
                return (
                  <section key={col} data-testid={`expansion-col-${col}`}>
                    <h3 className="mb-2 border-b border-line pb-2 text-[13px] font-semibold tracking-wide text-muted-2 uppercase">{col === 'closed' ? t('Cerradas en 30 días', 'Closed in 30 days') : lab(t, EXPANSION_STATUS[col]!.label)} · {rows.length}</h3>
                    {rows.length === 0 ? <p className="text-[13.5px] text-muted">{t('Nada aquí.', 'Nothing here.')}</p> : (
                      <ul>
                        {rows.map((o) => (
                          <li key={o.id} className="border-t border-line py-2.5 text-[14px] first:border-t-0" data-testid="board-opportunity">
                            {acc(o.account_id, o.account)}
                            <p className="text-[13.5px] text-muted">{o.product_label}{o.owner_name ? ` · ${o.owner_name}` : ''}{col === 'closed' ? ` · ${lab(t, EXPANSION_STATUS[o.status]?.label, o.status)}` : ''}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {view === 'comentarios' && (
        <>
          <Card data-testid="board-topics">
            <CardTitle title={t('Resumen para Producto y Tecnología', 'Summary for Product and Technology')} hint={t('Comentarios de los últimos 90 días en este mercado, por tema. Los temas son fijos para que los conteos se puedan comparar mes a mes.', 'Feedback from the last 90 days in this market, by topic. Topics are fixed so the counts can be compared month over month.')} />
            {b.byTopic.length === 0 ? (
              <Empty title={t('Sin comentarios todavía', 'No feedback yet')} hint={t('Se registran desde la pantalla de cuidado de cada comercio, con tema.', 'They are logged from each merchant’s care page, with a topic.')} />
            ) : (
              <Table label={t('Comentarios por tema', 'Feedback by topic')} testId="topic-table" head={<><th>{t('Tema', 'Topic')}</th><th>{t('Comentarios', 'Feedback')}</th><th>{t('Le estorba', 'Gets in the way')}</th><th>{t('Lo pide', 'Asked for')}</th></>}>
                {b.byTopic.map((r) => <tr key={r.topic} className="table-row" data-testid="topic-row"><td>{topic(r.topic)}</td><td className="num font-semibold">{r.n}</td><td className="num">{r.friction}</td><td className="num">{r.request}</td></tr>)}
              </Table>
            )}
            {b.digests.length > 0 && (
              <section className="mt-5 border-t border-line pt-4" data-testid="digests">
                <h3 className="mb-2 text-[14px] font-semibold text-strong">{t('Resúmenes semanales (todos los mercados)', 'Weekly summaries (all markets)')}</h3>
                <ul>{b.digests.map((dg) => <li key={dg.id} className="border-t border-line py-2 text-[13.5px] first:border-t-0"><span className="font-medium text-strong">{dg.period_start} {t('al', 'to')} {dg.period_end}</span> <span className="text-muted">· {t(`${dg.total} comentarios`, `${dg.total} items`)}{dg.counts.slice(0, 4).map((c) => ` · ${c.market} ${topic(c.topic)}: ${c.count}`).join('')}</span></li>)}</ul>
              </section>
            )}
          </Card>
          <Card className="mt-6" data-testid="board-feedback">
            <CardTitle title={t('Comentarios', 'Feedback')} hint={t('Los nuevos van primero. Quien lidera el mercado responde: visto, en plan, resuelto o no se hará.', 'New ones come first. The market lead answers: seen, planned, done or will not be done.')} />
            {b.feedback.length === 0 ? <p className="text-[13.5px] text-muted">{t('Nada todavía.', 'Nothing yet.')}</p> : (
              <ul>
                {b.feedback.map((f) => (
                  <li key={f.id} className="border-t border-line py-3.5 first:border-t-0" data-testid="board-feedback-item">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="min-w-0 text-[14.5px]"><span className="font-medium text-strong">{topic(f.topic)}</span> <span className="text-muted">· {lab(t, FEEDBACK_KIND[f.kind])} · </span>{acc(f.account_id, f.account)}</p>
                      <Badge tone={FEEDBACK_STATUS[f.status]?.tone ?? 'neutral'}>{lab(t, FEEDBACK_STATUS[f.status]?.label, f.status)}</Badge>
                    </div>
                    {f.note && <p className="text-[14px] text-strong">{f.note}</p>}
                    <p className="text-[13px] text-muted">{f.by ?? t('s/d', 'n/a')} · {ago(f.created_at, locale)}</p>
                    {f.response && <p className="mt-1 rounded-[10px] bg-surface-2 px-3 py-2 text-[13.5px] text-strong">{f.response}</p>}
                    {ctx.can('feedback.manage', market.code) && (
                      <ActionForm action={feedbackStatusAction} className={cx('mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end')}>
                        <input type="hidden" name="id" value={f.id} />
                        <Field label={t('Respuesta', 'Answer')}><select name="status" className="input" defaultValue={f.status === 'new' ? 'seen' : f.status} data-testid="feedback-status">{(['seen', 'planned', 'done', 'declined'] as const).map((s) => <option key={s} value={s}>{lab(t, FEEDBACK_STATUS[s]!.label)}</option>)}</select></Field>
                        <Field label={t('Una línea para quien lo reportó', 'One line for whoever reported it')}><input name="response" maxLength={500} className="input" defaultValue={f.response ?? ''} data-testid="feedback-response" /></Field>
                        <Submit variant="ghost" size="sm" testId="feedback-answer">{t('Guardar', 'Save')}</Submit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  )
}
