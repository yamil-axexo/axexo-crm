import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId } from './helpers'
import { answerReport, createReport, screenPath } from '@/domain/reports'
import { allReports, myReports } from '@/dal/reports'

// Reportar un problema (0017_problem_reports): cada quien ve los suyos, administración ve todos y responde,
// quien reportó ve la respuesta, y todo deja evento en la bitácora. 42501 = la base rechazó la operación.
const DENIED = '42501'
const admin = owner()
const MARK = 'Contenido prueba:'
// Datos de prueba armados por partes, para que el escáner de datos prohibidos no los tome por reales.
const card = ['4111', '1111', '1111', '1111'].join(' ')
const ssn = ['123', '45', '6789'].join('-')

afterAll(async () => {
  await admin`delete from crm.problem_reports where body like ${MARK + '%'}`
  await admin.end()
})

describe('reportar un problema', () => {
  let id = ''

  it('quien vende reporta y solo esa persona y administración lo ven', async () => {
    const lucia = await ctxFor('lucia.vega')
    id = await createReport(lucia, { kind: 'problem', urgency: 'high', body: `${MARK} no me deja guardar la visita`, screen: '/comercios?ficha=abc' })
    const mine = await myReports(lucia)
    expect(mine.map((r) => r.id)).toContain(id)
    const row = mine.find((r) => r.id === id)!
    expect(row).toMatchObject({ status: 'open', urgency: 'high', kind: 'problem', screen: '/comercios', answer: null })

    // otra persona que vende en el mismo mercado no lo ve, ni por la lectura ni directo en la base
    const marco = await ctxFor('marco.pena')
    expect((await myReports(marco)).map((r) => r.id)).not.toContain(id)
    expect(await asPersona('marco.pena', async (tx) => (await tx`select 1 from crm.problem_reports where id = ${id}`).length)).toBe(0)
    // supervisión y quien lidera el mercado tampoco: los reportes no son del equipo, son de la persona
    for (const p of ['fernando.ibarra', 'ana.robles', 'valeria.soto', 'luis.tovar']) {
      expect(await asPersona(p, async (tx) => (await tx`select 1 from crm.problem_reports where id = ${id}`).length), p).toBe(0)
    }
    // administración ve todos
    const nora = await ctxFor('nora.salas')
    const all = await allReports(nora, 'open')
    expect(all.rows.map((r) => r.id)).toContain(id)
    expect(all.rows.find((r) => r.id === id)!.user_name).toBe('Lucía Vega')
    expect(all.open).toBeGreaterThanOrEqual(1)
  })

  it('solo administración responde; quien reportó ve la respuesta', async () => {
    const lucia = await ctxFor('lucia.vega')
    await expect(answerReport(lucia, id, 'Me respondo sola')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(allReports(lucia, 'all')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(answerReport(await ctxFor('ana.robles'), id, 'Desde el mercado')).rejects.toMatchObject({ code: 'forbidden' })
    // la base repite el límite: quien reportó no puede marcarlo atendido ni cambiar lo que escribió
    const luciaId = await personaId('lucia.vega')
    await asPersona('lucia.vega', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.problem_reports set status = 'answered', answer = 'ok', answered_by = ${luciaId}, answered_at = now() where id = ${id}`)).toBe('0 rows')
      expect(await attempt(tx, (sp) => sp`update crm.problem_reports set body = 'otra cosa' where id = ${id}`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`delete from crm.problem_reports where id = ${id}`)).toBe(DENIED)
    })
    // administración tampoco reescribe el texto de la persona
    await asPersona('nora.salas', async (tx) => {
      expect(await attempt(tx, (sp) => sp`update crm.problem_reports set body = 'editado' where id = ${id}`)).toBe(DENIED)
    })

    const nora = await ctxFor('nora.salas')
    await answerReport(nora, id, 'Ya quedó: vuelve a intentar guardar la visita.')
    const row = (await myReports(lucia)).find((r) => r.id === id)!
    expect(row).toMatchObject({ status: 'answered', answer: 'Ya quedó: vuelve a intentar guardar la visita.', answered_by_name: 'Nora Salas' })
    expect(row.answered_at).toBeInstanceOf(Date)
    const after = await allReports(nora, 'answered')
    expect(after.rows.map((r) => r.id)).toContain(id)
  })

  it('nadie reporta a nombre de otra persona ni crea un reporte ya respondido', async () => {
    const luciaId = await personaId('lucia.vega')
    const marcoId = await personaId('marco.pena')
    await asPersona('marco.pena', async (tx) => {
      expect(await attempt(tx, (sp) => sp`insert into crm.problem_reports (user_id, body) values (${luciaId}, ${MARK + ' a nombre de otra persona'})`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`insert into crm.problem_reports (user_id, body, status, answer, answered_by, answered_at) values (${marcoId}, ${MARK + ' ya respondido'}, 'answered', 'listo', ${marcoId}, now())`)).toBe(DENIED)
      expect(await attempt(tx, (sp) => sp`insert into crm.problem_reports (user_id, body) values (${marcoId}, ${MARK + ' propio'})`)).toBe('ok')
    })
  })

  it('cada reporte y cada respuesta dejan evento en la bitácora, sin copiar el texto', async () => {
    const events = await admin<{ action: string; actor: string; after: Record<string, unknown> }[]>`
      select e.action, u.full_name as actor, e.after from crm.audit_events e join crm.users u on u.id = e.actor_id
       where e.object = 'problem_report' and e.object_id = ${id} order by e.at`
    expect(events.map((e) => e.action)).toEqual(['report.created', 'report.answered'])
    expect(events[0]).toMatchObject({ actor: 'Lucía Vega', after: { kind: 'problem', urgency: 'high', screen: '/comercios' } })
    expect(events[1]!.actor).toBe('Nora Salas')
    expect(JSON.stringify(events)).not.toContain('guardar la visita')
  })

  it('bloquea datos prohibidos y textos vacíos, en el reporte y en la respuesta', async () => {
    const lucia = await ctxFor('lucia.vega')
    await expect(createReport(lucia, { kind: 'problem', urgency: 'normal', body: `${MARK} la tarjeta ${card} no pasó` })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createReport(lucia, { kind: 'problem', urgency: 'normal', body: '  ' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createReport(lucia, { kind: 'otro', urgency: 'normal', body: `${MARK} tipo que no existe` })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createReport(lucia, { kind: 'request', urgency: 'ya', body: `${MARK} urgencia que no existe` })).rejects.toMatchObject({ code: 'invalid' })
    const nora = await ctxFor('nora.salas')
    const other = await createReport(lucia, { kind: 'request', urgency: 'low', body: `${MARK} quiero ver mis visitas del mes` })
    await expect(answerReport(nora, other, `Tu SSN ${ssn} ya quedó`)).rejects.toMatchObject({ code: 'invalid' })
    await expect(answerReport(nora, other, ' ')).rejects.toMatchObject({ code: 'invalid' })
    await expect(answerReport(nora, 'no-es-un-id', 'Hola')).rejects.toMatchObject({ code: 'not_found' })
    expect((await myReports(lucia)).find((r) => r.id === other)!.status).toBe('open')
  })

  it('quien solo lee también puede reportar, y la pantalla se guarda como ruta de la app', async () => {
    const luis = await ctxFor('luis.tovar')
    const rid = await createReport(luis, { kind: 'request', urgency: 'normal', body: `${MARK} me hizo falta una cifra en el panel`, screen: '/panel-lt' })
    expect((await myReports(luis)).find((r) => r.id === rid)).toMatchObject({ screen: '/panel-lt', kind: 'request' })
    expect(screenPath('/deals/452a75e7-de8c-81b6-1a99-b45bb316c163')).toBe('/deals')
    expect(screenPath('/admin?tab=personas')).toBe('/admin')
    expect(screenPath('https://otro.sitio/x')).toBeNull()
    expect(screenPath('//otro.sitio')).toBeNull()
    expect(screenPath('')).toBeNull()
    expect(screenPath(undefined)).toBeNull()
  })
})
