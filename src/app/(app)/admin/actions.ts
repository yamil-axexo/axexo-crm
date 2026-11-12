'use server'

import { randomUUID } from 'node:crypto'
import { runAction, str } from '@/server/action'
import { systemCtx } from '@/server/context'
import { env } from '@/env'
import { createApiClient, createTeam, endMembership, grantAccess, recordSimulation, revokeApiClient, setMembershipExpiry, setRoutingMembers, updateStage } from '@/domain/admin'
import { ingestMetricsFile, ingestSalesAppEvent } from '@/domain/integrations'
import { forbidden, invalid, type ActionResult } from '@/lib/errors'
import { isoDay } from '@/lib/format'
import { qs } from '@/lib/labels'
import { aliasMarket } from '@/dal/admin'
import { configurePipeline } from '@/domain/custom'
import { cancelImport, importStep, purgeRaw, resumeImport, startImport, type Mode, type StepResult } from '@/domain/pipedrive/import'

type R = ActionResult<unknown>

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** "12 comercios, 3 negocios abiertos y 2 leads abiertos", en los dos idiomas. Vacío si la persona no tiene nada a su nombre. */
function ownedText(o: { accounts: number; deals: number; leads: number }): [es: string, en: string] {
  const es = [o.accounts ? plural(o.accounts, 'comercio', 'comercios') : '', o.deals ? plural(o.deals, 'negocio abierto', 'negocios abiertos') : '', o.leads ? plural(o.leads, 'lead abierto', 'leads abiertos') : ''].filter(Boolean)
  const en = [o.accounts ? plural(o.accounts, 'merchant', 'merchants') : '', o.deals ? plural(o.deals, 'open deal', 'open deals') : '', o.leads ? plural(o.leads, 'open lead', 'open leads') : ''].filter(Boolean)
  const join = (list: string[], and: string) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} ${and} ${list[list.length - 1]}` : (list[0] ?? ''))
  return [join(es, 'y'), join(en, 'and')]
}
const dayText = (iso: string, locale: 'es' | 'en') => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))

export async function grantMembershipAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await grantAccess(
      ctx,
      { email: str(fd, 'email'), fullName: str(fd, 'full_name'), role: str(fd, 'role') as 'rep', market: str(fd, 'market'), teamId: str(fd, 'team_id'), expires: str(fd, 'expires'), confirmAdmin: fd.get('confirm_admin') === 'on' },
      env().AUTH_ALLOWED_DOMAINS,
    )
    const es = ['Acceso otorgado.']
    const en = ['Access granted.']
    if (out.expires) {
      es.push(`Vence el ${dayText(out.expires, 'es')}: ese día deja de valer solo.`)
      en.push(`It expires on ${dayText(out.expires, 'en')}: it stops working on its own that day.`)
    }
    if (out.supervisorWithoutTeam) {
      es.push('Esta supervisión quedó sin equipo: no va a ver los registros de nadie más hasta que le asignes uno.')
      en.push('This supervisor has no team: they will not see anyone else’s records until you assign one.')
    }
    return { message: [es.join(' '), en.join(' ')] }
  })
}

export async function createTeamAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await createTeam(ctx, { market: str(fd, 'market'), name: str(fd, 'name'), motor: str(fd, 'motor') as 'd2d' })
    return { message: ['Equipo creado.', 'Team created.'] }
  })
}

export async function endMembershipAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const out = await endMembership(ctx, str(fd, 'id'))
    const es = [`Acceso cerrado: ${out.name} ya no tiene ese rol.`]
    const en = [`Access removed: ${out.name} no longer has that role.`]
    if (out.removedFrom.length) {
      es.push(`Salió ${out.removedFrom.length === 1 ? 'del turno' : 'de los turnos'}: ${out.removedFrom.join(', ')}.`)
      en.push(`Removed from ${out.removedFrom.length === 1 ? 'the rotation' : 'the rotations'}: ${out.removedFrom.join(', ')}.`)
    }
    if (out.fallbackOf.length) {
      es.push(`Era el respaldo de ${out.fallbackOf.join(', ')}: ahora ${out.fallbackOf.length === 1 ? 'ese turno no tiene' : 'esos turnos no tienen'} respaldo.`)
      en.push(`They were the fallback of ${out.fallbackOf.join(', ')}: ${out.fallbackOf.length === 1 ? 'that rotation has' : 'those rotations have'} no fallback now.`)
    }
    const [ownedEs, ownedEn] = ownedText(out)
    if (out.vacant && out.market) {
      // Lo que tenía a su nombre quedó sin dueño vigente: se dice con la misma cuenta que muestra Mi equipo y el aviso
      // lleva directo a repartirlo (los comercios, con sus negocios; si solo hay leads o negocios, a "Reasignar cartera").
      es.push(`Lo que tiene a su nombre (${ownedEs}) quedó por repartir en ${out.market}: nadie lo atiende hasta que lo repartas.`)
      en.push(`What they hold (${ownedEn}) now has no current owner in ${out.market} and needs to be distributed.`)
      const href = out.accounts > 0 ? qs('/comercios', { owner: out.userId, market: out.market, repartir: '1' }) : qs('/supervisor', { market: out.market })
      return { message: [es.join(' '), en.join(' ')], data: { link: { href, label: ctx.t('Repartir', 'Distribute') } } }
    }
    if (ownedEs) {
      es.push(`Sigue teniendo a su nombre ${ownedEs}.`)
      en.push(`They still have ${ownedEn} in their name.`)
    }
    return { message: [es.join(' '), en.join(' ')] }
  })
}

export async function setMembershipExpiryAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const expires = str(fd, 'expires') || null
    await setMembershipExpiry(ctx, str(fd, 'id'), expires)
    return {
      message: expires
        ? [`Listo: el acceso vence el ${dayText(expires, 'es')}.`, `Done: the access expires on ${dayText(expires, 'en')}.`]
        : ['Listo: el acceso ya no tiene fecha de vencimiento.', 'Done: the access no longer has an expiry date.'],
    }
  })
}

export async function updateStageAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await updateStage(ctx, str(fd, 'stage_id'), {
      nameEs: str(fd, 'name_es'),
      nameEn: str(fd, 'name_en'),
      rotDays: Number(str(fd, 'rot_days') || '0'),
      requiredFields: fd.getAll('required').filter((v): v is 'amount' => typeof v === 'string'),
    })
    return { message: ['Etapa actualizada. El cambio quedó en la bitácora.', 'Stage updated. The change is in the audit log.'] }
  })
}

export async function setRoutingMembersAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setRoutingMembers(ctx, str(fd, 'rule_id'), fd.getAll('member_id').filter((v): v is string => typeof v === 'string'))
    return { message: ['Turno actualizado.', 'Rotation updated.'] }
  })
}

export async function createApiClientAction(_: R | null, fd: FormData): Promise<R> {
  return runAction<string>(async (ctx) => {
    const out = await createApiClient(ctx, str(fd, 'name'), fd.getAll('scope').filter((v): v is string => typeof v === 'string'))
    return { data: out.key }
  })
}

export async function revokeApiClientAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await revokeApiClient(ctx, str(fd, 'id'))
    return { message: ['Llave revocada.', 'Key revoked.'] }
  })
}

// Las tres acciones de abajo mandan a la integración el mismo mensaje que mandaría el sistema real,
// por el mismo camino de código (contrato v1). Sirven para probar staging sin la Sales App ni S5 conectados.
function guard(ctx: { can: (c: 'integration.operate') => boolean }) {
  if (!ctx.can('integration.operate')) throw forbidden()
  if (env().APP_ENV === 'production') throw invalid('Las pruebas de integración no existen en producción.', 'Integration tests do not exist in production.')
}

export async function simulateVisitAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    guard(ctx)
    const outcome = str(fd, 'outcome')
    const now = new Date()
    const eventId = randomUUID()
    const out = await ingestSalesAppEvent(await systemCtx(), {
      event_id: eventId,
      type: 'visit.checked_out',
      version: 1,
      occurred_at: now.toISOString(),
      data: {
        visit_id: `SCV-${randomUUID().slice(0, 12)}`,
        customer_id: str(fd, 'customer_id'),
        salesperson_id: 'SC-U-staging',
        business_date: now.toISOString().slice(0, 10),
        checked_in_at: new Date(now.getTime() - 12 * 60000).toISOString(),
        checked_out_at: now.toISOString(),
        duration_seconds: 720,
        sale: outcome === 'sale',
        rejection_reason: outcome === 'revisit' ? 'owner_absent' : outcome === 'no_sale' ? 'has_stock' : null,
        revisit: outcome === 'revisit',
        revisit_reason: outcome === 'revisit' ? 'owner_absent' : null,
        decision_maker_present: outcome !== 'revisit',
        auto_closed: false,
      },
    })
    await recordSimulation(ctx, 'visit', eventId, null)
    if (out.status === 'unmatched') return { message: ['El evento llegó, pero ese ID de la Sales App no existe aquí. Quedó en Pendientes del equipo, en Mi equipo.', 'The event arrived, but that Sales App ID does not exist here. It went to Team alerts, in My team.'] }
    return { message: ['Evento recibido y procesado. Mira el hilo del comercio y su negocio.', 'Event received and processed. Check the merchant’s thread and its deal.'] }
  })
}

export async function simulateStoreAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    guard(ctx)
    const market = str(fd, 'market')
    const customerId = `SC-${market}-${Math.floor(100000 + Math.random() * 899999)}`
    const eventId = randomUUID()
    const out = await ingestSalesAppEvent(await systemCtx(), {
      event_id: eventId,
      type: 'store.created',
      version: 1,
      occurred_at: new Date().toISOString(),
      data: { customer_id: customerId, market, name: str(fd, 'name'), phone: str(fd, 'phone') || null, locality: str(fd, 'locality') || null },
    })
    if (out.status !== 'processed') throw invalid('No se pudo procesar el evento.', 'The event could not be processed.')
    await recordSimulation(ctx, 'store', eventId, ctx.markets.some((m) => m.code === market) ? market : null)
    return { message: [`Tienda recibida como ${customerId}. CONTIGO le dio su ID y dejó el aviso para la Sales App.`, `Store received as ${customerId}. CONTIGO gave it an ID and left the notice for the Sales App.`] }
  })
}

export async function simulateMetricsAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    guard(ctx)
    const now = new Date()
    // El archivo lleva la fecha de corte del mercado del comercio, no la del servidor (que ya va en el día siguiente por la tarde).
    const where = await aliasMarket(ctx, str(fd, 'merchant_ref'))
    const market = ctx.markets.find((m) => m.code === where?.market_code)
    const asOf = isoDay(now, market?.timezone ?? 'UTC')
    const fileName = `merchant_metrics_daily_${asOf.replaceAll('-', '')}_${now.getTime()}.json`
    const out = await ingestMetricsFile(await systemCtx(), {
      as_of: asOf,
      file_name: fileName,
      mode: 'delta',
      rows: [
        { merchant_ref: str(fd, 'merchant_ref'), first_txn_at: now.toISOString(), last_txn_at: now.toISOString(), txn_count_30d: 1, volume_minor_30d: 5000, currency: where?.currency ?? (str(fd, 'currency') || 'USD'), active_days_30d: 1 },
      ],
    })
    await recordSimulation(ctx, 'metrics', fileName, market?.code ?? null)
    if (out.matched === 0) throw invalid('Ese ID no corresponde a ningún comercio.', 'That ID does not match any merchant.')
    return { message: [`Archivo cargado: ${out.matched} comercio, ${out.dealsWon} negocio ganado por primera transacción.`, `File loaded: ${out.matched} merchant, ${out.dealsWon} deal won by first transaction.`] }
  })
}

export async function configurePipelineAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await configurePipeline(ctx, str(fd, 'pipeline_id'), { closeByTransaction: fd.get('close_by_transaction') === 'on', awaitingStageId: str(fd, 'awaiting_stage_id') || null, confirmed: fd.get('confirm') === 'on' })
    return { message: ['Embudo actualizado.', 'Pipeline updated.'] }
  })
}

// ---------------------------------------------------------------- migración desde Pipedrive
export async function startImportAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const mode = str(fd, 'mode')
    if (mode !== 'full' && mode !== 'delta' && mode !== 'remap') throw invalid('Modo no válido.', 'Invalid mode.')
    await startImport(ctx, mode as Mode)
    return { message: ['Importación iniciada. Deja esta pestaña abierta: avanza sola.', 'Import started. Keep this tab open: it moves forward on its own.'] }
  })
}

export async function resumeImportAction(_: R | null, _fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await resumeImport(ctx)
    return { message: ['Importación reanudada.', 'Import resumed.'] }
  })
}

export async function cancelImportAction(_: R | null, _fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await cancelImport(ctx)
    return { message: ['Importación detenida. Lo ya cargado se queda.', 'Import stopped. What was already loaded stays.'] }
  })
}

export async function purgeRawAction(_: R | null, _fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const n = await purgeRaw(ctx)
    return { message: [`Copia cruda vaciada: ${n} filas.`, `Raw copy emptied: ${n} rows.`] }
  })
}

/** La pantalla llama a este paso una y otra vez mientras la corrida esté activa. Cada llamada trabaja unos segundos. */
export async function importStepAction(): Promise<StepResult> {
  const res = await runAction<StepResult>(async (ctx) => ({ data: await importStep(ctx), revalidate: [] }))
  return res.ok && res.data ? res.data : { status: 'failed' }
}
