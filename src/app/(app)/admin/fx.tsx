import type { Ctx } from '@/server/context'
import { getFxRates } from '@/dal/reports'
import { Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { fxSource } from '@/ui/report'
import { addDays, day, isoDay } from '@/lib/format'
import { setFxRateAction } from './fx-actions'

/**
 * Tasa de cambio a USD para el consolidado del Panel del LT. La carga administración, con fecha y fuente; CONTIGO no la
 * trae de ningún lado ni la supone. Sin tasa cargada para una moneda, el panel no consolida y lo dice.
 */
export async function FxCard({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const admin = ctx.can('config.manage')
  const rates = await getFxRates(ctx)
  const today = isoDay(new Date())
  const currencies = [...new Set(ctx.markets.map((m) => m.currency).filter((c) => c !== 'USD'))]
  if (currencies.length === 0) return null
  return (
    <Card data-testid="fx-card">
      <CardTitle
        title={t('Tasa de cambio a USD', 'Exchange rate to USD')}
        hint={t('La usa el Panel del LT para sumar mercados en USD. Vale la de fecha más reciente. Si una moneda no tiene tasa, el panel no consolida y lo dice.', 'The leadership panel uses it to add markets up in USD. The most recently dated one applies. If a currency has no rate, the panel does not consolidate and says so.')}
      />
      <ul className="divide-y divide-line" data-testid="fx-list">
        {currencies.map((c) => {
          const r = rates.find((x) => x.currency === c)
          return (
            <li key={c} className="py-3 text-[14px]" data-testid="fx-row">
              {r ? (
                <>
                  <p className="font-semibold text-strong"><span className="num" data-testid="fx-value">1 {c} = {Number(r.usd_rate)} USD</span></p>
                  <p className="mt-0.5 text-[13px] text-muted-2" data-testid="fx-meta">{t(`Tasa del ${day(r.as_of, locale)}. Fuente: ${fxSource(t, r)}.${r.loaded_by ? ` La cargó ${r.loaded_by}.` : ''}`, `Rate dated ${day(r.as_of, locale)}. Source: ${fxSource(t, r)}.${r.loaded_by ? ` Loaded by ${r.loaded_by}.` : ''}`)}</p>
                </>
              ) : <p className="font-medium text-amber-text" data-testid="fx-none">{t(`${c}: sin tasa cargada. El panel no consolida en USD.`, `${c}: no rate loaded. The panel does not consolidate in USD.`)}</p>}
            </li>
          )
        })}
      </ul>
      {admin && (
        <ActionForm action={setFxRateAction} onOk="reset" className="mt-4 border-t border-line pt-5" testId="fx-form">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label={t('Moneda', 'Currency')}><select name="currency" className="input" data-testid="fx-currency">{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
            <Field label={t('Fecha de la tasa', 'Rate date')}><input type="date" name="as_of" className="input" required defaultValue={today} max={addDays(today, 1)} data-testid="fx-date" /></Field>
            <Field label={t('1 unidad en USD', '1 unit in USD')} hint={t('Por ejemplo, cuántos USD vale 1 MXN.', 'For example, how many USD 1 MXN is worth.')}><input name="rate" className="input" inputMode="decimal" required pattern="[0-9]*[.]?[0-9]+" data-testid="fx-rate" /></Field>
            <Field label={t('De dónde sale', 'Where it comes from')} hint={t('Quién la publica o quién la aprobó.', 'Who publishes it or who approved it.')}><input name="source" className="input" required minLength={3} maxLength={120} data-testid="fx-source" /></Field>
          </div>
          <div className="mt-4"><Submit variant="ghost" testId="fx-save">{t('Guardar tasa', 'Save rate')}</Submit></div>
        </ActionForm>
      )}
    </Card>
  )
}
