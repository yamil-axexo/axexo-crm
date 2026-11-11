import { NextResponse } from 'next/server'
import { dbHealth } from '@/server/db'

export const dynamic = 'force-dynamic'

// OBS: chequeo de vida para el balanceador. No expone datos ni versión de dependencias.
export async function GET() {
  try {
    const db = await dbHealth()
    if (!db.ok) return NextResponse.json({ status: 'degraded', db: 'not_migrated' }, { status: 503 })
    return NextResponse.json({ status: 'ok', db: 'ok' })
  } catch {
    return NextResponse.json({ status: 'degraded', db: 'unreachable' }, { status: 503 })
  }
}
