import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ctxFor, owner } from './helpers'
// @ts-expect-error módulo de soporte sin tipos
import { startMock } from '../support/pipedrive-mock.mjs'
import type { Ctx } from '@/server/context'
import { activity, ingestStoreSales, storeSalesFile } from '@/domain/store-sales'
import { storeSales, teamStoreSales } from '@/dal/store-sales'
import { simulatedStoreSalesFiles } from '@/server/adapters/sales-file'
import { findJob, runJob } from '@/server/jobs/runner'
import { JOBS } from '@/server/jobs/registry'
import { finishLoad, startLoad, watchLateLoads, withLoad } from '@/server/loads'
import { configureLoad, setLoadWindow } from '@/domain/data-loads'
import { withSystem } from '@/server/db'
import { ingestRouteCheckin, readRouteStores, routeStoresOut } from '@/domain/route-tool'
import { draftFor, emailDocument, generateDocument } from '@/domain/documents'
import { textPdf, wrap } from '@/lib/pdf'
import { confirmationFor, resetAllowed, resetTestMarket } from '@/domain/test-reset'
import { previewImport, runImport, undoImport, sheetLeadState } from '@/domain/csv-import'
import { importStep, startImport } from '@/domain/pipedrive/import'
import { pipedriveBackup, BACKUP_FORMAT } from '@/domain/pipedrive/backup'
import { systemContext } from './helpers'
import { createAccount } from '@/domain/accounts'

type Mock = { data: Record<string, unknown>; close: () => Promise<void> }
const admin = owner()
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
let nora: Ctx
let lucia: Ctx
let ana: Ctx

const storesOf = (email: string, n: number) => admin<{ id: string; ref: string; name: string }[]>`
  select a.id, al.external_id as ref, a.name from crm.account_aliases al join crm.accounts a on a.id = al.account_id join crm.users u on u.id = a.owner_id
   where al.system in ('s5','sales_core') and al.valid_to is null and a.kind = 'store' and a.archived_at is null and u.email = ${email}
   order by al.external_id limit ${n}`
const clearLoads = () => admin`delete from crm.load_runs`

beforeAll(async () => {
  nora = await ctxFor('nora.salas')
  lucia = await ctxFor('lucia.vega')
  ana = await ctxFor('ana.robles')
})
afterAll(async () => {
  await admin.end()
})

