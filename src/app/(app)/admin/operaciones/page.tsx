import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getOpsConfig } from '@/dal/ops'
import { Card, CardTitle, Field, PageHeader } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { pipelineFlagsAction, saveCatalogAction, saveProductAction } from '@/app/(app)/operaciones/actions'

/** Lo que administración mantiene para Operaciones: propiedades de embudos y etapas, productos y catálogos por mercado. */
export default async function OpsConfigPage() {
  const ctx = await requireCtx()
  const { t } = ctx
  if (!ctx.can('config.manage')) notFound()
  const cfg = await getOpsConfig(ctx)
  const markets = ctx.markets
  const KINDS = [
    { kind: 'provider', title: t('Proveedores (carriers)', 'Providers (carriers)'), hint: t('Cada negocio lleva el estado de aprobación por proveedor.', 'Each deal carries the approval status per provider.') },
    { kind: 'document', title: t('Documentos requeridos', 'Required documents'), hint: t('Del documento se guarda el estado y un enlace a dónde está, nunca el archivo.', 'For each document we keep the status and a link to where it is, never the file.') },
    { kind: 'return_reason', title: t('Motivos de devolución a Ventas', 'Reasons to send back to Sales'), hint: t('Sin mercado: vale en todos.', 'No market: applies to all.') },
  ] as const

  return (
    <>
      <p className="mb-3"><Link href="/admin" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="ops-config-back">{t('Volver a Administración', 'Back to Administration')}</Link></p>
      <PageHeader eyebrow={t('Administración', 'Administration')} title={t('Operaciones', 'Operations')}
        desc={t('Embudos de pedidos, etapas de Operaciones, productos y catálogos. Todo cambio queda en la bitácora.', 'Order pipelines, Operations stages, products and catalogs. Every change is logged.')} />
      <div className="space-y-8">
        <Card data-testid="ops-pipelines">
          <CardTitle title={t('Embudos y etapas', 'Pipelines and stages')}
            hint={t('Un embudo de pedidos admite varios negocios abiertos por comercio y lleva líneas de producto. En una etapa de Operaciones el negocio pasa a su cola y solo Operaciones lo avanza.', 'An order pipeline allows several open deals per merchant and carries product lines. In an Operations stage the deal moves to their queue and only Operations moves it forward.')} />
          <div className="divide-y divide-line">
            {cfg.pipelines.map((p) => (
              <ActionForm key={p.id} action={pipelineFlagsAction} className="py-4" testId="ops-pipeline">
                <input type="hidden" name="pipeline_id" value={p.id} />
                <p className="text-[15px] font-semibold text-strong">{p.market_code} · {p.name}</p>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                  <label className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="multi_open" defaultChecked={p.multi_open} className="h-5 w-5" />{t('Admite varios negocios abiertos por comercio', 'Allows several open deals per merchant')}</label>
                  <label className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="has_items" defaultChecked={p.has_items} className="h-5 w-5" />{t('Lleva líneas de producto', 'Carries product lines')}</label>
                </div>
                <fieldset className="mt-2">
                  <legend className="text-[13px] font-medium text-muted-2">{t('Etapas de Operaciones', 'Operations stages')}</legend>
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    {cfg.stages.filter((s) => s.pipeline_id === p.id).map((s) => (
                      <label key={s.id} className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="ops_stage" value={s.id} defaultChecked={s.is_ops} className="h-5 w-5" />{t(s.name_es, s.name_en)}</label>
                    ))}
                  </div>
                </fieldset>
                <div className="mt-2 flex justify-end"><Submit variant="ghost" size="sm" testId="ops-pipeline-save">{t('Guardar', 'Save')}</Submit></div>
              </ActionForm>
            ))}
          </div>
        </Card>

        <Card data-testid="ops-products">
          <CardTitle title={t('Productos', 'Products')} hint={t('Catálogo por mercado, con precio unitario en la moneda del mercado.', 'Catalog per market, with the unit price in the market’s currency.')} />
          <ul className="divide-y divide-line">
            {cfg.products.map((p) => (
              <li key={p.id} className="py-3" data-testid="ops-product">
                <ActionForm action={saveProductAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="market" value={p.market_code} />
                  <span className="inline-flex h-11 items-center text-[13px] font-semibold text-muted-2">{p.market_code}</span>
                  <input name="name" aria-label={t('Nombre del producto', 'Product name')} className="input !w-auto min-w-[180px] flex-1" defaultValue={p.name} />
                  <input name="price" aria-label={t('Precio unitario', 'Unit price')} className="input !w-28" inputMode="decimal" defaultValue={p.unit_price_minor ? String(Number(p.unit_price_minor) / 100) : '0'} />
                  <label className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="active" defaultChecked={p.is_active} className="h-5 w-5" />{t('Activo', 'Active')}</label>
                  <Submit variant="ghost" size="sm">{t('Guardar', 'Save')}</Submit>
                </ActionForm>
              </li>
            ))}
          </ul>
          <ActionForm action={saveProductAction} onOk="reset" className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 md:grid-cols-[120px_minmax(0,1fr)_140px_auto] md:items-end" testId="ops-product-new">
            <Field label={t('Mercado', 'Market')}><select name="market" className="input">{markets.map((mk) => <option key={mk.code} value={mk.code}>{mk.code}</option>)}</select></Field>
            <Field label={t('Producto nuevo', 'New product')}><input name="name" className="input" required minLength={2} maxLength={120} data-testid="product-name" /></Field>
            <Field label={t('Precio unitario', 'Unit price')}><input name="price" className="input" inputMode="decimal" required data-testid="product-price" /></Field>
            <div className="col-span-2 flex justify-end md:col-span-1"><Submit testId="product-add">{t('Agregar', 'Add')}</Submit></div>
          </ActionForm>
        </Card>

        {KINDS.map((k) => (
          <Card key={k.kind} data-testid={`ops-catalog-${k.kind}`}>
            <CardTitle title={k.title} hint={k.hint} />
            <ul className="divide-y divide-line">
              {cfg.catalog.filter((c) => c.kind === k.kind).map((c) => (
                <li key={c.id} className="py-3">
                  <ActionForm action={saveCatalogAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="kind" value={c.kind} />
                    <span className="inline-flex h-11 min-w-8 items-center text-[13px] font-semibold text-muted-2">{c.market_code ?? t('Todos', 'All')}</span>
                    <input name="label_es" aria-label={t('Nombre en español', 'Name in Spanish')} className="input !w-auto min-w-[160px] flex-1" defaultValue={c.label_es} />
                    <input name="label_en" aria-label={t('Nombre en inglés', 'Name in English')} className="input !w-auto min-w-[160px] flex-1" defaultValue={c.label_en} />
                    <label className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="active" defaultChecked={c.is_active} className="h-5 w-5" />{t('Activo', 'Active')}</label>
                    <Submit variant="ghost" size="sm">{t('Guardar', 'Save')}</Submit>
                  </ActionForm>
                </li>
              ))}
            </ul>
            <ActionForm action={saveCatalogAction} onOk="reset" className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <input type="hidden" name="kind" value={k.kind} />
              <Field label={t('Mercado', 'Market')}>
                <select name="market" className="input">
                  {k.kind === 'return_reason' && <option value="">{t('Todos', 'All')}</option>}
                  {markets.map((mk) => <option key={mk.code} value={mk.code}>{mk.code}</option>)}
                </select>
              </Field>
              <Field label={t('Nombre en español', 'Name in Spanish')}><input name="label_es" className="input" required minLength={2} maxLength={80} data-testid={`catalog-es-${k.kind}`} /></Field>
              <Field label={t('Nombre en inglés', 'Name in English')}><input name="label_en" className="input" required minLength={2} maxLength={80} data-testid={`catalog-en-${k.kind}`} /></Field>
              <div className="col-span-2 flex justify-end md:col-span-1"><Submit testId={`catalog-add-${k.kind}`}>{t('Agregar', 'Add')}</Submit></div>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  )
}
