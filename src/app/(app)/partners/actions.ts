'use server'

import { runAction, str } from '@/server/action'
import { readerTimeZone } from '@/server/timezone'
import {
  addEnablement, addMilestone, cancelContract, createContract, createPartnerToken, createPlan, grantPartnerAccess, invitePartnerUser, markSigned,
  recalcTiersNow, registerPartner, renewContract, revokePartnerToken, runCrossMatch, saveTerms, saveTier, sendContract, sharePlan, updateMilestone,
} from '@/domain/partners'
import { promoteBatch, releaseNetwork, rollbackBatch, stageNetwork, NETWORK_TARGETS } from '@/domain/network-loads'
import { captureComm } from '@/domain/comms'
import { estimateStatements, partnerRegisterClaim, publishStatement, recordEnablementProgress } from '@/domain/campo-canal/canal2'
import { day } from '@/lib/format'
import { invalid } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>
const acc = (fd: FormData) => [`/comercios/${str(fd, 'account_id')}`, `/comercios/${str(fd, 'account_id')}/contratos`, `/comercios/${str(fd, 'account_id')}/plan`, `/comercios/${str(fd, 'account_id')}/comunicaciones`]
const offMsg: [string, string] = ['La firma electrónica está apagada: el pedido quedó en la cola. Manda el documento por tu medio y, al tenerlo firmado, márcalo aquí.', 'Electronic signature is off: the request is queued. Send the document your usual way and, once signed, mark it here.']

// ------------------------------------------------------------ PIPE-07
export async function saveTermsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const r = await saveTerms(ctx, str(fd, 'account_id'), {
      lines: str(fd, 'lines'), settlement: str(fd, 'settlement') as 'prepaid', fees: str(fd, 'fees'), nda: str(fd, 'nda') === 'on',
      termMonths: str(fd, 'term_months'), validFrom: str(fd, 'valid_from'), renewalNoticeDays: str(fd, 'renewal_notice_days') || '30', note: str(fd, 'note'),
    })
    return { message: [`Términos guardados: versión ${r.version}.`, `Terms saved: version ${r.version}.`], revalidate: acc(fd) }
  })
}
export async function createContractAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createContract(ctx, str(fd, 'account_id'))
    return { message: ['Contrato creado en borrador con los términos vigentes.', 'Contract created as a draft with the current terms.'], revalidate: acc(fd) }
  })
}
export async function sendContractAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const s = await sendContract(ctx, str(fd, 'id'), { signerEmail: str(fd, 'signer_email'), signerName: str(fd, 'signer_name'), documentUrl: str(fd, 'document_url') })
    return { message: s === 'channel_off' ? offMsg : s === 'sent' ? ['Enviado a firmar.', 'Sent for signature.'] : s === 'failed' ? ['No se pudo mandar a firmar. Quedó en la cola; inténtalo de nuevo más tarde.', 'It could not be sent for signature. It is queued; try again later.'] : ['Enviado (simulado).', 'Sent (simulated).'], revalidate: acc(fd) }
  })
}
export async function markSignedAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const s = await markSigned(ctx, str(fd, 'id'), { signedOn: str(fd, 'signed_on'), signedBy: str(fd, 'signed_by'), documentUrl: str(fd, 'document_url') })
    return { message: s === 'active' ? ['Firmado y vigente.', 'Signed and active.'] : s === 'expired' ? ['Firmado; ya pasó su fin, queda vencido.', 'Signed; its end date has passed, so it is expired.'] : ['Firmado. Queda vigente el día que empieza.', 'Signed. It becomes active on its start date.'], revalidate: acc(fd) }
  })
}
export async function cancelContractAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await cancelContract(ctx, str(fd, 'id'))
    return { message: ['Contrato cancelado.', 'Contract cancelled.'], revalidate: acc(fd) }
  })
}
export async function renewContractAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await renewContract(ctx, str(fd, 'id'))
    return { message: ['Renovación creada en borrador con los términos vigentes.', 'Renewal created as a draft with the current terms.'], revalidate: acc(fd) }
  })
}

