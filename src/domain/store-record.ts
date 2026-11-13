import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean, newId } from '@/domain/common'
import { DomainError, invalid, notFound } from '@/lib/errors'
import { assertNoProhibited } from '@/domain/guard'
import { PRODUCT_STATUSES, setAccountProduct } from '@/domain/gobierno'
import { captureTaxId } from '@/domain/markets'
import { protectedDataAdapter } from '@/server/adapters/markets'

// Ficha de la tienda de un mercado con ficha de dealer (épica E9): número de sitio, tipo de negocio, origen del comercio,
// reclutado por, Tax ID (últimos 4) y el portafolio de carriers. La base repite cada regla (0030_us_ficha).

export const MERCHANT_ORIGINS = ['new_acquisition', 'emida_conversion'] as const
export type MerchantOrigin = (typeof MERCHANT_ORIGINS)[number]
export const RECRUITER_KINDS = ['field_team', 'agency', 'partner'] as const
export type RecruiterKind = (typeof RECRUITER_KINDS)[number]

type Acc = { id: string; market_code: string; account_type: string; kind: string; site_ref: string | null; business_type: string | null; merchant_origin: string | null
  recruited_by: string | null; recruited_agency_id: string | null; retired_carriers: string | null; tax_id_last4: string | null }

async function load(tx: Tx, id: string): Promise<Acc> {
  const rows = await tx<(Acc & { archived_at: Date | null })[]>`
    select id, market_code, account_type, kind, site_ref, business_type, merchant_origin, recruited_by, recruited_agency_id, retired_carriers, tax_id_last4, archived_at
      from crm.accounts where id = ${id} for update`
  if (!rows[0] || rows[0].archived_at) throw notFound('No encontramos ese comercio.', 'We could not find that merchant.')
  return rows[0]
}

const REF = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/

/**
 * E9.F2, F4 y F8: número de sitio o terminal (lo llena Operaciones, junto al Merchant ID), tipo de negocio (solo dealers) y
 * los carriers que ya no están vigentes, como texto. Cada campo valida a quien lo cambia; lo que no cambia no pide permiso.
 */
export async function setStoreProfile(ctx: Ctx, accountId: string, input: { siteRef?: string; businessType?: string; retiredCarriers?: string }): Promise<void> {
  const site = input.siteRef === undefined ? undefined : clean(input.siteRef)
  const biz = input.businessType === undefined ? undefined : clean(input.businessType)
  const retired = input.retiredCarriers === undefined ? undefined : clean(input.retiredCarriers)
  if (site && !REF.test(site)) throw invalid('El número de sitio lleva letras, números, punto, guion o espacio, hasta 40 caracteres.', 'The site number takes letters, numbers, dot, hyphen or space, up to 40 characters.')
  if (retired && retired.length > 300) throw invalid('Carriers anteriores: hasta 300 letras.', 'Earlier carriers: up to 300 characters.')
  assertNoProhibited(site, retired)
  await withUser(ctx.user.id, async (tx) => {
    const a = await load(tx, accountId)
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (site !== undefined && site !== a.site_ref) {
      ctx.assert('account.products', a.market_code)
      before.site_ref = a.site_ref
      after.site_ref = site
    }
    if (retired !== undefined && retired !== a.retired_carriers) {
      ctx.assert('account.products', a.market_code)
      before.retired_carriers = a.retired_carriers
      after.retired_carriers = retired
    }
    if (biz !== undefined && biz !== a.business_type) {
      ctx.assert('account.edit', a.market_code)
      if (biz) {
        const takes = await tx<{ takes: boolean }[]>`
          select t.takes_business_type as takes from crm.account_types t where t.code = ${a.account_type} and (t.market_code is null or t.market_code = ${a.market_code})
           order by t.market_code nulls last limit 1`
        if (!takes[0]?.takes) throw invalid('El tipo de negocio es solo para dealers. En otras cuentas se queda vacío.', 'Business type is for dealers only. It stays empty on other accounts.')
        if (!(await tx`select 1 from crm.business_types where market_code = ${a.market_code} and code = ${biz} and is_active`)[0])
          throw invalid('Elige un tipo de negocio de la lista.', 'Pick a business type from the list.')
      }
      before.business_type = a.business_type
      after.business_type = biz
    }
    if (Object.keys(after).length === 0) return
    await tx`update crm.accounts set site_ref = ${'site_ref' in after ? (site ?? null) : a.site_ref}, retired_carriers = ${'retired_carriers' in after ? (retired ?? null) : a.retired_carriers},
              business_type = ${'business_type' in after ? (biz ?? null) : a.business_type} where id = ${accountId}`
    await audit(tx, ctx, 'account.store_profile_set', 'account', accountId, a.market_code, before, after)
  })
}

