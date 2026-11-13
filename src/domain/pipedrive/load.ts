import 'server-only'
import type { Tx } from '@/server/db'
import { evaluateRules } from '@/domain/rules'
import { accountRule, dealRule, leadRule, skipReason } from '@/domain/intake'
import { missingForStage } from '@/domain/deals'
import * as M from './mapping'
import { SRC, accountsByOrg, bump, ensureLossReason, loadRefs, markLoaded, newIds, refMap, saveRefs, sid, type Json, type Raw, type Refs } from './refs'

/**
 * 3. Carga: traduce la copia cruda al modelo de CONTIGO, por lotes y con operaciones de conjunto.
 * Cada cargador toma lo pendiente (loaded_at is null), lo escribe y lo marca. Volver a correrlo no duplica nada:
 * las cuentas se reconocen por su alias de Pipedrive (DAT-03) y lo demás por crm.external_refs.
 * No genera un evento de auditoría por fila: la corrida completa deja el suyo con los conteos (OBS-03).
 */
type Loader = (tx: Tx, runId: string, sysId: string) => Promise<boolean>
type Rec = Record<string, unknown>

const J = (tx: Tx, v: unknown) => tx.json(v as Json)
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))]
const str = (v: unknown, max: number) => (typeof v === 'string' ? M.scrub(v).trim().slice(0, max) : '')

async function pending(tx: Tx, object: string, limit: number): Promise<Raw[]> {
  const rows = await tx<Raw[]>`select external_id, parent_ref, payload from crm.import_raw
    where source = ${SRC} and object = ${object} and loaded_at is null order by external_id limit ${limit}`
  return [...rows]
}

let cache: { runId: string; at: number; refs: Refs } | null = null
async function refsFor(tx: Tx, runId: string): Promise<Refs> {
  if (cache && cache.runId === runId && Date.now() - cache.at < 45_000) return cache.refs
  const refs = await loadRefs(tx)
  cache = { runId, at: Date.now(), refs }
  return refs
}

class Tally {
  created = 0
  updated = 0
  skipped = new Map<string, number>()
  done: { id: string; note: string | null }[] = []
  ok(id: string, isNew: boolean) {
    if (isNew) this.created++
    else this.updated++
    this.done.push({ id, note: null })
  }
  skip(id: string, reason: string) {
    this.skipped.set(reason, (this.skipped.get(reason) ?? 0) + 1)
    this.done.push({ id, note: reason })
  }
  async save(tx: Tx, runId: string, object: string) {
    await markLoaded(tx, object, this.done)
    await bump(tx, runId, ['created', object], this.created)
    await bump(tx, runId, ['updated', object], this.updated)
    for (const [reason, n] of this.skipped) await bump(tx, runId, ['skipped', `${object}:${reason}`], n)
  }
}

/** Valor ya convertido del campo que alimenta una columna del modelo ("core:x"), con su llave para marcarlo como usado. */
function coreValue(plans: M.FieldPlan[], payload: Rec, refs: Refs, to: string): { key: string; v: unknown } | null {
  const p = plans.find((x) => x.mappedTo === to)
  if (!p) return null
  return { key: p.key, v: M.convertValue(p, M.rawValue(payload, p), refs.userNames) }
}

/** Campos adicionales: todo lo que no se usó para una columna del modelo ni está restringido por política. */
function customOf(plans: M.FieldPlan[], payload: Rec, refs: Refs, used: Set<string>, skipRefs: Set<string> = new Set()): Rec {
  const out: Rec = {}
  for (const p of plans) {
    if (used.has(p.key) || skipRefs.has(p.externalRef)) continue
    if (p.mappedTo?.startsWith('alias:') || p.mappedTo === 'policy:omit') continue
    const raw = M.rawValue(payload, p)
    if (p.mappedTo === 'policy:last4') {
      const l4 = typeof raw === 'object' && raw !== null && '__last4' in raw ? (raw as { __last4: unknown }).__last4 : M.last4(raw)
      if (l4) out[p.key] = `••••${String(l4)}`
      continue
    }
    const v = M.convertValue(p, raw, refs.userNames)
    if (v !== undefined) out[p.key] = v
  }
  return out
}

