'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { runAction, str } from '@/server/action'
import { VIEW_AS_COOKIE } from '@/server/context'
import { env } from '@/env'
import { endMembership } from '@/domain/admin'
import { ADMIN_AREAS, type AdminArea } from '@/domain/policy'
import {
  acknowledgeAlert, addAccountTeamMember, anonymizeSubject, applyRetention, closeAccessReview, createSensitiveField, createSubjectRequest,
  decideReviewItem, grantAgencyAccess, liftOptOut, openAccessReview, optOut, prepareAuditArchive, recordConsent, recordSeatApproval, removeAccountTeamMember,
  revealSensitive, revokeConsent, runSecurityScan, setAdminAreas, setApiClientMeta, setDueDays, setMembershipEntity, setRetentionRule,
  setSecretMeta, setSensitive, setTeamParent, setThresholds, startViewAs, updateSensitiveField, updateSubjectRequest, THRESHOLD_KEYS,
} from '@/domain/security'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>
const all = (fd: FormData, key: string) => fd.getAll(key).filter((v): v is string => typeof v === 'string')
const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const here = ['/admin/seguridad', 'layout']

export async function scanAction(): Promise<R> {
  return runAction(async (ctx) => {
    const n = await runSecurityScan(ctx)
    return { message: n === 0 ? ['Revisado: no hay alertas nuevas.', 'Checked: no new alerts.'] : [`Revisado: ${n} ${n === 1 ? 'alerta nueva o actualizada' : 'alertas nuevas o actualizadas'}.`, `Checked: ${n} new or updated ${n === 1 ? 'alert' : 'alerts'}.`], revalidate: here }
  })
}

export async function ackAlertAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await acknowledgeAlert(ctx, str(fd, 'id'), str(fd, 'note'))
    return { message: ['Alerta revisada. Queda en la bitácora con tu nota.', 'Alert reviewed. It is logged with your note.'], revalidate: here }
  })
}

export async function thresholdsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setThresholds(ctx, Object.fromEntries(THRESHOLD_KEYS.map((k) => [k, Number(str(fd, k))])))
    return { message: ['Umbrales guardados.', 'Thresholds saved.'], revalidate: here }
  })
}

export async function archiveAction(): Promise<R> {
  return runAction(async (ctx) => {
    const n = await prepareAuditArchive(ctx)
    return { message: n === 0 ? ['No hay filas nuevas que copiar.', 'There are no new rows to copy.'] : [`${n} ${n === 1 ? 'lote armado' : 'lotes armados'} con su huella. El destino está apagado: quedan en la cola.`, `${n} ${n === 1 ? 'batch' : 'batches'} built with a fingerprint. The destination is off: they stay queued.`], revalidate: here }
  })
}

export async function adminAreasAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const everything = str(fd, 'scope') === 'all'
    const areas = all(fd, 'area').filter((a): a is AdminArea => (ADMIN_AREAS as readonly string[]).includes(a))
    await setAdminAreas(ctx, str(fd, 'membership_id'), everything ? null : areas)
    return { message: ['Guardado. El cambio vale desde su siguiente pantalla.', 'Saved. The change applies from their next screen.'], revalidate: here }
  })
}

export async function entityAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setMembershipEntity(ctx, str(fd, 'membership_id'), str(fd, 'legal_entity_id') || null)
    return { message: ['Alcance guardado.', 'Scope saved.'], revalidate: here }
  })
}

export async function teamParentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setTeamParent(ctx, str(fd, 'team_id'), str(fd, 'parent_id') || null)
    return { message: ['Jerarquía guardada.', 'Hierarchy saved.'], revalidate: here }
  })
}

export async function grantAgencyAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await grantAgencyAccess(ctx, { email: str(fd, 'email'), fullName: str(fd, 'full_name'), agencyId: str(fd, 'agency_id'), expires: str(fd, 'expires') }, env().AUTH_ALLOWED_DOMAINS)
    return { message: ['Acceso de agencia otorgado: solo verá lo que su agencia reclutó.', 'Agency access granted: they will only see what their agency recruited.'], revalidate: here }
  })
}

