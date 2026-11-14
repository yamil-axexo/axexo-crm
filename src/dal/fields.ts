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
  /** Bloque de la ficha: para calificar, términos comerciales, expediente o una sección que el mercado agregó (crm.field_sections). */
  section: string | null
  /** Nombre, equipo y orden de la sección, tal como los definió administración. Vacíos si el campo no tiene sección. */
  section_es: string | null
  section_en: string | null
  section_team: string | null
  section_pos: number | null
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
      select f.key, f.label_es, f.label_en, f.data_type, f.options, f.data_class, f.mapped_to, f.market_code, f.motor, f.section, f.applies_when, f.in_intake,
             fs.label_es as section_es, fs.label_en as section_en, fs.team as section_team, fs.position as section_pos
        from crm.field_definitions f
        left join lateral (select s.label_es, s.label_en, s.team, s.position from crm.field_sections s
                            where s.code = f.section and s.is_active and (s.market_code is null or s.market_code = ${market ?? null})
                            order by s.market_code nulls last limit 1) fs on true
       where f.object = ${object} and f.is_active and (f.market_code is null or f.market_code = ${market ?? null})
         and (f.motor is null or f.motor = ${motor ?? null})
       order by f.position, f.label_en`
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

/**
 * E10.F7: claves de los campos que la etapa actual de un negocio destaca y de los que pide la etapa siguiente.
 * La pantalla de campos los pone primero y los marca, para que se llenen sin buscarlos entre todos.
 */
export async function stageFieldMarks(ctx: Ctx, dealId: string): Promise<{ stage_es: string; stage_en: string; highlight: string[]; next: string[]; next_es: string | null; next_en: string | null } | null> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ stage_es: string; stage_en: string; highlight: string[]; next: string[] | null; next_es: string | null; next_en: string | null }[]>`
      select s.name_es as stage_es, s.name_en as stage_en, s.highlight_fields as highlight, n.required_fields as next, n.name_es as next_es, n.name_en as next_en
        from crm.deals d join crm.stages s on s.id = d.stage_id
        left join crm.stages n on n.pipeline_id = s.pipeline_id and n.position = s.position + 1 and n.archived_at is null and n.kind in ('open', 'awaiting_txn')
       where d.id = ${dealId} and d.status = 'open'`
    const r = rows[0]
    if (!r) return null
    const keys = (list: string[] | null) => (list ?? []).filter((x) => x.startsWith('field:')).map((x) => x.slice(6))
    return { stage_es: r.stage_es, stage_en: r.stage_en, highlight: keys(r.highlight), next: keys(r.next), next_es: r.next_es, next_en: r.next_en }
  })
}
