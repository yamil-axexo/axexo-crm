import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ctxFor, owner } from './helpers'
// @ts-expect-error módulo de soporte sin tipos
import { startMock } from '../support/pipedrive-mock.mjs'
import { importStep, startImport, purgeRaw, type Mode } from '@/domain/pipedrive/import'
import { moveDeal } from '@/domain/deals'
import { configurePipeline, updateCustom } from '@/domain/custom'
import { updateStage } from '@/domain/admin'
import { getImportStatus } from '@/dal/imports'
import { loadCtx, type Ctx } from '@/server/context'
import { withUser } from '@/server/db'

type Mock = { data: Record<string, Record<string, unknown>[]> & { code: (o: string, n: string) => string }; calls: string[]; close: () => Promise<void> }
const admin = owner()
let mock: Mock
let nora: Ctx
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const card = ['4111', '1111', '1111', '1111'].join(' ')

async function runImport(mode: Mode) {
  await startImport(nora, mode)
  for (let i = 0; i < 400; i++) {
    const r = await importStep(nora, 4000)
    if (r.status === 'done') return
    if (r.status === 'failed' || r.status === 'idle') throw new Error(`import ${r.status} at ${r.phase}: ${JSON.stringify((await getImportStatus(nora)).run?.issues)}`)
    if (r.waitMs) await new Promise((res) => setTimeout(res, Math.min(r.waitMs!, 1500)))
  }
  throw new Error('import did not finish')
}
const account = (orgId: number) => one(admin`
  select a.* from crm.accounts a join crm.account_aliases al on al.account_id = a.id where al.system = 'pipedrive' and al.external_id = ${String(orgId)}`)
const ref = async (object: string, id: number | string) => (await one(admin`select internal_id from crm.external_refs where system = 'pipedrive' and object = ${object} and external_id = ${String(id)}`)).internal_id as string
const skipped = async (object: string, id: number | string) => (await admin`select load_note from crm.import_raw where source = 'pipedrive' and object = ${object} and external_id = ${String(id)}`)[0]?.load_note

beforeAll(async () => {
  mock = await startMock(Number(process.env.UNIT_PIPEDRIVE_PORT ?? 45991), { rateLimitOnce: true })
  nora = await ctxFor('nora.salas')
  await runImport('full')
}, 120_000)
afterAll(async () => {
  await mock.close()
  await admin.end()
})

