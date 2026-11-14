import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId, systemContext } from './helpers'
import { withUser } from '@/server/db'
import { notify, notifyOutside, BURST_LIMIT, sendDigests, releaseHeld } from '@/domain/notify'
import { markAllNoticesSeen, saveComms, savePrefs, saveTemplate } from '@/domain/notices'
import { myCenter, myPrefs, outsideQueue, templates, unreadNotices } from '@/dal/notices'
import { myNotices } from '@/dal/ops'
import { createAccount } from '@/domain/accounts'
import { addActivity } from '@/domain/activities'
import { intakeFromForm } from '@/domain/leads'
import { leadGoalMissed, avisosJobs } from '@/server/jobs/avisos'
import { JOBS } from '@/server/jobs/registry'
import { simulatedSends } from '@/server/adapters/channel'
import { channelStatus } from '@/server/adapters/channels'
import { wants, renderTemplate, unknownVars } from '@/lib/notice-kinds'

const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8)

/** El mercado abre todos los días a toda hora: las pruebas no dependen de la hora en que corren. */
const alwaysOpen = () => admin`update crm.market_hours set days = '{1,2,3,4,5,6,7}', opens = '00:00', closes = '23:59:59'`
const closedNow = () => admin`update crm.market_hours set days = array[(extract(isodow from now() at time zone 'UTC')::int % 7) + 1], opens = '00:00', closes = '00:01'`

