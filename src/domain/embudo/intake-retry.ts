import 'server-only'
import { withUser, type Tx } from '@/server/db'
import { systemCtx, type Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { DomainError, notFound } from '@/lib/errors'
import { scrub } from '@/domain/pipedrive/mapping'
import { intakeFromForm } from '@/domain/leads'

/**
 * E3.F8: ningún envío de formulario se pierde. Si guardar el lead falla por algo nuestro (no por datos inválidos), el envío
 * queda retenido en CONTIGO (crm.intake_retries, sin datos prohibidos) y una tarea programada lo reintenta con espera
 * creciente. Si se agota, queda a la vista en Administración con su botón de reintentar. No pasa por ningún tercero.
 */
export const MAX_ATTEMPTS = 6
const safe = (raw: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries((raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>)) {
    if (typeof v === 'string' && /^[a-z_][a-z0-9_]{0,40}$/i.test(k)) out[k] = scrub(v).slice(0, 2000)
    else if (typeof v === 'boolean' || typeof v === 'number') out[k] = String(v)
  }
  return out
}

/** Retiene un envío que no se pudo guardar. Si ni esto se puede escribir, lanza: quien envió recibe el error y reintenta. */
export async function holdForRetry(slug: string, idempotencyKey: string, raw: unknown, error: unknown): Promise<void> {
  const sys = await systemCtx()
  const code = (error as { code?: string; name?: string })?.code ?? (error as { name?: string })?.name ?? 'error'
  await withUser(sys.user.id, async (tx) => {
    const ins = await tx`insert into crm.intake_retries (slug, idempotency_key, payload, error)
                         values (${slug.slice(0, 80)}, ${idempotencyKey.slice(0, 200)}, ${tx.json(safe(raw))}, ${String(code).slice(0, 300)})
                         on conflict (idempotency_key) do nothing returning id`
    if (ins[0]) await audit(tx, sys, 'integration.intake_held', 'intake_retry', null, null, null, { slug, error: String(code).slice(0, 80) })
  })
}

async function attempt(sys: Ctx, r: { id: string; slug: string; idempotency_key: string; payload: unknown; attempts: number }): Promise<'done' | 'pending' | 'failed'> {
  try {
    const out = await intakeFromForm(sys, r.slug, r.payload, r.idempotency_key)
    await withUser(sys.user.id, (tx) => tx`update crm.intake_retries set status = 'done', lead_id = ${out.leadId || null}, attempts = attempts + 1, updated_at = now(), error = null where id = ${r.id}`)
    return 'done'
  } catch (e) {
    // Datos inválidos o formulario apagado no se arreglan reintentando: queda fallido, a la vista.
    const fatal = e instanceof DomainError || r.attempts + 1 >= MAX_ATTEMPTS
    const code = e instanceof DomainError ? e.code : ((e as { code?: string })?.code ?? 'error')
    await withUser(sys.user.id, (tx) => tx`update crm.intake_retries set status = ${fatal ? 'failed' : 'pending'}, attempts = attempts + 1, error = ${String(code).slice(0, 300)},
        next_attempt_at = now() + make_interval(mins => ${5 * (r.attempts + 1) * (r.attempts + 1)}), updated_at = now() where id = ${r.id}`)
    return fatal ? 'failed' : 'pending'
  }
}

/** La tarea programada: reintenta lo retenido que ya toca. Segura de correr dos veces (la llave de idempotencia es la del envío). */
export async function retryHeldIntake(tx: Tx): Promise<{ done: number; note?: string }> {
  const rows = await tx<{ id: string; slug: string; idempotency_key: string; payload: unknown; attempts: number }[]>`
    select id, slug, idempotency_key, payload, attempts from crm.intake_retries where status = 'pending' and next_attempt_at <= now() order by created_at limit 50`
  if (rows.length === 0) return { done: 0 }
  const sys = await systemCtx()
  let ok = 0
  for (const r of rows) if ((await attempt(sys, r)) === 'done') ok += 1
  return { done: ok, note: `${ok}/${rows.length}` }
}

/** Administración reintenta a mano un envío retenido o fallido. */
export async function retryIntakeNow(ctx: Ctx, id: string): Promise<'done' | 'pending' | 'failed'> {
  ctx.assert('config.manage')
  const rows = await withUser(ctx.user.id, (tx) => tx<{ id: string; slug: string; idempotency_key: string; payload: unknown; attempts: number; status: string }[]>`
    select id, slug, idempotency_key, payload, attempts, status from crm.intake_retries where id = ${id}`)
  const r = rows[0]
  if (!r) throw notFound('No encontramos ese envío.', 'We could not find that submission.')
  if (r.status === 'done') return 'done'
  const out = await attempt(await systemCtx(), { ...r, attempts: Math.min(r.attempts, MAX_ATTEMPTS - 2) })
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'integration.intake_retried', 'intake_retry', null, null, null, { slug: r.slug, result: out }))
  return out
}