describe('migración desde Pipedrive: configuración espejo', () => {
  it('termina sin errores y deja contado lo que no entra', async () => {
    const s = await getImportStatus(nora)
    expect(s.run).toMatchObject({ status: 'done', mode: 'full' })
    expect(s.run!.issues.filter((i) => i.code === 'error')).toEqual([])
    expect(s.run!.issues).toContainEqual(expect.objectContaining({ code: 'pipeline_out_of_scope', detail: 'CO - Pilot' }))
    expect(s.run!.issues).toContainEqual(expect.objectContaining({ code: 'config_unavailable', detail: 'permission_set' }))
    expect(s.run!.stats.extracted).toMatchObject({ organization: 520, person: 604, deal: 358, lead: 15, activity: 5, note: 2, product: 2, deal_product: 2 })
    expect(s.run!.stats.created).toMatchObject({ organization: 519, person: 603, lead: 15, product: 2, deal_product: 2 })
    expect(s.run!.stats.skipped).toMatchObject({ 'organization:no_market': 1, 'person:no_market': 1, 'deal:pipeline_out_of_scope': 1, 'deal:archived_open': 1, 'activity:no_link': 1 })
    expect(s.raw.every((r) => r.pending === 0)).toBe(true)
  })

  it('copia embudos y etapas en su orden, con Ganado y Perdido al final, y el cierre por transacción según el tipo de embudo', async () => {
    const pipes = await admin`select p.name, p.market_code, p.motor, p.close_by_transaction from crm.pipelines p
      join crm.external_refs r on r.internal_id = p.id and r.object = 'pipeline' order by p.position`
    expect(pipes.map((p) => [p.name, p.market_code, p.motor, p.close_by_transaction])).toEqual([
      ['MX - D2D Store Enrollment', 'MX', 'd2d', true], ['US - Dealer Enrollment', 'US', 'dealer', true], ['US - Sales Orders', 'US', 'orders', false]])
    const stages = await admin`select s.name_en, s.kind, s.rot_days from crm.stages s where s.pipeline_id = ${await ref('pipeline', 7)} order by s.position`
    expect(stages.map((s) => s.name_en)).toEqual(['Prospect', 'Contacted', 'Committed', 'Migrating', 'Won', 'Lost'])
    expect(stages.map((s) => s.kind)).toEqual(['open', 'open', 'open', 'open', 'won', 'lost'])
    expect(stages[0]!.rot_days).toBe(30)
  })

  it('registra cada campo custom con su destino; el Tax ID queda restringido (DATA-06)', async () => {
    const defs = await admin`select object, key, data_type, mapped_to, data_class, options from crm.field_definitions where source = 'pipedrive'`
    const get = (o: string, k: string) => defs.find((d) => d.object === o && d.key === k)
    expect(get('account', 'market')).toMatchObject({ mapped_to: 'core:market' })
    expect(get('account', 'tax_id')).toMatchObject({ mapped_to: 'policy:last4', data_class: 'confidential' })
    expect(get('account', 'carriers_activos')).toMatchObject({ data_type: 'multiselect', options: ['H2O', 'Lyca'], mapped_to: null })
    expect(get('deal', 'requested_credit_line')).toMatchObject({ data_type: 'money' })
    expect(get('activity', 'reason_for_visit')).toMatchObject({ data_type: 'select' })
    expect((await admin`select 1 from crm.loss_reasons where code = 'pd_went_with_competitor'`).length).toBe(1)
  })

  it('las personas de Pipedrive existen como usuarios y entran como ventas donde llevan registros', async () => {
    const rows = await admin`select u.email::text, u.is_active, m.role, m.market_code from crm.users u
      left join crm.memberships m on m.user_id = u.id and m.valid_to is null where u.email like '%@contigo.test' and u.id in (
        select internal_id from crm.external_refs where object = 'user') order by u.email`
    expect(rows.map((r) => [r.email, r.is_active, r.role, r.market_code])).toEqual([
      ['omar.vidal@contigo.test', true, 'rep', 'US'], ['paz.ibarra@contigo.test', false, null, null], ['rita.solano@contigo.test', true, 'rep', 'MX']])
  })

  it('el inventario de conexiones no guarda credenciales ni parámetros de la URL', async () => {
    const w = await one(admin`select payload from crm.import_raw where object = 'cfg:webhook'`)
    expect(w.payload).toMatchObject({ event_object: 'deal', target: 'https://hooks.example.com/…' })
    expect(JSON.stringify(w.payload)).not.toMatch(/never-stored|not-stored|http_auth/)
    expect(JSON.stringify((await one(admin`select payload from crm.import_raw where object = 'cfg:user' and external_id = '11'`)).payload)).not.toMatch(/\+5255/)
  })
})

