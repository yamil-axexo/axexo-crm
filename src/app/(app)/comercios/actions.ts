'use server'

import { redirect } from 'next/navigation'
import { runAction, str } from '@/server/action'
import { addContact, createAccount, mergeAccounts, reassignAccounts, setParent, updateAccount } from '@/domain/accounts'
import { invalid } from '@/lib/errors'
import { updateCustom, type CustomInput } from '@/domain/custom'

import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function createAccountAction(_: R | null, fd: FormData): Promise<R> {
  let id = ''
  const res = await runAction(async (ctx) => {
    const out = await createAccount(ctx, {
      market: str(fd, 'market'),
      accountType: str(fd, 'kind'),
      name: str(fd, 'name'),
      segment: str(fd, 'segment') as 'd2d',
      parentId: str(fd, 'parent_id'),
      phone: str(fd, 'phone'),
      locality: str(fd, 'locality'),
      region: str(fd, 'region'),
      territoryId: str(fd, 'territory_id'),
      force: fd.get('force') === 'on',
    })
    if (out.duplicates) {
      const names = out.duplicates.map((d) => `${d.name}${d.owner_name ? ` (${d.owner_name})` : ''}`).join('; ')
      throw new (await import('@/lib/errors')).DomainError(
        'duplicate',
        `Parece que ya existe: ${names}. Si es otro comercio, marca "Crear de todos modos".`,
        `It looks like this already exists: ${names}. If it is a different merchant, tick "Create anyway".`,
      )
    }
    id = out.id!
    // Lo mínimo para calificar que se pidió en el alta (campos marcados "pedir al dar de alta"): se guarda como campos de la cuenta.
    const intake: CustomInput = {}
    for (const [k, v] of fd.entries()) if (k.startsWith('f_') && typeof v === 'string' && v.trim()) intake[k.slice(2)] = v
    if (Object.keys(intake).length > 0) await updateCustom(ctx, 'account', id, intake)
  })
  if (res.ok && id) redirect(`/comercios/${id}`)
  return res
}

export async function updateAccountAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateAccount(ctx, str(fd, 'id'), {
      name: str(fd, 'name'),
      phone: str(fd, 'phone'),
      email: str(fd, 'email'),
      addressLine: str(fd, 'address_line'),
      locality: str(fd, 'locality'),
      region: str(fd, 'region'),
      postalCode: str(fd, 'postal_code'),
    })
    return { message: ['Comercio actualizado.', 'Merchant updated.'] }
  })
}

export async function addContactAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await addContact(ctx, str(fd, 'account_id'), { fullName: str(fd, 'full_name'), phone: str(fd, 'phone'), email: str(fd, 'email'), role: str(fd, 'role') as 'staff',
      locale: str(fd, 'locale') as 'es', sms: fd.get('sms') === 'on', primary: fd.get('primary') === 'on' })
    return { message: ['Contacto agregado.', 'Contact added.'] }
  })
}

export async function setParentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setParent(ctx, str(fd, 'id'), str(fd, 'parent_id') || null)
    return { message: ['Jerarquía actualizada.', 'Hierarchy updated.'] }
  })
}

/** Reasignar desde la ficha o con una selección de la lista. El reparto por filtro y por lotes vive en reparto-actions.ts. */
export async function reassignAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const ids = fd.getAll('account_id').filter((v): v is string => typeof v === 'string' && v.length > 0)
    if (ids.length === 0) throw invalid('Elige al menos un comercio.', 'Choose at least one merchant.')
    const n = await reassignAccounts(ctx, ids, str(fd, 'to_user_id'))
    if (n === 1) return { message: ['1 comercio reasignado, con sus negocios y tareas abiertas.', '1 merchant reassigned, with its open deals and tasks.'] }
    return { message: [`${n} comercios reasignados, con sus negocios y tareas abiertas.`, `${n} merchants reassigned, with their open deals and tasks.`] }
  })
}

export async function mergeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await mergeAccounts(ctx, str(fd, 'source_id'), str(fd, 'target_id'))
    return { message: ['Fusionados. El duplicado quedó archivado, no borrado.', 'Merged. The duplicate was archived, not deleted.'] }
  })
}
