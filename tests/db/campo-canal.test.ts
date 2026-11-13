import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId } from './helpers'
import { withSystem } from '@/server/db'
import { assignFile, decideFile, markReceived, openDocument, openFile, reviewDocument, submitFile } from '@/domain/campo-canal/expediente'
import { correctAttribution, decideCreditLimit, expireClaimsTx, extendClaim, raiseDispute, registerClaim, rejectClaim, requestCreditLimit, resolveDispute, simulateFunding } from '@/domain/campo-canal/canal'
import { addCompetitor, applyPlan, computePriorityTx, draftPlan, evaluateFieldExceptionsTx, handleIncident, ingestPerfectStoreTx, recordCompetitor, reportIncident, setChannelAssignment, setRepPlan, setTerritoryOwner } from '@/domain/campo-canal/campo'
import { setThreshold } from '@/domain/campo-canal/thresholds'
import { attributionCycle, claims, competitorReport, incidents, plans, priorityToday } from '@/dal/campo-canal'
import { JOBS } from '@/server/jobs/registry'

// Paquete campo-canal (programa los 95, ola 3). Una prueba por regla del encargo.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x')
const DENIED = '42501'

/** Una tienda de Marco (MX) sin expediente abierto. */
const marcoStore = (skip = 0) => one(admin<{ id: string; name: string }[]>`
  select a.id, a.name from crm.accounts a where a.owner_id = md5('contigo:marco.pena')::uuid and a.archived_at is null
     and not exists (select 1 from crm.onboarding_files f where f.account_id = a.id)
   order by a.id offset ${skip} limit 1`)

