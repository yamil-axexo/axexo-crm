import { afterAll, describe, expect, it } from 'vitest'
import { ctxFor, owner, systemContext } from './helpers'
import { withSystem } from '@/server/db'
import { ingestSalesAppEvent } from '@/domain/integrations'
import { createAccount } from '@/domain/accounts'
import { classifyOrigin, reclassifyAttribution } from '@/domain/campo-canal/attribution'
import { evaluateCompetitionTx, reportIncident } from '@/domain/campo-canal/campo'
import { createOnboardingLink, onboardingLinkReceive, onboardingLinkSubmit, onboardingLinkView } from '@/domain/campo-canal/expediente'
import { estimateStatementsTx, partnerRegisterClaim, publishStatement, recordEnablementProgress, setChannelPolicy, syncAcademyProgressTx } from '@/domain/campo-canal/canal2'
import { raiseDispute, resolveDispute } from '@/domain/campo-canal/canal'
import { setThreshold } from '@/domain/campo-canal/thresholds'
import { feedbackDigest } from '@/domain/care-accounts'
import { claims, incidents, proposedValues, thresholds } from '@/dal/campo-canal'
import { myStatements, partnerExtras } from '@/dal/partners'
import { JOBS } from '@/server/jobs/registry'
import { decide } from '@/domain/events/catalog'
import { AUDIT_ACTION } from '@/lib/audit'

// Paquete campo2 (ola 6, residuos). Una prueba por "falta" de la re-auditoría.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x')
const now = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0, 10)
const sc = (m: string) => `SC-${m}-${Math.floor(100000 + Math.random() * 899999)}`

/** Una tienda nueva de la Sales App en México, con su ID de Sales Core. */
async function salesAppStore(name = `Abarrotes Campo Dos ${tag()}`): Promise<{ id: string; customer: string }> {
  const sys = await systemContext()
  const customer = sc('MX')
  const res = await ingestSalesAppEvent(sys, { event_id: `ev-${tag()}${tag()}`, type: 'store.created', version: 1, occurred_at: now(), data: { customer_id: customer, market: 'MX', name, salesperson_email: 'marco.pena@contigo.test' } })
  return { id: res.accountId!, customer }
}
const visit = (customer: string, extra: Record<string, unknown> = {}) => ({
  event_id: `ev-${tag()}${tag()}`, type: 'visit.checked_out', version: 1, occurred_at: now(),
  data: { visit_id: `v-${tag()}${tag()}`, customer_id: customer, salesperson_id: 'sp-1', business_date: today(), checked_in_at: now(), sale: false, ...extra },
})

describe('CAMPO-04 ningún aviso sin dueño y calibración', () => {
  it('un aviso que llega sin dueño cae a quien supervisa el mercado y queda dicho a quién', async () => {
    const acc = await salesAppStore()
    await admin`update crm.accounts set owner_id = null where id = ${acc.id}`
    const ex = await one(admin<{ owner_id: string | null; detail: { routed_to?: string } }[]>`
      insert into crm.exceptions (market_code, kind, severity, account_id, detail, dedupe_key) values ('MX', 'unowned_account', 'low', ${acc.id}, '{}'::jsonb, ${'campo2-test:' + tag()})
      returning owner_id, detail`)
    expect(ex.owner_id).not.toBeNull()
    expect(['territory_owner', 'supervisor', 'market_lead']).toContain(ex.detail.routed_to)
    const open = await admin`select 1 from crm.exceptions where owner_id is null and resolved_at is null and market_code = 'MX'`
    expect(open.length).toBe(0)
  })
  it('cada umbral nuevo nace como valor propuesto con su dueño y fecha de calibración; al fijarlo deja de ser propuesta', async () => {
    const ana = await ctxFor('ana.robles')
    const rows = await thresholds(ana, 'MX')
    const trust = rows.find((r) => r.key === 'trust_min_score')!
    expect(trust.value).toBe(50)
    expect(trust.pending_owner).toBe('Ventas')
    expect(trust.review_due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await proposedValues(ana)).some((p) => p.key === 'competitor_window_days' && p.market_code === 'MX')).toBe(true)
    await setThreshold(ana, { market: 'MX', key: 'threshold_review_days', value: 120, reason: 'Acordado con Ventas para el primer trimestre' })
    const after = (await thresholds(ana, 'MX')).find((r) => r.key === 'threshold_review_days')!
    expect(after.pending_owner).toBeNull()
    expect(after.version).toBe(2)
  })
})

