import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { flat } from '@/server/params'
import { fullThread } from '@/dal/embudo'
import { MILESTONE_LABEL, type Milestone } from '@/domain/embudo/closing'
import { TICKET_STATUS_LABEL } from '@/domain/embudo/tickets'
import { Card, PageHeader, Pills, buttonClass } from '@/ui/kit'
import { ACTIVITY, lab, qs } from '@/lib/labels'
import { dayTime } from '@/lib/format'

/**
 * ACT-01: el hilo completo de un comercio. Una sola línea de tiempo, paginada, con actividades y notas, visitas de la
 * Sales App, cambios de etapa, hitos de venta y tickets de soporte; y, si se pide, también lo de sus sucursales.
 */
export default async function FullThreadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const sp = flat(await searchParams)
  const withChildren = sp.sucursales === '1'
  const data = await fullThread(ctx, id, { withChildren, before: sp.antes })
  if (!data) notFound()
  const tz = ctx.market(data.account.market_code).timezone
  const href = (over: Record<string, string | undefined>) => qs(`/comercios/${id}/hilo`, { sucursales: withChildren ? '1' : undefined, ...over })
  const title = (e: (typeof data.items)[number]): string => {
    if (e.kind === 'stage') { const [es, en] = e.title.split('|'); return t(`Cambio de etapa: ${es}`, `Stage change: ${en}`) }
    if (e.kind === 'ticket') return t(`Ticket de soporte ${e.title}`, `Support ticket ${e.title}`)
    if (e.kind === 'sales_app_visit') return e.title === 'sale' ? t('Visita de la Sales App: con venta', 'Sales App visit: sale') : t('Visita de la Sales App: sin venta', 'Sales App visit: no sale')
    if (e.kind === 'milestone') { const [k, a] = e.title.split(':'); const m = MILESTONE_LABEL[k as Milestone]; return `${t(m.es, m.en)}: ${a === 'set' ? t('registrado', 'recorded') : a === 'void' ? t('anulado', 'voided') : t('fecha corregida', 'date corrected')}` }
    return `${lab(t, ACTIVITY[e.kind], e.kind)}: ${e.title}`
  }
  const detail = (e: (typeof data.items)[number]): string | null => (e.kind === 'ticket' ? t(TICKET_STATUS_LABEL[(e.detail ?? 'unknown') as 'open'].es, TICKET_STATUS_LABEL[(e.detail ?? 'unknown') as 'open'].en) : e.detail)
  return (
    <div className="mx-auto max-w-[820px]">
      <Link href={`/comercios/${id}`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-blue-text hover:underline" data-testid="thread-back">
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />{data.account.name}
      </Link>
      <PageHeader title={t('Hilo completo', 'Full thread')} desc={t('Todo lo que ha pasado con este comercio, de lo más reciente a lo más antiguo.', 'Everything that has happened with this merchant, newest first.')} />
      <div className="mb-6"><Pills label={t('Alcance', 'Scope')} current={withChildren ? 'con' : 'solo'} items={[
        { key: 'solo', href: qs(`/comercios/${id}/hilo`, {}), label: t('Solo este comercio', 'This merchant only') },
        { key: 'con', href: qs(`/comercios/${id}/hilo`, { sucursales: '1' }), label: t('Con sus sucursales', 'With its branches') }]} /></div>
      <Card>
        {data.items.length === 0 ? <p className="text-[15px] text-muted" data-testid="thread-empty">{t('Todavía no hay nada en el hilo.', 'There is nothing in the thread yet.')}</p> : (
          <ol className="space-y-4" data-testid="full-thread">
            {data.items.map((e) => (
              <li key={`${e.kind}-${e.id}`} className="border-b border-line pb-3 last:border-b-0" data-testid="thread-entry" data-kind={e.kind}>
                <p className="text-[12.5px] text-muted">{dayTime(e.at, locale, tz)}{e.who ? ` · ${e.who}` : ''}{withChildren && e.account_id !== id ? <> · <Link href={`/comercios/${e.account_id}`} className="underline" data-testid="thread-branch">{e.account_name}</Link></> : null}</p>
                <p className="text-[15px] font-medium text-strong [overflow-wrap:anywhere]">{title(e)}</p>
                {detail(e) && <p className="text-[13.5px] text-muted-2 [overflow-wrap:anywhere]">{detail(e)}</p>}
              </li>
            ))}
          </ol>
        )}
        {data.next && <p className="mt-5"><Link href={href({ antes: data.next })} className={buttonClass('ghost', 'sm')} data-testid="thread-more">{t('Ver lo anterior', 'See earlier entries')}</Link></p>}
      </Card>
    </div>
  )
}
