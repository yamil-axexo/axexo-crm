import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { Capability } from '@/domain/policy'
import { audit } from '@/domain/common'
import { logCall } from '@/domain/ia/commands'
import { accountBrief, askMetric, openRecommendations } from '@/dal/ia'
import { searchAll } from '@/dal/accounts'
import { forbidden, invalid } from '@/lib/errors'

/**
 * IA-06: herramientas del servidor MCP de CONTIGO. Solo lectura: no hay ninguna que escriba (la de escritura sería un servidor
 * aparte, después). Cada herramienta corre como la persona autenticada, con su capacidad y con la base filtrando lo que no ve;
 * nunca con una cuenta de servicio. Cada llamada deja quién, por qué vía y qué herramienta en la bitácora. Máximo 50 filas.
 * Con MCP_SERVER apagado no existe ninguna ruta (src/app/api/mcp/route.ts responde 404). Documentación: docs/mcp.md.
 */
export const MCP_ROW_LIMIT = 50

type Args = Record<string, unknown>
export type McpTool = {
  name: string
  description: string
  cap: Capability
  inputSchema: { type: 'object'; properties: Record<string, { type: 'string'; description: string }>; required?: string[] }
  run: (ctx: Ctx, args: Args) => Promise<unknown>
}

const str = (a: Args, k: string, max = 200): string => {
  const v = a[k]
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw invalid(`Falta ${k}.`, `Missing ${k}.`)
  return v.trim()
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'search_records',
    description: 'Search merchants, leads and deals the signed-in person can see, by name, full phone number or external ID.',
    cap: 'ia.read',
    inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'At least 2 characters.' } }, required: ['q'] },
    run: async (ctx, a) => {
      const r = await searchAll(ctx, str(a, 'q', 80))
      return { accounts: r.accounts.slice(0, MCP_ROW_LIMIT), leads: r.leads.slice(0, MCP_ROW_LIMIT), deals: r.deals.slice(0, MCP_ROW_LIMIT), limited: r.limited }
    },
  },
  {
    name: 'my_suggestions',
    description: 'Open next-action suggestions for the signed-in person, with the reason in words. Read-only: accepting one happens in CONTIGO.',
    cap: 'ia.read',
    inputSchema: { type: 'object', properties: {} },
    run: async (ctx) => (await openRecommendations(ctx, { scope: 'mine', limit: MCP_ROW_LIMIT })).map((r) => ({ account: r.account_name, account_id: r.account_id, rule: r.rule_code, reason: ctx.t(...r.reason), expires_at: r.expires_at })),
  },
  {
    name: 'account_brief',
    description: 'Read-only brief of a merchant: days without contact, open deals and tasks, and transactions in the last 30 days against the previous period.',
    cap: 'ia.read',
    inputSchema: { type: 'object', properties: { account_id: { type: 'string', description: 'Merchant ID.' } }, required: ['account_id'] },
    run: async (ctx, a) => {
      const id = str(a, 'account_id', 36)
      if (!/^[0-9a-f-]{36}$/.test(id)) throw invalid('ID inválido.', 'Invalid ID.')
      return (await accountBrief(ctx, id)) ?? { error: 'not_found' }
    },
  },
  {
    name: 'ask_metric',
    description: 'Answer a question with one of CONTIGO’s defined metrics only (deals won or lost, leads, qualified leads, open deals, waiting for first sale, active or at-risk merchants, revisits). Anything else returns out_of_scope.',
    cap: 'ia.ask',
    inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'The question in Spanish or English.' }, market: { type: 'string', description: 'Optional market code.' } }, required: ['question'] },
    run: (ctx, a) => askMetric(ctx, { text: str(a, 'question', 300), market: typeof a.market === 'string' ? a.market : undefined }),
  },
]

/** Corre una herramienta como la persona. Sin la capacidad, se rechaza antes de leer nada. */
export async function callTool(ctx: Ctx, name: string, args: Args): Promise<unknown> {
  const tool = MCP_TOOLS.find((t) => t.name === name)
  if (!tool) throw invalid('Esa herramienta no existe.', 'That tool does not exist.')
  if (!ctx.can(tool.cap)) throw forbidden()
  const out = await tool.run(ctx, args)
  await withUser(ctx.user.id, async (tx) => {
    await logCall(tx, { feature: 'metric_question', mode: 'rules', input: { tool: name }, tool: { name, args: Object.keys(args).sort() }, outcome: 'answered', via: 'mcp' })
    await audit(tx, ctx, 'ia.mcp_read', 'mcp', null, null, null, { tool: name, via: 'mcp' })
  })
  return out
}
