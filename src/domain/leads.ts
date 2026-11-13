import 'server-only'
import { saveFormAnswers } from '@/domain/b2b'
import { CONTACT_ROLES } from '@/domain/accounts'
import { z } from 'zod'
import { marketToday, marketWorkday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit, newId, clean } from '@/domain/common'
import { DomainError, invalid, notFound } from '@/lib/errors'
import { toE164 } from '@/lib/format'
import { assertNoProhibited } from '@/domain/guard'
import { scrub } from '@/domain/pipedrive/mapping'
import { territoryFor, type Territory } from '@/lib/territory'
import { isWebSource, type WebSource } from '@/lib/lead-source'

export const MOTORS = ['d2d', 'b2b', 'dealer'] as const

/** Rol de la persona de contacto dentro del comercio: el mismo catálogo que usan los contactos de un comercio. */
export { CONTACT_ROLES }
export type ContactRole = (typeof CONTACT_ROLES)[number]
/** De dónde sale un lead que alguien captura a mano. */
export const MANUAL_SOURCES = ['walk_in', 'referral', 'phone_in', 'event', 'manual'] as const
const OPEN = ['new', 'contacted', 'qualified']

/**
 * Sin dato en el lead ni en el formulario, el tipo de cuenta sale del tipo de venta: cadenas y distribuidores no nacen como
 * tienda. Devuelve un código del catálogo de tipos de cuenta (crm.account_types), el mismo que se edita en la ficha.
 */
export const typeForMotor = (motor: string): string => (motor === 'b2b' ? 'chain' : 'store')

/** El tipo de cuenta tiene que estar en el catálogo del mercado. Devuelve su nivel en el árbol, o null si no existe. */
async function accountTypeLevel(tx: Tx, market: string, code: string): Promise<string | null> {
  const rows = await tx<{ kind: string }[]>`
    select kind from crm.account_types where code = ${code} and (market_code is null or market_code = ${market})
     order by market_code nulls last limit 1`
  return rows[0]?.kind ?? null
}

const leadInput = z.object({
  market: z.string().length(2),
  motor: z.string().trim().min(1).max(40),
  source: z.enum(MANUAL_SOURCES).optional().default('manual'),
  accountType: z.string().trim().max(41).optional(),
  contactRole: z.enum(CONTACT_ROLES).optional(),
  /** "Ya hablé con esta persona": el lead nace contactado, con el intento en el hilo, y no arranca el reloj. */
  alreadyContacted: z.boolean().optional().default(false),
  businessName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().max(160).optional().default(''),
  locality: z.string().trim().max(120).optional().default(''),
  message: z.string().trim().max(1000).optional().default(''),
})
export type LeadInput = z.input<typeof leadInput>

type LeadRow = {
  id: string
  market_code: string
  status: string
  owner_id: string | null
  motor: string
  business_name: string
  contact_name: string
  phone: string | null
  email: string | null
  locality: string | null
  account_id: string | null
  first_touch_at: Date | null
  source: string
  form_id: string | null
  sla_due_at: Date | null
  account_type: string | null
  contact_role: string | null
  extra_contacts: ExtraContact[]
  message: string | null
  created_at: Date
}
export type ExtraContact = { name: string; phone: string | null; email: string | null; at: string }

async function loadLead(tx: Tx, id: string): Promise<LeadRow> {
  const rows = await tx<LeadRow[]>`select id, market_code, status, owner_id, motor, business_name, contact_name, phone, email::text, locality,
    account_id, first_touch_at, source, form_id, sla_due_at, account_type, contact_role, extra_contacts, message, created_at
      from crm.leads where id = ${id} for update`
  if (!rows[0]) throw notFound('No encontramos ese lead.', 'We could not find that lead.')
  return rows[0]
}

/**
 * Un lead sin dueño se ve (quien vende ve los de su mercado) pero no se trabaja sin tomarlo:
 * así cada contacto y cada cambio de estado tiene un responsable. Quien asigna leads sí puede.
 */
export function assertOwned(ctx: Ctx, lead: { owner_id: string | null; market_code: string }): void {
  if (!lead.owner_id && !ctx.can('lead.assign', lead.market_code)) throw invalid('Nadie lleva este lead: tómalo antes de trabajarlo.', 'This lead has no owner: take it before working it.')
}

/** De dónde vino un lead web (E3.F6): los parámetros de campaña y los identificadores de clic de la dirección de la página. */
export const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'] as const
export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number]
export type Origin = Partial<Record<AttributionKey, string | null>> & { consentAt?: Date | null; consentText?: string | null }

