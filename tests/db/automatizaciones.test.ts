import { afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { attempt, ctxFor, owner, systemContext } from './helpers'
import { withUser } from '@/server/db'
import { createAccount } from '@/domain/accounts'
import { createDeal, moveDeal, updateDeal } from '@/domain/deals'
import { createLead, passLead } from '@/domain/leads'
import { pauseDeal } from '@/domain/b2b'
import { ingestSalesAppEvent } from '@/domain/integrations'
import { evaluateRules } from '@/domain/rules'
import { accountRule, dealRule, leadRule, skipReason } from '@/domain/intake'
import { DEFAULTS, describe as say, problemIn } from '@/domain/automation/catalog'
import { createFromTemplate, runJobNow, saveAutomation, setAutomationActive, testAutomation } from '@/domain/automation/admin'
import { addEvidence, escalateApprovals, saveTransition, setStageTimes, setWaitingOn } from '@/domain/automation/transitions'
import { decide } from '@/domain/automation/approvals'
import { escalateLeads, saveLeadEscalation } from '@/domain/automation/lead-escalation'
import { cronAuthorized, findJob, runDue, runJob, tickJobs } from '@/server/jobs/runner'
import { JOBS } from '@/server/jobs/registry'
import type { Job } from '@/server/jobs/types'
import { dealSteps, getAutomation, jobsPanel, listAutomations } from '@/dal/automations'
import { getLeadWatch } from '@/dal/boards'
import { getQueue } from '@/dal/queue'
import { myNotices } from '@/dal/ops'
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
const CARD = '4111 1111 1111 1111'
const job = (key: string) => findJob(key)!
const runRules = () => runJob(job('automatizaciones.reglas'), 'manual', { force: true })
const autoId = async (market: string, key: string) => (await one(admin<{ id: string }[]>`select id from crm.automations where market_code = ${market} and key = ${key}`)).id

/** Un negocio nuevo de Diana (ventas MX, B2B) en la primera etapa, con su comercio. */
async function dianaDeal(amount: number | null = null) {
  const diana = await ctxFor('diana.cruz')
  const acc = await createAccount(diana, { market: 'MX', kind: 'chain', name: `Cadena prueba ${tag()}`, segment: 'b2b', force: true })
  const id = await createDeal(diana, { accountId: acc.id!, pipelineId: await uid('p-mx-b2b'), title: `Negocio ${tag()}`, amount, nextStep: 'Llamar', nextStepDue: tomorrow })
  return { diana, accountId: acc.id!, id }
}

describe('corredor de tareas programadas', () => {
  const fake = (key: string, run: Job['run']): Job => ({ key, everyMinutes: 30, description: { es: 'Prueba', en: 'Test' }, run })

  it('deja cada corrida anotada, no repite antes de tiempo y "correr ahora" no espera', async () => {
    const key = `prueba.${tag()}`
    let calls = 0
    const j = fake(key, async () => ({ done: ++calls, note: 'ok' }))
    expect(await runJob(j, 'visit')).toMatchObject({ status: 'ok', done: 1 })
    expect(await runJob(j, 'visit')).toMatchObject({ status: 'not_due' })
    expect(await runJob(j, 'manual', { force: true })).toMatchObject({ status: 'ok', done: 2 })
    const runs = await admin<{ trigger: string; status: string; done: number; duration_ms: number }[]>`select trigger, status, done, duration_ms from crm.job_runs where job_key = ${key} order by started_at`
    expect(runs.map((r) => [r.trigger, r.status, r.done])).toEqual([['visit', 'ok', 1], ['manual', 'ok', 2]])
    expect(runs.every((r) => r.duration_ms >= 0)).toBe(true)
  })

  it('una tarea que falla no deja nada a medias y queda anotada con el código del error, sin datos', async () => {
    const key = `prueba.${tag()}`
    const j = fake(key, async (tx) => {
      await tx`insert into crm.settings (key, value) values (${'tmp_' + key}, '1'::jsonb)`
      throw new Error('Fulano de Tal, 55 1234 5678')
    })
    expect(await runJob(j, 'cron')).toMatchObject({ status: 'failed', error: 'Error' })
    expect(await admin`select 1 from crm.settings where key = ${'tmp_' + key}`).toHaveLength(0)
    const r = await one(admin<{ status: string; error: string }[]>`select status, error from crm.job_runs where job_key = ${key}`)
    expect(r).toEqual({ status: 'failed', error: 'Error' })
  })

  it('dos corridas de la misma tarea no se pisan: la segunda encuentra el candado y no corre', async () => {
    const key = `prueba.${tag()}`
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let entered!: () => void
    const inside = new Promise<void>((r) => (entered = r))
    const slow = fake(key, async () => {
      entered()
      await gate
      return { done: 1 }
    })
    const first = runJob(slow, 'manual', { force: true })
    await inside
    expect(await runJob(slow, 'manual', { force: true })).toMatchObject({ status: 'busy' })
    release()
    expect(await first).toMatchObject({ status: 'ok' })
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.job_runs where job_key = ${key}`)).n).toBe(1)
  })

  it('el registro trae las tareas del paquete, y el disparo externo está apagado sin secreto', async () => {
    expect(JOBS.map((j) => j.key)).toEqual(expect.arrayContaining(['automatizaciones.reglas', 'automatizaciones.eventos', 'automatizaciones.escalamiento']))
    expect(cronAuthorized('Bearer cualquier-cosa')).toBe('off')
    const { POST } = await import('@/app/api/cron/run/route')
    const res = await POST(new Request('http://localhost/api/cron/run', { method: 'POST', headers: { authorization: 'Bearer x' } }) as never)
    expect(res.status).toBe(503)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.job_runs where trigger = 'cron' and job_key like 'automatizaciones.%'`)).n).toBe(0)
  })

  it('con secreto, el disparo externo pide el secreto exacto y corre lo que toca', async () => {
    vi.resetModules()
    process.env.CRON_SECRET = 'secreto-de-prueba-0123456789'
    try {
      const fresh = await import('@/server/jobs/runner')
      expect(fresh.cronAuthorized(null)).toBe('no')
      expect(fresh.cronAuthorized('Bearer otro-secreto-0123456789xxxx')).toBe('no')
      expect(fresh.cronAuthorized('Bearer secreto-de-prueba-0123456789')).toBe('yes')
      const route = await import('@/app/api/cron/run/route')
      const bad = await route.POST(new Request('http://localhost/api/cron/run', { method: 'POST' }) as never)
      expect(bad.status).toBe(401)
      const ok = await route.POST(new Request('http://localhost/api/cron/run', { method: 'POST', headers: { authorization: 'Bearer secreto-de-prueba-0123456789' } }) as never)
      expect(ok.status).toBe(200)
      const body = (await ok.json()) as { ran: { key: string; status: string }[] }
      expect(body.ran.map((r) => r.key)).toContain('automatizaciones.reglas')
      expect(JSON.stringify(body)).not.toMatch(/@|\+52|\+1/)
    } finally {
      delete process.env.CRON_SECRET
      vi.resetModules()
    }
  })

  it('el disparo oportunista corre a lo sumo una vez por minuto y "correr ahora" es de administración', async () => {
    await admin`update crm.settings set value = to_jsonb(now() - interval '5 minutes') where key = 'jobs_last_tick'`
    ;(globalThis as { __contigoJobsTick?: number }).__contigoJobsTick = 0
    const a = await tickJobs()
    expect(a.length).toBe(JOBS.length)
    ;(globalThis as { __contigoJobsTick?: number }).__contigoJobsTick = 0
    expect(await tickJobs()).toEqual([]) // la base dice que ya corrió en este minuto
    await expect(runJobNow(await ctxFor('ana.robles'), 'automatizaciones.reglas')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(runJobNow(await ctxFor('luis.tovar'), 'automatizaciones.reglas')).rejects.toMatchObject({ code: 'forbidden' })
    const nora = await ctxFor('nora.salas')
    expect(await runJobNow(nora, 'automatizaciones.reglas')).toMatchObject({ status: 'ok' })
    const ev = await one(admin<{ after: { job: string } }[]>`select after from crm.audit_events where action = 'job.run_manual' and actor_id = ${nora.user.id} order by at desc limit 1`)
    expect(ev.after.job).toBe('automatizaciones.reglas')
    const panel = await jobsPanel(nora)
    expect(panel.jobs.find((j) => j.key === 'automatizaciones.reglas')?.last?.status).toBe('ok')
    expect(await runDue('visit')).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'automatizaciones.reglas', status: 'not_due' })]))
  })
})

