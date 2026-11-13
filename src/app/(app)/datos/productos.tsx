import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { expansionList, productMatrix } from '@/dal/datos'
import { PRODUCT_STATUSES } from '@/domain/gobierno'
import { Badge, Card, CardTitle, Empty, Field, Table, buttonClass, NoData } from '@/ui/kit'
import { Submit } from '@/ui/client'
import { NoticeForm } from '@/ui/admin'
import { ago, num } from '@/lib/format'
import { lab, qs } from '@/lib/labels'
import { PRODUCT_STATUS, PRODUCT_TONE } from '@/lib/datos-labels'
import { openExpansionDealsAction, setProductEntityAction, setProductProviderAction, setProviderSlaAction } from './actions'

/**
 * DAT-07: productos por comercio. Qué producto tiene cada comercio y en qué va con su proveedor, con el reloj del proveedor
 * aparte del de quien vende. Es el mismo registro que Operaciones marca en el negocio ("Aprobación por proveedor").
 */
export async function ProductosTab({ ctx, market, provider, status, late, without }: { ctx: Ctx; market: string | null; provider: string | null; status: string | null; late: boolean; without: string | null }) {
  const { t, locale } = ctx
  const st = status && (PRODUCT_STATUSES as readonly string[]).includes(status) ? status : null
  const d = await productMatrix(ctx, { market, provider, status: st, late })
  const admin = ctx.can('config.manage')
  const markets = ctx.markets.filter((m) => m.status === 'live')
  const filtered = !!(market || provider || st || late)
  const expansion = without ? await expansionList(ctx, without) : null
  // DAT-07 (datos2): de la base de expansión se abren negocios. Lo hace quien trabaja expansión en el mercado del producto.
  const canExpand = !!expansion && (expansion.product.market_code ? ctx.can('expansion.work', expansion.product.market_code) : ctx.can('expansion.work'))

  return (
    <div className="space-y-8" data-testid="products-tab">
      <Card pad={false} data-testid="providers-card">
        <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Proveedores y su plazo de respuesta', 'Providers and their response deadline')} hint={t('Cada proveedor tiene su propio reloj: cuántos días puede tardar en responder una solicitud. Pasado ese plazo, la solicitud se marca fuera de plazo. Los proveedores se dan de alta en Administración, Operaciones.', 'Each provider has its own clock: how many days it may take to answer a request. Past that, the request is flagged as past its deadline. Providers are added under Administration, Operations.')} /></div>
        {d.providers.length === 0 ? <div className="px-5 pb-6 md:px-7 md:pb-7"><Empty title={t('Sin proveedores', 'No providers')} hint={t('Agrega el primero en Administración, Operaciones.', 'Add the first one under Administration, Operations.')} /></div> : (
          <Table label={t('Proveedores', 'Providers')} head={<><th>{t('Proveedor', 'Provider')}</th><th>{t('Mercado', 'Market')}</th><th>{t('Esperando respuesta', 'Awaiting an answer')}</th><th>{t('Fuera de plazo', 'Past deadline')}</th><th>{t('Plazo en días', 'Deadline in days')}</th></>}>
            {d.providers.map((p) => (
              <tr key={p.id} className="table-row" data-testid="provider-row">
                <td className="font-semibold text-strong">{t(p.label_es, p.label_en)}</td>
                <td>{p.market_code ?? t('Todos', 'All')}</td>
                <td className="num">{p.waiting > 0 ? <Link href={qs('/datos', { tab: 'productos', proveedor: p.id, estado: 'submitted' })} className="inline-flex min-h-11 items-center font-semibold text-blue-text underline">{num(p.waiting, locale)}</Link> : 0}</td>
                <td className="num">{p.late > 0 ? <Link href={qs('/datos', { tab: 'productos', proveedor: p.id, plazo: 'vencido' })} className="inline-flex min-h-11 items-center font-semibold text-red-text underline" data-testid="provider-late">{num(p.late, locale)}</Link> : 0}</td>
                <td>
                  {admin ? (
                    <NoticeForm action={setProviderSlaAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="sla_days" type="number" min={1} max={120} className="input !w-20" defaultValue={p.sla_days ?? ''} aria-label={t(`Plazo de ${p.label_es} en días`, `Deadline for ${p.label_en} in days`)} data-testid="provider-sla" />
                      <Submit variant="quiet" size="sm" testId="provider-sla-save">{t('Guardar', 'Save')}</Submit>
                    </NoticeForm>
                  ) : p.sla_days ? t(`${p.sla_days} días`, `${p.sla_days} days`) : <span className="text-muted">{t('Sin plazo', 'No deadline')}</span>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card pad={false} data-testid="catalog-card">
        <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Catálogo de productos', 'Product catalog')} hint={t('Cada producto es de un mercado y lo entrega un proveedor. Los productos se dan de alta en Administración, Operaciones.', 'Each product belongs to a market and is delivered by a provider. Products are added under Administration, Operations.')} /></div>
        {d.products.length === 0 ? <div className="px-5 pb-6 md:px-7 md:pb-7"><Empty title={t('Sin productos', 'No products')} hint={t('Agrega el primero en Administración, Operaciones.', 'Add the first one under Administration, Operations.')} /></div> : (
          <Table label={t('Catálogo de productos', 'Product catalog')} head={<><th>{t('Producto', 'Product')}</th><th>{t('Mercado', 'Market')}</th><th>{t('Proveedor', 'Provider')}</th><th>{t('Entidad legal', 'Legal entity')}</th><th>{t('Comercios que lo tienen', 'Merchants that have it')}</th><th>{t('Activos que no lo tienen', 'Active ones without it')}</th></>}>
            {d.products.map((p) => {
              const options = d.providers.filter((k) => !k.market_code || !p.market_code || k.market_code === p.market_code)
              const current = d.providers.find((k) => k.id === p.provider_id)
              return (
                <tr key={p.id} className="table-row" data-testid="product-row">
                  <td className="font-semibold text-strong">{p.name}</td>
                  <td>{p.market_code ?? t('Todos', 'All')}</td>
                  <td>
                    {admin ? (
                      <NoticeForm action={setProductProviderAction} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <select name="provider_id" className="input !w-auto" defaultValue={p.provider_id ?? ''} aria-label={t(`Proveedor de ${p.name}`, `Provider for ${p.name}`)} data-testid="product-provider"><option value="">{t('Sin proveedor', 'No provider')}</option>{options.map((k) => <option key={k.id} value={k.id}>{t(k.label_es, k.label_en)}</option>)}</select>
                        <Submit variant="quiet" size="sm" testId="product-provider-save">{t('Guardar', 'Save')}</Submit>
                      </NoticeForm>
                    ) : current ? t(current.label_es, current.label_en) : <NoData locale={locale} />}
                  </td>
                  <td>
                    {admin ? (
                      <NoticeForm action={setProductEntityAction} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <select name="legal_entity_id" className="input !w-auto" defaultValue={p.legal_entity_id ?? ''} aria-label={t(`Entidad legal de ${p.name}`, `Legal entity for ${p.name}`)} data-testid="product-entity"><option value="">{t('Sin entidad', 'No entity')}</option>{d.entities.filter((e) => !p.market_code || e.market_code === p.market_code).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
                        <Submit variant="quiet" size="sm" testId="product-entity-save">{t('Guardar', 'Save')}</Submit>
                      </NoticeForm>
                    ) : d.entities.find((e) => e.id === p.legal_entity_id)?.name ?? <NoData locale={locale} />}
                  </td>
                  <td className="num">{num(p.merchants, locale)}</td>
                  <td className="num">{p.without > 0 ? <Link href={`${qs('/datos', { tab: 'productos', sin: p.id })}#expansion`} className="inline-flex min-h-11 items-center font-semibold text-blue-text underline" data-testid="product-without">{num(p.without, locale)}</Link> : 0}</td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      {expansion && (
        <Card pad={false} id="expansion" data-testid="expansion-card">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t(`A quién ofrecerle ${expansion.product.name}`, `Who to offer ${expansion.product.name} to`)} hint={t('Comercios activos que todavía no lo tienen ni lo tienen en trámite, primero los que más venden.', 'Active merchants that do not have it yet and have no request in progress, best sellers first.')} /></div>
          {expansion.rows.length === 0 ? <div className="px-5 pb-6 md:px-7 md:pb-7"><Empty title={t('Todos los comercios activos ya lo tienen', 'Every active merchant already has it')} hint={t('Cuando se active un comercio nuevo, aparece aquí.', 'When a new merchant becomes active, it shows here.')} /></div> : (
            <NoticeForm action={openExpansionDealsAction} testId="expansion-form">
            <input type="hidden" name="product_id" value={expansion.product.id} />
            <Table label={t('Comercios para ofrecer el producto', 'Merchants to offer the product to')} head={<><th>{canExpand ? <span className="sr-only">{t('Elegir', 'Pick')}</span> : null}</th><th>{t('Comercio', 'Merchant')}</th><th>{t('Ciudad', 'City')}</th><th>{t('Quién lo lleva', 'Owner')}</th><th>{t('Ventas en 30 días', 'Sales in 30 days')}</th></>}>
              {expansion.rows.map((r) => (
                <tr key={r.id} className="table-row" data-testid="expansion-row">
                  <td>{canExpand && <label className="flex min-h-11 min-w-11 items-center justify-center"><input type="checkbox" name="account_id" value={r.id} className="h-5 w-5" aria-label={t(`Elegir ${r.name}`, `Pick ${r.name}`)} data-testid="expansion-pick" /></label>}</td>
                  <td><Link href={`/comercios/${r.id}`} className="inline-flex min-h-11 items-center font-semibold text-blue-text underline">{r.name}</Link></td>
                  <td className="text-[13.5px]">{r.locality ?? <NoData locale={locale} />}</td>
                  <td className="text-[13.5px]">{r.owner_name ?? <span className="text-amber-text">{t('Sin asignar', 'Unassigned')}</span>}</td>
                  <td className="num">{r.txn_30d === null ? <NoData locale={locale} /> : num(r.txn_30d, locale)}</td>
                </tr>
              ))}
            </Table>
            {canExpand && <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-4 md:px-7"><span className="text-[13px] text-muted">{t('Cada negocio queda a nombre de quien lleva el comercio, con el producto pedido en la matriz.', 'Each deal is owned by whoever owns the merchant, with the product requested in the matrix.')}</span><Submit size="sm" testId="expansion-open">{t('Abrir negocios de expansión', 'Open expansion deals')}</Submit></div>}
            </NoticeForm>
          )}
          {expansion.rows.length >= 100 && <p className="px-5 py-4 text-[13px] text-muted md:px-7">{t('Se muestran los primeros 100.', 'Showing the first 100.')}</p>}
        </Card>
      )}

      <Card pad={false} data-testid="matrix-card">
        <div className="px-5 pt-6 md:px-7 md:pt-7">
          <CardTitle title={t('Productos por comercio', 'Products by merchant')} hint={t('Filtra por mercado, proveedor y estado. El detalle y los cambios se hacen en la ficha del comercio, en Datos.', 'Filter by market, provider and status. Details and changes happen on the merchant record, under Details.')} />
          <form method="get" action="/datos" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="matrix-filter">
            <input type="hidden" name="tab" value="productos" />
            <Field label={t('Mercado', 'Market')}><select name="mercado" className="input" defaultValue={market ?? ''}><option value="">{t('Todos', 'All')}</option>{markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
            <Field label={t('Proveedor', 'Provider')}><select name="proveedor" className="input" defaultValue={provider ?? ''} data-testid="matrix-provider"><option value="">{t('Todos', 'All')}</option>{d.providers.map((k) => <option key={k.id} value={k.id}>{t(k.label_es, k.label_en)}</option>)}</select></Field>
            <Field label={t('Estado', 'Status')}><select name="estado" className="input" defaultValue={st ?? ''} data-testid="matrix-status"><option value="">{t('Todos', 'All')}</option>{PRODUCT_STATUSES.map((k) => <option key={k} value={k}>{t(...PRODUCT_STATUS[k]!)}</option>)}</select></Field>
            <Field label={t('Plazo', 'Deadline')}><select name="plazo" className="input" defaultValue={late ? 'vencido' : ''}><option value="">{t('Cualquiera', 'Any')}</option><option value="vencido">{t('Fuera de plazo', 'Past deadline')}</option></select></Field>
            <div className="flex items-end"><button className={buttonClass('ghost')} data-testid="matrix-apply">{t('Filtrar', 'Filter')}</button></div>
          </form>
        </div>
        {d.rows.length === 0 ? (
          <div className="px-5 pb-6 md:px-7 md:pb-7"><Empty title={filtered ? t('Ningún comercio con ese filtro', 'No merchants match that filter') : t('Todavía ningún comercio tiene productos registrados', 'No merchant has products on record yet')}
            hint={t('Un producto entra aquí cuando Operaciones lo registra en la ficha del comercio o marca el estado de un proveedor en un negocio.', 'A product lands here when Operations logs it on the merchant record or sets a provider status on a deal.')} /></div>
        ) : (
          <Table testId="matrix-table" label={t('Productos por comercio', 'Products by merchant')} head={<><th>{t('Comercio', 'Merchant')}</th><th>{t('Producto', 'Product')}</th><th>{t('Proveedor', 'Provider')}</th><th>{t('Estado', 'Status')}</th><th>{t('Desde', 'Since')}</th></>}>
            {d.rows.map((r) => (
              <tr key={r.id} className="table-row" data-testid="matrix-row">
                <td><Link href={`/comercios/${r.account_id}?tab=datos`} className="inline-flex min-h-11 items-center font-semibold text-blue-text underline">{r.account_name}</Link>{ctx.markets.length > 1 && <span className="ml-2 text-[13px] text-muted">{r.market_code}</span>}</td>
                <td>{r.product_name ?? <span className="text-muted">{t('Alta con el proveedor', 'Provider sign-up')}</span>}</td>
                <td>{r.provider_es ? t(r.provider_es, r.provider_en ?? r.provider_es) : <NoData locale={locale} />}</td>
                <td><Badge tone={PRODUCT_TONE[r.status]}>{lab(t, PRODUCT_STATUS[r.status], r.status)}</Badge>{r.late && <span className="ml-2"><Badge tone="bad">{t('Fuera de plazo', 'Past deadline')}</Badge></span>}</td>
                <td className="text-[13.5px] text-muted-2">{ago(r.status_at, locale)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
