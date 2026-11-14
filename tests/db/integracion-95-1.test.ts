import { afterAll, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ctxFor, owner, personaId, systemContext } from './helpers'
import { fillEnrollment } from '../support/us-enrollment'
import { createAccount } from '@/domain/accounts'
import { createDeal } from '@/domain/deals'
import { intakeFromForm, markContacted } from '@/domain/leads'
import { saveLeadEscalation } from '@/domain/automation/lead-escalation'
import { addDealItem, saveOrderDetails, setOpsCheck } from '@/domain/ops'
import { setAccountProduct } from '@/domain/gobierno'
import { reassignDeals } from '@/domain/reparto'
import { sendOrderToOps } from '@/domain/orders'
import { exportAccounts, exportLeads } from '@/domain/exports'
import { exportClosedDeals, exportFieldReport } from '@/domain/reports'
import { exportReport, saveView } from '@/domain/reportes'
import { exportVisitDetail } from '@/domain/visit-detail'
import { exportDeadLeads, exportMarketReport } from '@/domain/mx-reports'
import { marketPeriods } from '@/dal/reports'
import { accountIdentity } from '@/dal/datos'
import { myNotices } from '@/dal/ops'
import { orderPrint } from '@/dal/orders'
import { JOBS } from '@/server/jobs/registry'
import { findJob, runJob } from '@/server/jobs/runner'
import { NOTICE_KINDS } from '@/lib/notice-kinds'
import { VIEW_FILTERS, viewHref } from '@/lib/report-catalog'
import { addDays, isoDay } from '@/lib/format'

