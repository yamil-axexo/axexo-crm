import 'server-only'
import { z } from 'zod'
import { marketToday, withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { assertNoProhibited } from '@/domain/guard'
import { audit, emit, clean } from '@/domain/common'
import { isoDate, syncDealStep } from '@/domain/deals'
import { DomainError, invalid, notFound } from '@/lib/errors'

/** Estados que Operaciones lleva por proveedor y por documento. */
export const PROVIDER_STATUS = ['pending', 'sent', 'approved', 'rejected'] as const
export const DOCUMENT_STATUS = ['missing', 'received', 'validated'] as const
export const TRAINING_STATUS = ['pending', 'scheduled', 'done'] as const
export const OPS_LABEL: Record<string, { es: string; en: string }> = {
  pending: { es: 'Pendiente', en: 'Pending' },
  sent: { es: 'Enviada', en: 'Submitted' },
  approved: { es: 'Aprobada', en: 'Approved' },
  rejected: { es: 'Rechazada', en: 'Rejected' },
  missing: { es: 'Falta', en: 'Missing' },
  received: { es: 'Recibido', en: 'Received' },
  validated: { es: 'Validado', en: 'Validated' },
  scheduled: { es: 'Agendada', en: 'Scheduled' },
  done: { es: 'Hecha', en: 'Done' },
}

type OpsDeal = { id: string; market_code: string; account_id: string; pipeline_id: string; stage_id: string; status: string; owner_id: string | null; ops_owner_id: string | null; title: string; is_ops: boolean; has_items: boolean; currency: string }

async function loadOpsDeal(tx: Tx, id: string): Promise<OpsDeal> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound()
  const rows = await tx<OpsDeal[]>`
    select d.id, d.market_code, d.account_id, d.pipeline_id, d.stage_id, d.status, d.owner_id, d.ops_owner_id, d.title, s.is_ops, p.has_items, d.currency
      from crm.deals d join crm.stages s on s.id = d.stage_id join crm.pipelines p on p.id = d.pipeline_id where d.id = ${id} for update of d`
  if (!rows[0]) throw notFound('No encontramos ese negocio.', 'We could not find that deal.')
  return rows[0]
}

const openOnly = (d: OpsDeal) => {
  if (d.status !== 'open') throw invalid('Un negocio cerrado no se edita.', 'A closed deal cannot be edited.')
}

// ---------------------------------------------------------------- líneas de producto (pedido)

const itemInput = z.object({ productId: z.guid(), quantity: z.number().positive().max(1_000_000), unitPrice: z.number().nonnegative().max(1e9).nullable().optional(), /** Descuento de la línea, en porcentaje (0 a 100). */ discountPct: z.number().min(0).max(100).optional().default(0) })

async function recomputeAmount(tx: Tx, dealId: string): Promise<number | null> {
  const rows = await tx<{ total: string | null; n: number }[]>`select sum(sum_minor)::text as total, count(*)::int as n from crm.deal_items where deal_id = ${dealId}`
  const total = rows[0]?.n ? Number(rows[0].total ?? 0) : null
  await tx`update crm.deals set amount_minor = ${total} where id = ${dealId}`
  return total
}

