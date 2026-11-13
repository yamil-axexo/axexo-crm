'use server'

import { runAction, str } from '@/server/action'
import { readerTimeZone } from '@/server/timezone'
import { isoDay, offsetMs } from '@/lib/format'
import {
  addCost, annotateChange, announceRelease, checkReleaseItem, createRelease, decideConfigRequest, markReleased, openIncident, recordChampionReview,
  recordDeployment, recordRestoreTest, removeMaterial, saveMaterial, scheduleMaintenance, setChampion, setComponentOwners, setMaintenanceStatus,
  setObjective, updateIncident, voidCost,
} from '@/domain/gobierno-ops'
import { invalid, type ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>
const PATHS = ['/admin/gobierno', '/estado', '/solicitudes']

/** Una fecha y hora escritas en un formulario (`2026-11-13T09:30`) están en la zona de quien las escribe. */
function localDate(raw: string, tz: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) throw invalid('Revisa la fecha y la hora.', 'Check the date and time.')
  const guess = new Date(`${raw}:00Z`)
  if (Number.isNaN(guess.getTime())) throw invalid('Revisa la fecha y la hora.', 'Check the date and time.')
  return new Date(guess.getTime() - offsetMs(guess, tz))
}
const int = (raw: string): number | null => (/^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : null)

export async function setObjectiveAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setObjective(ctx, { key: str(fd, 'key'), target: str(fd, 'target'), agreedBy: str(fd, 'agreed_by'), agreedOn: str(fd, 'agreed_on') })
    return { message: ['Objetivo guardado. El tablero ya compara contra él.', 'Objective saved. The board now compares against it.'], revalidate: PATHS }
  })
}

export async function openIncidentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const tz = await readerTimeZone(ctx)
    await openIncident(ctx, { title: str(fd, 'title'), severity: str(fd, 'severity') as 'high', startedAt: localDate(str(fd, 'started_at'), tz), market: str(fd, 'market'), impact: str(fd, 'impact'), requestId: str(fd, 'request_id') })
    return { message: ['Incidente abierto. Queda arriba hasta que se cierre con su causa.', 'Incident opened. It stays on top until it is closed with its cause.'], revalidate: PATHS }
  })
}

export async function updateIncidentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const tz = await readerTimeZone(ctx)
    const resolved = str(fd, 'resolved_at')
    await updateIncident(ctx, { id: str(fd, 'id'), status: str(fd, 'status'), cause: str(fd, 'cause'), actions: str(fd, 'actions'), resolvedAt: resolved ? localDate(resolved, tz) : null })
    return { message: ['Incidente actualizado.', 'Incident updated.'], revalidate: PATHS }
  })
}

export async function recordRestoreTestAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await recordRestoreTest(ctx, {
      testedOn: str(fd, 'tested_on'), testedBy: str(fd, 'tested_by'), environment: str(fd, 'environment') as 'staging', minutes: int(str(fd, 'minutes')),
      dataLossMinutes: int(str(fd, 'data_loss_minutes')), result: str(fd, 'result') as 'ok', evidence: str(fd, 'evidence'), notes: str(fd, 'notes'),
    })
    return { message: ['Prueba de restauración anotada.', 'Restore test recorded.'], revalidate: PATHS }
  })
}

export async function setComponentOwnersAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setComponentOwners(ctx, { key: str(fd, 'key'), owner: str(fd, 'owner'), backup: str(fd, 'backup') })
    return { message: ['Guardado.', 'Saved.'], revalidate: PATHS }
  })
}

export async function scheduleMaintenanceAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const tz = await readerTimeZone(ctx)
    await scheduleMaintenance(ctx, { title: str(fd, 'title'), startsAt: localDate(str(fd, 'starts_at'), tz), endsAt: localDate(str(fd, 'ends_at'), tz), market: str(fd, 'market'), impact: str(fd, 'impact') })
    return { message: ['Ventana agendada. El equipo la ve en "Pedir un cambio".', 'Window scheduled. The team sees it in "Request a change".'], revalidate: PATHS }
  })
}

export async function setMaintenanceStatusAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setMaintenanceStatus(ctx, str(fd, 'id'), str(fd, 'status'))
    return { message: ['Ventana cerrada.', 'Window closed.'], revalidate: PATHS }
  })
}

