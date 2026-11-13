import { requireCtx } from '@/server/context'
import { listViews } from '@/dal/reportes'
import { ViewsBar } from '@/ui/reportes'
import { VIEW_FILTERS, type ViewObject } from '@/lib/report-catalog'
import { deleteViewAction, pinViewAction, saveViewAction } from './reportes/actions'

/** Vistas guardadas de una lista (UX-03). La página le pasa los filtros que tiene puestos; aquí se listan las vistas y se guarda la actual. */
export async function ViewsSection({ object, filters, current }: { object: ViewObject; filters: Record<string, string | undefined>; current?: string }) {
  const ctx = await requireCtx()
  if (!ctx.can('view.save')) return null
  const views = await listViews(ctx, object)
  const allowed = Object.fromEntries(VIEW_FILTERS[object].map((k) => [k, filters[k]]))
  // Filtros que cambian la lista: el embudo de Negocios y los valores por defecto no cuentan como filtro puesto.
  const active = Object.entries(allowed).filter(([k, v]) => v && !(object === 'deal' && k === 'pipeline') && !(object === 'lead' && k === 'status' && v === 'open') && !(object === 'activity' && v === 'mine')).length
  return <ViewsBar t={ctx.t} object={object} views={views} current={current} filters={allowed} canShare={ctx.can('view.share')} activeFilters={active}
    actions={{ save: saveViewAction, remove: deleteViewAction, pin: pinViewAction }} />
}
