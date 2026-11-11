import 'server-only'
import { z } from 'zod'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit, newId, clean } from '@/domain/common'
import { DomainError, invalid, notFound } from '@/lib/errors'
import { toE164 } from '@/lib/format'
import { assertNoProhibited } from '@/domain/guard'
import { scrub } from '@/domain/pipedrive/mapping'

export const MOTORS = ['d2d', 'b2b', 'dealer'] as const

const leadInput = z.object({
  market: z.string().length(2),
  motor: z.enum(MOTORS),
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
}

async function loadLead(tx: Tx, id: string): Promise<LeadRow> {
  const rows = await tx<LeadRow[]>`select id, market_code, status, owner_id, motor, business_name, contact_name, phone, email::text, locality,
    account_id, first_touch_at, source, form_id from crm.leads where id = ${id} for update`
  if (!rows[0]) throw notFound('No encontramos ese lead.', 'We could not find that lead.')
  return rows[0]
}

async function insertLead(
  tx: Tx,
  ctx: Ctx,
  v: z.output<typeof leadInput>,
  opts: { source: 'manual' | 'web_form'; formId: string | null; ownerId: string | null; slaMinutes: number },
): Promise<string> {
  // SEC-08: lo que captura una persona se rechaza con explicación; lo que llega del formulario público se guarda sin el dato
  // prohibido, para no perder el lead por un texto que escribió el comercio.
  if (opts.source === 'manual') assertNoProhibited(v.message, v.businessName, v.contactName)
  else v = { ...v, message: v.message ? scrub(v.message) : v.message }
  const market = ctx.market(v.market)
  const phone = v.phone ? toE164(v.phone, market.phoneCc) : null
  if (v.phone && !phone) throw invalid('El teléfono no parece válido.', 'The phone number does not look valid.')
  if (v.email && !z.string().email().safeParse(v.email).success) throw invalid('El correo no parece válido.', 'The email does not look valid.')
  if (!phone && !v.email) throw invalid('Deja un teléfono o un correo para poder contactar.', 'Add a phone or an email so we can reach them.')
  const dup = await tx<{ id: string }[]>`select id from app.duplicate_candidates(${v.market}, ${v.businessName}, ${phone})`
  const id = await newId(tx)
  await tx`insert into crm.leads (id, market_code, source, form_id, motor, business_name, contact_name, phone, email, locality, message,
                                  status, owner_id, assigned_at, sla_due_at, duplicate_of)
           values (${id}, ${v.market}, ${opts.source}, ${opts.formId}, ${v.motor}, ${v.businessName}, ${v.contactName}, ${phone},
                   ${clean(v.email)}, ${clean(v.locality)}, ${clean(v.message)}, 'new', ${opts.ownerId},
                   ${opts.ownerId ? tx`now()` : null}, now() + make_interval(mins => ${opts.slaMinutes}), ${dup[0]?.id ?? null})`
  await audit(tx, ctx, 'lead.created', 'lead', id, v.market, null, { source: opts.source, motor: v.motor, owner_id: opts.ownerId })
  await emit(tx, 'lead.created', 'lead', id, v.market, { source: opts.source, motor: v.motor })
  return id
}

export async function createLead(ctx: Ctx, input: LeadInput): Promise<string> {
  const v = leadInput.parse(input)
  ctx.assert('lead.create', v.market)
  return withUser(ctx.user.id, (tx) => insertLead(tx, ctx, v, { source: 'manual', formId: null, ownerId: ctx.user.id, slaMinutes: 60 }))
}

const formPayload = z.object({
  business_name: z.string().trim().min(2).max(120),
  contact_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().max(160).optional().default(''),
  locality: z.string().trim().max(120).optional().default(''),
  message: z.string().trim().max(1000).optional().default(''),
  website: z.string().max(0).optional().default(''), // trampa para bots: debe llegar vacío
})

/**
 * LEAD-03: entrada de un formulario web. Corre como usuario de sistema, es idempotente (REL-07)
 * y asigna por la regla del formulario (round robin atómico en la base).
 */
export async function intakeFromForm(sys: Ctx, slug: string, raw: unknown, idempotencyKey: string): Promise<{ leadId: string; duplicate: boolean }> {
  const parsed = formPayload.safeParse(raw)
  if (!parsed.success) throw invalid('Revisa los datos del formulario.', 'Check the form fields.')
  const p = parsed.data
  return withUser(sys.user.id, async (tx) => {
    const forms = await tx<{ id: string; market_code: string; motor: (typeof MOTORS)[number]; routing_rule_id: string | null }[]>`
      select id, market_code, motor, routing_rule_id from crm.web_forms where slug = ${slug} and is_active`
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
      { market: form.market_code, motor: form.motor, businessName: p.business_name, contactName: p.contact_name, phone: p.phone, email: p.email, locality: p.locality, message: p.message },
      { source: 'web_form', formId: form.id, ownerId, slaMinutes: sla },
    )
    await tx`update crm.inbound_events set status = 'processed', processed_at = now(), payload = ${tx.json({ form: slug, lead_id: leadId })}
             where id = ${seen[0].id}`
    return { leadId, duplicate: false }
  })
}

