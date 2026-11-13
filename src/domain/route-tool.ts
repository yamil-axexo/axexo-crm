import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import type { ApiKey } from '@/dal/api-v1'
import { routeStoresOf } from '@/dal/routes'
import { audit } from '@/domain/common'
import { scrub } from '@/domain/pipedrive/mapping'
import { markUntrusted, plainText } from '@/domain/untrusted'
import { DomainError, invalid } from '@/lib/errors'

/**
 * E5.F6: contrato con la herramienta de rutas (docs/contracts/route-tool-v1.md, propuesta).
 * - Lectura: GET /api/v1/routes/stores?owner_email=… (permiso accounts:read): las tiendas que lleva esa persona en el mercado
 *   de la llave, con nombre, dirección, contacto, productos aprobados y desempeño reciente.
 * - Vuelta: POST /api/v1/routes/checkins (permiso events:write): el check-in en una tienda entra como visita en su hilo.
 * La herramienta todavía no está conectada (adaptador `routes`, apagado); el contrato se prueba con estas formas.
 */
export const routeStoreOut = z.object({
  account_id: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  locality: z.string().nullable(),
  region: z.string().nullable(),
  postal_code: z.string().nullable(),
  phone: z.string().nullable(),
  contact: z.string().nullable(),
  merchant_ref: z.string().nullable(),
  approved_products: z.array(z.string()),
  performance: z.object({
    txn_count_30d: z.number().int().nullable(),
    activations_mtd: z.number().int().nullable(),
    activations_prev_month: z.number().int().nullable(),
    sales_as_of: z.string().nullable(),
    last_visit_on: z.string().nullable(),
  }),
})
export const routeStoresOut = z.object({ owner_email: z.string(), market: z.string(), data: z.array(routeStoreOut) })

export const routeCheckin = z.object({
  checkin_id: z.string().min(8).max(80).regex(/^[A-Za-z0-9._:-]+$/),
  account_id: z.string().uuid(),
  owner_email: z.string().email(),
  checked_in_at: z.string().datetime({ offset: true }),
  checked_out_at: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
})
export type RouteCheckin = z.infer<typeof routeCheckin>

async function ownerIn(tx: Tx, email: string, market: string): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    select u.id from crm.users u where u.email = ${email.toLowerCase()} and u.is_active
       and exists (select 1 from crm.memberships m where m.user_id = u.id and (m.market_code = ${market} or m.market_code is null) and (m.valid_to is null or m.valid_to > now()))`
  if (!rows[0]) throw new DomainError('not_found', 'No hay una persona activa con ese correo en el mercado de la llave.', 'There is no active person with that email in the key’s market.', 404)
  return rows[0].id
}

/** La lista de tiendas de una persona, como la lee la herramienta de rutas. */
export async function readRouteStores(key: ApiKey, params: URLSearchParams): Promise<z.infer<typeof routeStoresOut>> {
  const market = key.market
  if (!market || !key.createdBy) throw new DomainError('forbidden', 'La llave no tiene mercado.', 'The key has no market.', 403)
  const email = params.get('owner_email') ?? ''
  if (!z.string().email().safeParse(email).success) throw invalid('Falta owner_email.', 'owner_email is missing.')
  if (key.mode === 'test') return { owner_email: email, market, data: [] }
  return withUser(key.createdBy, async (tx) => {
    const reach = await tx`select 1 from crm.users u where u.id = app.current_user_id() and u.is_active and ${market} = any(app.my_markets())`
    if (!reach[0]) throw new DomainError('forbidden', 'Quien creó la llave ya no tiene acceso a ese mercado.', 'The key’s creator no longer has access to that market.', 403)
    const owner = await ownerIn(tx, email, market)
    const stores = await routeStoresOf(tx, market, owner)
    return {
      owner_email: email, market,
      data: stores.map((s) => ({
        account_id: s.account_id, name: s.name, address: s.address, locality: s.locality, region: s.region, postal_code: s.postal_code,
        phone: s.phone, contact: s.contact, merchant_ref: s.merchant_ref, approved_products: s.approved_products,
        performance: { txn_count_30d: s.txn_count_30d, activations_mtd: s.activations_mtd, activations_prev_month: s.activations_prev_month, sales_as_of: s.sales_as_of, last_visit_on: s.last_visit_on },
      })),
    }
  })
}

export type CheckinResult = { status: 'processed' | 'duplicate'; visit_id?: string }

/** El check-in que devuelve la herramienta de rutas: una visita abierta (sin resultado de venta) en el hilo de la tienda. */
export async function ingestRouteCheckin(sys: Ctx, raw: unknown): Promise<CheckinResult> {
  const v = routeCheckin.safeParse(raw)
  if (!v.success) throw invalid('El check-in no cumple el contrato route_tool v1.', 'The check-in does not match route_tool v1.')
  const c = v.data
  return withUser(sys.user.id, async (tx) => {
    const acc = (await tx<{ id: string; market_code: string; owner_id: string | null }[]>`
      select id, market_code, owner_id from crm.accounts where id = ${c.account_id} and archived_at is null`)[0]
    if (!acc) throw new DomainError('not_found', 'La tienda no existe.', 'The store does not exist.', 404)
    const user = (await tx<{ id: string }[]>`select id from crm.users where email = ${c.owner_email.toLowerCase()} and is_active`)[0]
    const ev = await tx<{ id: string }[]>`
      insert into crm.inbound_events (source, event_type, idempotency_key, market_code, payload)
      values ('route_tool', 'route.checked_in', ${c.checkin_id}, ${acc.market_code}, ${tx.json(c as never)})
      on conflict (source, idempotency_key) do nothing returning id`
    if (!ev[0]) return { status: 'duplicate' }
    const note = c.note ? scrub(plainText(c.note)) : null
    const day = (await tx<{ d: string }[]>`select (${c.checked_in_at}::timestamptz at time zone m.timezone)::date::text as d from crm.markets m where m.code = ${acc.market_code}`)[0]!.d
    const visit = await tx<{ id: string }[]>`
      insert into crm.visits (market_code, account_id, external_visit_id, salesperson_ref, user_id, business_date, checked_in_at, checked_out_at,
                              outcome, revisit, auto_closed, note, inbound_event_id)
      values (${acc.market_code}, ${acc.id}, ${'route:' + c.checkin_id}, ${c.owner_email.toLowerCase()}, ${user?.id ?? null}, ${day}, ${c.checked_in_at},
              ${c.checked_out_at ?? null}, 'open', false, false, ${note}, ${ev[0].id})
      on conflict (external_visit_id) do nothing returning id`
    if (visit[0] && note) await markUntrusted(tx, 'visit', visit[0].id, acc.market_code, 'route_tool', ['note'])
    await tx`update crm.inbound_events set status = 'processed', processed_at = now() where id = ${ev[0].id}`
    await audit(tx, sys, 'integration.route_checkin', 'account', acc.id, acc.market_code, null, { checkin_id: c.checkin_id })
    return { status: 'processed', visit_id: visit[0]?.id }
  })
}
