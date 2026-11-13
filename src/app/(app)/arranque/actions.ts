'use server'

import { runAction, str } from '@/server/action'
import { openToTeam, setKeyPerson, setLeadersFirst, setRolloutStep } from '@/domain/rollout'
import { loadMigratedStores, loadVisitsSheet, type LoadResult } from '@/domain/sheet-loads'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function setLeadersFirstAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const on = str(fd, 'on') === '1'
    await setLeadersFirst(ctx, str(fd, 'market'), on)
    return { message: on ? ['Listo: primero entran quienes lideran y las personas clave.', 'Done: leaders and key people come in first.'] : ['Regla apagada: cualquier acceso de Ventas entra.', 'Rule off: any Sales access can come in.'] }
  })
}

export async function openToTeamAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await openToTeam(ctx, str(fd, 'market'))
    return { message: ['Mercado abierto al equipo de campo.', 'Market open to the field team.'] }
  })
}

export async function keyPersonAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const on = str(fd, 'on') === '1'
    await setKeyPerson(ctx, str(fd, 'market'), str(fd, 'email'), on)
    return { message: on ? ['Persona clave agregada.', 'Key person added.'] : ['Persona clave quitada.', 'Key person removed.'] }
  })
}

export async function rolloutStepAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setRolloutStep(ctx, str(fd, 'market'), str(fd, 'step'), { done: fd.get('done') === 'on', note: str(fd, 'note'), link: str(fd, 'link') })
    return { message: ['Paso guardado.', 'Step saved.'] }
  })
}

const summary = (out: LoadResult, es: [one: string, many: string], en: [one: string, many: string]): [string, string] => [
  `${out.loaded === 1 ? `1 ${es[0]}` : `${out.loaded} ${es[1]}`}. ${out.known > 0 ? `${out.known} ya estaban y no se duplicaron. ` : ''}${out.failed > 0 ? `${out.failed} con problema: están abajo, con su número de fila.` : 'Ninguna fila con problema.'}`,
  `${out.loaded === 1 ? `1 ${en[0]}` : `${out.loaded} ${en[1]}`}. ${out.known > 0 ? `${out.known} were already there and were not duplicated. ` : ''}${out.failed > 0 ? `${out.failed} with a problem: they are listed below, with their row number.` : 'No rows with a problem.'}`,
]

export async function loadVisitsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await loadVisitsSheet(ctx, str(fd, 'market'), str(fd, 'rows'), str(fd, 'label'))
    return { message: summary(out, ['visita cargada', 'visitas cargadas'], ['visit loaded', 'visits loaded']) }
  })
}

export async function loadMigratedAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await loadMigratedStores(ctx, str(fd, 'market'), str(fd, 'rows'), str(fd, 'label'))
    return { message: summary(out, ['tienda migrada cargada', 'tiendas migradas cargadas'], ['migrated store loaded', 'migrated stores loaded']) }
  })
}