describe('E5.F1 / E5.F2: cifras de ventas por tienda', () => {
  it('el contrato rechaza archivos mal formados y cero o sin dato es "sin actividad"', () => {
    expect(storeSalesFile.safeParse({ contract: 'store_sales_daily', version: 1, as_of: '2026-11-12', file_name: 'x.json', rows: [] }).success).toBe(false)
    expect(storeSalesFile.safeParse({ contract: 'store_sales_daily', version: 1, as_of: '2026-11-12', file_name: 'x.json', rows: [{ merchant_ref: 'A', payments: [{ product: 'Recargas', mtd: 1 }] }] }).success).toBe(false)
    expect([activity(0), activity(null), activity(undefined), activity(7)]).toEqual([null, null, null, 7])
  })

  it('carga por Merchant ID, guarda por tienda y lo vacío queda vacío; se ve en la ficha y en Mi equipo', async () => {
    const [a, b] = await storesOf('lucia.vega@contigo.test', 2)
    const sys = await systemContext()
    const out = await ingestStoreSales(sys, {
      contract: 'store_sales_daily', version: 1, as_of: '2026-11-12', file_name: 'store-sales-2026-11-12.json',
      rows: [
        { merchant_ref: a!.ref, currency: 'MXN', activations: [{ carrier: 'Telcel', mtd: 12, prev_month: 30, d90: 80 }, { carrier: 'AT&T', mtd: 0, prev_month: null, d90: 4 }], payments: [{ product: 'Recargas', mtd: 150000, prev_month: 0, d90: 900000 }] },
        { merchant_ref: b!.ref, activations: [{ carrier: 'Telcel', mtd: 3 }] },
        { merchant_ref: 'NO-EXISTE-1', activations: [{ carrier: 'Telcel', mtd: 1 }] },
      ],
    })
    expect(out).toMatchObject({ status: 'loaded', rows: 3, matched: 2, unmatched: 1, lines: 4 })
    const s = (await storeSales(lucia, a!.id))!
    expect(s.as_of).toBe('2026-11-12')
    const att = s.lines.find((l) => l.line_key === 'AT&T')!
    expect([att.mtd, att.prev_month, att.d90]).toEqual([null, null, 4])
    const pay = s.lines.find((l) => l.line_kind === 'payments')!
    expect([pay.mtd, pay.prev_month, pay.currency]).toEqual([150000, null, 'MXN'])
    // Mismo archivo otra vez: no duplica.
    const again = await ingestStoreSales(sys, { contract: 'store_sales_daily', version: 1, as_of: '2026-11-12', file_name: 'store-sales-2026-11-12.json',
      rows: [
        { merchant_ref: a!.ref, currency: 'MXN', activations: [{ carrier: 'Telcel', mtd: 12, prev_month: 30, d90: 80 }, { carrier: 'AT&T', mtd: 0, prev_month: null, d90: 4 }], payments: [{ product: 'Recargas', mtd: 150000, prev_month: 0, d90: 900000 }] },
        { merchant_ref: b!.ref, activations: [{ carrier: 'Telcel', mtd: 3 }] },
        { merchant_ref: 'NO-EXISTE-1', activations: [{ carrier: 'Telcel', mtd: 1 }] },
      ] })
    expect(again.status).toBe('duplicate')
    const team = await teamStoreSales(ana, 'MX', [lucia.user.id])
    expect(team.get(lucia.user.id)).toMatchObject({ stores: 2, activations_mtd: 15, activations_prev_month: 30, payments_mtd: 150000, currency: 'MXN' })
    // Quien no lleva la tienda y no está en su mercado no la ve (RLS).
    const jade = await ctxFor('jade.kim')
    expect(await storeSales(jade, a!.id)).toBeNull()
  })

  it('la tarea nocturna está en el registro, es una carga y apagada no va a ningún lado', async () => {
    await clearLoads()
    const job = findJob('integraciones2.store_sales_nightly')!
    expect(job).toBeTruthy()
    expect(job.everyMinutes).toBe(1440)
    expect(job.load).toBe('store_sales')
    const off = await runJob(job, 'manual', { force: true })
    expect(off).toMatchObject({ status: 'ok', note: 'Canal apagado' })
    const run = await one(admin<{ status: string; finished_at: Date | null }[]>`select status, finished_at from crm.load_runs where load_key = 'store_sales' order by started_at desc limit 1`)
    expect(run.status).toBe('ok')
    expect(run.finished_at).not.toBeNull()
    // Simulada: entrega el archivo que la prueba dejó listo.
    process.env.SALES_FILE = 'simulated'
    try {
      const [c] = await storesOf('marco.pena@contigo.test', 1)
      simulatedStoreSalesFiles().push({ contract: 'store_sales_daily', version: 1, as_of: '2026-11-13', file_name: 'store-sales-2026-11-13.json', rows: [{ merchant_ref: c!.ref, activations: [{ carrier: 'Movistar', mtd: 2 }] }] })
      const sim = await runJob(job, 'manual', { force: true })
      expect(sim).toMatchObject({ status: 'ok', done: 1, note: 'Simulado' })
    } finally {
      delete process.env.SALES_FILE
    }
  })
})

