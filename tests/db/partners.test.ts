import { afterAll, describe, expect, it } from 'vitest'
import { asPersona, attempt, ctxFor, owner, personaId } from './helpers'
import { withSystem, withoutUser } from '@/server/db'
import { createAccount } from '@/domain/accounts'
import {
  addMilestone, cancelContract, createContract, createPartnerToken, createPlan, crossMatch, grantPartnerAccess, invitePartnerUser, markSigned,
  parseCommissionLines, partnerTokenHash, recalcTiers, registerPartner, renewContract, revokePartnerToken, runCrossMatch, saveTerms, saveTier,
  sendContract, sharePlan, updateMilestone,
} from '@/domain/partners'
import { promoteBatch, releaseNetwork, rollbackBatch, stageNetwork } from '@/domain/network-loads'
import { captureComm } from '@/domain/comms'
import { accountComms, accountContracts, accountPlans, networkLoad, partnerPortal, partnersAdmin } from '@/dal/partners'
import { esignAdapter, externalIdentityAdapter, gmailCaptureAdapter, partnersAdapterStatus } from '@/server/adapters/partners'
import { homePath } from '@/domain/policy'
import { JOBS } from '@/server/jobs/registry'
import { AUDIT_ACTION } from '@/lib/audit'
import { decide } from '@/domain/events/catalog'

const admin = owner()
afterAll(() => admin.end())
const tag = () => Math.random().toString(36).slice(2, 8)
const uid = async (k: string) => (await admin<{ id: string }[]>`select md5(${'contigo:' + k})::uuid as id`)[0]!.id
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

/** Una cuenta de US de Sam (ventas), para no ensuciar el árbol sintético. */
async function usAccount(kind: 'store' | 'distributor' = 'store', extra: Record<string, unknown> = {}) {
  const sam = await ctxFor('sam.ortiz')
  const acc = await createAccount(sam, { market: 'US', kind, name: `Partners ${tag()} ${kind}`, segment: 'dealer', force: true, reason: 'Cuenta de prueba de partners', ...extra })
  return acc.id!
}

