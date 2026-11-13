import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit, newId, clean } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import { toE164 } from '@/lib/format'
import type postgres from 'postgres'

type Json = postgres.JSONValue
type Row = Record<string, unknown>
const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id)

// ================================================================ DAT-04: fusión con foto previa y deshacer

/** Campos del comercio que se comparan lado a lado y de los que se decide cuál valor queda. */
export const SURVIVOR_FIELDS = ['name', 'phone', 'email', 'address_line', 'locality', 'region', 'postal_code', 'territory_id', 'owner_id', 'segment', 'merchant_ref'] as const
export type SurvivorField = (typeof SURVIVOR_FIELDS)[number]
export type Side = 'source' | 'target'
/** Por qué quedó cada valor: lo tenía el que se queda, el que se queda no lo tenía, o lo eligió una persona. */
export type Survivor = { winner: Side; reason: 'kept' | 'filled' | 'chosen'; value: unknown; previous: unknown }

/**
 * Regla de supervivencia por campo. Por defecto gana el dato del comercio que se queda; si no lo tiene, toma el del otro.
 * Una persona puede elegir, campo por campo, el valor del registro que se archiva.
 */
export function survivors(source: Row, target: Row, picks: Partial<Record<SurvivorField, Side>> = {}): Record<SurvivorField, Survivor> {
  const out = {} as Record<SurvivorField, Survivor>
  for (const f of SURVIVOR_FIELDS) {
    const sv = source[f] ?? null
    const tv = target[f] ?? null
    const pick = picks[f]
    if (pick === 'source' && sv !== null && sv !== tv) out[f] = { winner: 'source', reason: 'chosen', value: sv, previous: tv }
    else if (tv === null && sv !== null && pick !== 'target') out[f] = { winner: 'source', reason: 'filled', value: sv, previous: null }
    else out[f] = { winner: 'target', reason: pick === 'target' ? 'chosen' : 'kept', value: tv, previous: tv }
  }
  return out
}

async function loadPair(tx: Tx, sourceId: string, targetId: string): Promise<{ s: Row; t: Row }> {
  const rows = await tx<{ id: string; row: Row }[]>`select a.id, to_jsonb(a) as row from crm.accounts a where a.id in (${sourceId}, ${targetId}) for update of a`
  const s = rows.find((r) => r.id === sourceId)?.row
  const t = rows.find((r) => r.id === targetId)?.row
  if (!s || !t || s.archived_at || t.archived_at) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
  return { s, t }
}

/**
 * DAT-04: fusionar no borra. Antes de mover nada se guarda la foto de los dos registros, qué se movió y qué valor ganó en cada
 * campo; con eso la fusión se puede deshacer. Todo lo que colgaba del comercio que se archiva sigue al que queda.
 */
