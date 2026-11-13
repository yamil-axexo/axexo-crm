import type { NextRequest } from 'next/server'
import { apiHandler } from '@/server/api'
import { systemCtx } from '@/server/context'
import { ingestRouteCheckin } from '@/domain/route-tool'

// E5.F6: el check-in que devuelve la herramienta de rutas entra como visita. Idempotente por checkin_id.
export async function POST(request: NextRequest) {
  return apiHandler(request, 'events:write', async (body) => ingestRouteCheckin(await systemCtx(), body))
}
