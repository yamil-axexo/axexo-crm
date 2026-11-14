import type { Ctx } from '@/server/context'
import { storeSales, type SalesLine } from '@/dal/store-sales'
import { day, money, num } from '@/lib/format'

/**
 * E5.F2: activaciones por carrier y volumen de pago por producto de la tienda, con el corte del archivo de cada noche.
 * Un carrier o producto sin actividad se ve vacío, no en cero.
 */
export async function StoreSalesSection({ ctx, accountId }: { ctx: Ctx; accountId: string }) {
  const { t, locale } = ctx
  const s = await storeSales(ctx, accountId)
  const acts = s?.lines.filter((l) => l.line_kind === 'activations') ?? []
  const pays = s?.lines.filter((l) => l.line_kind === 'payments') ?? []
  const empty = <span className="sr-only">{t('Sin actividad', 'No activity')}</span>
  const cell = (l: SalesLine, v: number | null) => (v === null ? empty : l.line_kind === 'payments' ? money(v, l.currency ?? 'USD', locale, true) : num(v, locale))
  const table = (rows: SalesLine[], head: string, testId: string) => (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-[14px]" data-testid={testId}>
        <thead>
          <tr className="border-b border-line text-left text-[12.5px] font-semibold text-muted-2">
            <th scope="col" className="py-2 pr-3">{head}</th>
            <th scope="col" className="py-2 pr-3 text-right">{t('Mes a la fecha', 'Month to date')}</th>
            <th scope="col" className="py-2 pr-3 text-right">{t('Mes anterior', 'Previous month')}</th>
            <th scope="col" className="py-2 text-right">{t('90 días', '90 days')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.line_key} className="border-b border-line" data-testid={`${testId}-row`}>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-strong">{l.line_key}</th>
              <td className="num py-2 pr-3 text-right text-strong">{cell(l, l.mtd)}</td>
              <td className="num py-2 pr-3 text-right text-strong">{cell(l, l.prev_month)}</td>
              <td className="num py-2 text-right text-strong">{cell(l, l.d90)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <section className="border-t border-line pt-6" data-testid="store-sales">
      <h3 className="text-[16px] font-semibold text-strong">{t('Ventas de la tienda', 'Store sales')}</h3>
      {!s ? (
        <p className="mt-2 text-[14px] text-muted" data-testid="store-sales-empty">{t('Todavía no llegan cifras de esta tienda. Llegan cada noche en el archivo de ventas, por su Merchant ID.', 'No figures for this store yet. They arrive every night in the sales file, by its Merchant ID.')}</p>
      ) : (
        <>
          {acts.length > 0 && table(acts, t('Activaciones por carrier', 'Activations by carrier'), 'store-sales-activations')}
          {pays.length > 0 && table(pays, t('Volumen de pago por producto', 'Payment volume by product'), 'store-sales-payments')}
          <p className="mt-2 text-[13px] text-muted" data-testid="store-sales-asof">{t(`Corte al ${day(s.as_of, locale)}. Vacío: sin actividad.`, `As of ${day(s.as_of, locale)}. Empty: no activity.`)}</p>
        </>
      )}
    </section>
  )
}
