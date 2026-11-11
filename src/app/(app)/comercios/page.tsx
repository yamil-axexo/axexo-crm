import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { listAccounts, savedViews } from '@/dal/accounts'
import { track } from '@/dal/boards'
import { Badge, Card, Empty, Field, LinkButton, PageHeader, Pills, Table } from '@/ui/kit'
import { ActionForm, Dialog, Submit } from '@/ui/client'
import { ago, num } from '@/lib/format'
import { KIND, LIFECYCLE, MOTOR, lab, qs } from '@/lib/labels'
import { createAccountAction } from './actions'

export default async function ComerciosPage({ searchParams }: { searchParams: Promise<{ q?: string; market?: string; lifecycle?: string; owner?: string; kind?: string; after?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const sp = await searchParams
  const [data, views] = await Promise.all([listAccounts(ctx, sp), savedViews(ctx, 'account')])
  await track(ctx, 'view.comercios')
  const live = ctx.markets.filter((m) => m.status === 'live')
  const base = { q: sp.q, market: sp.market, lifecycle: sp.lifecycle, owner: sp.owner, kind: sp.kind }
  const link = (patch: Record<string, string | undefined>) => qs('/comercios', { ...base, ...patch })
  const viewKey = sp.lifecycle ? `lc:${sp.lifecycle}` : sp.owner ? `ow:${sp.owner}` : sp.kind ? `k:${sp.kind}` : ''

  return (
    <>
      <PageHeader
        title={t('Comercios', 'Merchants')}
        desc={t('La cuenta es el centro: su árbol, sus contactos, sus IDs en otros sistemas y todo lo que ha pasado con ella.', 'The account is the center: its tree, its contacts, its IDs in other systems and everything that has happened with it.')}
        actions={
          ctx.can('account.create') ? (
            <Dialog trigger={t('Nuevo comercio', 'New merchant')} title={t('Nuevo comercio', 'New merchant')} variant="primary" testId="new-account" hash="nuevo">
              <ActionForm action={createAccountAction} className="grid grid-cols-2 gap-4">
                <Field label={t('Mercado', 'Market')}><select name="market" className="input">{live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
                <Field label={t('Tipo', 'Type')}><select name="kind" className="input">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></Field>
                <Field label={t('Nombre', 'Name')} className="col-span-2"><input name="name" className="input" required minLength={2} data-testid="account-name" /></Field>
                <Field label={t('Canal', 'Channel')}><select name="segment" className="input">{Object.entries(MOTOR).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></Field>
                <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" data-testid="account-phone" /></Field>
                <Field label={t('Ciudad', 'City')}><input name="locality" className="input" /></Field>
                <Field label={t('Estado o región', 'State or region')}><input name="region" className="input" /></Field>
                <label className="col-span-2 flex items-center gap-3 text-[13.5px] text-muted-2"><input type="checkbox" name="force" className="h-4 w-4" data-testid="account-force" />{t('Crear de todos modos si se parece a uno que ya existe', 'Create anyway if it looks like an existing one')}</label>
                <div className="col-span-2 flex justify-end"><Submit testId="save-account">{t('Guardar comercio', 'Save merchant')}</Submit></div>
              </ActionForm>
            </Dialog>
          ) : undefined
        }
      />

      <form action="/comercios" method="get" className="mb-5 flex flex-wrap items-center gap-3">
        <input name="q" defaultValue={sp.q ?? ''} className="input !w-80" placeholder={t('Nombre, teléfono o ID externo', 'Name, phone or external ID')} aria-label={t('Buscar comercios', 'Search merchants')} data-testid="account-search" />
        {live.length > 1 && (
          <select name="market" defaultValue={sp.market ?? ''} className="input !w-48" aria-label={t('Mercado', 'Market')}>
            <option value="">{t('Todos los mercados', 'All markets')}</option>
            {live.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>
        )}
        {sp.lifecycle && <input type="hidden" name="lifecycle" value={sp.lifecycle} />}
        {sp.owner && <input type="hidden" name="owner" value={sp.owner} />}
        <button className="inline-flex h-11 items-center rounded-full border border-line-2 bg-surface px-5 text-[14px] font-semibold">{t('Buscar', 'Search')}</button>
      </form>

      <Pills
        label={t('Vistas', 'Views')}
        current={viewKey}
        items={[
          { key: '', href: qs('/comercios', { q: sp.q, market: sp.market }), label: t('Todos', 'All') },
          { key: 'ow:me', href: qs('/comercios', { market: sp.market, owner: 'me' }), label: t('Mi cartera', 'My book') },
          { key: 'k:parents', href: qs('/comercios', { market: sp.market, kind: 'parents' }), label: t('Cadenas y distribuidores', 'Chains and distributors') },
          ...views.map((v) => {
            const f = v.filters
            const key = f.lifecycle ? `lc:${f.lifecycle}` : f.owner ? `ow:${f.owner}` : `v:${v.id}`
            return { key, href: qs('/comercios', { market: sp.market, ...f }), label: v.name }
          }),
        ]}
      />

      <p className="mt-5 text-[13px] text-muted" data-testid="account-total">{t(`${num(data.total, locale)} comercios en esta vista`, `${num(data.total, locale)} merchants in this view`)}</p>
      <Card className="mt-3" pad={false}>
        {data.items.length === 0 ? (
          <div className="p-7"><Empty title={t('Nada con esos filtros', 'Nothing matches those filters')} hint={t('Busca por otro nombre, por teléfono o por el ID que tiene en la Sales App.', 'Search by another name, by phone or by its Sales App ID.')} /></div>
        ) : (
          <Table testId="account-table" head={<><th>{t('Comercio', 'Merchant')}</th><th>{t('Etapa de vida', 'Lifecycle')}</th><th>{t('Dueño', 'Owner')}</th><th>{t('Ventas 30 días', 'Sales, 30 days')}</th><th>{t('Última venta', 'Last sale')}</th></>}>
            {data.items.map((a) => (
              <tr key={a.id} className="table-row row-hover" data-testid="account-row">
                <td>
                  <Link href={`/comercios/${a.id}`} className="block">
                    <span className="block font-semibold text-strong">{a.name}</span>
                    <span className="text-[13px] text-muted-2">
                      {[a.kind !== 'store' ? `${lab(t, KIND[a.kind])} · ${t(`${a.children} hijos`, `${a.children} children`)}` : null, a.parent_name ? t(`de ${a.parent_name}`, `under ${a.parent_name}`) : null, a.locality, a.market_code].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                </td>
                <td><Badge tone={LIFECYCLE[a.lifecycle]?.tone}>{lab(t, LIFECYCLE[a.lifecycle]?.label)}</Badge></td>
                <td>{a.owner_name ?? (a.parent_name ? <span className="text-muted">{t('Por su cadena', 'Via its chain')}</span> : <Badge tone="warn">{t('Sin dueño', 'No owner')}</Badge>)}</td>
                <td className="num">{a.txn_count_30d === null ? '—' : num(a.txn_count_30d, locale)}</td>
                <td className="text-[13.5px] text-muted-2">{a.last_txn_at ? ago(a.last_txn_at, locale) : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {data.next && <div className="mt-6 flex justify-center"><LinkButton href={link({ after: data.next })} testId="more">{t('Ver más', 'Load more')}</LinkButton></div>}
    </>
  )
}
