import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import type postgres from 'postgres'

type Json = postgres.JSONValue
type Row = Record<string, unknown>

/** Nombre comparable: sin acentos, sin signos, en minúsculas y con un espacio entre palabras. */
export const nameKey = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export type ContactSource = 'lead' | 'form' | 'pipedrive' | 'sales_app' | 'manual'
export type Resolved = { id: string; outcome: 'new' | 'linked' | 'held'; matchedId: string | null }

/**
 * DAT-02: toda vía que crea un contacto pasa por aquí (conversión de leads, segunda solicitud de un formulario, Sales App).
 * - Sin teléfono, o con un teléfono que nadie tiene en el mercado: contacto nuevo.
 * - El teléfono ya es de un contacto con el mismo nombre: es la misma persona, se usa ese contacto.
 * - El teléfono ya es de alguien con otro nombre: no se adivina. El contacto nuevo se crea con el teléfono "en espera" y el par
 *   entra a la cola de Datos, Duplicados, con la fusión sugerida hacia el que ya existía. Nada se fusiona solo.
 */
export async function resolveContact(tx: Tx, actorId: string, p: { market: string; name: string; phone: string | null; email: string | null; source: ContactSource; extra?: { bestTime?: string | null } }): Promise<Resolved> {
  const known = p.phone ? (await tx<{ id: string; full_name: string }[]>`select id, full_name from app.contacts_by_phones(${p.market}, ${[p.phone]}::text[])`)[0] : undefined
  if (known && nameKey(known.full_name) === nameKey(p.name)) return { id: known.id, outcome: 'linked', matchedId: known.id }
  const id = await newId(tx)
  const held = !!known
  await tx`insert into crm.contacts (id, market_code, full_name, phone, held_phone, email, best_time, created_by)
           values (${id}, ${p.market}, ${p.name}, ${held ? null : p.phone}, ${held ? p.phone : null}, ${p.email}, ${p.extra?.bestTime ?? null}, ${actorId})`
  if (known) await tx`select app.contact_pair_queue(${p.market}, ${known.id}, ${id}, ${p.source})`
  return { id, outcome: held ? 'held' : 'new', matchedId: known?.id ?? null }
}

/** E4.F2: fusionar contactos es de administración; Ventas y Operaciones también, si el mercado lo tiene encendido. */
export async function canMergeHere(_tx: Tx, ctx: Ctx, market: string): Promise<boolean> {
  return ctx.can('account.merge', market) || ctx.can('operator.merge', market)
}

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id)

/**
 * Fusiona dos contactos de la misma persona. Antes de mover nada guarda la foto de los dos; el que se archiva entrega sus
 * vínculos con cuentas y negocios, sus consentimientos y su papel de quien decide. Si el que queda no tenía teléfono, toma
 * el del archivado (también el que estaba en espera). Se puede deshacer.
 */
export async function mergeContacts(ctx: Ctx, sourceId: string, targetId: string): Promise<string> {
  if (sourceId === targetId) throw invalid('Elige dos contactos distintos.', 'Pick two different contacts.')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; row: Row }[]>`select c.id, to_jsonb(c) as row from crm.contacts c where c.id in (${sourceId}, ${targetId}) for update`
    const s = rows.find((r) => r.id === sourceId)?.row
    const t = rows.find((r) => r.id === targetId)?.row
    if (!s || !t || s.archived_at || t.archived_at) throw notFound('No encontramos ese contacto.', 'We could not find that contact.')
    const market = String(t.market_code)
    if (s.market_code !== market) throw invalid('Solo se fusionan contactos del mismo mercado.', 'Only contacts in the same market can be merged.')
    if (!(await canMergeHere(tx, ctx, market))) ctx.assert('operator.merge', market)

    // Primero se archiva el que se va (todavía se ve: tiene sus vínculos); después se mueven sus vínculos.
    const phone = (s.phone ?? s.held_phone ?? null) as string | null
    const takePhone = !t.phone && !!phone
    await tx`update crm.contacts set merged_into = ${targetId}, archived_at = now(), phone = null, held_phone = null where id = ${sourceId}`
    await tx`update crm.contacts set phone = case when ${takePhone} then ${phone} else phone end,
                                     held_phone = case when ${takePhone} then null else held_phone end,
                                     email = coalesce(email, ${(s.email as string | null) ?? null}::citext) where id = ${targetId}`
    const moved: Record<string, string[]> = {}
    // Un vínculo que el que queda ya tiene (misma cuenta, mismo negocio) no se duplica: el del archivado se cierra.
    moved.links_closed = ids(await tx<{ id: string }[]>`
      update crm.account_contacts s set valid_to = now(), end_reason = 'merge', is_primary = false
       where s.contact_id = ${sourceId} and s.valid_to is null
         and exists (select 1 from crm.account_contacts x where x.contact_id = ${targetId} and x.account_id = s.account_id and x.valid_to is null and x.deal_id is not distinct from s.deal_id)
       returning id`)
    moved.links = ids(await tx<{ id: string }[]>`update crm.account_contacts set contact_id = ${targetId} where contact_id = ${sourceId} and valid_to is null returning id`)
    moved.decision_maker = ids(await tx<{ id: string }[]>`update crm.deals set decision_maker_id = ${targetId} where decision_maker_id = ${sourceId} returning id`)
    moved.consents = ids(await tx<{ id: string }[]>`update crm.consents set contact_id = ${targetId} where contact_id = ${sourceId} returning id`)

    const eventId = await newId(tx)
    await tx`insert into crm.contact_merge_events (id, market_code, source_id, target_id, snapshot, moved, merged_by)
             values (${eventId}, ${market}, ${sourceId}, ${targetId}, ${tx.json({ source: s, target: t } as Json)}, ${tx.json({ ...moved, phone_taken: takePhone ? [phone!] : [] } as Json)}, ${ctx.user.id})`
    await tx`update crm.contact_pairs set status = 'merged', decided_by = ${ctx.user.id}, decided_at = now()
              where status = 'open' and a_id = least(${sourceId}::uuid, ${targetId}::uuid) and b_id = greatest(${sourceId}::uuid, ${targetId}::uuid)`
    await tx`update crm.contact_pairs set status = 'dismissed', decision_note = 'archived', decided_at = now() where status = 'open' and (a_id = ${sourceId} or b_id = ${sourceId})`
    await audit(tx, ctx, 'contact.merged', 'contact', targetId, market, { source_id: sourceId, source_name: s.full_name }, { target_id: targetId, merge_event_id: eventId, phone_taken: takePhone })
    return eventId
  })
}