/** Agrega una línea al pedido: producto del catálogo del mercado, cantidad y precio unitario. El monto del negocio es la suma de sus líneas. */
export async function addDealItem(ctx: Ctx, dealId: string, raw: z.input<typeof itemInput>): Promise<void> {
  const parsed = itemInput.safeParse(raw)
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '')
    if (field === 'productId') throw invalid('Elige un producto del catálogo.', 'Pick a product from the catalog.')
    if (field === 'quantity') throw invalid('La cantidad tiene que ser mayor que cero.', 'The quantity must be greater than zero.')
    if (field === 'discountPct') throw invalid('El descuento es un porcentaje entre 0 y 100.', 'The discount is a percentage between 0 and 100.')
    throw invalid('El precio unitario tiene que ser un número de cero en adelante.', 'The unit price must be a number, zero or more.')
  }
  const v = parsed.data
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadOpsDeal(tx, dealId)
    ctx.assert('deal.edit', d.market_code)
    openOnly(d)
    if (!d.has_items) throw invalid('Este embudo no lleva líneas de producto.', 'This pipeline does not carry product lines.')
    const prods = await tx<{ id: string; name: string; unit_price_minor: string | null }[]>`
      select id, name, unit_price_minor::text from crm.products where id = ${v.productId} and is_active and (market_code is null or market_code = ${d.market_code})`
    const prod = prods[0]
    if (!prod) throw invalid('Ese producto no está en el catálogo de este mercado.', 'That product is not in this market’s catalog.')
    const unit = v.unitPrice == null ? (prod.unit_price_minor === null ? null : Number(prod.unit_price_minor)) : Math.round(v.unitPrice * 100)
    if (unit === null) throw invalid('Ese producto no tiene precio en el catálogo: escribe el precio unitario.', 'That product has no catalog price: enter the unit price.')
    const discount = Math.round(v.discountPct * 100) / 100
    // El importe de la línea ya trae su descuento: cantidad por precio, menos el porcentaje.
    const sum = Math.round(unit * v.quantity * (1 - discount / 100))
    const pos = await tx<{ n: number }[]>`select coalesce(max(position), 0)::int + 1 as n from crm.deal_items where deal_id = ${dealId}`
    await tx`insert into crm.deal_items (deal_id, market_code, product_id, name, quantity, unit_price_minor, discount_pct, sum_minor, currency, position)
             values (${dealId}, ${d.market_code}, ${prod.id}, ${prod.name}, ${v.quantity}, ${unit}, ${discount}, ${sum}, ${d.currency}, ${pos[0]!.n})`
    const total = await recomputeAmount(tx, dealId)
    await audit(tx, ctx, 'deal.item_added', 'deal', dealId, d.market_code, null, { product_id: prod.id, quantity: v.quantity, unit_price_minor: unit, ...(discount ? { discount_pct: discount } : {}), amount_minor: total })
  })
}

export async function removeDealItem(ctx: Ctx, dealId: string, itemId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadOpsDeal(tx, dealId)
    ctx.assert('deal.edit', d.market_code)
    openOnly(d)
    const gone = await tx<{ name: string }[]>`delete from crm.deal_items where id = ${itemId} and deal_id = ${dealId} returning name`
    if (!gone[0]) throw notFound()
    const total = await recomputeAmount(tx, dealId)
    await audit(tx, ctx, 'deal.item_removed', 'deal', dealId, d.market_code, { name: gone[0].name }, { amount_minor: total })
  })
}

// ---------------------------------------------------------------- datos del pedido (E11.F1)

export const DEFAULT_CARRIER = 'FedEx'
const orderInput = z.object({
  carrier: z.string().trim().max(60).optional().default(''),
  customerNumber: z.string().trim().max(40).optional().default(''),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional().default(''),
  poNumber: z.string().trim().max(40).optional().default(''),
  shipTo: z.string().trim().max(400).optional().default(''),
  terms: z.string().trim().max(120).optional().default(''),
  description: z.string().trim().max(1000).optional().default(''),
})
export type OrderDetailsInput = z.input<typeof orderInput>

/**
 * Datos del pedido que Operaciones necesita para surtirlo: paquetería (FedEx si no se dice otra), número de cliente,
 * fecha de entrega, orden de compra, dirección de envío, términos y descripción. Solo en embudos con líneas de producto.
 */
