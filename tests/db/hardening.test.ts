import { afterAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { addActivity } from '@/domain/activities'
import { completeItem } from '@/domain/queue'
import { getQueue } from '@/dal/queue'
import { listTree, searchAll } from '@/dal/accounts'
import { createLead, intakeFromForm } from '@/domain/leads'
import { moveDeal, updateDeal } from '@/domain/deals'
import { evaluateRules } from '@/domain/rules'
import { assertNoProhibited } from '@/domain/guard'
import { withoutUser, withUser } from '@/server/db'
import { addDays, isoDay } from '@/lib/format'

// Hallazgos del comité de evaluación (11-nov-2026): cada uno queda con una prueba que falla sin su corrección.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const phone = () => `55 6${Math.floor(1000000 + Math.random() * 8999999)}`
const today = isoDay(new Date(), 'America/Mexico_City')
const tomorrow = addDays(today, 1)
// Datos de prueba armados en ejecución, para que el repositorio no contenga un número con forma de tarjeta o de cuenta.
const CARD = ['4111', '1111', '1111', '1111'].join(' ')
const SSN = ['123', '45', '6789'].join('-')
// Un IMEI válido (pasa el dígito de control de Luhn, como las tarjetas): es dato de trabajo y sí se guarda.
const IMEI = ['35', '693803', '564380', '9'].join('')
const CLABE = (() => {
  const base = ['002', '010', '07777', '777777'].join('')
  const w = [3, 7, 1]
  const sum = [...base].reduce((n, d, i) => n + ((Number(d) * w[i % 3]!) % 10), 0)
  return base + String((10 - (sum % 10)) % 10)
})()

describe('SEG-01: una actividad solo se liga a registros visibles y del mismo mercado', () => {
  it('un vendedor de MX no deja una nota en el lead de US usando un comercio propio como puerta', async () => {
    const ivan = await ctxFor('ivan.rios')
    const usLead = await one(admin<{ id: string }[]>`select id from crm.leads where market_code = 'US' order by id limit 1`)
    const mine = await one(admin<{ id: string }[]>`select id from crm.accounts where owner_id = ${ivan.user.id} and archived_at is null order by id limit 1`)
    const before = (await admin`select 1 from crm.activities where lead_id = ${usLead.id}`).length
    await expect(addActivity(ivan, { accountId: mine.id, leadId: usLead.id, kind: 'note', subject: `Nota cruzada ${tag()}` })).rejects.toMatchObject({ code: 'not_found' })
    await expect(addActivity(ivan, { leadId: usLead.id, kind: 'note', subject: `Nota cruzada ${tag()}` })).rejects.toMatchObject({ code: 'not_found' })
    // y la política de la base lo rechaza aunque alguien se salte el dominio
    await asPersona('ivan.rios', async (tx) => {
      const res = await attempt(tx, (sp) => sp`insert into crm.activities (market_code, account_id, lead_id, kind, subject, owner_id, created_by)
                                                 values ('MX', ${mine.id}, ${usLead.id}, 'note', 'directo', ${ivan.user.id}, ${ivan.user.id})`)
      expect(res).toBe('42501')
    })
    expect((await admin`select 1 from crm.activities where lead_id = ${usLead.id}`).length).toBe(before)
    // lo legítimo sigue funcionando: nota en su propio comercio
    await expect(addActivity(ivan, { accountId: mine.id, kind: 'note', subject: `Nota propia ${tag()}` })).resolves.toBeTruthy()
  })

  it('un negocio y un comercio que no se corresponden no se mezclan en una actividad', async () => {
    const marco = await ctxFor('marco.pena')
    const d = await one(admin<{ id: string; account_id: string }[]>`select id, account_id from crm.deals where owner_id = ${marco.user.id} and status = 'open' order by id limit 1`)
    const other = await one(admin<{ id: string }[]>`select id from crm.accounts where owner_id = ${marco.user.id} and id <> ${d.account_id} and archived_at is null order by id limit 1`)
    await expect(addActivity(marco, { dealId: d.id, accountId: other.id, kind: 'note', subject: `Mezcla ${tag()}` })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('SEG-02 y SEG-03: el reloj de primer contacto y las sugerencias no se apagan sin seguimiento', () => {
  it('"Llamar después" no cuenta como intento, y "No contestó" exige programar el siguiente', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Reloj ${tag()}`, contactName: 'Persona', phone: phone() })
    await expect(completeItem(marco, { type: 'lead', id, result: 'later', next: 'call', when: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'lead', id, result: 'done', next: 'call', when: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'lead', id, result: 'no_answer', next: 'none', when: '' })).rejects.toMatchObject({ code: 'invalid' })
    const still = await one(admin`select status, first_touch_at from crm.leads where id = ${id}`)
    expect(still).toMatchObject({ status: 'new', first_touch_at: null })
    expect((await getQueue(marco)).rows.some((r) => r.type === 'lead' && r.id === id)).toBe(true)
    // con contacto sí se puede cerrar sin más pasos
    await expect(completeItem(marco, { type: 'lead', id, result: 'reached', next: 'none', when: '' })).resolves.toEqual({ next: null, due: null })
    expect((await one(admin`select status from crm.leads where id = ${id}`)).status).toBe('contacted')
  })

  it('una sugerencia no se cierra con "nada más": pide un próximo paso con fecha', async () => {
    const marco = await ctxFor('marco.pena')
    const sys = await systemContext()
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    const s = (await getQueue(marco)).rows.find((r) => r.type === 'suggestion')
    expect(s).toBeTruthy()
    await expect(completeItem(marco, { type: 'suggestion', id: s!.id, result: 'done', next: 'none', when: '' })).rejects.toMatchObject({ code: 'invalid' })
    expect((await one(admin`select resolved_at from crm.exceptions where id = ${s!.id}`)).resolved_at).toBeNull()
  })
})

describe('SEG-05 y SEG-08: texto libre sin datos prohibidos y con límites', () => {
  it('una tarjeta, un SSN o una CLABE no entran por notas, asuntos ni próximo paso; un teléfono o un ID largo sí', async () => {
    for (const bad of [`Paga con ${CARD}`, `SSN ${SSN}`, `CLABE ${CLABE} del dueño`]) expect(() => assertNoProhibited(bad), bad.slice(0, 8)).toThrow()
    for (const ok of ['Llamar al 55 1234 5678', 'Terminal 000123456789012346', 'ID EM-100200300', '+52 55 1234 5678 y +1 305 555 0100', `IMEI ${IMEI}`, null, '']) expect(() => assertNoProhibited(ok)).not.toThrow()

    const marco = await ctxFor('marco.pena')
    const d = await one(admin<{ id: string; account_id: string; stage_id: string; pipeline_id: string }[]>`
      select d.id, d.account_id, d.stage_id, d.pipeline_id from crm.deals d join crm.stages s on s.id = d.stage_id
       where d.owner_id = ${marco.user.id} and d.status = 'open' and s.code = 'interes' order by d.id desc limit 1`)
    await expect(addActivity(marco, { accountId: d.account_id, kind: 'note', subject: 'Datos de pago', body: `Tarjeta ${CARD}` })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addActivity(marco, { accountId: d.account_id, kind: 'note', subject: `Cuenta ${CLABE}` })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateDeal(marco, d.id, { nextStep: `Cobrar a la tarjeta ${CARD}`, nextStepDue: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    const to = (await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${d.pipeline_id} and code = 'visitada'`)).id
    await expect(moveDeal(marco, d.id, to, undefined, { step: `Pedir ${CARD}`, due: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    await expect(moveDeal(marco, d.id, to, undefined, { step: 'x'.repeat(201), due: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    await expect(moveDeal(marco, d.id, to, undefined, { step: 'Volver', due: '1999-01-01' })).rejects.toMatchObject({ code: 'invalid' })
    expect((await admin`select 1 from crm.activities where account_id = ${d.account_id} and (subject like ${'%' + CARD + '%'} or body like ${'%' + CARD + '%'})`).length).toBe(0)
    expect((await one(admin`select stage_id from crm.deals where id = ${d.id}`)).stage_id).toBe(d.stage_id)
  })
})

describe('SEG-04: bitácora de accesos', () => {
  it('iniciar y cerrar sesión dejan su evento, con el tipo de sesión', async () => {
    const id = await personaId('marco.pena')
    const hash = createHash('sha256').update(`prueba-${tag()}`).digest('hex')
    const count = async (action: string) => (await admin`select 1 from crm.audit_events where actor_id = ${id} and action = ${action}`).length
    const [started, ended] = [await count('session.started'), await count('session.ended')]
    await withoutUser((tx) => tx`select app.session_create(${id}, ${hash}, 'persona', 12)`)
    expect(await count('session.started')).toBe(started + 1)
    expect((await one(admin`select after from crm.audit_events where actor_id = ${id} and action = 'session.started' order by at desc limit 1`)).after).toEqual({ kind: 'persona' })
    await withoutUser((tx) => tx`select app.session_delete(${hash})`)
    expect(await count('session.ended')).toBe(ended + 1)
    // cerrar una sesión que no existe no deja rastro falso
    await withoutUser((tx) => tx`select app.session_delete(${hash})`)
    expect(await count('session.ended')).toBe(ended + 1)
  })
})

describe('hallazgos de QA', () => {
  it('QA-02: saltar etapas hacia adelante exige lo que piden las de en medio', async () => {
    const marco = await ctxFor('marco.pena')
    const d = await one(admin<{ id: string; pipeline_id: string; stage_id: string }[]>`
      select d.id, d.pipeline_id, d.stage_id from crm.deals d join crm.stages s on s.id = d.stage_id
       where d.owner_id = ${marco.user.id} and d.status = 'open' and s.code = 'visitada' order by d.id limit 1`)
    await admin`update crm.deals set decision_maker_met = false, next_step = 'Volver', next_step_due = current_date + 1 where id = ${d.id}`
    const stage = async (code: string) => (await one(admin<{ id: string }[]>`select id from crm.stages where pipeline_id = ${d.pipeline_id} and code = ${code}`)).id
    // "Esperando primera venta" no pide nada por sí misma, pero para llegar hay que pasar por dos etapas que piden al decisor
    await expect(moveDeal(marco, d.id, await stage('espera'))).rejects.toMatchObject({ code: 'stage_gate' })
    await expect(moveDeal(marco, d.id, await stage('interes'))).rejects.toMatchObject({ code: 'stage_gate' })
    expect((await one(admin`select stage_id from crm.deals where id = ${d.id}`)).stage_id).toBe(d.stage_id)
  })

  it('QA-18: el próximo paso de un negocio abierto no se borra ni se fecha en el pasado', async () => {
    const marco = await ctxFor('marco.pena')
    const d = await one(admin<{ id: string }[]>`select id from crm.deals where owner_id = ${marco.user.id} and status = 'open' and next_step is not null order by id limit 1`)
    await expect(updateDeal(marco, d.id, { nextStep: '', nextStepDue: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateDeal(marco, d.id, { nextStep: 'Volver', nextStepDue: '2020-01-01' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateDeal(marco, d.id, { nextStep: 'Volver con contrato', nextStepDue: tomorrow })).resolves.toBeUndefined()
  })

  it('QA-12: atender una sugerencia cierra los demás avisos abiertos del mismo negocio', async () => {
    const lucia = await ctxFor('lucia.vega')
    const sys = await systemContext()
    const d = await one(admin<{ id: string }[]>`
      select d.id from crm.deals d join crm.stages s on s.id = d.stage_id
       where d.owner_id = ${lucia.user.id} and d.status = 'open' and s.kind = 'open' and s.rot_days > 0 order by d.id limit 1`)
    await admin`update crm.deals set next_step = null, next_step_due = null, stage_entered_at = now() - interval '200 days', amount_minor = 99999999900 where id = ${d.id}`
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    const open = async () => (await admin<{ kind: string }[]>`select kind from crm.exceptions where deal_id = ${d.id} and resolved_at is null order by kind`).map((r) => r.kind)
    expect(await open()).toEqual(['no_next_step', 'stalled_deal'])
    const s = (await getQueue(lucia)).rows.find((r) => r.type === 'suggestion' && r.dealId === d.id)
    expect(s?.kind).toBe('no_next_step')
    await completeItem(lucia, { type: 'suggestion', id: s!.id, result: 'done', next: 'task', when: tomorrow })
    expect(await open()).toEqual([])
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    expect(await open()).toEqual([])
    expect((await getQueue(lucia)).rows.some((r) => r.type === 'suggestion' && r.dealId === d.id)).toBe(false)
  })

  it('QA-01: dos negocios enviados desde la misma pantalla del formulario son dos leads; el mismo dos veces es uno', async () => {
    const sys = await systemContext()
    const key = `form:${tag()}`
    const a = { business_name: `Tienda Mostrador A ${tag()}`, contact_name: 'Persona', phone: phone() }
    const b = { business_name: `Tienda Mostrador B ${tag()}`, contact_name: 'Persona', phone: phone() }
    // la acción del formulario combina la llave del render con lo enviado: aquí se prueba el efecto en el dominio
    const first = await intakeFromForm(sys, 'tiendas-mx', a, `${key}:a`)
    const again = await intakeFromForm(sys, 'tiendas-mx', a, `${key}:a`)
    const second = await intakeFromForm(sys, 'tiendas-mx', b, `${key}:b`)
    expect(again).toMatchObject({ leadId: first.leadId, duplicate: true })
    expect(second.duplicate).toBe(false)
    expect(second.leadId).not.toBe(first.leadId)
  })

  it('QA-05 y QA-19: el árbol sale en orden de jerarquía y la búsqueda encuentra por el ID de CONTIGO', async () => {
    const nora = await ctxFor('nora.salas')
    const { nodes } = await listTree(nora, { market: 'MX' })
    expect(nodes[0]!.depth).toBe(0)
    // cada nodo con sangría va debajo de un nodo de un nivel menor: no hay tiendas colgando del padre equivocado
    const parents = await admin<{ id: string; parent_id: string | null }[]>`select id, parent_id from crm.accounts where id = any(${nodes.map((n) => n.id)}::uuid[])`
    const parentOf = new Map(parents.map((p) => [p.id, p.parent_id]))
    const stack: string[] = []
    for (const n of nodes) {
      stack.length = n.depth
      if (n.depth > 0) expect(parentOf.get(n.id), n.name).toBe(stack[n.depth - 1])
      stack[n.depth] = n.id
    }
    // quien no ve la cadena ve sus tiendas al primer nivel, no con sangría bajo un padre que no aparece
    const marco = await ctxFor('marco.pena')
    const mine = (await listTree(marco, {})).nodes
    const visible = new Set(mine.map((n) => n.id))
    for (const n of mine) if (n.depth > 0) expect(visible.has(parentOf.get(n.id) ?? (await one(admin<{ parent_id: string }[]>`select parent_id from crm.accounts where id = ${n.id}`)).parent_id)).toBe(true)

    const acc = await one(admin<{ id: string; name: string }[]>`select id, name from crm.accounts where market_code = 'MX' and archived_at is null order by id limit 1`)
    expect((await searchAll(nora, acc.id)).accounts.map((x) => x.id)).toContain(acc.id)
    expect((await searchAll(nora, acc.id.slice(0, 13))).accounts.map((x) => x.id)).toContain(acc.id)
  })
})
