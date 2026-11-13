import 'server-only'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
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
  return withUser(ctx.user.id, (tx) => submitFileTx(tx, ctx, fileId, true))
}

async function submitFileTx(tx: Tx, ctx: Ctx, fileId: string, check: boolean): Promise<'submitted' | 'auto_approved'> {
  const f = (await tx<{ market_code: string; status: string; funding: string; account_id: string }[]>`
    select market_code, status, funding, account_id from crm.onboarding_files where id = ${fileId} for update`)[0]
  if (!f) throw notFound('No encontramos ese expediente.', 'We could not find that file.')
  if (check) ctx.assert('onboarding.capture', f.market_code)
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
}

// ------------------------------------------------------------------ campo2: el expediente también nace en la Sales App
export type SalesAppFile = {
  person_type?: string | null
  funding?: string | null
  documents?: { requirement: string; link?: string | null }[]
  documents_complete?: boolean | null
  submitted_at: string
}

/**
 * onboarding.submitted abre (o completa) el expediente del comercio, capturado allá una sola vez. Sin tipo de persona o
 * forma de pago se toma lo más conservador (persona física, prepago con la autoaprobación como esté en el mercado: apagada
 * de fábrica). Los documentos que trae llegan como recibidos con su enlace https; si viene completo, se envía a la mesa.
 * Devuelve qué pasó para la bitácora del evento.
 */
export async function openFileFromSalesAppTx(tx: Tx, sys: Ctx, acc: { id: string; market_code: string }, d: SalesAppFile): Promise<{ fileId: string | null; outcome: 'opened' | 'updated' | 'submitted' | 'auto_approved' | 'no_form' | 'closed' }> {
  const personType = (PERSON_TYPES as readonly string[]).includes(d.person_type ?? '') ? d.person_type! : 'individual'
  const funding = (FUNDINGS as readonly string[]).includes(d.funding ?? '') ? d.funding! : 'prepaid'
  let file = (await tx<{ id: string; status: string }[]>`
    select id, status from crm.onboarding_files where account_id = ${acc.id} and status not in ('approved', 'auto_approved') for update`)[0]
  let outcome: 'opened' | 'updated' = 'updated'
  if (!file) {
    const done = await tx`select 1 from crm.onboarding_files where account_id = ${acc.id} and status in ('approved', 'auto_approved')`
    if (done[0]) return { fileId: null, outcome: 'closed' }
    const reqs = await tx<{ code: string; pii_class: string; retention_days: number }[]>`
      select code, pii_class, retention_days from crm.onboarding_requirements
       where market_code = ${acc.market_code} and person_type = ${personType} and funding in (${funding}, 'any') and is_active order by position`
    if (reqs.length === 0) return { fileId: null, outcome: 'no_form' }
    const rows = await tx<{ id: string }[]>`
      insert into crm.onboarding_files (account_id, market_code, person_type, funding, captured_via, visited_at, created_by)
      values (${acc.id}, ${acc.market_code}, ${personType}, ${funding}, 'sales_app', ${d.submitted_at}, ${sys.user.id}) returning id, 'draft' as status`
    file = { id: rows[0]!.id, status: 'draft' }
    for (const r of reqs) {
      await tx`insert into crm.onboarding_documents (file_id, account_id, market_code, requirement, pii_class, retention_until)
               values (${file.id}, ${acc.id}, ${acc.market_code}, ${r.code}, ${r.pii_class}, (now() + make_interval(days => ${r.retention_days}))::date)`
    }
    outcome = 'opened'
    await audit(tx, sys, 'onboarding.opened', 'onboarding_file', file.id, acc.market_code, null, { account_id: acc.id, person_type: personType, funding, captured_via: 'sales_app', documents: reqs.length, defaults: !d.person_type || !d.funding })
  }
  if (['draft', 'returned'].includes(file.status)) {
    for (const doc of d.documents ?? []) {
      const link = doc.link && /^https:\/\/[^\s]{4,490}$/.test(doc.link) ? doc.link : null
      const res = await tx`update crm.onboarding_documents set status = 'received', link = coalesce(${link}, link), validated_by = null, validated_at = null, updated_at = now()
                            where file_id = ${file.id} and requirement = ${doc.requirement} and status in ('missing', 'rejected', 'received')`
      if (res.count) await audit(tx, sys, 'onboarding.document_received', 'onboarding_file', file.id, acc.market_code, null, { requirement: doc.requirement, status: 'received', has_link: Boolean(link), via: 'sales_app' })
    }
    const missing = await tx`select 1 from crm.onboarding_documents where file_id = ${file.id} and status in ('missing', 'rejected') limit 1`
    if (d.documents_complete && !missing[0]) return { fileId: file.id, outcome: await submitFileTx(tx, sys, file.id, false) }
  }
  return { fileId: file.id, outcome }
}

