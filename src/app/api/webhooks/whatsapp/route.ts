import { NextResponse, type NextRequest } from 'next/server'
import { withSystem } from '@/server/db'
import { whatsappCaptureAdapter } from '@/server/adapters/partners'
import { parseWhatsappWebhook, verifyMetaSignature } from '@/server/adapters/live/messaging'
import { ingestWhatsapp } from '@/domain/conectores/capture'

export const dynamic = 'force-dynamic'

/**
 * ACT-03: webhook entrante de WhatsApp Cloud API. Con la captura apagada la ruta no existe (404).
 * GET: verificación de Meta (hub.verify_token). POST: firma X-Hub-Signature-256 obligatoria; sin firma válida, 401 y nada entra.
 * Solo se ligan mensajes de teléfonos de contactos o comercios conocidos; el texto del mensaje no se guarda.
 */
const MAX_BYTES = 1_000_000

export async function GET(req: NextRequest) {
  if (whatsappCaptureAdapter().mode === 'off') return new NextResponse(null, { status: 404 })
  const q = req.nextUrl.searchParams
  const token = process.env.WHATSAPP_VERIFY_TOKEN ?? ''
  if (q.get('hub.mode') === 'subscribe' && token && q.get('hub.verify_token') === token) {
    return new NextResponse((q.get('hub.challenge') ?? '').slice(0, 200), { status: 200, headers: { 'content-type': 'text/plain' } })
  }
  return new NextResponse(null, { status: 403 })
}

export async function POST(req: NextRequest) {
  if (whatsappCaptureAdapter().mode === 'off') return new NextResponse(null, { status: 404 })
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > MAX_BYTES) return new NextResponse(null, { status: 413 })
  const raw = await req.text()
  if (raw.length > MAX_BYTES) return new NextResponse(null, { status: 413 })
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET ?? '')) return new NextResponse(null, { status: 401 })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  const msgs = parseWhatsappWebhook(body)
  const r = msgs.length ? await withSystem((tx, sys) => ingestWhatsapp(tx, sys, msgs)) : { linked: 0, discarded: 0, duplicates: 0 }
  return NextResponse.json({ ok: true, linked: r.linked, discarded: r.discarded })
}