describe('AUT-05: un solo servicio de avisos', () => {
  it('avisa dentro de CONTIGO, deja el correo en la cola con el canal apagado y no manda nada', async () => {
    await alwaysOpen()
    const jade = await ctxFor('jade.kim')
    const tom = await ctxFor('tom.reyes')
    const before = await unreadNotices(tom)
    const title = `Prueba de servicio ${tag()}`
    const out = await withUser(jade.user.id, (tx) => notify(tx, jade, { to: tom.user.id, kind: 'handoff', market: 'US', title: [title, title], body: ['Texto', 'Text'], link: '/operaciones' }))
    expect(out.noticeId).toBeTruthy()
    expect(out.channels).toMatchObject({ in_app: 'delivered', email: 'queued_off' })
    expect(out.channels.slack).toBeUndefined() // Slack no viene encendido para este tipo
    expect(await unreadNotices(tom)).toBe(before + 1)
    const mine = (await myCenter(tom, 'unread')).find((n) => n.title === title)
    expect(mine).toMatchObject({ kind: 'handoff', link: '/operaciones', from_name: 'Jade Kim', body: 'Text' }) // Tom lee en inglés
    // No pide acción: está en la campana, no en Hoy.
    expect((await myNotices(tom)).some((n) => n.id === mine!.id)).toBe(false)
    const rows = await admin<{ channel: string; status: string; cost: string | null; recipient_address: string | null; template_key: string | null }[]>`
      select channel, status, cost::text, recipient_address, template_key from crm.notifications where notice_id = ${out.noticeId} order by channel`
    expect(rows).toEqual([
      { channel: 'email', status: 'queued_off', cost: null, recipient_address: 'tom.reyes@contigo.test', template_key: 'notice' },
      { channel: 'in_app', status: 'delivered', cost: '0.0000', recipient_address: null, template_key: null },
    ])
    expect(simulatedSends()).toHaveLength(0)
  })

  it('los tres canales de afuera están apagados y dicen qué falta; en pruebas se pueden simular', async () => {
    expect(channelStatus().map((c) => [c.channel, c.mode])).toEqual([['email', 'off'], ['slack', 'off'], ['whatsapp', 'off']])
    for (const c of channelStatus()) expect(c.needs[0].length).toBeGreaterThan(20)
    await alwaysOpen()
    const nora = await ctxFor('nora.salas')
    await saveComms(nora, { market: 'US', orderHeader: '', ordersMailbox: '', senderAddress: '', walkthroughUrl: '', supportWhatsapp: '', emailUnitCost: '0.0125', supportHoursHigh: '', supportHoursNormal: '', supportHoursLow: '' })
    process.env.EMAIL_ADAPTER = 'simulated'
    try {
      const jade = await ctxFor('jade.kim')
      const title = `Simulado ${tag()}`
      const out = await withUser(jade.user.id, (tx) => notify(tx, jade, { to: nora.user.id, kind: 'handoff', market: 'US', title: [title, title], body: ['Texto', 'Text'] }))
      expect(out.channels.email).toBe('simulated')
      expect(simulatedSends().at(-1)).toMatchObject({ channel: 'email', to: 'nora.salas@contigo.test', subject: title })
      // El costo por mensaje queda anotado cuando el mensaje sale.
      expect(await one(admin<{ cost: string; cost_currency: string }[]>`select cost::text, cost_currency from crm.notifications where notice_id = ${out.noticeId} and channel = 'email'`)).toEqual({ cost: '0.0125', cost_currency: 'USD' })
    } finally {
      delete process.env.EMAIL_ADAPTER
    }
    // Fuera de pruebas la variable no enciende nada.
    process.env.EMAIL_ADAPTER = 'simulated'; const env = process.env.APP_ENV; process.env.APP_ENV = 'staging'
    try { expect(channelStatus()[0]!.mode).toBe('off') } finally { process.env.APP_ENV = env; delete process.env.EMAIL_ADAPTER }
  })

  it('preferencias: la persona apaga un tipo o un canal, pide resumen, y lo obligatorio no se apaga', async () => {
    await alwaysOpen()
    const tom = await ctxFor('tom.reyes')
    const jade = await ctxFor('jade.kim')
    expect(wants({}, 'announcement', 'in_app')).toBe(true)
    expect(wants({ announcement: { in_app: false } }, 'announcement', 'in_app')).toBe(true)
    await savePrefs(tom, { dailyDigest: false, on: ['handoff:slack', 'lead_arrived:in_app'] })
    expect((await myPrefs(tom)).prefs.handoff).toMatchObject({ in_app: false, email: false, slack: true })
    expect((await myPrefs(tom)).prefs.mention?.in_app).toBe(true) // una mención no se apaga dentro de CONTIGO
    const out = await withUser(jade.user.id, (tx) => notify(tx, jade, { to: tom.user.id, kind: 'handoff', market: 'US', title: ['a b c', 'a b c'], body: ['x', 'x'] }))
    expect(out).toMatchObject({ noticeId: null, channels: { slack: 'queued_off' } })
    expect(out.channels.email).toBeUndefined()
    // WhatsApp: CONTIGO no guarda el teléfono de las personas, así que no hay a dónde mandarlo.
    await savePrefs(tom, { dailyDigest: true, on: ['handoff:email', 'handoff:whatsapp', 'returned:email'] })
    const d = await withUser(jade.user.id, (tx) => notify(tx, jade, { to: tom.user.id, kind: 'handoff', market: 'US', title: ['a b c', 'a b c'], body: ['x', 'x'] }))
    expect(d.channels).toMatchObject({ email: 'held_digest', whatsapp: 'skipped_no_address' })
    // Lo urgente no espera al resumen.
    const u = await withUser(jade.user.id, (tx) => notify(tx, jade, { to: tom.user.id, kind: 'returned', market: 'US', title: ['a b c', 'a b c'], body: ['x', 'x'] }))
    expect(u.channels.email).toBe('queued_off')
    // El resumen junta lo que esperaba en un solo mensaje.
    const sys = await systemContext()
    expect(await withUser(sys.user.id, (tx) => sendDigests(tx, sys.user.id))).toBe(1)
    const digest = await one(admin<{ subject: string; body: string; status: string }[]>`select subject, body, status from crm.notifications where kind = 'digest' and recipient_user_id = ${tom.user.id}`)
    expect(digest).toMatchObject({ status: 'queued_off', subject: 'Your CONTIGO summary: 1 notice' })
    expect(await one(admin<{ n: number }[]>`select count(*)::int as n from crm.notifications where recipient_user_id = ${tom.user.id} and status = 'held_digest'`)).toEqual({ n: 0 })
    await admin`delete from crm.notification_prefs`
  })

  it('fuera del horario hábil el mensaje espera; muchos seguidos se juntan en un resumen', async () => {
    const jade = await ctxFor('jade.kim')
    const kira = await ctxFor('kira.dunn')
    const sys = await systemContext()
    await closedNow()
    const held = await withUser(jade.user.id, (tx) => notify(tx, jade, { to: kira.user.id, kind: 'handoff', market: 'US', title: ['fuera de hora', 'after hours'], body: ['x', 'x'] }))
    expect(held.channels).toMatchObject({ in_app: 'delivered', email: 'held_hours' }) // dentro de CONTIGO sale siempre
    expect((await one(admin<{ release_at: Date | null }[]>`select release_at from crm.notifications where notice_id = ${held.noticeId} and channel = 'email'`)).release_at).toBeInstanceOf(Date)
    expect(await withUser(sys.user.id, (tx) => releaseHeld(tx))).toBe(0) // sigue cerrado
    await alwaysOpen()
    await admin`update crm.notifications set release_at = now() - interval '1 minute' where status = 'held_hours'`
    expect(await withUser(sys.user.id, (tx) => releaseHeld(tx))).toBeGreaterThanOrEqual(1)
    expect((await one(admin<{ status: string }[]>`select status from crm.notifications where notice_id = ${held.noticeId} and channel = 'email'`)).status).toBe('queued_off')
    let last = ''
    for (let i = 0; i <= BURST_LIMIT; i++) last = (await withUser(jade.user.id, (tx) => notify(tx, jade, { to: kira.user.id, kind: 'handoff', market: 'US', title: [`n ${i} x`, `n ${i} x`], body: ['x', 'x'] }))).channels.email!
    expect(last).toBe('held_digest')
  })

  it('RLS: cada quien ve sus avisos y lo que salió para él; la cola completa es de administración', async () => {
    const tomId = await personaId('tom.reyes')
    await asPersona('sam.ortiz', async (tx) => {
      expect(await tx`select 1 from crm.notices where user_id = ${tomId}`).toHaveLength(0)
      expect(await tx`select 1 from crm.notifications where recipient_user_id = ${tomId}`).toHaveLength(0)
      expect(await attempt(tx, (sp) => sp`update crm.notifications set status = 'delivered'`)).toBe('0 rows')
      expect(await attempt(tx, (sp) => sp`insert into crm.message_templates (key, version, recipient, trigger_event, subject_es, body_es, subject_en, body_en) values ('notice', 99, 'person', 'notice', 'aa', 'aa', 'aa', 'aa')`)).toBe('42501')
      expect(await attempt(tx, (sp) => sp`update crm.market_comms set orders_mailbox = 'x@y.zz'`)).toBe('0 rows')
      expect(await attempt(tx, (sp) => sp`insert into crm.notification_prefs (user_id) values (${tomId})`)).toBe('42501')
    })
    await expect(outsideQueue(await ctxFor('sam.ortiz'), null)).rejects.toMatchObject({ code: 'forbidden' })
    const q = await outsideQueue(await ctxFor('nora.salas'), 'email')
    expect(q.rows.length).toBeGreaterThan(0)
    expect(q.rows.every((r) => r.channel === 'email')).toBe(true)
    for (const t of ['notification_prefs', 'market_comms', 'message_templates', 'notifications', 'announcements', 'announcement_receipts', 'order_dispatches', 'training_sessions', 'help_lessons'])
      expect(await one(admin<{ f: boolean }[]>`select relforcerowsecurity as f from pg_class where oid = ${'crm.' + t}::regclass`)).toEqual({ f: true })
  })

  it('lo que ya avisaba sigue avisando, ahora por el servicio: mención desde una nota y marcar todo como leído', async () => {
    const jade = await ctxFor('jade.kim')
    const tom = await ctxFor('tom.reyes')
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Avisos prueba ${tag()}`, segment: 'dealer', force: true })
    // Cuenta nueva (E13.F2): Operaciones se entera, sin que le aparezca en Hoy.
    const created = (await myCenter(tom, 'unread')).find((n) => n.account_id === acc.id)
    expect(created).toMatchObject({ kind: 'lifecycle' })
    const subject = `Revisar permiso ${tag()}`
    await addActivity(jade, { accountId: acc.id!, kind: 'note', subject, notify: tom.user.id })
    const hoy = (await myNotices(tom)).filter((n) => n.account_id === acc.id)
    expect(hoy).toHaveLength(1)
    expect(hoy[0]!.body).toContain(subject)
    expect(await one(admin<{ n: number }[]>`select count(*)::int as n from crm.notifications where notice_id = ${hoy[0]!.id} and channel = 'in_app' and status = 'delivered'`)).toEqual({ n: 1 })
    expect(await markAllNoticesSeen(tom)).toBeGreaterThanOrEqual(2)
    expect(await unreadNotices(tom)).toBe(0)
    expect((await myCenter(tom, 'all')).length).toBeGreaterThanOrEqual(2)
  })
})

describe('plantillas, leads y metas (E13.F3, E15.F8, E15.F9)', () => {
  it('plantillas: versión nueva al guardar, variables conocidas, solo administración', async () => {
    const nora = await ctxFor('nora.salas')
    const list = await templates(nora)
    expect(list.map((t) => t.key)).toEqual(expect.arrayContaining(['lead_welcome', 'lead_web_ack', 'ops_handoff', 'order_to_ops', 'account_new', 'dealer_active', 'owner_changed', 'approval_visit', 'dealer_closed', 'dealer_churned']))
    // El texto de la bienvenida no se inventa: queda pendiente hasta que alguien lo ponga.
    expect(list.find((t) => t.key === 'lead_welcome')).toMatchObject({ market_code: 'MX', body_es: '[pendiente: quien administra CONTIGO]' })
    const base = { key: 'lead_web_ack', market: '', active: true, needsConsent: true, subjectEs: 'Recibimos tu solicitud', bodyEs: 'Hola, {{contacto}}. Gracias.', subjectEn: 'We received your request', bodyEn: 'Hello {{contacto}}. Thanks.' }
    expect(await saveTemplate(nora, base)).toBe(2)
    expect((await templates(nora)).find((t) => t.key === 'lead_web_ack')).toMatchObject({ version: 2, versions: 2, by_name: 'Nora Salas' })
    await expect(saveTemplate(nora, { ...base, bodyEs: 'Hola {{nombre_raro}}' })).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('nombre_raro') })
    await expect(saveTemplate(await ctxFor('robert.hale'), base)).rejects.toMatchObject({ code: 'forbidden' })
    expect(renderTemplate('Hola, {{contacto}} de {{ comercio }}', { contacto: 'Ana', comercio: 'Tienda Uno' })).toBe('Hola, Ana de Tienda Uno')
    expect(unknownVars('{{a}} {{comercio}}')).toEqual(['a'])
  })

  it('lead web: aviso a quien le toca, acuse en la cola solo con consentimiento, bienvenida de México pendiente de texto', async () => {
    await alwaysOpen()
    const sys = await systemContext()
    const us = await one(admin<{ slug: string }[]>`select slug from crm.web_forms where market_code = 'US' and is_active limit 1`)
    const mx = await one(admin<{ slug: string }[]>`select slug from crm.web_forms where market_code = 'MX' and is_active limit 1`)
    const t = tag()
    const a = await intakeFromForm(sys, us.slug, { business_name: `Acuse ${t}`, contact_name: 'Persona Uno', email: `uno-${t}@ejemplo.test`, consent: true }, `k-${t}-1`)
    const b = await intakeFromForm(sys, us.slug, { business_name: `Sin permiso ${t}`, contact_name: 'Persona Dos', email: `dos-${t}@ejemplo.test` }, `k-${t}-2`)
    const c = await intakeFromForm(sys, mx.slug, { business_name: `Bienvenida ${t}`, contact_name: 'Persona Tres', email: `tres-${t}@ejemplo.test`, consent: true }, `k-${t}-3`)
    const row = (id: string) => one(admin<{ template_key: string; status: string; recipient_kind: string; recipient_address: string; body: string }[]>`
      select template_key, status, recipient_kind, recipient_address, body from crm.notifications where lead_id = ${id} and recipient_kind = 'lead'`)
    expect(await row(a.leadId)).toMatchObject({ template_key: 'lead_web_ack', status: 'queued_off', recipient_address: `uno-${t}@ejemplo.test` })
    expect((await row(a.leadId)).body).toContain('Persona Uno')
    expect(await row(b.leadId)).toMatchObject({ template_key: 'lead_web_ack', status: 'skipped_consent' })
    expect(await row(c.leadId)).toMatchObject({ template_key: 'lead_welcome', status: 'blocked_template' })
    // E15.F9: a quien le tocó por turno le llega el aviso con enlace al lead.
    const lead = await one(admin<{ owner_id: string | null }[]>`select owner_id from crm.leads where id = ${a.leadId}`)
    if (lead.owner_id) {
      const n = await one(admin<{ kind: string; link: string; needs_action: boolean }[]>`select kind, link, needs_action from crm.notices where lead_id = ${a.leadId} and user_id = ${lead.owner_id}`)
      expect(n).toEqual({ kind: 'lead_arrived', link: `/leads/${a.leadId}`, needs_action: false })
    }
    expect(simulatedSends().filter((s) => s.to.includes(t))).toHaveLength(0)
  })

  it('meta vencida: la tarea programada avisa una sola vez a quien lleva el lead', async () => {
    await alwaysOpen()
    const sys = await systemContext()
    const us = await one(admin<{ slug: string }[]>`select slug from crm.web_forms where market_code = 'US' and is_active limit 1`)
    const t = tag()
    const l = await intakeFromForm(sys, us.slug, { business_name: `Meta ${t}`, contact_name: 'Persona Meta', phone: '+13055550142' }, `k-${t}-m`)
    const sam = await personaId('sam.ortiz')
    await admin`update crm.leads set owner_id = ${sam}, sla_due_at = now() - interval '5 minutes' where id = ${l.leadId}`
    const first = await withUser(sys.user.id, (tx) => leadGoalMissed(tx))
    expect(first.done).toBeGreaterThanOrEqual(1)
    const n = await admin<{ kind: string; title: string }[]>`select kind, title from crm.notices where lead_id = ${l.leadId} and kind = 'lead_goal_missed' and user_id = ${sam}`
    expect(n).toHaveLength(1)
    expect(n[0]!.title).toContain(`Meta ${t}`)
    await withUser(sys.user.id, (tx) => leadGoalMissed(tx))
    expect(await admin`select 1 from crm.notices where lead_id = ${l.leadId} and kind = 'lead_goal_missed'`).toHaveLength(1)
    // Las tareas están en el registro único, con su descripción en los dos idiomas.
    expect(JOBS.filter((j) => j.key.startsWith('avisos.')).map((j) => j.key)).toEqual(avisosJobs.map((j) => j.key))
    for (const j of avisosJobs) expect(j.description.es && j.description.en && j.everyMinutes > 0).toBeTruthy()
  })

  it('mensaje a un buzón sin dirección configurada: queda dicho y no sale', async () => {
    await alwaysOpen()
    const jade = await ctxFor('jade.kim')
    const status = await withUser(jade.user.id, (tx) => notifyOutside(tx, jade, { kind: 'order_sent', template: 'order_to_ops', market: 'US', recipient: 'mailbox', address: null, locale: 'en', vars: { comercio: 'Tienda' } }))
    expect(status).toBe('skipped_no_address')
  })
})