describe('PIPE-07: términos comerciales versionados y contrato como objeto', () => {
  it('lee la comisión por producto, con coma o punto decimal, y rechaza lo que no entiende', () => {
    expect(parseCommissionLines('Recargas: 4.5\nServicios = 3,25 %')).toEqual([{ product: 'Recargas', pct: 4.5 }, { product: 'Servicios', pct: 3.25 }])
    expect(() => parseCommissionLines('Recargas cuatro')).toThrow()
    expect(() => parseCommissionLines('Recargas: 140')).toThrow()
  })

  it('cada guardado es una versión nueva; la anterior se conserva y la bitácora no lleva porcentajes', async () => {
    const id = await usAccount()
    const robert = await ctxFor('robert.hale')
    const v1 = await saveTerms(robert, id, { lines: 'Top-ups: 4.5', settlement: 'prepaid', termMonths: 12, validFrom: isoDay(-10) })
    const v2 = await saveTerms(robert, id, { lines: 'Top-ups: 5\nBills: 2', settlement: 'ach_credit', termMonths: 24, validFrom: isoDay(-10), nda: true })
    expect([v1.version, v2.version]).toEqual([1, 2])
    const rows = await admin<{ version: number; is_current: boolean; valid_to: string; supersedes: string | null }[]>`
      select version, is_current, valid_to::text, supersedes from crm.commercial_terms where account_id = ${id} order by version`
    expect(rows.map((r) => r.is_current)).toEqual([false, true])
    expect(rows[1]!.supersedes).toBe(v1.id)
    const ev = await admin<{ after: Record<string, unknown> }[]>`select after from crm.audit_events where action = 'terms.versioned' and object_id = ${id} order by at desc limit 1`
    expect(JSON.stringify(ev[0]!.after)).not.toContain('5')
    expect(ev[0]!.after).toMatchObject({ version: 2, products: 2 })
  })

  it('los términos son dato reservado: ventas que no lleva la cuenta no los ve ni los escribe; quien la lleva los ve', async () => {
    const id = await usAccount()
    await saveTerms(await ctxFor('robert.hale'), id, { lines: 'Top-ups: 4', settlement: 'prepaid', termMonths: 12, validFrom: isoDay(0) })
    const jade = await ctxFor('jade.kim')
    // Jade ve la cuenta por su mercado solo si es suya: la hacemos visible por su equipo de supervisión, no por términos.
    expect((await asPersona('jade.kim', (tx) => tx`select 1 from crm.commercial_terms where account_id = ${id}`)).length).toBe(0)
    await expect(saveTerms(jade, id, { lines: 'Top-ups: 9', settlement: 'prepaid', termMonths: 12, validFrom: isoDay(0) })).rejects.toBeTruthy()
    expect((await asPersona('sam.ortiz', (tx) => tx`select 1 from crm.commercial_terms where account_id = ${id}`)).length).toBe(1)
    const d = await accountContracts(await ctxFor('sam.ortiz'), id)
    expect(d!.account.can_terms_view).toBe(true)
    // Sam ve sus términos pero no los versiona: eso es de quien lidera el mercado.
    await expect(saveTerms(await ctxFor('sam.ortiz'), id, { lines: 'Top-ups: 9', settlement: 'prepaid', termMonths: 12, validFrom: isoDay(0) })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('contrato: nace en borrador de los términos, el envío queda en la cola con canal apagado y "firmado" se marca a mano', async () => {
    const id = await usAccount()
    const robert = await ctxFor('robert.hale')
    const sam = await ctxFor('sam.ortiz')
    await expect(createContract(sam, id)).rejects.toMatchObject({ code: 'invalid' })
    await saveTerms(robert, id, { lines: 'Top-ups: 4', settlement: 'prepaid', termMonths: 12, validFrom: isoDay(-5) })
    const cid = await createContract(sam, id)
    await expect(createContract(sam, id)).rejects.toMatchObject({ code: 'invalid' })
    expect(await sendContract(sam, cid)).toBe('channel_off')
    const q = await admin<{ adapter: string; status: string }[]>`select adapter, status from crm.external_queue where object_id = ${cid}`
    expect(q).toEqual([{ adapter: 'esign', status: 'channel_off' }])
    await expect(markSigned(sam, cid, { signedOn: isoDay(-1), signedBy: 'Cliente Ejemplo', documentUrl: 'http://inseguro.test/x' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(markSigned(sam, cid, { signedOn: isoDay(5), signedBy: 'Cliente Ejemplo', documentUrl: 'https://docs.ejemplo.test/contrato' })).rejects.toMatchObject({ code: 'invalid' })
    expect(await markSigned(sam, cid, { signedOn: isoDay(-1), signedBy: 'Cliente Ejemplo', documentUrl: 'https://docs.ejemplo.test/contrato' })).toBe('active')
    const c = await admin<{ status: string; signed_by_name: string; marked_by: string }[]>`select status, signed_by_name, marked_by from crm.contracts where id = ${cid}`
    expect(c[0]).toMatchObject({ status: 'active', signed_by_name: 'Cliente Ejemplo', marked_by: sam.user.id })
    // La base no deja un contrato firmado sin fecha, firmante ni documento.
    const code = await admin`update crm.contracts set document_url = null where id = ${cid}`.then(() => 'ok', (e: { code?: string }) => e.code)
    expect(code).toBe('23514')
    const renewal = await renewContract(sam, cid)
    expect((await admin<{ renewed_from: string; status: string }[]>`select renewed_from, status from crm.contracts where id = ${renewal}`)[0]).toMatchObject({ renewed_from: cid, status: 'draft' })
    await cancelContract(sam, renewal)
  })

  it('la tarea diaria pasa a vencido el que terminó y avisa la renovación a quien lleva la cuenta, una sola vez', async () => {
    const robert = await ctxFor('robert.hale')
    const sam = await ctxFor('sam.ortiz')
    const old = await usAccount()
    await saveTerms(robert, old, { lines: 'Top-ups: 4', settlement: 'prepaid', termMonths: 12, validFrom: isoDay(-400) })
    const c1 = await createContract(sam, old)
    expect(await markSigned(sam, c1, { signedOn: isoDay(-399), signedBy: 'Cliente Ejemplo', documentUrl: 'https://docs.ejemplo.test/a' })).toBe('expired')
    const soon = await usAccount()
    await saveTerms(robert, soon, { lines: 'Top-ups: 4', settlement: 'prepaid', termMonths: 12, validFrom: isoDay(-340), renewalNoticeDays: 60 })
    const c2 = await createContract(sam, soon)
    await markSigned(sam, c2, { signedOn: isoDay(-340), signedBy: 'Cliente Ejemplo', documentUrl: 'https://docs.ejemplo.test/b' })
    const job = JOBS.find((j) => j.key === 'partners.contracts')!
    await withSystem((tx) => job.run(tx))
    await withSystem((tx) => job.run(tx))
    const n = await admin<{ n: number }[]>`select count(*)::int as n from crm.notices where account_id = ${soon} and user_id = ${sam.user.id} and kind = 'lifecycle'`
    expect(n[0]!.n).toBe(1)
    expect((await admin<{ renewal_noticed_at: Date | null }[]>`select renewal_noticed_at from crm.contracts where id = ${c2}`)[0]!.renewal_noticed_at).not.toBeNull()
  })
})

describe('CANAL-01: portal de partners con visibilidad por subárbol', () => {
  it('el partner sintético ve su ISO, su agente y sus puntos, y nada más; su portal es su pantalla de inicio', async () => {
    const iso = await uid('dat-us-iso')
    const ctx = await ctxFor('iso.partner')
    expect(homePath(ctx.memberships)).toBe('/partners')
    expect(ctx.can('partner.portal')).toBe(true)
    expect(ctx.can('contract.manage', 'US')).toBe(false)
    const seen = await asPersona('iso.partner', (tx) => tx<{ id: string; ancestor_ids: string[] }[]>`select id, ancestor_ids from crm.accounts`)
    expect(seen.length).toBeGreaterThanOrEqual(4)
    expect(seen.every((a) => a.id === iso || a.ancestor_ids.includes(iso))).toBe(true)
    const portal = await partnerPortal(ctx)
    expect(portal.roots.map((r) => r.id)).toEqual([iso])
    expect(portal.nodes.length).toBe(seen.length)
    // Solo lectura: no escribe nada ni en su propio subárbol.
    expect(await asPersona('iso.partner', (tx) => attempt(tx, (sp) => sp`update crm.accounts set name = name where id = ${iso}`))).toBe('0 rows')
    await expect(createContract(ctx, iso)).rejects.toBeTruthy()
  })

  it('token por subárbol: lee lo que ve la persona de partner; revocado o con el nodo archivado deja de servir', async () => {
    const robert = await ctxFor('robert.hale')
    const nora = await ctxFor('nora.salas')
    const root = await usAccount('distributor')
    const child = await usAccount()
    await admin`update crm.accounts set parent_id = ${root} where id = ${child}`
    const u = (await admin<{ id: string }[]>`insert into crm.users (email, full_name, locale, is_synthetic) values (${`p-${tag()}@contigo.test`}, 'Partner temporal', 'en', true) returning id`)[0]!.id
    await expect(grantPartnerAccess(robert, { userId: u, accountId: root })).rejects.toMatchObject({ code: 'forbidden' })
    await grantPartnerAccess(nora, { userId: u, accountId: root })
    await expect(grantPartnerAccess(nora, { userId: u, accountId: root })).rejects.toMatchObject({ code: 'invalid' })
    const raw = await createPartnerToken(robert, { userId: u, label: 'Sistema del ISO' })
    expect(raw.startsWith('cpt_')).toBe(true)
    const who = await withoutUser((tx) => tx<{ user_id: string; scope_account_id: string }[]>`select user_id, scope_account_id from app.partner_token_user(${partnerTokenHash(raw)})`)
    expect(who[0]).toMatchObject({ user_id: u, scope_account_id: root })
    expect((await withoutUser((tx) => tx`select * from app.partner_token_user(${partnerTokenHash(raw + 'x')})`)).length).toBe(0)
    // Ventas no ve los tokens.
    expect((await asPersona('jade.kim', (tx) => tx`select 1 from crm.partner_tokens`)).length).toBe(0)
    // Baja automática: al archivar el nodo se cierra el acceso y se revoca el token.
    await admin`update crm.accounts set archived_at = now() where id = ${root}`
    expect((await withoutUser((tx) => tx`select * from app.partner_token_user(${partnerTokenHash(raw)})`)).length).toBe(0)
    expect((await admin<{ n: number }[]>`select count(*)::int as n from crm.memberships where user_id = ${u} and (valid_to is null or valid_to > now())`)[0]!.n).toBe(0)
    expect((await admin<{ revoked_at: Date | null }[]>`select revoked_at from crm.partner_tokens where user_id = ${u}`)[0]!.revoked_at).not.toBeNull()
  })

  it('revocar a mano corta el token; invitar a un externo queda en la cola con canal apagado', async () => {
    const robert = await ctxFor('robert.hale')
    const raw = await createPartnerToken(robert, { userId: await personaId('iso.partner'), label: 'Prueba revocar' })
    const id = (await admin<{ id: string }[]>`select id from crm.partner_tokens where token_hash = ${partnerTokenHash(raw)}`)[0]!.id
    await revokePartnerToken(robert, id)
    expect((await withoutUser((tx) => tx`select * from app.partner_token_user(${partnerTokenHash(raw)})`)).length).toBe(0)
    expect(await invitePartnerUser(await ctxFor('nora.salas'), await uid('dat-us-iso'))).toBe('channel_off')
  })
})

describe('PIPE-08: plan compartido de integración', () => {
  it('nace de la plantilla con dueño de cada lado; certificar guarda los días; compartir queda pedido con canal apagado', async () => {
    const id = await usAccount('distributor')
    const sam = await ctxFor('sam.ortiz')
    const plan = await createPlan(sam, { accountId: id, title: 'Integración de prueba', axexoOwner: sam.user.id, clientOwner: 'Contacto Ejemplo' })
    const ms = await admin<{ id: string; side: string; owner_user_id: string | null; owner_name: string | null; phase: string }[]>`
      select id, side, owner_user_id, owner_name, phase from crm.plan_milestones where plan_id = ${plan} order by position`
    expect(ms.length).toBe(6)
    expect(ms.every((m) => (m.side === 'axexo' ? m.owner_user_id === sam.user.id : m.owner_name === 'Contacto Ejemplo'))).toBe(true)
    await expect(addMilestone(sam, plan, { phase: 'other', title: 'Hito sin dueño', side: 'client' })).rejects.toMatchObject({ code: 'invalid' })
    await addMilestone(sam, plan, { phase: 'other', title: 'Firma de anexo técnico', side: 'client', ownerName: 'Contacto Ejemplo', dueOn: isoDay(10) })
    const cert = ms.find((m) => m.phase === 'certification')!
    await updateMilestone(sam, cert.id, { status: 'done' })
    const p = await admin<{ certified_on: string | null }[]>`select certified_on::text from crm.integration_plans where id = ${plan}`
    expect(p[0]!.certified_on).not.toBeNull()
    expect(await sharePlan(sam, plan)).toBe('channel_off')
    const d = await accountPlans(sam, id)
    expect(d!.plans[0]!.days_to_cert).toBe(0)
    expect(d!.plans[0]!.client_access).toBe('requested')
    expect(d!.plans[0]!.milestones.length).toBe(7)
    // Leadership solo lee.
    await expect(createPlan(await ctxFor('luis.tovar'), { accountId: id, title: 'No', axexoOwner: sam.user.id, clientOwner: 'X Y' })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('CANAL-06: niveles, habilitación y cruce de bases', () => {
  it('el nivel sale de criterios publicados y queda por período', async () => {
    const robert = await ctxFor('robert.hale')
    await saveTier(robert, { market: 'US', code: 'silver', nameEs: 'Plata', nameEn: 'Silver', rank: 2, minActive: 1, minQuality: 0, minCompliance: 0 })
    await withSystem((tx) => recalcTiers(tx))
    const p = await admin<{ tier_code: string; metrics: { active: number; nodes: number } }[]>`select tier_code, metrics from crm.partner_profiles where account_id = ${await uid('dat-us-iso')}`
    expect(p[0]!.metrics.nodes).toBeGreaterThanOrEqual(3)
    expect(p[0]!.metrics.active).toBeGreaterThanOrEqual(1)
    expect(p[0]!.tier_code).toBe('silver')
    expect((await admin<{ n: number }[]>`select count(*)::int as n from crm.partner_tier_history where account_id = ${await uid('dat-us-iso')}`)[0]!.n).toBe(1)
    await expect(saveTier(await ctxFor('jade.kim'), { market: 'US', code: 'x1', nameEs: 'X', nameEn: 'X', rank: 9, minActive: 0, minQuality: 0, minCompliance: 0 })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('el cruce encuentra los puntos del partner que ya están en la cartera, y solo lo ve quien maneja partners', async () => {
    const robert = await ctxFor('robert.hale')
    const twin = await usAccount('store', { phone: '+19565550142' })
    const n = await runCrossMatch(robert, 'US')
    expect(n).toBeGreaterThanOrEqual(1)
    const o = await admin<{ match_key: string }[]>`select match_key from crm.partner_overlaps where own_account_id = ${twin}`
    expect(o.map((x) => x.match_key)).toContain('phone')
    expect((await asPersona('jade.kim', (tx) => tx`select 1 from crm.partner_overlaps`)).length).toBe(0)
    await expect(runCrossMatch(await ctxFor('jade.kim'), 'US')).rejects.toMatchObject({ code: 'forbidden' })
    const d = await partnersAdmin(robert, 'US')
    expect(d.overlaps.some((x) => x.own_id === twin)).toBe(true)
    await withSystem((tx) => crossMatch(tx))
  })

  it('registrar un partner no se repite', async () => {
    const id = await usAccount('distributor')
    const robert = await ctxFor('robert.hale')
    await registerPartner(robert, id)
    await expect(registerPartner(robert, id)).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('DAT-06: kit de ingesta de red adquirida', () => {
  const csv = (phoneDup: string) => [
    'id,parent_id,nombre,telefono,ciudad,estado,tipo',
    `N1,,Red Ejemplo Norte ${tag()},,Laredo,TX,distribuidor`,
    `S1,N1,Punto Ejemplo Uno ${tag()},9565551001,Laredo,TX,tienda`,
    `S2,N1,Punto Ejemplo Dos ${tag()},${phoneDup},Laredo,TX,tienda`,
    `S3,N1,,9565551003,Laredo,TX,tienda`,
    `S4,N1,Punto con tarjeta 4111 1111 1111 1111,9565551004,Laredo,TX,tienda`,
  ].join('\n')

  it('carga aparte, marca problemas y repetidos, pide dos liberaciones distintas, promueve por lotes con árbol y origen, y regresa', async () => {
    const robert = await ctxFor('robert.hale')
    const nora = await ctxFor('nora.salas')
    const le = await uid('le-us')
    const { id } = await stageNetwork(robert, { market: 'US', entityId: le, name: `Red prueba ${tag()}`, system: 'emida', mapping: { external_id: 'id', parent_external_id: 'parent_id', name: 'nombre', phone: 'telefono', locality: 'ciudad', region: 'estado', kind: 'tipo' }, text: csv('9565550142') })
    const rows = await admin<{ external_id: string; status: string; issues: string[]; dup_key: string | null; name: string }[]>`select external_id, status, issues, dup_key, name from crm.network_load_rows where load_id = ${id} order by line`
    expect(rows.map((r) => r.status)).toEqual(['ready', 'ready', 'duplicate', 'error', 'error'])
    expect(rows[2]!.dup_key).toBe('phone')
    expect(rows[3]!.issues).toContain('missing_name')
    expect(rows[4]!.issues).toContain('prohibited')
    expect(rows[4]!.name).not.toContain('4111')
    // Segregado: nada de esto está en la cartera, y ventas no lo ve.
    expect((await admin`select 1 from crm.accounts where name like 'Punto Ejemplo Uno%' and created_at > now() - interval '1 minute'`).length).toBe(0)
    expect((await asPersona('jade.kim', (tx) => tx`select 1 from crm.network_loads`)).length).toBe(0)
    await expect(promoteBatch(robert, id)).rejects.toMatchObject({ code: 'invalid' })
    await expect(releaseNetwork(robert, id, 'legal')).rejects.toMatchObject({ code: 'forbidden' })
    expect(await releaseNetwork(nora, id, 'legal')).toBe('waiting')
    await expect(releaseNetwork(nora, id, 'business')).rejects.toMatchObject({ code: 'invalid' })
    expect(await releaseNetwork(robert, id, 'business')).toBe('released')
    const r = await promoteBatch(robert, id, 1)
    expect(r).toMatchObject({ batch: 1, created: 1, left: 1 })
    const r2 = await promoteBatch(robert, id)
    expect(r2).toMatchObject({ batch: 2, created: 1, left: 0 })
    const made = await admin<{ external_id: string; account_id: string }[]>`select external_id, account_id from crm.network_load_rows where load_id = ${id} and status = 'promoted' order by line`
    const n1 = made.find((m) => m.external_id === 'N1')!.account_id
    const s1 = made.find((m) => m.external_id === 'S1')!.account_id
    const acc = await admin<{ parent_id: string; merchant_origin: string; legal_entity_id: string; kind: string }[]>`select parent_id, merchant_origin, legal_entity_id, kind from crm.accounts where id = ${s1}`
    expect(acc[0]).toMatchObject({ parent_id: n1, merchant_origin: 'emida_conversion', legal_entity_id: le, kind: 'store' })
    expect((await admin`select 1 from crm.account_aliases where account_id = ${s1} and system = 'emida' and external_id = 'S1' and valid_to is null`).length).toBe(1)
    const d = await networkLoad(robert, id)
    expect(d!.batches.length).toBe(2)
    expect(d!.byNode.length).toBeGreaterThan(0)
    // Marcha atrás del lote 2 (S1): nadie lo trabajó, se archiva y se cierra su ID.
    const back = await rollbackBatch(robert, id, 2)
    expect(back).toEqual({ archived: 1, kept: 0 })
    expect((await admin<{ archived_at: Date | null }[]>`select archived_at from crm.accounts where id = ${s1}`)[0]!.archived_at).not.toBeNull()
    // El lote 1 (N1) ya tiene trabajo encima (una actividad): se queda y se dice.
    await captureComm(robert, { accountId: n1, channel: 'meeting', subject: 'Arranque de la red' })
    expect(await rollbackBatch(robert, id, 1)).toEqual({ archived: 0, kept: 1 })
  })

  it('el mapeo pide al menos ID y nombre, y avisa qué columnas trae el archivo', async () => {
    const robert = await ctxFor('robert.hale')
    await expect(stageNetwork(robert, { market: 'US', entityId: await uid('le-us'), name: 'Mal mapeo', system: 'sky', mapping: { external_id: 'codigo', name: 'nombre' }, text: csv('9565551999') })).rejects.toMatchObject({ code: 'invalid' })
    await expect(stageNetwork(await ctxFor('jade.kim'), { market: 'US', entityId: await uid('le-us'), name: 'Sin permiso', system: 'sky', mapping: { external_id: 'id', name: 'nombre' }, text: csv('9565551999') })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('ACT-03: captura de comunicaciones', () => {
  it('un correo y un WhatsApp quedan en el hilo con sus datos; la ventana de 24 horas se abre con el mensaje del cliente', async () => {
    const id = await usAccount()
    const sam = await ctxFor('sam.ortiz')
    const a1 = await captureComm(sam, { accountId: id, channel: 'email', subject: 'Envío de propuesta', participants: 'cliente@ejemplo.test, sam', summary: 'Mandamos la propuesta.' })
    const act = await admin<{ kind: string; subject: string; done_at: Date | null }[]>`select kind, subject, done_at from crm.activities where id = ${a1}`
    expect(act[0]).toMatchObject({ kind: 'email', subject: 'Envío de propuesta' })
    expect(act[0]!.done_at).not.toBeNull()
    const before = await accountComms(sam, id)
    expect(before!.window.open).toBe(false)
    await expect(captureComm(sam, { accountId: id, channel: 'whatsapp', subject: 'Pregunta' })).rejects.toMatchObject({ code: 'invalid' })
    await captureComm(sam, { accountId: id, channel: 'whatsapp', subject: 'Pregunta por comisión', direction: 'inbound', phone: '7025551234' })
    const after = await accountComms(sam, id)
    expect(after!.window.open).toBe(true)
    expect(after!.comms.map((c) => c.channel).sort()).toEqual(['email', 'whatsapp'])
    const wa = await admin<{ phone_e164: string; source: string }[]>`select phone_e164, source from crm.activity_comms where account_id = ${id} and channel = 'whatsapp'`
    expect(wa[0]).toEqual({ phone_e164: '+17025551234', source: 'manual' })
  })

  it('el texto pasa por el escaneo de datos prohibidos y una fecha futura no entra', async () => {
    const id = await usAccount()
    const sam = await ctxFor('sam.ortiz')
    await expect(captureComm(sam, { accountId: id, channel: 'email', subject: 'Datos', summary: 'Su tarjeta 4111 1111 1111 1111' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(captureComm(sam, { accountId: id, channel: 'meeting', subject: 'Futura', at: '2099-01-01T10:00' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(captureComm(await ctxFor('luis.tovar'), { accountId: id, channel: 'email', subject: 'Leadership' })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('Adaptadores apagados y contrato del paquete', () => {
  it('firma, identidad de externos y captura están apagados por defecto y dicen qué falta', () => {
    expect(esignAdapter().mode).toBe('off')
    expect(externalIdentityAdapter().mode).toBe('off')
    expect(gmailCaptureAdapter().mode).toBe('off')
    const st = partnersAdapterStatus()
    expect(st.map((s) => s.key)).toEqual(['esign', 'external_identity', 'gmail', 'calendar', 'whatsapp_capture'])
    expect(st.every((s) => s.mode === 'off' && s.needs[0].length > 20 && s.envVar.startsWith('CONTIGO_'))).toBe(true)
  })

  it('cada acción nueva tiene nombre en la bitácora y está clasificada para eventos', () => {
    const mine = Object.keys(AUDIT_ACTION).filter((a) => /^(terms|contract|plan|partner|partner_token|partner_tier|network_load)\.|^activity\.comm_captured$/.test(a))
    expect(mine.length).toBeGreaterThanOrEqual(24)
    for (const a of mine) expect(decide(a)).not.toMatchObject({ unclassified: true })
  })

  it('las tablas nuevas tienen RLS forzado', async () => {
    const rows = await admin<{ relname: string; forced: boolean }[]>`
      select c.relname, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'crm' and c.relname = any(${['external_queue', 'commercial_terms', 'contracts', 'partner_tokens', 'integration_plans', 'plan_milestones', 'partner_tiers', 'partner_profiles', 'partner_tier_history', 'partner_enablement', 'partner_overlaps', 'network_loads', 'network_load_rows', 'activity_comms']}::text[])`
    expect(rows.length).toBe(14)
    expect(rows.every((r) => r.forced)).toBe(true)
  })
})
