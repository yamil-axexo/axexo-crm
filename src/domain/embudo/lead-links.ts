import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid, notFound } from '@/lib/errors'
import { assertOwned } from '@/domain/leads'

/**
 * LEAD-01: el lead sigue siendo un registro aparte que se convierte (requerimiento E3.F1), pero ya no vive suelto:
 * se puede ligar desde el inicio a un comercio que ya existe. El comercio muestra sus leads abiertos y pasados, y al
 * convertir un lead ligado no nace otro comercio: el negocio entra en el que ya estaba.
 */
export async function linkLeadToAccount(ctx: Ctx, leadId: string, accountId: string | null): Promise<void> {
  if (accountId !== null && !z.guid().safeParse(accountId).success) throw invalid('Elige un comercio de la lista.', 'Pick a merchant from the list.')
  await withUser(ctx.user.id, async (tx) => {
    const leads = await tx<{ market_code: string; owner_id: string | null; status: string; account_id: string | null }[]>`
      select market_code, owner_id, status, account_id from crm.leads where id = ${leadId} for update`
    const lead = leads[0]
    if (!lead) throw notFound('No encontramos ese lead.', 'We could not find that lead.')
    ctx.assert('lead.work', lead.market_code)
    assertOwned(ctx, lead)
    if (!['new', 'contacted', 'qualified'].includes(lead.status)) throw invalid('Este lead ya se cerró.', 'This lead is already closed.')
    if (accountId) {
      const acc = await tx`select 1 from crm.accounts where id = ${accountId} and market_code = ${lead.market_code} and archived_at is null and merged_into is null`
      if (!acc[0]) throw notFound('No puedes ver ese comercio para ligarlo, o es de otro mercado.', 'You cannot see that merchant to link it, or it belongs to another market.')
    }
    if (lead.account_id === accountId) return
    await tx`update crm.leads set account_id = ${accountId} where id = ${leadId}`
    await audit(tx, ctx, accountId ? 'lead.linked_to_account' : 'lead.unlinked_from_account', 'lead', leadId, lead.market_code, { account_id: lead.account_id }, { account_id: accountId })
  })
}

/** E3.F3: etiquetas del lead, de un catálogo que mantiene administración. Sirven para filtrar la bandeja. */
export async function setLeadLabels(ctx: Ctx, leadId: string, labels: string[]): Promise<void> {
  const want = [...new Set(z.array(z.string().regex(/^[a-z][a-z0-9_]{1,30}$/)).max(12).parse(labels))]
  await withUser(ctx.user.id, async (tx) => {
    const leads = await tx<{ market_code: string; owner_id: string | null; labels: string[] }[]>`select market_code, owner_id, labels from crm.leads where id = ${leadId} for update`
    const lead = leads[0]
    if (!lead) throw notFound('No encontramos ese lead.', 'We could not find that lead.')
    ctx.assert('lead.work', lead.market_code)
    assertOwned(ctx, lead)
    const known = await tx<{ code: string }[]>`select code from crm.lead_labels where code = any(${want}::text[]) and is_active`
    if (known.length !== want.length) throw invalid('Elige etiquetas de la lista.', 'Pick labels from the list.')
    await tx`update crm.leads set labels = ${want} where id = ${leadId}`
    await audit(tx, ctx, 'lead.labels_changed', 'lead', leadId, lead.market_code, { labels: lead.labels }, { labels: want })
  })
}

const labelInput = z.object({ labelEs: z.string().trim().min(2).max(40), labelEn: z.string().trim().min(2).max(40) })
export async function createLeadLabel(ctx: Ctx, input: z.input<typeof labelInput>): Promise<string> {
  ctx.assert('config.manage')
  const p = labelInput.safeParse(input)
  if (!p.success) throw invalid('Escribe la etiqueta en español y en inglés (de 2 a 40 letras).', 'Enter the label in Spanish and in English (2 to 40 characters).')
  const code = p.data.labelEs.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'e_$1').slice(0, 30)
  if (code.length < 2) throw invalid('Usa letras en el nombre de la etiqueta.', 'Use letters in the label name.')
  return withUser(ctx.user.id, async (tx) => {
    const ins = await tx`insert into crm.lead_labels (code, label_es, label_en, position) values (${code}, ${p.data.labelEs}, ${p.data.labelEn}, (select coalesce(max(position), 0) + 1 from crm.lead_labels))
                         on conflict (code) do nothing returning code`
    if (!ins[0]) throw invalid('Ya existe una etiqueta con ese nombre.', 'A label with that name already exists.')
    await audit(tx, ctx, 'lead.label_created', 'lead_label', null, null, null, { code, label_es: p.data.labelEs, label_en: p.data.labelEn })
    return code
  })
}
