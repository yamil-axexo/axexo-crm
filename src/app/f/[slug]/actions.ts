'use server'

import { createHash } from 'node:crypto'
import { systemCtx, publicLocale } from '@/server/context'
import { intakeFromForm } from '@/domain/leads'
import { DomainError, type ActionResult } from '@/lib/errors'
import { translator } from '@/lib/format'

type R = ActionResult<unknown>

/** Formulario público: no hay sesión. Valida todo en el servidor y es idempotente por la llave del render. */
export async function submitPublicForm(_: R | null, fd: FormData): Promise<R> {
  const t = translator(await publicLocale())
  const slug = String(fd.get('slug') ?? '')
  const key = String(fd.get('idempotency_key') ?? '')
  if (!/^[a-z0-9-]{3,60}$/.test(slug) || !/^[0-9a-f-]{36}$/.test(key)) return { ok: false, code: 'invalid', error: t('Formulario inválido.', 'Invalid form.') }
  try {
    // La llave del render evita el doble envío del mismo formulario. Se combina con lo enviado para que un segundo
    // negocio capturado en la misma pantalla (una tablet en mostrador, un dueño con dos tiendas) sea otro lead.
    const body = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>
    const print = createHash('sha256').update([body.business_name, body.contact_name, body.phone, body.email].map((v) => (v ?? '').trim().toLowerCase()).join('|')).digest('hex').slice(0, 16)
    await intakeFromForm(await systemCtx(), slug, body, `form:${key}:${print}`)
    return { ok: true, message: t('Recibimos tus datos. Alguien del equipo te va a contactar.', 'We got your details. Someone from the team will reach out.') }
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, code: e.code, error: t(e.es, e.en) }
    console.error(JSON.stringify({ level: 'error', msg: 'public_form_failed' }))
    return { ok: false, code: 'error', error: t('No pudimos enviar el formulario. Intenta otra vez.', 'We could not send the form. Try again.') }
  }
}
