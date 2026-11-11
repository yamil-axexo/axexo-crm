import type { NextRequest } from 'next/server'
import { apiHandler } from '@/server/api'
import { systemCtx } from '@/server/context'
import { ingestMetricsFile } from '@/domain/integrations'

// AUT-06: carga del archivo diario merchant_metrics_daily (v1) que produce S5. Idempotente por contenido.
export async function POST(request: NextRequest) {
  return apiHandler(request, 'metrics:write', async (body) => ingestMetricsFile(await systemCtx(), body))
}
