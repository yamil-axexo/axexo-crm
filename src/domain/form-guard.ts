import 'server-only'
import { withUser, withoutUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { invalid } from '@/lib/errors'
import { LIMITS, defaultFormSubmitsPerIp, defaultMinFillSeconds, ipHash, rateHit } from '@/server/protect'
import { antibot } from '@/server/adapters/antibot'

// SEG-10: defensas de los formularios públicos, en este orden: límite por IP y por formulario, campo trampa, llave de la
// página (la app tuvo que haberla mostrado), tiempo mínimo entre carga y envío y verificación anti-bot (adaptador apagado).
// Lo rechazado no se guarda: solo se cuenta por motivo. La respuesta a quien envía es siempre la misma, sin detalle.
export type Rejection = 'rate' | 'trap' | 'no_render' | 'too_fast' | 'bot'
export type GuardResult = { ok: true } | { ok: false; reason: Rejection }

const count = (slug: string, reason: Rejection) => withoutUser((tx) => tx`select app.intake_rejected(${slug}, ${reason})`).then(() => undefined)

async function limits(slug: string): Promise<{ minFill: number; perMinute: number }> {
  const rows = await withoutUser((tx) => tx<{ min_fill_seconds: number | null; rate_per_minute: number | null }[]>`select min_fill_seconds, rate_per_minute from app.form_limits(${slug})`)
  return { minFill: rows[0]?.min_fill_seconds ?? defaultMinFillSeconds(), perMinute: rows[0]?.rate_per_minute ?? defaultFormSubmitsPerIp() }
}

/** Al mostrar la página: cuenta la vista por IP y, si pasa, anota la llave de esa página. */
export async function openPublicForm(slug: string, ip: string, key: string): Promise<{ allowed: boolean; retryAfter: number }> {
  const r = await rateHit(`form:view:${slug}:${ipHash(ip)}`, LIMITS.formViewsPerIp)
  if (!r.allowed) {
    await count(slug, 'rate')
    return r
  }
  await withoutUser((tx) => tx`select app.form_render(${slug}, ${key}::uuid)`)
  return r
}

export async function guardPublicSubmit(input: { slug: string; key: string; ip: string; trap: string; botToken: string | null }): Promise<GuardResult> {
  const { slug, key, ip } = input
  const lim = await limits(slug)
  const fail = async (reason: Rejection): Promise<GuardResult> => {
    await count(slug, reason)
    return { ok: false, reason }
  }
  if (!(await rateHit(`form:submit:${slug}:${ipHash(ip)}`, lim.perMinute)).allowed) return fail('rate')
  if (input.trap.trim() !== '') return fail('trap')
  const age = await withoutUser((tx) => tx<{ age: string | null }[]>`select app.form_render_age(${slug}, ${key}::uuid)::text as age`)
  if (age[0]?.age == null) return fail('no_render')
  if (Number(age[0].age) < lim.minFill) return fail('too_fast')
  if (!(await antibot().verify(input.botToken, ipHash(ip))).ok) return fail('bot')
  return { ok: true }
}

/**
 * Límites propios de un formulario público (segundos mínimos de llenado y envíos por minuto por dirección). Vacío usa el
 * valor general. Lo cambia administración y queda en la bitácora con el valor anterior.
 */
export async function setFormLimits(ctx: Ctx, formId: string, input: { minFillSeconds: number | null; ratePerMinute: number | null }): Promise<void> {
  ctx.assert('config.manage')
  const ok = (n: number | null, min: number, max: number) => n === null || (Number.isInteger(n) && n >= min && n <= max)
  if (!ok(input.minFillSeconds, 0, 120) || !ok(input.ratePerMinute, 1, 600))
    throw invalid('Revisa los límites: segundos entre 0 y 120, envíos por minuto entre 1 y 600. Vacío usa el valor general.', 'Check the limits: seconds between 0 and 120, submissions per minute between 1 and 600. Empty uses the general value.')
  await withUser(ctx.user.id, async (tx) => {
    const before = await tx<{ market_code: string; min_fill_seconds: number | null; rate_per_minute: number | null }[]>`select market_code, min_fill_seconds, rate_per_minute from crm.web_forms where id = ${formId} for update`
    if (!before[0]) throw invalid('Ese formulario no existe.', 'That form does not exist.')
    await tx`update crm.web_forms set min_fill_seconds = ${input.minFillSeconds}, rate_per_minute = ${input.ratePerMinute} where id = ${formId}`
    await audit(tx, ctx, 'form.updated', 'form', formId, before[0].market_code, { min_fill_seconds: before[0].min_fill_seconds, rate_per_minute: before[0].rate_per_minute }, { min_fill_seconds: input.minFillSeconds, rate_per_minute: input.ratePerMinute })
  })
}
