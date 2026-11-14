import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { recordActivity } from '@/domain/activities'
import { createLead } from '@/domain/leads'
import { moveDeal } from '@/domain/deals'
import { updateAccount } from '@/domain/accounts'
import { DomainError, notFound } from '@/lib/errors'

/**
 * AUT-04: API de escritura general sobre el dominio. Cada operación llama al MISMO comando que usa la pantalla (mismas
 * reglas, permisos y bitácora), como la persona que creó la llave y acotada al mercado de la llave. Nada se escribe por
 * fuera del dominio. Contrato: docs/contracts/api-v1-write.md y docs/contracts/api-v1-write.openapi.json.
 */
export { WRITE_SCOPES, type WriteScope } from './scopes'

const wrongMarket = () => new DomainError('not_found', 'No encontramos ese registro.', 'We could not find that record.', 404)

/** El registro tiene que existir, verse como la persona de la llave y ser del mercado de la llave. */
async function marketOf(ctx: Ctx, table: 'accounts' | 'deals' | 'leads', id: string): Promise<string> {
  if (!z.guid().safeParse(id).success) throw notFound()
  const rows = await withUser(ctx.user.id, (tx) => tx<{ market_code: string }[]>`select market_code from ${tx(`crm.${table}`)} where id = ${id}`)
  if (!rows[0]) throw notFound()
  return rows[0].market_code
}

const activityBody = z.object({
  account_id: z.guid().optional(),
  deal_id: z.guid().optional(),
  lead_id: z.guid().optional(),
  kind: z.enum(['note', 'call', 'meeting', 'task', 'visit']),
  subject: z.string().max(200).optional(),
  body: z.string().max(4000).optional(),
  due_at: z.string().max(40).optional(),
  outcome: z.string().max(40).optional(),
}).strict()

export async function apiCreateActivity(ctx: Ctx, market: string, raw: unknown): Promise<{ id: string; masked?: boolean }> {
  const b = activityBody.parse(raw)
  for (const [table, id] of [['accounts', b.account_id], ['deals', b.deal_id], ['leads', b.lead_id]] as const) {
    if (id && (await marketOf(ctx, table, id)) !== market) throw wrongMarket()
  }
  const r = await recordActivity(ctx, { accountId: b.account_id, dealId: b.deal_id, leadId: b.lead_id, kind: b.kind, subject: b.subject ?? '', body: b.body ?? '', dueAt: b.due_at ?? '', outcome: b.outcome ?? '' })
  return { id: r.id, ...(r.masked ? { masked: true } : {}) }
}

const leadBody = z.object({
  sale_type: z.string().min(1).max(40),
  business_name: z.string().min(2).max(120),
  contact_name: z.string().min(2).max(120),
  phone: z.string().max(30).optional(),
  email: z.string().max(160).optional(),
  locality: z.string().max(120).optional(),
  message: z.string().max(1000).optional(),
}).strict()

export async function apiCreateLead(ctx: Ctx, market: string, raw: unknown): Promise<{ id: string }> {
  const b = leadBody.parse(raw)
  const id = await createLead(ctx, { market, motor: b.sale_type, source: 'manual', businessName: b.business_name, contactName: b.contact_name, phone: b.phone ?? '', email: b.email ?? '', locality: b.locality ?? '', message: b.message ?? '' })
  return { id }
}

const dealPatch = z.object({
  stage_id: z.guid(),
  loss_reason_code: z.string().max(60).optional(),
  loss_note: z.string().max(500).optional(),
  next_step: z.object({ step: z.string().min(1).max(200), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).optional(),
}).strict()

export async function apiMoveDeal(ctx: Ctx, market: string, id: string, raw: unknown): Promise<{ id: string; status: string }> {
  const b = dealPatch.parse(raw)
  if ((await marketOf(ctx, 'deals', id)) !== market) throw wrongMarket()
  const r = await moveDeal(ctx, id, b.stage_id, b.loss_reason_code ? { reasonCode: b.loss_reason_code, note: b.loss_note } : undefined, b.next_step)
  return { id, status: r.status }
}

const accountPatch = z.object({
  name: z.string().min(2).max(160).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(160).optional(),
  address_line: z.string().max(200).optional(),
  locality: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postal_code: z.string().max(20).optional(),
}).strict()

export async function apiUpdateAccount(ctx: Ctx, market: string, id: string, raw: unknown): Promise<{ id: string }> {
  const b = accountPatch.parse(raw)
  if ((await marketOf(ctx, 'accounts', id)) !== market) throw wrongMarket()
  const cur = (await withUser(ctx.user.id, (tx) => tx<{ name: string; phone: string | null; email: string | null; address_line: string | null; locality: string | null; region: string | null; postal_code: string | null }[]>`
    select name, phone, email::text as email, address_line, locality, region, postal_code from crm.accounts where id = ${id}`))[0]!
  await updateAccount(ctx, id, {
    name: b.name ?? cur.name, phone: b.phone ?? cur.phone ?? '', email: b.email ?? cur.email ?? '', addressLine: b.address_line ?? cur.address_line ?? '',
    locality: b.locality ?? cur.locality ?? '', region: b.region ?? cur.region ?? '', postalCode: b.postal_code ?? cur.postal_code ?? '',
  })
  return { id }
}