const territories = new Map<string, string>()
async function territoryId(tx: Tx, market: string, label: string): Promise<string> {
  const k = `${market}|${label}`
  const hit = territories.get(k)
  if (hit) return hit
  const code = M.normName(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'zona'
  const rows = await tx<{ id: string }[]>`insert into crm.territories (market_code, code, name) values (${market}, ${code}, ${label.slice(0, 80)})
    on conflict (market_code, code) do update set name = excluded.name returning id`
  territories.set(k, rows[0]!.id)
  return rows[0]!.id
}

// ---------------------------------------------------------------- organizaciones → cuentas
const loadOrganizations: Loader = async (tx, runId, sysId) => {
  const rows = await pending(tx, 'organization', 250)
  if (!rows.length) return false
  const refs = await refsFor(tx, runId)
  const plans = refs.plans.account
  const ids = rows.map((r) => r.external_id)
  const info = new Map<string, { markets: Map<string, number>; won: number }>()
  for (const d of await tx<{ org: string; pipeline: string | null; status: string | null; n: number }[]>`
    select parent_ref as org, payload ->> 'pipeline_id' as pipeline, payload ->> 'status' as status, count(*)::int as n
      from crm.import_raw where source = ${SRC} and object = 'deal' and parent_ref = any(${ids}::text[]) group by 1, 2, 3`) {
    const e = info.get(d.org) ?? { markets: new Map<string, number>(), won: 0 }
    const m = d.pipeline ? refs.pipelineMarket.get(d.pipeline) : undefined
    if (m) e.markets.set(m, (e.markets.get(m) ?? 0) + d.n)
    if (d.status === 'won') e.won += d.n
    info.set(d.org, e)
  }
  const existing = new Map<string, { id: string; market: string; merged: boolean }>()
  for (const a of await tx<{ external_id: string; id: string; market_code: string; merged: boolean }[]>`
    select al.external_id, a.id, a.market_code, a.merged_into is not null as merged
      from crm.account_aliases al join crm.accounts a on a.id = al.account_id
     where al.system = ${SRC} and al.valid_to is null and al.external_id = any(${ids}::text[])`) {
    existing.set(a.external_id, { id: a.id, market: a.market_code, merged: a.merged })
  }

  const tally = new Tally()
  const fresh: Rec[] = []
  const changed: Rec[] = []
  const emida: Rec[] = []
  for (const r of rows) {
    const p = r.payload
    const prior = existing.get(r.external_id)
    if (prior?.merged) {
      tally.skip(r.external_id, 'merged_in_contigo')
      continue
    }
    const used = new Set<string>()
    const live = (code: string | null | undefined) => (code && refs.markets.get(code)?.live ? code : null)
    const addr = (typeof p.address === 'object' && p.address !== null ? p.address : {}) as Rec
    const phoneF = coreValue(plans, p, refs, 'core:phone')
    const marketF = coreValue(plans, p, refs, 'core:market')
    const e = info.get(r.external_id)
    let market = prior?.market ?? live(M.countryCode(marketF?.v))
    if (marketF && live(M.countryCode(marketF.v))) used.add(marketF.key)
    if (!market && e?.markets.size) market = [...e.markets.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    market ??= live(M.countryCode(addr.country)) ?? live(M.marketFromPhone(phoneF?.v)) ?? live(refs.ownerMarket.get(sid(p.owner_id) ?? ''))
    if (!market) {
      tally.skip(r.external_id, 'no_market')
      continue
    }
    const mk = refs.markets.get(market)!

    const lifeF = coreValue(plans, p, refs, 'core:lifecycle')
    let lifecycle = M.lifecycleFromLabel(lifeF?.v)
    if (lifecycle && lifeF) used.add(lifeF.key)
    lifecycle ??= (e?.won ?? 0) > 0 ? 'active' : 'prospect'

    const segF = coreValue(plans, p, refs, 'core:segment')
    const segment = typeof segF?.v === 'string' ? segF.v.slice(0, 80) : null
    if (segment && segF) used.add(segF.key)

    const terF = coreValue(plans, p, refs, 'core:territory')
    const territory = typeof terF?.v === 'string' && terF.v.trim() ? await territoryId(tx, market, terF.v.trim()) : null
    if (territory && terF) used.add(terF.key)

    const phone = M.phoneE164(phoneF?.v, mk.phoneCc)
    if (phone && phoneF) used.add(phoneF.key)
    const emailF = coreValue(plans, p, refs, 'core:email')
    const email = M.validEmail(emailF?.v)
    if (email && emailF) used.add(emailF.key)

    const latF = coreValue(plans, p, refs, 'core:latitude')
    const lngF = coreValue(plans, p, refs, 'core:longitude')
    const latitude = M.coord(latF?.v, 90)
    const longitude = M.coord(lngF?.v, 180)
    if (latitude !== null && longitude !== null) {
      if (latF) used.add(latF.key)
      if (lngF) used.add(lngF.key)
    }

    const cityF = coreValue(plans, p, refs, 'core:locality')
    const stateF = coreValue(plans, p, refs, 'core:region')
    let locality = str(addr.locality, 120) || null
    if (!locality && typeof cityF?.v === 'string') {
      locality = cityF.v.slice(0, 120)
      used.add(cityF.key)
    } else if (locality && cityF && typeof cityF.v === 'string' && M.normName(cityF.v) === M.normName(locality)) used.add(cityF.key)
    let region = str(addr.admin_area_level_1, 120) || null
    if (!region && typeof stateF?.v === 'string') {
      region = stateF.v.slice(0, 120)
      used.add(stateF.key)
    } else if (region && stateF && typeof stateF.v === 'string' && M.normName(stateF.v) === M.normName(region)) used.add(stateF.key)

    const taxPlan = plans.find((x) => x.mappedTo === 'policy:last4')
    const taxRaw = taxPlan ? M.rawValue(p, taxPlan) : null
    const tax = taxRaw && typeof taxRaw === 'object' && '__last4' in taxRaw ? String((taxRaw as { __last4: unknown }).__last4 ?? '') : M.last4(taxRaw)
    if (taxPlan) used.add(taxPlan.key)

    const rec: Rec = {
      id: prior?.id ?? null,
      ext: r.external_id,
      market,
      name: str(p.name, 240) || '(sin nombre)',
      segment,
      lifecycle,
      owner_id: refs.users.get(sid(p.owner_id) ?? '')?.id ?? null,
      territory_id: territory,
      phone,
      email,
      address_line: str(addr.value ?? addr.formatted_address, 300) || null,
      locality,
      region,
      postal_code: str(addr.postal_code, 20) || null,
      country: M.countryCode(addr.country),
      latitude: latitude !== null && longitude !== null ? latitude : null,
      longitude: latitude !== null && longitude !== null ? longitude : null,
      tax_id_last4: tax && /^[A-Z0-9]{1,4}$/.test(tax) ? tax : null,
      custom: customOf(plans, p, refs, used),
      created_at: M.isoTime(p.add_time),
    }
    // AUT-01: la importación aplica las mismas reglas de entrada que la pantalla y la API. La fila que no cumple se salta, con su motivo.
    const broken = accountRule({ name: String(rec.name), phone: rec.phone as string | null })
    if (broken) {
      tally.skip(r.external_id, skipReason(broken))
      continue
    }
    const emidaPlan = plans.find((x) => x.mappedTo === 'alias:emida')
    const emidaId = emidaPlan ? str(String(M.rawValue(p, emidaPlan) ?? ''), 80) : ''
    if (prior) changed.push(rec)
    else fresh.push(rec)
    // Un ID externo identifica a un solo comercio: si dos organizaciones traen el mismo, se queda en la primera.
    if (emidaId && !emida.some((x) => x.alias === emidaId)) emida.push({ ext: r.external_id, market, alias: emidaId })
    tally.ok(r.external_id, !prior)
  }

  const idByExt = new Map<string, string>()
  if (fresh.length) {
    const nid = await newIds(tx, fresh.length)
    fresh.forEach((f, i) => {
      f.id = nid[i]
      idByExt.set(String(f.ext), nid[i]!)
    })
    await tx`
      with d as (
        select * from jsonb_to_recordset(${J(tx, fresh)}) as x(id uuid, ext text, market text, name text, segment text, lifecycle text, owner_id uuid,
          territory_id uuid, phone text, email text, address_line text, locality text, region text, postal_code text, country text,
          latitude numeric, longitude numeric, tax_id_last4 text, custom jsonb, created_at timestamptz)
      ), ins as (
        insert into crm.accounts (id, market_code, kind, name, segment, lifecycle, owner_id, territory_id, phone, email, address_line, locality, region,
                                  postal_code, country, latitude, longitude, tax_id_last4, custom, created_by, created_at)
        select id, market, 'store', name, segment, lifecycle, owner_id, territory_id, phone, email, address_line, locality, region,
               postal_code, country, latitude, longitude, tax_id_last4, custom, ${sysId}, coalesce(created_at, now()) from d
      )
      insert into crm.account_aliases (account_id, market_code, system, external_id, valid_from)
      select id, market, ${SRC}, ext, coalesce(created_at, now()) from d`
  }
  if (changed.length) {
    for (const c of changed) idByExt.set(String(c.ext), String(c.id))
    await tx`
      update crm.accounts a set name = d.name, segment = d.segment, owner_id = d.owner_id, territory_id = d.territory_id, phone = d.phone, email = d.email,
             address_line = d.address_line, locality = d.locality, region = d.region, postal_code = d.postal_code, country = d.country,
             latitude = d.latitude, longitude = d.longitude, tax_id_last4 = d.tax_id_last4, custom = a.custom || d.custom,
             -- si S5 ya reporta actividad del comercio, su etapa de vida la decide CONTIGO, no el campo de Pipedrive
             lifecycle = case when exists (select 1 from crm.merchant_metrics_daily mm where mm.account_id = a.id) then a.lifecycle else d.lifecycle end
        from jsonb_to_recordset(${J(tx, changed)}) as d(id uuid, name text, segment text, lifecycle text, owner_id uuid, territory_id uuid, phone text,
             email text, address_line text, locality text, region text, postal_code text, country text, latitude numeric, longitude numeric,
             tax_id_last4 text, custom jsonb)
       where a.id = d.id`
  }
  if (emida.length) {
    for (const x of emida) x.id = idByExt.get(String(x.ext))
    const res = await tx`
      insert into crm.account_aliases (account_id, market_code, system, external_id)
      select x.id, x.market, 'emida', x.alias from jsonb_to_recordset(${J(tx, emida)}) as x(id uuid, market text, alias text)
       where not exists (select 1 from crm.account_aliases al where al.system = 'emida' and al.external_id = x.alias and al.valid_to is null)
      on conflict do nothing`
    await bump(tx, runId, ['created', 'alias_emida'], res.count)
  }
  await tally.save(tx, runId, 'organization')
  return true
}

// ---------------------------------------------------------------- personas → contactos
const loadPersons: Loader = async (tx, runId, sysId) => {
  const rows = await pending(tx, 'person', 400)
  if (!rows.length) return false
  const refs = await refsFor(tx, runId)
  const plans = refs.plans.contact
  const accs = await accountsByOrg(tx, uniq(rows.map((r) => r.parent_ref)))
  const existing = await refMap(tx, 'person', rows.map((r) => r.external_id))
  const tally = new Tally()
  const fresh: Rec[] = []
  const changed: Rec[] = []
  const links: Rec[] = []
  for (const r of rows) {
    const p = r.payload
    const acc = r.parent_ref ? accs.get(r.parent_ref) : undefined
    const used = new Set<string>()
    const marketF = coreValue(plans, p, refs, 'core:market')
    const fieldMarket = M.countryCode(marketF?.v)
    if (marketF && fieldMarket) used.add(marketF.key)
    const market = acc?.market ?? (fieldMarket && refs.markets.has(fieldMarket) ? fieldMarket : null) ?? refs.ownerMarket.get(sid(p.owner_id) ?? '') ?? null
    if (!market) {
      tally.skip(r.external_id, 'no_market')
      continue
    }
    const mk = refs.markets.get(market)!
    const roleF = coreValue(plans, p, refs, 'core:role')
    const dmF = coreValue(plans, p, refs, 'core:decision_maker')
    if (dmF) used.add(dmF.key)
    const role = M.contactRole(roleF?.v, dmF?.v)
    const phone = M.phoneE164(p.phones, mk.phoneCc)
    const email = M.validEmail(M.primaryValue(p.emails))
    // El teléfono y el correo principales ya viven en sus columnas; la lista completa solo se guarda si aporta algo más.
    const skip = new Set<string>()
    if (phone && (!Array.isArray(p.phones) || p.phones.length <= 1)) skip.add('phones')
    if (email && (!Array.isArray(p.emails) || p.emails.length <= 1)) skip.add('emails')
    const id = existing.get(r.external_id) ?? null
    const rec: Rec = {
      id,
      ext: r.external_id,
      market,
      full_name: str(p.name, 200) || [str(p.first_name, 100), str(p.last_name, 100)].filter(Boolean).join(' ') || '(sin nombre)',
      phone,
      email,
      owner_id: refs.users.get(sid(p.owner_id) ?? '')?.id ?? null,
      custom: customOf(plans, p, refs, used, skip),
      created_at: M.isoTime(p.add_time),
      account_id: acc?.id ?? null,
      account_market: acc?.market ?? null,
      role,
    }
    if (id) changed.push(rec)
    else fresh.push(rec)
    tally.ok(r.external_id, !id)
    links.push(rec)
  }
  if (fresh.length) {
    const nid = await newIds(tx, fresh.length)
    fresh.forEach((f, i) => (f.id = nid[i]))
    await tx`insert into crm.contacts (id, market_code, full_name, phone, email, owner_id, custom, created_by, created_at)
             select id, market, full_name, phone, email, owner_id, custom, ${sysId}, coalesce(created_at, now())
               from jsonb_to_recordset(${J(tx, fresh)}) as x(id uuid, market text, full_name text, phone text, email text, owner_id uuid, custom jsonb, created_at timestamptz)`
    await saveRefs(tx, 'person', fresh.map((f) => ({ ext: String(f.ext), id: String(f.id) })))
  }
  if (changed.length) {
    await tx`update crm.contacts c set full_name = d.full_name, phone = d.phone, email = d.email, owner_id = d.owner_id, custom = c.custom || d.custom
               from jsonb_to_recordset(${J(tx, changed)}) as d(id uuid, full_name text, phone text, email text, owner_id uuid, custom jsonb)
              where c.id = d.id`
  }
  const withAccount = links.filter((l) => l.account_id)
  if (withAccount.length) {
    await tx`insert into crm.account_contacts (account_id, contact_id, market_code, role, valid_from)
             select x.account_id, x.id, x.account_market, x.role, coalesce(x.created_at, now())
               from jsonb_to_recordset(${J(tx, withAccount)}) as x(account_id uuid, id uuid, account_market text, role text, created_at timestamptz)
              where not exists (select 1 from crm.account_contacts ac where ac.account_id = x.account_id and ac.contact_id = x.id and ac.valid_to is null)`
  }
  await tally.save(tx, runId, 'person')
  return true
}

// ---------------------------------------------------------------- deals
const loadDeals: Loader = async (tx, runId, sysId) => {
  const rows = await pending(tx, 'deal', 250)
  if (!rows.length) return false
  const refs = await refsFor(tx, runId)
  const plans = refs.plans.deal
  const ids = rows.map((r) => r.external_id)
  const accs = await accountsByOrg(tx, uniq(rows.map((r) => r.parent_ref)))
  const personIds = uniq(rows.map((r) => sid(r.payload.person_id)))
  const contacts = await refMap(tx, 'person', personIds)
  const personNames = new Map<string, string>()
  if (personIds.length) {
    for (const n of await tx<{ external_id: string; name: string | null }[]>`
      select external_id, payload ->> 'name' as name from crm.import_raw where source = ${SRC} and object = 'person' and external_id = any(${personIds}::text[])`) {
      if (n.name) personNames.set(n.external_id, n.name)
    }
  }
  const existing = await refMap(tx, 'deal', ids)
  const placeholders = await refMap(tx, 'deal_account', ids)
  const lossCodes = new Map<string, string>()
  const tally = new Tally()
  let needsStep = 0
  const fresh: Rec[] = []
  const changed: Rec[] = []
  const newAccounts: Rec[] = []
  const links: Rec[] = []
  for (const r of rows) {
    const p = r.payload
    const pipe = refs.pipelines.get(sid(p.pipeline_id) ?? '')
    if (!pipe) {
      tally.skip(r.external_id, 'pipeline_out_of_scope')
      continue
    }
    const status = p.status === 'won' || p.status === 'lost' || p.status === 'open' ? p.status : null
    if (!status) {
      tally.skip(r.external_id, 'deleted')
      continue
    }
    if (p.is_archived === true && status === 'open') {
      tally.skip(r.external_id, 'archived_open')
      continue
    }
    const market = pipe.market
    const mk = refs.markets.get(market)!
    const pdStage = refs.stages.get(sid(p.stage_id) ?? '')
    const pdStageId = pdStage && pdStage.pipelineId === pipe.id ? pdStage.id : null
    const stageId = status === 'won' ? pipe.won : status === 'lost' ? pipe.lost : (pdStageId ?? pipe.first)
    if (!stageId) {
      tally.skip(r.external_id, 'no_stage')
      continue
    }
    const ownerId = refs.users.get(sid(p.owner_id) ?? '')?.id ?? null
    const created = M.isoTime(p.add_time)
    const personId = sid(p.person_id)
    const title = str(p.title, 160) || '(sin título)'
    let accountId = (r.parent_ref ? accs.get(r.parent_ref)?.id : null) ?? placeholders.get(r.external_id) ?? null
    if (!accountId) {
      // Deal sin organización (o con una que no se pudo cargar): nace una cuenta mínima para no perder el deal.
      accountId = (await newIds(tx, 1))[0]!
      newAccounts.push({
        id: accountId, ext: r.external_id, market, name: (personId && personNames.get(personId)?.slice(0, 240)) || title,
        lifecycle: status === 'won' ? 'active' : 'prospect', owner_id: ownerId, created_at: created,
      })
    }
    const contactId = personId ? (contacts.get(personId) ?? null) : null
    if (contactId) links.push({ account_id: accountId, id: contactId, market })

    let lossCode: string | null = null
    let lossNote: string | null = null
    if (status === 'lost') {
      const text = str(p.lost_reason, 500)
      lossNote = text || null
      lossCode = text.length > 0 && text.length <= 80 ? (lossCodes.get(text) ?? (await ensureLossReason(tx, text))) : 'pd_unspecified'
      if (text) lossCodes.set(text, lossCode)
    }
    const wonAt = status === 'won' ? (M.isoTime(p.won_time) ?? M.isoTime(p.close_time) ?? M.isoTime(p.update_time) ?? created) : null
    const lostAt = status === 'lost' ? (M.isoTime(p.lost_time) ?? M.isoTime(p.close_time) ?? M.isoTime(p.update_time) ?? created) : null
    const currency = typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency) ? p.currency : mk.currency
    const id = existing.get(r.external_id) ?? null
    const rec: Rec = {
      id, ext: r.external_id, market, pipeline_id: pipe.id, stage_id: stageId, pd_stage_id: pdStageId, account_id: accountId, owner_id: ownerId, title,
      amount_minor: M.toMinor(p.value), currency, status, loss_reason_code: lossCode, loss_note: lossNote, decision_maker_id: contactId,
      stage_entered_at: wonAt ?? lostAt ?? M.isoTime(p.stage_change_time) ?? created, won_at: wonAt, lost_at: lostAt,
      closed_by: status === 'open' ? null : 'manual', custom: customOf(plans, p, refs, new Set()), created_at: created,
    }
    const broken = dealRule({ title, amount_minor: rec.amount_minor as number | null, status, loss_reason_code: lossCode, loss_note: lossNote })
    if (broken) {
      tally.skip(r.external_id, skipReason(broken))
      continue
    }
    // Un negocio abierto lleva próximo paso (la misma función que revisa la pantalla). Pipedrive no lo trae: el negocio entra,
    // se cuenta aquí y la regla "sin próximo paso" lo pone en la cola de avisos al terminar la corrida. No se inventa un paso.
    if (status === 'open' && !id && missingForStage({ amount_minor: rec.amount_minor as number | null, next_step: null, next_step_due: null, decision_maker_id: null, decision_maker_met: false }, { kind: 'open', required_fields: [] }).includes('next_step')) needsStep++
    if (id) changed.push(rec)
    else fresh.push(rec)
    tally.ok(r.external_id, !id)
  }
  if (needsStep) await bump(tx, runId, ['created', 'deal_needs_next_step'], needsStep)

  if (newAccounts.length) {
    await tx`insert into crm.accounts (id, market_code, kind, name, lifecycle, owner_id, custom, created_by, created_at)
             select id, market, 'store', name, lifecycle, owner_id, '{}'::jsonb, ${sysId}, coalesce(created_at, now())
               from jsonb_to_recordset(${J(tx, newAccounts)}) as x(id uuid, market text, name text, lifecycle text, owner_id uuid, created_at timestamptz)`
    await saveRefs(tx, 'deal_account', newAccounts.map((a) => ({ ext: String(a.ext), id: String(a.id) })))
    await bump(tx, runId, ['created', 'account_from_deal'], newAccounts.length)
  }
  if (links.length) {
    await tx`insert into crm.account_contacts (account_id, contact_id, market_code, role)
             select distinct x.account_id, x.id, a.market_code, 'staff'
               from jsonb_to_recordset(${J(tx, links)}) as x(account_id uuid, id uuid) join crm.accounts a on a.id = x.account_id
              where not exists (select 1 from crm.account_contacts ac where ac.account_id = x.account_id and ac.contact_id = x.id and ac.valid_to is null)`
  }
  const cols = tx`x(id uuid, market text, pipeline_id uuid, stage_id uuid, pd_stage_id uuid, account_id uuid, owner_id uuid, title text, amount_minor bigint,
    currency text, status text, loss_reason_code text, loss_note text, decision_maker_id uuid, stage_entered_at timestamptz, won_at timestamptz,
    lost_at timestamptz, closed_by text, custom jsonb, created_at timestamptz)`
  if (fresh.length) {
    const nid = await newIds(tx, fresh.length)
    fresh.forEach((f, i) => (f.id = nid[i]))
    await tx`insert into crm.deals (id, market_code, pipeline_id, stage_id, account_id, owner_id, title, amount_minor, currency, status, loss_reason_code, loss_note,
                                    decision_maker_id, stage_entered_at, won_at, lost_at, closed_by, custom, created_by, created_at)
             select id, market, pipeline_id, stage_id, account_id, owner_id, title, amount_minor, currency, status, loss_reason_code, loss_note,
                    decision_maker_id, coalesce(stage_entered_at, now()), won_at, lost_at, closed_by, custom, ${sysId}, coalesce(created_at, now())
               from jsonb_to_recordset(${J(tx, fresh)}) as ${cols}`
    await saveRefs(tx, 'deal', fresh.map((f) => ({ ext: String(f.ext), id: String(f.id) })))
    // REP-02: la historia de etapas arranca con lo que se sabe: dónde estaba y, si cerró, cuándo.
    await tx`insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause, at)
             select x.id, x.market, null, coalesce(x.pd_stage_id, x.stage_id), x.owner_id, 'import', coalesce(x.created_at, now())
               from jsonb_to_recordset(${J(tx, fresh)}) as ${cols}
             union all
             select x.id, x.market, x.pd_stage_id, x.stage_id, x.owner_id, 'import', coalesce(x.won_at, x.lost_at, now())
               from jsonb_to_recordset(${J(tx, fresh)}) as ${cols}
              where x.status <> 'open' and x.pd_stage_id is not null and x.pd_stage_id <> x.stage_id`
  }
  if (changed.length) {
    await tx`
      with d as (select * from jsonb_to_recordset(${J(tx, changed)}) as ${cols}),
      ev as (
        insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause)
        select o.id, o.market_code, o.stage_id, d.stage_id, d.owner_id, 'import' from d join crm.deals o on o.id = d.id where o.stage_id <> d.stage_id
      )
      update crm.deals o set pipeline_id = d.pipeline_id, stage_id = d.stage_id, account_id = d.account_id, owner_id = d.owner_id, title = d.title,
             amount_minor = d.amount_minor, currency = d.currency, status = d.status, loss_reason_code = d.loss_reason_code, loss_note = d.loss_note,
             decision_maker_id = coalesce(o.decision_maker_id, d.decision_maker_id), won_at = d.won_at, lost_at = d.lost_at, closed_by = d.closed_by,
             stage_entered_at = case when o.stage_id <> d.stage_id then coalesce(d.stage_entered_at, now()) else o.stage_entered_at end,
             custom = o.custom || d.custom
        from d where o.id = d.id`
  }
  await tally.save(tx, runId, 'deal')
  return true
}

// ---------------------------------------------------------------- leads
const loadLeads: Loader = async (tx, runId) => {
  const rows = await pending(tx, 'lead', 400)
  if (!rows.length) return false
  const refs = await refsFor(tx, runId)
  const accs = await accountsByOrg(tx, uniq(rows.map((r) => r.parent_ref)))
  const accNames = new Map<string, string>()
  const accIds = uniq([...accs.values()].map((a) => a.id))
  if (accIds.length) for (const a of await tx<{ id: string; name: string }[]>`select id, name from crm.accounts where id = any(${accIds}::uuid[])`) accNames.set(a.id, a.name)
  const personIds = uniq(rows.map((r) => sid(r.payload.person_id)))
  const contactIds = await refMap(tx, 'person', personIds)
  const contacts = new Map<string, { full_name: string; phone: string | null; email: string | null; market_code: string }>()
  const cids = uniq([...contactIds.values()])
  if (cids.length) {
    for (const c of await tx<{ id: string; full_name: string; phone: string | null; email: string | null; market_code: string }[]>`
      select id, full_name, phone, email::text, market_code from crm.contacts where id = any(${cids}::uuid[])`) contacts.set(c.id, c)
  }
  const existing = await refMap(tx, 'lead', rows.map((r) => r.external_id))
  const tally = new Tally()
  const fresh: Rec[] = []
  const changed: Rec[] = []
  for (const r of rows) {
    const p = r.payload
    const acc = r.parent_ref ? accs.get(r.parent_ref) : undefined
    const personId = sid(p.person_id)
    const contact = personId ? contacts.get(contactIds.get(personId) ?? '') : undefined
    const market = acc?.market ?? contact?.market_code ?? refs.ownerMarket.get(sid(p.owner_id) ?? '') ?? null
    if (!market || !refs.markets.has(market)) {
      tally.skip(r.external_id, 'no_market')
      continue
    }
    const title = str(p.title, 200)
    const business = (acc && accNames.get(acc.id)) || title || '(sin nombre)'
    const custom = customOf(refs.plans.deal, p, refs, new Set())
    const labels = (Array.isArray(p.label_ids) ? p.label_ids : []).map((l) => refs.leadLabels.get(String(l))).filter(Boolean)
    if (labels.length) custom.lead_labels = labels
    if (typeof p.source_name === 'string' && p.source_name) custom.lead_source = p.source_name
    const value = p.value as { amount?: unknown; currency?: unknown } | null
    if (value && Number.isFinite(Number(value.amount))) custom.lead_value = { amount: Number(value.amount), currency: value.currency ?? null }
    const archived = p.is_archived === true
    const created = M.isoTime(p.add_time)
    const id = existing.get(r.external_id) ?? null
    const rec: Rec = {
      id, ext: r.external_id, market, account_id: acc?.id ?? null, motor: refs.defaultMotor.get(market) ?? 'other', business_name: business.slice(0, 240),
      contact_name: contact?.full_name ?? '(sin contacto)', phone: contact?.phone ?? null, email: contact?.email ?? null,
      message: title && title !== business ? title : null, status: archived ? 'disqualified' : 'new', disqualify_code: archived ? 'pd_archived' : null,
      owner_id: refs.users.get(sid(p.owner_id) ?? '')?.id ?? null, custom, created_at: created,
    }
    const broken = leadRule({ business_name: String(rec.business_name), contact_name: String(rec.contact_name), phone: rec.phone as string | null, message: rec.message as string | null })
    if (broken) {
      tally.skip(r.external_id, skipReason(broken))
      continue
    }
    if (id) changed.push(rec)
    else fresh.push(rec)
    tally.ok(r.external_id, !id)
  }
  const cols = tx`x(id uuid, market text, account_id uuid, motor text, business_name text, contact_name text, phone text, email text, message text,
    status text, disqualify_code text, owner_id uuid, custom jsonb, created_at timestamptz)`
  if (fresh.length) {
    const nid = await newIds(tx, fresh.length)
    fresh.forEach((f, i) => (f.id = nid[i]))
    await tx`insert into crm.leads (id, market_code, account_id, source, motor, business_name, contact_name, phone, email, message, status, disqualify_code,
                                    owner_id, assigned_at, custom, created_at)
             select id, market, account_id, 'import', motor, business_name, contact_name, phone, email, message, status, disqualify_code,
                    owner_id, case when owner_id is not null then coalesce(created_at, now()) end, custom, coalesce(created_at, now())
               from jsonb_to_recordset(${J(tx, fresh)}) as ${cols}`
    await saveRefs(tx, 'lead', fresh.map((f) => ({ ext: String(f.ext), id: String(f.id) })))
  }
  if (changed.length) {
    // Un lead que ya se trabajó en CONTIGO conserva su estado; solo se refrescan los datos.
    await tx`update crm.leads l set account_id = coalesce(x.account_id, l.account_id), business_name = x.business_name, contact_name = x.contact_name,
                    phone = x.phone, email = x.email, message = x.message, owner_id = coalesce(x.owner_id, l.owner_id), custom = l.custom || x.custom,
                    status = case when l.status = 'new' then x.status else l.status end,
                    disqualify_code = case when l.status = 'new' then x.disqualify_code else l.disqualify_code end
               from jsonb_to_recordset(${J(tx, changed)}) as ${cols} where l.id = x.id`
  }
  await tally.save(tx, runId, 'lead')
  return true
}

// ---------------------------------------------------------------- actividades y notas
type Link = { id: string; account: string | null; market: string }
async function linkMaps(tx: Tx, rows: Raw[]) {
  const dealIds = uniq(rows.map((r) => sid(r.payload.deal_id)))
  const leadIds = uniq(rows.map((r) => sid(r.payload.lead_id)))
  const personIds = uniq(rows.map((r) => sid(r.payload.person_id)))
  const deals = new Map<string, Link>()
  if (dealIds.length) {
    for (const d of await tx<{ external_id: string; id: string; account_id: string; market_code: string }[]>`
      select r.external_id, d.id, d.account_id, d.market_code from crm.external_refs r join crm.deals d on d.id = r.internal_id
       where r.system = ${SRC} and r.object = 'deal' and r.external_id = any(${dealIds}::text[])`) deals.set(d.external_id, { id: d.id, account: d.account_id, market: d.market_code })
  }
  const leads = new Map<string, Link>()
  if (leadIds.length) {
    for (const l of await tx<{ external_id: string; id: string; account_id: string | null; market_code: string }[]>`
      select r.external_id, l.id, l.account_id, l.market_code from crm.external_refs r join crm.leads l on l.id = r.internal_id
       where r.system = ${SRC} and r.object = 'lead' and r.external_id = any(${leadIds}::text[])`) leads.set(l.external_id, { id: l.id, account: l.account_id, market: l.market_code })
  }
  const persons = new Map<string, Link>()
  if (personIds.length) {
    for (const c of await tx<{ external_id: string; id: string; account_id: string; market_code: string }[]>`
      select distinct on (r.external_id) r.external_id, r.internal_id as id, ac.account_id, a.market_code
        from crm.external_refs r join crm.account_contacts ac on ac.contact_id = r.internal_id and ac.valid_to is null
        join crm.accounts a on a.id = ac.account_id
       where r.system = ${SRC} and r.object = 'person' and r.external_id = any(${personIds}::text[])
       order by r.external_id, ac.valid_from`) persons.set(c.external_id, { id: c.id, account: c.account_id, market: c.market_code })
  }
  const accs = await accountsByOrg(tx, uniq(rows.map((r) => r.parent_ref)))
  return { deals, leads, persons, accs }
}

function resolveLink(r: Raw, maps: Awaited<ReturnType<typeof linkMaps>>) {
  const deal = maps.deals.get(sid(r.payload.deal_id) ?? '')
  const lead = maps.leads.get(sid(r.payload.lead_id) ?? '')
  const person = maps.persons.get(sid(r.payload.person_id) ?? '')
  const acc = r.parent_ref ? maps.accs.get(r.parent_ref) : undefined
  const accountId = acc?.id ?? deal?.account ?? lead?.account ?? person?.account ?? null
  const market = acc?.market ?? deal?.market ?? lead?.market ?? person?.market ?? null
  return { accountId, market, dealId: deal?.id ?? null, leadId: lead?.id ?? null }
}

const ACT_COLS = `x(id uuid, market text, account_id uuid, deal_id uuid, lead_id uuid, kind text, subject text, body text, due_at timestamptz,
  done_at timestamptz, owner_id uuid, created_by uuid, created_at timestamptz, custom jsonb, type_label text)`

async function writeActivities(tx: Tx, object: 'activity' | 'note', fresh: Rec[], changed: Rec[]): Promise<void> {
  if (fresh.length) {
    const nid = await newIds(tx, fresh.length)
    fresh.forEach((f, i) => (f.id = nid[i]))
    await tx`insert into crm.activities (id, market_code, account_id, deal_id, lead_id, kind, subject, body, due_at, done_at, owner_id, created_by, source, created_at, custom, type_label)
             select id, market, account_id, deal_id, lead_id, kind, subject, body, due_at, done_at, owner_id, created_by, 'import', coalesce(created_at, now()), custom, type_label
               from jsonb_to_recordset(${J(tx, fresh)}) as ${tx.unsafe(ACT_COLS)}`
    await saveRefs(tx, object, fresh.map((f) => ({ ext: String(f.ext), id: String(f.id) })))
  }
  if (changed.length) {
    await tx`update crm.activities a set account_id = x.account_id, deal_id = x.deal_id, lead_id = x.lead_id, kind = x.kind, subject = x.subject, body = x.body,
                    due_at = x.due_at, done_at = coalesce(a.done_at, x.done_at), owner_id = x.owner_id, custom = a.custom || x.custom, type_label = x.type_label
               from jsonb_to_recordset(${J(tx, changed)}) as ${tx.unsafe(ACT_COLS)} where a.id = x.id`
  }
}

const loadActivities: Loader = async (tx, runId, sysId) => {
  const rows = await pending(tx, 'activity', 400)
  if (!rows.length) return false
  const refs = await refsFor(tx, runId)
  const maps = await linkMaps(tx, rows)
  const existing = await refMap(tx, 'activity', rows.map((r) => r.external_id))
  const tally = new Tally()
  const fresh: Rec[] = []
  const changed: Rec[] = []
  for (const r of rows) {
    const p = r.payload
    const link = resolveLink(r, maps)
    if (!link.market) {
      tally.skip(r.external_id, 'no_link')
      continue
    }
    const typeKey = String(p.type ?? '')
    const typeName = refs.activityTypes.get(typeKey) ?? typeKey
    const created = M.isoTime(p.add_time)
    const date = typeof p.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.due_date) ? p.due_date : null
    const time = typeof p.due_time === 'string' && /^\d{2}:\d{2}/.test(p.due_time) ? p.due_time.slice(0, 5) : null
    const dueAt = date ? `${date}T${time ?? '12:00'}:00Z` : null
    const done = p.done === true || p.done === 1
    const ownerId = refs.users.get(sid(p.owner_id) ?? '')?.id ?? null
    const body = [M.htmlToText(p.note as string | null), typeof p.location === 'object' && p.location ? str((p.location as Rec).value, 300) : ''].filter(Boolean).join('\n\n')
    const id = existing.get(r.external_id) ?? null
    const rec: Rec = {
      id, ext: r.external_id, market: link.market, account_id: link.accountId, deal_id: link.dealId, lead_id: link.leadId,
      kind: M.activityKind(typeKey, typeName), subject: str(p.subject, 200) || typeName || 'Actividad', body: body || null, due_at: dueAt,
      done_at: done ? (M.isoTime(p.marked_as_done_time) ?? M.isoTime(p.update_time) ?? dueAt ?? created) : null,
      owner_id: ownerId, created_by: refs.users.get(sid(p.creator_user_id) ?? '')?.id ?? ownerId ?? sysId, created_at: created,
      custom: customOf(refs.plans.activity, p, refs, new Set()), type_label: typeName.slice(0, 60) || null,
    }
    if (id) changed.push(rec)
    else fresh.push(rec)
    tally.ok(r.external_id, !id)
  }
  await writeActivities(tx, 'activity', fresh, changed)
  await tally.save(tx, runId, 'activity')
  return true
}