export async function mergeAccounts(ctx: Ctx, sourceId: string, targetId: string, opts: { picks?: Partial<Record<SurvivorField, Side>> } = {}): Promise<string> {
  if (sourceId === targetId) throw invalid('Elige dos comercios distintos.', 'Pick two different merchants.')
  return withUser(ctx.user.id, async (tx) => {
    const { s, t } = await loadPair(tx, sourceId, targetId)
    const market = String(s.market_code)
    ctx.assert('account.merge', market)
    if (s.market_code !== t.market_code) throw invalid('Solo se fusionan comercios del mismo mercado.', 'Only merchants in the same market can be merged.')
    if ((t.ancestor_ids as string[]).includes(sourceId)) throw invalid('El comercio que se queda cuelga del que se archiva. Fusiona al revés.', 'The merchant you keep sits under the one being archived. Merge the other way round.')

    const surv = survivors(s, t, opts.picks)
    const patch: Row = {}
    for (const f of SURVIVOR_FIELDS) if (surv[f].winner === 'source') patch[f] = surv[f].value
    const sCustom = (s.custom ?? {}) as Row
    const tCustom = (t.custom ?? {}) as Row
    const customFilled = Object.keys(sCustom).filter((k) => !(k in tCustom))

    const moved: Record<string, string[]> = {}
    moved.deals = ids(await tx<{ id: string }[]>`update crm.deals set account_id = ${targetId} where account_id = ${sourceId} returning id`)
    moved.activities = ids(await tx<{ id: string }[]>`update crm.activities set account_id = ${targetId} where account_id = ${sourceId} returning id`)
    moved.visits = ids(await tx<{ id: string }[]>`update crm.visits set account_id = ${targetId} where account_id = ${sourceId} returning id`)
    moved.leads = ids(await tx<{ id: string }[]>`update crm.leads set account_id = ${targetId} where account_id = ${sourceId} returning id`)
    moved.lead_duplicates = ids(await tx<{ id: string }[]>`update crm.leads set duplicate_of = ${targetId} where duplicate_of = ${sourceId} returning id`)
    moved.notices = ids(await tx<{ id: string }[]>`update crm.notices set account_id = ${targetId} where account_id = ${sourceId} returning id`)
    // Un contacto que ya está en el comercio que se queda no se liga dos veces: su vínculo con el archivado se cierra.
    moved.contacts_closed = ids(await tx<{ id: string }[]>`
      update crm.account_contacts s set valid_to = now(), end_reason = 'merge', is_primary = false
       where s.account_id = ${sourceId} and s.valid_to is null
         and exists (select 1 from crm.account_contacts x where x.account_id = ${targetId} and x.contact_id = s.contact_id and x.valid_to is null and x.deal_id is not distinct from s.deal_id)
       returning id`)
    // Una cuenta tiene un solo contacto principal: si el que se queda ya tiene, el del archivado llega sin esa marca.
    moved.contacts_unprimary = ids(await tx<{ id: string }[]>`
      update crm.account_contacts s set is_primary = false where s.account_id = ${sourceId} and s.is_primary and s.valid_to is null
         and exists (select 1 from crm.account_contacts x where x.account_id = ${targetId} and x.is_primary and x.valid_to is null) returning id`)
    moved.account_contacts = ids(await tx<{ id: string }[]>`update crm.account_contacts set account_id = ${targetId} where account_id = ${sourceId} and valid_to is null returning id`)
    moved.account_aliases = ids(await tx<{ id: string }[]>`update crm.account_aliases set account_id = ${targetId} where account_id = ${sourceId} returning id`)
    moved.account_attributions = ids(await tx<{ id: string }[]>`update crm.account_attributions set account_id = ${targetId} where account_id = ${sourceId} returning id`)
    moved.account_products = ids(await tx<{ id: string }[]>`
      update crm.account_products p set account_id = ${targetId} where p.account_id = ${sourceId}
         and not exists (select 1 from crm.account_products x where x.account_id = ${targetId} and x.product_id is not distinct from p.product_id and x.provider_id is not distinct from p.provider_id)
       returning id`)
    moved.process_memberships = ids(await tx<{ id: string }[]>`
      update crm.process_memberships p set account_id = ${targetId} where p.account_id = ${sourceId}
         and not exists (select 1 from crm.process_memberships x where x.account_id = ${targetId} and x.list_id = p.list_id and x.ended_at is null and p.ended_at is null)
       returning id`)
    moved.metric_days = (await tx<{ day: string }[]>`
      update crm.merchant_metrics_daily m set account_id = ${targetId} where account_id = ${sourceId}
         and not exists (select 1 from crm.merchant_metrics_daily x where x.account_id = ${targetId} and x.as_of = m.as_of) returning as_of::text as day`).map((r) => r.day)
    await tx`update crm.exceptions set resolved_at = now(), resolved_by = ${ctx.user.id}, resolution = 'merged'
              where resolved_at is null and (account_id = ${sourceId} or (kind = 'duplicate_suspect' and account_id = ${targetId}))`
    // Las cuentas que colgaban del archivado pasan a colgar del que queda, con su vínculo fechado.
    moved.children = ids(await tx<{ id: string }[]>`update crm.accounts set parent_id = ${targetId} where parent_id = ${sourceId} returning id`)
    if (moved.children.length) {
      await tx`update crm.account_links set valid_to = now() where parent_id = ${sourceId} and valid_to is null and child_id = any(${moved.children}::uuid[])`
      await tx`insert into crm.account_links (child_id, parent_id, created_by, reason) select c, ${targetId}, ${ctx.user.id}, 'Fusión de la cuenta matriz' from unnest(${moved.children}::uuid[]) c`
    }

    await tx`update crm.accounts set merged_into = ${targetId}, archived_at = now(), phone = null where id = ${sourceId}`
    if (Object.keys(patch).length) await tx`update crm.accounts set ${tx(patch as Record<string, postgres.SerializableParameter>)} where id = ${targetId}`
    if (customFilled.length) await tx`update crm.accounts set custom = ${tx.json(sCustom as Json)}::jsonb || custom where id = ${targetId}`

    const eventId = await newId(tx)
    await tx`insert into crm.merge_events (id, market_code, source_id, target_id, snapshot, moved, survivorship, merged_by)
             values (${eventId}, ${market}, ${sourceId}, ${targetId}, ${tx.json({ source: s, target: t } as Json)}, ${tx.json(moved as Json)},
                     ${tx.json({ fields: surv, custom_filled: customFilled } as Json)}, ${ctx.user.id})`
    const [a, b] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId]
    await tx`update crm.duplicate_pairs set status = 'merged', decided_by = ${ctx.user.id}, decided_at = now() where a_id = ${a} and b_id = ${b} and status = 'open'`
    await tx`update crm.duplicate_pairs set status = 'dismissed', decision_note = 'archived', decided_at = now() where status = 'open' and (a_id = ${sourceId} or b_id = ${sourceId})`
    const taken = SURVIVOR_FIELDS.filter((f) => surv[f].winner === 'source')
    await audit(tx, ctx, 'account.merged', 'account', targetId, market, { source_id: sourceId, source_name: s.name }, { target_id: targetId, merge_event_id: eventId, fields_from_source: taken })
    await emit(tx, 'account.merged', 'account', targetId, market, { source_id: sourceId, merge_event_id: eventId })
    return eventId
  })
}

