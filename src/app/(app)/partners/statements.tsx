import { ownerEn } from '@/lib/owner-en'
import type { Statement } from '@/dal/partners'
import type { T, Locale } from '@/lib/format'
import { num } from '@/lib/format'
import { Badge, Empty } from '@/ui/kit'

/**
 * CANAL-05: estado de comisión, siempre en conteos (nunca montos) y marcado como estimado o publicado. El premio se mide por
 * umbral de tiendas activas a 90 días; en una persona se ve también lo del equipo, sin ranking contra nadie.
 */
export function StatementList({ t, locale, rows, testId = 'statements' }: { t: T; locale: Locale; rows: Statement[]; testId?: string }) {
  if (rows.length === 0) return <Empty title={t('Todavía no hay estado de este mes', 'No statement for this month yet')} hint={t('Se calcula cada día con las altas y las ventas de tus tiendas.', 'It is calculated every day from your stores’ sign-ups and sales.')} />
  return (
    <ul data-testid={testId}>
      {rows.map((s) => {
        const c = s.counts as Record<string, number | string | null>
        const n = (k: string) => Number(c[k] ?? 0)
        const goal = n('threshold')
        return (
          <li key={s.id} className="border-t border-line py-4 first:border-t-0" data-testid="statement-row" data-status={s.status}>
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-strong">
              <span>{s.month} · {s.party_label}</span>
              <Badge tone={s.status === 'published' ? 'good' : 'info'}>{s.status === 'published' ? t('Publicado', 'Published') : t('Estimado', 'Estimate')}</Badge>
            </p>
            <p className="mt-1 text-[13.5px] text-muted">
              {t(`${num(n('enrolled'), locale)} altas · ${num(n('first_sales'), locale)} primeras ventas · activas: ${num(n('active_30'), locale)} a 30 días, ${num(n('active_60'), locale)} a 60, ${num(n('active_90'), locale)} a 90`,
                 `${num(n('enrolled'), locale)} sign-ups · ${num(n('first_sales'), locale)} first sales · active: ${num(n('active_30'), locale)} at 30 days, ${num(n('active_60'), locale)} at 60, ${num(n('active_90'), locale)} at 90`)}
            </p>
            {goal > 0 && (
              <p className="mt-1 text-[13.5px] text-strong" data-testid="statement-goal">
                {n('active_90') >= goal ? t(`Premio por umbral: alcanzado (${num(goal, locale)} activas a 90 días).`, `Threshold award: reached (${num(goal, locale)} active at 90 days).`) : t(`Premio por umbral: faltan ${num(goal - n('active_90'), locale)} activas a 90 días.`, `Threshold award: ${num(goal - n('active_90'), locale)} more active at 90 days to go.`)}
                {c.team_active_90 !== undefined ? t(` Tu equipo: ${num(n('team_active_90'), locale)}.`, ` Your team: ${num(n('team_active_90'), locale)}.`) : ''}
                {c.threshold_pending ? <span className="ml-1 text-amber-text">{t(`Valor propuesto, [pendiente: ${String(c.threshold_pending)}]`, `Proposed value, [pending: ${ownerEn(String(c.threshold_pending))}]`)}</span> : null}
              </p>
            )}
            <p className="mt-1 text-[12.5px] text-muted-2">{s.status === 'published' ? t(`Publicado con las reglas: ${s.rules_ref}`, `Published under the rules: ${s.rules_ref}`) : t('Estimado: puede cambiar hasta que se publique con las reglas escritas.', 'Estimate: it can change until it is published under the written rules.')}</p>
          </li>
        )
      })}
    </ul>
  )
}