describe('AUT-03: las reglas son datos, por mercado, con bitácora propia', () => {
  it('cada mercado nace con las reglas de base y los avisos quedan ligados a su automatización', async () => {
    const sys = await systemContext()
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    const per = await admin<{ market_code: string; n: number }[]>`select market_code, count(*)::int as n from crm.automations group by 1 order by 1`
    expect(per).toEqual([{ market_code: 'MX', n: DEFAULTS.length }, { market_code: 'SV', n: DEFAULTS.length }, { market_code: 'US', n: DEFAULTS.length }])
    const loose = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.exceptions e where e.resolved_at is null and e.kind <> 'unmatched_event'
      and (e.automation_id is null or not exists (select 1 from crm.automations a where a.id = e.automation_id and a.market_code = e.market_code))`)
    expect(loose.n).toBe(0) // todo aviso abierto es de una automatización de SU mercado
    const logged = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.automation_log where outcome = 'done' and detail ->> 'action' = 'open_exception'`)
    const open = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.exceptions where resolved_at is null and kind <> 'unmatched_event'`)
    expect(logged.n).toBe(open.n)
    for (const d of DEFAULTS) expect(problemIn(d), d.key).toBeNull()
  })

  it('pausar una regla cierra sus avisos (con bitácora) y activarla los vuelve a abrir; solo administración la cambia', async () => {
    const nora = await ctxFor('nora.salas')
    const id = await autoId('MX', 'stalled_deal')
    const before = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.exceptions where resolved_at is null and kind = 'stalled_deal' and market_code = 'MX'`)
    expect(before.n).toBeGreaterThan(0)
    await expect(setAutomationActive(await ctxFor('ana.robles'), id, false)).rejects.toMatchObject({ code: 'forbidden' })
    await setAutomationActive(nora, id, false)
    await runRules()
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.exceptions where resolved_at is null and kind = 'stalled_deal' and market_code = 'MX'`)).n).toBe(0)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.automation_log where automation_id = ${id} and outcome = 'closed'`)).n).toBe(before.n)
    await setAutomationActive(nora, id, true)
    await runRules()
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.exceptions where resolved_at is null and kind = 'stalled_deal' and market_code = 'MX'`)).n).toBe(before.n)
    const acts = await admin<{ action: string }[]>`select action from crm.audit_events where object = 'automation' and object_id = ${id} order by at`
    expect(acts.map((a) => a.action)).toEqual(['automation.paused', 'automation.resumed'])
    // Quien lidera México la ve (solo lectura); no ve las de US.
    const ana = await ctxFor('ana.robles')
    expect(new Set((await listAutomations(ana)).map((a) => a.market_code))).toEqual(new Set(['MX']))
  })

  it('una automatización nueva nace de una plantilla, en pausa, y se edita con validaciones; cada cambio sube la versión', async () => {
    const nora = await ctxFor('nora.salas')
    await expect(createFromTemplate(await ctxFor('luis.tovar'), 'MX', 'stalled_task')).rejects.toMatchObject({ code: 'forbidden' })
    const id = await createFromTemplate(nora, 'MX', 'stalled_task')
    const again = await createFromTemplate(nora, 'MX', 'stalled_task')
    expect(again).not.toBe(id)
    const a = (await getAutomation(nora, id))!.a
    expect(a).toMatchObject({ is_active: false, version: 1, market_code: 'MX', source: 'deal' })
    const text = say({ source: a.source, trigger: { kind: 'schedule' }, conditions: a.conditions, actions: a.actions })
    expect(text.then[0]!.es).toMatch(/^Crea una tarea para quien lleva el registro/)
    expect(text.then[0]!.en).toMatch(/^Creates a task for the record owner/)
    const base = { nameEs: 'Estancado: tarea', nameEn: 'Stalled: task', motor: 'd2d', ownerId: nora.user.id, conditions: a.conditions, actions: a.actions }
    await expect(saveAutomation(nora, id, { ...base, conditions: [{ field: 'no_existe', op: 'is_true' }] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveAutomation(nora, id, { ...base, conditions: [{ field: 'stage_age_days', op: 'gt', value: 'muchos' }] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveAutomation(nora, id, { ...base, actions: [{ type: 'create_task', to: 'owner', text_es: `Cobrar a la tarjeta ${CARD}`, text_en: 'Charge the card', due_days: 1 }] })).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('tarjeta') })
    await expect(saveAutomation(nora, id, { ...base, actions: [{ type: 'open_exception', kind: 'lead_sla', severity: 'high' }] })).rejects.toMatchObject({ code: 'invalid' }) // aviso de leads en una regla de negocios
    await expect(saveAutomation(nora, id, { ...base, actions: [{ type: 'notify', to: `user:${(await ctxFor('jade.kim')).user.id}`, text_es: 'Revisar', text_en: 'Review' }] })).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('mercado') }) // persona de otro mercado
    await expect(saveAutomation(nora, id, { ...base, motor: 'dealer' })).rejects.toMatchObject({ code: 'invalid' }) // tipo de venta que México no tiene
    await expect(saveAutomation(await ctxFor('ana.robles'), id, base)).rejects.toMatchObject({ code: 'forbidden' })
    await saveAutomation(nora, id, base)
    const b = (await getAutomation(nora, id))!.a
    expect(b).toMatchObject({ version: 2, motor: 'd2d', owner_name: nora.user.name, name_en: 'Stalled: task' })
    const ev = await one(admin<{ before: { version: number }; after: { version: number } }[]>`select before, after from crm.audit_events where action = 'automation.updated' and object_id = ${id}`)
    expect([ev.before.version, ev.after.version]).toEqual([1, 2])
  })

  it('por horario: actúa una vez por registro, solo en su mercado y tipo de venta, y deja qué hizo', async () => {
    const nora = await ctxFor('nora.salas')
    const id = await createFromTemplate(nora, 'MX', 'stalled_task')
    const a = (await getAutomation(nora, id))!.a
    await saveAutomation(nora, id, { nameEs: 'Estancado D2D: tarea', nameEn: 'Stalled D2D: task', motor: 'd2d', ownerId: nora.user.id, conditions: a.conditions, actions: a.actions })
    await setAutomationActive(nora, id, true)
    const expected = await admin<{ id: string; owner_id: string }[]>`
      select d.id, d.owner_id from crm.deals d join crm.stages s on s.id = d.stage_id join crm.pipelines p on p.id = d.pipeline_id
       where d.status = 'open' and d.market_code = 'MX' and p.motor = 'd2d' and d.paused_at is null and s.rot_days > 0 and d.stage_entered_at < now() - make_interval(days => s.rot_days)`
    expect(expected.length).toBeGreaterThan(0)
    expect(await runRules()).toMatchObject({ status: 'ok' })
    const tasks = () => admin<{ deal_id: string; owner_id: string; market_code: string; subject: string; source: string }[]>`
      select a.deal_id, a.owner_id, a.market_code, a.subject, a.source from crm.activities a
       where a.id in (select e.object_id from crm.audit_events e where e.action = 'automation.task_created' and e.after ->> 'automation_id' = ${id})`
    const first = await tasks()
    expect(new Set(first.map((t) => t.deal_id))).toEqual(new Set(expected.map((d) => d.id)))
    expect(first.every((t) => t.market_code === 'MX' && t.source === 'rule')).toBe(true)
    for (const t of first) expect(t.owner_id).toBe(expected.find((d) => d.id === t.deal_id)!.owner_id)
    expect(first[0]!.subject).toMatch(/^Mover o cerrar este negocio/)
    await runRules()
    expect(await tasks()).toHaveLength(first.length) // la segunda corrida no repite
    const log = (await getAutomation(nora, id))!.log
    expect(log.filter((l) => l.outcome === 'done')).toHaveLength(first.length)
    expect(log.every((l) => l.version === 2 && l.object === 'deal' && l.record_label)).toBe(true)
    // "Qué haría", sin cambiar nada: el negocio estancado cumple y ya se hizo; uno de US ni siquiera es de su alcance.
    const t1 = await testAutomation(nora, id, expected[0]!.id)
    expect(t1).toMatchObject({ found: true, inScope: true, wouldAct: true, alreadyDone: true, checks: [true, true] })
    const us = await one(admin<{ id: string }[]>`select id from crm.deals where market_code = 'US' and status = 'open' limit 1`)
    expect(await testAutomation(nora, id, us.id)).toMatchObject({ found: true, inScope: false, wouldAct: false })
    const fresh = await dianaDeal()
    expect(await testAutomation(nora, id, fresh.id)).toMatchObject({ found: true, inScope: false }) // es B2B, la regla es de D2D
    await expect(testAutomation(await ctxFor('lucia.vega'), id, fresh.id)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('por evento: corre con lo que entra por la cola de eventos; lo que no cumple queda anotado con la condición', async () => {
    const nora = await ctxFor('nora.salas')
    const sys = await systemContext()
    await runJob(job('automatizaciones.eventos'), 'manual', { force: true }) // fija desde dónde lee: lo anterior no dispara nada
    const id = await createFromTemplate(nora, 'MX', 'new_deal_review')
    await setAutomationActive(nora, id, true)
    const big = await dianaDeal(250000)
    const small = await dianaDeal(900)
    await new Promise((r) => setTimeout(r, 2300))
    const out = await runJob(job('automatizaciones.eventos'), 'manual', { force: true })
    expect(out).toMatchObject({ status: 'ok', done: 1 })
    const paula = await ctxFor('paula.mendez') // supervisa el equipo de Diana
    const got = await admin<{ owner_id: string; deal_id: string; subject: string }[]>`
      select owner_id, deal_id, subject from crm.activities where source = 'rule' and deal_id = any(${[big.id, small.id]}::uuid[])`
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ owner_id: paula.user.id, deal_id: big.id })
    expect(got[0]!.subject).toMatch(/^Aviso: Entró un negocio de monto alto · Negocio/)
    expect((await getQueue(paula)).rows.some((r) => r.dealId === big.id && r.type === 'task')).toBe(true) // le llega a Hoy
    const log = (await getAutomation(nora, id))!.log
    expect(log.find((l) => l.record_id === small.id)).toMatchObject({ outcome: 'skipped', detail: { condition: { field: 'amount' } } })
    expect(log.find((l) => l.record_id === big.id)).toMatchObject({ outcome: 'done', detail: { action: 'notify', people: 1 } })
    // La misma cola no se procesa dos veces.
    expect(await runJob(job('automatizaciones.eventos'), 'manual', { force: true })).toMatchObject({ done: 0 })
    void sys
  })
})

describe('AUT-01: la misma regla en toda vía de entrada (contrato)', () => {
  it('dato prohibido: la pantalla y la API lo rechazan, la importación salta la fila y la automatización no actúa', async () => {
    const jade = await ctxFor('jade.kim')
    const sys = await systemContext()
    const name = `Tienda ${CARD}`
    // 1) pantalla
    await expect(createAccount(jade, { market: 'US', kind: 'store', name, segment: 'dealer', force: true })).rejects.toMatchObject({ code: 'invalid', en: expect.stringContaining('card number') })
    // 2) API (alta de punto de venta desde la Sales App)
    const customer = `cust-${tag()}`
    const res = await ingestSalesAppEvent(sys, { event_id: `ev-${tag()}${tag()}`, type: 'store.created', version: 1, occurred_at: new Date().toISOString(), data: { customer_id: customer, market: 'US', name } })
    expect(res).toMatchObject({ status: 'unmatched', detail: 'rule_prohibited' })
    expect(await admin`select 1 from crm.account_aliases where external_id = ${customer}`).toHaveLength(0)
    expect(await admin`select 1 from crm.accounts where name like ${'%' + CARD + '%'}`).toHaveLength(0)
    // 3) importación: es la misma función, y el cargador la llama antes de escribir cada tipo de registro
    expect(skipReason(accountRule({ name })!)).toBe('rule_prohibited')
    expect(dealRule({ title: `Pedido ${CARD}`, status: 'open' })).toBe('prohibited')
    expect(leadRule({ business_name: 'Tienda', message: `mi cuenta ${CARD}` })).toBe('prohibited')
    const loader = readFileSync('src/domain/pipedrive/load.ts', 'utf8')
    for (const call of ['accountRule(', 'dealRule(', 'leadRule(']) expect(loader, call).toContain(call)
    // 4) automatización (tarea programada): una definición que alguien dejara con ese texto no llega a escribir la tarea
    const id = (await one(admin<{ id: string }[]>`
      insert into crm.automations (market_code, key, name_es, name_en, source, trigger_kind, conditions, actions)
      values ('US', ${'contrato_' + tag()}, 'Contrato', 'Contract', 'deal', 'schedule', '[{"field":"stage_kind","op":"eq","value":"open"}]'::jsonb,
              ${admin.json([{ type: 'create_task', to: 'owner', text_es: `Cobrar ${CARD}`, text_en: `Charge ${CARD}`, due_days: 0 }])}) returning id`)).id
    await runRules()
    const log = await admin<{ outcome: string; detail: { reason?: { es: string } } }[]>`select outcome, detail from crm.automation_log where automation_id = ${id}`
    expect(log.length).toBeGreaterThan(0)
    expect(log.every((l) => l.outcome === 'skipped' && /tarjeta/.test(l.detail.reason?.es ?? ''))).toBe(true)
    expect(await admin`select 1 from crm.activities where subject like ${'%' + CARD + '%'}`).toHaveLength(0)
    await admin`update crm.automations set is_active = false where id = ${id}`
  })

  it('el punto de venta de la Sales App nace por la misma función de alta, y un alta válida sigue entrando', async () => {
    const sys = await systemContext()
    const customer = `cust-${tag()}`
    const res = await ingestSalesAppEvent(sys, { event_id: `ev-${tag()}${tag()}`, type: 'store.created', version: 1, occurred_at: new Date().toISOString(), data: { customer_id: customer, market: 'MX', name: `Abarrotes La Esquina ${tag()}`, phone: mxPhone() } })
    expect(res.status).toBe('processed')
    const acc = await one(admin<{ lifecycle: string; segment: string; kind: string; country: string }[]>`select lifecycle, segment, kind, country from crm.accounts where id = ${res.accountId!}`)
    expect(acc).toEqual({ lifecycle: 'onboarding', segment: 'd2d', kind: 'store', country: 'MX' })
    expect(readFileSync('src/domain/integrations.ts', 'utf8')).not.toMatch(/insert into crm\.accounts/)
  })

  it('lo que pide la etapa vale igual para la persona y para una automatización: mismo candado, mismo mensaje', async () => {
    const nora = await ctxFor('nora.salas')
    await runJob(job('automatizaciones.eventos'), 'manual', { force: true })
    const key = 'mover_' + tag()
    const id = (await one(admin<{ id: string }[]>`
      insert into crm.automations (market_code, motor, key, name_es, name_en, source, trigger_kind, trigger_event, conditions, actions)
      values ('MX', 'b2b', ${key}, 'Mover a propuesta', 'Move to proposal', 'deal', 'event', 'deal.created', '[]'::jsonb, '[{"type":"move_stage","stage_code":"propuesta"}]'::jsonb) returning id`)).id
    const without = await dianaDeal(null) // sin monto: la etapa "propuesta" lo pide
    const withAmount = await dianaDeal(5000)
    await new Promise((r) => setTimeout(r, 2300))
    await runJob(job('automatizaciones.eventos'), 'manual', { force: true })
    const propuesta = await stage('p-mx-b2b', 'propuesta')
    const human = await moveDeal(without.diana, without.id, propuesta).catch((e: { code: string; es: string }) => e)
    expect(human).toMatchObject({ code: 'stage_gate' })
    const log = (await getAutomation(nora, id))!.log
    expect(log.find((l) => l.record_id === without.id)).toMatchObject({ outcome: 'skipped', detail: { action: 'move_stage', reason: { es: (human as { es: string }).es } } })
    expect(log.find((l) => l.record_id === withAmount.id)).toMatchObject({ outcome: 'done' })
    const moved = await one(admin<{ stage_id: string; cause: string }[]>`
      select d.stage_id, (select e.cause from crm.deal_stage_events e where e.deal_id = d.id order by e.at desc, e.id desc limit 1) as cause from crm.deals d where d.id = ${withAmount.id}`)
    expect(moved).toEqual({ stage_id: propuesta, cause: 'rule' })
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${without.id}`)).stage_id).not.toBe(propuesta)
    await admin`update crm.automations set is_active = false where id = ${id}`
  })

  it('la base repite el invariante para todos: un negocio vive en una etapa de su embudo y de su mercado', async () => {
    const sys = await systemContext()
    const deal = await dianaDeal()
    const other = await stage('p-us-dealer', 'qualified')
    const code = await withUser(sys.user.id, (tx) => attempt(tx, (sp) => sp`update crm.deals set stage_id = ${other} where id = ${deal.id}`))
    expect(code).toBe('23514') // ni la identidad de sistema (importación, integraciones) lo puede escribir
    const usPipe = await uid('p-us-dealer')
    const code2 = await withUser(sys.user.id, (tx) => attempt(tx, (sp) => sp`update crm.deals set pipeline_id = ${usPipe}, stage_id = ${other} where id = ${deal.id}`))
    expect(code2).toBe('23514')
  })
})

