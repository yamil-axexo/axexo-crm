import 'server-only'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { withUser, marketToday, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean, newId } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { forbidden, invalid, notFound } from '@/lib/errors'
import { esignAdapter, externalIdentityAdapter, type ExternalState } from '@/server/adapters/partners'
import { queueExternal } from '@/domain/external-queue'

/**
 * Paquete partners-contratos (0033).
 * PIPE-07: términos comerciales versionados por cuenta, propuesta imprimible y contrato con estado. La firma electrónica es un
 * adaptador apagado: "firmado" se marca a mano con fecha, quién firmó y el enlace a donde vive el documento.
 * CANAL-01: acceso de partner a un subárbol (lo decide RLS) y token de lectura por subárbol para la API.
 * PIPE-08: plan compartido de integración con hitos y dueño de cada lado.
 * CANAL-06: niveles con criterios publicados, habilitación por nivel (enlaces a Kore Academy) y cruce de bases.
 */
type Pair = [es: string, en: string]
const uuid = z.guid()
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// ------------------------------------------------------------ PIPE-07: términos comerciales
export const SETTLEMENTS = ['prepaid', 'ach_credit', 'other'] as const
export const SETTLEMENT_LABEL: Record<(typeof SETTLEMENTS)[number], Pair> = {
  prepaid: ['Prepago', 'Prepaid'],
  ach_credit: ['Crédito por ACH', 'ACH credit'],
  other: ['Otro (en notas)', 'Other (see notes)'],
}
export type CommissionLine = { product: string; pct: number; /** PIPE-07 (embudo2): el producto del catálogo (crm.products) al que se liga la línea, si se encontró. */ product_id?: string | null; product_code?: string | null }

/** PIPE-07 (embudo2): cada línea se liga al catálogo de productos por nombre o código. La que no se encuentra queda marcada "sin ligar". */
export async function linkCommissionLines(tx: Tx, lines: CommissionLine[]): Promise<CommissionLine[]> {
  const products = await tx<{ id: string; name: string; code: string | null }[]>`select id, name, code from crm.products where is_active`
  return lines.map((l) => {
    const key = l.product.trim().toLowerCase()
    const hit = products.find((p) => p.name.trim().toLowerCase() === key || (p.code ?? '').trim().toLowerCase() === key)
    return { ...l, product_id: hit?.id ?? null, product_code: hit?.code ?? null }
  })
}

/** "Recargas: 4.5" por renglón. Acepta coma decimal. Devuelve las líneas o un error claro. */
export function parseCommissionLines(text: string): CommissionLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0 || lines.length > 20) throw invalid('Escribe de 1 a 20 productos, uno por renglón, como "Recargas: 4.5".', 'Write 1 to 20 products, one per line, like "Top-ups: 4.5".')
  return lines.map((l) => {
    const m = /^(.{2,80}?)\s*[:=]\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*%?$/.exec(l)
    const pct = m ? Number(m[2]!.replace(',', '.')) : NaN
    if (!m || !(pct >= 0 && pct <= 100)) throw invalid(`No entendimos "${l.slice(0, 60)}". Usa producto, dos puntos y el porcentaje, como "Recargas: 4.5".`, `We could not read "${l.slice(0, 60)}". Use product, a colon and the percentage, like "Top-ups: 4.5".`)
    return { product: m[1]!.trim(), pct }
  })
}

const termsInput = z.object({
  lines: z.string().max(2000),
  settlement: z.enum(SETTLEMENTS),
  fees: z.string().trim().max(300).optional().default(''),
  nda: z.boolean().optional().default(false),
  termMonths: z.coerce.number().int().min(1).max(120),
  validFrom: isoDay,
  renewalNoticeDays: z.coerce.number().int().min(0).max(365).optional().default(30),
  note: z.string().trim().max(500).optional().default(''),
})
export type TermsInput = z.input<typeof termsInput>

type AccountRow = { id: string; market_code: string; legal_entity_id: string | null; name: string; owner_id: string | null }
async function account(tx: Tx, id: string): Promise<AccountRow> {
  const rows = await tx<AccountRow[]>`select id, market_code, legal_entity_id, name, owner_id from crm.accounts where id = ${uuid.parse(id)} and archived_at is null`
  if (!rows[0]) throw notFound()
  return rows[0]
}

/**
 * Una versión nueva de los términos de una cuenta. La anterior deja de ser la vigente y se conserva: se capturan una vez
 * y de aquí salen la propuesta y el contrato. Son dato reservado: la base deja escribir solo a quien el campo deja.
 */
