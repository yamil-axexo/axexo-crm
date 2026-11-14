import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { notifyOutside } from '@/domain/notify'
import { documentVault } from '@/server/adapters/document-vault'
import { invalid, notFound } from '@/lib/errors'

/**
 * E5.F9: documentos de plantilla de un comercio (pedido, propuesta, carta). Se arman con los datos del comercio, la persona
 * los ajusta y quedan guardados en CONTIGO con su vista imprimible y su PDF (armado en el navegador, sin red).
 * "Enviar por correo" pasa por el servicio de avisos; el canal de correo está apagado: queda en la cola "Canal apagado".
 * La bóveda (almacenamiento externo) está apagada: el documento queda con su enlace dentro de CONTIGO.
 */
export const DOC_KINDS = ['order', 'proposal', 'letter'] as const
export type DocKind = (typeof DOC_KINDS)[number]
type Pair = [es: string, en: string]
export const DOC_LABEL: Record<DocKind, Pair> = { order: ['Pedido', 'Order'], proposal: ['Propuesta', 'Proposal'], letter: ['Carta', 'Letter'] }

export type DocDraft = { kind: DocKind; title: string; body: string; dealId: string | null }
type Source = { name: string; address: string | null; contact: string | null; market: string; marketName: string; locale: 'es' | 'en'; me: string; today: string; deal: { id: string; title: string; currency: string; lines: { name: string; quantity: string; sum_minor: string | null }[] } | null }

const money = (minor: string | null, currency: string, locale: 'es' | 'en') =>
  minor === null ? '' : new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { style: 'currency', currency, currencyDisplay: 'code' }).format(Number(minor) / 100)

/** El borrador que propone la plantilla. Puro: la prueba lo revisa sin base. */
export function draftFor(kind: DocKind, s: Source): DocDraft {
  const en = s.locale === 'en'
  const hello = s.contact ? (en ? `Dear ${s.contact},` : `Hola, ${s.contact}:`) : en ? 'Hello,' : 'Hola:'
  const where = s.address ? `\n${s.address}` : ''
  if (kind === 'order') {
    const lines = s.deal?.lines.length
      ? s.deal.lines.map((l) => `${l.name} x ${Number(l.quantity)}${l.sum_minor ? `: ${money(l.sum_minor, s.deal!.currency, s.locale)}` : ''}`).join('\n')
      : en ? 'Add the products on the deal before generating the order.' : 'Agrega los productos en el negocio antes de generar el pedido.'
    return {
      kind, dealId: s.deal?.id ?? null,
      title: en ? `Order for ${s.name}` : `Pedido de ${s.name}`,
      body: `${s.name}${where}\n${s.today}\n\n${s.deal ? `${s.deal.title}\n\n` : ''}${lines}\n\n${en ? `Placed by ${s.me}.` : `Lo levantó ${s.me}.`}`,
    }
  }
  if (kind === 'proposal')
    return {
      kind, dealId: s.deal?.id ?? null,
      title: en ? `Proposal for ${s.name}` : `Propuesta para ${s.name}`,
      body: en
        ? `${s.name}${where}\n${s.today}\n\n${hello}\n\nThank you for your time. This is our proposal for ${s.name} to join the axexo network in ${s.marketName}.\n\nWhat we offer:\n\nNext steps:\n\nRegards,\n${s.me}`
        : `${s.name}${where}\n${s.today}\n\n${hello}\n\nGracias por tu tiempo. Esta es nuestra propuesta para que ${s.name} se sume a la red de axexo en ${s.marketName}.\n\nLo que ofrecemos:\n\nSiguientes pasos:\n\nSaludos,\n${s.me}`,
    }
  return {
    kind, dealId: s.deal?.id ?? null,
    title: en ? `Letter to ${s.name}` : `Carta a ${s.name}`,
    body: en ? `${s.name}${where}\n${s.today}\n\n${hello}\n\n\n\nSincerely,\n${s.me}` : `${s.name}${where}\n${s.today}\n\n${hello}\n\n\n\nAtentamente,\n${s.me}`,
  }
}

