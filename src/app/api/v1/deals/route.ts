import type { NextRequest } from 'next/server'
import { apiRead } from '@/server/api'
import { readResource } from '@/dal/api-v1'

// AUT-04: lectura de deals (v1). Llave de un mercado con el permiso deals:read; paginación por cursor.
export async function GET(request: NextRequest) {
  return apiRead(request, 'deals:read', (key, params) => readResource(key, 'deals', params))
}
