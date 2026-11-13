import type { NextRequest } from 'next/server'
import { apiRead } from '@/server/api'
import { readFieldSignals } from '@/dal/campo-canal-api'

// CAMPO-02 / CAMPO-08: lo que la Sales App lee para armar la ruta del día: prioridad de cada tienda con su razón y el
// último puntaje de punto de venta perfecto. Llave de un mercado con permiso accounts:read; sin el grupo de control.
export async function GET(request: NextRequest) {
  return apiRead(request, 'accounts:read', (key, params) => readFieldSignals(key, params))
}