/**
 * Deshacer una fusión: el comercio archivado vuelve con sus datos de antes y recupera lo que se había movido. Lo que se
 * registró en el comercio que quedó DESPUÉS de fusionar se queda con él. Un dato que alguien cambió después no se pisa.
 */
export async function undoMerge(ctx: Ctx, eventId: string, reason: string): Promise<void> {
  const why = reason.trim()
  if (why.length < 5 || why.length > 300) throw invalid('Escribe por qué se deshace la fusión (de 5 a 300 letras).', 'Say why the merge is being undone (5 to 300 characters).')
  assertNoProhibited(why)
  await withUser(ctx.user.id, async (tx) => {
    const evs = await tx<{ id: string; market_code: string; source_id: string; target_id: string; snapshot: { source: Row; target: Row }; moved: Record<string, string[]>; survivorship: { fields: Record<string, Survivor>; custom_filled: string[] }; undone_at: Date | null }[]>`
      select id, market_code, source_id, target_id, snapshot, moved, survivorship, undone_at from crm.merge_events where id = ${eventId} for update`
    const ev = evs[0]
    if (!ev) throw notFound('No encontramos esa fusión.', 'We could not find that merge.')
    ctx.assert('account.merge', ev.market_code)
    if (ev.undone_at) throw invalid('Esa fusión ya se deshizo.', 'That merge was already undone.')
    const tgt = await tx<{ row: Row }[]>`select to_jsonb(a) as row from crm.accounts a where a.id = ${ev.target_id} for update of a`
    const t = tgt[0]?.row
    if (!t) throw notFound()
    if (t.archived_at) throw invalid('El comercio que quedó ya se fusionó en otro. Deshaz primero esa fusión.', 'The surviving merchant was later merged into another one. Undo that merge first.')
    const { source_id: src, target_id: dst, moved: mv } = ev
    const list = (k: string) => mv[k] ?? []
    const before = ev.snapshot.source

    // El archivado vuelve tal como estaba (salvo su lugar en el árbol, que se repone abajo con su vínculo).
    await tx`update crm.accounts set archived_at = null, merged_into = null, phone = ${(before.phone as string | null) ?? null} where id = ${src}`
    await tx`update crm.deals set account_id = ${src} where id = any(${list('deals')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.activities set account_id = ${src} where id = any(${list('activities')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.visits set account_id = ${src} where id = any(${list('visits')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.leads set account_id = ${src} where id = any(${list('leads')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.leads set duplicate_of = ${src} where id = any(${list('lead_duplicates')}::uuid[]) and duplicate_of = ${dst}`
    await tx`update crm.notices set account_id = ${src} where id = any(${list('notices')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.account_contacts set account_id = ${src} where id = any(${list('account_contacts')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.account_contacts set valid_to = null, end_reason = null where id = any(${list('contacts_closed')}::uuid[]) and end_reason = 'merge'`
    await tx`update crm.account_contacts c set is_primary = true where c.id = any(${list('contacts_unprimary')}::uuid[]) and c.valid_to is null
              and not exists (select 1 from crm.account_contacts x where x.account_id = c.account_id and x.is_primary and x.valid_to is null)`
    await tx`update crm.account_aliases set account_id = ${src} where id = any(${list('account_aliases')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.account_attributions set account_id = ${src} where id = any(${list('account_attributions')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.account_products set account_id = ${src} where id = any(${list('account_products')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.process_memberships set account_id = ${src} where id = any(${list('process_memberships')}::uuid[]) and account_id = ${dst}`
    await tx`update crm.merchant_metrics_daily set account_id = ${src} where account_id = ${dst} and as_of = any(${list('metric_days')}::date[])`
    const kids = list('children')
    if (kids.length) {
      const back = ids(await tx<{ id: string }[]>`update crm.accounts set parent_id = ${src} where id = any(${kids}::uuid[]) and parent_id = ${dst} returning id`)
      await tx`update crm.account_links set valid_to = now() where parent_id = ${dst} and valid_to is null and child_id = any(${back}::uuid[])`
      if (back.length) await tx`insert into crm.account_links (child_id, parent_id, created_by, reason) select c, ${src}, ${ctx.user.id}, 'Se deshizo la fusión' from unnest(${back}::uuid[]) c`
    }
    // El que quedó suelta lo que había tomado del otro, salvo lo que alguien cambió después.
    const restore: Row = {}
    for (const [f, sv] of Object.entries(ev.survivorship.fields ?? {})) {
      if (sv.winner === 'source' && (t[f] ?? null) === (sv.value ?? null)) restore[f] = sv.previous ?? null
    }
    if (Object.keys(restore).length) await tx`update crm.accounts set ${tx(restore as Record<string, postgres.SerializableParameter>)} where id = ${dst}`
    const tCustom = (t.custom ?? {}) as Row
    const sCustom = (before.custom ?? {}) as Row
    const drop = (ev.survivorship.custom_filled ?? []).filter((k) => JSON.stringify(tCustom[k]) === JSON.stringify(sCustom[k]))
    if (drop.length) await tx`update crm.accounts set custom = custom - ${drop}::text[] where id = ${dst}`

    await tx`update crm.merge_events set undone_at = now(), undone_by = ${ctx.user.id}, undo_reason = ${why} where id = ${eventId}`
    // Quien deshace ya decidió que no son el mismo comercio: el par no vuelve a la cola.
    const [a, b] = src < dst ? [src, dst] : [dst, src]
    await tx`insert into crm.duplicate_pairs (market_code, a_id, b_id, match_kinds, status, decision_note, decided_by, decided_at)
             values (${ev.market_code}, ${a}, ${b}, '{}', 'dismissed', ${why}, ${ctx.user.id}, now())
             on conflict (a_id, b_id) do update set status = 'dismissed', decision_note = excluded.decision_note, decided_by = excluded.decided_by, decided_at = now()`
    await audit(tx, ctx, 'account.unmerged', 'account', dst, ev.market_code, { merge_event_id: eventId }, { restored_id: src, reason: why })
    await emit(tx, 'account.unmerged', 'account', dst, ev.market_code, { restored_id: src, merge_event_id: eventId })
  })
}

