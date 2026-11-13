import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized, runDue } from '@/server/jobs/runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Disparo externo de las tareas programadas. Sin CRON_SECRET en el ambiente está apagado: responde 503 y no corre nada.
 * Con secreto, pide `Authorization: Bearer <secreto>` y corre lo que ya toca. La respuesta dice qué corrió, sin datos.
 */
export async function POST(request: NextRequest) {
  const auth = cronAuthorized(request.headers.get('authorization'))
  if (auth === 'off') return NextResponse.json({ error: 'cron_off' }, { status: 503 })
  if (auth === 'no') return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const ran = await runDue('cron')
  return NextResponse.json({ ran: ran.map((r) => ({ key: r.key, status: r.status, done: r.done ?? 0, ms: r.ms ?? 0 })) })
}
