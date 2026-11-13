import type { Ctx } from '@/server/context'
import { teamStoreSales } from '@/dal/store-sales'
import { Card, CardTitle, Empty } from '@/ui/kit'
import { day, money, num } from '@/lib/format'

type Rep = { id: string; full_name: string; market_code: string }

/**
 * E5.F2: en Mi equipo, por persona, lo que dicen las cifras de ventas por tienda del último corte: activaciones del mes
 * a la fecha y del mes anterior, y volumen de pago del mes. Sin actividad se ve vacío, no en cero.
 */
export async function TeamStoreSales({ ctx, reps }: { ctx: Ctx; reps: Rep[] }) {
  const { t, locale } = ctx
  const byMarket = new Map<string, Rep[]>()
  for (const r of reps) byMarket.set(r.market_code, [...(byMarket.get(r.market_code) ?? []), r])
  const sums = new Map<string, Awaited<ReturnType<typeof teamStoreSales>>>()
  for (const [mk, rs] of byMarket) sums.set(mk, await teamStoreSales(ctx, mk, rs.map((r) => r.id)))
  const rows = reps.map((r) => ({ r, s: sums.get(r.market_code)?.get(r.id) ?? null }))
  const any = rows.some((x) => x.s)
  const asOf = rows.map((x) => x.s?.as_of).filter(Boolean).sort().pop()
  const empty = <span className="sr-only">{t('Sin actividad', 'No activity')}</span>
  return (
    <Card pad={false} data-testid="team-store-sales">
      <div className="px-5 pt-6 md:px-7 md:pt-7">
        <CardTitle
          title={t('Ventas por tienda del equipo', 'Team store sales')}
          hint={t('Suma de las tiendas que lleva cada persona, con el último archivo de cifras por tienda: activaciones de todos los carriers y volumen de pago. Vacío: sin actividad.', 'Sum of the stores each person owns, from the latest store figures file: activations across all carriers and payment volume. Empty: no activity.')}
        />
      </div>
      {!any ? <div className="p-7"><Empty title={t('Todavía no llegan cifras por tienda', 'No store figures yet')} /></div> : (
        <div className="overflow-x-auto px-5 pb-6 md:px-7">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] font-semibold text-muted-2">
                <th scope="col" className="py-2 pr-3">{t('Persona', 'Person')}</th>
                <th scope="col" className="py-2 pr-3 text-right">{t('Tiendas con cifras', 'Stores with figures')}</th>
                <th scope="col" className="py-2 pr-3 text-right">{t('Activaciones, mes a la fecha', 'Activations, month to date')}</th>
                <th scope="col" className="py-2 pr-3 text-right">{t('Activaciones, mes anterior', 'Activations, previous month')}</th>
                <th scope="col" className="py-2 text-right">{t('Pagos, mes a la fecha', 'Payments, month to date')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, s }) => (
                <tr key={`${r.id}-${r.market_code}`} className="border-b border-line" data-testid="team-store-sales-row">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-strong">{r.full_name}</th>
                  <td className="num py-2 pr-3 text-right">{s ? num(s.stores, locale) : empty}</td>
                  <td className="num py-2 pr-3 text-right">{s?.activations_mtd ? num(s.activations_mtd, locale) : empty}</td>
                  <td className="num py-2 pr-3 text-right">{s?.activations_prev_month ? num(s.activations_prev_month, locale) : empty}</td>
                  <td className="num py-2 text-right">{s?.payments_mtd && s.currency ? money(s.payments_mtd, s.currency, locale, true) : empty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {asOf && <p className="mt-2 text-[13px] text-muted">{t(`Corte al ${day(asOf, locale)}.`, `As of ${day(asOf, locale)}.`)}</p>}
        </div>
      )}
    </Card>
  )
}