// ------------------------------------------------------------ PIPE-08
export async function createPlanAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createPlan(ctx, { accountId: str(fd, 'account_id'), dealId: str(fd, 'deal_id'), title: str(fd, 'title'), axexoOwner: str(fd, 'axexo_owner'), clientOwner: str(fd, 'client_owner') })
    return { message: ['Plan creado con los hitos de la plantilla.', 'Plan created with the template milestones.'], revalidate: acc(fd) }
  })
}
export async function addMilestoneAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addMilestone(ctx, str(fd, 'plan_id'), { phase: str(fd, 'phase') as 'other', title: str(fd, 'title'), side: str(fd, 'side') as 'client', ownerUserId: str(fd, 'owner_user_id'), ownerName: str(fd, 'owner_name'), dueOn: str(fd, 'due_on') })
    return { message: ['Hito agregado.', 'Milestone added.'], revalidate: acc(fd) }
  })
}
export async function updateMilestoneAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateMilestone(ctx, str(fd, 'id'), { status: str(fd, 'status') as 'pending', dueOn: str(fd, 'due_on'), note: str(fd, 'note') })
    return { message: ['Hito actualizado.', 'Milestone updated.'], revalidate: acc(fd) }
  })
}
export async function sharePlanAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const s = await sharePlan(ctx, str(fd, 'id'), str(fd, 'email'))
    return { message: s === 'sent' ? ['Invitación enviada al cliente.', 'Invitation sent to the client.'] : s === 'failed' ? ['No se pudo mandar la invitación. Quedó en la cola.', 'The invitation could not be sent. It is queued.'] : s === 'channel_off' ? ['El acceso de clientes está apagado: el pedido quedó en la cola. Mientras tanto comparte el avance por tu medio.', 'Client access is off: the request is queued. Meanwhile share progress your usual way.'] : ['Compartido (simulado).', 'Shared (simulated).'], revalidate: acc(fd) }
  })
}

// ------------------------------------------------------------ ACT-03
export async function captureCommAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await captureComm(ctx, {
      accountId: str(fd, 'account_id'), channel: str(fd, 'channel') as 'email', subject: str(fd, 'subject'), participants: str(fd, 'participants'), summary: str(fd, 'summary'),
      at: str(fd, 'at'), minutes: str(fd, 'minutes') || '0', direction: str(fd, 'direction') as 'inbound', phone: str(fd, 'phone'),
    }, await readerTimeZone(ctx))
    return { message: ['Quedó en el hilo de la cuenta.', 'It is now in the account thread.'], revalidate: acc(fd) }
  })
}

// ------------------------------------------------------------ CANAL-01 y CANAL-06
const here = ['/partners']
export async function registerPartnerAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await registerPartner(ctx, str(fd, 'account_id'))
    return { message: ['Registrado como partner. Su nivel sale en el próximo cálculo.', 'Registered as a partner. Its tier comes out in the next calculation.'], revalidate: here }
  })
}
export async function grantPartnerAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await grantPartnerAccess(ctx, { userId: str(fd, 'user_id'), accountId: str(fd, 'account_id') })
    return { message: ['Acceso de partner dado: ve ese nodo y lo que cuelga de él, en solo lectura.', 'Partner access given: they see that node and everything under it, read-only.'], revalidate: here }
  })
}
export async function invitePartnerAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const s = await invitePartnerUser(ctx, str(fd, 'account_id'), str(fd, 'email'))
    return { message: s === 'sent' ? ['Invitación enviada por correo.', 'Invitation sent by email.'] : s === 'failed' ? ['No se pudo mandar la invitación. Quedó en la cola.', 'The invitation could not be sent. It is queued.'] : s === 'channel_off' ? ['La entrada de usuarios externos está apagada: la invitación quedó en la cola.', 'External user sign-in is off: the invitation is queued.'] : ['Invitación simulada.', 'Invitation simulated.'], revalidate: here }
  })
}
export async function createTokenAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const raw = await createPartnerToken(ctx, { userId: str(fd, 'user_id'), label: str(fd, 'label') })
    return { data: raw, revalidate: here }
  })
}
export async function revokeTokenAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await revokePartnerToken(ctx, str(fd, 'id'))
    return { message: ['Token revocado: deja de funcionar ya.', 'Token revoked: it stops working now.'], revalidate: here }
  })
}
export async function saveTierAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveTier(ctx, { market: str(fd, 'market'), code: str(fd, 'code'), nameEs: str(fd, 'name_es'), nameEn: str(fd, 'name_en'), rank: str(fd, 'rank'), minActive: str(fd, 'min_active'), minQuality: str(fd, 'min_quality'), minCompliance: str(fd, 'min_compliance') })
    return { message: ['Nivel guardado. Los criterios quedan publicados para todos.', 'Tier saved. The criteria are published for everyone.'], revalidate: here }
  })
}
export async function addMaterialAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addEnablement(ctx, { market: str(fd, 'market'), tier: str(fd, 'tier'), titleEs: str(fd, 'title_es'), titleEn: str(fd, 'title_en'), url: str(fd, 'url') })
    return { message: ['Material agregado al nivel.', 'Material added to the tier.'], revalidate: here }
  })
}
export async function recalcTiersAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const n = await recalcTiersNow(ctx, str(fd, 'market'))
    return { message: [`Niveles recalculados: ${n} partners.`, `Tiers recalculated: ${n} partners.`], revalidate: here }
  })
}
export async function crossMatchAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const n = await runCrossMatch(ctx, str(fd, 'market'))
    return { message: [`Cruce listo: ${n} coincidencias.`, `Cross-match done: ${n} matches.`], revalidate: here }
  })
}

