import 'server-only'
import { withUser, type Tx } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { notFound } from '@/lib/errors'
import { runSchedule } from '@/domain/automation/engine'

export const EXCEPTION_KINDS = ['lead_sla', 'revisit_due', 'activation_risk', 'no_next_step', 'stalled_deal', 'reactivation', 'unowned_account', 'duplicate_suspect', 'unmatched_event', 'under_plan', 'perfect_store_low', 'lead_no_next_step', 'onboarding_no_next_step'] as const
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]

/**
 * CAMPO-04 / CS-03 / PIPE-03: las reglas ya no viven en el código. Son automatizaciones guardadas en la base (AUT-03),
 * por mercado, que se ven y se cambian en Administración > Automatizaciones; el motor (domain/automation/engine.ts) las
 * lee y las ejecuta. Esta función conserva el contrato de siempre: abre el aviso si la condición existe, lo cierra sola
 * cuando deja de existir, y devuelve cuántos abrió y cerró. Corre como usuario de sistema dentro de una transacción.
 */
export async function evaluateRules(tx: Tx, sys: Ctx | null = null): Promise<{ opened: number; closed: number }> {
  const out = await runSchedule(tx, sys)
  return { opened: out.opened, closed: out.closed }
}

/** Las reglas se reevalúan a lo sumo cada 15 minutos cuando alguien abre un tablero. */
export async function ensureRulesFresh(sys: Ctx, maxAgeMinutes = 15): Promise<void> {
  await withUser(sys.user.id, async (tx) => {
    const rows = await tx<{ stale: boolean }[]>`
      select coalesce((value #>> '{}')::timestamptz < now() - make_interval(mins => ${maxAgeMinutes}), true) as stale
        from crm.settings where key = 'rules_last_run' for update`
    // Al abrir un tablero solo se refrescan los avisos de la cola (rápido). Las tareas y avisos de las demás automatizaciones los hace la tarea programada.
    if (rows[0]?.stale ?? true) await evaluateRules(tx)
  })
}

/**
 * "Evaluar reglas ahora" abre y cierra excepciones para todo el mercado: cuenta como cambio de datos.
 * La corre quien dirige un equipo o administra, nunca un rol de solo lectura, y deja en la bitácora quién la corrió
 * y qué movió. Las reglas corren con identidad de sistema (ven todos los mercados); el evento va a nombre de la persona.
 */
export async function runRulesNow(ctx: Ctx, sys: Ctx): Promise<{ opened: number; closed: number }> {
  ctx.assert('rules.run')
  const out = await withUser(sys.user.id, (tx) => evaluateRules(tx, sys))
  await withUser(ctx.user.id, (tx) => audit(tx, ctx, 'rules.evaluated', 'rules', null, null, null, { opened: out.opened, closed: out.closed }))
  return out
}

/** Descartar una excepción no la borra: queda cerrada, con quién y por qué, y no reaparece por 7 días. */
export async function resolveException(ctx: Ctx, id: string, note: string): Promise<void> {
  await withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ market_code: string; kind: string; resolved_at: Date | null }[]>`
      select market_code, kind, resolved_at from crm.exceptions where id = ${id} for update`
    const e = rows[0]
    if (!e) throw notFound()
    ctx.assert('exception.resolve', e.market_code)
    if (e.resolved_at) return
    await tx`update crm.exceptions set resolved_at = now(), resolved_by = ${ctx.user.id}, resolution = 'dismissed',
              detail = detail || ${tx.json({ note: note.trim().slice(0, 300) })} where id = ${id}`
    await audit(tx, ctx, 'exception.dismissed', 'exception', id, e.market_code, null, { kind: e.kind })
  })
}
