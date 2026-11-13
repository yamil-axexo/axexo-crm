import { redirect } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { listPipelines } from '@/dal/pipelines'
import { Empty, PageHeader } from '@/ui/kit'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'

export default async function PipelinesIndex({ searchParams }: { searchParams: Promise<{ owner?: string; vista?: string; paso?: string; revisita?: string }> }) {
  const ctx = await requireCtx()
  const sp = flat(await searchParams)
  const pipelines = await listPipelines(ctx)
  // Cada quien aterriza donde tiene trabajo: el conteo ya viene filtrado por lo que su rol le deja ver.
  const first = [...pipelines].sort((a, b) => b.open_deals - a.open_deals)[0]
  if (first) redirect(qs(`/pipelines/${first.id}`, { owner: sp.owner, vista: sp.vista, paso: sp.revisita ? 'revisita' : sp.paso }))
  return (
    <>
      <PageHeader title={ctx.t('Negocios', 'Deals')} />
      <Empty title={ctx.t('Tu mercado todavía no tiene embudos', 'Your market has no pipelines yet')} />
    </>
  )
}
