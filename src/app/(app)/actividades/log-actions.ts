'use server'

import { runAction, str } from '@/server/action'
import { notifyOptions } from '@/dal/ops'
import { requireCtx } from '@/server/context'
import { recordActivity } from '@/domain/activities'
import { reassignAccounts } from '@/domain/accounts'
import { takeAccount } from '@/domain/reparto'
import { resolveException } from '@/domain/rules'
import { findAccounts, noSaleReasons, visitorNames, type FoundAccount } from '@/dal/field'
import { withUser } from '@/server/db'
import { weekday } from '@/lib/format'
import { isUuid } from '@/lib/ids'
import { invalid, notFound, type ActionResult } from '@/lib/errors'

type Done = { toast: string }

/**
 * Registrar una visita, una llamada o una nota sobre un comercio (dock, ficha, detalle del negocio y al volver de una
 * llamada). Una visita o una llamada piden el próximo paso, igual que completar una tarea.
 */
export async function logActivityAction(_: ActionResult<Done> | null, fd: FormData): Promise<ActionResult<Done>> {
  return runAction<Done>(async (ctx) => {
    const kind = str(fd, 'kind')
    if (kind !== 'visit' && kind !== 'call' && kind !== 'note') throw invalid('Elige qué registras.', 'Choose what you are logging.')
    if (!str(fd, 'account_id')) throw invalid('Elige el comercio para poder guardar.', 'Choose the merchant to save.')
    if (kind !== 'note' && !str(fd, 'result')) throw invalid('Elige cómo te fue para poder guardar.', 'Choose how it went to save.')
    const out = await recordActivity(ctx, {
      accountId: str(fd, 'account_id'),
      dealId: str(fd, 'deal_id') || undefined,
      kind,
      subject: kind === 'note' ? str(fd, 'subject') : '',
      body: kind === 'note' ? '' : str(fd, 'note'),
      outcome: kind === 'note' ? '' : str(fd, 'result'),
      on: kind === 'visit' ? str(fd, 'on') : '',
      visitedBy: kind === 'visit' ? str(fd, 'visited_by') : '',
      noSaleReason: kind === 'visit' ? str(fd, 'no_sale_reason') : '',
      next: kind === 'note' ? '' : str(fd, 'next'),
      nextWhen: str(fd, 'when'),
      nextText: str(fd, 'next_text'),
      askNext: true,
      notify: kind === 'note' ? str(fd, 'notify') : '',
    })
    const saved = kind === 'visit' ? ctx.t(`Visita guardada en ${out.name}.`, `Visit saved on ${out.name}.`) : kind === 'call' ? ctx.t(`Llamada guardada en ${out.name}.`, `Call saved on ${out.name}.`) : ctx.t(`Nota guardada en ${out.name}.`, `Note saved on ${out.name}.`)
    const next = out.next ? ` ${ctx.t(`Próximo paso: ${out.next}, ${weekday(out.due, 'es')}.`, `Next step: ${out.next}, ${weekday(out.due, 'en')}.`)}` : ''
    return { data: { toast: saved + next } }
  })
}

/** Buscar el comercio dentro de la hoja. Es una lectura: no refresca la pantalla. */
export async function findAccountsAction(q: string): Promise<FoundAccount[]> {
  const ctx = await requireCtx()
  return findAccounts(ctx, typeof q === 'string' ? q : '')
}

/** Nombres de quienes visitan ya usados en el mercado (o en los mercados de la persona, si no se dice cuál). */
export async function visitorNamesAction(market?: string): Promise<string[]> {
  const ctx = await requireCtx()
  const markets = typeof market === 'string' && market ? [market] : ctx.markets.map((m) => m.code)
  const lists = await Promise.all(markets.map((code) => visitorNames(ctx, code)))
  return [...new Set(lists.flat())].slice(0, 40)
}

/**
 * Reasignar un comercio desde su ficha, después de confirmar. Dice qué pasó con nombre y apellido:
 * a quién pasó y qué se fue con él.
 */
