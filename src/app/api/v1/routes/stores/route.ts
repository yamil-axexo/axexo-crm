import type { NextRequest } from 'next/server'
import { apiRead } from '@/server/api'
import { readRouteStores } from '@/domain/route-tool'

// E5.F6: lectura para la herramienta de rutas: las tiendas de una persona (permiso accounts:read, mercado de la llave).
export async function GET(request: NextRequest) {
  return apiRead(request, 'accounts:read', (key, params) => readRouteStores(key, params))
}