export async function createReleaseAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createRelease(ctx, {
      version: str(fd, 'version'), titleEs: str(fd, 'title_es'), titleEn: str(fd, 'title_en'), notesEs: str(fd, 'notes_es'), notesEn: str(fd, 'notes_en'),
      plannedFor: str(fd, 'planned_for'), touchesMoney: fd.get('touches_money') === 'on',
    })
    return { message: ['Versión creada como borrador. Completa su lista de salida y anúnciala antes de liberarla.', 'Release created as a draft. Complete its go-live checklist and announce it before releasing it.'], revalidate: PATHS }
  })
}

export async function checkReleaseItemAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await checkReleaseItem(ctx, { id: str(fd, 'id'), item: str(fd, 'item'), evidence: str(fd, 'evidence') })
    return { message: ['Punto cumplido, con su evidencia.', 'Item done, with its evidence.'], revalidate: PATHS }
  })
}

export async function announceReleaseAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await announceRelease(ctx, str(fd, 'id'))
    return { message: ['Versión anunciada. Sus notas ya las ve todo el equipo en "Pedir un cambio".', 'Release announced. The whole team now sees its notes in "Request a change".'], revalidate: PATHS }
  })
}

export async function markReleasedAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await markReleased(ctx, str(fd, 'id'), isoDay(new Date(), await readerTimeZone(ctx)))
    return { message: ['Versión marcada como liberada.', 'Release marked as released.'], revalidate: PATHS }
  })
}

export async function recordDeploymentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const tz = await readerTimeZone(ctx)
    await recordDeployment(ctx, {
      environment: str(fd, 'environment') as 'staging', commit: str(fd, 'commit'), deployedAt: localDate(str(fd, 'deployed_at'), tz), deployedBy: str(fd, 'deployed_by'),
      result: str(fd, 'result') as 'ok', releaseId: str(fd, 'release_id'), notes: str(fd, 'notes'),
    })
    return { message: ['Despliegue anotado.', 'Deployment recorded.'], revalidate: PATHS }
  })
}

export async function addCostAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addCost(ctx, { month: str(fd, 'month'), kind: str(fd, 'kind') as 'cost', component: str(fd, 'component') as 'platform', label: str(fd, 'label'), amount: str(fd, 'amount'), note: str(fd, 'note') }, isoDay(new Date(), await readerTimeZone(ctx)).slice(0, 7))
    return { message: ['Cargado. El tablero ya lo suma.', 'Loaded. The board now adds it up.'], revalidate: PATHS }
  })
}

export async function voidCostAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await voidCost(ctx, str(fd, 'id'))
    return { message: ['Anulado. Ya no suma; queda a la vista, tachado.', 'Voided. It no longer adds up; it stays visible, struck through.'], revalidate: PATHS }
  })
}

export async function decideRequestAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await decideConfigRequest(ctx, { id: str(fd, 'id'), decision: str(fd, 'decision'), note: str(fd, 'note') })
    return { message: ['Decisión guardada. Quien lo pidió ya la ve.', 'Decision saved. The person who asked can see it now.'], revalidate: PATHS }
  })
}

export async function annotateChangeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await annotateChange(ctx, str(fd, 'event_id'), str(fd, 'reason'))
    return { message: ['Motivo anotado.', 'Reason recorded.'], revalidate: PATHS }
  })
}

export async function setChampionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setChampion(ctx, str(fd, 'team_id'), str(fd, 'user_id'))
    return { message: ['Champion guardado. Su equipo ya lo ve en "Pedir un cambio".', 'Champion saved. The team now sees it in "Request a change".'], revalidate: PATHS }
  })
}

export async function recordChampionReviewAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await recordChampionReview(ctx, { teamId: str(fd, 'team_id'), month: str(fd, 'month'), notes: str(fd, 'notes') }, isoDay(new Date(), await readerTimeZone(ctx)).slice(0, 7))
    return { message: ['Revisión del mes anotada.', 'Monthly review recorded.'], revalidate: PATHS }
  })
}

export async function saveMaterialAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveMaterial(ctx, { market: str(fd, 'market'), kind: str(fd, 'kind') as 'deck', locale: str(fd, 'locale') as 'es', title: str(fd, 'title'), url: str(fd, 'url'), inPortal: fd.get('in_portal') === 'on', pinned: fd.get('pinned') === 'on' })
    return { message: ['Material guardado. El equipo de ese mercado ya lo ve.', 'Material saved. That market’s team can see it now.'], revalidate: PATHS }
  })
}

export async function removeMaterialAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await removeMaterial(ctx, str(fd, 'id'))
    return { message: ['Material quitado.', 'Material removed.'], revalidate: PATHS }
  })
}