export async function reassignOneAction(_: ActionResult<Done> | null, fd: FormData): Promise<ActionResult<Done>> {
  return runAction<Done>(async (ctx) => {
    const id = str(fd, 'account_id')
    const to = str(fd, 'to_user_id')
    if (!isUuid(id)) throw notFound()
    if (!isUuid(to)) throw invalid('Elige a quién se lo pasas.', 'Choose who gets it.')
    const before = await withUser(ctx.user.id, (tx) => tx<{ name: string; owner_id: string | null; deals: number; tasks: number }[]>`
      select a.name, a.owner_id,
             (select count(*)::int from crm.deals d where d.account_id = a.id and d.status = 'open') as deals,
             (select count(*)::int from crm.activities x where x.account_id = a.id and x.done_at is null and x.kind in ('task', 'visit')) as tasks
        from crm.accounts a where a.id = ${id}`)
    const a = before[0]
    if (!a) throw notFound()
    if (a.owner_id === to) throw invalid('Ese comercio ya es de esa persona.', 'That merchant already belongs to that person.')
    await reassignAccounts(ctx, [id], to)
    const who = await withUser(ctx.user.id, (tx) => tx<{ full_name: string }[]>`select full_name from crm.users where id = ${to}`)
    const name = who[0]?.full_name ?? ''
    const es = [a.deals ? (a.deals === 1 ? '1 negocio abierto' : `${a.deals} negocios abiertos`) : null, a.tasks ? (a.tasks === 1 ? '1 pendiente' : `${a.tasks} pendientes`) : null].filter(Boolean).join(' y ')
    const en = [a.deals ? (a.deals === 1 ? '1 open deal' : `${a.deals} open deals`) : null, a.tasks ? (a.tasks === 1 ? '1 open task' : `${a.tasks} open tasks`) : null].filter(Boolean).join(' and ')
    return { data: { toast: ctx.t(`${a.name} ahora es de ${name}${es ? `, con ${es}` : ''}.`, `${a.name} now belongs to ${name}${en ? `, with ${en}` : ''}.`) } }
  })
}

/** Descartar un pendiente del equipo, después de confirmar. El motivo queda con el aviso y en la bitácora. */
export async function dismissExceptionAction(_: ActionResult<Done> | null, fd: FormData): Promise<ActionResult<Done>> {
  return runAction<Done>(async (ctx) => {
    await resolveException(ctx, str(fd, 'id'), str(fd, 'note'))
    return { data: { toast: ctx.t('Pendiente descartado. Si sigue sin corregirse, vuelve a aparecer en 7 días.', 'Item dismissed. If it is still not fixed, it comes back in 7 days.') } }
  })
}

/** A quién se le puede avisar desde una nota de este comercio (o negocio): personas que ven el registro. */
export async function notifyOptionsAction(accountId: string, dealId: string | null): Promise<{ id: string; full_name: string }[]> {
  const ctx = await requireCtx()
  if (!ctx.can('activity.write')) return []
  return notifyOptions(ctx, { accountId, dealId })
}

/** Motivos de una visita sin venta (catálogo de motivos de calle) del mercado, o de los mercados de la persona. */
export async function noSaleReasonsAction(market?: string): Promise<{ value: string; label: string }[]> {
  const ctx = await requireCtx()
  const markets = typeof market === 'string' && market ? [market] : ctx.markets.map((m) => m.code)
  const rows = await noSaleReasons(ctx, markets)
  return rows.map((r) => ({ value: r.code, label: ctx.t(r.label_es, r.label_en) }))
}

/** "Tomar esta tienda": un comercio sin asignar queda a nombre de quien lo toma (ver `takeAccount`). */
export async function takeAccountAction(_: ActionResult<Done> | null, fd: FormData): Promise<ActionResult<Done>> {
  return runAction<Done>(async (ctx) => {
    const id = str(fd, 'account_id')
    if (!isUuid(id)) throw notFound()
    const name = await takeAccount(ctx, id)
    return { data: { toast: ctx.t(`${name} ahora es tuya.`, `${name} is now yours.`) } }
  })
}
