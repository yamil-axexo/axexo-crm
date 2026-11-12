import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'

export type FieldDef = {
  key: string
  label_es: string
  label_en: string
  data_type: 'text' | 'long_text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect' | 'money' | 'user' | 'phone'
  options: string[]
  data_class: 'public' | 'internal' | 'confidential'
  mapped_to: string | null
  market_code: string | null
  /** Tipo de venta al que aplica el campo; null = todos. */
  motor: string | null
  /** Bloque de la ficha: para calificar, términos comerciales o expediente. */
  section: 'qualify' | 'terms' | 'file' | null
  /** El campo solo aplica cuando otro campo tiene este valor (por ejemplo, los documentos de una persona moral). */
  applies_when: { key: string; equals: string } | null
  in_intake: boolean
}

/** Un campo condicionado aplica solo cuando el campo del que depende tiene el valor indicado. */
export const fieldApplies = (d: Pick<FieldDef, 'applies_when'>, values: Record<string, unknown>) => !d.applies_when || values[d.applies_when.key] === d.applies_when.equals

/** GOB-01: campos adicionales de un objeto, en el orden en que se definieron. Los de un mercado solo aplican a ese mercado. */
export async function fieldDefs(ctx: Ctx, object: 'account' | 'deal' | 'contact' | 'lead' | 'activity' | 'product', market?: string | null, motor?: string | null): Promise<FieldDef[]> {
  return withUser(ctx.user.id, async (tx) => {
    // Un campo de un tipo de venta (por ejemplo, los de B2B) solo sale en registros de ese tipo de venta.
    const rows = await tx<FieldDef[]>`
      select key, label_es, label_en, data_type, options, data_class, mapped_to, market_code, motor, section, applies_when, in_intake
        from crm.field_definitions
       where object = ${object} and is_active and (market_code is null or market_code = ${market ?? null})
         and (motor is null or motor = ${motor ?? null})
       order by position, label_en`
    return [...rows]
  })
}

/** Valores de los campos adicionales de un registro. RLS decide si la persona lo ve. */
export async function customValues(ctx: Ctx, object: 'account' | 'deal', id: string) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = object === 'account'
      ? await tx<{ id: string; title: string; market_code: string; custom: Record<string, unknown>; locked: boolean; motor: string | null }[]>`
          select id, name as title, market_code, custom, archived_at is not null as locked, segment as motor from crm.accounts where id = ${id}`
      : await tx<{ id: string; title: string; market_code: string; custom: Record<string, unknown>; locked: boolean; motor: string | null }[]>`
          select d.id, d.title, d.market_code, d.custom, false as locked, p.motor from crm.deals d join crm.pipelines p on p.id = d.pipeline_id where d.id = ${id}`
    return rows[0] ?? null
  })
}
