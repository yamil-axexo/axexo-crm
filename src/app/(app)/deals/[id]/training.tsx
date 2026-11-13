import type { Ctx } from '@/server/context'
import { trainingFor } from '@/dal/training'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { day } from '@/lib/format'
import { resolveTrainingAction, scheduleTrainingAction } from './pedido/actions'

const STATUS: Record<string, [string, string]> = {
  scheduled: ['Agendada', 'Scheduled'], done: ['Hecha', 'Done'], no_show: ['No se presentó', 'No-show'], cancelled: ['Cancelada', 'Cancelled'],
}

/** E13.F4: agenda de capacitación del dealer: fecha, quién la da, resultado y el video de recorrido del portal. */
export async function TrainingAgenda({ ctx, dealId, market, open, today }: { ctx: Ctx; dealId: string; market: string; open: boolean; today: string }) {
  const { t, locale } = ctx
  const data = await trainingFor(ctx, dealId, market)
  const edit = open && ctx.can('deal.ops', market)
  const current = data.sessions.find((s) => s.status === 'scheduled')
  if (!edit && data.sessions.length === 0) return null
  return (
    <Card data-testid="training-agenda">
      <CardTitle title={t('Agenda de capacitación', 'Training schedule')}
        hint={t('Cada sesión con su fecha, quién la da y cómo terminó. Si el dealer no se presenta, se reagenda aquí mismo.', 'Each session with its date, who gives it and how it ended. If the dealer misses it, reschedule right here.')} />
      {data.video
        ? <p className="mb-4 text-[14px]"><a href={data.video} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="training-video">{t('Video de recorrido del portal', 'Portal walkthrough video')}</a></p>
        : <p className="mb-4 text-[13.5px] text-muted-2" data-testid="training-video-missing">{t('Video de recorrido: s/d. Administración lo pone en Avisos y plantillas, Por mercado.', 'Walkthrough video: n/a. Administration sets it under Notices and templates, Per market.')}</p>}
      {data.sessions.length === 0 ? (
        <p className="text-[14.5px] text-muted" data-testid="training-empty">{t('Todavía no hay ninguna sesión agendada.', 'No session has been scheduled yet.')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="training-session" data-status={s.status}>
              <span className="text-[14.5px] text-strong">
                <span className="font-semibold">{day(s.on_date, locale)}{s.at_time ? `, ${s.at_time}` : ''}</span> · {t(`la da ${s.trainer_name}`, `given by ${s.trainer_name}`)}
                {s.rescheduled_from ? <span className="text-muted-2"> · {t('reagendada', 'rescheduled')}</span> : null}
                {s.note ? <span className="block text-[13px] text-muted-2">{s.note}</span> : null}
              </span>
              <Badge tone={s.status === 'done' ? 'good' : s.status === 'no_show' ? 'bad' : s.status === 'scheduled' ? 'accent' : 'neutral'}>{t(...(STATUS[s.status] ?? [s.status, s.status]))}</Badge>
            </li>
          ))}
        </ul>
      )}
      {edit && current && (
        <div className="mt-4 flex flex-wrap gap-3" data-testid="training-resolve">
          <ActionForm action={resolveTrainingAction}>
            <input type="hidden" name="session_id" value={current.id} /><input type="hidden" name="result" value="done" />
            <Submit size="sm" testId="training-done">{t('Marcar como hecha', 'Mark as done')}</Submit>
          </ActionForm>
          <Dialog trigger={t('No se presentó', 'No-show')} title={t('El dealer no se presentó', 'The dealer missed the training')} variant="ghost" size="sm" testId="training-noshow">
            <ActionForm action={resolveTrainingAction} onOk="close">
              <input type="hidden" name="session_id" value={current.id} /><input type="hidden" name="result" value="no_show" />
              <p className="mb-4 text-[14px] text-muted-2">{t('Elige la nueva fecha. A quien vendió le queda una tarea para confirmarla con el dealer.', 'Choose the new date. The seller gets a task to confirm it with the dealer.')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('Nueva fecha', 'New date')}><input name="next_on" type="date" min={today} required className="input" data-testid="training-next-on" /></Field>
                <Field label={t('Hora (opcional)', 'Time (optional)')}><input name="next_at" type="time" className="input" /></Field>
              </div>
              <Field label={t('Nota (opcional)', 'Note (optional)')} className="mt-3"><input name="note" maxLength={500} className="input" /></Field>
              <div className="mt-5 flex justify-end"><Submit testId="training-noshow-confirm">{t('Reagendar', 'Reschedule')}</Submit></div>
            </ActionForm>
          </Dialog>
          <ActionForm action={resolveTrainingAction}>
            <input type="hidden" name="session_id" value={current.id} /><input type="hidden" name="result" value="cancelled" />
            <Submit variant="quiet" size="sm" testId="training-cancel">{t('Cancelar la sesión', 'Cancel the session')}</Submit>
          </ActionForm>
        </div>
      )}
      {edit && (
        <ActionForm action={scheduleTrainingAction} onOk="reset" className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 md:grid-cols-[170px_130px_minmax(0,1fr)_auto] md:items-end" testId="training-form">
          <input type="hidden" name="deal_id" value={dealId} />
          <Field label={current ? t('Cambiar a esta fecha', 'Change to this date') : t('Fecha', 'Date')}><input name="on" type="date" min={today} required className="input" data-testid="training-date" /></Field>
          <Field label={t('Hora (opcional)', 'Time (optional)')}><input name="at" type="time" className="input" data-testid="training-time" /></Field>
          <Field label={t('Quién la da', 'Who gives it')} className="col-span-2 md:col-span-1">
            <select name="trainer_id" required defaultValue="" className="input" data-testid="training-trainer">
              <option value="">{t('Elige a una persona', 'Pick a person')}</option>
              {data.trainers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <div className="col-span-2 flex justify-end md:col-span-1"><Submit variant="ghost" testId="training-schedule">{current ? t('Cambiar la fecha', 'Change the date') : t('Agendar', 'Schedule')}</Submit></div>
        </ActionForm>
      )}
    </Card>
  )
}
