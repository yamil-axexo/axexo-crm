'use server'

import { runAction, str } from '@/server/action'
import type { ActionResult } from '@/lib/errors'
import { day } from '@/lib/format'
import { assignFile, decideFile, markReceived, openDocument, openFile, reviewDocument, submitFile } from '@/domain/campo-canal/expediente'
import { correctAttribution, decideCreditLimit, extendClaim, raiseDispute, registerClaim, rejectClaim, requestCreditLimit, resolveDispute, simulateFunding } from '@/domain/campo-canal/canal'
import { addCompetitor, applyPlan, discardPlan, draftPlan, handleIncident, recordCompetitor, reportIncident, setChannelAssignment, setRepPlan, setSellerProfile, setTerritoryOwner } from '@/domain/campo-canal/campo'
import { setThreshold } from '@/domain/campo-canal/thresholds'
import { reclassifyAttribution } from '@/domain/campo-canal/attribution'
import { setChannelPolicy } from '@/domain/campo-canal/canal2'
import { createOnboardingLink } from '@/domain/campo-canal/expediente'
import { setSensitive } from '@/domain/security'
import { headers } from 'next/headers'

type R = ActionResult<unknown>
const all = (fd: FormData): Record<string, string> => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]))
const REV = ['/campo']

export async function openFileAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await openFile(ctx, { accountId: str(fd, 'accountId'), personType: str(fd, 'personType'), funding: str(fd, 'funding'), capturedVia: str(fd, 'capturedVia') || 'contigo', visitedOn: str(fd, 'visitedOn') })
    return { message: ['Expediente abierto con la lista de documentos que pide este mercado.', 'File opened with the list of documents this market asks for.'], revalidate: REV }
  })
}
export async function markReceivedAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await markReceived(ctx, str(fd, 'id'), str(fd, 'link'))
    return { message: ['Marcado como recibido.', 'Marked as received.'], revalidate: REV }
  })
}
export async function submitFileAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await submitFile(ctx, str(fd, 'id'))
    return { message: out === 'auto_approved' ? ['Aprobado por la regla de prepago.', 'Approved by the prepaid rule.'] : ['Enviado a la mesa de control.', 'Sent to the control desk.'], revalidate: REV }
  })
}
export async function assignFileAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await assignFile(ctx, str(fd, 'id'), str(fd, 'to') || null)
    return { message: ['Expediente asignado.', 'File assigned.'], revalidate: REV }
  })
}
export async function reviewDocumentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await reviewDocument(ctx, str(fd, 'id'), str(fd, 'verdict'), str(fd, 'note'))
    return { message: ['Documento revisado.', 'Document reviewed.'], revalidate: REV }
  })
}
export async function decideFileAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await decideFile(ctx, str(fd, 'id'), str(fd, 'decision'), str(fd, 'note'))
    return { message: str(fd, 'decision') === 'approve' ? ['Expediente aprobado.', 'File approved.'] : ['Devuelto a Ventas con el motivo.', 'Returned to Sales with the reason.'], revalidate: REV }
  })
}
export async function openDocumentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await openDocument(ctx, str(fd, 'id'))
    if (out.outcome === 'vault_off') return { message: ['La bóveda de documentos está apagada: CONTIGO no guarda el archivo. Quedó registrado que lo pediste.', 'The document vault is off: CONTIGO does not store the file. Your request was logged.'], revalidate: REV }
    return { message: [`Enlace: ${out.url}`, `Link: ${out.url}`], revalidate: REV }
  })
}
export async function setThresholdAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const v = await setThreshold(ctx, { market: str(fd, 'market'), key: str(fd, 'key'), value: str(fd, 'value'), reason: str(fd, 'reason') })
    return { message: [`Guardado como versión ${v}.`, `Saved as version ${v}.`], revalidate: REV }
  })
}
export async function draftPlanAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await draftPlan(ctx, { market: str(fd, 'market'), fromUserId: str(fd, 'from'), toUserId: str(fd, 'to'), territoryId: str(fd, 'territory'), note: str(fd, 'note') })
    return { message: ['Plan guardado en borrador. Revisa quién gana y quién pierde visibilidad antes de aplicarlo.', 'Plan saved as a draft. Check who gains and who loses visibility before applying it.'], revalidate: REV }
  })
}
export async function applyPlanAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const n = await applyPlan(ctx, str(fd, 'id'))
    return { message: [`Plan aplicado: ${n} comercios cambiaron de manos, con su historia.`, `Plan applied: ${n} merchants changed hands, with their history.`], revalidate: REV }
  })
}
export async function discardPlanAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await discardPlan(ctx, str(fd, 'id'))
    return { message: ['Plan descartado. No se movió nada.', 'Plan discarded. Nothing moved.'], revalidate: REV }
  })
}
export async function channelAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setChannelAssignment(ctx, { accountId: str(fd, 'accountId'), channel: str(fd, 'channel'), userId: str(fd, 'userId'), duty: str(fd, 'duty'), reason: str(fd, 'reason') })
    return { message: ['Canal asignado. La asignación anterior quedó cerrada con fecha.', 'Channel assigned. The previous assignment was closed with a date.'], revalidate: REV }
  })
}
export async function territoryOwnerAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setTerritoryOwner(ctx, str(fd, 'territory'), str(fd, 'userId'))
    return { message: ['Listo: esa persona responde por el territorio.', 'Done: that person now owns the territory.'], revalidate: REV }
  })
}
export async function profileAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setSellerProfile(ctx, str(fd, 'market'), str(fd, 'userId'), str(fd, 'profile'))
    return { message: ['Perfil guardado.', 'Profile saved.'], revalidate: REV }
  })
}
export async function correctAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await correctAttribution(ctx, str(fd, 'accountId'), { layer: str(fd, 'layer'), partyKind: str(fd, 'partyKind'), partyRef: str(fd, 'partyRef') || str(fd, 'partyLabel'), partyLabel: str(fd, 'partyLabel'), reason: str(fd, 'reason'), originKind: str(fd, 'originKind') })
    return { message: ['Corrección guardada como fila nueva. La anterior sigue en la historia.', 'Correction saved as a new row. The previous one stays in the history.'], revalidate: REV }
  })
}
export async function raiseDisputeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const d = all(fd)
    await raiseDispute(ctx, { ...d, claimedRef: d.claimedRef || d.claimedLabel || '' })
    return { message: ['Disputa enviada. Quien lidera el mercado la resuelve dentro del plazo.', 'Dispute sent. The market lead resolves it within the deadline.'], revalidate: REV }
  })
}
export async function resolveDisputeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await resolveDispute(ctx, str(fd, 'id'), str(fd, 'decision'), str(fd, 'resolution'))
    return { message: ['Disputa resuelta. Queda en la bitácora.', 'Dispute resolved. It stays in the log.'], revalidate: REV }
  })
}
export async function registerClaimAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await registerClaim(ctx, all(fd))
    if (out.status === 'held') return { message: [`Esa tienda ya tiene un registro vigente de otro canal hasta el ${day(out.until, ctx.locale, ctx.market(str(fd, 'market')).timezone)}. El intento quedó rechazado con ese motivo.`, `That store already has an active registration from another channel until ${day(out.until, ctx.locale, ctx.market(str(fd, 'market')).timezone)}. The attempt was rejected with that reason.`], revalidate: REV }
    if (out.status === 'customer') return { message: ['Esa tienda ya es cliente: no se registra.', 'That store is already a customer: it is not registered.'], revalidate: REV }
    return { message: [`Registrada hasta el ${day(out.until, ctx.locale, ctx.market(str(fd, 'market')).timezone)}.`, `Registered until ${day(out.until, ctx.locale, ctx.market(str(fd, 'market')).timezone)}.`], revalidate: REV }
  })
}
export async function extendClaimAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await extendClaim(ctx, str(fd, 'id'), str(fd, 'evidence'))
    return { message: ['Ventana extendida.', 'Window extended.'], revalidate: REV }
  })
}
export async function rejectClaimAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await rejectClaim(ctx, str(fd, 'id'), str(fd, 'reason'))
    return { message: ['Registro rechazado con motivo.', 'Registration rejected with a reason.'], revalidate: REV }
  })
}
export async function simulateFundingAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await simulateFunding(ctx, all(fd))
    return { message: ['Dato simulado cargado. Se ve marcado como simulado.', 'Simulated value loaded. It shows as simulated.'], revalidate: REV }
  })
}
export async function requestCreditAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await requestCreditLimit(ctx, all(fd))
    return { message: ['Solicitud enviada. La aprueba otra persona.', 'Request sent. Someone else approves it.'], revalidate: REV }
  })
}
export async function decideCreditAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await decideCreditLimit(ctx, str(fd, 'id'), str(fd, 'decision'), str(fd, 'note'))
    return { message: ['Decisión guardada.', 'Decision saved.'], revalidate: REV }
  })
}
export async function addCompetitorAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addCompetitor(ctx, str(fd, 'market'), str(fd, 'name'))
    return { message: ['Competidor en la lista.', 'Competitor on the list.'], revalidate: REV }
  })
}
export async function recordCompetitorAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await recordCompetitor(ctx, all(fd))
    return { message: ['Observación guardada con su fecha y fuente.', 'Observation saved with its date and source.'], revalidate: REV }
  })
}
export async function repPlanAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setRepPlan(ctx, { market: str(fd, 'market'), userId: str(fd, 'userId'), month: str(fd, 'month'), target: str(fd, 'target') })
    return { message: ['Meta guardada.', 'Target saved.'], revalidate: REV }
  })
}
export async function reportIncidentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await reportIncident(ctx, all(fd))
    return { message: ['Incidente registrado. Es confidencial: lo ve quien lidera el mercado.', 'Incident recorded. It is confidential: the market lead sees it.'], revalidate: REV }
  })
}
export async function handleIncidentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await handleIncident(ctx, str(fd, 'id'), str(fd, 'action'), str(fd, 'resolution'))
    return { message: str(fd, 'action') === 'take' ? ['Lo tomaste.', 'You took it.'] : ['Incidente cerrado.', 'Incident closed.'], revalidate: REV }
  })
}