/** Un valor de atribución llega de una URL que cualquiera puede escribir: sin caracteres de control, sin datos prohibidos y con tope. */
export function cleanAttribution(raw: string | null | undefined): string | null {
  const v = scrub((raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 200)
  return v ? v : null
}

async function insertLead(
  tx: Tx,
  ctx: Ctx,
  v: z.output<typeof leadInput>,
  opts: { source: (typeof MANUAL_SOURCES)[number] | WebSource; formId: string | null; ownerId: string | null; slaMinutes: number; origin?: Origin; accountType?: string | null },
): Promise<string> {
  // SEC-08: lo que captura una persona se rechaza con explicación; lo que llega del formulario público se guarda sin el dato
  // prohibido, para no perder el lead por un texto que escribió el comercio.
  const byHand = !isWebSource(opts.source)
  if (byHand) assertNoProhibited(v.message, v.businessName, v.contactName)
  else v = { ...v, message: v.message ? scrub(v.message) : v.message }
  const market = ctx.market(v.market)
  // El tipo de venta tiene que existir: uno de los de siempre o el de un embudo activo del mercado.
  if (!(MOTORS as readonly string[]).includes(v.motor)) {
    const known = await tx`select 1 from crm.pipelines where market_code = ${v.market} and motor = ${v.motor} and is_active limit 1`
    if (!known[0]) throw invalid('Elige un tipo de venta de la lista.', 'Pick a sale type from the list.')
  }
  const phone = v.phone ? toE164(v.phone, market.phoneCc) : null
  if (v.phone && !phone) throw invalid('El teléfono no parece válido.', 'The phone number does not look valid.')
  if (v.email && !z.string().email().safeParse(v.email).success) throw invalid('El correo no parece válido.', 'The email does not look valid.')
  if (!phone && !v.email) throw invalid('Deja un teléfono o un correo para poder contactar.', 'Add a phone or an email so we can reach them.')
  // Tipo de cuenta: el que eligió la persona tiene que estar en el catálogo; el de un formulario que ya no existe se ignora
  // (un formulario público nunca se rechaza por esto).
  let accountType: string | null = v.accountType || null
  if (accountType && !(await accountTypeLevel(tx, v.market, accountType))) throw invalid('Elige un tipo de cuenta de la lista.', 'Pick an account type from the list.')
  if (!accountType && opts.accountType && (await accountTypeLevel(tx, v.market, opts.accountType))) accountType = opts.accountType
  const dup = await tx<{ id: string }[]>`select id from app.duplicate_candidates(${v.market}, ${v.businessName}, ${phone})`
  const id = await newId(tx)
  const o = opts.origin ?? {}
  // "Ya hablé con esta persona" (solo en el alta a mano): nace contactado, con el primer contacto a tiempo y sin reloj que corra.
  const spoke = byHand && v.alreadyContacted
  // El reloj de primer contacto corre en el horario hábil del mercado (app.business_due): el cumplimiento usa esta misma fecha.
  await tx`insert into crm.leads (id, market_code, source, form_id, motor, business_name, contact_name, phone, email, locality, message,
                                  status, owner_id, assigned_at, sla_due_at, first_touch_at, duplicate_of, account_type, contact_role,
                                  utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, consent_at, consent_text)
           values (${id}, ${v.market}, ${opts.source}, ${opts.formId}, ${v.motor}, ${v.businessName}, ${v.contactName}, ${phone},
                   ${clean(v.email)}, ${clean(v.locality)}, ${clean(v.message)}, ${spoke ? 'contacted' : 'new'}, ${opts.ownerId},
                   ${opts.ownerId ? tx`now()` : null},
                   ${spoke ? tx`now()` : tx`app.business_due(${v.market}, now(), ${opts.slaMinutes})`}, ${spoke ? tx`now()` : null}, ${dup[0]?.id ?? null},
                   ${accountType}, ${v.contactRole ?? null},
                   ${o.utm_source ?? null}, ${o.utm_medium ?? null}, ${o.utm_campaign ?? null}, ${o.utm_content ?? null}, ${o.utm_term ?? null},
                   ${o.gclid ?? null}, ${o.fbclid ?? null}, ${o.consentAt ?? null}, ${o.consentAt ? (o.consentText ?? null) : null})`
  // La bitácora guarda la fuente y la campaña, y si hubo consentimiento. Los identificadores de clic se quedan en el lead.
  await audit(tx, ctx, 'lead.created', 'lead', id, v.market, null, {
    source: opts.source, motor: v.motor, owner_id: opts.ownerId, ...(spoke ? { contacted: true } : {}),
    ...(o.utm_source ? { utm_source: o.utm_source } : {}), ...(o.utm_campaign ? { utm_campaign: o.utm_campaign } : {}),
    ...(isWebSource(opts.source) ? { consent: Boolean(o.consentAt) } : {}),
  })
  if (spoke) {
    // Fue en persona, no una llamada: queda como reunión con la marca "en persona" (el hilo dice "En persona").
    await tx`insert into crm.activities (market_code, lead_id, kind, subject, done_at, outcome, owner_id, created_by, type_label)
             values (${v.market}, ${id}, 'meeting', ${ctx.t('Primer contacto: en persona, al capturar el lead', 'First contact: in person, when the lead was added')},
                     now(), 'reached', ${ctx.user.id}, ${ctx.user.id}, 'in_person')`
    await audit(tx, ctx, 'lead.contacted', 'lead', id, v.market, { status: 'new' }, { status: 'contacted', outcome: 'reached', at: 'creation' })
  }
  await emit(tx, 'lead.created', 'lead', id, v.market, { source: opts.source, motor: v.motor })
  // Aviso para otros sistemas: a quién se le asignó. Cuando se conecte un canal (correo, Slack), sale de aquí sin tocar el producto.
  if (opts.ownerId) await emit(tx, 'lead.assigned', 'lead', id, v.market, { owner_id: opts.ownerId, by: isWebSource(opts.source) ? 'routing' : 'creation', motor: v.motor, sla_due: !spoke })
  return id
}

export async function createLead(ctx: Ctx, input: LeadInput): Promise<string> {
  const v = leadInput.parse(input)
  ctx.assert('lead.create', v.market)
  return withUser(ctx.user.id, (tx) => insertLead(tx, ctx, v, { source: v.source, formId: null, ownerId: ctx.user.id, slaMinutes: 60 }))
}

// Un valor de origen que no es texto se ignora; uno larguísimo se recorta al guardar. Ninguno rechaza el formulario.
const attributionValue = z.preprocess((v) => (typeof v === 'string' ? v.slice(0, 2000) : ''), z.string())

const formPayload = z.object({
  business_name: z.string().trim().min(2).max(120),
  contact_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().max(160).optional().default(''),
  locality: z.string().trim().max(120).optional().default(''),
  message: z.string().trim().max(1000).optional().default(''),
  website: z.string().max(0).optional().default(''), // trampa para bots: debe llegar vacío
  // Tipo de empresa (E15.F3): solo cuenta si el formulario lo ofrece; un valor que no está en su lista se ignora.
  company_type: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 41) : ''), z.string()),
  // Origen (E3.F6). Son opcionales y nunca tumban el lead: un valor demasiado largo se recorta.
  ...(Object.fromEntries(ATTRIBUTION_KEYS.map((k) => [k, attributionValue])) as Record<AttributionKey, typeof attributionValue>),
  // Consentimiento para recibir correos (E3.F7). La página manda la casilla ("on"); la API manda true y, si lo tiene,
  // el texto que la persona aceptó y el momento en que lo aceptó en el sitio.
  consent: z.union([z.boolean(), z.enum(['on', 'true', 'false', ''])]).optional().default(false),
  consent_text: z.string().trim().max(400).optional().default(''),
  consent_at: z.string().datetime({ offset: true }).optional(),
})