const loadNotes: Loader = async (tx, runId, sysId) => {
  const rows = await pending(tx, 'note', 400)
  if (!rows.length) return false
  const refs = await refsFor(tx, runId)
  const maps = await linkMaps(tx, rows)
  const existing = await refMap(tx, 'note', rows.map((r) => r.external_id))
  const tally = new Tally()
  const fresh: Rec[] = []
  const changed: Rec[] = []
  for (const r of rows) {
    const p = r.payload
    const link = resolveLink(r, maps)
    if (!link.market) {
      tally.skip(r.external_id, 'no_link')
      continue
    }
    const text = M.htmlToText(p.content as string | null)
    if (!text) {
      tally.skip(r.external_id, 'empty')
      continue
    }
    const created = M.isoTime(p.add_time)
    const first = text.split('\n')[0]!.slice(0, 120)
    const id = existing.get(r.external_id) ?? null
    const rec: Rec = {
      id, ext: r.external_id, market: link.market, account_id: link.accountId, deal_id: link.dealId, lead_id: link.leadId, kind: 'note',
      subject: first || 'Nota', body: text.length > first.length ? text.slice(first.length).trim() || null : null, due_at: null, done_at: created, owner_id: null,
      created_by: refs.users.get(sid(p.user_id) ?? '')?.id ?? sysId, created_at: created, custom: {}, type_label: null,
    }
    if (id) changed.push(rec)
    else fresh.push(rec)
    tally.ok(r.external_id, !id)
  }
  await writeActivities(tx, 'note', fresh, changed)
  await tally.save(tx, runId, 'note')
  return true
}

