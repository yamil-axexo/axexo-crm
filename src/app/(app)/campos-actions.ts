'use server'

import { runAction, str } from '@/server/action'
import { updateCustom, type CustomInput } from '@/domain/custom'
import type { ActionResult } from '@/lib/errors'

type R = ActionResult<unknown>

function parse(fd: FormData): CustomInput {
  const out: CustomInput = {}
  const keys = new Set([...fd.keys()].filter((k) => k.startsWith('f_')).map((k) => k.slice(2)))
  for (const key of keys) {
    const values = fd.getAll(`f_${key}`).filter((v): v is string => typeof v === 'string')
    if (fd.has(`c_${key}`)) out[key] = { amount: values[0] ?? '', currency: str(fd, `c_${key}`) }
    else if (values.length > 1) out[key] = values.filter(Boolean)
    else out[key] = values[0] ?? ''
  }
  return out
}

const done = (n: number): [string, string] => (n === 0 ? ['No había cambios que guardar.', 'There were no changes to save.'] : [`Guardado: ${n} campo${n === 1 ? '' : 's'}.`, `Saved: ${n} field${n === 1 ? '' : 's'}.`])

export async function saveAccountCustomAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => ({ message: done(await updateCustom(ctx, 'account', str(fd, 'id'), parse(fd))) }))
}

export async function saveDealCustomAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => ({ message: done(await updateCustom(ctx, 'deal', str(fd, 'id'), parse(fd))) }))
}

/** DAT-05 (datos2): campos adicionales de un contacto. */
export async function saveContactCustomAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => ({ message: done(await updateCustom(ctx, 'contact', str(fd, 'id'), parse(fd))) }))
}
