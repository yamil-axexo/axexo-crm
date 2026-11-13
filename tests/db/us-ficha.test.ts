import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner } from './helpers'
import { createAccount } from '@/domain/accounts'
import { createDeal } from '@/domain/deals'
import { setOpsCheck } from '@/domain/ops'
import { addAlias } from '@/domain/datos'
import { setAccountType } from '@/domain/b2b'
import { createAgency, setAgencyActive, setCarrierDetail, setMerchantOrigin, setProviderRefLabel, setRecruiter, setStoreProfile, setTaxId } from '@/domain/store-record'
import { agenciesAdmin, dealRecruiter, documentTaxId, recruiterChoices, storeRecord } from '@/dal/store-record'
import { accountTypes } from '@/dal/b2b'
import { fieldDefs } from '@/dal/fields'
import { resolveKept, KEPT_GROUPS } from '@/lib/store-labels'
import { protectedDataAdapter, simulatedVault } from '@/server/adapters/protected-data'
import { isoDay } from '@/lib/format'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const today = isoDay(new Date(), 'America/New_York')
const uid = (k: string) => one(admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`).then((r) => r.id)
const audits = (action: string, id: string) => admin<{ before: Record<string, unknown> | null; after: Record<string, unknown> }[]>`
  select before, after from crm.audit_events where action = ${action} and object_id = ${id} order by at desc`
const provider = async (code: string) => (await one(admin<{ id: string }[]>`select id from crm.ops_catalog where market_code = 'US' and kind = 'provider' and code = ${code}`)).id

/** Una tienda de US creada por Jade (ventas). */
async function store(extra: { recruitedBy?: string } = {}) {
  const jade = await ctxFor('jade.kim')
  const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Ficha US ${tag()}`, segment: 'dealer', force: true, reason: 'Tienda de prueba distinta a las demás', ...extra })
  return { jade, id: acc.id! }
}
/** Una tienda que llegó por una carga del sistema (como la importación): sin origen ni reclutador. */
async function imported() {
  const sys = (await one(admin<{ id: string }[]>`select app.system_user_id() as id`)).id
  return (await one(admin<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, lifecycle, country, created_by) values ('US', 'store', ${`Importada ${tag()}`}, 'dealer', 'active', 'US', ${sys}) returning id`)).id
}

describe('E9: configuración de un mercado con ficha de dealer', () => {
  it('US lleva la ficha de dealer y México no', async () => {
    const jade = await ctxFor('jade.kim')
    expect(jade.market('US').dealerRecord).toBe(true)
    expect((await ctxFor('nora.salas')).market('MX').dealerRecord).toBe(false)
  })

  it('E9.F3: US ofrece los seis valores de Channel Segment, primero en la lista, y las tiendas son Dealer', async () => {
    const jade = await ctxFor('jade.kim')
    const types = await accountTypes(jade, 'US')
    expect(types.slice(0, 6).map((x) => x.label_en)).toEqual(['Dealer', 'ISP', 'Distributor/Master Agent', 'Carrier', 'TSP', 'Vendor'])
    expect((await accountTypes(await ctxFor('nora.salas'), 'MX')).some((x) => x.code === 'dealer')).toBe(false)
    const { id } = await store()
    expect(await one(admin`select account_type, kind from crm.accounts where id = ${id}`)).toMatchObject({ account_type: 'dealer', kind: 'store' })
    // las tiendas sintéticas que ya existían también quedaron como Dealer; ninguna cuenta de US quedó con un tipo que no existe
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where market_code = 'US' and account_type = 'store'`)).n).toBe(0)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts a where market_code = 'US' and not exists (select 1 from crm.account_types t where t.code = a.account_type and t.kind = a.kind)`)).n).toBe(0)
  })

  it('E9.F6: US tiene las 15 zonas del documento, sin duplicar las que ya existían', async () => {
    const names = (await admin<{ name: string }[]>`select name from crm.territories where market_code = 'US' and archived_at is null`).map((r) => r.name)
    for (const n of ['Maryland', 'Los Angeles CA', 'Orange County CA', 'New Jersey', 'Florida', 'Washington DC', 'Northern Virginia', 'Boston MA', 'Chicago IL', 'Sacramento CA', 'San Diego CA', 'Las Vegas NV', 'Fresno/Bakersfield CA', 'Arizona', 'Houston TX'])
      expect(names.filter((x) => x === n), n).toHaveLength(1)
    // la importación arma el código de una zona a partir de su nombre: cae en la misma fila
    expect((await one(admin<{ code: string }[]>`select code from crm.territories where market_code = 'US' and name = 'Houston TX'`)).code).toBe('houston-tx')
  })

  it('la configuración se puede volver a correr sin duplicar nada, y con carriers carga los seis vigentes con su identificador', async () => {
    const count = async () => one(admin<{ t: number; b: number; ty: number; f: number }[]>`select (select count(*)::int from crm.territories where market_code = 'US') as t,
      (select count(*)::int from crm.business_types where market_code = 'US') as b, (select count(*)::int from crm.account_types where market_code = 'US') as ty,
      (select count(*)::int from crm.field_definitions where market_code = 'US' and key like 'us\\_%') as f`)
    const before = await count()
    expect(before).toMatchObject({ b: 11, ty: 6, f: 15 })
    await admin.begin(async (tx) => {
      await tx`select crm.dealer_record_setup('US', true)`
      const again = await one(tx<{ t: number; b: number; ty: number; f: number }[]>`select (select count(*)::int from crm.territories where market_code = 'US') as t,
        (select count(*)::int from crm.business_types where market_code = 'US') as b, (select count(*)::int from crm.account_types where market_code = 'US') as ty,
        (select count(*)::int from crm.field_definitions where market_code = 'US' and key like 'us\\_%') as f`)
      expect(again).toEqual(before)
      const carriers = await tx<{ label_en: string; ref_label: string | null }[]>`select label_en, ref_label from crm.ops_catalog where market_code = 'US' and kind = 'provider' and code in ('h2o','att','tmobile','gen_mobile','ultra','lwp') order by position`
      expect(carriers.map((c) => c.label_en)).toEqual(['H2O', 'AT&T', 'T-Mobile', 'Gen Mobile', 'Ultra', 'LWP'])
      expect(carriers.map((c) => c.ref_label)).toEqual(['HDN Account ID', 'AT&T RT2 ID', 'TMO ID', null, 'Ultra Dealer Code', null])
      await tx`select crm.dealer_record_setup('US', true)`
      expect((await one(tx<{ n: number }[]>`select count(*)::int as n from crm.ops_catalog where market_code = 'US' and kind = 'provider' and code in ('h2o','att','tmobile','gen_mobile','ultra','lwp')`)).n).toBe(6)
      throw new Error('rollback')
    }).catch((e: Error) => { if (e.message !== 'rollback') throw e })
  })
})

describe('E9.F2 y F4: número de sitio y tipo de negocio', () => {
  it('Operaciones anota el número de sitio junto al Merchant ID; quien vende no', async () => {
    const { jade, id } = await store()
    const tom = await ctxFor('tom.reyes')
    await setStoreProfile(tom, id, { siteRef: 'SITE-00417' })
    const rec = (await storeRecord(jade, id, 'US'))!
    expect(rec).toMatchObject({ site_ref: 'SITE-00417', merchant_ref: null })
    expect((await audits('account.store_profile_set', id))[0]).toMatchObject({ before: { site_ref: null }, after: { site_ref: 'SITE-00417' } })
    await expect(setStoreProfile(jade, id, { siteRef: 'OTRO-1' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setStoreProfile(tom, id, { siteRef: 'x'.repeat(41) })).rejects.toMatchObject({ code: 'invalid' })
    // guardar lo mismo no deja otro evento
    await setStoreProfile(tom, id, { siteRef: 'SITE-00417' })
    expect(await audits('account.store_profile_set', id)).toHaveLength(1)
    // la base repite el límite: quien vende no ve la columna cambiar a escondidas de la regla
    expect(await asPersona('sam.ortiz', (tx) => attempt(tx, (sp) => sp`update crm.accounts set site_ref = 'X' where id = ${id}`))).toBe('0 rows')
  })

  it('el tipo de negocio trae las 11 opciones, es solo de dealers y se vacía si la cuenta deja de serlo', async () => {
    const { jade, id } = await store()
    const rec = (await storeRecord(jade, id, 'US'))!
    expect(rec.takes_business_type).toBe(true)
    expect(rec.businessTypes.map((b) => b.label_en)).toEqual(['Bodega/grocery', 'Wireless/phone shop', 'Convenience', 'Liquor', 'Restaurant/taqueria', 'Pharmacy', 'Laundromat', 'Check cashing/MSB', 'Repair shop', 'Travel agency', 'Other retail'])
    await setStoreProfile(jade, id, { businessType: 'wireless_shop' })
    expect((await storeRecord(jade, id, 'US'))!).toMatchObject({ business_type: 'wireless_shop', business_en: 'Wireless/phone shop' })
    await expect(setStoreProfile(jade, id, { businessType: 'no_existe' })).rejects.toMatchObject({ code: 'invalid' })
    // la base tampoco acepta un valor fuera del catálogo
    await expect(admin`update crm.accounts set business_type = 'no_existe' where id = ${id}`).rejects.toMatchObject({ code: '23514' })
    // una cuenta que no es dealer no lo lleva
    const robert = await ctxFor('robert.hale')
    const isp = await createAccount(robert, { market: 'US', accountType: 'isp', name: `ISP ${tag()}`, segment: 'dealer', force: true, reason: 'Cuenta de prueba que no es dealer' })
    expect((await storeRecord(robert, isp.id!, 'US'))!.takes_business_type).toBe(false)
    await expect(setStoreProfile(robert, isp.id!, { businessType: 'wireless_shop' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(admin`update crm.accounts set business_type = 'wireless_shop' where id = ${isp.id!}`).rejects.toMatchObject({ code: '23514' })
    // el dealer pasa a ser Vendor: su tipo de negocio queda vacío
    await setAccountType(robert, id, 'vendor')
    expect((await one(admin<{ business_type: string | null }[]>`select business_type from crm.accounts where id = ${id}`)).business_type).toBeNull()
  })
})

describe('E9.F5: origen del comercio, una sola vez', () => {
  it('una tienda creada en CONTIGO nace como alta nueva y no se puede cambiar', async () => {
    const { jade, id } = await store()
    expect((await storeRecord(jade, id, 'US'))!.merchant_origin).toBe('new_acquisition')
    await expect(setMerchantOrigin(await ctxFor('robert.hale'), id, 'emida_conversion')).rejects.toMatchObject({ code: 'set_once' })
    await expect(admin`update crm.accounts set merchant_origin = 'emida_conversion' where id = ${id}`).rejects.toMatchObject({ code: '23514' })
    await expect(admin`update crm.accounts set merchant_origin = null where id = ${id}`).rejects.toMatchObject({ code: '23514' })
    // una tienda de México no lleva origen
    const mx = await createAccount(await ctxFor('marco.pena'), { market: 'MX', kind: 'store', name: `Tienda MX ${tag()}`, segment: 'd2d', force: true, reason: 'Tienda de prueba distinta a las demás' })
    expect((await one(admin<{ merchant_origin: string | null }[]>`select merchant_origin from crm.accounts where id = ${mx.id!}`)).merchant_origin).toBeNull()
  })

  it('lo que llega por carga queda sin definir; con su ID de EMIDA es conversión; sin él, lo fija una vez quien dirige u Operaciones', async () => {
    const a = await imported()
    const robert = await ctxFor('robert.hale')
    expect((await storeRecord(robert, a, 'US'))!.merchant_origin).toBeNull()
    await addAlias(robert, a, { system: 'emida', externalId: `EM-${tag()}` })
    expect((await storeRecord(robert, a, 'US'))!.merchant_origin).toBe('emida_conversion')
    const b = await imported()
    await expect(setMerchantOrigin(await ctxFor('jade.kim'), b, 'new_acquisition')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setMerchantOrigin(robert, b, 'otra_cosa')).rejects.toMatchObject({ code: 'invalid' })
    await setMerchantOrigin(await ctxFor('tom.reyes'), b, 'new_acquisition')
    expect((await audits('account.origin_set', b))[0]?.after).toMatchObject({ merchant_origin: 'new_acquisition' })
    await expect(setMerchantOrigin(robert, b, 'emida_conversion')).rejects.toMatchObject({ code: 'set_once' })
    // un ID de EMIDA que llega después no cambia un origen ya fijado
    await addAlias(robert, b, { system: 'emida', externalId: `EM-${tag()}` })
    expect((await storeRecord(robert, b, 'US'))!.merchant_origin).toBe('new_acquisition')
  })
})

describe('E9.F12: reclutado por y agencias', () => {
  it('quien lidera el mercado da de alta agencias y socios; ventas y otros mercados no', async () => {
    const robert = await ctxFor('robert.hale')
    const name = `Agencia ${tag()}`
    const id = await createAgency(robert, { market: 'US', kind: 'agency', name })
    expect((await audits('team.agency_created', id))[0]?.after).toMatchObject({ kind: 'agency', name })
    await expect(createAgency(robert, { market: 'US', kind: 'agency', name: name.toUpperCase() })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createAgency(await ctxFor('jade.kim'), { market: 'US', kind: 'agency', name: `Otra ${tag()}` })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createAgency(await ctxFor('ana.robles'), { market: 'US', kind: 'agency', name: `Otra ${tag()}` })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createAgency(robert, { market: 'US', kind: 'otra', name: `Otra ${tag()}` })).rejects.toMatchObject({ code: 'invalid' })
    expect((await recruiterChoices(await ctxFor('jade.kim'))).some((g) => g.id === id)).toBe(true)
    expect((await agenciesAdmin(robert)).agencies.find((g) => g.id === id)).toMatchObject({ is_active: true, stores: 0 })
    // RLS: quien vende no inserta agencias aunque salte la pantalla; alguien de México no las ve
    expect(await asPersona('jade.kim', (tx) => attempt(tx, (sp) => sp`insert into crm.agencies (market_code, kind, name) values ('US', 'agency', 'Directo')`))).toBe('42501')
    expect(await asPersona('marco.pena', async (tx) => (await tx`select 1 from crm.agencies where id = ${id}`).length)).toBe(0)
    // de baja: ya no se ofrece, y se puede reactivar
    await setAgencyActive(robert, id, false)
    expect((await recruiterChoices(await ctxFor('jade.kim'))).some((g) => g.id === id)).toBe(false)
    await setAgencyActive(robert, id, true)
    expect((await audits('team.agency_restored', id))).toHaveLength(1)
  })

  it('queda fijo desde el alta: equipo propio o agencia, y baja a los negocios de la tienda', async () => {
    const agency = await uid('ag-us-1')
    const own = await store({ recruitedBy: 'field_team' })
    expect((await storeRecord(own.jade, own.id, 'US'))!).toMatchObject({ recruited_by: 'field_team', recruited_agency: null })
    const byAgency = await store({ recruitedBy: agency })
    expect((await storeRecord(byAgency.jade, byAgency.id, 'US'))!).toMatchObject({ recruited_by: 'agency', recruited_agency: 'Agencia Ejemplo Uno (sintética)' })
    // no se cambia: ni por la pantalla ni directo en la base
    const robert = await ctxFor('robert.hale')
    await expect(setRecruiter(robert, byAgency.id, 'field_team')).rejects.toMatchObject({ code: 'set_once' })
    await expect(admin`update crm.accounts set recruited_by = 'field_team', recruited_agency_id = null where id = ${byAgency.id}`).rejects.toMatchObject({ code: '23514' })
    // el negocio nuevo de la tienda lo copia y tampoco se cambia
    const deal = await createDeal(byAgency.jade, { accountId: byAgency.id, pipelineId: await uid('p-us-dealer'), title: `Alta ${tag()}`, nextStep: 'Call the owner', nextStepDue: today })
    expect(await dealRecruiter(byAgency.jade, deal)).toEqual({ recruited_by: 'agency', agency: 'Agencia Ejemplo Uno (sintética)' })
    await expect(admin`update crm.deals set recruited_by = 'field_team', recruited_agency_id = null where id = ${deal}`).rejects.toMatchObject({ code: '23514' })
    // una agencia de otro mercado o inexistente no entra
    await expect(createAccount(own.jade, { market: 'US', kind: 'store', name: `Mala ${tag()}`, segment: 'dealer', force: true, reason: 'Tienda de prueba distinta a las demás', recruitedBy: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('en una tienda que venía sin dato, quien dirige lo fija una vez y llega a sus negocios abiertos', async () => {
    const a = await imported()
    const jade = await ctxFor('jade.kim')
    const kira = await ctxFor('kira.dunn')
    await admin`update crm.accounts set owner_id = ${jade.user.id} where id = ${a}`
    const deal = await createDeal(jade, { accountId: a, pipelineId: await uid('p-us-dealer'), title: `Alta ${tag()}`, nextStep: 'Call the owner', nextStepDue: today })
    expect(await dealRecruiter(jade, deal)).toBeNull()
    await expect(setRecruiter(jade, a, 'field_team')).rejects.toMatchObject({ code: 'forbidden' })
    await setRecruiter(kira, a, await uid('ag-us-2'))
    expect((await storeRecord(kira, a, 'US'))!).toMatchObject({ recruited_by: 'partner', recruited_agency: 'Socio Ejemplo (sintético)' })
    expect(await dealRecruiter(jade, deal)).toEqual({ recruited_by: 'partner', agency: 'Socio Ejemplo (sintético)' })
    expect((await audits('account.recruiter_set', a))[0]?.after).toMatchObject({ recruited_by: 'partner' })
    await expect(setRecruiter(kira, a, 'field_team')).rejects.toMatchObject({ code: 'set_once' })
  })
})

describe('E9.F13: Tax ID, solo los últimos 4', () => {
  it('se captura una vez, se guardan los últimos 4 y el número completo no queda en ningún lado', async () => {
    const { jade, id } = await store()
    expect(protectedDataAdapter().mode).toBe('off')
    const out = await setTaxId(jade, id, '12-3456789')
    expect(out).toEqual({ last4: '6789', full: true, vault: 'off' })
    expect((await one(admin<{ tax_id_last4: string; tax_id_blind_ix: string | null }[]>`select tax_id_last4, tax_id_blind_ix from crm.accounts where id = ${id}`))).toEqual({ tax_id_last4: '6789', tax_id_blind_ix: null })
    // ni la bitácora ni el outbox ni la fila guardan el número
    const leak = await one(admin<{ n: number }[]>`select (select count(*) from crm.audit_events where object_id = ${id} and (before::text like '%123456789%' or after::text like '%123456789%' or after::text like '%6789%'))
      + (select count(*) from crm.outbox_events where aggregate_id = ${id} and payload::text like '%6789%')
      + (select count(*) from crm.accounts where id = ${id} and to_jsonb(accounts)::text like '%123456789%') as n`)
    expect(Number(leak.n)).toBe(0)
    expect((await audits('account.tax_id_set', id))[0]).toMatchObject({ after: { has: true, full_offered: true } })
    // los documentos lo reciben ya capturado, enmascarado
    expect(await documentTaxId(jade, id)).toEqual({ text: '•••••6789', complete: false })
    // solo los últimos 4, o borrarlo
    expect(await setTaxId(jade, id, '4321')).toMatchObject({ last4: '4321', full: false, vault: null })
    await expect(setTaxId(jade, id, '12')).rejects.toMatchObject({ code: 'invalid' })
    await setTaxId(jade, id, '')
    expect(await documentTaxId(jade, id)).toBeNull()
    // leadership solo lee
    await expect(setTaxId(await ctxFor('luis.tovar'), id, '1111')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('el adaptador simulado (solo pruebas) anota que habría salido un valor, nunca el valor', async () => {
    const { jade, id } = await store()
    process.env.PROTECTED_DATA_VAULT = 'simulated'
    try {
      expect(protectedDataAdapter().mode).toBe('simulated')
      expect(await setTaxId(jade, id, '98-7654321')).toMatchObject({ last4: '4321', vault: 'simulated' })
      expect(simulatedVault().at(-1)).toEqual({ account_id: id, length: 9, last4: '4321' })
      expect(await protectedDataAdapter().readTaxId(id)).toBeNull()
    } finally {
      delete process.env.PROTECTED_DATA_VAULT
    }
    // fuera de pruebas la variable no lo enciende
    const env = process.env.APP_ENV
    process.env.APP_ENV = 'production'
    process.env.PROTECTED_DATA_VAULT = 'simulated'
    try {
      expect(protectedDataAdapter().mode).toBe('off')
    } finally {
      process.env.APP_ENV = env
      delete process.env.PROTECTED_DATA_VAULT
    }
  })
})

describe('E9.F8, F9, F10 y E10.F2: portafolio de carriers en la tienda', () => {
  it('Operaciones mantiene cada carrier en la tienda con estado, fechas, identificador, kit, SIMs y capacitación', async () => {
    const { jade, id } = await store()
    const tom = await ctxFor('tom.reyes')
    const north = await provider('carrier_north')
    const empty = (await storeRecord(jade, id, 'US'))!
    // E9.F9: sin movimiento no aparece ningún carrier; los vigentes se ofrecen para agregar
    expect(empty.carriers).toEqual([])
    expect(empty.available.map((c) => c.label_en)).toEqual(['North carrier', 'Coast carrier'])
    await setCarrierDetail(tom, id, { providerId: north, status: 'submitted', carrierRef: 'NORTH-7781', kitSentOn: '2026-11-02', simsOrdered: '40', trainingOn: '' })
    let rec = (await storeRecord(jade, id, 'US'))!
    expect(rec.carriers).toHaveLength(1)
    expect(rec.carriers[0]).toMatchObject({ label_en: 'North carrier', ref_label: 'North dealer code', status: 'submitted', carrier_ref: 'NORTH-7781', kit_sent_on: '2026-11-02', sims_ordered: 40, training_on: null, products: 0 })
    expect(rec.carriers[0]!.submitted_at).not.toBeNull()
    expect(rec.available.map((c) => c.label_en)).toEqual(['Coast carrier'])
    // aprobar deja la fecha de aprobación; la capacitación se anota después
    await setCarrierDetail(tom, id, { providerId: north, status: 'approved', carrierRef: 'NORTH-7781', kitSentOn: '2026-11-02', simsOrdered: '40', trainingOn: '2026-11-10' })
    rec = (await storeRecord(jade, id, 'US'))!
    expect(rec.carriers[0]).toMatchObject({ status: 'approved', training_on: '2026-11-10' })
    expect(rec.carriers[0]!.decided_at).not.toBeNull()
    expect((await audits('account.carrier_detail_set', id))[0]).toMatchObject({ before: { training_on: null }, after: { training_on: '2026-11-10', carrier_ref: 'NORTH-7781' } })
    expect((await audits('account.product_set', id)).length).toBeGreaterThanOrEqual(2)
    // quien vende lo ve y no lo cambia (E9.F10), ni por el comando ni directo en la base
    await expect(setCarrierDetail(jade, id, { providerId: north, status: 'active' })).rejects.toMatchObject({ code: 'forbidden' })
    expect(await asPersona('jade.kim', (tx) => attempt(tx, (sp) => sp`update crm.account_products set carrier_ref = 'X' where account_id = ${id}`))).toBe('0 rows')
    // validaciones
    await expect(setCarrierDetail(tom, id, { providerId: north, status: 'approved', simsOrdered: '-3' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setCarrierDetail(tom, id, { providerId: north, status: 'approved', kitSentOn: '2026-13-40' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setCarrierDetail(tom, id, { providerId: north, status: 'no' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setCarrierDetail(tom, id, { providerId: await one(admin<{ id: string }[]>`select id from crm.ops_catalog where market_code = 'MX' and kind = 'provider' limit 1`).then((r) => r.id), status: 'requested' })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('es un solo modelo: lo que Operaciones marca en un negocio aparece en el portafolio de la tienda, y el detalle se queda', async () => {
    const { jade, id } = await store()
    const tom = await ctxFor('tom.reyes')
    const coast = await provider('carrier_coast')
    const deal = await createDeal(jade, { accountId: id, pipelineId: await uid('p-us-dealer'), title: `Alta ${tag()}`, nextStep: 'Call the owner', nextStepDue: today })
    await setOpsCheck(tom, deal, coast, { status: 'sent' })
    let rec = (await storeRecord(jade, id, 'US'))!
    expect(rec.carriers.map((c) => [c.label_en, c.status])).toEqual([['Coast carrier', 'submitted']])
    expect(rec.carriers[0]!.deal_id).toBe(deal)
    // Operaciones completa el detalle en la tienda y después aprueba desde el negocio: el detalle no se pierde
    await setCarrierDetail(tom, id, { providerId: coast, status: 'submitted', carrierRef: 'COAST-55', simsOrdered: '12' })
    await setOpsCheck(tom, deal, coast, { status: 'approved' })
    rec = (await storeRecord(jade, id, 'US'))!
    expect(rec.carriers[0]).toMatchObject({ status: 'approved', carrier_ref: 'COAST-55', sims_ordered: 12 })
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.account_products where account_id = ${id} and provider_id = ${coast}`)).n).toBe(1)
  })

  it('los carriers retirados se guardan como texto y un carrier dado de baja del catálogo sigue a la vista en la tienda que lo tuvo', async () => {
    const { jade, id } = await store()
    const tom = await ctxFor('tom.reyes')
    await setStoreProfile(tom, id, { retiredCarriers: 'Operador Antiguo (hasta 2024)' })
    expect((await storeRecord(jade, id, 'US'))!.retired_carriers).toBe('Operador Antiguo (hasta 2024)')
    await expect(setStoreProfile(jade, id, { retiredCarriers: 'otro' })).rejects.toMatchObject({ code: 'forbidden' })
    const north = await provider('carrier_north')
    await setCarrierDetail(tom, id, { providerId: north, status: 'active' })
    await admin`update crm.ops_catalog set is_active = false where id = ${north}`
    try {
      const rec = (await storeRecord(jade, id, 'US'))!
      expect(rec.carriers[0]).toMatchObject({ status: 'active', is_active: false })
      const other = await store()
      expect((await storeRecord(jade, other.id, 'US'))!.available.some((c) => c.id === north)).toBe(false)
    } finally {
      await admin`update crm.ops_catalog set is_active = true where id = ${north}`
    }
  })

  it('administración nombra el identificador que da cada carrier', async () => {
    const coast = await provider('carrier_coast')
    await expect(setProviderRefLabel(await ctxFor('robert.hale'), coast, 'Coast ID')).rejects.toMatchObject({ code: 'forbidden' })
    await setProviderRefLabel(await ctxFor('nora.salas'), coast, 'Coast ID')
    expect((await audits('account.carrier_label_set', coast))[0]?.after).toMatchObject({ ref_label: 'Coast ID' })
    const { jade, id } = await store()
    expect((await storeRecord(jade, id, 'US'))!.available.find((c) => c.id === coast)?.ref_label).toBe('Coast ID')
  })
})

