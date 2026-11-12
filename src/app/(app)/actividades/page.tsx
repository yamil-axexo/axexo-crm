import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { withUser } from '@/server/db'
import { Card, Empty, PageHeader, Pills, Badge } from '@/ui/kit'
import { CompleteButton } from '@/ui/complete'
import { sheetConfig, taskItem } from '@/server/sheet'
import { day } from '@/lib/format'
import { ACTIVITY, lab, qs } from '@/lib/labels'
import { completeItemAction } from '@/app/(app)/hoy/actions'
import { flat } from '@/server/params'

type Row = { id: string; kind: string; subject: string; due_at: Date | null; done_at: Date | null; account_id: string | null; account_name: string | null; deal_id: string | null; owner_name: string | null }

export default async function ActividadesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const view = flat(await searchParams).view ?? 'mine'
  const rows = await withUser(ctx.user.id, (tx) => tx<Row[]>`
    select a.id, a.kind, a.subject, a.due_at, a.done_at, a.account_id, ac.name as account_name, a.deal_id, u.full_name as owner_name
      from crm.activities a left join crm.accounts ac on ac.id = a.account_id left join crm.users u on u.id = a.owner_id
     where a.kind in ('task','handoff','visit')
       ${view === 'done' ? tx`and a.done_at is not null and a.owner_id = ${ctx.user.id}` : view === 'team' ? tx`and a.done_at is null` : tx`and a.done_at is null and a.owner_id = ${ctx.user.id}`}
     order by ${view === 'done' ? tx`a.done_at desc` : tx`a.due_at nulls last`} limit 80`)
  const now = new Date()
  const config = sheetConfig(ctx, now)

  return (
    <>
      <PageHeader title={t('Actividades', 'Activities')} desc={t('Tareas y entregas a Operaciones con fecha. Las notas, llamadas y visitas viven en el hilo de cada comercio.', 'Dated tasks and handoffs to Operations. Notes, calls and visits live on each merchant’s thread.')} />
      <Pills
        label={t('Vista', 'View')}
        current={view}
        items={[
          { key: 'mine', href: '/actividades', label: t('Mías, abiertas', 'Mine, open') },
          ...(ctx.can('board.supervisor') ? [{ key: 'team', href: qs('/actividades', { view: 'team' }), label: t('Del equipo', 'Team') }] : []),
          { key: 'done', href: qs('/actividades', { view: 'done' }), label: t('Hechas', 'Done') },
        ]}
      />
      <Card className="mt-6" pad={false}>
        {rows.length === 0 ? (
          <div className="p-7"><Empty title={t('Nada por aquí', 'Nothing here')} hint={t('Cuando un negocio tenga próximo paso, la tarea aparece sola.', 'When a deal has a next step, the task shows up on its own.')} /></div>
        ) : (
          <ul data-testid="task-list">
            {rows.map((r) => {
              const late = !r.done_at && r.due_at && new Date(r.due_at) < now
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-line px-4 py-4 first:border-t-0 md:px-7" data-testid="task-row">
                  {!r.done_at && ctx.can('activity.write') && <CompleteButton item={taskItem(ctx, r, r.account_name ?? r.subject)} config={config} action={completeItemAction} />}
                  <Link href={r.deal_id ? `/deals/${r.deal_id}` : r.account_id ? `/comercios/${r.account_id}` : '#'} className="min-w-0 flex-1 basis-[200px]">
                    <span className="block truncate text-[14.5px] font-semibold text-strong">{r.subject}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted-2">{[r.account_name, view === 'team' ? r.owner_name : null].filter(Boolean).join(' · ') || '—'}</span>
                  </Link>
                  {r.kind === 'handoff' && <Badge tone="info">{lab(t, ACTIVITY.handoff)}</Badge>}
                  <span className={`w-28 text-right text-[13px] ${late ? 'font-semibold text-red-text' : 'text-muted-2'}`}>{day(r.done_at ?? r.due_at, locale)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