/** El texto que acepta quien marca la casilla en la página del formulario. Se guarda con el lead, tal como se mostró. */
export const CONSENT_TEXT = {
  es: 'Acepto que axexo me escriba por correo sobre sus productos y novedades.',
  en: 'I agree to receive emails from axexo about its products and news.',
} as const

/**
 * LEAD-03: entrada de un formulario web. Corre como usuario de sistema, es idempotente (REL-07)
 * y asigna por la regla del formulario (round robin atómico en la base).
 */
export async function intakeFromForm(sys: Ctx, slug: string, raw: unknown, idempotencyKey: string): Promise<{ leadId: string; duplicate: boolean; merged?: boolean }> {
  const parsed = formPayload.safeParse(raw)
  if (!parsed.success) throw invalid('Revisa los datos del formulario.', 'Check the form fields.')
  const p = parsed.data
  return withUser(sys.user.id, async (tx) => {
    const forms = await tx<{ id: string; market_code: string; motor: string; routing_rule_id: string | null; locale: string; account_type: string | null; funnel: string | null; channel_id: string | null; is_campaign: boolean; offer_types: string[] }[]>`
      select id, market_code, motor, routing_rule_id, locale, account_type, funnel, channel_id, is_campaign, offer_types from crm.web_forms where slug = ${slug} and is_active`
    const form = forms[0]
    if (!form) throw notFound('Ese formulario no existe o está apagado.', 'That form does not exist or is turned off.')
    const seen = await tx<{ id: string; payload: { lead_id?: string } }[]>`
      insert into crm.inbound_events (source, event_type, idempotency_key, market_code, payload)
      values ('web_form', 'form.submitted', ${idempotencyKey}, ${form.market_code}, ${tx.json({ form: slug })})
      on conflict (source, idempotency_key) do nothing returning id, payload`
    if (!seen[0]) {
      const prev = await tx<{ payload: { lead_id?: string } }[]>`
        select payload from crm.inbound_events where source = 'web_form' and idempotency_key = ${idempotencyKey}`
      return { leadId: prev[0]?.payload.lead_id ?? '', duplicate: true }
    }
    // Segunda solicitud de la misma empresa (mismo teléfono o correo): no nace otro lead ni se gasta un turno.
    const repeat = await repeatRequest(tx, sys, form, p)
    if (repeat) {
      await tx`update crm.inbound_events set status = 'processed', processed_at = now(), payload = ${tx.json({ form: slug, lead_id: repeat, merged: true })}
               where id = ${seen[0].id}`
      return { leadId: repeat, duplicate: false, merged: true }
    }
    const consented = p.consent === true || p.consent === 'on' || p.consent === 'true'
    // El momento del consentimiento es el que reporta el sitio, si es creíble (no en el futuro); si no, el de llegada.
    const given = p.consent_at ? new Date(p.consent_at) : null
    const origin: Origin = {
      ...Object.fromEntries(ATTRIBUTION_KEYS.map((k) => [k, cleanAttribution(p[k])])),
      consentAt: consented ? (given && given.getTime() <= Date.now() ? given : new Date()) : null,
      consentText: consented ? cleanAttribution(p.consent_text) ?? CONSENT_TEXT[form.locale === 'en' ? 'en' : 'es'] : null,
    }
    let ownerId: string | null = null
    let sla = 60
    if (form.routing_rule_id) {
      const pick = await tx<{ owner: string | null; sla_minutes: number }[]>`
        select app.rr_next(${form.routing_rule_id}) as owner, (select sla_minutes from crm.routing_rules where id = ${form.routing_rule_id}) as sla_minutes`
      ownerId = pick[0]?.owner ?? null
      sla = pick[0]?.sla_minutes ?? 60
    }
    const leadId = await insertLead(
      tx,
      sys,
      { market: form.market_code, motor: form.motor, businessName: p.business_name, contactName: p.contact_name, phone: p.phone, email: p.email, locality: p.locality, message: p.message, source: 'manual', alreadyContacted: false },
      // Un formulario de campaña deja el origen "Campaña web" (E15.F2). El tipo de empresa que eligió la persona manda sobre el del formulario (E15.F3).
      { source: form.is_campaign ? 'web_campaign' : 'web_form', formId: form.id, ownerId, slaMinutes: sla, origin, accountType: form.offer_types.includes(p.company_type) ? p.company_type : form.account_type },
    )
    // El lead lleva el embudo de campaña y el identificador de canal de su formulario (E15.F1): se filtran y se reportan.
    if (form.funnel || form.channel_id) await tx`update crm.leads set funnel = ${form.funnel}, channel_id = ${form.channel_id} where id = ${leadId}`
    // Lo que este formulario pide además de lo básico (por ejemplo, lo mínimo para calificar una cuenta B2B) queda en el lead.
    await saveFormAnswers(tx, leadId, form.id, raw)
    await tx`update crm.inbound_events set status = 'processed', processed_at = now(), payload = ${tx.json({ form: slug, lead_id: leadId })}
             where id = ${seen[0].id}`
    return { leadId, duplicate: false }
  })
}

