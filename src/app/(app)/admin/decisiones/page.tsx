import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { decisionsBoard } from '@/dal/datos2'
import { DECISIONS } from '@/domain/decisions'
import { Badge, Card, CardTitle, Field, PageHeader } from '@/ui/kit'
import { Submit } from '@/ui/client'
import { NoticeArea, NoticeForm } from '@/ui/admin'
import { day } from '@/lib/format'
import { setDecisionAction } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Decisiones de negocio que no se toman en el código (paquete datos2). Cada una tiene un valor propuesto, conservador y
 * reversible, y un dueño. Mientras el dueño no la confirma, la pantalla lo dice. Las cambia administración (Embudos y campos);
 * las lee también quien responde por los controles.
 */
export default async function DecisionsPage() {
  const ctx = await requireCtx()
  const edit = ctx.can('config.manage')
  if (!edit && !ctx.can('status.read')) notFound()
  const { t, locale } = ctx
  const rows = await decisionsBoard(ctx)
  const mk = (code: string | null) => (code ? (ctx.markets.find((m) => m.code === code)?.name ?? code) : t('Todos los mercados', 'All markets'))
  const pending = rows.filter((r) => r.proposed).length
  return (
    <>
      <PageHeader title={t('Decisiones de negocio', 'Business decisions')} desc={t('Reglas que decide una persona fuera del equipo que construye. Mientras no se confirman, CONTIGO usa el valor propuesto y lo dice.', 'Rules decided by someone outside the build team. Until they are confirmed, CONTIGO uses the proposed value and says so.')} />
      <p className="mb-6 text-[14px] text-muted-2" data-testid="decisions-summary">
        {pending === 0 ? t('Todas las decisiones están confirmadas.', 'All decisions are confirmed.') : t(`${pending} por confirmar. También aparecen en Estado de CONTIGO.`, `${pending} to confirm. They also show in CONTIGO status.`)}{' '}
        <Link href="/admin" className="font-medium text-blue-text underline">{t('Volver a Administración', 'Back to Administration')}</Link>
      </p>
      <NoticeArea closeLabel={t('Cerrar aviso', 'Dismiss notice')}>
        <div className="space-y-6">
          {DECISIONS.map((d) => (
            <Card key={d.key} data-testid="decision-card" data-key={d.key}>
              <CardTitle title={t(...d.label)} hint={t(...d.help)} />
              <ul>
                {rows.filter((r) => r.key === d.key).map((r) => {
                  const opt = d.options.find((o) => o.value === r.value)
                  return (
                    <li key={`${d.key}-${r.market ?? 'all'}`} className="border-t border-line py-4 first:border-t-0" data-testid="decision-row" data-market={r.market ?? ''} data-proposed={r.proposed ? 'yes' : 'no'}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="min-w-0 text-[14px]">
                          {d.perMarket && <span className="mr-2 font-semibold text-strong">{mk(r.market)}</span>}
                          <span className="text-strong" data-testid="decision-value">{opt ? t(...opt.label) : r.value}</span>
                          {r.updatedAt && <span className="block text-[12.5px] text-muted">{[r.updatedBy, day(r.updatedAt, locale)].filter(Boolean).join(' · ')}{r.note ? ` · ${r.note}` : ''}</span>}
                        </span>
                        {r.proposed
                          ? <span className="inline-block max-w-full rounded-[10px] bg-warn-bg px-2.5 py-0.5 text-[13px] font-medium text-amber-text" data-testid="decision-pending">{t(`Valor propuesto, pendiente: ${d.owner}`, `Proposed value, pending: ${d.owner}`)}</span>
                          : <Badge tone="good">{t('Decidido', 'Decided')}</Badge>}
                      </div>
                      {edit && !d.locked && (
                        <NoticeForm action={setDecisionAction} className="mt-3 grid gap-3 sm:flex sm:flex-wrap sm:items-end" testId="decision-form">
                          <input type="hidden" name="key" value={d.key} />
                          <input type="hidden" name="market" value={r.market ?? ''} />
                          <Field label={t('Valor', 'Value')} className="sm:min-w-48">
                            <select name="value" className="input" defaultValue={r.value} data-testid="decision-select">
                              {d.options.map((o) => <option key={o.value} value={o.value}>{t(...o.label)}</option>)}
                            </select>
                          </Field>
                          <label className="flex min-h-11 items-center gap-2 text-[13.5px]"><input type="checkbox" name="confirmed" value="yes" className="h-5 w-5" defaultChecked={!r.proposed} data-testid="decision-confirmed" />{t(`Ya lo decidió ${d.owner}`, `${d.owner} has decided`)}</label>
                          <Field label={t('Nota (cuándo y cómo se decidió)', 'Note (when and how it was decided)')} className="sm:min-w-56 sm:flex-1"><input name="note" className="input" maxLength={300} defaultValue={r.note ?? ''} data-testid="decision-note" /></Field>
                          <Submit size="sm" variant="ghost" testId="decision-save">{t('Guardar', 'Save')}</Submit>
                        </NoticeForm>
                      )}
                      {d.locked && <p className="mt-2 text-[13px] text-muted-2" data-testid="decision-locked">{t(`La decide ${d.owner}. No se cambia desde esta pantalla.`, `${d.owner} decides it. It cannot be changed from this screen.`)}</p>}
                    </li>
                  )
                })}
              </ul>
            </Card>
          ))}
        </div>
      </NoticeArea>
    </>
  )
}
