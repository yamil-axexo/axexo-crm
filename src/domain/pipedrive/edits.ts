import 'server-only'
import type { Tx } from '@/server/db'
import type { Json } from './refs'

/**
 * E6.F2: lo editado en CONTIGO manda. La recarga recuerda qué valor trajo de Pipedrive la última vez (la "base") y, campo por campo:
 * - si CONTIGO tiene lo mismo que llega, no hay nada que hacer;
 * - si en CONTIGO está vacío, se llena con lo que llega;
 * - si en CONTIGO sigue el valor de la base (nadie lo tocó), se actualiza con lo que llega;
 * - si alguien lo cambió en CONTIGO y Pipedrive no cambió, se queda lo de CONTIGO, sin ruido;
 * - si cambiaron los dos (o no hay base para saberlo), se queda lo de CONTIGO y el choque va a la cola para que una persona decida.
 */
export type Obj = 'account' | 'contact' | 'deal'
type Rec = Record<string, unknown>

/** Los campos que la recarga protege, por tipo de registro. En negocios, "etapa" mueve también el estado y las fechas de cierre. */
export const GUARDED: Record<Obj, readonly string[]> = {
  account: ['name', 'owner_id', 'phone', 'email', 'segment', 'territory_id', 'address_line', 'locality', 'region', 'postal_code'],
  contact: ['full_name', 'phone', 'email', 'owner_id'],
  deal: ['title', 'owner_id', 'amount_minor', 'stage_id'],
}
/** Lo que acompaña a la etapa de un negocio: si la etapa se queda como está en CONTIGO, esto también. */
export const STAGE_COMPANIONS = ['pipeline_id', 'status', 'won_at', 'lost_at', 'loss_reason_code', 'loss_note', 'closed_by', 'stage_entered_at'] as const

const TABLE: Record<Obj, string> = { account: 'crm.accounts', contact: 'crm.contacts', deal: 'crm.deals' }
const LABEL: Record<Obj, string> = { account: 'name', contact: 'full_name', deal: 'title' }

export const norm = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  const s = String(v).trim()
  return s === '' ? null : s
}

export type Decision = { apply: boolean; conflict: boolean; base: string | null }
/** La regla de un campo, sola y pura: la prueban las pruebas por campo. */
export function decideField(incoming: unknown, current: unknown, base: string | null | undefined): Decision {
  const inc = norm(incoming)
  const cur = norm(current)
  if (inc === cur) return { apply: false, conflict: false, base: inc }
  if (cur === null) return { apply: true, conflict: false, base: inc }
  if (base !== undefined && cur === base) return { apply: true, conflict: false, base: inc }
  if (base !== undefined && inc === base) return { apply: false, conflict: false, base }
  return { apply: false, conflict: true, base: base ?? null }
}

/**
 * Ajusta `changed` (registros que ya existen) para que no pise lo editado en CONTIGO, deja los choques en la cola y
 * guarda la base nueva de cada registro. `fresh` (los que nacen ahora) solo guarda su base.
 */
export async function guardEdits(tx: Tx, runId: string, object: Obj, changed: Rec[], fresh: Rec[]): Promise<{ kept: number; conflicts: number }> {
  const fields = GUARDED[object]
  const bases: Rec[] = []
  let kept = 0
  const conflicts: Rec[] = []
  if (changed.length) {
    const ids = changed.map((c) => String(c.id))
    const cols = [...new Set([...fields, LABEL[object], ...(object === 'deal' ? STAGE_COMPANIONS : [])])]
    const current = new Map<string, Rec>()
    for (const row of await tx<Rec[]>`select id, market_code, ${tx(cols)} from ${tx.unsafe(TABLE[object])} where id = any(${ids}::uuid[])`) current.set(String(row.id), row)
    const prior = new Map<string, Record<string, string | null>>()
    for (const b of await tx<{ record_id: string; fields: Record<string, string | null> }[]>`
      select record_id, fields from crm.import_baselines where object = ${object} and record_id = any(${ids}::uuid[])`) prior.set(b.record_id, b.fields)
    for (const rec of changed) {
      const cur = current.get(String(rec.id))
      if (!cur) continue
      const base = prior.get(String(rec.id))
      const next: Record<string, string | null> = {}
      for (const f of fields) {
        const d = decideField(rec[f], cur[f], base ? (f in base ? base[f] : undefined) : undefined)
        next[f] = d.base
        if (d.apply) continue
        if (norm(rec[f]) !== norm(cur[f])) kept++
        if (d.conflict) {
          const pd = f === 'stage_id' && object === 'deal'
            ? Object.fromEntries(['stage_id', ...STAGE_COMPANIONS].map((k) => [k, norm(rec[k])]))
            : norm(rec[f])
          conflicts.push({ object, record_id: rec.id, market: cur.market_code, label: String(cur[LABEL[object]] ?? '').slice(0, 240), field: f, contigo: norm(cur[f]), pipedrive: pd })
        }
        rec[f] = cur[f]
        if (f === 'stage_id' && object === 'deal') for (const k of STAGE_COMPANIONS) rec[k] = cur[k]
      }
      bases.push({ id: rec.id, market: cur.market_code, fields: next })
    }
  }
  for (const rec of fresh) bases.push({ id: rec.id, market: rec.market, fields: Object.fromEntries(fields.map((f) => [f, norm(rec[f])])) })
  if (bases.length) {
    await tx`insert into crm.import_baselines (object, record_id, market_code, fields)
             select ${object}, x.id, x.market, x.fields from jsonb_to_recordset(${tx.json(bases as Json)}) as x(id uuid, market text, fields jsonb)
             on conflict (object, record_id) do update set fields = excluded.fields, updated_at = now()`
  }
  if (conflicts.length) {
    await tx`insert into crm.import_conflicts (object, record_id, market_code, record_label, field, contigo_value, pipedrive_value, run_id)
             select x.object, x.record_id, x.market, x.label, x.field, x.contigo, x.pipedrive, ${runId}::uuid
               from jsonb_to_recordset(${tx.json(conflicts as Json)}) as x(object text, record_id uuid, market text, label text, field text, contigo jsonb, pipedrive jsonb)
             on conflict (object, record_id, field) where status = 'open'
             do update set pipedrive_value = excluded.pipedrive_value, contigo_value = excluded.contigo_value, record_label = excluded.record_label, run_id = excluded.run_id, detected_at = now()`
  }
  return { kept, conflicts: conflicts.length }
}

/** Mercados donde Pipedrive ya se apagó (corte cerrado): la recarga ya no toca sus registros. */
export async function cutOverMarkets(tx: Tx): Promise<Set<string>> {
  const rows = await tx<{ market_code: string }[]>`select market_code from crm.pipedrive_cutover where pipedrive_off_at is not null`
  return new Set(rows.map((r) => r.market_code))
}
