'use server'

import { runAction, str } from '@/server/action'
import { addAlias, closeAlias, createAliasSystem, dismissPair, endContact, endDealContact, mergeAccounts, setDealContact, reviewBypass, scanDuplicates, undoMerge, updateContact, SURVIVOR_FIELDS, type Side, type SurvivorField } from '@/domain/datos'
import { createMarket, createProcessList, createRoutingRule, createWebForm, decideField, proposeField, setAccountProduct, setProcessListActive, setProcessStatus, setProductProvider,
  saveQualitySnapshot, setProviderSla, setQualityRule, setRoutingRuleActive, setTypeDepth, setWebFormActive, updateField, updateMarket, type GovernanceInput } from '@/domain/gobierno'
import { setParent } from '@/domain/accounts'
import { dismissContactPair, mergeContacts, undoContactMerge } from '@/domain/contacts-dedup'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
const all = (fd: FormData, key: string) => fd.getAll(key).filter((v): v is string => typeof v === 'string' && v.length > 0)
const intOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

// ---------------------------------------------------------------- duplicados y fusión

export async function scanDuplicatesAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const open = await scanDuplicates(ctx, str(fd, 'market'))
    return { message: open === 0 ? ['Búsqueda terminada: no hay pares por decidir.', 'Search finished: there are no pairs to decide.'] : [`Búsqueda terminada: ${open === 1 ? 'hay 1 par' : `hay ${open} pares`} por decidir.`, `Search finished: ${open === 1 ? '1 pair' : `${open} pairs`} to decide.`] }
  })
}

export async function mergePairAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    // "keep" dice cuál de los dos se queda; cada campo puede traer el valor del otro.
    const keep = str(fd, 'keep')
    const a = str(fd, 'a_id')
    const b = str(fd, 'b_id')
    const target = keep === b ? b : a
    const source = target === a ? b : a
    const picks: Partial<Record<SurvivorField, Side>> = {}
    for (const f of SURVIVOR_FIELDS) {
      const from = str(fd, `pick_${f}`)
      if (from) picks[f] = from === target ? 'target' : 'source'
    }
    await mergeAccounts(ctx, source, target, { picks })
    return { message: ['Fusionados. El otro registro quedó archivado y la fusión se puede deshacer desde esta pantalla.', 'Merged. The other record is archived and the merge can be undone from this screen.'], revalidate: ['layout'] }
  })
}

export async function undoMergeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await undoMerge(ctx, str(fd, 'event_id'), str(fd, 'reason'))
    return { message: ['Fusión deshecha: los dos comercios vuelven a existir por separado.', 'Merge undone: the two merchants exist separately again.'] }
  })
}

export async function dismissPairAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await dismissPair(ctx, str(fd, 'pair_id'), str(fd, 'note'))
    return { message: ['Listo: no son el mismo comercio. El par no vuelve a aparecer.', 'Done: they are not the same merchant. The pair will not show up again.'] }
  })
}

export async function reviewBypassAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await reviewBypass(ctx, str(fd, 'bypass_id'), str(fd, 'note'))
    return { message: ['Aviso revisado.', 'Warning reviewed.'] }
  })
}

// ---------------------------------------------------------------- ficha: árbol, contactos, alias, productos, procesos

export async function moveInTreeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await setParent(ctx, str(fd, 'id'), str(fd, 'parent_id') || null, { reason: str(fd, 'reason'), effectiveOn: str(fd, 'effective_on') })
    return { message: out.ownerDiffers
      ? ['Jerarquía actualizada. La cuenta conserva a quien la lleva, que no es quien lleva la matriz: revisa si hay que reasignarla.', 'Hierarchy updated. The account keeps its owner, who is not the parent’s owner: check whether it needs reassigning.']
      : ['Jerarquía actualizada.', 'Hierarchy updated.'] }
  })
}

export async function updateContactAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateContact(ctx, str(fd, 'account_id'), str(fd, 'contact_id'), { fullName: str(fd, 'full_name'), phone: str(fd, 'phone'), email: str(fd, 'email'), role: str(fd, 'role'),
      locale: str(fd, 'locale') as 'es', sms: fd.get('sms') === 'on' })
    return { message: ['Contacto actualizado.', 'Contact updated.'] }
  })
}

export async function endContactAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await endContact(ctx, str(fd, 'account_id'), str(fd, 'contact_id'), str(fd, 'reason'))
    return { message: ['Contacto dado de baja en esta cuenta. Queda en su historia.', 'Contact removed from this account. It stays in its history.'] }
  })
}

export async function addAliasAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addAlias(ctx, str(fd, 'account_id'), { system: str(fd, 'system'), externalId: str(fd, 'external_id'), note: str(fd, 'note') })
    return { message: ['ID agregado. Ya se puede buscar el comercio por él.', 'ID added. The merchant can now be found by it.'] }
  })
}

