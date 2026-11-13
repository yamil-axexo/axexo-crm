import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { accountByRef } from '@/dal/markets'
import { Empty } from '@/ui/kit'

const SYSTEMS = ['sales_core', 's5', 'pipedrive', 'zoho', 'emida', 'sky', 'movilway', 'other']

/**
 * Enlace directo a una ficha desde otro sistema (UX-04): /comercios/ref/<identificador>. Sirve el ID de la Sales App,
 * el Merchant ID, el de Pipedrive o el propio de CONTIGO. Si la persona no tiene sesión, entra y vuelve aquí. Si el
 * identificador no existe o el comercio no es de su alcance, se le dice sin revelar nada del comercio.
 */
export default async function RefPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ sistema?: string | string[]; tab?: string | string[] }> }) {
  const ctx = await requireCtx()
  const { t } = ctx
  const ref = decodeURIComponent((await params).ref)
  const sp = await searchParams
  const system = typeof sp.sistema === 'string' && SYSTEMS.includes(sp.sistema) ? sp.sistema : undefined
  const tab = typeof sp.tab === 'string' && ['hilo', 'arbol', 'datos'].includes(sp.tab) ? sp.tab : undefined
  const hit = await accountByRef(ctx, ref, system)
  if (hit) redirect(`/comercios/${hit.id}${tab ? `?tab=${tab}` : ''}`)
  return (
    <div className="mx-auto max-w-[620px]" data-testid="ref-missing">
      <Empty
        title={t('No encontramos un comercio con ese identificador', 'We could not find a merchant with that identifier')}
        hint={t('Puede que todavía no exista en CONTIGO o que no sea de tu lista. Búscalo por nombre o teléfono; si lo lleva otra persona, la búsqueda te dice quién.', 'It may not exist in CONTIGO yet, or it may not be on your list. Search for it by name or phone; if someone else owns it, search tells you who.')}
        action={<Link href={`/buscar?q=${encodeURIComponent(ref.slice(0, 80))}`} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="ref-search">{t('Buscar ese identificador', 'Search for that identifier')}</Link>}
      />
    </div>
  )
}
