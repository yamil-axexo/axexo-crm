import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { flat } from '@/server/params'
import { contactList } from '@/dal/reportes2'
import { Card, Empty, PageHeader, buttonClass } from '@/ui/kit'
import { DataTable, linkClass } from '@/ui/reportes'
import { qs } from '@/lib/labels'
import { ViewsSection } from '../views-section'

const ROLE: Record<string, [string, string]> = {
  owner: ['Dueño del comercio', 'Owner'], decision_maker: ['Quien decide', 'Decision-maker'], manager: ['Encargado', 'Manager'], staff: ['Personal', 'Staff'], billing: ['Pagos', 'Billing'],
}

/**
 * E8.F4 (reportes2): la lista de personas de los comercios, con vistas guardadas por equipo como las demás listas.
 * Sin teléfonos ni correos en la lista (se ven en la ficha del comercio, con su consentimiento).
 */
export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; market?: string; role?: string; owner?: string; cola?: string }> }) {
  const ctx = await requireCtx()
  if (!ctx.can('view.save')) notFound()
  const { t } = ctx
  const sp = flat(await searchParams)
  const role = sp.role && sp.role in ROLE ? sp.role : undefined
  const market = ctx.markets.some((m) => m.code === sp.market) ? sp.market : undefined
  const rows = await contactList(ctx, { q: sp.q, market, role, owner: sp.owner === 'me' ? 'me' : undefined })
  const filters = { q: sp.q, market, role, owner: sp.owner === 'me' ? 'me' : undefined }
  return (
    <>
      <PageHeader title={t('Personas de los comercios', 'Merchant contacts')} desc={t('Quién es quién en cada comercio: el dueño del comercio, quien decide, el encargado. Guarda una vista para tu equipo con los filtros que uses.', 'Who is who at each merchant: owner, decision-maker, manager. Save a view for your team with the filters you use.')} />
      <ViewsSection object="contact" filters={filters} current={sp.cola} />
      <form method="get" action="/personas" className="mb-5 flex flex-wrap items-end gap-3" data-testid="contacts-filters">
        <label className="block"><span className="mb-1 block text-[12.5px] font-semibold text-muted-2">{t('Buscar', 'Search')}</span><input name="q" className="input !h-11 !w-56" defaultValue={sp.q ?? ''} maxLength={60} data-testid="contacts-q" /></label>
        <label className="block"><span className="mb-1 block text-[12.5px] font-semibold text-muted-2">{t('Papel', 'Role')}</span>
          <select name="role" className="input !h-11 !w-auto" defaultValue={role ?? ''} data-testid="contacts-role"><option value="">{t('Todos', 'All')}</option>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></label>
        {ctx.markets.length > 1 && (
          <label className="block"><span className="mb-1 block text-[12.5px] font-semibold text-muted-2">{t('Mercado', 'Market')}</span>
            <select name="market" className="input !h-11 !w-auto" defaultValue={market ?? ''}><option value="">{t('Todos', 'All')}</option>{ctx.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></label>
        )}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px]"><input type="checkbox" name="owner" value="me" defaultChecked={sp.owner === 'me'} className="h-5 w-5" />{t('Solo de mis comercios', 'Only my merchants')}</label>
        <button className={buttonClass("ghost")} data-testid="contacts-apply">{t('Filtrar', 'Filter')}</button>
      </form>
      <Card pad={false}>
        <DataTable testId="contacts-table" label={t('Personas de los comercios', 'Merchant contacts')}
          empty={<div className="p-7"><Empty title={t('Nadie con estos filtros', 'No one with these filters')} hint={t('Las personas se agregan en la ficha del comercio.', 'People are added on the merchant record.')} /></div>}
          head={[{ label: t('Persona', 'Person') }, { label: t('Papel', 'Role') }, { label: t('Comercio', 'Merchant') }, { label: t('Quién lo lleva', 'Owner') }, { label: t('Datos de contacto', 'Contact details') }]}
          rows={rows.map((r) => ({ key: `${r.id}${r.account_id}`, testId: 'contact-row', cells: [
            <span key="n" className="font-semibold">{r.full_name}</span>, ROLE[r.role] ? t(ROLE[r.role]![0], ROLE[r.role]![1]) : r.role,
            <Link key="a" href={`/comercios/${r.account_id}`} className={linkClass}>{r.account}</Link>, r.owner_name ?? t('Sin persona asignada', 'No one assigned'),
            [r.has_phone ? t('teléfono', 'phone') : null, r.has_email ? t('correo', 'email') : null].filter(Boolean).join(', ') || t('ninguno', 'none'),
          ] }))} />
      </Card>
      {rows.length === 200 && <p className="mt-3 text-[13px] text-muted">{t('Se muestran las primeras 200. Usa un filtro para acotar.', 'The first 200 are shown. Use a filter to narrow it down.')} <Link href={qs('/personas', {})} className={linkClass}>{t('Quitar filtros', 'Clear filters')}</Link></p>}
    </>
  )
}
