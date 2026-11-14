import type { NextRequest } from 'next/server'
import { apiRead, apiWrite } from '@/server/api'
import { apiCreateActivity } from '@/domain/plataforma/api-write'
import { readResource } from '@/dal/api-v1'

// AUT-04: lectura de activities (v1). Llave de un mercado con el permiso activities:read; paginación por cursor.
export async function GET(request: NextRequest) {
  return apiRead(request, 'activities:read', (key, params) => readResource(key, 'activities', params))
}

// AUT-04: escritura general. Mismo comando que la pantalla (recordActivity), como la persona dueña de la llave.
export async function POST(request: NextRequest) {
  return apiWrite(request, 'activities:write', (ctx, market, body) => apiCreateActivity(ctx, market, body))
}
