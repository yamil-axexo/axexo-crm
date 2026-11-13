import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { notify, notifyMany, peopleWithRole } from '@/domain/notify'
import { invalid, notFound } from '@/lib/errors'
import { documentVault } from '@/server/adapters/document-vault'
import { threshold } from './thresholds'

/**
 * CAMPO-06: expediente digital del alta, capturado una vez, y mesa de control.
 * - El formulario maestro por país (crm.onboarding_requirements) dice qué se pide según tipo de persona y forma de pago.
 * - Cada documento tiene estado, quién lo validó y cuándo, observaciones, clase de dato y fecha de retención.
 * - CONTIGO no guarda el archivo: solo un enlace https al sistema que lo tiene o la referencia de la bóveda (apagada).
 * - La mesa de control trabaja una cola con plazo (umbral control_desk_sla_hours) y reparto.
 * - Prepago se autoaprueba por regla (umbral prepaid_auto_approve) cuando todo está recibido y nada rechazado; crédito ACH siempre pasa por la mesa.
 */
export const PERSON_TYPES = ['individual', 'company'] as const
export const FUNDINGS = ['prepaid', 'ach_credit'] as const
const CAPTURE = ['contigo', 'sales_app', 'link'] as const

const openInput = z.object({
  accountId: z.guid(),
  personType: z.enum(PERSON_TYPES),
  funding: z.enum(FUNDINGS),
  capturedVia: z.enum(CAPTURE).default('contigo'),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
})

export async function openFile(ctx: Ctx, raw: { accountId: string; personType: string; funding: string; capturedVia?: string; visitedOn?: string }): Promise<string> {
  const p = openInput.safeParse(raw)
  if (!p.success) throw invalid('Elige el comercio, el tipo de persona y la forma de pago.', 'Choose the merchant, the type of person and the payment method.')
  const d = p.data
  return withUser(ctx.user.id, async (tx) => {
    const acc = (await tx<{ market_code: string; name: string }[]>`select market_code, name from crm.accounts where id = ${d.accountId} and archived_at is null`)[0]
    if (!acc) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('onboarding.capture', acc.market_code)
    const live = await tx`select 1 from crm.onboarding_files where account_id = ${d.accountId} and status not in ('approved', 'auto_approved')`
    if (live[0]) throw invalid('Este comercio ya tiene un expediente abierto. Complétalo ahí.', 'This merchant already has an open file. Complete that one.')
    const reqs = await tx<{ code: string; pii_class: string; retention_days: number }[]>`
      select code, pii_class, retention_days from crm.onboarding_requirements
       where market_code = ${acc.market_code} and person_type = ${d.personType} and funding in (${d.funding}, 'any') and is_active order by position`
    if (reqs.length === 0) throw invalid('Este mercado todavía no tiene formulario de alta para ese tipo de persona. Pídeselo a quien lidera el mercado.', 'This market has no enrollment form for that type of person yet. Ask the market lead.')
    const visited = d.visitedOn ? d.visitedOn : null
    const rows = await tx<{ id: string }[]>`
      insert into crm.onboarding_files (account_id, market_code, person_type, funding, captured_via, visited_at, created_by)
      values (${d.accountId}, ${acc.market_code}, ${d.personType}, ${d.funding}, ${d.capturedVia}, ${visited}::date, ${ctx.user.id}) returning id`
    const id = rows[0]!.id
    for (const r of reqs) {
      await tx`insert into crm.onboarding_documents (file_id, account_id, market_code, requirement, pii_class, retention_until)
               values (${id}, ${d.accountId}, ${acc.market_code}, ${r.code}, ${r.pii_class}, (now() + make_interval(days => ${r.retention_days}))::date)`
    }
    await audit(tx, ctx, 'onboarding.opened', 'onboarding_file', id, acc.market_code, null, { account_id: d.accountId, person_type: d.personType, funding: d.funding, captured_via: d.capturedVia, documents: reqs.length })
    return id
  })
}

type Doc = { id: string; file_id: string; market_code: string; status: string; file_status: string; requirement: string }
async function lockDoc(tx: Tx, id: string): Promise<Doc> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No encontramos ese documento.', 'We could not find that document.')
  const d = (await tx<Doc[]>`
    select d.id, d.file_id, d.market_code, d.status, f.status as file_status, d.requirement
      from crm.onboarding_documents d join crm.onboarding_files f on f.id = d.file_id where d.id = ${id} for update of d`)[0]
  if (!d) throw notFound('No encontramos ese documento.', 'We could not find that document.')
  return d
}