/**
 * La misma empresa vuelve a escribir por el formulario (mismo teléfono o correo que un lead que sigue vivo o ya es comercio):
 * la persona se suma al lead (o al comercio, si ya se convirtió) y queda una nota en el hilo. Un lead descartado no cuenta:
 * si la empresa vuelve después de un descarte, entra como lead nuevo.
 */
async function repeatRequest(
  tx: Tx,
  sys: Ctx,
  form: { id: string; market_code: string; locale: string },
  p: { business_name: string; contact_name: string; phone: string; email: string; message: string },
): Promise<string | null> {
  const phone = p.phone ? toE164(p.phone, sys.market(form.market_code).phoneCc) : null
  const email = p.email && z.string().email().safeParse(p.email).success ? p.email.trim() : null
  if (!phone && !email) return null
  const prev = await tx<{ id: string; account_id: string | null; owner_id: string | null; business_name: string; contact_name: string; phone: string | null; email: string | null; extra_contacts: ExtraContact[] }[]>`
    select id, account_id, owner_id, business_name, contact_name, phone, email::text, extra_contacts from crm.leads
     where market_code = ${form.market_code} and status <> 'disqualified'
       and ((${phone}::text is not null and phone = ${phone}) or (${email}::text is not null and email = ${email}::citext))
     order by created_at desc limit 1 for update`
  const lead = prev[0]
  if (!lead) return null
  const en = form.locale === 'en'
  const name = scrub(p.contact_name).slice(0, 120)
  const same = (a: string) => a.trim().toLowerCase() === name.trim().toLowerCase()
  const known = same(lead.contact_name) || lead.extra_contacts.some((c) => same(c.name))
  if (!known) {
    const person: ExtraContact = { name, phone, email, at: new Date().toISOString() }
    await tx`update crm.leads set extra_contacts = ${tx.json([...lead.extra_contacts, person].slice(-10))} where id = ${lead.id}`
    if (lead.account_id) {
      const contactId = await newId(tx)
      await tx`insert into crm.contacts (id, market_code, full_name, phone, email, created_by) values (${contactId}, ${form.market_code}, ${name}, ${phone}, ${email}, ${sys.user.id})`
      await tx`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${lead.account_id}, ${contactId}, ${form.market_code}, 'staff')`
    }
  }
  const deals = lead.account_id ? await tx<{ id: string }[]>`select id from crm.deals where lead_id = ${lead.id} and status = 'open' order by created_at desc limit 1` : []
  const body = [[name, phone, email].filter(Boolean).join(' · '), p.message ? scrub(p.message).slice(0, 1000) : null].filter(Boolean).join('\n')
  await tx`insert into crm.activities (market_code, lead_id, account_id, deal_id, kind, subject, body, done_at, owner_id, created_by, source)
           values (${form.market_code}, ${lead.id}, ${lead.account_id}, ${deals[0]?.id ?? null}, 'note',
                   ${en ? 'Second web request from the same business' : 'Segunda solicitud web de la misma empresa'}, ${body}, now(), ${lead.owner_id}, ${sys.user.id}, 'rule')`
  // Quien lleva la cuenta (si el lead ya es comercio) o el lead se entera en Hoy: una tarea para hoy con el pedido. Sin correo ni Slack.
  const holder = lead.account_id
    ? ((await tx<{ owner_id: string | null }[]>`select owner_id from crm.accounts where id = ${lead.account_id}`)[0]?.owner_id ?? lead.owner_id)
    : lead.owner_id
  if (holder) {
    await tx`insert into crm.activities (market_code, lead_id, account_id, deal_id, kind, subject, body, due_at, owner_id, created_by, source)
             values (${form.market_code}, ${lead.id}, ${lead.account_id}, ${deals[0]?.id ?? null}, 'task',
                     ${en ? `Answer the second web request: ${lead.business_name}` : `Responder segunda solicitud web: ${lead.business_name}`}, ${body},
                     ((${marketToday(tx, form.market_code)} + time '15:00') at time zone 'UTC'), ${holder}, ${sys.user.id}, 'rule')`
  }
  await audit(tx, sys, 'lead.repeat_request', 'lead', lead.id, form.market_code, null, { form_id: form.id, person_added: !known, task_for: holder })
  return lead.id
}

export async function markContacted(ctx: Ctx, leadId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    assertOwned(ctx, lead)
    if (!['new', 'contacted'].includes(lead.status)) throw invalid('Este lead ya se trabajó.', 'This lead was already worked.')
    await tx`update crm.leads set status = 'contacted', first_touch_at = coalesce(first_touch_at, now()) where id = ${leadId}`
    await audit(tx, ctx, 'lead.contacted', 'lead', leadId, lead.market_code, { status: lead.status }, { status: 'contacted' })
  })
}

export async function qualifyLead(ctx: Ctx, leadId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    assertOwned(ctx, lead)
    if (!['new', 'contacted'].includes(lead.status)) throw invalid('Solo se califica un lead nuevo o contactado.', 'Only a new or contacted lead can be qualified.')
    await tx`update crm.leads set status = 'qualified', first_touch_at = coalesce(first_touch_at, now()) where id = ${leadId}`
    await audit(tx, ctx, 'lead.qualified', 'lead', leadId, lead.market_code, { status: lead.status }, { status: 'qualified' })
  })
}

