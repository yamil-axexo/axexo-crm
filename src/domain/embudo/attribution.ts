import 'server-only'
import type { Tx } from '@/server/db'
import { scrub } from '@/domain/pipedrive/mapping'
import { adConversionsAdapter, type AdConversion } from '@/server/adapters/ad-conversions'

/**
 * LEAD-02 / E3.F6: atribución completa del lead. Además de UTM, gclid y fbclid (que ya se guardaban), los identificadores
 * de clic de TikTok, LinkedIn y X, la página de llegada y la página de la que vino. Cada toque se guarda como un renglón
 * que no se edita (crm.source_touches): el primero nunca se pisa con el último. Al convertir, viaja al comercio y al negocio.
 */
export const PLATFORMS = ['google', 'meta', 'tiktok', 'linkedin', 'x'] as const
export type Platform = (typeof PLATFORMS)[number]
export const PLATFORM_LABEL: Record<Platform, string> = { google: 'Google', meta: 'Meta', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X' }
export const CLICK_ID: Record<Platform, 'gclid' | 'fbclid' | 'ttclid' | 'li_fat_id' | 'twclid'> = { google: 'gclid', meta: 'fbclid', tiktok: 'ttclid', linkedin: 'li_fat_id', x: 'twclid' }
/** Lo que este paquete agrega a lo que el formulario ya recibía. */
export const EXTRA_ORIGIN_KEYS = ['ttclid', 'li_fat_id', 'twclid', 'ctwa_clid', 'landing_page', 'referrer'] as const
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'] as const
export type TouchValues = Partial<Record<(typeof UTM_KEYS)[number] | (typeof EXTRA_ORIGIN_KEYS)[number], string | null>>

/** Llega de una dirección que cualquiera puede escribir: sin caracteres de control, sin datos prohibidos y con tope. */
export function cleanOrigin(raw: unknown, max = 200): string | null {
  if (typeof raw !== 'string') return null
  const v = scrub(raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, max)
  return v ? v : null
}
/** De una página solo se guarda dónde (host y ruta): lo que venga después del signo de pregunta puede traer datos de la persona. */
export function cleanPage(raw: unknown): string | null {
  const v = cleanOrigin(raw, 500)
  if (!v) return null
  return v.split(/[?#]/)[0]!.slice(0, 500) || null
}
export function readOrigin(raw: unknown): TouchValues {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    ...Object.fromEntries(UTM_KEYS.map((k) => [k, cleanOrigin(o[k])])),
    ttclid: cleanOrigin(o.ttclid), li_fat_id: cleanOrigin(o.li_fat_id), twclid: cleanOrigin(o.twclid), ctwa_clid: cleanOrigin(o.ctwa_clid),
    landing_page: cleanPage(o.landing_page), referrer: cleanPage(o.referrer),
  }
}
const hasAny = (v: TouchValues): boolean => Object.values(v).some(Boolean)

export async function recordTouch(tx: Tx, p: { market: string; leadId: string; touch: 'first' | 'last'; source: string; values: TouchValues; referralAccountId?: string | null }): Promise<boolean> {
  const v = p.values
  if (!hasAny(v) && !p.referralAccountId) return false
  await tx`insert into crm.source_touches (market_code, lead_id, touch, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, ttclid, li_fat_id, twclid, ctwa_clid, landing_page, referrer, referral_account_id)
           values (${p.market}, ${p.leadId}, ${p.touch}, ${p.source}, ${v.utm_source ?? null}, ${v.utm_medium ?? null}, ${v.utm_campaign ?? null}, ${v.utm_content ?? null}, ${v.utm_term ?? null},
                   ${v.gclid ?? null}, ${v.fbclid ?? null}, ${v.ttclid ?? null}, ${v.li_fat_id ?? null}, ${v.twclid ?? null}, ${v.ctwa_clid ?? null}, ${v.landing_page ?? null}, ${v.referrer ?? null}, ${p.referralAccountId ?? null})`
  return true
}

/** El primer toque de un lead recién creado: llena los campos nuevos del lead (los de siempre ya los puso el alta) y guarda el renglón. */
export async function saveFirstTouch(tx: Tx, p: { market: string; leadId: string; source: string; values: TouchValues; referralAccountId?: string | null }): Promise<void> {
  const v = p.values
  await tx`update crm.leads set ttclid = coalesce(ttclid, ${v.ttclid ?? null}), li_fat_id = coalesce(li_fat_id, ${v.li_fat_id ?? null}), twclid = coalesce(twclid, ${v.twclid ?? null}), ctwa_clid = coalesce(ctwa_clid, ${v.ctwa_clid ?? null}),
            landing_page = coalesce(landing_page, ${v.landing_page ?? null}), referrer = coalesce(referrer, ${v.referrer ?? null}),
            referred_by_account_id = coalesce(referred_by_account_id, ${p.referralAccountId ?? null}),
            labels = case when ${p.referralAccountId ?? null}::uuid is not null and not ('referido' = any(labels)) then labels || 'referido'::text else labels end
            where id = ${p.leadId}`
  await recordTouch(tx, { ...p, touch: 'first' })
}

/** Al convertir: los toques del lead quedan también en el comercio y en el negocio, para filtrar y reportar ahí. */
export async function carryTouches(tx: Tx, leadId: string, accountId: string, dealId: string): Promise<number> {
  const rows = await tx`
    insert into crm.source_touches (market_code, account_id, deal_id, touch, touched_at, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                                    gclid, fbclid, ttclid, li_fat_id, twclid, ctwa_clid, landing_page, referrer, referral_account_id)
    select market_code, ${accountId}, ${dealId}, touch, touched_at, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           gclid, fbclid, ttclid, li_fat_id, twclid, ctwa_clid, landing_page, referrer, referral_account_id
      from crm.source_touches where lead_id = ${leadId}
       and not exists (select 1 from crm.source_touches x where x.deal_id = ${dealId})
    returning 1`
  return rows.length
}

/**
 * Deja en cola la conversión para cada plataforma de la que el lead (o el negocio) trae identificador de clic.
 * Una por plataforma, evento y registro: repetirla no la duplica (las plataformas no deduplican por nosotros).
 */
export async function enqueueConversions(tx: Tx, p: { market: string; event: 'qualified_lead' | 'purchase'; leadId?: string | null; dealId?: string | null; accountId?: string | null }): Promise<number> {
  // Para Meta vale el clic del anuncio web o el de Click to WhatsApp.
  const touches = await tx<{ platform: Platform | null; gclid: string | null; fbclid: string | null; ttclid: string | null; li_fat_id: string | null; twclid: string | null }[]>`
    select platform, gclid, coalesce(fbclid, ctwa_clid) as fbclid, ttclid, li_fat_id, twclid from crm.source_touches
     where touch = 'first' and ${p.dealId ? tx`deal_id = ${p.dealId}` : tx`lead_id = ${p.leadId ?? null}`} order by touched_at limit 1`
  const t = touches[0]
  if (!t) return 0
  let n = 0
  for (const platform of PLATFORMS) {
    const click = t[CLICK_ID[platform]]
    if (!click) continue
    const key = `${p.event}:${platform}:${p.dealId ?? p.leadId}`
    const ins = await tx`insert into crm.conversion_events (market_code, platform, event_name, lead_id, deal_id, account_id, click_id, dedupe_key)
                         values (${p.market}, ${platform}, ${p.event}, ${p.leadId ?? null}, ${p.dealId ?? null}, ${p.accountId ?? null}, ${click}, ${key})
                         on conflict (dedupe_key) do nothing returning 1`
    n += ins.length
  }
  return n
}

/** La tarea programada: entrega lo que hay en cola al adaptador. Apagado, cada conversión queda como "Canal apagado" y no sale nada. */
export async function flushConversions(tx: Tx): Promise<{ done: number; note: string }> {
  const adapter = adConversionsAdapter()
  const rows = await tx<{ id: string; platform: Platform; event_name: 'qualified_lead' | 'purchase'; click_id: string; dedupe_key: string; created_at: Date }[]>`
    select id, platform, event_name, click_id, dedupe_key, created_at from crm.conversion_events where status = 'queued' order by created_at limit 500 for update skip locked`
  if (rows.length === 0) return { done: 0, note: adapter.mode === 'off' ? 'Canal apagado: nada en cola' : 'Nada en cola' }
  const batch: AdConversion[] = rows.map((r) => ({ id: r.id, platform: r.platform, event: r.event_name, click_id: r.click_id, dedupe_key: r.dedupe_key, occurred_at: r.created_at.toISOString() }))
  const out = await adapter.send(batch)
  await tx`update crm.conversion_events set status = ${out.status}, attempts = attempts + 1, processed_at = now() where id = any(${rows.map((r) => r.id)}::uuid[])`
  return { done: rows.length, note: out.status === 'channel_off' ? `Canal apagado: ${rows.length} en cola, nada salió` : `Simulado: ${rows.length}` }
}
