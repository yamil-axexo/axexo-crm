import type { NextRequest } from 'next/server'
import { apiHandler } from '@/server/api'
import { systemCtx } from '@/server/context'
import { intakeFromForm } from '@/domain/leads'
import { invalid } from '@/lib/errors'

// Conecta un formulario del sitio web con CONTIGO. El backend del sitio manda el JSON con su llave y un Idempotency-Key.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return apiHandler(request, 'forms:write', async (body, key) => {
    if (!key || key.length < 8 || key.length > 120) throw invalid('Falta el encabezado Idempotency-Key.', 'The Idempotency-Key header is required.')
    const out = await intakeFromForm(await systemCtx(), slug, body, `api:${key}`)
    return { status: out.duplicate ? 'duplicate' : 'created', lead_id: out.leadId }
  })
}
