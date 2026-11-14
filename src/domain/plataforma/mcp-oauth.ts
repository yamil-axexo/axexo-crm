import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { withUser, withoutUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'

/**
 * IA-06: OAuth 2.1 con PKCE (S256) para que un agente (cliente MCP) entre al servidor MCP COMO la persona: mismo alcance,
 * mismas capacidades por herramienta y su bitácora. No hay contraseña ni llave compartida:
 * 1. Administración registra el cliente (nombre y URL de regreso) y le da su client_id. Sin secreto: es un cliente público.
 * 2. El agente manda a la persona a /mcp/autorizar con client_id, redirect_uri, code_challenge (S256) y state.
 * 3. La persona, con su sesión, ve qué agente pide acceso y acepta. Sale un código de un solo uso de 5 minutos.
 * 4. El agente canjea el código en /api/mcp/oauth/token con su code_verifier y recibe un token de acceso de 60 minutos.
 * 5. Cada llamada a /api/mcp con ese token corre como la persona. La persona o administración revoca cuando quiera.
 * Sin tokens de renovación: al vencer, la persona vuelve a autorizar. Todo esto existe solo con el servidor MCP encendido.
 */
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const b64url = (buf: Buffer) => buf.toString('base64url')
export const TOKEN_MINUTES = 60

const redirectOk = (u: string) => {
  try {
    const url = new URL(u)
    if (url.hash) return false
    return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))
  } catch {
    return false
  }
}

export type McpClient = { client_id: string; name: string; redirect_uris: string[]; created_at: Date; revoked_at: Date | null; active_tokens: number }

export async function mcpClients(ctx: Ctx): Promise<McpClient[]> {
  if (!ctx.can('integration.operate')) return []
  return withUser(ctx.user.id, (tx) => tx<McpClient[]>`
    select c.client_id, c.name, c.redirect_uris, c.created_at, c.revoked_at,
           (select count(*)::int from crm.mcp_oauth_tokens t where t.client_id = c.client_id and t.revoked_at is null and t.expires_at > now()) as active_tokens
      from crm.mcp_oauth_clients c order by c.created_at desc`)
}

export async function createMcpClient(ctx: Ctx, name: string, redirectUri: string): Promise<string> {
  ctx.assert('integration.operate')
  const n = z.string().trim().min(3).max(80).safeParse(name)
  if (!n.success) throw invalid('Ponle nombre al agente (3 a 80 letras).', 'Name the agent (3 to 80 characters).')
  if (!redirectOk(redirectUri.trim())) throw invalid('La URL de regreso tiene que ser https (o http a 127.0.0.1 para una app local).', 'The return URL must be https (or http to 127.0.0.1 for a local app).')
  const clientId = `mcpc_${b64url(randomBytes(18))}`
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.mcp_oauth_clients (client_id, name, redirect_uris, created_by) values (${clientId}, ${n.data}, ${[redirectUri.trim()]}, ${ctx.user.id})`
    await audit(tx, ctx, 'mcp_oauth.client_created', 'mcp_oauth_client', null, null, null, { client_id: clientId, name: n.data })
  })
  return clientId
}

export async function revokeMcpClient(ctx: Ctx, clientId: string): Promise<void> {
  ctx.assert('integration.operate')
  await withUser(ctx.user.id, async (tx) => {
    const r = await tx`update crm.mcp_oauth_clients set revoked_at = now() where client_id = ${clientId} and revoked_at is null`
    if (r.count === 0) throw notFound()
    await tx`update crm.mcp_oauth_tokens set revoked_at = now() where client_id = ${clientId} and revoked_at is null`
    await audit(tx, ctx, 'mcp_oauth.revoked', 'mcp_oauth_client', null, null, null, { client_id: clientId })
  })
}

/** Lo que la pantalla de consentimiento muestra: el cliente existe, no está revocado y la URL de regreso es la registrada. */
export async function authorizeRequest(ctx: Ctx, p: { client_id?: string; redirect_uri?: string; code_challenge?: string; code_challenge_method?: string; response_type?: string }): Promise<{ name: string } | null> {
  if (p.response_type !== 'code' || p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge ?? '')) return null
  const rows = await withUser(ctx.user.id, (tx) => tx<{ name: string | null }[]>`select app.mcp_oauth_client_name(${p.client_id ?? ''}, ${p.redirect_uri ?? ''}) as name`)
  return rows[0]?.name ? { name: rows[0].name } : null
}

/** La persona acepta: devuelve la URL de regreso con el código y el state. */
export async function approveAuthorization(ctx: Ctx, p: { client_id: string; redirect_uri: string; code_challenge: string; state: string }): Promise<string> {
  ctx.assert('mcp.authorize')
  const code = b64url(randomBytes(32))
  await withUser(ctx.user.id, (tx) => tx`select app.mcp_oauth_issue_code(${p.client_id}, ${p.redirect_uri}, ${p.code_challenge}, ${sha(code)})`)
  const back = new URL(p.redirect_uri)
  back.searchParams.set('code', code)
  if (p.state) back.searchParams.set('state', p.state.slice(0, 200))
  return back.toString()
}

export type TokenResponse = { access_token: string; token_type: 'Bearer'; expires_in: number; scope: string } | { error: 'invalid_request' | 'invalid_grant' | 'unsupported_grant_type' }

/** Canje del código con PKCE. Un código usado, vencido, de otro cliente o con un verificador que no corresponde: invalid_grant. */
export async function exchangeCode(form: URLSearchParams): Promise<TokenResponse> {
  if (form.get('grant_type') !== 'authorization_code') return { error: 'unsupported_grant_type' }
  const code = form.get('code') ?? ''
  const client = form.get('client_id') ?? ''
  const redirect = form.get('redirect_uri') ?? ''
  const verifier = form.get('code_verifier') ?? ''
  if (!code || !client || !redirect || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return { error: 'invalid_request' }
  return withoutUser(async (tx) => {
    const rows = await tx<{ user_id: string; code_challenge: string; scope: string }[]>`select * from app.mcp_oauth_redeem(${sha(code)}, ${client}, ${redirect})`
    const r = rows[0]
    if (!r) return { error: 'invalid_grant' as const }
    if (b64url(createHash('sha256').update(verifier).digest()) !== r.code_challenge) return { error: 'invalid_grant' as const }
    const token = `mcpt_${b64url(randomBytes(32))}`
    await tx`select app.mcp_oauth_store_token(${sha(token)}, ${client}, ${r.user_id}::uuid, ${r.scope}, ${TOKEN_MINUTES})`
    return { access_token: token, token_type: 'Bearer' as const, expires_in: TOKEN_MINUTES * 60, scope: r.scope }
  })
}

/** A quién representa un token de acceso vigente. */
export async function tokenUser(raw: string): Promise<{ userId: string; clientId: string } | null> {
  if (!raw.startsWith('mcpt_')) return null
  const rows = await withoutUser((tx) => tx<{ user_id: string; client_id: string }[]>`select * from app.mcp_oauth_user(${sha(raw)})`)
  return rows[0] ? { userId: rows[0].user_id, clientId: rows[0].client_id } : null
}