/** Quien captura marca un documento como recibido, con el enlace al sistema que lo guarda. Nunca sube el archivo. */
export async function markReceived(ctx: Ctx, docId: string, rawLink: string): Promise<void> {
  const link = clean(rawLink)
  if (link && (!/^https:\/\/[^\s]{4,490}$/.test(link))) throw invalid('El enlace tiene que empezar con https:// y llevar al sistema donde está el documento.', 'The link must start with https:// and point to the system where the document is.')
  assertNoProhibited(link)
  await withUser(ctx.user.id, async (tx) => {
    const d = await lockDoc(tx, docId)
    ctx.assert('onboarding.capture', d.market_code)
    if (!['draft', 'returned'].includes(d.file_status)) throw invalid('El expediente ya está en la mesa de control: ahí se revisa.', 'The file is already at the control desk: it is reviewed there.')
    await tx`update crm.onboarding_documents set status = 'received', link = ${link}, validated_by = null, validated_at = null, updated_at = now() where id = ${d.id}`
    await audit(tx, ctx, 'onboarding.document_received', 'onboarding_file', d.file_id, d.market_code, { status: d.status }, { requirement: d.requirement, status: 'received', has_link: Boolean(link) })
  })
}

/** Enviar a la mesa de control. Si es prepago, todo está recibido y la regla está encendida, se aprueba solo. */
export async function submitFile(ctx: Ctx, fileId: string): Promise<'submitted' | 'auto_approved'> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound()
  return withUser(ctx.user.id, async (tx) => {
    const f = (await tx<{ market_code: string; status: string; funding: string; account_id: string }[]>`
      select market_code, status, funding, account_id from crm.onboarding_files where id = ${fileId} for update`)[0]
    if (!f) throw notFound('No encontramos ese expediente.', 'We could not find that file.')
    ctx.assert('onboarding.capture', f.market_code)
    if (!['draft', 'returned'].includes(f.status)) throw invalid('Este expediente ya se envió.', 'This file was already sent.')
    const missing = await tx<{ requirement: string }[]>`select requirement from crm.onboarding_documents where file_id = ${fileId} and status in ('missing', 'rejected')`
    if (missing.length) throw invalid(`Faltan ${missing.length} documentos por recibir o corregir.`, `${missing.length} documents still need to be received or fixed.`)
    const rule = await threshold(tx, f.market_code, 'prepaid_auto_approve')
    if (f.funding === 'prepaid' && rule.value >= 1) {
      await tx`update crm.onboarding_files set status = 'auto_approved', submitted_at = now(), decided_at = now(),
                decision_note = ${`Aprobado por la regla de prepago, versión ${rule.version}`} where id = ${fileId}`
      await audit(tx, ctx, 'onboarding.auto_approved', 'onboarding_file', fileId, f.market_code, { status: f.status }, { status: 'auto_approved', rule: 'prepaid_auto_approve', rule_version: rule.version })
      return 'auto_approved'
    }
    const sla = await threshold(tx, f.market_code, 'control_desk_sla_hours')
    await tx`update crm.onboarding_files set status = 'submitted', submitted_at = now(), due_at = now() + make_interval(hours => ${sla.value}) where id = ${fileId}`
    await audit(tx, ctx, 'onboarding.submitted', 'onboarding_file', fileId, f.market_code, { status: f.status }, { status: 'submitted', sla_hours: sla.value, sla_version: sla.version })
    await notifyMany(tx, ctx, await peopleWithRole(tx, f.market_code, ['ops']), {
      kind: 'lifecycle', market: f.market_code, link: '/campo?tab=expedientes', needsAction: true,
      title: ['Expediente nuevo en la mesa de control', 'New file at the control desk'], body: [`Plazo: ${sla.value} horas.`, `Deadline: ${sla.value} hours.`],
    })
    return 'submitted'
  })
}

/** La mesa toma un expediente (o se lo reparte a alguien de Operaciones). */
export async function assignFile(ctx: Ctx, fileId: string, toUserId?: string | null): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const f = (await tx<{ market_code: string; status: string; assigned_to: string | null }[]>`select market_code, status, assigned_to from crm.onboarding_files where id = ${fileId} for update`)[0]
    if (!f) throw notFound('No encontramos ese expediente.', 'We could not find that file.')
    ctx.assert('onboarding.review', f.market_code)
    if (!['submitted', 'in_review'].includes(f.status)) throw invalid('Ese expediente no está en la mesa.', 'That file is not at the desk.')
    const to = toUserId || ctx.user.id
    if (to !== ctx.user.id) {
      const ok = await tx`select 1 from crm.memberships m where m.user_id = ${to} and m.market_code = ${f.market_code} and m.role in ('ops', 'admin') and (m.valid_to is null or m.valid_to > now())`
      if (!ok[0]) throw invalid('Esa persona no es de Operaciones en este mercado.', 'That person is not in Operations in this market.')
    }
    await tx`update crm.onboarding_files set status = 'in_review', assigned_to = ${to} where id = ${fileId}`
    await audit(tx, ctx, 'onboarding.assigned', 'onboarding_file', fileId, f.market_code, { assigned_to: f.assigned_to }, { assigned_to: to })
    if (to !== ctx.user.id) await notify(tx, ctx, { to, kind: 'lifecycle', market: f.market_code, link: '/campo?tab=expedientes', needsAction: true, title: ['Te asignaron un expediente', 'A file was assigned to you'], body: [`${ctx.user.name} te lo pasó.`, `${ctx.user.name} passed it to you.`] })
  })
}

