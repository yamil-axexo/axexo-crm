import { afterAll, describe, expect, it } from 'vitest'
import { ctxFor, owner, systemContext } from './helpers'
import { bulkDisqualify, convertLead, createLead, intakeFromForm, passLead, qualifyLead, releaseLead, takeLead, updateLeadDetails } from '@/domain/leads'
import { setMarketHours } from '@/domain/lead-hours'
import { addActivity } from '@/domain/activities'
import { completeItem } from '@/domain/queue'
import { getQueue } from '@/dal/queue'
import { getLead, listLeads, marketPipelines } from '@/dal/leads'
import { searchAll } from '@/dal/accounts'
import { addDays, isoDay } from '@/lib/format'

// Ola 2, paquete leads (12-nov-2026): cada punto del encargo queda con una prueba que falla sin su cambio.
// Las pruebas crean sus propios leads y dejan los datos sembrados como estaban.
const admin = owner()
const tag = () => Math.random().toString(36).slice(2, 8)
const usPhone = () => `305 6${Math.floor(100000 + Math.random() * 899999)}`
const mxPhone = () => `55 4${Math.floor(1000000 + Math.random() * 8999999)}`
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tomorrow = addDays(isoDay(new Date(), 'America/Mexico_City'), 1)

afterAll(async () => {
  await admin.end()
})

