import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getBoard, listPipelines, BOARD_LIMIT } from '@/dal/pipelines'
import { track } from '@/dal/boards'
import { Badge, PageHeader, Pills, cx } from '@/ui/kit'
import { day, daysSince, money } from '@/lib/format'
import { MOTOR, lab, qs } from '@/lib/labels'

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ owner?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  const sp = await searchParams
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const [board, pipelines] = await Promise.all([getBoard(ctx, id, { owner: sp.owner }), listPipelines(ctx)])
  if (!board) notFound()
  await track(ctx, 'view.pipeline')
  const market = ctx.market(board.pipeline.market_code)
  const open = board.stages.filter((s) => s.kind === 'open' || s.kind === 'awaiting_txn')
  const total = (stageId: string) => board.totals.find((x) => x.stage_id === stageId)
  const revisits = board.totals.reduce((n, x) => n + x.revisits, 0)
  const now = new Date()

  return (
    <>
      <PageHeader
        eyebrow={`${market.name} · ${lab(t, MOTOR[board.pipeline.motor])}`}
        title={board.pipeline.name}
        desc={t('Un deal avanza cuando cumple el criterio de la etapa, y se gana solo cuando S5 reporta la primera transacción.', 'A deal moves forward when it meets the stage criteria, and is won only when S5 reports the first transaction.')}
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Pills label="Pipelines" current={id} items={pipelines.map((p) => ({ key: p.id, href: qs(`/pipelines/${p.id}`, { owner: sp.owner }), label: `${p.market_code} · ${p.name}`, count: p.open_deals }))} />
        <Pills
          label={t('Dueño', 'Owner')}
          current={sp.owner ?? ''}
          items={[
            { key: '', href: `/pipelines/${id}`, label: t('De todos', 'Everyone') },
            { key: 'me', href: qs(`/pipelines/${id}`, { owner: 'me' }), label: t('Míos', 'Mine') },
          ]}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-3 text-[13.5px]" data-testid="board-summary">
        <Badge tone={revisits ? 'warn' : 'neutral'}>{t(`${revisits} con revisita al decisor`, `${revisits} with a decision-maker revisit`)}</Badge>
        <Badge tone="good">{t(`${board.closed.won} ganados en 30 días`, `${board.closed.won} won in 30 days`)}</Badge>
        <Badge>{t(`${board.closed.lost} perdidos en 30 días`, `${board.closed.lost} lost in 30 days`)}</Badge>
      </div>

      <div className="-mx-2 flex gap-5 overflow-x-auto px-2 pb-4" data-testid="board">
        {open.map((s) => {
          const deals = board.deals.filter((d) => d.stage_id === s.id)
          const tot = total(s.id)
          return (
            <section key={s.id} className="min-w-[240px] flex-1 basis-0" data-testid={`stage-${s.code}`} aria-label={t(s.name_es, s.name_en)}>
              <header className={cx('rounded-[20px] px-5 py-4', s.kind === 'awaiting_txn' ? 'stage on-ink' : 'bg-surface-3')}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[14.5px] font-semibold">{t(s.name_es, s.name_en)}</h2>
                  <span className="num text-[13px] font-semibold text-muted-2" data-testid={`stage-count-${s.code}`}>{tot?.n ?? 0}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-muted-2">
                  {tot?.amount ? money(Number(tot.amount), market.currency, locale, true) : t(s.exit_es, s.exit_en)}
                </p>
              </header>
              <ul className="mt-3 space-y-3">
                {deals.map((d) => {
                  const days = daysSince(d.stage_entered_at, now)
                  const stalled = s.kind === 'open' && s.rot_days > 0 && days > s.rot_days
                  const noStep = s.kind === 'open' && !d.next_step
                  return (
                    <li key={d.id}>
                      <Link href={`/deals/${d.id}`} className="card lift block !rounded-[20px] p-4" data-testid="deal-card">
                        <p className="truncate text-[14px] font-semibold text-strong">{d.account_name}</p>
                        <p className="mt-0.5 truncate text-[12.5px] text-muted-2">{d.owner_name ?? t('Sin dueño', 'No owner')}{d.amount_minor ? ` · ${money(Number(d.amount_minor), d.currency, locale, true)}` : ''}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {d.revisit_needed && <Badge tone="warn" title={d.revisit_due ? day(d.revisit_due, locale) : undefined}>{t('Revisita al decisor', 'Decision-maker revisit')}</Badge>}
                          {stalled && <Badge tone="bad">{t(`${days} días aquí`, `${days} days here`)}</Badge>}
                          {noStep && <Badge tone="bad">{t('Sin próximo paso', 'No next step')}</Badge>}
                          {s.kind === 'awaiting_txn' && <Badge tone="info">{t(`${days} días esperando`, `${days} days waiting`)}</Badge>}
                        </div>
                        {d.next_step && s.kind === 'open' && <p className="mt-3 truncate text-[12.5px] text-muted">→ {d.next_step}{d.next_step_due ? ` · ${day(d.next_step_due, locale)}` : ''}</p>}
                      </Link>
                    </li>
                  )
                })}
                {deals.length === 0 && <li className="rounded-[20px] border border-dashed border-line-2 px-4 py-8 text-center text-[13px] text-muted">{t('Sin deals en esta etapa', 'No deals in this stage')}</li>}
                {(tot?.n ?? 0) > BOARD_LIMIT && <li className="px-2 text-[12.5px] text-muted">{t(`Se muestran ${BOARD_LIMIT} de ${tot?.n}; primero los que piden revisita y los más antiguos.`, `Showing ${BOARD_LIMIT} of ${tot?.n}; revisits and oldest first.`)}</li>}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}
