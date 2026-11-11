import type { NextRequest } from 'next/server'
import { apiHandler } from '@/server/api'
import { systemCtx } from '@/server/context'
import { ingestSalesAppEvent } from '@/domain/integrations'

// CAMPO-01: entrada de eventos de la Sales App (contrato v1). Idempotente por event_id.
export async function POST(request: NextRequest) {
  return apiHandler(request, 'events:write', async (body) => ingestSalesAppEvent(await systemCtx(), body))
}
