'use server'

import { runAction, str } from '@/server/action'
import { systemCtx } from '@/server/context'
import { resolveException, runRulesNow } from '@/domain/rules'
import { addStreetSeller, updateStreetSeller } from '@/domain/street'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function resolveExceptionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await resolveException(ctx, str(fd, 'id'), str(fd, 'note'))
    return { message: ['Descartada. No reaparece por 7 días.', 'Dismissed. It will not reappear for 7 days.'] }
  })
}

export async function runRulesAction(_: R | null, _fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await runRulesNow(ctx, await systemCtx())
    return { message: [`Avisos actualizados: ${out.opened} nuevos, ${out.closed} que ya se corrigieron.`, `Alerts refreshed: ${out.opened} new, ${out.closed} already fixed.`] }
  })
}

/** Catálogo de vendedores de calle: alta. */
export async function addStreetSellerAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addStreetSeller(ctx, { market: str(fd, 'market'), name: str(fd, 'name'), reportsTo: str(fd, 'reports_to') || null })
    return { message: ['Vendedor de calle agregado. Ya sale primero en "¿Quién visitó?".', 'Street seller added. They now show first under "Who visited?".'] }
  })
}

/** Catálogo de vendedores de calle: cambiar a quién responde, o baja. */
export async function updateStreetSellerAction(_: ActionResult<{ toast: string }> | null, fd: FormData): Promise<ActionResult<{ toast: string }>> {
  return runAction<{ toast: string }>(async (ctx) => {
    const end = str(fd, 'end') === '1'
    await updateStreetSeller(ctx, str(fd, 'id'), end ? { end: true } : { reportsTo: str(fd, 'reports_to') || null })
    return { data: { toast: end ? ctx.t('Dado de baja. Sus visitas anteriores se conservan.', 'Removed. Their earlier visits are kept.') : ctx.t('Listo: quedó a cargo de esa persona.', 'Done: they now report to that person.') } }
  })
}