export async function saveOrderDetails(ctx: Ctx, dealId: string, raw: OrderDetailsInput): Promise<void> {
  const parsed = orderInput.safeParse(raw)
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '')
    if (field === 'dueOn') throw invalid('Fecha de entrega: elige el día.', 'Due date: pick the day.')
    if (field === 'shipTo') throw invalid('Dirección de envío: hasta 400 caracteres.', 'Shipping address: up to 400 characters.')
    if (field === 'description') throw invalid('Descripción: hasta 1000 caracteres.', 'Description: up to 1000 characters.')
    throw invalid('Revisa los datos del pedido: alguno es más largo de lo que cabe.', 'Check the order details: one of them is longer than fits.')
  }
  const v = parsed.data
  assertNoProhibited(v.carrier, v.customerNumber, v.poNumber, v.shipTo, v.terms, v.description)
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadOpsDeal(tx, dealId)
    ctx.assert('deal.edit', d.market_code)
    openOnly(d)
    if (!d.has_items) throw invalid('Este embudo no lleva pedidos.', 'This pipeline does not carry orders.')
    if (v.dueOn) {
      const ok = await tx<{ ok: boolean }[]>`select ${v.dueOn}::date >= ${marketToday(tx, d.market_code)} as ok`
      const same = await tx`select 1 from crm.deal_orders where deal_id = ${dealId} and due_on = ${v.dueOn}::date`
      if (!ok[0]?.ok && !same[0]) throw invalid('La fecha de entrega es de hoy en adelante.', 'The due date is today or later.')
    }
    const next = { carrier: v.carrier || DEFAULT_CARRIER, customer_number: clean(v.customerNumber), due_on: v.dueOn || null, po_number: clean(v.poNumber), ship_to: clean(v.shipTo), terms: clean(v.terms), description: clean(v.description) }
    const prev = await tx<{ carrier: string; customer_number: string | null; due_on: string | null; po_number: string | null; ship_to: string | null; terms: string | null; description: string | null }[]>`
      select carrier, customer_number, due_on::text, po_number, ship_to, terms, description from crm.deal_orders where deal_id = ${dealId} for update`
    if (prev[0] && JSON.stringify(prev[0]) === JSON.stringify(next)) return
    await tx`insert into crm.deal_orders (deal_id, market_code, carrier, customer_number, due_on, po_number, ship_to, terms, description, updated_by)
             values (${dealId}, ${d.market_code}, ${next.carrier}, ${next.customer_number}, ${next.due_on}, ${next.po_number}, ${next.ship_to}, ${next.terms}, ${next.description}, ${ctx.user.id})
             on conflict (deal_id) do update set carrier = excluded.carrier, customer_number = excluded.customer_number, due_on = excluded.due_on, po_number = excluded.po_number,
               ship_to = excluded.ship_to, terms = excluded.terms, description = excluded.description, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'deal.order_updated', 'deal', dealId, d.market_code, prev[0] ?? null, next)
  })
}

// ---------------------------------------------------------------- cola de Operaciones

/** "Tomar": el negocio queda a nombre de quien lo toma en Operaciones. Solo en etapas de Operaciones. */
export async function takeDeal(ctx: Ctx, dealId: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadOpsDeal(tx, dealId)
    ctx.assert('deal.ops', d.market_code)
    openOnly(d)
    if (!d.is_ops) throw invalid('Este negocio todavía está con Ventas.', 'This deal is still with Sales.')
    if (d.ops_owner_id === ctx.user.id) return
    await tx`update crm.deals set ops_owner_id = ${ctx.user.id} where id = ${dealId}`
    await tx`update crm.activities set owner_id = ${ctx.user.id} where deal_id = ${dealId} and deal_step = 'ops' and done_at is null`
    await audit(tx, ctx, 'deal.ops_taken', 'deal', dealId, d.market_code, { ops_owner_id: d.ops_owner_id }, { ops_owner_id: ctx.user.id })
  })
}

/** El próximo paso de Operaciones: es aparte del de quien vende y llega a Hoy de quien lleva el negocio en Operaciones. */
export async function setOpsStep(ctx: Ctx, dealId: string, rawStep: string, due: string): Promise<void> {
  const step = clean(rawStep)
  if (!step || step.length < 2 || step.length > 200) throw invalid('Escribe el próximo paso de Operaciones (hasta 200 letras).', 'Enter the Operations next step (up to 200 characters).')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw invalid('Ponle fecha al próximo paso de Operaciones.', 'Give the Operations next step a date.')
  assertNoProhibited(step)
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadOpsDeal(tx, dealId)
    ctx.assert('deal.ops', d.market_code)
    openOnly(d)
    const ok = await tx<{ ok: boolean }[]>`select ${due}::date >= ${marketToday(tx, d.market_code)} as ok`
    if (!ok[0]?.ok) throw invalid('La fecha del próximo paso tiene que ser de hoy en adelante.', 'The next step date must be today or later.')
    const owner = d.ops_owner_id ?? ctx.user.id
    await tx`update crm.deals set ops_next_step = ${step}, ops_next_step_due = ${due}, ops_owner_id = ${owner} where id = ${dealId}`
    await syncDealStep(tx, ctx, d, 'ops', step, due, owner)
    await audit(tx, ctx, 'deal.updated', 'deal', dealId, d.market_code, null, { ops_next_step: step, ops_next_step_due: due })
  })
}

// ---------------------------------------------------------------- campos que Operaciones mantiene

const checkInput = z.object({
  status: z.string(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional().default(''),
  link: z.string().trim().max(500).optional().default(''),
})

/** Estado de un proveedor (pendiente, enviada, aprobada, rechazada) o de un documento (falta, recibido, validado, con enlace a dónde está). */
export async function setOpsCheck(ctx: Ctx, dealId: string, catalogId: string, raw: z.input<typeof checkInput>): Promise<void> {
  const parsed = checkInput.safeParse(raw)
  if (!parsed.success) throw invalid('Revisa la fecha (AAAA-MM-DD) y el enlace.', 'Check the date (YYYY-MM-DD) and the link.')
  const v = parsed.data
  if (v.link && !/^https:\/\/[^\s]+$/.test(v.link)) throw invalid('El enlace tiene que empezar con https:// y no llevar espacios. Se guarda dónde está el documento, no el archivo.', 'The link must start with https:// and have no spaces. We store where the document is, not the file.')
  assertNoProhibited(v.link)
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadOpsDeal(tx, dealId)
    ctx.assert('deal.ops', d.market_code)
    const cats = await tx<{ id: string; kind: string; code: string }[]>`
      select id, kind, code from crm.ops_catalog where id = ${catalogId} and is_active and kind in ('provider', 'document') and (market_code is null or market_code = ${d.market_code})`
    const cat = cats[0]
    if (!cat) throw notFound('Ese proveedor o documento no está en el catálogo de este mercado.', 'That provider or document is not in this market’s catalog.')
    const allowed: readonly string[] = cat.kind === 'provider' ? PROVIDER_STATUS : DOCUMENT_STATUS
    if (!allowed.includes(v.status)) throw invalid('Elige un estado de la lista.', 'Pick a status from the list.')
    if (cat.kind === 'provider' && v.link) throw invalid('El enlace es solo para documentos.', 'The link is only for documents.')
    if (v.onDate) {
      const ok = await tx<{ ok: boolean }[]>`select ${v.onDate}::date <= ${marketToday(tx, d.market_code)} as ok`
      if (!ok[0]?.ok) throw invalid('La fecha es de hoy hacia atrás.', 'The date is today or earlier.')
    }
    const before = await tx<{ status: string }[]>`select status from crm.deal_ops_checks where deal_id = ${dealId} and catalog_id = ${catalogId}`
    await tx`insert into crm.deal_ops_checks (deal_id, market_code, catalog_id, status, on_date, link, updated_by)
             values (${dealId}, ${d.market_code}, ${catalogId}, ${v.status}, ${v.onDate || null}, ${v.link || null}, ${ctx.user.id})
             on conflict (deal_id, catalog_id) do update set status = excluded.status, on_date = excluded.on_date, link = excluded.link, updated_by = excluded.updated_by, updated_at = now()`
    await audit(tx, ctx, 'deal.ops_check', 'deal', dealId, d.market_code, before[0] ? { status: before[0].status } : null, { kind: cat.kind, code: cat.code, status: v.status, on: v.onDate || null, link: Boolean(v.link) })
  })
}

/** Capacitación: pendiente, agendada (con fecha) o hecha. */
export async function setTraining(ctx: Ctx, dealId: string, status: string, on: string): Promise<void> {
  if (!(TRAINING_STATUS as readonly string[]).includes(status)) throw invalid('Elige el estado de la capacitación.', 'Pick the training status.')
  if (on && !/^\d{4}-\d{2}-\d{2}$/.test(on)) throw invalid('Elige la fecha de la capacitación.', 'Choose the training date.')
  if (status === 'scheduled' && !on) throw invalid('Una capacitación agendada lleva fecha.', 'A scheduled training needs a date.')
  await withUser(ctx.user.id, async (tx) => {
    const d = await loadOpsDeal(tx, dealId)
    ctx.assert('deal.ops', d.market_code)
    const day = status === 'pending' ? null : on || null
    const before = await tx<{ training_status: string }[]>`select training_status from crm.deals where id = ${dealId}`
    await tx`update crm.deals set training_status = ${status}, training_on = ${day} where id = ${dealId}`
    await audit(tx, ctx, 'deal.training', 'deal', dealId, d.market_code, { status: before[0]?.training_status ?? null }, { status, on: day })
  })
}

/** Merchant ID del comercio: lo anota Operaciones y se ve (y se copia) en la ficha y en el negocio. */
export async function setMerchantRef(ctx: Ctx, accountId: string, raw: string, confirmDuplicate = false): Promise<void> {
  const value = clean(raw)
  if (value && !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(value)) throw invalid('El Merchant ID lleva letras, números, punto, guion o espacio, hasta 40 caracteres.', 'The Merchant ID takes letters, numbers, dot, hyphen or space, up to 40 characters.')
  assertNoProhibited(value)
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; merchant_ref: string | null }[]>`select market_code, merchant_ref from crm.accounts where id = ${accountId} for update`
    const a = rows[0]
    if (!a) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
    ctx.assert('deal.ops', a.market_code)
    // El mismo Merchant ID en dos comercios del mercado casi siempre es un error de captura: se avisa cuál lo tiene y se pide confirmar.
    const others = value ? await tx<{ name: string }[]>`
      select name from crm.accounts where market_code = ${a.market_code} and merchant_ref is not null and upper(btrim(merchant_ref)) = upper(${value}) and id <> ${accountId} and archived_at is null
       order by name limit 3` : []
    if (others.length > 0 && !confirmDuplicate) {
      const names = others.map((o) => `"${o.name}"`).join(', ')
      throw new DomainError('merchant_ref_duplicate',
        `Ese Merchant ID ya lo tiene ${names} en este mercado. Revisa si es el mismo comercio antes de guardarlo aquí también.`,
        `That Merchant ID already belongs to ${names} in this market. Check whether it is the same merchant before saving it here too.`, 409)
    }
    await tx`update crm.accounts set merchant_ref = ${value} where id = ${accountId}`
    await audit(tx, ctx, 'account.merchant_ref', 'account', accountId, a.market_code, { merchant_ref: a.merchant_ref }, { merchant_ref: value, ...(others.length > 0 ? { duplicate_confirmed: true, same_as: others.map((o) => o.name) } : {}) })
  })
}

// ---------------------------------------------------------------- cerrar en bloque

export const BULK_LIMIT = 100

/**
 * Cierra como perdidos varios negocios sin movimiento, con un mismo motivo. Cada negocio deja su propio evento en la bitácora.
 * Un negocio en pausa no es un negocio sin movimiento: no se cierra en bloque (se cuenta como omitido). El motivo tiene que
 * ser de los del embudo de cada negocio, igual que al perderlo uno por uno.
 */
export async function bulkCloseLost(ctx: Ctx, dealIds: string[], reasonCode: string, note: string): Promise<{ closed: number; skipped: number }> {
  const ids = [...new Set(dealIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  if (ids.length === 0) throw invalid('Elige al menos un negocio.', 'Select at least one deal.')
  if (ids.length > BULK_LIMIT) throw invalid(`Cierra hasta ${BULK_LIMIT} negocios por vez.`, `Close up to ${BULK_LIMIT} deals at a time.`)
  assertNoProhibited(note)
  if (note.trim().length > 300) throw invalid('Deja la nota en 300 caracteres o menos.', 'Keep the note to 300 characters or fewer.')
  return withUser(ctx.user.id, async (tx) => {
    const reason = reasonCode ? await tx<{ market_code: string | null; motors: string[] | null }[]>`select market_code, motors from crm.loss_reasons where code = ${reasonCode} and kind = 'lost' and is_active` : []
    if (!reason[0]) throw invalid('Elige el motivo de pérdida.', 'Pick the loss reason.')
    const deals = await tx<{ id: string; market_code: string; stage_id: string; pipeline_id: string; motor: string }[]>`
      select d.id, d.market_code, d.stage_id, d.pipeline_id, p.motor from crm.deals d join crm.pipelines p on p.id = d.pipeline_id
       where d.id = any(${ids}::uuid[]) and d.status = 'open' and d.paused_at is null order by d.id for update of d`
    let closed = 0
    for (const d of deals) {
      if (!ctx.can('deal.bulk_close', d.market_code)) throw new DomainError('forbidden', 'No tienes permiso para cerrar negocios en bloque.', 'You do not have permission to close deals in bulk.', 403)
      if ((reason[0].market_code && reason[0].market_code !== d.market_code) || (reason[0].motors && !reason[0].motors.includes(d.motor))) {
        throw invalid('Ese motivo no es de este embudo. Elige uno de la lista.', 'That reason does not belong to this pipeline. Pick one from the list.')
      }
      const lost = await tx<{ id: string }[]>`select id from crm.stages where pipeline_id = ${d.pipeline_id} and kind = 'lost' order by position limit 1`
      if (!lost[0]) continue
      const done = await tx`update crm.deals set stage_id = ${lost[0].id}, status = 'lost', loss_reason_code = ${reasonCode}, loss_note = ${clean(note)},
                  lost_at = now(), closed_by = 'manual', stage_entered_at = now(), revisit_needed = false where id = ${d.id} and status = 'open'`
      if (done.count === 0) continue
      await tx`insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause) values (${d.id}, ${d.market_code}, ${d.stage_id}, ${lost[0].id}, ${ctx.user.id}, 'user')`
      await tx`update crm.activities set done_at = now(), outcome = 'done' where deal_id = ${d.id} and deal_step is not null and done_at is null`
      await audit(tx, ctx, 'deal.stage_changed', 'deal', d.id, d.market_code, { stage_id: d.stage_id }, { stage_id: lost[0].id, kind: 'lost', reason: reasonCode, bulk: true })
      await emit(tx, 'deal.stage_changed', 'deal', d.id, d.market_code, { from: d.stage_id, to: lost[0].id, kind: 'lost' })
      closed++
    }
    return { closed, skipped: ids.length - closed }
  })
}

// ---------------------------------------------------------------- avisos desde una nota

/**
 * A quién se le puede avisar desde una nota: personas que ven ese registro. Quien lo lleva (ventas y Operaciones)
 * y quienes ven todo el mercado (Operaciones, supervisión, líder de mercado). Nunca quien escribe.
 */
export async function notifiable(tx: Tx, ctx: Ctx, market: string, accountId: string | null, dealId: string | null): Promise<{ id: string; full_name: string }[]> {
  const rows = await tx<{ id: string; full_name: string }[]>`
    select distinct u.id, u.full_name from crm.users u
     where u.is_active and not u.is_system and u.id <> ${ctx.user.id}
       and (u.id in (select owner_id from crm.accounts where id = ${accountId})
            or u.id in (select owner_id from crm.deals where ${dealId ? tx`id = ${dealId}` : tx`account_id = ${accountId} and status = 'open'`})
            or u.id in (select ops_owner_id from crm.deals where ${dealId ? tx`id = ${dealId}` : tx`account_id = ${accountId} and status = 'open'`})
            or exists (select 1 from crm.memberships m where m.user_id = u.id and m.market_code = ${market} and m.role in ('ops', 'supervisor', 'market_lead')
                        and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())))
     order by u.full_name`
  return [...rows]
}

/** Deja el aviso a la persona elegida: le aparece en Hoy con enlace al registro. Sin correo ni mensajes fuera de CONTIGO. */
export async function notifyFromNote(tx: Tx, ctx: Ctx, p: { market: string; userId: string; accountId: string | null; dealId: string | null; activityId: string; body: string }): Promise<void> {
  const people = await notifiable(tx, ctx, p.market, p.accountId, p.dealId)
  if (!people.some((u) => u.id === p.userId)) throw invalid('Solo puedes avisar a alguien que ve este registro.', 'You can only notify someone who can see this record.')
  await tx`insert into crm.notices (market_code, user_id, from_user_id, kind, account_id, deal_id, activity_id, body)
           values (${p.market}, ${p.userId}, ${ctx.user.id}, 'mention', ${p.accountId}, ${p.dealId}, ${p.activityId}, ${p.body.slice(0, 600)})`
  await audit(tx, ctx, 'activity.notice_sent', 'activity', p.activityId, p.market, null, { to: p.userId })
}

export async function markNoticeSeen(ctx: Ctx, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound()
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string }[]>`update crm.notices set seen_at = now() where id = ${id} and user_id = ${ctx.user.id} and seen_at is null returning market_code`
    if (rows[0]) await audit(tx, ctx, 'activity.notice_seen', 'notice', id, rows[0].market_code, null, null)
  })
}

// ---------------------------------------------------------------- configuración (administración)

const catalogInput = z.object({
  id: z.guid().or(z.literal('')).optional().default(''),
  market: z.string().length(2).or(z.literal('')).optional().default(''),
  kind: z.enum(['provider', 'document', 'return_reason']),
  labelEs: z.string().trim().min(2).max(80),
  labelEn: z.string().trim().min(2).max(80),
  active: z.boolean().optional().default(true),
})

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

/** Catálogos de Operaciones (proveedores, documentos requeridos, motivos de devolución): los mantiene administración. */
export async function saveOpsCatalog(ctx: Ctx, raw: z.input<typeof catalogInput>): Promise<void> {
  ctx.assert('config.manage')
  const parsed = catalogInput.safeParse(raw)
  if (!parsed.success) throw invalid('Escribe el nombre en español y en inglés (2 a 80 letras).', 'Enter the name in Spanish and in English (2 to 80 characters).')
  const v = parsed.data
  if (v.kind !== 'return_reason' && !v.market && !v.id) throw invalid('Elige el mercado.', 'Pick the market.')
  await withUser(ctx.user.id, async (tx) => {
    if (v.id) {
      const rows = await tx<{ market_code: string | null }[]>`update crm.ops_catalog set label_es = ${v.labelEs}, label_en = ${v.labelEn}, is_active = ${v.active} where id = ${v.id} returning market_code`
      if (!rows[0]) throw notFound()
      await audit(tx, ctx, 'pipeline.catalog_updated', 'ops_catalog', v.id, rows[0].market_code, null, { label_es: v.labelEs, label_en: v.labelEn, active: v.active })
      return
    }
    const code = slug(v.labelEn)
    if (code.length < 2) throw invalid('El nombre en inglés lleva al menos dos letras o números.', 'The English name needs at least two letters or numbers.')
    const clash = await tx`select 1 from crm.ops_catalog where coalesce(market_code, '') = ${v.market} and kind = ${v.kind} and code = ${code}`
    if (clash[0]) throw invalid('Ya existe uno con ese nombre en este mercado.', 'There is already one with that name in this market.')
    const pos = await tx<{ n: number }[]>`select coalesce(max(position), 0)::int + 1 as n from crm.ops_catalog where coalesce(market_code, '') = ${v.market} and kind = ${v.kind}`
    const rows = await tx<{ id: string }[]>`insert into crm.ops_catalog (market_code, kind, code, label_es, label_en, position) values (${v.market || null}, ${v.kind}, ${code}, ${v.labelEs}, ${v.labelEn}, ${pos[0]!.n}) returning id`
    await audit(tx, ctx, 'pipeline.catalog_created', 'ops_catalog', rows[0]!.id, v.market || null, null, { kind: v.kind, code })
  })
}

const productInput = z.object({
  id: z.guid().or(z.literal('')).optional().default(''),
  market: z.string().length(2),
  name: z.string().trim().min(2).max(120),
  price: z.number().nonnegative().max(1e9),
  active: z.boolean().optional().default(true),
})

/** Catálogo simple de productos por mercado, con precio unitario en la moneda del mercado. */
export async function saveProduct(ctx: Ctx, raw: z.input<typeof productInput>): Promise<void> {
  ctx.assert('config.manage')
  const parsed = productInput.safeParse(raw)
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '')
    throw field === 'price' ? invalid('El precio unitario es un número de cero en adelante.', 'The unit price is a number, zero or more.')
      : field === 'market' ? invalid('Elige el mercado.', 'Pick the market.') : invalid('Escribe el nombre del producto (2 a 120 letras).', 'Enter the product name (2 to 120 characters).')
  }
  const v = parsed.data
  ctx.market(v.market)
  await withUser(ctx.user.id, async (tx) => {
    const minor = Math.round(v.price * 100)
    if (v.id) {
      const rows = await tx`update crm.products set name = ${v.name}, unit_price_minor = ${minor}, is_active = ${v.active} where id = ${v.id} and market_code = ${v.market} returning id`
      if (!rows[0]) throw notFound()
      await audit(tx, ctx, 'pipeline.product_updated', 'product', v.id, v.market, null, { name: v.name, unit_price_minor: minor, active: v.active })
      return
    }
    const rows = await tx<{ id: string }[]>`insert into crm.products (name, market_code, unit_price_minor) values (${v.name}, ${v.market}, ${minor}) returning id`
    await audit(tx, ctx, 'pipeline.product_created', 'product', rows[0]!.id, v.market, null, { name: v.name, unit_price_minor: minor })
  })
}

/** Propiedades del embudo (varios negocios abiertos por comercio, líneas de producto) y de la etapa (es de Operaciones). */
export async function setPipelineFlags(ctx: Ctx, pipelineId: string, flags: { multiOpen: boolean; hasItems: boolean; opsStageIds: string[]; /** Líder de Operaciones del embudo: recibe lo que entra a Operaciones. Sin mandarlo, no cambia; vacío lo quita. */ opsLeadId?: string }): Promise<void> {
  ctx.assert('config.manage')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; multi_open: boolean; has_items: boolean; ops_lead_id: string | null }[]>`select market_code, multi_open, has_items, ops_lead_id from crm.pipelines where id = ${pipelineId} for update`
    const p = rows[0]
    if (!p) throw notFound()
    const lead = flags.opsLeadId === undefined ? p.ops_lead_id : flags.opsLeadId || null
    if (lead && lead !== p.ops_lead_id) {
      const ok = /^[0-9a-f-]{36}$/i.test(lead) ? await tx`
        select 1 from crm.users u where u.id = ${lead} and u.is_active and not u.is_system
           and exists (select 1 from crm.memberships m where m.user_id = u.id and m.role = 'ops' and m.market_code = ${p.market_code} and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))` : []
      if (!ok[0]) throw invalid('Quien lidera Operaciones del embudo tiene que ser una persona de Operaciones de ese mercado.', 'The pipeline’s Operations lead must be an Operations person in that market.')
    }
    const stages = await tx<{ id: string; kind: string; is_ops: boolean }[]>`select id, kind, is_ops from crm.stages where pipeline_id = ${pipelineId} order by position`
    const ops = new Set(flags.opsStageIds)
    for (const id of ops) {
      const s = stages.find((x) => x.id === id)
      if (!s || (s.kind !== 'open' && s.kind !== 'awaiting_txn')) throw invalid('Solo una etapa abierta de este embudo puede ser de Operaciones.', 'Only an open stage of this pipeline can belong to Operations.')
    }
    await tx`update crm.pipelines set multi_open = ${flags.multiOpen}, has_items = ${flags.hasItems}, ops_lead_id = ${lead} where id = ${pipelineId}`
    await tx`update crm.stages set is_ops = (id = any(${[...ops]}::uuid[])) where pipeline_id = ${pipelineId}`
    await audit(tx, ctx, 'pipeline.ops_configured', 'pipeline', pipelineId, p.market_code,
      { multi_open: p.multi_open, has_items: p.has_items, ops_stages: stages.filter((s) => s.is_ops).map((s) => s.id), ...(lead !== p.ops_lead_id ? { ops_lead_id: p.ops_lead_id } : {}) },
      { multi_open: flags.multiOpen, has_items: flags.hasItems, ops_stages: [...ops], ...(lead !== p.ops_lead_id ? { ops_lead_id: lead } : {}) })
  })
}

const visitReasonInput = z.object({
  id: z.guid().or(z.literal('')).optional().default(''),
  market: z.string().length(2).or(z.literal('')).optional().default(''),
  labelEs: z.string().trim().min(2).max(80),
  labelEn: z.string().trim().min(2).max(80),
  campaign: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
})

/** Propósitos de visita (E12.F4): la lista la mantiene administración por mercado; los de campaña van marcados. */
export async function saveVisitReason(ctx: Ctx, raw: z.input<typeof visitReasonInput>): Promise<void> {
  ctx.assert('config.manage')
  const parsed = visitReasonInput.safeParse(raw)
  if (!parsed.success) throw invalid('Escribe el nombre en español y en inglés (2 a 80 letras).', 'Enter the name in Spanish and in English (2 to 80 characters).')
  const v = parsed.data
  assertNoProhibited(v.labelEs, v.labelEn)
  await withUser(ctx.user.id, async (tx) => {
    if (v.id) {
      const rows = await tx<{ market_code: string | null; code: string }[]>`update crm.visit_reasons set label_es = ${v.labelEs}, label_en = ${v.labelEn}, is_campaign = ${v.campaign}, is_active = ${v.active} where id = ${v.id} returning market_code, code`
      if (!rows[0]) throw notFound()
      await audit(tx, ctx, 'pipeline.visit_reason_updated', 'visit_reason', v.id, rows[0].market_code, null, { code: rows[0].code, label_es: v.labelEs, label_en: v.labelEn, campaign: v.campaign, active: v.active })
      return
    }
    if (!v.market) throw invalid('Elige el mercado.', 'Pick the market.')
    ctx.market(v.market)
    const code = slug(v.labelEn)
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(code)) throw invalid('El nombre en inglés empieza con una letra y lleva al menos dos letras o números.', 'The English name starts with a letter and needs at least two letters or numbers.')
    const clash = await tx`select 1 from crm.visit_reasons where coalesce(market_code, '') = ${v.market} and code = ${code}`
    if (clash[0]) throw invalid('Ya existe un propósito con ese nombre en este mercado.', 'There is already a purpose with that name in this market.')
    const pos = await tx<{ n: number }[]>`select coalesce(max(position), 0)::int + 1 as n from crm.visit_reasons where coalesce(market_code, '') = ${v.market}`
    const rows = await tx<{ id: string }[]>`insert into crm.visit_reasons (market_code, code, label_es, label_en, is_campaign, position) values (${v.market}, ${code}, ${v.labelEs}, ${v.labelEn}, ${v.campaign}, ${pos[0]!.n}) returning id`
    await audit(tx, ctx, 'pipeline.visit_reason_created', 'visit_reason', rows[0]!.id, v.market, null, { code, label_es: v.labelEs, campaign: v.campaign })
  })
}

export { isoDate }
