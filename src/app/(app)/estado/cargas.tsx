import type { Ctx } from '@/server/context'
import { getLoads } from '@/dal/loads'
import { Badge, Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { dayTime, num } from '@/lib/format'
import { configureLoadAction, setLoadWindowAction } from './actions'

const STATUS: Record<string, [string, string]> = {
  ok: ['Terminó bien', 'Finished'], failed: ['Falló', 'Failed'], running: ['Corriendo', 'Running'],
  paused: ['En pausa por mantenimiento', 'Paused for maintenance'], late: ['No llegó a su hora', 'Did not arrive on time'],
}
const ERR: Record<string, [string, string]> = { abandoned: ['se quedó colgada', 'it hung'], cancelled: ['se detuvo a mano', 'it was stopped by hand'] }

/**
 * E5.F3/F4/F5: cargas de datos visibles. Cada una con responsable, hora esperada, la última corrida y lo que hizo.
 * Ventana diaria sin cargas por mercado. E5.F7: qué ya no depende de Pipedrive (firma). E5.F9: la bóveda, apagada.
 */
export async function LoadsCard({ ctx, tz }: { ctx: Ctx; tz: string }) {
  const { t, locale } = ctx
  const { loads, windows, people } = await getLoads(ctx)
  const canEdit = ctx.can('load.configure')
  return (
    <Card data-testid="status-loads">
      <CardTitle title={t('Cargas de datos', 'Data loads')} hint={t('Cada carga deja su inicio y su fin. Nunca corren dos a la vez ni dentro de la ventana de mantenimiento de su mercado. Si una falla o no llega a su hora, su responsable recibe un aviso; sin responsable, administración.', 'Each load records its start and end. Two never run at once, nor inside their market’s maintenance window. If one fails or does not arrive on time, its owner gets a notice; with no owner, administration does.')} />
      <ul>
        {loads.map((l) => {
          const st = l.running ? 'running' : l.last_status
          const tone = st === 'ok' ? 'good' : st === 'failed' || st === 'late' ? 'bad' : st ? 'warn' : 'neutral'
          return (
            <li key={l.key} className="border-t border-line py-4 first:border-t-0" data-testid={`load-${l.key}`}>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <span className="min-w-0 flex-1 basis-60">
                  <span className="block text-[14.5px] font-semibold text-strong">{t(l.label_es, l.label_en)}</span>
                  <span className="block text-[12.5px] text-muted-2" data-testid="load-owner">
                    {[l.owner_name ? t(`Responsable: ${l.owner_name}`, `Owner: ${l.owner_name}`) : t('Sin responsable: avisa a administración', 'No owner: administration is notified'),
                      l.expected_by ? t(`Debe terminar a las ${l.expected_by} (${l.clock_market})`, `Due by ${l.expected_by} (${l.clock_market})`) : t('Sin hora fija', 'No fixed time')].join(' · ')}
                  </span>
                  <span className="block text-[12.5px] text-muted-2" data-testid="load-last">
                    {l.last_started_at
                      ? [t(`Última: ${dayTime(l.last_started_at, locale, tz)}`, `Latest: ${dayTime(l.last_started_at, locale, tz)}`),
                         l.last_done ? t(`${num(l.last_done, locale)} registros`, `${num(l.last_done, locale)} records`) : null,
                         l.last_note && !l.last_note.includes(':') ? l.last_note : null,
                         l.last_error ? t(`motivo: ${ERR[l.last_error]?.[0] ?? l.last_error}`, `reason: ${ERR[l.last_error]?.[1] ?? l.last_error}`) : null].filter(Boolean).join(' · ')
                      : t('Todavía no ha corrido.', 'It has not run yet.')}
                  </span>
                </span>
                <Badge tone={tone}>{st ? t(...STATUS[st]!) : t('Sin corridas', 'No runs')}</Badge>
              </div>
              {canEdit && (
                <ActionForm action={configureLoadAction} className="mt-3 flex flex-wrap items-end gap-3" testId={`load-form-${l.key}`}>
                  <input type="hidden" name="key" value={l.key} />
                  <Field label={t('Responsable', 'Owner')}>
                    <select name="owner" defaultValue={l.owner_id ?? ''} className="input !w-56" data-testid="load-owner-select">
                      <option value="">{t('Administración', 'Administration')}</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </Field>
                  <Field label={t('Hora esperada', 'Expected by')}><input type="time" name="expected_by" defaultValue={l.expected_by ?? ''} className="input !w-36" data-testid="load-expected" /></Field>
                  <Field label={t('Reloj del mercado', 'Market clock')}>
                    <select name="clock_market" defaultValue={l.clock_market ?? ''} className="input !w-28">
                      <option value="">{t('Ninguno', 'None')}</option>
                      {windows.map((w) => <option key={w.market_code} value={w.market_code}>{w.market_code}</option>)}
                    </select>
                  </Field>
                  <Submit size="sm" variant="ghost" testId={`load-save-${l.key}`}>{t('Guardar', 'Save')}</Submit>
                </ActionForm>
              )}
            </li>
          )
        })}
      </ul>

      <h3 className="mt-6 border-t border-line pt-5 text-[15px] font-semibold text-strong">{t('Ventana sin cargas por mercado', 'No-load window by market')}</h3>
      <p className="mt-1 text-[12.5px] text-muted-2">{t('Hora local del mercado. También detiene las cargas cualquier mantenimiento planeado en Gobierno.', 'Market local time. Any maintenance planned in Governance also stops loads.')}</p>
      <ul className="mt-2">
        {windows.map((w) => (
          <li key={w.market_code} className="flex flex-wrap items-end gap-3 border-t border-line py-3 first:border-t-0" data-testid={`load-window-${w.market_code}`}>
            <span className="w-full text-[14px] font-medium text-strong md:w-auto md:min-w-24">{w.market_code}{w.now_paused && <span className="ml-2"><Badge tone="warn">{t('En ventana ahora', 'In window now')}</Badge></span>}</span>
            {canEdit ? (
              <ActionForm action={setLoadWindowAction} className="flex flex-wrap items-end gap-3" testId={`load-window-form-${w.market_code}`}>
                <input type="hidden" name="market" value={w.market_code} />
                <Field label={t('Desde', 'From')}><input type="time" name="starts" defaultValue={w.starts_local} required className="input !w-32" data-testid="window-starts" /></Field>
                <Field label={t('Hasta', 'To')}><input type="time" name="ends" defaultValue={w.ends_local} required className="input !w-32" data-testid="window-ends" /></Field>
                <label className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" name="active" defaultChecked={w.is_active} className="h-5 w-5" data-testid="window-active" />{t('Activa', 'Active')}</label>
                <Submit size="sm" variant="ghost" testId={`window-save-${w.market_code}`}>{t('Guardar', 'Save')}</Submit>
              </ActionForm>
            ) : (
              <span className="text-[13.5px] text-muted-2">{w.is_active ? `${w.starts_local} a ${w.ends_local}` : t('Sin ventana', 'No window')}</span>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-6 border-t border-line pt-5 text-[15px] font-semibold text-strong">{t('Lo que ya no pasa por Pipedrive', 'What no longer goes through Pipedrive')}</h3>
      <ul className="mt-2" data-testid="status-no-pipedrive">
        <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid="status-esign">
          <span className="min-w-0 flex-1 basis-60"><span className="block text-[14px] font-medium text-strong">{t('Firma de contratos', 'Contract signing')}</span>
            <span className="text-[12.5px] text-muted-2">{t('El contrato se firma con el adaptador de firma propio de CONTIGO (variable CONTIGO_ESIGN_ADAPTER), apagado hasta su aprobación. Pipedrive no interviene: ni pide la firma ni guarda el contrato.', 'The contract is signed through CONTIGO’s own signing adapter (CONTIGO_ESIGN_ADAPTER variable), off until approved. Pipedrive is not involved: it neither requests the signature nor keeps the contract.')}</span></span>
          <Badge>{t('Sin Pipedrive', 'No Pipedrive')}</Badge>
        </li>
      </ul>
    </Card>
  )
}
