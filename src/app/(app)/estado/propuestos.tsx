import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { allProposed, ownerEn } from '@/dal/proposed'
import { Card, CardTitle } from '@/ui/kit'
import { ProposedTag } from '@/ui/role-board'

const SOURCE: Record<string, [string, string]> = {
  decision: ['Decisiones de negocio', 'Business decisions'],
  funnel: ['Embudo y automatizaciones', 'Pipeline and automations'],
  field: ['Campo y canales', 'Field and channels'],
  board: ['Tableros y reportes', 'Boards and reports'],
  platform: ['Plataforma', 'Platform'],
}

/**
 * Valores propuestos (ola 6): UNA lista con todo lo que CONTIGO usa como propuesta mientras su dueño no lo fija. Cada fila
 * dice quién lo tiene y dónde se cambia. Las decisiones viven donde se usan; esta vista las junta.
 */
export async function ProposedCard({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const items = await allProposed(ctx)
  const canBoards = ctx.can('config.manage') || ctx.can('metric.owner')
  return (
    <Card data-testid="status-proposed">
      <CardTitle title={t('Valores propuestos', 'Proposed values')} hint={t('CONTIGO funciona con estos valores mientras quien decide no los fija. Cada uno dice quién lo tiene y dónde se cambia.', 'CONTIGO runs with these values until the decision owner sets them. Each one says who has it and where it is changed.')}
        right={canBoards ? <Link href="/admin/tableros" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="status-proposed-link">{t('Tableros', 'Boards')}</Link> : undefined} />
      {items.length === 0 ? <p className="text-[14px] text-muted">{t('Todo lo propuesto ya está fijado.', 'Everything proposed has been set.')}</p> : (
        <ul>
          {items.map((u) => (
            <li key={u.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid="status-proposed-row" data-key={u.key} data-source={u.source}>
              <span className="min-w-0 flex-1 basis-48">
                <span className="block text-[14px] font-medium text-strong">{t(...u.label)}</span>
                <span className="block text-[12.5px] text-muted-2">{t(...SOURCE[u.source]!)}{u.detail ? ` · ${locale === 'en' ? u.detail[1] : u.detail[0]}` : ''}</span>
                {ctx.can('status.read') && <Link href={u.href} className="inline-flex min-h-11 items-center text-[13px] font-medium text-blue-text underline" data-testid="status-proposed-open">{t('Dónde se cambia', 'Where to change it')}</Link>}
              </span>
              <ProposedTag>{t(`Valor propuesto, [pendiente: ${u.owner}]`, `Proposed value, [pending: ${ownerEn(u.owner)}]`)}</ProposedTag>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