/** Datos del comercio para la plantilla, con lo que la persona puede ver. */
export async function documentDraft(ctx: Ctx, accountId: string, kind: DocKind, dealId: string | null): Promise<DocDraft> {
  return withUser(ctx.user.id, async (tx) => {
    const a = (await tx<{ name: string; address: string | null; market_code: string }[]>`
      select name, nullif(concat_ws(', ', address_line, locality, region, postal_code), '') as address, market_code from crm.accounts where id = ${accountId}`)[0]
    if (!a) throw notFound()
    const mk = ctx.market(a.market_code)
    const contact = (await tx<{ full_name: string }[]>`select c.full_name from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
      where ac.account_id = ${accountId} and ac.valid_to is null order by ac.is_primary desc, (ac.role = 'decision_maker') desc limit 1`)[0]?.full_name ?? null
    const today = (await tx<{ d: string }[]>`select to_char((now() at time zone m.timezone)::date, 'YYYY-MM-DD') as d from crm.markets m where m.code = ${a.market_code}`)[0]!.d
    let deal: Source['deal'] = null
    if (dealId) {
      const d = (await tx<{ id: string; title: string; currency: string }[]>`select id, title, trim(currency) as currency from crm.deals where id = ${dealId} and account_id = ${accountId}`)[0]
      if (d) deal = { ...d, lines: [...(await tx<{ name: string; quantity: string; sum_minor: string | null }[]>`select name, quantity::text, sum_minor::text from crm.deal_items where deal_id = ${d.id} order by position, created_at`)] }
    }
    const locale = mk.locale === 'en' ? 'en' : 'es'
    return draftFor(kind, { name: a.name, address: a.address, contact, market: a.market_code, marketName: mk.name, locale, me: ctx.user.name ?? '', today, deal })
  })
}

const input = z.object({
  accountId: z.guid(),
  dealId: z.guid().nullable(),
  kind: z.enum(DOC_KINDS),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(1).max(8000),
})

/** Guarda el documento y lo intenta llevar a la bóveda (apagada: queda "Canal apagado" y el enlace de CONTIGO). */
export async function generateDocument(ctx: Ctx, raw: z.input<typeof input>): Promise<string> {
  const v = input.safeParse(raw)
  if (!v.success) throw invalid('Pon un título (3 caracteres o más) y el texto del documento.', 'Enter a title (3 characters or more) and the document text.')
  const d = v.data
  assertNoProhibited(d.title, d.body)
  return withUser(ctx.user.id, async (tx) => {
    const a = (await tx<{ market_code: string }[]>`select market_code from crm.accounts where id = ${d.accountId} and archived_at is null`)[0]
    if (!a) throw notFound()
    ctx.assert('document.generate', a.market_code)
    if (d.dealId) {
      const ok = await tx`select 1 from crm.deals where id = ${d.dealId} and account_id = ${d.accountId}`
      if (!ok[0]) throw invalid('Ese negocio no es de este comercio.', 'That deal does not belong to this merchant.')
    }
    const row = (await tx<{ id: string }[]>`
      insert into crm.generated_documents (market_code, account_id, deal_id, kind, title, body, created_by)
      values (${a.market_code}, ${d.accountId}, ${d.dealId}, ${d.kind}, ${d.title}, ${d.body}, ${ctx.user.id}) returning id`)[0]!
    const stored = await documentVault().store({ id: row.id, title: d.title, content: `${d.title}\n\n${d.body}` })
    // Si la bóveda encendida falla, el documento queda en CONTIGO como "no guardado afuera" (channel_off) y la falla en la bitácora.
    const vaultStatus = stored.status === 'failed' ? 'channel_off' : stored.status
    await tx`update crm.generated_documents set vault_status = ${vaultStatus}, vault_ref = ${stored.ref}, vault_sha256 = ${stored.sha256 ?? null} where id = ${row.id}`
    await audit(tx, ctx, 'document.generated', 'account', d.accountId, a.market_code, null, { document_id: row.id, kind: d.kind, vault: stored.status })
    return row.id
  })
}

/** "Enviar por correo": pasa por el servicio de avisos. Con el canal apagado queda en la cola y no sale nada. */
export async function emailDocument(ctx: Ctx, id: string, to: string): Promise<string> {
  const email = z.string().trim().toLowerCase().email().max(160).safeParse(to)
  if (!email.success) throw invalid('Escribe un correo válido.', 'Enter a valid email.')
  return withUser(ctx.user.id, async (tx) => {
    const doc = (await tx<{ id: string; market_code: string; account_id: string; deal_id: string | null; title: string; body: string; name: string }[]>`
      select g.id, g.market_code, g.account_id, g.deal_id, g.title, g.body, a.name from crm.generated_documents g join crm.accounts a on a.id = g.account_id where g.id = ${id}`)[0]
    if (!doc) throw notFound()
    ctx.assert('document.generate', doc.market_code)
    const mk = ctx.market(doc.market_code)
    const status = await notifyOutside(tx, ctx, {
      kind: 'lifecycle', template: 'notice', market: doc.market_code, recipient: 'mailbox', address: email.data, locale: mk.locale === 'en' ? 'en' : 'es',
      vars: { titulo: doc.title, texto: doc.body.slice(0, 5000), comercio: doc.name }, accountId: doc.account_id, dealId: doc.deal_id,
    })
    const st = status ?? 'blocked_template'
    await tx`update crm.generated_documents set emailed_to = ${email.data}, emailed_at = now(), email_status = ${st} where id = ${id}`
    await audit(tx, ctx, 'document.emailed', 'account', doc.account_id, doc.market_code, null, { document_id: id, status: st })
    return st
  })
}