export async function disqualifyLead(ctx: Ctx, leadId: string, reasonCode: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    assertOwned(ctx, lead)
    if (lead.status === 'converted') throw invalid('Este lead ya se convirtió.', 'This lead was already converted.')
    // Un solo catálogo de motivos: los del tipo de venta y el mercado del lead, más los que valen para todos (igual que al perder un negocio).
    const reason = await tx`select 1 from crm.loss_reasons where code = ${reasonCode} and kind = 'lost' and is_active
                              and (market_code is null or market_code = ${lead.market_code}) and (motors is null or ${lead.motor} = any(motors))`
    if (!reason[0]) throw invalid('Elige un motivo para descartarlo.', 'Pick a reason to disqualify it.')
    await tx`update crm.leads set status = 'disqualified', disqualify_code = ${reasonCode}, first_touch_at = coalesce(first_touch_at, now()) where id = ${leadId}`
    await audit(tx, ctx, 'lead.disqualified', 'lead', leadId, lead.market_code, { status: lead.status }, { status: 'disqualified', reason: reasonCode })
  })
}

/** "Tomar y llamar": quien vende se queda con un lead sin dueño. Si ya es suyo no cambia nada; si es de otra persona, no se lo quita. */
export async function takeLead(ctx: Ctx, leadId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    if (!['new', 'contacted'].includes(lead.status)) throw invalid('Este lead ya se trabajó.', 'This lead was already worked.')
    if (lead.owner_id === ctx.user.id) return
    if (lead.owner_id) throw invalid('Alguien ya lleva este lead. Pide a tu supervisión o a quien lidera tu mercado que lo reasigne.', 'This lead already has an owner. Ask your supervisor or whoever leads your market to reassign it.')
    await tx`update crm.leads set owner_id = ${ctx.user.id}, assigned_at = now() where id = ${leadId} and owner_id is null`
    await audit(tx, ctx, 'lead.taken', 'lead', leadId, lead.market_code, { owner_id: null }, { owner_id: ctx.user.id })
    await emit(tx, 'lead.assigned', 'lead', leadId, lead.market_code, { owner_id: ctx.user.id, by: 'taken', motor: lead.motor })
  })
}

export async function assignLead(ctx: Ctx, leadId: string, ownerId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.assign', lead.market_code)
    const ok = await tx`select 1 from crm.memberships m where m.user_id = ${ownerId} and m.market_code = ${lead.market_code}
                         and m.role in ('rep','supervisor','market_lead') and (m.valid_to is null or m.valid_to > now())`
    if (!ok[0]) throw invalid('Esa persona no vende en este mercado.', 'That person does not sell in this market.')
    await tx`update crm.leads set owner_id = ${ownerId}, assigned_at = now() where id = ${leadId}`
    await audit(tx, ctx, 'lead.assigned', 'lead', leadId, lead.market_code, { owner_id: lead.owner_id }, { owner_id: ownerId })
    await emit(tx, 'lead.assigned', 'lead', leadId, lead.market_code, { owner_id: ownerId, previous_owner_id: lead.owner_id, by: 'assignment', motor: lead.motor })
  })
}

/** Antes de convertir se puede corregir el tipo de venta, el tipo de cuenta y el rol del contacto: un lead mal clasificado no se queda atascado. */
export async function updateLeadDetails(ctx: Ctx, leadId: string, input: { motor?: string; accountType?: string; contactRole?: string }): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    assertOwned(ctx, lead)
    if (!OPEN.includes(lead.status)) throw invalid('Este lead ya se cerró.', 'This lead is already closed.')
    const motor = input.motor?.trim() || lead.motor
    if (motor !== lead.motor && !(MOTORS as readonly string[]).includes(motor)) {
      const known = await tx`select 1 from crm.pipelines where market_code = ${lead.market_code} and motor = ${motor} and is_active limit 1`
      if (!known[0]) throw invalid('Elige un tipo de venta de la lista.', 'Pick a sale type from the list.')
    }
    const type = input.accountType?.trim() || null
    const role = input.contactRole ? z.enum(CONTACT_ROLES).safeParse(input.contactRole) : null
    if ((type && !(await accountTypeLevel(tx, lead.market_code, type))) || (role && !role.success)) throw invalid('Elige una opción de la lista.', 'Pick an option from the list.')
    const after = { motor, account_type: type ?? lead.account_type, contact_role: role?.data ?? lead.contact_role }
    const before = { motor: lead.motor, account_type: lead.account_type, contact_role: lead.contact_role }
    if (JSON.stringify(before) === JSON.stringify(after)) return
    await tx`update crm.leads set motor = ${after.motor}, account_type = ${after.account_type}, contact_role = ${after.contact_role} where id = ${leadId}`
    await audit(tx, ctx, 'lead.updated', 'lead', leadId, lead.market_code, before, after)
  })
}

const handNote = (raw: string, es: string, en: string): string => {
  const text = (raw ?? '').trim()
  if (text.length < 3) throw invalid(es, en)
  if (text.length > 500) throw invalid('La nota es muy larga: resume en 500 caracteres.', 'The note is too long: keep it under 500 characters.')
  assertNoProhibited(text)
  return text
}

/**
 * Pasar un lead propio a alguien que vende en el mismo mercado, con nota obligatoria. Quien lo recibe lo ve en Hoy: como
 * lead nuevo con su reloj si nadie lo había intentado, o como tarea de hoy si ya hubo contacto (el reloj no se reinicia).
 * Supervisión y quien lidera reasignan con assignLead.
 */