describe('E5.F3 / E5.F4 / E5.F5: cargas visibles', () => {
  it('nunca dos cargas a la vez: la segunda espera su turno', async () => {
    await clearLoads()
    const first = await withSystem((tx) => startLoad(tx, 'pipedrive', 'manual', null))
    expect(first.status).toBe('started')
    const second = await withSystem((tx) => startLoad(tx, 'store_sales', 'cron', null))
    expect(second).toEqual({ status: 'busy', running: 'pipedrive' })
    const viaRunner = await runJob(findJob('embudo.sales_file_pull')!, 'cron', { force: true })
    expect(viaRunner.status).toBe('busy')
    // La base lo garantiza aunque alguien se salte la aplicación.
    await expect(admin`insert into crm.load_runs (load_key, trigger) values ('imports', 'manual')`).rejects.toThrow()
    await withSystem((tx, sys) => finishLoad(tx, (first as { runId: string }).runId, { ok: true, done: 0 }, sys))
    expect((await withSystem((tx) => startLoad(tx, 'store_sales', 'cron', null))).status).toBe('started')
    await clearLoads()
  })

  it('una falla avisa a su responsable por el servicio de avisos; sin responsable, a administración', async () => {
    await clearLoads()
    await configureLoad(nora, { key: 'imports', owner: ana.user.id, expectedBy: null, clockMarket: null })
    await expect(withLoad('imports', 'manual', null, async () => { throw Object.assign(new Error('x'), { code: 'boom' }) })).rejects.toThrow()
    const run = await one(admin<{ status: string; error: string }[]>`select status, error from crm.load_runs where load_key = 'imports' order by started_at desc limit 1`)
    expect(run).toEqual({ status: 'failed', error: 'boom' })
    const notice = await admin<{ kind: string; title: string }[]>`select kind, title from crm.notices where user_id = ${ana.user.id} and kind = 'data_load' order by created_at desc limit 1`
    expect(notice[0]?.title).toContain('falló')
    // Al terminar con algo hecho, publica qué hizo.
    const ok = await withLoad('imports', 'manual', null, async () => ({ done: 3, note: 'prueba' }))
    expect(ok).toMatchObject({ done: 3 })
    const done = await admin<{ title: string; body: string }[]>`select title, body from crm.notices where user_id = ${ana.user.id} and kind = 'data_load' and title like '%terminó%'`
    expect(done[0]?.body).toContain('3')
    // Sin responsable: administración.
    await clearLoads()
    await withLoad('store_sales', 'manual', null, async () => { throw new Error('y') }).catch(() => undefined)
    const toAdmin = await admin`select 1 from crm.notices where user_id = ${nora.user.id} and kind = 'data_load'`
    expect(toAdmin.length).toBeGreaterThan(0)
  })

  it('ventana de mantenimiento por mercado: dentro de ella no corre ninguna carga', async () => {
    await clearLoads()
    const now = await one(admin<{ a: string; b: string }[]>`select to_char((now() at time zone 'America/Mexico_City') - interval '1 hour', 'HH24:MI') as a, to_char((now() at time zone 'America/Mexico_City') + interval '1 hour', 'HH24:MI') as b`)
    await setLoadWindow(nora, { market: 'MX', starts: now.a, ends: now.b, active: true })
    const paused = await withSystem((tx) => startLoad(tx, 'store_sales', 'cron', null))
    expect(paused).toEqual({ status: 'paused', markets: ['MX'] })
    const viaRunner = await runJob(findJob('integraciones2.store_sales_nightly')!, 'cron', { force: true })
    expect(viaRunner).toMatchObject({ status: 'not_due', note: 'maintenance_window:MX' })
    await expect(setLoadWindow(lucia, { market: 'MX', starts: '01:00', ends: '02:00', active: true })).rejects.toThrow()
    await setLoadWindow(nora, { market: 'MX', starts: now.a, ends: now.b, active: false })
    expect((await withSystem((tx) => startLoad(tx, 'store_sales', 'cron', null))).status).toBe('started')
    await clearLoads()
  })

  it('la carga que no llegó a su hora avisa una sola vez al día', async () => {
    await clearLoads()
    const past = await one(admin<{ t: string }[]>`select to_char(((now() at time zone 'America/Mexico_City') - interval '1 minute')::time, 'HH24:MI') as t`)
    if (past.t < '00:05') return // justo después de medianoche no hay "antes" en el día del mercado
    await configureLoad(nora, { key: 'sales_file', owner: ana.user.id, expectedBy: past.t, clockMarket: 'MX' })
    const sysId = (await systemContext()).user.id
    expect(await withSystem((tx) => watchLateLoads(tx, sysId))).toBeGreaterThanOrEqual(1)
    expect(await withSystem((tx) => watchLateLoads(tx, sysId))).toBe(0)
    const n = await admin`select 1 from crm.notices where user_id = ${ana.user.id} and kind = 'data_load' and title like '%no llegó%'`
    expect(n.length).toBe(1)
    expect(JOBS.some((j) => j.key === 'integraciones2.load_watch')).toBe(true)
  })
})

