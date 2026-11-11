import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { getAccount } from '@/dal/accounts'
import { Ficha, fichaTab, type FichaTab } from '../ficha'
import { flat } from '@/server/params'

/** La ficha a pantalla completa: a donde llegan los enlaces directos (Hoy, Buscar, un negocio). Desde la lista se abre como panel. */
export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCtx()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const data = await getAccount(ctx, id)
  if (!data) notFound()
  const tab = fichaTab(flat(await searchParams).tab)
  const href = (to: string, t?: FichaTab) => `/comercios/${to}${t && t !== 'hilo' ? `?tab=${t}` : ''}`
  return (
    <div className="mx-auto max-w-[720px]">
      <Link href="/comercios" className="mb-4 inline-flex items-center gap-1 text-[14px] font-medium text-blue-text hover:underline" data-testid="ficha-back">
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
        {ctx.m('record.back')}
      </Link>
      <div className="card p-5 md:p-8">
        <Ficha ctx={ctx} data={data} tab={tab} mode="page" href={href} closeHref="/comercios" />
      </div>
    </div>
  )
}
