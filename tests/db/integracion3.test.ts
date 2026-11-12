import { afterAll, describe, expect, it } from 'vitest'
import { ctxFor, owner } from './helpers'
import { createAccount } from '@/domain/accounts'
import { createDeal } from '@/domain/deals'
import { recordActivity } from '@/domain/activities'
import { completeItem } from '@/domain/queue'
import { NEXT_SETS } from '@/domain/followup'
import { addDays, isoDay } from '@/lib/format'

// Integración final (olas 1 a 3): la lista de próximos pasos por rol y por tipo de venta no la impone solo la hoja.
// El dominio valida la misma lista al guardar, venga de la hoja "Completar" o de "Registrar actividad".
// Cada prueba crea sus propios comercios y negocios, con nombre único, y no depende de lo que dejó otro archivo.
const admin = owner()
afterAll(() => admin.end())
const tag = () => Math.random().toString(36).slice(2, 8)
const tomorrow = addDays(isoDay(new Date(), 'America/Mexico_City'), 1)
const openSteps = async (accountId: string) => (await admin<{ subject: string }[]>`select subject from crm.activities where account_id = ${accountId} and done_at is null and kind in ('task', 'visit')`).map((r) => r.subject)

describe('próximo paso: el dominio valida la lista de quien lo deja y del tipo de venta', () => {
  it('quien vende a tiendas no deja un paso de Operaciones ni uno de cadenas; sí una visita', async () => {
    const marco = await ctxFor('marco.pena')
    const acc = await createAccount(marco, { market: 'MX', kind: 'store', name: `Lista tiendas ${tag()}`, segment: 'd2d', force: true })
    const call = (next: string) => recordActivity(marco, { accountId: acc.id!, kind: 'call', outcome: 'reached', askNext: true, next, nextWhen: tomorrow })
    for (const next of ['docs', 'provider', 'training', 'contract', 'kickoff', 'testing', 'certification']) {
      expect(NEXT_SETS.default).not.toContain(next)
      await expect(call(next), next).rejects.toMatchObject({ code: 'invalid' })
    }
    // nada quedó a medias: ni la llamada ni un próximo paso
    expect(await openSteps(acc.id!)).toEqual([])
    expect((await admin`select 1 from crm.activities where account_id = ${acc.id!} and kind = 'call'`).length).toBe(0)
    const ok = await recordActivity(marco, { accountId: acc.id!, kind: 'call', outcome: 'reached', askNext: true, next: 'visit', nextWhen: tomorrow })
    expect(ok.next).toBeTruthy()
    expect((await openSteps(acc.id!)).length).toBe(1)
  })

  it('quien vende a cadenas no deja una visita de campo ni un paso de Operaciones; sí el envío de contrato', async () => {
    const diana = await ctxFor('diana.cruz')
    const acc = await createAccount(diana, { market: 'MX', kind: 'chain', name: `Lista cadenas ${tag()}`, segment: 'b2b', force: true })
    const call = (next: string) => recordActivity(diana, { accountId: acc.id!, kind: 'call', outcome: 'reached', askNext: true, next, nextWhen: tomorrow })
    for (const next of ['visit', 'docs', 'provider', 'training']) await expect(call(next), next).rejects.toMatchObject({ code: 'invalid' })
    await call('contract')
    expect((await openSteps(acc.id!)).length).toBe(1)
  })

  it('Operaciones deja documentos, proveedor o capacitación, no una llamada de ventas, aunque el negocio sea de cadenas', async () => {
    const diana = await ctxFor('diana.cruz')
    const valeria = await ctxFor('valeria.soto')
    const acc = await createAccount(diana, { market: 'MX', kind: 'chain', name: `Lista operaciones ${tag()}`, segment: 'b2b', force: true })
    const note = (next: string) => recordActivity(valeria, { accountId: acc.id!, kind: 'call', outcome: 'reached', askNext: true, next, nextWhen: tomorrow })
    for (const next of ['call', 'visit', 'proposal', 'meeting', 'contract']) await expect(note(next), next).rejects.toMatchObject({ code: 'invalid' })
    await note('docs')
    expect((await openSteps(acc.id!)).length).toBe(1)
  })

  it('al completar una tarea vale la misma lista, y un paso fuera de ella no completa nada', async () => {
    const marco = await ctxFor('marco.pena')
    const acc = await createAccount(marco, { market: 'MX', kind: 'store', name: `Lista completar ${tag()}`, segment: 'd2d', force: true })
    const pipe = (await admin<{ id: string }[]>`select md5('contigo:p-mx-d2d')::uuid as id`)[0]!.id
    const deal = await createDeal(marco, { accountId: acc.id!, pipelineId: pipe, title: `Lista completar ${tag()}`, nextStep: 'Llamar para confirmar', nextStepDue: tomorrow })
    const task = (await admin<{ id: string }[]>`select id from crm.activities where deal_id = ${deal} and done_at is null and kind = 'task'`)[0]!
    await expect(completeItem(marco, { type: 'task', id: task.id, result: 'done', next: 'training', when: tomorrow })).rejects.toMatchObject({ code: 'invalid' })
    // la tarea sigue abierta: el rechazo deshace todo
    expect((await admin`select 1 from crm.activities where id = ${task.id} and done_at is null`).length).toBe(1)
    // "Otra tarea" está en las tres listas
    const done = await completeItem(marco, { type: 'task', id: task.id, result: 'done', next: 'task', when: tomorrow, nextText: 'Llevar el contrato firmado' })
    expect(done.next).toBe('Llevar el contrato firmado')
  })
})
