import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getConsolidated, type ConsolidatedCut } from '@/dal/markets'
import { Card, CardTitle, Empty, PageHeader, Pills, Stat } from '@/ui/kit'
import { day, money, num } from '@/lib/format'
import { qs } from '@/lib/labels'
import { flat } from '@/server/params'

const CUTS: ConsolidatedCut[] = ['market', 'entity', 'unit']

/**
 * Consolidado en USD (MULTI-01, E1.F10): los negocios con monto, en su moneda y convertidos. Cada mercado sigue viendo
 * su moneda en la ficha y en el embudo; aquí se suman en USD con UNA regla: la tasa que quedó guardada en cada negocio
 * (la del día para los abiertos, la del cierre para los ganados). Se puede cortar por mercado, entidad legal o unidad de negocio.
 */
export default async function ConsolidatedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx()
  if (!ctx.can('board.lt')) notFound()
  const { t, locale } = ctx
  const sp = flat(await searchParams)
  const status = sp.ver === 'ganados' ? 'won' : 'open'
  const cut: ConsolidatedCut = CUTS.includes(sp.por as ConsolidatedCut) ? (sp.por as ConsolidatedCut) : 'market'
  const market = ctx.markets.some((m) => m.code === sp.mercado) ? sp.mercado : undefined
  const data = await getConsolidated(ctx, { status, cut, market })
  const base = { ver: status === 'won' ? 'ganados' : undefined, por: cut === 'market' ? undefined : cut, mercado: market }
  const cutLabel: Record<ConsolidatedCut, string> = { market: t('Mercado', 'Market'), entity: t('Entidad legal', 'Legal entity'), unit: t('Unidad de negocio', 'Business unit') }
  const usd = (minor: string | null) => (minor === null ? null : money(Number(minor), 'USD', locale))

  return (
    <>
      <PageHeader
        title={t('Consolidado en USD', 'Consolidated in USD')}
        desc={t('Los negocios con monto, en su moneda y en USD. Cada negocio usa la tasa que quedó guardada en él: la del día si sigue abierto, la del día de cierre si ya se ganó.', 'Deals with an amount, in their own currency and in USD. Each deal uses the rate stored on it: today’s if it is still open, the close date’s if it was won.')}
      />
      <div className="mb-4 flex flex-wrap gap-x-8 gap-y-3">
        <Pills label={t('Qué negocios', 'Which deals')} current={status} items={[
          { key: 'open', href: qs('/reportes/consolidado', { ...base, ver: undefined }), label: t('Abiertos (pronóstico)', 'Open (forecast)') },
          { key: 'won', href: qs('/reportes/consolidado', { ...base, ver: 'ganados' }), label: t('Ganados', 'Won') },
        ]} />
        <Pills label={t('Cortar por', 'Cut by')} current={cut} items={CUTS.map((c) => ({ key: c, href: qs('/reportes/consolidado', { ...base, por: c === 'market' ? undefined : c }), label: cutLabel[c] }))} />
        {ctx.markets.length > 1 && (
          <Pills label={t('Mercado', 'Market')} current={market ?? 'all'} items={[{ key: 'all', href: qs('/reportes/consolidado', { ...base, mercado: undefined }), label: t('Todos', 'All') },
            ...ctx.markets.filter((m) => m.status === 'live').map((m) => ({ key: m.code, href: qs('/reportes/consolidado', { ...base, mercado: m.code }), label: m.name }))]} />
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 desk:grid-cols-4" data-testid="consolidated-top">
        <Stat testId="consolidated-total" label={status === 'open' ? t('Abierto, en USD', 'Open, in USD') : t('Ganado, en USD', 'Won, in USD')} value={usd(data.total_usd_minor) ?? t('Sin tasa', 'No rate')} />
        <Stat testId="consolidated-deals" label={t('Negocios con monto', 'Deals with an amount')} value={num(data.deals, locale)} />
        <Stat testId="consolidated-unconverted" label={t('Sin convertir', 'Not converted')} value={num(data.unconverted, locale)} tone={data.unconverted > 0 ? 'warn' : undefined}
          hint={data.unconverted > 0 ? t('No hay tasa cargada para su fecha. No entran al total en USD.', 'No rate is loaded for their date. They are left out of the USD total.') : t('Todos tienen su tasa guardada.', 'All of them have their rate stored.')} />
      </div>

      <Card pad={false} data-testid="consolidated-card">
        <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t(`Por ${cutLabel[cut].toLowerCase()} y moneda`, `By ${cutLabel[cut].toLowerCase()} and currency`)} hint={t('Monto original y convertido, con las fechas de las tasas usadas y de dónde salen.', 'Original and converted amount, with the dates of the rates used and where they come from.')} /></div>
        {data.rows.length === 0 ? (
          <div className="px-5 pb-6 md:px-7"><Empty title={t('No hay negocios con monto en este corte', 'No deals with an amount in this cut')} hint={t('El monto se captura en el negocio. Cambia de "Abiertos" a "Ganados" o quita el filtro de mercado.', 'The amount is entered on the deal. Switch between "Open" and "Won" or clear the market filter.')} /></div>
        ) : (
          <ul className="divide-y divide-line" data-testid="consolidated-rows">
            {data.rows.map((r) => (
              <li key={`${r.key}${r.currency}`} className="grid grid-cols-1 gap-x-6 gap-y-1 px-5 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] md:items-baseline md:px-7" data-testid="consolidated-row" data-currency={r.currency}>
                <p className="min-w-0 text-[15px] font-semibold text-strong [overflow-wrap:anywhere]">{r.label || t('Sin unidad de negocio', 'No business unit')} <span className="num font-normal text-muted-2">· {t(`${num(r.deals, locale)} ${r.deals === 1 ? 'negocio' : 'negocios'}`, `${num(r.deals, locale)} ${r.deals === 1 ? 'deal' : 'deals'}`)}</span></p>
                <p className="num text-[14.5px] text-strong" data-testid="row-original"><span className="text-[12.5px] text-muted md:hidden">{t('Original: ', 'Original: ')}</span>{money(Number(r.amount_minor), r.currency, locale)}</p>
                <p className="num text-[14.5px] font-semibold text-strong" data-testid="row-usd"><span className="text-[12.5px] font-normal text-muted md:hidden">{t('En USD: ', 'In USD: ')}</span>{usd(r.usd_minor) ?? t('Sin tasa', 'No rate')}
                  {status === 'open' && r.weighted_usd_minor !== null && <span className="block text-[12.5px] font-normal text-muted-2" data-testid="row-weighted">{t(`Ponderado por etapa: ${usd(r.weighted_usd_minor)}`, `Weighted by stage: ${usd(r.weighted_usd_minor)}`)}</span>}
                </p>
                <p className="text-[13px] text-muted-2" data-testid="row-rate">
                  {r.currency === 'USD' ? t('Ya está en USD: no se convierte.', 'Already in USD: no conversion.')
                    : r.rate_from ? t(`Tasas del ${day(r.rate_from, locale)}${r.rate_to && r.rate_to !== r.rate_from ? ` al ${day(r.rate_to, locale)}` : ''}. Fuente: ${r.sources.join(', ') || 's/d'}.`, `Rates dated ${day(r.rate_from, locale)}${r.rate_to && r.rate_to !== r.rate_from ? ` to ${day(r.rate_to, locale)}` : ''}. Source: ${r.sources.join(', ') || 'n/a'}.`)
                    : t('Sin tasa cargada para estas fechas.', 'No rate loaded for these dates.')}
                  {r.unconverted > 0 && <span className="block font-medium text-amber-text">{t(`${num(r.unconverted, locale)} sin convertir: administración carga la tasa de esa fecha.`, `${num(r.unconverted, locale)} not converted: administration loads the rate for that date.`)}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-4 text-[13px] text-muted" data-testid="consolidated-rule">{t('Una sola regla para sumar: nunca se mezcla la tasa guardada en el negocio con la tasa de hoy. Un negocio ganado conserva la tasa de su día de cierre aunque después se cargue otra.', 'One rule to add things up: the rate stored on the deal is never mixed with today’s rate. A won deal keeps the rate of its close date even if another is loaded later.')}</p>
    </>
  )
}