// ------------------------------------------------------------ DAT-06
const nets = (id?: string) => ['/partners/redes', ...(id ? [`/partners/redes/${id}`] : [])]
export async function stageNetworkAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const file = fd.get('file')
    if (!(file instanceof File) || file.size === 0) throw invalid('Elige un archivo CSV.', 'Pick a CSV file.')
    if (file.size > 2_000_000) throw invalid('El archivo pasa de 2 MB: pártelo en varias cargas.', 'The file is over 2 MB: split it into several loads.')
    const mapping = Object.fromEntries(NETWORK_TARGETS.map((t) => [t, str(fd, `map_${t}`)]))
    const r = await stageNetwork(ctx, { market: str(fd, 'market'), entityId: str(fd, 'entity_id'), name: str(fd, 'name'), system: str(fd, 'system') as 'other', rootAccountId: str(fd, 'root_account_id'), mapping, text: await file.text() })
    return { data: r.id, message: [`Cargada en su espacio aparte: ${r.rows} filas. Todavía no toca la cartera.`, `Loaded into its separate space: ${r.rows} rows. It does not touch the portfolio yet.`], revalidate: nets() }
  })
}
export async function releaseNetworkAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const s = await releaseNetwork(ctx, str(fd, 'id'), str(fd, 'kind') === 'legal' ? 'legal' : 'business')
    return { message: s === 'released' ? ['Liberada por legal y negocio. Ya se comparó contra toda la cartera: revisa los repetidos antes de promover.', 'Released by legal and business. It was compared against the whole portfolio: review the duplicates before promoting.'] : ['Liberación guardada. Falta la otra.', 'Release saved. The other one is still missing.'], revalidate: nets(str(fd, 'id')) }
  })
}
export async function promoteBatchAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const r = await promoteBatch(ctx, str(fd, 'id'), Math.min(1000, Math.max(1, Number(str(fd, 'size')) || 200)))
    return { message: [`Lote ${r.batch}: ${r.created} comercios a la cartera. Quedan ${r.left}.`, `Batch ${r.batch}: ${r.created} merchants into the portfolio. ${r.left} left.`], revalidate: nets(str(fd, 'id')) }
  })
}
export async function rollbackBatchAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const r = await rollbackBatch(ctx, str(fd, 'id'), Number(str(fd, 'batch')))
    return { message: [`Lote regresado: ${r.archived} archivados${r.kept ? `, ${r.kept} se quedan porque ya se trabajaron` : ''}.`, `Batch rolled back: ${r.archived} archived${r.kept ? `, ${r.kept} stay because they were already worked` : ''}.`], revalidate: nets(str(fd, 'id')) }
  })
}

// ------------------------------------------------------------ campo2
const all = (fd: FormData): Record<string, string> => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]))
export async function partnerClaimAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await partnerRegisterClaim(ctx, all(fd))
    if (out.status === 'customer') return { message: ['Esa tienda ya es cliente: no se registra.', 'That store is already a customer: it is not registered.'], revalidate: ['/partners'] }
    if (out.status === 'held') return { message: out.until ? [`Esa tienda ya tiene registro vigente de otro canal hasta el ${day(out.until, ctx.locale)}.`, `That store is already registered by another channel until ${day(out.until, ctx.locale)}.`] : ['Esa tienda ya tiene registro vigente de otro canal.', 'That store is already registered by another channel.'], revalidate: ['/partners'] }
    return { message: [`Registrada a tu nombre hasta el ${day(out.until, ctx.locale)}.`, `Registered to you until ${day(out.until, ctx.locale)}.`], revalidate: ['/partners'] }
  })
}
export async function estimateStatementsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const n = await estimateStatements(ctx, str(fd, 'market'))
    return { message: [`${n} estados calculados.`, `${n} statements calculated.`], revalidate: ['/partners'] }
  })
}
export async function publishStatementAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await publishStatement(ctx, str(fd, 'id'), str(fd, 'rules'))
    return { message: ['Publicado. Ya no cambia.', 'Published. It no longer changes.'], revalidate: ['/partners'] }
  })
}
export async function enablementProgressAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await recordEnablementProgress(ctx, all(fd))
    return { message: ['Avance anotado.', 'Progress recorded.'], revalidate: ['/partners'] }
  })
}