// Ola 1 de los 95, integración: lo que cruza paquetes. Un solo servicio de avisos, exportaciones con motivo, un solo
// portafolio por tienda, tareas programadas en el registro, adaptadores a la vista y una sola marca de texto de fuera.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x')
const mxPhone = () => `55 6${Math.floor(1000000 + Math.random() * 8999999)}`
const uid = (k: string) => one(admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`).then((r) => r.id)
const today = isoDay(new Date(), 'America/New_York')
const job = (key: string) => findJob(key)!
const run = (key: string) => runJob(job(key), 'manual', { force: true })
const alwaysOpen = () => admin`update crm.market_hours set days = '{1,2,3,4,5,6,7}', opens = '00:00', closes = '23:59:59'`

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('un lead de campaña de México, de punta a punta (mx, eventos y API, avisos, automatizaciones, reportes)', () => {
  it('entra por el formulario de cadenas, rota entre las dos personas del turno, y cada aviso sale por el servicio único', async () => {
    await alwaysOpen()
    const sys = await systemContext()
    const nora = await ctxFor('nora.salas')
    const name = `Cadena Integrada ${tag()}`
    const out = await intakeFromForm(sys, 'contacto-mx', { business_name: name, contact_name: 'Ana Web', phone: mxPhone(), email: `lead.${tag()}@ejemplo.test`, consent: true, company_type: 'chain' }, `i95-${tag()}`)
    const lead = await one(admin<{ source: string; owner_id: string; motor: string; on_time: boolean }[]>`
      select source, owner_id, motor, abs(extract(epoch from (sla_due_at - app.business_due('MX', created_at, 60)))) < 5 as on_time from crm.leads where id = ${out.leadId}`)
    // mx: origen "campaña web" y meta de una hora hábil; el turno de B2B es de Diana e Iván
    expect(lead).toMatchObject({ source: 'web_campaign', on_time: true })
    expect([await uid('diana.cruz'), await uid('ivan.rios')]).toContain(lead.owner_id)
    // eventos y API: el texto llegó de fuera y queda marcado con su origen
    expect((await one(admin<{ origin: string }[]>`select origin from crm.untrusted_marks where object = 'lead' and object_id = ${out.leadId}`)).origin).toBe('web_form')
    // avisos: a quien le tocó le llega "Te llegó un lead", y al lead su bienvenida o acuse (correo en la cola apagada o en espera)
    const arrived = await admin<{ kind: string; user_id: string }[]>`select kind, user_id from crm.notices where lead_id = ${out.leadId}`
    expect(arrived).toEqual([{ kind: 'lead_arrived', user_id: lead.owner_id }])
    const outside = await admin<{ template_key: string; status: string }[]>`select template_key, status from crm.notifications where lead_id = ${out.leadId} and recipient_kind = 'lead'`
    expect(outside).toHaveLength(1)
    expect(['lead_welcome', 'lead_web_ack']).toContain(outside[0]!.template_key)
    expect(outside[0]!.status).not.toBe('delivered') // hacia afuera nada sale de verdad: los canales están apagados

    // Vence la meta sin intento: avisos le avisa a quien lo lleva; automatizaciones escala a supervisión. Los dos por notify.
    await admin`update crm.leads set sla_due_at = now() - interval '10 minutes' where id = ${out.leadId}`
    expect((await run('avisos.lead_goal')).status).toBe('ok')
    await saveLeadEscalation(nora, 'MX', { active: true, hours: 4 })
    expect((await run('automatizaciones.escalamiento')).status).toBe('ok')
    const paula = await ctxFor('paula.mendez') // supervisa el equipo B2B
    const kinds = await admin<{ kind: string; user_id: string }[]>`select kind, user_id from crm.notices where lead_id = ${out.leadId} order by created_at, kind`
    expect(kinds.map((k) => k.kind).sort()).toEqual(['lead_arrived', 'lead_escalated', 'lead_goal_missed'])
    expect(kinds.find((k) => k.kind === 'lead_goal_missed')!.user_id).toBe(lead.owner_id)
    expect(kinds.find((k) => k.kind === 'lead_escalated')!.user_id).toBe(paula.user.id)
    expect((await myNotices(paula)).some((n) => n.link === `/leads/${out.leadId}` && n.kind === 'lead_escalated')).toBe(true)
    // ningún aviso se quedó fuera del registro del servicio, y nadie "avisó" creando una tarea por su cuenta
    expect((await one(admin<{ n: number }[]>`
      select count(*)::int as n from crm.notices n where n.lead_id = ${out.leadId}
         and not exists (select 1 from crm.notifications x where x.notice_id = n.id and x.channel = 'in_app' and x.status = 'delivered')`)).n).toBe(0)
    expect(await admin`select 1 from crm.activities where lead_id = ${out.leadId} and source = 'rule'`).toHaveLength(0)
    for (const k of ['lead_arrived', 'lead_goal_missed', 'lead_escalated', 'automation', 'export_alert', 'scheduled_report'] as const) expect(NOTICE_KINDS[k].label[1].length).toBeGreaterThan(5)

    // Con el primer intento, el aviso de escalamiento deja de pedir acción solo.
    await markContacted(await ctxFor(lead.owner_id === (await uid('diana.cruz')) ? 'diana.cruz' : 'ivan.rios'), out.leadId)
    await run('automatizaciones.escalamiento')
    expect((await myNotices(paula)).some((n) => n.link === `/leads/${out.leadId}`)).toBe(false)
    await saveLeadEscalation(nora, 'MX', { active: false, hours: 4 })
  })

  it('una vista guardada de Leads conserva los filtros de campaña de México', async () => {
    const ana = await ctxFor('ana.robles')
    const id = await saveView(ana, { object: 'lead', name: `Cadenas de campaña ${tag()}`, filters: { market: 'MX', source: 'web_campaign', tipo: 'chain', embudo: 'F2', tiendas_min: '5', otro: 'no entra' }, shared: false, pin: false })
    const saved = await one(admin<{ filters: Record<string, string> }[]>`select filters from crm.saved_views where id = ${id}`)
    expect(saved.filters).toEqual({ market: 'MX', source: 'web_campaign', tipo: 'chain', embudo: 'F2', tiendas_min: '5' })
    const href = viewHref({ id, object: 'lead', filters: saved.filters })
    for (const part of ['tipo=chain', 'embudo=F2', 'tiendas_min=5', 'source=web_campaign']) expect(href).toContain(part)
    expect(VIEW_FILTERS.lead).toEqual(expect.arrayContaining(['tipo', 'embudo', 'tiendas_min', 'tiendas_max']))
  })
})

describe('toda exportación pide motivo y queda en la bitácora de exportaciones (eventos y API, reportes, us-embudo, mx)', () => {
  it('ocho descargas, una sola regla: sin motivo no hay archivo; con motivo queda anotada con su tope', async () => {
    const nora = await ctxFor('nora.salas')
    const reason = `Revisión de integración ${tag()}`
    const period = marketPeriods(nora, 'mes')
    const all: [string, (r: string) => Promise<{ rows: number }>][] = [
      ['accounts', (r) => exportAccounts(nora, { market: 'MX' }, r)],
      ['leads', (r) => exportLeads(nora, { market: 'MX' }, r)],
      ['closed_deals', (r) => exportClosedDeals(nora, period, { market: 'MX' }, r)],
      ['field_visits', (r) => exportFieldReport(nora, { market: 'MX', by: 'territorio' }, 'visitas', r)],
      ['report_etapas', (r) => exportReport(nora, 'etapas', period, { market: 'MX' }, r)],
      ['visit_detail', (r) => exportVisitDetail(nora, { market: 'US' }, r)],
      ['market_mensual', (r) => exportMarketReport(nora, 'MX', 6, 'mensual', r)],
      ['market_dead_leads_mailing', (r) => exportDeadLeads(nora, 'MX', r)],
    ]
    for (const [what, go] of all) {
      await expect(go(''), what).rejects.toMatchObject({ code: 'invalid' })
      await expect(go('corto'), what).rejects.toMatchObject({ code: 'invalid' })
      await go(reason)
    }
    const log = await admin<{ what: string; row_cap: number }[]>`select what, row_cap from crm.export_log where user_id = ${nora.user.id} and reason = ${reason}`
    expect(log.map((l) => l.what).sort()).toEqual(all.map(([w]) => w).sort())
    expect(log.every((l) => l.row_cap > 0 && l.row_cap <= 10000)).toBe(true)
    // y cada una dejó su evento en la bitácora con el motivo
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'report.exported' and actor_id = ${nora.user.id} and after ->> 'reason' = ${reason}`)).n).toBe(all.length)
  })

  it('toda ruta que entrega un archivo de datos lee el motivo; las dos que no lo piden no llevan datos del negocio', () => {
    const routes = files('src/app').filter((p) => p.endsWith('route.ts') && /text\/csv/.test(readFileSync(p, 'utf8')))
    // La plantilla de importación es un archivo vacío con encabezados, y el reporte de rechazos trae fila y motivo, sin los datos de la fila.
    const exempt = ['src/app/(app)/importar/plantilla/route.ts', 'src/app/(app)/importar/reporte/route.ts']
    const governed = routes.filter((p) => !exempt.includes(p))
    expect(governed.length).toBeGreaterThanOrEqual(7)
    for (const p of governed) expect(readFileSync(p, 'utf8'), p).toMatch(/\bmotivo\b/)
    for (const p of exempt) expect(routes, p).toContain(p)
  })
})