describe('E5.F6: herramienta de rutas (prueba de contrato)', () => {
  it('la lectura entrega las tiendas de la persona con el contrato v1 y nada de otra persona', async () => {
    const key = { id: 'k', scopes: ['accounts:read'], market: 'MX', mode: 'live' as const, ratePerMinute: 60, createdBy: ana.user.id }
    const out = await readRouteStores(key, new URLSearchParams({ owner_email: 'lucia.vega@contigo.test' }))
    expect(routeStoresOut.safeParse(out).success).toBe(true)
    expect(out.data.length).toBeGreaterThan(0)
    const ids = out.data.map((s) => s.account_id)
    const foreign = await admin`select 1 from crm.accounts where id = any(${ids}::uuid[]) and owner_id <> ${lucia.user.id}`
    expect(foreign.length).toBe(0)
    // Las dos tiendas con cifras: Telcel 12 (AT&T vacío no suma) y Telcel 3.
    expect(out.data.map((s) => s.performance.activations_mtd).filter((x) => x !== null).sort((x, y) => x! - y!)).toEqual([3, 12])
    await expect(readRouteStores(key, new URLSearchParams({ owner_email: 'nadie@contigo.test' }))).rejects.toThrow()
  })

  it('el check-in de vuelta entra como visita, una sola vez', async () => {
    const [a] = await storesOf('lucia.vega@contigo.test', 1)
    const sys = await systemContext()
    const body = { checkin_id: 'route-ck-0001', account_id: a!.id, owner_email: 'lucia.vega@contigo.test', checked_in_at: new Date().toISOString(), note: 'Llegué a la tienda' }
    const r = await ingestRouteCheckin(sys, body)
    expect(r.status).toBe('processed')
    const v = await one(admin<{ outcome: string; user_id: string; account_id: string }[]>`select outcome, user_id, account_id from crm.visits where external_visit_id = 'route:route-ck-0001'`)
    expect(v).toEqual({ outcome: 'open', user_id: lucia.user.id, account_id: a!.id })
    expect((await ingestRouteCheckin(sys, body)).status).toBe('duplicate')
    await expect(ingestRouteCheckin(sys, { ...body, checkin_id: 'x' })).rejects.toThrow()
  })
})

