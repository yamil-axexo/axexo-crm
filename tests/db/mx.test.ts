import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { intakeFromForm, qualifyLead, convertLead } from '@/domain/leads'
import { leadFacets, listLeads, getLead } from '@/dal/leads'
import { createAccount } from '@/domain/accounts'
import { createDeal, moveDeal } from '@/domain/deals'
import { ingestMetricsFile } from '@/domain/integrations'
import { grantAccess } from '@/domain/admin'
import { setTerritory } from '@/domain/reparto'
import { createTerritory } from '@/domain/territories'
import { setFormCampaign, setResponseTarget, setTerritoryManager, setWinRule } from '@/domain/mx-config'
import { loadMigratedStores, loadVisitsSheet, parseSheet, sheetDate, sheetOutcome } from '@/domain/sheet-loads'
import { openToTeam, ROLLOUT_STEPS, setKeyPerson, setLeadersFirst, setRolloutStep } from '@/domain/rollout'
import { exportDeadLeads, exportMarketReport } from '@/domain/mx-reports'
import { getMarketReport, getRollout, getSheetLoads, getTerritoryManagers, getWinRules } from '@/dal/mx'
import { addDays, isoDay } from '@/lib/format'

// Paquete mx (12-nov-2026): México como lo describe el documento de requerimientos, épicas E14 a E18.
// Cada requerimiento del encargo tiene una prueba que falla sin su cambio. Las pruebas crean sus propios registros.
const admin = owner()
const tag = () => Math.random().toString(36).slice(2, 8)
const mxPhone = () => `55 4${Math.floor(1000000 + Math.random() * 8999999)}`
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const today = isoDay(new Date(), 'America/Mexico_City')
const uid = (k: string) => personaId(k)

afterAll(async () => {
  await admin.end()
})

