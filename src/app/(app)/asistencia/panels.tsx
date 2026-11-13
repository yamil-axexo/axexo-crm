import type { Ctx } from '@/server/context'
import { accountBrief, leadScore, openRecommendations, type Rec } from '@/dal/ia'
import { DISMISS_CODES, DISMISS_LABEL, FACTOR_LABEL, LEAD_CLASSES, LEAD_CLASS_LABEL, NEXT_TITLE } from '@/domain/ia/rules'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { isoDay, num } from '@/lib/format'
import { acceptRecommendationAction, confirmLeadClassAction, dismissRecommendationAction } from './actions'

/** Una sugerencia con su porqué, aceptable (con fecha) o descartable (con motivo). La usan Asistencia y la ficha del comercio. */
export function RecItem({ ctx, r, showAccount, canAct }: { ctx: Ctx; r: Rec; showAccount: boolean; canAct: boolean }) {
  const { t } = ctx
  const tomorrow = isoDay(new Date(Date.now() + 86400000), ctx.market(r.market_code).timezone)
  return (
    <li className="rounded-[14px] border border-line px-4 py-3.5" data-testid="rec-item">
      <p className="text-[15px] font-semibold text-strong">{t(...NEXT_TITLE[r.rule_code])}{showAccount && <> · <a href={`/comercios/${r.account_id}`} className="text-blue-text underline">{r.account_name}</a></>}</p>
      <p className="mt-1 text-[14px] text-muted-2" data-testid="rec-reason">{t(...r.reason)}</p>
      <p className="mt-1 text-[12.5px] text-muted">{t('Sugerido por una regla de CONTIGO, no por IA.', 'Suggested by a CONTIGO rule, not by AI.')}{showAccount && r.owner_name ? ` ${t('Lleva la cuenta', 'Account owner')}: ${r.owner_name}.` : ''}</p>
      {canAct && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Dialog trigger={t('Hacerlo', 'Do it')} title={t('¿Cuándo lo vas a hacer?', 'When will you do it?')} variant="primary" size="sm" testId="rec-accept">
            <ActionForm action={acceptRecommendationAction} onOk="close" className="space-y-4">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="account_id" value={r.account_id} />
              <p className="text-[14px] text-muted-2">{t('Queda una tarea con esta fecha en Hoy, a nombre de quien lleva la cuenta.', 'A task with this date goes to Today, for the account owner.')}</p>
              <Field label={t('Fecha', 'Date')}><input type="date" name="due_on" className="input" required defaultValue={tomorrow} data-testid="rec-due" /></Field>
              <div className="flex justify-end"><Submit testId="rec-accept-save">{t('Guardar tarea', 'Save task')}</Submit></div>
            </ActionForm>
          </Dialog>
          <Dialog trigger={t('Descartar', 'Dismiss')} title={t('¿Por qué la descartas?', 'Why are you dismissing it?')} size="sm" testId="rec-dismiss">
            <ActionForm action={dismissRecommendationAction} onOk="close" className="space-y-4">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="account_id" value={r.account_id} />
              <fieldset className="space-y-2">
                <legend className="mb-1 text-[13.5px] font-medium text-strong">{t('Motivo', 'Reason')}</legend>
                {DISMISS_CODES.map((c, i) => (
                  <label key={c} className="flex min-h-11 items-center gap-3 text-[14px]"><input type="radio" name="code" value={c} required defaultChecked={i === 0} data-testid={`rec-dismiss-${c}`} />{t(...DISMISS_LABEL[c])}</label>
                ))}
              </fieldset>
              <Field label={t('Nota (obligatoria si es otro motivo)', 'Note (required for another reason)')}><input name="note" className="input" maxLength={300} data-testid="rec-note" /></Field>
              <div className="flex justify-end"><Submit testId="rec-dismiss-save">{t('Descartar', 'Dismiss')}</Submit></div>
            </ActionForm>
          </Dialog>
        </div>
      )}
    </li>
  )
}