/** La mesa valida o rechaza un documento, con observación. Queda quién y cuándo. */
export async function reviewDocument(ctx: Ctx, docId: string, verdict: string, rawNote: string): Promise<void> {
  if (verdict !== 'valid' && verdict !== 'rejected') throw invalid('Elige si el documento es válido o se rechaza.', 'Choose whether the document is valid or rejected.')
  const note = clean(rawNote)
  if (verdict === 'rejected' && (!note || note.length < 3)) throw invalid('Di qué hay que corregir.', 'Say what needs to be fixed.')
  assertNoProhibited(note)
  await withUser(ctx.user.id, async (tx) => {
    const d = await lockDoc(tx, docId)
    ctx.assert('onboarding.review', d.market_code)
    if (!['submitted', 'in_review'].includes(d.file_status)) throw invalid('Ese expediente no está en la mesa.', 'That file is not at the desk.')
    if (d.status === 'missing') throw invalid('Ese documento no se ha recibido.', 'That document has not been received.')
    await tx`update crm.onboarding_documents set status = ${verdict}, note = ${note}, validated_by = ${ctx.user.id}, validated_at = now(), updated_at = now() where id = ${d.id}`
    await audit(tx, ctx, 'onboarding.document_reviewed', 'onboarding_file', d.file_id, d.market_code, { status: d.status }, { requirement: d.requirement, status: verdict })
  })
}

/** Aprobar (todo validado) o devolver a Ventas con motivo. */
export async function decideFile(ctx: Ctx, fileId: string, decision: string, rawNote: string): Promise<void> {
  if (decision !== 'approve' && decision !== 'return') throw invalid('Elige aprobar o devolver.', 'Choose approve or return.')
  const note = clean(rawNote)
  if (decision === 'return' && (!note || note.length < 3)) throw invalid('Di por qué lo devuelves.', 'Say why you are returning it.')
  assertNoProhibited(note)
  await withUser(ctx.user.id, async (tx) => {
    const f = (await tx<{ market_code: string; status: string; created_by: string | null }[]>`select market_code, status, created_by from crm.onboarding_files where id = ${fileId} for update`)[0]
    if (!f) throw notFound('No encontramos ese expediente.', 'We could not find that file.')
    ctx.assert('onboarding.review', f.market_code)
    if (!['submitted', 'in_review'].includes(f.status)) throw invalid('Ese expediente no está en la mesa.', 'That file is not at the desk.')
    if (decision === 'approve') {
      const pending = await tx`select 1 from crm.onboarding_documents where file_id = ${fileId} and status <> 'valid'`
      if (pending.length) throw invalid(`Faltan ${pending.length} documentos por validar.`, `${pending.length} documents still need to be validated.`)
    }
    const status = decision === 'approve' ? 'approved' : 'returned'
    await tx`update crm.onboarding_files set status = ${status}, decided_by = ${ctx.user.id}, decided_at = now(), decision_note = ${note} where id = ${fileId}`
    await audit(tx, ctx, decision === 'approve' ? 'onboarding.approved' : 'onboarding.returned', 'onboarding_file', fileId, f.market_code, { status: f.status }, { status })
    if (f.created_by && f.created_by !== ctx.user.id) {
      await notify(tx, ctx, {
        to: f.created_by, kind: 'lifecycle', market: f.market_code, link: '/campo?tab=expedientes', needsAction: decision === 'return',
        title: decision === 'approve' ? ['Expediente aprobado', 'File approved'] : ['Te devolvieron un expediente', 'A file was returned to you'],
        body: decision === 'approve' ? ['La mesa de control lo aprobó.', 'The control desk approved it.'] : [`Motivo: ${note}`, `Reason: ${note}`],
      })
    }
  })
}

/** Pedir abrir un documento: queda en la bitácora de lectura. Con la bóveda apagada no hay archivo; si hay enlace, se devuelve. */
export async function openDocument(ctx: Ctx, docId: string): Promise<{ outcome: 'vault_off' | 'simulated' | 'link'; url: string | null }> {
  return withUser(ctx.user.id, async (tx) => {
    const d = (await tx<{ id: string; market_code: string; file_id: string; link: string | null; storage_ref: string | null; requirement: string }[]>`
      select id, market_code, file_id, link, storage_ref, requirement from crm.onboarding_documents where id = ${docId}`)[0]
    if (!d) throw notFound('No encontramos ese documento.', 'We could not find that document.')
    if (!ctx.can('onboarding.review', d.market_code) && !ctx.can('onboarding.capture', d.market_code)) throw notFound()
    let outcome: 'vault_off' | 'simulated' | 'link' = 'vault_off'
    let url: string | null = null
    if (d.storage_ref) {
      const s = await documentVault().signedUrl(d.storage_ref)
      if (s.status === 'simulated') { outcome = 'simulated'; url = s.url }
    } else if (d.link) { outcome = 'link'; url = d.link }
    await tx`insert into crm.document_reads (document_id, market_code, user_id, outcome) values (${d.id}, ${d.market_code}, ${ctx.user.id}, ${outcome})`
    await audit(tx, ctx, 'onboarding.document_opened', 'onboarding_file', d.file_id, d.market_code, null, { requirement: d.requirement, outcome })
    return { outcome, url }
  })
}
