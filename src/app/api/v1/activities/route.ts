import type { NextRequest } from 'next/server'
import { apiRead } from '@/server/api'
import { readResource } from '@/dal/api-v1'

// AUT-04: lectura de activities (v1). Llave de un mercado con el permiso activities:read; paginación por cursor.
export async function GET(request: NextRequest) {
  return apiRead(request, 'activities:read', (key, params) => readResource(key, 'activities', params))
}
