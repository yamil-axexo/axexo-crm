import type { Tx } from '@/server/db'
import type { WaTemplate } from '@/server/adapters/live/messaging'

/**
 * MULTI-05 y CS-03: por WhatsApp solo sale una plantilla APROBADA por Meta para ese mercado, en el idioma del comercio,
 * desde el número de la cuenta del mercado (crm.whatsapp_accounts.external_ref). Sin plantilla aprobada no sale nada:
 * el canal lo marca "blocked_template".
 */
export async function waTemplateFor(tx: Tx, market: string, key: string, locale: string, params: string[]): Promise<{ template: WaTemplate | null; phoneNumberId: string | null }> {
  const rows = await tx<{ key: string; locale: string; external_ref: string | null }[]>`
    select t.key, t.locale, a.external_ref from crm.whatsapp_templates t join crm.whatsapp_accounts a on a.id = t.account_id
     where t.market_code = ${market} and t.key = ${key} and t.status = 'approved' and t.is_active and a.is_active
     order by (t.locale = ${locale}) desc limit 1`
  const r = rows[0]
  return r ? { template: { name: r.key, locale: r.locale, params }, phoneNumberId: r.external_ref } : { template: null, phoneNumberId: null }
}
