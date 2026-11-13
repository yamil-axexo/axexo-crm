import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit, newId } from '@/domain/common'
import { assertNoProhibited } from '@/domain/guard'
import { invalid, notFound } from '@/lib/errors'
import type { ValueSchema } from '@/domain/custom'

/**
 * DAT-05 (datos2). Reglas del valor de un campo con palabras de JSON Schema: número con mínimo y máximo, texto con largo y
 * forma. Las fija administración; el dominio las aplica al guardar (domain/custom.ts).
 */
export async function setFieldSchema(ctx: Ctx, fieldId: string, raw: { minimum?: string; maximum?: string; minLength?: string; maxLength?: string; pattern?: string }): Promise<ValueSchema> {
  ctx.assert('config.manage')
  const num = (s: string | undefined, label: [string, string]) => {
    const v = (s ?? '').trim()
    if (!v) return undefined
    const n = Number(v)
    if (!Number.isFinite(n)) throw invalid(`${label[0]}: escribe un número.`, `${label[1]}: enter a number.`)
    return n
  }
  const schema: ValueSchema = {}
  return withUser(ctx.user.id, async (tx) => {
    const f = (await tx<{ data_type: string; market_code: string | null; key: string; value_schema: ValueSchema }[]>`select data_type, market_code, key, value_schema from crm.field_definitions where id = ${fieldId} for update`)[0]
    if (!f) throw notFound()
    if (f.data_type === 'number') {
      schema.minimum = num(raw.minimum, ['Mínimo', 'Minimum'])
      schema.maximum = num(raw.maximum, ['Máximo', 'Maximum'])
      if (schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) throw invalid('El mínimo es mayor que el máximo.', 'The minimum is above the maximum.')
    } else if (f.data_type === 'text') {
      schema.minLength = num(raw.minLength, ['Largo mínimo', 'Minimum length'])
      schema.maxLength = num(raw.maxLength, ['Largo máximo', 'Maximum length'])
      for (const n of [schema.minLength, schema.maxLength]) if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 4000)) throw invalid('El largo va de 0 a 4000 caracteres.', 'Length goes from 0 to 4000 characters.')
      const pattern = (raw.pattern ?? '').trim()
      if (pattern) {
        if (pattern.length > 200) throw invalid('La forma lleva hasta 200 caracteres.', 'The format takes up to 200 characters.')
        try {
          new RegExp(pattern)
        } catch {
          throw invalid('La forma no es válida.', 'The format is not valid.')
        }
        schema.pattern = pattern
      }
    } else throw invalid('Las reglas aplican a campos de número o de texto.', 'Rules apply to number or text fields.')
    const clean = Object.fromEntries(Object.entries(schema).filter(([, v]) => v !== undefined)) as ValueSchema
    await tx`update crm.field_definitions set value_schema = ${tx.json(clean)} where id = ${fieldId}`
    await audit(tx, ctx, 'field.schema_set', 'field', fieldId, f.market_code, { value_schema: f.value_schema }, { key: f.key, value_schema: clean })
    return clean
  })
}

const TABLE: Record<string, string> = { account: 'accounts', deal: 'deals', lead: 'leads', contact: 'contacts', activity: 'activities' }
const SQL_TYPE: Record<string, string> = { text: 'text', select: 'text', number: 'numeric', date: 'date', boolean: 'boolean' }

/** El cambio que hace falta para pasar un campo a columna: agregar la columna, copiar lo que ya hay, índice y mapeo. */
export function promotionSql(f: { id: string; object: string; key: string; data_type: string }, column: string): string {
  const table = TABLE[f.object]
  const type = SQL_TYPE[f.data_type]
  if (!table || !type) throw invalid('Ese campo no se puede pasar a columna.', 'That field cannot be promoted to a column.')
  return [
    `-- Pasar el campo "${f.key}" a la columna crm.${table}.${column}`,
    `alter table crm.${table} add column ${column} ${type};`,
    `update crm.${table} set ${column} = (custom ->> '${f.key}')::${type} where custom ? '${f.key}';`,
    `create index ${table}_${column}_idx on crm.${table} (${column}) where ${column} is not null;`,
    `update crm.field_definitions set mapped_to = 'core:${column}' where id = '${f.id}';`,
  ].join('\n')
}