describe('E5.F9: documentos generados', () => {
  it('la plantilla arma el borrador con los datos del comercio', () => {
    const d = draftFor('proposal', { name: 'Abarrotes Prueba', address: 'Calle 1', contact: 'Persona Ejemplo', market: 'MX', marketName: 'México', locale: 'es', me: 'Lucía', today: '2026-11-13', deal: null })
    expect(d.title).toBe('Propuesta para Abarrotes Prueba')
    expect(d.body).toContain('Hola, Persona Ejemplo:')
    const o = draftFor('order', { name: 'Shop', address: null, contact: null, market: 'US', marketName: 'United States', locale: 'en', me: 'Sam', today: '2026-11-13', deal: { id: 'd', title: 'Order 1', currency: 'USD', lines: [{ name: 'SIM', quantity: '2', sum_minor: '1000' }] } })
    expect(o.body).toContain('SIM x 2: USD')
  })

  it('el PDF se arma sin red: es un PDF válido con varias páginas si hace falta', () => {
    const bytes = textPdf('Título con acentos: año', Array.from({ length: 120 }, (_, i) => `Línea ${i}`).join('\n'), 'pie')
    const text = Buffer.from(bytes).toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toMatch(/\/Count [2-9]/)
    expect(text).toContain('a\xf1o')
    expect(wrap('palabra '.repeat(40), 11).length).toBeGreaterThan(1)
  })

  it('se guarda, la bóveda apagada deja el enlace y el correo queda en la cola con el canal apagado', async () => {
    const [a] = await storesOf('lucia.vega@contigo.test', 1)
    const id = await generateDocument(lucia, { accountId: a!.id, dealId: null, kind: 'letter', title: 'Carta de prueba', body: 'Texto de la carta' })
    const doc = await one(admin<{ vault_status: string; created_by: string }[]>`select vault_status, created_by from crm.generated_documents where id = ${id}`)
    expect(doc).toEqual({ vault_status: 'channel_off', created_by: lucia.user.id })
    expect(await emailDocument(lucia, id, 'tienda@ejemplo.test')).toBe('queued_off')
    const n = await one(admin<{ status: string; channel: string }[]>`select status, channel from crm.notifications where account_id = ${a!.id} and recipient_address = 'tienda@ejemplo.test'`)
    expect(n).toEqual({ status: 'queued_off', channel: 'email' })
    // Datos prohibidos no entran; quien no trabaja ese mercado no genera.
    await expect(generateDocument(lucia, { accountId: a!.id, dealId: null, kind: 'letter', title: 'Carta', body: `Tarjeta ${['4111', '1111', '1111', '1111'].join(' ')}` })).rejects.toThrow()
    await expect(generateDocument(await ctxFor('jade.kim'), { accountId: a!.id, dealId: null, kind: 'letter', title: 'Carta', body: 'x' })).rejects.toThrow()
  })
})

describe('E5.F7: firmar no pasa por Pipedrive', () => {
  it('ningún módulo de firma o contratos usa el adaptador de Pipedrive', () => {
    const files: string[] = []
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p) } }
    walk('src')
    const signing = files.filter((f) => /esign|firma|contrat|partners/i.test(f) || /esignAdapter|requestSignature/.test(readFileSync(f, 'utf8')))
    for (const f of signing) expect(readFileSync(f, 'utf8'), f).not.toMatch(/adapters\/pipedrive|pdList|pipedriveConfigured/)
    if (existsSync('src/server/adapters/partners.ts')) expect(readFileSync('src/server/adapters/partners.ts', 'utf8')).toContain('CONTIGO_ESIGN_ADAPTER')
    expect(readFileSync('src/app/(app)/estado/cargas.tsx', 'utf8')).toContain('status-esign')
  })
})

