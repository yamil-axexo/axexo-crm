import { NextResponse } from 'next/server'
import { mcpMode } from '@/server/adapters/ai'

export const dynamic = 'force-dynamic'

/** IA-06: metadatos OAuth 2.1 del servidor de autorización (RFC 8414). Solo con el servidor MCP encendido. */
export async function GET(req: Request) {
  if (mcpMode() === 'off') return new NextResponse(null, { status: 404 })
  const base = new URL(req.url).origin
  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/mcp/autorizar`,
    token_endpoint: `${base}/api/mcp/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['crm:read'],
  })
}
