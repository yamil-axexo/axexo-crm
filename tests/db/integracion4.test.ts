import { afterAll, describe, expect, it } from 'vitest'
import { ctxFor, owner } from './helpers'
import { fillEnrollment } from '../support/us-enrollment'
import { convertLead, createLead, qualifyLead } from '@/domain/leads'
import { createAccount } from '@/domain/accounts'
import { takeAccount } from '@/domain/reparto'
import { getAccount } from '@/dal/accounts'
import { createDeal, moveDeal, updateDeal } from '@/domain/deals'
import { takeDeal } from '@/domain/ops'
import { updateCustom } from '@/domain/custom'
import { getQueue } from '@/dal/queue'
import { getDeal } from '@/dal/pipelines'
import { loadCtx } from '@/server/context'

// Ola 4, integración: territorio al convertir un lead, "Tomar esta tienda" y próximo paso por defecto en día hábil.
const admin = owner()
afterAll(() => admin.end())
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const tag = () => Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x')
const mxPhone = () => `55 6${Math.floor(1000000 + Math.random() * 8999999)}`
const usPhone = () => `305 55${Math.floor(10000 + Math.random() * 89999)}`
const territory = async (market: string, code: string) => (await one(admin<{ id: string }[]>`select id from crm.territories where market_code = ${market} and code = ${code}`)).id
const accountTerritory = async (id: string) => (await one(admin<{ code: string | null }[]>`select (select t.code from crm.territories t where t.id = a.territory_id) as code from crm.accounts a where a.id = ${id}`)).code

describe('un lead convertido hereda el territorio', () => {
  it('con dos territorios, la ciudad del lead decide; sin ciudad que lo diga, se pregunta y vale el que se elige', async () => {
    const marco = await ctxFor('marco.pena') // CDMX Norte y Guadalajara
    const inferred = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Tapatíos ${tag()}`, contactName: 'Rosa Luna', phone: mxPhone(), locality: 'Guadalajara' })
    await qualifyLead(marco, inferred)
    expect(await accountTerritory((await convertLead(marco, inferred)).accountId)).toBe('GDL')

    const unclear = await createLead(marco, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Sin Plaza ${tag()}`, contactName: 'Rosa Luna', phone: mxPhone() })
    await qualifyLead(marco, unclear)
    await expect(convertLead(marco, unclear)).rejects.toMatchObject({ code: 'pick_territory' })
    // un territorio de otro mercado no entra
    await expect(convertLead(marco, unclear, { territoryId: await territory('US', 'FL') })).rejects.toMatchObject({ code: 'invalid' })
    const out = await convertLead(marco, unclear, { territoryId: await territory('MX', 'CDMX-N') })
    expect(await accountTerritory(out.accountId)).toBe('CDMX-N')
  })

  it('con un solo territorio es ese, y el próximo paso por defecto cae en un día hábil del mercado', async () => {
    const sam = await ctxFor('sam.ortiz') // Nevada
    const id = await createLead(sam, { market: 'US', motor: 'dealer', businessName: `Desert Wireless ${tag()}`, contactName: 'Dana Fox', phone: usPhone() })
    await qualifyLead(sam, id)
    const out = await convertLead(sam, id)
    expect(await accountTerritory(out.accountId)).toBe('NV')
    const due = await one(admin<{ dow: number; gap: number }[]>`
      select extract(isodow from d.next_step_due)::int as dow, d.next_step_due - (now() at time zone 'America/New_York')::date as gap from crm.deals d where d.id = ${out.dealId}`)
    expect(due.dow).toBeLessThanOrEqual(5)
    expect(due.gap).toBeGreaterThanOrEqual(2)
    expect(due.gap).toBeLessThanOrEqual(4)
  })
})