export async function passLead(ctx: Ctx, leadId: string, toUserId: string, note: string): Promise<void> {
  const text = handNote(note, 'Escribe una nota para quien recibe el lead.', 'Write a note for the person receiving the lead.')
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.pass', lead.market_code)
    if (lead.owner_id !== ctx.user.id) throw invalid('Solo puedes pasar un lead que es tuyo.', 'You can only pass a lead that is yours.')
    if (!OPEN.includes(lead.status)) throw invalid('Este lead ya se cerró.', 'This lead is already closed.')
    const to = await tx<{ ok: boolean; name: string | null }[]>`
      select app.can_sell_in(${toUserId}::uuid, ${lead.market_code}) as ok, (select full_name from crm.users where id = ${toUserId}::uuid) as name`
    if (toUserId === ctx.user.id || !to[0]?.ok || !to[0].name) throw invalid('Elige a alguien que venda en este mercado.', 'Pick someone who sells in this market.')
    const name = to[0].name
    // Todo lo que queda en el hilo se escribe antes de entregar: después el lead ya no es de quien lo pasa.
    await tx`insert into crm.activities (market_code, lead_id, kind, subject, body, done_at, owner_id, created_by)
             values (${lead.market_code}, ${leadId}, 'note', ${ctx.t(`${ctx.user.name} pasó este lead a ${name}`, `${ctx.user.name} passed this lead to ${name}`)}, ${text}, now(), ${ctx.user.id}, ${ctx.user.id})`
    const clock = lead.status === 'new' && !lead.first_touch_at && lead.sla_due_at !== null
    if (!clock) {
      await tx`insert into crm.activities (market_code, lead_id, kind, subject, body, due_at, owner_id, created_by)
               values (${lead.market_code}, ${leadId}, 'task', ${ctx.t(`Lead que te pasó ${ctx.user.name}: ${lead.business_name}`, `Lead passed to you by ${ctx.user.name}: ${lead.business_name}`)},
                       ${text}, ((${marketToday(tx, lead.market_code)} + time '15:00') at time zone 'UTC'), ${toUserId}, ${ctx.user.id})`
    }
    await audit(tx, ctx, 'lead.passed', 'lead', leadId, lead.market_code, { owner_id: lead.owner_id }, { owner_id: toUserId, note: text.slice(0, 200), clock_restarted: clock })
    await tx`select app.hand_lead(${leadId}, ${toUserId}::uuid)`
    await emit(tx, 'lead.assigned', 'lead', leadId, lead.market_code, { owner_id: toUserId, previous_owner_id: lead.owner_id, by: 'passed', motor: lead.motor })
  })
}

/** Soltar un lead: vuelve a "sin dueño" con motivo, y lo puede tomar cualquiera que venda en el mercado. */
export async function releaseLead(ctx: Ctx, leadId: string, reason: string): Promise<void> {
  const text = handNote(reason, 'Escribe por qué lo sueltas.', 'Say why you are releasing it.')
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    const mine = lead.owner_id === ctx.user.id
    if (!lead.owner_id) throw invalid('Este lead ya está sin asignar.', 'This lead already has no owner.')
    if (!mine && !ctx.can('lead.assign', lead.market_code)) throw invalid('Solo puedes soltar un lead que es tuyo.', 'You can only release a lead that is yours.')
    if (!OPEN.includes(lead.status)) throw invalid('Este lead ya se cerró.', 'This lead is already closed.')
    await tx`insert into crm.activities (market_code, lead_id, kind, subject, body, done_at, owner_id, created_by)
             values (${lead.market_code}, ${leadId}, 'note', ${ctx.t(`${ctx.user.name} soltó este lead`, `${ctx.user.name} released this lead`)}, ${text}, now(), ${ctx.user.id}, ${ctx.user.id})`
    await audit(tx, ctx, 'lead.released', 'lead', leadId, lead.market_code, { owner_id: lead.owner_id }, { owner_id: null, reason: text.slice(0, 200) })
    if (mine) await tx`select app.hand_lead(${leadId}, null)`
    else await tx`update crm.leads set owner_id = null, assigned_at = null where id = ${leadId}`
  })
}

export const BULK_MAX = 200

/**
 * Cerrar varios leads como no calificados, con un motivo para todos. Quien vende solo cierra los suyos; supervisión y quien
 * lidera, los de su alcance. Cada lead deja su propio evento en la bitácora. No cuenta como primer contacto.
 */
export async function bulkDisqualify(ctx: Ctx, leadIds: string[], reasonCode: string): Promise<number> {
  const ids = [...new Set(leadIds)].filter((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))
  if (ids.length === 0) throw invalid('Elige al menos un lead.', 'Select at least one lead.')
  if (ids.length > BULK_MAX) throw invalid(`Elige ${BULK_MAX} leads o menos por vez.`, `Select ${BULK_MAX} leads or fewer at a time.`)
  return withUser(ctx.user.id, async (tx) => {
    // En bloque la selección puede mezclar tipos de venta: solo valen los motivos generales (los que no son de un tipo de venta).
    const reason = await tx`select 1 from crm.loss_reasons where code = ${reasonCode} and kind = 'lost' and is_active and motors is null`
    if (!reason[0]) throw invalid('Elige un motivo para cerrarlos.', 'Pick a reason to close them.')
    const rows = await tx<{ id: string; market_code: string; status: string; owner_id: string | null }[]>`
      select id, market_code, status, owner_id from crm.leads where id = any(${ids}::uuid[]) order by id for update`
    if (rows.length !== ids.length) throw notFound('Alguno de esos leads ya no está a tu alcance. Actualiza la lista.', 'Some of those leads are no longer within your reach. Refresh the list.')
    let n = 0
    for (const l of rows) {
      ctx.assert('lead.work', l.market_code)
      if (!ctx.can('lead.assign', l.market_code) && l.owner_id !== ctx.user.id) throw invalid('Solo puedes cerrar en bloque los leads que son tuyos.', 'You can only close in bulk the leads that are yours.')
      if (!OPEN.includes(l.status)) continue
      await tx`update crm.leads set status = 'disqualified', disqualify_code = ${reasonCode} where id = ${l.id}`
      await audit(tx, ctx, 'lead.disqualified', 'lead', l.id, l.market_code, { status: l.status }, { status: 'disqualified', reason: reasonCode, bulk: true, batch: ids.length })
      n += 1
    }
    return n
  })
}

