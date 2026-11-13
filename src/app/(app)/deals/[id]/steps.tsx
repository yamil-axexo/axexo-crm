import type { Ctx } from '@/server/context'
import { dealSteps } from '@/dal/automations'
import { ROLE_LABEL } from '@/domain/policy'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { dayTime } from '@/lib/format'
import { addEvidenceAction, decideApprovalAction, waitingOnAction } from '@/app/(app)/admin/automatizaciones/actions'

/**
 * PIPE-02 / PIPE-03 en la ficha del negocio: la meta de tiempo de la etapa (con su reloj), a quién se espera, la evidencia
 * que pide el siguiente paso y la aprobación pendiente. Quien pidió el paso ve a quién espera; quien aprueba decide aquí.
 */
export async function DealSteps({ ctx, dealId, canEdit, market }: { ctx: Ctx; dealId: string; canEdit: boolean; market: { timezone: string } }) {
  const s = await dealSteps(ctx, dealId)
  if (!s) return null
  const { t, locale } = ctx
  const needsEvidence = s.steps.filter((x) => x.requires_evidence)
  const show = s.pending || s.goal || s.steps.length > 0 || s.evidence.length > 0 || canEdit || s.waiting_on
  if (!show) return null
  const rich = Boolean(s.pending || s.last || s.goal || s.steps.length > 0 || s.evidence.length > 0)
  const WAIT: Record<string, [string, string]> = { us: ['A nosotros', 'Us'], customer: ['Al cliente', 'The customer'], third_party: ['A un tercero (proveedor, operador)', 'A third party (provider, carrier)'] }
  const approver = s.pending ? (s.pending.escalated && s.pending.backup ? s.pending.backup : s.pending.approver ?? (s.pending.escalated && !s.pending.backup ? t(ROLE_LABEL.market_lead.es, ROLE_LABEL.market_lead.en) : s.pending.approver_role ? t(ROLE_LABEL[s.pending.approver_role].es, ROLE_LABEL[s.pending.approver_role].en) : '')) : ''
  return (
    <Card data-testid="deal-steps">
      {rich
        ? <CardTitle title={t('Evidencia y aprobaciones', 'Evidence and approvals')} hint={t('Lo que el siguiente paso pide además de los campos de la etapa.', 'What the next step requires besides the stage fields.')} />
        : <CardTitle title={t('Espera', 'Waiting')} hint={t('Di a quién espera este negocio para que no cuente como estancado por el equipo.', 'Say who this deal is waiting on so it does not count as stalled by the team.')} />}

      {s.pending && (
        <div className="mb-5 rounded-[14px] bg-warn-bg px-5 py-4" data-testid="approval-pending" data-mine={s.pending.mine ? '1' : '0'}>
          <p className="text-[15px] font-semibold text-amber-text" data-testid="approval-waiting">{t(`Esperando aprobación de ${approver}`, `Waiting for approval from ${approver}`)}</p>
          <p className="mt-1 text-[13.5px] text-muted-2">
            {t(`${s.pending.requester ?? 'Alguien'} pidió pasar este negocio a "${s.pending.to_es}". El negocio se mueve cuando lo aprueben.`, `${s.pending.requester ?? 'Someone'} asked to move this deal to "${s.pending.to_en}". The deal moves once it is approved.`)}{' '}
            {s.pending.escalated
              ? t('El plazo venció y pasó al suplente.', 'The time ran out and it went to the backup.')
              : s.pending.late ? t('El plazo ya venció: pasa al suplente en la próxima revisión.', 'The time has run out: it goes to the backup at the next check.') : t(`Plazo: ${dayTime(s.pending.due_at, locale, market.timezone)}.`, `Due: ${dayTime(s.pending.due_at, locale, market.timezone)}.`)}
          </p>
          {s.pending.can_decide && (
            <div className="mt-4 flex flex-wrap gap-3">
              <ActionForm action={decideApprovalAction} testId="approval-approve">
                <input type="hidden" name="approval_id" value={s.pending.id} />
                <input type="hidden" name="decision" value="approve" />
                <Submit size="sm" testId="approval-approve-btn">{t('Aprobar y mover', 'Approve and move')}</Submit>
              </ActionForm>
              <Dialog trigger={t('No aprobar', 'Decline')} title={t('No aprobar este paso', 'Decline this step')} size="sm" testId="approval-reject">
                <ActionForm action={decideApprovalAction} className="space-y-4 text-left" onOk="close" testId="approval-reject-form">
                  <input type="hidden" name="approval_id" value={s.pending.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <Field label={t('Por qué (lo lee quien lo pidió)', 'Why (the requester reads it)')}><textarea name="note" className="input min-h-24" required minLength={2} maxLength={300} data-testid="approval-note" /></Field>
                  <div className="flex justify-end"><Submit variant="danger" testId="approval-reject-btn">{t('No aprobar', 'Decline')}</Submit></div>
                </ActionForm>
              </Dialog>
            </div>
          )}
        </div>
      )}
      {!s.pending && s.last && (
        <p className="mb-5 text-[13.5px] text-muted-2" data-testid="approval-last">
          {s.last.status === 'approved'
            ? t(`${s.last.decided_by ?? 'Alguien'} aprobó el paso a "${s.last.to_es}".`, `${s.last.decided_by ?? 'Someone'} approved the step to "${s.last.to_en}".`)
            : t(`${s.last.decided_by ?? 'Alguien'} no aprobó el paso a "${s.last.to_es}"${s.last.note ? `: ${s.last.note}` : '.'}`, `${s.last.decided_by ?? 'Someone'} declined the step to "${s.last.to_en}"${s.last.note ? `: ${s.last.note}` : '.'}`)}
        </p>
      )}

      {s.goal && (
        <p className="mb-5 text-[14px]" data-testid="stage-goal" data-late={s.goal.late ? '1' : '0'}>
          {s.goal.late ? <Badge tone="bad">{t('Meta de la etapa vencida', 'Stage time goal passed')}</Badge> : <Badge tone="info">{t('Meta de la etapa', 'Stage time goal')}</Badge>}
          <span className="ml-2 text-muted-2">{s.goal.late ? t(`venció el ${dayTime(s.goal.due_at, locale, market.timezone)}`, `it passed on ${dayTime(s.goal.due_at, locale, market.timezone)}`) : t(`vence el ${dayTime(s.goal.due_at, locale, market.timezone)}`, `due on ${dayTime(s.goal.due_at, locale, market.timezone)}`)} · {t(`${s.goal.hours} horas hábiles en la etapa`, `${s.goal.hours} business hours in the stage`)}</span>
        </p>
      )}

      {s.steps.length > 0 && (
        <ul className="mb-5 space-y-2 text-[14px]" data-testid="step-needs-list">
          {s.steps.map((x) => (
            <li key={x.to_stage_id} data-testid="step-need">
              <span className="font-semibold text-strong">{t(`Para pasar a "${x.to_es}":`, `To move to "${x.to_en}":`)}</span>{' '}
              {[x.requires_evidence ? (x.has_evidence ? t('evidencia ya agregada', 'evidence already added') : t(`falta la evidencia (${x.evidence_es ?? 'enlace con nota'})`, `the evidence is missing (${x.evidence_en ?? 'link with a note'})`)) : null,
                x.needs_approval ? t('pide aprobación al moverlo', 'it asks for approval when you move it') : null].filter(Boolean).join(' · ')}
            </li>
          ))}
        </ul>
      )}

      {canEdit && needsEvidence.length > 0 && (
        <Dialog trigger={t('Agregar evidencia', 'Add evidence')} title={t('Agregar evidencia', 'Add evidence')} size="sm" testId="evidence-add">
          <ActionForm action={addEvidenceAction} className="space-y-4 text-left" onOk="close" testId="evidence-form">
            <input type="hidden" name="deal_id" value={dealId} />
            <Field label={t('Para qué paso', 'For which step')}>
              <select name="to_stage_id" className="input" required data-testid="evidence-stage">{needsEvidence.map((x) => <option key={x.to_stage_id} value={x.to_stage_id}>{t(`Pasar a "${x.to_es}": ${x.evidence_es ?? ''}`, `Move to "${x.to_en}": ${x.evidence_en ?? ''}`)}</option>)}</select>
            </Field>
            <Field label={t('Enlace al documento', 'Link to the document')} hint={t('Dónde está guardado (empieza con https://). CONTIGO guarda el enlace, no el archivo. No pegues números de cuenta ni identificaciones.', 'Where it is stored (starts with https://). CONTIGO keeps the link, not the file. Do not paste account numbers or IDs.')}>
              <input name="url" type="url" className="input" required maxLength={480} placeholder="https://" data-testid="evidence-url" />
            </Field>
            <Field label={t('Nota', 'Note')}><input name="note" className="input" required minLength={2} maxLength={300} data-testid="evidence-note" /></Field>
            <div className="flex justify-end"><Submit testId="evidence-save">{t('Guardar evidencia', 'Save evidence')}</Submit></div>
          </ActionForm>
        </Dialog>
      )}

      {s.evidence.length > 0 && (
        <ul className="mt-5 divide-y divide-line text-[13.5px]" data-testid="evidence-list">
          {s.evidence.map((e) => (
            <li key={e.id} className="py-2.5" data-testid="evidence-row">
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-text underline [overflow-wrap:anywhere]">{e.note}</a>
              <span className="block text-muted-2">{[t(`para pasar a "${e.to_es}"`, `to move to "${e.to_en}"`), e.added_by, dayTime(e.added_at, locale, market.timezone)].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}

      {(canEdit || s.waiting_on) && (
        <div className={rich ? 'mt-5 border-t border-line pt-5' : ''} data-testid="waiting-on">
          {canEdit ? (
            <ActionForm action={waitingOnAction} className="flex flex-wrap items-end gap-4" testId="waiting-form">
              <input type="hidden" name="deal_id" value={dealId} />
              <Field label={t('A quién se espera', 'Who it is waiting on')} hint={t('Si esperas a un tercero, el aviso de estancado usa el plazo de espera de la etapa.', 'If you are waiting on a third party, the stalled notice uses the stage’s waiting limit.')}>
                <select name="waiting_on" className="input" defaultValue={s.waiting_on ?? ''} data-testid="waiting-select">
                  <option value="">{t('A nadie', 'Nobody')}</option>
                  {Object.entries(WAIT).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}
                </select>
              </Field>
              <Submit variant="ghost" size="sm" testId="waiting-save">{t('Guardar espera', 'Save wait')}</Submit>
            </ActionForm>
          ) : (
            <p className="text-[14px]">{t('Se espera: ', 'Waiting on: ')}<strong>{t(WAIT[s.waiting_on ?? '']?.[0] ?? '', WAIT[s.waiting_on ?? '']?.[1] ?? '')}</strong></p>
          )}
        </div>
      )}
    </Card>
  )
}
