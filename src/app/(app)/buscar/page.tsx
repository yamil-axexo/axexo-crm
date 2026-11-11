import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { searchAll } from '@/dal/accounts'
import { Badge, Card, CardTitle, Empty, PageHeader } from '@/ui/kit'
import { LEAD_STATUS, LIFECYCLE, lab } from '@/lib/labels'

export default async function BuscarPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx()
  const { t } = ctx
  const q = ((await searchParams).q ?? '').slice(0, 80)
  const r = await searchAll(ctx, q)
  const none = r.accounts.length + r.leads.length + r.deals.length === 0
  return (
    <>
      <PageHeader title={t(`Resultados para "${q}"`, `Results for "${q}"`)} desc={t('Busca en comercios (nombre, teléfono, ID externo), leads y deals que tu rol puede ver.', 'Searches merchants (name, phone, external ID), leads and deals your role can see.')} />
      {none ? (
        <Empty title={t('Sin resultados', 'No results')} hint={t('Prueba con menos letras o con el ID de la Sales App.', 'Try fewer letters or the Sales App ID.')} />
      ) : (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
          <Card className="xl:col-span-2" data-testid="search-accounts">
            <CardTitle title={t('Comercios', 'Merchants')} />
            <ul className="-mx-2">
              {r.accounts.map((a) => (
                <li key={a.id}>
                  <Link href={`/comercios/${a.id}`} className="row-hover flex items-center justify-between gap-4 rounded-2xl px-3 py-3" data-testid="search-hit">
                    <span><span className="block font-semibold text-strong">{a.name}</span><span className="text-[13px] text-muted-2">{[a.locality, a.market_code, a.via].filter(Boolean).join(' · ')}</span></span>
                    <Badge tone={LIFECYCLE[a.lifecycle]?.tone}>{lab(t, LIFECYCLE[a.lifecycle]?.label)}</Badge>
                  </Link>
                </li>
              ))}
              {r.accounts.length === 0 && <li className="px-3 text-[14px] text-muted">—</li>}
            </ul>
          </Card>
          <div className="space-y-8">
            <Card>
              <CardTitle title="Leads" />
              <ul className="space-y-2">{r.leads.map((l) => <li key={l.id}><Link href={`/leads/${l.id}`} className="text-[14px] font-medium text-strong underline">{l.business_name}</Link> <span className="text-[12.5px] text-muted">{lab(t, LEAD_STATUS[l.status]?.label)}</span></li>)}{r.leads.length === 0 && <li className="text-[14px] text-muted">—</li>}</ul>
            </Card>
            <Card>
              <CardTitle title="Deals" />
              <ul className="space-y-2">{r.deals.map((d) => <li key={d.id}><Link href={`/deals/${d.id}`} className="text-[14px] font-medium text-strong underline">{d.title}</Link></li>)}{r.deals.length === 0 && <li className="text-[14px] text-muted">—</li>}</ul>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
