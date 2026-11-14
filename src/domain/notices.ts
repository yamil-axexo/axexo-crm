import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import { CHANNELS, KIND_KEYS, NOTICE_KINDS, TEMPLATE_INFO, unknownVars, type KindDef, type Prefs } from '@/lib/notice-kinds'

/** Centro de avisos: leer, marcar todo como leído, preferencias de la persona, plantillas y configuración por mercado. */
export async function markAllNoticesSeen(ctx: Ctx): Promise<number> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx`update crm.notices set seen_at = now() where user_id = ${ctx.user.id} and seen_at is null and announcement_id is null returning id`
    if (rows.length) await audit(tx, ctx, 'notice.all_seen', 'notice', null, null, null, { count: rows.length })
    return rows.length
  })
}

const prefsInput = z.object({ dailyDigest: z.boolean(), on: z.array(z.string().regex(/^[a-z_]+:[a-z_]+$/)).max(200) })

/** Qué tipos recibe la persona, por qué canal, y si quiere resumen diario. Lo que no se puede apagar no se guarda apagado. */
export async function savePrefs(ctx: Ctx, raw: z.input<typeof prefsInput>): Promise<void> {
  const v = prefsInput.parse(raw)
  const on = new Set(v.on)
  const prefs: Prefs = {}
  for (const kind of KIND_KEYS) {
    const def: KindDef = NOTICE_KINDS[kind]
    prefs[kind] = Object.fromEntries(CHANNELS.map((c) => [c, c === 'in_app' && def.locked ? true : on.has(`${kind}:${c}`)]))
  }
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.notification_prefs (user_id, prefs, daily_digest) values (${ctx.user.id}, ${tx.json(prefs as never)}, ${v.dailyDigest})
             on conflict (user_id) do update set prefs = excluded.prefs, daily_digest = excluded.daily_digest, updated_at = now()`
    await audit(tx, ctx, 'notice.prefs_saved', 'user', ctx.user.id, null, null, { daily_digest: v.dailyDigest })
  })
}

const templateInput = z.object({
  key: z.string().regex(/^[a-z0-9_]{3,40}$/),
  market: z.string().length(2).or(z.literal('')),
  active: z.boolean(),
  needsConsent: z.boolean(),
  subjectEs: z.string().trim().min(2).max(200),
  bodyEs: z.string().trim().min(2).max(4000),
  subjectEn: z.string().trim().min(2).max(200),
  bodyEn: z.string().trim().min(2).max(4000),
})

/** Guardar una plantilla crea una versión nueva (la anterior se conserva). Solo administración. */
export async function saveTemplate(ctx: Ctx, raw: z.input<typeof templateInput>): Promise<number> {
  ctx.assert('config.manage')
  const parsed = templateInput.safeParse(raw)
  if (!parsed.success) throw invalid('Escribe el asunto y el texto en español y en inglés.', 'Write the subject and the text in Spanish and in English.')
  const v = parsed.data
  if (!TEMPLATE_INFO[v.key]) throw notFound('Esa plantilla no existe.', 'That template does not exist.')
  const bad = unknownVars(`${v.subjectEs} ${v.bodyEs} ${v.subjectEn} ${v.bodyEn}`)
  if (bad.length) throw invalid(`Estas variables no existen: ${bad.join(', ')}. Usa solo las de la lista.`, `These variables do not exist: ${bad.join(', ')}. Use only the ones on the list.`)
  assertNoProhibited(v.subjectEs, v.bodyEs, v.subjectEn, v.bodyEn)
  return withUser(ctx.user.id, async (tx) => {
    const market = v.market || null
    if (market) ctx.market(market)
    const base = await tx<{ version: number; recipient: string; trigger_event: string }[]>`
      select version, recipient, trigger_event from crm.message_templates where key = ${v.key} order by (coalesce(market_code, '') = ${market ?? ''}) desc, version desc limit 1`
    if (!base[0]) throw notFound('Esa plantilla no existe.', 'That template does not exist.')
    const last = await tx<{ version: number }[]>`select max(version)::int as version from crm.message_templates where key = ${v.key} and coalesce(market_code, '') = ${market ?? ''}`
    const version = (last[0]?.version ?? 0) + 1
    await tx`update crm.message_templates set is_current = false where key = ${v.key} and coalesce(market_code, '') = ${market ?? ''} and is_current`
    await tx`insert into crm.message_templates (key, market_code, version, is_active, recipient, trigger_event, needs_consent, subject_es, body_es, subject_en, body_en, created_by)
             values (${v.key}, ${market}, ${version}, ${v.active}, ${base[0].recipient}, ${base[0].trigger_event}, ${base[0].recipient === 'lead' ? v.needsConsent : false},
                     ${v.subjectEs}, ${v.bodyEs}, ${v.subjectEn}, ${v.bodyEn}, ${ctx.user.id})`
    await audit(tx, ctx, 'template.saved', 'template', null, market, null, { key: v.key, version, active: v.active })
    return version
  })
}

const optional = (max: number) => z.string().trim().max(max)
const commsInput = z.object({
  market: z.string().length(2),
  orderHeader: optional(80), ordersMailbox: optional(160), senderAddress: optional(160), walkthroughUrl: optional(500), supportWhatsapp: optional(20),
  emailUnitCost: optional(12),
  supportHoursHigh: optional(4), supportHoursNormal: optional(4), supportHoursLow: optional(4),
})
const mail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
const intOrNull = (s: string, min: number, max: number): number | null | undefined => (s === '' ? null : /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max ? Number(s) : undefined)
const costOrNull = (s: string): string | null | undefined => (s === '' ? null : /^\d{1,7}(\.\d{1,4})?$/.test(s) ? s : undefined)

/** Configuración de avisos de un mercado: buzón de pedidos, dirección de salida, video de recorrido, límites y costos. */
export async function saveComms(ctx: Ctx, raw: z.input<typeof commsInput>): Promise<void> {
  ctx.assert('config.manage')
  const v = commsInput.parse(raw)
  ctx.market(v.market)
  if ((v.ordersMailbox && !mail(v.ordersMailbox)) || (v.senderAddress && !mail(v.senderAddress))) throw invalid('Revisa las direcciones de correo.', 'Check the email addresses.')
  if (v.walkthroughUrl && !/^https:\/\/[^\s]+$/.test(v.walkthroughUrl)) throw invalid('El enlace del video tiene que empezar con https://.', 'The video link must start with https://.')
  if (v.supportWhatsapp && !/^\+[1-9][0-9]{7,14}$/.test(v.supportWhatsapp)) throw invalid('El WhatsApp de soporte va con signo + y código de país, sin espacios.', 'The support WhatsApp number needs a + sign and country code, no spaces.')
  const hours = [intOrNull(v.supportHoursHigh, 1, 720), intOrNull(v.supportHoursNormal, 1, 720), intOrNull(v.supportHoursLow, 1, 720)]
  const costs = [costOrNull(v.emailUnitCost)]
  if (hours.includes(undefined) || costs.includes(undefined)) throw invalid('Los límites, plazos y costos son números. Deja vacío lo que no se ha definido.', 'Limits, deadlines and costs are numbers. Leave empty what has not been defined.')
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.market_comms (market_code, order_header, orders_mailbox, sender_address, walkthrough_url, support_whatsapp, email_unit_cost,
                                           support_hours_high, support_hours_normal, support_hours_low, updated_by)
             values (${v.market}, ${v.orderHeader || null}, ${v.ordersMailbox || null}, ${v.senderAddress || null}, ${v.walkthroughUrl || null}, ${v.supportWhatsapp || null},
                     ${costs[0] ?? null}, ${hours[0] ?? null}, ${hours[1] ?? null}, ${hours[2] ?? null}, ${ctx.user.id})
             on conflict (market_code) do update set order_header = excluded.order_header, orders_mailbox = excluded.orders_mailbox, sender_address = excluded.sender_address, walkthrough_url = excluded.walkthrough_url,
               support_whatsapp = excluded.support_whatsapp, email_unit_cost = excluded.email_unit_cost,
               support_hours_high = excluded.support_hours_high, support_hours_normal = excluded.support_hours_normal,
               support_hours_low = excluded.support_hours_low, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'comms.saved', 'market', null, v.market, null, {
      orders_mailbox: Boolean(v.ordersMailbox), sender_address: Boolean(v.senderAddress), walkthrough_url: Boolean(v.walkthroughUrl), support_whatsapp: Boolean(v.supportWhatsapp),
    })
  })
}

const lessonInput = z.object({ screen: z.string().regex(/^\/[a-z0-9/_-]{1,60}$/), url: z.string().trim().max(500) })
/** Lección de Kore Academy de una pantalla. Vacío la quita. */
export async function saveLesson(ctx: Ctx, raw: z.input<typeof lessonInput>): Promise<void> {
  ctx.assert('config.manage')
  const v = lessonInput.parse(raw)
  if (v.url && !/^https:\/\/[^\s]+$/.test(v.url)) throw invalid('El enlace de la lección tiene que empezar con https://.', 'The lesson link must start with https://.')
  await withUser(ctx.user.id, async (tx) => {
    if (!v.url) await tx`delete from crm.help_lessons where screen = ${v.screen}`
    else await tx`insert into crm.help_lessons (screen, url, updated_by) values (${v.screen}, ${v.url}, ${ctx.user.id})
                  on conflict (screen) do update set url = excluded.url, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'help.lesson_saved', 'screen', null, null, null, { screen: v.screen, set: Boolean(v.url) })
  })
}
