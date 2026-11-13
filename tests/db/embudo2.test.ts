import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, systemContext } from './helpers'
import { withUser } from '@/server/db'
import { createAccount } from '@/domain/accounts'
import { createDeal, updateDeal } from '@/domain/deals'
import { createLead } from '@/domain/leads'
import { completeItem } from '@/domain/queue'
import { createLossReason, updateLossReason } from '@/domain/b2b'
import { addEvidence } from '@/domain/automation/transitions'
import { saveAutomation, setAutomationOwner } from '@/domain/automation/admin'
import { getAutomation } from '@/dal/automations'
import { createAssignmentRule, decideRoutingSuggestion, editAssignmentRule, resolveOwner, logAssignment, routeNewAccount } from '@/domain/embudo/routing'
import { correctActivity, applyActivityRetention, weeklySalesSummary } from '@/domain/embudo2/activities'
import { saveFunnelSetting } from '@/domain/embudo2/settings'
import { setTransitionActive } from '@/domain/embudo2/transitions'
import { addActivity } from '@/domain/activities'
import { officialQueues } from '@/dal/reportes'
import { listAccounts } from '@/dal/accounts'
import { fullThread } from '@/dal/embudo'
import { findJob, runJob } from '@/server/jobs/runner'
import { addDays, isoDay } from '@/lib/format'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const today = isoDay(new Date(), 'America/Mexico_City')
const tomorrow = addDays(today, 1)
const uid = (k: string) => one(admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`).then((r) => r.id)
const stage = async (pipe: string, code: string) => (await one(admin<{ id: string }[]>`select s.id from crm.stages s where s.pipeline_id = md5(${'contigo:' + pipe})::uuid and s.code = ${code}`)).id
const mxPhone = () => `55 4${Math.floor(1000000 + Math.random() * 8999999)}`
const runRules = () => runJob(findJob('automatizaciones.reglas')!, 'manual', { force: true })
const openEx = (col: 'deal_id' | 'lead_id' | 'account_id', id: string, kind: string) =>
  admin`select 1 from crm.exceptions where ${admin(col)} = ${id} and kind = ${kind} and resolved_at is null`

async function dianaDeal() {
  const diana = await ctxFor('diana.cruz')
  const acc = await createAccount(diana, { market: 'MX', kind: 'chain', name: `Cadena embudo2 ${tag()}`, segment: 'b2b', force: true })
  const id = await createDeal(diana, { accountId: acc.id!, pipelineId: await uid('p-mx-b2b'), title: `Negocio ${tag()}`, nextStep: 'Llamar', nextStepDue: tomorrow })
  return { diana, accountId: acc.id!, id }
}

describe('ACT-02: próximo paso', () => {
  it('un lead contactado sin tarea siguiente y un comercio en alta sin tarea abren aviso en la cola de supervisión', async () => {
    const lucia = await ctxFor('lucia.vega')
    const leadId = await createLead(lucia, { market: 'MX', motor: 'd2d', businessName: `Abarrotes sin paso ${tag()}`, contactName: 'Rita Luna', phone: mxPhone() })
    await admin`update crm.leads set status = 'contacted' where id = ${leadId}`
    await admin`update crm.activities set done_at = now() where lead_id = ${leadId} and done_at is null`
    const acc = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Tienda en alta ${tag()}`, segment: 'd2d', force: true })
    await admin`update crm.accounts set lifecycle = 'onboarding' where id = ${acc.id!}`
    await runRules()
    expect(await openEx('lead_id', leadId, 'lead_no_next_step')).toHaveLength(1)
    expect(await openEx('account_id', acc.id!, 'onboarding_no_next_step')).toHaveLength(1)
    // Con una tarea siguiente, el aviso se cierra solo.
    await addActivity(lucia, { kind: 'task', subject: 'Volver a llamar', dueAt: tomorrow, leadId })
    await addActivity(lucia, { kind: 'task', subject: 'Pedir documentos', dueAt: tomorrow, accountId: acc.id! })
    await runRules()
    expect(await openEx('lead_id', leadId, 'lead_no_next_step')).toHaveLength(0)
    expect(await openEx('account_id', acc.id!, 'onboarding_no_next_step')).toHaveLength(0)
  })

  it('la fecha del próximo paso tiene tope configurable: no se calla la alerta con fechas a meses', async () => {
    const { diana, id } = await dianaDeal()
    await expect(updateDeal(diana, id, { nextStep: 'Llamar en un año', nextStepDue: addDays(today, 200) })).rejects.toMatchObject({ code: 'invalid' })
    await updateDeal(diana, id, { nextStep: 'Llamar en un mes', nextStepDue: addDays(today, 30) })
    // La base repite el límite para cualquier camino de la app.
    const code = await asPersona('diana.cruz', (tx) => attempt(tx, (sp) => sp`update crm.deals set next_step_due = ${addDays(today, 200)} where id = ${id}`))
    expect(code).toBe('22023')
    // El tope es un valor propuesto que administración cambia (queda en la bitácora).
    const nora = await ctxFor('nora.salas')
    await expect(saveFunnelSetting(diana, { key: 'next_step_max_days', market: null, value: '300', confirm: true })).rejects.toMatchObject({ code: 'forbidden' })
    await saveFunnelSetting(nora, { key: 'next_step_max_days', market: 'MX', value: '250', confirm: true })
    await updateDeal(diana, id, { nextStep: 'Llamar en un año', nextStepDue: addDays(today, 200) })
    await admin`delete from crm.funnel_settings where market_code = 'MX' and key = 'next_step_max_days'`
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'funnel.setting_changed'`)).n).toBeGreaterThan(0)
  })
})

describe('PIPE-03: estancamiento', () => {
  it('esperar al cliente y al carrier usan su propio umbral; un próximo paso por venir detiene el aviso', async () => {
    const { id } = await dianaDeal()
    const st = await stage('p-mx-b2b', 'calificacion')
    await admin`update crm.deals set stage_entered_at = now() - interval '20 days', next_step_due = ${addDays(today, -1)}, waiting_on = 'customer' where id = ${id}`
    await admin`update crm.stages set rot_days_customer = 30 where id = ${st}`
    await runRules()
    expect(await openEx('deal_id', id, 'stalled_deal')).toHaveLength(0) // 20 < 30 del cliente
    await admin`update crm.deals set waiting_on = 'carrier' where id = ${id}`
    await admin`update crm.stages set rot_days_carrier = 10 where id = ${st}`
    await runRules()
    expect(await openEx('deal_id', id, 'stalled_deal')).toHaveLength(1) // 20 > 10 del carrier
    await admin`update crm.deals set next_step_due = ${tomorrow} where id = ${id}`
    await runRules()
    expect(await openEx('deal_id', id, 'stalled_deal')).toHaveLength(0) // tiene un paso por venir
    await admin`update crm.stages set rot_days_customer = null, rot_days_carrier = null where id = ${st}`
  })

  it('alta sin primera venta usa el umbral de su etapa, no 7 días fijos', async () => {
    const def = await one(admin<{ conditions: { field: string }[] }[]>`select conditions from crm.automations where key = 'activation_risk' and market_code = 'MX'`)
    expect(def.conditions.map((c) => c.field)).toContain('over_stage_limit')
    const { id } = await dianaDeal()
    await admin`update crm.deals set stage_id = ${await stage('p-mx-b2b', 'espera')}, stage_entered_at = now() - interval '10 days' where id = ${id}`
    await runRules()
    expect(await openEx('deal_id', id, 'activation_risk')).toHaveLength(0) // la etapa se estanca a los 21
    await admin`update crm.deals set stage_entered_at = now() - interval '25 days' where id = ${id}`
    await runRules()
    expect(await openEx('deal_id', id, 'activation_risk')).toHaveLength(1)
  })
})

describe('PIPE-04: catálogo de motivos acotado y custodiado', () => {
  it('lo custodia administración; cada mercado tiene tope de motivos propios; nunca se borra un motivo', async () => {
    const nora = await ctxFor('nora.salas')
    const ana = await ctxFor('ana.robles')
    await expect(createLossReason(ana, { labelEs: 'Motivo de prueba', labelEn: 'Test reason', market: 'SV', motors: [] })).rejects.toMatchObject({ code: 'forbidden' })
    const before = (await one(admin<{ n: number }[]>`select count(*)::int as n from crm.loss_reasons where market_code = 'SV' and kind = 'no_sale' and is_active`)).n
    const made: string[] = []
    for (let i = before; i < 2; i++) made.push(await createLossReason(nora, { labelEs: `Motivo SV ${tag()}`, labelEn: `SV reason ${tag()}`, market: 'SV', motors: [], kind: 'no_sale' }))
    await expect(createLossReason(nora, { labelEs: 'Uno de más', labelEn: 'One too many', market: 'SV', motors: [], kind: 'no_sale' })).rejects.toMatchObject({ code: 'invalid' })
    const code = made[0] ?? (await one(admin<{ code: string }[]>`select code from crm.loss_reasons where market_code = 'SV' and kind = 'no_sale' and is_active limit 1`)).code
    await updateLossReason(nora, code, { motors: [], active: false })
    expect(await one(admin<{ retired_at: Date | null; is_active: boolean }[]>`select retired_at, is_active from crm.loss_reasons where code = ${code}`)).toMatchObject({ is_active: false })
    expect((await one(admin<{ retired_at: Date | null }[]>`select retired_at from crm.loss_reasons where code = ${code}`)).retired_at).not.toBeNull()
    expect(await asPersona('nora.salas', (tx) => attempt(tx, (sp) => sp`delete from crm.loss_reasons where code = ${code}`))).toBe('42501')
  })
})

describe('PIPE-02: evidencia como documento con huella; pasos de alta y crédito ACH propuestos', () => {
  it('la evidencia puede ser un documento del expediente (con su huella) o una huella; sin nada no se guarda', async () => {
    const { diana, id, accountId } = await dianaDeal()
    const to = await stage('p-mx-b2b', 'propuesta')
    await expect(addEvidence(diana, id, { toStageId: to, note: 'Sin nada' })).rejects.toMatchObject({ code: 'invalid' })
    const hash = 'a'.repeat(64)
    const file = await one(admin<{ id: string }[]>`insert into crm.onboarding_files (account_id, market_code, person_type, funding) values (${accountId}, 'MX', 'company', 'prepaid') returning id`)
    const doc = await one(admin<{ id: string }[]>`insert into crm.onboarding_documents (file_id, account_id, market_code, requirement, status, content_hash, storage_ref)
      values (${file.id}, ${accountId}, 'MX', 'acta', 'received', ${hash}, 'sim:acta') returning id`)
    await addEvidence(diana, id, { toStageId: to, note: 'Acta del expediente', documentId: doc.id })
    await addEvidence(diana, id, { toStageId: to, note: 'Contrato firmado', contentHash: 'B'.repeat(64) })
    const rows = await admin<{ content_hash: string; document_id: string | null; url: string | null }[]>`select content_hash, document_id, url from crm.deal_evidence where deal_id = ${id} order by added_at`
    expect(rows).toMatchObject([{ content_hash: hash, document_id: doc.id, url: null }, { content_hash: 'b'.repeat(64), document_id: null, url: null }])
  })

  it('los pasos de alta y de crédito ACH nacen configurados, en pausa y propuestos; administración los activa', async () => {
    const steps = await admin<{ id: string; is_active: boolean; pending_owner: string; needs_approval: boolean; backup_id: string | null; requires_evidence: boolean }[]>`
      select id, is_active, pending_owner, needs_approval, backup_id, requires_evidence from crm.stage_transitions where pending_owner is not null order by id`
    expect(steps.length).toBeGreaterThanOrEqual(2)
    expect(steps.every((s) => !s.is_active && s.needs_approval && s.backup_id && s.requires_evidence)).toBe(true)
    await expect(setTransitionActive(await ctxFor('ana.robles'), steps[0]!.id, true)).rejects.toMatchObject({ code: 'forbidden' })
    await setTransitionActive(await ctxFor('nora.salas'), steps[0]!.id, true)
    expect(await one(admin<{ is_active: boolean; pending_owner: string | null }[]>`select is_active, pending_owner from crm.stage_transitions where id = ${steps[0]!.id}`)).toEqual({ is_active: true, pending_owner: null })
    await admin`update crm.stage_transitions set is_active = false, pending_owner = 'Operaciones' where id = ${steps[0]!.id}`
  })
})

describe('LEAD-04: reloj de primer contacto', () => {
  it('se cierra con el contacto efectivo, no con el intento; queda en el reloj genérico', async () => {
    const lucia = await ctxFor('lucia.vega')
    const id = await createLead(lucia, { market: 'MX', motor: 'd2d', businessName: `Contacto efectivo ${tag()}`, contactName: 'Rita Luna', phone: mxPhone() })
    await admin`update crm.leads set owner_id = ${lucia.user.id}, sla_due_at = now() - interval '5 minutes' where id = ${id}`
    await completeItem(lucia, { type: 'lead', id, result: 'no_answer', next: 'call', when: tomorrow })
    await runRules()
    expect(await openEx('lead_id', id, 'lead_sla')).toHaveLength(1) // un intento sin respuesta no cierra el reloj
    let timer = await one(admin<{ attempt_at: Date | null; met_at: Date | null }[]>`select attempt_at, met_at from crm.sla_timers where record_id = ${id} and sla_type = 'first_contact'`)
    expect(timer.attempt_at).not.toBeNull()
    expect(timer.met_at).toBeNull()
    await completeItem(lucia, { type: 'lead', id, result: 'reached', next: 'none', when: '' })
    await runRules()
    expect(await openEx('lead_id', id, 'lead_sla')).toHaveLength(0)
    timer = await one(admin<{ attempt_at: Date | null; met_at: Date | null }[]>`select attempt_at, met_at from crm.sla_timers where record_id = ${id} and sla_type = 'first_contact'`)
    expect(timer.met_at).not.toBeNull()
  })

  it('el horario hábil salta los feriados del mercado y usa la zona del punto de venta si se conoce', async () => {
    const r = await one(admin<{ plain: Date; holiday: Date; tz: Date }[]>`
      with d as (select (date_trunc('week', now() at time zone 'America/Mexico_City') + interval '7 days')::date as monday)
      select app.business_due('MX', ((select monday from d) + time '09:00') at time zone 'America/Mexico_City', 60) as plain,
             (select app.business_due('MX', ((select monday from d) + time '09:00') at time zone 'America/Mexico_City', 60)) as holiday,
             app.business_due_tz('MX', ((select monday from d) + time '09:00') at time zone 'America/Mexico_City', 60, 'America/Tijuana') as tz`)
    expect(r.tz.getTime()).toBeGreaterThan(r.plain.getTime()) // Tijuana abre más tarde que Ciudad de México
    const monday = await one(admin<{ d: string }[]>`select (date_trunc('week', now() at time zone 'America/Mexico_City') + interval '7 days')::date::text as d`)
    await admin`insert into crm.market_holidays (market_code, day, name) values ('MX', ${monday.d}, 'Feriado de prueba') on conflict do nothing`
    const after = await one(admin<{ due: Date }[]>`select app.business_due('MX', (${monday.d}::date + time '09:00') at time zone 'America/Mexico_City', 60) as due`)
    expect(after.due.getTime() - r.plain.getTime()).toBeGreaterThanOrEqual(23 * 3600 * 1000)
    await admin`delete from crm.market_holidays where market_code = 'MX' and day = ${monday.d}`
  })
})

describe('LEAD-03: ruteo', () => {
  it('tienda saturada: con el tope lleno queda una sugerencia que supervisión confirma o descarta', async () => {
    const nora = await ctxFor('nora.salas')
    const marco = await ctxFor('marco.pena')
    const ruleId = await createAssignmentRule(nora, { market: 'MX', name: `Tope uno ${tag()}`, action: 'user', userId: marco.user.id, capOpen: 1, match: { sources: ['referral'] } })
    const leadId = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Saturada ${tag()}`, contactName: 'Rita Luna', phone: mxPhone() })
    const routed = await withUser(nora.user.id, async (tx) => {
      const r = await resolveOwner(tx, { market: 'MX', source: 'referral', motor: 'd2d' }, { dryRun: true })
      await logAssignment(tx, 'MX', leadId, r)
      return r
    })
    expect(routed.steps.some((s) => s.outcome === 'capped')).toBe(true)
    const sug = await one(admin<{ id: string; status: string }[]>`select id, status from crm.routing_suggestions where lead_id = ${leadId}`)
    expect(sug.status).toBe('open')
    await expect(decideRoutingSuggestion(marco, sug.id, { confirm: true })).rejects.toMatchObject({ code: 'not_found' }) // ventas ni la ve
    const fernando = await ctxFor('fernando.ibarra')
    await decideRoutingSuggestion(fernando, sug.id, { confirm: true, note: 'Va por distribuidor' })
    expect(await admin`select 1 from crm.activities where lead_id = ${leadId} and owner_id = ${fernando.user.id} and done_at is null`).toHaveLength(1)
    await admin`update crm.assignment_rules set is_active = false where id = ${ruleId}`
  })

  it('la condición de una regla se edita; un comercio que nace sin dueño por la Sales App o importación pasa por las reglas', async () => {
    const nora = await ctxFor('nora.salas')
    const lucia = await ctxFor('lucia.vega')
    const ruleId = await createAssignmentRule(nora, { market: 'MX', name: `Importados ${tag()}`, action: 'user', userId: lucia.user.id, match: { sources: ['web_form'] } })
    await editAssignmentRule(nora, ruleId, { name: 'Comercios importados', match: { sources: ['import', 'sales_app'] } })
    expect((await one(admin<{ match: { sources: string[] } }[]>`select match from crm.assignment_rules where id = ${ruleId}`)).match.sources).toEqual(['import', 'sales_app'])
    const acc = await createAccount(nora, { market: 'MX', kind: 'store', name: `Sin dueño ${tag()}`, segment: 'd2d', force: true })
    await admin`update crm.accounts set owner_id = null where id = ${acc.id!}`
    const r = await withUser(nora.user.id, (tx) => routeNewAccount(tx, acc.id!, 'import'))
    expect(r?.ownerId).toBe(lucia.user.id)
    expect((await one(admin<{ owner_id: string }[]>`select owner_id from crm.accounts where id = ${acc.id!}`)).owner_id).toBe(lucia.user.id)
    expect(await admin`select 1 from crm.assignment_log where account_id = ${acc.id!}`).toHaveLength(1)
    await admin`update crm.assignment_rules set is_active = false where id = ${ruleId}`
  })
})

