'use server'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { mcpMode } from '@/server/adapters/ai'
import { approveAuthorization, authorizeRequest } from '@/domain/plataforma/mcp-oauth'

/** IA-06: la persona acepta que el agente lea CONTIGO como ella. Se vuelve a validar todo antes de emitir el código. */
export async function approveMcpAction(fd: FormData): Promise<void> {
  const ctx = await requireCtx()
  if (mcpMode() === 'off' || ctx.viewAs) redirect('/hoy')
  const p = {
    client_id: String(fd.get('client_id') ?? ''),
    redirect_uri: String(fd.get('redirect_uri') ?? ''),
    code_challenge: String(fd.get('code_challenge') ?? ''),
    code_challenge_method: 'S256',
    response_type: 'code',
    state: String(fd.get('state') ?? ''),
  }
  if (!(await authorizeRequest(ctx, p))) redirect('/hoy')
  redirect(await approveAuthorization(ctx, p))
}