describe('migración desde Pipedrive: registros', () => {
  it('una organización completa llega con columnas del modelo, campos adicionales, alias y sin el identificador fiscal completo', async () => {
    const a = await account(1001)
    expect(a).toMatchObject({ market_code: 'MX', kind: 'store', lifecycle: 'active', phone: '+525561234567', locality: 'Ciudad de México', region: 'CDMX', postal_code: '06000', country: 'MX', tax_id_last4: '1000' })
    expect(Number(a.latitude)).toBeCloseTo(19.4326)
    expect(a.custom).toMatchObject({ monthly_volume: 48250.75, carriers_activos: ['H2O', 'Lyca'], first_transaction_date: '2026-08-14', notas_internas: 'Prefiere visita por la mañana', labels: ['Customer'] })
    for (const k of ['market', 'lifecycle_stage', 'tax_id', 'latitude', 'phone_number_associated', 'city', 'merchant_id_emida']) expect(a.custom).not.toHaveProperty(k)
    const aliases = await admin`select system, external_id from crm.account_aliases where account_id = ${a.id} order by system`
    expect(aliases.map((x) => [x.system, x.external_id])).toEqual([['emida', 'EM-1001'], ['pipedrive', '1001']])
    const leak = await admin`select 1 from crm.import_raw where payload::text like '%XAXX010101000%' union all select 1 from crm.accounts where custom::text like '%XAXX010101000%'`
    expect(leak.length).toBe(0)
    expect((await admin`select layer from crm.account_attributions where account_id = ${a.id} order by layer`).map((x) => x.layer)).toEqual(['origin', 'owner'])
  })

  it('resuelve el mercado por el campo, por la dirección o por los deals; si no hay cómo, no carga y lo cuenta', async () => {
    const sunrise = await account(1002)
    expect(sunrise).toMatchObject({ market_code: 'US', segment: 'Dealer', country: 'US', locality: 'Miami' })
    expect((await one(admin`select name from crm.territories where id = ${sunrise.territory_id}`)).name).toBe('Florida')
    expect(await account(1003)).toMatchObject({ market_code: 'US', lifecycle: 'active' })
    expect(await skipped('organization', 1004)).toBe('no_market')
  })

  it('un valor que no cabe en la columna del modelo no se pierde: queda como campo adicional; un ID de EMIDA repetido no se liga dos veces', async () => {
    const b = await account(1005)
    expect(b.phone).toBeNull()
    expect(b.custom).toMatchObject({ phone_number_associated: 'ext. 12' })
    expect((await admin`select 1 from crm.account_aliases where account_id = ${b.id} and system = 'emida'`).length).toBe(0)
  })

  it('las personas llegan como contactos con rol, teléfono E.164 y sus campos', async () => {
    const id = await ref('person', 5001)
    const c = await one(admin`select c.*, ac.role, ac.account_id from crm.contacts c join crm.account_contacts ac on ac.contact_id = c.id where c.id = ${id}`)
    expect(c).toMatchObject({ full_name: 'Elena Prado', phone: '+525561234567', email: 'elena.prado@contigo.test', role: 'owner', market_code: 'MX' })
    expect(c.account_id).toBe((await account(1001)).id)
    expect(c.custom).toMatchObject({ preferred_language: 'Spanish', whatsapp: '+525561234567', phone: '5561234567, 55 1111 2222' })
    expect(c.custom).not.toHaveProperty('email')
    expect(await skipped('person', 5004)).toBe('no_market')
  })

  it('los deals conservan embudo, etapa, estado, montos, campos y su historia de etapas', async () => {
    const d = await one(admin`select d.*, s.name_en as stage, s.kind from crm.deals d join crm.stages s on s.id = d.stage_id where d.id = ${await ref('deal', 7001)}`)
    expect(d).toMatchObject({ market_code: 'MX', status: 'open', stage: 'Contacted', currency: 'MXN', title: 'Alta La Esperanza', next_step: 'Enviar contrato' })
    expect(Number(d.amount_minor)).toBe(150050)
    expect(d.decision_maker_id).toBe(await ref('person', 5001))
    expect(d.custom).toMatchObject({ lead_source: 'Field canvass', products_wanted: ['Domestic top-up', 'Bill pay'], requested_credit_line: { amount: 25000, currency: 'MXN' }, sales_rep: 'Omar Vidal', label: ['AWPE Welcome Sent'], expected_close_date: '2026-12-01' })
    const won = await one(admin`select d.status, d.closed_by, d.won_at, s.kind from crm.deals d join crm.stages s on s.id = d.stage_id where d.id = ${await ref('deal', 7002)}`)
    expect(won).toMatchObject({ status: 'won', closed_by: 'manual', kind: 'won' })
    expect(won.won_at).toBeTruthy()
    const events = await admin`select t.name_en, e.cause from crm.deal_stage_events e join crm.stages t on t.id = e.to_stage_id where e.deal_id = ${await ref('deal', 7002)} order by e.at`
    expect(events.map((e) => [e.name_en, e.cause])).toEqual([['Presented', 'import'], ['Won', 'import']])
    expect(await one(admin`select status, loss_reason_code, loss_note from crm.deals where id = ${await ref('deal', 7003)}`)).toMatchObject({ status: 'lost', loss_reason_code: 'pd_went_with_competitor' })
    expect((await one(admin`select status from crm.deals where id = ${await ref('deal', 7007)}`)).status).toBe('won')
    expect(await skipped('deal', 7005)).toBe('pipeline_out_of_scope')
    expect(await skipped('deal', 7008)).toBe('archived_open')
  })

  it('un deal sin organización no se pierde: nace un comercio mínimo y se liga a la persona', async () => {
    const d = await one(admin`select d.account_id, a.name, a.market_code from crm.deals d join crm.accounts a on a.id = d.account_id where d.id = ${await ref('deal', 7004)}`)
    expect(d).toMatchObject({ name: 'Nadia Ross', market_code: 'US' })
    expect((await admin`select 1 from crm.account_contacts where account_id = ${d.account_id} and contact_id = ${await ref('person', 5003)}`).length).toBe(1)
  })

  it('los pedidos traen sus productos', async () => {
    const items = await admin`select i.name, i.quantity::float8 as q, i.sum_minor::int as s, p.code from crm.deal_items i left join crm.products p on p.id = i.product_id
      where i.deal_id = ${await ref('deal', 7006)} order by i.position`
    expect(items.map((i) => [i.name, i.q, i.s, i.code])).toEqual([['SIM kit (synthetic)', 10, 25000, 'SIM-KIT'], ['Terminal stand (synthetic)', 4, 10000, 'STAND']])
    expect((await one(admin`select prices from crm.products where code = 'SIM-KIT'`)).prices).toEqual([{ currency: 'USD', price_minor: 2500 }])
  })

  it('los leads llegan ligados a su comercio, con etiquetas y campos; los archivados entran como descartados', async () => {
    const l = await one(admin`select * from crm.leads where id = ${await ref('lead', '11111111-1111-4111-8111-111111111111')}`)
    expect(l).toMatchObject({ market_code: 'MX', source: 'import', status: 'new', business_name: 'Abarrotes La Esperanza (sintético)', contact_name: 'Elena Prado', phone: '+525561234567', message: 'Segunda tienda La Esperanza', motor: 'd2d' })
    expect(l.account_id).toBe((await account(1001)).id)
    expect(l.custom).toMatchObject({ lead_source: 'Manually created', lead_labels: ['Hot'], lead_value: { amount: 5000, currency: 'MXN' } })
    expect(await one(admin`select status, disqualify_code from crm.leads where id = ${await ref('lead', '44444444-4444-4444-8444-444444444444')}`)).toMatchObject({ status: 'disqualified', disqualify_code: 'pd_archived' })
    expect((await one(admin`select market_code, business_name from crm.leads where id = ${await ref('lead', '22222222-2222-4222-8222-222222222222')}`))).toMatchObject({ market_code: 'US', business_name: 'Nadia Ross wants terminals' })
  })

  it('actividades y notas caen en el timeline; una tarjeta escrita en una nota no entra (SEC-08)', async () => {
    const call = await one(admin`select * from crm.activities where id = ${await ref('activity', 9001)}`)
    expect(call).toMatchObject({ kind: 'call', source: 'import', type_label: 'Call', market_code: 'MX' })
    expect(call.done_at).toBeTruthy()
    expect(call.body).toContain('[dato omitido]')
    expect(call.custom).toMatchObject({ outcome: 'Connected' })
    const leak = await admin`select 1 from crm.import_raw where payload::text like ${'%' + card + '%'} union all select 1 from crm.activities where body like ${'%' + card + '%'}`
    expect(leak.length).toBe(0)
    const visit = await one(admin`select * from crm.activities where id = ${await ref('activity', 9002)}`)
    expect(visit).toMatchObject({ kind: 'meeting', type_label: 'Visit', done_at: null })
    expect(visit.custom).toMatchObject({ reason_for_visit: 'First Visit - Prospecting', priority: 'High' })
    expect(new Date(visit.due_at).toISOString()).toBe('2026-12-10T16:30:00.000Z')
    expect((await one(admin`select lead_id from crm.activities where id = ${await ref('activity', 9005)}`)).lead_id).toBe(await ref('lead', '22222222-2222-4222-8222-222222222222'))
    expect(await skipped('activity', 9004)).toBe('no_link')
    const note = await one(admin`select kind, subject, body, account_id from crm.activities where id = ${await ref('note', 9501)}`)
    expect(note).toMatchObject({ kind: 'note', subject: 'Pidio catalogo de carriers' })
    expect(note.body).toBe('Segunda linea con detalle & precio')
  })

  it('RLS sigue mandando sobre lo importado: cada quien ve su mercado', async () => {
    const rita = (await loadCtx((await one(admin`select id from crm.users where email = 'rita.solano@contigo.test'`)).id, 'es'))!
    expect(rita.markets.map((m) => m.code)).toEqual(['MX'])
    const seen = await withUser(rita.user.id, (tx) => tx<{ market_code: string; n: number }[]>`
      select a.market_code, count(*)::int as n from crm.accounts a join crm.account_aliases al on al.account_id = a.id and al.system = 'pipedrive' group by 1`)
    expect(seen.map((s) => s.market_code)).toEqual(['MX'])
    expect((await withUser(rita.user.id, (tx) => tx`select 1 from crm.import_raw limit 1`)).length).toBe(0)
  })
})

