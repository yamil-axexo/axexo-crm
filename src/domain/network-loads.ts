import 'server-only'
import { z } from 'zod'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, emit, newId } from '@/domain/common'
import { hasProhibited } from '@/domain/guard'
import { parseCsv } from '@/lib/csv'
import { toE164 } from '@/lib/format'
import { invalid, notFound } from '@/lib/errors'

/**
 * DAT-06: kit de ingesta de una red adquirida (EMIDA, Sky, Movilway u otra).
 * 1) Carga: el archivo CSV (el mismo lector de la importación) entra a un espacio aparte, con el mapeo de columnas guardado.
 *    No toca la cartera: nadie lo ve fuera de quien maneja las redes del mercado y de su entidad legal.
 * 2) Calidad y repetidos: cada fila se valida y se compara contra lo existente. Antes de la liberación de legal, solo contra la
 *    cartera de la MISMA entidad legal; el cruce con toda la cartera corre después de liberar (no se cruzan bases sin permiso).
 * 3) Liberación: legal (administración) y negocio (quien lidera el mercado o administración), dos personas distintas.
 * 4) Promoción por lotes: cada lote crea los comercios con su árbol, el ID del sistema de origen y el origen "conversión de red".
 *    Cada lote se puede regresar: lo que nadie trabajó se archiva; lo que ya tiene negocios o actividades se queda y se dice.
 */
type Pair = [es: string, en: string]
export const NETWORK_SYSTEMS = ['emida', 'sky', 'movilway', 'other'] as const
export const NETWORK_TARGETS = ['external_id', 'parent_external_id', 'name', 'phone', 'locality', 'region', 'kind'] as const
export type NetworkTarget = (typeof NETWORK_TARGETS)[number]
export const TARGET_LABEL: Record<NetworkTarget, Pair> = {
  external_id: ['ID en el sistema de origen', 'ID in the source system'],
  parent_external_id: ['ID del nodo padre (vacío: cuelga de la raíz)', 'Parent node ID (empty: hangs from the root)'],
  name: ['Nombre', 'Name'],
  phone: ['Teléfono', 'Phone'],
  locality: ['Ciudad', 'City'],
  region: ['Estado', 'State'],
  kind: ['Tipo (tienda, cadena, distribuidor)', 'Type (store, chain, distributor)'],
}
export const DEFAULT_MAPPING: Record<NetworkTarget, string> = {
  external_id: 'id', parent_external_id: 'parent_id', name: 'nombre', phone: 'telefono', locality: 'ciudad', region: 'estado', kind: 'tipo',
}
export const MAX_ROWS = 5000
const KIND_WORDS: Record<string, string> = { tienda: 'store', store: 'store', pdv: 'store', sucursal: 'store', cadena: 'chain', chain: 'chain', distribuidor: 'distributor', distributor: 'distributor', iso: 'distributor', agente: 'distributor', agent: 'distributor', organizacion: 'organization', organization: 'organization' }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const loadInput = z.object({
  market: z.string().min(2).max(3), entityId: z.guid(), name: z.string().trim().min(2).max(120), system: z.enum(NETWORK_SYSTEMS),
  rootAccountId: z.guid().or(z.literal('')).optional().default(''), mapping: z.record(z.string(), z.string()), text: z.string().max(2_000_000),
})
export type LoadInput = z.input<typeof loadInput>

