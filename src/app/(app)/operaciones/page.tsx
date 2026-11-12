import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getOpsQueue, opsMarkets, type OpsFocus, type OpsView } from '@/dal/ops'
import { flat } from '@/server/params'
import { Badge, Empty, PageHeader, Pills, Stat, cx } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { daysSince, day } from '@/lib/format'
import { qs } from '@/lib/labels'
import { takeDealAction } from './actions'

/** Cola de Operaciones: la pantalla de inicio de quien es de Operaciones. */
export default async function OpsQueuePage({ searchParams }: { searchParams: Promise<{ ver?: string; mercado?: string; foco?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  if (opsMarkets(ctx).length === 0) notFound()
  const sp = flat(await searchParams)
  const view: OpsView = sp.ver === 'mios' ? 'mine' : sp.ver === 'todos' ? 'all' : 'unassigned'
  const focus: OpsFocus | undefined = sp.foco === 'aprobacion' ? 'approval' : sp.foco === 'capacitacion' ? 'training' : undefined
  const q = await getOpsQueue(ctx, { view, market: sp.mercado, focus })
  const many = q.markets.length > 1
  const here = (patch: Record<string, string | undefined>) => qs('/operaciones', { ver: sp.ver, mercado: sp.mercado, ...patch })
  const now = new Date()
  const seg = (on: boolean) => cx('press inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium', on ? 'bg-ink text-white' : 'text-strong hover:bg-green-50')

  return (
    <>
      <PageHeader
        title={t('Cola de Operaciones', 'Operations queue')}
        desc={t('Negocios que Ventas ya entregó. Toma uno para llevarlo; si llegó incompleto, devuélvelo con el motivo.', 'Deals Sales has handed over. Take one to run it; if it arrived incomplete, send it back with the reason.')}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="ops-numbers">
        <Stat label={t('Sin tomar', 'Not taken')} value={q.counts.unassigned} tone={q.counts.unassigned ? 'warn' : undefined} href={here({ ver: undefined, foco: undefined })} testId="ops-n-unassigned" />
        <Stat label={t('Míos', 'Mine')} value={q.counts.mine} href={here({ ver: 'mios', foco: undefined })} testId="ops-n-mine" />
        <Stat label={t('Pendientes de aprobación', 'Awaiting approval')} value={q.counts.approval} hint={t('Con algún proveedor sin respuesta', 'With a provider still to answer')} href={here({ foco: 'aprobacion' })} testId="ops-n-approval" />
        <Stat label={t('Pendientes de capacitación', 'Awaiting training')} value={q.counts.training} hint={t('Capacitación sin hacer', 'Training not done yet')} href={here({ foco: 'capacitacion' })} testId="ops-n-training" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Pills label={t('Qué ver', 'What to show')} current={focus ? '' : view}
          items={[
            { key: 'unassigned', href: here({ ver: undefined, foco: undefined }), label: t('Sin tomar', 'Not taken'), count: q.counts.unassigned },
            { key: 'mine', href: here({ ver: 'mios', foco: undefined }), label: t('Míos', 'Mine'), count: q.counts.mine },
            { key: 'all', href: here({ ver: 'todos', foco: undefined }), label: t('Todos', 'All'), count: q.counts.all },
          ]} />
        {many && (
          <nav aria-label={t('Mercado', 'Market')} className="inline-flex rounded-full border border-line bg-surface p-1" data-testid="ops-market-filter">
            <Link href={here({ mercado: undefined, foco: sp.foco })} aria-current={!sp.mercado ? 'page' : undefined} className={seg(!sp.mercado)}>{t('Todos los mercados', 'All markets')}</Link>
            {q.markets.map((mk) => <Link key={mk} href={here({ mercado: mk, foco: sp.foco })} aria-current={sp.mercado === mk ? 'page' : undefined} className={seg(sp.mercado === mk)} data-testid={`ops-market-${mk}`}>{mk}</Link>)}
          </nav>
        )}
        {focus && <Badge tone="accent">{focus === 'approval' ? t('Pendientes de aprobación', 'Awaiting approval') : t('Pendientes de capacitación', 'Awaiting training')}</Badge>}
      </div>

      {q.rows.length === 0 ? (
        <Empty title={view === 'unassigned' && !focus ? t('No hay nada sin tomar.', 'Nothing is waiting to be taken.') : t('No hay negocios aquí.', 'No deals here.')}
          hint={t('Cuando Ventas entregue un negocio, aparece en esta cola.', 'When Sales hands over a deal, it shows up in this queue.')} />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden" data-testid="ops-queue">
          {q.rows.map((r) => {
            const days = daysSince(r.since, now)
            const missing = [
              r.docs_missing ? t(`${r.docs_missing} ${r.docs_missing === 1 ? 'documento por recibir' : 'documentos por recibir'}`, `${r.docs_missing} ${r.docs_missing === 1 ? 'document to receive' : 'documents to receive'}`) : null,
              r.providers_pending ? t(`${r.providers_pending} ${r.providers_pending === 1 ? 'proveedor sin respuesta' : 'proveedores sin respuesta'}`, `${r.providers_pending} ${r.providers_pending === 1 ? 'provider to answer' : 'providers to answer'}`) : null,
              r.checklist && r.training_status !== 'done' ? (r.training_status === 'scheduled' ? t('capacitación agendada', 'training scheduled') : t('capacitación pendiente', 'training pending')) : null,
            ].filter(Boolean)
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 md:px-5" data-testid="ops-row">
                <div className="min-w-[220px] flex-1">
                  <Link href={`/deals/${r.id}`} className="block text-[15px] font-semibold text-strong underline-offset-2 hover:underline" data-testid="ops-row-link">{r.title}</Link>
                  <p className="text-[13.5px] text-muted-2">
                    {[r.account_name, many ? r.market_code : null, t(r.stage_es, r.stage_en),
                      // En pausa no envejece en la cola: dice cuándo se revisa en vez de cuántos días lleva.
                      r.paused_at ? null : t(`${days} ${days === 1 ? 'día' : 'días'} aquí`, `${days} ${days === 1 ? 'day' : 'days'} here`)].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-[13px] text-muted">
                    {t(`Vendió: ${r.seller ?? 'sin asignar'}`, `Sold by: ${r.seller ?? 'no owner'}`)}
                    {r.ops_owner ? ` · ${t(`Lo lleva ${r.ops_owner}`, `Handled by ${r.ops_owner}`)}` : ''}
                    {r.ops_next_step ? ` · ${r.ops_next_step} (${day(r.ops_next_step_due, locale)})` : ''}
                  </p>
                </div>
                <p className="flex flex-wrap gap-1.5" data-testid="ops-missing">
                  {many && <Badge tone="info">{r.market_code}</Badge>}
                  {r.paused_at && <span data-testid="ops-row-paused"><Badge tone="neutral">{t(`En pausa${r.pause_review_on ? ` · se revisa el ${day(r.pause_review_on, locale)}` : ''}`, `On hold${r.pause_review_on ? ` · review on ${day(r.pause_review_on, locale)}` : ''}`)}</Badge></span>}
                  {missing.length === 0 ? <Badge tone="good">{t('Completo', 'Complete')}</Badge> : missing.map((x) => <Badge key={x} tone="warn">{x}</Badge>)}
                </p>
                {r.ops_owner_id !== ctx.user.id && (
                  <ActionForm action={takeDealAction}>
                    <input type="hidden" name="deal_id" value={r.id} />
                    <Submit variant={r.ops_owner_id ? 'ghost' : 'primary'} size="sm" testId="ops-row-take">{t('Tomar', 'Take')}</Submit>
                  </ActionForm>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
