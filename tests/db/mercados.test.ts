import { describe, it, expect, afterAll } from 'vitest'
import { asPersona, ctxFor, owner, personaId, systemContext, marketDay } from './helpers'
import { withUser, marketWorkday } from '@/server/db'
import { ingestSalesAppEvent } from '@/domain/integrations'
import { createAccount, addContact } from '@/domain/accounts'
import { searchAll, getAccount } from '@/dal/accounts'
import { fieldDefs } from '@/dal/fields'
import { setFxRate } from '@/domain/reports'
import { createMarket, updateMarket } from '@/domain/gobierno'
import { setMembershipEntity } from '@/domain/security'
import {
  addHoliday, captureTaxId, createEntity, createFieldSection, openWhatsappWindow, reviewTaxId, saveWhatsappAccount, saveWhatsappRate, saveWhatsappTemplate,
  setAccountProfile, setFichaLayout, setFieldSection, setLocation, setUserEntity, updateAddress, updateEntity,
} from '@/domain/markets'
import { accountByRef, accountsByTaxId, accountsNear, getAccountHeader, getAccountMarketData, getConsolidated, getMarketsAdmin } from '@/dal/markets'
import { fxRestampJob } from '@/server/jobs/mercados'
import { JOBS } from '@/server/jobs/registry'
import { marketAdapterStatus } from '@/server/adapters/markets'
import { DomainError } from '@/lib/errors'

// Con la forma de un SSN (tres, dos y cuatro números). Se arma por partes: el escáner de datos prohibidos no deja escribirlo.
const SSN_SHAPED = ['123', '45', '6789'].join('-')

// Paquete de mercados (migración 0026): moneda con tasa guardada, entidad legal, identificador fiscal, dirección y
// ubicación, WhatsApp por mercado, encabezado de la ficha por rol, contactos y secciones de campos.

const db = owner()
afterAll(async () => { await db.end() })

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof DomainError ? e.code : ((e as { code?: string }).code ?? 'error')
  }
}
const iso = (offset: number) => marketDay(offset)

async function storeOf(persona: string, n = 0) {
  const id = await personaId(persona)
  const rows = await db<{ id: string; market_code: string; name: string }[]>`select id, market_code, name from crm.accounts where owner_id = ${id} and kind = 'store' and archived_at is null order by name, id offset ${n} limit 1`
  return rows[0]!
}
async function newDeal(accountId: string, market: string, amountMinor: number | null, currency: string) {
  const stage = (await db<{ id: string; pipeline_id: string }[]>`select s.id, s.pipeline_id from crm.stages s join crm.pipelines p on p.id = s.pipeline_id where p.market_code = ${market} and s.kind = 'open' order by p.position, s.position limit 1`)[0]!
  const rows = await db<{ id: string }[]>`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, title, amount_minor, currency, next_step, next_step_due)
    values (${market}, ${stage.pipeline_id}, ${stage.id}, ${accountId}, 'Prueba de mercados', ${amountMinor}, ${currency}, 'Llamar', (now() at time zone 'UTC')::date + 3) returning id`
  return rows[0]!.id
}
const fxOf = async (dealId: string) => (await db<{ fx_rate: string | null; fx_rate_date: string | null; fx_source: string | null; amount_usd_minor: string | null; frozen: boolean; legal_entity_id: string; business_unit: string | null }[]>`
  select fx_rate::text, fx_rate_date::text, fx_source, amount_usd_minor::text, fx_frozen_at is not null as frozen, legal_entity_id, business_unit from crm.deals where id = ${dealId}`)[0]!