describe('un solo portafolio por tienda (datos DAT-07 y us-embudo E10.F2), pedidos (avisos y us-embudo) y reparto', () => {
  it('lo que Operaciones marca por proveedor en el negocio es la misma fila que se mantiene en la tienda, y lo activo no retrocede', async () => {
    const jade = await ctxFor('jade.kim')
    const tom = await ctxFor('tom.reyes')
    const nora = await ctxFor('nora.salas')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Portafolio ${tag()}`, segment: 'dealer', force: true })
    const dealId = await createDeal(jade, { accountId: acc.id!, pipelineId: await uid('p-us-dealer'), title: `Alta ${tag()}`, nextStep: 'Call the owner', nextStepDue: today })
    const north = (await one(admin<{ id: string }[]>`select id from crm.ops_catalog where market_code = 'US' and kind = 'provider' and code = 'carrier_north'`)).id
    const providers = async () => (await accountIdentity(jade, acc.id!, 'US')).products.filter((p) => p.product_id === null)
    await setOpsCheck(tom, dealId, north, { status: 'sent', onDate: today })
    expect(await providers()).toMatchObject([{ provider_id: north, status: 'submitted', deal_id: dealId }])
    await setAccountProduct(nora, acc.id!, { productId: '', providerId: north, status: 'active' })
    await setOpsCheck(tom, dealId, north, { status: 'approved', onDate: today })
    const rows = await providers()
    expect(rows).toHaveLength(1) // una fila por tienda y proveedor, la escriba quien la escriba
    expect(rows[0]).toMatchObject({ status: 'active', deal_id: dealId })
    // no existe una segunda lectura por negocio para la tienda
    expect(files('src').filter((p) => /store-providers|comercios\/proveedores/.test(p))).toEqual([])
  })

  it('al pasar los negocios de una persona a otra, las tareas de Operaciones y de quien aprueba se quedan con su dueño', async () => {
    const jade = await ctxFor('jade.kim')
    const kira = await ctxFor('kira.dunn')
    const tom = await personaId('tom.reyes')
    const sam = await personaId('sam.ortiz')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Reparto ${tag()}`, segment: 'dealer', force: true })
    const dealId = await createDeal(jade, { accountId: acc.id!, pipelineId: await uid('p-us-dealer'), title: `Alta ${tag()}`, nextStep: 'Call the owner', nextStepDue: today })
    await fillEnrollment(admin, dealId)
    const task = async (ownerId: string, subject: string) => (await one(admin<{ id: string }[]>`
      insert into crm.activities (market_code, account_id, deal_id, kind, subject, due_at, owner_id, created_by, source)
      values ('US', ${acc.id!}, ${dealId}, 'task', ${subject}, now() + interval '1 day', ${ownerId}, ${jade.user.id}, 'user') returning id`)).id
    const mine = await task(jade.user.id, 'Llamar al dueño')
    const ops = await task(tom, 'Validar documentos')
    const moved = await reassignDeals(kira, { market: 'US', from: jade.user.id, to: sam })
    expect(moved.moved).toBeGreaterThan(0)
    const ownerOf = async (id: string) => (await one(admin<{ owner_id: string }[]>`select owner_id from crm.activities where id = ${id}`)).owner_id
    expect((await one(admin<{ owner_id: string }[]>`select owner_id from crm.deals where id = ${dealId}`)).owner_id).toBe(sam)
    expect(await ownerOf(mine)).toBe(sam)
    expect(await ownerOf(ops)).toBe(tom)
  })

  it('el pedido listo para imprimir lleva los datos de envío y el descuento de cada línea', async () => {
    const jade = await ctxFor('jade.kim')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Pedido impreso ${tag()}`, segment: 'orders', force: true })
    const id = await createDeal(jade, { accountId: acc.id!, pipelineId: await uid('p-us-orders'), title: `Order ${tag()}`, nextStep: 'Confirm', nextStepDue: today })
    await addDealItem(jade, id, { productId: await uid('prod-us-sim'), quantity: 100, discountPct: 10 })
    expect((await orderPrint(jade, id))!.shipping).toBeNull()
    const due = addDays(today, 5)
    await saveOrderDetails(jade, id, { customerNumber: 'C-10293', dueOn: due, poNumber: 'PO-7781', shipTo: '100 Main Street, Baltimore', terms: 'Net 15' })
    const print = (await orderPrint(jade, id))!
    expect(print.shipping).toMatchObject({ carrier: 'FedEx', customer_number: 'C-10293', due_on: due, po_number: 'PO-7781', ship_to: '100 Main Street, Baltimore', terms: 'Net 15' })
    expect(Number(print.items[0]!.discount_pct)).toBe(10)
    // y el mensaje al buzón de pedidos (correo apagado: queda en la cola) dice lo mismo que la hoja
    await admin`insert into crm.market_comms (market_code, orders_mailbox) values ('US', 'pedidos@ejemplo.test') on conflict (market_code) do update set orders_mailbox = excluded.orders_mailbox`
    await sendOrderToOps(jade, id)
    const mail = await one(admin<{ body: string; status: string }[]>`select body, status from crm.notifications where deal_id = ${id} and recipient_kind = 'mailbox'`)
    for (const part of ['(less 10% discount)', 'Carrier: FedEx', 'PO number: PO-7781', 'Shipping address: 100 Main Street, Baltimore', 'Terms: Net 15']) expect(mail.body).toContain(part)
    expect(mail.status).not.toBe('delivered')
  })
})

describe('contratos de la integración', () => {
  it('todo lo programado está en el registro, con clave única y nombre en los dos idiomas, y corre', async () => {
    const keys = JOBS.map((j) => j.key)
    expect(new Set(keys).size).toBe(keys.length)
    const packages = readdirSync('src/server/jobs').filter((f) => !['registry.ts', 'runner.ts', 'types.ts'].includes(f)).map((f) => f.replace('.ts', ''))
    const registry = readFileSync('src/server/jobs/registry.ts', 'utf8')
    for (const p of packages) expect(registry, p).toContain(`from './${p}'`)
    for (const p of packages) expect(keys.some((k) => k.startsWith(`${p}.`)), p).toBe(true)
    // nadie programa nada por su lado
    const server = [...files('src/server'), ...files('src/domain'), ...files('src/dal'), ...files('src/app/api')]
    const own = server.filter((p) => !p.startsWith('src/server/jobs/') && /\bsetInterval\(/.test(readFileSync(p, 'utf8')))
    expect(own).toEqual([])
    for (const j of JOBS) {
      const out = await runJob(j, 'manual', { force: true })
      expect(out.status, `${j.key}: ${out.error ?? ''}`).toBe('ok')
    }
  })

  it('todo aviso a una persona pasa por notify.ts y todo adaptador externo aparece en Estado de CONTIGO', () => {
    const src = files('src')
    const direct = src.filter((p) => p !== 'src/domain/notify.ts' && /insert\s+into\s+crm\.(notices|notifications)\b/i.test(readFileSync(p, 'utf8')))
    expect(direct).toEqual([])
    for (const p of ['src/domain/automation/engine.ts', 'src/domain/automation/lead-escalation.ts', 'src/domain/exports.ts', 'src/domain/reportes.ts'])
      expect(readFileSync(p, 'utf8'), p).toMatch(/from '@\/domain\/notify'/)
    expect(readFileSync('src/domain/automation/lead-escalation.ts', 'utf8')).not.toMatch(/insert\s+into\s+crm\.activities/i)
    const status = readFileSync('src/app/(app)/estado/page.tsx', 'utf8')
    const channels = readFileSync('src/server/adapters/channels.ts', 'utf8')
    // channel.ts es la base común de los canales; identidad y Pipedrive ya tenían su renglón propio en Estado.
    // Paquete conectores: la tarjeta "Conectores" (estado/conectores.tsx) lee el registro único, que importa cada adaptador.
    const registry = readFileSync('src/server/adapters/registry.ts', 'utf8')
    const card = readFileSync('src/app/(app)/estado/conectores.tsx', 'utf8').includes("@/server/adapters/registry'") && status.includes("from './conectores'")
    for (const f of readdirSync('src/server/adapters').filter((x) => x.endsWith('.ts')).map((x) => x.replace('.ts', '')).filter((x) => x !== 'channel' && x !== 'registry')) {
      const shown = status.includes(`@/server/adapters/${f}'`) || channels.includes(`./${f}'`) || channels.includes(`/adapters/${f}'`) || (f === 'identity' && status.includes('ssoEnabled')) || (card && registry.includes(`from './${f}'`))
      expect(shown, `adaptador ${f}`).toBe(true)
    }
  })

  it('una sola marca de texto de fuera por campo, una sola función de mercados que lidero, y Administración en secciones', async () => {
    const col = await admin<{ is_generated: string }[]>`select is_generated from information_schema.columns where table_schema = 'crm' and table_name = 'field_definitions' and column_name = 'untrusted'`
    expect(col).toEqual([{ is_generated: 'NEVER' }])
    // texto libre: siempre marcado; otro tipo: lo marca quien gobierna el campo, y se puede quitar
    const f = await one(admin<{ id: string; untrusted: boolean }[]>`
      insert into crm.field_definitions (object, key, label_es, label_en, data_type, market_code) values ('deal', ${`i95_${tag()}`}, 'Campo de prueba', 'Test field', 'text', 'MX') returning id, untrusted`)
    expect(f.untrusted).toBe(true)
    expect((await one(admin<{ untrusted: boolean }[]>`update crm.field_definitions set untrusted = false where id = ${f.id} returning untrusted`)).untrusted).toBe(true)
    expect((await one(admin<{ untrusted: boolean }[]>`update crm.field_definitions set data_type = 'number' where id = ${f.id} returning untrusted`)).untrusted).toBe(false)
    expect((await one(admin<{ untrusted: boolean }[]>`update crm.field_definitions set untrusted = true where id = ${f.id} returning untrusted`)).untrusted).toBe(true)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'app' and p.proname = 'lead_markets'`)).n).toBe(1)
    const adminPage = readFileSync('src/app/(app)/admin/page.tsx', 'utf8')
    expect(adminPage).toContain('<AdminNav')
    expect((adminPage.match(/\{ key: '[a-z]+', label: t\(/g) ?? []).length).toBe(6)
    expect(adminPage).not.toContain('api-clients') // las llaves viven en un solo lugar: Eventos, API y datos
  })
})