/** Lee el archivo con el mapeo y deja cada fila en el espacio de la red, con sus problemas a la vista. */
export async function stageNetwork(ctx: Ctx, raw: LoadInput): Promise<{ id: string; rows: number }> {
  const p = loadInput.safeParse(raw)
  if (!p.success) throw invalid('Revisa el nombre de la carga, la entidad legal, el sistema de origen y el archivo.', 'Check the load name, legal entity, source system and file.')
  const v = p.data
  ctx.assert('network.load', v.market)
  const table = parseCsv(v.text)
  if (table.rows.length === 0) throw invalid('El archivo no tiene filas.', 'The file has no rows.')
  if (table.rows.length > MAX_ROWS) throw invalid(`El archivo pasa de ${MAX_ROWS} filas: pártelo en varias cargas.`, `The file has more than ${MAX_ROWS} rows: split it into several loads.`)
  const heads = table.headers.map(norm)
  const mapping: Partial<Record<NetworkTarget, string>> = {}
  const idx: Partial<Record<NetworkTarget, number>> = {}
  for (const t of NETWORK_TARGETS) {
    const col = norm(v.mapping[t] ?? '')
    if (!col) continue
    const i = heads.indexOf(col)
    if (i < 0) throw invalid(`No encontramos la columna "${col}" en el archivo. Columnas: ${table.headers.join(', ').slice(0, 300)}.`, `We could not find the "${col}" column in the file. Columns: ${table.headers.join(', ').slice(0, 300)}.`)
    mapping[t] = col
    idx[t] = i
  }
  if (idx.external_id === undefined || idx.name === undefined) throw invalid('El mapeo necesita al menos la columna del ID y la del nombre.', 'The mapping needs at least the ID column and the name column.')
  return withUser(ctx.user.id, async (tx) => {
    const ent = await tx<{ id: string }[]>`select id from crm.legal_entities where id = ${v.entityId} and market_code = ${v.market}`
    if (!ent[0]) throw invalid('Esa entidad legal no es de este mercado.', 'That legal entity is not in this market.')
    if (v.rootAccountId) {
      const r = await tx`select 1 from crm.accounts where id = ${v.rootAccountId} and market_code = ${v.market} and archived_at is null`
      if (!r[0]) throw invalid('No encontramos la cuenta raíz en este mercado.', 'We could not find the root account in this market.')
    }
    const cc = (await tx<{ phone_cc: string }[]>`select phone_cc from crm.markets where code = ${v.market}`)[0]?.phone_cc ?? '+1'
    const id = await newId(tx)
    await tx`insert into crm.network_loads (id, market_code, legal_entity_id, name, source_system, mapping, root_account_id, rows_total, created_by)
             values (${id}, ${v.market}, ${v.entityId}, ${v.name}, ${v.system}, ${tx.json(mapping as Record<string, string>)}, ${v.rootAccountId || null}, ${table.rows.length}, ${ctx.user.id})`
    const seen = new Set<string>()
    const cell = (r: string[], t: NetworkTarget) => (idx[t] === undefined ? '' : (r[idx[t]!] ?? '').trim())
    const rows = table.rows.map((r, i) => {
      const issues: string[] = []
      const ext = cell(r, 'external_id').slice(0, 80)
      const name = cell(r, 'name').slice(0, 160)
      const rawPhone = cell(r, 'phone')
      const phone = rawPhone ? toE164(rawPhone, cc) : null
      const kindRaw = norm(cell(r, 'kind'))
      const kind = kindRaw ? KIND_WORDS[kindRaw] : 'store'
      if (!ext) issues.push('missing_id')
      else if (seen.has(ext)) issues.push('repeated_id')
      if (!name) issues.push('missing_name')
      if (rawPhone && !phone) issues.push('bad_phone')
      if (!kind) issues.push('bad_kind')
      if (hasProhibited(...r)) issues.push('prohibited')
      if (ext) seen.add(ext)
      return {
        load_id: id, market_code: v.market, line: i + 2, external_id: ext || `fila-${i + 2}`, parent_external_id: cell(r, 'parent_external_id').slice(0, 80) || null,
        // Lo prohibido no se guarda ni en el espacio aparte: la fila queda con su problema y sin el texto.
        name: issues.includes('prohibited') ? '(sin guardar)' : name || '(sin nombre)', kind: kind ?? 'store', phone: issues.includes('prohibited') ? null : phone,
        locality: issues.includes('prohibited') ? null : cell(r, 'locality').slice(0, 120) || null, region: issues.includes('prohibited') ? null : cell(r, 'region').slice(0, 120) || null,
        status: issues.length ? 'error' : 'ready', issues,
      }
    })
    const unique = rows.filter((r, i) => rows.findIndex((x) => x.external_id === r.external_id) === i)
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500)
      await tx`insert into crm.network_load_rows ${tx(chunk, 'load_id', 'market_code', 'line', 'external_id', 'parent_external_id', 'name', 'kind', 'phone', 'locality', 'region', 'status', 'issues')}`
    }
    await dedupe(tx, id, false)
    await audit(tx, ctx, 'network_load.staged', 'network_load', id, v.market, null, { name: v.name, system: v.system, rows: table.rows.length, mapping: mapping as Record<string, string> })
    return { id, rows: table.rows.length }
  })
}

/**
 * Repetidos: dentro del archivo (mismo teléfono) y contra la cartera, por ID del sistema de origen, por teléfono y por nombre
 * más ciudad. `all = false` compara solo contra la cartera de la misma entidad legal (antes de la liberación de legal).
 */
