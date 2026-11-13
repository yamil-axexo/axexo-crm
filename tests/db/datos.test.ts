import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId } from './helpers'
import { withSystem } from '@/server/db'
import { addContact, addContactLinked, createAccount, setParent } from '@/domain/accounts'
import { setPrimaryContact, createField } from '@/domain/b2b'
import { addAlias, closeAlias, createAliasSystem, dismissPair, endContact, mergeAccounts, reviewBypass, scanDuplicates, survivors, undoMerge, updateContact } from '@/domain/datos'
import { createMarket, createProcessList, createRoutingRule, createWebForm, decideField, proposeField, setAccountProduct, setProcessStatus, setProviderSla, setQualityRule, setTypeDepth,
  updateField, updateMarket } from '@/domain/gobierno'
import { accountIdentity, dataCatalogs, duplicateQueue, fieldRegistry, nodeTotals, productMatrix, qualityBoard, qualityQueue } from '@/dal/datos'
import { getAccount, searchAll } from '@/dal/accounts'
import { fieldDefs } from '@/dal/fields'
import { JOBS } from '@/server/jobs/registry'
import { CAPABILITIES } from '@/domain/policy'
import { AUDIT_ACTION } from '@/lib/audit'

// Paquete datos (0023_datos): DAT-04, DAT-01, DAT-02, DAT-03, DAT-05, GOB-01, GOB-02 y DAT-07.
const admin = owner()
const tag = () => Math.random().toString(36).slice(2, 8)
const one = async <T>(q: Promise<T[]>) => (await q)[0]!
const phone = () => `55 6${Math.floor(1000000 + Math.random() * 8999999)}`
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const audits = (action: string, id: string) => admin<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null }[]>`
  select before, after from crm.audit_events where action = ${action} and object_id = ${id} order by at desc`
const WHY = 'Es otra tienda del mismo dueño'

afterAll(async () => {
  await admin.end()
})

/** Un comercio de prueba creado directo en la base (dueño de las migraciones), para no depender del aviso de duplicado. */
async function rawAccount(market: 'MX' | 'US', who: string, extra: Record<string, string | null> = {}, type = 'store'): Promise<string> {
  const o = await personaId(who)
  const kind = type === 'store' || type === 'branch' ? 'store' : type === 'chain' || type === 'region' ? 'chain' : 'distributor'
  const row = await one(admin<{ id: string }[]>`
    insert into crm.accounts (market_code, kind, account_type, name, segment, owner_id, phone, email, address_line, locality, country, created_by)
    values (${market}, ${kind}, ${type}, ${extra.name ?? `Datos ${tag()} ${tag()}`}, ${market === 'US' ? 'dealer' : 'd2d'}, ${o}, ${extra.phone ?? null}, ${extra.email ?? null},
            ${extra.address_line ?? null}, ${extra.locality ?? null}, ${market}, ${o}) returning id`)
  return row.id
}
const mxPipe = async () => one(admin<{ id: string; stage: string }[]>`
  select p.id, (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'open' order by position limit 1) as stage from crm.pipelines p where p.market_code = 'MX' and p.motor = 'd2d'`)
async function rawDeal(accountId: string, who: string): Promise<string> {
  const p = await mxPipe()
  const row = await one(admin<{ id: string }[]>`
    insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, next_step, next_step_due)
    values ('MX', ${p.id}, ${p.stage}, ${accountId}, ${await personaId(who)}, ${`Alta datos ${tag()}`}, 'MXN', 'Llamar', now()::date + 3) returning id`)
  return row.id
}

