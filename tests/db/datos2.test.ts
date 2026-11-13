import { afterAll, describe, expect, it } from 'vitest'
import { ctxFor, owner, personaId } from './helpers'
import { withSystem } from '@/server/db'
import { addContactLinked, createAccount } from '@/domain/accounts'
import { convertLead, createLead, qualifyLead } from '@/domain/leads'
import { dismissContactPair, mergeContacts, resolveContact, undoContactMerge } from '@/domain/contacts-dedup'
import { decisionValue, DECISIONS, setDecision } from '@/domain/decisions'
import { contactQueue, decisionsBoard } from '@/dal/datos2'
import { scanDuplicates } from '@/domain/datos'
import { AUDIT_ACTION } from '@/lib/audit'

// Paquete datos2 (0040_datos2, ola 6): residuos de DAT-02, DAT-04, DAT-01, DAT-05, DAT-07, MULTI-02, E9.F11, E3.F10, E4.F2, E4.F9, E6.F8.
const admin = owner()
const tag = () => Math.random().toString(36).slice(2, 8)
const mxPhone = () => `55 7${Math.floor(1000000 + Math.random() * 8999999)}`
const e164 = (p: string) => `+52${p.replace(/\D/g, '')}`
const one = async <T>(q: Promise<T[]>) => (await q)[0]!

afterAll(async () => {
  await admin.end()
})

async function rawAccount(market: 'MX' | 'US', who: string, extra: Record<string, string | number | null> = {}): Promise<string> {
  const o = await personaId(who)
  const row = await one(admin<{ id: string }[]>`
    insert into crm.accounts (market_code, kind, account_type, name, segment, owner_id, phone, email, locality, country, latitude, longitude, created_by)
    values (${market}, 'store', 'store', ${(extra.name as string) ?? `Datos2 ${tag()} ${tag()}`}, ${market === 'US' ? 'dealer' : 'd2d'}, ${o}, ${(extra.phone as string) ?? null},
            ${(extra.email as string) ?? null}, ${(extra.locality as string) ?? null}, ${market}, ${(extra.lat as number) ?? null}, ${(extra.lon as number) ?? null}, ${o}) returning id`)
  return row.id
}

