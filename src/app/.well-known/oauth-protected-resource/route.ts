import { NextResponse } from 'next/server'
import { mcpMode } from '@/server/adapters/ai'

export const dynamic = 'force-dynamic'

/** IA-06: metadatos del recurso protegido (RFC 9728): el servidor MCP y quién emite sus tokens. */
export async function GET(req: Request) {
  if (mcpMode() === 'off') return new NextResponse(null, { status: 404 })
  const base = new URL(req.url).origin
  return NextResponse.json({ resource: `${base}/api/mcp`, authorization_servers: [base], scopes_supported: ['crm:read'], bearer_methods_supported: ['header'] })
}