describe('PIPE-02: pasos con dueño, evidencia y aprobación', () => {
  async function b2bStep(input: Partial<Parameters<typeof saveTransition>[1]> = {}) {
    const nora = await ctxFor('nora.salas')
    const pipelineId = await uid('p-mx-b2b')
    return saveTransition(nora, {
      pipelineId, fromStageId: await stage('p-mx-b2b', 'calificacion'), toStageId: await stage('p-mx-b2b', 'propuesta'), allowedRoles: [],
      requiresEvidence: true, evidenceEs: 'Propuesta firmada', evidenceEn: 'Signed proposal', needsApproval: true, approver: 'role:supervisor', approvalHours: 8, ...input,
    })
  }

  it('solo administración configura un paso, y el paso se valida', async () => {
    const pipelineId = await uid('p-mx-b2b')
    const to = await stage('p-mx-b2b', 'propuesta')
    await expect(saveTransition(await ctxFor('ana.robles'), { pipelineId, toStageId: to, allowedRoles: [], requiresEvidence: false, needsApproval: false })).rejects.toMatchObject({ code: 'forbidden' })
    const nora = await ctxFor('nora.salas')
    await expect(saveTransition(nora, { pipelineId, toStageId: to, allowedRoles: [], requiresEvidence: true, needsApproval: false })).rejects.toMatchObject({ code: 'invalid' }) // falta decir qué evidencia
    await expect(saveTransition(nora, { pipelineId, toStageId: to, allowedRoles: [], requiresEvidence: false, needsApproval: true, approver: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveTransition(nora, { pipelineId, toStageId: await stage('p-us-dealer', 'application'), allowedRoles: [], requiresEvidence: false, needsApproval: false })).rejects.toMatchObject({ code: 'invalid' }) // etapa de otro embudo
    await expect(saveTransition(nora, { pipelineId, toStageId: await stage('p-mx-b2b', 'perdida'), allowedRoles: [], requiresEvidence: false, needsApproval: false })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveTransition(nora, { pipelineId, toStageId: to, allowedRoles: [], requiresEvidence: false, needsApproval: true, approver: `user:${(await ctxFor('jade.kim')).user.id}` })).rejects.toMatchObject({ code: 'invalid' }) // aprueba alguien de otro mercado
  })

  it('pide evidencia (enlace con nota), luego aprobación; quien la pidió ve a quién espera, quien aprueba la recibe en Hoy y al aprobar el negocio se mueve', async () => {
    await b2bStep()
    const { diana, id } = await dianaDeal(8000)
    const propuesta = await stage('p-mx-b2b', 'propuesta')
    await expect(moveDeal(diana, id, propuesta)).rejects.toMatchObject({ code: 'evidence_required', es: expect.stringContaining('Propuesta firmada'), en: expect.stringContaining('Signed proposal') })
    await expect(addEvidence(diana, id, { toStageId: propuesta, url: 'http://sin-cifrar.example/doc', note: 'Propuesta' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addEvidence(diana, id, { toStageId: propuesta, url: 'https://docs.example/propuesta', note: `Cuenta ${CARD}` })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addEvidence(await ctxFor('jade.kim'), id, { toStageId: propuesta, url: 'https://docs.example/p', note: 'Propuesta' })).rejects.toMatchObject({ code: 'not_found' })
    await addEvidence(diana, id, { toStageId: propuesta, url: 'https://docs.example/propuesta-firmada', note: 'Propuesta firmada por el cliente' })
    const out = await moveDeal(diana, id, propuesta)
    expect(out).toEqual({ status: 'pending', approver: 'Supervisión' })
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${id}`)).stage_id).not.toBe(propuesta) // no se movió
    expect(await moveDeal(diana, id, propuesta)).toEqual({ status: 'pending', approver: 'Supervisión' }) // pedirlo otra vez no crea otra
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.approvals where deal_id = ${id}`)).n).toBe(1)

    const mine = (await dealSteps(diana, id))!
    expect(mine.pending).toMatchObject({ mine: true, can_decide: false, approver_role: 'supervisor', late: false })
    expect(mine.evidence).toHaveLength(1)
    expect(mine.steps[0]).toMatchObject({ requires_evidence: true, has_evidence: true, needs_approval: true })
    const paula = await ctxFor('paula.mendez')
    const fernando = await ctxFor('fernando.ibarra') // supervisa otro equipo: no le llega la tarea
    const task = (await getQueue(paula)).rows.find((r) => r.dealId === id && r.type === 'task')
    expect(task?.subject).toMatch(/^Aprobar: Negocio .* pasa a "Propuesta"$/)
    expect((await getQueue(fernando)).rows.some((r) => r.dealId === id)).toBe(false)
    const approvalId = mine.pending!.id
    await expect(decide(diana, approvalId, 'approve', '')).rejects.toMatchObject({ code: 'own_request' })
    await expect(decide(await ctxFor('ivan.rios'), approvalId, 'approve', '')).rejects.toMatchObject({ code: 'not_found' }) // otro vendedor ni la ve
    await expect(decide(await ctxFor('fernando.ibarra'), approvalId, 'approve', '')).rejects.toMatchObject({ code: expect.stringMatching(/not_found|forbidden/) })
    await expect(decide(await ctxFor('luis.tovar'), approvalId, 'approve', '')).rejects.toMatchObject({ code: expect.stringMatching(/not_found|forbidden/) }) // solo lectura
    expect((await dealSteps(paula, id))!.pending).toMatchObject({ mine: false, can_decide: true })
    await decide(paula, approvalId, 'approve', '')
    const after = await one(admin<{ stage_id: string; actor: string; cause: string }[]>`
      select d.stage_id, e.actor_id as actor, e.cause from crm.deals d join crm.deal_stage_events e on e.deal_id = d.id where d.id = ${id} order by e.at desc, e.id desc limit 1`)
    expect(after).toEqual({ stage_id: propuesta, actor: diana.user.id, cause: 'user' }) // se mueve a nombre de quien lo pidió
    expect((await getQueue(paula)).rows.some((r) => r.dealId === id && /^Aprobar/.test(r.subject))).toBe(false)
    expect((await myNotices(diana)).some((n) => /lo aprobó/.test(n.body))).toBe(true)
    await expect(decide(paula, approvalId, 'approve', '')).rejects.toMatchObject({ code: 'invalid' }) // ya se decidió
    const trail = await admin<{ action: string; actor_id: string }[]>`select action, actor_id from crm.audit_events where object = 'deal' and object_id = ${id} and (action like 'deal.approval%' or action in ('deal.evidence_added', 'deal.stage_changed')) order by at, id`
    expect(trail.map((x) => x.action)).toEqual(['deal.evidence_added', 'deal.approval_requested', 'deal.approval_approved', 'deal.stage_changed'])
    expect(trail[2]!.actor_id).toBe(paula.user.id)
    expect((await dealSteps(diana, id))!.last).toMatchObject({ status: 'approved', decided_by: paula.user.name })
  })

  it('no aprobar pide el porqué, no mueve el negocio y le avisa a quien lo pidió', async () => {
    await b2bStep({ requiresEvidence: false, evidenceEs: '', evidenceEn: '' })
    const { diana, id } = await dianaDeal(8000)
    const propuesta = await stage('p-mx-b2b', 'propuesta')
    expect((await moveDeal(diana, id, propuesta)).status).toBe('pending')
    const paula = await ctxFor('paula.mendez')
    const ap = (await dealSteps(paula, id))!.pending!
    await expect(decide(paula, ap.id, 'reject', '')).rejects.toMatchObject({ code: 'invalid' })
    await decide(paula, ap.id, 'reject', 'Falta el descuento autorizado')
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${id}`)).stage_id).not.toBe(propuesta)
    expect((await myNotices(diana)).some((n) => /no aprobó/.test(n.body) && /Falta el descuento autorizado/.test(n.body))).toBe(true)
    expect((await dealSteps(diana, id))!).toMatchObject({ pending: null, last: { status: 'rejected', note: 'Falta el descuento autorizado' } })
    // Puede volver a pedirlo.
    expect((await moveDeal(diana, id, propuesta)).status).toBe('pending')
  })

  it('vencido el plazo, la aprobación pasa al suplente; antes de eso el suplente no decide', async () => {
    const paula = await ctxFor('paula.mendez')
    const ana = await ctxFor('ana.robles')
    await b2bStep({ requiresEvidence: false, evidenceEs: '', evidenceEn: '', approver: `user:${paula.user.id}`, backupId: ana.user.id, approvalHours: 2 })
    const { diana, id } = await dianaDeal(8000)
    const propuesta = await stage('p-mx-b2b', 'propuesta')
    expect(await moveDeal(diana, id, propuesta)).toEqual({ status: 'pending', approver: paula.user.name })
    const ap = (await dealSteps(ana, id))!.pending!
    expect(ap).toMatchObject({ can_decide: false, escalated: false, backup: ana.user.name })
    await expect(decide(ana, ap.id, 'approve', '')).rejects.toMatchObject({ code: 'forbidden' })
    const sys = await systemContext()
    expect(await withUser(sys.user.id, (tx) => escalateApprovals(tx, sys))).toBe(0) // todavía no vence
    await admin`update crm.approvals set due_at = now() - interval '1 minute' where id = ${ap.id}`
    expect(await runJob(job('automatizaciones.escalamiento'), 'manual', { force: true })).toMatchObject({ status: 'ok', done: 1 })
    expect(await runJob(job('automatizaciones.escalamiento'), 'manual', { force: true })).toMatchObject({ done: 0 }) // escala una sola vez
    expect((await getQueue(ana)).rows.some((r) => r.dealId === id && /^Aprobar/.test(r.subject))).toBe(true)
    expect((await dealSteps(ana, id))!.pending).toMatchObject({ can_decide: true, escalated: true })
    await decide(ana, ap.id, 'approve', 'Aprobado por suplencia')
    expect((await one(admin<{ stage_id: string }[]>`select stage_id from crm.deals where id = ${id}`)).stage_id).toBe(propuesta)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where object_id = ${id} and action = 'deal.approval_escalated'`)).n).toBe(1)
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.activities where approval_id = ${ap.id} and done_at is null`)).n).toBe(0)
  })

  it('el paso puede ser de un rol, una automatización no da un paso que pide aprobación, y perder nunca la pide', async () => {
    await b2bStep({ requiresEvidence: false, evidenceEs: '', evidenceEn: '', needsApproval: false, approver: '', allowedRoles: ['supervisor'] })
    const { diana, id } = await dianaDeal(8000)
    const propuesta = await stage('p-mx-b2b', 'propuesta')
    await expect(moveDeal(diana, id, propuesta)).rejects.toMatchObject({ code: 'step_role', es: expect.stringContaining('Supervisión') })
    await moveDeal(await ctxFor('paula.mendez'), id, propuesta) // supervisión sí
    await b2bStep({ requiresEvidence: false, evidenceEs: '', evidenceEn: '', allowedRoles: [] })
    const other = await dianaDeal(8000)
    const sys = await systemContext()
    await expect(withUser(sys.user.id, async (tx) => (await import('@/domain/deals')).moveDealTx(tx, sys, other.id, propuesta, undefined, undefined, { byRule: true }))).rejects.toMatchObject({ code: 'rule_needs_person' })
    expect((await moveDeal(other.diana, other.id, propuesta)).status).toBe('pending')
    // Perder el negocio cancela la aprobación pendiente y no pide nada más que el motivo.
    const reason = await one(admin<{ code: string }[]>`select code from crm.loss_reasons where kind = 'lost' and is_active and (market_code is null or market_code = 'MX') and (motors is null or 'b2b' = any(motors)) limit 1`)
    expect(await moveDeal(other.diana, other.id, await stage('p-mx-b2b', 'perdida'), { reasonCode: reason.code })).toEqual({ status: 'moved' })
    expect((await one(admin<{ status: string }[]>`select status from crm.approvals where deal_id = ${other.id}`)).status).toBe('cancelled')
    await admin`update crm.stage_transitions set is_active = false`
  })

  it('la etapa tiene meta de tiempo con reloj visible, y vencida se puede escalar con una automatización', async () => {
    const nora = await ctxFor('nora.salas')
    const calif = await stage('p-mx-b2b', 'calificacion')
    await expect(setStageTimes(await ctxFor('ana.robles'), calif, { slaHours: 4, rotDaysWaiting: null })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setStageTimes(nora, calif, { slaHours: 0, rotDaysWaiting: null })).rejects.toMatchObject({ code: 'invalid' })
    await setStageTimes(nora, calif, { slaHours: 4, rotDaysWaiting: null })
    const { diana, id } = await dianaDeal(100)
    expect((await dealSteps(diana, id))!.goal).toMatchObject({ late: false, hours: 4 })
    await admin`update crm.deals set stage_entered_at = now() - interval '10 days' where id = ${id}`
    expect((await dealSteps(diana, id))!.goal).toMatchObject({ late: true })
    const auto = await createFromTemplate(nora, 'MX', 'stage_goal_passed')
    expect(await testAutomation(nora, auto, id)).toMatchObject({ wouldAct: true, checks: [true, true] })
    await setAutomationActive(nora, auto, true)
    await runRules()
    const paula = await ctxFor('paula.mendez')
    expect((await getQueue(paula)).rows.some((r) => r.dealId === id && /^Aviso: Venció la meta de tiempo de la etapa/.test(r.subject))).toBe(true)
    await setStageTimes(nora, calif, { slaHours: null, rotDaysWaiting: null })
    await setAutomationActive(nora, auto, false)
  })
})

describe('PIPE-03: estancamiento por horario, también en Operaciones, con espera de terceros', () => {
  it('un negocio estancado en una etapa de Operaciones abre aviso para quien lo lleva ahí; en pausa no cuenta', async () => {
    const d = await one(admin<{ id: string; owner_id: string; ops_owner_id: string | null }[]>`
      select d.id, d.owner_id, d.ops_owner_id from crm.deals d join crm.stages s on s.id = d.stage_id where s.code = 'carrier' and d.status = 'open' and d.paused_at is null limit 1`)
    const tom = await ctxFor('tom.reyes')
    await admin`update crm.deals set stage_entered_at = now() - interval '40 days', ops_owner_id = ${tom.user.id} where id = ${d.id}`
    expect(await runRules()).toMatchObject({ status: 'ok' })
    const ex = await one(admin<{ owner_id: string; detail: { limit_days: number }; key: string }[]>`
      select e.owner_id, e.detail, a.key from crm.exceptions e join crm.automations a on a.id = e.automation_id where e.deal_id = ${d.id} and e.kind = 'stalled_deal' and e.resolved_at is null`)
    expect(ex).toMatchObject({ owner_id: tom.user.id, key: 'stalled_ops', detail: { limit_days: 28 } })
    // Con la app sin abrir sigue corriendo: es una tarea programada, con su corrida anotada.
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.job_runs where job_key = 'automatizaciones.reglas' and status = 'ok'`)).n).toBeGreaterThan(0)
    const jade = await ctxFor('jade.kim')
    void jade
    await admin`update crm.deals set paused_at = now(), pause_reason = 'Espera al cliente', pause_review_on = ${addDays(today, 5)} where id = ${d.id}`
    await runRules()
    expect(await admin`select 1 from crm.exceptions where deal_id = ${d.id} and kind = 'stalled_deal' and resolved_at is null`).toHaveLength(0)
    await admin`update crm.deals set paused_at = null, pause_reason = null, pause_review_on = null where id = ${d.id}`
  })

  it('esperar a un tercero usa su propio plazo, y el aviso dice a quién se espera', async () => {
    const nora = await ctxFor('nora.salas')
    const tom = await ctxFor('tom.reyes')
    const carrier = await stage('p-us-dealer', 'carrier')
    const d = await one(admin<{ id: string }[]>`select d.id from crm.deals d where d.stage_id = ${carrier} and d.status = 'open' and d.paused_at is null order by d.id desc limit 1`)
    await admin`update crm.deals set stage_entered_at = now() - interval '40 days' where id = ${d.id}`
    await setStageTimes(nora, carrier, { slaHours: null, rotDaysWaiting: 60 })
    await expect(setWaitingOn(await ctxFor('luis.tovar'), d.id, 'third_party')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setWaitingOn(tom, d.id, 'el vecino')).rejects.toMatchObject({ code: 'invalid' })
    await setWaitingOn(tom, d.id, 'third_party')
    await runRules()
    expect(await admin`select 1 from crm.exceptions where deal_id = ${d.id} and kind = 'stalled_deal' and resolved_at is null`).toHaveLength(0) // 40 días < 60 de espera
    await setStageTimes(nora, carrier, { slaHours: null, rotDaysWaiting: 30 })
    await runRules()
    const ex = await one(admin<{ detail: { limit_days: number; waiting_on: string } }[]>`select detail from crm.exceptions where deal_id = ${d.id} and kind = 'stalled_deal' and resolved_at is null`)
    expect(ex.detail).toMatchObject({ limit_days: 30, waiting_on: 'third_party' })
    expect((await one(admin<{ after: { waiting_on: string } }[]>`select after from crm.audit_events where action = 'deal.waiting_on' and object_id = ${d.id}`)).after.waiting_on).toBe('third_party')
    await setStageTimes(nora, carrier, { slaHours: null, rotDaysWaiting: null })
  })

  it('el umbral de la etapa sigue mandando en Ventas, y una nota no reinicia el contador', async () => {
    const { diana, id } = await dianaDeal(100)
    await admin`update crm.deals set stage_entered_at = now() - interval '15 days' where id = ${id}` // calificación se estanca a los 14
    await updateDeal(diana, id, { nextStep: 'Seguir', nextStepDue: tomorrow })
    await runRules()
    expect(await admin`select 1 from crm.exceptions where deal_id = ${id} and kind = 'stalled_deal' and resolved_at is null`).toHaveLength(1)
    await pauseDeal(diana, id, { reason: 'El cliente pidió esperar', reviewOn: addDays(today, 3) })
    await runRules()
    expect(await admin`select 1 from crm.exceptions where deal_id = ${id} and kind = 'stalled_deal' and resolved_at is null`).toHaveLength(0)
  })
})

