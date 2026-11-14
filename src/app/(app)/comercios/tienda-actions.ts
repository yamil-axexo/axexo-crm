'use server'

import { runAction, str } from '@/server/action'
import { createAgency, setAgencyActive, setCarrierDetail, setMerchantOrigin, setProviderRefLabel, setRecruiter, setStoreProfile, setTaxId } from '@/domain/store-record'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function setStoreProfileAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const has = (k: string) => fd.has(k)
    await setStoreProfile(ctx, str(fd, 'account_id'), {
      siteRef: has('site_ref') ? str(fd, 'site_ref') : undefined,
      businessType: has('business_type') ? str(fd, 'business_type') : undefined,
      retiredCarriers: has('retired_carriers') ? str(fd, 'retired_carriers') : undefined,
    })
    return { message: ['Datos de la tienda guardados.', 'Store details saved.'] }
  })
}

export async function setMerchantOriginAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setMerchantOrigin(ctx, str(fd, 'account_id'), str(fd, 'merchant_origin'))
    return { message: ['Origen fijado. Ya no se cambia.', 'Origin set. It does not change from here on.'] }
  })
}

export async function setRecruiterAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setRecruiter(ctx, str(fd, 'account_id'), str(fd, 'recruited_by'))
    return { message: ['Quedó anotado quién reclutó la tienda. Ya no se cambia.', 'Who recruited the store is on record. It does not change from here on.'] }
  })
}

export async function setTaxIdAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await setTaxId(ctx, str(fd, 'account_id'), str(fd, 'tax_id'))
    if (!out.last4) return { message: ['Tax ID borrado.', 'Tax ID removed.'] }
    return out.full
      ? { message: [`Guardamos solo los últimos 4 (${out.last4}). El número completo no se guarda en CONTIGO.`, `We kept only the last 4 (${out.last4}). The full number is not stored in CONTIGO.`] }
      : { message: ['Últimos 4 del Tax ID guardados.', 'Last 4 of the Tax ID saved.'] }
  })
}

export async function setCarrierDetailAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setCarrierDetail(ctx, str(fd, 'account_id'), { providerId: str(fd, 'provider_id'), status: str(fd, 'status'), carrierRef: str(fd, 'carrier_ref'),
      kitSentOn: str(fd, 'kit_sent_on'), simsOrdered: str(fd, 'sims_ordered'), trainingOn: str(fd, 'training_on'), note: str(fd, 'note') })
    return { message: ['Carrier actualizado.', 'Carrier updated.'] }
  })
}

export async function createAgencyAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createAgency(ctx, { market: str(fd, 'market'), kind: str(fd, 'kind'), name: str(fd, 'name'), pipelineId: str(fd, 'pipeline_id'), territoryId: str(fd, 'territory_id') })
    return { message: ['Agregado. Ya se puede elegir en "Reclutado por".', 'Added. It can now be picked under "Recruited by".'] }
  })
}

export async function toggleAgencyAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const active = str(fd, 'active') === '1'
    await setAgencyActive(ctx, str(fd, 'id'), active)
    return { message: active ? ['Reactivado.', 'Restored.'] : ['Dado de baja. Las tiendas que reclutó lo conservan.', 'Retired. The stores it recruited keep it.'] }
  })
}

export async function setProviderRefLabelAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setProviderRefLabel(ctx, str(fd, 'provider_id'), str(fd, 'ref_label'))
    return { message: ['Nombre del identificador guardado.', 'ID name saved.'] }
  })
}