/** Deshacer: el contacto archivado vuelve con sus datos y recupera sus vínculos. Lo que pasó después se queda con el que quedó. */
export async function undoContactMerge(ctx: Ctx, eventId: string, reason: string): Promise<void> {
  const why = reason.trim()
  if (why.length < 5 || why.length > 300) throw invalid('Escribe por qué se deshace la fusión (de 5 a 300 letras).', 'Say why the merge is being undone (5 to 300 characters).')
  assertNoProhibited(why)
  await withUser(ctx.user.id, async (tx) => {
    const ev = (await tx<{ market_code: string; source_id: string; target_id: string; snapshot: { source: Row; target: Row }; moved: Record<string, string[]>; undone_at: Date | null }[]>`
      select market_code, source_id, target_id, snapshot, moved, undone_at from crm.contact_merge_events where id = ${eventId} for update`)[0]
    if (!ev) throw notFound('No encontramos esa fusión.', 'We could not find that merge.')
    if (ev.undone_at) throw invalid('Esa fusión ya se deshizo.', 'That merge was already undone.')
    if (!(await canMergeHere(tx, ctx, ev.market_code))) ctx.assert('operator.merge', ev.market_code)
    const src = ev.snapshot.source
    // El teléfono vuelve a su dueño solo si el que quedó no lo cambió después.
    if ((ev.moved.phone_taken ?? []).length) {
      await tx`update crm.contacts set phone = null where id = ${ev.target_id} and phone = ${ev.moved.phone_taken![0]!}`
    }
    await tx`update crm.account_contacts set contact_id = ${ev.source_id} where id = any(${ev.moved.links ?? []}::uuid[]) and contact_id = ${ev.target_id}`
    await tx`update crm.account_contacts set valid_to = null, end_reason = null where id = any(${ev.moved.links_closed ?? []}::uuid[]) and end_reason = 'merge'`
    await tx`update crm.deals set decision_maker_id = ${ev.source_id} where id = any(${ev.moved.decision_maker ?? []}::uuid[]) and decision_maker_id = ${ev.target_id}`
    await tx`update crm.consents set contact_id = ${ev.source_id} where id = any(${ev.moved.consents ?? []}::uuid[]) and contact_id = ${ev.target_id}`
    await tx`update crm.contacts set merged_into = null, archived_at = null,
               phone = case when ${(src.phone as string | null) ?? null}::text is not null and not exists (select 1 from crm.contacts x where x.market_code = ${ev.market_code} and x.phone = ${(src.phone as string | null) ?? null}) then ${(src.phone as string | null) ?? null} end,
               held_phone = case when ${(src.phone as string | null) ?? null}::text is not null and exists (select 1 from crm.contacts x where x.market_code = ${ev.market_code} and x.phone = ${(src.phone as string | null) ?? null}) then ${(src.phone as string | null) ?? null} else ${(src.held_phone as string | null) ?? null} end
             where id = ${ev.source_id}`
    await tx`update crm.contact_merge_events set undone_at = now(), undone_by = ${ctx.user.id}, undo_reason = ${why} where id = ${eventId}`
    await audit(tx, ctx, 'contact.merge_undone', 'contact', ev.target_id, ev.market_code, { merge_event_id: eventId }, { source_id: ev.source_id, reason: why })
  })
}

/** "No son la misma persona": el par sale de la cola. El teléfono en espera sigue guardado en el contacto, a la vista. */
export async function dismissContactPair(ctx: Ctx, pairId: string, note: string): Promise<void> {
  const why = note.trim()
  if (why.length < 5 || why.length > 300) throw invalid('Escribe por qué no son la misma persona (de 5 a 300 letras).', 'Say why they are not the same person (5 to 300 characters).')
  assertNoProhibited(why)
  await withUser(ctx.user.id, async (tx) => {
    const p = (await tx<{ market_code: string }[]>`select market_code from crm.contact_pairs where id = ${pairId} and status = 'open' for update`)[0]
    if (!p) throw notFound('Ese par ya se decidió.', 'That pair was already decided.')
    if (!ctx.can('duplicate.review', p.market_code) && !(await canMergeHere(tx, ctx, p.market_code))) ctx.assert('duplicate.review', p.market_code)
    await tx`update crm.contact_pairs set status = 'dismissed', decision_note = ${why}, decided_by = ${ctx.user.id}, decided_at = now() where id = ${pairId}`
    await audit(tx, ctx, 'contact.pair_dismissed', 'contact_pair', pairId, p.market_code, null, { note: why })
  })
}
