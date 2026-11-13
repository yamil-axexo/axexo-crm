import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { storeProviders } from '@/dal/store-providers'
import { OPS_LABEL } from '@/domain/ops'
import { Badge } from '@/ui/kit'
import { day } from '@/lib/format'

const tone = (s: string) => (s === 'approved' ? 'good' : s === 'rejected' ? 'bad' : s === 'sent' ? 'accent' : 'neutral') as 'good' | 'bad' | 'accent' | 'neutral'

/**
 * Aprobación por proveedor de la tienda (E10.F2): corre en paralelo a la venta y se ve aquí, no como etapa del embudo.
 * Solo salen los proveedores con movimiento. Operaciones cambia el estado desde el negocio; aquí se lee.
 */
export async function StoreProviders({ ctx, accountId }: { ctx: Ctx; accountId: string }) {
  const rows = await storeProviders(ctx, accountId)
  if (rows.length === 0) return null
  const { t, locale } = ctx
  return (
    <section className="border-t border-line pt-6" data-testid="store-providers">
      <h3 className="text-[15px] leading-6 font-semibold">{t('Aprobación por proveedor', 'Approval per provider')}</h3>
      <p className="mt-1 text-[13px] text-muted">{t('Corre aparte de las etapas del negocio. La mantiene Operaciones.', 'It runs alongside the deal stages. Operations keeps it up to date.')}</p>
      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.catalog_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5" data-testid="store-provider">
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-strong">{t(r.label_es, r.label_en)}</span>
              <Link href={`/deals/${r.deal_id}`} className="block truncate text-[13px] text-blue-text underline">{r.deal_title}</Link>
            </span>
            <span className="flex items-center gap-2 text-[13px] text-muted-2">
              {r.on_date ? day(r.on_date, locale) : null}
              <Badge tone={tone(r.status)}>{t(OPS_LABEL[r.status]?.es ?? r.status, OPS_LABEL[r.status]?.en ?? r.status)}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