/**
 * Pedir que un campo pase a columna real (porque se filtra, entra a RLS o a una métrica). CONTIGO arma el cambio; lo aplica una
 * migración con revisión técnica. Lo pide quien lidera el mercado del campo o administración.
 */
export async function requestPromotion(ctx: Ctx, fieldId: string, reason: string): Promise<string> {
  const why = reason.trim()
  if (why.length < 10 || why.length > 400) throw invalid('Escribe para qué hace falta la columna (de 10 a 400 letras): un filtro, un permiso o una métrica.', 'Say what the column is needed for (10 to 400 characters): a filter, a permission or a metric.')
  assertNoProhibited(why)
  return withUser(ctx.user.id, async (tx) => {
    const f = (await tx<{ id: string; object: string; key: string; data_type: string; market_code: string | null; status: string; mapped_to: string | null }[]>`
      select id, object, key, data_type, market_code, status, mapped_to from crm.field_definitions where id = ${fieldId}`)[0]
    if (!f) throw notFound()
    if (f.market_code) ctx.assert('field.propose', f.market_code)
    else ctx.assert('config.manage')
    if (f.status !== 'approved' || f.mapped_to) throw invalid('Solo un campo aprobado que todavía vive en campos adicionales se pasa a columna.', 'Only an approved field that still lives in additional fields can be promoted.')
    const table = TABLE[f.object]
    if (!table) throw invalid('Ese campo no se puede pasar a columna.', 'That field cannot be promoted to a column.')
    let column = f.key
    if (await colExists(tx, table, column)) column = `x_${f.key}`.slice(0, 41)
    const open = await tx`select 1 from crm.field_promotions where field_id = ${fieldId} and status = 'requested'`
    if (open[0]) throw invalid('Ya hay un pedido abierto para este campo.', 'There is already an open request for this field.')
    const id = await newId(tx)
    await tx`insert into crm.field_promotions (id, field_id, market_code, reason, column_name, migration_sql, requested_by)
             values (${id}, ${fieldId}, ${f.market_code}, ${why}, ${column}, ${promotionSql(f, column)}, ${ctx.user.id})`
    await audit(tx, ctx, 'field.promotion_requested', 'field', fieldId, f.market_code, null, { key: f.key, column, reason: why })
    return id
  })
}

async function colExists(tx: Tx, table: string, column: string): Promise<boolean> {
  return (await tx<{ ok: boolean }[]>`select app.column_exists(${table}, ${column}) as ok`)[0]?.ok ?? false
}

/** Administración cierra un pedido a mano (rechazado, con motivo). El "hecho" lo marca CONTIGO solo cuando la columna existe. */
export async function closePromotion(ctx: Ctx, id: string, note: string): Promise<void> {
  ctx.assert('config.manage')
  const why = note.trim()
  if (why.length < 5 || why.length > 300) throw invalid('Escribe por qué se cierra (de 5 a 300 letras).', 'Say why it is closed (5 to 300 characters).')
  assertNoProhibited(why)
  await withUser(ctx.user.id, async (tx) => {
    const p = (await tx<{ field_id: string; market_code: string | null }[]>`select field_id, market_code from crm.field_promotions where id = ${id} and status = 'requested' for update`)[0]
    if (!p) throw notFound()
    await tx`update crm.field_promotions set status = 'rejected', closed_by = ${ctx.user.id}, closed_at = now(), close_note = ${why} where id = ${id}`
    await audit(tx, ctx, 'field.promotion_closed', 'field', p.field_id, p.market_code, { status: 'requested' }, { status: 'rejected', note: why })
  })
}

