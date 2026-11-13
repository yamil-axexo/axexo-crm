import { recruiterChoices } from '@/dal/store-record'
import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { getAccount, listAccounts, listTree, savedViews, type AccountFilters } from '@/dal/accounts'
import { track } from '@/dal/boards'
import { getHolders, getPlaceOptions, getTargets } from '@/dal/reparto'
import { getReportOptions } from '@/dal/reports'
import { narrows } from '@/server/account-filter'
import { RepartoBar } from '@/ui/reparto'
import { repartoPreviewAction, repartoStepAction } from '@/app/(app)/reparto-actions'
import { isUuid } from '@/lib/ids'
import { Empty, Field, LinkButton, Pills, cx } from '@/ui/kit'
import { DataTools } from '@/ui/data-tools'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { FichaPanel } from '@/ui/panel'
import { ago, day, num } from '@/lib/format'
import { HEALTH_DOT, healthOf } from '@/lib/health'
import { KIND, MOTOR, lab, qs } from '@/lib/labels'
import type { MessageKey } from '@/lib/messages'
import { createAccountAction } from './actions'
import { accountTypeOptions, intakeFields } from '@/dal/b2b'
import { IntakeFields } from '@/ui/intake'
import { Ficha, fichaTab, type FichaTab } from './ficha'
import { flat } from '@/server/params'
import { ViewsSection } from '../views-section'
import { salesCutoff } from '@/dal/reportes'
import { visitorNames } from '@/dal/field'
import { marketPipelines } from '@/dal/leads'

/** Las vistas compartidas que vienen de fábrica se guardaron con nombre en español: en inglés se leen en inglés. Las que crea cada equipo salen como las escribió. */
const VIEW_EN: Record<string, string> = { 'En riesgo': 'At risk', 'Sin dueño': 'No owner', 'Esperando primera venta': 'Awaiting first sale' }

type Params = AccountFilters & { vista?: string; ficha?: string; tab?: string; repartir?: string; cola?: string }