export async function markContacted(ctx: Ctx, leadId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    if (!['new', 'contacted'].includes(lead.status)) throw invalid('Este lead ya se trabajó.', 'This lead was already worked.')
    await tx`update crm.leads set status = 'contacted', first_touch_at = coalesce(first_touch_at, now()) where id = ${leadId}`
    await audit(tx, ctx, 'lead.contacted', 'lead', leadId, lead.market_code, { status: lead.status }, { status: 'contacted' })
  })
}

export async function qualifyLead(ctx: Ctx, leadId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    if (!['new', 'contacted'].includes(lead.status)) throw invalid('Solo se califica un lead nuevo o contactado.', 'Only a new or contacted lead can be qualified.')
    await tx`update crm.leads set status = 'qualified', first_touch_at = coalesce(first_touch_at, now()) where id = ${leadId}`
    await audit(tx, ctx, 'lead.qualified', 'lead', leadId, lead.market_code, { status: lead.status }, { status: 'qualified' })
  })
}

export async function disqualifyLead(ctx: Ctx, leadId: string, reasonCode: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    if (lead.status === 'converted') throw invalid('Este lead ya se convirtió.', 'This lead was already converted.')
    const reason = await tx`select 1 from crm.loss_reasons where code = ${reasonCode} and kind = 'lost' and is_active`
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
    if (lead.owner_id) throw invalid('Este lead ya tiene dueño. Pide a tu supervisor que lo reasigne.', 'This lead already has an owner. Ask your supervisor to reassign it.')
    await tx`update crm.leads set owner_id = ${ctx.user.id}, assigned_at = now() where id = ${leadId} and owner_id is null`
    await audit(tx, ctx, 'lead.taken', 'lead', leadId, lead.market_code, { owner_id: null }, { owner_id: ctx.user.id })
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
  })
}

/**
 * LEAD-01: al convertir, el prospecto queda dentro del objeto cuenta, con su contacto,
 * su atribución de origen y un deal con próximo paso (ACT-02).
 */
