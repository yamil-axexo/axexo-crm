import type { NextRequest } from 'next/server'
import { apiRead } from '@/server/api'
import { readCatalogs } from '@/dal/api-v1'

// AUT-04: catálogos del mercado de la llave (embudos y etapas, motivos, tipos de cuenta, territorios).
export async function GET(request: NextRequest) {
  return apiRead(request, 'catalogs:read', (key) => readCatalogs(key))
}
