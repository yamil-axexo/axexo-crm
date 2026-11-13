import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { ctxFor, owner } from './helpers'
import { createAccount } from '@/domain/accounts'
import { createDeal } from '@/domain/deals'
import { setRecruiter, setTaxId } from '@/domain/store-record'
import { storeRecord } from '@/dal/store-record'
import { getLtPanel } from '@/dal/boards'
import { withRequestId } from '@/server/request-id'
import { isoDay } from '@/lib/format'

// Integración 95-2 (mercados, seguridad, gobierno, embudo, us-ficha): lo que cruza paquetes. Un solo catálogo de agencias,
// un solo modelo de identificador fiscal con un solo resguardo, un solo alcance por entidad legal, un solo identificador de
// petición en las dos bitácoras, la telemetría fuera de la bitácora de la base y un solo modelo de WhatsApp por mercado.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x')
const uid = (k: string) => one(admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`).then((r) => r.id)
const today = isoDay(new Date(), 'America/New_York')

describe('una tienda de US de punta a punta (us-ficha, mercados, seguridad, gobierno)', () => {
  it('el Tax ID completo pasa por el modelo de mercados, con el mismo identificador de petición en la bitácora de la aplicación y en la de la base', async () => {
    const jade = await ctxFor('jade.kim')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Integra 95-2 ${tag()}`, segment: 'dealer', force: true, reason: 'Tienda de prueba de la integración' })
    const req = `int95-2-${tag()}${tag()}`
    const out = await withRequestId(req, () => setTaxId(jade, acc.id!, '12-3456789'))
    expect(out).toMatchObject({ last4: '6789', full: true, vault: 'off' })
    // un solo modelo: la fila de crm.tax_ids, últimos 4 y huella en el comercio; nunca el número completo
    const tax = await one(admin<{ last4: string; id_type: string; n: number }[]>`
      select last4, id_type, (select count(*)::int from crm.tax_ids x where x.account_id = ${acc.id!}) as n from crm.tax_ids where account_id = ${acc.id!} and valid_to is null`)
    expect(tax).toEqual({ last4: '6789', id_type: 'us_ein', n: 1 })
    const leak = await one(admin<{ n: number }[]>`
      select ((select count(*) from audit.data_log where row_id = ${acc.id!} and (before::text like '%123456789%' or after::text like '%123456789%'))
            + (select count(*) from crm.audit_events where object_id = ${acc.id!} and after::text like '%123456789%'))::int as n`)
    expect(leak.n).toBe(0)
    // GOB-07 y SEG-03: el evento de la aplicación y el cambio de fila que escribe la base llevan el mismo identificador y la vía
    const ev = await one(admin<{ request_id: string }[]>`select request_id from crm.audit_events where action = 'taxid.captured' and object_id = ${acc.id!}`)
    expect(ev.request_id).toBe(req)
    const rows = await admin<{ via: string; request_id: string }[]>`select via, request_id from audit.data_log where table_name = 'accounts' and row_id = ${acc.id!}::text and request_id = ${req}`
    expect(rows.length).toBeGreaterThan(0)
  })

  it('un solo catálogo de agencias: el socio de la ficha de dealer y la agencia confinada viven en la misma tabla, y supervisión ve lo que recluta su equipo', async () => {
    const jade = await ctxFor('jade.kim')
    const kira = await ctxFor('kira.dunn')
    const sys = (await one(admin<{ id: string }[]>`select app.system_user_id() as id`)).id
    const store = (await one(admin<{ id: string }[]>`
      insert into crm.accounts (market_code, kind, name, segment, lifecycle, country, owner_id, created_by) values ('US', 'store', ${`Importada 95-2 ${tag()}`}, 'dealer', 'active', 'US', ${jade.user.id}, ${sys}) returning id`)).id
    const deal = await createDeal(jade, { accountId: store, pipelineId: await uid('p-us-dealer'), title: `Alta 95-2 ${tag()}`, nextStep: 'Call the store manager', nextStepDue: today })
    await setRecruiter(kira, store, await uid('ag-us-2'))
    // el socio queda en el comercio y baja al negocio; la tabla es la de 0027 con la clase de 0030
    expect((await storeRecord(kira, store, 'US'))!).toMatchObject({ recruited_by: 'partner' })
    expect(await one(admin<{ recruited_by: string; kind: string }[]>`
      select d.recruited_by, g.kind from crm.deals d join crm.agencies g on g.id = d.recruited_agency_id where d.id = ${deal}`)).toEqual({ recruited_by: 'partner', kind: 'partner' })
    const tables = await admin<{ n: number }[]>`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'crm' and c.relname like '%agenc%' and c.relkind = 'r'`
    expect(tables[0]!.n).toBe(1)
    // lo que marca la agencia confinada (sin "reclutado por") toma la clase de la agencia
    const confined = (await one(admin<{ recruited_by: string }[]>`
      insert into crm.accounts (market_code, kind, name, segment, lifecycle, country, recruited_agency_id, created_by)
      values ('MX', 'store', ${`Agencia 95-2 ${tag()}`}, 'd2d', 'prospect', 'MX', ${await uid('ag-mx-demo')}, ${sys}) returning recruited_by`))
    expect(confined.recruited_by).toBe('agency')
  })
})