export async function saveTerms(ctx: Ctx, accountId: string, raw: TermsInput): Promise<{ id: string; version: number }> {
  const p = termsInput.safeParse(raw)
  if (!p.success) throw invalid('Revisa los términos: plazo de 1 a 120 meses, fecha de inicio y aviso de renovación de 0 a 365 días.', 'Check the terms: a term of 1 to 120 months, a start date and a renewal notice of 0 to 365 days.')
  const v = p.data
  const lines = parseCommissionLines(v.lines)
  assertNoProhibited(v.fees, v.note, ...lines.map((l) => l.product))
  return withUser(ctx.user.id, async (tx) => {
    const a = await account(tx, accountId)
    ctx.assert('terms.manage', a.market_code)
    const can = await tx<{ ok: boolean }[]>`select app.sensitive_can('commercial_terms', ${a.id}, 'edit') as ok`
    if (!can[0]?.ok) throw forbidden()
    const prev = await tx<{ id: string; version: number }[]>`
      update crm.commercial_terms set is_current = false where account_id = ${a.id} and is_current returning id, version`
    const max = await tx<{ v: number }[]>`select coalesce(max(version), 0)::int as v from crm.commercial_terms where account_id = ${a.id}`
    const version = (max[0]?.v ?? 0) + 1
    const id = await newId(tx)
    const linked = await linkCommissionLines(tx, lines)
    await tx`insert into crm.commercial_terms (id, account_id, market_code, legal_entity_id, version, commission_lines, settlement, fees, nda, term_months,
                                              valid_from, valid_to, renewal_notice_days, note, supersedes, created_by)
             values (${id}, ${a.id}, ${a.market_code}, ${a.legal_entity_id}, ${version}, ${tx.json(linked as never)}, ${v.settlement}, ${clean(v.fees)}, ${v.nda},
                     ${v.termMonths}, ${v.validFrom}::date, (${v.validFrom}::date + make_interval(months => ${v.termMonths}))::date,
                     ${v.renewalNoticeDays}, ${clean(v.note)}, ${prev[0]?.id ?? null}, ${ctx.user.id})`
    // La bitácora dice qué versión y cuántos productos, nunca los porcentajes: los términos son dato reservado.
    await audit(tx, ctx, 'terms.versioned', 'account', a.id, a.market_code, prev[0] ? { version: prev[0].version } : null,
      { version, products: lines.length, linked: linked.filter((l) => l.product_id).length, settlement: v.settlement, nda: v.nda, term_months: v.termMonths })
    return { id, version }
  })
}

// ------------------------------------------------------------ PIPE-07: contratos
export const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'active', 'expired', 'cancelled'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, Pair> = {
  draft: ['Borrador', 'Draft'],
  sent: ['Enviado', 'Sent'],
  signed: ['Firmado', 'Signed'],
  active: ['Vigente', 'Active'],
  expired: ['Vencido', 'Expired'],
  cancelled: ['Cancelado', 'Cancelled'],
}

type ContractRow = { id: string; account_id: string; market_code: string; status: ContractStatus; starts_on: string; ends_on: string }
async function contract(tx: Tx, id: string): Promise<ContractRow> {
  const rows = await tx<ContractRow[]>`select id, account_id, market_code, status, starts_on::text, ends_on::text from crm.contracts where id = ${uuid.parse(id)} for update`
  if (!rows[0]) throw notFound()
  return rows[0]
}

/** El contrato nace en borrador desde los términos vigentes: mismas fechas, mismo aviso de renovación. */
export async function createContract(ctx: Ctx, accountId: string, renewedFrom?: string | null): Promise<string> {
  return withUser(ctx.user.id, async (tx) => {
    const a = await account(tx, accountId)
    ctx.assert('contract.manage', a.market_code)
    const terms = await tx<{ id: string; valid_from: string; valid_to: string; renewal_notice_days: number }[]>`
      select id, valid_from::text, valid_to::text, renewal_notice_days from crm.commercial_terms where account_id = ${a.id} and is_current`
    const tr = terms[0]
    if (!tr) throw invalid('Primero captura los términos comerciales de la cuenta: el contrato sale de ellos.', 'First capture the account’s commercial terms: the contract comes from them.')
    const open = await tx`select 1 from crm.contracts where account_id = ${a.id} and terms_id = ${tr.id} and status in ('draft','sent')`
    if (open[0]) throw invalid('Ya hay un contrato en borrador o enviado con estos términos.', 'There is already a draft or sent contract with these terms.')
    const id = await newId(tx)
    await tx`insert into crm.contracts (id, account_id, market_code, terms_id, starts_on, ends_on, renewal_notice_days, renewed_from, created_by)
             values (${id}, ${a.id}, ${a.market_code}, ${tr.id}, ${tr.valid_from}::date, ${tr.valid_to}::date, ${tr.renewal_notice_days},
                     ${renewedFrom ? uuid.parse(renewedFrom) : null}, ${ctx.user.id})`
    await audit(tx, ctx, renewedFrom ? 'contract.renewed' : 'contract.created', 'account', a.id, a.market_code, null, { contract_id: id, status: 'draft', renewed_from: renewedFrom ?? null })
    return id
  })
}