async function dedupe(tx: Tx, loadId: string, all: boolean): Promise<void> {
  await tx`update crm.network_load_rows set status = 'ready', dup_account_id = null, dup_key = null where load_id = ${loadId} and status = 'duplicate'`
  await tx`
    with l as (select * from crm.network_loads where id = ${loadId}),
    cand as (
      select r.id as row_id, m.account_id, m.key, m.prio
        from crm.network_load_rows r cross join l
        cross join lateral (
          select x.account_id, 'alias'::text as key, 1 as prio from crm.account_aliases x join crm.accounts a on a.id = x.account_id
           where x.system = l.source_system and x.external_id = r.external_id and x.valid_to is null and a.market_code = l.market_code
             and (${all} or a.legal_entity_id = l.legal_entity_id)
          union all
          select a.id, 'phone', 2 from crm.accounts a
           where r.phone is not null and a.phone = r.phone and a.market_code = l.market_code and a.archived_at is null and a.merged_into is null
             and (${all} or a.legal_entity_id = l.legal_entity_id)
          union all
          select a.id, 'name', 3 from crm.accounts a
           where a.market_code = l.market_code and a.archived_at is null and a.merged_into is null and r.locality is not null
             and a.name_norm = app.norm(r.name) and lower(coalesce(a.locality, '')) = lower(r.locality)
             and (${all} or a.legal_entity_id = l.legal_entity_id)
        ) m
       where r.load_id = l.id and r.status = 'ready'
    ),
    best as (select distinct on (row_id) row_id, account_id, key from cand order by row_id, prio)
    update crm.network_load_rows r set status = 'duplicate', dup_account_id = b.account_id, dup_key = b.key from best b where r.id = b.row_id`
  await tx`
    update crm.network_load_rows r set status = 'duplicate', dup_key = 'in_file'
     where r.load_id = ${loadId} and r.status = 'ready' and r.phone is not null
       and exists (select 1 from crm.network_load_rows o where o.load_id = r.load_id and o.phone = r.phone and o.line < r.line)`
}

export async function releaseNetwork(ctx: Ctx, loadId: string, kind: 'legal' | 'business'): Promise<'released' | 'waiting'> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; status: string; legal_release_by: string | null; business_release_by: string | null }[]>`
      select market_code, status, legal_release_by, business_release_by from crm.network_loads where id = ${z.guid().parse(loadId)} for update`
    const l = rows[0]
    if (!l) throw notFound()
    ctx.assert(kind === 'legal' ? 'network.release_legal' : 'network.release_business', l.market_code)
    if (l.status !== 'staged') throw invalid('Esta carga ya se liberó o se cerró.', 'This load was already released or closed.')
    const other = kind === 'legal' ? l.business_release_by : l.legal_release_by
    if (other === ctx.user.id) throw invalid('La liberación de legal y la de negocio las dan dos personas distintas.', 'The legal and the business release are given by two different people.')
    if (kind === 'legal') await tx`update crm.network_loads set legal_release_by = ${ctx.user.id}, legal_release_at = now() where id = ${loadId}`
    else await tx`update crm.network_loads set business_release_by = ${ctx.user.id}, business_release_at = now() where id = ${loadId}`
    const both = Boolean(other)
    if (both) {
      await tx`update crm.network_loads set status = 'released' where id = ${loadId}`
      // Liberada: ahora sí se compara contra toda la cartera del mercado.
      await dedupe(tx, loadId, true)
    }
    await audit(tx, ctx, kind === 'legal' ? 'network_load.legal_released' : 'network_load.business_released', 'network_load', loadId, l.market_code, null, { released: both })
    return both ? 'released' : 'waiting'
  })
}

