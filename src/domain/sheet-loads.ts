import 'server-only'
import { createHash } from 'node:crypto'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, clean, newId } from '@/domain/common'
import { invalid } from '@/lib/errors'
import { toE164 } from '@/lib/format'
import { scrub } from '@/domain/pipedrive/mapping'
import { recordStageGaps } from '@/domain/embudo/stage-conditions'

/**
 * Carga desde las hojas mientras se retiran (E17.F4 y E14.F3). Quien dirige un equipo pega las filas de la hoja:
 *  - visitas: cada fila queda como una visita fechada en el hilo del comercio, con quién visitó, resultado y comentario;
 *  - tiendas migradas: cada tienda queda con un negocio ganado fechado en su día real de migración.
 * Volver a pegar las mismas filas no duplica nada: cada fila se reconoce por su comercio y su día. Lo que no se pudo
 * cargar queda en la carga con el número de fila y el porqué, para corregirlo en la hoja y volver a pegar.
 */
export const SHEET_MAX_ROWS = 500
/** Hasta dónde se acepta una fecha de la hoja hacia atrás: dos años de visitas, diez de migraciones. Nunca futura. */
export const VISIT_BACK_DAYS = 730
export const MIGRATION_BACK_DAYS = 3650

export type Problem = { row: number; es: string; en: string }
export type LoadResult = { loadId: string; total: number; loaded: number; known: number; failed: number; problems: Problem[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Texto pegado de una hoja (tabuladores) o un CSV (comas o punto y coma), con comillas. */
export function parseSheet(text: string): string[][] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const head = src.split('\n', 1)[0] ?? ''
  const sep = head.includes('\t') ? '\t' : (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) { row.push(cell.trim()); cell = '' }
    else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell !== '' || row.length > 0) { row.push(cell.trim()); rows.push(row) }
  return rows.filter((r) => r.some((c) => c !== ''))
}

const COLUMNS: Record<string, string[]> = {
  store: ['comercio', 'tienda', 'merchant id', 'id', 'store', 'merchant', 'telefono', 'phone'],
  date: ['fecha', 'dia', 'date', 'fecha de visita', 'fecha de migracion', 'migracion', 'migration date', 'visit date'],
  visitor: ['quien visito', 'visito', 'vendedor', 'visited by', 'rep', 'field rep'],
  status: ['resultado', 'estado', 'estatus', 'status', 'result', 'outcome'],
  action: ['accion', 'action'],
  comment: ['comentario', 'comentarios', 'nota', 'notas', 'comment', 'comments', 'notes'],
}

function header(rows: string[][], need: string[]): Record<string, number> {
  const first = (rows[0] ?? []).map(norm)
  const idx: Record<string, number> = {}
  for (const [key, names] of Object.entries(COLUMNS)) idx[key] = first.findIndex((c) => names.includes(c))
  const missing = need.filter((k) => (idx[k] ?? -1) < 0)
  if (missing.length) {
    const say = (k: string) => (k === 'store' ? ['Comercio', 'Store'] : ['Fecha', 'Date'])
    throw invalid(
      `La primera fila tiene que traer los títulos de las columnas. Falta: ${missing.map((k) => say(k)[0]).join(', ')}.`,
      `The first row must carry the column titles. Missing: ${missing.map((k) => say(k)[1]).join(', ')}.`)
  }
  return idx
}

/** Fecha de la hoja: 2026-03-09, 09/03/2026 o 9/3/26 (día primero, como se escribe en México). */
export function sheetDate(raw: string): string | null {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  let y: number, mo: number, d: number
  if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]! } else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s)
    if (!m) return null
    d = +m[1]!; mo = +m[2]!; y = +m[3]!
    if (y < 100) y += 2000
  }
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const OUTCOMES: [string, 'sale' | 'no_sale' | 'revisit'][] = [
  ['venta', 'sale'], ['vendio', 'sale'], ['alta', 'sale'], ['migrada', 'sale'], ['sale', 'sale'], ['sold', 'sale'],
  ['volver', 'revisit'], ['revisita', 'revisit'], ['regresar', 'revisit'], ['revisit', 'revisit'], ['come back', 'revisit'],
  ['sin venta', 'no_sale'], ['no venta', 'no_sale'], ['no vendio', 'no_sale'], ['no sale', 'no_sale'], ['no_sale', 'no_sale'],
]
/** El estado de la hoja se lleva a los tres resultados de una visita. Lo que no se reconoce queda "sin venta" y el texto original se conserva en la nota. */
export function sheetOutcome(raw: string): { outcome: 'sale' | 'no_sale' | 'revisit'; known: boolean } {
  const n = norm(raw)
  const hit = OUTCOMES.find(([k]) => n === norm(k))
  return hit ? { outcome: hit[1], known: true } : { outcome: 'no_sale', known: n === '' }
}