describe('un solo modelo por concepto', () => {
  it('alcance por entidad legal: una sola versión (0026), y la regla de quién ve un comercio la usa', async () => {
    const fns = await admin<{ proname: string }[]>`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and proname in ('entity_open_markets', 'entity_limited_markets', 'my_entity_ids')`
    expect(fns.map((f) => f.proname).sort()).toEqual(['entity_limited_markets', 'my_entity_ids'])
    const pols = await admin<{ policyname: string }[]>`select policyname from pg_policies where schemaname = 'crm' and tablename in ('accounts', 'deals') and policyname like '%entity%' order by 1`
    expect(pols.map((p) => p.policyname)).toEqual(['accounts_entity', 'deals_entity'])
    const body = await one(admin<{ src: string }[]>`select prosrc as src from pg_proc where proname = 'can_see_account'`)
    expect(body.src).toContain('entity_limited_markets')
  })

  it('un solo resguardo de datos protegidos y un solo modelo de WhatsApp por mercado', () => {
    expect(existsSync('src/server/adapters/protected-data.ts')).toBe(false)
    const status = readFileSync('src/app/(app)/estado/page.tsx', 'utf8')
    expect(status).not.toContain('PROTECTED_DATA_VAULT')
    const notify = readFileSync('src/domain/notify.ts', 'utf8')
    expect(notify).toContain('crm.whatsapp_rates')
    expect(notify).not.toContain('whatsapp_unit_cost')
    expect(readFileSync('src/app/(app)/admin/avisos/page.tsx', 'utf8')).not.toContain('name="whatsapp_unit_cost"')
  })

  it('la telemetría de gobierno no lleva trigger de bitácora y toda otra tabla de crm sí, o tiene su motivo', async () => {
    const missing = await admin<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'crm' and c.relkind = 'r'
         and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'zz_audit_capture')
         and c.relname not in (select table_name from audit.excluded_tables)`
    expect(missing.map((m) => m.relname)).toEqual([])
    const tele = await admin<{ n: number }[]>`
      select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('request_metrics', 'error_events') and t.tgname = 'zz_audit_capture'`
    expect(tele[0]!.n).toBe(0)
  })

  it('el panel del LT convierte con la tasa vigente en la fecha de corte (mercados), no con la de hoy', async () => {
    const luis = await ctxFor('luis.tovar')
    const mx = (await getLtPanel(luis)).markets.find((m) => m.code === 'MX')!
    const expected = await one(admin<{ r: string | null }[]>`
      select (select usd_rate::text from app.fx_at('MXN', coalesce((select max(as_of) from crm.merchant_metrics_daily where market_code = 'MX'), current_date))) as r`)
    expect(mx.usd_rate).toBe(expected.r)
  })
})
