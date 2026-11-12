import { requireCtx } from '@/server/context'
import { myReports } from '@/dal/reports'
import { screenPath } from '@/domain/reports'
import { Badge, Card, CardTitle, Empty, Field, PageHeader } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { dayTime } from '@/lib/format'
import { screenLabel } from '@/lib/screens'
import { flat } from '@/server/params'
import { readerTimeZone } from '@/server/timezone'
import { createReportAction } from './actions'

/** Reportar un problema o pedir algo: un formulario corto y, debajo, los reportes de la persona con su respuesta. */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ desde?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const screen = screenPath(sp.desde)
  const [rows, tz] = await Promise.all([myReports(ctx), readerTimeZone(ctx)])
  const urgency = { low: t('Puede esperar', 'It can wait'), normal: t('Esta semana', 'This week'), high: t('Urgente: no puedo trabajar', 'Urgent: I cannot work') } as Record<string, string>
  const kind = { problem: t('Algo falla', 'Something is broken'), request: t('Me hace falta algo', 'I am missing something') } as Record<string, string>

  return (
    <div className="mx-auto max-w-[760px]" data-testid="report">
      <PageHeader
        title={t('Reportar un problema', 'Report a problem')}
        desc={t('Cuéntanos qué pasó o qué te hace falta. Lo recibe administración y su respuesta te aparece aquí mismo.', 'Tell us what happened or what you are missing. Administration receives it and the answer shows up right here.')}
      />
      <Card>
        <ActionForm action={createReportAction} onOk="reset" testId="report-form">
          <input type="hidden" name="screen" value={screen ?? ''} />
          <fieldset>
            <legend className="mb-2 block text-[13px] font-semibold text-muted-2">{t('¿Qué es?', 'What is it?')}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {(['problem', 'request'] as const).map((k) => (
                <label key={k} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
                  <input type="radio" name="kind" value={k} defaultChecked={k === 'problem'} className="h-5 w-5" data-testid={`report-kind-${k}`} />
                  {kind[k]}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t('¿Qué pasó?', 'What happened?')} hint={t('Qué intentabas hacer, qué pasó y con qué comercio o negocio. Sin tarjetas, cuentas bancarias ni contraseñas.', 'What you were trying to do, what happened and with which merchant or deal. No cards, bank accounts or passwords.')} className="mt-5">
            <textarea name="body" className="input min-h-[132px] py-3" required minLength={5} maxLength={2000} data-testid="report-body" />
          </Field>
          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <p className="mb-2 block text-[13px] font-semibold text-muted-2">{t('¿En qué pantalla estabas?', 'Which screen were you on?')}</p>
              <p className="flex min-h-11 items-center rounded-[10px] bg-surface-2 px-4 text-[15px] text-strong" data-testid="report-screen">{screenLabel(t, screen)}</p>
              <p className="mt-1.5 text-[12.5px] text-muted">{screen ? t('Se llenó sola con la pantalla de donde vienes.', 'Filled in by itself from the screen you came from.') : t('Si aplica, dilo en el texto.', 'If it matters, say so in the text.')}</p>
            </div>
            <Field label={t('¿Qué tan urgente es?', 'How urgent is it?')}>
              <select name="urgency" className="input" defaultValue="normal" data-testid="report-urgency">
                {(['high', 'normal', 'low'] as const).map((u) => <option key={u} value={u}>{urgency[u]}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-6 flex justify-end"><Submit testId="report-send">{t('Enviar reporte', 'Send report')}</Submit></div>
        </ActionForm>
      </Card>

      <Card className="mt-8" data-testid="report-mine">
        <CardTitle title={t('Tus reportes', 'Your reports')} hint={t('Solo tú y administración los ven. CONTIGO no manda aviso: la respuesta aparece aquí.', 'Only you and administration see them. CONTIGO sends no notice: the answer shows up here.')} />
        {rows.length === 0 ? (
          <Empty title={t('Todavía no has reportado nada', 'You have not reported anything yet')} hint={t('Cuando mandes un reporte, queda aquí con su respuesta.', 'When you send a report, it stays here with its answer.')} />
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.id} className="border-t border-line py-5 first:border-t-0 first:pt-0" data-testid="report-row" data-status={r.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.status === 'answered' ? 'good' : 'warn'}>{r.status === 'answered' ? t('Atendido', 'Handled') : t('Abierto', 'Open')}</Badge>
                  <span className="text-[13px] text-muted">{kind[r.kind]} · {urgency[r.urgency]} · {screenLabel(t, r.screen)} · {dayTime(r.created_at, locale, tz)}</span>
                </div>
                <p className="mt-2 text-[15px] leading-6 whitespace-pre-wrap text-strong">{r.body}</p>
                {r.answer && (
                  <div className="mt-3 rounded-[14px] bg-green-50 px-4 py-3" data-testid="report-answer">
                    <p className="text-[12.5px] font-semibold text-brand-text">{t(`Respuesta de ${r.answered_by_name ?? 'administración'}`, `Answer from ${r.answered_by_name ?? 'administration'}`)}{r.answered_at ? ` · ${dayTime(r.answered_at, locale, tz)}` : ''}</p>
                    <p className="mt-1 text-[14.5px] leading-6 whitespace-pre-wrap text-strong">{r.answer}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