/** Marca como hechos los pedidos cuya columna ya existe (la migración se aplicó). Corre al abrir la pantalla. */
export async function syncPromotions(tx: Tx): Promise<number> {
  const open = await tx<{ id: string; object: string; column_name: string }[]>`
    select p.id, f.object, p.column_name from crm.field_promotions p join crm.field_definitions f on f.id = p.field_id where p.status = 'requested'`
  let n = 0
  for (const p of open) {
    if (await colExists(tx, TABLE[p.object]!, p.column_name)) {
      const r = await tx`update crm.field_promotions set status = 'done', closed_at = now(), close_note = 'column exists' where id = ${p.id} and status = 'requested'`
      n += r.count
    }
  }
  return n
}

/**
 * E9.F11 (datos2): un campo de la tienda de US que resultó ser el mismo que uno importado de Pipedrive. "same": los valores
 * pasan al importado donde este no tenga dato, y el conservado se archiva (no se borra). "different": el par no vuelve a salir.
 */
export async function decideFieldOverlap(ctx: Ctx, keptId: string, importedId: string, decision: 'same' | 'different'): Promise<number> {
  ctx.assert('config.manage')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ id: string; key: string; object: string; market_code: string | null; source: string; origin: string | null }[]>`
      select id, key, object, market_code, source, origin from crm.field_definitions where id in (${keptId}, ${importedId})`
    const kept = rows.find((r) => r.id === keptId)
    const imp = rows.find((r) => r.id === importedId)
    if (!kept || !imp || imp.source !== 'pipedrive' || kept.object !== 'account') throw notFound()
    let moved = 0
    if (decision === 'same') {
      moved = (await tx`update crm.accounts set custom = (custom - ${kept.key}) || jsonb_build_object(${imp.key}::text, custom -> ${kept.key})
                         where custom ? ${kept.key} and not (custom ? ${imp.key}) and (${kept.market_code}::text is null or market_code = ${kept.market_code})`).count
      await tx`update crm.field_definitions set is_active = false, decision_note = ${`Es el mismo que ${imp.key} (Pipedrive)`} where id = ${keptId}`
    }
    await tx`insert into crm.field_overlap_decisions (kept_id, imported_id, decision, decided_by) values (${keptId}, ${importedId}, ${decision}, ${ctx.user.id})`
    await audit(tx, ctx, 'field.overlap_decided', 'field', keptId, kept.market_code, null, { imported_key: imp.key, kept_key: kept.key, decision, values_moved: moved })
    return moved
  })
}

/**
 * E9.F11 (datos2): pasar un campo de texto a lista cuando su dueño define las opciones. Si hay valores guardados que no están
 * en la lista, no se cambia y se dice cuáles son (nada se pierde ni se reescribe solo).
 */
export async function convertToList(ctx: Ctx, fieldId: string, options: string[]): Promise<{ converted: boolean; outside: string[] }> {
  ctx.assert('config.manage')
  const opts = [...new Set(options.map((o) => o.trim()).filter(Boolean))].slice(0, 30)
  if (opts.length < 2) throw invalid('Una lista lleva al menos dos opciones, una por renglón.', 'A list needs at least two options, one per line.')
  assertNoProhibited(...opts)
  return withUser(ctx.user.id, async (tx) => {
    const f = (await tx<{ key: string; object: string; data_type: string; market_code: string | null }[]>`select key, object, data_type, market_code from crm.field_definitions where id = ${fieldId} for update`)[0]
    if (!f) throw notFound()
    if (f.data_type !== 'text' || f.object !== 'account') throw invalid('Solo un campo de texto de comercio pasa a lista.', 'Only a merchant text field becomes a list.')
    const outside = (await tx<{ v: string }[]>`
      select distinct custom ->> ${f.key} as v from crm.accounts where custom ? ${f.key} and nullif(custom ->> ${f.key}, '') is not null
         and not ((custom ->> ${f.key}) = any(${opts}::text[])) limit 20`).map((r) => r.v)
    if (outside.length) return { converted: false, outside }
    await tx`update crm.field_definitions set data_type = 'select', options = ${tx.json(opts)} where id = ${fieldId}`
    await audit(tx, ctx, 'field.converted_to_list', 'field', fieldId, f.market_code, { data_type: 'text' }, { data_type: 'select', options: opts })
    return { converted: true, outside: [] }
  })
}