export type ConvertOptions = { linkAccountId?: string | null; pipelineId?: string | null; accountType?: string | null; contactRole?: string | null; territoryId?: string | null }

/**
 * LEAD-01: al convertir, el prospecto queda dentro del objeto cuenta, con su contacto,
 * su atribución de origen y un deal con próximo paso (ACT-02).
 *
 * - El embudo se elige entre los que existen en el mercado del lead: el que se pide, el del tipo de venta del lead o,
 *   si el mercado tiene uno solo, ese. Nunca falla por el tipo de venta del lead.
 * - El comercio nace con el tipo de cuenta confirmado (o el del lead, del formulario o del tipo de venta), tomado del
 *   catálogo de tipos de cuenta del mercado, y el contacto con su rol. Lo que el lead contestó para calificar (campos del
 *   tipo de venta, por ejemplo los de B2B) pasa a la ficha del comercio cuando el comercio tiene el mismo campo.
 * - La historia del lead (notas, llamadas, intentos, tareas) pasa al hilo del comercio y del negocio. Si el lead ya tenía
 *   una tarea abierta, esa es el próximo paso del negocio: no se crea otra para lo mismo.
 */
export async function convertLead(ctx: Ctx, leadId: string, opts: ConvertOptions = {}): Promise<{ accountId: string; dealId: string }> {
  return withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    assertOwned(ctx, lead)
    if (lead.status !== 'qualified') throw invalid('Califica el lead antes de convertirlo.', 'Qualify the lead before converting it.')
    const market = ctx.market(lead.market_code)
    const pipes = await tx<{ id: string; motor: string; stage_id: string | null }[]>`
      select p.id, p.motor, (select s.id from crm.stages s where s.pipeline_id = p.id order by s.position limit 1) as stage_id
        from crm.pipelines p where p.market_code = ${lead.market_code} and p.is_active order by p.position, p.id`
    const usable = pipes.filter((p): p is { id: string; motor: string; stage_id: string } => !!p.stage_id)
    if (usable.length === 0) {
      throw new DomainError('no_pipeline',
        `${market.name} todavía no tiene un embudo de ventas. El lead queda calificado y no se pierde: pide a administración que lo configure (Administración, Embudos y campos) y vuelve a convertirlo.`,
        `${market.name} has no sales pipeline yet. The lead stays qualified and is not lost: ask administration to set one up (Administration, Pipelines and fields), then convert it again.`)
    }
    const pipe = opts.pipelineId
      ? usable.find((p) => p.id === opts.pipelineId)
      : usable.find((p) => p.motor === lead.motor) ?? (usable.length === 1 ? usable[0] : undefined)
    if (!pipe) {
      throw opts.pipelineId
        ? invalid('Ese embudo no es de este mercado. Elige uno de la lista.', 'That pipeline is not from this market. Pick one from the list.')
        : new DomainError('pick_pipeline', 'Elige en qué embudo entra este negocio.', 'Choose which pipeline this deal goes into.')
    }
    // Lo que se confirma en la hoja tiene que estar en el catálogo. Si el tipo que traía el lead ya no existe para este
    // mercado, vale el del tipo de venta: convertir nunca se atasca por un dato viejo.
    let accountType = opts.accountType || lead.account_type || typeForMotor(pipe.motor)
    let level = await accountTypeLevel(tx, lead.market_code, accountType)
    if (!level && !opts.accountType) {
      accountType = typeForMotor(pipe.motor)
      level = await accountTypeLevel(tx, lead.market_code, accountType)
    }
    const role = z.enum(CONTACT_ROLES).safeParse(opts.contactRole || lead.contact_role || 'staff')
    if (!level || !role.success) throw invalid('Elige una opción de la lista.', 'Pick an option from the list.')
    const ownerId = lead.owner_id ?? ctx.user.id

    let accountId = opts.linkAccountId ?? null
    if (accountId) {
      const acc = await tx`select 1 from crm.accounts where id = ${accountId} and market_code = ${lead.market_code} and archived_at is null`
      if (!acc[0]) throw notFound('No puedes ver ese comercio para ligarlo.', 'You cannot see that merchant to link it.')
    } else {
      accountId = await newId(tx)
      // Territorio: el que se eligió en la hoja o el que se puede inferir (el único de quien lo lleva, o el de la plaza del lead).
      // Con dos o más territorios y una plaza que no dice cuál, no se adivina: se pregunta.
      const territories = await tx<(Territory & { own: boolean })[]>`
        select t.id, t.code, t.name, exists (select 1 from crm.user_territories ut where ut.territory_id = t.id and ut.user_id = ${ownerId}) as own
          from crm.territories t where t.market_code = ${lead.market_code} and t.archived_at is null order by t.name`
      let territoryId: string | null
      if (opts.territoryId) {
        if (!territories.some((x) => x.id === opts.territoryId)) throw invalid('Ese territorio no es de este mercado.', 'That territory does not belong to this market.')
        territoryId = opts.territoryId
      } else {
        const pick = territoryFor(territories.filter((x) => x.own), [...territories], lead.locality)
        if (pick.ask) {
          throw new DomainError('pick_territory',
            'Elige el territorio del comercio: quien lleva este lead cubre más de uno y la ciudad del lead no dice cuál.',
            'Pick the merchant’s territory: the person who owns this lead covers more than one and the lead’s city does not say which.')
        }
        territoryId = pick.id
      }
      // Respuestas para calificar: solo las llaves que también son un campo activo del comercio en este mercado y tipo de venta.
      const carriedFields = await tx<{ custom: Record<string, unknown> }[]>`
        select coalesce(jsonb_object_agg(d.key, l.custom -> d.key), '{}'::jsonb) as custom
          from crm.leads l
          join crm.field_definitions d on d.object = 'account' and d.is_active and d.mapped_to is null and l.custom ? d.key
           and (d.market_code is null or d.market_code = l.market_code) and (d.motor is null or d.motor = ${pipe.motor})
         where l.id = ${leadId}`
      await tx`insert into crm.accounts (id, market_code, kind, account_type, name, segment, lifecycle, owner_id, territory_id, phone, email, locality, country, custom, created_by)
               values (${accountId}, ${lead.market_code}, ${level}, ${accountType}, ${lead.business_name}, ${pipe.motor}, 'prospect', ${ownerId}, ${territoryId},
                       ${lead.phone}, ${lead.email}, ${lead.locality}, ${lead.market_code}, ${tx.json((carriedFields[0]?.custom ?? {}) as never)}, ${ctx.user.id})`
      const people: { name: string; phone: string | null; email: string | null; role: string }[] = [
        { name: lead.contact_name, phone: lead.phone, email: lead.email, role: role.data },
        ...lead.extra_contacts.map((c) => ({ name: c.name, phone: c.phone, email: c.email, role: 'staff' })),
      ]
      for (const person of people) {
        const contactId = await newId(tx)
        await tx`insert into crm.contacts (id, market_code, full_name, phone, email, created_by)
                 values (${contactId}, ${lead.market_code}, ${person.name}, ${person.phone}, ${person.email}, ${ctx.user.id})`
        await tx`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${accountId}, ${contactId}, ${lead.market_code}, ${person.role})`
      }
      await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by) values
        (${accountId}, ${lead.market_code}, 'origin', ${isWebSource(lead.source) ? 'form' : 'user'}, ${lead.form_id ?? ctx.user.id},
         ${lead.source === 'web_campaign' ? 'Campaña web' : lead.source === 'web_form' ? 'Formulario web' : ctx.user.name}, ${ctx.user.id}),
        (${accountId}, ${lead.market_code}, 'channel', 'team', ${pipe.motor}, ${pipe.motor.toUpperCase()}, ${ctx.user.id}),
        (${accountId}, ${lead.market_code}, 'owner', 'user', ${ownerId}, (select full_name from crm.users where id = ${ownerId}), ${ctx.user.id})`
    }
    // Lo que el lead ya tenía por hacer es el próximo paso del negocio; solo si no había nada se crea la tarea de siempre.
    const pending = await tx<{ id: string; subject: string; due: string | null }[]>`
      select id, subject, (due_at at time zone 'UTC')::date::text as due from crm.activities
       where lead_id = ${leadId} and done_at is null and kind in ('task', 'visit') order by due_at nulls last, created_at limit 1`
    const carried = pending[0]
    const dealId = await newId(tx)
    const nextStep = carried?.subject ?? (market.locale === 'en' ? 'Call to schedule the first meeting' : 'Llamar para agendar la primera visita')
    await tx`insert into crm.deals (id, market_code, pipeline_id, stage_id, account_id, lead_id, owner_id, title, currency, next_step, next_step_due, created_by)
             values (${dealId}, ${lead.market_code}, ${pipe.id}, ${pipe.stage_id}, ${accountId}, ${leadId}, ${ownerId},
                     ${(market.locale === 'en' ? 'Onboarding: ' : 'Alta: ') + lead.business_name}, ${market.currency}, ${nextStep},
                     ${carried?.due ? tx`${carried.due}::date` : marketWorkday(tx, lead.market_code, 2)}, ${ctx.user.id})`
    await tx`insert into crm.deal_stage_events (deal_id, market_code, to_stage_id, actor_id) values (${dealId}, ${lead.market_code}, ${pipe.stage_id}, ${ctx.user.id})`
    // La historia del lead sigue al comercio y al negocio: mismas filas, ahora ligadas a los tres.
    const moved = await tx`update crm.activities set account_id = ${accountId}, deal_id = ${dealId} where lead_id = ${leadId}`
    // El próximo paso del negocio es una tarea del carril de quien vende (la regla de siempre): la que traía el lead o la nueva.
    if (carried) {
      await tx`update crm.activities set deal_step = 'sales' where id = ${carried.id}`
    } else {
      await tx`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by, deal_step)
               values (${lead.market_code}, ${accountId}, ${dealId}, 'task', ${nextStep}, ((${marketWorkday(tx, lead.market_code, 2)} + time '15:00') at time zone 'UTC'), ${ownerId}, ${ctx.user.id}, 'sales')`
    }
    // Lo que la persona escribió al pedir contacto no se queda en el lead: pasa al hilo del comercio y del negocio como primera nota, con su fecha.
    if (lead.message && lead.message.trim()) {
      await tx`insert into crm.activities (market_code, lead_id, account_id, deal_id, kind, subject, body, done_at, owner_id, created_by, source)
               values (${lead.market_code}, ${leadId}, ${accountId}, ${dealId}, 'note',
                       ${isWebSource(lead.source) ? ctx.t('Mensaje del formulario', 'Message from the form') : ctx.t('Mensaje del lead', 'Message on the lead')},
                       ${lead.message.trim().slice(0, 1000)}, ${lead.created_at}, ${ownerId}, ${ctx.user.id}, 'rule')`
    }
    await tx`update crm.leads set status = 'converted', account_id = ${accountId} where id = ${leadId}`
    await audit(tx, ctx, 'lead.converted', 'lead', leadId, lead.market_code, { status: 'qualified' },
      { status: 'converted', account_id: accountId, deal_id: dealId, pipeline_id: pipe.id, account_type: opts.linkAccountId ? null : accountType, contact_role: opts.linkAccountId ? null : role.data, history_moved: moved.count })
    await emit(tx, 'lead.converted', 'lead', leadId, lead.market_code, { account_id: accountId, deal_id: dealId })
    return { accountId, dealId }
  })
}