export async function closeAliasAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await closeAlias(ctx, str(fd, 'alias_id'), str(fd, 'reason'))
    return { message: ['ID cerrado. Queda en la historia del comercio.', 'ID closed. It stays in the merchant’s history.'] }
  })
}

export async function setAccountProductAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setAccountProduct(ctx, str(fd, 'account_id'), { productId: str(fd, 'product_id'), providerId: str(fd, 'provider_id'), status: str(fd, 'status'), note: str(fd, 'note') })
    return { message: ['Producto actualizado.', 'Product updated.'] }
  })
}

export async function setProcessStatusAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const attrs: Record<string, string> = {}
    for (const [k, v] of fd.entries()) if (k.startsWith('attr_') && typeof v === 'string') attrs[k.slice(5)] = v
    await setProcessStatus(ctx, str(fd, 'account_id'), str(fd, 'list_id'), str(fd, 'status'), attrs)
    return { message: ['Proceso actualizado.', 'Process updated.'] }
  })
}

// ---------------------------------------------------------------- campos

const governanceOf = (fd: FormData): GovernanceInput => ({
  ownerId: str(fd, 'owner_id'), purpose: str(fd, 'purpose'), decision: str(fd, 'decision'), reviewOn: str(fd, 'review_on'), piiClass: (str(fd, 'pii_class') || 'none') as 'none',
  dataClass: (str(fd, 'data_class') || 'internal') as 'internal', untrusted: fd.get('untrusted') === 'on', origin: str(fd, 'origin'), usedBy: str(fd, 'used_by'),
})

export async function updateFieldAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const options = fd.has('options') ? lines(str(fd, 'options')) : undefined
    await updateField(ctx, str(fd, 'id'), { labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en'), options, ...governanceOf(fd) })
    return { message: ['Campo actualizado.', 'Field updated.'] }
  })
}

export async function proposeFieldAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await proposeField(ctx, { object: str(fd, 'object') as 'account', market: str(fd, 'market'), motor: str(fd, 'motor') as 'b2b', labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en'),
      dataType: str(fd, 'data_type') as 'text', options: lines(str(fd, 'options')), ...governanceOf(fd) })
    return { message: ['Propuesta enviada. Administración la aprueba o la rechaza; hasta entonces el campo no aparece en las fichas.', 'Proposal sent. Administration approves or rejects it; until then the field does not show on records.'] }
  })
}

export async function decideFieldAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const approve = str(fd, 'approve') === 'true'
    await decideField(ctx, str(fd, 'id'), approve, str(fd, 'note'))
    return { message: approve ? ['Campo aprobado. Ya aparece en las fichas de su mercado.', 'Field approved. It now shows on records in its market.'] : ['Propuesta rechazada, con su motivo.', 'Proposal rejected, with its reason.'] }
  })
}

// ---------------------------------------------------------------- catálogos

export async function createMarketAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createMarket(ctx, { code: str(fd, 'code'), name: str(fd, 'name'), currency: str(fd, 'currency'), locale: str(fd, 'locale') as 'es', timezone: str(fd, 'timezone'), phoneCc: str(fd, 'phone_cc') })
    return { message: ['Mercado agregado, en preparación. Créale su embudo y su equipo, y después ábrelo.', 'Market added, being set up. Create its pipeline and its team, then open it.'], revalidate: ['layout'] }
  })
}

export async function updateMarketAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateMarket(ctx, str(fd, 'code'), { name: str(fd, 'name'), status: str(fd, 'status') as 'live' })
    return { message: ['Mercado actualizado.', 'Market updated.'], revalidate: ['layout'] }
  })
}

export async function createWebFormAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createWebForm(ctx, { market: str(fd, 'market'), name: str(fd, 'name'), slug: str(fd, 'slug'), motor: str(fd, 'motor') as 'd2d', locale: str(fd, 'locale') as 'es', routingRuleId: str(fd, 'routing_rule_id') })
    return { message: ['Formulario creado. Qué pregunta cada formulario se ajusta en Administración, Formularios y turnos.', 'Form created. What each form asks is set under Administration, Forms and rotation.'] }
  })
}

export async function toggleWebFormAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const active = str(fd, 'active') === 'true'
    await setWebFormActive(ctx, str(fd, 'id'), active)
    return { message: active ? ['Formulario activo.', 'Form is on.'] : ['Formulario en pausa: ya no recibe solicitudes.', 'Form paused: it no longer takes requests.'] }
  })
}

