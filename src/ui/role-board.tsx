import type { ReactNode } from 'react'
import { Badge, NoData } from '@/ui/kit'
import { Metric } from '@/ui/report'
import { money, num } from '@/lib/format'
import type { T } from '@/lib/format'
import type { BoardItem, BoardValue } from '@/dal/role-boards'
import type { MetricKey } from '@/lib/metric-defs'

/**
 * REP-01 (reportes2): el tablero de un rol. Cada cifra lleva su definición y su dueño (Metric); si la lista del rol todavía no
 * la confirmó quien decide, cada tarjeta lo dice con quién falta, sin esconder la cifra.
 */
export function RoleBoard({ t, locale, items, values, owners, money: moneyKeys = [], testId, hrefs = {} }: {
  t: T; locale: 'es' | 'en'; items: BoardItem[]; values: Partial<Record<MetricKey, BoardValue>>; owners: Record<string, string>
  money?: MetricKey[]; testId: string; hrefs?: Partial<Record<MetricKey, string>>
}) {
  const ownerMap = { ...owners, ...Object.fromEntries(items.filter((i) => i.ownerLabel).map((i) => [i.key, i.ownerLabel!])) }
  const pending = items.filter((i) => !i.confirmed)
  return (
    <section aria-label={t('Indicadores del rol', 'Role indicators')} data-testid={testId}>
      {pending.length > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted" data-testid={`${testId}-proposed`}>
          <Badge tone="warn">{t('Valor propuesto', 'Proposed value')}</Badge>
          {t(`Esta lista de indicadores es una propuesta. [pendiente: ${pending[0]!.pendingOwner}] la confirma en Administración.`, `This list of indicators is a proposal. [pending: ${pending[0]!.pendingOwner}] confirms it in Administration.`)}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => {
          const v = values[i.key]
          let shownValue: ReactNode = <NoData locale={locale} />
          if (v && v.value !== null && v.value !== undefined) {
            shownValue = typeof v.value === 'string' ? v.value
              : v.pct ? `${num(v.value, locale)}%`
              : i.key === 'financeCostPerAi' ? new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(v.value)
              : moneyKeys.includes(i.key) ? money(Math.round(v.value * 100), 'USD', locale)
              : num(v.value, locale)
          }
          return (
            <Metric key={i.key} t={t} k={i.key} owners={ownerMap} testId={`rb-${i.key}`} value={shownValue}
              hint={v?.hint ? t(v.hint[0], v.hint[1]) : undefined} href={hrefs[i.key]} />
          )
        })}
      </div>
    </section>
  )
}