describe('LEAD-04: escalamiento del primer contacto', () => {
  it('nace apagado; encendido, avisa a supervisión al vencer y a quien lidera N horas hábiles después, una sola vez', async () => {
    const nora = await ctxFor('nora.salas')
    const lucia = await ctxFor('lucia.vega')
    const fernando = await ctxFor('fernando.ibarra') // supervisa D2D Centro, el equipo de Lucía
    const paula = await ctxFor('paula.mendez') // supervisa otro equipo
    const ana = await ctxFor('ana.robles') // lidera México
    const id = await createLead(lucia, { market: 'MX', motor: 'd2d', businessName: `Abarrotes escalados ${tag()}`, contactName: 'Rita Luna', phone: mxPhone() })
    await admin`update crm.leads set owner_id = ${lucia.user.id}, status = 'new', first_touch_at = null, sla_due_at = now() - interval '5 minutes' where id = ${id}`
    const esc = () => runJob(job('automatizaciones.escalamiento'), 'manual', { force: true })
    const level = async () => (await one(admin<{ escalation_level: number }[]>`select escalation_level from crm.leads where id = ${id}`)).escalation_level
    const tasksOf = async (userId: string) => admin<{ subject: string }[]>`select subject from crm.activities where lead_id = ${id} and owner_id = ${userId} and custom ? 'lead_escalation' and done_at is null`

    await esc()
    expect(await level()).toBe(0) // apagado por defecto
    await expect(saveLeadEscalation(ana, 'MX', { active: true, hours: 4 })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveLeadEscalation(nora, 'MX', { active: true, hours: 0 })).rejects.toMatchObject({ code: 'invalid' })
    await saveLeadEscalation(nora, 'MX', { active: true, hours: 4 })
    await esc()
    expect(await level()).toBe(1)
    expect((await tasksOf(fernando.user.id)).map((t) => t.subject)).toEqual([expect.stringMatching(/^Lead sin primer contacto: Abarrotes escalados .*\. Lo lleva Lucía Vega\.$/)])
    expect(await tasksOf(paula.user.id)).toHaveLength(0)
    expect(await tasksOf(ana.user.id)).toHaveLength(0)
    expect((await getQueue(fernando)).rows.some((r) => r.leadId === id && r.type === 'task')).toBe(true)
    await esc()
    expect(await tasksOf(fernando.user.id)).toHaveLength(1) // no repite
    expect(await level()).toBe(1) // todavía no pasan las 4 horas hábiles más
    expect((await getLeadWatch(fernando, { market: 'MX' })).find((l) => l.id === id)).toMatchObject({ escalation_level: 1, late: true })

    // Pasan más de 4 horas hábiles desde que venció (una semana cubre fines de semana).
    await admin`alter table crm.leads disable trigger leads_escalation_reset`
    await admin`update crm.leads set sla_due_at = now() - interval '7 days' where id = ${id}`
    await admin`alter table crm.leads enable trigger leads_escalation_reset`
    await esc()
    expect(await level()).toBe(2)
    expect((await tasksOf(ana.user.id)).map((t) => t.subject)).toEqual([expect.stringMatching(/^Lead sigue sin primer contacto después de 4 horas hábiles más/)])
    expect((await getLeadWatch(ana, { market: 'MX' })).find((l) => l.id === id)).toBeUndefined() // la guardia muestra la última semana
    const trail = await admin<{ after: { level: number } }[]>`select after from crm.audit_events where action = 'lead.escalated' and object_id = ${id} order by at, id`
    expect(trail.map((t) => t.after.level)).toEqual([1, 2])

    // Con el primer intento, los avisos pendientes se cierran solos.
    await admin`update crm.leads set first_touch_at = now() where id = ${id}`
    await esc()
    expect(await tasksOf(fernando.user.id)).toHaveLength(0)
    expect(await tasksOf(ana.user.id)).toHaveLength(0)
    await saveLeadEscalation(nora, 'MX', { active: false, hours: 4 })
    expect((await one(admin<{ after: { active: boolean } }[]>`select after from crm.audit_events where action = 'routing.escalation_updated' order by at desc, id desc limit 1`)).after.active).toBe(false)
  })

  it('si el lead pasa a otra persona y su reloj vuelve a empezar, el escalamiento también', async () => {
    const nora = await ctxFor('nora.salas')
    const lucia = await ctxFor('lucia.vega')
    const marco = await ctxFor('marco.pena')
    const id = await createLead(lucia, { market: 'MX', motor: 'd2d', businessName: `Abarrotes pase ${tag()}`, contactName: 'Rita Luna', phone: mxPhone() })
    await admin`update crm.leads set owner_id = ${lucia.user.id}, status = 'new', first_touch_at = null, sla_due_at = now() - interval '5 minutes' where id = ${id}`
    await saveLeadEscalation(nora, 'MX', { active: true, hours: 4 })
    await runJob(job('automatizaciones.escalamiento'), 'manual', { force: true })
    expect((await one(admin<{ escalation_level: number }[]>`select escalation_level from crm.leads where id = ${id}`)).escalation_level).toBe(1)
    await passLead(lucia, id, marco.user.id, 'Lo atiende Marco, es de su zona')
    const l = await one(admin<{ escalation_level: number; escalated_at: Date | null; late: boolean }[]>`select escalation_level, escalated_at, sla_due_at < now() as late from crm.leads where id = ${id}`)
    expect(l).toEqual({ escalation_level: 0, escalated_at: null, late: false })
    await saveLeadEscalation(nora, 'MX', { active: false, hours: 4 })
  })
})
