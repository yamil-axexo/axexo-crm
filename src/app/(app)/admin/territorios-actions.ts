'use server'

import { runAction, str } from '@/server/action'
import { archiveTerritory, createTerritory, renameTerritory, setUserTerritories } from '@/domain/territories'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function createTerritoryAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createTerritory(ctx, { market: str(fd, 'market'), name: str(fd, 'name') })
    return { message: ['Territorio agregado.', 'Territory added.'] }
  })
}

export async function renameTerritoryAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await renameTerritory(ctx, str(fd, 'id'), str(fd, 'name'))
    return { message: ['Nombre guardado.', 'Name saved.'] }
  })
}

export async function archiveTerritoryAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const archived = str(fd, 'archived') === '1'
    await archiveTerritory(ctx, str(fd, 'id'), archived)
    return { message: archived ? ['Archivado. Ya no se ofrece; los comercios que lo tenían lo conservan.', 'Archived. It is no longer offered; merchants that had it keep it.'] : ['Territorio recuperado.', 'Territory restored.'] }
  })
}

export async function setUserTerritoriesAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setUserTerritories(ctx, str(fd, 'user_id'), str(fd, 'market'), fd.getAll('territory_id').filter((v): v is string => typeof v === 'string'))
    return { message: ['Territorios guardados.', 'Territories saved.'] }
  })
}