/** E9.F5: el origen del comercio se fija una vez. Los comercios nuevos ya nacen con él; aquí se fija en los que venían sin dato. */
export async function setMerchantOrigin(ctx: Ctx, accountId: string, origin: string): Promise<void> {
  if (!(MERCHANT_ORIGINS as readonly string[]).includes(origin)) throw invalid('Elige el origen: alta nueva o conversión de EMIDA.', 'Pick the origin: new acquisition or EMIDA conversion.')
  await withUser(ctx.user.id, async (tx) => {
    const a = await load(tx, accountId)
    ctx.assert('account.origin', a.market_code)
    if (a.merchant_origin) throw new DomainError('set_once', 'El origen de este comercio ya está fijado y no se cambia.', 'This merchant’s origin is already set and does not change.')
    await tx`update crm.accounts set merchant_origin = ${origin} where id = ${accountId}`
    await audit(tx, ctx, 'account.origin_set', 'account', accountId, a.market_code, null, { merchant_origin: origin })
  })
}

/** Quién reclutó: el equipo propio, o una agencia o socio del catálogo del mercado. Devuelve la forma que guarda la base. */
export async function resolveRecruiter(tx: Tx, market: string, value: string): Promise<{ kind: RecruiterKind; agencyId: string | null }> {
  if (value === 'field_team') return { kind: 'field_team', agencyId: null }
  if (!/^[0-9a-f-]{36}$/.test(value)) throw invalid('Elige quién reclutó la tienda.', 'Pick who recruited the store.')
  const rows = await tx<{ kind: RecruiterKind }[]>`select kind from crm.agencies where id = ${value} and market_code = ${market} and is_active`
  if (!rows[0]) throw invalid('Esa agencia no está activa en este mercado.', 'That agency is not active in this market.')
  return { kind: rows[0].kind, agencyId: value }
}

/** E9.F12: quién reclutó la tienda, fijo desde que se anota. Baja a los negocios de la tienda que no lo tenían (lo hace la base). */
export async function setRecruiter(ctx: Ctx, accountId: string, value: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const a = await load(tx, accountId)
    ctx.assert('account.recruiter', a.market_code)
    if (a.recruited_by) throw new DomainError('set_once', 'Quién reclutó esta tienda ya está fijado y no se cambia.', 'Who recruited this store is already set and does not change.')
    const r = await resolveRecruiter(tx, a.market_code, value)
    await tx`update crm.accounts set recruited_by = ${r.kind}, recruited_agency_id = ${r.agencyId} where id = ${accountId}`
    await audit(tx, ctx, 'account.recruiter_set', 'account', accountId, a.market_code, null, { recruited_by: r.kind, agency_id: r.agencyId })
  })
}

/**
 * E9.F13: el Tax ID se captura una vez en la tienda. CONTIGO guarda SOLO los últimos 4 (estándar DATA-06). Si la persona escribe
 * el número completo, se le dice que se guardaron los últimos 4: el completo pasa al resguardo de datos protegidos, que está
 * apagado (no se guarda ni sale a ningún lado). Vacío lo borra.
 */