type Found = { id: string; name: string; owner_id: string | null }

/** El comercio de una fila: por su identificador externo (Merchant ID, Sales App), por teléfono o por nombre exacto. Solo dentro de lo que la persona ve. */
async function findStore(tx: Tx, market: string, phoneCc: string, ref: string): Promise<Found | 'many' | null> {
  const byAlias = await tx<Found[]>`
    select distinct a.id, a.name, a.owner_id from crm.account_aliases al join crm.accounts a on a.id = al.account_id
     where al.market_code = ${market} and al.external_id = ${ref} and al.valid_to is null and a.archived_at is null and a.merged_into is null limit 2`
  if (byAlias.length === 1) return byAlias[0]!
  if (byAlias.length > 1) return 'many'
  const phone = /^[+\d][\d\s().-]{6,}$/.test(ref) ? toE164(ref, phoneCc) : null
  if (phone) {
    const byPhone = await tx<Found[]>`select id, name, owner_id from crm.accounts where market_code = ${market} and phone = ${phone} and archived_at is null and merged_into is null limit 2`
    if (byPhone.length === 1) return byPhone[0]!
    if (byPhone.length > 1) return 'many'
  }
  const byName = await tx<Found[]>`
    select id, name, owner_id from crm.accounts where market_code = ${market} and name_norm = app.norm(${ref}) and archived_at is null and merged_into is null limit 2`
  if (byName.length === 1) return byName[0]!
  return byName.length > 1 ? 'many' : null
}

const NOT_FOUND = (ref: string): [string, string] => [`No encontramos el comercio "${ref.slice(0, 60)}" entre los que ves.`, `We could not find the merchant "${ref.slice(0, 60)}" among the ones you can see.`]
const MANY = (ref: string): [string, string] => [`Hay más de un comercio para "${ref.slice(0, 60)}": usa su Merchant ID.`, `More than one merchant matches "${ref.slice(0, 60)}": use its Merchant ID.`]

function prepare(ctx: Ctx, market: string, text: string, need: string[]) {
  const mk = ctx.market(market)
  const rows = parseSheet(text ?? '')
  if (rows.length < 2) throw invalid('Pega las filas de la hoja con su fila de títulos.', 'Paste the sheet rows together with their title row.')
  const idx = header(rows, need)
  const body = rows.slice(1)
  if (body.length > SHEET_MAX_ROWS) throw invalid(`Pega hasta ${SHEET_MAX_ROWS} filas por carga.`, `Paste up to ${SHEET_MAX_ROWS} rows per load.`)
  const cell = (r: string[], k: string) => ((idx[k] ?? -1) >= 0 ? (r[idx[k]!] ?? '').trim() : '')
  return { mk, body, cell }
}

async function inRange(tx: Tx, tz: string, day: string, back: number): Promise<boolean> {
  const ok = await tx<{ ok: boolean }[]>`select ${day}::date <= (now() at time zone ${tz})::date and ${day}::date >= (now() at time zone ${tz})::date - ${back}::int as ok`
  return ok[0]?.ok === true
}

const key = (...parts: string[]) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40)

async function closeLoad(tx: Tx, ctx: Ctx, market: string, kind: 'visits' | 'migrated_stores', loadId: string, total: number, loaded: number, known: number, problems: Problem[], refs: string[]): Promise<LoadResult> {
  const failed = problems.length
  await tx`update crm.sheet_loads set rows_total = ${total}, rows_loaded = ${loaded}, rows_known = ${known}, rows_failed = ${failed},
            problems = ${tx.json(problems.slice(0, 100))} where id = ${loadId}`
  await audit(tx, ctx, kind === 'visits' ? 'sheet.visits_loaded' : 'sheet.migrated_loaded', 'sheet_load', loadId, market, null,
    { rows: total, loaded, known, failed, ...(kind === 'visits' ? { activity_ids: refs.slice(0, 50) } : { deal_ids: refs.slice(0, 50) }) })
  return { loadId, total, loaded, known, failed, problems }
}