describe('DAT-02 · un teléfono, una persona', () => {
  it('la base no admite dos contactos del mismo mercado con el mismo teléfono', async () => {
    const tel = e164(mxPhone())
    const lucia = await personaId('lucia.vega')
    await admin`insert into crm.contacts (market_code, full_name, phone, created_by) values ('MX', 'Primera Persona', ${tel}, ${lucia})`
    await expect(admin`insert into crm.contacts (market_code, full_name, phone, created_by) values ('MX', 'Segunda Persona', ${tel}, ${lucia})`).rejects.toMatchObject({ code: '23505' })
    // otro mercado sí: el teléfono es único por mercado
    await admin`insert into crm.contacts (market_code, full_name, phone, created_by) values ('US', 'Otra Persona', ${tel}, ${lucia})`
  })

  it('la limpieza deja el teléfono al más antiguo, pone en espera el del otro y sugiere la fusión en la cola', async () => {
    const tel = e164(mxPhone())
    const lucia = await personaId('lucia.vega')
    const out = await admin.begin(async (sql) => {
      await sql`drop index crm.contacts_phone_uq`
      const [a] = await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name, phone, created_by, created_at) values ('MX', 'Ana Antigua', ${tel}, ${lucia}, now() - interval '2 days') returning id`
      const [b] = await sql<{ id: string }[]>`insert into crm.contacts (market_code, full_name, phone, created_by) values ('MX', 'Beto Nuevo', ${tel}, ${lucia}) returning id`
      const [n] = await sql<{ n: number }[]>`select app.contact_phone_cleanup() as n`
      const rows = await sql<{ id: string; phone: string | null; held_phone: string | null }[]>`select id, phone, held_phone from crm.contacts where id in (${a!.id}, ${b!.id})`
      const pair = await sql<{ suggested_keep: string; source: string; status: string }[]>`select suggested_keep, source, status from crm.contact_pairs where ${a!.id} in (a_id, b_id) and ${b!.id} in (a_id, b_id)`
      await sql`create unique index contacts_phone_uq on crm.contacts (market_code, phone) where phone is not null`
      return { a: a!.id, b: b!.id, n: n!.n, rows, pair }
    })
    expect(out.n).toBeGreaterThanOrEqual(1)
    expect(out.rows.find((r) => r.id === out.a)).toMatchObject({ phone: tel, held_phone: null })
    expect(out.rows.find((r) => r.id === out.b)).toMatchObject({ phone: null, held_phone: tel })
    expect(out.pair[0]).toMatchObject({ suggested_keep: out.a, source: 'cleanup', status: 'open' })
  })

  it('convertir un lead liga a la persona que ya existe por teléfono, y si el nombre no cuadra la deja en espera para revisión', async () => {
    const diana = await ctxFor('diana.cruz')
    const tel = mxPhone()
    const acc = await rawAccount('MX', 'diana.cruz')
    const known = await addContactLinked(diana, acc, { fullName: 'Rosa Jiménez', phone: tel, role: 'owner' })
    // misma persona (mismo nombre, sin acentos ni mayúsculas): un contacto, dos cuentas
    const l1 = await createLead(diana, { market: 'MX', motor: 'd2d', businessName: `Abarrotes Rosa ${tag()}`, contactName: 'rosa jimenez', phone: tel })
    await qualifyLead(diana, l1)
    const o1 = await convertLead(diana, l1)
    const linked = await admin<{ contact_id: string }[]>`select contact_id from crm.account_contacts where account_id = ${o1.accountId}`
    expect(linked.map((r) => r.contact_id)).toEqual([known.id])
    // otra persona con el mismo teléfono: contacto nuevo, teléfono en espera y el par en la cola
    const l2 = await createLead(diana, { market: 'MX', motor: 'd2d', businessName: `Papelería Centro ${tag()}`, contactName: 'Mario Ruiz', phone: `${tel.slice(0, -1)}${(Number(tel.slice(-1)) + 1) % 10}` })
    await admin`update crm.leads set phone = ${e164(tel)} where id = ${l2}`
    await qualifyLead(diana, l2)
    const o2 = await convertLead(diana, l2)
    const c2 = await one(admin<{ id: string; phone: string | null; held_phone: string | null }[]>`
      select c.id, c.phone, c.held_phone from crm.account_contacts ac join crm.contacts c on c.id = ac.contact_id where ac.account_id = ${o2.accountId}`)
    expect(c2).toMatchObject({ phone: null, held_phone: e164(tel) })
    expect(c2.id).not.toBe(known.id)
    const pair = await one(admin<{ source: string; suggested_keep: string }[]>`select source, suggested_keep from crm.contact_pairs where ${c2.id} in (a_id, b_id)`)
    expect(pair).toEqual({ source: 'lead', suggested_keep: known.id })
  })

  it('la Sales App y la segunda solicitud usan la misma detección (resolveContact)', async () => {
    const tel = e164(mxPhone())
    const r = await withSystem(async (tx, sysId) => {
      const a = await resolveContact(tx, sysId, { market: 'MX', name: 'Laura Peña', phone: tel, email: null, source: 'sales_app' })
      const b = await resolveContact(tx, sysId, { market: 'MX', name: 'LAURA PEÑA', phone: tel, email: null, source: 'sales_app' })
      const c = await resolveContact(tx, sysId, { market: 'MX', name: 'Pedro Soto', phone: tel, email: null, source: 'form' })
      return { a, b, c }
    })
    expect(r.a.outcome).toBe('new')
    expect(r.b).toMatchObject({ id: r.a.id, outcome: 'linked' })
    expect(r.c).toMatchObject({ outcome: 'held', matchedId: r.a.id })
  })

  it('fusionar contactos mueve vínculos y quién decide, toma el teléfono en espera, y se deshace', async () => {
    const diana = await ctxFor('diana.cruz')
    const nora = await ctxFor('nora.salas')
    const tel = mxPhone()
    const a1 = await rawAccount('MX', 'diana.cruz')
    const a2 = await rawAccount('MX', 'diana.cruz')
    const keep = await addContactLinked(diana, a1, { fullName: 'Julia Mora', role: 'owner' })
    const other = await addContactLinked(diana, a2, { fullName: 'Julia M.', phone: tel, role: 'manager' })
    // quien vende no fusiona en MX mientras la decisión siga cerrada
    await expect(mergeContacts(diana, other.id, keep.id)).rejects.toMatchObject({ code: 'forbidden' })
    const ev = await mergeContacts(nora, other.id, keep.id)
    const after = await admin<{ id: string; phone: string | null; archived_at: Date | null; merged_into: string | null }[]>`select id, phone, archived_at, merged_into from crm.contacts where id in (${keep.id}, ${other.id})`
    expect(after.find((r) => r.id === keep.id)!.phone).toBe(e164(tel))
    expect(after.find((r) => r.id === other.id)).toMatchObject({ phone: null, merged_into: keep.id })
    expect((await admin`select 1 from crm.account_contacts where account_id = ${a2} and contact_id = ${keep.id} and valid_to is null`).length).toBe(1)
    expect((await admin`select 1 from crm.audit_events where action = 'contact.merged' and object_id = ${keep.id}`).length).toBe(1)
    await undoContactMerge(nora, ev, 'Eran dos personas distintas')
    const back = await admin<{ id: string; phone: string | null; archived_at: Date | null }[]>`select id, phone, archived_at from crm.contacts where id in (${keep.id}, ${other.id})`
    expect(back.find((r) => r.id === other.id)).toMatchObject({ phone: e164(tel), archived_at: null })
    expect(back.find((r) => r.id === keep.id)!.phone).toBeNull()
    expect((await admin`select 1 from crm.account_contacts where account_id = ${a2} and contact_id = ${other.id} and valid_to is null`).length).toBe(1)
  })

  it('la cola de contactos muestra el par y se puede descartar con motivo', async () => {
    const nora = await ctxFor('nora.salas')
    const tel = e164(mxPhone())
    const ids = await withSystem(async (tx, sysId) => {
      const a = await resolveContact(tx, sysId, { market: 'MX', name: 'Sofía Lara', phone: tel, email: null, source: 'sales_app' })
      const b = await resolveContact(tx, sysId, { market: 'MX', name: 'Tomás Lara', phone: tel, email: null, source: 'sales_app' })
      return [a.id, b.id]
    })
    const q = await contactQueue(nora, 'MX')
    const p = q.pairs.find((x) => [x.a.id, x.b.id].includes(ids[1]!))
    expect(p).toBeTruthy()
    expect([p!.a.held_phone, p!.b.held_phone]).toContain(tel)
    await expect(dismissContactPair(nora, p!.id, 'no')).rejects.toMatchObject({ code: 'invalid' })
    await dismissContactPair(nora, p!.id, 'Son hermanos con el teléfono de la tienda')
    expect((await one(admin<{ status: string }[]>`select status from crm.contact_pairs where id = ${p!.id}`)).status).toBe('dismissed')
  })
})

describe('DAT-04 · llaves de identificador fiscal y de ubicación; conversión y carga pasan por la detección', () => {
  it('el identificador fiscal escrito al crear encuentra el comercio que ya lo tiene', async () => {
    const lucia = await ctxFor('lucia.vega')
    const a = await rawAccount('MX', 'marco.pena')
    const { blindIndex } = await import('@/server/adapters/markets')
    const { checkTaxId } = await import('@/lib/tax-id')
    const rfc = 'GODE561231GR8'
    const blind = blindIndex('mx_rfc', checkTaxId('mx_rfc', rfc).normalized)
    await admin`update crm.accounts set tax_id_blind_ix = ${blind} where id = ${a}`
    const r = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Nada parecido ${tag()}`, segment: 'd2d', taxId: rfc.toLowerCase() })
    expect(r.duplicates?.[0]).toMatchObject({ id: a, match: 'tax_id', strong: true })
  })

  it('el mismo lugar con nombre parecido es llave; sin coordenadas no hay llave de ubicación', async () => {
    const lucia = await ctxFor('lucia.vega')
    const name = `Recargas El Faro ${tag()}`
    const a = await rawAccount('MX', 'marco.pena', { name, lat: 19.4326077, lon: -99.133208 })
    const near = await createAccount(lucia, { market: 'MX', kind: 'store', name: `${name.replace('Recargas', 'Recarga')}`, segment: 'd2d', latitude: 19.43261, longitude: -99.13321 })
    expect(near.duplicates?.some((d) => d.id === a && (d.match === 'geo' || d.match === 'name'))).toBe(true)
    const geoOnly = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Otra cosa distinta ${tag()}`, segment: 'd2d', latitude: 19.43261, longitude: -99.13321 })
    expect(geoOnly.duplicates?.some((d) => d.id === a) ?? false).toBe(false)
    expect((await one(admin<{ g: string }[]>`select app.geohash(57.64911, 10.40744, 11) as g`)).g).toBe('u4pruydqqvj')
  })

  it('la búsqueda en lote encuentra pares por identificador fiscal', async () => {
    const nora = await ctxFor('nora.salas')
    const a = await rawAccount('MX', 'marco.pena')
    const b = await rawAccount('MX', 'marco.pena')
    const blind = `blind-${tag()}`
    await admin`update crm.accounts set tax_id_blind_ix = ${blind} where id in (${a}, ${b})`
    await scanDuplicates(nora, 'MX')
    const p = await one(admin<{ match_kinds: string[]; strong: boolean }[]>`select match_kinds, strong from crm.duplicate_pairs where a_id = least(${a}::uuid, ${b}::uuid) and b_id = greatest(${a}::uuid, ${b}::uuid)`)
    expect(p.match_kinds).toContain('tax_id')
    expect(p.strong).toBe(true)
  })

  it('el comercio que nace de un lead entra a la cola si choca con otro por llave fuerte', async () => {
    const diana = await ctxFor('diana.cruz')
    const tel = mxPhone()
    const existing = await rawAccount('MX', 'marco.pena', { phone: e164(tel) })
    const l = await createLead(diana, { market: 'MX', motor: 'd2d', businessName: `Lead choca ${tag()}`, contactName: 'Persona Choca', phone: tel })
    await qualifyLead(diana, l)
    const o = await convertLead(diana, l)
    const p = await one(admin<{ match_kinds: string[]; strong: boolean; status: string }[]>`
      select match_kinds, strong, status from crm.duplicate_pairs where a_id = least(${existing}::uuid, ${o.accountId}::uuid) and b_id = greatest(${existing}::uuid, ${o.accountId}::uuid)`)
    expect(p).toMatchObject({ strong: true, status: 'open' })
    expect(p.match_kinds).toContain('phone')
  })
})

describe('Decisiones de negocio con dueño', () => {
  it('cada decisión tiene dueño y valor propuesto; cambiarla queda en la bitácora; la bloqueada no se cambia', async () => {
    for (const d of DECISIONS) {
      expect(d.owner.length).toBeGreaterThan(2)
      expect(d.options.map((o) => o.value)).toContain(d.proposal['*'])
    }
    const nora = await ctxFor('nora.salas')
    const board = await decisionsBoard(nora)
    expect(board.find((r) => r.key === 'market.reset_production')).toMatchObject({ value: 'blocked', proposed: true })
    await expect(setDecision(nora, { key: 'market.reset_production', market: null, value: 'allowed', confirmed: true, note: 'Lo decidió alguien' })).rejects.toMatchObject({ code: 'invalid' })
    const diana = await ctxFor('diana.cruz')
    await expect(setDecision(diana, { key: 'tree.reparent_owner', market: 'MX', value: 'parent', confirmed: false })).rejects.toMatchObject({ code: 'forbidden' })
    // confirmar pide una nota
    await expect(setDecision(nora, { key: 'tree.reparent_owner', market: 'SV', value: 'keep', confirmed: true })).rejects.toMatchObject({ code: 'invalid' })
    await setDecision(nora, { key: 'tree.reparent_owner', market: 'SV', value: 'keep', confirmed: true, note: 'Acordado en la reunión de Comercial' })
    const v = await withSystem((tx) => decisionValue(tx, 'tree.reparent_owner', 'SV'))
    expect(v).toEqual({ value: 'keep', proposed: false })
    expect((await admin`select 1 from crm.audit_events where action = 'decision.set'`).length).toBeGreaterThan(0)
    expect(AUDIT_ACTION['decision.set']).toBeTruthy()
  })
})