export default async function ComerciosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireCtx()
  const { t, m, locale } = ctx
  const sp = flat(await searchParams)
  const tree = sp.vista === 'arbol'
  const fichaId = sp.ficha && /^[0-9a-f-]{36}$/.test(sp.ficha) ? sp.ficha : null
  const live = ctx.markets.filter((x) => x.status === 'live')
  // Quien no solo vende ve comercios de más de una persona: a esos roles se les ofrece filtrar por dueño.
  const wide = ctx.memberships.some((x) => x.role !== 'rep')
  // Repartir: se reparte un mercado a la vez. Si la persona reparte en uno solo, es ese; si no, el del filtro.
  const repartoMarkets = live.filter((x) => ctx.can('account.reassign', x.code)).map((x) => x.code)
  const repartoMarket = sp.market && repartoMarkets.includes(sp.market) ? sp.market : repartoMarkets.length === 1 && !sp.market ? repartoMarkets[0]! : null
  const repartir = !tree && sp.repartir === '1' && repartoMarkets.length > 0
  // Equipo y embudo: filtros para supervisión, quien lidera y leadership (su alcance de reportes dice qué pueden elegir).
  const lead = !tree && ctx.can('report.view')
  const [data, views, treeData, open, place, holders, targets, options] = await Promise.all([
    listAccounts(ctx, sp),
    savedViews(ctx, 'account'),
    tree ? listTree(ctx, { market: sp.market, owner: sp.owner, q: sp.q }) : Promise.resolve({ nodes: [], cut: false }),
    fichaId ? getAccount(ctx, fichaId) : Promise.resolve(null),
    tree ? Promise.resolve({ regions: [], territories: [] }) : getPlaceOptions(ctx),
    wide && !tree ? getHolders(ctx, sp.market ? [sp.market] : ctx.markets.map((x) => x.code)) : Promise.resolve([]),
    repartir && repartoMarket ? getTargets(ctx, [repartoMarket]) : Promise.resolve([]),
    lead ? getReportOptions(ctx) : Promise.resolve(null),
  ])
  const nodes = treeData.nodes
  // "Visitado por": sugiere el catálogo de vendedores de calle y los nombres ya usados en los mercados de la persona.
  const visitors = tree ? [] : [...new Set((await Promise.all((sp.market ? [sp.market] : live.map((x) => x.code)).map((code) => visitorNames(ctx, code)))).flat())]
  // E9.F12: en mercados con ficha de dealer, el alta pregunta quién reclutó la tienda.
  const dealerMarkets = live.filter((x) => x.dealerRecord && ctx.can('account.create', x.code))
  const recruiters = dealerMarkets.length ? await recruiterChoices(ctx) : []
  const [typeOptions, intake] = ctx.can('account.create') ? await Promise.all([accountTypeOptions(ctx), intakeFields(ctx)]) : [[], []]
  // Canal por defecto de "Nuevo comercio": el del primer embudo del mercado de la persona (en US, Dealers; en México, tiendas).
  const firstPipe = ctx.can('account.create') ? (await marketPipelines(ctx, live.find((x) => ctx.can('account.create', x.code))?.code))[0] : undefined
  const defaultSegment = firstPipe && firstPipe.motor in MOTOR ? firstPipe.motor : 'd2d'
  await track(ctx, 'view.comercios')
  // REP-04: todo dato del archivo de ventas va con su fecha de corte a la vista.
  const cutoff = tree ? null : await salesCutoff(ctx, sp.market)
  const multi = ctx.markets.length > 1
  // El estado de la lista vive en la URL: abrir o cerrar la ficha no pierde filtros, búsqueda ni página.
  const base = { q: sp.q, market: sp.market, lifecycle: sp.lifecycle, owner: sp.owner, kind: sp.kind, ver: sp.ver, vista: sp.vista, after: sp.after, region: sp.region, city: sp.city, territory: sp.territory, team: sp.team, pipeline: sp.pipeline, visito: sp.visito, repartir: repartir ? '1' : undefined }
  const link = (patch: Record<string, string | undefined>) => qs('/comercios', { ...base, ...patch })
  const fichaHref = (id: string, tab?: FichaTab) => link({ ficha: id, tab: tab && tab !== 'hilo' ? tab : undefined })
  const closeHref = link({})
  const filter = (ver?: string) => qs('/comercios', { ...base, lifecycle: undefined, kind: undefined, after: undefined, ver })
  // Filtros por dueño y por plaza. Las opciones salen de lo que la persona alcanza a ver.
  const inMarket = <X extends { market_code: string }>(rows: X[]) => (sp.market ? rows.filter((r) => r.market_code === sp.market) : rows)
  const owners = inMarket(holders).filter((h) => h.owner_id && h.accounts > 0).sort((a, b) => Number(a.current) - Number(b.current) || b.accounts - a.accounts)
  const regions = inMarket(place.regions)
  const territories = inMarket(place.territories)
  const placeOn = !!(sp.region || sp.city || sp.territory || sp.team || sp.pipeline || sp.visito || (sp.owner && sp.owner !== 'me'))
  const teams = options ? inMarket(options.teams) : []
  const pipes = options ? inMarket(options.pipelines) : []
  const ownerTag = (h: { is_active: boolean | null; current: boolean }) => (h.is_active === false ? t(' (inactiva)', ' (inactive)') : !h.current ? t(' (no vende ni opera en este mercado)', ' (does not sell or run operations in this market)') : '')
  const withMarket = (label: string, code: string) => (multi && !sp.market ? `${label} · ${code}` : label)
  const current = sp.ver ?? (sp.lifecycle ? `lc:${sp.lifecycle}` : sp.kind ? `k:${sp.kind}` : '')
  const seg = (on: boolean) => cx('press inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium', on ? 'bg-ink text-white' : 'text-strong hover:bg-green-50')
  const healthCell = (lifecycle: string, hasDeal: boolean) => {
    const h = healthOf(lifecycle, hasDeal)
    return (
      <span className="inline-flex items-center gap-2 text-[15px] text-strong">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: HEALTH_DOT[h] }} />
        {m(`health.${h}` as MessageKey)}
      </span>
    )
  }
  const cols = '@2xl:grid @2xl:grid-cols-[minmax(0,2.1fr)_170px_minmax(0,1fr)_150px] @2xl:items-center @2xl:gap-4'

  return (
    <div className={open ? 'ficha-split' : undefined}>
      <div className="@container min-w-0">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] leading-9 font-semibold">{m('merchants.title')}</h1>
            <p className="mt-1 text-[15px] text-muted">{m('merchants.subtitle')}</p>
          </div>
          {ctx.can('account.create') && (
            <Dialog trigger={t('Nuevo comercio', 'New merchant')} title={t('Nuevo comercio', 'New merchant')} variant="primary" testId="new-account" hash="nuevo">
              <ActionForm action={createAccountAction} className="grid grid-cols-2 gap-4">
                <Field label={t('Mercado', 'Market')}><select name="market" className="input">{live.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
                <Field label={t('Tipo de cuenta', 'Account type')}><select name="kind" className="input" data-testid="account-type">{typeOptions.map((x) => <option key={x.code} value={x.code}>{t(x.label_es, x.label_en)}</option>)}</select></Field>
                <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="name" className="input" required minLength={2} data-testid="account-name" /></Field>
                <Field label={t('Canal', 'Channel')}><select name="segment" className="input" defaultValue={defaultSegment} data-testid="account-segment">{Object.entries(MOTOR).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></Field>
                <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" data-testid="account-phone" /></Field>
                <Field label={t('Ciudad', 'City')}><input name="locality" className="input" /></Field>
                <Field label={t('Estado o región', 'State or region')}><input name="region" className="input" /></Field>
                {place.territories.length > 0 && (
                  <Field label={t('Territorio', 'Territory')} className="col-span-2" hint={t('Si lo dejas así y tienes un solo territorio, el comercio nace con el tuyo.', 'If you leave it like this and you have a single territory, the merchant starts with yours.')}>
                    <select name="territory_id" className="input" data-testid="account-territory"><option value="">{t('Según quien lo crea', 'Based on who creates it')}</option>{place.territories.map((x) => <option key={x.id} value={x.id}>{multi ? `${x.market_code} · ${x.name}` : x.name}</option>)}</select>
                  </Field>
                )}
                {dealerMarkets.length > 0 && (
                  <Field label={t('Reclutado por', 'Recruited by')} className="col-span-2" hint={t(`Para tiendas de ${dealerMarkets.map((x) => x.name).join(', ')}. Queda fijo desde el alta.`, `For stores in ${dealerMarkets.map((x) => x.name).join(', ')}. It is fixed from creation.`)}>
                    <select name="recruited_by" className="input" defaultValue="field_team" data-testid="account-recruiter">
                      <option value="field_team">{t('Equipo de campo de axexo', 'axexo field team')}</option>
                      {recruiters.map((g) => <option key={g.id} value={g.id}>{`${dealerMarkets.length > 1 ? `${g.market_code} · ` : ''}${g.kind === 'agency' ? t('Agencia', 'Agency') : t('Socio', 'Partner')}: ${g.name}`}</option>)}
                    </select>
                  </Field>
                )}
                <IntakeFields defs={intake} locale={locale} legend={t('Para calificar (lo que falte se completa después en la ficha)', 'To qualify (anything missing can be filled in later on the record)')} yes={t('Sí', 'Yes')} no={t('No', 'No')} />
                <label className="col-span-2 flex items-center gap-3 text-[14px] text-muted-2"><input type="checkbox" name="force" className="h-4 w-4" data-testid="account-force" />{t('Crear de todos modos si se parece a uno que ya existe', 'Create anyway if it looks like an existing one')}</label>
                <Field label={t('Si se parece a otro: ¿por qué es un comercio distinto?', 'If it looks like another one: why is it a different merchant?')} className="col-span-2" hint={t('Solo hace falta cuando marcas "Crear de todos modos". Lo revisa quien lidera tu mercado.', 'Only needed when you tick "Create anyway". Your market lead reviews it.')}>
                  <input name="reason" className="input" maxLength={400} data-testid="account-reason" />
                </Field>
                <div className="col-span-2 flex justify-end"><Submit testId="save-account">{t('Guardar comercio', 'Save merchant')}</Submit></div>
              </ActionForm>
            </Dialog>
          )}
        </header>
        <DataTools t={t} canExport={ctx.can('report.export', sp.market)} canImport={ctx.can('data.import')} exportHref={qs('/comercios/export', { ...base, vista: undefined, after: undefined, repartir: undefined })} exportLabel={t('Exportar lo filtrado', 'Export what is filtered')} importHref="/importar?tipo=accounts" />

        {!tree && <Pills
          label={m('merchants.filters')}
          current={current}
          items={[
            { key: '', href: filter(), label: m('merchants.filter.all'), count: data.counts.all },
            { key: 'riesgo', href: filter('riesgo'), label: m('merchants.filter.risk'), count: data.counts.risk },
            { key: 'sin-transaccionar', href: filter('sin-transaccionar'), label: m('merchants.filter.idle'), count: data.counts.idle },
            { key: 'sin-paso', href: filter('sin-paso'), label: m('merchants.filter.nostep'), count: data.counts.nostep },
            // vistas guardadas del equipo; las que repiten un filtro de arriba no se duplican
            ...views.filter((v) => v.name in VIEW_EN && !v.filters.owner && v.filters.lifecycle !== 'at_risk').map((v) => {
              const f = v.filters
              return { key: f.lifecycle ? `lc:${f.lifecycle}` : f.kind ? `k:${f.kind}` : `v:${v.id}`, href: qs('/comercios', { market: sp.market, owner: sp.owner, ...f }), label: t(v.name, VIEW_EN[v.name] ?? v.name) }
            }),
          ]}
        />}

        {!tree && <ViewsSection object="account" filters={{ q: sp.q, market: sp.market, lifecycle: sp.lifecycle, owner: sp.owner, kind: sp.kind, ver: sp.ver, region: sp.region, city: sp.city, territory: sp.territory, team: sp.team, pipeline: sp.pipeline, visito: sp.visito }} current={sp.cola} />}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form action="/comercios" method="get" role="search" className="flex min-w-0 flex-1 basis-64 flex-wrap gap-2">
            <input name="q" defaultValue={sp.q ?? ''} className="input min-w-[200px] flex-1" placeholder={m('merchants.search')} aria-label={m('merchants.searchLabel')} data-testid="account-search" />
            {live.length > 1 && (
              <select name="market" defaultValue={sp.market ?? ''} className="input !w-40" aria-label={t('Mercado', 'Market')}>
                <option value="">{t('Todos los mercados', 'All markets')}</option>
                {live.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
              </select>
            )}
            {(['ver', 'owner', 'vista', 'lifecycle', 'kind', 'region', 'city', 'territory', 'visito'] as const).map((k) => (sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null))}
            {repartir && <input type="hidden" name="repartir" value="1" />}
            <button className="press inline-flex h-11 shrink-0 items-center rounded-[10px] border border-line-2 bg-surface px-4 text-[14px] font-semibold hover:bg-green-50">{m('top.searchLabel')}</button>
          </form>
          <nav aria-label={m('merchants.scope')} className="inline-flex rounded-full border border-line bg-surface p-1" data-testid="scope">
            <Link href={link({ owner: undefined, after: undefined, ficha: undefined })} aria-current={sp.owner !== 'me' ? 'page' : undefined} className={seg(sp.owner !== 'me')}>{m('merchants.scope.all')}</Link>
            <Link href={link({ owner: 'me', after: undefined, ficha: undefined })} aria-current={sp.owner === 'me' ? 'page' : undefined} className={seg(sp.owner === 'me')} data-testid="scope-mine">{m('merchants.scope.mine')}</Link>
          </nav>
          <nav aria-label={m('merchants.views')} className="inline-flex rounded-full border border-line bg-surface p-1" data-testid="views">
            <Link href={link({ vista: undefined, after: undefined, ficha: undefined })} aria-current={!tree ? 'page' : undefined} className={seg(!tree)} data-testid="view-list">{m('merchants.view.list')}</Link>
            <Link href={link({ vista: 'arbol', after: undefined, ficha: undefined })} aria-current={tree ? 'page' : undefined} className={seg(tree)} data-testid="view-tree">{m('merchants.view.tree')}</Link>
            <span aria-disabled="true" title={m('merchants.view.mapSoon')} className="inline-flex h-9 cursor-not-allowed items-center rounded-full px-4 text-[13px] font-medium text-muted" data-testid="view-map">
              {m('merchants.view.map')}
              <span className="sr-only">: {m('merchants.view.mapSoon')}</span>
            </span>
          </nav>
        </div>

        {!tree && (
          <details className="mt-3" open={placeOn || repartir} data-testid="place-filters">
            <summary className="press inline-flex min-h-11 cursor-pointer items-center rounded-[10px] px-3 text-[14px] font-semibold text-strong hover:bg-green-50" data-testid="place-filters-toggle">
              {lead ? t('Filtrar por quién lo lleva, equipo, embudo, plaza o territorio', 'Filter by owner, team, pipeline, place or territory') : wide ? t('Filtrar por quién lo lleva, plaza o territorio', 'Filter by owner, place or territory') : t('Filtrar por plaza o territorio', 'Filter by place or territory')}
            </summary>
            <form action="/comercios" method="get" className="card mt-2 grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="place-form">
              {(['q', 'market', 'ver', 'vista', 'lifecycle', 'kind'] as const).map((k) => (sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null))}
              {repartir && <input type="hidden" name="repartir" value="1" />}
              {wide ? (
                <Field label={t('Quién lo lleva', 'Owner')}>
                  <select name="owner" defaultValue={sp.owner ?? ''} className="input" data-testid="filter-owner">
                    <option value="">{t('Todos', 'All')}</option>
                    <option value="vacant">{t(`Por repartir (${num(inMarket(holders).filter((h) => !h.current).reduce((n, h) => n + h.accounts, 0), locale)})`, `No current owner (${num(inMarket(holders).filter((h) => !h.current).reduce((n, h) => n + h.accounts, 0), locale)})`)}</option>
                    <option value="none">{t(`Sin asignar (${num(inMarket(holders).filter((h) => !h.owner_id).reduce((n, h) => n + h.accounts, 0), locale)})`, `No owner (${num(inMarket(holders).filter((h) => !h.owner_id).reduce((n, h) => n + h.accounts, 0), locale)})`)}</option>
                    {owners.map((h) => <option key={`${h.owner_id}${h.market_code}`} value={h.owner_id!}>{withMarket(`${h.full_name}${ownerTag(h)} (${num(h.accounts, locale)})`, h.market_code)}</option>)}
                    {isUuid(sp.owner) && !owners.some((h) => h.owner_id === sp.owner) && <option value={sp.owner}>{t('La persona elegida', 'The chosen person')}</option>}
                  </select>
                </Field>
              ) : sp.owner ? <input type="hidden" name="owner" value={sp.owner} /> : null}
              {lead && teams.length > 0 ? (
                <Field label={t('Equipo', 'Team')}>
                  <select name="team" defaultValue={sp.team ?? ''} className="input" data-testid="filter-team">
                    <option value="">{t('Todos', 'All')}</option>
                    {teams.map((x) => <option key={x.id} value={x.id}>{withMarket(x.name, x.market_code)}</option>)}
                    <option value="none">{t('Sin equipo', 'No team')}</option>
                  </select>
                </Field>
              ) : sp.team ? <input type="hidden" name="team" value={sp.team} /> : null}
              {lead && pipes.length > 0 ? (
                <Field label={t('Embudo', 'Pipeline')} hint={t('Comercios con un negocio en ese embudo.', 'Merchants with a deal in that pipeline.')}>
                  <select name="pipeline" defaultValue={sp.pipeline ?? ''} className="input" data-testid="filter-pipeline">
                    <option value="">{t('Todos', 'All')}</option>
                    {pipes.map((x) => <option key={x.id} value={x.id}>{withMarket(x.name, x.market_code)}</option>)}
                  </select>
                </Field>
              ) : sp.pipeline ? <input type="hidden" name="pipeline" value={sp.pipeline} /> : null}
              <Field label={t('Región o estado', 'Region or state')}>
                <select name="region" defaultValue={sp.region ?? ''} className="input" data-testid="filter-region">
                  <option value="">{t('Todas', 'All')}</option>
                  {regions.map((r) => <option key={`${r.market_code}${r.region}`} value={r.region}>{withMarket(`${r.region} (${num(r.accounts, locale)})`, r.market_code)}</option>)}
                  {sp.region && !regions.some((r) => r.region === sp.region) && <option value={sp.region}>{sp.region}</option>}
                </select>
              </Field>
              <Field label={t('Ciudad o localidad', 'City or town')}>
                <input name="city" defaultValue={sp.city ?? ''} className="input" maxLength={80} placeholder={t('Escribe una ciudad', 'Type a city')} data-testid="filter-city" />
              </Field>
              <Field label={t('Territorio', 'Territory')}>
                <select name="territory" defaultValue={sp.territory ?? ''} className="input" data-testid="filter-territory">
                  <option value="">{t('Todos', 'All')}</option>
                  <option value="none">{t('Sin territorio', 'No territory')}</option>
                  {territories.map((x) => <option key={x.id} value={x.id}>{withMarket(x.name, x.market_code)}</option>)}
                </select>
              </Field>
              <Field label={t('Visitado por', 'Visited by')}>
                <input name="visito" defaultValue={sp.visito ?? ''} className="input" maxLength={80} list="visited-by-names" placeholder={t('Nombre de quien visitó', 'Name of who visited')} data-testid="filter-visited-by" />
                <datalist id="visited-by-names">{visitors.map((n) => <option key={n} value={n} />)}</datalist>
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
                <button className="press inline-flex h-11 items-center rounded-[10px] border border-line-2 bg-surface px-5 text-[15px] font-semibold hover:bg-green-50" data-testid="place-apply">{t('Aplicar', 'Apply')}</button>
                {placeOn && <Link href={link({ owner: undefined, region: undefined, city: undefined, territory: undefined, team: undefined, pipeline: undefined, visito: undefined, after: undefined, ficha: undefined })} className="inline-flex min-h-11 items-center px-2 text-[14px] font-medium text-blue-text underline" data-testid="place-clear">{t('Quitar estos filtros', 'Clear these filters')}</Link>}
              </div>
            </form>
          </details>
        )}

        {tree ? (
          <div className="card mt-4 overflow-hidden" data-testid="account-tree">
            {nodes.length === 0 ? (
              <p className="px-6 py-10 text-center text-[15px] text-muted">{m('merchants.tree.empty')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {nodes.map((n) => (
                  <li key={n.id} data-testid="tree-row" data-depth={n.depth}>
                    <Link href={fichaHref(n.id, 'arbol')} scroll={false} aria-current={n.id === fichaId ? 'true' : undefined} className={cx('row-hover flex items-center gap-3 py-3 pr-4', n.id === fichaId && 'bg-green-50')} style={{ paddingLeft: 16 + n.depth * 24 }}>
                      <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-medium', n.kind === 'store' ? 'bg-green-100 text-brand-text' : n.kind === 'chain' ? 'bg-mint text-[#0b3d2c]' : 'bg-black text-neon')}>{lab(t, KIND[n.kind])}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-strong">{n.name}</span>
                        {n.children > 0 && <span className="block text-[13px] text-muted">{m('merchants.size.children', { count: n.children })}</span>}
                      </span>
                      <span className="hidden shrink-0 @2xl:inline-flex">{healthCell(n.lifecycle, n.has_deal)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {treeData.cut && <p className="border-t border-line px-4 py-3 text-[13px] text-muted" data-testid="tree-cut">{m('merchants.tree.cut', { count: nodes.length })}</p>}
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-[13px] text-muted" data-testid="account-total">{m('merchants.total', { count: data.total })}</p>
              {repartoMarkets.length > 0 && (
                <Link href={link({ repartir: repartir ? undefined : '1', after: undefined, ficha: undefined, tab: undefined })} className="press inline-flex h-11 items-center rounded-[10px] border border-line-2 bg-surface px-4 text-[14px] font-semibold text-strong hover:bg-green-50" data-testid="reparto-toggle">
                  {repartir ? t('Terminar de repartir', 'Finish distributing') : t('Repartir', 'Distribute')}
                </Link>
              )}
            </div>
            {repartir && (
              <RepartoBar
                key={qs('', { ...base, ficha: undefined })}
                locale={locale}
                market={repartoMarket}
                filter={{ q: sp.q, market: sp.market, lifecycle: sp.lifecycle, owner: sp.owner, kind: sp.kind, ver: sp.ver, region: sp.region, city: sp.city, territory: sp.territory, team: sp.team, pipeline: sp.pipeline, visito: sp.visito }}
                narrowed={narrows(sp)}
                total={data.total}
                people={targets}
                territories={repartoMarket ? place.territories.filter((x) => x.market_code === repartoMarket) : []}
                actions={{ preview: repartoPreviewAction, step: repartoStepAction }}
              />
            )}
            <div className="card mt-2 overflow-hidden">
              {data.items.length === 0 ? (
                <div className="p-6"><Empty title={m('merchants.empty.title')} hint={m('merchants.empty.body')} /></div>
              ) : (
                <>
                  {cutoff && <p className="border-b border-line px-5 py-2 text-[12.5px] text-muted" data-testid="list-asof">{t(`Ventas y última transacción con corte al ${day(cutoff, locale)}, según el archivo diario de ventas.`, `Sales and last transaction as of ${day(cutoff, locale)}, per the daily sales file.`)}</p>}
                  <div aria-hidden className={cx('hidden border-b border-line px-5 py-3 text-[13px] font-medium text-muted', cols, repartir && 'ml-11')}>
                    <span>{m('merchants.col.merchant')}</span><span>{m('merchants.col.health')}</span><span>{m('merchants.col.owner')}</span><span>{m('merchants.col.lastTxn')}</span>
                  </div>
                  <ul className="divide-y divide-line" data-testid="account-table">
                    {data.items.map((a) => (
                      <li key={a.id} data-testid="account-row" className={repartir ? 'flex items-stretch' : undefined}>
                        {repartir && (
                          <label className="flex w-11 shrink-0 cursor-pointer items-center justify-center hover:bg-green-50">
                            <input type="checkbox" data-reparto-row value={a.id} className="h-[18px] w-[18px]" data-testid="reparto-row" />
                            <span className="sr-only">{t(`Marcar ${a.name}`, `Tick ${a.name}`)}</span>
                          </label>
                        )}
                        <Link href={fichaHref(a.id)} scroll={false} aria-current={a.id === fichaId ? 'true' : undefined} className={cx('row-hover block min-w-0 flex-1 px-4 py-3.5 @2xl:px-5', cols, a.id === fichaId && 'bg-green-50', repartir && 'pl-1 @2xl:pl-1')}>
                          <span className="block min-w-0">
                            <span className="block truncate text-[15px] leading-6 font-medium text-strong">{a.name}</span>
                            <span className="block truncate text-[13px] text-muted">
                              {[a.type_es ? t(a.type_es, a.type_en ?? a.type_es) : lab(t, KIND[a.kind]), a.kind !== 'store' ? m('merchants.size.children', { count: a.children }) : a.parent_name ? m('merchants.size.under', { name: a.parent_name }) : a.account_type === 'store' ? null : m('merchants.size.independent'), a.locality, a.territory, multi ? a.market_code : null].filter(Boolean).join(' · ')}
                            </span>
                            {/* En teléfono la columna de dueño no cabe: quien ve comercios de varias personas lo lee aquí. */}
                            {wide && <span className="block truncate text-[13px] text-muted @2xl:hidden" data-testid="row-owner">{a.owner_name ? `${a.owner_name}${a.owner_current ? '' : t(' · por repartir', ' · no current owner')}` : a.parent_name ? m('merchants.viaChain') : m('merchants.noOwner')}</span>}
                          </span>
                          <span className="mt-1.5 block @2xl:mt-0">{healthCell(a.lifecycle, a.has_deal)}</span>
                          <span className={cx('hidden min-w-0 text-[15px] @2xl:block', a.owner_name ? 'text-strong' : a.parent_name ? 'text-muted' : 'text-amber-text')}>
                            <span className="block truncate">{a.owner_name ?? (a.parent_name ? m('merchants.viaChain') : m('merchants.noOwner'))}</span>
                            {a.owner_name && !a.owner_current && <span className="block truncate text-[13px] text-amber-text" data-testid="owner-vacant">{t('Por repartir', 'No current owner')}</span>}
                          </span>
                          <span className="hidden text-[15px] text-muted-2 @2xl:block">{a.last_txn_at ? ago(a.last_txn_at, locale) : m('merchants.never')}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {data.next && <div className="mt-5 flex justify-center"><LinkButton href={link({ after: data.next, ficha: undefined, tab: undefined })} testId="more">{m('merchants.more')}</LinkButton></div>}
          </>
        )}
      </div>

      {open && fichaId && (
        <>
          <Link href={closeHref} scroll={false} aria-hidden tabIndex={-1} className="ficha-veil" data-testid="ficha-veil" />
          <FichaPanel id={fichaId} closeHref={closeHref} label={open.account.name}>
            <Ficha ctx={ctx} data={open} tab={fichaTab(sp.tab)} mode="panel" href={fichaHref} closeHref={closeHref} />
          </FichaPanel>
        </>
      )}
    </div>
  )
}