/** Enviar: la firma electrónica está apagada, así que el envío queda en la cola con "Canal apagado" y el documento sale por tu medio. */
const signerInput = z.object({ signerEmail: z.string().trim().toLowerCase().email().max(160), signerName: z.string().trim().min(2).max(120), documentUrl: z.string().trim().regex(/^https:\/\/[^ ]{4,400}$/) })
export async function sendContract(ctx: Ctx, id: string, signer?: { signerEmail?: string; signerName?: string; documentUrl?: string }): Promise<ExternalState> {
  // Con la firma electrónica encendida hacen falta quién firma y el documento; apagada, el envío queda en la cola.
  const es = esignAdapter()
  const who = es.mode === 'live' ? signerInput.safeParse(signer ?? {}) : null
  if (who && !who.success) throw invalid('Para mandar a firmar escribe el correo y el nombre de quien firma y el enlace del documento.', 'To send for signature enter the signer’s email and name and the document link.')
  return withUser(ctx.user.id, async (tx) => {
    const c = await contract(tx, id)
    ctx.assert('contract.manage', c.market_code)
    if (c.status !== 'draft') throw invalid('Solo se envía un contrato en borrador.', 'Only a draft contract can be sent.')
    const state = await es.requestSignature({ contractId: c.id, title: `Contrato ${c.id.slice(0, 8)}`, ...(who?.success ? who.data : {}) })
    await queueExternal(tx, ctx.user.id, { adapter: 'esign', object: 'contract', objectId: c.id, market: c.market_code, summary: 'Solicitud de firma electrónica de un contrato', status: state })
    // Si el proveedor de firma rechazó el envío, el contrato sigue en borrador y la falla queda anotada.
    if (state === 'failed') await tx`update crm.contracts set esign_state = 'failed', updated_at = now() where id = ${c.id}`
    else await tx`update crm.contracts set status = 'sent', sent_at = now(), esign_state = ${state}, updated_at = now() where id = ${c.id}`
    await audit(tx, ctx, 'contract.status_changed', 'account', c.account_id, c.market_code, { contract_id: c.id, status: c.status }, { contract_id: c.id, status: 'sent' })
    return state
  })
}

const signedInput = z.object({ signedOn: isoDay, signedBy: z.string().trim().min(2).max(120), documentUrl: z.string().trim().regex(/^https:\/\/[^ ]{4,400}$/) })
/** Firmado a mano: fecha, quién firmó del lado del cliente y enlace a donde vive el documento. Si ya empezó, queda vigente. */
export async function markSigned(ctx: Ctx, id: string, raw: z.input<typeof signedInput>): Promise<ContractStatus> {
  const p = signedInput.safeParse(raw)
  if (!p.success) throw invalid('Escribe la fecha de firma, quién firmó y el enlace al documento (empieza con https://).', 'Write the signing date, who signed and the link to the document (starts with https://).')
  const v = p.data
  assertNoProhibited(v.signedBy, v.documentUrl)
  return withUser(ctx.user.id, async (tx) => {
    const c = await contract(tx, id)
    ctx.assert('contract.manage', c.market_code)
    if (c.status !== 'draft' && c.status !== 'sent') throw invalid('Este contrato ya está firmado o cerrado.', 'This contract is already signed or closed.')
    const today = (await tx<{ d: string }[]>`select ${marketToday(tx, c.market_code)}::text as d`)[0]!.d
    if (v.signedOn > today) throw invalid('La fecha de firma no puede ser futura.', 'The signing date cannot be in the future.')
    const next: ContractStatus = c.starts_on <= today ? (c.ends_on < today ? 'expired' : 'active') : 'signed'
    await tx`update crm.contracts set status = ${next}, signed_on = ${v.signedOn}::date, signed_by_name = ${v.signedBy}, document_url = ${v.documentUrl},
                    marked_by = ${ctx.user.id}, updated_at = now() where id = ${c.id}`
    await audit(tx, ctx, 'contract.signed', 'account', c.account_id, c.market_code, { contract_id: c.id, status: c.status }, { contract_id: c.id, status: next, signed_on: v.signedOn })
    return next
  })
}

export async function cancelContract(ctx: Ctx, id: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const c = await contract(tx, id)
    ctx.assert('contract.manage', c.market_code)
    if (c.status === 'expired' || c.status === 'cancelled') throw invalid('Este contrato ya está cerrado.', 'This contract is already closed.')
    await tx`update crm.contracts set status = 'cancelled', updated_at = now() where id = ${c.id}`
    await audit(tx, ctx, 'contract.status_changed', 'account', c.account_id, c.market_code, { contract_id: c.id, status: c.status }, { contract_id: c.id, status: 'cancelled' })
  })
}

/** Renovar: un contrato nuevo en borrador con los términos vigentes (si cambiaron, primero se guarda la versión nueva). */
export async function renewContract(ctx: Ctx, id: string): Promise<string> {
  const c = await withUser(ctx.user.id, (tx) => contract(tx, id))
  if (c.status !== 'active' && c.status !== 'expired' && c.status !== 'signed') throw invalid('Se renueva un contrato firmado, vigente o vencido.', 'A signed, active or expired contract can be renewed.')
  return createContract(ctx, c.account_id, c.id)
}

/**
 * Tarea diaria: firmado pasa a vigente al llegar su inicio, vigente pasa a vencido al pasar su fin, y el aviso de renovación
 * le llega a quien lleva la cuenta cuando faltan los días pactados. Segura de correr dos veces.
 */
