import type { NextRequest } from 'next/server'
import { apiHandler } from '@/server/api'
import { systemCtx } from '@/server/context'
import { ingestStoreSales } from '@/domain/store-sales'
import { loadBlocked, withLoad } from '@/server/loads'
import { DomainError } from '@/lib/errors'

// E5.F1: archivo de cifras de ventas por tienda (store_sales_daily v1, docs/contracts/store-sales-daily-v1.md). Idempotente
// por contenido. Es una carga: queda con inicio y fin y no entra en la ventana de mantenimiento ni junto con otra carga.
export async function POST(request: NextRequest) {
  return apiHandler(request, 'metrics:write', async (body) => {
    const out = await withLoad('store_sales', 'api', null, async () => {
      const r = await ingestStoreSales(await systemCtx(), body)
      return { ...r, done: r.matched }
    })
    const blocked = 'batchId' in out || 'lines' in out ? null : loadBlocked(out as never)
    if (blocked) throw new DomainError('busy', blocked[0], blocked[1], 409)
    const { done: _done, ...result } = out as { done: number }
    return result
  })
}