describe('DAT-04 · duplicados y registro único', () => {
  it('correo, nombre más dirección e identificador externo son llaves fuertes, además del teléfono', async () => {
    const lucia = await ctxFor('lucia.vega')
    const mail = `tienda.${tag()}@ejemplo.test`
    const name = `Ferretería Los Pinos ${tag()}`
    const a = await rawAccount('MX', 'marco.pena', { name, email: mail, address_line: 'Calle Hidalgo 45, Col. Centro', locality: 'Puebla' })
    const byMail = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Sin parecido ${tag()}`, segment: 'd2d', email: mail })
    expect(byMail.duplicates?.[0]).toMatchObject({ id: a, match: 'email', strong: true })
    // la dirección se compara normalizada (acentos, signos, mayúsculas) y solo junto con el nombre igual
    const byAddress = await createAccount(lucia, { market: 'MX', kind: 'store', name: name.toUpperCase(), segment: 'd2d', addressLine: 'calle hidalgo 45 col centro', locality: 'PUEBLA' })
    expect(byAddress.duplicates?.[0]).toMatchObject({ id: a, match: 'name_address', strong: true })
    const nora = await ctxFor('nora.salas')
    const ext = `SA-${tag()}`
    await addAlias(nora, a, { system: 'sales_core', externalId: ext })
    const byId = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Otro sin parecido ${tag()}`, segment: 'd2d', externalId: ext.toLowerCase() })
    expect(byId.duplicates?.[0]).toMatchObject({ id: a, match: 'external_id', strong: true })
  })

  it('una llave fuerte exacta bloquea a quien vende; lo parecido se salta solo con motivo y queda para revisión', async () => {
    const lucia = await ctxFor('lucia.vega')
    const name = `Miscelánea Tulipanes ${tag()}`
    const tel = phone()
    const a = await rawAccount('MX', 'marco.pena', { name, phone: `+5255${tel.replace(/\D/g, '').slice(-8)}` })
    await expect(createAccount(lucia, { market: 'MX', kind: 'store', name: 'Nada que ver', segment: 'd2d', phone: `55${tel.replace(/\D/g, '').slice(-8)}`, force: true, reason: WHY })).rejects.toMatchObject({ code: 'duplicate_blocked' })
    // nombre parecido: aviso, y con "crear de todos modos" hace falta un motivo de verdad
    const similar = `${name} 2`
    expect((await createAccount(lucia, { market: 'MX', kind: 'store', name: similar, segment: 'd2d' })).duplicates?.[0]).toMatchObject({ id: a, match: 'name', strong: false })
    await expect(createAccount(lucia, { market: 'MX', kind: 'store', name: similar, segment: 'd2d', force: true })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createAccount(lucia, { market: 'MX', kind: 'store', name: similar, segment: 'd2d', force: true, reason: 'ok' })).rejects.toMatchObject({ code: 'invalid' })
    const made = await createAccount(lucia, { market: 'MX', kind: 'store', name: similar, segment: 'd2d', force: true, reason: WHY })
    expect(made.id).toBeTruthy()
    const bypass = await one(admin<{ id: string; reason: string; matched_ids: string[]; strong: boolean }[]>`select id, reason, matched_ids, strong from crm.duplicate_bypasses where account_id = ${made.id!}`)
    expect(bypass).toMatchObject({ reason: WHY, strong: false })
    expect(bypass.matched_ids).toContain(a)
    expect((await audits('duplicate.bypassed', made.id!))[0]?.after).toMatchObject({ reason: WHY })
    // la mesa de control (quien lidera el mercado) lo ve y lo revisa; quien vende no revisa
    const ana = await ctxFor('ana.robles')
    expect((await duplicateQueue(ana, 'MX', null)).bypasses.map((b) => b.id)).toContain(bypass.id)
    await expect(reviewBypass(lucia, bypass.id, '')).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not_found/) })
    await reviewBypass(ana, bypass.id, 'Confirmado con la dueña')
    expect((await duplicateQueue(ana, 'MX', null)).bypasses.map((b) => b.id)).not.toContain(bypass.id)
    // sin parecido, "force" no pide motivo ni deja aviso: no se saltó nada
    const clean = await createAccount(lucia, { market: 'MX', kind: 'store', name: `Zzqx ${tag()}${tag()}`, segment: 'd2d', force: true })
    expect((await admin`select 1 from crm.duplicate_bypasses where account_id = ${clean.id!}`).length).toBe(0)
  })

  it('reglas de supervivencia: gana el que se queda; si no tiene el dato toma el del otro; lo elegido a mano manda', () => {
    const s = { name: 'B', phone: '+525511112222', email: 'b@x.test', locality: 'León', region: null }
    const t = { name: 'A', phone: null, email: 'a@x.test', locality: 'Puebla', region: 'Puebla' }
    const out = survivors(s, t, { locality: 'source', email: 'target' })
    expect(out.name).toMatchObject({ winner: 'target', reason: 'kept', value: 'A' })
    expect(out.phone).toMatchObject({ winner: 'source', reason: 'filled', value: '+525511112222', previous: null })
    expect(out.locality).toMatchObject({ winner: 'source', reason: 'chosen', value: 'León', previous: 'Puebla' })
    expect(out.email).toMatchObject({ winner: 'target', reason: 'chosen', value: 'a@x.test' })
    expect(out.region).toMatchObject({ winner: 'target', value: 'Puebla' })
  })

  it('fusionar guarda la foto de los dos registros, mueve todo lo que colgaba y se puede deshacer', async () => {
    const nora = await ctxFor('nora.salas')
    const tel = `+5255${Math.floor(10000000 + Math.random() * 89999999)}`
    const target = await rawAccount('MX', 'marco.pena', { name: `Abarrotes Jacarandas ${tag()}`, locality: 'Puebla' })
    const source = await rawAccount('MX', 'lucia.vega', { name: `Abarrotes Jacarandas ${tag()}`, phone: tel, locality: 'Cholula', email: `jaca.${tag()}@ejemplo.test` })
    const deal = await rawDeal(source, 'lucia.vega')
    const contact = await addContact(nora, source, { fullName: 'Rosa Ibáñez', role: 'owner', phone: phone() })
    const shared = await addContactLinked(nora, target, { fullName: 'Hugo Prado', role: 'manager', phone: phone() })
    await admin`insert into crm.account_contacts (account_id, contact_id, market_code, role) values (${source}, ${shared.id}, 'MX', 'staff')`
    const alias = await addAlias(nora, source, { system: 'sales_core', externalId: `SA-${tag()}` })
    await admin`insert into crm.activities (market_code, account_id, kind, subject, owner_id) values ('MX', ${source}, 'note', 'Nota del duplicado', ${await personaId('lucia.vega')})`
    const child = await rawAccount('MX', 'lucia.vega')
    await admin`update crm.accounts set kind = 'chain', account_type = 'chain' where id = ${source}`
    await admin`update crm.accounts set parent_id = ${source}, account_type = 'branch' where id = ${child}`
    await admin`update crm.accounts set kind = 'chain', account_type = 'chain' where id = ${target}`

    // solo administración fusiona
    await expect(mergeAccounts(await ctxFor('ana.robles'), source, target)).rejects.toMatchObject({ code: 'forbidden' })
    const eventId = await mergeAccounts(nora, source, target, { picks: { locality: 'source' } })

    const ev = await one(admin<{ snapshot: { source: Record<string, unknown>; target: Record<string, unknown> }; moved: Record<string, string[]>; survivorship: { fields: Record<string, { winner: string; reason: string }> } }[]>`
      select snapshot, moved, survivorship from crm.merge_events where id = ${eventId}`)
    expect(ev.snapshot.source).toMatchObject({ id: source, phone: tel, locality: 'Cholula' })
    expect(ev.snapshot.target).toMatchObject({ id: target, phone: null, locality: 'Puebla' })
    expect(ev.moved.deals).toEqual([deal])
    expect(ev.moved.account_aliases).toEqual([alias])
    expect(ev.moved.children).toEqual([child])
    expect(ev.moved.contacts_closed).toHaveLength(1)
    expect(ev.survivorship.fields.phone).toMatchObject({ winner: 'source', reason: 'filled' })
    expect(ev.survivorship.fields.locality).toMatchObject({ winner: 'source', reason: 'chosen' })
    expect(ev.survivorship.fields.name).toMatchObject({ winner: 'target', reason: 'kept' })
    // el que queda tomó lo que no tenía y lo elegido; el otro quedó archivado apuntando a él
    expect(await one(admin`select phone, locality, email::text as email from crm.accounts where id = ${target}`)).toMatchObject({ phone: tel, locality: 'Cholula' })
    expect(await one(admin`select merged_into, archived_at is not null as archived from crm.accounts where id = ${source}`)).toMatchObject({ merged_into: target, archived: true })
    expect(await one(admin`select account_id from crm.deals where id = ${deal}`)).toMatchObject({ account_id: target })
    expect(await one(admin`select parent_id from crm.accounts where id = ${child}`)).toMatchObject({ parent_id: target })
    // el contacto compartido no quedó dos veces en el que queda; el otro contacto llegó
    expect((await getAccount(nora, target))!.contacts.map((c) => c.id).sort()).toEqual([contact, shared.id].sort())
    expect((await audits('account.merged', target))[0]?.after).toMatchObject({ merge_event_id: eventId })

    // después de fusionar se registra algo en el que quedó: eso no se va al deshacer
    await admin`insert into crm.activities (market_code, account_id, kind, subject) values ('MX', ${target}, 'note', 'Nota posterior a la fusión')`
    await expect(undoMerge(nora, eventId, '')).rejects.toMatchObject({ code: 'invalid' })
    await expect(undoMerge(await ctxFor('ana.robles'), eventId, 'No eran el mismo')).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not_found/) })
    await undoMerge(nora, eventId, 'No eran el mismo comercio')

    expect(await one(admin`select merged_into, archived_at, phone, locality from crm.accounts where id = ${source}`)).toMatchObject({ merged_into: null, archived_at: null, phone: tel, locality: 'Cholula' })
    expect(await one(admin`select phone, locality from crm.accounts where id = ${target}`)).toMatchObject({ phone: null, locality: 'Puebla' })
    expect(await one(admin`select account_id from crm.deals where id = ${deal}`)).toMatchObject({ account_id: source })
    expect(await one(admin`select account_id from crm.account_aliases where id = ${alias}`)).toMatchObject({ account_id: source })
    expect(await one(admin`select parent_id from crm.accounts where id = ${child}`)).toMatchObject({ parent_id: source })
    expect((await getAccount(nora, source))!.contacts.map((c) => c.id).sort()).toEqual([contact, shared.id].sort())
    expect((await getAccount(nora, target))!.contacts.map((c) => c.id)).toEqual([shared.id])
    expect(await one(admin<{ n: number }[]>`select count(*)::int as n from crm.activities where account_id = ${target} and subject = 'Nota posterior a la fusión'`)).toMatchObject({ n: 1 })
    expect(await one(admin<{ n: number }[]>`select count(*)::int as n from crm.activities where account_id = ${source} and subject = 'Nota del duplicado'`)).toMatchObject({ n: 1 })
    await expect(undoMerge(nora, eventId, 'Otra vez')).rejects.toMatchObject({ code: 'invalid' })
    expect((await audits('account.unmerged', target))[0]?.after).toMatchObject({ restored_id: source })
    // quien deshizo ya decidió: el par no vuelve a la cola
    const [a, b] = source < target ? [source, target] : [target, source]
    expect(await one(admin`select status from crm.duplicate_pairs where a_id = ${a} and b_id = ${b}`)).toMatchObject({ status: 'dismissed' })
  })

  it('la búsqueda en lote llena la cola con su llave; un par descartado no se vuelve a abrir', async () => {
    const ana = await ctxFor('ana.robles')
    const tel = `+5255${Math.floor(10000000 + Math.random() * 89999999)}`
    const x = await rawAccount('MX', 'marco.pena', { phone: tel })
    const y = await rawAccount('MX', 'lucia.vega', { phone: tel })
    await expect(scanDuplicates(await ctxFor('marco.pena'), 'MX')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(scanDuplicates(ana, 'US')).rejects.toMatchObject({ code: 'forbidden' })
    expect(await scanDuplicates(ana, 'MX')).toBeGreaterThan(0)
    const [a, b] = x < y ? [x, y] : [y, x]
    const pair = await one(admin<{ id: string; strong: boolean; match_kinds: string[]; status: string }[]>`select id, strong, match_kinds, status from crm.duplicate_pairs where a_id = ${a} and b_id = ${b}`)
    expect(pair).toMatchObject({ strong: true, status: 'open' })
    expect(pair.match_kinds).toContain('phone')
    const shown = (await duplicateQueue(ana, 'MX', pair.id)).pairs[0]!
    expect([shown.a.id, shown.b.id].sort()).toEqual([a, b].sort())
    // los fuertes van primero en la cola
    expect((await duplicateQueue(ana, 'MX', null)).pairs[0]!.strong).toBe(true)
    await expect(dismissPair(ana, pair.id, 'no')).rejects.toMatchObject({ code: 'invalid' })
    await dismissPair(ana, pair.id, 'Comparten el teléfono del corporativo')
    await scanDuplicates(ana, 'MX')
    expect(await one(admin`select status from crm.duplicate_pairs where id = ${pair.id}`)).toMatchObject({ status: 'dismissed' })
    // quien supervisa no ve la cola del mercado (RLS)
    expect((await duplicateQueue(await ctxFor('fernando.ibarra'), 'MX', null)).pairs).toHaveLength(0)
  })
})