// ------------------------------------------------------------------ campo2: enlace de captura con código
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** Quien captura genera un enlace para que el comercio deje los enlaces de sus documentos. Se muestra una sola vez. */
export async function createOnboardingLink(ctx: Ctx, fileId: string): Promise<{ token: string; expiresAt: Date }> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound()
  return withUser(ctx.user.id, async (tx) => {
    const f = (await tx<{ account_id: string; market_code: string; status: string }[]>`select account_id, market_code, status from crm.onboarding_files where id = ${fileId}`)[0]
    if (!f) throw notFound('No encontramos ese expediente.', 'We could not find that file.')
    ctx.assert('onboarding.capture', f.market_code)
    if (!['draft', 'returned'].includes(f.status)) throw invalid('El expediente ya está en la mesa de control.', 'The file is already at the control desk.')
    const days = await threshold(tx, f.market_code, 'onboarding_link_days')
    await tx`update crm.onboarding_links set revoked_at = now() where file_id = ${fileId} and revoked_at is null and used_at is null`
    const token = randomBytes(24).toString('base64url')
    const rows = await tx<{ expires_at: Date }[]>`
      insert into crm.onboarding_links (file_id, account_id, market_code, token_hash, expires_at, created_by)
      values (${fileId}, ${f.account_id}, ${f.market_code}, ${tokenHash(token)}, now() + make_interval(days => ${days.value}), ${ctx.user.id}) returning expires_at`
    await audit(tx, ctx, 'onboarding.link_created', 'onboarding_file', fileId, f.market_code, null, { days: days.value, days_version: days.version })
    return { token, expiresAt: rows[0]!.expires_at }
  })
}

export type LinkView = { market_code: string; locale: 'es' | 'en'; store: string; status: string; docs: { id: string; label_es: string; label_en: string; status: string; has_link: boolean }[] }

async function liveLink(tx: Tx, token: string): Promise<{ id: string; file_id: string; market_code: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const rows = await tx<{ id: string; file_id: string; market_code: string }[]>`
    select id, file_id, market_code from crm.onboarding_links where token_hash = ${tokenHash(token)} and revoked_at is null and used_at is null and expires_at > now()`
  return rows[0] ?? null
}

/** Lo que ve quien abre el enlace: solo el nombre de la tienda y la lista de documentos de ese expediente. */
export async function onboardingLinkView(sys: Ctx, token: string): Promise<LinkView | null> {
  return withUser(sys.user.id, async (tx) => {
    const l = await liveLink(tx, token)
    if (!l) return null
    const f = (await tx<{ name: string; status: string; locale: 'es' | 'en' }[]>`
      select a.name, f.status, mk.default_locale as locale from crm.onboarding_files f join crm.accounts a on a.id = f.account_id join crm.markets mk on mk.code = f.market_code where f.id = ${l.file_id}`)[0]
    if (!f) return null
    const docs = await tx<LinkView['docs']>`
      select d.id, coalesce(r.label_es, d.requirement) as label_es, coalesce(r.label_en, d.requirement) as label_en, d.status, d.link is not null as has_link
        from crm.onboarding_documents d join crm.onboarding_files f on f.id = d.file_id
        left join crm.onboarding_requirements r on r.market_code = d.market_code and r.code = d.requirement and r.person_type = f.person_type and r.funding in (f.funding, 'any')
       where d.file_id = ${l.file_id} order by r.position nulls last, d.requirement`
    return { market_code: l.market_code, locale: f.locale, store: f.name, status: f.status, docs: [...docs] }
  })
}

/** Un enlace que ya se usó para enviar: quien lo abre ve que se recibió, sin ningún dato del expediente. */
export async function onboardingLinkUsed(sys: Ctx, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false
  return withUser(sys.user.id, async (tx) => (await tx`select 1 from crm.onboarding_links where token_hash = ${tokenHash(token)} and used_at is not null`).length > 0)
}

/** Quien abre el enlace deja el enlace https de un documento. No ve ni cambia nada más. */
export async function onboardingLinkReceive(sys: Ctx, token: string, docId: string, rawLink: string): Promise<void> {
  const link = clean(rawLink)
  if (!link || !/^https:\/\/[^\s]{4,490}$/.test(link)) throw invalid('El enlace tiene que empezar con https://.', 'The link must start with https://.')
  assertNoProhibited(link)
  await withUser(sys.user.id, async (tx) => {
    const l = await liveLink(tx, token)
    if (!l) throw notFound('Este enlace ya no sirve. Pide uno nuevo a quien te visitó.', 'This link no longer works. Ask whoever visited you for a new one.')
    const res = await tx`update crm.onboarding_documents d set status = 'received', link = ${link}, validated_by = null, validated_at = null, updated_at = now()
                          from crm.onboarding_files f where f.id = d.file_id and d.id = ${docId} and d.file_id = ${l.file_id} and d.status in ('missing', 'rejected', 'received')
                           and f.status in ('draft', 'returned')`
    if (!res.count) throw invalid('Ese documento ya no se puede cambiar.', 'That document can no longer be changed.')
    await audit(tx, sys, 'onboarding.document_received', 'onboarding_file', l.file_id, l.market_code, null, { status: 'received', has_link: true, via: 'link' })
  })
}

/** Con todo recibido, quien abre el enlace lo manda a la mesa de control. El enlace queda usado. */
export async function onboardingLinkSubmit(sys: Ctx, token: string): Promise<'submitted' | 'auto_approved'> {
  return withUser(sys.user.id, async (tx) => {
    const l = await liveLink(tx, token)
    if (!l) throw notFound('Este enlace ya no sirve. Pide uno nuevo a quien te visitó.', 'This link no longer works. Ask whoever visited you for a new one.')
    const out = await submitFileTx(tx, sys, l.file_id, false)
    await tx`update crm.onboarding_links set used_at = now() where id = ${l.id}`
    return out
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
