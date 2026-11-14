import type { Ctx } from '@/server/context'
import { connectorStatus } from '@/server/adapters/registry'
import { lastConnectorTests } from '@/dal/conectores'
import { Badge, Card, CardTitle } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { dayTime } from '@/lib/format'
import { testConnectorAction } from './conectores-actions'

/**
 * Paquete conectores: cada conector construido completo y apagado. Por conector: modo, variables que faltan (solo nombres,
 * nunca valores), referencia de aprobación, quién lo enciende y "Probar conexión" (solo administración, auditado).
 */
export async function ConnectorsCard({ ctx, tz }: { ctx: Ctx; tz: string }) {
  const { t, locale } = ctx
  const list = connectorStatus()
  const tests = await lastConnectorTests(ctx)
  const canTest = ctx.can('connector.test')
  const on = list.filter((c) => c.mode === 'live').length
  return (
    <Card data-testid="status-connectors">
      <CardTitle
        title={t('Conectores', 'Connectors')}
        hint={t(
          `Construidos completos. ${on} de ${list.length} encendidos. Cada uno sale hacia afuera solo con tres cosas: su variable en "live", las credenciales del proveedor y la referencia del sign-off escrito de Dan Mulligan o Michael Essiet. Detalle de cada uno en docs/adapters.md.`,
          `Fully built. ${on} of ${list.length} on. Each one goes out only with three things: its variable set to "live", the provider credentials and the reference of the written sign-off from Dan Mulligan or Michael Essiet. Details for each in docs/adapters.md.`,
        )}
      />
      <ul>
        {list.map(({ def, mode, missing, approval, approvalVar }) => {
          const last = tests[def.key]
          return (
            <li key={def.key} className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line py-4 first:border-t-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto] md:items-start" data-testid={`connector-${def.key}`}>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-strong">{t(...def.name)}</span>
                <span className="block text-[12.5px] text-muted-2 [overflow-wrap:anywhere]">{def.provider}</span>
                <span className="mt-1.5 inline-block" data-testid="connector-mode">
                  {mode === 'live' ? <Badge tone="good">{t('Encendido', 'On')}</Badge> : mode === 'simulated' ? <Badge tone="warn">{t('Simulado (pruebas)', 'Simulated (tests)')}</Badge> : <Badge>{t('Apagado', 'Off')}</Badge>}
                </span>
              </span>
              <span className="min-w-0 space-y-1.5 text-[13.5px] text-muted-2 [overflow-wrap:anywhere]">
                {missing.length > 0 && (
                  <span className="block" data-testid="connector-missing">
                    {t('Falta: ', 'Missing: ')}
                    {missing.map((m, i) => <span key={m}>{i > 0 ? ', ' : ''}<code className="text-[12.5px] text-strong">{m}</code></span>)}
                  </span>
                )}
                <span className="block" data-testid="connector-approval">
                  {approval ? t(`Aprobación: ${approval}`, `Approval: ${approval}`) : t(`Sin referencia de aprobación (${approvalVar}).`, `No approval reference (${approvalVar}).`)}
                </span>
                <span className="block">{t('Quién lo enciende: ', 'Who turns it on: ')}{t(...def.turnsOn)}</span>
                {last && (
                  <span className="block" data-testid="connector-last-test">
                    {t(`Última prueba: ${dayTime(last.tested_at.toISOString(), locale, tz)}${last.who ? `, ${last.who}` : ''}. ${last.ok ? 'Correcta' : 'Sin conexión'}: ${last.detail}`, `Last test: ${dayTime(last.tested_at.toISOString(), locale, tz)}${last.who ? `, ${last.who}` : ''}. ${last.ok ? 'Works' : 'No connection'}: ${last.detail}`)}
                  </span>
                )}
              </span>
              {canTest && (
                <ActionForm action={testConnectorAction} testId={`connector-test-${def.key}`}>
                  <input type="hidden" name="key" value={def.key} />
                  <Submit size="sm" variant="ghost" testId={`connector-test-btn-${def.key}`}>{t('Probar conexión', 'Test connection')}</Submit>
                </ActionForm>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
