import type { Ctx } from '@/server/context'
import { allReports } from '@/dal/problem-reports'
import { Badge, Card, CardTitle, Empty, Field, Pills } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { dayTime } from '@/lib/format'
import { qs } from '@/lib/labels'
import { screenLabel } from '@/lib/screens'
import { readerTimeZone } from '@/server/timezone'
import { answerReportAction } from '@/app/(app)/reportar/actions'

const FILTERS = ['open', 'answered', 'all'] as const
type Filter = (typeof FILTERS)[number]
export const reportFilter = (v: string | undefined): Filter => (FILTERS.includes(v as Filter) ? (v as Filter) : 'open')

/** Reportes del equipo: lo que cada persona mandó desde "Reportar un problema". Administración responde y marca atendido. */
export async function ReportesTab({ ctx, filter }: { ctx: Ctx; filter: Filter }) {
  const { t, locale } = ctx
  const [d, tz] = await Promise.all([allReports(ctx, filter), readerTimeZone(ctx)])
  const urgency = { low: t('Puede esperar', 'It can wait'), normal: t('Esta semana', 'This week'), high: t('Urgente', 'Urgent') } as Record<string, string>
  const kind = { problem: t('Algo falla', 'Something is broken'), request: t('Pide algo', 'Asks for something') } as Record<string, string>
  return (
    <Card data-testid="admin-reports">
      <CardTitle
        title={t('Reportes del equipo', 'Team reports')}
        hint={t('Lo que cada persona manda desde "Reportar un problema". Al responder, queda atendido y la persona ve tu respuesta en esa misma pantalla. CONTIGO no le manda aviso.', 'What each person sends from "Report a problem". Once you answer, it is handled and the person sees your answer on that same screen. CONTIGO does not notify them.')}
      />
      <div className="mb-6">
        <Pills
          label={t('Qué reportes ver', 'Which reports to see')}
          current={filter}
          items={[
            { key: 'open', href: qs('/admin', { tab: 'reportes' }), label: t('Abiertos', 'Open'), count: d.open },
            { key: 'answered', href: qs('/admin', { tab: 'reportes', reportes: 'answered' }), label: t('Atendidos', 'Handled'), count: d.answered },
            { key: 'all', href: qs('/admin', { tab: 'reportes', reportes: 'all' }), label: t('Todos', 'All'), count: d.open + d.answered },
          ]}
        />
      </div>
      {d.rows.length === 0 ? (
        <Empty title={filter === 'open' ? t('No hay reportes abiertos', 'No open reports') : t('No hay reportes aquí', 'No reports here')} hint={t('Cuando alguien reporte un problema o pida algo, aparece en esta lista.', 'When someone reports a problem or asks for something, it shows up in this list.')} />
      ) : (
        <ul>
          {d.rows.map((r) => (
            <li key={r.id} className="border-t border-line py-5 first:border-t-0 first:pt-0" data-testid="admin-report-row" data-status={r.status}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.status === 'answered' ? 'good' : r.urgency === 'high' ? 'bad' : 'warn'}>{r.status === 'answered' ? t('Atendido', 'Handled') : urgency[r.urgency]}</Badge>
                <span className="text-[15px] font-semibold text-strong">{r.user_name}</span>
                <span className="text-[13px] text-muted">{kind[r.kind]} · {screenLabel(t, r.screen)} · {dayTime(r.created_at, locale, tz)}</span>
              </div>
              <p className="mt-2 text-[15px] leading-6 whitespace-pre-wrap text-strong" data-testid="admin-report-body">{r.body}</p>
              {r.answer ? (
                <div className="mt-3 rounded-[14px] bg-green-50 px-4 py-3">
                  <p className="text-[12.5px] font-semibold text-brand-text">{t(`Respondió ${r.answered_by_name ?? ''}`, `Answered by ${r.answered_by_name ?? ''}`)}{r.answered_at ? ` · ${dayTime(r.answered_at, locale, tz)}` : ''}</p>
                  <p className="mt-1 text-[14.5px] leading-6 whitespace-pre-wrap text-strong">{r.answer}</p>
                </div>
              ) : (
                <ActionForm action={answerReportAction} className="mt-3" testId="admin-report-form">
                  <input type="hidden" name="id" value={r.id} />
                  <Field label={t(`Respuesta para ${r.user_name}`, `Answer for ${r.user_name}`)}>
                    <textarea name="answer" className="input min-h-[88px] py-3" required minLength={2} maxLength={2000} data-testid="admin-report-answer" />
                  </Field>
                  <div className="mt-3 flex justify-end"><Submit variant="ghost" testId="admin-report-save">{t('Responder y marcar atendido', 'Answer and mark handled')}</Submit></div>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