/** En la ficha: el resumen de la cuenta por reglas y sus sugerencias abiertas (hasta 3). */
export async function AccountNextActions({ ctx, accountId, market }: { ctx: Ctx; accountId: string; market: string }) {
  if (!ctx.can('ia.read', market)) return null
  const { t } = ctx
  const [recs, brief] = await Promise.all([openRecommendations(ctx, { scope: 'all', account: accountId, limit: 3 }), accountBrief(ctx, accountId)])
  if (!brief) return null
  const drop = brief.txn_before && brief.txn_now != null && brief.txn_before > 0 ? Math.round(((brief.txn_now - brief.txn_before) / brief.txn_before) * 100) : null
  const canAct = ctx.can('ia.act', market)
  return (
    <section className="mb-6 rounded-[18px] bg-surface-3 px-4 py-4 md:px-5" aria-label={t('Resumen y siguiente acción', 'Summary and next action')} data-testid="account-next">
      <h3 className="text-[15px] font-semibold text-strong">{t('Antes de la visita', 'Before the visit')}</h3>
      <ul className="mt-2 grid grid-cols-1 gap-1 text-[14px] text-muted-2 md:grid-cols-2" data-testid="account-brief">
        <li>{t(`${num(brief.days_quiet, 'es')} días sin contacto`, `${num(brief.days_quiet, 'en')} days without contact`)}</li>
        <li>{t(`${brief.open_deals} negocios abiertos, ${brief.open_tasks} pendientes`, `${brief.open_deals} open deals, ${brief.open_tasks} to-dos`)}</li>
        <li>{brief.txn_now == null ? t('Sin datos de ventas todavía', 'No sales data yet') : t(`${num(brief.txn_now, 'es')} transacciones en 30 días`, `${num(brief.txn_now, 'en')} transactions in 30 days`)}</li>
        {drop !== null && <li>{drop < 0 ? t(`Bajó ${-drop}% contra el mes anterior`, `Down ${-drop}% against the previous month`) : t(`Subió ${drop}% contra el mes anterior`, `Up ${drop}% against the previous month`)}</li>}
      </ul>
      <p className="mt-2 text-[12.5px] text-muted">{t('Armado con reglas y datos de CONTIGO.', 'Built with rules and CONTIGO data.')}</p>
      {recs.length > 0 && <ul className="mt-4 space-y-3">{recs.map((r) => <RecItem key={r.id} ctx={ctx} r={r} showAccount={false} canAct={canAct} />)}</ul>}
    </section>
  )
}

/** En el lead: el puntaje con cada punto explicado y la clasificación que propone la regla, para que una persona la confirme. */
export async function LeadScoreCard({ ctx, leadId, canWork }: { ctx: Ctx; leadId: string; canWork: boolean }) {
  const s = await leadScore(ctx, leadId)
  if (!s) return null
  const { t } = ctx
  return (
    <Card data-testid="lead-score">
      <CardTitle title={t('Calificación', 'Score')} hint={t('Con reglas y los pesos que fija administración. No la calcula una IA.', 'With rules and the weights set by administration. It is not computed by AI.')} right={<span className="num text-[22px] font-semibold text-strong" data-testid="lead-score-value">{s.score}</span>} />
      <ul className="space-y-1 text-[14px]" data-testid="lead-score-parts">
        {s.parts.length === 0 && <li className="text-muted">{t('Todavía no suma puntos: le faltan datos.', 'No points yet: it is missing data.')}</li>}
        {s.parts.map((p) => <li key={p.factor} className="flex justify-between gap-3"><span>{t(...FACTOR_LABEL[p.factor])}</span><span className="num font-medium">{p.points > 0 ? `+${p.points}` : p.points}</span></li>)}
      </ul>
      <div className="mt-4 border-t border-line pt-4">
        <p className="text-[14px]"><span className="font-medium text-strong">{t('Clasificación propuesta', 'Proposed classification')}: </span>
          {s.proposed ? <Badge tone="neutral">{t(...LEAD_CLASS_LABEL[s.proposed])}</Badge> : t('por confirmar', 'to be confirmed')}</p>
        <p className="mt-1 text-[13px] text-muted">{t(...s.why)}{s.hasMessage ? ` ${t('El mensaje del lead no se usa para clasificar: lo escribió alguien de fuera.', 'The lead’s message is not used to classify: someone outside wrote it.')}` : ''}</p>
        {s.confirmed && <p className="mt-2 text-[14px]" data-testid="lead-class-confirmed">{t('Confirmada', 'Confirmed')}: <strong>{t(...LEAD_CLASS_LABEL[s.confirmed])}</strong>{s.confirmed_by ? ` · ${s.confirmed_by}` : ''}</p>}
        {canWork && (
          <ActionForm action={confirmLeadClassAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="lead_id" value={leadId} />
            <Field label={t('Confirmar como', 'Confirm as')}>
              <select name="cls" className="input" defaultValue={s.confirmed ?? s.proposed ?? ''} required data-testid="lead-class-select">
                <option value="" disabled>{t('Elige', 'Choose')}</option>
                {LEAD_CLASSES.map((c) => <option key={c} value={c}>{t(...LEAD_CLASS_LABEL[c])}</option>)}
              </select>
            </Field>
            <Submit size="sm" variant="ghost" testId="lead-class-confirm">{t('Confirmar', 'Confirm')}</Submit>
          </ActionForm>
        )}
      </div>
    </Card>
  )
}
