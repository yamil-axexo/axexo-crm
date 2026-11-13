import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { pendingDecisions } from '@/dal/reportes2'
import { Badge, Card, CardTitle } from '@/ui/kit'

/** reportes2: valores que CONTIGO usa como propuesta mientras su dueño no los fija. Cada uno con quién lo tiene. */
export async function ProposedCard({ ctx }: { ctx: Ctx }) {
  const { t } = ctx
  const items = await pendingDecisions(ctx)
  return (
    <Card data-testid="status-proposed">
      <CardTitle title={t('Valores propuestos', 'Proposed values')} hint={t('CONTIGO funciona con estos valores mientras quien decide no los fija. Se cambian en Administración.', 'CONTIGO runs with these values until the decision owner sets them. They change in Administration.')}
        right={ctx.can('config.manage') || ctx.can('metric.owner') ? <Link href="/admin/tableros" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="status-proposed-link">{t('Abrir', 'Open')}</Link> : undefined} />
      {items.length === 0 ? <p className="text-[14px] text-muted">{t('Todo lo propuesto ya está fijado.', 'Everything proposed has been set.')}</p> : (
        <ul>
          {items.map((u) => (
            <li key={u.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid="status-proposed-row">
              <span className="min-w-0 flex-1 basis-48 text-[14px] font-medium text-strong">{t(...u.label)}</span>
              <Badge tone="warn">{t(`Valor propuesto, [pendiente: ${u.pending}]`, `Proposed value, [pending: ${u.pending}]`)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