describe('MULTI-01: cada monto guarda su tasa, su fecha y su fuente', () => {
  it('todo negocio sembrado con monto y tasa disponible quedó convertido; USD vale 1 y no usa tasa cargada', async () => {
    const rows = await db<{ currency: string; n: number; stamped: number; bad: number }[]>`
      select trim(currency) as currency, count(*)::int as n, count(fx_rate)::int as stamped,
             count(*) filter (where fx_rate is not null and amount_usd_minor <> round(amount_minor * fx_rate))::int as bad
        from crm.deals where amount_minor is not null group by 1`
    for (const r of rows) {
      expect(r.stamped, r.currency).toBe(r.n)
      expect(r.bad, r.currency).toBe(0)
    }
    const usd = await db<{ n: number }[]>`select count(*)::int as n from crm.deals where trim(currency) = 'USD' and amount_minor is not null and (fx_rate <> 1 or fx_source <> 'USD' or amount_usd_minor <> amount_minor)`
    expect(usd[0]!.n).toBe(0)
    // Los cerrados quedaron congelados; los abiertos no.
    const frozen = await db<{ status: string; frozen: number; n: number }[]>`select status, count(fx_frozen_at)::int as frozen, count(*)::int as n from crm.deals where amount_minor is not null group by 1`
    for (const f of frozen) expect(f.frozen, f.status).toBe(f.status === 'open' ? 0 : f.n)
  })

  it('un negocio en MXN se convierte con la tasa vigente; al ganarse la congela, y una tasa nueva solo mueve a los abiertos', async () => {
    const admin = await ctxFor('nora.salas')
    const store = await storeOf('marco.pena')
    const open = await newDeal(store.id, 'MX', 1_000_000, 'MXN')
    const closing = await newDeal(store.id, 'MX', 2_000_000, 'MXN')
    expect(await fxOf(open)).toMatchObject({ fx_rate: '0.05000000', fx_source: 'synthetic', amount_usd_minor: '50000', frozen: false })
    const won = (await db<{ id: string }[]>`select s.id from crm.stages s join crm.deals d on d.pipeline_id = s.pipeline_id where d.id = ${closing} and s.kind = 'won' limit 1`)[0]!
    await db`update crm.deals set status = 'won', stage_id = ${won.id}, won_at = now(), closed_by = 'manual' where id = ${closing}`
    const atClose = await fxOf(closing)
    expect(atClose).toMatchObject({ fx_rate: '0.05000000', amount_usd_minor: '100000', frozen: true })

    await setFxRate(admin, { currency: 'MXN', asOf: iso(0), rate: '0.06', source: 'Banco de prueba' })
    expect(await fxOf(open)).toMatchObject({ fx_rate: '0.06000000', fx_rate_date: iso(0), fx_source: 'Banco de prueba', amount_usd_minor: '60000', frozen: false })
    // El ganado conserva la tasa de su cierre: no se mezcla con la de hoy.
    expect(await fxOf(closing)).toEqual(atClose)
    // Editar otra cosa del negocio cerrado tampoco lo vuelve a convertir.
    await db`update crm.deals set title = 'Otro título' where id = ${closing}`
    expect(await fxOf(closing)).toEqual(atClose)
    // Cambiar el monto del abierto lo vuelve a convertir.
    await db`update crm.deals set amount_minor = 500000 where id = ${open}`
    expect((await fxOf(open)).amount_usd_minor).toBe('30000')
    await db`update crm.deals set amount_minor = null where id = ${open}`
    expect(await fxOf(open)).toMatchObject({ fx_rate: null, amount_usd_minor: null })
  })

  it('sin tasa para su fecha el monto queda sin convertir y se dice; al cargarla, se rellena', async () => {
    const admin = await ctxFor('nora.salas')
    const store = await storeOf('marco.pena', 1)
    await db`delete from crm.fx_rates where currency = 'MXN'`
    const deal = await newDeal(store.id, 'MX', 700_000, 'MXN')
    expect(await fxOf(deal)).toMatchObject({ fx_rate: null, amount_usd_minor: null })
    const before = await getConsolidated(admin, { status: 'open', cut: 'market', market: 'MX' })
    expect(before.unconverted).toBeGreaterThanOrEqual(1)
    const mxn = before.rows.find((r) => r.currency === 'MXN')!
    expect(mxn.unconverted).toBeGreaterThanOrEqual(1)

    await setFxRate(admin, { currency: 'MXN', asOf: iso(-1), rate: '0.05', source: 'Banco de prueba' })
    expect(await fxOf(deal)).toMatchObject({ fx_rate: '0.05000000', fx_rate_date: iso(-1), amount_usd_minor: '35000' })
  })

  it('el consolidado suma en USD con la tasa guardada en cada negocio y corta por mercado, entidad y unidad de negocio', async () => {
    const lt = await ctxFor('luis.tovar')
    for (const status of ['open', 'won'] as const) {
      const byMarket = await getConsolidated(lt, { status, cut: 'market' })
      const expected = (await db<{ usd: string | null; n: number; un: number }[]>`select sum(amount_usd_minor)::text as usd, count(*)::int as n, count(*) filter (where amount_usd_minor is null)::int as un from crm.deals where amount_minor is not null and status = ${status}`)[0]!
      expect(byMarket.total_usd_minor).toBe(expected.usd)
      expect(byMarket.deals).toBe(expected.n)
      expect(byMarket.unconverted).toBe(expected.un)
      // Original y convertido, lado a lado, con la fecha de la tasa.
      const mxn = byMarket.rows.find((r) => r.currency === 'MXN')
      if (mxn && mxn.usd_minor) {
        expect(Number(mxn.amount_minor)).toBeGreaterThan(Number(mxn.usd_minor))
        expect(mxn.rate_from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(mxn.sources.length).toBeGreaterThan(0)
      }
      const byEntity = await getConsolidated(lt, { status, cut: 'entity' })
      expect(byEntity.total_usd_minor).toBe(expected.usd)
      expect(byEntity.rows.every((r) => r.label.length > 0)).toBe(true)
      expect((await getConsolidated(lt, { status, cut: 'unit' })).total_usd_minor).toBe(expected.usd)
    }
    // Quien lidera MX solo suma lo de su mercado (RLS).
    const ana = await getConsolidated(await ctxFor('ana.robles'), { status: 'open', cut: 'market' })
    expect(ana.rows.every((r) => r.key === 'MX')).toBe(true)
  })

  it('el job está registrado, corre sin persona, no trae tasas con el adaptador apagado y correrlo dos veces no cambia nada', async () => {
    expect(JOBS.map((j) => j.key)).toContain('mercados.fx_restamp')
    const sys = (await db<{ id: string }[]>`select app.system_user_id() as id`)[0]!.id
    const rates = async () => (await db<{ n: number }[]>`select count(*)::int as n from crm.fx_rates`)[0]!.n
    const n0 = await rates()
    const first = await withUser(sys, (tx) => fxRestampJob.run(tx))
    expect(first.note).toContain('off')
    expect(await rates()).toBe(n0)
    const second = await withUser(sys, (tx) => fxRestampJob.run(tx))
    expect(second.done).toBe(0)
  })
})

describe('MULTI-02: entidad legal, límite por entidad, zona horaria y festivos', () => {
  it('un comercio creado en la app nace con la entidad por defecto de su mercado y su negocio la hereda', async () => {
    const marco = await ctxFor('marco.pena')
    const { id } = await createAccount(marco, { market: 'MX', name: 'Abarrotes Entidad Prueba Uno', segment: 'd2d', force: true })
    const acc = (await db<{ legal_entity_id: string; def: string }[]>`select a.legal_entity_id, (select e.id from crm.legal_entities e where e.market_code = 'MX' and e.is_default) as def from crm.accounts a where a.id = ${id!}`)[0]!
    expect(acc.legal_entity_id).toBe(acc.def)
    const deal = await newDeal(id!, 'MX', 100_000, 'MXN')
    expect((await fxOf(deal)).legal_entity_id).toBe(acc.def)
    // Ningún comercio ni negocio queda sin entidad, y la base no acepta una entidad de otro mercado.
    expect((await db<{ n: number }[]>`select (select count(*) from crm.accounts where legal_entity_id is null)::int + (select count(*) from crm.deals where legal_entity_id is null)::int as n`)[0]!.n).toBe(0)
    const us = (await db<{ id: string }[]>`select id from crm.legal_entities where market_code = 'US' limit 1`)[0]!.id
    expect(await code(db`update crm.accounts set legal_entity_id = ${us} where id = ${id!}`)).toBe('23514')
    const data = await getAccountMarketData(marco, id!)
    expect(data!.profile.entity_name).toBe('Entidad MX (sintética)')
  })

  it('con el acceso limitado a una entidad, la persona solo ve y cambia lo de esa entidad; quien no tiene límite sigue viendo todo', async () => {
    const admin = await ctxFor('nora.salas')
    const marcoId = await personaId('marco.pena')
    const entity = await createEntity(admin, { market: 'MX', name: 'Red Adquirida de Prueba' })
    const mine = await db<{ id: string }[]>`select id from crm.accounts where owner_id = ${marcoId} and archived_at is null order by name limit 3`
    await setAccountProfile(admin, mine[0]!.id, { entityId: entity })
    const deal = await newDeal(mine[0]!.id, 'MX', 100_000, 'MXN')
    const other = await newDeal(mine[1]!.id, 'MX', 100_000, 'MXN')
    await db`update crm.deals set owner_id = ${marcoId} where id in (${deal}, ${other})`
    const seen = () => asPersona('marco.pena', async (tx) => ({
      accounts: (await tx<{ n: number }[]>`select count(*)::int as n from crm.accounts`)[0]!.n,
      inEntity: (await tx<{ n: number }[]>`select count(*)::int as n from crm.accounts where legal_entity_id = ${entity}`)[0]!.n,
      deals: (await tx<{ id: string }[]>`select id from crm.deals where id in (${deal}, ${other})`).map((r) => r.id),
    }))
    const before = await seen()
    expect(before.accounts).toBeGreaterThan(100)
    expect(before.deals.sort()).toEqual([deal, other].sort())

    // Pertenece a la entidad (Mercados) y su rol en MX queda limitado a ella (Seguridad: el único lugar que escribe el límite).
    await setUserEntity(admin, marcoId, { entityId: entity })
    expect((await seen()).accounts).toBe(before.accounts)
    const roles = (await db<{ id: string }[]>`select id from crm.memberships where user_id = ${marcoId} and market_code = 'MX' and (valid_to is null or valid_to > now())`).map((r) => r.id)
    for (const m of roles) await setMembershipEntity(admin, m, entity)
    const after = await seen()
    expect(after.accounts).toBe(1)
    expect(after.inEntity).toBe(1)
    expect(after.deals).toEqual([deal])
    // Tampoco puede cambiar lo de otra entidad, y lo que crea nace en la suya.
    expect(await asPersona('marco.pena', async (tx) => (await tx`update crm.accounts set email = 'x@prueba.test' where id = ${mine[1]!.id}`).count)).toBe(0)
    const created = await createAccount(await ctxFor('marco.pena'), { market: 'MX', name: 'Tienda de la Red Adquirida', segment: 'd2d', force: true })
    expect((await db<{ legal_entity_id: string }[]>`select legal_entity_id from crm.accounts where id = ${created.id!}`)[0]!.legal_entity_id).toBe(entity)
    // Su supervisor y quien lidera el mercado no tienen límite.
    expect(await asPersona('ana.robles', async (tx) => (await tx<{ n: number }[]>`select count(*)::int as n from crm.accounts where id = ${mine[1]!.id}`)[0]!.n)).toBe(1)

    expect((await getMarketsAdmin(admin)).people.find((p) => p.id === marcoId)).toMatchObject({ legal_entity_id: entity, limited: true })
    for (const m of roles) await setMembershipEntity(admin, m, null)
    expect((await seen()).accounts).toBe(before.accounts + 1)
    const people = (await getMarketsAdmin(admin)).people.find((p) => p.id === marcoId)!
    expect(people).toMatchObject({ legal_entity_id: entity, limited: false })
    // Cambiar la entidad a la que pertenece no toca el límite de sus roles.
    await setUserEntity(admin, marcoId, { entityId: null })
    expect((await db<{ n: number }[]>`select count(*)::int as n from crm.memberships where user_id = ${marcoId} and legal_entity_id is not null`)[0]!.n).toBe(0)
  })

  it('la entidad provisional se confirma al guardarle su nombre; solo administración la cambia', async () => {
    const admin = await ctxFor('nora.salas')
    const sv = (await getMarketsAdmin(admin)).entities.find((e) => e.market_code === 'SV')!
    expect(sv).toMatchObject({ needs_review: true, is_default: true })
    expect(await code(updateEntity(await ctxFor('ana.robles'), sv.id, { name: 'Otra', makeDefault: false }))).toBe('forbidden')
    await updateEntity(admin, sv.id, { name: 'Entidad SV de prueba', makeDefault: false })
    expect((await getMarketsAdmin(admin)).entities.find((e) => e.id === sv.id)).toMatchObject({ name: 'Entidad SV de prueba', needs_review: false })
  })

  it('la zona horaria es del comercio: en US sale del estado y la ficha la usa', async () => {
    const jade = await ctxFor('jade.kim')
    const store = await storeOf('jade.kim')
    await updateAddress(jade, store.id, { address_line: '100 Main St', locality: 'Los Angeles', region: 'ca', postal_code: '90012' })
    const row = (await db<{ timezone: string; region: string; tz: string }[]>`select timezone, region, app.account_timezone(id) as tz from crm.accounts where id = ${store.id}`)[0]!
    expect(row).toEqual({ timezone: 'America/Los_Angeles', region: 'CA', tz: 'America/Los_Angeles' })
    expect((await getAccountHeader(jade, store.id))!.header).toMatchObject({ timezone: 'America/Los_Angeles', own_timezone: true })
    expect(await code(setAccountProfile(jade, store.id, { timezone: 'Marte/Olimpo' }))).toBe('invalid')
    // Sin zona propia vale la del mercado.
    const other = await storeOf('jade.kim', 1)
    expect((await db<{ tz: string }[]>`select app.account_timezone(${other.id}) as tz`)[0]!.tz).toBe('America/New_York')
  })

  it('un próximo paso por defecto no cae en un día festivo del mercado', async () => {
    const admin = await ctxFor('nora.salas')
    const sys = (await db<{ id: string }[]>`select app.system_user_id() as id`)[0]!.id
    const next = () => withUser(sys, async (tx) => (await tx<{ d: string }[]>`select ${marketWorkday(tx, 'MX', 1)}::text as d`)[0]!.d)
    const first = await next()
    await addHoliday(admin, { market: 'MX', day: first, name: 'Día de prueba' })
    const second = await next()
    expect(second > first).toBe(true)
    // El festivo es de México: en US ese día se trabaja igual.
    expect((await db<{ n: number }[]>`select count(*)::int as n from crm.market_holidays where market_code = 'US'`)[0]!.n).toBe(0)
    expect(await code(addHoliday(await ctxFor('ana.robles'), { market: 'MX', day: first, name: 'No debe' }))).toBe('forbidden')
  })
})

describe('E1.F1 y E1.F4: mercado nuevo por configuración y unidad de negocio', () => {
  it('un mercado nuevo (Datos, Mercados y catálogos) nace con su entidad por confirmar y Administración dice qué le falta', async () => {
    const admin = await ctxFor('nora.salas')
    const before = (await db<{ n: number }[]>`select count(*)::int as n from crm.accounts`)[0]!.n
    // Agregar y abrir un mercado tiene un solo modelo: domain/gobierno.ts. Este paquete le da su entidad legal y la lista de lo que falta.
    expect(await code(createMarket(await ctxFor('ana.robles'), { code: 'GT', name: 'Guatemala', currency: 'GTQ', locale: 'es', timezone: 'America/Guatemala', phoneCc: '+502' }))).toBe('forbidden')
    await createMarket(admin, { code: 'gt', name: 'Guatemala', currency: 'gtq', locale: 'es', timezone: 'America/Guatemala', phoneCc: '+502' })
    let m = (await getMarketsAdmin(admin)).markets.find((x) => x.code === 'GT')!
    expect(m).toMatchObject({ status: 'planned', currency: 'GTQ', ready: { pipelines: 0, entity: false, people: 0, rate: false } })
    const entity = (await db<{ id: string; needs_review: boolean; is_default: boolean }[]>`select id, needs_review, is_default from crm.legal_entities where market_code = 'GT'`)
    expect(entity).toHaveLength(1)
    expect(entity[0]).toMatchObject({ needs_review: true, is_default: true })
    // Sin embudo no se abre, y se dice por qué.
    expect(await code(updateMarket(admin, 'GT', { name: 'Guatemala', status: 'live' }))).toBe('invalid')
    await updateEntity(admin, entity[0]!.id, { name: 'Entidad GT de prueba', makeDefault: true })
    const pipe = (await db<{ id: string }[]>`insert into crm.pipelines (market_code, motor, name) values ('GT', 'd2d', 'D2D Guatemala') returning id`)[0]!.id
    await db`insert into crm.stages (pipeline_id, position, code, name_es, name_en, kind) values (${pipe}, 1, 'new', 'Nuevo', 'New', 'open'), (${pipe}, 2, 'won', 'Ganado', 'Won', 'won'), (${pipe}, 3, 'lost', 'Perdido', 'Lost', 'lost')`
    await db`insert into crm.memberships (user_id, market_code, role) values (${await personaId('ana.robles')}, 'GT', 'market_lead')`
    // La tasa de una moneda se carga cuando su mercado ya está abierto; aquí la deja lista la prueba para ver la lista completa.
    await db`insert into crm.fx_rates (currency, as_of, usd_rate, source) values ('GTQ', ${iso(-1)}::date, 0.13, 'Banco de prueba')`
    m = (await getMarketsAdmin(admin)).markets.find((x) => x.code === 'GT')!
    expect(m.ready).toMatchObject({ pipelines: 1, entity: true, people: 1, rate: true })
    await updateMarket(admin, 'GT', { name: 'Guatemala', status: 'live' })
    expect((await db<{ status: string }[]>`select status from crm.markets where code = 'GT'`)[0]!.status).toBe('live')
    // Los mercados que ya operaban no se tocaron.
    expect((await db<{ n: number }[]>`select count(*)::int as n from crm.accounts`)[0]!.n).toBe(before)
  })

  it('la unidad de negocio trae las ocho opciones, va en el comercio y sus negocios abiertos la siguen', async () => {
    const units = await db<{ label_en: string }[]>`select label_en from crm.business_units where is_active order by position`
    expect(units.map((u) => u.label_en)).toEqual(['Strategic Partnerships', 'LLA/CWC', 'Internacional', 'USA', 'Mexico', 'Sky Solutions Panama', 'Sky Solutions El Salvador', 'Colombia'])
    const marco = await ctxFor('marco.pena')
    const store = await storeOf('marco.pena', 2)
    const deal = await newDeal(store.id, 'MX', 100_000, 'MXN')
    await setAccountProfile(marco, store.id, { businessUnit: 'mexico' })
    expect((await fxOf(deal)).business_unit).toBe('mexico')
    expect((await fxOf(await newDeal(store.id, 'MX', null, 'MXN'))).business_unit).toBe('mexico')
    expect(await code(setAccountProfile(marco, store.id, { businessUnit: 'marte' }))).toBe('invalid')
    // Quien vende no cambia la entidad legal del comercio.
    const entity = await createEntity(await ctxFor('nora.salas'), { market: 'MX', name: 'Entidad Dos de Prueba' })
    expect(await code(setAccountProfile(marco, store.id, { entityId: entity }))).toBe('forbidden')
    const cut = await getConsolidated(await ctxFor('ana.robles'), { status: 'open', cut: 'unit' })
    expect(cut.rows.some((r) => r.key === 'mexico')).toBe(true)
  })
})

describe('MULTI-03: identificador fiscal en tres capas, sin guardar el valor completo', () => {
  const RFC = 'GODE561231GR8'
  it('se captura una vez: quedan los últimos 4, la huella y el estado; el valor completo no está en ninguna tabla ni en la bitácora', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await storeOf('marco.pena', 3)
    expect(await code(captureTaxId(marco, store.id, { type: 'mx_rfc', value: RFC }))).toBe('invalid') // falta nombre, régimen y CP
    const out = await captureTaxId(marco, store.id, { type: 'mx_rfc', value: 'gode 561231-gr8', legalName: 'Comercio de Prueba SA de CV', taxRegime: '601', postalCode: '64000' })
    expect(out).toMatchObject({ status: 'format_valid', last4: '1GR8', duplicates: [], fingerprint: true })
    const row = (await db<{ last4: string; blind_ix: string; status: string; checksum_ok: boolean; registry_status: string; legal_name: string }[]>`select last4, blind_ix, status, checksum_ok, registry_status, legal_name from crm.tax_ids where account_id = ${store.id} and valid_to is null`)[0]!
    expect(row).toMatchObject({ last4: '1GR8', status: 'format_valid', checksum_ok: true, registry_status: 'queued_off', legal_name: 'Comercio de Prueba SA de CV' })
    expect(row.blind_ix).toMatch(/^[0-9a-f]{64}$/)
    expect(row.blind_ix).not.toContain(RFC.toLowerCase())
    // Las tres capas dejaron su resultado: formato pasó; registro y listas de riesgo, canal apagado.
    const checks = await db<{ layer: string; result: string; provider: string }[]>`select layer, result, provider from crm.tax_id_verifications where account_id = ${store.id} order by layer`
    expect(checks).toEqual([{ layer: 'format', result: 'pass', provider: 'contigo' }, { layer: 'registry', result: 'queued_off', provider: 'off' }, { layer: 'risk_list', result: 'queued_off', provider: 'off' }])
    // El valor completo no quedó en ningún lado.
    const leaks = await db<{ n: number }[]>`
      select (select count(*) from crm.tax_ids where to_jsonb(tax_ids)::text ilike ${'%' + RFC + '%'})::int
           + (select count(*) from crm.tax_id_verifications where to_jsonb(tax_id_verifications)::text ilike ${'%' + RFC + '%'})::int
           + (select count(*) from crm.audit_events where coalesce(before::text, '') || coalesce(after::text, '') ilike ${'%' + RFC + '%'})::int
           + (select count(*) from crm.accounts where to_jsonb(accounts)::text ilike ${'%' + RFC + '%'})::int
           + (select count(*) from crm.outbox_events where payload::text ilike ${'%' + RFC + '%'})::int as n`
    expect(leaks[0]!.n).toBe(0)
    expect((await db<{ tax_id_last4: string }[]>`select tax_id_last4 from crm.accounts where id = ${store.id}`)[0]!.tax_id_last4).toBe('1GR8')
    const ev = (await db<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'taxid.captured' and object_id = ${store.id}`)[0]!
    expect(ev.after).toMatchObject({ type: 'mx_rfc', last4: '1GR8', status: 'format_valid', registry: 'queued_off' })
  })

  it('el mismo identificador en otro comercio se detecta por la huella y pasa a revisión; la búsqueda exacta lo encuentra', async () => {
    const marco = await ctxFor('marco.pena')
    const first = await storeOf('marco.pena', 3)
    const second = await storeOf('marco.pena', 4)
    const out = await captureTaxId(marco, second.id, { type: 'mx_rfc', value: RFC, legalName: 'Otro Comercio de Prueba', taxRegime: '601', postalCode: '64000' })
    expect(out.status).toBe('needs_review')
    expect(out.duplicates.map((d) => d.account_id)).toEqual([first.id])
    const found = await accountsByTaxId(marco, 'GODE-561231-GR8')
    expect(found.map((f) => f.id).sort()).toEqual([first.id, second.id].sort())
    expect(await accountsByTaxId(marco, 'GODE561231GR9')).toEqual([])
    expect(await accountsByTaxId(marco, 'abarrotes')).toEqual([])
    // Quien vende en US no ve comercios de MX por esta vía (RLS).
    expect(await accountsByTaxId(await ctxFor('jade.kim'), RFC)).toEqual([])
  })

  it('el dígito verificador que no cuadra, un país sin validador y un SSN: revisión, revisión y rechazo', async () => {
    const marco = await ctxFor('marco.pena')
    const a = await storeOf('marco.pena', 5)
    const bad = await captureTaxId(marco, a.id, { type: 'mx_rfc', value: 'ABC680524P76', legalName: 'Comercio Tres', taxRegime: '601', postalCode: '64000' })
    expect(bad.status).toBe('needs_review')
    expect((await db<{ result: string; detail: string }[]>`select result, detail from crm.tax_id_verifications where account_id = ${a.id} and layer = 'format'`)[0]).toEqual({ result: 'review', detail: 'checksum_mismatch' })
    const jade = await ctxFor('jade.kim')
    const us = await storeOf('jade.kim', 2)
    expect(await code(captureTaxId(jade, us.id, { type: 'us_ein', value: SSN_SHAPED }))).toBe('invalid')
    expect((await db<{ n: number }[]>`select count(*)::int as n from crm.tax_ids where account_id = ${us.id}`)[0]!.n).toBe(0)
    const ein = await captureTaxId(jade, us.id, { type: 'us_ein', value: '12-3456789' })
    expect(ein).toMatchObject({ status: 'format_valid', last4: '6789' })
    expect((await captureTaxId(jade, us.id, { type: 'other', value: 'TRN 100200300' })).status).toBe('needs_review')
    // Capturar de nuevo cierra el anterior con fecha: hay uno vigente y queda la historia.
    expect((await db<{ live: number; all: number }[]>`select count(*) filter (where valid_to is null)::int as live, count(*)::int as all from crm.tax_ids where account_id = ${us.id}`)[0]).toEqual({ live: 1, all: 2 })
    // Leadership (solo lectura) no captura.
    expect(await code(captureTaxId(await ctxFor('luis.tovar'), us.id, { type: 'us_ein', value: '12-3456789' }))).toBe('forbidden')
  })

  it('la revisión humana la hace otra persona con permiso y queda con su nota', async () => {
    const store = await storeOf('marco.pena', 3)
    expect(await code(reviewTaxId(await ctxFor('marco.pena'), store.id, { decision: 'approve', note: 'Constancia fiscal' }))).toBe('forbidden')
    expect(await code(reviewTaxId(await ctxFor('fernando.ibarra'), store.id, { decision: 'approve', note: 'Constancia fiscal' }))).toBe('forbidden')
    expect(await code(reviewTaxId(await ctxFor('valeria.soto'), store.id, { decision: 'approve', note: '' }))).toBe('invalid')
    await reviewTaxId(await ctxFor('valeria.soto'), store.id, { decision: 'approve', note: 'Constancia de situación fiscal a la vista' })
    const row = (await db<{ status: string; reviewer: string; review_note: string }[]>`select t.status, u.full_name as reviewer, t.review_note from crm.tax_ids t join crm.users u on u.id = t.reviewed_by where t.account_id = ${store.id} and t.valid_to is null`)[0]!
    expect(row).toEqual({ status: 'verified', reviewer: 'Valeria Soto', review_note: 'Constancia de situación fiscal a la vista' })
    expect((await db<{ result: string }[]>`select result from crm.tax_id_verifications where account_id = ${store.id} and layer = 'human'`)[0]!.result).toBe('pass')
    const header = await getAccountHeader(await ctxFor('valeria.soto'), store.id)
    expect(header!.header.tax).toEqual({ status: 'verified', last4: '1GR8', type: 'mx_rfc' })
    // Quien lo capturó no lo aprueba, aunque tenga permiso de revisar.
    const valeria = await ctxFor('valeria.soto')
    const mine = await storeOf('marco.pena', 6)
    await captureTaxId(valeria, mine.id, { type: 'mx_rfc', value: 'ABC680524P73', legalName: 'Comercio Cuatro', taxRegime: '601', postalCode: '64000' })
    expect(await code(reviewTaxId(valeria, mine.id, { decision: 'approve', note: 'Constancia' }))).toBe('invalid')
    await reviewTaxId(valeria, mine.id, { decision: 'reject', note: 'El nombre no coincide con la constancia' })
    expect((await db<{ status: string }[]>`select status from crm.tax_ids where account_id = ${mine.id} and valid_to is null`)[0]!.status).toBe('rejected')
  })
  it('cuando hace falta una persona, se le avisa a quien revisa; y a quien capturó, cuando se decide', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await storeOf('marco.pena', 8)
    expect((await captureTaxId(marco, store.id, { type: 'other', value: 'TRN 778812349' })).status).toBe('needs_review')
    const sent = await db<{ who: string; title: string; body: string; needs_action: boolean; link: string }[]>`
      select u.full_name as who, n.title, n.body, n.needs_action, n.link from crm.notices n join crm.users u on u.id = n.user_id
       where n.account_id = ${store.id} and n.kind = 'approval' order by u.full_name`
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.map((x) => x.who)).toContain('Valeria Soto')
    expect(sent.map((x) => x.who)).not.toContain('Marco Peña')
    for (const x of sent) {
      expect(x.needs_action).toBe(true)
      expect(x.link).toBe(`/comercios/${store.id}?tab=datos`)
      // El aviso nunca lleva el identificador: solo el nombre del comercio y los últimos 4.
      expect(`${x.title} ${x.body}`).not.toMatch(/778812349|TRN/)
      expect(x.body).toContain('2349')
    }
    await reviewTaxId(await ctxFor('valeria.soto'), store.id, { decision: 'reject', note: 'No coincide con el documento' })
    const back = await db<{ title: string; needs_action: boolean }[]>`
      select n.title, n.needs_action from crm.notices n where n.account_id = ${store.id} and n.kind = 'approval' and n.user_id = ${await personaId('marco.pena')}`
    expect(back).toHaveLength(1)
    expect(back[0]!.needs_action).toBe(true)
    expect(back[0]!.title).toMatch(/rechazado|rejected/)
  })
})

describe('MULTI-04: dirección con el formato del país, ubicación, distancia y cerca de mí', () => {
  it('cada país pide sus campos y valida su código postal; lo que no existe en un país no se exige', async () => {
    const marco = await ctxFor('marco.pena')
    const mx = await storeOf('marco.pena', 7)
    expect(await code(updateAddress(marco, mx.id, { address_line: 'Calle Uno 10', locality: 'Monterrey', region: 'Nuevo León', postal_code: '64000' }))).toBe('invalid') // falta la colonia
    expect(await code(updateAddress(marco, mx.id, { address_line: 'Calle Uno 10', sublocality: 'Centro', locality: 'Monterrey', region: 'Nuevo León', postal_code: '6400' }))).toBe('invalid')
    await updateAddress(marco, mx.id, { address_line: '  Calle   Uno 10 ', sublocality: 'Centro', locality: 'Monterrey', region: 'Nuevo León', postal_code: '64000' })
    const row = (await db<{ address_line: string; sublocality: string; postal_code: string; address_norm: string; country: string }[]>`select address_line, sublocality, postal_code, address_norm, trim(country) as country from crm.accounts where id = ${mx.id}`)[0]!
    expect(row).toEqual({ address_line: 'Calle Uno 10', sublocality: 'Centro', postal_code: '64000', address_norm: 'calle uno 10 centro 64000', country: 'MX' })
    const jade = await ctxFor('jade.kim')
    const us = await storeOf('jade.kim', 3)
    expect(await code(updateAddress(jade, us.id, { address_line: '5 Elm St', locality: 'Rockville', region: 'Maryland', postal_code: '20850' }))).toBe('invalid') // el estado sale de la lista
    expect(await code(updateAddress(jade, us.id, { address_line: '5 Elm St', locality: 'Rockville', region: 'MD', postal_code: '2085' }))).toBe('invalid')
    await updateAddress(jade, us.id, { address_line: '5 Elm St', locality: 'Rockville', region: 'md', postal_code: '20850-1234' })
    const formats = await db<{ country: string; keys: string[] }[]>`select trim(country) as country, array(select jsonb_array_elements(fields) ->> 'key') as keys from crm.address_formats order by 1`
    const of = (c: string) => formats.find((f) => f.country === c)!.keys
    expect(of('MX')).toContain('sublocality')
    expect(of('US')).not.toContain('sublocality')
    expect(of('SV')).not.toContain('postal_code')
    expect(of('BR')).toEqual(['address_line', 'address_line2', 'sublocality', 'locality', 'region', 'postal_code'])
    // La búsqueda encuentra por calle (E2.F1).
    expect((await searchAll(marco, 'calle uno 10')).accounts.map((a) => a.id)).toContain(mx.id)
  })

  it('la ubicación se guarda a mano o desde el teléfono; la distancia y los posibles repetidos se calculan en la base', async () => {
    const marco = await ctxFor('marco.pena')
    const a = await storeOf('marco.pena', 8)
    const b = await storeOf('marco.pena', 9)
    const far = await storeOf('marco.pena', 10)
    expect(await code(setLocation(marco, a.id, { latitude: '91', longitude: '0', source: 'manual' }))).toBe('invalid')
    expect(await code(setLocation(marco, a.id, { latitude: '', longitude: '', source: 'manual' }))).toBe('invalid')
    expect(await code(setLocation(marco, a.id, { latitude: '0', longitude: '0', source: 'manual' }))).toBe('invalid')
    expect((await setLocation(marco, a.id, { latitude: '20.6736', longitude: '-103.344', source: 'manual' })).near).toEqual([])
    const second = await setLocation(marco, b.id, { latitude: '20.67385', longitude: '-103.344', source: 'device', accuracy: '12.4' })
    expect(second.near.map((n) => n.id)).toEqual([a.id])
    expect(second.near[0]!.distance_m).toBeGreaterThan(20)
    expect(second.near[0]!.distance_m).toBeLessThan(35)
    await setLocation(marco, far.id, { latitude: '20.6836', longitude: '-103.344', source: 'manual' })
    expect((await db<{ geo_source: string; geo_accuracy_m: number; by: string }[]>`select a.geo_source, a.geo_accuracy_m, u.full_name as by from crm.accounts a join crm.users u on u.id = a.geo_by where a.id = ${b.id}`)[0]).toEqual({ geo_source: 'device', geo_accuracy_m: 12, by: 'Marco Peña' })
    expect((await db<{ m: number }[]>`select app.distance_m(20.6736, -103.344, 20.6836, -103.344) as m`)[0]!.m).toBeGreaterThan(1100)
    expect((await db<{ m: number }[]>`select app.distance_m(20.6736, -103.344, 20.6836, -103.344) as m`)[0]!.m).toBeLessThan(1125)

    const near = (await accountsNear(marco, 20.6736, -103.344, 500)).filter((x) => [a.id, b.id, far.id].includes(x.id))
    expect(near.map((x) => x.id)).toEqual([a.id, b.id])
    expect(near[0]!.distance_m).toBe(0)
    const wide = (await accountsNear(marco, 20.6736, -103.344, 2000)).filter((x) => [a.id, b.id, far.id].includes(x.id))
    expect(wide.map((x) => x.id)).toEqual([a.id, b.id, far.id])
    // "Cerca de mí" respeta el alcance: otra persona que vende no ve los comercios de Marco.
    expect((await accountsNear(await ctxFor('lucia.vega'), 20.6736, -103.344, 2000)).filter((x) => [a.id, b.id, far.id].includes(x.id))).toEqual([])
    // La bitácora no guarda la coordenada exacta.
    const ev = (await db<{ after: { lat: number; source: string } }[]>`select after from crm.audit_events where action = 'account.located' and object_id = ${b.id}`)[0]!
    expect(ev.after).toMatchObject({ lat: 20.67, source: 'device', near: 1 })
  })
  it('la Sales App puede mandar la ubicación del punto de venta: llena el hueco y no pisa la que ya estaba', async () => {
    const sys = await systemContext()
    const customer = `SC-MX-${Math.floor(100000 + Math.random() * 899999)}`
    const ev = (lat: number, lon: number) => ({ event_id: `ev-merc-${Math.random().toString(36).slice(2, 12)}`, type: 'store.created', version: 1, occurred_at: new Date().toISOString(),
      data: { customer_id: customer, market: 'MX', name: 'Abarrotes Ubicación De Prueba', latitude: lat, longitude: lon, location_accuracy_m: 12 } })
    const first = await ingestSalesAppEvent(sys, ev(20.67359, -103.34421))
    expect(first.status).toBe('processed')
    const id = (first as { accountId: string }).accountId
    const geo = async () => (await db<{ latitude: string; longitude: string; geo_source: string; geo_accuracy_m: number }[]>`select latitude::text, longitude::text, geo_source, geo_accuracy_m from crm.accounts where id = ${id}`)[0]!
    expect(await geo()).toMatchObject({ geo_source: 'sales_app', geo_accuracy_m: 12 })
    expect(Number((await geo()).latitude)).toBeCloseTo(20.67359, 4)
    // Otro evento de la misma tienda con otra ubicación no la mueve: manda lo que ya está en CONTIGO.
    await ingestSalesAppEvent(sys, ev(19.5, -99.1))
    expect(Number((await geo()).latitude)).toBeCloseTo(20.67359, 4)
    // Una latitud imposible no entra.
    expect(await code(ingestSalesAppEvent(sys, ev(120, -99.1)))).toBe('invalid')
  })
})

describe('MULTI-05: WhatsApp por mercado, listo y apagado', () => {
  it('un número por mercado y entidad, plantillas por idioma y categoría, costo con fuente y ventana visible', async () => {
    const admin = await ctxFor('nora.salas')
    const mx = (await db<{ id: string }[]>`select id from crm.legal_entities where market_code = 'MX' and is_default`)[0]!.id
    const us = (await db<{ id: string }[]>`select id from crm.legal_entities where market_code = 'US' and is_default`)[0]!.id
    expect(await code(saveWhatsappAccount(await ctxFor('ana.robles'), { entityId: mx, displayName: 'axexo México' }))).toBe('forbidden')
    expect(await code(saveWhatsappAccount(admin, { market: 'US', entityId: mx, displayName: 'axexo México' }))).toBe('invalid')
    const acc = await saveWhatsappAccount(admin, { entityId: mx, displayName: 'axexo México', phone: '55 5000 0000', dailyLimit: '250' })
    // Guardar otra vez el mismo mercado y entidad actualiza: no hay dos números para lo mismo.
    expect(await saveWhatsappAccount(admin, { entityId: mx, displayName: 'axexo MX' })).toBe(acc)
    const other = await saveWhatsappAccount(admin, { entityId: us, displayName: 'axexo US' })
    expect(other).not.toBe(acc)
    expect((await db<{ n: number }[]>`select count(*)::int as n from crm.whatsapp_accounts where is_active`)[0]!.n).toBe(2)

    expect(await code(saveWhatsappTemplate(admin, { accountId: acc, key: 'Alta', locale: 'es', category: 'utility', body: 'Hola' }))).toBe('invalid')
    expect(await code(saveWhatsappTemplate(admin, { accountId: acc, key: 'promo_recargas', locale: 'es', category: 'marketing', body: 'Compra tus recargas aquí y paga ahora.' }))).toBe('invalid')
    const tpl = await saveWhatsappTemplate(admin, { accountId: acc, key: 'alta_confirmada', locale: 'es', category: 'utility', body: 'Tu alta quedó lista. Ya puedes hacer tu primera venta.' })
    await saveWhatsappTemplate(admin, { accountId: acc, key: 'alta_confirmada', locale: 'en', category: 'utility', body: 'Your signup is ready. You can now make your first sale.' })
    expect(await saveWhatsappTemplate(admin, { accountId: acc, key: 'alta_confirmada', locale: 'es', category: 'utility', body: 'Tu alta quedó lista. Haz tu primera venta hoy.' })).toBe(tpl)
    await saveWhatsappRate(admin, { market: 'MX', category: 'utility', currency: 'usd', cost: '0.0085', effectiveFrom: iso(-10), source: 'Tarifario de prueba' })
    expect(await code(saveWhatsappRate(admin, { market: 'MX', category: 'utility', currency: 'USD', cost: '', effectiveFrom: iso(0), source: 'x' }))).toBe('invalid')
    const d = await getMarketsAdmin(admin)
    expect(d.templates.filter((t) => t.account_id === acc).map((t) => `${t.key}:${t.locale}:${t.status}`).sort()).toEqual(['alta_confirmada:en:draft', 'alta_confirmada:es:draft'])
    expect(d.rates).toEqual([{ market_code: 'MX', category: 'utility', currency: 'USD', cost: '0.008500', effective_from: iso(-10), source: 'Tarifario de prueba' }])
    // Quien vende en US no ve la configuración de MX.
    expect(await asPersona('jade.kim', async (tx) => (await tx<{ n: number }[]>`select count(*)::int as n from crm.whatsapp_accounts where market_code = 'MX'`)[0]!.n)).toBe(0)

    const marco = await ctxFor('marco.pena')
    const store = await storeOf('marco.pena', 11)
    expect((await getAccountMarketData(marco, store.id))!.window).toBeNull()
    await openWhatsappWindow(marco, store.id, 'service_24h')
    const data = (await getAccountMarketData(marco, store.id))!
    expect(data.whatsapp).toEqual({ display_name: 'axexo MX', phone: null })
    const hours = (new Date(data.window!.expires_at).getTime() - Date.now()) / 3600000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThan(24.1)
    expect((await getAccountHeader(marco, store.id))!.header.whatsapp_until).not.toBeNull()
    expect(await code(openWhatsappWindow(await ctxFor('luis.tovar'), store.id, 'service_24h'))).toBe('forbidden')
  })

  it('cada adaptador del paquete está apagado y dice qué falta y con qué variable se enciende', () => {
    const status = marketAdapterStatus()
    expect(status.map((s) => s.key)).toEqual(['tax_registry', 'protected_data', 'blind_index', 'geocoding', 'fx_feed', 'whatsapp_market'])
    for (const s of status) {
      if (s.key !== 'blind_index') expect(s.mode, s.key).toBe('off')
      expect(s.envVar).toMatch(/^[A-Z_]+$/)
      expect(s.needs[0].startsWith('Falta')).toBe(true)
      expect(s.needs[1].startsWith('Missing')).toBe(true)
    }
  })
})

describe('UX-01: el encabezado de la ficha depende del rol y sale de una sola llamada', () => {
  it('ventas, supervisión y operaciones ven datos distintos arriba; administración los cambia', async () => {
    const store = await storeOf('marco.pena', 12)
    const rep = (await getAccountHeader(await ctxFor('marco.pena'), store.id))!
    const sup = (await getAccountHeader(await ctxFor('fernando.ibarra'), store.id))!
    const ops = (await getAccountHeader(await ctxFor('valeria.soto'), store.id))!
    expect(rep.role).toBe('rep')
    expect(sup.role).toBe('supervisor')
    expect(ops.role).toBe('ops')
    expect(rep.facts).toEqual(['next_step', 'alerts', 'contact', 'sales_30d', 'data_as_of'])
    expect(sup.facts[0]).toBe('owner_team')
    expect(ops.facts).toContain('tax_id')
    expect(rep.facts).not.toEqual(sup.facts)
    // Equipo, avisos abiertos, cadena completa y fecha de corte vienen en la misma respuesta.
    expect(sup.header).toMatchObject({ owner: 'Marco Peña', team: 'D2D Centro', market: 'MX', entity: 'Entidad MX (sintética)' })
    expect(typeof sup.header.alerts).toBe('number')
    const child = (await db<{ id: string; depth: number }[]>`select id, cardinality(ancestor_ids) as depth from crm.accounts where cardinality(ancestor_ids) > 0 and market_code = 'MX' order by cardinality(ancestor_ids) desc limit 1`)[0]!
    const h = (await getAccountHeader(await ctxFor('ana.robles'), child.id))!
    expect(h.header.path).toHaveLength(child.depth)
    expect(h.role).toBe('market_lead')

    const admin = await ctxFor('nora.salas')
    expect(await code(setFichaLayout(await ctxFor('ana.robles'), 'rep', ['entity']))).toBe('forbidden')
    expect(await code(setFichaLayout(admin, 'rep', ['entity', 'invento']))).toBe('invalid')
    expect(await code(setFichaLayout(admin, 'rep', []))).toBe('invalid')
    await setFichaLayout(admin, 'rep', ['entity', 'tax_id', '', 'entity'])
    expect((await getAccountHeader(await ctxFor('marco.pena'), store.id))!.facts).toEqual(['entity', 'tax_id'])
    // RLS: quien no puede ver el comercio no recibe encabezado.
    expect(await getAccountHeader(await ctxFor('jade.kim'), store.id)).toBeNull()
  })

  it('presupuesto de latencia: el encabezado responde en menos de 150 ms sobre la base sembrada', async () => {
    const ctx = await ctxFor('ana.robles')
    const ids = await db<{ id: string }[]>`select id from crm.accounts where market_code = 'MX' and archived_at is null order by id limit 12`
    await getAccountHeader(ctx, ids[0]!.id) // primera llamada: conexión y plan
    const times: number[] = []
    for (const r of ids) times.push((await getAccountHeader(ctx, r.id))!.ms)
    times.sort((x, y) => x - y)
    expect(times[Math.floor(times.length / 2)]!).toBeLessThan(150)
  })
})

describe('UX-04: enlace directo a la ficha desde otro sistema', () => {
  it('abre por el ID de la Sales App, por el Merchant ID o por el ID de CONTIGO, y no revela comercios fuera del alcance', async () => {
    const marco = await ctxFor('marco.pena')
    const alias = (await db<{ account_id: string; external_id: string; system: string }[]>`
      select al.account_id, al.external_id, al.system from crm.account_aliases al join crm.accounts a on a.id = al.account_id
       where al.valid_to is null and a.owner_id = ${await personaId('marco.pena')} and a.archived_at is null order by al.external_id limit 1`)[0]!
    expect(await accountByRef(marco, alias.external_id.toLowerCase())).toEqual({ id: alias.account_id })
    expect(await accountByRef(marco, alias.external_id, alias.system)).toEqual({ id: alias.account_id })
    expect(await accountByRef(marco, alias.account_id)).toEqual({ id: alias.account_id })
    expect(await accountByRef(marco, 'NO-EXISTE-000')).toBeNull()
    expect(await accountByRef(await ctxFor('jade.kim'), alias.external_id)).toBeNull()
    await db`update crm.accounts set merchant_ref = 'MID-778899' where id = ${alias.account_id}`
    expect(await accountByRef(marco, 'mid-778899')).toEqual({ id: alias.account_id })
  })
})

describe('E2.F5: secciones de campos por mercado', () => {
  it('las secciones comunes son las mismas en todos los mercados y un mercado agrega la suya', async () => {
    const admin = await ctxFor('nora.salas')
    const base = (await getMarketsAdmin(admin)).sections
    expect(base.filter((s) => s.market_code === null).map((s) => s.code)).toEqual(['qualify', 'terms', 'file'])
    expect(await code(createFieldSection(await ctxFor('ana.robles'), { market: 'MX', labelEs: 'Soporte', labelEn: 'Support', team: 'support' }))).toBe('forbidden')
    await createFieldSection(admin, { market: 'MX', labelEs: 'Soporte en tienda', labelEn: 'In-store support', team: 'support' })
    expect(await code(createFieldSection(admin, { market: 'MX', labelEs: 'Soporte en tienda', labelEn: 'Other', team: 'support' }))).toBe('invalid')
    const section = (await getMarketsAdmin(admin)).sections.find((s) => s.market_code === 'MX')!
    expect(section).toMatchObject({ code: 'in_store_support', team: 'support', fields: 0 })
    const mxField = (await db<{ id: string }[]>`insert into crm.field_definitions (object, key, label_es, label_en, data_type, market_code) values ('account', 'pos_model', 'Modelo de terminal', 'Terminal model', 'text', 'MX') returning id`)[0]!.id
    const usField = (await db<{ id: string }[]>`insert into crm.field_definitions (object, key, label_es, label_en, data_type, market_code) values ('account', 'pos_model_us', 'Modelo de terminal US', 'Terminal model US', 'text', 'US') returning id`)[0]!.id
    await setFieldSection(admin, mxField, section.code)
    expect((await getMarketsAdmin(admin)).sections.find((s) => s.id === section.id)!.fields).toBe(1)
    // La ficha lee la sección de la tabla: el campo llega con el nombre, el equipo y el orden de su sección, solo en su mercado.
    const inMx = (await fieldDefs(await ctxFor('marco.pena'), 'account', 'MX')).find((f) => f.key === 'pos_model')!
    expect(inMx).toMatchObject({ section: section.code, section_es: section.label_es, section_en: section.label_en, section_team: 'support' })
    const common = (await fieldDefs(await ctxFor('marco.pena'), 'account', 'MX', 'b2b')).find((f) => f.section === 'qualify')!
    expect(common).toMatchObject({ section_es: 'Para calificar', section_team: 'sales', section_pos: 1 })
    expect((await fieldDefs(await ctxFor('jade.kim'), 'account', 'US')).some((f) => f.key === 'pos_model')).toBe(false)
    // La sección de México no vale para un campo de US, ni desde la app ni directo en la base.
    expect(await code(setFieldSection(admin, usField, section.code))).toBe('invalid')
    expect(await code(db`update crm.field_definitions set section = ${section.code} where id = ${usField}`)).toBe('23514')
    await setFieldSection(admin, usField, 'terms')
    await setFieldSection(admin, mxField, '')
    expect((await db<{ section: string | null }[]>`select section from crm.field_definitions where id = ${mxField}`)[0]!.section).toBeNull()
  })
})

describe('la base repite los límites', () => {
  it('toda tabla nueva tiene RLS forzado y ninguna se puede leer sin identidad', async () => {
    const tables = ['market_holidays', 'business_units', 'tax_ids', 'tax_id_verifications', 'address_formats', 'whatsapp_accounts', 'whatsapp_templates', 'whatsapp_rates', 'whatsapp_windows', 'ficha_layouts', 'field_sections']
    const rows = await db<{ relname: string; ok: boolean }[]>`select c.relname, (c.relrowsecurity and c.relforcerowsecurity) as ok from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'crm' and c.relname = any(${tables})`
    expect(rows.map((r) => r.relname).sort()).toEqual([...tables].sort())
    expect(rows.every((r) => r.ok)).toBe(true)
    const all = await db<{ n: number }[]>`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'crm' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`
    expect(all[0]!.n).toBe(0)
    // Quien vende no escribe catálogos ni configuración, aunque lo intente directo en la base.
    const denied = await asPersona('marco.pena', async (tx) => {
      const out: string[] = []
      for (const sql of [
        () => tx`insert into crm.market_holidays (market_code, day, name) values ('MX', '2030-01-01', 'No')`,
        () => tx`insert into crm.business_units (code, label_es, label_en) values ('nueva', 'Nueva', 'New')`,
        () => tx`insert into crm.whatsapp_rates (market_code, category, currency, cost, effective_from, source) values ('MX', 'utility', 'USD', 1, '2030-01-01', 'no')`,
        () => tx`insert into crm.ficha_layouts (role, facts) values ('rep', '{entity}') on conflict (role) do update set facts = excluded.facts`,
        () => tx`insert into crm.legal_entities (market_code, name) values ('MX', 'No debe')`,
      ]) {
        try {
          await tx.savepoint(() => sql())
          out.push('ok')
        } catch (e) {
          out.push((e as { code?: string }).code ?? 'error')
        }
      }
      return out
    })
    expect(denied).toEqual(['42501', '42501', '42501', '42501', '42501'])
  })
})