export async function convertLead(ctx: Ctx, leadId: string, opts: { linkAccountId?: string | null } = {}): Promise<{ accountId: string; dealId: string }> {
  return withUser(ctx.user.id, async (tx) => {
    const lead = await loadLead(tx, leadId)
    ctx.assert('lead.work', lead.market_code)
    if (lead.status !== 'qualified') throw invalid('Califica el lead antes de convertirlo.', 'Qualify the lead before converting it.')
    const market = ctx.market(lead.market_code)
    const pipes = await tx<{ id: string; stage_id: string }[]>`
      select p.id, (select s.id from crm.stages s where s.pipeline_id = p.id order by s.position limit 1) as stage_id
        from crm.pipelines p where p.market_code = ${lead.market_code} and p.motor = ${lead.motor} and p.is_active order by p.position limit 1`
    const pipe = pipes[0]
    if (!pipe) throw new DomainError('no_pipeline', 'Este mercado no tiene pipeline para ese motor.', 'This market has no pipeline for that motor.')
    const ownerId = lead.owner_id ?? ctx.user.id

    let accountId = opts.linkAccountId ?? null
    if (accountId) {
      const acc = await tx`select 1 from crm.accounts where id = ${accountId} and market_code = ${lead.market_code} and archived_at is null`
      if (!acc[0]) throw notFound('No puedes ver ese comercio para ligarlo.', 'You cannot see that merchant to link it.')
    } else {
      accountId = await newId(tx)
      await tx`insert into crm.accounts (id, market_code, kind, name, segment, lifecycle, owner_id, phone, email, locality, country, created_by)
               values (${accountId}, ${lead.market_code}, 'store', ${lead.business_name}, ${lead.motor}, 'prospect', ${ownerId},
                       ${lead.phone}, ${lead.email}, ${lead.locality}, ${lead.market_code}, ${ctx.user.id})`
      const contactId = await newId(tx)
      await tx`insert into crm.contacts (id, market_code, full_name, phone, email, created_by)
               values (${contactId}, ${lead.market_code}, ${lead.contact_name}, ${lead.phone}, ${lead.email}, ${ctx.user.id})`
      await tx`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${accountId}, ${contactId}, ${lead.market_code}, 'owner')`
      await tx`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, created_by) values
        (${accountId}, ${lead.market_code}, 'origin', ${lead.source === 'web_form' ? 'form' : 'user'}, ${lead.form_id ?? ctx.user.id},
         ${lead.source === 'web_form' ? 'Formulario web' : ctx.user.name}, ${ctx.user.id}),
        (${accountId}, ${lead.market_code}, 'channel', 'team', ${lead.motor}, ${lead.motor.toUpperCase()}, ${ctx.user.id}),
        (${accountId}, ${lead.market_code}, 'owner', 'user', ${ownerId}, (select full_name from crm.users where id = ${ownerId}), ${ctx.user.id})`
    }
    const dealId = await newId(tx)
    const nextStep = market.locale === 'en' ? 'Call to schedule the first meeting' : 'Llamar para agendar la primera visita'
    await tx`insert into crm.deals (id, market_code, pipeline_id, stage_id, account_id, lead_id, owner_id, title, currency, next_step, next_step_due, created_by)
             values (${dealId}, ${lead.market_code}, ${pipe.id}, ${pipe.stage_id}, ${accountId}, ${leadId}, ${ownerId},
                     ${(market.locale === 'en' ? 'Onboarding: ' : 'Alta: ') + lead.business_name}, ${market.currency}, ${nextStep}, ${marketToday(tx, lead.market_code)} + 2, ${ctx.user.id})`
    await tx`insert into crm.deal_stage_events (deal_id, market_code, to_stage_id, actor_id) values (${dealId}, ${lead.market_code}, ${pipe.stage_id}, ${ctx.user.id})`
    await tx`insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by)
             values (${lead.market_code}, ${accountId}, ${dealId}, 'task', ${nextStep}, ((${marketToday(tx, lead.market_code)} + 2 + time '15:00') at time zone 'UTC'), ${ownerId}, ${ctx.user.id})`
    await tx`update crm.leads set status = 'converted', account_id = ${accountId} where id = ${leadId}`
    await audit(tx, ctx, 'lead.converted', 'lead', leadId, lead.market_code, { status: 'qualified' }, { status: 'converted', account_id: accountId, deal_id: dealId })
    await emit(tx, 'lead.converted', 'lead', leadId, lead.market_code, { account_id: accountId, deal_id: dealId })
    return { accountId, dealId }
  })
}