describe('1 a 4: convertir funciona en todos los mercados y conserva la historia', () => {
  it('un lead de US guardado como "Tiendas (D2D)" se convierte: el mercado tiene un solo embudo y va directo', async () => {
    const sam = await ctxFor('sam.ortiz')
    const id = await createLead(sam, { market: 'US', motor: 'd2d', businessName: `Corner Wireless ${tag()}`, contactName: 'Dana Fox', phone: usPhone(), contactRole: 'manager' })
    await qualifyLead(sam, id)
    // otras pruebas pueden haber dejado más embudos en US: aquí el mercado queda con uno solo, como en producción
    const extra = await admin<{ id: string }[]>`update crm.pipelines set is_active = false where market_code = 'US' and is_active and id <> md5('contigo:p-us-dealer')::uuid returning id`
    let out: { accountId: string; dealId: string }
    try {
      out = await convertLead(sam, id)
    } finally {
      if (extra.length) await admin`update crm.pipelines set is_active = true where id = any(${extra.map((e) => e.id)}::uuid[])`
    }
    const deal = await one(admin`select p.motor, p.market_code from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where d.id = ${out.dealId}`)
    expect(deal).toMatchObject({ motor: 'dealer', market_code: 'US' })
    const acc = await one(admin`select kind, segment from crm.accounts where id = ${out.accountId}`)
    expect(acc).toMatchObject({ kind: 'store', segment: 'dealer' })
    // el rol que se capturó en el lead es el del contacto: quien atiende el mostrador no queda como dueño
    expect((await one(admin`select role from crm.account_contacts where account_id = ${out.accountId}`)).role).toBe('manager')
  })

  it('el tipo de venta, el tipo de cuenta y el rol se corrigen en el lead antes de convertir, y queda en la bitácora', async () => {
    const diana = await ctxFor('diana.cruz')
    const id = await createLead(diana, { market: 'MX', motor: 'd2d', businessName: `Distribuidora Norte ${tag()}`, contactName: 'Raúl Peña', phone: mxPhone() })
    await updateLeadDetails(diana, id, { motor: 'b2b', accountType: 'distributor', contactRole: 'purchasing' })
    expect(await one(admin`select motor, account_type, contact_role from crm.leads where id = ${id}`)).toEqual({ motor: 'b2b', account_type: 'distributor', contact_role: 'purchasing' })
    // el tipo de cuenta sale del catálogo de tipos de cuenta: uno que no existe no entra
    await expect(updateLeadDetails(diana, id, { accountType: 'no_existe' })).rejects.toMatchObject({ code: 'invalid' })
    expect((await admin`select 1 from crm.audit_events where object_id = ${id} and action = 'lead.updated'`).length).toBe(1)
    await expect(updateLeadDetails(diana, id, { motor: 'no-existe' })).rejects.toMatchObject({ code: 'invalid' })
    await qualifyLead(diana, id)
    const out = await convertLead(diana, id)
    expect(await one(admin`select kind, segment from crm.accounts where id = ${out.accountId}`)).toEqual({ kind: 'distributor', segment: 'b2b' })
    expect((await one(admin`select role from crm.account_contacts where account_id = ${out.accountId}`)).role).toBe('purchasing')
  })

  it('un lead B2B no nace como tienda, y en MX se puede elegir el embudo entre los del mercado', async () => {
    const diana = await ctxFor('diana.cruz')
    const pipes = await marketPipelines(diana, 'MX')
    expect([...new Set(pipes.map((p) => p.motor))].sort()).toEqual(expect.arrayContaining(['b2b', 'd2d']))
    const a = await createLead(diana, { market: 'MX', motor: 'b2b', businessName: `Cadena Sur ${tag()}`, contactName: 'Mara Gil', phone: mxPhone() })
    await qualifyLead(diana, a)
    const outA = await convertLead(diana, a)
    expect((await one(admin`select kind from crm.accounts where id = ${outA.accountId}`)).kind).toBe('chain')
    // con embudo elegido a mano: entra a ese, aunque el tipo de venta del lead diga otra cosa
    const b = await createLead(diana, { market: 'MX', motor: 'b2b', businessName: `Tienda Elegida ${tag()}`, contactName: 'Mara Gil', phone: mxPhone() })
    await qualifyLead(diana, b)
    const d2d = pipes.find((p) => p.motor === 'd2d')!
    const outB = await convertLead(diana, b, { pipelineId: d2d.id, accountType: 'store', contactRole: 'owner' })
    expect((await one(admin`select pipeline_id from crm.deals where id = ${outB.dealId}`)).pipeline_id).toBe(d2d.id)
    // un embudo de otro mercado no entra
    const us = (await marketPipelines(await ctxFor('nora.salas'), 'US'))[0]!
    const c = await createLead(diana, { market: 'MX', motor: 'b2b', businessName: `Cadena Ajena ${tag()}`, contactName: 'Mara Gil', phone: mxPhone() })
    await qualifyLead(diana, c)
    await expect(convertLead(diana, c, { pipelineId: us.id })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('sin embudo en el mercado, el mensaje dice qué hacer y quién lo resuelve, y el lead sigue calificado', async () => {
    const sam = await ctxFor('sam.ortiz')
    const id = await createLead(sam, { market: 'US', motor: 'dealer', businessName: `No Funnel Mobile ${tag()}`, contactName: 'Dana Fox', phone: usPhone() })
    await qualifyLead(sam, id)
    const off = await admin<{ id: string }[]>`update crm.pipelines set is_active = false where market_code = 'US' and is_active returning id`
    try {
      await expect(convertLead(sam, id)).rejects.toMatchObject({ code: 'no_pipeline', en: expect.stringContaining('ask an admin') })
      expect((await one(admin`select status from crm.leads where id = ${id}`)).status).toBe('qualified')
    } finally {
      await admin`update crm.pipelines set is_active = true where id = any(${off.map((e) => e.id)}::uuid[])`
    }
  })

  it('las notas, los intentos y la tarea del lead quedan en el hilo del comercio y del negocio, sin una segunda tarea', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Historia ${tag()}`, contactName: 'Lola Ruiz', phone: mxPhone() })
    await addActivity(marco, { leadId: id, kind: 'note', subject: 'Pidió la lista de productos' })
    await completeItem(marco, { type: 'lead', id, result: 'reached', next: 'proposal', when: tomorrow })
    await qualifyLead(marco, id)
    const out = await convertLead(marco, id)
    const thread = await admin`select kind, subject, done_at, account_id, deal_id from crm.activities where lead_id = ${id} order by created_at`
    expect(thread.length).toBe(3)
    expect(thread.every((a) => a.account_id === out.accountId && a.deal_id === out.dealId)).toBe(true)
    // lo único abierto es la tarea que ya traía el lead, y es el próximo paso del negocio
    const open = await admin`select subject from crm.activities where deal_id = ${out.dealId} and done_at is null`
    expect(open.length).toBe(1)
    const deal = await one(admin`select next_step, next_step_due::text as due from crm.deals where id = ${out.dealId}`)
    expect(deal).toEqual({ next_step: open[0]!.subject, due: tomorrow })
    expect(deal.next_step).toContain('Enviar propuesta')
  })

  it('sin nada pendiente en el lead, la conversión deja la tarea de siempre (una sola)', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Limpio ${tag()}`, contactName: 'Lola Ruiz', phone: mxPhone() })
    await qualifyLead(marco, id)
    const out = await convertLead(marco, id)
    const open = await admin`select subject from crm.activities where deal_id = ${out.dealId} and done_at is null`
    expect(open.map((a) => a.subject)).toEqual(['Llamar para agendar la primera visita'])
  })
})