describe('ACT-01: hilo de solo agregar', () => {
  it('lo hecho no se reescribe: se corrige con una entrada nueva y la original queda marcada', async () => {
    const lucia = await ctxFor('lucia.vega')
    const acc = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Hilo ${tag()}`, segment: 'd2d', force: true })
    const id = await addActivity(lucia, { kind: 'note', subject: 'Habló con la dueña', accountId: acc.id! })
    await admin`update crm.activities set done_at = coalesce(done_at, now()) where id = ${id}`
    expect(await asPersona('lucia.vega', (tx) => attempt(tx, (sp) => sp`update crm.activities set subject = 'otra cosa' where id = ${id}`))).toBe('42501')
    const fix = await correctActivity(lucia, id, { subject: 'Habló con el encargado', reason: 'Era el encargado, no la dueña' })
    expect(await one(admin<{ corrects_id: string }[]>`select corrects_id from crm.activities where id = ${fix}`)).toEqual({ corrects_id: id })
    expect((await one(admin<{ corrected_at: Date | null; subject: string }[]>`select corrected_at, subject from crm.activities where id = ${id}`)).subject).toBe('Habló con la dueña')
    const thread = await fullThread(lucia, acc.id!, { withChildren: false })
    expect(thread!.items.find((e) => e.id === id)).toMatchObject({ corrected: true })
    expect(thread!.items.find((e) => e.id === fix)).toMatchObject({ is_correction: true })
    await expect(correctActivity(lucia, id, { subject: 'Otra vez', reason: 'Segunda corrección' })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('visibilidad por actividad: una nota para quien dirige no la ve otra persona de ventas', async () => {
    const lucia = await ctxFor('lucia.vega')
    const acc = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Reservada ${tag()}`, segment: 'd2d', force: true })
    const id = await addActivity(lucia, { kind: 'note', subject: 'Nota para supervisión', accountId: acc.id!, visibility: 'managers' })
    await admin`update crm.accounts set owner_id = ${(await ctxFor('marco.pena')).user.id} where id = ${acc.id!}`
    expect(await asPersona('marco.pena', (tx) => tx`select 1 from crm.activities where id = ${id}`)).toHaveLength(0)
    expect(await asPersona('fernando.ibarra', (tx) => tx`select 1 from crm.activities where id = ${id}`)).toHaveLength(1)
    expect(await asPersona('lucia.vega', (tx) => tx`select 1 from crm.activities where id = ${id}`)).toHaveLength(1)
  })

  it('retención configurable (vacía no borra nada) y resumen semanal de ventas como una entrada por semana', async () => {
    const lucia = await ctxFor('lucia.vega')
    const acc = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Retención ${tag()}`, segment: 'd2d', force: true })
    const old = await addActivity(lucia, { kind: 'note', subject: 'Nota vieja', accountId: acc.id! })
    await admin`alter table crm.activities disable trigger activities_append_only`
    await admin`update crm.activities set done_at = now() - interval '30 months' where id = ${old}`
    await admin`alter table crm.activities enable trigger activities_append_only`
    expect(await withUser((await systemContext()).user.id, (tx) => applyActivityRetention(tx))).toBe(0)
    await admin`insert into crm.funnel_settings (market_code, key, value, proposed) values ('MX', 'activity_retention_months', '24', false)`
    expect(await withUser((await systemContext()).user.id, (tx) => applyActivityRetention(tx))).toBeGreaterThan(0)
    expect(await admin`select 1 from crm.activities where id = ${old}`).toHaveLength(0)
    await admin`delete from crm.funnel_settings where market_code = 'MX' and key = 'activity_retention_months'`

    await admin`insert into crm.store_sales_lines (account_id, as_of, market_code, line_kind, line_key, mtd) values (${acc.id!}, ${today}, 'MX', 'activations', 'telcel', 12)`
    const sys = await systemContext()
    expect(await withUser(sys.user.id, (tx) => weeklySalesSummary(tx, sys.user.id))).toBeGreaterThan(0)
    expect(await withUser(sys.user.id, (tx) => weeklySalesSummary(tx, sys.user.id))).toBe(0) // una por semana
    const e = await one(admin<{ subject: string; source: string }[]>`select subject, source from crm.activities where account_id = ${acc.id!} and source = 's5'`)
    expect(e.subject).toContain('Resumen semanal de ventas')
  })
})

describe('AUT-03: cada automatización con dueño', () => {
  it('ninguna queda sin dueño; las asignadas a administración se listan para revisar; no se guarda sin dueño', async () => {
    await runRules()
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.automations where owner_id is null`)).n).toBe(0)
    const a = await one(admin<{ id: string; owner_id: string; owner_review: boolean }[]>`select id, owner_id, owner_review from crm.automations where key = 'no_next_step' and market_code = 'MX'`)
    expect(a.owner_review).toBe(true)
    const nora = await ctxFor('nora.salas')
    const full = (await getAutomation(nora, a.id))!.a
    const input = { nameEs: full.name_es, nameEn: full.name_en, motor: full.motor ?? '', conditions: full.conditions, actions: full.actions }
    await expect(saveAutomation(nora, a.id, { ...input, ownerId: '' })).rejects.toThrow(/quién responde|who answers/)
    await saveAutomation(nora, a.id, { ...input, ownerId: nora.user.id })
    expect(await one(admin<{ owner_review: boolean }[]>`select owner_review from crm.automations where id = ${a.id}`)).toEqual({ owner_review: false })
    await admin`update crm.automations set owner_review = true where id = ${a.id}`
    await setAutomationOwner(nora, a.id, (await ctxFor('ana.robles')).user.id)
    expect(await one(admin<{ owner_review: boolean }[]>`select owner_review from crm.automations where id = ${a.id}`)).toEqual({ owner_review: false })
  })
})

