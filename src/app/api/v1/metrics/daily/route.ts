import type { NextRequest } from 'next/server'
import { apiHandler } from '@/server/api'
import { systemCtx } from '@/server/context'
import { ingestMetricsFile } from '@/domain/integrations'
import { loadBlocked, withLoad } from '@/domain/loads'
import { DomainError } from '@/lib/errors'

// AUT-06: carga del archivo diario merchant_metrics_daily (v1) que produce S5. Idempotente por contenido.
// E5.F3/F4: es una carga: queda con inicio y fin y no entra en la ventana de mantenimiento ni junto con otra carga.
export async function POST(request: NextRequest) {
  return apiHandler(request, 'metrics:write', async (body) => {
    const out = await withLoad('sales_file', 'api', null, async () => {
      const r = await ingestMetricsFile(await systemCtx(), body)
      return { ...r, done: r.matched }
    })
    const blocked = 'rows' in out ? null : loadBlocked(out as never)
    if (blocked) throw new DomainError('busy', blocked[0], blocked[1], 409)
    const result: Record<string, unknown> = { ...(out as object) }
    delete result.done
    return result
  })
}