/** Visitas que el equipo de campo sigue anotando en hojas: cada fila queda como visita fechada en el comercio. */
export async function loadVisitsSheet(ctx: Ctx, market: string, text: string, label?: string): Promise<LoadResult> {
  ctx.assert('visit.sheet_load', market)
  const { mk, body, cell } = prepare(ctx, market, text, ['store', 'date'])
  return withUser(ctx.user.id, async (tx) => {
    await recordStageGaps(tx) // PIPE-01: carga histórica; lo que falte para la etapa queda anotado, no se rechaza
    const loadId = await newId(tx)
    await tx`insert into crm.sheet_loads (id, market_code, kind, label, created_by) values (${loadId}, ${market}, 'visits', ${clean(label)?.slice(0, 120) ?? null}, ${ctx.user.id})`
    const problems: Problem[] = []
    const refs: string[] = []
    let loaded = 0
    let known = 0
    for (const [i, r] of body.entries()) {
      const n = i + 2 // la fila 1 es la de títulos
      const bad = (es: string, en: string) => problems.push({ row: n, es, en })
      const ref = cell(r, 'store')
      const day = sheetDate(cell(r, 'date'))
      if (!ref) { bad('Falta el comercio.', 'The merchant is missing.'); continue }
      if (!day) { bad('La fecha no se entiende: usa 2026-03-09 o 09/03/2026.', 'The date is not readable: use 2026-03-09 or 09/03/2026.'); continue }
      if (!(await inRange(tx, mk.timezone, day, VISIT_BACK_DAYS))) { bad('La fecha es futura o de hace más de dos años.', 'The date is in the future or more than two years back.'); continue }
      const store = await findStore(tx, market, mk.phoneCc, ref)
      if (store === 'many') { bad(...MANY(ref)); continue }
      if (!store) { bad(...NOT_FOUND(ref)); continue }
      const visitor = scrub(cell(r, 'visitor')).slice(0, 80)
      if (visitor && visitor.length < 2) { bad('El nombre de quien visitó es muy corto.', 'The visitor name is too short.'); continue }
      const status = cell(r, 'status')
      const out = sheetOutcome(status)
      // SEC-08: lo que viene de la hoja se guarda sin datos prohibidos (tarjetas, cuentas): la visita no se pierde por un comentario.
      const note = [
        !out.known && status ? `${ctx.t('Estado en la hoja', 'Status on the sheet')}: ${scrub(status).slice(0, 120)}` : null,
        cell(r, 'action') ? `${ctx.t('Acción', 'Action')}: ${scrub(cell(r, 'action')).slice(0, 300)}` : null,
        cell(r, 'comment') ? scrub(cell(r, 'comment')).slice(0, 1000) : null,
      ].filter(Boolean).join('\n')
      const rowKey = key(store.id, day, norm(visitor))
      const seen = await tx`select 1 from crm.sheet_rows where market_code = ${market} and kind = 'visits' and row_key = ${rowKey}`
      if (seen[0]) { known++; continue }
      const id = await newId(tx)
      await tx`insert into crm.activities (id, market_code, account_id, kind, subject, body, done_at, outcome, visited_by, owner_id, created_by, source, created_at)
               values (${id}, ${market}, ${store.id}, 'visit', ${ctx.t('Visita (cargada de la hoja)', 'Visit (loaded from the sheet)')}, ${note || null},
                       (${day}::date + time '12:00') at time zone ${mk.timezone}, ${out.outcome}, ${visitor || null}, ${store.owner_id}, ${ctx.user.id}, 'import',
                       (${day}::date + time '12:00') at time zone ${mk.timezone})`
      await tx`insert into crm.sheet_rows (market_code, kind, row_key, load_id, ref_id) values (${market}, 'visits', ${rowKey}, ${loadId}, ${id})`
      refs.push(id)
      loaded++
    }
    return closeLoad(tx, ctx, market, 'visits', loadId, body.length, loaded, known, problems, refs)
  })
}

/**
 * Tiendas ya migradas: cada una queda con UN negocio ganado, fechado en su día real de migración (E14.F3). Si la tienda
 * tenía un negocio abierto en el embudo de tiendas, ese se gana con esa fecha; si ya tenía uno ganado con otra fecha, se
 * corrige la fecha; si no tenía ninguno, nace ganado. Los reportes de ganados por mes cuentan así la historia real.
 */