export async function contractsDaily(tx: Tx, notifyOwner: (tx: Tx, c: { account_id: string; market_code: string; owner_id: string; name: string; ends_on: string; contract_id: string }) => Promise<void>): Promise<number> {
  const sys = (await tx<{ id: string }[]>`select app.system_user_id() as id`)[0]!.id
  const log = (accountId: string, market: string, contractId: string, from: string, to: string) => tx`
    insert into crm.audit_events (actor_id, action, object, object_id, market_code, before, after)
    values (${sys}, 'contract.status_changed', 'account', ${accountId}, ${market}, ${tx.json({ contract_id: contractId, status: from })}, ${tx.json({ contract_id: contractId, status: to })})`
  let n = 0
  const started = await tx<{ id: string; account_id: string; market_code: string }[]>`
    update crm.contracts c set status = 'active', updated_at = now()
     where c.status = 'signed' and c.starts_on <= ${marketToday(tx, tx`c.market_code`)} returning c.id, c.account_id, c.market_code`
  for (const r of started) await log(r.account_id, r.market_code, r.id, 'signed', 'active')
  const ended = await tx<{ id: string; account_id: string; market_code: string }[]>`
    update crm.contracts c set status = 'expired', updated_at = now()
     where c.status = 'active' and c.ends_on < ${marketToday(tx, tx`c.market_code`)} returning c.id, c.account_id, c.market_code`
  for (const r of ended) await log(r.account_id, r.market_code, r.id, 'active', 'expired')
  n += started.length + ended.length
  const due = await tx<{ id: string; account_id: string; market_code: string; owner_id: string | null; name: string; ends_on: string }[]>`
    select c.id, c.account_id, c.market_code, a.owner_id, a.name, c.ends_on::text
      from crm.contracts c join crm.accounts a on a.id = c.account_id
     where c.status = 'active' and c.renewal_noticed_at is null
       and c.ends_on - c.renewal_notice_days <= ${marketToday(tx, tx`c.market_code`)}
       and not exists (select 1 from crm.contracts r where r.renewed_from = c.id and r.status <> 'cancelled')`
  for (const c of due) {
    if (c.owner_id) await notifyOwner(tx, { account_id: c.account_id, market_code: c.market_code, owner_id: c.owner_id, name: c.name, ends_on: c.ends_on, contract_id: c.id })
    await tx`update crm.contracts set renewal_noticed_at = now() where id = ${c.id}`
    await tx`insert into crm.audit_events (actor_id, action, object, object_id, market_code, after)
             values (${sys}, 'contract.renewal_noticed', 'account', ${c.account_id}, ${c.market_code}, ${tx.json({ contract_id: c.id, ends_on: c.ends_on })})`
    n += 1
  }
  return n
}

// ------------------------------------------------------------ CANAL-01: acceso de partner y token por subárbol
const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex')
export const partnerTokenHash = hashToken

/** Da a una persona el rol de partner sobre un nodo (ISO, agente, distribuidor): ve ese nodo y todo lo que cuelga de él. */
export async function grantPartnerAccess(ctx: Ctx, input: { userId: string; accountId: string }): Promise<void> {
  ctx.assert('access.manage')
  await withUser(ctx.user.id, async (tx) => {
    const a = await account(tx, input.accountId)
    const userId = uuid.parse(input.userId)
    const other = await tx`select 1 from crm.memberships where user_id = ${userId} and (valid_to is null or valid_to > now())`
    if (other[0]) throw invalid('Esa persona ya tiene un acceso. Un usuario de partner no combina su rol con otro.', 'That person already has access. A partner user does not combine that role with another.')
    await tx`insert into crm.memberships (user_id, market_code, role, scope_account_id) values (${userId}, ${a.market_code}, 'partner', ${a.id})`
    await audit(tx, ctx, 'membership.granted', 'user', userId, a.market_code, null, { role: 'partner', market: a.market_code, scope: a.name })
  })
}

/** Invitar a una persona de afuera: la identidad de externos está apagada, la invitación queda en la cola con "Canal apagado". */
const externalEmail = z.string().trim().toLowerCase().email().max(160)
export async function invitePartnerUser(ctx: Ctx, accountId: string, email?: string | null): Promise<ExternalState> {
  ctx.assert('access.manage')
  const ext = externalIdentityAdapter()
  const mail = ext.mode === 'live' ? externalEmail.safeParse(email ?? '') : null
  if (mail && !mail.success) throw invalid('Escribe el correo de la persona a invitar.', 'Enter the email of the person to invite.')
  return withUser(ctx.user.id, async (tx) => {
    const a = await account(tx, accountId)
    const state = await ext.invite({ accountId: a.id, email: mail?.success ? mail.data : null })
    await queueExternal(tx, ctx.user.id, { adapter: 'external_identity', object: 'account', objectId: a.id, market: a.market_code, summary: `Invitación de acceso externo al portal de partners: ${a.name}`.slice(0, 300), status: state })
    await audit(tx, ctx, 'partner.invite_queued', 'account', a.id, a.market_code, null, { channel: state })
    return state
  })
}

