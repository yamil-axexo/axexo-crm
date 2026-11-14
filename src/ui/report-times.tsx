import type { T, Locale } from '@/lib/format'
import { dayTime } from '@/lib/format'

type Times = { created_at: Date; taken_at: Date | null; taken_by_name: string | null; answered_at: Date | null; status: string; target_hours: number | null }

/** "3 h", "menos de 1 h", "2 días": cuánto pasó entre dos momentos. */
export function span(t: T, from: Date, to: Date): string {
  const hours = Math.max(0, (to.getTime() - from.getTime()) / 3_600_000)
  if (hours < 1) return t('menos de 1 h', 'under 1 h')
  if (hours < 48) return `${Math.round(hours)} h`
  const days = Math.round(hours / 24)
  return t(`${days} días`, `${days} days`)
}

/** Estado de un reporte con sus tiempos (GOB-10): recibido, en revisión, respondido, y si cumplió el plazo cuando hay uno definido. */
export function ReportTimes({ t, locale, tz, r, now = new Date() }: { t: T; locale: Locale; tz: string; r: Times; now?: Date }) {
  const end = r.answered_at ?? now
  const hours = (end.getTime() - r.created_at.getTime()) / 3_600_000
  const late = r.target_hours !== null && hours > r.target_hours
  return (
    <ol className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-2" data-testid="report-times">
      <li>{t('Recibido', 'Received')}: {dayTime(r.created_at, locale, tz)}</li>
      {(r.taken_at || r.status !== 'answered') && (
        <li data-testid="report-time-taken">{r.taken_at ? `${t('En revisión', 'Under review')}: ${dayTime(r.taken_at, locale, tz)}${r.taken_by_name ? `, ${r.taken_by_name}` : ''} (${t('a las', 'after')} ${span(t, r.created_at, r.taken_at)})` : t('Todavía nadie lo revisa', 'Nobody is reviewing it yet')}</li>
      )}
      <li data-testid="report-time-answered">{r.answered_at ? `${t('Respondido', 'Answered')}: ${dayTime(r.answered_at, locale, tz)} (${t('en', 'in')} ${span(t, r.created_at, r.answered_at)})` : `${t('Lleva abierto', 'Open for')} ${span(t, r.created_at, now)}`}</li>
      <li data-testid="report-time-target" className={late ? 'font-semibold text-red-text' : undefined}>
        {r.target_hours === null ? t('Plazo de respuesta: sin definir', 'Answer deadline: not defined') : `${t('Plazo', 'Deadline')}: ${r.target_hours} h. ${late ? t('Fuera del plazo', 'Past the deadline') : r.answered_at ? t('Dentro del plazo', 'Within the deadline') : t('En plazo', 'On time')}`}
      </li>
    </ol>
  )
}
