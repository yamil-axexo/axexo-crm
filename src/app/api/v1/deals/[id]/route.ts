import type { NextRequest } from 'next/server'
import { apiWrite } from '@/server/api'
import { apiMoveDeal } from '@/domain/plataforma/api-write'

// AUT-04: mover un negocio de etapa con el mismo comando que la pantalla (moveDeal): pasos, aprobaciones y bitácora.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return apiWrite(request, 'deals:write', (ctx, market, body) => apiMoveDeal(ctx, market, id, body))
}