/** Promueve el siguiente lote: padres antes que hijos. Cada comercio nace con su ID del sistema de origen y origen "conversión de red". */
export async function promoteBatch(ctx: Ctx, loadId: string, size = 200): Promise<{ batch: number; created: number; left: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const ls = await tx<{ id: string; market_code: string; legal_entity_id: string; status: string; source_system: string; root_account_id: string | null; country: string }[]>`
      select l.id, l.market_code, l.legal_entity_id, l.status, l.source_system, l.root_account_id, l.market_code as country from crm.network_loads l where l.id = ${z.guid().parse(loadId)} for update`
    const l = ls[0]
    if (!l) throw notFound()
    ctx.assert('network.load', l.market_code)
    if (l.status !== 'released') throw invalid('La carga se promueve después de las dos liberaciones (legal y negocio).', 'The load is promoted after both releases (legal and business).')
    const batch = ((await tx<{ b: number }[]>`select coalesce(max(batch), 0)::int as b from crm.network_load_rows where load_id = ${l.id}`)[0]?.b ?? 0) + 1
    const origin = l.source_system === 'emida' ? 'emida_conversion' : 'network_conversion'
    const system = l.source_system === 'other' ? 'other' : l.source_system
    let created = 0
    // Hasta agotar el lote: en cada vuelta, las filas cuyo padre ya existe (o no está en el archivo).
    for (let pass = 0; pass < 20 && created < size; pass++) {
      const ready = await tx<{ id: string; external_id: string; name: string; kind: string; phone: string | null; locality: string | null; region: string | null; parent_account: string | null }[]>`
        select r.id, r.external_id, r.name, r.kind, r.phone, r.locality, r.region,
               coalesce(pr.account_id, ${l.root_account_id}::uuid) as parent_account
          from crm.network_load_rows r
          left join crm.network_load_rows pr on pr.load_id = r.load_id and pr.external_id = r.parent_external_id
         where r.load_id = ${l.id} and r.status = 'ready'
           and (r.parent_external_id is null or pr.id is null or pr.account_id is not null)
         order by r.line limit ${size - created}`
      if (ready.length === 0) break
      for (const r of ready) {
        const acc = await newId(tx)
        await tx`insert into crm.accounts (id, market_code, legal_entity_id, parent_id, kind, name, lifecycle, phone, locality, region, country, merchant_origin, merchant_origin_at, created_by)
                 values (${acc}, ${l.market_code}, ${l.legal_entity_id}, ${r.parent_account}, ${r.kind}, ${r.name}, 'onboarding', ${r.phone}, ${r.locality}, ${r.region},
                         ${l.market_code === 'MX' || l.market_code === 'US' || l.market_code === 'SV' ? l.market_code : null}, ${origin}, now(), ${ctx.user.id})`
        await tx`insert into crm.account_aliases (account_id, market_code, system, external_id) values (${acc}, ${l.market_code}, ${system}, ${r.external_id})`
        await tx`update crm.network_load_rows set status = 'promoted', account_id = ${acc}, batch = ${batch}, promoted_at = now() where id = ${r.id}`
        await emit(tx, 'account.created', 'account', acc, l.market_code, { kind: r.kind })
        created++
      }
    }
    const left = (await tx<{ n: number }[]>`select count(*)::int as n from crm.network_load_rows where load_id = ${l.id} and status = 'ready'`)[0]!.n
    if (left === 0) await tx`update crm.network_loads set status = 'done' where id = ${l.id}`
    await audit(tx, ctx, 'network_load.promoted', 'network_load', l.id, l.market_code, null, { batch, created, left })
    return { batch, created, left }
  })
}

/** Marcha atrás de un lote: se archiva lo que nadie trabajó (sin negocios ni actividades); lo demás se queda y se cuenta. */
export async function rollbackBatch(ctx: Ctx, loadId: string, batch: number): Promise<{ archived: number; kept: number }> {
  return withUser(ctx.user.id, async (tx) => {
    const ls = await tx<{ id: string; market_code: string }[]>`select id, market_code from crm.network_loads where id = ${z.guid().parse(loadId)} for update`
    const l = ls[0]
    if (!l) throw notFound()
    ctx.assert('network.load', l.market_code)
    const rows = await tx<{ id: string; account_id: string; worked: boolean }[]>`
      select r.id, r.account_id,
             (exists (select 1 from crm.deals d where d.account_id = r.account_id) or exists (select 1 from crm.activities a where a.account_id = r.account_id)
              or exists (select 1 from crm.accounts c where c.parent_id = r.account_id and c.archived_at is null
                          and not exists (select 1 from crm.network_load_rows z where z.account_id = c.id and z.load_id = r.load_id and z.batch = r.batch))) as worked
        from crm.network_load_rows r where r.load_id = ${l.id} and r.batch = ${batch} and r.status = 'promoted'`
    if (rows.length === 0) throw invalid('Ese lote no tiene comercios para regresar.', 'That batch has no merchants to roll back.')
    let archived = 0
    let kept = 0
    for (const r of rows) {
      if (r.worked) {
        await tx`update crm.network_load_rows set status = 'kept' where id = ${r.id}`
        kept++
        continue
      }
      await tx`update crm.account_aliases set valid_to = now() where account_id = ${r.account_id} and valid_to is null`
      await tx`update crm.accounts set archived_at = now() where id = ${r.account_id}`
      await tx`update crm.network_load_rows set status = 'rolled_back', account_id = null where id = ${r.id}`
      archived++
    }
    await tx`update crm.network_loads set status = case when exists (select 1 from crm.network_load_rows where load_id = ${l.id} and status = 'promoted') then status
                                                        when exists (select 1 from crm.network_load_rows where load_id = ${l.id} and status in ('ready','kept')) then 'released' else 'rolled_back' end
             where id = ${l.id}`
    await audit(tx, ctx, 'network_load.rolled_back', 'network_load', l.id, l.market_code, null, { batch, archived, kept })
    return { archived, kept }
  })
}