describe('DAT-01 · jerarquía de N niveles con agregados', () => {
  it('los datos sembrados traen tres niveles reales y el nodo suma lo que cuelga de él', async () => {
    const sam = await ctxFor('sam.ortiz')
    const iso = await one(admin<{ id: string }[]>`select id from crm.accounts where name = 'Lone Star Payments ISO'`)
    const pdv = await one(admin<{ id: string; ancestor_ids: string[] }[]>`select id, ancestor_ids from crm.accounts where name = 'Frontera Wireless Laredo'`)
    expect(pdv.ancestor_ids).toHaveLength(2)
    expect(pdv.ancestor_ids[0]).toBe(iso.id)
    expect((await getAccount(sam, pdv.id))!.ancestors.map((x) => x.name)).toEqual(['Lone Star Payments ISO', 'Rio Grande Agents'])
    const before = await nodeTotals(sam, iso.id)
    expect(before).toMatchObject({ accounts: 4, active: 3, open_deals: 0 })
    const p = await one(admin<{ id: string; stage: string; won: string }[]>`
      select p.id, (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'open' order by position limit 1) as stage,
             (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'won' limit 1) as won from crm.pipelines p where p.market_code = 'US' and p.motor = 'dealer'`)
    await admin`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, amount_minor) values ('US', ${p.id}, ${p.stage}, ${pdv.id}, ${sam.user.id}, 'Alta de prueba', 'USD', 150000)`
    await admin`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, status, won_at) values ('US', ${p.id}, ${p.won}, ${pdv.id}, ${sam.user.id}, 'Alta ganada', 'USD', 'won', now())`
    expect(await nodeTotals(sam, iso.id)).toMatchObject({ open_deals: 1, open_amount: '150000', won_deals: 1 })
    const mx = await one(admin<{ ancestor_ids: string[] }[]>`select ancestor_ids from crm.accounts where name = 'La Colmena Sucursal Centro'`)
    expect(mx.ancestor_ids).toHaveLength(2)
  })

  it('mover una cuenta pide motivo y fecha efectiva, y conserva su historia, su atribución y a quien la lleva', async () => {
    const paula = await ctxFor('paula.mendez')
    const diana = await personaId('diana.cruz')
    const a = await rawAccount('MX', 'diana.cruz', {}, 'chain')
    const b = await rawAccount('MX', 'ivan.rios', {}, 'chain')
    const kid = await rawAccount('MX', 'diana.cruz', {}, 'branch')
    await admin`insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label) values (${kid}, 'MX', 'origin', 'user', ${diana}, 'Diana Cruz')`
    await admin`insert into crm.activities (market_code, account_id, kind, subject) values ('MX', ${kid}, 'note', 'Historia previa')`
    // la primera vez (cuenta independiente) no pide motivo
    await setParent(paula, kid, a)
    // moverla sí: sin motivo no pasa
    await expect(setParent(paula, kid, b)).rejects.toMatchObject({ code: 'invalid' })
    await expect(setParent(paula, kid, b, { reason: 'Se vendió la sucursal', effectiveOn: future(2) })).rejects.toMatchObject({ code: 'invalid' })
    await admin`update crm.account_links set valid_from = now() - interval '10 days' where child_id = ${kid}`
    const yesterday = future(-1)
    const out = await setParent(paula, kid, b, { reason: 'Se vendió la sucursal', effectiveOn: yesterday })
    expect(out.ownerDiffers).toBe(true)
    const links = await admin<{ parent_id: string; reason: string | null; to_day: string | null; from_day: string }[]>`
      select parent_id, reason, (valid_to at time zone 'America/Mexico_City')::date::text as to_day, (valid_from at time zone 'America/Mexico_City')::date::text as from_day
        from crm.account_links where child_id = ${kid} order by valid_from`
    expect(links).toHaveLength(2)
    expect(links[0]).toMatchObject({ parent_id: a, to_day: yesterday })
    expect(links[1]).toMatchObject({ parent_id: b, reason: 'Se vendió la sucursal', from_day: yesterday, to_day: null })
    // conserva dueño, atribución de origen e historia
    expect(await one(admin`select owner_id, parent_id from crm.accounts where id = ${kid}`)).toMatchObject({ owner_id: diana, parent_id: b })
    expect((await admin`select 1 from crm.account_attributions where account_id = ${kid} and layer = 'origin' and party_ref = ${diana} and effective_to is null`).length).toBe(1)
    expect((await admin`select 1 from crm.activities where account_id = ${kid} and subject = 'Historia previa'`).length).toBe(1)
    expect((await audits('account.parent_changed', kid))[0]?.after).toMatchObject({ reason: 'Se vendió la sucursal', effective_on: yesterday, owner_differs_from_parent: true })
    const moves = (await accountIdentity(paula, kid, 'MX')).moves
    expect(moves[0]).toMatchObject({ reason: 'Se vendió la sucursal', valid_to: null })
    // sacarla del árbol también pide motivo
    await expect(setParent(paula, kid, null)).rejects.toMatchObject({ code: 'invalid' })
    await setParent(paula, kid, null, { reason: 'Ahora es independiente' })
  })

  it('profundidad máxima por tipo: la regla vive en el catálogo, el dominio la explica y la base la impide', async () => {
    const nora = await ctxFor('nora.salas')
    const typeId = (await one(admin<{ id: string }[]>`select id from crm.account_types where code = 'aggregator' and market_code is null`)).id
    await setTypeDepth(nora, typeId, 2)
    expect((await audits('account_type.depth_set', typeId))[0]?.after).toMatchObject({ max_depth: 2 })
    const root = await rawAccount('MX', 'diana.cruz', {}, 'aggregator')
    const mid = await rawAccount('MX', 'diana.cruz', {}, 'distributor')
    const leaf = await rawAccount('MX', 'diana.cruz', {}, 'branch')
    await setParent(nora, mid, root)
    await expect(setParent(nora, leaf, mid)).rejects.toMatchObject({ code: 'invalid' })
    await expect(admin`update crm.accounts set parent_id = ${mid} where id = ${leaf}`).rejects.toMatchObject({ code: '23514' })
    // con un nivel más, entra; y el límite no baja por debajo de un árbol que ya existe
    await setTypeDepth(nora, typeId, 3)
    await setParent(nora, leaf, mid)
    await expect(setTypeDepth(nora, typeId, 2)).rejects.toMatchObject({ code: 'invalid' })
    await expect(setTypeDepth(await ctxFor('ana.robles'), typeId, 5)).rejects.toMatchObject({ code: 'forbidden' })
    await setTypeDepth(nora, typeId, 4)
  })
})

