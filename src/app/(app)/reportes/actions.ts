'use server'

import { runAction, str } from '@/server/action'
import { withSystem } from '@/server/db'
import { deleteReport, deleteView, markDeliveriesSeen, pinView, runReconciliation, saveReport, saveView, scheduleReport, setAgencyLabels, setMetricOwner, takeSnapshot } from '@/domain/reportes'
import type { ActionResult } from '@/lib/errors'

type Prev = ActionResult<unknown> | null
const json = (raw: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function saveReportAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await saveReport(ctx, { report: str(fd, 'report'), name: str(fd, 'name'), params: json(str(fd, 'params')), shared: fd.get('shared') === 'on', schedule: str(fd, 'schedule') })
    return { message: ['Reporte guardado. Está en Reportes, en "Mis reportes".', 'Report saved. It is in Reports, under "My reports".'], revalidate: ['/reportes'] }
  })
}
export async function deleteReportAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await deleteReport(ctx, str(fd, 'id'))
    return { message: ['Reporte borrado.', 'Report deleted.'], revalidate: ['/reportes'] }
  })
}
export async function scheduleReportAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await scheduleReport(ctx, str(fd, 'id'), str(fd, 'schedule'))
    return { message: ['Listo. El resumen te llega aquí, en Reportes.', 'Done. The summary arrives here, in Reports.'], revalidate: ['/reportes'] }
  })
}
export async function seenDeliveriesAction(_: Prev, _fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await markDeliveriesSeen(ctx)
    return { revalidate: ['/reportes'] }
  })
}
export async function metricOwnerAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await setMetricOwner(ctx, { key: str(fd, 'key'), owner: str(fd, 'owner') })
    return { message: ['Responsable guardado.', 'Owner saved.'], revalidate: ['/reportes/indicadores'] }
  })
}
export async function agencyLabelsAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await setAgencyLabels(ctx, str(fd, 'labels'))
    return { message: ['Guardado.', 'Saved.'], revalidate: ['/reportes/agencias'] }
  })
}
export async function saveViewAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await saveView(ctx, { object: str(fd, 'object'), name: str(fd, 'name'), filters: json(str(fd, 'filters')), shared: fd.get('shared') === 'on', pin: fd.get('pin') === 'on' })
    return { message: ['Vista guardada.', 'View saved.'] }
  })
}
export async function deleteViewAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    await deleteView(ctx, str(fd, 'id'))
    return { message: ['Vista borrada.', 'View deleted.'] }
  })
}
export async function pinViewAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    const on = str(fd, 'on') === '1'
    await pinView(ctx, str(fd, 'id'), on)
    return { message: on ? ['Cola fijada en tu menú.', 'Queue pinned to your menu.'] : ['Cola quitada de tu menú.', 'Queue removed from your menu.'] }
  })
}
/** Correr ahora, a mano: solo administración. La tarea corre con la identidad del sistema, igual que cuando la corre el horario. */
export async function runReportJobAction(_: Prev, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async (ctx) => {
    ctx.assert('integration.operate')
    const what = str(fd, 'job')
    if (what === 'snapshot') await withSystem((tx) => takeSnapshot(tx))
    else await withSystem((tx) => runReconciliation(tx))
    return { message: what === 'snapshot' ? ['Foto tomada.', 'Snapshot taken.'] : ['Conciliación hecha.', 'Reconciliation done.'], revalidate: ['/reportes/historico', '/reportes/conciliacion'] }
  })
}