/** Busca duplicados en todo un mercado y deja los pares en la cola. No fusiona nada: cada par lo decide una persona. */
export async function scanDuplicates(ctx: Ctx, market: string): Promise<number> {
  ctx.assert('duplicate.review', market)
  ctx.market(market)
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ n: number }[]>`select app.scan_duplicates(${market}) as n`
    const open = await tx<{ n: number }[]>`select count(*)::int as n from crm.duplicate_pairs where market_code = ${market} and status = 'open'`
    await audit(tx, ctx, 'duplicate.scanned', 'market', null, market, null, { pairs_seen: rows[0]?.n ?? 0, open: open[0]?.n ?? 0 })
    return open[0]?.n ?? 0
  })
}

/** "No son el mismo comercio": el par sale de la cola con su motivo y no vuelve a aparecer. */
export async function dismissPair(ctx: Ctx, pairId: string, note: string): Promise<void> {
  const why = note.trim()
  if (why.length < 5 || why.length > 300) throw invalid('Escribe por qué no son el mismo comercio (de 5 a 300 letras).', 'Say why they are not the same merchant (5 to 300 characters).')
  assertNoProhibited(why)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; status: string; a_id: string; b_id: string }[]>`select market_code, status, a_id, b_id from crm.duplicate_pairs where id = ${pairId} for update`
    const p = rows[0]
    if (!p) throw notFound()
    ctx.assert('duplicate.review', p.market_code)
    if (p.status !== 'open') throw invalid('Ese par ya se decidió.', 'That pair was already decided.')
    await tx`update crm.duplicate_pairs set status = 'dismissed', decision_note = ${why}, decided_by = ${ctx.user.id}, decided_at = now() where id = ${pairId}`
    await audit(tx, ctx, 'duplicate.dismissed', 'account', p.a_id, p.market_code, null, { other_id: p.b_id, reason: why })
  })
}

