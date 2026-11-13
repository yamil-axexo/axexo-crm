import { NextResponse } from 'next/server'
import { getCtx } from '@/server/context'
import { mcpMode } from '@/server/adapters/ai'
import { callTool, MCP_TOOLS } from '@/server/mcp/tools'
import { DomainError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

/**
 * IA-06: servidor MCP de solo lectura (JSON-RPC: initialize, tools/list, tools/call). APAGADO: sin MCP_SERVER=simulated
 * (solo en pruebas) esta ruta no existe. Encenderlo de verdad necesita ingreso por persona (OAuth) y la revisión de tecnología.
 */
const gone = () => new NextResponse(null, { status: 404 })
const rpc = (id: unknown, body: Record<string, unknown>) => NextResponse.json({ jsonrpc: '2.0', id: id ?? null, ...body }, { headers: { 'Cache-Control': 'no-store' } })

export async function GET() {
  return gone()
}

export async function POST(req: Request) {
  if (mcpMode() === 'off') return gone()
  const ctx = await getCtx()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let msg: { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
  try {
    msg = await req.json()
  } catch {
    return rpc(null, { error: { code: -32700, message: 'Parse error' } })
  }
  if (msg.method === 'initialize') return rpc(msg.id, { result: { protocolVersion: '2025-06-18', serverInfo: { name: 'contigo-read', version: '1' }, capabilities: { tools: {} } } })
  if (msg.method === 'tools/list') {
    return rpc(msg.id, { result: { tools: MCP_TOOLS.filter((t) => ctx.can(t.cap)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } })
  }
  if (msg.method === 'tools/call') {
    try {
      const out = await callTool(ctx, String(msg.params?.name ?? ''), msg.params?.arguments ?? {})
      return rpc(msg.id, { result: { content: [{ type: 'text', text: JSON.stringify(out) }] } })
    } catch (e) {
      if (e instanceof DomainError) return rpc(msg.id, { result: { isError: true, content: [{ type: 'text', text: e.code }] } })
      throw e
    }
  }
  return rpc(msg.id, { error: { code: -32601, message: 'Method not found' } })
}