describe('E9.F11: los demás campos de la tienda se conservan', () => {
  it('US tiene los 15 campos de la lista, agrupados como los lee el equipo', async () => {
    const jade = await ctxFor('jade.kim')
    const defs = await fieldDefs(jade, 'account', 'US', 'dealer')
    const groups = resolveKept(defs)
    expect(groups.map((g) => [g.id, g.fields.length])).toEqual([['account', 6], ['churn', 2], ['empower', 3], ['hdn', 4]])
    expect(groups.flatMap((g) => g.fields).length).toBe(KEPT_GROUPS.flatMap((g) => g.slots).length)
    // México no los ve
    expect(resolveKept(await fieldDefs(await ctxFor('marco.pena'), 'account', 'MX', 'd2d'))).toEqual([])
  })

  it('si la importación ya trajo un campo con ese nombre, se usa el importado y no se crea otro', async () => {
    await admin.begin(async (tx) => {
      await tx`delete from crm.field_definitions where key = 'us_dba'`
      await tx`insert into crm.field_definitions (object, key, label_es, label_en, data_type, source, external_ref) values ('account', 'dba', 'DBA', 'DBA', 'text', 'pipedrive', 'abc123')`
      await tx`select crm.dealer_record_setup('US', false)`
      const rows = await tx<{ key: string }[]>`select key from crm.field_definitions where object = 'account' and lower(label_en) = 'dba'`
      expect(rows.map((r) => r.key)).toEqual(['dba'])
      throw new Error('rollback')
    }).catch((e: Error) => { if (e.message !== 'rollback') throw e })
    expect(resolveKept([{ key: 'dba', label_en: 'DBA' }, { key: 'store_owner', label_en: 'Store Owner' }]).map((g) => g.fields.map((f) => f.key))).toEqual([['dba', 'store_owner']])
  })
})