describe('E6.F8 / E18.F7 / E18.F8: recarga de un mercado e importación de la hoja de México', () => {
  it('la hoja de México: sin columnas de promo, muertos cerrados con motivo, vista previa, reporte y deshacer', async () => {
    expect([sheetLeadState('Muerto'), sheetLeadState(''), sheetLeadState('abierto'), sheetLeadState('raro')]).toEqual(['dead', 'open', 'open', null])
    const csv = [
      'negocio,contacto,telefono,ciudad,estado,motivo,promo,Promoción del mes',
      'Miscelánea Hoja Uno,Persona Uno,5512340001,Ciudad Ejemplo,abierto,,2x1,si',
      'Miscelánea Hoja Dos,Persona Dos,5512340002,Ciudad Ejemplo,muerto,La tienda cerró,,',
      'Miscelánea Hoja Tres,Persona Tres,5512340003,Ciudad Ejemplo,muerto,,,',
      'Miscelánea Hoja Cuatro,Persona Cuatro,5512340004,Ciudad Ejemplo,muerto,motivo inventado,,',
    ].join('\n')
    const base = { kind: 'mx_leads' as const, market: 'MX', fileName: 'hoja-mx.csv', text: csv }
    const p = await previewImport(ana, base)
    expect(p.notes?.[0]?.[0]).toContain('promo')
    expect([p.ok, p.errors]).toEqual([2, 2])
    expect(p.rows[2]!.problems[0]![0]).toContain('motivo')
    expect(p.rows[3]!.problems[0]![0]).toContain('catálogo')
    await expect(previewImport(nora, { ...base, market: 'US' }).then((x) => x.fileProblem)).resolves.toBeTruthy()
    const out = await runImport(ana, { ...base, checksum: p.checksum })
    expect(out).toMatchObject({ created: 2, rejected: 2 })
    const dead = await one(admin<{ status: string; disqualify_code: string }[]>`select status, disqualify_code from crm.leads where business_name = 'Miscelánea Hoja Dos'`)
    expect(dead).toEqual({ status: 'disqualified', disqualify_code: 'store_closed_down' })
    const promo = await admin`select 1 from crm.leads where business_name = 'Miscelánea Hoja Uno' and coalesce(message, '') like '%2x1%'`
    expect(promo.length).toBe(0)
    const undo = await undoImport(ana, out.id)
    expect(undo).toEqual({ undone: 2, kept: 0 })
    expect((await admin`select 1 from crm.leads where business_name like 'Miscelánea Hoja%'`).length).toBe(0)
  })

  it('borrar y recargar: solo fuera de producción, con confirmación escrita, y deja el mercado vacío', async () => {
    expect(resetAllowed({ APP_ENV: 'production' })).toBe(false)
    expect(resetAllowed({ APP_ENV: 'staging' })).toBe(false)
    expect(resetAllowed({ APP_ENV: 'staging', TEST_RESET_ON_STAGING: '1' })).toBe(true)
    expect(resetAllowed({ APP_ENV: 'test' })).toBe(true)
    expect(confirmationFor('US')).toEqual(['BORRAR US', 'WIPE US'])
    await expect(resetTestMarket(nora, 'US', 'borrar mx')).rejects.toThrow()
    await expect(resetTestMarket(ana, 'US', 'BORRAR US')).rejects.toThrow()
    const before = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where market_code = 'US'`)
    expect(before.n).toBeGreaterThan(0)
    const mxBefore = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where market_code = 'MX'`)
    const counts = await resetTestMarket(nora, 'US', 'borrar  us')
    expect(counts.accounts).toBe(before.n)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where market_code = 'US'`)).n).toBe(0)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where market_code = 'MX'`)).n).toBe(mxBefore.n)
    // La configuración y los accesos del mercado siguen.
    expect((await admin`select 1 from crm.memberships where market_code = 'US'`).length).toBeGreaterThan(0)
    expect((await admin`select 1 from crm.pipelines where market_code = 'US'`).length).toBeGreaterThan(0)
    expect((await admin`select 1 from crm.audit_events where action = 'market.reset_test'`).length).toBe(1)
  })
})

