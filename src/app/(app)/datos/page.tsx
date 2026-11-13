import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { PageHeader, Pills } from '@/ui/kit'
import { NoticeArea } from '@/ui/admin'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'
import { CalidadTab } from './calidad'
import { DuplicadosTab } from './duplicados'
import { CamposTab, fieldView } from './campos'
import { CatalogosTab } from './catalogos'
import { ProductosTab } from './productos'

const TABS = ['calidad', 'duplicados', 'campos', 'productos', 'catalogos'] as const
type Tab = (typeof TABS)[number]

/**
 * Datos: la pantalla de quien cuida la calidad y la identidad de los registros. Calidad de datos (GOB-02), duplicados y
 * fusiones (DAT-04), registro de campos (GOB-01, DAT-05), productos por comercio (DAT-07) y catálogos que antes pedían
 * una migración: mercados, formularios, turnos, sistemas de ID, niveles del árbol y listas de proceso.
 */
export default async function DatosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx()
  const { t } = ctx
  const sp = flat(await searchParams)
  const sees: Record<Tab, boolean> = {
    calidad: ctx.can('data.quality'),
    // La cola la lee quien ve todo el mercado (RLS); decide quien lidera o administra.
    duplicados: ctx.can('duplicate.review') || ctx.isGlobal || ctx.can('alias.manage'),
    campos: ctx.can('field.propose') || ctx.can('config.manage') || ctx.isGlobal,
    productos: ctx.can('account.products') || ctx.can('field.propose') || ctx.isGlobal,
    catalogos: ctx.can('config.manage') || ctx.can('process.define'),
  }
  const allowed = TABS.filter((k) => sees[k])
  if (allowed.length === 0) notFound()
  const tab: Tab = allowed.includes(sp.tab as Tab) ? (sp.tab as Tab) : allowed[0]!
  const labels: Record<Tab, string> = {
    calidad: t('Calidad de datos', 'Data quality'),
    duplicados: t('Duplicados', 'Duplicates'),
    campos: t('Campos', 'Fields'),
    productos: t('Productos por comercio', 'Products by merchant'),
    catalogos: t('Mercados y catálogos', 'Markets and catalogs'),
  }
  const markets = ctx.markets.filter((m) => m.status === 'live')
  const market = markets.find((m) => m.code === sp.mercado)?.code ?? null
  return (
    <>
      <PageHeader title={t('Datos', 'Data')} desc={t('Aquí se cuida que cada comercio exista una sola vez, con sus datos completos y al día. Cada cambio queda en la bitácora.', 'This is where each merchant is kept as one record, complete and up to date. Every change is logged.')} />
      <div className="mb-8"><Pills label={t('Secciones', 'Sections')} current={tab} items={allowed.map((k) => ({ key: k, href: qs('/datos', { tab: k }), label: labels[k] }))} /></div>
      <NoticeArea closeLabel={t('Cerrar aviso', 'Dismiss notice')}>
        {tab === 'calidad' && <CalidadTab ctx={ctx} market={market} team={sp.equipo ?? null} rule={sp.regla ?? null} />}
        {tab === 'duplicados' && <DuplicadosTab ctx={ctx} market={market} pairId={/^[0-9a-f-]{36}$/.test(sp.par ?? '') ? sp.par! : null} />}
        {tab === 'campos' && <CamposTab ctx={ctx} view={fieldView(sp.vista)} />}
        {tab === 'productos' && <ProductosTab ctx={ctx} market={market} provider={/^[0-9a-f-]{36}$/.test(sp.proveedor ?? '') ? sp.proveedor! : null} status={sp.estado ?? null} late={sp.plazo === 'vencido'} without={/^[0-9a-f-]{36}$/.test(sp.sin ?? '') ? sp.sin! : null} />}
        {tab === 'catalogos' && <CatalogosTab ctx={ctx} />}
      </NoticeArea>
    </>
  )
}