/** Un token de lectura para la API, atado a una persona de partner: lo que el token lee es lo que esa persona ve (RLS). Se muestra una vez. */
export async function createPartnerToken(ctx: Ctx, input: { userId: string; label: string }): Promise<string> {
  const label = z.string().trim().min(2).max(80).safeParse(input.label)
  if (!label.success) throw invalid('Ponle un nombre al token (2 a 80 caracteres), por ejemplo el sistema del partner que lo usa.', 'Name the token (2 to 80 characters), for example the partner system that uses it.')
  assertNoProhibited(label.data)
  return withUser(ctx.user.id, async (tx) => {
    const m = await tx<{ scope_account_id: string; market_code: string }[]>`
      select scope_account_id, market_code from crm.memberships
       where user_id = ${uuid.parse(input.userId)} and role = 'partner' and valid_from <= now() and (valid_to is null or valid_to > now())`
    if (!m[0]) throw invalid('Esa persona no tiene acceso de partner vigente.', 'That person has no current partner access.')
    ctx.assert('partner.manage', m[0].market_code)
    const raw = `cpt_${randomBytes(24).toString('base64url')}`
    const id = await newId(tx)
    await tx`insert into crm.partner_tokens (id, scope_account_id, market_code, user_id, label, token_hash, created_by)
             values (${id}, ${m[0].scope_account_id}, ${m[0].market_code}, ${uuid.parse(input.userId)}, ${label.data}, ${hashToken(raw)}, ${ctx.user.id})`
    await audit(tx, ctx, 'partner_token.created', 'account', m[0].scope_account_id, m[0].market_code, null, { token_id: id, label: label.data })
    return raw
  })
}

export async function revokePartnerToken(ctx: Ctx, id: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ scope_account_id: string; market_code: string }[]>`
      update crm.partner_tokens set revoked_at = now(), revoked_by = ${ctx.user.id} where id = ${uuid.parse(id)} and revoked_at is null returning scope_account_id, market_code`
    if (!rows[0]) throw notFound()
    ctx.assert('partner.manage', rows[0].market_code)
    await audit(tx, ctx, 'partner_token.revoked', 'account', rows[0].scope_account_id, rows[0].market_code, null, { token_id: id })
  })
}

// ------------------------------------------------------------ PIPE-08: plan compartido de integración
export const PLAN_PHASES = ['specs', 'sandbox', 'certification', 'go_live', 'other'] as const
export const PLAN_PHASE_LABEL: Record<(typeof PLAN_PHASES)[number], Pair> = {
  specs: ['Especificaciones', 'Specs'],
  sandbox: ['Ambiente de pruebas', 'Sandbox'],
  certification: ['Certificación', 'Certification'],
  go_live: ['Salida a producción', 'Go-live'],
  other: ['Otro', 'Other'],
}
export const MILESTONE_STATUSES = ['pending', 'in_progress', 'done', 'blocked'] as const
export const MILESTONE_STATUS_LABEL: Record<(typeof MILESTONE_STATUSES)[number], Pair> = {
  pending: ['Por empezar', 'Not started'],
  in_progress: ['En curso', 'In progress'],
  done: ['Hecho', 'Done'],
  blocked: ['Detenido', 'Blocked'],
}
/** La plantilla: los hitos de siempre, con su lado. Los dueños y las fechas se ponen en el plan. */
export const PLAN_TEMPLATE: { phase: (typeof PLAN_PHASES)[number]; side: 'client' | 'axexo'; title: Pair }[] = [
  { phase: 'specs', side: 'axexo', title: ['Entregar especificaciones de la API', 'Deliver the API specs'] },
  { phase: 'specs', side: 'client', title: ['Confirmar alcance técnico y contacto de integración', 'Confirm technical scope and integration contact'] },
  { phase: 'sandbox', side: 'axexo', title: ['Dar acceso al ambiente de pruebas', 'Give sandbox access'] },
  { phase: 'sandbox', side: 'client', title: ['Completar las transacciones de prueba', 'Complete the test transactions'] },
  { phase: 'certification', side: 'axexo', title: ['Revisar y certificar la integración', 'Review and certify the integration'] },
  { phase: 'go_live', side: 'client', title: ['Salir a producción', 'Go live'] },
]

const planInput = z.object({ accountId: uuid, dealId: uuid.or(z.literal('')).optional().default(''), title: z.string().trim().min(2).max(120), axexoOwner: uuid, clientOwner: z.string().trim().min(2).max(120) })
/** Crea el plan desde la plantilla: los hitos de axexo quedan con la persona elegida y los del cliente con su contacto. */
export async function createPlan(ctx: Ctx, raw: z.input<typeof planInput>): Promise<string> {
  const p = planInput.safeParse(raw)
  if (!p.success) throw invalid('Escribe el nombre del plan, quién lo lleva de nuestro lado y el contacto del cliente.', 'Write the plan name, who owns it on our side and the client contact.')
  const v = p.data
  assertNoProhibited(v.title, v.clientOwner)
  return withUser(ctx.user.id, async (tx) => {
    const a = await account(tx, v.accountId)
    ctx.assert('plan.manage', a.market_code)
    const lang = ctx.locale === 'en' ? 1 : 0
    const id = await newId(tx)
    await tx`insert into crm.integration_plans (id, account_id, deal_id, market_code, title, started_on, created_by)
             values (${id}, ${a.id}, ${v.dealId || null}, ${a.market_code}, ${v.title}, ${marketToday(tx, a.market_code)}, ${ctx.user.id})`
    let pos = 1
    for (const m of PLAN_TEMPLATE) {
      await tx`insert into crm.plan_milestones (plan_id, account_id, market_code, position, phase, title, side, owner_user_id, owner_name)
               values (${id}, ${a.id}, ${a.market_code}, ${pos++}, ${m.phase}, ${m.title[lang]}, ${m.side},
                       ${m.side === 'axexo' ? v.axexoOwner : null}, ${m.side === 'client' ? v.clientOwner : null})`
    }
    await audit(tx, ctx, 'plan.created', 'account', a.id, a.market_code, null, { plan_id: id, milestones: PLAN_TEMPLATE.length, deal_id: v.dealId || null })
    return id
  })
}

