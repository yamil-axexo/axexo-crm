import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ctxFor, owner, personaId } from './helpers'
import { getDataQuality } from '@/dal/admin'
import { listAccounts } from '@/dal/accounts'
import { getHolders } from '@/dal/reparto'

// Dos reglas que este paquete dejó con un solo significado:
// - "Por repartir" en Calidad de datos cuenta igual que en Mi equipo y en Comercios (app.owner_roles): tener solo
//   administración no es llevar cartera.
// - "Sin próximo paso" no cuenta a una tienda activa que no tiene negocio abierto: esa tienda está al día.
const admin = owner()
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const TAG = 'Vocabulario '

async function clean() {
  await admin`delete from crm.accounts where name like ${TAG + '%'}`
}

let nora = ''
let lucia = ''
beforeAll(async () => {
  await clean()
  nora = await personaId('nora.salas')
  lucia = await personaId('lucia.vega')
})
afterAll(async () => {
  await clean()
  await admin.end()
})

describe('"por repartir" es una sola regla', () => {
  it('un comercio a nombre de alguien que solo administra aparece en Calidad de datos, igual que en Mi equipo', async () => {
    const ctx = await ctxFor('nora.salas')
    const before = (await getDataQuality(ctx)).orphans.find((o) => o.owner_id === nora && o.market_code === 'MX')?.accounts ?? 0
    await admin`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id) values ('MX', 'store', ${TAG + 'de administración'}, 'd2d', 'active', ${nora})`
    const row = (await getDataQuality(ctx)).orphans.find((o) => o.owner_id === nora && o.market_code === 'MX')
    expect(row?.accounts).toBe(before + 1)
    // La misma cuenta que usa el reparto: esa persona figura como alguien que hoy no lleva cartera en MX.
    const holder = (await getHolders(ctx, ['MX'])).find((h) => h.owner_id === nora && h.market_code === 'MX')
    expect(holder).toMatchObject({ current: false, accounts: before + 1 })
  })

  it('lo que lleva alguien que vende en ese mercado no aparece', async () => {
    const ctx = await ctxFor('nora.salas')
    expect((await getDataQuality(ctx)).orphans.some((o) => o.owner_id === lucia && o.market_code === 'MX')).toBe(false)
  })
})

describe('"sin próximo paso" no cuenta a una tienda activa que está al día', () => {
  it('una tienda activa sin negocio abierto ni tarea no entra al filtro; la misma tienda en alta sí', async () => {
    const ctx = await ctxFor('lucia.vega')
    const name = TAG + 'tienda al día'
    const { id } = await one(admin<{ id: string }[]>`insert into crm.accounts (market_code, kind, name, segment, lifecycle, owner_id) values ('MX', 'store', ${name}, 'd2d', 'active', ${lucia}) returning id`)
    expect((await listAccounts(ctx, { ver: 'sin-paso', q: name })).items.map((a) => a.id)).not.toContain(id)
    expect((await listAccounts(ctx, { q: name })).items.map((a) => a.id)).toContain(id)
    await admin`update crm.accounts set lifecycle = 'onboarding' where id = ${id}`
    expect((await listAccounts(ctx, { ver: 'sin-paso', q: name })).items.map((a) => a.id)).toContain(id)
  })
})
