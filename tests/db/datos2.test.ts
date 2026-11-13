import { afterAll, describe, expect, it } from 'vitest'
import { ctxFor, owner, personaId } from './helpers'
import { withSystem } from '@/server/db'
import { addContactLinked, createAccount, setParent } from '@/domain/accounts'
import { fieldRegistry, nodeTotals } from '@/dal/datos'
import { decideField, proposeField } from '@/domain/gobierno'
import { updateCustom } from '@/domain/custom'
import { requestPromotion, setFieldSchema } from '@/domain/fields2'
import { openExpansionDeals, setProductEntity } from '@/domain/products2'
import { productMatrix } from '@/dal/datos'
import { inferAccountTimezones } from '@/server/jobs/datos'
import { JOBS } from '@/server/jobs/registry'
import { convertLead, createLead, intakeFromForm, qualifyLead } from '@/domain/leads'
import { systemContext } from './helpers'
import { retryIntakeNow } from '@/domain/embudo/intake-retry'
import { reassignAccounts } from '@/domain/reparto'
import { loadCtx } from '@/server/context'
import { updateAccount } from '@/domain/accounts'
import { grantAccess } from '@/domain/admin'
import { grantAgencyAccess } from '@/domain/security'
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

async function rawAccount(market: 'MX' | 'US', who: string, extra: Record<string, string | number | null> = {}, type = 'store'): Promise<string> {
  const o = await personaId(who)
  const kind = type === 'chain' ? 'chain' : 'store'
  const row = await one(admin<{ id: string }[]>`
    insert into crm.accounts (market_code, kind, account_type, name, segment, owner_id, phone, email, locality, country, latitude, longitude, created_by)
    values (${market}, ${kind}, ${type}, ${(extra.name as string) ?? `Datos2 ${tag()} ${tag()}`}, ${market === 'US' ? 'dealer' : 'd2d'}, ${o}, ${(extra.phone as string) ?? null},
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

describe('DAT-01 · árbol a una fecha, comisión por nodo y dueño al mover', () => {
  it('lo que suma un nodo se puede ver a una fecha pasada con el árbol de ese día', async () => {
    const paula = await ctxFor('paula.mendez')
    const chain = await rawAccount('MX', 'diana.cruz', {}, 'chain')
    const kid = await rawAccount('MX', 'diana.cruz', {}, 'branch')
    await admin`update crm.accounts set created_at = now() - interval '30 days' where id in (${chain}, ${kid})`
    await setParent(paula, kid, chain)
    await admin`update crm.account_links set valid_from = now() - interval '5 days' where child_id = ${kid}`
    const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
    const today = await nodeTotals(paula, chain)
    expect(today.accounts).toBe(2)
    expect(today.as_of).toBeNull()
    const before = await nodeTotals(paula, chain, ago(10))
    expect(before.accounts).toBe(1)
    // la etapa de vida de un día pasado no se guarda: queda sin dato en vez de inventarse
    expect(before.active).toBeNull()
    expect(before.as_of).toBe(ago(10))
    // comisión: sin señales, sin dato; con señales, suma el último corte de cada comercio del subárbol
    expect(today.commission_30d).toBeNull()
    await admin`insert into crm.care_signals (account_id, as_of, market_code, commission_minor_30d, source) values (${kid}, current_date - 1, 'MX', 12500, 'manual'), (${chain}, current_date - 1, 'MX', 500, 'manual')`
    expect((await nodeTotals(paula, chain)).commission_30d).toBe('13000')
  })

  it('al mover una cuenta, el dueño sigue la regla del mercado: por defecto se conserva; con "toma el de arriba", pasa con su subárbol', async () => {
    const paula = await ctxFor('paula.mendez')
    const nora = await ctxFor('nora.salas')
    const ivan = await personaId('ivan.rios')
    const diana = await personaId('diana.cruz')
    const top = await rawAccount('MX', 'ivan.rios', {}, 'chain')
    const mid = await rawAccount('MX', 'diana.cruz', {}, 'chain')
    const leaf = await rawAccount('MX', 'diana.cruz', {}, 'branch')
    await setParent(paula, leaf, mid)
    const kept = await setParent(paula, mid, top)
    expect(kept).toMatchObject({ ownerDiffers: true, ownerFollowed: 0 })
    expect((await one(admin<{ owner_id: string }[]>`select owner_id from crm.accounts where id = ${mid}`)).owner_id).toBe(diana)
    await setParent(paula, mid, null, { reason: 'Se reacomoda la cadena' })
    await setDecision(nora, { key: 'tree.reparent_owner', market: 'MX', value: 'parent', confirmed: false })
    try {
      const out = await setParent(paula, mid, top)
      expect(out.ownerFollowed).toBe(2)
      const owners = await admin<{ owner_id: string }[]>`select owner_id from crm.accounts where id in (${mid}, ${leaf})`
      expect(owners.every((o) => o.owner_id === ivan)).toBe(true)
      expect((await admin`select 1 from crm.audit_events where action = 'account.owner_followed_parent' and object_id = ${mid}`).length).toBe(1)
    } finally {
      await setDecision(nora, { key: 'tree.reparent_owner', market: 'MX', value: 'keep', confirmed: false })
    }
  })
})

describe('DAT-05 · reglas de valor, campos de contacto y actividad, paso a columna y plazo medido', () => {
  const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

  it('un mercado propone un campo de contacto; aprobado, se llena en el contacto y respeta sus reglas', async () => {
    const ana = await ctxFor('ana.robles')
    const nora = await ctxFor('nora.salas')
    const diana = await ctxFor('diana.cruz')
    const gov = { ownerId: ana.user.id, purpose: 'Saber cuántos años lleva', decision: 'Decide el trato del contacto en la visita', reviewOn: future(90), piiClass: 'none' as const }
    const id = await proposeField(ana, { object: 'contact', market: 'MX', labelEs: `Años en el negocio ${tag()}`, labelEn: `Years in business ${tag()}`, dataType: 'number', ...gov })
    await decideField(nora, id, true, '')
    const key = (await one(admin<{ key: string }[]>`select key from crm.field_definitions where id = ${id}`)).key
    await expect(setFieldSchema(ana, id, { minimum: '0' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setFieldSchema(nora, id, { minimum: '10', maximum: '2' })).rejects.toMatchObject({ code: 'invalid' })
    expect(await setFieldSchema(nora, id, { minimum: '0', maximum: '80' })).toEqual({ minimum: 0, maximum: 80 })
    const acc = await rawAccount('MX', 'diana.cruz')
    const c = await addContactLinked(diana, acc, { fullName: 'Contacto Campos', role: 'owner' })
    await expect(updateCustom(diana, 'contact', c.id, { [key]: '120' })).rejects.toMatchObject({ code: 'invalid' })
    expect(await updateCustom(diana, 'contact', c.id, { [key]: '12' })).toBe(1)
    expect((await one(admin<{ v: number }[]>`select (custom ->> ${key})::int as v from crm.contacts where id = ${c.id}`)).v).toBe(12)
    expect((await admin`select 1 from crm.audit_events where action = 'contact.custom_updated' and object_id = ${c.id}`).length).toBe(1)
    // y de actividad
    const act = await proposeField(ana, { object: 'activity', market: 'MX', labelEs: `Resultado corto ${tag()}`, labelEn: `Short outcome ${tag()}`, dataType: 'text', ...gov })
    expect((await one(admin<{ object: string }[]>`select object from crm.field_definitions where id = ${act}`)).object).toBe('activity')
  })

  it('pasar un campo a columna arma el cambio y se marca hecho cuando la columna existe', async () => {
    const ana = await ctxFor('ana.robles')
    const nora = await ctxFor('nora.salas')
    const gov = { ownerId: ana.user.id, purpose: 'Filtrar por nivel', decision: 'Decide a quién se visita primero', reviewOn: future(90), piiClass: 'none' as const }
    const id = await proposeField(ana, { object: 'account', market: 'MX', labelEs: `Nivel de tienda ${tag()}`, labelEn: `Store level ${tag()}`, dataType: 'number', ...gov })
    await expect(requestPromotion(ana, id, 'Se filtra en la cola de visitas')).rejects.toMatchObject({ code: 'invalid' })
    await decideField(nora, id, true, '')
    await expect(requestPromotion(ana, id, 'corto')).rejects.toMatchObject({ code: 'invalid' })
    const pid = await requestPromotion(ana, id, 'Se filtra en la cola de visitas')
    const p = await one(admin<{ column_name: string; migration_sql: string; status: string }[]>`select column_name, migration_sql, status from crm.field_promotions where id = ${pid}`)
    expect(p.status).toBe('requested')
    expect(p.migration_sql).toContain(`alter table crm.accounts add column ${p.column_name} numeric;`)
    await expect(requestPromotion(ana, id, 'Se filtra en la cola de visitas')).rejects.toMatchObject({ code: 'invalid' })
    await admin.unsafe(`alter table crm.accounts add column ${p.column_name} numeric`)
    const reg = await fieldRegistry(nora, 'vigentes')
    expect(reg.promotions.find((x) => x.id === pid)?.status).toBe('done')
    await admin.unsafe(`alter table crm.accounts drop column ${p.column_name}`)
  })

  it('el plazo para decidir propuestas se mide y sale de Decisiones de negocio', async () => {
    const ana = await ctxFor('ana.robles')
    const nora = await ctxFor('nora.salas')
    const gov = { ownerId: ana.user.id, purpose: 'Medir el plazo', decision: 'Decide si la propuesta llega a tiempo', reviewOn: future(90), piiClass: 'none' as const }
    const late = await proposeField(ana, { object: 'deal', market: 'MX', labelEs: `Tarde ${tag()}`, labelEn: `Late ${tag()}`, dataType: 'text', ...gov })
    await admin`update crm.field_definitions set proposed_at = now() - interval '10 days' where id = ${late}`
    await decideField(nora, late, true, '')
    const quick = await proposeField(ana, { object: 'deal', market: 'MX', labelEs: `Rápido ${tag()}`, labelEn: `Quick ${tag()}`, dataType: 'text', ...gov })
    await decideField(nora, quick, true, '')
    const r = await fieldRegistry(nora, 'propuestos')
    expect(r.sla).toBe(3)
    expect(r.slaStats.decided).toBeGreaterThanOrEqual(2)
    expect(r.slaStats.on_time).toBeLessThan(r.slaStats.decided)
    await setDecision(nora, { key: 'field.approval_sla_days', market: null, value: '5', confirmed: false })
    expect((await fieldRegistry(nora, 'propuestos')).sla).toBe(5)
  })
})

describe('DAT-07 · entidad del producto y negocios de expansión', () => {
  it('administración fija la entidad legal del producto, solo una del mismo mercado', async () => {
    const nora = await ctxFor('nora.salas')
    const prod = await one(admin<{ id: string }[]>`select id from crm.products where market_code = 'MX' and is_active order by name limit 1`)
    const mx = await one(admin<{ id: string }[]>`select id from crm.legal_entities where market_code = 'MX' limit 1`)
    const us = await one(admin<{ id: string }[]>`select id from crm.legal_entities where market_code = 'US' limit 1`)
    await expect(setProductEntity(nora, prod.id, us.id)).rejects.toMatchObject({ code: 'invalid' })
    await expect(setProductEntity(await ctxFor('valeria.soto'), prod.id, mx.id)).rejects.toMatchObject({ code: 'forbidden' })
    await setProductEntity(nora, prod.id, mx.id)
    const m = await productMatrix(nora, { market: null, provider: null, status: null, late: false })
    expect(m.products.find((p) => p.id === prod.id)?.legal_entity_id).toBe(mx.id)
    expect(m.entities.length).toBeGreaterThan(0)
  })

  it('de la base de expansión se abren negocios a nombre de quien lleva cada comercio, con el producto pedido', async () => {
    const valeria = await ctxFor('valeria.soto')
    const prod = await one(admin<{ id: string; name: string }[]>`select id, name from crm.products where market_code = 'MX' and is_active order by name desc limit 1`)
    const a = await rawAccount('MX', 'marco.pena')
    await admin`update crm.accounts set lifecycle = 'active' where id = ${a}`
    const out = await openExpansionDeals(valeria, prod.id, [a])
    expect(out).toEqual({ opened: 1, skipped: 0 })
    const deal = await one(admin<{ id: string; owner_id: string; title: string; status: string }[]>`select id, owner_id, title, status from crm.deals where account_id = ${a}`)
    expect(deal.owner_id).toBe(await personaId('marco.pena'))
    expect(deal.title).toContain(prod.name)
    expect(await one(admin`select status, deal_id from crm.account_products where account_id = ${a} and product_id = ${prod.id}`)).toEqual({ status: 'requested', deal_id: deal.id })
    // dos veces no abre otro
    expect((await openExpansionDeals(valeria, prod.id, [a])).opened).toBe(0)
    await expect(openExpansionDeals(await ctxFor('luis.tovar'), prod.id, [a])).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('MULTI-02 · entidad en contrato y lead, hora de la cuenta', () => {
  it('el contrato lleva entidad obligatoria (la del comercio) y no acepta una de otro mercado', async () => {
    const acc = await rawAccount('MX', 'diana.cruz')
    const ent = await one(admin<{ legal_entity_id: string }[]>`select legal_entity_id from crm.accounts where id = ${acc}`)
    const terms = await one(admin<{ id: string }[]>`
      insert into crm.commercial_terms (account_id, market_code, version, commission_lines, settlement, term_months, valid_from, valid_to)
      values (${acc}, 'MX', 1, ${admin.json([{ product: 'Recargas', pct: 4 }])}, 'prepaid', 12, current_date, current_date + 365) returning id`)
    {
      const c = await one(admin<{ legal_entity_id: string }[]>`insert into crm.contracts (account_id, market_code, terms_id, starts_on, ends_on) values (${acc}, 'MX', ${terms.id}, current_date, current_date + 365) returning legal_entity_id`)
      expect(c.legal_entity_id).toBe(ent.legal_entity_id)
      const us = await one(admin<{ id: string }[]>`select id from crm.legal_entities where market_code = 'US' limit 1`)
      await expect(admin`insert into crm.contracts (account_id, market_code, terms_id, starts_on, ends_on, legal_entity_id) values (${acc}, 'MX', ${terms.id}, current_date, current_date + 365, ${us.id})`).rejects.toMatchObject({ code: '23514' })
    }
    const nulls = await one(admin<{ n: number }[]>`select count(*)::int as n from crm.contracts where legal_entity_id is null`)
    expect(nulls.n).toBe(0)
    const col = await one(admin<{ is_nullable: string }[]>`select is_nullable from information_schema.columns where table_schema = 'crm' and table_name = 'contracts' and column_name = 'legal_entity_id'`)
    expect(col.is_nullable).toBe('NO')
  })

  it('cada lead nace con entidad legal, y su reloj corre en la hora de la cuenta cuando se sabe', async () => {
    const diana = await ctxFor('diana.cruz')
    const id = await createLead(diana, { market: 'MX', motor: 'd2d', businessName: `Lead entidad ${tag()}`, contactName: 'Persona Entidad', phone: mxPhone() })
    expect((await one(admin<{ legal_entity_id: string | null }[]>`select legal_entity_id from crm.leads where id = ${id}`)).legal_entity_id).toBeTruthy()
    // misma hora de captura: con la zona de Tijuana, el reloj vence más tarde (en UTC) que con la de la Ciudad de México
    const [a, b] = await withSystem(async (tx) => tx<{ mx: Date; tj: Date }[]>`
      select app.business_due('MX', timestamptz '2026-11-16 15:00:00+00', 60, null) as mx, app.business_due('MX', timestamptz '2026-11-16 15:00:00+00', 60, 'America/Tijuana') as tj`).then((r) => [r[0]!.mx, r[0]!.tj])
    expect(b!.getTime()).toBeGreaterThan(a!.getTime())
    const tj = await createLead(diana, { market: 'MX', motor: 'd2d', businessName: `Lead Tijuana ${tag()}`, contactName: 'Persona Tijuana', phone: mxPhone(), timezone: 'America/Tijuana' })
    expect((await one(admin<{ timezone: string | null }[]>`select timezone from crm.leads where id = ${tj}`)).timezone).toBe('America/Tijuana')
    expect((await one(admin<{ tz: string | null }[]>`select app.lead_timezone(${tj}) as tz`)).tz).toBe('America/Tijuana')
  })

  it('los comercios sin zona propia toman la de su estado cuando el estado entero está en una zona', async () => {
    const a = await rawAccount('US', 'jade.kim')
    const b = await rawAccount('MX', 'diana.cruz')
    const c = await rawAccount('US', 'jade.kim')
    await admin`update crm.accounts set region = 'NV' where id = ${a}`
    await admin`update crm.accounts set region = 'Quintana Roo' where id = ${b}`
    await admin`update crm.accounts set region = 'NV', timezone = 'America/Denver' where id = ${c}`
    const n = await withSystem((tx) => inferAccountTimezones(tx))
    expect(n).toBeGreaterThanOrEqual(2)
    const rows = await admin<{ id: string; timezone: string | null }[]>`select id, timezone from crm.accounts where id in (${a}, ${b}, ${c})`
    expect(rows.find((r) => r.id === a)!.timezone).toBe('America/Los_Angeles')
    expect(rows.find((r) => r.id === b)!.timezone).toBe('America/Cancun')
    expect(rows.find((r) => r.id === c)!.timezone).toBe('America/Denver')
    expect(JOBS.some((j) => j.key === 'datos.account_timezones')).toBe(true)
  })
})

describe('E3.F10 · el formulario no crea un lead sin dueño', () => {
  it('sin nadie a quien dárselo, el envío queda retenido (no se pierde) y entra al reintentar cuando hay dueño', async () => {
    const sys = await systemContext()
    const nora = await ctxFor('nora.salas')
    const form = await one(admin<{ routing_rule_id: string }[]>`select routing_rule_id from crm.web_forms where slug = 'tiendas-mx'`)
    const before = await one(admin<{ member_ids: string[]; fallback_id: string | null }[]>`select member_ids, fallback_id from crm.routing_rules where id = ${form.routing_rule_id}`)
    await admin`update crm.routing_rules set member_ids = '{}', fallback_id = null where id = ${form.routing_rule_id}`
    const key = `t-${tag()}${tag()}`
    try {
      // regla del mercado en "rechazar": aunque haya quien lidera, no cae a esa persona
      await setDecision(nora, { key: 'lead.no_owner', market: 'MX', value: 'refuse', confirmed: false })
      const name = `Sin dueño ${tag()}`
      const out = await intakeFromForm(sys, 'tiendas-mx', { business_name: name, contact_name: 'Persona Retenida', phone: mxPhone() }, key)
      expect(out).toMatchObject({ leadId: '', held: true })
      expect((await admin`select 1 from crm.leads where business_name = ${name}`).length).toBe(0)
      const held = await one(admin<{ id: string; status: string; error: string }[]>`select id, status, error from crm.intake_retries where idempotency_key = ${key}`)
      expect(held).toMatchObject({ status: 'failed', error: 'no_owner' })
      expect((await admin`select 1 from crm.audit_events where action = 'lead.held'`).length).toBeGreaterThan(0)
      // con la regla de vuelta a "pasa a quien lidera", el reintento lo crea con dueño
      await setDecision(nora, { key: 'lead.no_owner', market: 'MX', value: 'market_lead', confirmed: false })
      expect(await retryIntakeNow(nora, held.id)).toBe('done')
      const l = await one(admin<{ owner_id: string | null }[]>`select owner_id from crm.leads where business_name = ${name}`)
      expect(l.owner_id).toBe(await personaId('ana.robles'))
    } finally {
      await admin`update crm.routing_rules set member_ids = ${before.member_ids}, fallback_id = ${before.fallback_id} where id = ${form.routing_rule_id}`
      await setDecision(nora, { key: 'lead.no_owner', market: 'MX', value: 'market_lead', confirmed: false })
    }
  })
})

describe('E4.F2 · quien opera no administra; cambiar dueño, fusionar y editar en bloque por mercado; rol de Finanzas', () => {
  it('en Estados Unidos (confirmado) Ventas cambia dueños y fusiona; en México sigue cerrado hasta que se decida', async () => {
    const jade = await ctxFor('jade.kim')
    const lucia = await ctxFor('lucia.vega')
    expect(jade.can('operator.reassign', 'US')).toBe(true)
    expect(jade.can('operator.merge', 'US')).toBe(true)
    expect(lucia.can('operator.reassign', 'MX')).toBe(false)
    // nada de administrar, exportar ni importar
    for (const c of ['config.manage', 'report.export', 'data.import', 'access.manage'] as const) expect(jade.can(c, 'US')).toBe(false)
    const mine = await rawAccount('US', 'jade.kim')
    expect(await reassignAccounts(jade, [mine], await personaId('sam.ortiz'))).toBe(1)
    const mx = await rawAccount('MX', 'lucia.vega')
    await expect(reassignAccounts(lucia, [mx], await personaId('diana.cruz'))).rejects.toMatchObject({ code: 'forbidden' })
    // si administración enciende México, Ventas de México también puede
    const nora = await ctxFor('nora.salas')
    await setDecision(nora, { key: 'ops.operator_rights', market: 'MX', value: 'on', confirmed: false })
    try {
      const lucia2 = await ctxFor('lucia.vega')
      expect(await reassignAccounts(lucia2, [mx], await personaId('marco.pena'))).toBe(1)
    } finally {
      await setDecision(nora, { key: 'ops.operator_rights', market: 'MX', value: 'off', confirmed: false })
    }
  })

  it('existe el rol de Finanzas: edita y lee sus reportes en su mercado, sin administrar ni exportar', async () => {
    const uid = await one(admin<{ id: string }[]>`insert into crm.users (email, full_name, locale) values (${`finanzas.${tag()}@contigo.test`}, 'Persona Finanzas', 'es') returning id`)
    await admin`insert into crm.memberships (user_id, market_code, role) values (${uid.id}, 'US', 'finance')`
    const fin = (await loadCtx(uid.id, 'es'))!
    expect(fin.can('report.finance', 'US')).toBe(true)
    expect(fin.can('account.edit', 'US')).toBe(true)
    expect(fin.can('operator.reassign', 'US')).toBe(true)
    for (const c of ['config.manage', 'report.export', 'data.import', 'account.merge', 'deal.create'] as const) expect(fin.can(c, 'US')).toBe(false)
    expect(fin.can('account.edit', 'MX')).toBe(false)
    // ve y edita comercios de su mercado (RLS)
    const acc = await rawAccount('US', 'jade.kim')
    await updateAccount(fin, acc, { name: 'Tienda Finanzas Reno', locality: 'Reno' })
    expect((await one(admin<{ locality: string }[]>`select locality from crm.accounts where id = ${acc}`)).locality).toBe('Reno')
  })
})

describe('E4.F9 · el asiento se aprueba antes del acceso', () => {
  it('sin quién aprobó el asiento y cuándo no hay acceso; con eso, el acceso nace con su aprobación', async () => {
    const nora = await ctxFor('nora.salas')
    const email = `asiento.${tag()}@axexo.com`
    const D = ['axexo.com']
    await expect(grantAccess(nora, { email, fullName: 'Persona Asiento', role: 'rep', market: 'MX' } as never, D)).rejects.toMatchObject({ code: 'invalid' })
    expect((await admin`select 1 from crm.users where email = ${email}`).length).toBe(0)
    await expect(grantAccess(nora, { email, fullName: 'Persona Asiento', role: 'rep', market: 'MX', seatApprover: 'Dueña del presupuesto', seatApprovedOn: '2099-01-01' }, D)).rejects.toMatchObject({ code: 'invalid' })
    const out = await grantAccess(nora, { email, fullName: 'Persona Asiento', role: 'finance', market: 'MX', seatApprover: 'Dueña del presupuesto', seatApprovedOn: new Date().toISOString().slice(0, 10), seatReference: 'Presupuesto 2027' }, D)
    const row = await one(admin<{ approver_name: string; reference: string; role: string }[]>`
      select s.approver_name, s.reference, m.role from crm.memberships m join crm.seat_approvals s on s.membership_id = m.id where m.user_id = ${out.userId}`)
    expect(row).toEqual({ approver_name: 'Dueña del presupuesto', reference: 'Presupuesto 2027', role: 'finance' })
    // la agencia también
    const ag = await one(admin<{ id: string }[]>`insert into crm.agencies (market_code, name) values ('US', ${`Agencia Asiento ${tag()}`}) returning id`)
    await expect(grantAgencyAccess(nora, { email: `ag.${tag()}@axexo.com`, fullName: 'Persona Agencia', agencyId: ag.id } as never, D)).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('E6.F8 · borrar y recargar un mercado en producción queda bloqueado y visible', () => {
  it('en producción no corre mientras la decisión siga pendiente, y el intento queda en la bitácora', async () => {
    const { resetTestMarket, productionResetState } = await import('@/domain/test-reset')
    const nora = await ctxFor('nora.salas')
    const prev = process.env.APP_ENV
    process.env.APP_ENV = 'production'
    try {
      await expect(resetTestMarket(nora, 'SV', 'BORRAR SV')).rejects.toMatchObject({ code: 'forbidden' })
    } finally {
      process.env.APP_ENV = prev
    }
    expect((await admin`select 1 from crm.audit_events where action = 'market.reset_blocked'`).length).toBe(1)
    expect(await withSystem((tx) => productionResetState(tx))).toBe('blocked')
    expect((await admin`select 1 from crm.accounts where market_code = 'SV'`).length).toBeGreaterThanOrEqual(0)
  })
})
