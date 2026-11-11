import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { getAccount, listAccounts, listTree, savedViews, type AccountFilters } from '@/dal/accounts'
import { track } from '@/dal/boards'
import { Empty, Field, LinkButton, Pills, cx } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { FichaPanel } from '@/ui/panel'
import { ago } from '@/lib/format'
import { HEALTH_DOT, healthOf } from '@/lib/health'
import { KIND, MOTOR, lab, qs } from '@/lib/labels'
import type { MessageKey } from '@/lib/messages'
import { createAccountAction } from './actions'
import { Ficha, fichaTab, type FichaTab } from './ficha'

type Params = AccountFilters & { vista?: string; ficha?: string; tab?: string }

export default async function ComerciosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireCtx()
  const { t, m, locale } = ctx
  const sp = await searchParams
  const tree = sp.vista === 'arbol'
  const fichaId = sp.ficha && /^[0-9a-f-]{36}$/.test(sp.ficha) ? sp.ficha : null
  const [data, views, nodes, open] = await Promise.all([
    listAccounts(ctx, sp),
    savedViews(ctx, 'account'),
    tree ? listTree(ctx, { market: sp.market }) : Promise.resolve([]),
    fichaId ? getAccount(ctx, fichaId) : Promise.resolve(null),
  ])
  await track(ctx, 'view.comercios')
  const live = ctx.markets.filter((x) => x.status === 'live')
  const multi = ctx.markets.length > 1
  // El estado de la lista vive en la URL: abrir o cerrar la ficha no pierde filtros, búsqueda ni página.
  const base = { q: sp.q, market: sp.market, lifecycle: sp.lifecycle, owner: sp.owner, kind: sp.kind, ver: sp.ver, vista: sp.vista, after: sp.after }
  const link = (patch: Record<string, string | undefined>) => qs('/comercios', { ...base, ...patch })
  const fichaHref = (id: string, tab?: FichaTab) => link({ ficha: id, tab: tab && tab !== 'hilo' ? tab : undefined })
  const closeHref = link({})
  const filter = (ver?: string) => qs('/comercios', { q: sp.q, market: sp.market, owner: sp.owner, vista: sp.vista, ver })
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
                <Field label={t('Tipo', 'Type')}><select name="kind" className="input">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></Field>
                <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="name" className="input" required minLength={2} data-testid="account-name" /></Field>
                <Field label={t('Canal', 'Channel')}><select name="segment" className="input">{Object.entries(MOTOR).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></Field>
                <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" data-testid="account-phone" /></Field>
                <Field label={t('Ciudad', 'City')}><input name="locality" className="input" /></Field>
                <Field label={t('Estado o región', 'State or region')}><input name="region" className="input" /></Field>
                <label className="col-span-2 flex items-center gap-3 text-[14px] text-muted-2"><input type="checkbox" name="force" className="h-4 w-4" data-testid="account-force" />{t('Crear de todos modos si se parece a uno que ya existe', 'Create anyway if it looks like an existing one')}</label>
                <div className="col-span-2 flex justify-end"><Submit testId="save-account">{t('Guardar comercio', 'Save merchant')}</Submit></div>
              </ActionForm>
            </Dialog>
          )}
        </header>

        <Pills
          label={m('merchants.filters')}
          current={current}
          items={[
            { key: '', href: filter(), label: m('merchants.filter.all'), count: data.counts.all },
            { key: 'riesgo', href: filter('riesgo'), label: m('merchants.filter.risk'), count: data.counts.risk },
            { key: 'sin-transaccionar', href: filter('sin-transaccionar'), label: m('merchants.filter.idle'), count: data.counts.idle },
            { key: 'sin-paso', href: filter('sin-paso'), label: m('merchants.filter.nostep'), count: data.counts.nostep },
            // vistas guardadas del equipo; las que repiten un filtro de arriba no se duplican
            ...views.filter((v) => !v.filters.owner && v.filters.lifecycle !== 'at_risk').map((v) => {
              const f = v.filters
              return { key: f.lifecycle ? `lc:${f.lifecycle}` : f.kind ? `k:${f.kind}` : `v:${v.id}`, href: qs('/comercios', { market: sp.market, owner: sp.owner, ...f }), label: v.name }
            }),
          ]}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form action="/comercios" method="get" role="search" className="flex min-w-0 flex-1 basis-64 flex-wrap gap-2">
            <input name="q" defaultValue={sp.q ?? ''} className="input min-w-[200px] flex-1" placeholder={m('merchants.search')} aria-label={m('merchants.searchLabel')} data-testid="account-search" />
            {live.length > 1 && (
              <select name="market" defaultValue={sp.market ?? ''} className="input !w-40" aria-label={t('Mercado', 'Market')}>
                <option value="">{t('Todos los mercados', 'All markets')}</option>
                {live.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
              </select>
            )}
            {(['ver', 'owner', 'vista', 'lifecycle', 'kind'] as const).map((k) => (sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null))}
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
          </div>
        ) : (
          <>
            <p className="mt-4 text-[13px] text-muted" data-testid="account-total">{m('merchants.total', { count: data.total })}</p>
            <div className="card mt-2 overflow-hidden">
              {data.items.length === 0 ? (
                <div className="p-6"><Empty title={m('merchants.empty.title')} hint={m('merchants.empty.body')} /></div>
              ) : (
                <>
                  <div aria-hidden className={cx('hidden border-b border-line px-5 py-3 text-[13px] font-medium text-muted', cols)}>
                    <span>{m('merchants.col.merchant')}</span><span>{m('merchants.col.health')}</span><span>{m('merchants.col.owner')}</span><span>{m('merchants.col.lastTxn')}</span>
                  </div>
                  <ul className="divide-y divide-line" data-testid="account-table">
                    {data.items.map((a) => (
                      <li key={a.id} data-testid="account-row">
                        <Link href={fichaHref(a.id)} scroll={false} aria-current={a.id === fichaId ? 'true' : undefined} className={cx('row-hover block px-4 py-3.5 @2xl:px-5', cols, a.id === fichaId && 'bg-green-50')}>
                          <span className="block min-w-0">
                            <span className="block truncate text-[15px] leading-6 font-medium text-strong">{a.name}</span>
                            <span className="block truncate text-[13px] text-muted">
                              {[lab(t, KIND[a.kind]), a.kind !== 'store' ? m('merchants.size.children', { count: a.children }) : a.parent_name ? m('merchants.size.under', { name: a.parent_name }) : m('merchants.size.independent'), a.locality, multi ? a.market_code : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span className="mt-1.5 block @2xl:mt-0">{healthCell(a.lifecycle, a.has_deal)}</span>
                          <span className={cx('hidden truncate text-[15px] @2xl:block', a.owner_name ? 'text-strong' : a.parent_name ? 'text-muted' : 'text-amber-text')}>{a.owner_name ?? (a.parent_name ? m('merchants.viaChain') : m('merchants.noOwner'))}</span>
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
