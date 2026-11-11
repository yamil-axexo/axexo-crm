import { redirect } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { listPipelines } from '@/dal/pipelines'
import { Empty, PageHeader } from '@/ui/kit'
import { qs } from '@/lib/labels'

export default async function PipelinesIndex({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const ctx = await requireCtx()
  const sp = await searchParams
  const pipelines = await listPipelines(ctx)
  // Cada quien aterriza donde tiene trabajo: el conteo ya viene filtrado por lo que su rol le deja ver.
  const first = [...pipelines].sort((a, b) => b.open_deals - a.open_deals)[0]
  if (first) redirect(qs(`/pipelines/${first.id}`, { owner: sp.owner }))
  return (
    <>
      <PageHeader title="Pipelines" />
      <Empty title={ctx.t('Tu mercado todavía no tiene pipelines', 'Your market has no pipelines yet')} />
    </>
  )
}
