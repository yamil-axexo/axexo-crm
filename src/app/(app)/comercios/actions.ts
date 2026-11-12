'use server'

import { redirect } from 'next/navigation'
import { runAction, str } from '@/server/action'
import { addContact, createAccount, mergeAccounts, reassignAccounts, setParent, updateAccount } from '@/domain/accounts'
import { withUser, type Tx } from '@/server/db'
import { invalid } from '@/lib/errors'
import { isUuid } from '@/lib/ids'

const BOOK_BATCH = 500
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

export async function createAccountAction(_: R | null, fd: FormData): Promise<R> {
  let id = ''
  const res = await runAction(async (ctx) => {
    const out = await createAccount(ctx, {
      market: str(fd, 'market'),
      kind: str(fd, 'kind') as 'store',
      name: str(fd, 'name'),
      segment: str(fd, 'segment') as 'd2d',
      parentId: str(fd, 'parent_id'),
      phone: str(fd, 'phone'),
      locality: str(fd, 'locality'),
      region: str(fd, 'region'),
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
    await addContact(ctx, str(fd, 'account_id'), { fullName: str(fd, 'full_name'), phone: str(fd, 'phone'), email: str(fd, 'email'), role: str(fd, 'role') as 'staff' })
    return { message: ['Contacto agregado.', 'Contact added.'] }
  })
}

export async function setParentAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setParent(ctx, str(fd, 'id'), str(fd, 'parent_id') || null)
    return { message: ['Jerarquía actualizada.', 'Hierarchy updated.'] }
  })
}

export async function reassignAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    let ids = fd.getAll('account_id').filter((v): v is string => typeof v === 'string' && v.length > 0)
    // Cartera completa: "de" trae persona y mercado (id|MX); la región es opcional y tiene que ser del mismo mercado.
    const [from, fromMarket] = str(fd, 'from_user_id').split('|')
    let left = 0
    if (ids.length === 0 && from) {
      const market = fromMarket || str(fd, 'market')
      const [regionMarket, ...rest] = str(fd, 'region').split('|')
      const region = rest.join('|')
      if (region && regionMarket !== market) throw invalid('Esa región es de otro mercado.', 'That region belongs to another market.')
      if (!isUuid(from)) throw invalid('Elige de quién es la cartera.', 'Choose whose book it is.')
      const scope = (tx: Tx) => tx`owner_id = ${from} and market_code = ${market} and archived_at is null ${region ? tx`and region = ${region}` : tx``}`
      const rows = await withUser(ctx.user.id, (tx) => tx<{ id: string }[]>`select id from crm.accounts where ${scope(tx)} order by name_norm, id limit ${BOOK_BATCH}`)
      ids = rows.map((r) => r.id)
      if (ids.length === BOOK_BATCH) {
        const total = await withUser(ctx.user.id, (tx) => tx<{ n: number }[]>`select count(*)::int as n from crm.accounts where ${scope(tx)}`)
        left = (total[0]?.n ?? 0) - ids.length
      }
    }
    if (ids.length === 0) throw invalid('No hay comercios que mover con esa selección.', 'There are no merchants to move with that selection.')
    const n = await reassignAccounts(ctx, ids, str(fd, 'to_user_id'))
    const more = left > 0 ? [` Quedan ${left} con esa selección: repite para seguir.`, ` ${left} remain with that selection: repeat to continue.`] : ['', '']
    return { message: [`${n} comercios reasignados, con sus negocios y tareas abiertas.${more[0]}`, `${n} merchants reassigned, with their open deals and tasks.${more[1]}`] }
  })
}

export async function mergeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await mergeAccounts(ctx, str(fd, 'source_id'), str(fd, 'target_id'))
    return { message: ['Fusionados. El duplicado quedó archivado, no borrado.', 'Merged. The duplicate was archived, not deleted.'] }
  })
}