export async function createRoutingRuleAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createRoutingRule(ctx, { market: str(fd, 'market'), name: str(fd, 'name'), strategy: str(fd, 'strategy') as 'fixed', memberIds: all(fd, 'member_id'), fallbackId: str(fd, 'fallback_id'), slaMinutes: Number(str(fd, 'sla_minutes') || '60') })
    return { message: ['Turno creado.', 'Rotation created.'] }
  })
}

export async function toggleRoutingRuleAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const active = str(fd, 'active') === 'true'
    await setRoutingRuleActive(ctx, str(fd, 'id'), active)
    return { message: active ? ['Turno activo.', 'Rotation is on.'] : ['Turno en pausa.', 'Rotation paused.'] }
  })
}

export async function createAliasSystemAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createAliasSystem(ctx, { labelEs: str(fd, 'label_es'), labelEn: str(fd, 'label_en'), kind: str(fd, 'kind') as 'carrier', market: str(fd, 'market') })
    return { message: ['Sistema agregado. Ya se puede elegir al ligar un ID en la ficha.', 'System added. It can now be picked when linking an ID on a record.'] }
  })
}

export async function setTypeDepthAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setTypeDepth(ctx, str(fd, 'id'), intOrNull(str(fd, 'max_depth')))
    return { message: ['Niveles actualizados.', 'Levels updated.'] }
  })
}

export async function createProcessListAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createProcessList(ctx, { market: str(fd, 'market'), nameEs: str(fd, 'name_es'), nameEn: str(fd, 'name_en'), statuses: lines(str(fd, 'statuses')), attributes: lines(str(fd, 'attributes')) })
    return { message: ['Lista creada. Ya aparece en la ficha de los comercios de ese mercado.', 'List created. It now shows on merchant records in that market.'] }
  })
}

export async function toggleProcessListAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const active = str(fd, 'active') === 'true'
    await setProcessListActive(ctx, str(fd, 'id'), active)
    return { message: active ? ['Lista activa otra vez.', 'List active again.'] : ['Lista retirada. Lo capturado no se borra.', 'List retired. What was captured is not erased.'] }
  })
}

// ---------------------------------------------------------------- calidad y productos

export async function setQualityRuleAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setQualityRule(ctx, str(fd, 'code'), { ownerRole: str(fd, 'owner_role'), ownerId: str(fd, 'owner_id'), threshold: intOrNull(str(fd, 'threshold')), active: fd.get('active') === 'on' })
    return { message: ['Regla actualizada.', 'Rule updated.'] }
  })
}

export async function setProviderSlaAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setProviderSla(ctx, str(fd, 'id'), intOrNull(str(fd, 'sla_days')))
    return { message: ['Plazo del proveedor actualizado.', 'Provider deadline updated.'] }
  })
}

export async function setProductProviderAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setProductProvider(ctx, str(fd, 'id'), str(fd, 'provider_id') || null)
    return { message: ['Proveedor del producto actualizado.', 'Product provider updated.'] }
  })
}

export async function saveQualitySnapshotAction(_: R | null, _fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await saveQualitySnapshot(ctx)
    return { message: ['Corte de hoy guardado. La tendencia se compara contra el corte más antiguo de los últimos 30 días.', 'Today’s snapshot saved. The trend compares against the oldest snapshot of the last 30 days.'] }
  })
}

// ---------------------------------------------------------------- personas de un negocio

export async function setDealContactAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setDealContact(ctx, str(fd, 'deal_id'), str(fd, 'contact_id'), str(fd, 'role'))
    return { message: ['Rol en el negocio guardado.', 'Role on the deal saved.'] }
  })
}

export async function endDealContactAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await endDealContact(ctx, str(fd, 'deal_id'), str(fd, 'contact_id'))
    return { message: ['Ya no participa en este negocio. Sigue siendo contacto de la cuenta.', 'No longer on this deal. Still a contact of the account.'] }
  })
}

// ---------------------------------------------------------------- DAT-02 contactos duplicados (paquete datos2)

export async function mergeContactsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const a = str(fd, 'a_id')
    const b = str(fd, 'b_id')
    const keep = str(fd, 'keep') === b ? b : a
    await mergeContacts(ctx, keep === a ? b : a, keep)
    return { message: ['Contactos fusionados. Se puede deshacer desde esta pantalla.', 'Contacts merged. It can be undone from this screen.'] }
  })
}

export async function dismissContactPairAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await dismissContactPair(ctx, str(fd, 'pair_id'), str(fd, 'note'))
    return { message: ['Listo: no son la misma persona. El teléfono en espera sigue guardado en su contacto.', 'Done: they are different people. The held phone stays saved on its contact.'] }
  })
}

export async function undoContactMergeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await undoContactMerge(ctx, str(fd, 'event_id'), str(fd, 'reason'))
    return { message: ['Fusión deshecha: los dos contactos vuelven a existir por separado.', 'Merge undone: the two contacts exist separately again.'] }
  })
}