/** La mesa de control revisa un aviso de duplicado que alguien se saltó. */
export async function reviewBypass(ctx: Ctx, bypassId: string, note: string): Promise<void> {
  const text = note.trim().slice(0, 300)
  assertNoProhibited(text)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; account_id: string; reviewed_at: Date | null }[]>`select market_code, account_id, reviewed_at from crm.duplicate_bypasses where id = ${bypassId} for update`
    const b = rows[0]
    if (!b) throw notFound()
    ctx.assert('duplicate.review', b.market_code)
    if (b.reviewed_at) return
    await tx`update crm.duplicate_bypasses set reviewed_at = now(), reviewed_by = ${ctx.user.id}, review_note = ${clean(text)} where id = ${bypassId}`
    await audit(tx, ctx, 'duplicate.bypass_reviewed', 'account', b.account_id, b.market_code, null, { note: clean(text) })
  })
}

// ================================================================ DAT-02: contactos

async function liveAccount(tx: Tx, id: string) {
  const rows = await tx<{ id: string; market_code: string; name: string }[]>`select id, market_code, name from crm.accounts where id = ${id} and archived_at is null for update`
  if (!rows[0]) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
  return rows[0]
}

const contactEdit = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().max(160).optional().default(''),
  role: z.string().trim().min(2).max(40),
  locale: z.enum(['es', 'en']).or(z.literal('')).optional().default(''),
  sms: z.boolean().optional().default(false),
})