describe('UX-03: colas oficiales por rol', () => {
  it('revisitas vencidas, altas sin fondeo y puntos de venta en riesgo, con contador para el rol', async () => {
    const rep = await officialQueues(await ctxFor('marco.pena'))
    expect(rep.map((q) => q.name)).toEqual(['Revisitas vencidas'])
    const all = await officialQueues(await ctxFor('nora.salas'))
    expect(all.map((q) => q.name).sort()).toEqual(['Altas sin fondeo', 'En riesgo', 'Revisitas vencidas'])
    const { id } = await dianaDeal()
    const before = rep[0]!.count ?? 0
    await admin`update crm.deals set revisit_needed = true, revisit_due = ${addDays(today, -2)} where id = ${id}`
    const diana = await officialQueues(await ctxFor('diana.cruz'))
    expect(diana[0]!.count).toBeGreaterThanOrEqual(1)
    void before
    const lucia = await ctxFor('lucia.vega')
    const acc = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Sin fondeo ${tag()}`, segment: 'd2d', force: true })
    await admin`update crm.accounts set lifecycle = 'onboarding' where id = ${acc.id!}`
    const list = await listAccounts(await ctxFor('nora.salas'), { fondeo: 'sin', q: 'Sin fondeo' })
    expect(list.items.some((x) => x.id === acc.id)).toBe(true)
    await admin`insert into crm.account_funding (account_id, market_code, method, balance_minor, as_of, source) values (${acc.id!}, 'MX', 'prepaid', 5000, ${today}, 'simulator')`
    const list2 = await listAccounts(await ctxFor('nora.salas'), { fondeo: 'sin', q: 'Sin fondeo' })
    expect(list2.items.some((x) => x.id === acc.id)).toBe(false)
  })
})
