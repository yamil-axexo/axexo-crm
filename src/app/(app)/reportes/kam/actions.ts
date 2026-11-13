'use server'

import { runAction, str } from '@/server/action'
import { adjustForecast, recordOneOnOne, saveRoleBoard, setForecastCategory, setProposed, setUserAlias, submitForecast } from '@/domain/reportes2'
import type { ActionResult } from '@/lib/errors'

type Prev = ActionResult<unknown> | null

export async function forecastCategoryAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await setForecastCategory(ctx, str(fd, 'deal'), str(fd, 'category'))
    return { message: ['Categoría guardada.', 'Category saved.'], revalidate: ['/reportes/kam'] }
  })
}
export async function forecastAdjustAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await adjustForecast(ctx, str(fd, 'deal'), str(fd, 'category'), str(fd, 'note'))
    return { message: ['Ajuste guardado. La categoría de quien lleva el negocio sigue a la vista.', 'Adjustment saved. The owner’s category stays in view.'], revalidate: ['/reportes/kam'] }
  })
}
export async function forecastSubmitAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    const r = await submitForecast(ctx, { market: str(fd, 'market'), from: str(fd, 'from'), to: str(fd, 'to'), note: str(fd, 'note') })
    return { message: [`Pronóstico enviado: versión ${r.version}, ${r.rows} negocios.`, `Forecast submitted: version ${r.version}, ${r.rows} deals.`], revalidate: ['/reportes/kam'] }
  })
}
export async function roleBoardAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    const keys = fd.getAll('keys').map(String)
    const owners: Record<string, string> = {}
    for (const k of keys) owners[k] = str(fd, `owner_${k}`)
    await saveRoleBoard(ctx, { role: str(fd, 'role'), keys, owners, confirm: fd.get('confirm') === 'on' })
    return { message: ['Tablero guardado.', 'Board saved.'], revalidate: ['/admin/tableros'] }
  })
}
export async function proposedAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    const key = str(fd, 'key')
    const raw = str(fd, 'value')
    let value: Record<string, unknown> = {}
    if (key === 'ingest.require_manifest') value = { value: raw === 'true' }
    else if (key === 'snapshots.window_days') value = { value: Number(raw) }
    else if (key === 'quality.exception_rules') value = { value: fd.getAll('rules').map(String), min_failing: Number(str(fd, 'min_failing')) }
    else if (key === 'adoption.rollout_rule') value = { supervisor_weeks: Number(str(fd, 'supervisor_weeks')), one_on_ones_min: Number(str(fd, 'one_on_ones_min')), result: str(fd, 'result') }
    else if (key === 'orders.brand') {
      const market = str(fd, 'market').toUpperCase()
      const company = str(fd, 'company')
      value = { [market]: { company: company || null, tagline: str(fd, 'tagline') || null, logo_svg: null } }
    }
    await setProposed(ctx, key, value, fd.get('confirm') === 'on')
    return { message: ['Valor guardado.', 'Value saved.'], revalidate: ['/admin/tableros', '/estado'] }
  })
}
export async function oneOnOneAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await recordOneOnOne(ctx, { personId: str(fd, 'person'), heldOn: str(fd, 'held_on'), note: str(fd, 'note') })
    return { message: ['1:1 anotada.', '1:1 logged.'], revalidate: ['/supervisor', '/reportes/adopcion'] }
  })
}
export async function userAliasAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await setUserAlias(ctx, { userId: str(fd, 'user'), system: str(fd, 'system'), externalId: str(fd, 'external_id') })
    return { message: ['ID guardado.', 'ID saved.'], revalidate: ['/admin/tableros'] }
  })
}