// ------------------------------------------------------------ campo2
export async function reclassifyAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const r = await reclassifyAttribution(ctx, str(fd, 'market'))
    return { message: [`Listo: ${r.classified} orígenes clasificados (${r.network} de red adquirida, ${r.acquisition} altas nuevas) y ${r.channels} capas de canal con su equipo reclutador.`, `Done: ${r.classified} origins classified (${r.network} acquired network, ${r.acquisition} new sign-ups) and ${r.channels} channel layers with their recruiting team.`], revalidate: REV }
  })
}
export async function channelPolicyAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const v = await setChannelPolicy(ctx, all(fd))
    return { message: [`Política guardada como versión ${v}.`, `Policy saved as version ${v}.`], revalidate: REV }
  })
}
export async function onboardingLinkAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const r = await createOnboardingLink(ctx, str(fd, 'id'))
    return { data: await publicUrl(`/e/${r.token}`), revalidate: REV }
  })
}
export async function taxIdAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setSensitive(ctx, str(fd, 'accountId'), 'tax_id', str(fd, 'value'))
    return { message: ['Guardado como dato reservado. Se muestra tapado y cada revelado queda en la bitácora.', 'Saved as restricted data. It is shown masked and every reveal is logged.'], revalidate: REV }
  })
}

/** La dirección completa del enlace, con el host con que la persona abrió CONTIGO. */
async function publicUrl(path: string): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https')
  return host && /^[A-Za-z0-9.:-]{3,200}$/.test(host) ? `${proto}://${host}${path}` : path
}
