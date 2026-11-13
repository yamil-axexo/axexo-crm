import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { metricOwners } from '@/dal/reportes'
import { track } from '@/dal/boards'
import { METRICS, METRIC_KEYS, metricOwner } from '@/lib/metric-defs'
import { Badge, Card, PageHeader } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { BackToReports } from '@/ui/reportes'
import { metricOwnerAction } from '../actions'

export const dynamic = 'force-dynamic'

/** REP-01 / REP-04: cada indicador con su definición y su dueño. Una cifra, una definición, un dueño. El dueño lo cambia administración. */
export default async function MetricsPage() {
  const ctx = await requireCtx()
  if (!ctx.can('report.gallery')) notFound()
  const { t } = ctx
  const owners = await metricOwners(ctx)
  await track(ctx, 'view.report.indicadores')
  const canEdit = ctx.can('metric.owner')
  return (
    <>
      <BackToReports t={t} />
      <PageHeader title={t('Indicadores y dueños', 'Metrics and owners')} desc={t('Cada cifra de CONTIGO tiene una sola definición y alguien que responde por ella. Las pantallas leen de esta misma lista.', 'Each figure in CONTIGO has a single definition and someone who answers for it. Screens read from this same list.')} />
      <ul className="grid gap-4" data-testid="metric-list">
        {METRIC_KEYS.map((k) => {
          const d = METRICS[k]
          return (
            <li key={k}>
              <Card data-testid="metric-item" data-metric={k}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-[17px] font-semibold text-strong">{t(d.label[0], d.label[1])}</h2>
                  <span data-testid="metric-owner"><Badge tone={owners[k] ? 'good' : 'neutral'}>{t('Responde: ', 'Owner: ')}{metricOwner(k, owners, t)}</Badge></span>
                </div>
                <p className="mt-2 text-[14.5px] text-strong">{t(d.what[0], d.what[1])}</p>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13.5px] md:grid-cols-2">
                  {'num' in d && <div><dt className="font-semibold text-muted-2">{t('Numerador', 'Numerator')}</dt><dd className="text-strong">{t(d.num[0], d.num[1])}</dd></div>}
                  {'den' in d && <div><dt className="font-semibold text-muted-2">{t('Denominador', 'Denominator')}</dt><dd className="text-strong">{t(d.den[0], d.den[1])}</dd></div>}
                  <div><dt className="font-semibold text-muted-2">{t('Ventana', 'Window')}</dt><dd className="text-strong">{t(d.window[0], d.window[1])}</dd></div>
                  <div><dt className="font-semibold text-muted-2">{t('Fuente', 'Source')}</dt><dd className="text-strong">{t(d.source[0], d.source[1])}</dd></div>
                </dl>
                {!owners[k] && <p className="mt-2 text-[12.5px] text-muted">{t('Dueño por defecto, por área. Administración puede poner a la persona o al área que responde.', 'Default owner, by area. Administration can set the person or area that answers.')}</p>}
                {canEdit && (
                  <ActionForm action={metricOwnerAction} className="mt-3 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="key" value={k} />
                    <label className="block min-w-0 flex-1 basis-60"><span className="mb-1 block text-[12.5px] font-semibold text-muted-2">{t('Quién responde por este número', 'Who answers for this number')}</span>
                      <input name="owner" defaultValue={owners[k] ?? ''} className="input" minLength={2} maxLength={80} required aria-label={t(`Quién responde por "${d.label[0]}"`, `Who answers for "${d.label[1]}"`)} data-testid="metric-owner-input" /></label>
                    <Submit variant="ghost" testId="metric-owner-save">{t('Guardar', 'Save')}</Submit>
                  </ActionForm>
                )}
              </Card>
            </li>
          )
        })}
      </ul>
    </>
  )
}
