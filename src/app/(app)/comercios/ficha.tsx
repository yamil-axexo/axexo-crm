import Link from 'next/link'
import { CalendarPlus, MapPinCheck, MessageCircle, MessageSquareText, Navigation, Phone, StickyNote, X } from 'lucide-react'
import type { Ctx } from '@/server/context'
import { untrustedMark } from '@/dal/untrusted'
import { UntrustedTag } from '@/ui/untrusted'
import { getAccount } from '@/dal/accounts'
import { sellers } from '@/dal/leads'
import { fieldDefs, fieldApplies } from '@/dal/fields'
import { accountTypes, parentChoices } from '@/dal/b2b'
import { setAccountTypeAction, setPrimaryContactAction } from '@/app/(app)/b2b-actions'
import { sheetConfig, taskItem } from '@/server/sheet'
import { CustomFields, FieldSections } from '@/ui/fields'
import { Badge, Field, KeyVal, LinkButton, cx, NoData } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { CompleteButton } from '@/ui/complete'
import { CallLink, LogButton } from '@/ui/log'
import { ConfirmButton } from '@/ui/confirm'
import { ago, day, isoDay, offsetMs, money, monthYear, num, phoneText, threadDate, weekday, zoneNote } from '@/lib/format'
import { HEALTH_DOT, healthOf } from '@/lib/health'
import { ACTIVITY, ATTRIBUTION_LAYER, CONTACT_ROLE, KIND, LIFECYCLE, MOTOR, lab } from '@/lib/labels'
import type { MessageKey } from '@/lib/messages'
import { addContactAction, updateAccountAction } from './actions'
import { moveInTreeAction } from '@/app/(app)/datos/actions'
import { accountIdentity, nodeTotals } from '@/dal/datos'
import { contactRolesFor } from '@/lib/datos-labels'
import { AliasSection, ContactHistory, ContactTools, MergeSection, ProcessSection, ProductsSection, TreeTotals } from './datos-ficha'
import { FichaFacts, FichaMercados } from './ficha-mercados'
import { fichaRole, readerTeam } from '@/lib/markets'
import { rolesIn } from '@/domain/policy'
import { addActivityAction } from '@/app/(app)/actividades/actions'
import { reassignOneAction, takeAccountAction } from '@/app/(app)/actividades/log-actions'
import { AccountOrders, LastOrderLine } from './pedidos'
import { createDealAction } from '@/app/(app)/pipelines/actions'
import { StagePicker } from '@/ui/ops'
import { completeItemAction } from '@/app/(app)/hoy/actions'

export const FICHA_TABS = ['hilo', 'arbol', 'datos'] as const
export type FichaTab = (typeof FICHA_TABS)[number]
export const fichaTab = (v: string | undefined): FichaTab => (FICHA_TABS as readonly string[]).includes(v ?? '') ? (v as FichaTab) : 'hilo'

type Data = NonNullable<Awaited<ReturnType<typeof getAccount>>>

/** Etiqueta de nivel del árbol: organización y distribuidor en negro con texto neón, cadena en menta, punto de venta en verde claro. */
const LEVEL: Record<string, string> = {
  organization: 'bg-black text-neon',
  distributor: 'bg-black text-neon',
  chain: 'bg-mint text-[#0b3d2c]',
  store: 'bg-green-100 text-brand-text',
}

/**
 * Ficha del comercio (handoff, sección 5): encabezado, "Lo siguiente", cuatro acciones y las pestañas Hilo, Árbol y Datos.
 * La misma ficha se usa como panel sobre la lista (desktop), a un lado de la lista (tablet) y a pantalla completa (móvil y enlaces directos).
 */