describe('CAMPO-05 señal de confianza de la visita', () => {
  it('la visita trae su señal y sus motivos; por debajo del mínimo del mercado no cuenta', async () => {
    const sys = await systemContext()
    const acc = await salesAppStore()
    const ev = visit(acc.customer, { trust_score: 20, trust_flags: ['gps_far', 'too_short'] })
    expect((await ingestSalesAppEvent(sys, ev)).status).toBe('processed')
    const v = await one(admin<{ trust_score: number; trust_flags: string[] }[]>`select trust_score, trust_flags from crm.visits where external_visit_id = ${(ev.data as { visit_id: string }).visit_id}`)
    expect(v.trust_score).toBe(20)
    expect(v.trust_flags).toEqual(['gps_far', 'too_short'])
    // el contrato sin señal sigue valiendo: la visita cuenta
    const plain = visit(acc.customer)
    expect((await ingestSalesAppEvent(sys, plain)).status).toBe('processed')
    // una señal fuera de rango no cumple el contrato
    await expect(ingestSalesAppEvent(sys, visit(acc.customer, { trust_score: 140 }))).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('CAMPO-07 la competencia alimenta avisos y ruteo', () => {
  it('competencia vista en varios días abre pérdida de share; sin venta, propone el canal indirecto; se cierra solo con el umbral', async () => {
    const acc = await salesAppStore()
    const comp = await one(admin<{ id: string }[]>`insert into crm.competitors (market_code, name) values ('MX', ${'Rival ' + tag()}) returning id`)
    for (const d of [1, 3, 5]) {
      await admin`insert into crm.account_competitors (account_id, market_code, competitor_id, observed_on, source) values (${acc.id}, 'MX', ${comp.id}, current_date - ${d}::int, 'sales_app')`
    }
    await withSystem((tx) => evaluateCompetitionTx(tx, 'MX'))
    const ex = await admin<{ kind: string; owner_id: string | null; rule_key: string }[]>`select kind, owner_id, rule_key from crm.exceptions where account_id = ${acc.id} and resolved_at is null and kind in ('competitor_share_loss','indirect_route') order by kind`
    expect(ex.map((e) => e.kind)).toEqual(['competitor_share_loss', 'indirect_route'])
    expect(ex.every((e) => e.owner_id)).toBe(true)
    const ana = await ctxFor('ana.robles')
    await setThreshold(ana, { market: 'MX', key: 'competitor_alert_visits', value: 9, reason: 'Prueba de calibración' })
    await setThreshold(ana, { market: 'MX', key: 'indirect_route_visits', value: 9, reason: 'Prueba de calibración' })
    await withSystem((tx) => evaluateCompetitionTx(tx, 'MX'))
    expect((await admin`select 1 from crm.exceptions where account_id = ${acc.id} and resolved_at is null and kind in ('competitor_share_loss','indirect_route')`).length).toBe(0)
    await setThreshold(ana, { market: 'MX', key: 'competitor_alert_visits', value: 2, reason: 'De vuelta al propuesto' })
    await setThreshold(ana, { market: 'MX', key: 'indirect_route_visits', value: 3, reason: 'De vuelta al propuesto' })
  })
  it('el motor de automatizaciones ya no cierra los avisos de campo que no son suyos', async () => {
    const acc = await salesAppStore()
    await admin`insert into crm.exceptions (market_code, kind, severity, account_id, detail, dedupe_key) values ('MX', 'perfect_store_low', 'low', ${acc.id}, '{}'::jsonb, ${'perfect_store_low:' + acc.id})`
    const job = JOBS.find((j) => j.key.startsWith('automatizaciones.') && /rules|engine|notice/.test(j.key))
    if (job) await withSystem((tx) => job.run(tx))
    expect((await admin`select 1 from crm.exceptions where dedupe_key = ${'perfect_store_low:' + acc.id} and resolved_at is null`).length).toBe(1)
  })
})

describe('CAMPO-08 punto de venta perfecto en la salud', () => {
  it('el último puntaje vigente entra como grupo de la salud con su peso', async () => {
    const acc = await one(admin<{ id: string }[]>`
      select a.id from crm.accounts a where a.market_code = 'MX' and a.lifecycle in ('active','at_risk','inactive') and a.archived_at is null and a.merged_into is null
         and exists (select 1 from crm.merchant_metrics_daily m where m.account_id = a.id) limit 1`)
    await admin`insert into crm.perfect_store_scores (account_id, market_code, score, items_ok, items_total, observed_at) values (${acc.id}, 'MX', 80, 8, 10, now() - interval '1 hour')`
    await withSystem((tx) => tx`select app.health_snapshot_run('MX')`)
    const h = await one(admin<{ groups: { grp: string; raw: number | null; points: number | null }[] }[]>`select groups from crm.health_snapshots where account_id = ${acc.id} order by as_of desc limit 1`)
    const ps = h.groups.find((g) => g.grp === 'perfect_store')!
    expect(Number(ps.raw)).toBe(80)
    expect(Number(ps.points)).toBe(8)
  })
})

describe('CAMPO-06 expediente desde la Sales App y por enlace', () => {
  it('onboarding.submitted abre el expediente con lo que trae y, completo, lo manda a la mesa', async () => {
    const sys = await systemContext()
    const acc = await salesAppStore()
    const reqs = await admin<{ code: string }[]>`select code from crm.onboarding_requirements where market_code = 'MX' and person_type = 'company' and funding in ('ach_credit','any') and is_active`
    const res = await ingestSalesAppEvent(sys, { event_id: `ev-${tag()}${tag()}`, type: 'onboarding.submitted', version: 1, occurred_at: now(),
      data: { customer_id: acc.customer, submitted_at: now(), person_type: 'company', funding: 'ach_credit', documents_complete: true,
        documents: reqs.map((r) => ({ requirement: r.code, link: 'https://docs.ejemplo.test/' + r.code })) } })
    expect(res.status).toBe('processed')
    const f = await one(admin<{ status: string; captured_via: string; person_type: string }[]>`select status, captured_via, person_type from crm.onboarding_files where account_id = ${acc.id}`)
    expect(f).toMatchObject({ status: 'submitted', captured_via: 'sales_app', person_type: 'company' })
  })
  it('sin documentos queda en captura; el enlace con código deja enlaces y envía; un código falso o usado no sirve', async () => {
    const sys = await systemContext()
    const acc = await salesAppStore()
    await ingestSalesAppEvent(sys, { event_id: `ev-${tag()}${tag()}`, type: 'onboarding.submitted', version: 1, occurred_at: now(), data: { customer_id: acc.customer, submitted_at: now() } })
    const f = await one(admin<{ id: string; status: string; person_type: string; funding: string }[]>`select id, status, person_type, funding from crm.onboarding_files where account_id = ${acc.id}`)
    expect(f).toMatchObject({ status: 'draft', person_type: 'individual', funding: 'prepaid' })
    const marco = await ctxFor('marco.pena')
    const { token } = await createOnboardingLink(marco, f.id)
    expect((await one(admin<{ token_hash: string }[]>`select token_hash from crm.onboarding_links where file_id = ${f.id}`)).token_hash).not.toBe(token)
    expect(await onboardingLinkView(sys, 'x'.repeat(30))).toBeNull()
    const view = (await onboardingLinkView(sys, token))!
    expect(view.docs.length).toBeGreaterThan(0)
    await expect(onboardingLinkReceive(sys, token, view.docs[0]!.id, 'http://inseguro.test/x')).rejects.toMatchObject({ code: 'invalid' })
    for (const d of view.docs) await onboardingLinkReceive(sys, token, d.id, 'https://docs.ejemplo.test/' + d.id)
    expect(['submitted', 'auto_approved']).toContain(await onboardingLinkSubmit(sys, token))
    expect(await onboardingLinkView(sys, token)).toBeNull()
  })
})

describe('SEG-06 instalación y retiro de equipo ligados al incidente', () => {
  it('el retiro llega de la Sales App y el incidente de ese día se liga a él, a la atribución y a la señal', async () => {
    const sys = await systemContext()
    const acc = await salesAppStore()
    const r = await ingestSalesAppEvent(sys, { event_id: `ev-${tag()}${tag()}`, type: 'equipment.changed', version: 1, occurred_at: now(),
      data: { customer_id: acc.customer, action: 'retired', equipment_type: 'terminal', equipment_ref: 'T-100', trust_score: 35 } })
    expect(r.status).toBe('processed')
    const marco = await ctxFor('marco.pena')
    const id = await reportIncident(marco, { market: 'MX', accountId: acc.id, partyKind: 'other', partyLabel: 'Encargado de la tienda', type: 'equipment', occurredOn: today(), description: 'El equipo se retiró sin aviso a la tienda.' })
    const inc = await one(admin<{ equipment_event_id: string | null; trust_score: number | null; attribution: Record<string, string> }[]>`select equipment_event_id, trust_score, attribution from crm.field_incidents where id = ${id}`)
    expect(inc.equipment_event_id).not.toBeNull()
    expect(inc.trust_score).toBe(35)
    expect(inc.attribution.origin).toBe('Sales App')
    expect(inc.attribution.channel).toBeTruthy()
    const ana = await ctxFor('ana.robles')
    const row = (await incidents(ana, 'MX')).find((x) => x.id === id)!
    expect(row.equipment?.kind).toBe('retired')
    // el incidente sigue siendo confidencial: otra persona que vende no lo ve
    expect((await incidents(await ctxFor('lucia.vega'), 'MX')).some((x) => x.id === id)).toBe(false)
  })
})

describe('CANAL-03 atribución completa en el alta y corrida auditada', () => {
  it('la regla decide red adquirida o alta nueva con la evidencia del comercio', () => {
    expect(classifyOrigin({ merchant_origin: 'emida_conversion', network_alias: false }).kind).toBe('network_conversion')
    expect(classifyOrigin({ merchant_origin: null, network_alias: true }).kind).toBe('network_conversion')
    expect(classifyOrigin({ merchant_origin: null, network_alias: false })).toEqual({ kind: 'new_acquisition', evidence: 'created_here' })
  })
  it('el alta desde la pantalla y desde la Sales App nace con origen clasificado, equipo reclutador y quien lo lleva', async () => {
    const marco = await ctxFor('marco.pena')
    const { id } = await createAccount(marco, { market: 'MX', kind: 'store', name: `Abarrotes Atribución ${tag()}`, segment: 'd2d', phone: '', locality: '', region: '' } as never)
    const rows = await admin<{ layer: string; party_kind: string; party_label: string; origin_kind: string | null }[]>`select layer, party_kind, party_label, origin_kind from crm.account_attributions where account_id = ${id} and effective_to is null order by layer`
    expect(rows.find((r) => r.layer === 'origin')!.origin_kind).toBe('new_acquisition')
    const ch = rows.find((r) => r.layer === 'channel')!
    expect(ch.party_kind).toBe('team')
    expect(ch.party_label).not.toBe('D2D')
    const app = await salesAppStore()
    const layers = await admin<{ layer: string; origin_kind: string | null }[]>`select layer, origin_kind from crm.account_attributions where account_id = ${app.id} and effective_to is null order by layer`
    expect(layers.map((l) => l.layer)).toEqual(['channel', 'origin', 'owner'])
    expect(layers.find((l) => l.layer === 'origin')!.origin_kind).toBe('new_acquisition')
  })
  it('la corrida clasifica lo pendiente con la misma regla, cambia el canal heredado por el equipo y deja la bitácora', async () => {
    const acc = await salesAppStore()
    await admin`update crm.account_attributions set origin_kind = null where account_id = ${acc.id} and layer = 'origin'`
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${acc.id}, 'MX', 'emida', ${'EM-' + tag()})`
    await admin`update crm.account_attributions set effective_to = now() where account_id = ${acc.id} and layer = 'channel' and effective_to is null`
    await admin`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label) values (${acc.id}, 'MX', 'channel', 'team', 'd2d', 'D2D')`
    await expect(reclassifyAttribution(await ctxFor('marco.pena'), 'MX')).rejects.toMatchObject({ code: 'forbidden' })
    const r = await reclassifyAttribution(await ctxFor('ana.robles'), 'MX')
    expect(r.network).toBeGreaterThanOrEqual(1)
    const o = await one(admin<{ origin_kind: string; reason: string }[]>`select origin_kind, reason from crm.account_attributions where account_id = ${acc.id} and layer = 'origin' and effective_to is null`)
    expect(o.origin_kind).toBe('network_conversion')
    expect(o.reason).toMatch(/red adquirida/)
    const ch = await one(admin<{ party_label: string; correction_of: string | null }[]>`select party_label, correction_of from crm.account_attributions where account_id = ${acc.id} and layer = 'channel' and effective_to is null`)
    expect(ch.party_label).not.toBe('D2D')
    expect(ch.correction_of).not.toBeNull()
    expect((await admin`select 1 from crm.account_attributions where layer = 'origin' and effective_to is null and origin_kind is null and market_code = 'MX'`).length).toBe(0)
    expect((await admin`select 1 from crm.audit_events where action = 'attribution.reclassified' and market_code = 'MX'`).length).toBeGreaterThan(0)
  })
})

describe('CANAL-02 el aliado registra y ve sus registros', () => {
  it('registra a nombre de su nodo, ve solo lo suyo y la venta directa no lo ve', async () => {
    const iso = await ctxFor('iso.partner')
    const root = await one(admin<{ id: string }[]>`select md5('contigo:dat-us-iso')::uuid as id`)
    const store = `Corner Store ${tag()}`
    const out = await partnerRegisterClaim(iso, { root: root.id, storeName: store, city: 'Laredo' })
    expect(out.status).toBe('registered')
    const again = await partnerRegisterClaim(iso, { root: root.id, storeName: store, city: 'Laredo' })
    expect(again.status).toBe('registered')
    const x = await partnerExtras(iso)
    expect(x.claims.some((c) => c.store_name === store)).toBe(true)
    expect(x.rules[0]!.window_days).toBeGreaterThan(0)
    expect(x.claims.every((c) => typeof c.store_name === 'string')).toBe(true)
    // la venta directa no ve registros de canal; quien lidera el mercado sí, marcado como del aliado
    expect((await claims(await ctxFor('sam.ortiz'), 'US')).length).toBe(0)
    expect((await claims(await ctxFor('robert.hale'), 'US')).find((c) => c.store_name === store)?.registered_via).toBe('partner')
    // un nodo que no es suyo no se puede usar
    const other = await one(admin<{ id: string }[]>`select id from crm.accounts where market_code = 'US' and id <> md5('contigo:dat-us-iso')::uuid limit 1`)
    await expect(partnerRegisterClaim(iso, { root: other.id, storeName: store, city: 'Laredo' })).rejects.toMatchObject({ code: 'not_found' })
    // quien vende no registra como aliado
    await expect(partnerRegisterClaim(await ctxFor('sam.ortiz'), { root: root.id, storeName: store, city: 'Laredo' })).rejects.toBeTruthy()
  })
})

describe('CANAL-05 estado de comisión estimado y publicado', () => {
  it('se estima por persona y por aliado sin montos, cada quien ve lo suyo y publicar exige reglas escritas', async () => {
    await withSystem((tx) => estimateStatementsTx(tx, 'MX'))
    await withSystem((tx) => estimateStatementsTx(tx, 'US'))
    const marco = await ctxFor('marco.pena')
    const mine = await myStatements(marco)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((s) => s.status === 'estimate' && s.party_label)).toBe(true)
    expect(Object.keys(mine[0]!.counts)).toEqual(expect.arrayContaining(['enrolled', 'first_sales', 'active_90', 'threshold', 'team_active_90']))
    expect(JSON.stringify(mine[0]!.counts)).not.toMatch(/amount|monto/)
    expect((await admin`select 1 from crm.commission_statements where party_kind = 'user' and party_ref <> ${marco.user.id}`).length).toBeGreaterThan(0)
    // el aliado ve el suyo desde su portal
    const iso = await partnerExtras(await ctxFor('iso.partner'))
    expect(iso.statements.length).toBeGreaterThan(0)
    const ana = await ctxFor('ana.robles')
    await expect(publishStatement(ana, mine[0]!.id, '')).rejects.toMatchObject({ code: 'invalid' })
    await expect(publishStatement(marco, mine[0]!.id, 'Reglas 2026')).rejects.toMatchObject({ code: 'forbidden' })
    await publishStatement(ana, mine[0]!.id, 'Reglas de incentivo 2026, versión aprobada')
    await admin`update crm.merchant_metrics_daily set txn_count_30d = txn_count_30d where false`
    await withSystem((tx) => estimateStatementsTx(tx, 'MX'))
    const pub = await one(admin<{ status: string; rules_ref: string }[]>`select status, rules_ref from crm.commission_statements where id = ${mine[0]!.id}`)
    expect(pub).toMatchObject({ status: 'published', rules_ref: 'Reglas de incentivo 2026, versión aprobada' })
  })
})

describe('CANAL-06 avance de capacitación y cruce', () => {
  it('el avance se anota mientras Kore Academy está apagado y el aliado lo ve en su portal', async () => {
    const hale = await ctxFor('robert.hale')
    const mat = await one(admin<{ id: string }[]>`insert into crm.partner_enablement (market_code, tier_code, title_es, title_en, url) values ('US', 'base', 'Curso base', 'Base course', 'https://academy.ejemplo.test/base') returning id`)
    const root = (await one(admin<{ id: string }[]>`select md5('contigo:dat-us-iso')::uuid as id`)).id
    await expect(recordEnablementProgress(await ctxFor('sam.ortiz'), { partner: root, material: mat.id, learner: 'Agente 1', pct: '50' })).rejects.toMatchObject({ code: 'forbidden' })
    await recordEnablementProgress(hale, { partner: root, material: mat.id, learner: 'Agente 1', pct: '100' })
    const x = await partnerExtras(await ctxFor('iso.partner'))
    expect(x.progress.find((p) => p.material_es === 'Curso base')).toMatchObject({ progress_pct: 100, source: 'manual' })
    const sync = await withSystem((tx) => syncAcademyProgressTx(tx))
    expect(sync.note).toMatch(/off/)
  })
})

describe('CANAL-08 política de reversos y árbitro por escrito', () => {
  it('la política nace propuesta; con árbitro nombrado solo esa persona (o administración) resuelve', async () => {
    const ana = await ctxFor('ana.robles')
    const nora = await ctxFor('nora.salas')
    const marco = await ctxFor('marco.pena')
    expect((await proposedValues(ana)).some((p) => p.key === 'clawback_policy' && p.market_code === 'MX')).toBe(true)
    const base = { market: 'MX', clawbackDays: '60', policyEs: 'Si se aprueba un reverso dentro de la ventana, la atribución se corrige con una fila nueva.', policyEn: 'If a reversal is approved within the window, the attribution is corrected with a new row.', reason: 'Prueba' }
    await expect(setChannelPolicy(marco, base)).rejects.toMatchObject({ code: 'forbidden' })
    const v = await setChannelPolicy(ana, { ...base, arbiterId: nora.user.id })
    expect(v).toBeGreaterThanOrEqual(2)
    const pol = await one(admin<{ status: string; pending_owner: string | null }[]>`select status, pending_owner from crm.channel_policies where market_code = 'MX' and valid_to is null`)
    expect(pol).toMatchObject({ status: 'proposed', pending_owner: 'Finanzas y Ventas' })
    const acc = await salesAppStore()
    const id = await raiseDispute(marco, { accountId: acc.id, layer: 'channel', kind: 'dispute', claimedKind: 'user', claimedRef: marco.user.id, claimedLabel: 'Marco Peña', reason: 'La tienda la recluté yo en la visita.' })
    await expect(resolveDispute(ana, id, 'reject', 'No procede')).rejects.toMatchObject({ code: 'invalid' })
    await resolveDispute(nora, id, 'reject', 'No procede: quedó con el equipo')
    await setChannelPolicy(ana, { ...base, financeBy: 'Persona de Finanzas', salesBy: 'Persona de Ventas', reason: 'Aprobada' })
    expect((await one(admin<{ status: string }[]>`select status from crm.channel_policies where market_code = 'MX' and valid_to is null`)).status).toBe('approved')
  })
})

describe('CS-06 y CS-08', () => {
  it('el cambio de encargado viaja en la visita y abre lo mismo que en la pantalla', async () => {
    const sys = await systemContext()
    const acc = await salesAppStore()
    await ingestSalesAppEvent(sys, visit(acc.customer, { manager_change: { new_name: 'Rosa Encargada', note: 'Entró esta semana' } }))
    const m = await one(admin<{ new_name: string; source: string }[]>`select new_name, source from crm.manager_changes where account_id = ${acc.id}`)
    expect(m).toMatchObject({ new_name: 'Rosa Encargada', source: 'visit' })
  })
  it('el resumen semanal queda en la cola hacia P&T con el canal apagado y sale como evento', async () => {
    await withSystem((tx) => feedbackDigest(tx))
    const d = await one(admin<{ delivery_status: string | null }[]>`select delivery_status from crm.feedback_digests order by created_at desc limit 1`)
    expect(d.delivery_status).toBe('queued_off')
    expect(decide('feedback.digest_sent')).toEqual({ emit: 'auto' })
  })
})

describe('campo2: registro de lo nuevo', () => {
  it('tareas, acciones de bitácora con nombre y clasificación de eventos', () => {
    expect(JOBS.map((j) => j.key)).toEqual(expect.arrayContaining(['campo2.statements', 'campo2.academy_progress']))
    for (const a of ['attribution.reclassified', 'onboarding.link_created', 'integration.equipment_received', 'feedback.digest_sent', 'commission_statement.estimated', 'commission_statement.published', 'channel_policy.changed', 'enablement.progress_recorded']) {
      expect(AUDIT_ACTION[a], a).toBeTruthy()
      expect(decide(a), a).not.toMatchObject({ unclassified: true })
    }
  })
})
