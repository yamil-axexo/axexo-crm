import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { officialQueues } from '@/dal/reportes'
import { Badge, Card, CardTitle, Empty, PageHeader } from '@/ui/kit'
import { VIEW_EN, VIEW_OBJECT_LABEL, viewHref } from '@/lib/report-catalog'
import { ROLE_LABEL, type Role } from '@/domain/policy'

export const dynamic = 'force-dynamic'

/**
 * UX-03 (embudo2): las colas oficiales de cada rol, con su contador. Las publica administración (no son vistas personales):
 * revisitas vencidas, altas sin fondeo y puntos de venta en riesgo. La meta es cerrarlas en cero al final de la semana.
 */
export default async function ColasPage() {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const queues = await officialQueues(ctx)
  const name = (n: string) => (locale === 'en' ? VIEW_EN[n] ?? n : n)
  return (
    <div className="mx-auto max-w-[960px] px-4 py-6 md:px-8">
      <PageHeader title={t('Colas del equipo', 'Team queues')} desc={t('Las colas oficiales de tu rol. La meta es dejarlas en cero al cierre de la semana.', 'The official queues for your role. The goal is to bring them to zero by the end of the week.')} />
      {queues.length === 0 ? (
        <Card><Empty title={t('Tu rol no tiene colas oficiales', 'Your role has no official queues')} hint={t('Administración las publica por rol. Mientras tanto, tus vistas guardadas están en cada lista.', 'Administration publishes them per role. Meanwhile, your saved views are on each list.')} /></Card>
      ) : (
        <Card data-testid="official-queues">
          <CardTitle title={t('Colas oficiales', 'Official queues')} hint={t('Valor propuesto, [pendiente: C1 define las colas oficiales por rol]', 'Proposed value, [pending: C1 defines the official queues per role]')} />
          <ul className="divide-y divide-line">
            {queues.map((q) => (
              <li key={q.id} className="flex min-h-14 flex-wrap items-center gap-3 py-3" data-testid="official-queue">
                <Link href={viewHref(q)} className="min-h-11 flex-1 content-center text-[15px] font-semibold text-strong underline-offset-4 hover:underline" data-testid="official-queue-link">{name(q.name)}</Link>
                <span className="text-[13px] text-muted">{t(...VIEW_OBJECT_LABEL[q.object])} · {ROLE_LABEL[q.role as Role]?.[locale] ?? q.role}</span>
                <Badge tone={q.count ? 'warn' : 'good'}><span data-testid="official-queue-count">{q.count ?? 0}</span></Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
