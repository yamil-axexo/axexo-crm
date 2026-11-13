'use server'

import { runAction, str } from '@/server/action'
import { resolveConflict, setCutover, setGoalTarget } from '@/domain/pipedrive/coexistence'
import { invalid, type ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

/** E6.F2: una persona decide un choque entre CONTIGO y Pipedrive. */
export async function resolveConflictAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const choice = str(fd, 'choice')
    if (choice !== 'keep' && choice !== 'take') throw invalid('Elige con qué valor te quedas.', 'Choose which value to keep.')
    await resolveConflict(ctx, str(fd, 'id'), choice)
    return { message: choice === 'keep' ? ['Se queda lo de CONTIGO.', 'The CONTIGO value stays.'] : ['Se usó lo de Pipedrive.', 'The Pipedrive value was used.'] }
  })
}

/** GOB-05 / E6.F3: fecha de corte, congelar, descongelar o apagar Pipedrive en un mercado. */
export async function setCutoverAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const action = str(fd, 'action')
    const market = str(fd, 'market')
    if (action === 'date') await setCutover(ctx, market, { action, cutoffOn: str(fd, 'cutoff_on') })
    else if (action === 'freeze' || action === 'unfreeze' || action === 'off') await setCutover(ctx, market, { action })
    else throw invalid('Acción no válida.', 'Invalid action.')
    const msg: Record<string, [string, string]> = {
      date: ['Fecha de corte guardada.', 'Cutover date saved.'],
      freeze: ['Pipedrive congelado para el mercado. La siguiente carga es la última sincronización.', 'Pipedrive frozen for the market. The next load is the last sync.'],
      unfreeze: ['Pipedrive vuelve a estar abierto para el mercado.', 'Pipedrive is open again for the market.'],
      off: ['Pipedrive apagado para el mercado. La recarga ya no toca sus registros.', 'Pipedrive switched off for the market. Reloads no longer touch its records.'],
    }
    return { message: msg[action]! }
  })
}

/** La cifra de una meta (la "Deals won" de Pipedrive y las que se agreguen). */
export async function setGoalTargetAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setGoalTarget(ctx, str(fd, 'id'), str(fd, 'target'))
    return { message: ['Meta guardada.', 'Goal saved.'] }
  })
}