const milestoneInput = z.object({
  phase: z.enum(PLAN_PHASES), title: z.string().trim().min(2).max(160), side: z.enum(['client', 'axexo']),
  ownerUserId: uuid.or(z.literal('')).optional().default(''), ownerName: z.string().trim().max(120).optional().default(''), dueOn: isoDay.or(z.literal('')).optional().default(''),
})
export async function addMilestone(ctx: Ctx, planId: string, raw: z.input<typeof milestoneInput>): Promise<void> {
  const p = milestoneInput.safeParse(raw)
  if (!p.success) throw invalid('Escribe el hito y su lado.', 'Write the milestone and its side.')
  const v = p.data
  if (v.side === 'axexo' ? !v.ownerUserId : v.ownerName.length < 2) throw invalid('Cada hito lleva responsable: de nuestro lado una persona de CONTIGO, del lado del cliente su nombre.', 'Each milestone has an owner: on our side a CONTIGO user, on the client side their name.')
  assertNoProhibited(v.title, v.ownerName)
  await withUser(ctx.user.id, async (tx) => {
    const plan = await tx<{ account_id: string; market_code: string }[]>`select account_id, market_code from crm.integration_plans where id = ${uuid.parse(planId)}`
    if (!plan[0]) throw notFound()
    ctx.assert('plan.manage', plan[0].market_code)
    await tx`insert into crm.plan_milestones (plan_id, account_id, market_code, position, phase, title, side, owner_user_id, owner_name, due_on)
             values (${planId}, ${plan[0].account_id}, ${plan[0].market_code}, (select coalesce(max(position), 0) + 1 from crm.plan_milestones where plan_id = ${planId}),
                     ${v.phase}, ${v.title}, ${v.side}, ${v.side === 'axexo' ? v.ownerUserId : null}, ${v.side === 'client' ? v.ownerName : null}, ${v.dueOn || null})`
    await audit(tx, ctx, 'plan.milestone_added', 'account', plan[0].account_id, plan[0].market_code, null, { plan_id: planId, phase: v.phase, side: v.side })
  })
}

const msUpdate = z.object({ status: z.enum(MILESTONE_STATUSES), dueOn: isoDay.or(z.literal('')).optional().default(''), note: z.string().trim().max(300).optional().default('') })
/** Cambia el estado de un hito. Al quedar hecha la certificación, el plan guarda el día: de ahí salen los días a certificación. */
export async function updateMilestone(ctx: Ctx, id: string, raw: z.input<typeof msUpdate>): Promise<void> {
  const p = msUpdate.safeParse(raw)
  if (!p.success) throw invalid('Revisa el estado y la fecha.', 'Check the status and the date.')
  const v = p.data
  assertNoProhibited(v.note)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ plan_id: string; account_id: string; market_code: string; status: string; phase: string }[]>`
      select plan_id, account_id, market_code, status, phase from crm.plan_milestones where id = ${uuid.parse(id)} for update`
    const m = rows[0]
    if (!m) throw notFound()
    ctx.assert('plan.manage', m.market_code)
    const today = marketToday(tx, m.market_code)
    await tx`update crm.plan_milestones set status = ${v.status}, due_on = ${v.dueOn || null}, note = ${clean(v.note)},
                    done_on = case when ${v.status} = 'done' then coalesce(done_on, ${today}) else null end, updated_at = now() where id = ${id}`
    if (m.phase === 'certification') {
      await tx`update crm.integration_plans p set certified_on =
                 (select case when bool_and(x.status = 'done') then max(x.done_on) end from crm.plan_milestones x where x.plan_id = p.id and x.phase = 'certification')
               where p.id = ${m.plan_id}`
    }
    await audit(tx, ctx, 'plan.milestone_updated', 'account', m.account_id, m.market_code, { milestone_id: id, status: m.status }, { milestone_id: id, status: v.status })
  })
}