export async function Ficha({ ctx, data, tab, mode, href, closeHref }: { ctx: Ctx; data: Data; tab: FichaTab; mode: 'panel' | 'page'; href: (id: string, tab?: FichaTab) => string; closeHref: string }) {
  const { t, m, locale } = ctx
  const { account: a, ancestors, rollup, children, contacts, aliases, attributions, deals, metrics, tasks, timeline, pipelines } = data
  const market = ctx.market(a.market_code)
  // IA-07: si el nombre o la dirección llegaron de fuera (Sales App, archivo), se dice junto al nombre.
  const untrusted = await untrustedMark(ctx, 'account', a.id)
  const tz = market.timezone
  const now = new Date()
  const canWrite = !a.archived_at && ctx.can('activity.write', a.market_code)
  const canEdit = !a.archived_at && ctx.can('account.edit', a.market_code)
  const canReassign = !a.archived_at && ctx.can('account.reassign', a.market_code)
  // Un comercio sin asignar: lo toma quien vende en ese mercado si la regla se lo permite (quien dirige, cualquiera de su
  // alcance; quien vende, los de sus territorios). Si no, la ficha dice a quién pedirlo.
  const sellsHere = ctx.memberships.some((x) => x.market === a.market_code && x.role !== 'ops')
  const unowned = !a.archived_at && !a.owner_id && sellsHere && ctx.can('account.take', a.market_code)
  const canTake = unowned && (canReassign || a.in_my_territory)
  const canSell = !a.archived_at && ctx.can('deal.create', a.market_code)
  const isParent = a.kind !== 'store'
  const openDeal = deals.find((d) => d.status === 'open')
  // Con un negocio abierto solo se ofrecen los embudos que admiten varios por comercio (pedidos, recompra).
  // El embudo que se propone es el del tipo de venta de la cuenta (una cuenta B2B o ISO no empieza en el embudo de tiendas); los demás quedan en la lista.
  const offered = pipelines.filter((p) => p.stages.length > 0 && (!openDeal || p.multi_open)).sort((x, y) => Number(y.motor === a.segment) - Number(x.motor === a.segment))
  // En el árbol cada cuenta lleva su tipo real (ISO, Agente de ISO, Distribuidor), no el nivel.
  const typeOf = (x: { kind: string; type_es: string | null; type_en: string | null }) => (x.type_es ? t(x.type_es, x.type_en ?? x.type_es) : lab(t, KIND[x.kind]))
  const lastDeal = deals[0]
  const health = healthOf(a.lifecycle, !!openDeal)
  const today = isoDay(now, tz)
  const parent = ancestors[ancestors.length - 1]
  // El tipo de cuenta ya dice si es independiente: "Independiente" solo acompaña a un tipo que no lo dice.
  const size = isParent ? m('merchants.size.children', { count: rollup.stores }) : parent ? m('merchants.size.under', { name: parent.name }) : a.account_type === 'store' ? null : m('merchants.size.independent')
  // Para llamar: el teléfono del comercio y, si no tiene, el de su contacto (primero quien decide).
  const callee = a.phone
    ? { phone: a.phone, who: null as string | null }
    : (() => {
        const c = contacts.find((x) => x.role === 'decision_maker' && x.phone) ?? contacts.find((x) => x.role === 'owner' && x.phone) ?? contacts.find((x) => x.phone)
        return c?.phone ? { phone: c.phone, who: c.full_name } : null
      })()
  const owner = a.owner_name ?? (ancestors.length ? m('merchants.viaChain') : m('merchants.noOwner'))
  // Dirección a la vista y "Cómo llegar": un enlace a mapas con la dirección escrita (abre la app de mapas del teléfono).
  const place = [a.locality, a.region].filter(Boolean).join(', ')
  const address = [a.address_line, place, a.postal_code].filter(Boolean).join(', ')
  const directions = a.address_line ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${address}, ${a.market_code}`)}` : null
  const logAccount = { id: a.id, name: a.name, market: a.market_code, motor: a.segment }
  // Lo que se va con el comercio al reasignarlo: sus negocios abiertos y sus tareas y visitas por hacer.
  const openDeals = deals.filter((d) => d.status === 'open').length
  const openTasks = tasks.filter((x) => x.kind === 'task' || x.kind === 'visit').length
  const moves = {
    es: [openDeals ? (openDeals === 1 ? '1 negocio abierto' : `${openDeals} negocios abiertos`) : null, openTasks ? (openTasks === 1 ? '1 pendiente' : `${openTasks} pendientes`) : null].filter(Boolean).join(' y '),
    en: [openDeals ? (openDeals === 1 ? '1 open deal' : `${openDeals} open deals`) : null, openTasks ? (openTasks === 1 ? '1 open task' : `${openTasks} open tasks`) : null].filter(Boolean).join(' and '),
  }
  const Title = mode === 'page' ? 'h1' : 'h2'

  // Lo siguiente: la actividad abierta más próxima; si no hay, el próximo paso del negocio abierto.
  const step = tasks[0]
    ? { text: tasks[0].subject, due: tasks[0].due_at }
    : openDeal?.next_step
      ? { text: openDeal.next_step, due: openDeal.next_step_due ? new Date(`${openDeal.next_step_due}T15:00:00Z`) : null }
      : null
  const startOfToday = new Date(new Date(`${today}T00:00:00Z`).getTime() - offsetMs(now, tz))
  const stepLate = !!step?.due && step.due < startOfToday
  // Una tienda activa, sin negocio abierto y sin tarea, está al día: no es una advertencia ni pide una fecha de relleno.
  const calm = !step && !openDeal && a.lifecycle === 'active'
  const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
  const dueLabel = (due: Date | null, late: boolean) => (due ? m(late ? 'record.next.late' : 'record.next.due', { date: weekday(due, locale, tz) }) : '')

  const tile = 'press flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-[12px] border border-line bg-surface text-[13px] font-medium text-green-600 hover:bg-green-50'
  const tileOff = 'flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-line-2 text-[13px] font-medium text-muted'
  const section = 'border-t border-line pt-6'
  const h3 = 'text-[15px] leading-6 font-semibold'

  type Item = (typeof timeline)[number]
  type Meta = { origin?: string | null; outcome?: string | null; visited_by?: string | null; rejection?: string | null; rejection_es?: string | null; rejection_en?: string | null; revisit?: boolean; minutes?: number | null; cause?: string; from?: string | null; won_on?: string | null; type_label?: string | null; purpose_es?: string | null; purpose_en?: string | null }
  const meta = (it: Item) => it.meta as Meta
  // Una visita dice de dónde viene: la que alguien registró en CONTIGO o la que llegó de la Sales App.
  const manualVisit = (it: Item) => it.kind === 'visit' && meta(it).origin === 'manual'
  const outcomeText = (o: string | null | undefined) => (o && o !== 'done' ? m(`complete.result.${o}` as MessageKey) : null)
  const visitText = (it: Item) => {
    const v = meta(it)
    if (manualVisit(it)) return [t('Visita', 'Visit'), v.purpose_es ? t(v.purpose_es, v.purpose_en ?? v.purpose_es) : null, outcomeText(v.outcome), v.rejection ? t(v.rejection_es ?? v.rejection, v.rejection_en ?? v.rejection) : null].filter(Boolean).join(' · ')
    const base = it.title === 'sale' ? t('Visita con venta', 'Visit with a sale') : t('Visita sin venta', 'Visit with no sale')
    const why = v.rejection ? t(v.rejection_es ?? v.rejection, v.rejection_en ?? v.rejection) : null
    return `${base}${why ? ` · ${why}` : ''}${v.revisit ? ` · ${t('pide revisita', 'needs a revisit')}` : ''}${v.minutes ? ` · ${v.minutes} min` : ''}`
  }
  // Cambio de dueño en palabras: a quién pasó, de quién venía y quién lo reasignó (cuando el registro lo guarda).
  const ownerFrom = (it: Item) => (meta(it).from && meta(it).from !== it.title ? meta(it).from! : null)
  const ownerChange = (it: Item) => {
    const from = ownerFrom(it)
    return from ? t(`Pasó a ${it.title}; venía de ${from}`, `Moved to ${it.title}; it came from ${from}`) : t(`Lo lleva ${it.title}`, `Owner: ${it.title}`)
  }
  const threadTitle = (it: Item) =>
    it.kind === 'visit' ? visitText(it) : it.kind === 'stage' ? (meta(it).won_on ? t(`Negocio ganado, con cierre el ${day(meta(it).won_on, locale)}`, `Deal won, with close date ${day(meta(it).won_on, locale)}`) : `${t('Pasó a', 'Moved to')} "${t(it.title, it.body ?? it.title)}"`) : it.kind === 'attribution' ? ownerChange(it) : it.title
  /** Variación contra los 30 días anteriores, en transacciones. Sin base (cero ventas antes) no hay porcentaje que mostrar. */
  const salesDelta = (now: number, before: number) => {
    if (before <= 0) return ''
    const d = Math.round(((now - before) / before) * 100)
    return ` · ${t(`ahora ${d > 0 ? '+' : ''}${d}%`, `now ${d > 0 ? '+' : ''}${d}%`)}`
  }
  const threadWho = (it: Item) =>
    it.kind === 'stage' && meta(it).cause === 'transaction' ? t('Primera transacción', 'First transaction')
      // Una visita que llegó de la hoja del equipo de campo lo dice (paquete mx): no se confunde con una capturada en la pantalla.
      : manualVisit(it) ? [(meta(it) as { source?: string }).source === 'import' ? t('Cargada de la hoja', 'Loaded from the sheet') : t('Registrada en CONTIGO', 'Logged in CONTIGO'), it.actor].filter(Boolean).join(' · ')
        : it.kind === 'visit' ? `Sales App${it.actor ? ` · ${it.actor}` : ''}`
          : it.kind === 'attribution' && it.actor && ownerFrom(it) ? t(`Lo reasignó ${it.actor}`, `Reassigned by ${it.actor}`) : it.actor
  // Cada renglón dice qué fue (nota, llamada, reunión, tarea) y, si se completó con un resultado, cuál.
  const threadKind = (it: Item) =>
    ['note', 'call', 'meeting', 'task', 'email', 'handoff'].includes(it.kind) ? [meta(it).type_label === 'in_person' ? t('En persona', 'In person') : lab(t, ACTIVITY[it.kind]), outcomeText(meta(it).outcome)].filter(Boolean).join(' · ') : null
  const threadDetail = (it: Item) =>
    [manualVisit(it) && meta(it).visited_by ? t(`Visitó: ${meta(it).visited_by}`, `Visited by: ${meta(it).visited_by}`) : null, it.kind !== 'stage' ? it.body : null].filter(Boolean)

  // Armar el árbol: quien dirige mueve cualquier cuenta; quien vende, las suyas (y solo bajo una matriz suya).
  const canTree = !a.archived_at && ctx.can('account.tree', a.market_code) && (canReassign || a.owner_id === ctx.user.id)
  const people = tab === 'datos' && canReassign ? await sellers(ctx, a.market_code) : []
  const parents = tab === 'datos' && canTree ? await parentChoices(ctx, a.market_code, !canReassign) : []
  const types = tab === 'datos' && canEdit ? await accountTypes(ctx, a.market_code) : []
  // Los campos de un tipo de venta (los de B2B) solo salen en cuentas de ese tipo de venta, y los condicionados, cuando aplican.
  const defs = tab === 'datos' ? (await fieldDefs(ctx, 'account', a.market_code, a.segment)).filter((d) => fieldApplies(d, a.custom)) : []
  const typeName = a.type_es ? t(a.type_es, a.type_en ?? a.type_es) : lab(t, KIND[a.kind])
  // Paquete datos: identidad del comercio (movimientos en el árbol, contactos, ID de otros sistemas, productos, procesos, fusiones)
  // y lo que suma el nodo con todo lo que cuelga de él.
  const identity = tab === 'datos' || tab === 'arbol' ? await accountIdentity(ctx, a.id, a.market_code) : null
  const totals = tab === 'arbol' && isParent ? await nodeTotals(ctx, a.id) : null
  const canAlias = !a.archived_at && ctx.can('alias.manage', a.market_code)
  const canProducts = !a.archived_at && ctx.can('account.products', a.market_code)
  const contactRoles = contactRolesFor(a.segment, Object.keys(CONTACT_ROLE))
  const config = tab === 'hilo' && canWrite && tasks.length ? sheetConfig(ctx, now) : null

  return (
    <article data-testid="ficha" data-mode={mode} aria-labelledby="ficha-title" className="flex flex-col gap-5">
      <div data-testid="account-facts">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow" data-testid="ficha-type">{[typeName, size, ctx.markets.length > 1 ? market.name : null].filter(Boolean).join(' · ')}</p>
            <Title id="ficha-title" className="mt-0.5 text-[22px] leading-[30px] font-semibold break-words">{a.name}</Title>
            {untrusted && <UntrustedTag t={t} origin={untrusted.origin} />}
          </div>
          <Link href={closeHref} aria-label={m('record.close')} title={m('record.close')} className="press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface text-strong hover:bg-green-50" data-testid="ficha-close">
            <X size={20} strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-strong">
          <span className="inline-flex items-center gap-2" data-testid="health" data-health={health}>
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: HEALTH_DOT[health] }} />
            {m(`health.${health}` as MessageKey)}
          </span>
          <span aria-hidden className="text-muted">·</span>
          <span className={!a.owner_name && !ancestors.length ? 'text-amber-text' : undefined}>{m('record.owner', { name: owner })}</span>
          {canReassign && tab !== 'datos' && (
            <Link href={href(a.id, 'datos')} scroll={false} className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="ficha-reassign">
              {a.owner_id ? t('Reasignar', 'Reassign') : t('Asignar', 'Assign')}
            </Link>
          )}
          {canTake && (
            <ConfirmButton action={takeAccountAction} fields={{ account_id: a.id }} label={t('Tomar esta tienda', 'Take this store')}
              title={t('¿Tomar esta tienda?', 'Take this store?')}
              body={t(`${a.name} queda a tu nombre${moves.es ? `, con ${moves.es}` : ''}.`, `${a.name} becomes yours${moves.en ? `, with ${moves.en}` : ''}.`)}
              confirm={t('Sí, tomarla', 'Yes, take it')} cancel={m('action.cancel')} testId="ficha-take" />
          )}
          {unowned && !canTake && (
            <span className="text-[14px] text-muted-2" data-testid="ficha-ask">{t('Para llevarla, pídesela a tu supervisión o a quien lidera tu mercado.', 'To take it on, ask your supervisor or your market lead.')}</span>
          )}
          {a.archived_at && <Badge tone="bad">{m('record.archived')}</Badge>}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[14px] text-muted-2" data-testid="ficha-address">
          {address ? <span className="[overflow-wrap:anywhere]">{address}</span> : <span className="text-muted">{t('Sin dirección', 'No address')}</span>}
          {directions ? (
            <a href={directions} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-blue-text underline" data-testid="ficha-directions">
              <Navigation size={16} strokeWidth={1.75} aria-hidden />
              {t('Cómo llegar', 'Directions')}
            </a>
          ) : canEdit && tab !== 'datos' ? (
            <Link href={href(a.id, 'datos')} scroll={false} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="ficha-add-address">
              {t('Agregar dirección', 'Add address')}
            </Link>
          ) : null}
        </p>

        {(parent || children.length > 0) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-4 text-[14px] text-muted-2" data-testid="ficha-hierarchy">
            {parent && (
              <span>{t('Pertenece a', 'Belongs to')}{' '}<Link href={href(parent.id, 'arbol')} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="ficha-parent">{parent.name}</Link></span>
            )}
            {children.length > 0 && (
              <Link href={href(a.id, 'arbol')} scroll={false} className="inline-flex min-h-11 items-center font-medium text-blue-text underline" data-testid="ficha-children">
                {t(`Sus cuentas (${num(rollup.stores > children.length ? rollup.stores : children.length, locale)})`, `Its accounts (${num(rollup.stores > children.length ? rollup.stores : children.length, locale)})`)}
              </Link>
            )}
          </p>
        )}

        <div className={cx('mt-4 rounded-[12px] px-4 py-3.5', step ? 'bg-green-100' : calm ? 'bg-surface-2' : 'bg-warn-bg')} data-testid="ficha-next" data-state={step ? (stepLate ? 'late' : 'set') : calm ? 'calm' : 'none'}>
          <p className={cx('text-[13px]', step ? 'text-brand-text' : calm ? 'text-muted-2' : 'text-amber-text')}>{m('record.next')}</p>
          <p className="mt-0.5 text-[15px] leading-6 font-medium text-strong">{step ? step.text : calm ? m('record.next.calm') : m('record.next.none')}</p>
          <p className={cx('text-[13px]', stepLate ? 'font-medium text-red-text' : 'text-muted-2')}>
            {step ? dueLabel(step.due, stepLate) : calm ? (metrics?.last_txn_at ? m('record.next.calmSale', { when: ago(metrics.last_txn_at, locale, now) }) : m('record.next.calmHint')) : m('record.next.noneHint')}
            {(openDeal || lastDeal) && (
              <>
                {step?.due ? ' · ' : step ? '' : ' '}
                <Link href={`/deals/${(openDeal ?? lastDeal)!.id}`} className="font-medium text-blue-text underline" data-testid="deal-link">
                  {openDeal ? m('record.next.deal', { stage: t(openDeal.stage_es, openDeal.stage_en) }) : m('record.next.dealClosed', { status: lastDeal!.status === 'won' ? t('ganado', 'won') : t('perdido', 'lost') })}
                </Link>
              </>
            )}
          </p>
        </div>
        {/* UX-01: los datos de arriba dependen del rol de quien abre la ficha (crm.ficha_layouts). */}
        <FichaFacts ctx={ctx} id={a.id} treeHref={href(a.id, 'arbol')} />
        <LastOrderLine ctx={ctx} accountId={a.id} timezone={market.timezone} hasOrderPipeline={pipelines.some((p) => p.has_items)} />
      </div>

      {/* Arriba, contactar (llamar, WhatsApp, mensaje de texto); abajo, dejar registro (visita, nota, actividad). */}
      <div className="grid grid-cols-3 gap-2" data-testid="ficha-actions">
        {callee && canWrite ? (
          <CallLink href={`tel:${callee.phone}`} account={logAccount} className={tile} title={callee.who ?? undefined} testId="action-call"><Phone size={20} strokeWidth={1.75} aria-hidden />{m('action.call')}</CallLink>
        ) : callee ? (
          <a href={`tel:${callee.phone}`} className={tile} title={callee.who ?? undefined} data-testid="action-call"><Phone size={20} strokeWidth={1.75} aria-hidden />{m('action.call')}</a>
        ) : (
          <span className={tileOff} title={m('action.noPhone')}><Phone size={20} strokeWidth={1.75} aria-hidden />{m('action.noPhone')}</span>
        )}
        {callee ? (
          <a href={`https://wa.me/${callee.phone.slice(1)}`} target="_blank" rel="noopener noreferrer" className={tile} title={callee.who ?? undefined} data-testid="action-whatsapp"><MessageCircle size={20} strokeWidth={1.75} aria-hidden />{m('action.whatsapp')}</a>
        ) : (
          <span className={tileOff} aria-hidden><MessageCircle size={20} strokeWidth={1.75} aria-hidden />{m('action.whatsapp')}</span>
        )}
        {callee ? (
          <a href={`sms:${callee.phone}`} className={tile} title={callee.who ?? undefined} aria-label={t('Mensaje de texto', 'Text message')} data-testid="action-sms"><MessageSquareText size={20} strokeWidth={1.75} aria-hidden />{t('Mensaje', 'Text')}</a>
        ) : (
          <span className={tileOff} aria-hidden><MessageSquareText size={20} strokeWidth={1.75} aria-hidden />{t('Mensaje', 'Text')}</span>
        )}
        {canWrite ? (
          <>
            <LogButton target={{ kind: 'visit', account: logAccount }} className={tile} testId="action-visit"><MapPinCheck size={20} strokeWidth={1.75} aria-hidden />{t('Visita', 'Visit')}</LogButton>
            <Dialog trigger={<><StickyNote size={20} strokeWidth={1.75} aria-hidden />{m('record.note')}</>} title={m('record.note')} triggerClass={tile} testId="action-note">
              <ActionForm action={addActivityAction} onOk="close" className="space-y-4">
                <input type="hidden" name="account_id" value={a.id} />
                <input type="hidden" name="kind" value="note" />
                <Field label={t('¿Qué pasó?', 'What happened?')}><input name="subject" className="input" required minLength={2} data-testid="note-subject" /></Field>
                <Field label={t('Detalle (opcional)', 'Details (optional)')}><textarea name="body" rows={3} className="input !h-auto py-3" /></Field>
                <div className="flex justify-end"><Submit testId="note-add">{t('Guardar nota', 'Save note')}</Submit></div>
              </ActionForm>
            </Dialog>
            <Dialog trigger={<><CalendarPlus size={20} strokeWidth={1.75} aria-hidden />{m('record.activity')}</>} title={m('record.activity')} triggerClass={tile} testId="action-activity">
              <ActionForm action={addActivityAction} onOk="close" className="space-y-4" testId="activity-form">
                <input type="hidden" name="account_id" value={a.id} />
                <Field label={t('Tipo', 'Type')}>
                  <select name="kind" className="input" defaultValue="task" data-testid="activity-kind">
                    <option value="task">{t('Tarea con fecha', 'Task with a date')}</option><option value="visit">{t('Visita por hacer (con fecha)', 'Planned visit (with a date)')}</option><option value="call">{lab(t, ACTIVITY.call)}</option><option value="meeting">{lab(t, ACTIVITY.meeting)}</option>
                  </select>
                </Field>
                <Field label={t('¿Qué pasó o qué sigue?', 'What happened or what is next?')}><input name="subject" className="input" required minLength={2} data-testid="activity-subject" /></Field>
                <Field label={t('Fecha (para tareas y visitas por hacer)', 'Date (for tasks and planned visits)')}><input name="due_at" type="date" className="input" min={today} data-testid="activity-due" /></Field>
                <div className="flex justify-end"><Submit testId="activity-add">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
            </Dialog>
          </>
        ) : null}
      </div>

      {callee?.who && <p className="-mt-2 text-[13px] text-muted" data-testid="callee">{m('record.callee', { name: callee.who })}</p>}

      {canSell && offered.length > 0 && (
        <Dialog trigger={openDeal ? t('Nuevo pedido', 'New order') : t('Nuevo negocio', 'New deal')} title={t('Nuevo negocio', 'New deal')} variant="ghost" testId="new-deal">
          <ActionForm action={createDealAction} className="grid grid-cols-2 gap-4">
            <input type="hidden" name="account_id" value={a.id} />
            <StagePicker pipelines={offered.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: t(s.name_es, s.name_en) })) }))}
              labels={{ pipeline: t('Embudo', 'Pipeline'), stage: t('Etapa en la que empieza', 'Stage it starts in'), hint: t('Si ya va avanzado, elige su etapa: se pide lo mismo que para llegar ahí.', 'If it is already under way, pick its stage: it asks for the same as getting there.') }} />
            <Field label={t('Título', 'Title')} className="col-span-2"><input name="title" className="input" required defaultValue={`${openDeal ? t('Pedido', 'Order') : t('Alta', 'Onboarding')}: ${a.name}`} data-testid="new-deal-title" /></Field>
            <Field label={t('Próximo paso', 'Next step')} className="col-span-2"><input name="next_step" className="input" required minLength={2} data-testid="new-deal-step" /></Field>
            <Field label={t('Fecha', 'Date')}><input name="next_step_due" type="date" className="input" required defaultValue={today} /></Field>
            <Field label={t(`Monto (${market.currency}), opcional`, `Amount (${market.currency}), optional`)} hint={t('En un pedido, el monto sale de sus líneas.', 'On an order, the amount comes from its lines.')}><input name="amount" className="input" inputMode="decimal" /></Field>
            <div className="col-span-2 flex justify-end"><Submit testId="save-deal">{t('Crear negocio', 'Create deal')}</Submit></div>
          </ActionForm>
        </Dialog>
      )}

      <nav aria-label={m('record.tabs')} className="flex gap-6 border-b border-line" data-testid="ficha-tabs">
        {FICHA_TABS.map((k) => (
          <Link key={k} href={href(a.id, k)} scroll={false} aria-current={tab === k ? 'page' : undefined} data-testid={`tab-${k}`}
            className={cx('-mb-px border-b-2 pb-2.5 text-[15px]', tab === k ? 'border-green-600 font-semibold text-strong' : 'border-transparent font-medium text-muted hover:text-strong')}>
            {m(k === 'hilo' ? 'record.tab.thread' : k === 'arbol' ? 'record.tab.tree' : 'record.tab.data')}
          </Link>
        ))}
      </nav>

      {tab === 'hilo' && (
        <div data-testid="account-timeline">
          {tasks.length + timeline.length === 0 ? (
            <p className="text-[15px] text-muted">{m('record.thread.empty')}</p>
          ) : (
            <>
              {tasks.length > 0 && (
                <ol className="thread" data-testid="account-tasks">
                  {tasks.map((task) => {
                    const late = !!task.due_at && task.due_at < startOfToday
                    return (
                      <li key={task.id} className="thread-item thread-open !pb-5" data-testid="thread-next">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={cx('text-[13px] font-medium', late ? 'text-red-text' : 'text-green-600')}>
                              {m('record.thread.next')}{task.due_at ? ` · ${lowerFirst(dueLabel(task.due_at, late))}` : ''}
                            </p>
                            <p className="text-[15px] leading-6 font-medium text-strong">{task.subject}</p>
                            {task.owner_name && task.owner_name !== ctx.user.name && <p className="text-[13px] text-muted">{task.owner_name}</p>}
                          </div>
                          {config && <CompleteButton item={taskItem(ctx, task, a.name, task.motor ?? a.segment)} config={config} action={completeItemAction} />}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
              {timeline.length > 0 && <p className="mb-3 text-[13px] text-muted" data-testid="thread-zone">{zoneNote(market, locale)}</p>}
              <ol className="thread">
              {timeline.map((it, i) => (
                <li key={i} className="thread-item" data-testid={`tl-${it.kind}`} data-origin={it.kind === 'visit' ? (manualVisit(it) ? 'manual' : 'sales_app') : undefined}>
                  <p className="text-[13px] text-muted">{[threadDate(it.at, locale, tz, now), threadWho(it), threadKind(it)].filter(Boolean).join(' · ')}</p>
                  <p className="text-[15px] leading-6 font-medium text-strong [overflow-wrap:anywhere]">{threadTitle(it)}</p>
                  {threadDetail(it).map((line, n) => <p key={n} className="text-[13px] leading-5 text-muted-2 [overflow-wrap:anywhere]">{line}</p>)}
                </li>
              ))}
              </ol>
            </>
          )}
        </div>
      )}

      {tab === 'arbol' && (
        <div data-testid="account-children">
          {isParent && (
            <div className="mb-5 rounded-[12px] bg-surface-3 px-4 py-3" data-testid="rollup-stores">
              <p className="text-[15px] font-medium text-strong" data-testid="tree-network">{rollup.stores > 0 || rollup.accounts === 0 ? m('record.tree.network', { stores: rollup.stores }) : t(`${rollup.accounts} ${rollup.accounts === 1 ? 'cuenta' : 'cuentas'} en su red, todavía sin puntos de venta`, `${rollup.accounts} ${rollup.accounts === 1 ? 'account' : 'accounts'} in its network, no stores yet`)}</p>
              <p className="text-[13px] text-muted-2">
                {t(`${rollup.active} activos · ${rollup.onboarding} en alta · ${rollup.at_risk} en riesgo`, `${rollup.active} active · ${rollup.onboarding} onboarding · ${rollup.at_risk} at risk`)}
                {` · ${t(`${num(rollup.txn_30d, locale)} ventas en 30 días`, `${num(rollup.txn_30d, locale)} sales in 30 days`)}`}
                {rollup.volume_30d ? ` · ${money(Number(rollup.volume_30d), rollup.currency ?? market.currency, locale, true)}` : ''}
              </p>
            </div>
          )}
          {identity && (totals || identity.moves.length > 0) && <TreeTotals ctx={ctx} totals={totals} moves={identity.moves} tz={tz} />}
          {ancestors.length + children.length === 0 ? (
            <p className="text-[15px] text-muted">{m('record.tree.alone')}</p>
          ) : (
            <ul className="space-y-1">
              <li>
                <nav aria-label={t('Jerarquía', 'Hierarchy')} data-testid="breadcrumb">
                  <ul className="space-y-1">
                    {ancestors.map((p, i) => (
                      <li key={p.id} style={{ paddingLeft: i * 24 }}>
                        <Link href={href(p.id, 'arbol')} className="row-hover flex items-center gap-3 rounded-[10px] px-2 py-2">
                          <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-medium', LEVEL[p.kind] ?? LEVEL.store)} data-testid="tree-type">{typeOf(p)}</span>
                          <span className="min-w-0 text-[15px] font-medium text-strong [overflow-wrap:anywhere]">{p.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              </li>
              <li style={{ paddingLeft: ancestors.length * 24 }} aria-current="true">
                <div className="flex items-center gap-3 rounded-[10px] bg-green-50 px-2 py-2">
                  <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-medium', LEVEL[a.kind] ?? LEVEL.store)} data-testid="tree-type">{typeOf(a)}</span>
                  <span className="min-w-0 text-[15px] font-semibold text-strong [overflow-wrap:anywhere]">{a.name}</span>
                  <span className="ml-auto shrink-0 text-[13px] text-muted">{m('record.tree.here')}</span>
                </div>
              </li>
              {children.map((c) => (
                <li key={c.id} style={{ paddingLeft: (ancestors.length + 1) * 24 }}>
                  <Link href={href(c.id, 'arbol')} className="row-hover flex items-center gap-3 rounded-[10px] px-2 py-2" data-testid="child-row">
                    <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-medium', LEVEL[c.kind] ?? LEVEL.store)} data-testid="tree-type">{typeOf(c)}</span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-strong [overflow-wrap:anywhere]">{c.name}</span>
                      <span className="flex items-center gap-1.5 text-[13px] text-muted">
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: HEALTH_DOT[healthOf(c.lifecycle, c.has_deal)] }} />
                        {m(`health.${healthOf(c.lifecycle, c.has_deal)}` as MessageKey)}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 text-[13px] text-muted">{m('record.tree.since', { date: monthYear(c.since, locale, tz) })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'datos' && (
        <div className="space-y-6" data-testid="account-data">
          {/* Reasignar va arriba de Datos: quien supervisa llega aquí desde el encabezado de la ficha, sin recorrer la pantalla. */}
          {canReassign && (
            <section data-testid="account-reassign">
              <form data-testid="reassign-form">
                <input type="hidden" name="account_id" value={a.id} />
                <Field label={t('Reasignar a otra persona', 'Reassign to someone else')}>
                  <select name="to_user_id" className="input" required defaultValue={a.owner_id ?? ''} data-testid="reassign-to">
                    {!a.owner_id && <option value="" disabled>{t('Elige a alguien', 'Pick someone')}</option>}
                    {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </Field>
                <div className="mt-3 flex justify-end">
                  <ConfirmButton
                    action={reassignOneAction}
                    label={t('Reasignar', 'Reassign')}
                    title={t('¿Reasignar este comercio?', 'Reassign this merchant?')}
                    body={t(`${a.name} pasa a %s${moves.es ? `, con ${moves.es}` : ''}.${a.owner_name ? ` ${a.owner_name} deja de verlo en su lista.` : ''}`, `${a.name} moves to %s${moves.en ? `, with ${moves.en}` : ''}.${a.owner_name ? ` ${a.owner_name} stops seeing it in their list.` : ''}`)}
                    confirm={t('Sí, reasignar', 'Yes, reassign')}
                    cancel={m('action.cancel')}
                    nameFrom="to_user_id"
                    testId="reassign-save"
                  />
                </div>
              </form>
            </section>
          )}

          <section className={canReassign ? section : undefined}>
            <h3 className={h3}>{isParent ? t('Ventas de su red', 'Network sales') : t('Ventas', 'Sales')}</h3>
            <dl className="mt-2">
              <KeyVal k={t('Etapa de vida', 'Lifecycle')}>{lab(t, LIFECYCLE[a.lifecycle]?.label)} · {t('desde', 'since')} {day(a.lifecycle_at, locale, tz)}</KeyVal>
              {isParent ? (
                <KeyVal k={t('Ventas, 30 días', 'Sales, 30 days')}>{num(rollup.txn_30d, locale)}{rollup.volume_30d ? ` · ${money(Number(rollup.volume_30d), rollup.currency ?? market.currency, locale, true)}` : ''}</KeyVal>
              ) : (
                <>
                  <KeyVal k={metrics ? t(`Ventas, últimos 30 días al ${day(metrics.as_of, locale)}`, `Sales, last 30 days to ${day(metrics.as_of, locale)}`) : t('Ventas, últimos 30 días', 'Sales, last 30 days')}><span data-testid="fact-sales">{metrics ? `${t(`${num(metrics.txn_count_30d, locale)} ${metrics.txn_count_30d === 1 ? 'transacción' : 'transacciones'}`, `${num(metrics.txn_count_30d, locale)} ${metrics.txn_count_30d === 1 ? 'transaction' : 'transactions'}`)} · ${money(Number(metrics.volume_minor_30d), metrics.currency, locale, true)} · ${t(`${metrics.active_days_30d} días con venta`, `${metrics.active_days_30d} days with sales`)}` : t('Todavía no transacciona', 'Not transacting yet')}</span></KeyVal>
                  {metrics && (
                    <KeyVal k={t('30 días anteriores', 'Previous 30 days')}><span data-testid="fact-sales-prev">{metrics.prev_as_of && metrics.prev_txn_count_30d !== null
                      ? `${t(`${num(metrics.prev_txn_count_30d, locale)} ${metrics.prev_txn_count_30d === 1 ? 'transacción' : 'transacciones'}`, `${num(metrics.prev_txn_count_30d, locale)} ${metrics.prev_txn_count_30d === 1 ? 'transaction' : 'transactions'}`)} · ${money(Number(metrics.prev_volume_minor_30d), metrics.currency, locale, true)}${salesDelta(metrics.txn_count_30d, metrics.prev_txn_count_30d)} · ${t(`al ${day(metrics.prev_as_of, locale)}`, `to ${day(metrics.prev_as_of, locale)}`)}`
                      : t('No hay dato de ese periodo', 'No data for that period')}</span></KeyVal>
                  )}
                  <KeyVal k={t('Primera venta', 'First sale')}>{metrics?.first_txn_at ? day(metrics.first_txn_at, locale, tz) : <NoData locale={locale} />}</KeyVal>
                  <KeyVal k={t('Última venta', 'Last sale')}>{metrics?.last_txn_at ? ago(metrics.last_txn_at, locale, now) : <NoData locale={locale} />}</KeyVal>
                </>
              )}
              {a.territory && <KeyVal k={t('Territorio', 'Territory')}>{a.territory}</KeyVal>}
              {a.segment && <KeyVal k={t('Canal', 'Channel')}>{lab(t, MOTOR[a.segment])}</KeyVal>}
            </dl>
            {metrics && <p className="mt-2 text-[13px] text-muted" data-testid="metrics-asof">{t(`Datos de ventas con corte al ${day(metrics.as_of, locale)}.`, `Sales data as of ${day(metrics.as_of, locale)}.`)}</p>}
          </section>

          {deals.length > 0 && (
            <section className={section} data-testid="account-deals">
              <h3 className={h3}>{t('Negocios', 'Deals')}</h3>
              <ul className="mt-2 divide-y divide-line">
                {deals.map((d) => (
                  <li key={d.id}>
                    <Link href={`/deals/${d.id}`} className="row-hover -mx-2 flex items-center justify-between gap-3 rounded-[10px] px-2 py-2.5">
                      <span className="min-w-0"><span className="block truncate text-[15px] font-medium text-strong">{d.title}</span><span className="text-[13px] text-muted">{[d.owner_name, d.amount_minor ? money(Number(d.amount_minor), d.currency, locale) : null].filter(Boolean).join(' · ')}</span></span>
                      <Badge tone={d.status === 'won' ? 'good' : d.status === 'lost' ? 'bad' : 'neutral'}>{d.status === 'open' ? t(d.stage_es, d.stage_en) : d.status === 'won' ? t('Ganado', 'Won') : t('Perdido', 'Lost')}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <AccountOrders ctx={ctx} accountId={a.id} timezone={market.timezone} hasOrderPipeline={pipelines.some((p) => p.has_items)} />

          <section className={section} data-testid="account-contacts">
            <div className="flex items-center justify-between gap-3">
              <h3 className={h3}>{t('Contactos', 'Contacts')}</h3>
              {canEdit && (
                <Dialog trigger={t('Agregar', 'Add')} title={t('Nuevo contacto', 'New contact')} size="sm" testId="add-contact">
                  <ActionForm action={addContactAction} onOk="close" className="grid grid-cols-2 gap-4">
                    <input type="hidden" name="account_id" value={a.id} />
                    <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="full_name" className="input" required minLength={2} data-testid="contact-name" /></Field>
                    <Field label={t('Rol', 'Role')}><select name="role" className="input" data-testid="contact-role">{contactRoles.map((k) => <option key={k} value={k}>{lab(t, CONTACT_ROLE[k])}</option>)}</select></Field>
                    <Field label={t('Teléfono', 'Phone')} hint={t('Si esa persona ya es contacto de otra cuenta con este teléfono, se liga a esta: no se captura dos veces.', 'If that person is already a contact of another account with this phone, they are linked to this one: no second entry.')}><input name="phone" className="input" inputMode="tel" data-testid="contact-phone" /></Field>
                    <Field label={t('Correo', 'Email')} className="col-span-2"><input name="email" type="email" className="input" /></Field>
                    <Field label={t('Idioma preferido', 'Preferred language')} className="col-span-2 sm:col-span-1">
                      <select name="locale" className="input" defaultValue="" data-testid="contact-locale"><option value="">{t('Sin dato', 'Not set')}</option><option value="es">{t('Español', 'Spanish')}</option><option value="en">{t('Inglés', 'English')}</option></select>
                    </Field>
                    <div className="col-span-2 space-y-1">
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="sms" className="h-5 w-5 shrink-0" data-testid="contact-sms" />{t('Su teléfono es un móvil que recibe SMS', 'Their phone is a mobile that gets SMS')}</label>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" name="primary" className="h-5 w-5 shrink-0" data-testid="contact-primary" />{t('Es el contacto principal de la cuenta', 'This is the account’s primary contact')}</label>
                    </div>
                    <div className="col-span-2 flex justify-end"><Submit testId="save-contact">{t('Guardar', 'Save')}</Submit></div>
                  </ActionForm>
                </Dialog>
              )}
            </div>
            <ul className="mt-2 space-y-3">
              {contacts.map((c) => (
                <li key={c.id} data-testid="contact-row">
                  <p className="flex flex-wrap items-center gap-x-2 text-[15px] font-medium text-strong">{c.full_name} <span className="text-[13px] font-normal text-muted">{lab(t, CONTACT_ROLE[c.role])}</span>
                    {c.is_primary && <Badge tone="good">{t('Principal', 'Primary')}</Badge>}
                    {c.sms_capable && <Badge>{t('Recibe SMS', 'Gets SMS')}</Badge>}
                    {c.preferred_locale && <Badge>{c.preferred_locale === 'en' ? t('Prefiere inglés', 'Prefers English') : t('Prefiere español', 'Prefers Spanish')}</Badge>}
                  </p>
                  <p className="text-[13px] text-muted-2">
                    {c.phone ? <a href={`tel:${c.phone}`} className="font-medium text-blue-text underline" data-testid="contact-call">{phoneText(c.phone)}</a> : null}
                    {c.phone ? <> · <a href={`https://wa.me/${c.phone.slice(1)}`} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-text underline">WhatsApp</a></> : null}
                    {c.phone && c.email ? ' · ' : ''}{c.email ?? (c.phone ? '' : <NoData locale={locale} />)}
                  </p>
                  {canEdit && !c.is_primary && contacts.length > 1 && (
                    <ActionForm action={setPrimaryContactAction}>
                      <input type="hidden" name="account_id" value={a.id} /><input type="hidden" name="contact_id" value={c.id} />
                      <Submit variant="quiet" size="sm" testId="contact-make-primary">{t('Hacer principal', 'Make primary')}</Submit>
                    </ActionForm>
                  )}
                  {identity && <ContactTools ctx={ctx} accountId={a.id} segment={a.segment} contact={c} others={identity.otherAccounts.get(c.id) ?? []} canEdit={canEdit} />}
                </li>
              ))}
              {contacts.length === 0 && <li className="text-[15px] text-muted">{t('Sin contactos todavía.', 'No contacts yet.')}</li>}
            </ul>
            {identity && <ContactHistory ctx={ctx} identity={identity} tz={tz} />}
          </section>

          <section className={section} data-testid="account-attribution">
            <h3 className={h3}>{t('Atribución', 'Attribution')}</h3>
            <p className="text-[13px] text-muted">{t('Tres capas, cada una con fecha. Lo anterior no se borra.', 'Three layers, each one dated. Nothing earlier is erased.')}</p>
            <ul className="mt-3 space-y-3">
              {attributions.map((at, i) => (
                <li key={i} className={at.effective_to ? 'text-muted' : ''}>
                  <p className="text-[13px] text-muted">{lab(t, ATTRIBUTION_LAYER[at.layer])}</p>
                  <p className={cx('text-[15px] font-medium', at.effective_to ? 'text-muted-2' : 'text-strong')} data-testid={`attribution-${at.layer}`}>{at.party_kind === 'form' ? t('Formulario web', 'Web form') : at.party_label}</p>
                  <p className="text-[13px] text-muted-2">{t('desde', 'since')} {day(at.effective_from, locale, tz)}{at.effective_to ? ` ${t('hasta', 'until')} ${day(at.effective_to, locale, tz)}` : ''}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className={section} data-testid="account-aliases">
            {identity && <AliasSection ctx={ctx} accountId={a.id} identity={identity} canManage={canAlias} canInternal={ctx.can('integration.operate', a.market_code)} tz={tz} />}
          </section>

          {identity && <ProductsSection ctx={ctx} accountId={a.id} identity={identity} canManage={canProducts} />}
          {identity && <ProcessSection ctx={ctx} accountId={a.id} identity={identity} canEdit={canEdit} />}
          {identity && <MergeSection ctx={ctx} accountId={a.id} identity={identity} tz={tz} />}

          {defs.length > 0 && (
            <section className={section} data-testid="account-custom">
              <h3 className={cx(h3, 'mb-2')}>{t('Campos adicionales', 'Additional fields')}</h3>
              <CustomFields defs={defs.filter((d) => !d.section)} values={a.custom} t={t} locale={locale}
                action={canEdit ? <LinkButton href={`/comercios/${a.id}/campos`} size="sm" testId="custom-edit">{t('Editar campos', 'Edit fields')}</LinkButton> : undefined} />
              <div className="mt-5"><FieldSections defs={defs} values={a.custom} t={t} locale={locale} team={readerTeam(fichaRole(rolesIn(ctx.memberships, a.market_code)))} /></div>
            </section>
          )}

          <FichaMercados ctx={ctx} id={a.id} market={a.market_code} archived={!!a.archived_at} name={a.name} />

          {canEdit && (
            <section className={section}>
              <h3 className={cx(h3, 'mb-3')}>{t('Datos del comercio', 'Merchant details')}</h3>
              <ActionForm action={updateAccountAction} className="space-y-4">
                <input type="hidden" name="id" value={a.id} />
                <Field label={t('Nombre', 'Name')}><input name="name" className="input" defaultValue={a.name} required data-testid="edit-name" /></Field>
                <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" defaultValue={a.phone ?? ''} data-testid="edit-phone" /></Field>
                <Field label={t('Correo', 'Email')}><input name="email" className="input" defaultValue={a.email ?? ''} /></Field>
                {/* La dirección se edita arriba, en "Dirección y ubicación", con el formato del país; este formulario la conserva como está. */}
                <input type="hidden" name="address_line" value={a.address_line ?? ''} />
                <input type="hidden" name="locality" value={a.locality ?? ''} />
                <input type="hidden" name="region" value={a.region ?? ''} />
                <input type="hidden" name="postal_code" value={a.postal_code ?? ''} />
                <div className="flex justify-end"><Submit variant="ghost" testId="edit-save">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
              <ActionForm action={setAccountTypeAction} className="mt-6 border-t border-line pt-5" testId="type-form">
                <input type="hidden" name="id" value={a.id} />
                <Field label={t('Tipo de cuenta', 'Account type')} hint={t('Dice qué es esta cuenta: tienda, sucursal, cadena, corporativo, distribuidor, ISO o agregador.', 'Says what this account is: store, branch, chain, corporate account, distributor, ISO or aggregator.')}>
                  <select name="account_type" className="input" defaultValue={a.account_type} data-testid="type-select">
                    {!types.some((x) => x.code === a.account_type) && <option value={a.account_type}>{typeName}</option>}
                    {types.map((x) => <option key={x.code} value={x.code}>{t(x.label_es, x.label_en)}</option>)}
                  </select>
                </Field>
                <div className="mt-3 flex justify-end"><Submit variant="ghost" size="sm" testId="type-save">{t('Guardar tipo', 'Save type')}</Submit></div>
              </ActionForm>
              {canTree && (
                <ActionForm action={moveInTreeAction} className="mt-6 border-t border-line pt-5" testId="parent-form">
                  <input type="hidden" name="id" value={a.id} />
                  <Field label={t('Pertenece a', 'Belongs to')} hint={canReassign ? undefined : t('Puedes armar el árbol con cuentas que son tuyas.', 'You can build the tree with accounts that are yours.')}>
                    <select name="parent_id" className="input" defaultValue={a.parent_id ?? ''} data-testid="parent-select">
                      <option value="">{t('Ninguna (cuenta independiente)', 'None (independent account)')}</option>
                      {a.parent_id && parent && !parents.some((p) => p.id === a.parent_id) && <option value={a.parent_id}>{parent.name}</option>}
                      {parents.filter((p) => p.id !== a.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto]">
                    <Field label={a.parent_id ? t('¿Por qué se mueve?', 'Why is it moving?') : t('Motivo (opcional la primera vez)', 'Reason (optional the first time)')} hint={t('Queda en la historia del árbol. La cuenta conserva su historia, su atribución y a quien la lleva.', 'It stays in the tree history. The account keeps its history, its attribution and its owner.')}>
                      <input name="reason" className="input" required={!!a.parent_id} minLength={5} maxLength={300} data-testid="parent-reason" />
                    </Field>
                    <Field label={t('Fecha efectiva', 'Effective date')}><input name="effective_on" type="date" className="input" defaultValue={today} max={today} data-testid="parent-date" /></Field>
                  </div>
                  <div className="mt-3 flex justify-end"><Submit variant="ghost" size="sm" testId="parent-save">{t('Mover en el árbol', 'Move in the tree')}</Submit></div>
                </ActionForm>
              )}
            </section>
          )}
        </div>
      )}
    </article>
  )
}