describe('DAT-02 · contacto y cuenta con rol y vigencia', () => {
  it('la misma persona en dos cuentas es un solo contacto, con su rol en cada una', async () => {
    const diana = await ctxFor('diana.cruz')
    const a = await rawAccount('MX', 'diana.cruz')
    const b = await rawAccount('MX', 'diana.cruz')
    const tel = phone()
    const first = await addContactLinked(diana, a, { fullName: 'Marta Leal', role: 'owner', phone: tel })
    expect(first.linked).toBe(false)
    const second = await addContactLinked(diana, b, { fullName: 'Marta L.', role: 'decision_maker', phone: tel })
    expect(second).toMatchObject({ id: first.id, linked: true, name: 'Marta Leal' })
    expect(await one(admin<{ n: number }[]>`select count(*)::int as n from crm.contacts where id = ${first.id}`)).toMatchObject({ n: 1 })
    expect((await getAccount(diana, b))!.contacts[0]).toMatchObject({ id: first.id, role: 'decision_maker', full_name: 'Marta Leal' })
    expect((await accountIdentity(diana, a, 'MX')).otherAccounts.get(first.id)?.map((x) => x.id)).toEqual([b])
    // no se liga dos veces a la misma cuenta
    await expect(addContactLinked(diana, b, { fullName: 'Marta Leal', role: 'staff', phone: tel })).rejects.toMatchObject({ code: 'invalid' })
    // se encuentra aunque la otra cuenta sea de alguien más y esta persona no la vea
    const other = await rawAccount('MX', 'ivan.rios')
    const hidden = await addContactLinked(await ctxFor('ivan.rios'), other, { fullName: 'Marta Leal', role: 'billing', phone: tel })
    expect(hidden).toMatchObject({ id: first.id, linked: true })
  })

  it('editar, cambiar al principal como acción explícita con su historia, y dar de baja con fecha y motivo', async () => {
    const diana = await ctxFor('diana.cruz')
    const acc = await rawAccount('MX', 'diana.cruz')
    const c1 = await addContact(diana, acc, { fullName: 'Julio Sáenz', role: 'manager', phone: phone() })
    const c2 = await addContact(diana, acc, { fullName: 'Irene Mora', role: 'staff', phone: phone() })
    await updateContact(diana, acc, c2, { fullName: 'Irene Mora Díaz', role: 'billing', phone: '', email: 'irene@ejemplo.test' })
    expect((await getAccount(diana, acc))!.contacts.find((c) => c.id === c2)).toMatchObject({ full_name: 'Irene Mora Díaz', role: 'billing', email: 'irene@ejemplo.test', phone: null })
    expect((await audits('contact.updated', acc))[0]?.after).toMatchObject({ name: 'Irene Mora Díaz', role: 'billing' })
    await expect(updateContact(diana, acc, c2, { fullName: 'Irene', role: 'no_existe' })).rejects.toMatchObject({ code: 'invalid' })
    // el principal no se da de baja mientras haya otros: primero se elige quién queda
    await expect(endContact(diana, acc, c1, 'Ya no trabaja ahí')).rejects.toMatchObject({ code: 'invalid' })
    await setPrimaryContact(diana, acc, c2)
    const turns = (await accountIdentity(diana, acc, 'MX')).primaries
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ full_name: 'Irene Mora Díaz', to_at: null, by_name: 'Diana Cruz' })
    expect(turns[1]!.full_name).toBe('Julio Sáenz')
    expect(turns[1]!.to_at).not.toBeNull()
    await expect(endContact(diana, acc, c1, '')).rejects.toMatchObject({ code: 'invalid' })
    await endContact(diana, acc, c1, 'Ya no trabaja ahí')
    expect((await getAccount(diana, acc))!.contacts.map((c) => c.id)).toEqual([c2])
    expect((await accountIdentity(diana, acc, 'MX')).past[0]).toMatchObject({ full_name: 'Julio Sáenz', end_reason: 'Ya no trabaja ahí' })
    expect((await audits('contact.ended', acc))[0]?.after).toMatchObject({ reason: 'Ya no trabaja ahí' })
    // quien solo lee no cambia contactos
    await expect(endContact(await ctxFor('luis.tovar'), acc, c2, 'Prueba de permiso')).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not_found/) })
  })
})