export async function loadMigratedStores(ctx: Ctx, market: string, text: string, label?: string): Promise<LoadResult> {
  ctx.assert('deal.migrated_load', market)
  const { mk, body, cell } = prepare(ctx, market, text, ['store', 'date'])
  return withUser(ctx.user.id, async (tx) => {
    await recordStageGaps(tx) // PIPE-01: carga histórica; lo que falte para la etapa queda anotado, no se rechaza
    const pipes = await tx<{ id: string; won: string | null }[]>`
      select p.id, (select s.id from crm.stages s where s.pipeline_id = p.id and s.kind = 'won' and s.archived_at is null order by s.position limit 1) as won
        from crm.pipelines p where p.market_code = ${market} and p.motor = 'd2d' and p.is_active order by p.position limit 1`
    const pipe = pipes[0]
    if (!pipe?.won) throw invalid('Este mercado no tiene un embudo de tiendas con etapa ganada.', 'This market has no store pipeline with a won stage.')
    const loadId = await newId(tx)
    await tx`insert into crm.sheet_loads (id, market_code, kind, label, created_by) values (${loadId}, ${market}, 'migrated_stores', ${clean(label)?.slice(0, 120) ?? null}, ${ctx.user.id})`
    const problems: Problem[] = []
    const refs: string[] = []
    let loaded = 0
    let known = 0
    for (const [i, r] of body.entries()) {
      const n = i + 2
      const bad = (es: string, en: string) => problems.push({ row: n, es, en })
      const ref = cell(r, 'store')
      const day = sheetDate(cell(r, 'date'))
      if (!ref) { bad('Falta el comercio.', 'The merchant is missing.'); continue }
      if (!day) { bad('La fecha no se entiende: usa 2026-03-09 o 09/03/2026.', 'The date is not readable: use 2026-03-09 or 09/03/2026.'); continue }
      if (!(await inRange(tx, mk.timezone, day, MIGRATION_BACK_DAYS))) { bad('La fecha de migración es futura o demasiado antigua.', 'The migration date is in the future or too far back.'); continue }
      const store = await findStore(tx, market, mk.phoneCc, ref)
      if (store === 'many') { bad(...MANY(ref)); continue }
      if (!store) { bad(...NOT_FOUND(ref)); continue }
      const at = tx`(${day}::date + time '12:00') at time zone ${mk.timezone}`
      const deals = await tx<{ id: string; status: string; stage_id: string; same_day: boolean }[]>`
        select d.id, d.status, d.stage_id, (d.won_at at time zone ${mk.timezone})::date = ${day}::date as same_day
          from crm.deals d where d.account_id = ${store.id} and d.pipeline_id = ${pipe.id} and d.status in ('won', 'open')
         order by (d.status = 'won') desc, d.created_at desc limit 1 for update`
      const deal = deals[0]
      let dealId: string
      let how: 'created' | 'won' | 'redated'
      if (deal?.status === 'won') {
        if (deal.same_day) { known++; continue }
        await tx`update crm.deals set won_at = ${at} where id = ${deal.id}`
        dealId = deal.id
        how = 'redated'
      } else if (deal) {
        await tx`update crm.deals set status = 'won', stage_id = ${pipe.won}, won_at = ${at}, closed_by = 'manual', stage_entered_at = now(), revisit_needed = false where id = ${deal.id}`
        await tx`insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause, at) values (${deal.id}, ${market}, ${deal.stage_id}, ${pipe.won}, ${ctx.user.id}, 'import', ${at})`
        dealId = deal.id
        how = 'won'
      } else {
        dealId = await newId(tx)
        await tx`insert into crm.deals (id, market_code, pipeline_id, stage_id, account_id, owner_id, title, currency, status, won_at, closed_by, stage_entered_at, created_by, created_at)
                 values (${dealId}, ${market}, ${pipe.id}, ${pipe.won}, ${store.id}, ${store.owner_id}, ${ctx.t(`Migración: ${store.name}`, `Migration: ${store.name}`).slice(0, 200)}, ${mk.currency},
                         'won', ${at}, 'manual', ${at}, ${ctx.user.id}, ${at})`
        await tx`insert into crm.deal_stage_events (deal_id, market_code, from_stage_id, to_stage_id, actor_id, cause, at) values (${dealId}, ${market}, null, ${pipe.won}, ${ctx.user.id}, 'import', ${at})`
        how = 'created'
      }
      await tx`insert into crm.sheet_rows (market_code, kind, row_key, load_id, ref_id) values (${market}, 'migrated_stores', ${key(store.id, day)}, ${loadId}, ${dealId})
               on conflict (market_code, kind, row_key) do nothing`
      await audit(tx, ctx, 'deal.won_on_migration', 'deal', dealId, market, deal ? { status: deal.status } : null, { status: 'won', won_on: day, how, account_id: store.id })
      refs.push(dealId)
      loaded++
    }
    return closeLoad(tx, ctx, market, 'migrated_stores', loadId, body.length, loaded, known, problems, refs)
  })
}
