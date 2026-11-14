import type { NextRequest } from 'next/server'
import { apiWrite } from '@/server/api'
import { apiUpdateAccount } from '@/domain/plataforma/api-write'

// AUT-04: corregir datos de contacto y dirección de un comercio con el mismo comando que la pantalla (updateAccount).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return apiWrite(request, 'accounts:write', (ctx, market, body) => apiUpdateAccount(ctx, market, id, body))
}