describe('DAT-03 · alias de identificadores externos', () => {
  it('alta manual con bitácora, búsqueda por cualquier alias, choque detectado y cierre con vigencia', async () => {
    const valeria = await ctxFor('valeria.soto')
    const a = await rawAccount('MX', 'marco.pena')
    const b = await rawAccount('MX', 'lucia.vega')
    const ext = `ZH-${tag()}${tag()}`.toUpperCase()
    const aliasId = await addAlias(valeria, a, { system: 'zoho', externalId: ext, note: 'Lo dio el comercio' })
    expect((await audits('alias.added', a))[0]?.after).toMatchObject({ system: 'zoho', external_id: ext })
    expect((await admin`select 1 from crm.outbox_events where event_type = 'account.alias_issued' and aggregate_id = ${a}`).length).toBe(1)
    expect((await searchAll(valeria, ext)).accounts.map((x) => x.id)).toContain(a)
    // choque: el mismo ID no puede ser de dos comercios, y se dice de quién es
    await expect(addAlias(valeria, b, { system: 'zoho', externalId: ext })).rejects.toMatchObject({ code: 'invalid', es: expect.stringContaining('ya es de') })
    await expect(addAlias(valeria, a, { system: 'zoho', externalId: ext })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addAlias(valeria, a, { system: 'no_existe', externalId: 'X1' })).rejects.toMatchObject({ code: 'invalid' })
    // un PDV cambia de ID: el anterior se cierra con fecha y el nuevo entra
    await expect(closeAlias(valeria, aliasId, '')).rejects.toMatchObject({ code: 'invalid' })
    await closeAlias(valeria, aliasId, 'El proveedor le cambió el ID')
    expect(await one(admin`select valid_to is not null as closed, note from crm.account_aliases where id = ${aliasId}`)).toMatchObject({ closed: true, note: 'El proveedor le cambió el ID' })
    await addAlias(valeria, b, { system: 'zoho', externalId: ext })
    const identity = await accountIdentity(valeria, a, 'MX')
    expect(identity.aliases.find((x) => x.id === aliasId)).toMatchObject({ external_id: ext, label_es: 'Zoho' })
    expect(identity.aliases.find((x) => x.id === aliasId)!.valid_to).not.toBeNull()
    // quien vende no agrega alias; la base repite el límite
    await expect(addAlias(await ctxFor('marco.pena'), a, { system: 'zoho', externalId: `ZH-${tag()}` })).rejects.toMatchObject({ code: 'forbidden' })
    expect(await asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${a}, 'MX', 'zoho', 'DIRECTO-1')`))).toBe('42501')
  })

  it('los sistemas de origen son un catálogo: InComm y proveedores vienen de la migración y administración agrega más', async () => {
    const nora = await ctxFor('nora.salas')
    const codes = (await dataCatalogs(nora)).systems.map((s) => s.code)
    expect(codes).toEqual(expect.arrayContaining(['sales_core', 's5', 'pipedrive', 'zoho', 'emida', 'sky', 'movilway', 'incomm', 'carrier']))
    const code = await createAliasSystem(nora, { labelEs: `Operador prueba ${tag()}`, labelEn: `Test carrier ${tag()}`, kind: 'carrier', market: 'US' })
    const acc = await rawAccount('US', 'sam.ortiz')
    await addAlias(nora, acc, { system: code, externalId: `OP-${tag()}` })
    // un sistema de US no se ofrece en MX
    await expect(addAlias(nora, await rawAccount('MX', 'marco.pena'), { system: code, externalId: `OP-${tag()}` })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createAliasSystem(await ctxFor('ana.robles'), { labelEs: 'Otro sistema', labelEn: 'Another system', kind: 'other' })).rejects.toMatchObject({ code: 'forbidden' })
    // un número de tarjeta no entra como identificador
    await expect(addAlias(nora, acc, { system: 'other', externalId: ['4111', '1111', '1111', '1111'].join(' ') })).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('DAT-05 / GOB-01 · campos como metadata con registro', () => {
  it('sin decisión documentada no hay campo; el registro guarda dueño, propósito, revisión y clase de dato', async () => {
    const nora = await ctxFor('nora.salas')
    const name = `Prueba datos giro ${tag()}`
    await expect(createField(nora, { object: 'account', market: 'MX', motor: '', labelEs: name, labelEn: `${name} en`, dataType: 'text' })).rejects.toMatchObject({ code: 'invalid' })
    const id = await createField(nora, { object: 'account', market: 'MX', motor: '', labelEs: name, labelEn: `${name} en`, dataType: 'select', options: ['Uno', 'Dos'], decision: 'Decide qué surtido se le ofrece' })
    expect(await one(admin`select decision, owner_id, review_on is not null as has_review, status from crm.field_definitions where id = ${id}`)).toMatchObject({ decision: 'Decide qué surtido se le ofrece', owner_id: nora.user.id, has_review: true, status: 'approved' })
    const ana = await personaId('ana.robles')
    const gov = { ownerId: ana, purpose: 'Saber el giro del comercio', decision: 'Decide qué surtido y qué material se le ofrece', reviewOn: future(120), piiClass: 'none' as const, origin: 'Lo captura quien vende', usedBy: 'Ventas y reportes' }
    await expect(updateField(nora, id, { labelEs: `${name} v2`, labelEn: `${name} v2 en`, ...gov, decision: 'corta' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateField(nora, id, { labelEs: `${name} v2`, labelEn: `${name} v2 en`, ...gov, reviewOn: future(-3) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateField(nora, id, { labelEs: `${name} v2`, labelEn: `${name} v2 en`, options: ['Uno'], ...gov })).rejects.toMatchObject({ code: 'invalid' })
    await updateField(nora, id, { labelEs: `${name} v2`, labelEn: `${name} v2 en`, options: ['Uno', 'Dos', 'Tres'], ...gov, piiClass: 'personal', untrusted: true })
    const row = (await fieldRegistry(nora, 'vigentes')).fields.find((f) => f.id === id)!
    expect(row).toMatchObject({ label_es: `${name} v2`, owner_name: 'Ana Robles', pii_class: 'personal', untrusted: true, origin: 'Lo captura quien vende', used_by: 'Ventas y reportes', options: ['Uno', 'Dos', 'Tres'], filled: 0 })
    expect(row.total).toBeGreaterThan(0)
    // la llave no cambia al cambiar la etiqueta: lo capturado no se pierde
    expect(await one(admin`select key from crm.field_definitions where id = ${id}`)).toMatchObject({ key: expect.stringContaining('prueba_datos_giro') })
    expect((await audits('field.updated', id))[0]?.after).toMatchObject({ owner_id: ana, pii_class: 'personal' })
    await expect(updateField(await ctxFor('ana.robles'), id, { labelEs: name, labelEn: name, ...gov })).rejects.toMatchObject({ code: 'forbidden' })
    // los campos sin decisión (los sembrados, los de Pipedrive) salen en su propia vista
    expect((await fieldRegistry(nora, 'sin-decision')).counts.sin_decision).toBeGreaterThan(0)
    await admin`update crm.field_definitions set is_active = false where id = ${id}`
  })

  it('quien lidera un mercado propone para su mercado; el campo no aparece hasta que administración lo aprueba', async () => {
    const ana = await ctxFor('ana.robles')
    const nora = await ctxFor('nora.salas')
    const name = `Prueba datos horario ${tag()}`
    const gov = { ownerId: ana.user.id, purpose: 'Saber cuándo visitar', decision: 'Decide a qué hora se programa la visita', reviewOn: future(90), piiClass: 'none' as const }
    await expect(proposeField(ana, { object: 'account', market: 'US', labelEs: name, labelEn: `${name} en`, dataType: 'text', ...gov })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(proposeField(await ctxFor('fernando.ibarra'), { object: 'account', market: 'MX', labelEs: name, labelEn: `${name} en`, dataType: 'text', ...gov })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(proposeField(ana, { object: 'account', market: 'MX', labelEs: name, labelEn: `${name} en`, dataType: 'text', ...gov, decision: '' })).rejects.toMatchObject({ code: 'invalid' })
    const id = await proposeField(ana, { object: 'account', market: 'MX', labelEs: name, labelEn: `${name} en`, dataType: 'text', ...gov })
    const key = (await one(admin<{ key: string }[]>`select key from crm.field_definitions where id = ${id}`)).key
    expect((await fieldDefs(ana, 'account', 'MX', 'd2d')).map((f) => f.key)).not.toContain(key)
    expect((await fieldRegistry(ana, 'propuestos')).fields.find((f) => f.id === id)).toMatchObject({ status: 'proposed', proposed_by: 'Ana Robles', overdue: false })
    // quien lidera no puede meter un campo aprobado por fuera de la propuesta (RLS), ni aprobar el suyo
    expect(await asPersona('ana.robles', (tx) => attempt(tx, (sp) => sp`insert into crm.field_definitions (object, key, label_es, label_en, data_type, market_code) values ('account', ${`directo_${tag()}`}, 'Directo', 'Direct', 'text', 'MX')`))).toBe('42501')
    await expect(decideField(ana, id, true, '')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(decideField(nora, id, false, '')).rejects.toMatchObject({ code: 'invalid' })
    await decideField(nora, id, true, '')
    expect((await fieldDefs(ana, 'account', 'MX', 'd2d')).map((f) => f.key)).toContain(key)
    await expect(decideField(nora, id, true, '')).rejects.toMatchObject({ code: 'invalid' })
    // una propuesta rechazada queda con su motivo y no se muestra
    const no = await proposeField(ana, { object: 'deal', market: 'MX', labelEs: `${name} dos`, labelEn: `${name} two`, dataType: 'boolean', ...gov })
    await decideField(nora, no, false, 'Ya existe un campo con ese dato')
    expect(await one(admin`select status, is_active, decision_note from crm.field_definitions where id = ${no}`)).toMatchObject({ status: 'rejected', is_active: false, decision_note: 'Ya existe un campo con ese dato' })
    // pasado el plazo publicado, la propuesta sale marcada
    const late = await proposeField(ana, { object: 'lead', market: 'MX', labelEs: `${name} tres`, labelEn: `${name} three`, dataType: 'text', ...gov })
    await admin`update crm.field_definitions set proposed_at = now() - interval '9 days' where id = ${late}`
    expect((await fieldRegistry(nora, 'propuestos')).fields.find((f) => f.id === late)).toMatchObject({ overdue: true })
    await admin`update crm.field_definitions set is_active = false where id = ${id}`
  })

  it('un mercado, un formulario web y un turno nuevos se crean desde la pantalla, sin migración', async () => {
    const nora = await ctxFor('nora.salas')
    const code = await createMarket(nora, { code: 'co', name: 'Colombia', currency: 'cop', locale: 'es', timezone: 'America/Bogota', phoneCc: '+57' })
    expect(code).toBe('CO')
    expect(await one(admin`select status, currency::text as currency, timezone from crm.markets where code = 'CO'`)).toMatchObject({ status: 'planned', currency: 'COP', timezone: 'America/Bogota' })
    expect((await admin`select 1 from crm.market_hours where market_code = 'CO'`).length).toBe(1)
    await expect(createMarket(nora, { code: 'CO', name: 'Colombia', currency: 'COP', locale: 'es', timezone: 'America/Bogota', phoneCc: '+57' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createMarket(nora, { code: 'PE', name: 'Perú', currency: 'PEN', locale: 'es', timezone: 'Lima', phoneCc: '+51' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createMarket(await ctxFor('ana.robles'), { code: 'PE', name: 'Perú', currency: 'PEN', locale: 'es', timezone: 'America/Lima', phoneCc: '+51' })).rejects.toMatchObject({ code: 'forbidden' })
    // no se abre sin embudo
    await expect(updateMarket(nora, 'CO', { name: 'Colombia', status: 'live' })).rejects.toMatchObject({ code: 'invalid' })
    await admin`insert into crm.pipelines (id, market_code, motor, name) values (app.uuid_v7(), 'CO', 'd2d', 'Tiendas Colombia')`
    await admin`insert into crm.stages (pipeline_id, position, code, name_es, name_en, kind) select id, 1, 'new', 'Nuevo', 'New', 'open' from crm.pipelines where market_code = 'CO'`
    await updateMarket(nora, 'CO', { name: 'Colombia', status: 'live' })
    expect((await admin`select 1 from crm.audit_events where action = 'market.updated' and market_code = 'CO'`).length).toBe(1)

    const marco = await personaId('marco.pena')
    const jade = await personaId('jade.kim')
    await expect(createRoutingRule(nora, { market: 'MX', name: `Turno datos ${tag()}`, strategy: 'round_robin', memberIds: [jade], slaMinutes: 30 })).rejects.toMatchObject({ code: 'invalid' })
    const rule = await createRoutingRule(nora, { market: 'MX', name: `Turno datos ${tag()}`, strategy: 'round_robin', memberIds: [marco], slaMinutes: 30 })
    const slug = `datos-${tag()}`
    await expect(createWebForm(nora, { market: 'MX', name: 'Formulario de prueba', slug: 'Con Espacios', motor: 'd2d', locale: 'es' })).rejects.toMatchObject({ code: 'invalid' })
    const form = await createWebForm(nora, { market: 'MX', name: 'Formulario de prueba', slug, motor: 'd2d', locale: 'es', routingRuleId: rule })
    await expect(createWebForm(nora, { market: 'MX', name: 'Otro', slug, motor: 'd2d', locale: 'es' })).rejects.toMatchObject({ code: 'invalid' })
    // el formulario nuevo ya es público por su dirección
    expect((await admin`select 1 from app.form_public(${slug})`).length).toBe(1)
    const cat = await dataCatalogs(nora)
    expect(cat.forms.find((f) => f.id === form)).toMatchObject({ slug, is_active: true })
    expect(cat.rules.find((r) => r.id === rule)).toMatchObject({ members: ['Marco Peña'], sla_minutes: 30 })
    expect(cat.markets.find((m) => m.code === 'CO')).toMatchObject({ status: 'live' })
    await admin`update crm.web_forms set is_active = false where id = ${form}`
    await admin`update crm.routing_rules set is_active = false where id = ${rule}`
  })

  it('procesos paralelos por mercado: una lista con sus estados y sus datos, sin tocar el embudo', async () => {
    const ana = await ctxFor('ana.robles')
    const marco = await ctxFor('marco.pena')
    await expect(createProcessList(marco, { market: 'MX', nameEs: 'Campaña', nameEn: 'Campaign', statuses: ['Invitado', 'Inscrito'], attributes: [] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createProcessList(ana, { market: 'US', nameEs: 'Campaña', nameEn: 'Campaign', statuses: ['Invitado', 'Inscrito'], attributes: [] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createProcessList(ana, { market: 'MX', nameEs: 'Campaña', nameEn: 'Campaign', statuses: ['Solo uno'], attributes: [] })).rejects.toMatchObject({ code: 'invalid' })
    const list = await createProcessList(ana, { market: 'MX', nameEs: `Campaña de prueba ${tag()}`, nameEn: `Test campaign ${tag()}`,
      statuses: ['Invitado | Invited', 'Inscrito | Enrolled', 'Terminó | Finished'], attributes: ['Material entregado | Material delivered'] })
    const acc = await rawAccount('MX', 'marco.pena')
    await setProcessStatus(marco, acc, list, 'invited', { material_delivered: 'Cartel y volantes' })
    let p = (await accountIdentity(marco, acc, 'MX')).processes.find((x) => x.list_id === list)!
    expect(p).toMatchObject({ status: 'invited', attrs: { material_delivered: 'Cartel y volantes' }, ended_at: null })
    await expect(setProcessStatus(marco, acc, list, 'no_existe')).rejects.toMatchObject({ code: 'invalid' })
    // el último estado cierra el proceso
    await setProcessStatus(marco, acc, list, 'finished', { material_delivered: 'Cartel y volantes' })
    p = (await accountIdentity(marco, acc, 'MX')).processes.find((x) => x.list_id === list)!
    expect(p.status).toBe('finished')
    expect(p.ended_at).not.toBeNull()
    expect((await audits('process.status_changed', acc))[0]?.after).toMatchObject({ status: 'finished', closed: true })
    // una lista de MX no se usa en un comercio de US
    await expect(setProcessStatus(await ctxFor('nora.salas'), await rawAccount('US', 'sam.ortiz'), list, 'invited')).rejects.toMatchObject({ code: 'invalid' })
    // el embudo no cambió: el comercio sigue sin negocios
    expect((await admin`select 1 from crm.deals where account_id = ${acc}`).length).toBe(0)
    await admin`update crm.process_lists set is_active = false where id = ${list}`
  })
})

describe('GOB-02 · tablero de calidad de datos', () => {
  it('cada regla tiene responsable y se mide por mercado y equipo; cada quien mide lo que ve', async () => {
    const nora = await ctxFor('nora.salas')
    const board = await qualityBoard(nora)
    expect(board.rules.map((r) => r.code)).toEqual(expect.arrayContaining(['no_owner', 'no_phone', 'no_contact', 'no_address', 'no_coords', 'no_alias', 'duplicate', 'bypass', 'stale', 'deal_no_step', 'provider_late', 'field_review']))
    expect(board.rules.every((r) => !!r.owner_role)).toBe(true)
    const mx = board.cells.filter((c) => c.market_code === 'MX' && c.rule_code === 'no_address')
    expect(mx.reduce((a, c) => a + c.total, 0)).toBeGreaterThan(300)
    expect(new Set(mx.map((c) => c.team_name)).has('D2D Centro')).toBe(true)
    expect(board.cells.some((c) => c.market_code === 'US')).toBe(true)
    // supervisión mide solo lo de su equipo y su mercado
    const fer = await qualityBoard(await ctxFor('fernando.ibarra'))
    expect(fer.cells.every((c) => c.market_code === 'MX')).toBe(true)
    const ferTotal = fer.cells.filter((c) => c.rule_code === 'no_address').reduce((a, c) => a + c.total, 0)
    expect(ferTotal).toBeGreaterThan(0)
    expect(ferTotal).toBeLessThan(mx.reduce((a, c) => a + c.total, 0))
    // la regla de proveedor fuera de plazo cuenta lo sembrado en US
    const late = board.cells.filter((c) => c.market_code === 'US' && c.rule_code === 'provider_late').reduce((a, c) => a + c.failing, 0)
    expect(late).toBeGreaterThanOrEqual(1)
    // responsable de la regla
    const ana = await personaId('ana.robles')
    await expect(setQualityRule(await ctxFor('ana.robles'), 'stale', { ownerRole: 'supervisor', ownerId: '', threshold: 90, active: true })).rejects.toMatchObject({ code: 'forbidden' })
    await setQualityRule(nora, 'stale', { ownerRole: 'market_lead', ownerId: ana, threshold: 90, active: true })
    expect((await qualityBoard(nora)).rules.find((r) => r.code === 'stale')).toMatchObject({ owner_role: 'market_lead', owner_name: 'Ana Robles', threshold: 90 })
  })

  it('el número lleva a la cola que lo corrige, y corregir el registro lo saca de la cola', async () => {
    const fer = await ctxFor('fernando.ibarra')
    const acc = await rawAccount('MX', 'marco.pena', { phone: null })
    const queue = await qualityQueue(fer, 'no_phone', 'MX')
    expect(queue.map((q) => q.id)).toContain(acc)
    expect(queue.find((q) => q.id === acc)).toMatchObject({ kind: 'account', who: 'Marco Peña' })
    await admin`update crm.accounts set phone = '+525512340000' where id = ${acc}`
    expect((await qualityQueue(fer, 'no_phone', 'MX')).map((q) => q.id)).not.toContain(acc)
    // datos vencidos: sin movimiento por más días que el umbral
    const old = await rawAccount('MX', 'marco.pena')
    await admin`alter table crm.accounts disable trigger accounts_touch`
    await admin`update crm.accounts set updated_at = now() - interval '400 days' where id = ${old}`
    await admin`alter table crm.accounts enable trigger accounts_touch`
    expect((await qualityQueue(fer, 'stale', 'MX')).map((q) => q.id)).toContain(old)
    // un negocio abierto sin próximo paso sale en su cola
    const deal = await rawDeal(acc, 'marco.pena')
    await admin`update crm.deals set next_step = null, next_step_due = null where id = ${deal}`
    expect((await qualityQueue(fer, 'deal_no_step', 'MX')).find((q) => q.id === deal)).toMatchObject({ kind: 'deal' })
  })

  it('el corte diario es una tarea registrada, segura de correr dos veces, y de ahí sale la tendencia', async () => {
    const keys = JOBS.map((j) => j.key)
    expect(keys).toEqual(expect.arrayContaining(['datos.duplicate_scan', 'datos.quality_snapshot']))
    const snap = JOBS.find((j) => j.key === 'datos.quality_snapshot')!
    const first = await withSystem((tx) => snap.run(tx))
    expect(first.done).toBeGreaterThan(10)
    const n1 = (await one(admin<{ n: number }[]>`select count(*)::int as n from crm.quality_snapshots`)).n
    await withSystem((tx) => snap.run(tx))
    expect((await one(admin<{ n: number }[]>`select count(*)::int as n from crm.quality_snapshots`)).n).toBe(n1)
    // un corte de hace 10 días con otro número: la tendencia lo trae
    await admin`insert into crm.quality_snapshots (as_of, market_code, team_id, rule_code, total, failing) values (now()::date - 10, 'MX', null, 'no_phone', 300, 42)`
    const nora = await ctxFor('nora.salas')
    const trend = (await qualityBoard(nora)).trend.filter((x) => x.market_code === 'MX' && x.rule_code === 'no_phone')
    expect(trend[0]).toMatchObject({ failing: 42 })
    expect(trend.length).toBeGreaterThanOrEqual(2)
    // supervisión lee los cortes de su equipo, no los del mercado completo
    const rows = await asPersona('fernando.ibarra', (tx) => tx<{ team_id: string | null }[]>`select team_id from crm.quality_snapshots`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.team_id !== null)).toBe(true)
    // la búsqueda de duplicados también corre como tarea
    const scan = JOBS.find((j) => j.key === 'datos.duplicate_scan')!
    expect((await withSystem((tx) => scan.run(tx))).done).toBeGreaterThanOrEqual(0)
    // quien vende no puede disparar el corte
    expect(await asPersona('marco.pena', (tx) => attempt(tx, (sp) => sp`select app.quality_snapshot()`))).toBe('42501')
  })
})

describe('DAT-07 · catálogo de productos y matriz por comercio', () => {
  it('cada comercio lleva sus productos con estado y fechas; el reloj es del proveedor', async () => {
    const tom = await ctxFor('tom.reyes')
    const nora = await ctxFor('nora.salas')
    const acc = await rawAccount('US', 'sam.ortiz')
    const sim = await one(admin<{ id: string; provider_id: string }[]>`select id, provider_id from crm.products where code = 'OPS-SIM'`)
    expect(sim.provider_id).toBeTruthy()
    await expect(setAccountProduct(await ctxFor('sam.ortiz'), acc, { productId: sim.id, providerId: '', status: 'requested' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setAccountProduct(tom, acc, { productId: sim.id, providerId: '', status: 'no_existe' })).rejects.toMatchObject({ code: 'invalid' })
    const id = await setAccountProduct(tom, acc, { productId: sim.id, providerId: '', status: 'requested' })
    // toma el proveedor del producto
    expect(await one(admin`select provider_id, status from crm.account_products where id = ${id}`)).toMatchObject({ provider_id: sim.provider_id, status: 'requested' })
    await setAccountProduct(tom, acc, { productId: sim.id, providerId: '', status: 'submitted' })
    let item = (await accountIdentity(tom, acc, 'US')).products[0]!
    expect(item).toMatchObject({ status: 'submitted', late: false, sla_days: 28 })
    expect(item.submitted_at).not.toBeNull()
    // pasado el plazo del proveedor, queda fuera de plazo; con otro plazo, ya no
    await admin`update crm.account_products set submitted_at = now() - interval '30 days' where id = ${id}`
    item = (await accountIdentity(tom, acc, 'US')).products[0]!
    expect(item.late).toBe(true)
    expect((await productMatrix(tom, { market: 'US', provider: null, status: null, late: true })).rows.map((r) => r.id)).toContain(id)
    await expect(setProviderSla(tom, sim.provider_id, 45)).rejects.toMatchObject({ code: 'forbidden' })
    await setProviderSla(nora, sim.provider_id, 45)
    expect((await accountIdentity(tom, acc, 'US')).products[0]!.late).toBe(false)
    await setProviderSla(nora, sim.provider_id, 28)
    await setAccountProduct(tom, acc, { productId: sim.id, providerId: '', status: 'active' })
    const events = await admin<{ from_status: string | null; to_status: string }[]>`select from_status, to_status from crm.account_product_events where account_product_id = ${id} order by at, id`
    expect(events.map((e) => e.to_status)).toEqual(['requested', 'submitted', 'active'])
    expect((await audits('account.product_set', acc))[0]?.after).toMatchObject({ status: 'active' })
    // filtros de la matriz: por proveedor y por estado
    const rows = (await productMatrix(tom, { market: 'US', provider: sim.provider_id, status: 'active', late: false })).rows
    expect(rows.map((r) => r.id)).toContain(id)
    expect(rows.every((r) => r.status === 'active')).toBe(true)
    // un producto de US no entra en un comercio de MX
    await expect(setAccountProduct(nora, await rawAccount('MX', 'marco.pena'), { productId: sim.id, providerId: '', status: 'requested' })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('un solo modelo: el estado por proveedor que Operaciones marca en un negocio escribe la matriz del comercio', async () => {
    const tom = await ctxFor('tom.reyes')
    const acc = await rawAccount('US', 'sam.ortiz')
    const p = await one(admin<{ id: string; stage: string }[]>`
      select p.id, (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'open' order by position limit 1) as stage from crm.pipelines p where p.market_code = 'US' and p.motor = 'dealer'`)
    const deal = (await one(admin<{ id: string }[]>`insert into crm.deals (market_code, pipeline_id, stage_id, account_id, title, currency) values ('US', ${p.id}, ${p.stage}, ${acc}, 'Alta dealer datos', 'USD') returning id`)).id
    const coast = (await one(admin<{ id: string }[]>`select id from crm.ops_catalog where kind = 'provider' and code = 'carrier_coast'`)).id
    const doc = (await one(admin<{ id: string }[]>`select id from crm.ops_catalog where kind = 'document' and market_code = 'US' limit 1`)).id
    await admin`insert into crm.deal_ops_checks (deal_id, market_code, catalog_id, status, on_date) values (${deal}, 'US', ${coast}, 'sent', now()::date - 2)`
    // un documento no es un producto: no entra a la matriz
    await admin`insert into crm.deal_ops_checks (deal_id, market_code, catalog_id, status) values (${deal}, 'US', ${doc}, 'received')`
    let items = (await accountIdentity(tom, acc, 'US')).products
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ provider_id: coast, product_id: null, status: 'submitted', deal_id: deal })
    await admin`update crm.deal_ops_checks set status = 'approved', on_date = now()::date where deal_id = ${deal} and catalog_id = ${coast}`
    items = (await accountIdentity(tom, acc, 'US')).products
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ status: 'approved' })
    expect(items[0]!.decided_at).not.toBeNull()
    // Operaciones lo activa en la ficha; un cambio posterior en el negocio no lo regresa
    await setAccountProduct(tom, acc, { productId: '', providerId: coast, status: 'active' })
    await admin`update crm.deal_ops_checks set status = 'sent' where deal_id = ${deal} and catalog_id = ${coast}`
    expect((await accountIdentity(tom, acc, 'US')).products[0]).toMatchObject({ status: 'active' })
  })
})

describe('contrato del paquete', () => {
  it('toda tabla nueva tiene RLS forzado y toda acción nueva tiene permiso y nombre legible', async () => {
    const tables = ['duplicate_bypasses', 'duplicate_pairs', 'merge_events', 'contact_primary_history', 'alias_systems', 'process_lists', 'process_memberships', 'quality_rules',
      'quality_snapshots', 'account_products', 'account_product_events']
    const rows = await admin<{ relname: string; ok: boolean }[]>`
      select c.relname, (c.relrowsecurity and c.relforcerowsecurity) as ok from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'crm' and c.relname = any(${tables})`
    expect(rows).toHaveLength(tables.length)
    expect(rows.every((r) => r.ok)).toBe(true)
    for (const cap of ['duplicate.review', 'alias.manage', 'field.propose', 'process.define', 'data.quality', 'account.products']) expect(Object.keys(CAPABILITIES)).toContain(cap)
    for (const action of ['account.unmerged', 'duplicate.bypassed', 'duplicate.dismissed', 'alias.added', 'alias.closed', 'contact.updated', 'contact.ended', 'field.updated', 'field.proposed', 'field.approved',
      'market.created', 'form.created', 'routing.rule_created', 'process.enrolled', 'quality.rule_updated', 'account.product_set', 'provider.sla_set', 'account_type.depth_set'])
      expect(AUDIT_ACTION[action]?.[0]).toBeTruthy()
    // sin sesión, nada de lo nuevo se lee
    for (const t of tables) expect((await withoutIdentity(t)).length).toBe(0)
  })
})

async function withoutIdentity(table: string) {
  const { withoutUser } = await import('@/server/db')
  return withoutUser((tx) => tx`select 1 from crm.${tx(table)} limit 1`)
}