// ---------------------------------------------------------------- productos y partidas
const loadProducts: Loader = async (tx, runId) => {
  const rows = await pending(tx, 'product', 400)
  if (!rows.length) return false
  const refs = await refsFor(tx, runId)
  const existing = await refMap(tx, 'product', rows.map((r) => r.external_id))
  const tally = new Tally()
  const fresh: Rec[] = []
  const changed: Rec[] = []
  for (const r of rows) {
    const p = r.payload
    const prices = (Array.isArray(p.prices) ? p.prices : [])
      .map((x) => x as Rec)
      .map((x) => ({ currency: typeof x.currency === 'string' ? x.currency : null, price_minor: M.toMinor(x.price) }))
      .filter((x) => x.currency && x.price_minor !== null)
    const id = existing.get(r.external_id) ?? null
    const rec: Rec = {
      id, ext: r.external_id, name: str(p.name, 200) || '(sin nombre)', code: str(p.code, 80) || null, unit: str(p.unit, 40) || null,
      category: p.category == null ? null : String(p.category).slice(0, 80), description: M.htmlToText(p.description as string | null, 2000) || null,
      prices, custom: customOf(refs.plans.product, p, refs, new Set()), is_active: p.is_deleted !== true,
    }
    if (id) changed.push(rec)
    else fresh.push(rec)
    tally.ok(r.external_id, !id)
  }
  const cols = `x(id uuid, name text, code text, unit text, category text, description text, prices jsonb, custom jsonb, is_active boolean)`
  if (fresh.length) {
    const nid = await newIds(tx, fresh.length)
    fresh.forEach((f, i) => (f.id = nid[i]))
    await tx`insert into crm.products (id, name, code, unit, category, description, prices, custom, is_active)
             select id, name, code, unit, category, description, prices, custom, is_active from jsonb_to_recordset(${J(tx, fresh)}) as ${tx.unsafe(cols)}`
    await saveRefs(tx, 'product', fresh.map((f) => ({ ext: String(f.ext), id: String(f.id) })))
  }
  if (changed.length) {
    await tx`update crm.products p set name = x.name, code = x.code, unit = x.unit, category = x.category, description = x.description, prices = x.prices,
                    custom = p.custom || x.custom, is_active = x.is_active
               from jsonb_to_recordset(${J(tx, changed)}) as ${tx.unsafe(cols)} where p.id = x.id`
  }
  await tally.save(tx, runId, 'product')
  return true
}

