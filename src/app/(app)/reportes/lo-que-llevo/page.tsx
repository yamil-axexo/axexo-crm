import { getCarry } from '@/dal/reportes'
import { isUuid } from '@/lib/ids'
import { Card, CardTitle, NoData } from '@/ui/kit'
import { Def, Metric, ReportFilters } from '@/ui/report'
import { qs } from '@/lib/labels'
import { day, num, pct } from '@/lib/format'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader } from '../shell'

/**
 * CANAL-05: "Lo que llevo". Los números de la cartera de una persona que alimentan su incentivo: altas, primeras ventas y
 * tiendas que siguen vendiendo a 30, 60 y 90 días. Aquí no hay montos de comisión ni lugar en una tabla: el pago lo calcula otro sistema.
 */
export default async function CarryPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('lo-que-llevo', searchParams)
  const { ctx, period, sel, owners, options } = r
  const { t, locale } = ctx
  // Quien dirige puede ver lo que lleva una persona de su alcance; quien vende ve lo suyo.
  const picked = ctx.can('report.view') && isUuid(r.sp.persona) && options.people.some((p) => p.id === r.sp.persona) ? r.sp.persona : undefined
  const ownerId = picked ?? ctx.user.id
  const who = picked ? options.people.find((p) => p.id === picked)!.full_name : null
  const c = await getCarry(ctx, period, ownerId)
  const params = { ...r.params, persona: picked, mercado: undefined, embudo: undefined, equipo: undefined }
  return (
    <>
      <ReportHeader r={{ ...r, params }} desc={who ? t(`Lo que lleva ${who}: altas, primeras ventas y tiendas que siguen vendiendo.`, `What ${who} is carrying: enrolled stores, first sales and stores still selling.`) : undefined} />
      <ReportFilters t={t} locale={locale} base="/reportes/lo-que-llevo" params={params} period={period.first} selects={ctx.can('report.view') ? [{ ...sel.owner, all: t('Yo', 'Me'), options: sel.owner.options.filter((o) => o.value !== 'none') }] : []} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="carry-top">
        <Metric t={t} k="carryStores" value={num(c.stores, locale)} owners={owners} testId="carry-stores" href={picked ? undefined : qs('/comercios', { owner: 'me', kind: 'store' })} />
        <Metric t={t} k="carryFirstSales" value={num(c.first_sales, locale)} tone="good" owners={owners} testId="carry-first" />
      </div>
      <Card className="mt-6" data-testid="carry-active">
        <CardTitle title={t('Siguen vendiendo', 'Still selling')} hint={c.as_of ? t(`Según el archivo diario de ventas, con corte al ${day(c.as_of, locale)}.`, `Per the daily sales file, cutoff ${day(c.as_of, locale)}.`) : t('Todavía no hay archivo de ventas para tu cartera.', 'There is no sales file for your book yet.')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {c.windows.map((w) => (
            <div key={w.days} className="rounded-[14px] border border-line p-4" data-testid={`carry-${w.days}`}>
              <p className="text-[13px] font-medium text-muted-2">{t(`A ${w.days} días`, `At ${w.days} days`)}</p>
              <p className="num mt-1 text-[24px] leading-8 font-semibold text-strong">{w.judged === 0 ? <NoData locale={locale} /> : <>{num(w.active, locale)}<span className="text-[15px] font-medium text-muted"> {t('de', 'of')} {num(w.judged, locale)}</span></>}</p>
              <p className="text-[13px] text-muted">{w.judged === 0 ? t('Ninguna tienda del periodo llega todavía a esa fecha.', 'No store from the period has reached that date yet.') : pct(w.active, w.judged, locale)}</p>
            </div>
          ))}
        </div>
        <Def t={t} k="carryActive" owners={owners} />
      </Card>
      <p role="note" className="mt-5 rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong" data-testid="carry-note">
        {t('Estos son los números que alimentan tu incentivo. CONTIGO no calcula el pago ni muestra montos: eso lo calcula otro sistema, con las reglas que publican Ventas y Finanzas. Si un número de aquí no te cuadra, repórtalo antes del cierre.', 'These are the numbers that feed your incentive. CONTIGO does not calculate the payout or show amounts: another system does that, under the rules Sales and Finance publish. If a number here looks off, report it before the close.')}
      </p>
    </>
  )
}