/** Compartir el plan con el cliente: su acceso es la misma identidad de externos, apagada. Queda pedido y en la cola. */
export async function sharePlan(ctx: Ctx, planId: string, email?: string | null): Promise<ExternalState> {
  const ext = externalIdentityAdapter()
  const mail = ext.mode === 'live' ? externalEmail.safeParse(email ?? '') : null
  if (mail && !mail.success) throw invalid('Escribe el correo de la persona del cliente.', 'Enter the client person’s email.')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ account_id: string; market_code: string; title: string }[]>`select account_id, market_code, title from crm.integration_plans where id = ${uuid.parse(planId)} for update`
    if (!rows[0]) throw notFound()
    ctx.assert('plan.manage', rows[0].market_code)
    const state = await ext.invite({ accountId: rows[0].account_id, email: mail?.success ? mail.data : null })
    await queueExternal(tx, ctx.user.id, { adapter: 'external_identity', object: 'integration_plan', objectId: planId, market: rows[0].market_code, summary: `Acceso del cliente al plan de integración: ${rows[0].title}`.slice(0, 300), status: state })
    await tx`update crm.integration_plans set client_access = 'requested' where id = ${planId}`
    await audit(tx, ctx, 'plan.shared', 'account', rows[0].account_id, rows[0].market_code, null, { plan_id: planId, channel: state })
    return state
  })
}

// ------------------------------------------------------------ CANAL-06: niveles, habilitación y cruce de bases
/** Registrar una cuenta como partner (ISO, agente, distribuidor): entra al cálculo de nivel y al cruce de bases. */
export async function registerPartner(ctx: Ctx, accountId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const a = await account(tx, accountId)
    ctx.assert('partner.manage', a.market_code)
    const r = await tx`insert into crm.partner_profiles (account_id, market_code, since, created_by) values (${a.id}, ${a.market_code}, ${marketToday(tx, a.market_code)}, ${ctx.user.id})
                       on conflict (account_id) do update set ended_at = null where crm.partner_profiles.ended_at is not null returning account_id`
    if (r.length === 0) throw invalid('Esta cuenta ya está registrada como partner.', 'This account is already registered as a partner.')
    await audit(tx, ctx, 'partner.registered', 'account', a.id, a.market_code, null, { name: a.name })
  })
}

