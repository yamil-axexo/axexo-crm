import 'server-only'
import type { Tx } from '@/server/db'

/**
 * IA-07: todo texto que entra de fuera (formulario web, API de formularios, Sales App, archivo CSV) queda marcado con su
 * origen. La marca dice "esto lo escribió alguien de fuera": se muestra como texto plano y ninguna función lo interpreta
 * como instrucción, enlace ni formato. Las definiciones de campo de texto libre llevan la misma marca (field_definitions.untrusted).
 */
export { UNTRUSTED_ORIGINS, ORIGIN_LABEL, type UntrustedOrigin } from '@/domain/untrusted-labels'
import type { UntrustedOrigin } from '@/domain/untrusted-labels'
export type UntrustedObject = 'lead' | 'account' | 'contact' | 'activity' | 'visit'

/**
 * Caracteres que no se ven pero cambian cómo se lee un texto (controles, cambios de dirección, ancho cero): se quitan al
 * entrar, para que lo que la persona ve sea lo que el texto dice. No es un filtro de instrucciones: la defensa es la marca.
 */
export function plainText(raw: string): string {
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁩﻿]/g, '')
}

export async function markUntrusted(tx: Tx, object: UntrustedObject, objectId: string, market: string, origin: UntrustedOrigin, fields: string[]): Promise<void> {
  if (fields.length === 0) return
  await tx`insert into crm.untrusted_marks (object, object_id, market_code, origin, fields)
           values (${object}, ${objectId}, ${market}, ${origin}, ${fields}) on conflict (object, object_id) do nothing`
}

/** Para cuando exista una función de AI: el texto viaja como dato citado, con su origen, nunca pegado a las instrucciones. */
export function asQuotedData(text: string, origin: UntrustedOrigin): { role: 'data'; origin: UntrustedOrigin; untrusted: true; text: string } {
  return { role: 'data', origin, untrusted: true, text: plainText(text) }
}
