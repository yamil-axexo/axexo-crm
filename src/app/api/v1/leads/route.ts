import type { NextRequest } from 'next/server'
import { apiRead, apiWrite } from '@/server/api'
import { apiCreateLead } from '@/domain/plataforma/api-write'
import { readResource } from '@/dal/api-v1'

// AUT-04: lectura de leads (v1). Llave de un mercado con el permiso leads:read; paginación por cursor.
export async function GET(request: NextRequest) {
  return apiRead(request, 'leads:read', (key, params) => readResource(key, 'leads', params))
}

// AUT-04: escritura general. Mismo comando que la pantalla (createLead): reparto, reloj de primer contacto y bitácora.
export async function POST(request: NextRequest) {
  return apiWrite(request, 'leads:write', (ctx, market, body) => apiCreateLead(ctx, market, body))
}