const tierInput = z.object({
  market: z.string().min(2).max(3), code: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), nameEs: z.string().trim().min(2).max(40), nameEn: z.string().trim().min(2).max(40),
  rank: z.coerce.number().int().min(1).max(10), minActive: z.coerce.number().int().min(0).max(100000), minQuality: z.coerce.number().int().min(0).max(100), minCompliance: z.coerce.number().int().min(0).max(100),
})
/** Criterios objetivos y publicados: PDV activos, calidad de altas y cumplimiento. Nada se negocia por partner. */
export async function saveTier(ctx: Ctx, raw: z.input<typeof tierInput>): Promise<void> {
  const p = tierInput.safeParse(raw)
  if (!p.success) throw invalid('Revisa el nivel: clave en minúsculas, nombre en español e inglés, orden de 1 a 10 y porcentajes de 0 a 100.', 'Check the tier: lowercase key, name in Spanish and English, order 1 to 10 and percentages 0 to 100.')
  const v = p.data
  ctx.assert('partner.manage', v.market)
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.partner_tiers (market_code, code, name_es, name_en, rank, min_active, min_quality_pct, min_compliance_pct)
             values (${v.market}, ${v.code}, ${v.nameEs}, ${v.nameEn}, ${v.rank}, ${v.minActive}, ${v.minQuality}, ${v.minCompliance})
             on conflict (market_code, code) do update set name_es = excluded.name_es, name_en = excluded.name_en, rank = excluded.rank,
               min_active = excluded.min_active, min_quality_pct = excluded.min_quality_pct, min_compliance_pct = excluded.min_compliance_pct, is_active = true`
    await audit(tx, ctx, 'partner_tier.saved', 'partner_tier', null, v.market, null, { code: v.code, rank: v.rank, min_active: v.minActive, min_quality_pct: v.minQuality, min_compliance_pct: v.minCompliance })
  })
}

const materialInput = z.object({ market: z.string().min(2).max(3), tier: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), titleEs: z.string().trim().min(2).max(120), titleEn: z.string().trim().min(2).max(120), url: z.string().trim().regex(/^https:\/\/[^ ]{4,400}$/) })
/** Material de habilitación por nivel: el enlace al curso de Kore Academy, no una copia. */
export async function addEnablement(ctx: Ctx, raw: z.input<typeof materialInput>): Promise<void> {
  const p = materialInput.safeParse(raw)
  if (!p.success) throw invalid('Escribe el título en español e inglés y el enlace al curso (empieza con https://).', 'Write the title in Spanish and English and the course link (starts with https://).')
  const v = p.data
  ctx.assert('partner.manage', v.market)
  assertNoProhibited(v.titleEs, v.titleEn)
  await withUser(ctx.user.id, async (tx) => {
    await tx`insert into crm.partner_enablement (market_code, tier_code, title_es, title_en, url, created_by) values (${v.market}, ${v.tier}, ${v.titleEs}, ${v.titleEn}, ${v.url}, ${ctx.user.id})`
    await audit(tx, ctx, 'partner_tier.material_added', 'partner_tier', null, v.market, null, { tier: v.tier, title: v.titleEs })
  })
}

export type TierMetrics = { active: number; nodes: number; enrolled_90d: number; quality_pct: number | null; compliance_pct: number | null }
/**
 * Nivel por período, para todos los partners registrados: PDV activos del subárbol, calidad de altas (de lo dado de alta en
 * 90 días, qué parte ya está activa) y cumplimiento (PDV sin avisos abiertos). Gana el nivel más alto cuyos tres mínimos se cumplen.
 */
export async function recalcTiers(tx: Tx): Promise<number> {
  const rows = await tx<{ account_id: string; market_code: string; period: string; active: number; nodes: number; enrolled: number; enrolled_active: number; clean: number }[]>`
    select p.account_id, p.market_code, to_char(${marketToday(tx, tx`p.market_code`)}, 'YYYY-MM') as period,
           count(*) filter (where d.lifecycle = 'active')::int as active,
           count(d.id)::int as nodes,
           count(*) filter (where d.created_at > now() - interval '90 days')::int as enrolled,
           count(*) filter (where d.created_at > now() - interval '90 days' and d.lifecycle = 'active')::int as enrolled_active,
           count(*) filter (where d.id is not null and not exists (select 1 from crm.exceptions e where e.account_id = d.id and e.resolved_at is null))::int as clean
      from crm.partner_profiles p
      left join crm.accounts d on d.ancestor_ids @> array[p.account_id] and d.archived_at is null and d.merged_into is null
     where p.ended_at is null
     group by p.account_id, p.market_code`
  for (const r of rows) {
    const m: TierMetrics = {
      active: r.active, nodes: r.nodes, enrolled_90d: r.enrolled,
      quality_pct: r.enrolled ? Math.round((100 * r.enrolled_active) / r.enrolled) : null,
      compliance_pct: r.nodes ? Math.round((100 * r.clean) / r.nodes) : null,
    }
    const tier = await tx<{ code: string }[]>`
      select code from crm.partner_tiers where market_code = ${r.market_code} and is_active
         and min_active <= ${m.active} and min_quality_pct <= ${m.quality_pct ?? 0} and min_compliance_pct <= ${m.compliance_pct ?? 0}
       order by rank desc limit 1`
    const code = tier[0]?.code ?? null
    await tx`update crm.partner_profiles set tier_code = ${code}, tier_period = ${r.period}, metrics = ${tx.json(m)}, computed_at = now() where account_id = ${r.account_id}`
    await tx`insert into crm.partner_tier_history (account_id, market_code, period, tier_code, metrics) values (${r.account_id}, ${r.market_code}, ${r.period}, ${code}, ${tx.json(m)})
             on conflict (account_id, period) do update set tier_code = excluded.tier_code, metrics = excluded.metrics, computed_at = now()`
  }
  return rows.length
}

/**
 * Cruce de bases: qué PDV del subárbol de un partner ya existen en la cartera propia (fuera de su subárbol), sobre llaves
 * fuertes: teléfono, identificador de otro sistema o índice ciego del identificador fiscal. El resultado tiene acceso restringido.
 */
export async function crossMatch(tx: Tx, market?: string | null): Promise<number> {
  await tx`delete from crm.partner_overlaps where ${market ?? null}::text is null or market_code = ${market ?? null}`
  const r = await tx`
    insert into crm.partner_overlaps (partner_account_id, market_code, node_account_id, own_account_id, match_key)
    select distinct p.account_id, p.market_code, n.id, o.id, k.key
      from crm.partner_profiles p
      join crm.accounts n on n.ancestor_ids @> array[p.account_id] and n.archived_at is null and n.merged_into is null
      join crm.accounts o on o.market_code = n.market_code and o.id <> n.id and o.id <> p.account_id
                         and not (o.ancestor_ids @> array[p.account_id]) and o.archived_at is null and o.merged_into is null
      cross join lateral (
        select 'phone'::text as key where n.phone is not null and n.phone = o.phone
        union all select 'tax_id' where n.tax_id_blind_ix is not null and n.tax_id_blind_ix = o.tax_id_blind_ix
        union all select 'alias' where exists (select 1 from crm.account_aliases x join crm.account_aliases y on y.system = x.system and y.external_id = x.external_id
                                                where x.account_id = n.id and y.account_id = o.id)
      ) k
     where p.ended_at is null and (${market ?? null}::text is null or p.market_code = ${market ?? null})
    on conflict do nothing`
  return r.count
}

export async function runCrossMatch(ctx: Ctx, market: string): Promise<number> {
  ctx.assert('partner.crossmatch', market)
  return withUser(ctx.user.id, async (tx) => {
    const n = await crossMatch(tx, market)
    await audit(tx, ctx, 'partner.crossmatch_run', 'account', null, market, null, { overlaps: n })
    return n
  })
}

export async function recalcTiersNow(ctx: Ctx, market: string): Promise<number> {
  ctx.assert('partner.manage', market)
  return withUser(ctx.user.id, async (tx) => {
    const n = await recalcTiers(tx)
    await audit(tx, ctx, 'partner_tier.recalculated', 'partner_tier', null, market, null, { partners: n })
    return n
  })
}