describe('5: el reloj de primer contacto corre en el horario hábil del mercado', () => {
  const due = async (market: string, from: string, mins: number, tz: string) =>
    (await one(admin<{ d: string }[]>`select to_char(app.business_due(${market}, ${from}::timestamptz, ${mins}) at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as d`)).d

  it('un lead que entra a las 22:00 vence a las 10:00 del siguiente día hábil; uno de viernes en la tarde sigue el lunes', async () => {
    const mx = 'America/Mexico_City'
    expect(await due('MX', '2026-11-12 22:00-06', 60, mx)).toBe('2026-11-13 10:00') // jueves en la noche
    expect(await due('MX', '2026-11-12 10:15-06', 60, mx)).toBe('2026-11-12 11:15') // dentro del horario: una hora natural
    expect(await due('MX', '2026-11-13 17:30-06', 60, mx)).toBe('2026-11-16 09:30') // viernes: media hora hoy, media el lunes
    expect(await due('US', '2026-11-14 12:00-05', 120, 'America/New_York')).toBe('2026-11-16 11:00') // sábado
  })

  it('administración cambia el horario del mercado y el reloj lo respeta; nadie más puede', async () => {
    const nora = await ctxFor('nora.salas')
    await expect(setMarketHours(await ctxFor('ana.robles'), { market: 'MX', days: [1, 2, 3, 4, 5, 6], opens: '08:00', closes: '20:00' })).rejects.toMatchObject({ code: 'forbidden' })
    await setMarketHours(nora, { market: 'MX', days: [1, 2, 3, 4, 5, 6], opens: '08:00', closes: '20:00' })
    try {
      expect(await due('MX', '2026-11-13 19:30-06', 60, 'America/Mexico_City')).toBe('2026-11-14 08:30') // sábado ya es hábil
      expect((await admin`select 1 from crm.audit_events where action = 'routing.hours_updated' and market_code = 'MX'`).length).toBeGreaterThan(0)
      await expect(setMarketHours(nora, { market: 'MX', days: [], opens: '08:00', closes: '20:00' })).rejects.toMatchObject({ code: 'invalid' })
      await expect(setMarketHours(nora, { market: 'MX', days: [1], opens: '18:00', closes: '09:00' })).rejects.toMatchObject({ code: 'invalid' })
    } finally {
      await setMarketHours(nora, { market: 'MX', days: [1, 2, 3, 4, 5], opens: '09:00', closes: '18:00' })
    }
  })

  it('un lead nuevo guarda su vencimiento con esa regla (la misma fecha que usa el cumplimiento)', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Horario ${tag()}`, contactName: 'Lola Ruiz', phone: mxPhone() })
    const row = await one(admin<{ ok: boolean }[]>`select sla_due_at = app.business_due('MX', created_at, 60) as ok from crm.leads where id = ${id}`)
    expect(row.ok).toBe(true)
  })
})

describe('6: un lead creado dentro de la tienda puede nacer contactado', () => {
  it('"Ya hablé con esta persona" registra el intento, deja el primer contacto a tiempo y no entra a Hoy con reloj', async () => {
    const sam = await ctxFor('sam.ortiz')
    const id = await createLead(sam, { market: 'US', motor: 'dealer', source: 'walk_in', businessName: `Walk In Mobile ${tag()}`, contactName: 'Dana Fox', phone: usPhone(), alreadyContacted: true })
    const lead = await one(admin`select status, source, first_touch_at is not null as touched, first_touch_at <= sla_due_at as on_time from crm.leads where id = ${id}`)
    expect(lead).toEqual({ status: 'contacted', source: 'walk_in', touched: true, on_time: true })
    const log = await admin`select kind, outcome from crm.activities where lead_id = ${id}`
    expect(log.map((a) => [a.kind, a.outcome])).toEqual([['call', 'reached']])
    expect((await getQueue(sam)).rows.some((r) => r.type === 'lead' && r.id === id)).toBe(false)
    expect((await admin`select action from crm.audit_events where object_id = ${id} order by at`).map((a) => a.action)).toEqual(['lead.created', 'lead.contacted'])
  })

  it('el origen del alta manual es uno de la lista', async () => {
    const sam = await ctxFor('sam.ortiz')
    await expect(createLead(sam, { market: 'US', motor: 'dealer', source: 'web_form' as never, businessName: `Bad Source ${tag()}`, contactName: 'Dana Fox', phone: usPhone() })).rejects.toBeTruthy()
  })
})

describe('7: lista de leads con búsqueda, filtros, orden y cierre en bloque', () => {
  it('busca por teléfono, filtra con reloj, sin reloj, por origen y sin dueño, y ordena por vencimiento', async () => {
    const sam = await ctxFor('sam.ortiz')
    const t = tag()
    const phone = usPhone()
    const a = await createLead(sam, { market: 'US', motor: 'dealer', source: 'referral', businessName: `Lista Uno ${t}`, contactName: 'Dana Fox', phone })
    const b = await createLead(sam, { market: 'US', motor: 'dealer', businessName: `Lista Dos ${t}`, contactName: 'Dana Fox', phone: usPhone() })
    await admin`update crm.leads set sla_due_at = null, source = 'import' where id = ${b}` // importado: sin reloj
    const ids = async (f: Parameters<typeof listLeads>[1]) => (await listLeads(sam, { q: t, ...f })).items.map((l) => l.id)
    expect((await listLeads(sam, { q: phone.replace(/\s/g, '').slice(-7) })).items.map((l) => l.id)).toEqual([a])
    expect(await ids({ clock: 'with' })).toEqual([a])
    expect(await ids({ clock: 'without' })).toEqual([b])
    expect(await ids({ source: 'referral' })).toEqual([a])
    expect(await ids({ sort: 'oldest' })).toEqual([a, b])
    expect(await ids({ sort: 'recent' })).toEqual([b, a])
    expect(await ids({ sort: 'due' })).toEqual([a]) // vence primero: solo los que tienen reloj corriendo
    await releaseLead(sam, a, 'No es de mi zona')
    expect(await ids({ owner: 'none' })).toEqual([a])
  })

  it('quien vende cierra en bloque solo los suyos; supervisión, los de su equipo; cada lead deja su evento', async () => {
    const sam = await ctxFor('sam.ortiz')
    const jade = await ctxFor('jade.kim')
    const kira = await ctxFor('kira.dunn')
    const mine = [1, 2, 3].map(() => createLead(sam, { market: 'US', motor: 'dealer', businessName: `Bloque ${tag()}`, contactName: 'Dana Fox', phone: usPhone() }))
    const ids = await Promise.all(mine)
    const hers = await createLead(jade, { market: 'US', motor: 'dealer', businessName: `Bloque Ajeno ${tag()}`, contactName: 'Dana Fox', phone: usPhone() })
    await expect(bulkDisqualify(sam, [...ids, hers], 'not_qualified')).rejects.toMatchObject({ code: 'not_found' })
    await expect(bulkDisqualify(sam, ids, 'no-existe')).rejects.toMatchObject({ code: 'invalid' })
    await expect(bulkDisqualify(sam, [], 'not_qualified')).rejects.toMatchObject({ code: 'invalid' })
    expect(await bulkDisqualify(sam, ids.slice(0, 2), 'not_qualified')).toBe(2)
    const rows = await admin`select status, disqualify_code, first_touch_at from crm.leads where id = any(${ids.slice(0, 2)}::uuid[])`
    expect(rows.every((r) => r.status === 'disqualified' && r.disqualify_code === 'not_qualified' && r.first_touch_at === null)).toBe(true)
    const events = await admin`select after from crm.audit_events where action = 'lead.disqualified' and object_id = any(${ids.slice(0, 2)}::uuid[])`
    expect(events.length).toBe(2)
    expect(events.every((e) => e.after.bulk === true)).toBe(true)
    // supervisión cierra lo de su equipo, de dos personas a la vez
    expect(await bulkDisqualify(kira, [ids[2]!, hers], 'no_response')).toBe(2)
    // Leadership (solo lectura) no cierra nada
    await expect(bulkDisqualify(await ctxFor('luis.tovar'), [ids[2]!], 'not_qualified')).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('8: búsqueda global, "existe y lo lleva X"', () => {
  it('quien vende ve que el comercio de otra persona existe y quién lo lleva, sin teléfono ni enlace; nunca cruza mercados', async () => {
    const jade = await ctxFor('jade.kim')
    const sam = await ctxFor('sam.ortiz')
    // un comercio propio de la prueba, con nombre único: no depende de lo que otras pruebas le hagan a los datos sembrados
    const target = await one(admin<{ id: string; name: string; phone: string; locality: string }[]>`
      insert into crm.accounts (market_code, kind, name, owner_id, phone, locality, country)
      values ('US', 'store', ${`Hidden Store Wireless ${tag()}`}, ${sam.user.id}, ${'+1702558' + Math.floor(1000 + Math.random() * 8999)}, 'Las Vegas', 'US')
      returning id, name, phone, locality`)
    const r = await searchAll(jade, target.name)
    expect(r.accounts.some((a) => a.id === target.id)).toBe(false)
    const hit = r.others.find((o) => o.name === target.name && o.owner_name === 'Sam Ortiz')
    expect(hit).toBeTruthy()
    expect(Object.keys(hit!).sort()).toEqual(['kind', 'locality', 'market_code', 'name', 'owner_name'])
    // por teléfono completo también; con cuatro dígitos no (no sirve para adivinar)
    expect((await searchAll(jade, target.phone)).others.some((o) => o.name === target.name)).toBe(true)
    expect((await searchAll(jade, target.phone.slice(-4))).others).toEqual([])
    // lo propio no se repite como "de otra persona"
    expect((await searchAll(sam, target.name)).others.some((o) => o.name === target.name)).toBe(false)
    // un comercio de México no aparece para quien vende en US, y al revés
    const mx = await one(admin<{ name: string }[]>`select name from crm.accounts where market_code = 'MX' and owner_id is not null and archived_at is null order by id limit 1`)
    expect((await searchAll(jade, mx.name)).others.filter((o) => o.market_code === 'MX')).toEqual([])
    expect((await searchAll(await ctxFor('marco.pena'), target.name)).others.filter((o) => o.market_code === 'US')).toEqual([])
    // operaciones no vende: la función no le dice nada (ya ve su mercado completo por su rol)
    expect((await searchAll(await ctxFor('tom.reyes'), target.name)).others).toEqual([])
  })

  it('un lead abierto de otra persona también aparece con su dueño', async () => {
    const sam = await ctxFor('sam.ortiz')
    const name = `Hidden Lead Wireless ${tag()}`
    await createLead(sam, { market: 'US', motor: 'dealer', businessName: name, contactName: 'Dana Fox', phone: usPhone() })
    const r = await searchAll(await ctxFor('jade.kim'), name)
    expect(r.leads).toEqual([])
    expect(r.others).toEqual([{ kind: 'lead', name, locality: null, owner_name: 'Sam Ortiz', market_code: 'US' }])
  })
})

describe('9 y 10: pasar un lead a un compañero y soltarlo', () => {
  it('quien vende pasa un lead suyo con nota: cambia de dueño, queda en la bitácora y el reloj vuelve a empezar si nadie lo había intentado', async () => {
    const sam = await ctxFor('sam.ortiz')
    const jade = await ctxFor('jade.kim')
    const id = await createLead(sam, { market: 'US', motor: 'dealer', businessName: `Pass Me Wireless ${tag()}`, contactName: 'Dana Fox', phone: usPhone() })
    await expect(passLead(sam, id, jade.user.id, ' ')).rejects.toMatchObject({ code: 'invalid' })
    await expect(passLead(sam, id, sam.user.id, 'Para mí mismo')).rejects.toMatchObject({ code: 'invalid' })
    await expect(passLead(sam, id, (await ctxFor('marco.pena')).user.id, 'Vende en otro mercado')).rejects.toMatchObject({ code: 'invalid' })
    await expect(passLead(sam, id, (await ctxFor('tom.reyes')).user.id, 'Operaciones no vende')).rejects.toMatchObject({ code: 'invalid' })
    await expect(passLead(jade, id, jade.user.id, 'No es mío')).rejects.toBeTruthy()
    await passLead(sam, id, jade.user.id, 'Está en Baltimore, es de tu zona')
    const lead = await one(admin`select owner_id, status, sla_due_at > now() as running from crm.leads where id = ${id}`)
    expect(lead).toEqual({ owner_id: jade.user.id, status: 'new', running: true })
    expect((await getQueue(jade)).rows.some((r) => r.type === 'lead' && r.id === id)).toBe(true)
    const ev = await one(admin`select actor_id, before, after from crm.audit_events where object_id = ${id} and action = 'lead.passed'`)
    expect(ev).toMatchObject({ actor_id: sam.user.id, before: { owner_id: sam.user.id }, after: { owner_id: jade.user.id, note: 'Está en Baltimore, es de tu zona' } })
    // quien lo pasó ya no lo ve; quien lo recibe ve la nota en el hilo
    expect(await getLead(sam, id)).toBeNull()
    expect((await getLead(jade, id))!.activities.map((a) => a.body)).toContain('Está en Baltimore, es de tu zona')
  })

  it('si ya hubo contacto el reloj no se reinicia: quien lo recibe lo ve en Hoy como tarea de hoy', async () => {
    const sam = await ctxFor('sam.ortiz')
    const jade = await ctxFor('jade.kim')
    const id = await createLead(sam, { market: 'US', motor: 'dealer', businessName: `Passed Warm Wireless ${tag()}`, contactName: 'Dana Fox', phone: usPhone(), alreadyContacted: true })
    const before = await one(admin`select sla_due_at, first_touch_at from crm.leads where id = ${id}`)
    await passLead(sam, id, jade.user.id, 'Ya hablé con la dueña, quiere visita')
    const after = await one(admin`select owner_id, sla_due_at, first_touch_at, status from crm.leads where id = ${id}`)
    expect(after).toMatchObject({ owner_id: jade.user.id, status: 'contacted', sla_due_at: before.sla_due_at, first_touch_at: before.first_touch_at })
    const task = (await getQueue(jade)).rows.find((r) => r.type === 'task' && r.leadId === id)
    expect(task).toMatchObject({ group: 'today' })
  })

  it('la base no deja entregar un lead ajeno ni a alguien que no vende en el mercado', async () => {
    const sam = await ctxFor('sam.ortiz')
    const jade = await ctxFor('jade.kim')
    const id = await createLead(sam, { market: 'US', motor: 'dealer', businessName: `Guarded Wireless ${tag()}`, contactName: 'Dana Fox', phone: usPhone() })
    const { withUser } = await import('@/server/db')
    const marcoId = (await ctxFor('marco.pena')).user.id
    await expect(withUser(jade.user.id, (tx) => tx`select app.hand_lead(${id}, ${jade.user.id})`)).rejects.toMatchObject({ code: '42501' })
    await expect(withUser(sam.user.id, (tx) => tx`select app.hand_lead(${id}, ${marcoId})`)).rejects.toMatchObject({ code: '42501' })
    await expect(withUser(sam.user.id, (tx) => tx`update crm.leads set owner_id = ${jade.user.id} where id = ${id}`)).rejects.toMatchObject({ code: '42501' })
  })

  it('soltar un lead lo deja sin dueño con motivo, y otra persona del mercado lo puede tomar', async () => {
    const sam = await ctxFor('sam.ortiz')
    const jade = await ctxFor('jade.kim')
    const id = await createLead(sam, { market: 'US', motor: 'dealer', businessName: `Released Wireless ${tag()}`, contactName: 'Dana Fox', phone: usPhone() })
    await expect(releaseLead(sam, id, '')).rejects.toMatchObject({ code: 'invalid' })
    await expect(releaseLead(jade, id, 'No es mío')).rejects.toBeTruthy()
    await releaseLead(sam, id, 'Salgo de vacaciones')
    expect((await one(admin`select owner_id from crm.leads where id = ${id}`)).owner_id).toBeNull()
    expect(await one(admin`select after from crm.audit_events where object_id = ${id} and action = 'lead.released'`)).toMatchObject({ after: { owner_id: null, reason: 'Salgo de vacaciones' } })
    await expect(releaseLead(sam, id, 'Otra vez')).rejects.toMatchObject({ code: 'invalid' })
    await takeLead(jade, id)
    expect((await one(admin`select owner_id from crm.leads where id = ${id}`)).owner_id).toBe(jade.user.id)
    // supervisión también puede soltar el lead de alguien de su equipo
    await releaseLead(await ctxFor('kira.dunn'), id, 'Jade está fuera esta semana')
    expect((await one(admin`select owner_id from crm.leads where id = ${id}`)).owner_id).toBeNull()
  })
})

describe('12: segunda solicitud web de la misma empresa', () => {
  it('mismo teléfono: no crea otro lead ni gasta un turno; suma a la persona y deja nota en el existente', async () => {
    const sys = await systemContext()
    const phone = mxPhone()
    const name = `Abarrotes Repetido ${tag()}`
    const first = await intakeFromForm(sys, 'tiendas-mx', { business_name: name, contact_name: 'Rosa Luna', phone }, `r1:${tag()}`)
    const cursor = (await one(admin`select r.cursor from crm.routing_rules r join crm.web_forms f on f.routing_rule_id = r.id where f.slug = 'tiendas-mx'`)).cursor
    const second = await intakeFromForm(sys, 'tiendas-mx', { business_name: name, contact_name: 'Pedro Luna', phone, message: 'Soy el hijo, también quiero información.' }, `r2:${tag()}`)
    expect(second).toEqual({ leadId: first.leadId, duplicate: false, merged: true })
    expect((await admin`select 1 from crm.leads where business_name = ${name}`).length).toBe(1)
    expect((await one(admin`select r.cursor from crm.routing_rules r join crm.web_forms f on f.routing_rule_id = r.id where f.slug = 'tiendas-mx'`)).cursor).toBe(cursor)
    const lead = await one(admin`select extra_contacts from crm.leads where id = ${first.leadId}`)
    expect(lead.extra_contacts.map((c: { name: string }) => c.name)).toEqual(['Pedro Luna'])
    const note = await one(admin`select subject, body from crm.activities where lead_id = ${first.leadId} and kind = 'note'`)
    expect(note.subject).toBe('Segunda solicitud web de la misma empresa')
    expect(note.body).toContain('Pedro Luna')
    expect((await admin`select 1 from crm.audit_events where object_id = ${first.leadId} and action = 'lead.repeat_request'`).length).toBe(1)
  })

  it('mismo correo sobre un lead ya convertido: la persona entra como contacto del comercio y la nota queda en su hilo', async () => {
    const sys = await systemContext()
    const email = `compras.${tag()}@cadena-prueba.test`
    const name = `Cadena Repetida ${tag()}`
    const first = await intakeFromForm(sys, 'contacto-mx', { business_name: name, contact_name: 'Ana Web', email }, `r3:${tag()}`)
    const owner = (await one(admin<{ owner_id: string }[]>`select owner_id from crm.leads where id = ${first.leadId}`)).owner_id
    const { loadCtx } = await import('@/server/context')
    const rep = (await loadCtx(owner, 'es'))!
    await qualifyLead(rep, first.leadId)
    const out = await convertLead(rep, first.leadId)
    const second = await intakeFromForm(sys, 'contacto-mx', { business_name: name, contact_name: 'Beto Compras', email }, `r4:${tag()}`)
    expect(second).toMatchObject({ leadId: first.leadId, merged: true })
    const contacts = await admin`select c.full_name, ac.role from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id where ac.account_id = ${out.accountId} order by ac.valid_from, c.full_name`
    expect(contacts.map((c) => c.full_name).sort()).toEqual(['Ana Web', 'Beto Compras'])
    expect((await admin`select 1 from crm.activities where account_id = ${out.accountId} and deal_id = ${out.dealId} and subject = 'Segunda solicitud web de la misma empresa'`).length).toBe(1)
  })

  it('si el lead anterior se descartó, la empresa entra como lead nuevo', async () => {
    const sys = await systemContext()
    const phone = mxPhone()
    const first = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Abarrotes Vuelve ${tag()}`, contact_name: 'Rosa Luna', phone }, `r5:${tag()}`)
    await admin`update crm.leads set status = 'disqualified', disqualify_code = 'no_response' where id = ${first.leadId}`
    const second = await intakeFromForm(sys, 'tiendas-mx', { business_name: `Abarrotes Vuelve ${tag()}`, contact_name: 'Rosa Luna', phone }, `r6:${tag()}`)
    expect(second.merged).toBeUndefined()
    expect(second.leadId).not.toBe(first.leadId)
  })
})
