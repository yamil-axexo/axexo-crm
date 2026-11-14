import 'server-only'
import { z } from 'zod'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { assertNoProhibited } from '@/domain/guard'
import { forbidden, invalid } from '@/lib/errors'
import { open, seal } from '@/server/adapters/field-crypto'

/**
 * SEG-02: datos reservados también en negocio y contacto (antes solo en comercio). Mismas reglas: quién ve y quién edita por
 * rol y por quien lleva el registro (crm.sensitive_fields), tapado, revelar pide motivo y queda en la bitácora y en el
 * registro de lecturas; el valor nunca entra a la bitácora. La tabla no tiene privilegios para la app: solo app.record_sensitive_*.
 * El reparto de comisión del negocio lo ven administración y quien lidera el mercado; quien vende no (ni siendo dueño).
 */
export type RecordObject = 'deal' | 'contact'
export type ReservedField = { field_key: string; label_es: string; label_en: string; has_value: boolean; can_view: boolean; can_edit: boolean; updated_at: Date | null }
const uuid = z.guid()
const obj = z.enum(['deal', 'contact'])

export async function reservedFields(ctx: Ctx, object: RecordObject, id: string): Promise<ReservedField[]> {
  if (!uuid.safeParse(id).success) return []
  return withUser(ctx.user.id, (tx) => tx<ReservedField[]>`select * from app.record_sensitive_list(${obj.parse(object)}, ${id})`)
}

export async function setReserved(ctx: Ctx, object: RecordObject, id: string, key: string, value: string): Promise<void> {
  if (ctx.viewAs) throw forbidden()
  const v = z.string().trim().min(1).max(1500).safeParse(value)
  if (!v.success) throw invalid('Escribe el dato (hasta 1,500 caracteres).', 'Write the value (up to 1,500 characters).')
  assertNoProhibited(v.data)
  const sealed = seal(v.data)
  await withUser(ctx.user.id, (tx) => tx`select app.record_sensitive_set(${obj.parse(object)}, ${uuid.parse(id)}, ${key}, ${sealed.payload}, ${sealed.cipher})`)
}

export async function revealReserved(ctx: Ctx, object: RecordObject, id: string, key: string, reason: string): Promise<string | null> {
  const r = z.string().trim().min(10).max(300).safeParse(reason)
  if (!r.success) throw invalid('Escribe para qué necesitas verlo (10 caracteres o más). Queda en la bitácora.', 'Write why you need to see it (10 characters or more). It is logged.')
  assertNoProhibited(r.data)
  if (ctx.viewAs) throw forbidden()
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ value: string; cipher: string }[]>`select value, cipher from app.record_sensitive_reveal(${obj.parse(object)}, ${uuid.parse(id)}, ${key}, ${r.data})`
    return rows[0] ? open(rows[0].cipher, rows[0].value) : null
  })
}
