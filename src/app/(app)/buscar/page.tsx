import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireCtx } from '@/server/context'
import { searchAll } from '@/dal/accounts'
import { Empty } from '@/ui/kit'
import { HEALTH_DOT, healthOf } from '@/lib/health'
import { LEAD_STATUS, lab } from '@/lib/labels'
import type { MessageKey } from '@/lib/messages'
import { flat } from '@/server/params'

/** Buscar (handoff, sección 6): por nombre, persona, teléfono con o sin lada, ID y el ID que el comercio tiene en otros sistemas. */
export default async function BuscarPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx()
  const { t, m } = ctx
  const q = (flat(await searchParams).q ?? '').slice(0, 80).trim()
  const r = await searchAll(ctx, q)
  const none = r.accounts.length + r.leads.length + r.deals.length === 0
  const group = (title: string, count: number) => (
    <h2 className="mb-2 flex items-baseline gap-2 text-[15px] leading-6 font-semibold">{title}<span className="num text-[13px] font-normal text-muted">{count}</span></h2>
  )
  const row = 'row-hover flex items-center justify-between gap-4 px-4 py-3.5 md:px-5'
  return (
    <div className="mx-auto max-w-[760px]">
      <header className="mb-5">
        <h1 className="text-[28px] leading-9 font-semibold">{q ? m('search.results', { q }) : m('search.title')}</h1>
        <p className="mt-1 text-[15px] text-muted">{m('search.hint')}</p>
      </header>
      <form action="/buscar" method="get" role="search" className="relative mb-7">
        <Search size={18} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
        <input name="q" type="search" defaultValue={q} className="input !pl-11" placeholder={m('top.search')} aria-label={m('top.searchLabel')} data-testid="search-input" />
      </form>
      {q.length < 2 ? (
        <p className="text-[15px] text-muted">{m('search.start')}</p>
      ) : none ? (
        <Empty title={m('search.empty.title')} hint={m('search.empty.body')} />
      ) : (
        <div className="space-y-8">
          {r.accounts.length > 0 && (
            <section data-testid="search-accounts">
              {group(m('search.merchants'), r.accounts.length)}
              <ul className="card divide-y divide-line overflow-hidden">
                {r.accounts.map((a) => {
                  const h = healthOf(a.lifecycle, a.has_deal)
                  return (
                    <li key={a.id}>
                      <Link href={`/comercios/${a.id}`} className={row} data-testid="search-hit">
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-medium text-strong">{a.name}</span>
                          <span className="block truncate text-[13px] text-muted">{[a.locality, ctx.markets.length > 1 ? a.market_code : null, a.via].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-2 text-[14px] text-strong">
                          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: HEALTH_DOT[h] }} />
                          {m(`health.${h}` as MessageKey)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          {r.leads.length > 0 && (
            <section data-testid="search-leads">
              {group(m('search.leads'), r.leads.length)}
              <ul className="card divide-y divide-line overflow-hidden">
                {r.leads.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className={row}>
                      <span className="min-w-0 truncate text-[15px] font-medium text-strong">{l.business_name}</span>
                      <span className="shrink-0 text-[13px] text-muted">{lab(t, LEAD_STATUS[l.status]?.label)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {r.deals.length > 0 && (
            <section data-testid="search-deals">
              {group(m('search.deals'), r.deals.length)}
              <ul className="card divide-y divide-line overflow-hidden">
                {r.deals.map((d) => (
                  <li key={d.id}>
                    <Link href={`/deals/${d.id}`} className={row}>
                      <span className="min-w-0 truncate text-[15px] font-medium text-strong">{d.title}</span>
                      <span className="shrink-0 text-[13px] text-muted">{d.status === 'open' ? t('Abierto', 'Open') : d.status === 'won' ? t('Ganado', 'Won') : t('Perdido', 'Lost')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