describe('migración desde Pipedrive: repetir, traer cambios y operar después', () => {
  it('importar todo otra vez no duplica nada', async () => {
    const before = await one(admin`select (select count(*)::int from crm.accounts) as a, (select count(*)::int from crm.contacts) as c, (select count(*)::int from crm.deals) as d,
      (select count(*)::int from crm.activities) as x, (select count(*)::int from crm.deal_stage_events) as e, (select count(*)::int from crm.memberships) as m`)
    await runImport('full')
    const after = await one(admin`select (select count(*)::int from crm.accounts) as a, (select count(*)::int from crm.contacts) as c, (select count(*)::int from crm.deals) as d,
      (select count(*)::int from crm.activities) as x, (select count(*)::int from crm.deal_stage_events) as e, (select count(*)::int from crm.memberships) as m`)
    expect(after).toEqual(before)
    const s = await getImportStatus(nora)
    expect(s.run!.stats.updated).toMatchObject({ organization: 519, deal: 356 })
    expect(s.run!.stats.created?.organization ?? 0).toBe(0)
  }, 120_000)

  it('"traer solo lo que cambió" pide a Pipedrive únicamente lo modificado y lo refleja', async () => {
    const org = mock.data.organizations!.find((o) => o.id === 1002)!
    org.name = 'Sunrise Wireless Miami (synthetic)'
    org.update_time = new Date().toISOString()
    const deal = mock.data.deals!.find((d) => d.id === 7001)!
    Object.assign(deal, { stage_id: 47, update_time: new Date().toISOString() })
    await runImport('delta')
    const s = await getImportStatus(nora)
    expect(s.run!.stats.extracted).toMatchObject({ organization: 1, deal: 1 })
    expect((await account(1002)).name).toBe('Sunrise Wireless Miami (synthetic)')
    const d = await one(admin`select s.name_en from crm.deals d join crm.stages s on s.id = d.stage_id where d.id = ${await ref('deal', 7001)}`)
    expect(d.name_en).toBe('Committed')
    const ev = await admin`select t.name_en from crm.deal_stage_events e join crm.stages t on t.id = e.to_stage_id where e.deal_id = ${await ref('deal', 7001)} order by e.at`
    expect(ev.map((e) => e.name_en)).toEqual(['Contacted', 'Committed'])
  }, 60_000)

  it('"volver a aplicar el mapeo" no llama a Pipedrive', async () => {
    const calls = mock.calls.length
    await runImport('remap')
    expect(mock.calls.length).toBe(calls)
    expect((await getImportStatus(nora)).run).toMatchObject({ status: 'done', mode: 'remap' })
  }, 120_000)

  it('PIPE-06 por embudo: un pedido se gana a mano; un alta solo con la primera transacción', async () => {
    await moveDeal(nora, await ref('deal', 7006), (await one(admin`select id from crm.stages where pipeline_id = ${await ref('pipeline', 11)} and kind = 'won'`)).id)
    expect(await one(admin`select status, closed_by from crm.deals where id = ${await ref('deal', 7006)}`)).toMatchObject({ status: 'won', closed_by: 'manual' })
    const wonMx = (await one(admin`select id from crm.stages where pipeline_id = ${await ref('pipeline', 7)} and kind = 'won'`)).id
    await expect(moveDeal(nora, await ref('deal', 7100), wonMx)).rejects.toMatchObject({ code: 'won_by_transaction' })
    const pipe = await ref('pipeline', 7)
    const migrating = (await one(admin`select id from crm.stages where pipeline_id = ${pipe} and name_en = 'Migrating'`)).id
    await configurePipeline(nora, pipe, { closeByTransaction: true, awaitingStageId: migrating })
    expect((await admin`select name_en from crm.stages where pipeline_id = ${pipe} and kind = 'awaiting_txn'`).map((s) => s.name_en)).toEqual(['Migrating'])
    await runImport('remap')
    expect((await admin`select name_en from crm.stages where pipeline_id = ${pipe} and kind = 'awaiting_txn'`).length).toBe(1)
  }, 120_000)

  it('los campos adicionales se editan con validación por tipo y dejan bitácora', async () => {
    const a = await account(1001)
    expect(await updateCustom(nora, 'account', a.id, { monthly_volume: '50000', carriers_activos: ['Lyca'], notas_internas: '' })).toBe(3)
    const after = (await account(1001)).custom
    expect(after).toMatchObject({ monthly_volume: 50000, carriers_activos: ['Lyca'] })
    expect(after).not.toHaveProperty('notas_internas')
    const log = await one(admin`select before, after from crm.audit_events where object_id = ${a.id} and action = 'account.custom_updated' order by at desc limit 1`)
    expect(log.before).toMatchObject({ monthly_volume: 48250.75 })
    await expect(updateCustom(nora, 'account', a.id, { carriers_activos: ['Inventado'] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateCustom(nora, 'account', a.id, { notas_internas: `tarjeta ${card}` })).rejects.toMatchObject({ code: 'invalid' })
    expect(await updateCustom(nora, 'account', a.id, { tax_id: 'ABC', market: 'US' })).toBe(0) // restringido y de modelo: no se editan por aquí
    const rita = (await loadCtx((await one(admin`select id from crm.users where email = 'omar.vidal@contigo.test'`)).id, 'es'))!
    await expect(updateCustom(rita, 'account', a.id, { monthly_volume: '1' })).rejects.toMatchObject({ code: 'not_found' }) // otro mercado: RLS no deja ni verlo
  })

  it('una etapa que administración corrigió conserva su nombre y sus días al volver a importar', async () => {
    const [edited, other] = await admin<{ id: string; name_en: string; rot_days: number }[]>`select id, name_en, rot_days from crm.stages where code like 'pd\\_%' order by id limit 2`
    await updateStage(nora, edited!.id, { nameEs: 'Etapa corregida a mano', nameEn: edited!.name_en, rotDays: edited!.rot_days + 3, requiredFields: [] })
    await runImport('remap')
    expect(await one(admin`select name_es, name_en, rot_days from crm.stages where id = ${edited!.id}`)).toMatchObject({ name_es: 'Etapa corregida a mano', name_en: edited!.name_en, rot_days: edited!.rot_days + 3 })
    // Una etapa que nadie tocó sigue trayendo el nombre de Pipedrive.
    expect(await one(admin`select name_es, rot_days from crm.stages where id = ${other!.id}`)).toMatchObject({ name_es: other!.name_en, rot_days: other!.rot_days })
  })

  it('vaciar la copia cruda no toca lo cargado', async () => {
    const n = await purgeRaw(nora)
    expect(n).toBeGreaterThan(1000)
    expect((await admin`select 1 from crm.import_raw where object not like 'cfg:%' limit 1`).length).toBe(0)
    expect((await account(1001)).name).toBe('Abarrotes La Esperanza (sintético)')
  })
})
