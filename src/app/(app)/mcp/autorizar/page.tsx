import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { mcpMode } from '@/server/adapters/ai'
import { flat } from '@/server/params'
import { authorizeRequest } from '@/domain/plataforma/mcp-oauth'
import { Card, CardTitle, PageHeader, buttonClass } from '@/ui/kit'
import { approveMcpAction } from './actions'

export const dynamic = 'force-dynamic'

/**
 * IA-06: pantalla de consentimiento OAuth. Un agente pide leer CONTIGO como la persona; ella ve quién pide, qué puede hacer
 * y acepta o no. Solo existe con el servidor MCP encendido.
 */
export default async function AuthorizeAgentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (mcpMode() === 'off') notFound()
  const ctx = await requireCtx()
  const { t } = ctx
  const q = flat(await searchParams) as Record<string, string | undefined>
  const req = ctx.can('mcp.authorize') ? await authorizeRequest(ctx, q) : null
  return (
    <>
      <PageHeader eyebrow={t('Agentes', 'Agents')} title={t('Permiso para un agente', 'Permission for an agent')} />
      <Card data-testid="mcp-consent">
        {!req ? (
          <CardTitle title={t('Esta solicitud no es válida', 'This request is not valid')} hint={t('El agente no está registrado, la URL de regreso no coincide o falta el reto de seguridad. Pídele a Administración que lo revise.', 'The agent is not registered, the return URL does not match or the security challenge is missing. Ask Administration to check it.')} />
        ) : (
          <>
            <CardTitle title={t(`${req.name} quiere leer CONTIGO como tú`, `${req.name} wants to read CONTIGO as you`)} hint={t('Verá lo mismo que tú ves, solo para leer, durante una hora. Cada consulta queda en la bitácora. Puedes quitarle el permiso en cualquier momento desde Administración, Plataforma.', 'It will see what you see, read only, for one hour. Each query is logged. You can remove the permission at any time from Administration, Platform.')} />
            <form action={approveMcpAction} className="mt-5 flex flex-wrap gap-3">
              {(['client_id', 'redirect_uri', 'code_challenge', 'state'] as const).map((k) => <input key={k} type="hidden" name={k} value={q[k] ?? ''} />)}
              <button type="submit" className={buttonClass('primary')} data-testid="mcp-approve">{t('Dar permiso', 'Allow')}</button>
              <a href="/hoy" className={buttonClass('ghost')} data-testid="mcp-deny">{t('No dar permiso', 'Do not allow')}</a>
            </form>
          </>
        )}
      </Card>
    </>
  )
}