export async function setTaxId(ctx: Ctx, accountId: string, raw: string): Promise<{ last4: string | null; full: boolean; vault: 'off' | 'simulated' | null }> {
  const value = raw.replace(/[\s.-]/g, '').toUpperCase()
  if (value && !/^[A-Z0-9]{4,20}$/.test(value)) throw invalid('Tax ID: escribe al menos los últimos 4 caracteres (letras y números).', 'Tax ID: enter at least the last 4 characters (letters and numbers).')
  const last4 = value ? value.slice(-4) : null
  const full = value.length > 4
  if (full) {
    // Un solo modelo de identificador fiscal (MULTI-03, paquete mercados): el número completo pasa por su validación en tres capas,
    // queda como últimos 4 y huella en crm.tax_ids y el valor sale al resguardo (apagado). Aquí solo se captura sin el número completo.
    const market = (await withUser(ctx.user.id, (tx) => load(tx, accountId))).market_code
    const r = await captureTaxId(ctx, accountId, { type: market === 'US' ? 'us_ein' : market === 'MX' ? 'mx_rfc' : 'other', value })
    return { last4: r.last4, full: true, vault: protectedDataAdapter().mode }
  }
  const out = await withUser(ctx.user.id, async (tx) => {
    const a = await load(tx, accountId)
    ctx.assert('account.edit', a.market_code)
    if (a.tax_id_last4 === last4 && !full) return false
    await tx`update crm.accounts set tax_id_last4 = ${last4} where id = ${accountId}`
    // La bitácora dice que cambió, nunca el número.
    await audit(tx, ctx, 'account.tax_id_set', 'account', accountId, a.market_code, { had: Boolean(a.tax_id_last4) }, { has: Boolean(last4), full_offered: full })
    return true
  })
  void out
  return { last4, full, vault: null }
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

/**
 * E9.F8 y F10: Operaciones mantiene, en la tienda, cada carrier con el que trabaja: estado y aprobación (con sus fechas, que
 * pone el cambio de estado), kit enviado, SIMs pedidas, el identificador que el carrier le dio y la capacitación.
 * Es el mismo registro que alimenta el estado por proveedor de un negocio (crm.account_products, sin producto).
 */
export async function setCarrierDetail(ctx: Ctx, accountId: string, input: { providerId: string; status: string; carrierRef?: string; kitSentOn?: string; simsOrdered?: string; trainingOn?: string; note?: string }): Promise<string> {
  if (!/^[0-9a-f-]{36}$/.test(input.providerId)) throw invalid('Elige el carrier.', 'Pick the carrier.')
  if (!(PRODUCT_STATUSES as readonly string[]).includes(input.status)) throw invalid('Elige un estado de la lista.', 'Pick a status from the list.')
  const ref = clean(input.carrierRef)
  const kit = clean(input.kitSentOn)
  const training = clean(input.trainingOn)
  const simsRaw = clean(input.simsOrdered)
  if (ref && ref.length > 60) throw invalid('El identificador del carrier lleva hasta 60 caracteres.', 'The carrier ID takes up to 60 characters.')
  if (kit && !isDay(kit)) throw invalid('Kit enviado: la fecha no es válida.', 'Kit sent: the date is not valid.')
  if (training && !isDay(training)) throw invalid('Capacitación: la fecha no es válida.', 'Training: the date is not valid.')
  const sims = simsRaw === null ? null : Number(simsRaw)
  if (sims !== null && (!Number.isInteger(sims) || sims < 0 || sims > 100000)) throw invalid('SIMs pedidas: un número entero de 0 a 100,000.', 'SIMs ordered: a whole number from 0 to 100,000.')
  assertNoProhibited(ref)
  // El estado y sus fechas pasan por el comando de siempre (permiso, proveedor del mercado, bitácora).
  const id = await setAccountProduct(ctx, accountId, { productId: '', providerId: input.providerId, status: input.status, note: input.note })
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; carrier_ref: string | null; kit_sent_on: string | null; sims_ordered: number | null; training_on: string | null }[]>`
      select market_code, carrier_ref, kit_sent_on::text, sims_ordered, training_on::text from crm.account_products where id = ${id} for update`
    const p = rows[0]
    if (!p) throw notFound()
    ctx.assert('account.products', p.market_code)
    if (p.carrier_ref === ref && p.kit_sent_on === kit && p.sims_ordered === sims && p.training_on === training) return
    await tx`update crm.account_products set carrier_ref = ${ref}, kit_sent_on = ${kit}::date, sims_ordered = ${sims}, training_on = ${training}::date, updated_by = ${ctx.user.id}, updated_at = now() where id = ${id}`
    await audit(tx, ctx, 'account.carrier_detail_set', 'account', accountId, p.market_code,
      { carrier_ref: p.carrier_ref, kit_sent_on: p.kit_sent_on, sims_ordered: p.sims_ordered, training_on: p.training_on },
      { provider_id: input.providerId, carrier_ref: ref, kit_sent_on: kit, sims_ordered: sims, training_on: training })
  })
  return id
}

