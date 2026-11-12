'use server'

import { z } from 'zod'
import { runAction } from '@/server/action'
import { previewAccounts, previewOpen, reassignAccounts, reassignByFilter, reassignDeals, reassignLeads, setTerritory, setTerritoryByFilter, type Progress } from '@/domain/reparto'
import { invalid, type ActionResult } from '@/lib/errors'

// Reparto de cartera desde la lista de Comercios y desde Mi equipo. La pantalla llama al paso una y otra vez:
// cada llamada mueve un lote y devuelve cuántos quedan (domain/reparto.ts).

const text = z.string().max(200).optional()
const filter = z.object({ q: text, market: text, lifecycle: text, owner: text, kind: text, ver: text, region: text, city: text, territory: text })
const payload = z.object({
  /** accounts: comercios con sus negocios y tareas. territory: poner territorio. leads / deals: lo abierto de una persona. */
  what: z.enum(['accounts', 'territory', 'leads', 'deals']),
  /** Comercios y territorio: los seleccionados (ids) o todos los de un filtro. */
  ids: z.array(z.guid()).max(500).optional(),
  filter: filter.optional(),
  /** Leads y negocios: mercado y de quién ('none', 'vacant' o una persona). */
  market: text,
  from: text,
  /** A quién van; en territorio, el territorio ('' lo quita). */
  to: z.string().max(60),
})
export type RepartoPayload = z.input<typeof payload>
export type RepartoCount = { count: number; deals: number; tasks: number }

export async function repartoPreviewAction(input: RepartoPayload): Promise<ActionResult<RepartoCount>> {
  return runAction<RepartoCount>(async (ctx) => {
    const p = payload.parse(input)
    if (p.what === 'leads' || p.what === 'deals') {
      return { data: { count: await previewOpen(ctx, p.what, { market: p.market ?? '', from: p.from ?? '', to: p.to || undefined }), deals: 0, tasks: 0 }, revalidate: [] }
    }
    if (!p.filter) throw invalid('Falta el filtro.', 'The filter is missing.')
    const n = await previewAccounts(ctx, p.filter, p.what === 'accounts' ? p.to || undefined : undefined)
    return { data: { count: n.accounts, deals: n.deals, tasks: n.tasks }, revalidate: [] }
  })
}

export async function repartoStepAction(input: RepartoPayload): Promise<ActionResult<Progress>> {
  return runAction<Progress>(async (ctx) => {
    const p = payload.parse(input)
    let out: Progress
    if (p.what === 'leads') out = await reassignLeads(ctx, { market: p.market ?? '', from: p.from ?? '', to: p.to })
    else if (p.what === 'deals') out = await reassignDeals(ctx, { market: p.market ?? '', from: p.from ?? '', to: p.to })
    else if (p.ids?.length) out = { moved: p.what === 'accounts' ? await reassignAccounts(ctx, p.ids, p.to) : await setTerritory(ctx, p.ids, p.to || null), left: 0 }
    else if (!p.filter) throw invalid('Elige comercios o un filtro.', 'Choose merchants or a filter.')
    else out = p.what === 'accounts' ? await reassignByFilter(ctx, p.filter, p.to) : await setTerritoryByFilter(ctx, p.filter, p.to || null)
    // Mientras queden lotes no se repinta la pantalla: se repinta una vez, al terminar.
    return { data: out, revalidate: out.left > 0 && out.moved > 0 ? [] : undefined }
  })
}