describe('tomar una tienda sin asignar', () => {
  const unowned = async (code: string) => {
    const ana = await ctxFor('ana.robles')
    const acc = await createAccount(ana, { market: 'MX', kind: 'store', name: `Tienda Libre ${code} ${tag()}`, segment: 'd2d', force: true, reason: 'Prueba: es otro comercio' })
    await admin`update crm.accounts set owner_id = null, territory_id = ${await territory('MX', code)} where id = ${acc.id!}`
    return acc.id!
  }

  it('quien vende toma la de su territorio y queda a su nombre, con el evento en la bitácora', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await unowned('GDL')
    expect((await getAccount(marco, id))?.account.in_my_territory).toBe(true)
    await takeAccount(marco, id)
    const row = await one(admin<{ owner_id: string }[]>`select owner_id from crm.accounts where id = ${id}`)
    expect(row.owner_id).toBe(marco.user.id)
    const ev = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.audit_events where action = 'account.reassigned' and actor_id = ${marco.user.id} and after -> 'account_ids' ? ${id}`)
    expect(ev.n).toBe(1)
    // ya tiene quien la lleve: no se toma dos veces
    await expect(takeAccount(await ctxFor('fernando.ibarra'), id)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('fuera de sus territorios no la toma quien vende; supervisión y quien lidera, sí; Operaciones, nunca', async () => {
    const marco = await ctxFor('marco.pena')
    const id = await unowned('MTY')
    await expect(takeAccount(marco, id)).rejects.toMatchObject({ code: expect.stringMatching(/invalid|not_found/) })
    await expect(takeAccount(await ctxFor('valeria.soto'), id)).rejects.toMatchObject({ code: 'forbidden' })
    const fernando = await ctxFor('fernando.ibarra')
    await takeAccount(fernando, id)
    expect((await one(admin<{ owner_id: string }[]>`select owner_id from crm.accounts where id = ${id}`)).owner_id).toBe(fernando.user.id)
    const other = await unowned('MTY')
    const ana = await ctxFor('ana.robles')
    await takeAccount(ana, other)
    expect((await one(admin<{ owner_id: string }[]>`select owner_id from crm.accounts where id = ${other}`)).owner_id).toBe(ana.user.id)
  })
})

describe('la devolución de Operaciones se lee en el idioma de quien la lee', () => {
  it('guarda el código del motivo; Hoy, el negocio y el hilo componen el texto en español o en inglés, y la nota libre no cambia', async () => {
    const jade = await ctxFor('jade.kim')
    const tom = await ctxFor('tom.reyes')
    const stage = async (code: string) => (await one(admin<{ id: string }[]>`select s.id from crm.stages s where s.pipeline_id = md5('contigo:p-us-dealer')::uuid and s.code = ${code}`)).id
    const acc = await createAccount(jade, { market: 'US', kind: 'store', name: `Return Wireless ${tag()}`, segment: 'dealer', force: true, reason: 'Prueba: es otro comercio' })
    const contact = await one(admin<{ id: string }[]>`insert into crm.contacts (market_code, full_name) values ('US', 'Dana Fox') returning id`)
    await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${acc.id!}, ${contact.id}, 'US', 'decision_maker')`
    const today = (await one(admin<{ d: string }[]>`select (now() at time zone 'America/New_York')::date::text as d`)).d
    const id = await createDeal(jade, { accountId: acc.id!, pipelineId: (await one(admin<{ id: string }[]>`select md5('contigo:p-us-dealer')::uuid as id`)).id, title: `Devolución ${tag()}`, nextStep: 'Reunir documentos', nextStepDue: today })
    await updateDeal(jade, id, { decisionMakerId: contact.id, decisionMakerMet: true, amount: 1200 })
    await updateCustom(jade, 'deal', id, { account_funding: 'ACH' })
    // El alta de dealers de US tiene nueve etapas con sus candados y seis motivos de devolución propios (paquete us-embudo).
    await fillEnrollment(admin, id)
    await moveDeal(jade, id, await stage('application'))
    await moveDeal(jade, id, await stage('carrier'))
    await takeDeal(tom, id)
    await moveDeal(tom, id, await stage('application'), undefined, undefined, { ret: { reasonCode: 'entity_mismatch', note: 'Falta el EIN' } })

    const task = await one(admin<{ custom: { ops_return?: { code: string; note: string } } }[]>`select custom from crm.activities where deal_id = ${id} and deal_step = 'sales' and done_at is null`)
    expect(task.custom.ops_return).toMatchObject({ code: 'entity_mismatch', note: 'Falta el EIN' })
    const title = (await one(admin<{ title: string }[]>`select title from crm.deals where id = ${id}`)).title
    const es = `Operaciones devolvió ${title}: Los datos de la entidad no coinciden. Falta el EIN`
    const en = `Operations sent back ${title}: Entity details mismatch. Falta el EIN`
    expect((await getQueue(jade)).rows.find((r) => r.dealId === id)?.subject).toBe(es)
    expect((await getDeal(jade, id))?.deal.next_step).toBe(es)
    const jadeEn = (await loadCtx(jade.user.id, 'en'))!
    expect((await getQueue(jadeEn)).rows.find((r) => r.dealId === id)?.subject).toBe(en)
    expect((await getDeal(jadeEn, id))?.deal.next_step).toBe(en)
    expect((await getAccount(jadeEn, acc.id!))?.tasks.find((t) => t.subject === en)).toBeTruthy()

    // Si la vendedora escribe otro próximo paso, deja de ser la devolución: se muestra lo que ella escribió
    await updateDeal(jade, id, { nextStep: 'Pedir el EIN al dueño', nextStepDue: today })
    expect((await getQueue(jadeEn)).rows.find((r) => r.dealId === id)?.subject).toBe('Pedir el EIN al dueño')
    expect((await getDeal(jadeEn, id))?.deal.next_step).toBe('Pedir el EIN al dueño')
  })
})