/** Cómo se llama el identificador que un carrier le da a cada tienda (por ejemplo "TMO ID"). Lo define administración. */
export async function setProviderRefLabel(ctx: Ctx, providerId: string, label: string): Promise<void> {
  ctx.assert('config.manage')
  const value = clean(label)
  if (value && (value.length < 2 || value.length > 40)) throw invalid('El nombre del identificador lleva de 2 a 40 letras.', 'The ID name takes 2 to 40 characters.')
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string | null; ref_label: string | null; code: string }[]>`select market_code, ref_label, code from crm.ops_catalog where id = ${providerId} and kind = 'provider' for update`
    if (!rows[0]) throw notFound()
    if (rows[0].ref_label === value) return
    await tx`update crm.ops_catalog set ref_label = ${value} where id = ${providerId}`
    await audit(tx, ctx, 'account.carrier_label_set', 'ops_catalog', providerId, rows[0].market_code, { ref_label: rows[0].ref_label }, { code: rows[0].code, ref_label: value })
  })
}

// ---------------------------------------------------------------- agencias y socios que reclutan

/**
 * Alta de una agencia o socio que recluta. Es la única: la usan Datos > Catálogos (la pantalla que edita agencias) y las
 * pruebas de Seguridad. Embudo y región son opcionales (E4.F4): si se fijan, lo que crea su gente nace ahí.
 */
export async function createAgency(ctx: Ctx, input: { market: string; kind: string; name: string; pipelineId?: string; territoryId?: string }): Promise<string> {
  const name = input.name.trim()
  if (input.kind !== 'agency' && input.kind !== 'partner') throw invalid('Elige si es una agencia u otro socio.', 'Pick whether it is an agency or another partner.')
  if (name.length < 2 || name.length > 80) throw invalid('Nombre: de 2 a 80 letras.', 'Name: 2 to 80 characters.')
  ctx.assert('agency.manage', input.market)
  ctx.market(input.market)
  assertNoProhibited(name)
  return withUser(ctx.user.id, async (tx) => {
    if ((await tx`select 1 from crm.agencies where market_code = ${input.market} and lower(btrim(name)) = lower(${name})`)[0])
      throw invalid('Ya hay una agencia o socio con ese nombre en este mercado.', 'There is already an agency or partner with that name in this market.')
    const pipelineId = input.pipelineId || null
    const territoryId = input.territoryId || null
    if (pipelineId && !(await tx`select 1 from crm.pipelines where id::text = ${pipelineId} and market_code = ${input.market}`)[0]) throw invalid('Ese embudo es de otro mercado.', 'That pipeline belongs to another market.')
    if (territoryId && !(await tx`select 1 from crm.territories where id::text = ${territoryId} and market_code = ${input.market}`)[0]) throw invalid('Ese territorio es de otro mercado.', 'That territory belongs to another market.')
    const id = await newId(tx)
    await tx`insert into crm.agencies (id, market_code, kind, name, pipeline_id, territory_id, created_by) values (${id}, ${input.market}, ${input.kind}, ${name}, ${pipelineId}, ${territoryId}, ${ctx.user.id})`
    await audit(tx, ctx, 'team.agency_created', 'agency', id, input.market, null, { kind: input.kind, name, pipeline_id: pipelineId, territory_id: territoryId })
    return id
  })
}

/** Dar de baja una agencia la quita de las listas; las tiendas que reclutó la conservan. */
export async function setAgencyActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; is_active: boolean; name: string }[]>`select market_code, is_active, name from crm.agencies where id = ${id} for update`
    const g = rows[0]
    if (!g) throw notFound()
    ctx.assert('agency.manage', g.market_code)
    if (g.is_active === active) return
    await tx`update crm.agencies set is_active = ${active} where id = ${id}`
    await audit(tx, ctx, active ? 'team.agency_restored' : 'team.agency_retired', 'agency', id, g.market_code, { is_active: g.is_active }, { is_active: active, name: g.name })
  })
}
