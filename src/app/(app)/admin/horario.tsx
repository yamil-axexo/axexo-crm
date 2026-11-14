import { requireCtx } from '@/server/context'
import { marketHours } from '@/dal/leads'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { setMarketHoursAction } from './horario-actions'

const DAYS: [n: number, es: string, en: string][] = [[1, 'Lun', 'Mon'], [2, 'Mar', 'Tue'], [3, 'Mié', 'Wed'], [4, 'Jue', 'Thu'], [5, 'Vie', 'Fri'], [6, 'Sáb', 'Sat'], [7, 'Dom', 'Sun']]

/** Formularios y turnos: horario hábil por mercado. El reloj de primer contacto de un lead solo corre dentro de este horario. */
export async function Horario() {
  const ctx = await requireCtx()
  const { t } = ctx
  const hours = await marketHours(ctx)
  const live = hours.filter((h) => ctx.markets.find((m) => m.code === h.market_code)?.status === 'live')
  return (
    <Card data-testid="admin-hours">
      <CardTitle
        title={t('Horario hábil por mercado', 'Business hours by market')}
        hint={t(
          'El reloj de primer contacto de un lead solo corre en este horario, en la hora del mercado. Un lead que entra de noche o en fin de semana empieza a contar cuando abre el siguiente día hábil.',
          'A lead’s first-contact clock only runs during these hours, in the market’s time. A lead that comes in at night or on a weekend starts counting when the next business day opens.',
        )}
      />
      <div className="space-y-6">
        {live.map((h) => {
          const market = ctx.market(h.market_code)
          return (
            <ActionForm key={h.market_code} action={setMarketHoursAction} className="border-t border-line pt-5 first:border-t-0 first:pt-0" testId={`hours-${h.market_code}`}>
              <input type="hidden" name="market" value={h.market_code} />
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="text-[15px] font-semibold text-strong">{market.name}</p>
                <Badge>{market.timezone}</Badge>
              </div>
              <fieldset>
                <legend className="mb-2 text-[13px] font-semibold text-muted-2">{t('Días hábiles', 'Business days')}</legend>
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  {DAYS.map(([n, es, en]) => (
                    <label key={n} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] px-2 text-[14px] text-strong">
                      <input type="checkbox" name="day" value={n} defaultChecked={h.days.includes(n)} className="h-5 w-5 shrink-0" data-testid={`hours-day-${n}`} />
                      {t(es, en)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field label={t('Abre', 'Opens')}><input type="time" name="opens" defaultValue={h.opens} required className="input !w-36" data-testid="hours-opens" /></Field>
                <Field label={t('Cierra', 'Closes')}><input type="time" name="closes" defaultValue={h.closes} required className="input !w-36" data-testid="hours-closes" /></Field>
                <Submit variant="ghost" testId="hours-save">{t('Guardar horario', 'Save hours')}</Submit>
              </div>
            </ActionForm>
          )
        })}
      </div>
    </Card>
  )
}
