'use server'

import { runAction, str } from '@/server/action'
import { captureTaxId, clearLocation, endContact, openWhatsappWindow, reviewTaxId, setAccountProfile, setLocation, updateAddress, updateContact } from '@/domain/markets'
import { accountsNear, type NearAccount } from '@/dal/markets'
import { distanceText } from '@/lib/markets'
import { invalid, type ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function setAccountProfileAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setAccountProfile(ctx, str(fd, 'id'), { entityId: str(fd, 'entity_id'), businessUnit: str(fd, 'business_unit'), timezone: str(fd, 'timezone') })
    return { message: ['Entidad, unidad de negocio y zona horaria guardadas.', 'Entity, business unit and time zone saved.'] }
  })
}

export async function updateAddressAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateAddress(ctx, str(fd, 'id'), {
      country: str(fd, 'country'), address_line: str(fd, 'address_line'), address_line2: str(fd, 'address_line2'), sublocality: str(fd, 'sublocality'),
      locality: str(fd, 'locality'), region: str(fd, 'region'), postal_code: str(fd, 'postal_code'),
    })
    return { message: ['Dirección guardada.', 'Address saved.'] }
  })
}

export async function setLocationAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const { near } = await setLocation(ctx, str(fd, 'id'), { latitude: str(fd, 'latitude'), longitude: str(fd, 'longitude'), source: str(fd, 'source') || 'manual', accuracy: str(fd, 'accuracy') })
    const first = near[0]
    return {
      message: first
        ? [`Ubicación guardada. Ojo: ${first.name} está a ${distanceText(first.distance_m, 'es')}. Revisa abajo si es el mismo comercio.`, `Location saved. Heads up: ${first.name} is ${distanceText(first.distance_m, 'en')} away. Check below whether it is the same merchant.`]
        : ['Ubicación guardada.', 'Location saved.'],
    }
  })
}

export async function clearLocationAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await clearLocation(ctx, str(fd, 'id'))
    return { message: ['Ubicación quitada.', 'Location removed.'] }
  })
}

export async function captureTaxIdAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const type = str(fd, 'type')
    const out = await captureTaxId(ctx, str(fd, 'id'), {
      type: type as 'mx_rfc', value: str(fd, 'value'), legalName: str(fd, 'legal_name'), taxRegime: str(fd, 'tax_regime'), postalCode: str(fd, 'tax_postal_code'),
    })
    const dup = out.duplicates[0]
    if (dup) return { message: [`Guardado, y pasa a revisión: ese identificador ya está en ${dup.name}. Solo se guardaron los últimos 4 (${out.last4}).`, `Saved, and sent to review: that identifier is already on ${dup.name}. Only the last 4 were stored (${out.last4}).`] }
    return {
      message: out.status === 'needs_review'
        ? [`Guardado, y pasa a revisión de una persona. Solo se guardaron los últimos 4 (${out.last4}).`, `Saved, and sent to a person for review. Only the last 4 were stored (${out.last4}).`]
        : [`Formato válido. Solo se guardaron los últimos 4 (${out.last4}); falta que alguien lo revise contra el documento.`, `Valid format. Only the last 4 were stored (${out.last4}); someone still has to check it against the document.`],
    }
  })
}

export async function reviewTaxIdAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const decision = str(fd, 'decision')
    if (decision !== 'approve' && decision !== 'reject') throw invalid('Elige aprobar o rechazar.', 'Pick approve or reject.')
    await reviewTaxId(ctx, str(fd, 'id'), { decision, note: str(fd, 'note') })
    return { message: decision === 'approve' ? ['Identificador fiscal aprobado.', 'Tax ID approved.'] : ['Identificador fiscal rechazado.', 'Tax ID rejected.'] }
  })
}

export async function openWhatsappWindowAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const kind = str(fd, 'kind') === 'ad_72h' ? 'ad_72h' : 'service_24h'
    await openWhatsappWindow(ctx, str(fd, 'id'), kind)
    return { message: kind === 'ad_72h' ? ['Anotado: tienes 72 horas para responderle sin plantilla.', 'Noted: you have 72 hours to reply without a template.'] : ['Anotado: tienes 24 horas para responderle sin plantilla.', 'Noted: you have 24 hours to reply without a template.'] }
  })
}

export async function updateContactAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateContact(ctx, str(fd, 'account_id'), str(fd, 'contact_id'), {
      fullName: str(fd, 'full_name'), phone: str(fd, 'phone'), email: str(fd, 'email'), role: str(fd, 'role') as 'owner', locale: str(fd, 'locale') as 'es',
    })
    return { message: ['Contacto actualizado.', 'Contact updated.'] }
  })
}

type Done = { toast: string }
export async function endContactAction(_: ActionResult<Done> | null, fd: FormData): Promise<ActionResult<Done>> {
  return runAction<Done>(async (ctx) => {
    await endContact(ctx, str(fd, 'account_id'), str(fd, 'contact_id'))
    return { data: { toast: ctx.t('Contacto dado de baja. Queda en la historia del comercio.', 'Contact removed. It stays in the merchant’s history.') } }
  })
}

/** "Cerca de mí": recibe la ubicación del teléfono, no la guarda, y devuelve los comercios del alcance de la persona por distancia. */
export async function nearMeAction(lat: number, lon: number, radiusM: number): Promise<ActionResult<NearAccount[]>> {
  return runAction<NearAccount[]>(async (ctx) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw invalid('No pudimos leer tu ubicación. Intenta otra vez.', 'We could not read your location. Try again.')
    const radius = [500, 2000, 10000].includes(radiusM) ? radiusM : 2000
    return { data: await accountsNear(ctx, lat, lon, radius), revalidate: [] }
  })
}
