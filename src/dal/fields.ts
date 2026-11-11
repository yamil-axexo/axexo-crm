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
}

/** GOB-01: campos adicionales de un objeto, en el orden en que se definieron. Los de un mercado solo aplican a ese mercado. */
export async function fieldDefs(ctx: Ctx, object: 'account' | 'deal' | 'contact' | 'lead' | 'activity' | 'product', market?: string | null): Promise<FieldDef[]> {
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<FieldDef[]>`
      select key, label_es, label_en, data_type, options, data_class, mapped_to, market_code
        from crm.field_definitions
       where object = ${object} and is_active and (market_code is null or market_code = ${market ?? null})
       order by position, label_en`
    return [...rows]
  })
}

/** Valores de los campos adicionales de un registro. RLS decide si la persona lo ve. */
export async function customValues(ctx: Ctx, object: 'account' | 'deal', id: string) {
  return withUser(ctx.user.id, async (tx) => {
    const rows = object === 'account'
      ? await tx<{ id: string; title: string; market_code: string; custom: Record<string, unknown>; locked: boolean }[]>`
          select id, name as title, market_code, custom, archived_at is not null as locked from crm.accounts where id = ${id}`
      : await tx<{ id: string; title: string; market_code: string; custom: Record<string, unknown>; locked: boolean }[]>`
          select id, title, market_code, custom, false as locked from crm.deals where id = ${id}`
    return rows[0] ?? null
  })
}
