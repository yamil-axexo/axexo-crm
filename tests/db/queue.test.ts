import { afterAll, describe, expect, it } from 'vitest'
import { ctxFor, owner, systemContext } from './helpers'
import { completeItem } from '@/domain/queue'
import { getQueue, getTeamQueue } from '@/dal/queue'
import { createLead } from '@/domain/leads'
import { addActivity } from '@/domain/activities'
import { evaluateRules } from '@/domain/rules'
import { withUser } from '@/server/db'
import { addDays, isoDay } from '@/lib/format'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)
const phone = () => `55 6${Math.floor(1000000 + Math.random() * 8999999)}`
const today = isoDay(new Date(), 'America/Mexico_City')
const tomorrow = addDays(today, 1)

/** Un deal abierto de Marco, con su comercio. */
const marcoDeal = async () => one(admin<{ id: string; account_id: string }[]>`
  select d.id, d.account_id from crm.deals d join crm.users u on u.id = d.owner_id join crm.stages s on s.id = d.stage_id
   where u.full_name = 'Marco Peña' and d.status = 'open' and s.kind = 'open' order by d.created_at limit 1`)

describe('cola de Hoy: completar siempre pide el próximo paso (handoff, sección 6)', () => {
  it('una tarea no se completa sin decir qué sigue; con próximo paso queda hecha, programa la siguiente y actualiza el deal', async () => {
    const marco = await ctxFor('marco.pena')
    const deal = await marcoDeal()
    const id = await addActivity(marco, { dealId: deal.id, kind: 'task', subject: `Llamar para cerrar ${tag()}`, dueAt: today })

    await expect(completeItem(marco, { type: 'task', id, result: 'done', next: '', when: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'task', id, result: 'done', next: 'call', when: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'task', id, result: 'done', next: 'call', when: addDays(today, -1) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(completeItem(marco, { type: 'task', id, result: '', next: 'call', when: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    expect((await one(admin`select done_at from crm.activities where id = ${id}`)).done_at).toBeNull()

    const out = await completeItem(marco, { type: 'task', id, result: 'reached', next: 'proposal', when: tomorrow })
    expect(out.due).toBe(tomorrow)
    expect(out.next).toContain('Enviar propuesta a')
    const done = await one(admin`select done_at, outcome from crm.activities where id = ${id}`)
    expect(done.done_at).not.toBeNull()
    expect(done.outcome).toBe('reached')
    const next = await one(admin`select subject, due_at::date::text as due, done_at, owner_id, account_id from crm.activities where deal_id = ${deal.id} and done_at is null and subject = ${out.next}`)
    expect(next).toMatchObject({ due: tomorrow, done_at: null, owner_id: marco.user.id, account_id: deal.account_id })
    const d = await one(admin`select next_step, next_step_due::text as due from crm.deals where id = ${deal.id}`)
    expect(d).toMatchObject({ next_step: out.next, due: tomorrow })
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action = 'activity.completed'`).length).toBe(1)

    // repetir no duplica: la tarea ya estaba hecha
    expect(await completeItem(marco, { type: 'task', id, result: 'done', next: 'call', when: tomorrow })).toEqual({ next: null, due: null })
    expect((await admin`select 1 from crm.activities where deal_id = ${deal.id} and done_at is null and subject like 'Llamar a %' and created_at > now() - interval '1 minute'`).length).toBe(0)
  })

  it('cerrar es la única forma de guardar sin próximo paso', async () => {
    const marco = await ctxFor('marco.pena')
    const deal = await marcoDeal()
    const id = await addActivity(marco, { accountId: deal.account_id, kind: 'task', subject: `Recoger contrato ${tag()}`, dueAt: today })
    const before = (await admin`select 1 from crm.activities where account_id = ${deal.account_id} and done_at is null`).length
    expect(await completeItem(marco, { type: 'task', id, result: 'done', next: 'none', when: '' })).toEqual({ next: null, due: null })
    expect((await admin`select 1 from crm.activities where account_id = ${deal.account_id} and done_at is null`).length).toBe(before - 1)
  })

  it('un lead que no contesta: el intento queda en el hilo, el reloj se detiene y sigue sin contactar; al contactarlo cambia de estado', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Cola ${tag()}`, contactName: 'Lupita Ramos', phone: phone() })
    await admin`update crm.leads set sla_due_at = now() - interval '5 minutes' where id = ${id}`
    expect((await getQueue(marco)).rows.find((r) => r.id === id)).toMatchObject({ type: 'lead', group: 'late' })

    const out = await completeItem(marco, { type: 'lead', id, result: 'no_answer', next: 'call', when: today })
    expect(out.next).toContain('Llamar a Abarrotes Cola')
    const lead = await one(admin`select status, first_touch_at from crm.leads where id = ${id}`)
    expect(lead.status).toBe('new')
    expect(lead.first_touch_at).not.toBeNull()
    const log = await admin`select kind, subject, outcome, done_at from crm.activities where lead_id = ${id} order by created_at`
    expect(log.map((a) => [a.kind, a.outcome, a.done_at !== null])).toEqual([['call', 'no_answer', true], ['task', null, false]])
    expect(log[0]!.subject).toBe('Primer contacto: No contestó')

    // sale de la cola como lead y entra como la tarea de volver a llamar; la regla de tiempo de respuesta ya no lo marca
    const rows = (await getQueue(marco)).rows
    expect(rows.find((r) => r.type === 'lead' && r.id === id)).toBeUndefined()
    expect(rows.find((r) => r.type === 'task' && r.leadId === id)).toMatchObject({ group: 'today', name: expect.stringContaining('Abarrotes Cola') })
    const sys = await systemContext()
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    expect((await admin`select 1 from crm.exceptions where lead_id = ${id} and kind = 'lead_sla' and resolved_at is null`).length).toBe(0)

    const again = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Cola ${tag()}`, contactName: 'Rosa Luna', phone: phone() })
    await completeItem(marco, { type: 'lead', id: again, result: 'reached', next: 'proposal', when: tomorrow })
    expect((await one(admin`select status from crm.leads where id = ${again}`)).status).toBe('contacted')
  })

  it('una sugerencia atendida se cierra, queda en el hilo y no reaparece aunque la condición siga', async () => {
    const marco = await ctxFor('marco.pena')
    const sys = await systemContext()
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    const s = (await getQueue(marco)).rows.find((r) => r.type === 'suggestion' && r.kind !== 'no_next_step' && (r.accountId || r.dealId))
    expect(s, 'el seed deja sugerencias a Marco').toBeTruthy()
    const out = await completeItem(marco, { type: 'suggestion', id: s!.id, result: 'reached', next: 'meeting', when: tomorrow })
    expect(out.next).toContain('Reunión con')
    const e = await one(admin`select resolution, resolved_by, dedupe_key, detail from crm.exceptions where id = ${s!.id}`)
    expect(e).toMatchObject({ resolution: 'scheduled', resolved_by: marco.user.id })
    expect(e.detail.outcome).toBe('reached')
    expect((await admin`select 1 from crm.activities where source = 'rule' and outcome = 'reached' and done_at is not null
                         and coalesce(deal_id::text, account_id::text) = ${s!.dealId ?? s!.accountId}`).length).toBeGreaterThan(0)
    await withUser(sys.user.id, (tx) => evaluateRules(tx))
    expect((await admin`select 1 from crm.exceptions where dedupe_key = ${e.dedupe_key} and resolved_at is null`).length).toBe(0)
    expect((await getQueue(marco)).rows.find((r) => r.id === s!.id)).toBeUndefined()
  })

  it('nadie completa lo que no puede ver: un vendedor de US no toca una tarea de MX', async () => {
    const marco = await ctxFor('marco.pena')
    const sam = await ctxFor('sam.ortiz')
    const deal = await marcoDeal()
    const id = await addActivity(marco, { dealId: deal.id, kind: 'task', subject: `Privada ${tag()}`, dueAt: today })
    await expect(completeItem(sam, { type: 'task', id, result: 'done', next: 'none', when: '' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(completeItem(sam, { type: 'task', id: 'no-es-un-id', result: 'done', next: 'none', when: '' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(completeItem(sam, { type: 'otro', id, result: 'done', next: 'none', when: '' })).rejects.toMatchObject({ code: 'not_found' })
    expect((await one(admin`select done_at from crm.activities where id = ${id}`)).done_at).toBeNull()
  })
})

describe('cola de Hoy: qué entra y en qué grupo', () => {
  it('lo de ayer es vencido, lo de hoy es hoy y lo de mañana todavía no aparece', async () => {
    const marco = await ctxFor('marco.pena')
    const deal = await marcoDeal()
    const mk = async (label: string, due: string) => {
      const id = await addActivity(marco, { accountId: deal.account_id, kind: 'task', subject: `${label} ${tag()}`, dueAt: today })
      await admin`update crm.activities set due_at = ${due} where id = ${id}`
      return id
    }
    const late = await mk('Ayer', `${addDays(today, -1)}T18:00:00Z`)
    const now = await mk('Hoy', `${today}T18:30:00Z`)
    const later = await mk('Mañana', `${tomorrow}T18:00:00Z`)
    const q = await getQueue(marco)
    expect(q.rows.find((r) => r.id === late)?.group).toBe('late')
    expect(q.rows.find((r) => r.id === now)?.group).toBe('today')
    expect(q.rows.find((r) => r.id === later)).toBeUndefined()
    expect(q.counts.late).toBeGreaterThanOrEqual(1)
    expect(q.counts.today).toBeGreaterThanOrEqual(1)
    expect(q.rows.every((r) => r.type !== 'suggestion' || r.kind !== 'lead_sla')).toBe(true)
  })

  it('Mi equipo: el supervisor ve a su gente con sus vencidos; un vendedor no ve a nadie', async () => {
    const fernando = await ctxFor('fernando.ibarra')
    const team = await getTeamQueue(fernando)
    const names = team.map((r) => r.full_name)
    expect(names).toEqual(expect.arrayContaining(['Marco Peña', 'Lucía Vega']))
    expect(names).not.toContain('Fernando Ibarra')
    expect(names.some((n) => n === 'Diana Cruz')).toBe(false)
    const marco = team.find((r) => r.full_name === 'Marco Peña')!
    expect(marco.late).toBeGreaterThanOrEqual(1)
    expect(new Set(team.map((r) => r.id)).size).toBe(team.length)
    expect(await getTeamQueue(await ctxFor('marco.pena'))).toEqual([])
  })
})
