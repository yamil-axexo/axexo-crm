'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { guardPublicSubmit } from '@/domain/form-guard'
import { clientIp } from '@/server/protect'
import { systemCtx, publicLocale } from '@/server/context'
import { intakeFromForm } from '@/domain/leads'
import { holdForRetry } from '@/domain/embudo/intake-retry'
import { DomainError, type ActionResult } from '@/lib/errors'
import { translator } from '@/lib/format'

type R = ActionResult<unknown>

/** Formulario público: no hay sesión. Valida todo en el servidor y es idempotente por la llave del render. */
export async function submitPublicForm(_: R | null, fd: FormData): Promise<R> {
  // El formulario responde en su propio idioma (el de su mercado), no en el del navegador de quien lo llena.
  const formLocale = fd.get('locale')
  const t = translator(formLocale === 'en' ? 'en' : formLocale === 'es' ? 'es' : await publicLocale())
  const slug = String(fd.get('slug') ?? '')
  const key = String(fd.get('idempotency_key') ?? '')
  if (!/^[a-z0-9-]{3,60}$/.test(slug) || !/^[0-9a-f-]{36}$/.test(key)) return { ok: false, code: 'invalid', error: t('Formulario inválido.', 'Invalid form.') }
  // SEG-10: límite por IP, campo trampa, llave de la página, tiempo mínimo y anti-bot. Lo rechazado no se guarda y la
  // respuesta es la misma para todos los motivos: no le dice a un bot qué defensa lo detuvo.
  const guard = await guardPublicSubmit({ slug, key, ip: clientIp(await headers()), trap: String(fd.get('website') ?? ''), botToken: typeof fd.get('bot_token') === 'string' ? String(fd.get('bot_token')) : null })
  if (!guard.ok) return { ok: false, code: 'rejected', error: t('No pudimos enviar el formulario. Espera un momento, vuelve a cargar la página e intenta otra vez.', 'We could not send the form. Wait a moment, reload the page and try again.') }
  let held: { key: string; body: Record<string, string> } | null = null
  try {
    // La llave del render evita el doble envío del mismo formulario. Se combina con lo enviado para que un segundo
    // negocio capturado en la misma pantalla (una tablet en mostrador, un dueño con dos tiendas) sea otro lead.
    const body = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>
    const print = createHash('sha256').update([body.business_name, body.contact_name, body.phone, body.email].map((v) => (v ?? '').trim().toLowerCase()).join('|')).digest('hex').slice(0, 16)
    held = { key: `form:${key}:${print}`, body }
    await intakeFromForm(await systemCtx(), slug, body, held.key)
    return { ok: true, message: t('Recibimos tus datos. Alguien del equipo te va a contactar.', 'We got your details. Someone from the team will reach out.') }
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, code: e.code, error: t(e.es, e.en) }
    console.error(JSON.stringify({ level: 'error', msg: 'public_form_failed' }))
    // E3.F8: la falla fue nuestra, no de quien llenó el formulario. El envío queda retenido en CONTIGO y se reintenta solo;
    // la persona no tiene que volver a escribirlo. Solo si ni eso se puede guardar se le pide intentar otra vez.
    if (held) {
      try {
        await holdForRetry(slug, held.key, held.body, e)
        return { ok: true, message: t('Recibimos tus datos. Alguien del equipo te va a contactar.', 'We got your details. Someone from the team will reach out.') }
      } catch {
        console.error(JSON.stringify({ level: 'error', msg: 'public_form_hold_failed' }))
      }
    }
    return { ok: false, code: 'error', error: t('No pudimos enviar el formulario. Intenta otra vez.', 'We could not send the form. Try again.') }
  }
}