describe('CAMPO-06 expediente y mesa de control', () => {
  it('el expediente sale del formulario maestro del país, se captura una vez y prepago se aprueba por regla', async () => {
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(0)
    const id = await openFile(marco, { accountId: store.id, personType: 'individual', funding: 'prepaid', visitedOn: '2026-11-01' })
    const docs = await admin<{ id: string; requirement: string; status: string; pii_class: string; retention_until: string | null }[]>`select id, requirement, status, pii_class, retention_until::text from crm.onboarding_documents where file_id = ${id} order by requirement`
    expect(docs.map((d) => d.requirement)).toEqual(['comprobante_domicilio', 'constancia_fiscal', 'identidad_verificada'])
    expect(docs.every((d) => d.status === 'missing' && d.retention_until)).toBe(true)
    expect(docs.find((d) => d.requirement === 'identidad_verificada')!.pii_class).toBe('personal')
    // no se abre otro expediente para el mismo comercio
    await expect(openFile(marco, { accountId: store.id, personType: 'company', funding: 'prepaid' })).rejects.toMatchObject({ code: 'invalid' })
    // no se envía incompleto; el enlace tiene que ser https (nunca el archivo)
    await expect(submitFile(marco, id)).rejects.toMatchObject({ code: 'invalid' })
    await expect(markReceived(marco, docs[0]!.id, 'ftp://algo')).rejects.toMatchObject({ code: 'invalid' })
    for (const d of docs) await markReceived(marco, d.id, 'https://docs.ejemplo.test/expediente/1')
    expect(await submitFile(marco, id)).toBe('auto_approved')
    const f = await one(admin<{ status: string; decision_note: string }[]>`select status, decision_note from crm.onboarding_files where id = ${id}`)
    expect(f.status).toBe('auto_approved')
    expect(f.decision_note).toMatch(/versión 1/)
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action = 'onboarding.auto_approved'`).length).toBe(1)
  })

  it('crédito ACH pasa por la mesa con plazo: Operaciones valida cada documento con quién y cuándo; quien vende no revisa', async () => {
    const marco = await ctxFor('marco.pena')
    const val = await ctxFor('valeria.soto')
    const store = await marcoStore(0)
    const id = await openFile(marco, { accountId: store.id, personType: 'company', funding: 'ach_credit' })
    const docs = await admin<{ id: string }[]>`select id from crm.onboarding_documents where file_id = ${id}`
    for (const d of docs) await markReceived(marco, d.id, '')
    expect(await submitFile(marco, id)).toBe('submitted')
    const f = await one(admin<{ status: string; due_at: Date; submitted_at: Date }[]>`select status, due_at, submitted_at from crm.onboarding_files where id = ${id}`)
    expect(Math.round((f.due_at.getTime() - f.submitted_at.getTime()) / 3600000)).toBe(24)
    await expect(reviewDocument(marco, docs[0]!.id, 'valid', '')).rejects.toMatchObject({ code: 'forbidden' })
    await assignFile(val, id)
    await expect(decideFile(val, id, 'approve', '')).rejects.toMatchObject({ code: 'invalid' })
    await reviewDocument(val, docs[0]!.id, 'rejected', 'Comprobante vencido')
    await expect(decideFile(val, id, 'return', '')).rejects.toMatchObject({ code: 'invalid' })
    await decideFile(val, id, 'return', 'Falta comprobante vigente')
    expect((await one(admin<{ status: string }[]>`select status from crm.onboarding_files where id = ${id}`)).status).toBe('returned')
    // Corrige, reenvía, se valida todo y se aprueba
    await markReceived(marco, docs[0]!.id, 'https://docs.ejemplo.test/expediente/2')
    expect(await submitFile(marco, id)).toBe('submitted')
    for (const d of docs) await reviewDocument(val, d.id, 'valid', '')
    await decideFile(val, id, 'approve', '')
    const v = await admin<{ validated_by: string; validated_at: Date }[]>`select validated_by, validated_at from crm.onboarding_documents where file_id = ${id}`
    expect(v.every((x) => x.validated_by === val.user.id && x.validated_at)).toBe(true)
    // Abrir un documento con la bóveda apagada no entrega archivo y queda en la bitácora de lectura
    expect((await openDocument(val, docs[0]!.id)).outcome).toBe('link')
    expect(await openDocument(val, docs[1]!.id)).toEqual({ outcome: 'vault_off', url: null })
    const reads = await admin`select outcome from crm.document_reads where document_id = any(${[docs[0]!.id, docs[1]!.id]}::uuid[])`
    expect(reads.length).toBe(2)
  })
})

describe('CANAL-03 atribución con vigencias y correcciones', () => {
  it('la base impide dos filas vigentes encimadas; corregir abre una fila nueva con motivo y correction_of', async () => {
    const ana = await ctxFor('ana.robles')
    const marco = await ctxFor('marco.pena')
    const store = await marcoStore(1)
    const before = await admin<{ id: string }[]>`select id from crm.account_attributions where account_id = ${store.id} and layer = 'origin' and effective_to is null`
    // doble vigente: lo rechaza la restricción de exclusión
    let code = 'ok'
    try {
      await admin`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, effective_from) values (${store.id}, 'MX', 'channel', 'team', 'x', 'Equipo X', now() - interval '3 days')`
      await admin`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, effective_from) values (${store.id}, 'MX', 'channel', 'team', 'y', 'Equipo Y', now() - interval '1 day')`
    } catch (e) { code = (e as { code?: string }).code ?? 'error' }
    expect(code).toBe('23P01')
    await expect(correctAttribution(marco, store.id, { layer: 'origin', partyKind: 'team', partyRef: 't1', partyLabel: 'Equipo reclutador norte', reason: 'Venía de la red' })).rejects.toMatchObject({ code: 'forbidden' })
    const id = await correctAttribution(ana, store.id, { layer: 'origin', partyKind: 'team', partyRef: 't1', partyLabel: 'Equipo reclutador norte', reason: 'Venía de una red adquirida', originKind: 'network_conversion' })
    const row = await one(admin<{ correction_of: string | null; reason: string; origin_kind: string }[]>`select correction_of, reason, origin_kind from crm.account_attributions where id = ${id}`)
    expect(row).toMatchObject({ reason: 'Venía de una red adquirida', origin_kind: 'network_conversion' })
    expect(row.correction_of).toBe(before[0]?.id ?? null)
    const live = await admin`select 1 from crm.account_attributions where account_id = ${store.id} and layer = 'origin' and effective_to is null`
    expect(live.length).toBe(1)
    const cycle = await attributionCycle(ana, 'MX', new Date().toISOString().slice(0, 7))
    expect(cycle.corrections).toBeGreaterThanOrEqual(1)
    expect(cycle.network).toBeGreaterThanOrEqual(1)
  })
})

describe('CANAL-08 disputas', () => {
  it('quien vende levanta la disputa, no la arbitra; al aprobarla se crea la fila corregida', async () => {
    const marco = await ctxFor('marco.pena')
    const ana = await ctxFor('ana.robles')
    const store = await marcoStore(2)
    const id = await raiseDispute(marco, { accountId: store.id, layer: 'channel', kind: 'dispute', claimedKind: 'team', claimedRef: 't-d2d', claimedLabel: 'D2D Centro', reason: 'Lo trajo el equipo de calle' })
    await expect(raiseDispute(marco, { accountId: store.id, layer: 'channel', kind: 'dispute', claimedKind: 'team', claimedRef: 't-d2d', claimedLabel: 'D2D Centro', reason: 'Otra vez la misma' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(resolveDispute(marco, id, 'approve', 'Me la apruebo')).rejects.toMatchObject({ code: 'forbidden' })
    await resolveDispute(ana, id, 'approve', 'Confirmado con la supervisión')
    const d = await one(admin<{ status: string; arbiter_id: string; correction_id: string }[]>`select status, arbiter_id, correction_id from crm.attribution_disputes where id = ${id}`)
    expect(d).toMatchObject({ status: 'approved', arbiter_id: ana.user.id })
    const c = await one(admin<{ party_label: string; reason: string }[]>`select party_label, reason from crm.account_attributions where id = ${d.correction_id}`)
    expect(c.party_label).toBe('D2D Centro')
    expect(c.reason).toMatch(/^Disputa aprobada/)
  })
})

describe('CANAL-02 registros de canal', () => {
  it('el primero gana la ventana; el segundo recibe solo hasta cuándo; la venta directa no los ve; el job los vence', async () => {
    const ana = await ctxFor('ana.robles')
    const store = `Abarrotes Canal ${tag()}`
    const a = await registerClaim(ana, { market: 'MX', storeName: store, city: 'Puebla', nodeRef: 'dist-1', nodeLabel: 'Distribuidora Uno', channel: 'indirect' })
    expect(a.status).toBe('registered')
    const b = await registerClaim(ana, { market: 'MX', storeName: store.toUpperCase(), city: 'puebla', nodeRef: 'dist-2', nodeLabel: 'Distribuidora Dos', channel: 'indirect' })
    expect(b.status).toBe('held')
    const rejected = await admin`select rejection_reason from crm.channel_claims where node_ref = 'dist-2' and store_name = ${store.toUpperCase()}`
    expect(rejected[0]?.rejection_reason).toBe('Ya tiene registro vigente de otro canal')
    if (a.status !== 'registered') throw new Error('x')
    await expect(extendClaim(ana, a.id, 'x')).rejects.toMatchObject({ code: 'invalid' })
    await extendClaim(ana, a.id, 'Visita con propuesta el martes')
    expect((await one(admin<{ extensions: number }[]>`select extensions from crm.channel_claims where id = ${a.id}`)).extensions).toBe(1)
    // RLS: quien vende y supervisión no ven registros del aliado
    expect(await asPersona('marco.pena', (tx) => tx`select 1 from crm.channel_claims`.then((r) => r.length))).toBe(0)
    expect(await asPersona('fernando.ibarra', (tx) => tx`select 1 from crm.channel_claims`.then((r) => r.length))).toBe(0)
    expect((await claims(ana, 'MX')).some((c) => c.id === a.id)).toBe(true)
    await admin`update crm.channel_claims set expires_at = now() - interval '1 minute' where id = ${a.id}`
    const n = await withSystem((tx) => expireClaimsTx(tx))
    expect(n).toBeGreaterThanOrEqual(1)
    expect((await one(admin<{ status: string }[]>`select status from crm.channel_claims where id = ${a.id}`)).status).toBe('expired')
    const c = await registerClaim(ana, { market: 'MX', storeName: store, city: 'Puebla', nodeRef: 'dist-2', nodeLabel: 'Distribuidora Dos', channel: 'indirect' })
    expect(c.status).toBe('registered')
    if (c.status === 'registered') await rejectClaim(ana, c.id, 'Fuera de zona del aliado')
  })
})

describe('CANAL-07 fondeo y CAMPO-04 avisos con umbral versionado', () => {
  it('saldo simulado abre el aviso de saldo bajo con la versión del umbral; el límite lo aprueba otra persona', async () => {
    const nora = await ctxFor('nora.salas')
    const marco = await ctxFor('marco.pena')
    const ana = await ctxFor('ana.robles')
    const store = await marcoStore(3)
    await expect(simulateFunding(marco, { accountId: store.id, method: 'prepaid', balance: '10' })).rejects.toMatchObject({ code: 'forbidden' })
    await simulateFunding(nora, { accountId: store.id, method: 'prepaid', balance: '120.50' })
    await expect(simulateFunding(nora, { accountId: store.id, method: 'prepaid', balance: '1' })).rejects.toMatchObject({ code: 'invalid' })
    const v2 = await setThreshold(ana, { market: 'MX', key: 'low_balance_minor', value: 20000, reason: 'Calibración de prueba' })
    expect(v2).toBe(2)
    await expect(setThreshold(marco, { market: 'MX', key: 'low_balance_minor', value: 1, reason: 'no' })).rejects.toMatchObject({ code: 'forbidden' })
    await withSystem((tx) => evaluateFieldExceptionsTx(tx))
    const e = await one(admin<{ owner_id: string; rule_version: number; rule_key: string }[]>`select owner_id, rule_version, rule_key from crm.exceptions where kind = 'low_balance' and account_id = ${store.id} and resolved_at is null`)
    expect(e).toMatchObject({ owner_id: marco.user.id, rule_version: 2, rule_key: 'low_balance_minor' })
    // con el umbral más bajo que el saldo, el aviso se cierra solo
    await setThreshold(ana, { market: 'MX', key: 'low_balance_minor', value: 5000, reason: 'Calibración de prueba 2' })
    await withSystem((tx) => evaluateFieldExceptionsTx(tx))
    expect((await admin`select 1 from crm.exceptions where kind = 'low_balance' and account_id = ${store.id} and resolved_at is null`).length).toBe(0)
    // límite de crédito: lo pide quien vende, no lo aprueba quien lo pidió
    const req = await requestCreditLimit(marco, { accountId: store.id, amount: '5000', reason: 'Vende mucho los fines de semana' })
    await expect(decideCreditLimit(marco, req, 'approve', 'Me lo apruebo')).rejects.toMatchObject({ code: 'forbidden' })
    await decideCreditLimit(ana, req, 'approve', 'Historial bueno')
    expect((await one(admin<{ status: string; decided_by: string }[]>`select status, decided_by from crm.credit_limit_requests where id = ${req}`))).toMatchObject({ status: 'approved', decided_by: ana.user.id })
  })

  it('quien va por debajo de su meta del mes aparece en los avisos con su dueño', async () => {
    const ana = await ctxFor('ana.robles')
    const lucia = await personaId('lucia.vega')
    const month = await one(admin<{ m: string }[]>`select to_char(now() at time zone 'America/Mexico_City', 'YYYY-MM') as m`)
    await setRepPlan(ana, { market: 'MX', userId: lucia, month: month.m, target: 900 })
    await withSystem((tx) => evaluateFieldExceptionsTx(tx))
    const e = await one(admin<{ owner_id: string; detail: { target: number } }[]>`select owner_id, detail from crm.exceptions where kind = 'under_plan' and owner_id = ${lucia} and resolved_at is null`)
    expect(e.detail.target).toBe(900)
  })

  it('el punto de venta perfecto llega como puntaje y abre aviso bajo el mínimo', async () => {
    const store = await marcoStore(4)
    await withSystem((tx) => ingestPerfectStoreTx(tx, { account_id: store.id, items_ok: 2, items_total: 6, observed_at: new Date().toISOString(), visit_ref: 'v-1' }, 'test'))
    const s = await one(admin<{ score: number }[]>`select score from crm.perfect_store_scores where account_id = ${store.id}`)
    expect(s.score).toBe(33)
    await withSystem((tx) => evaluateFieldExceptionsTx(tx))
    expect((await admin`select 1 from crm.exceptions where kind = 'perfect_store_low' and account_id = ${store.id} and resolved_at is null`).length).toBe(1)
  })
})

describe('CAMPO-02 prioridad diaria', () => {
  it('cada tienda activa con razón visible, segmento y grupo de control por territorio', async () => {
    const n = await withSystem((tx) => computePriorityTx(tx))
    expect(n).toBeGreaterThan(0)
    const rows = await admin<{ segment: string; reasons: unknown[]; holdout: boolean }[]>`select segment, reasons, holdout from crm.store_priority where market_code = 'MX'`
    expect(new Set(rows.map((r) => r.segment)).size).toBeLessThanOrEqual(4)
    expect(rows.some((r) => r.holdout)).toBe(true)
    expect(rows.some((r) => !r.holdout)).toBe(true)
    // idempotente: correr dos veces no duplica
    const again = await withSystem((tx) => computePriorityTx(tx))
    expect(again).toBe(n)
    const marco = await ctxFor('marco.pena')
    const mine = await priorityToday(marco, 'MX', true)
    expect(mine.rows.every((r) => r.reasons.length > 0)).toBe(true)
    expect(JOBS.some((j) => j.key === 'campo-canal.store_priority')).toBe(true)
  })
})

describe('CAMPO-03 cartera', () => {
  it('el plan en borrador dice quién pierde y quién gana visibilidad y se aplica entero; canal y polo con vigencia', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const ana = await ctxFor('ana.robles')
    const lucia = await personaId('lucia.vega')
    const marco = await personaId('marco.pena')
    const before = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where owner_id = ${lucia} and archived_at is null`)
    const id = await draftPlan(fer, { market: 'MX', fromUserId: lucia, toUserId: marco, note: 'Lucía pasa a captación' })
    // borrador: nada se movió
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where owner_id = ${lucia} and archived_at is null`)).n).toBe(before.n)
    const p = (await plans(fer, 'MX')).find((x) => x.id === id)!
    expect(p.diff.accounts).toBe(before.n)
    expect(p.diff.lose.some((x) => x.id === lucia)).toBe(true)
    expect(p.diff.gain.some((x) => x.id === marco)).toBe(true)
    const moved = await applyPlan(fer, id)
    expect(moved).toBe(before.n)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.accounts where owner_id = ${lucia} and archived_at is null`)).n).toBe(0)
    await expect(applyPlan(fer, id)).rejects.toMatchObject({ code: 'invalid' })
    // canal como eje: quien abre y quien cuida, cada cambio cierra el anterior
    const store = await marcoStore(5)
    await setChannelAssignment(fer, { accountId: store.id, channel: 'd2d', userId: marco, duty: 'hunter', reason: 'Lo abrió en calle' })
    await setChannelAssignment(fer, { accountId: store.id, channel: 'd2d', userId: lucia, duty: 'farmer', reason: 'Lo cuida en su ruta' })
    await setChannelAssignment(fer, { accountId: store.id, channel: 'telemarketing', userId: '', duty: 'farmer', reason: 'Pasa a cuidado telefónico' })
    const ca = await admin<{ duty: string; valid_to: Date | null }[]>`select duty, valid_to from crm.channel_assignments where account_id = ${store.id}`
    expect(ca.filter((c) => c.valid_to === null).length).toBe(2)
    // polo con dueño: lo pone quien lidera, no supervisión
    const terr = await one(admin<{ id: string }[]>`select id from crm.territories where market_code = 'MX' order by name limit 1`)
    await expect(setTerritoryOwner(fer, terr.id, marco)).rejects.toMatchObject({ code: 'forbidden' })
    await setTerritoryOwner(ana, terr.id, marco)
    expect((await admin`select 1 from crm.territory_owners where territory_id = ${terr.id} and valid_to is null`).length).toBe(1)
  })
})