export async function seatAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await recordSeatApproval(ctx, str(fd, 'membership_id'), { approverName: str(fd, 'approver_name'), approvedOn: str(fd, 'approved_on'), reference: str(fd, 'reference') })
    return { message: ['Aprobación registrada.', 'Approval recorded.'], revalidate: here }
  })
}

export async function viewAsAction(_: R | null, fd: FormData): Promise<R> {
  const out = await runAction<string>(async (ctx) => ({ data: await startViewAs(ctx, str(fd, 'target_id'), str(fd, 'reason'), Number(str(fd, 'minutes') || '15')) }))
  if (!out.ok || !out.data) return out
  ;(await cookies()).set(VIEW_AS_COOKIE, out.data, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 })
  redirect('/hoy')
}

export async function openReviewAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await openAccessReview(ctx, str(fd, 'market') || null, str(fd, 'due_on'))
    return { message: ['Revisión abierta. Quien lidera ya puede decidir cada acceso.', 'Review opened. The lead can now decide each access.'], revalidate: here }
  })
}

export async function decideItemAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await decideReviewItem(ctx, str(fd, 'id'), str(fd, 'decision') as 'keep', str(fd, 'note'))
    return { message: ['Decisión guardada.', 'Decision saved.'], revalidate: here }
  })
}

export async function closeReviewAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await closeAccessReview(ctx, str(fd, 'id'))
    return { message: [`Revisión cerrada con tu acuse: ${out.keep} se mantienen, ${out.remove} por quitar.`, `Review closed with your sign-off: ${out.keep} stay, ${out.remove} to remove.`], revalidate: here }
  })
}

export async function removeReviewedAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await endMembership(ctx, str(fd, 'membership_id'))
    return { message: [`Acceso de ${out.name} quitado.`, `Access removed for ${out.name}.`], revalidate: here }
  })
}

export async function sensitiveFieldAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateSensitiveField(ctx, str(fd, 'key'), {
      viewRoles: all(fd, 'view') as 'admin'[], editRoles: all(fd, 'edit') as 'admin'[],
      ownerCanView: fd.get('owner_view') === 'on', ownerCanEdit: fd.get('owner_edit') === 'on', isActive: fd.get('active') === 'on',
    })
    return { message: ['Guardado.', 'Saved.'], revalidate: here }
  })
}

export async function createSensitiveFieldAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createSensitiveField(ctx, { key: str(fd, 'key'), labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en') })
    return { message: ['Campo creado. Nace cerrado: ábrelo a los roles que deban verlo.', 'Field created. It starts closed: open it to the roles that should see it.'], revalidate: here }
  })
}

export async function retentionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const days = intOrNull(str(fd, 'after_days'))
    await setRetentionRule(ctx, str(fd, 'key'), { afterDays: days, isActive: fd.get('active') === 'on' })
    return { message: ['Regla guardada. Revisa la vista previa antes de aplicarla.', 'Rule saved. Check the preview before applying it.'], revalidate: here }
  })
}

export async function applyRetentionAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const n = await applyRetention(ctx, str(fd, 'key'))
    return { message: [`Regla aplicada: ${n} ${n === 1 ? 'registro' : 'registros'}.`, `Rule applied: ${n} ${n === 1 ? 'record' : 'records'}.`], revalidate: here }
  })
}

export async function dueDaysAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setDueDays(ctx, str(fd, 'market'), intOrNull(str(fd, 'days')))
    return { message: ['Plazo guardado. Vale para las solicitudes nuevas.', 'Period saved. It applies to new requests.'], revalidate: here }
  })
}

export async function createRequestAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createSubjectRequest(ctx, { market: str(fd, 'market'), kind: str(fd, 'kind') as 'access', subjectName: str(fd, 'subject_name'), subjectContact: str(fd, 'subject_contact'), detail: str(fd, 'detail'), receivedOn: str(fd, 'received_on'), contactId: str(fd, 'contact_id'), leadId: str(fd, 'lead_id') })
    return { message: ['Solicitud registrada.', 'Request recorded.'], revalidate: here }
  })
}