/** Corregir a un contacto desde la ficha: sus datos valen para todas las cuentas donde está; el rol, solo para esta. */
export async function updateContact(ctx: Ctx, accountId: string, contactId: string, input: z.input<typeof contactEdit>): Promise<void> {
  const parsed = contactEdit.safeParse(input)
  if (!parsed.success) throw invalid('Revisa nombre y rol del contacto.', 'Check the contact name and role.')
  const v = parsed.data
  assertNoProhibited(v.fullName)
  await withUser(ctx.user.id, async (tx) => {
    const a = await liveAccount(tx, accountId)
    ctx.assert('account.edit', a.market_code)
    const link = await tx<{ id: string; role: string; full_name: string; phone: string | null }[]>`
      select ac.id, ac.role, c.full_name, c.phone from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id
       where ac.account_id = ${accountId} and ac.contact_id = ${contactId} and ac.valid_to is null and ac.deal_id is null for update of ac`
    if (!link[0]) throw invalid('Ese contacto no es de esta cuenta.', 'That contact does not belong to this account.')
    const phone = v.phone ? toE164(v.phone, ctx.market(a.market_code).phoneCc) : null
    if (v.phone && !phone) throw invalid('El teléfono no parece válido.', 'The phone number does not look valid.')
    if (v.email && !z.string().email().safeParse(v.email).success) throw invalid('El correo no parece válido.', 'The email does not look valid.')
    if (phone && phone !== link[0].phone) {
      const other = await tx<{ id: string; full_name: string }[]>`select id, full_name from app.contact_by_phone(${a.market_code}, ${phone})`
      if (other[0] && other[0].id !== contactId) throw invalid(`Ese teléfono ya es de ${other[0].full_name}. Si es la misma persona, agrégala a esta cuenta con ese teléfono.`, `That phone already belongs to ${other[0].full_name}. If it is the same person, add them to this account with that phone.`)
    }
    await tx`update crm.contacts set full_name = ${v.fullName}, phone = ${phone}, email = ${clean(v.email)}, preferred_locale = ${v.locale || null}, sms_capable = ${phone ? v.sms : null} where id = ${contactId}`
    try {
      await tx`update crm.account_contacts set role = ${v.role} where id = ${link[0].id}`
    } catch (e) {
      if ((e as { code?: string }).code === '23514') throw invalid('Elige un rol de la lista.', 'Pick a role from the list.')
      throw e
    }
    await audit(tx, ctx, 'contact.updated', 'account', accountId, a.market_code, { contact_id: contactId, name: link[0].full_name, role: link[0].role }, { name: v.fullName, role: v.role })
  })
}

/**
 * Dar de baja a un contacto en una cuenta: el vínculo se cierra con fecha y motivo, no se borra. Si era el contacto
 * principal y hay otros, primero se elige quién queda: el cambio de principal es una acción aparte y deja su rastro.
 */
export async function endContact(ctx: Ctx, accountId: string, contactId: string, reason: string): Promise<void> {
  const why = reason.trim()
  if (why.length < 3 || why.length > 300) throw invalid('Escribe por qué se da de baja (de 3 a 300 letras).', 'Say why they are being removed (3 to 300 characters).')
  assertNoProhibited(why)
  await withUser(ctx.user.id, async (tx) => {
    const a = await liveAccount(tx, accountId)
    ctx.assert('account.edit', a.market_code)
    const links = await tx<{ id: string; contact_id: string; is_primary: boolean }[]>`
      select id, contact_id, is_primary from crm.account_contacts where account_id = ${accountId} and valid_to is null and deal_id is null for update`
    const link = links.find((l) => l.contact_id === contactId)
    if (!link) throw invalid('Ese contacto no es de esta cuenta.', 'That contact does not belong to this account.')
    if (link.is_primary && links.length > 1) throw invalid('Es el contacto principal. Elige antes quién queda como principal y después dalo de baja.', 'This is the primary contact. Choose who becomes primary first, then remove them.')
    await tx`update crm.account_contacts set valid_to = now(), end_reason = ${why}, is_primary = false where id = ${link.id}`
    await audit(tx, ctx, 'contact.ended', 'account', accountId, a.market_code, { contact_id: contactId, was_primary: link.is_primary }, { reason: why })
  })
}

/**
 * El rol de una persona en un negocio (quién firma, quién decide lo técnico, quién paga) vive en la misma tabla que su rol
 * en la cuenta: no hay dos lugares donde configurar roles. Solo entran contactos vigentes de la cuenta del negocio.
 */
