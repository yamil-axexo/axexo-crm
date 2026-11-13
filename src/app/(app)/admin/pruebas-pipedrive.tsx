import Link from 'next/link'
import type { Ctx } from '@/server/context'
import { Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { resetAllowed } from '@/domain/test-reset'
import { resetTestMarketAction } from './pipedrive-actions'

/**
 * E6.F4: respaldo de lo importado de Pipedrive. E6.F8 y E18.F7: borrar y recargar un mercado en ambiente de prueba, y la
 * hoja de leads de México para el corte (en Importar).
 */
export function MigrationToolsCard({ ctx }: { ctx: Ctx }) {
  const { t } = ctx
  const canBackup = ctx.can('pipedrive.backup')
  const canReset = ctx.can('market.reset_test') && resetAllowed()
  return (
    <Card data-testid="migration-tools">
      <CardTitle title={t('Respaldo y pruebas de migración', 'Backup and migration tests')} />
      {canBackup && (
        <section data-testid="pipedrive-backup">
          <h3 className="text-[15px] font-semibold text-strong">{t('Respaldo de Pipedrive', 'Pipedrive backup')}</h3>
          <p className="mt-1 text-[13.5px] text-muted-2">{t('Un archivo JSON con todo lo que se trajo de Pipedrive (la copia cruda), con fecha, quién lo bajó y conteo por objeto. El formato está en la guía de migración. Cada descarga queda en la bitácora. Quién lo guarda y dónde: [pendiente: Yamil].', 'A JSON file with everything brought from Pipedrive (the raw copy), with the date, who downloaded it and a count per object. The format is in the migration guide. Each download is logged. Who keeps it and where: [pending: Yamil].')}</p>
          <a href="/admin/respaldo-pipedrive" download className="mt-2 inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="pipedrive-backup-link">{t('Bajar el respaldo', 'Download the backup')}</a>
        </section>
      )}
      <section className="mt-5 border-t border-line pt-5" data-testid="mx-sheet">
        <h3 className="text-[15px] font-semibold text-strong">{t('Hoja de leads de México', 'Mexico leads sheet')}</h3>
        <p className="mt-1 text-[13.5px] text-muted-2">{t('Para el corte de México: las columnas de promoción no se cargan y los leads muertos entran cerrados con su motivo. Con vista previa, reporte por fila y deshacer.', 'For the Mexico cut-over: promotion columns are not loaded and dead leads come in closed with their reason. With preview, per-row report and undo.')}</p>
        <Link href="/importar?tipo=mx_leads" className="mt-2 inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="mx-sheet-link">{t('Importar la hoja', 'Import the sheet')}</Link>
      </section>
      {canReset && (
        <section className="mt-5 border-t border-line pt-5" data-testid="test-reset">
          <h3 className="text-[15px] font-semibold text-strong">{t('Borrar y recargar un mercado (solo pruebas)', 'Wipe and reload a market (tests only)')}</h3>
          <p className="mt-1 text-[13.5px] text-muted-2">{t('Borra comercios, contactos, leads, negocios, actividades y cifras del mercado. No toca la configuración, los accesos, la bitácora ni las bajas de contacto. Después vuelve a cargar desde el espejo de Pipedrive. En producción no aparece.', 'Wipes the market’s merchants, contacts, leads, deals, activities and figures. It does not touch the configuration, access, audit log or contact opt-outs. Then it reloads from the Pipedrive mirror. It does not show in production.')}</p>
          <ActionForm action={resetTestMarketAction} className="mt-3 flex flex-wrap items-end gap-3" testId="test-reset-form">
            <Field label={t('Mercado', 'Market')}>
              <select name="market" className="input !w-28" data-testid="test-reset-market">
                {ctx.markets.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
              </select>
            </Field>
            <Field label={t('Escribe BORRAR y el mercado (por ejemplo, BORRAR SV)', 'Type WIPE and the market (for example, WIPE SV)')}>
              <input name="confirmation" required autoComplete="off" className="input !w-60" data-testid="test-reset-confirm" />
            </Field>
            <Submit variant="danger" testId="test-reset-submit">{t('Borrar y recargar', 'Wipe and reload')}</Submit>
          </ActionForm>
        </section>
      )}
    </Card>
  )
}