describe('CAMPO-07 competencia', () => {
  it('observación estructurada con fecha y fuente, reportable por competidor', async () => {
    const marco = await ctxFor('marco.pena')
    const ana = await ctxFor('ana.robles')
    const store = await marcoStore(6)
    const comp = await addCompetitor(marco, 'MX', `Plataforma ${tag()}`)
    await recordCompetitor(marco, { accountId: store.id, competitorId: comp, product: 'Recargas', price: '10.50', observedOn: '2026-11-10', source: 'visit' })
    await expect(recordCompetitor(marco, { accountId: store.id, competitorId: comp, observedOn: '2099-01-01', source: 'visit' })).rejects.toMatchObject({ code: 'invalid' })
    const rep = (await competitorReport(ana, 'MX')).find((r) => r.stores > 0 && r.avg_price_minor === '1050')
    expect(rep).toBeTruthy()
  })
})

describe('SEG-06 incidentes de campo', () => {
  it('registro confidencial: lo ve quien reporta y quien lidera; otra persona que vende no; la bitácora no copia el texto', async () => {
    const marco = await ctxFor('marco.pena')
    const ana = await ctxFor('ana.robles')
    const desc = `Cobró una comisión extra al comercio ${tag()}`
    const id = await reportIncident(marco, { market: 'MX', partyKind: 'street_seller', partyLabel: 'Vendedor de calle', type: 'conduct', occurredOn: '2026-11-11', description: desc })
    expect(await asPersona('lucia.vega', (tx) => tx`select 1 from crm.field_incidents where id = ${id}`.then((r) => r.length))).toBe(0)
    expect(await asPersona('fernando.ibarra', (tx) => tx`select 1 from crm.field_incidents where id = ${id}`.then((r) => r.length))).toBe(0)
    expect((await incidents(ana, 'MX')).some((i) => i.id === id)).toBe(true)
    expect((await incidents(marco, 'MX')).some((i) => i.id === id)).toBe(true)
    // quien reporta no lo puede cerrar ni editar por la base
    await expect(handleIncident(marco, id, 'close', 'listo')).rejects.toMatchObject({ code: 'forbidden' })
    expect(await asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`update crm.field_incidents set status = 'in_review' where id = ${id}`))).toMatch(/0 rows|42501/)
    await handleIncident(ana, id, 'take', '')
    await handleIncident(ana, id, 'close', 'Se habló con la persona y se devolvió el cobro')
    const audit = await admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where object_id = ${id}`
    expect(JSON.stringify(audit)).not.toContain(desc)
    // un rol de solo lectura no reporta
    expect(await asPersona('luis.tovar', (tx) => attempt(tx, (sp) => sp`insert into crm.field_incidents (market_code, party_kind, party_label, type, occurred_on, description, reported_by)
      values ('MX', 'other', 'Alguien', 'other', '2026-11-11', 'Descripción de prueba larga', md5('contigo:luis.tovar')::uuid)`))).toBe(DENIED)
  })
})
