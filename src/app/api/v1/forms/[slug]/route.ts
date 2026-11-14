import type { NextRequest } from 'next/server'
import { apiHandler } from '@/server/api'
import { systemCtx } from '@/server/context'
import { intakeFromForm } from '@/domain/leads'
import { DomainError, invalid } from '@/lib/errors'
import { ZodError } from 'zod'
import { holdForRetry } from '@/domain/embudo/intake-retry'

// Conecta un formulario del sitio web con CONTIGO. El backend del sitio manda el JSON con su llave y un Idempotency-Key.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return apiHandler(request, 'forms:write', async (body, key) => {
    if (!key || key.length < 8 || key.length > 120) throw invalid('Falta el encabezado Idempotency-Key.', 'The Idempotency-Key header is required.')
    try {
      const out = await intakeFromForm(await systemCtx(), slug, body, `api:${key}`)
      // E3.F10: sin dueño no se crea el lead; el envío queda retenido en CONTIGO hasta que haya a quién dárselo.
      if (out.held) return { status: 'accepted', lead_id: null, retry: 'held_no_owner' }
      return { status: out.duplicate ? 'duplicate' : 'created', lead_id: out.leadId }
    } catch (e) {
      // E3.F8: datos inválidos se devuelven a quien llama; una falla nuestra retiene el envío y se reintenta sola.
      if (e instanceof DomainError || e instanceof ZodError) throw e
      await holdForRetry(slug, `api:${key}`, body, e)
      return { status: 'accepted', lead_id: null, retry: 'held' }
    }
  })
}
