import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { flat } from '@/server/params'
import { askMetric, openRecommendations, pendingDrafts } from '@/dal/ia'
import { getReportOptions } from '@/dal/reports'
import { METRICS } from '@/lib/metric-defs'
import { ASKABLE, ASK_PERIODS, QUESTION, PERIODIC } from '@/domain/ia/rules'
import { PERIOD_LABEL } from '@/lib/periods'
import { qs } from '@/lib/labels'
import { day, dayTime, num } from '@/lib/format'
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Pills, buttonClass } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { readerTimeZone } from '@/server/timezone'
import { RecItem } from './panels'
import { decideDraftAction } from './actions'

export const dynamic = 'force-dynamic'

const TABS = ['sugerencias', 'borradores', 'preguntas'] as const
type Tab = (typeof TABS)[number]

/**
 * Asistencia (dominio IA del catálogo): las sugerencias de siguiente acción con su porqué, los borradores que esperan aprobación
 * y las preguntas sobre las cifras definidas. Todo funciona con reglas; ningún modelo de IA está conectado.
 */
export default async function AssistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx()
  if (!ctx.can('ia.read') && !ctx.can('ia.ask')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const allowed = TABS.filter((k) => (k === 'preguntas' ? ctx.can('ia.ask') : ctx.can('ia.read')))
  const tab: Tab = allowed.includes(sp.tab as Tab) ? (sp.tab as Tab) : allowed[0]!
  const manager = ctx.can('board.supervisor') || ctx.isGlobal
  const scope: 'mine' | 'all' = manager && sp.de !== 'mias' ? 'all' : 'mine'
  const labels: Record<Tab, string> = { sugerencias: t('Sugerencias', 'Suggestions'), borradores: t('Borradores para aprobar', 'Drafts to approve'), preguntas: t('Preguntas sobre las cifras', 'Questions about figures') }
  const tz = await readerTimeZone(ctx)

  return (
    <>
      <PageHeader
        title={t('Asistencia', 'Assistance')}
        desc={t('Sugerencias con su porqué, borradores que tú apruebas y respuestas con las cifras definidas. Hoy todo sale de reglas de CONTIGO; la IA está apagada.', 'Suggestions with their reason, drafts you approve and answers with the defined figures. Today everything comes from CONTIGO rules; AI is off.')}
      />
      <Pills label={t('Secciones', 'Sections')} current={tab} items={allowed.map((k) => ({ key: k, href: qs('/asistencia', { tab: k }), label: labels[k] }))} />

      {tab === 'sugerencias' && <Suggestions />}
      {tab === 'borradores' && <Drafts />}
      {tab === 'preguntas' && <Questions />}
    </>
  )

  async function Suggestions() {
    const recs = await openRecommendations(ctx, { scope })
    return (
      <Card data-testid="rec-list">
        <CardTitle
          title={scope === 'mine' ? t('Para ti', 'For you') : t('De tu alcance', 'In your scope')}
          hint={t('Hasta 3 por comercio. Cada una vence a los 7 días. Lo que aceptas o descartas se mide para saber si ayudan.', 'Up to 3 per merchant. Each expires after 7 days. What you accept or dismiss is measured to know whether they help.')}
          right={manager ? <a className={buttonClass('ghost', 'sm')} href={qs('/asistencia', { tab: 'sugerencias', de: scope === 'mine' ? 'equipo' : 'mias' })} data-testid="rec-scope">{scope === 'mine' ? t('Ver las de mi alcance', 'See my scope') : t('Ver solo las mías', 'See only mine')}</a> : undefined}
        />
        {recs.length === 0 ? (
          <Empty title={t('Sin sugerencias por ahora', 'No suggestions right now')} hint={t('Aparecen cuando un comercio lleva días sin contacto, no ha hecho su primera venta, su venta baja o tiene una revisita pendiente.', 'They appear when a merchant has gone days without contact, has not made its first sale, its sales drop or a revisit is pending.')} />
        ) : (
          <ul className="space-y-3">{recs.map((r) => <RecItem key={r.id} ctx={ctx} r={r} showAccount canAct={ctx.can('ia.act', r.market_code)} />)}</ul>
        )}
      </Card>
    )
  }

  async function Drafts() {
    const drafts = await pendingDrafts(ctx, { scope })
    return (
      <Card data-testid="draft-list">
        <CardTitle title={labels.borradores} hint={t('Los deja la regla de siguiente acción cuando el mercado tiene ese nivel. Nada se crea sin que alguien lo apruebe.', 'The next-action rule leaves them when the market has that level. Nothing is created until someone approves it.')} />
        {drafts.length === 0 ? (
          <Empty title={t('No hay borradores', 'No drafts')} hint={t('Administración decide por mercado si la asistencia solo sugiere o también redacta tareas.', 'Administration decides per market whether assistance only suggests or also drafts tasks.')} />
        ) : (
          <ul className="space-y-3">
            {drafts.map((d) => (
              <li key={d.id} className="rounded-[14px] border border-line px-4 py-3.5" data-testid="draft-item">
                <p className="text-[15px] font-semibold text-strong">{d.subject} · <a href={`/comercios/${d.account_id}`} className="text-blue-text underline">{d.account_name}</a></p>
                {d.reason && <p className="mt-1 text-[14px] text-muted-2">{t(...d.reason)}</p>}
                <p className="mt-1 text-[12.5px] text-muted">
                  {d.level === 'execute' ? t('Viene completo: se crea como está al aprobarlo.', 'It comes complete: it is created as is when approved.') : t('Borrador: revisa el texto y pon la fecha.', 'Draft: check the text and set the date.')}
                  {d.owner_name ? ` ${t('Para', 'For')} ${d.owner_name}.` : ''}
                </p>
                {ctx.can('ia.act', d.market_code) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Dialog trigger={t('Revisar y aprobar', 'Review and approve')} title={t('Aprobar la tarea', 'Approve the task')} variant="primary" size="sm" testId="draft-approve">
                      <ActionForm action={decideDraftAction} onOk="close" className="space-y-4">
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="decision" value="approve" />
                        <Field label={t('Tarea', 'Task')}><input name="subject" className="input" defaultValue={d.subject} required minLength={2} maxLength={200} data-testid="draft-subject" /></Field>
                        <Field label={t('Fecha', 'Date')}><input type="date" name="due_on" className="input" required defaultValue={d.due_on ?? ''} data-testid="draft-due" /></Field>
                        <div className="flex justify-end"><Submit testId="draft-approve-save">{t('Aprobar', 'Approve')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                    <Dialog trigger={t('Rechazar', 'Reject')} title={t('¿Por qué lo rechazas?', 'Why are you rejecting it?')} size="sm" testId="draft-reject">
                      <ActionForm action={decideDraftAction} onOk="close" className="space-y-4">
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="decision" value="reject" />
                        <Field label={t('Motivo', 'Reason')}><input name="note" className="input" required minLength={3} maxLength={300} data-testid="draft-note" /></Field>
                        <div className="flex justify-end"><Submit variant="danger" testId="draft-reject-save">{t('Rechazar', 'Reject')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    )
  }

  async function Questions() {
    const opts = await getReportOptions(ctx)
    const text = (sp.q ?? '').slice(0, 300)
    const asked = text.trim() !== '' || (sp.cifra ?? '') !== ''
    const answer = asked ? await askMetric(ctx, { text, key: sp.cifra, period: sp.periodo, market: sp.mercado, team: sp.equipo }) : null
    const marketName = (c: string | null) => (c ? ctx.markets.find((m) => m.code === c)?.name ?? c : t('todos tus mercados', 'all your markets'))
    return (
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <Card className="xl:col-span-2" data-testid="ask">
          <CardTitle title={labels.preguntas} hint={t('Escribe la pregunta o elige una de la lista. Solo se contesta con cifras definidas, con tus permisos, y cada número trae su definición.', 'Type the question or choose one from the list. Only defined figures are answered, with your permissions, and each number comes with its definition.')} />
          <form method="get" action="/asistencia" className="space-y-4" data-testid="ask-form">
            <input type="hidden" name="tab" value="preguntas" />
            <Field label={t('Tu pregunta', 'Your question')}><input name="q" className="input" defaultValue={text} maxLength={300} placeholder={t('Por ejemplo: ¿cuántos negocios se ganaron este mes?', 'For example: how many deals were won this month?')} data-testid="ask-q" /></Field>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Field label={t('Cifra', 'Figure')}>
                <select name="cifra" className="input" defaultValue={sp.cifra ?? ''} data-testid="ask-key">
                  <option value="">{t('La que diga la pregunta', 'The one in the question')}</option>
                  {ASKABLE.map((k) => <option key={k} value={k}>{t(...QUESTION[k])}</option>)}
                </select>
              </Field>
              <Field label={t('Periodo', 'Period')}>
                <select name="periodo" className="input" defaultValue={sp.periodo ?? ''} data-testid="ask-period">
                  <option value="">{t('El que diga la pregunta (o este mes)', 'The one in the question (or this month)')}</option>
                  {ASK_PERIODS.map((p) => <option key={p} value={p}>{t(...PERIOD_LABEL[p])}</option>)}
                </select>
              </Field>
              <Field label={t('Mercado', 'Market')}>
                <select name="mercado" className="input" defaultValue={sp.mercado ?? ''} data-testid="ask-market">
                  <option value="">{t('Todos los míos', 'All mine')}</option>
                  {opts.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
                </select>
              </Field>
              <Field label={t('Equipo', 'Team')}>
                <select name="equipo" className="input" defaultValue={sp.equipo ?? ''} data-testid="ask-team">
                  <option value="">{t('Todos', 'All')}</option>
                  {opts.teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex justify-end"><button type="submit" className={buttonClass('primary')} data-testid="ask-go">{t('Preguntar', 'Ask')}</button></div>
          </form>
          {answer?.kind === 'out_of_scope' && (
            <p role="status" className="mt-6 rounded-[14px] bg-warn-bg px-5 py-4 text-[14px] font-medium text-amber-text" data-testid="ask-out">
              {t('Esa pregunta no está entre las cifras definidas, así que no la contesto: no se adivinan números. Elige una de la lista o pide la cifra a Data y Reportería.', 'That question is not among the defined figures, so it is not answered: numbers are not guessed. Choose one from the list or ask Data and Reporting for the figure.')}
            </p>
          )}
          {answer?.kind === 'answer' && (() => {
            const def = METRICS[answer.key]
            return (
              <div className="mt-6 rounded-[18px] bg-green-50 px-5 py-5" data-testid="ask-answer">
                <p className="text-[14px] text-muted-2">{t(...QUESTION[answer.key])}</p>
                <p className="num mt-1 text-[36px] font-semibold text-strong" data-testid="ask-value">{num(answer.value, locale)}</p>
                <p className="text-[14px] text-strong">
                  {t(...def.label)} · {marketName(answer.market)}
                  {answer.period ? ` · ${t(...PERIOD_LABEL[answer.period.key])} (${day(answer.period.from, locale)} ${t('al', 'to')} ${day(answer.period.to, locale)})` : ''}
                </p>
                <p className="mt-3 text-[14px] text-muted-2" data-testid="ask-def"><strong className="text-strong">{t('Cómo se calcula', 'How it is calculated')}:</strong> {t(...def.what)}</p>
                <p className="mt-2 text-[13px] text-muted" data-testid="ask-cut">
                  {t('Corte', 'As of')}: {answer.fileAsOf ? t(`archivo de ventas del ${day(answer.fileAsOf, locale)}`, `sales file of ${day(answer.fileAsOf, locale)}`) : dayTime(answer.asOf, locale, tz)}
                  {!PERIODIC.includes(answer.key) ? ` · ${t('foto de este momento', 'snapshot of right now')}` : ''}
                </p>
              </div>
            )
          })()}
        </Card>
        <Card>
          <CardTitle title={t('Lo que se puede preguntar', 'What you can ask')} />
          <ul className="space-y-2 text-[14px]">
            {ASKABLE.map((k) => <li key={k}><a className="text-blue-text underline" href={qs('/asistencia', { tab: 'preguntas', cifra: k })} data-testid={`ask-${k}`}>{t(...QUESTION[k])}</a></li>)}
          </ul>
          <p className="mt-4 text-[13px] text-muted"><Badge tone="neutral">{t('IA apagada', 'AI off')}</Badge> {t('Entender preguntas libres necesitaría un modelo de IA aprobado y evaluado. Mientras tanto, se busca la pregunta entre las definidas.', 'Understanding free-form questions would need an approved and evaluated AI model. Meanwhile, the question is matched against the defined ones.')}</p>
        </Card>
      </div>
    )
  }
}