export async function updateRequestAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateSubjectRequest(ctx, str(fd, 'id'), { status: str(fd, 'status') as 'done', resolution: str(fd, 'resolution'), contactId: str(fd, 'contact_id'), leadId: str(fd, 'lead_id') })
    return { message: ['Solicitud actualizada.', 'Request updated.'], revalidate: here }
  })
}

export async function anonymizeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const n = await anonymizeSubject(ctx, str(fd, 'id'), str(fd, 'confirm'))
    return { message: [`Persona anonimizada. En la bitácora se taparon sus datos en ${n} ${n === 1 ? 'fila' : 'filas'}; el hecho se conserva.`, `Person anonymized. Their data was masked in ${n} log ${n === 1 ? 'row' : 'rows'}; the fact is kept.`], revalidate: here }
  })
}

export async function liftOptOutAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await liftOptOut(ctx, str(fd, 'id'), str(fd, 'reason'))
    return { message: ['Baja levantada.', 'Opt-out lifted.'] }
  })
}

export async function keyMetaAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setApiClientMeta(ctx, str(fd, 'id'), { ownerId: str(fd, 'owner_id'), expires: str(fd, 'expires') })
    return { message: ['Llave actualizada.', 'Key updated.'], revalidate: here }
  })
}

export async function secretMetaAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setSecretMeta(ctx, str(fd, 'key'), { ownerId: str(fd, 'owner_id'), rotateEveryDays: intOrNull(str(fd, 'rotate_every_days')), lastRotatedOn: str(fd, 'last_rotated_on'), note: str(fd, 'note') })
    return { message: ['Inventario actualizado.', 'Inventory updated.'], revalidate: here }
  })
}

// ------------------------------------------------------------ hoja del comercio: equipo, datos reservados, consentimiento
export async function addTeamMemberAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addAccountTeamMember(ctx, { accountId: str(fd, 'account_id'), userId: str(fd, 'user_id'), fn: str(fd, 'function') as 'support', access: str(fd, 'access') as 'read', note: str(fd, 'note') })
    return { message: ['Persona agregada al equipo de la cuenta.', 'Person added to the account team.'] }
  })
}

export async function removeTeamMemberAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await removeAccountTeamMember(ctx, str(fd, 'id'))
    return { message: ['Persona fuera del equipo de la cuenta.', 'Person removed from the account team.'] }
  })
}

export async function setSensitiveAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setSensitive(ctx, str(fd, 'account_id'), str(fd, 'key'), str(fd, 'value'))
    return { message: ['Guardado. Queda tapado; verlo pide motivo y queda en la bitácora.', 'Saved. It stays masked; seeing it asks for a reason and is logged.'] }
  })
}

export async function revealAction(_: R | null, fd: FormData): Promise<R> {
  return runAction<string>(async (ctx) => {
    const value = await revealSensitive(ctx, str(fd, 'account_id'), str(fd, 'key'), str(fd, 'reason'))
    return { data: value ?? ctx.t('Sin dato', 'No value'), revalidate: [] }
  })
}

export async function recordConsentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await recordConsent(ctx, { contactId: str(fd, 'contact_id'), channel: str(fd, 'channel') as 'email', category: str(fd, 'category') as 'service', source: str(fd, 'source') as 'verbal', evidence: str(fd, 'evidence') })
    return { message: ['Consentimiento registrado con su fecha.', 'Consent recorded with its date.'] }
  })
}

export async function revokeConsentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await revokeConsent(ctx, str(fd, 'id'), str(fd, 'reason'))
    return { message: ['Consentimiento retirado.', 'Consent withdrawn.'] }
  })
}

export async function optOutAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await optOut(ctx, { market: str(fd, 'market'), channel: str(fd, 'channel') as 'email', address: str(fd, 'address'), reason: str(fd, 'reason') })
    return { message: ['Baja registrada: esa dirección no recibe más por ese canal.', 'Opt-out recorded: that address gets nothing more on that channel.'] }
  })
}