export async function setDealContact(ctx: Ctx, dealId: string, contactId: string, role: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const deals = await tx<{ market_code: string; account_id: string }[]>`select market_code, account_id from crm.deals where id = ${dealId} for update`
    const d = deals[0]
    if (!d) throw notFound('No encontramos ese negocio.', 'We could not find that deal.')
    ctx.assert('deal.edit', d.market_code)
    if (!(await tx`select 1 from crm.account_contacts where account_id = ${d.account_id} and contact_id = ${contactId} and valid_to is null and deal_id is null`)[0])
      throw invalid('Esa persona no es contacto de la cuenta de este negocio. Agrégala primero en la ficha del comercio.', 'That person is not a contact of this deal’s account. Add them on the merchant record first.')
    const live = await tx<{ id: string; role: string }[]>`select id, role from crm.account_contacts where deal_id = ${dealId} and contact_id = ${contactId} and valid_to is null for update`
    try {
      if (live[0]) await tx.savepoint((sp) => sp`update crm.account_contacts set role = ${role} where id = ${live[0]!.id}`)
      else await tx.savepoint((sp) => sp`insert into crm.account_contacts (account_id, contact_id, market_code, role, deal_id) values (${d.account_id}, ${contactId}, ${d.market_code}, ${role}, ${dealId})`)
    } catch (e) {
      if ((e as { code?: string }).code === '23514') throw invalid('Elige un rol de la lista.', 'Pick a role from the list.')
      throw e
    }
    await audit(tx, ctx, 'deal.contact_role_set', 'deal', dealId, d.market_code, live[0] ? { contact_id: contactId, role: live[0].role } : null, { contact_id: contactId, role })
  })
}

/** Quitar a una persona de un negocio: su rol ahí se cierra con fecha; sigue siendo contacto de la cuenta. */
export async function endDealContact(ctx: Ctx, dealId: string, contactId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const deals = await tx<{ market_code: string }[]>`select market_code from crm.deals where id = ${dealId} for update`
    if (!deals[0]) throw notFound('No encontramos ese negocio.', 'We could not find that deal.')
    ctx.assert('deal.edit', deals[0].market_code)
    const rows = await tx<{ id: string }[]>`update crm.account_contacts set valid_to = now(), end_reason = 'removed' where deal_id = ${dealId} and contact_id = ${contactId} and valid_to is null returning id`
    if (rows.length) await audit(tx, ctx, 'deal.contact_role_ended', 'deal', dealId, deals[0].market_code, { contact_id: contactId }, null)
  })
}

// ================================================================ DAT-03: alias de identificadores externos

/**
 * Agregar a mano el identificador que un comercio tiene en otro sistema. Si ese identificador ya es de otro comercio,
 * no entra y se dice de quién es. El ID fiscal completo no se guarda aquí (estándar de datos).
 */
export async function addAlias(ctx: Ctx, accountId: string, input: { system: string; externalId: string; note?: string }): Promise<string> {
  const externalId = input.externalId.trim()
  const note = (input.note ?? '').trim()
  if (externalId.length < 1 || externalId.length > 80) throw invalid('Escribe el identificador (hasta 80 caracteres).', 'Enter the identifier (up to 80 characters).')
  assertNoProhibited(externalId, note)
  return withUser(ctx.user.id, async (tx) => {
    const a = await liveAccount(tx, accountId)
    ctx.assert('alias.manage', a.market_code)
    const sys = await tx<{ code: string; label_es: string; label_en: string }[]>`
      select code, label_es, label_en from crm.alias_systems where code = ${input.system} and is_active and (market_code is null or market_code = ${a.market_code})`
    if (!sys[0]) throw invalid('Elige el sistema de la lista.', 'Pick the system from the list.')
    const holder = await tx<{ account_id: string; name: string }[]>`select account_id, name from app.alias_holder(${input.system}, ${externalId})`
    if (holder[0]?.account_id === accountId) throw invalid('Este comercio ya tiene ese identificador.', 'This merchant already has that identifier.')
    if (holder[0]) throw invalid(`Ese identificador de ${sys[0].label_es} ya es de "${holder[0].name}". Si son el mismo comercio, fusiónalos; si ahora es de este, ciérralo allá primero.`, `That ${sys[0].label_en} identifier already belongs to "${holder[0].name}". If they are the same merchant, merge them; if it now belongs to this one, close it there first.`)
    const id = await newId(tx)
    try {
      await tx`insert into crm.account_aliases (id, account_id, market_code, system, external_id, note, created_by) values (${id}, ${accountId}, ${a.market_code}, ${input.system}, ${externalId}, ${clean(note)}, ${ctx.user.id})`
    } catch (e) {
      // El índice único repite la regla aunque la otra cuenta sea de un mercado que esta persona no ve.
      if ((e as { code?: string }).code === '23505') throw invalid('Ese identificador ya es de otro comercio.', 'That identifier already belongs to another merchant.')
      throw e
    }
    await audit(tx, ctx, 'alias.added', 'account', accountId, a.market_code, null, { system: input.system, external_id: externalId, note: clean(note) })
    await emit(tx, 'account.alias_issued', 'account', accountId, a.market_code, { system: input.system, external_id: externalId })
    return id
  })
}