describe('GOB-05 y E6.F4: carga de Pipedrive con historial, árbol, duplicados y respaldo', () => {
  let mock: Mock
  beforeAll(async () => {
    mock = await startMock(Number(process.env.UNIT_PIPEDRIVE_PORT ?? 46560))
    await clearLoads()
    // Un comercio que ya existe en CONTIGO con el mismo nombre que una organización de Pipedrive: la carga lo debe proponer como duplicado.
    await createAccount(ana, { market: 'MX', name: 'Tienda Sintética 4', segment: 'd2d', kind: 'store' })
    await startImport(nora, 'full')
    for (let i = 0; i < 400; i++) {
      const r = await importStep(nora, 4000)
      if (r.status === 'done') break
      if (r.status === 'failed' || r.status === 'idle') throw new Error(`import ${r.status} at ${r.phase}`)
      if (r.waitMs) await new Promise((res) => setTimeout(res, Math.min(r.waitMs!, 1500)))
    }
  }, 240_000)
  afterAll(async () => {
    await mock.close()
  })

  it('la carga quedó como carga terminada en Estado', async () => {
    const run = await one(admin<{ status: string; done: number }[]>`select status, done from crm.load_runs where load_key = 'pipedrive' order by started_at desc limit 1`)
    expect(run.status).toBe('ok')
    expect(run.done).toBeGreaterThan(0)
  })

  it('el historial de etapas trae cada cambio con su fecha real', async () => {
    const ev = await admin<{ to_name: string; at: Date }[]>`
      select s.name_es as to_name, e.at from crm.deal_stage_events e join crm.stages s on s.id = e.to_stage_id
        join crm.external_refs r on r.internal_id = e.deal_id and r.system = 'pipedrive' and r.object = 'deal' and r.external_id = '7001'
       order by e.at`
    const names = ev.map((e) => e.to_name)
    expect(names).toContain('Prospect')
    expect(names).toContain('Contacted')
    // El cambio a Contacted llegó con su fecha real (además del registro con que arranca la historia al importar el negocio).
    expect(ev.filter((e) => e.to_name === 'Contacted').map((e) => e.at.toISOString().slice(0, 10))).toContain('2026-10-08')
  })

  it('la organización matriz de Pipedrive cuelga a la hija en el árbol', async () => {
    const row = await one(admin<{ child_parent: string | null; parent_id: string }[]>`
      select c.parent_id as child_parent, p.id as parent_id
        from crm.account_aliases ca join crm.accounts c on c.id = ca.account_id, crm.account_aliases pa join crm.accounts p on p.id = pa.account_id
       where ca.system = 'pipedrive' and ca.external_id = '2002' and pa.system = 'pipedrive' and pa.external_id = '2000'`)
    expect(row.child_parent).toBe(row.parent_id)
    expect((await admin`select 1 from crm.account_links where child_id = (select account_id from crm.account_aliases where system = 'pipedrive' and external_id = '2002') and valid_to is null`).length).toBe(1)
  })

  it('los duplicados de la carga quedan en la cola, sin fusionar nada', async () => {
    const merged = await admin`select 1 from crm.merge_events where merged_at > now() - interval '10 minutes'`
    expect(merged.length).toBe(0)
    const pair = await admin`select 1 from crm.duplicate_pairs p join crm.accounts a on a.id in (p.a_id, p.b_id)
      join crm.account_aliases al on al.account_id = a.id and al.system = 'pipedrive' and al.external_id = '2004' where p.status = 'open'`
    expect(pair.length).toBe(1)
  })

  it('E6.F4: el respaldo trae todo lo importado con formato y queda en la bitácora', async () => {
    const raw = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.import_raw where source = 'pipedrive'`)
    const b = await pipedriveBackup(nora)
    const parsed = JSON.parse(b.json) as { format: string; rows: number; counts: Record<string, number>; records: unknown[] }
    expect(parsed.format).toBe(BACKUP_FORMAT)
    expect(parsed.rows).toBe(raw.n)
    expect(parsed.records.length).toBe(raw.n)
    expect(b.json).not.toContain(['4111', '1111', '1111', '1111'].join(' '))
    expect((await admin`select 1 from crm.pipedrive_backups where sha256 = ${b.sha256}`).length).toBe(1)
    expect((await admin`select 1 from crm.audit_events where action = 'pipedrive.backup_downloaded'`).length).toBe(1)
    await expect(pipedriveBackup(ana)).rejects.toThrow()
  })
})
