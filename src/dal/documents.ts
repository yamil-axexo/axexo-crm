import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { DocKind } from '@/domain/documents'

export type DocRow = { id: string; kind: DocKind; title: string; created_at: Date; created_by_name: string | null; vault_status: string; email_status: string | null; emailed_to: string | null; emailed_at: Date | null }
export type DocFull = DocRow & { body: string; market_code: string; account_id: string; account_name: string; deal_id: string | null; header: string | null }

const isUuid = (s: string) => /^[0-9a-f-]{36}$/.test(s)

export async function accountDocuments(ctx: Ctx, accountId: string): Promise<DocRow[]> {
  if (!isUuid(accountId)) return []
  return withUser(ctx.user.id, async (tx) => [...(await tx<DocRow[]>`
    select g.id, g.kind, g.title, g.created_at, u.full_name as created_by_name, g.vault_status, g.email_status, g.emailed_to, g.emailed_at
      from crm.generated_documents g left join crm.users u on u.id = g.created_by
     where g.account_id = ${accountId} order by g.created_at desc limit 50`)])
}

export async function getDocument(ctx: Ctx, id: string): Promise<DocFull | null> {
  if (!isUuid(id)) return null
  return withUser(ctx.user.id, async (tx) => (await tx<DocFull[]>`
    select g.id, g.kind, g.title, g.body, g.created_at, u.full_name as created_by_name, g.vault_status, g.email_status, g.emailed_to, g.emailed_at,
           g.market_code, g.account_id, a.name as account_name, g.deal_id, (select c.order_header from crm.market_comms c where c.market_code = g.market_code) as header
      from crm.generated_documents g join crm.accounts a on a.id = g.account_id left join crm.users u on u.id = g.created_by
     where g.id = ${id}`)[0] ?? null)
}

/** Negocios del comercio para ligar el documento (el pedido toma sus productos). */
export async function accountDealsForDocs(ctx: Ctx, accountId: string): Promise<{ id: string; title: string; status: string }[]> {
  if (!isUuid(accountId)) return []
  return withUser(ctx.user.id, async (tx) => [...(await tx<{ id: string; title: string; status: string }[]>`
    select id, title, status from crm.deals where account_id = ${accountId} order by (status = 'open') desc, created_at desc limit 30`)])
}