/** Cerrar un alias: deja de estar vigente desde hoy y queda en la historia (un comercio cambia de ID con un proveedor). */
export async function closeAlias(ctx: Ctx, aliasId: string, reason: string): Promise<void> {
  const why = reason.trim()
  if (why.length < 3 || why.length > 300) throw invalid('Escribe por qué se cierra (de 3 a 300 letras).', 'Say why it is being closed (3 to 300 characters).')
  assertNoProhibited(why)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ account_id: string; market_code: string; system: string; external_id: string; valid_to: Date | null }[]>`
      select account_id, market_code, system, external_id, valid_to from crm.account_aliases where id = ${aliasId} for update`
    const al = rows[0]
    if (!al) throw notFound()
    ctx.assert('alias.manage', al.market_code)
    if (al.valid_to) throw invalid('Ese identificador ya estaba cerrado.', 'That identifier was already closed.')
    await tx`update crm.account_aliases set valid_to = now(), closed_by = ${ctx.user.id}, note = ${why} where id = ${aliasId}`
    await audit(tx, ctx, 'alias.closed', 'account', al.account_id, al.market_code, { system: al.system, external_id: al.external_id }, { reason: why })
    await emit(tx, 'account.alias_closed', 'account', al.account_id, al.market_code, { system: al.system, external_id: al.external_id })
  })
}

const sysInput = z.object({
  labelEs: z.string().trim().min(2).max(60),
  labelEn: z.string().trim().min(2).max(60),
  kind: z.enum(['internal', 'network', 'carrier', 'crm', 'other']),
  market: z.string().length(2).or(z.literal('')).optional().default(''),
})

/** Un sistema de origen nuevo (un proveedor, una red adquirida): desde ahí cualquier comercio puede llevar su ID de ese sistema. */
export async function createAliasSystem(ctx: Ctx, input: z.input<typeof sysInput>): Promise<string> {
  ctx.assert('config.manage')
  const parsed = sysInput.safeParse(input)
  if (!parsed.success) throw invalid('El sistema lleva nombre en español y en inglés (de 2 a 60 letras).', 'A system needs a name in Spanish and in English (2 to 60 characters).')
  const v = parsed.data
  assertNoProhibited(v.labelEs, v.labelEn)
  const base = v.labelEn.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, 36) || 'system'
  return withUser(ctx.user.id, async (tx) => {
    if (v.market && !(await tx`select 1 from crm.markets where code = ${v.market}`)[0]) throw invalid('Ese mercado no existe.', 'That market does not exist.')
    if ((await tx`select 1 from crm.alias_systems where lower(label_es) = lower(${v.labelEs}) or lower(label_en) = lower(${v.labelEn})`)[0]) throw invalid('Ya hay un sistema con ese nombre.', 'There is already a system with that name.')
    let code = base.length >= 2 ? base : `${base}_x`
    for (let i = 2; (await tx`select 1 from crm.alias_systems where code = ${code}`)[0]; i++) code = `${base}_${i}`
    await tx`insert into crm.alias_systems (code, label_es, label_en, kind, market_code) values (${code}, ${v.labelEs}, ${v.labelEn}, ${v.kind}, ${v.market || null})`
    await audit(tx, ctx, 'alias_system.created', 'alias_system', null, v.market || null, null, { code, label_es: v.labelEs, kind: v.kind })
    return code
  })
}