describe('E15 · leads de campaña de México', () => {
  it('E15.F1 y F2: cada formulario de campaña deja su embudo, su canal y el origen "Campaña web"', async () => {
    const sys = await systemContext()
    const f2 = await intakeFromForm(sys, 'contacto-mx', { business_name: `Cadena Campaña ${tag()}`, contact_name: 'Ana Web', phone: mxPhone(), company_type: 'chain' }, `mx-${tag()}`)
    const f1 = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Abarrotes Campaña ${tag()}`, contact_name: 'Luis Web', phone: mxPhone() }, `mx-${tag()}`)
    expect(await one(admin`select market_code, source, funnel, channel_id, motor from crm.leads where id = ${f2.leadId}`)).toEqual({ market_code: 'MX', source: 'web_campaign', funnel: 'F2', channel_id: 'mx-web-cadenas', motor: 'b2b' })
    expect(await one(admin`select market_code, source, funnel, channel_id, motor from crm.leads where id = ${f1.leadId}`)).toEqual({ market_code: 'MX', source: 'web_campaign', funnel: 'F1', channel_id: 'mx-web-tiendas', motor: 'd2d' })
    // un formulario que no es de campaña sigue dejando "Formulario web", sin embudo
    const us = await intakeFromForm(sys, 'dealers-us', { business_name: `Metro Wireless ${tag()}`, contact_name: 'Dana Fox', phone: `305 6${Math.floor(100000 + Math.random() * 899999)}` }, `mx-${tag()}`)
    expect(await one(admin`select source, funnel from crm.leads where id = ${us.leadId}`)).toEqual({ source: 'web_form', funnel: null })
    // la bitácora dice el origen con el que entró
    expect((await one(admin`select after from crm.audit_events where object_id = ${f2.leadId} and action = 'lead.created'`)).after).toMatchObject({ source: 'web_campaign' })
  })

  it('E15.F3: el formulario de cadenas y distribuidores ofrece Distribuidor y Cadena, y la respuesta queda en el lead', async () => {
    const offered = await asPersona('nora.salas', (tx) => tx<{ code: string; label_es: string }[]>`select code, label_es from app.form_offer_types('contacto-mx')`)
    expect(offered.map((o) => o.label_es)).toEqual(['Distribuidor', 'Cadena'])
    expect((await asPersona('nora.salas', (tx) => tx`select 1 from app.form_offer_types('tiendas-mx')`)).length).toBe(0)
    const sys = await systemContext()
    const d = await intakeFromForm(sys, 'contacto-mx', { business_name: `Mayoreo ${tag()}`, contact_name: 'Raúl Peña', phone: mxPhone(), company_type: 'distributor', x_b2b_points_of_sale: '24' }, `mx-${tag()}`)
    expect((await one(admin`select account_type from crm.leads where id = ${d.leadId}`)).account_type).toBe('distributor')
    // un tipo que el formulario no ofrece se ignora: el lead no se pierde y no nace con un tipo que nadie eligió
    const x = await intakeFromForm(sys, 'contacto-mx', { business_name: `Otro ${tag()}`, contact_name: 'Eva Ruiz', phone: mxPhone(), company_type: 'iso' }, `mx-${tag()}`)
    expect((await one(admin`select account_type from crm.leads where id = ${x.leadId}`)).account_type).toBeNull()
  })

  it('E15.F5: tipo de empresa y número de tiendas son campos: se filtran en Leads y se cuentan en el reporte', async () => {
    const sys = await systemContext()
    const name = `Distribuidora Filtro ${tag()}`
    const out = await intakeFromForm(sys, 'contacto-mx', { business_name: name, contact_name: 'Raúl Peña', phone: mxPhone(), company_type: 'distributor', x_b2b_points_of_sale: '37' }, `mx-${tag()}`)
    const ana = await ctxFor('ana.robles')
    const hit = await listLeads(ana, { tipo: 'distributor', tiendas_min: '37', tiendas_max: '37', embudo: 'F2' })
    expect(hit.items.map((l) => l.id)).toContain(out.leadId)
    expect(hit.items.every((l) => l.account_type === 'distributor' && Number(l.store_count) === 37 && l.funnel === 'F2')).toBe(true)
    expect((await listLeads(ana, { q: name, tiendas_max: '36' })).items.length).toBe(0)
    expect((await listLeads(ana, { q: name, tipo: 'chain' })).items.length).toBe(0)
    const facets = await leadFacets(ana)
    expect(facets.types.map((t) => t.code)).toEqual(expect.arrayContaining(['chain', 'distributor']))
    expect(facets.funnels).toEqual(['F1', 'F2'])
    const lead = await getLead(ana, out.leadId)
    expect(lead?.lead).toMatchObject({ funnel: 'F2', channel_id: 'mx-web-cadenas', store_count: '37' })
    const report = await getMarketReport(ana, 'MX', 3)
    const row = report.types.find((r) => r.funnel === 'F2' && r.account_type === 'distributor' && r.bucket === '21-50')
    expect(row && row.leads).toBeGreaterThan(0)
    expect(row?.type_es).toBe('Distribuidor')
  })

  it('E15.F6: los leads B2B alternan entre las dos personas del turno y cada una se entera', async () => {
    const sys = await systemContext()
    const leads: string[] = []
    for (let i = 0; i < 4; i++) leads.push((await intakeFromForm(sys, 'contacto-mx', { business_name: `Cadena Turno ${tag()}`, contact_name: 'Ana Web', phone: mxPhone(), company_type: 'chain' }, `mx-${tag()}`)).leadId)
    const owners = await Promise.all(leads.map(async (id) => (await one(admin<{ owner_id: string }[]>`select owner_id from crm.leads where id = ${id}`)).owner_id))
    expect(new Set(owners)).toEqual(new Set([await uid('diana.cruz'), await uid('ivan.rios')]))
    expect(owners[0]).not.toBe(owners[1])
    expect(owners[0]).toBe(owners[2])
    expect(owners[1]).toBe(owners[3])
    // cada asignación sale como evento con su dueño (de ahí toma el servicio de avisos) y el lead queda en la lista de esa persona
    for (const [i, id] of leads.entries()) {
      const ev = await one(admin<{ payload: { owner_id: string; by: string } }[]>`select payload from crm.outbox_events where aggregate_id = ${id} and event_type = 'lead.assigned'`)
      expect(ev.payload).toMatchObject({ owner_id: owners[i], by: 'routing' })
    }
    const diana = await ctxFor('diana.cruz')
    const mine = await listLeads(diana, { owner: 'me', status: 'new' })
    expect(mine.items.some((l) => leads.includes(l.id))).toBe(true)
  })

  it('E15.F9: cadenas y distribuidores, una hora hábil; tiendas, un día hábil; la meta se cambia en pantalla y sigue al horario', async () => {
    const sys = await systemContext()
    const b2b = await intakeFromForm(sys, 'contacto-mx', { business_name: `Cadena Meta ${tag()}`, contact_name: 'Ana Web', phone: mxPhone(), company_type: 'chain' }, `mx-${tag()}`)
    const d2d = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Abarrotes Meta ${tag()}`, contact_name: 'Luis Web', phone: mxPhone() }, `mx-${tag()}`)
    const due = async (id: string, minutes: number) => (await one(admin<{ ok: boolean }[]>`select abs(extract(epoch from (sla_due_at - app.business_due('MX', created_at, ${minutes})))) < 5 as ok from crm.leads where id = ${id}`)).ok
    expect(await due(b2b.leadId, 60)).toBe(true)
    expect(await due(d2d.leadId, 540)).toBe(true) // un día hábil de 9:00 a 18:00
    const rule = await one(admin<{ id: string; sla_minutes: number; sla_business_days: number }[]>`select r.id, r.sla_minutes, r.sla_business_days from crm.routing_rules r join crm.web_forms f on f.routing_rule_id = r.id where f.slug = 'tiendas-mx'`)
    expect(rule).toMatchObject({ sla_minutes: 540, sla_business_days: 1 })

    const nora = await ctxFor('nora.salas')
    await expect(setResponseTarget(await ctxFor('ana.robles'), rule.id, { amount: 2, unit: 'days' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setResponseTarget(nora, rule.id, { amount: 0, unit: 'days' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setResponseTarget(nora, rule.id, { amount: 3, unit: 'weeks' })).rejects.toMatchObject({ code: 'invalid' })
    await setResponseTarget(nora, rule.id, { amount: 2, unit: 'days' })
    expect(await one(admin`select sla_minutes, sla_business_days from crm.routing_rules where id = ${rule.id}`)).toEqual({ sla_minutes: 1080, sla_business_days: 2 })
    expect((await one(admin`select before, after from crm.audit_events where object_id = ${rule.id} and action = 'routing.target_set'`)).after).toEqual({ sla_minutes: 1080, sla_business_days: 2 })
    // si el horario del mercado cambia, el día hábil vale lo que dure el horario nuevo
    await admin`update crm.market_hours set closes = '17:00' where market_code = 'MX'`
    expect((await one(admin`select sla_minutes from crm.routing_rules where id = ${rule.id}`)).sla_minutes).toBe(960)
    await admin`update crm.market_hours set closes = '18:00' where market_code = 'MX'`
    await setResponseTarget(nora, rule.id, { amount: 3, unit: 'hours' })
    expect(await one(admin`select sla_minutes, sla_business_days from crm.routing_rules where id = ${rule.id}`)).toEqual({ sla_minutes: 180, sla_business_days: null })
    await setResponseTarget(nora, rule.id, { amount: 1, unit: 'days' })
  })

  it('E15.F1 a F3: administración cambia el embudo, el canal y los tipos de empresa de un formulario, y queda en la bitácora', async () => {
    const nora = await ctxFor('nora.salas')
    const form = await one(admin<{ id: string }[]>`select id from crm.web_forms where slug = 'dealers-us'`)
    await expect(setFormCampaign(await ctxFor('robert.hale'), form.id, { funnel: 'D1', channelId: 'us-web', isCampaign: true, offerTypes: [] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setFormCampaign(nora, form.id, { funnel: 'tiene espacios', channelId: 'us-web', isCampaign: true, offerTypes: [] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(setFormCampaign(nora, form.id, { funnel: 'D1', channelId: 'us-web', isCampaign: true, offerTypes: ['no_existe'] })).rejects.toMatchObject({ code: 'invalid' })
    await setFormCampaign(nora, form.id, { funnel: 'D1', channelId: 'us-web-dealers', isCampaign: true, offerTypes: ['store', 'chain'] })
    expect(await one(admin`select funnel, channel_id, is_campaign, offer_types from crm.web_forms where id = ${form.id}`)).toEqual({ funnel: 'D1', channel_id: 'us-web-dealers', is_campaign: true, offer_types: ['store', 'chain'] })
    expect((await admin`select 1 from crm.audit_events where object_id = ${form.id} and action = 'form.campaign_set'`).length).toBe(1)
    await setFormCampaign(nora, form.id, { funnel: '', channelId: '', isCampaign: false, offerTypes: [] })
  })
})

describe('E14 · embudos de México', () => {
  const stages = async (motor: string) => admin<{ code: string; name_es: string; name_en: string; kind: string; rot_days: number; required_fields: string[] }[]>`
    select s.code, s.name_es, s.name_en, s.kind, s.rot_days, s.required_fields from crm.stages s join crm.pipelines p on p.id = s.pipeline_id
     where p.market_code = 'MX' and p.motor = ${motor} and s.archived_at is null order by s.position`

  it('E14.F2: el embudo de tiendas va de Prospecto a En migración, con aviso de inactividad a los 30, 14, 7 y 7 días', async () => {
    const d2d = await stages('d2d')
    expect(d2d.map((s) => s.name_es)).toEqual(['Prospecto', 'Contactada', 'Comprometida', 'En migración', 'Activa', 'Perdida'])
    expect(d2d.map((s) => s.name_en).slice(0, 4)).toEqual(['Prospect', 'Contacted', 'Committed', 'Migrating'])
    expect(d2d.slice(0, 4).map((s) => s.rot_days)).toEqual([30, 14, 7, 7])
    expect(d2d.map((s) => s.kind)).toEqual(['open', 'open', 'open', 'awaiting_txn', 'won', 'lost'])
  })

  it('E14.F5: el embudo B2B/ISO pasa por propuesta, NDA, integración, contrato y certificación, y cada etapa pide lo suyo', async () => {
    const b2b = await stages('b2b')
    expect(b2b.map((s) => s.code)).toEqual(['calificacion', 'propuesta', 'nda', 'negociacion', 'integracion', 'pruebas', 'contrato', 'certificacion', 'alta', 'espera', 'ganada', 'perdida'])
    expect(b2b.find((s) => s.code === 'integracion')!.required_fields).toContain('field:b2b_nda_signed_on')
    expect(b2b.find((s) => s.code === 'certificacion')!.required_fields).toContain('field:b2b_contract_signed_on')
    // los dos campos de fecha existen para los negocios B2B de México
    expect((await admin`select key from crm.field_definitions where object = 'deal' and market_code = 'MX' and motor = 'b2b' and key in ('b2b_nda_signed_on', 'b2b_contract_signed_on') and data_type = 'date'`).length).toBe(2)
  })

  it('la plantilla se puede volver a aplicar sin duplicar etapas, y no pisa una etapa que administración ya editó', async () => {
    const before = await stages('b2b')
    await admin`update crm.stages s set name_es = 'Primer contacto', edited_at = now() from crm.pipelines p where p.id = s.pipeline_id and p.market_code = 'MX' and p.motor = 'd2d' and s.code = 'visitada'`
    await admin`select crm.apply_mx_stage_template()`
    expect((await stages('b2b')).map((s) => s.code)).toEqual(before.map((s) => s.code))
    expect((await stages('d2d'))[0]!.name_es).toBe('Primer contacto')
    await admin`update crm.stages s set name_es = 'Prospecto', edited_at = null from crm.pipelines p where p.id = s.pipeline_id and p.market_code = 'MX' and p.motor = 'd2d' and s.code = 'visitada'`
    // quien usa la app no puede llamar a la plantilla
    expect(await asPersona('nora.salas', (tx) => attempt(tx, (sp) => sp`select crm.apply_mx_stage_template()` as never))).toBe('42501')
  })

  it('E14.F8: una sola regla para ganar; con "contrato firmado o primera transacción" se gana a mano solo con el contrato, o solo con la primera venta', async () => {
    const nora = await ctxFor('nora.salas')
    const diana = await ctxFor('diana.cruz')
    const pipe = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'b2b'`)
    const won = await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${pipe.id} and kind = 'won'`)
    const rules = await getWinRules(nora)
    expect(rules.find((r) => r.id === pipe.id)).toMatchObject({ rule: 'transaction', has_contract_field: true })
    const fresh = async () => {
      const acc = await createAccount(diana, { market: 'MX', accountType: 'chain', name: `Cadena Regla ${tag()}`, segment: 'b2b', phone: mxPhone(), force: true })
      const dealId = await createDeal(diana, { accountId: acc.id!, pipelineId: pipe.id, title: `Regla ${tag()}`, amount: 1000, nextStep: 'Llamar', nextStepDue: addDays(today, 1) })
      return { accountId: acc.id!, dealId }
    }
    const a = await fresh()
    // con la regla de siempre nadie lo gana a mano
    await expect(moveDeal(diana, a.dealId, won.id)).rejects.toMatchObject({ code: 'won_by_transaction' })

    await expect(setWinRule(await ctxFor('ana.robles'), pipe.id, 'contract_or_transaction', true)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setWinRule(nora, pipe.id, 'cualquiera', true)).rejects.toMatchObject({ code: 'invalid' })
    await expect(setWinRule(nora, pipe.id, 'contract_or_transaction', false)).rejects.toMatchObject({ code: 'confirm_required' })
    await setWinRule(nora, pipe.id, 'contract_or_transaction', true)
    try {
      expect((await getWinRules(nora)).find((r) => r.id === pipe.id)!.rule).toBe('contract_or_transaction')
      expect((await one(admin`select after from crm.audit_events where object_id = ${pipe.id} and action = 'pipeline.win_rule_set' order by at desc limit 1`)).after).toMatchObject({ win_rule: 'contract_or_transaction' })
      // sin contrato firmado no se gana a mano: dice qué falta
      const gate = await moveDeal(diana, a.dealId, won.id).catch((e) => e)
      expect(gate).toMatchObject({ code: 'stage_gate' })
      expect(gate.es).toContain('Contrato firmado el')
      // con la fecha del contrato (y lo demás que piden las etapas), sí
      const contact = await one(admin<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('MX', 'Quien Decide') returning id`)
      await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${a.accountId}, ${contact.id}, 'MX', 'decision_maker')`
      await admin`update crm.deals set custom = custom || ${admin.json({ b2b_nda_signed_on: addDays(today, -20), b2b_contract_signed_on: addDays(today, -2) })}, decision_maker_id = ${contact.id}, decision_maker_met = true where id = ${a.dealId}`
      await moveDeal(diana, a.dealId, won.id, undefined, undefined, { wonOn: addDays(today, -2) })
      expect(await one(admin`select status, closed_by from crm.deals where id = ${a.dealId}`)).toEqual({ status: 'won', closed_by: 'manual' })
      // prepago y transaccionando: otro negocio del mismo embudo se gana solo con la primera transacción
      const b = await fresh()
      const ref = `MID-MX${tag()}`
      await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${b.accountId}, 'MX', 's5', ${ref})`
      const first = new Date(Date.now() - 86400000).toISOString()
      const out = await ingestMetricsFile(await systemContext(), { as_of: addDays(today, -1), file_name: `mx-${tag()}.json`, mode: 'delta', rows: [{ merchant_ref: ref, first_txn_at: first, last_txn_at: first, txn_count_30d: 2, volume_minor_30d: 50000, currency: 'MXN', active_days_30d: 1 }] })
      expect(out).toMatchObject({ status: 'loaded', dealsWon: 1 })
      expect(await one(admin`select status, closed_by from crm.deals where id = ${b.dealId}`)).toEqual({ status: 'won', closed_by: 'transaction' })
    } finally {
      await setWinRule(nora, pipe.id, 'transaction', true)
    }
    expect((await getWinRules(nora)).find((r) => r.id === pipe.id)!.rule).toBe('transaction')
  })

  it('E14.F3: una tienda migrada queda con un negocio ganado en su fecha real de migración, sin duplicar al volver a cargar', async () => {
    const ana = await ctxFor('ana.robles')
    const marco = await ctxFor('marco.pena')
    const mk = async (label: string) => {
      const acc = await createAccount(marco, { market: 'MX', name: `${label} ${tag()}`, segment: 'd2d', phone: mxPhone(), force: true })
      const ref = `MID-MG${tag()}`
      await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${acc.id!}, 'MX', 's5', ${ref})`
      return { id: acc.id!, ref }
    }
    const fresh = await mk('Abarrotes Migrada')
    const withOpen = await mk('Miscelánea En Curso')
    const pipe = await one(admin<{ id: string }[]>`select id from crm.pipelines where market_code = 'MX' and motor = 'd2d'`)
    const openDeal = await createDeal(marco, { accountId: withOpen.id, pipelineId: pipe.id, title: `Alta ${tag()}`, nextStep: 'Volver', nextStepDue: addDays(today, 1) })
    const sheet = `Comercio\tFecha de migración\n${fresh.ref}\t15/03/2025\n${withOpen.ref}\t2025-06-02\nMID-NO-EXISTE\t2025-06-02\n${fresh.ref}\tno es fecha\n${fresh.ref}\t${addDays(today, 3)}`
    await expect(loadMigratedStores(marco, 'MX', sheet)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(loadMigratedStores(await ctxFor('fernando.ibarra'), 'MX', sheet)).rejects.toMatchObject({ code: 'forbidden' })
    const out = await loadMigratedStores(ana, 'MX', sheet, 'Hoja de migración, marzo')
    expect(out).toMatchObject({ total: 5, loaded: 2, known: 0, failed: 3 })
    expect(out.problems.map((p) => p.row)).toEqual([4, 5, 6])
    const won = await one(admin<{ n: number; day: string; status: string; closed_by: string }[]>`
      select count(*) over ()::int as n, to_char(won_at at time zone 'America/Mexico_City', 'YYYY-MM-DD') as day, status, closed_by from crm.deals where account_id = ${fresh.id}`)
    expect(won).toEqual({ n: 1, day: '2025-03-15', status: 'won', closed_by: 'manual' })
    expect(await one(admin`select status, to_char(won_at at time zone 'America/Mexico_City', 'YYYY-MM-DD') as day from crm.deals where id = ${openDeal}`)).toEqual({ status: 'won', day: '2025-06-02' })
    expect((await admin`select 1 from crm.deal_stage_events where deal_id = ${openDeal} and cause = 'import'`).length).toBe(1)
    expect((await admin`select 1 from crm.audit_events where action = 'deal.won_on_migration' and object_id = ${openDeal}`).length).toBe(1)
    // el reporte por mes cuenta la historia en su mes real
    const report = await getMarketReport(ana, 'MX', 12)
    expect(report.monthly.length).toBe(12)
    // volver a pegar las mismas filas no crea otro negocio; una fecha corregida mueve la fecha del mismo negocio
    const again = await loadMigratedStores(ana, 'MX', `Comercio,Fecha\n${fresh.ref},2025-03-15\n${withOpen.ref},2025-06-09`)
    expect(again).toMatchObject({ total: 2, loaded: 1, known: 1, failed: 0 })
    expect((await admin`select 1 from crm.deals where account_id in (${fresh.id}, ${withOpen.id})`).length).toBe(2)
    expect((await one(admin`select to_char(won_at at time zone 'America/Mexico_City', 'YYYY-MM-DD') as day from crm.deals where id = ${openDeal}`)).day).toBe('2025-06-09')
    const loads = await getSheetLoads(ana, 'MX')
    expect(loads[0]).toMatchObject({ kind: 'migrated_stores', rows_total: 2, rows_loaded: 1, rows_known: 1 })
    expect(loads.find((l) => l.label === 'Hoja de migración, marzo')!.problems.length).toBe(3)
  })
})

describe('E16.F2 · la tienda D2D es del gerente de su territorio', () => {
  it('con gerente en el territorio, las tiendas sin dueño pasan a él y las nuevas nacen suyas; sin gerente no cambia nada', async () => {
    const nora = await ctxFor('nora.salas')
    const fernando = await ctxFor('fernando.ibarra')
    const lucia = await uid('lucia.vega')
    const terId = await createTerritory(nora, { market: 'MX', name: `Puebla ${tag()}` })
    // sin gerente: la tienda es de quien la crea, como siempre
    const before = await createAccount(fernando, { market: 'MX', name: `Abarrotes Sin Gerente ${tag()}`, segment: 'd2d', phone: mxPhone(), territoryId: terId, force: true })
    expect((await one(admin`select owner_id from crm.accounts where id = ${before.id!}`)).owner_id).toBe(fernando.user.id)
    // una tienda sin dueño en ese territorio (por ejemplo, de una carga)
    const loose = await one(admin<{ id: string }[]>`
      insert into crm.accounts (market_code, kind, name, segment, territory_id, country) values ('MX', 'store', ${'Miscelánea Suelta ' + tag()}, 'd2d', ${terId}, 'MX') returning id`)
    const deal = await one(admin<{ id: string }[]>`
      insert into crm.deals (market_code, pipeline_id, stage_id, account_id, title, currency)
      select 'MX', p.id, (select s.id from crm.stages s where s.pipeline_id = p.id order by position limit 1), ${loose.id}, 'Alta suelta', 'MXN' from crm.pipelines p where p.market_code = 'MX' and p.motor = 'd2d' returning id`)

    await expect(setTerritoryManager(await ctxFor('ana.robles'), terId, lucia)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setTerritoryManager(nora, terId, await uid('sam.ortiz'))).rejects.toMatchObject({ code: 'invalid' })
    const out = await setTerritoryManager(nora, terId, lucia)
    expect(out.moved).toBe(1)
    expect((await one(admin`select owner_id from crm.accounts where id = ${loose.id}`)).owner_id).toBe(lucia)
    expect((await one(admin`select owner_id from crm.deals where id = ${deal.id}`)).owner_id).toBe(lucia)
    expect((await one(admin`select party_ref from crm.account_attributions where account_id = ${loose.id} and layer = 'owner' and effective_to is null`)).party_ref).toBe(lucia)
    expect((await one(admin`select after from crm.audit_events where object_id = ${loose.id} and action = 'account.owner_by_territory'`)).after).toMatchObject({ owner_id: lucia, territory_id: terId })
    // la que ya llevaba otra persona no se mueve sola
    expect((await one(admin`select owner_id from crm.accounts where id = ${before.id!}`)).owner_id).toBe(fernando.user.id)
    expect((await one(admin`select after from crm.audit_events where object_id = ${terId} and action = 'territory.manager_set'`)).after).toMatchObject({ manager_id: lucia, stores_moved: 1 })

    // una tienda nueva en ese territorio nace con la gerente como dueña, la cree quien la cree
    const born = await createAccount(fernando, { market: 'MX', name: `Abarrotes Con Gerente ${tag()}`, segment: 'd2d', phone: mxPhone(), territoryId: terId, force: true })
    expect((await one(admin`select owner_id from crm.accounts where id = ${born.id!}`)).owner_id).toBe(lucia)
    expect((await admin`select 1 from crm.account_attributions where account_id = ${born.id!} and layer = 'owner' and effective_to is null and party_ref = ${lucia}`).length).toBe(1)
    // una cadena (B2B) en el mismo territorio no cambia de dueño: la regla es de las tiendas de venta puerta a puerta
    const chain = await createAccount(await ctxFor('paula.mendez'), { market: 'MX', accountType: 'chain', name: `Cadena En Puebla ${tag()}`, segment: 'b2b', phone: mxPhone(), territoryId: terId, force: true })
    expect((await one(admin`select owner_id from crm.accounts where id = ${chain.id!}`)).owner_id).toBe(await uid('paula.mendez'))
    // al cambiar de territorio, la tienda pasa al gerente del territorio nuevo
    await setTerritory(fernando, [before.id!], null)
    await setTerritory(fernando, [before.id!], terId)
    expect((await one(admin`select owner_id from crm.accounts where id = ${before.id!}`)).owner_id).toBe(lucia)
    // un lead de tienda convertido en ese territorio también
    const sys = await systemContext()
    const lead = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Abarrotes Lead ${tag()}`, contact_name: 'Luis Web', phone: mxPhone() }, `mx-${tag()}`)
    const leadOwner = (await one(admin<{ owner_id: string }[]>`select owner_id from crm.leads where id = ${lead.leadId}`)).owner_id
    const rep = await ctxFor(leadOwner === lucia ? 'lucia.vega' : 'marco.pena')
    await qualifyLead(rep, lead.leadId)
    const conv = await convertLead(rep, lead.leadId, { territoryId: terId })
    expect((await one(admin`select owner_id from crm.accounts where id = ${conv.accountId}`)).owner_id).toBe(lucia)
    expect((await one(admin`select owner_id from crm.deals where id = ${conv.dealId}`)).owner_id).toBe(lucia)

    const list = await getTerritoryManagers(nora)
    expect(list.find((t) => t.id === terId)).toMatchObject({ manager_id: lucia, manager_active: true, unowned: 0 })
    await setTerritoryManager(nora, terId, null)
  })
})

describe('E17.F4 · visitas mientras las hojas se retiran', () => {
  it('supervisión pega las filas de la hoja y cada una queda como visita fechada en el comercio; volver a pegar no duplica', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const marco = await ctxFor('marco.pena')
    const acc = await createAccount(marco, { market: 'MX', name: `Abarrotes Hoja ${tag()}`, segment: 'd2d', phone: mxPhone(), force: true })
    const ref = `MID-VS${tag()}`
    await admin`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${acc.id!}, 'MX', 's5', ${ref})`
    const phone = (await one(admin<{ phone: string }[]>`select phone from crm.accounts where id = ${acc.id!}`)).phone
    const d1 = addDays(today, -40) // más atrás que el límite del registro a mano (31 días)
    const d2 = addDays(today, -3)
    const [y, m, d] = d2.split('-')
    const sheet = [
      'Comercio;Fecha;Quién visitó;Estado;Acción;Comentarios',
      `${ref};${d1};Juan Pérez López;Venta;Alta en la app;"Quedó activo; pidió material"`,
      `${phone};${d}/${m}/${y};Juan Pérez López;Cerrado temporalmente;;Volver el lunes`,
      `${ref};${d1};Juan Pérez López;Venta;;repetida`,
      `MID-NADIE;${d1};Juan Pérez López;Venta;;`,
      `${ref};${addDays(today, 2)};Juan Pérez López;Venta;;`,
      `;${d1};Juan Pérez López;Venta;;`,
    ].join('\n')
    await expect(loadVisitsSheet(marco, 'MX', sheet)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(loadVisitsSheet(fernando, 'MX', 'Tienda\n' + ref)).rejects.toMatchObject({ code: 'invalid' })
    const out = await loadVisitsSheet(fernando, 'MX', sheet, 'Hoja de visitas')
    expect(out).toMatchObject({ total: 6, loaded: 2, known: 1, failed: 3 })
    expect(out.problems.map((p) => p.row)).toEqual([5, 6, 7])
    const visits = await admin<{ day: string; outcome: string; visited_by: string; body: string | null; source: string; owner_id: string }[]>`
      select to_char(done_at at time zone 'America/Mexico_City', 'YYYY-MM-DD') as day, outcome, visited_by, body, source, owner_id
        from crm.activities where account_id = ${acc.id!} and kind = 'visit' order by done_at`
    expect(visits.map((v) => [v.day, v.outcome, v.visited_by, v.source])).toEqual([[d1, 'sale', 'Juan Pérez López', 'import'], [d2, 'no_sale', 'Juan Pérez López', 'import']])
    expect(visits[0]!.body).toContain('Quedó activo; pidió material')
    expect(visits[1]!.body).toContain('Cerrado temporalmente') // un estado que no es de la lista no se pierde
    expect(visits[0]!.owner_id).toBe(marco.user.id)
    // cuenta en la lista única de visitas, con quién visitó
    expect((await admin`select 1 from crm.visit_log where account_id = ${acc.id!} and origin <> 'sales_app'`).length).toBe(2)
    const again = await loadVisitsSheet(fernando, 'MX', sheet)
    expect(again).toMatchObject({ loaded: 0, known: 3, failed: 3 })
    expect((await admin`select 1 from crm.activities where account_id = ${acc.id!} and kind = 'visit'`).length).toBe(2)
    expect((await one(admin`select after from crm.audit_events where action = 'sheet.visits_loaded' and object_id = ${out.loadId}`)).after).toMatchObject({ rows: 6, loaded: 2, known: 1, failed: 3 })
    // quien vende no ve las cargas; supervisión de otro mercado, tampoco
    expect((await asPersona('marco.pena', (tx) => tx`select 1 from crm.sheet_loads`)).length).toBe(0)
    expect((await asPersona('kira.dunn', (tx) => tx`select 1 from crm.sheet_loads`)).length).toBe(0)
    expect((await getSheetLoads(fernando, 'MX')).length).toBeGreaterThan(0)
  })

  it('la hoja se lee pegada o como CSV, con fechas día primero y estados en palabras', () => {
    expect(parseSheet('a\tb\n1\t"x\ty"\n\n')).toEqual([['a', 'b'], ['1', 'x\ty']])
    expect(parseSheet('a,b\r\n"1,5","dijo ""hola"""')).toEqual([['a', 'b'], ['1,5', 'dijo "hola"']])
    expect(sheetDate('9/3/26')).toBe('2026-03-09')
    expect(sheetDate('2026-02-30')).toBeNull()
    expect(sheetDate('marzo')).toBeNull()
    expect(sheetOutcome('Sin venta')).toEqual({ outcome: 'no_sale', known: true })
    expect(sheetOutcome('VOLVER')).toEqual({ outcome: 'revisit', known: true })
    expect(sheetOutcome('otra cosa')).toEqual({ outcome: 'no_sale', known: false })
  })
})

describe('E18 · arranque, acceso y reportes de México', () => {
  it('E18.F2: con "primero quienes lideran", Ventas entra solo si es persona clave; al abrir al equipo entra el resto', async () => {
    const nora = await ctxFor('nora.salas')
    const ana = await ctxFor('ana.robles')
    const domains = ['axexo.com']
    const mail = (k: string) => `${k}.${tag()}@contigo.test`
    await expect(setLeadersFirst(await ctxFor('fernando.ibarra'), 'MX', true)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setLeadersFirst(await ctxFor('robert.hale'), 'MX', true)).rejects.toMatchObject({ code: 'forbidden' })
    await setLeadersFirst(ana, 'MX', true)
    try {
      // quien lidera entra siempre
      await grantAccess(nora, { email: mail('supervision'), fullName: 'Supervisión Nueva', role: 'supervisor', market: 'MX' }, domains)
      // Ventas todavía no
      const rep = mail('ventas')
      await expect(grantAccess(nora, { email: rep, fullName: 'Ventas Nueva', role: 'rep', market: 'MX' }, domains)).rejects.toMatchObject({ code: 'leaders_first' })
      expect((await admin`select 1 from crm.memberships m join crm.users u on u.id = m.user_id where u.email = ${rep}`).length).toBe(0)
      // otro mercado no cambia
      await grantAccess(nora, { email: mail('us'), fullName: 'US Rep', role: 'rep', market: 'US' }, domains)
      // la base repite el límite aunque alguien se salte la pantalla
      const someone = await one(admin<{ id: string }[]>`insert into crm.users (email, full_name) values (${mail('directo')}, 'Directo') returning id`)
      expect(await asPersona('nora.salas', (tx) => attempt(tx, (sp) => sp`insert into crm.memberships (user_id, market_code, role) values (${someone.id}, 'MX', 'rep')`))).toBe('23514')
      // una persona clave sí entra
      await setKeyPerson(ana, 'MX', rep, true)
      await grantAccess(nora, { email: rep, fullName: 'Ventas Nueva', role: 'rep', market: 'MX' }, domains)
      // un paso del equipo no se marca antes que los de quienes lideran, y el mercado no se abre antes
      await expect(setRolloutStep(ana, 'MX', 'sessions', { done: true })).rejects.toMatchObject({ code: 'leaders_first' })
      await expect(openToTeam(ana, 'MX')).rejects.toMatchObject({ code: 'leaders_first' })
      for (const s of ROLLOUT_STEPS.filter((x) => x.phase === 'leaders')) await setRolloutStep(ana, 'MX', s.code, { done: true, ...(s.hasLink ? { link: 'https://ejemplo.test/material' } : {}) })
      await expect(setRolloutStep(ana, 'MX', 'deck', { done: true, link: 'http://sin-candado.test' })).rejects.toMatchObject({ code: 'invalid' })
      await expect(setRolloutStep(ana, 'MX', 'configure', { done: true, link: 'https://ejemplo.test/x' })).rejects.toMatchObject({ code: 'invalid' })
      await openToTeam(ana, 'MX')
      await grantAccess(nora, { email: mail('campo'), fullName: 'Campo Nuevo', role: 'rep', market: 'MX' }, domains)
      const r = await getRollout(ana, 'MX')
      expect(r.leadersFirst).toBe(true)
      expect(r.teamOpenedAt).not.toBeNull()
      expect(r.steps.find((s) => s.code === 'team_access')!.done_at).not.toBeNull()
      expect(r.steps.find((s) => s.code === 'deck')).toMatchObject({ link: 'https://ejemplo.test/material', done_by: 'Ana Robles' })
      expect(r.keyPeople).toEqual([rep])
      expect(r.people.find((p) => p.full_name === 'Ventas Nueva')).toMatchObject({ role: 'rep', is_key: true })
      // la bitácora no guarda el correo de la persona clave
      const ev = await one(admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'rollout.key_person_added' order by at desc limit 1`)
      expect(JSON.stringify(ev.after)).not.toContain('@')
      // supervisión ve el arranque y no lo cambia; quien vende no lo ve por permiso
      const fer = await ctxFor('fernando.ibarra')
      expect((await getRollout(fer, 'MX')).steps.length).toBe(ROLLOUT_STEPS.length)
      expect(fer.can('rollout.manage', 'MX')).toBe(false)
      expect((await ctxFor('marco.pena')).can('rollout.read', 'MX')).toBe(false)
      await expect(getRollout(await ctxFor('marco.pena'), 'MX')).rejects.toMatchObject({ code: 'forbidden' })
    } finally {
      await setLeadersFirst(ana, 'MX', false)
    }
    await grantAccess(nora, { email: mail('despues'), fullName: 'Después', role: 'rep', market: 'MX' }, domains)
  })

  it('E18.F10: el reporte de México trae leads capturados y convertidos, negocios por etapa y conteos por mes', async () => {
    const ana = await ctxFor('ana.robles')
    const sys = await systemContext()
    const before = await getMarketReport(ana, 'MX', 6)
    expect(before.monthly.length).toBe(6)
    expect(before.monthly.map((m) => m.month)).toEqual([...before.monthly.map((m) => m.month)].sort())
    const lead = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Abarrotes Reporte ${tag()}`, contact_name: 'Luis Web', phone: mxPhone() }, `mx-${tag()}`)
    const owner = (await one(admin<{ owner_id: string }[]>`select owner_id from crm.leads where id = ${lead.leadId}`)).owner_id
    const rep = await ctxFor(owner === (await uid('lucia.vega')) ? 'lucia.vega' : 'marco.pena')
    await qualifyLead(rep, lead.leadId)
    await convertLead(rep, lead.leadId, { territoryId: (await one(admin<{ id: string }[]>`select id from crm.territories where market_code = 'MX' and code = 'GDL'`)).id })
    const after = await getMarketReport(ana, 'MX', 6)
    const last = (r: typeof after) => r.monthly[r.monthly.length - 1]!
    expect(last(after).leads).toBe(last(before).leads + 1)
    expect(last(after).converted).toBe(last(before).converted + 1)
    expect(last(after).deals_created).toBe(last(before).deals_created + 1)
    // negocios abiertos por etapa: cada etapa abierta de los dos embudos, en orden, con lo que hay hoy
    expect(after.stages.filter((s) => s.motor === 'd2d').map((s) => s.stage_es)).toEqual(['Prospecto', 'Contactada', 'Comprometida', 'En migración'])
    const open = (await one(admin<{ n: number }[]>`select count(*)::int as n from crm.deals where market_code = 'MX' and status = 'open'`)).n
    expect(after.stages.reduce((n, s) => n + s.deals, 0)).toBe(open)
    expect(after.sources.find((s) => s.source === 'web_campaign' && s.funnel === 'F1')!.leads).toBeGreaterThan(0)
    // solo México: quien lidera US no puede pedirlo, y supervisión ve lo de su equipo
    await expect(getMarketReport(await ctxFor('robert.hale'), 'MX', 6)).rejects.toMatchObject({ code: 'forbidden' })
    const fer = await getMarketReport(await ctxFor('fernando.ibarra'), 'MX', 6)
    expect(fer.stages.filter((s) => s.motor === 'b2b').reduce((n, s) => n + s.deals, 0)).toBe(0)
    // la descarga deja evento con filas y no la hace quien vende
    const csv = await exportMarketReport(ana, 'MX', 6, 'mensual', 'Revisión mensual del mercado')
    expect(csv.rows).toBe(6)
    expect(csv.csv).toContain('Leads capturados')
    expect((await one(admin`select after from crm.audit_events where action = 'report.exported' order by at desc limit 1`)).after).toMatchObject({ report: 'market_mensual', rows: 6, reason: 'Revisión mensual del mercado' })
    // como toda exportación: sin motivo no hay archivo, y queda en la bitácora de exportaciones con su tope
    await expect(exportMarketReport(ana, 'MX', 6, 'mensual', '')).rejects.toMatchObject({ code: 'invalid' })
    expect(await one(admin`select what, rows, row_cap, reason from crm.export_log where user_id = ${ana.user.id} order by created_at desc limit 1`)).toMatchObject({ what: 'market_mensual', rows: 6, row_cap: 5000, reason: 'Revisión mensual del mercado' })
    await expect(exportMarketReport(rep, 'MX', 6, 'mensual', 'Revisión mensual del mercado')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(getMarketReport(rep, 'MX', 6)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('E18.F9: los leads descartados viven aparte como base de correo, solo con quien dio su consentimiento', async () => {
    const ana = await ctxFor('ana.robles')
    const sys = await systemContext()
    const yes = `si.${tag()}@ejemplo.test`
    const no = `no.${tag()}@ejemplo.test`
    const a = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Abarrotes Con Permiso ${tag()}`, contact_name: 'Luis Web', phone: mxPhone(), email: yes, consent: true }, `mx-${tag()}`)
    const b = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Abarrotes Sin Permiso ${tag()}`, contact_name: 'Eva Web', phone: mxPhone(), email: no }, `mx-${tag()}`)
    await admin`update crm.leads set status = 'disqualified', disqualify_code = 'not_qualified' where id in (${a.leadId}, ${b.leadId})`
    const report = await getMarketReport(ana, 'MX', 3)
    expect(report.dead.total).toBeGreaterThanOrEqual(2)
    expect(report.dead.with_consent).toBeLessThan(report.dead.with_email)
    await expect(exportDeadLeads(ana, 'MX', 'corto')).rejects.toMatchObject({ code: 'invalid' })
    const out = await exportDeadLeads(ana, 'MX', 'Campaña de correo de reactivación')
    expect(out.csv).toContain(yes)
    expect(out.csv).not.toContain(no)
    expect(out.csv).toContain('No califica') // conserva el motivo
    expect(out.rows).toBe(report.dead.with_consent)
    expect((await one(admin`select after from crm.audit_events where action = 'report.exported' order by at desc limit 1`)).after).toMatchObject({ report: 'dead_leads_mailing', rows: out.rows, reason: 'Campaña de correo de reactivación' })
    expect(await one(admin`select what, rows from crm.export_log where user_id = ${ana.user.id} order by created_at desc limit 1`)).toMatchObject({ what: 'market_dead_leads_mailing', rows: out.rows })
    // lleva correos: no la descarga supervisión, ni leadership, ni quien vende
    for (const k of ['fernando.ibarra', 'luis.tovar', 'marco.pena']) await expect(exportDeadLeads(await ctxFor(k), 'MX', 'Campaña de correo de reactivación')).rejects.toMatchObject({ code: 'forbidden' })
    // un lead descartado no está en ningún embudo
    expect((await admin`select 1 from crm.deals where lead_id in (${a.leadId}, ${b.leadId})`).length).toBe(0)
  })
})