const loadDealProducts: Loader = async (tx, runId) => {
  const rows = await pending(tx, 'deal_product', 400)
  if (!rows.length) return false
  const dealIds = uniq(rows.map((r) => r.parent_ref))
  const deals = new Map<string, { id: string; market: string; currency: string }>()
  if (dealIds.length) {
    for (const d of await tx<{ external_id: string; id: string; market_code: string; currency: string }[]>`
      select r.external_id, d.id, d.market_code, d.currency from crm.external_refs r join crm.deals d on d.id = r.internal_id
       where r.system = ${SRC} and r.object = 'deal' and r.external_id = any(${dealIds}::text[])`) deals.set(d.external_id, { id: d.id, market: d.market_code, currency: d.currency.trim() })
  }
  const products = await refMap(tx, 'product', uniq(rows.map((r) => sid(r.payload.product_id))))
  const existing = await refMap(tx, 'deal_item', rows.map((r) => r.external_id))
  const tally = new Tally()
  const fresh: Rec[] = []
  const changed: Rec[] = []
  for (const r of rows) {
    const p = r.payload
    const deal = r.parent_ref ? deals.get(r.parent_ref) : undefined
    if (!deal) {
      tally.skip(r.external_id, 'no_deal')
      continue
    }
    const qty = Number(p.quantity)
    const id = existing.get(r.external_id) ?? null
    const rec: Rec = {
      id, ext: r.external_id, deal_id: deal.id, market: deal.market, product_id: products.get(sid(p.product_id) ?? '') ?? null,
      name: str(p.name, 200) || 'Producto', quantity: Number.isFinite(qty) ? qty : 1, unit_price_minor: M.toMinor(p.item_price), sum_minor: M.toMinor(p.sum),
      currency: typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency) ? p.currency : deal.currency,
      discount: Number.isFinite(Number(p.discount)) ? Number(p.discount) : null, discount_type: str(p.discount_type, 20) || null,
      comments: M.htmlToText(p.comments as string | null, 1000) || null, position: Number.isFinite(Number(p.order_nr)) ? Number(p.order_nr) : 0,
    }
    if (id) changed.push(rec)
    else fresh.push(rec)
    tally.ok(r.external_id, !id)
  }
  const cols = `x(id uuid, deal_id uuid, market text, product_id uuid, name text, quantity numeric, unit_price_minor bigint, sum_minor bigint, currency text,
    discount numeric, discount_type text, comments text, position int)`
  if (fresh.length) {
    const nid = await newIds(tx, fresh.length)
    fresh.forEach((f, i) => (f.id = nid[i]))
    await tx`insert into crm.deal_items (id, deal_id, market_code, product_id, name, quantity, unit_price_minor, sum_minor, currency, discount, discount_type, comments, position)
             select id, deal_id, market, product_id, name, quantity, unit_price_minor, sum_minor, currency, discount, discount_type, comments, position
               from jsonb_to_recordset(${J(tx, fresh)}) as ${tx.unsafe(cols)}`
    await saveRefs(tx, 'deal_item', fresh.map((f) => ({ ext: String(f.ext), id: String(f.id) })))
  }
  if (changed.length) {
    await tx`update crm.deal_items i set product_id = x.product_id, name = x.name, quantity = x.quantity, unit_price_minor = x.unit_price_minor, sum_minor = x.sum_minor,
                    currency = x.currency, discount = x.discount, discount_type = x.discount_type, comments = x.comments, position = x.position
               from jsonb_to_recordset(${J(tx, changed)}) as ${tx.unsafe(cols)} where i.id = x.id`
  }
  await tally.save(tx, runId, 'deal_product')
  return true
}

