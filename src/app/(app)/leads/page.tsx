import Link from 'next/link'
import { Check } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { leadFacets, leadSources, listLeads, lossReasons, marketPipelines, sellers, type LeadListItem } from '@/dal/leads'
import { MANUAL_SOURCES, CONTACT_ROLES } from '@/domain/leads'
import { BULK_FORM, LeadBulk } from '@/ui/lead-bulk'
import { track } from '@/dal/boards'
import { getReportOptions } from '@/dal/reports'
import { resultOptions, sheetConfig } from '@/server/sheet'
import { Empty, Field, Pills, LinkButton, cx } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { LeadCall } from '@/ui/lead-call'
import { CONTACT_ROLE, LEAD_STATUS, MOTOR, SOURCE, lab, qs } from '@/lib/labels'
import { bulkDisqualifyAction, createLeadAction, takeLeadAction } from './actions'
import { completeItemAction } from '@/app/(app)/hoy/actions'
import { flat } from '@/server/params'
import { day } from '@/lib/format'

/** Anillo de reloj: cuánto de la meta de primer contacto ya se consumió. Lleno y en rojo si se pasó; verde con palomita si ya hubo contacto. */
function Ring({ fraction, tone }: { fraction: number; tone: 'warn' | 'risk' | 'ok' | 'idle' }) {
  const r = 15
  const c = 2 * Math.PI * r
  const color = tone === 'risk' ? 'var(--cg-risk-text)' : tone === 'warn' ? 'var(--cg-health-idle)' : tone === 'ok' ? 'var(--cg-green-500)' : 'var(--cg-health-new)'
  return (
    <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden data-testid="lead-ring" data-tone={tone}>
      <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--cg-line-200)" strokeWidth="3" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0.04, fraction)))} />
      </svg>
      {tone === 'ok' && <Check size={16} strokeWidth={2.5} className="absolute text-green-600" />}
    </span>
  )
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ market?: string; status?: string; owner?: string; q?: string; before?: string; clock?: string; source?: string; sort?: string; from?: string; to?: string; motor?: string; equipo?: string; tipo?: string; embudo?: string; tiendas_min?: string; tiendas_max?: string }> }) {
  const ctx = await requireCtx()
  const { t, m } = ctx
  const sp = flat(await searchParams)
  const status = sp.status ?? 'open'
  // Por equipo filtran supervisión, quien lidera y leadership: quien vende no tiene a quién comparar.
  const byTeam = ctx.can('lead.assign') || ctx.can('board.lt') || ctx.can('board.supervisor')
  const teams = byTeam ? (await getReportOptions(ctx)).teams.filter((x) => !sp.market || x.market_code === sp.market) : []
  const team = !byTeam ? undefined : sp.equipo === 'none' ? 'none' : teams.some((x) => x.id === sp.equipo) ? sp.equipo : undefined
  const data = await listLeads(ctx, { ...sp, status: status === 'all' ? undefined : status, team })
  await track(ctx, 'view.leads')
  // El alta ofrece solo los mercados donde la persona puede crear leads y los tipos de venta que tienen embudo ahí.
  const live = ctx.markets.filter((x) => x.status === 'live' && ctx.can('lead.create', x.code))
  const manages = ctx.can('lead.assign')
  const [pipes, sources, reasons, people, facets] = await Promise.all([
    marketPipelines(ctx), leadSources(ctx), ctx.can('lead.work') ? lossReasons(ctx) : Promise.resolve([]), manages ? sellers(ctx) : Promise.resolve([]), leadFacets(ctx),
  ])
  // Tipo de empresa, embudo de campaña y número de tiendas son campos del lead: se filtran aquí y se cuentan en el reporte por mercado (E15.F5).
  const tipo = facets.types.some((x) => x.code === sp.tipo) ? sp.tipo : undefined
  const embudo = facets.funnels.includes(sp.embudo ?? '') ? sp.embudo : undefined
  const isCount = (v: string | undefined) => /^\d{1,7}$/.test(v ?? '')
  const tiendasMin = isCount(sp.tiendas_min) ? sp.tiendas_min : undefined
  const tiendasMax = isCount(sp.tiendas_max) ? sp.tiendas_max : undefined
  const typeName = (code: string | null) => ((x) => (x ? t(x.label_es, x.label_en) : null))(facets.types.find((x) => x.code === code))
  const motors = [...new Set(pipes.filter((x) => live.some((mk) => mk.code === x.market_code)).map((x) => x.motor))]
  // Tipos de venta del filtro: los de los embudos activos de los mercados que la persona ve (no solo donde puede crear).
  const motorOptions = [...new Set(pipes.filter((x) => !sp.market || x.market_code === sp.market).map((x) => x.motor))]
  const motor = motorOptions.includes(sp.motor ?? '') ? sp.motor : undefined
  const owners = [...new Map(people.map((x) => [x.id, x.full_name])).entries()]
  // Desde el Panel del LT se llega con el periodo de la cifra: la lista muestra los leads que llegaron en esos días.
  const isDay = (v: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '')
  const from = isDay(sp.from) ? sp.from : undefined
  const to = isDay(sp.to) ? sp.to : undefined
  const keep = { market: sp.market, status, owner: sp.owner, q: sp.q, clock: sp.clock, source: sp.source, sort: sp.sort, from, to, motor, equipo: team, tipo, embudo, tiendas_min: tiendasMin, tiendas_max: tiendasMax }
  const link = (patch: Record<string, string | undefined>) => qs('/leads', { ...keep, ...patch, before: undefined })
  const filtered = !!(sp.q || sp.clock || sp.source || sp.sort || from || to || motor || team || tipo || embudo || tiendasMin || tiendasMax || (sp.owner && sp.owner !== 'me'))
  const now = new Date()
  const config = sheetConfig(ctx, now)
  const seg = (on: boolean) => cx('press inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium', on ? 'bg-ink text-white' : 'text-strong hover:bg-green-50')
  const span = (ms: number) => {
    const mins = Math.max(1, Math.round(Math.abs(ms) / 60000))
    return mins < 90 ? m('leads.minutes', { count: mins }) : mins < 48 * 60 ? m('leads.hours', { count: Math.round(mins / 60) }) : m('leads.days', { count: Math.round(mins / 1440) })
  }

  // Estado de primer contacto de un lead (handoff, sección 6): siempre con texto, nunca solo color.
  const state = (l: LeadListItem) => {
    const due = l.sla_due_at ? new Date(l.sla_due_at).getTime() : null
    const who = l.owner_name ?? m('leads.someone')
    if (l.status === 'new' && !l.first_touch_at) {
      const late = due !== null && due < now.getTime()
      const total = due !== null ? due - new Date(l.created_at).getTime() : 0
      return {
        waiting: true, late, ring: late ? ('risk' as const) : due === null ? ('idle' as const) : ('warn' as const), fraction: late || total <= 0 ? 1 : (now.getTime() - new Date(l.created_at).getTime()) / total,
        chip: late ? m('leads.state.late') : m('leads.state.waiting'), chipClass: late ? 'bg-risk-bg text-red-text' : 'bg-warn-bg text-amber-text',
        note: due === null ? '' : late ? m('leads.clock.late', { time: span(now.getTime() - due) }) : m('leads.clock.left', { time: span(due - now.getTime()) }),
      }
    }
    const onTime = l.first_touch_at && due !== null ? new Date(l.first_touch_at).getTime() <= due : null
    const note = onTime === null ? '' : onTime ? m('leads.clock.onTime') : m('leads.clock.lateTouch')
    // Un intento sin respuesta no es un contacto: se dice "intento", no "contacto a tiempo".
    if (l.status === 'new') return { waiting: false, late: false, ring: 'idle' as const, fraction: 1, chip: m('leads.state.attempted', { name: who }), chipClass: 'bg-surface-3 text-strong', note: onTime === null ? '' : onTime ? t('Primer intento a tiempo', 'First attempt on time') : t('Primer intento fuera de la meta', 'First attempt past the goal') }
    if (l.status === 'contacted') return { waiting: false, late: false, ring: 'ok' as const, fraction: 1, chip: m('leads.state.contacted', { name: who }), chipClass: 'bg-green-100 text-brand-text', note }
    return { waiting: false, late: false, ring: l.status === 'disqualified' ? ('idle' as const) : ('ok' as const), fraction: 1, chip: lab(t, LEAD_STATUS[l.status]?.label), chipClass: l.status === 'disqualified' ? 'bg-surface-3 text-strong' : 'bg-green-100 text-brand-text', note }
  }
  // Cierre en bloque: quien vende, solo sus leads abiertos; supervisión y quien lidera, los de su alcance.
  const canBulk = (l: LeadListItem) => ['new', 'contacted', 'qualified'].includes(l.status) && ctx.can('lead.work', l.market_code) && (ctx.can('lead.assign', l.market_code) || l.owner_id === ctx.user.id)
  const selectable = data.items.some(canBulk)
  const cols = '@3xl:grid @3xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_170px] @3xl:items-center @3xl:gap-4'

  return (
    <div className="@container">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-9 font-semibold">{m('leads.title')}</h1>
          <p className="mt-1 max-w-[640px] text-[15px] text-muted">{m('leads.subtitle')}</p>
        </div>
        {ctx.can('lead.create') && (
          <Dialog trigger={t('Nuevo lead', 'New lead')} title={t('Nuevo lead', 'New lead')} variant="primary" testId="new-lead" hash="nuevo">
            <ActionForm action={createLeadAction} className="grid grid-cols-2 gap-4">
              <Field label={t('Mercado', 'Market')}>
                <select name="market" className="input" defaultValue={live[0]?.code}>
                  {live.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                </select>
              </Field>
              <Field label={t('Tipo de negocio', 'Business type')}>
                <select name="motor" className="input">
                  {(motors.length ? motors : ['d2d']).map((k) => <option key={k} value={k}>{lab(t, MOTOR[k]) || k}</option>)}
                </select>
              </Field>
              <Field label={t('Nombre del negocio', 'Business name')} className="col-span-2"><input name="business_name" className="input" required minLength={2} /></Field>
              <Field label={t('Persona de contacto', 'Contact person')}><input name="contact_name" className="input" required minLength={2} /></Field>
              <Field label={t('Qué hace en el negocio', 'Their role in the business')}>
                <select name="contact_role" className="input" defaultValue="" data-testid="lead-role">
                  <option value="">{t('Todavía no sé', 'Not sure yet')}</option>
                  {CONTACT_ROLES.map((r) => <option key={r} value={r}>{lab(t, CONTACT_ROLE[r])}</option>)}
                </select>
              </Field>
              <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" /></Field>
              <Field label={t('Correo', 'Email')}><input name="email" type="email" className="input" /></Field>
              <Field label={t('Ciudad', 'City')}><input name="locality" className="input" /></Field>
              <Field label={t('De dónde salió', 'Where it came from')}>
                <select name="source" className="input" required defaultValue="" data-testid="lead-source">
                  <option value="" disabled>{t('Elige el origen', 'Pick the source')}</option>
                  {MANUAL_SOURCES.map((k) => <option key={k} value={k}>{k === 'manual' ? t('Otro', 'Other') : lab(t, SOURCE[k])}</option>)}
                </select>
              </Field>
              <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] bg-surface-2 px-3 text-[14px] text-strong">
                <input type="checkbox" name="already_contacted" className="h-5 w-5 shrink-0" data-testid="lead-spoke" />
                <span>{t('Ya hablé con esta persona', 'I already spoke with this person')}<span className="block text-[13px] text-muted">{t('Queda como contactado y no empieza el reloj de primer contacto.', 'It is saved as contacted and the first-contact clock does not start.')}</span></span>
              </label>
              <div className="col-span-2 mt-2 flex justify-end"><Submit testId="save-lead">{t('Guardar lead', 'Save lead')}</Submit></div>
            </ActionForm>
          </Dialog>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pills
          label={t('Estado', 'Status')}
          current={status}
          items={[
            { key: 'open', href: link({ status: 'open' }), label: t('Abiertos', 'Open'), count: data.counts.open ?? 0 },
            { key: 'overdue', href: link({ status: 'overdue' }), label: m('leads.state.late'), count: data.counts.overdue ?? 0 },
            { key: 'new', href: link({ status: 'new' }), label: t('Nuevos', 'New'), count: data.counts.new ?? 0 },
            { key: 'qualified', href: link({ status: 'qualified' }), label: t('Calificados', 'Qualified'), count: data.counts.qualified ?? 0 },
            { key: 'converted', href: link({ status: 'converted' }), label: t('Convertidos', 'Converted'), count: data.counts.converted ?? 0 },
            { key: 'all', href: link({ status: 'all' }), label: t('Todos', 'All') },
          ]}
        />
        <nav aria-label={m('merchants.scope')} className="inline-flex rounded-full border border-line bg-surface p-1">
          <Link href={link({ owner: undefined })} aria-current={sp.owner !== 'me' ? 'page' : undefined} className={seg(sp.owner !== 'me')}>{m('merchants.scope.all')}</Link>
          <Link href={link({ owner: 'me' })} aria-current={sp.owner === 'me' ? 'page' : undefined} className={seg(sp.owner === 'me')} data-testid="pill-me">{m('merchants.scope.mine')}</Link>
          <Link href={link({ owner: 'none' })} aria-current={sp.owner === 'none' ? 'page' : undefined} className={seg(sp.owner === 'none')} data-testid="pill-unowned">{m('leads.noOwner')}</Link>
        </nav>
      </div>

      {/* La llave vuelve a montar el formulario cuando cambian los filtros: así "Quitar filtros" también limpia lo que se ve. */}
      <form key={JSON.stringify(keep)} action="/leads" method="get" role="search" className="mt-4 grid grid-cols-2 items-end gap-3 @3xl:flex @3xl:flex-wrap" data-testid="lead-filters">
        <input type="hidden" name="status" value={status} />
        {sp.market && <input type="hidden" name="market" value={sp.market} />}
        {from && <input type="hidden" name="from" value={from} />}
        {to && <input type="hidden" name="to" value={to} />}
        {(from || to) && (
          <p className="col-span-2 rounded-[10px] bg-surface-3 px-3 py-2 text-[13.5px] text-strong @3xl:basis-full" data-testid="lead-period">
            {from && to ? t(`Leads que llegaron del ${day(from, ctx.locale)} al ${day(to, ctx.locale)}.`, `Leads that came in from ${day(from, ctx.locale)} to ${day(to, ctx.locale)}.`)
              : from ? t(`Leads que llegaron desde el ${day(from, ctx.locale)}.`, `Leads that came in since ${day(from, ctx.locale)}.`)
              : t(`Leads que llegaron hasta el ${day(to!, ctx.locale)}.`, `Leads that came in up to ${day(to!, ctx.locale)}.`)}
          </p>
        )}
        {!manages && sp.owner && <input type="hidden" name="owner" value={sp.owner} />}
        <Field label={t('Buscar en la lista', 'Search this list')} className="col-span-2 @3xl:min-w-[240px] @3xl:flex-1">
          <input name="q" type="search" defaultValue={sp.q ?? ''} className="input" placeholder={t('Nombre, persona o teléfono', 'Name, person or phone')} data-testid="lead-q" />
        </Field>
        <Field label={t('Reloj', 'Clock')}>
          <select name="clock" className="input" defaultValue={sp.clock ?? ''} data-testid="lead-f-clock">
            <option value="">{t('Todos', 'All')}</option>
            <option value="with">{t('Con reloj corriendo', 'Clock running')}</option>
            <option value="without">{t('Sin reloj (importados)', 'No clock (imported)')}</option>
          </select>
        </Field>
        <Field label={t('Origen', 'Source')}>
          <select name="source" className="input" defaultValue={sp.source ?? ''} data-testid="lead-f-source">
            <option value="">{t('Todos', 'All')}</option>
            {sources.map((k) => <option key={k} value={k}>{k === 'manual' ? t('Captura manual', 'Manual entry') : lab(t, SOURCE[k]) || k}</option>)}
          </select>
        </Field>
        {motorOptions.length > 1 && (
          <Field label={t('Tipo de venta', 'Sale type')}>
            <select name="motor" className="input" defaultValue={motor ?? ''} data-testid="lead-f-motor">
              <option value="">{t('Todos', 'All')}</option>
              {motorOptions.map((k) => <option key={k} value={k}>{lab(t, MOTOR[k]) || k}</option>)}
            </select>
          </Field>
        )}
        {facets.types.length > 0 && (
          <Field label={t('Tipo de empresa', 'Company type')}>
            <select name="tipo" className="input" defaultValue={tipo ?? ''} data-testid="lead-f-type">
              <option value="">{t('Todos', 'All')}</option>
              {facets.types.map((x) => <option key={x.code} value={x.code}>{t(x.label_es, x.label_en)}</option>)}
            </select>
          </Field>
        )}
        {facets.funnels.length > 0 && (
          <Field label={t('Embudo de campaña', 'Campaign group')}>
            <select name="embudo" className="input" defaultValue={embudo ?? ''} data-testid="lead-f-funnel">
              <option value="">{t('Todos', 'All')}</option>
              {facets.funnels.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
        )}
        <Field label={t('Tiendas, desde', 'Stores, from')}>
          <input name="tiendas_min" type="number" min={0} step={1} inputMode="numeric" defaultValue={tiendasMin ?? ''} className="input @3xl:w-[120px]" data-testid="lead-f-stores-min" />
        </Field>
        <Field label={t('Tiendas, hasta', 'Stores, up to')}>
          <input name="tiendas_max" type="number" min={0} step={1} inputMode="numeric" defaultValue={tiendasMax ?? ''} className="input @3xl:w-[120px]" data-testid="lead-f-stores-max" />
        </Field>
        {byTeam && teams.length > 0 && (
          <Field label={t('Equipo', 'Team')}>
            <select name="equipo" className="input" defaultValue={team ?? ''} data-testid="lead-f-team">
              <option value="">{t('Todos los equipos', 'All teams')}</option>
              {teams.map((x) => <option key={x.id} value={x.id}>{`${ctx.markets.length > 1 && !sp.market ? `${x.market_code} · ` : ''}${x.name}`}</option>)}
              <option value="none">{t('Sin equipo', 'No team')}</option>
            </select>
          </Field>
        )}
        {manages && (
          <Field label={t('De quién', 'Whose')}>
            <select name="owner" className="input" defaultValue={sp.owner ?? ''} data-testid="lead-f-owner">
              <option value="">{t('De todos', 'Everyone')}</option>
              <option value="me">{t('Míos', 'Mine')}</option>
              <option value="none">{m('leads.noOwner')}</option>
              {owners.filter(([id]) => id !== ctx.user.id).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </Field>
        )}
        <Field label={t('Orden', 'Order')}>
          <select name="sort" className="input" defaultValue={sp.sort ?? ''} data-testid="lead-f-sort">
            <option value="">{t('Más recientes', 'Newest first')}</option>
            <option value="oldest">{t('Más antiguos', 'Oldest first')}</option>
            <option value="due">{t('Vence primero', 'Due first')}</option>
          </select>
        </Field>
        <div className="col-span-2 flex gap-3 @3xl:col-span-1">
          <button type="submit" className="press inline-flex h-11 items-center rounded-[10px] border border-line-2 bg-surface px-5 text-[15px] font-semibold text-strong hover:bg-green-50" data-testid="lead-apply">{t('Aplicar', 'Apply')}</button>
          {filtered && <Link href={qs('/leads', { status, market: sp.market })} className="press inline-flex h-11 items-center rounded-[10px] px-3 text-[14px] font-medium text-muted-2 hover:bg-surface-3" data-testid="lead-clear">{t('Quitar filtros', 'Clear filters')}</Link>}
        </div>
      </form>

      <div className="card mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-6"><Empty title={m('leads.empty.title')} hint={m('leads.empty.body')} /></div>
        ) : (
          <>
            {selectable && (
              <LeadBulk
                action={bulkDisqualifyAction}
                reasons={reasons.map((r) => ({ code: r.code, label: t(r.label_es, r.label_en) }))}
                labels={{
                  selectAll: t('Seleccionar los de esta página', 'Select the ones on this page'),
                  one: t('1 lead seleccionado', '1 lead selected'),
                  many: t('{n} leads seleccionados', '{n} leads selected'),
                  reason: t('Motivo', 'Reason'),
                  pick: t('Elige un motivo', 'Pick a reason'),
                  close: t('Cerrar como no calificado', 'Close as not qualified'),
                  hint: t('Se cierran con el mismo motivo y cada uno queda en la bitácora. No cuenta como contacto.', 'They close with the same reason and each one is logged. It does not count as a contact.'),
                }}
              />
            )}
            <div aria-hidden className={cx('hidden border-b border-line px-5 py-3 text-[13px] font-medium text-muted', cols)}>
              <span className="pl-12">{m('leads.col.lead')}</span><span>{m('leads.col.state')}</span><span>{m('leads.col.owner')}</span><span />
            </div>
            <ul className="divide-y divide-line" data-testid="lead-table">
              {data.items.map((l) => {
                const s = state(l)
                const mine = l.owner_id === ctx.user.id
                // Llamar no desaparece después de un intento sin respuesta: sigue mientras nadie haya logrado el contacto.
                const canCall = l.status === 'new' && !!l.phone && ctx.can('lead.work', l.market_code) && (mine || !l.owner_id)
                const canPick = canBulk(l)
                return (
                  <li key={l.id} className={cx('row-hover relative px-4 py-3.5 @3xl:px-5', cols)} data-testid="lead-row" data-state={s.waiting ? (s.late ? 'late' : 'waiting') : l.status}>
                    <div className="flex min-w-0 items-center gap-3">
                      {selectable && (
                        <label className={cx('relative z-10 -my-1 -ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center', canPick ? 'cursor-pointer' : 'invisible')}>
                          <input type="checkbox" name="ids" value={l.id} form={canPick ? BULK_FORM : undefined} disabled={!canPick} className="h-5 w-5" aria-label={t(`Seleccionar ${l.business_name}`, `Select ${l.business_name}`)} data-testid="lead-check" />
                        </label>
                      )}
                      <Ring fraction={s.fraction} tone={s.ring} />
                      <span className="min-w-0">
                        <Link href={`/leads/${l.id}`} className="block truncate text-[15px] leading-6 font-medium text-strong after:absolute after:inset-0">{l.business_name}</Link>
                        <span className="block truncate text-[13px] text-muted">{[l.contact_name, l.locality, ctx.markets.length > 1 ? l.market_code : null, lab(t, MOTOR[l.motor]) || null, lab(t, SOURCE[l.source])].filter(Boolean).join(' · ')}</span>
                        {(l.funnel || l.store_count !== null || (l.account_type && l.account_type !== 'store')) && (
                          <span className="block truncate text-[13px] text-muted" data-testid="lead-fields">{[l.account_type && l.account_type !== 'store' ? typeName(l.account_type) : null, l.store_count !== null ? m('leads.stores', { count: Number(l.store_count) }) : null, l.funnel ? t(`Embudo ${l.funnel}`, `Group ${l.funnel}`) : null].filter(Boolean).join(' · ')}</span>
                        )}
                        <span className={cx('block truncate text-[13px] @3xl:hidden', l.owner_name ? 'text-muted' : 'font-medium text-amber-text')} data-testid="lead-owner-small">{l.owner_name ?? m('leads.noOwner')}</span>
                      </span>
                    </div>
                    <div className="mt-2 min-w-0 pl-12 @3xl:mt-0 @3xl:pl-0">
                      <span className={cx('inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-[13px] font-medium', s.chipClass)} data-testid="lead-state">{s.chip}</span>
                      {l.duplicate_of && <span className="ml-1.5 inline-flex rounded-full bg-warn-bg px-2.5 py-0.5 text-[13px] font-medium text-amber-text">{m('leads.dup')}</span>}
                      {s.note && <span className={cx('mt-0.5 block text-[13px]', s.late ? 'font-medium text-red-text' : 'text-muted')} data-testid="lead-clock-text">{s.note}</span>}
                    </div>
                    <div className={cx('hidden truncate text-[15px] @3xl:block', l.owner_name ? 'text-strong' : 'text-amber-text')} data-testid="lead-owner-cell">{l.owner_name ?? m('leads.noOwner')}</div>
                    <div className="mt-3 flex pl-12 @3xl:mt-0 @3xl:justify-end @3xl:pl-0">
                      {canCall && (
                        <LeadCall
                          item={{ type: 'lead', id: l.id, title: m('action.callOf', { name: l.business_name }), name: l.business_name, results: resultOptions(ctx, ['reached', 'no_answer']), defaultResult: null, motor: l.motor }}
                          tel={`tel:${l.phone}`}
                          take={!l.owner_id}
                          label={l.owner_id ? m('action.call') : m('leads.takeAndCall')}
                          key={`${l.id}:${l.status}:${l.first_touch_at ? 1 : 0}`}
                          takeAction={takeLeadAction}
                          config={config}
                          completeAction={completeItemAction}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
      {data.next && <div className="mt-5 flex justify-center"><LinkButton href={qs('/leads', { ...keep, before: data.next })} testId="more">{m('merchants.more')}</LinkButton></div>}
    </div>
  )
}