export const LOADERS = {
  'l:organization': loadOrganizations,
  'l:person': loadPersons,
  'l:deal': loadDeals,
  'l:lead': loadLeads,
  'l:activity': loadActivities,
  'l:note': loadNotes,
  'l:product': loadProducts,
  'l:deal_product': loadDealProducts,
} satisfies Record<string, Loader>

// ---------------------------------------------------------------- cierre de la corrida
export async function finish(tx: Tx, runId: string, sysId: string): Promise<void> {
  // Acceso: quien lleva registros en un mercado entra como ventas en ese mercado. Los demás roles los da administración.
  const members = await tx`
    insert into crm.memberships (user_id, market_code, role)
    select distinct x.user_id, x.market_code, 'rep'
      from (select owner_id as user_id, market_code from crm.accounts where owner_id is not null
            union select owner_id, market_code from crm.deals where owner_id is not null
            union select owner_id, market_code from crm.leads where owner_id is not null) x
      join crm.external_refs r on r.system = ${SRC} and r.object = 'user' and r.internal_id = x.user_id
      join crm.users u on u.id = x.user_id and u.is_active
      join crm.markets mk on mk.code = x.market_code and mk.status = 'live'
     where not exists (select 1 from crm.memberships m where m.user_id = x.user_id and (m.market_code = x.market_code or m.market_code is null)
                          and (m.valid_to is null or m.valid_to > now()))`
  await bump(tx, runId, ['created', 'membership'], members.count)

  // ACT-02: el próximo paso de un deal abierto es su actividad pendiente más cercana.
  await tx`
    update crm.deals d set next_step = x.subject, next_step_due = x.due
      from (select distinct on (a.deal_id) a.deal_id, left(a.subject, 200) as subject, coalesce(a.due_at, a.created_at)::date as due
              from crm.activities a
             where a.deal_id is not null and a.done_at is null and a.source = 'import' and a.kind <> 'note'
             order by a.deal_id, a.due_at nulls last) x
     where d.id = x.deal_id and d.status = 'open' and d.next_step is null`

  // CANAL-03: origen y dueño inicial de cada cuenta importada.
  await tx`
    insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, effective_from, created_by)
    select a.id, a.market_code, 'origin', 'import', ${SRC}, 'Pipedrive', a.created_at, ${sysId}
      from crm.accounts a
     where exists (select 1 from crm.account_aliases al where al.account_id = a.id and al.system = ${SRC})
       and not exists (select 1 from crm.account_attributions t where t.account_id = a.id and t.layer = 'origin')`
  await tx`
    insert into crm.account_attributions (account_id, market_code, layer, party_kind, party_ref, party_label, effective_from, created_by)
    select a.id, a.market_code, 'owner', 'user', a.owner_id::text, u.full_name, a.created_at, ${sysId}
      from crm.accounts a join crm.users u on u.id = a.owner_id
     where exists (select 1 from crm.account_aliases al where al.account_id = a.id and al.system = ${SRC})
       and not exists (select 1 from crm.account_attributions t where t.account_id = a.id and t.layer = 'owner')`

  await evaluateRules(tx)
  const run = await tx<{ stats: Json; mode: string | null }[]>`select stats, cursor ->> 'mode' as mode from crm.import_runs where id = ${runId}`
  await tx`insert into crm.audit_events (actor_id, action, object, object_id, after)
           values (${sysId}, 'import.completed', 'import_run', ${runId}, ${tx.json({ source: SRC, mode: run[0]?.mode ?? null, stats: run[0]?.stats ?? {} } as Json)})`
  cache = null
  territories.clear()
}
