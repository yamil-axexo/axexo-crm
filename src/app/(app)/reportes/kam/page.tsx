import Link from 'next/link'
import { Badge, Card, CardTitle, Empty, Field, NoData } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { NavSelect } from '@/ui/board'
import { RoleBoard } from '@/ui/role-board'
import { DataTable, linkClass } from '@/ui/reportes'
import { boardConfig, kamBoard, kamPeople } from '@/dal/role-boards'
import { forecastSubmissions } from '@/dal/reportes2'
import { FORECAST_CATEGORIES, FORECAST_LABEL, emitUsage, type ForecastCategory } from '@/domain/reportes2'
import { withUser } from '@/server/db'
import { qs } from '@/lib/labels'
import { day, money, num } from '@/lib/format'
import { loadReport, type ReportSp } from '../load'
import { ReportHeader } from '../shell'
import { forecastAdjustAction, forecastCategoryAction, forecastSubmitAction } from './actions'

const catLabel = (t: (es: string, en: string) => string, c: string | null) => (c && c in FORECAST_LABEL ? t(...FORECAST_LABEL[c as ForecastCategory]) : t('Sin categoría', 'No category'))

/**
 * REP-01 y REP-03 (reportes2): el tablero de quien lleva cuentas clave. Sus cifras con definición y dueño, sus cuentas con las
 * tiendas que cuelgan de ellas, y las oportunidades con categoría de pronóstico. Quien dirige ve el de cada persona KAM de su
 * alcance y ajusta la categoría al lado (sin borrarla). El envío guarda por valor: reorganizar territorios no lo cambia.
 */
export default async function KamBoardPage({ searchParams }: { searchParams: Promise<ReportSp> }) {
  const r = await loadReport('kam', searchParams)
  const { ctx, sp, owners } = r
  const { t, locale } = ctx
  const people = await kamPeople(ctx)
  const isKam = ctx.memberships.some((m) => m.role === 'kam')
  const who = people.find((p) => p.id === sp.persona)?.id ?? (isKam ? ctx.user.id : people[0]?.id)
  const items = await boardConfig(ctx, 'kam')
  const board = who ? await kamBoard(ctx, who) : null
  const subs = await forecastSubmissions(ctx, who ?? null)
  const canAdjust = (market: string) => ctx.can('forecast.adjust', market)
  const canSet = (market: string, owner: string | null) => ctx.can('forecast.categorize', market) && (owner === ctx.user.id || canAdjust(market))
  const market = people.find((p) => p.id === who)?.market_code ?? ctx.markets[0]?.code ?? ''
  if (!ctx.viewAs && (canAdjust(market) || isKam)) await withUser(ctx.user.id, (tx) => emitUsage(tx, ctx, 'usage.board_opened', market || null, { board: 'kam' }))
  const today = new Date()
  const q = Math.floor(today.getUTCMonth() / 3)
  const qFrom = `${today.getUTCFullYear()}-${String(q * 3 + 1).padStart(2, '0')}-01`
  const qToDate = new Date(Date.UTC(today.getUTCFullYear(), q * 3 + 3, 0))
  const qTo = `${qToDate.getUTCFullYear()}-${String(qToDate.getUTCMonth() + 1).padStart(2, '0')}-${String(qToDate.getUTCDate()).padStart(2, '0')}`

  return (
    <>
      <ReportHeader r={r} />
      {people.length > 1 && (
        <div className="mb-5 max-w-sm">
          <NavSelect label={t('Persona KAM', 'KAM')} value={qs('/reportes/kam', { persona: who })} testId="kam-person"
            options={people.map((p) => ({ label: `${p.full_name} · ${p.market_code}`, href: qs('/reportes/kam', { persona: p.id }) }))} />
        </div>
      )}
      {!who || !board ? (
        <Empty title={t('Todavía no hay personas KAM en tu alcance', 'There are no KAMs in your scope yet')} hint={t('Administración da el rol "Cuentas clave (KAM)" en Personas.', 'Administration grants the "Key accounts (KAM)" role in People.')} />
      ) : (
        <>
          <RoleBoard t={t} locale={locale} items={items} values={board.values} owners={owners} testId="kam-board" />

          <Card className="mt-6" pad={false}>
            <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Cuentas clave', 'Key accounts')} hint={t('Cadenas, distribuidores y organizaciones a su nombre, con las tiendas que cuelgan de cada una.', 'Chains, distributors and organizations in their name, with the stores under each one.')} /></div>
            <DataTable testId="kam-accounts" label={t('Cuentas clave', 'Key accounts')}
              empty={<div className="p-7 pt-0"><Empty title={t('Sin cuentas clave a su nombre', 'No key accounts in their name')} hint={t('Quien dirige pasa la cuenta desde la ficha del comercio.', 'A manager moves the account from the merchant record.')} /></div>}
              head={[{ label: t('Cuenta', 'Account') }, { label: t('Tiendas', 'Stores'), num: true }, { label: t('Activas', 'Active'), num: true }]}
              rows={board.accounts.map((a) => ({ key: a.id, testId: 'kam-account', cells: [
                <Link key="a" href={`/comercios/${a.id}`} className={linkClass}>{a.name}</Link>, num(a.stores, locale), num(a.active, locale)] }))} />
          </Card>

          <Card className="mt-6" pad={false}>
            <div className="px-5 pt-5 md:px-7 md:pt-6"><CardTitle title={t('Oportunidades y pronóstico', 'Opportunities and forecast')}
              hint={t('Cada oportunidad lleva su categoría. Si quien dirige la ajusta, las dos quedan a la vista y cuenta el ajuste.', 'Each opportunity carries its category. If the manager adjusts it, both stay in view and the adjustment counts.')} /></div>
            {board.deals.length === 0 ? (
              <div className="p-7 pt-0"><Empty title={t('Sin oportunidades abiertas', 'No open opportunities')} hint={t('Las oportunidades nacen en Negocios, sobre la cuenta clave.', 'Opportunities start in Deals, on the key account.')} /></div>
            ) : (
              <ul className="divide-y divide-line px-5 pb-5 md:px-7" data-testid="kam-deals">
                {board.deals.map((d) => (
                  <li key={d.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto]" data-testid="kam-deal">
                    <div className="min-w-0">
                      <Link href={`/deals/${d.id}`} className={`${linkClass} font-semibold`}>{d.title}</Link>
                      <p className="text-[13px] text-muted">{d.account} · {t(d.stage, d.stage_en)} · {d.amount_minor ? money(d.amount_minor, d.currency, locale) : <NoData locale={locale} />}</p>
                      <p className="text-[13px] text-muted">{d.next_step ? `${t('Próximo paso', 'Next step')}: ${d.next_step}${d.next_step_due ? ` (${day(d.next_step_due, locale)})` : ''}` : t('Sin próximo paso', 'No next step')}</p>
                      <p className="mt-1 flex flex-wrap gap-2 text-[13px]" data-testid="kam-deal-category">
                        <Badge>{t('Quien lleva la cuenta', 'Account owner')}: {catLabel(t, d.category)}</Badge>
                        {d.manager_category && <Badge tone="warn">{t('Ajuste de quien dirige', 'Manager adjustment')}: {catLabel(t, d.manager_category)}</Badge>}
                        {d.manager_note && <span className="text-muted">“{d.manager_note}”</span>}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      {canSet(d.market_code, d.owner_id) && (
                        <ActionForm action={forecastCategoryAction} className="flex items-end gap-2" testId="forecast-set">
                          <input type="hidden" name="deal" value={d.id} />
                          <Field label={t('Categoría', 'Category')}>
                            <select name="category" className="input !h-11 !w-auto" defaultValue={d.category ?? 'pipeline'} data-testid="forecast-category">
                              {FORECAST_CATEGORIES.map((c) => <option key={c} value={c}>{t(...FORECAST_LABEL[c])}</option>)}
                            </select>
                          </Field>
                          <Submit size="sm" variant="ghost" testId="forecast-save">{t('Guardar', 'Save')}</Submit>
                        </ActionForm>
                      )}
                      {canAdjust(d.market_code) && d.category && (
                        <ActionForm action={forecastAdjustAction} className="flex flex-wrap items-end gap-2" testId="forecast-adjust">
                          <input type="hidden" name="deal" value={d.id} />
                          <Field label={t('Ajuste', 'Adjustment')}>
                            <select name="category" className="input !h-11 !w-auto" defaultValue={d.manager_category ?? d.category} data-testid="forecast-adjust-category">
                              {FORECAST_CATEGORIES.map((c) => <option key={c} value={c}>{t(...FORECAST_LABEL[c])}</option>)}
                            </select>
                          </Field>
                          <Field label={t('Por qué', 'Why')}><input name="note" className="input !h-11 !w-48" required minLength={3} maxLength={300} data-testid="forecast-adjust-note" /></Field>
                          <Submit size="sm" variant="ghost" testId="forecast-adjust-save">{t('Ajustar', 'Adjust')}</Submit>
                        </ActionForm>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-6">
            <CardTitle title={t('Envíos del pronóstico', 'Forecast submissions')}
              hint={t('Cada envío guarda los negocios con su categoría, quién los lleva y su territorio en ese momento. Volver a enviar el mismo periodo crea una versión nueva.', 'Each submission stores the deals with their category, owner and territory at that moment. Submitting the same period again creates a new version.')} />
            {ctx.can('forecast.submit', market) && (who === ctx.user.id || canAdjust(market)) && (
              <ActionForm action={forecastSubmitAction} className="mb-5 flex flex-wrap items-end gap-3" testId="forecast-submit">
                <input type="hidden" name="market" value={market} />
                <Field label={t('Desde', 'From')}><input type="date" name="from" className="input !h-11" defaultValue={qFrom} required data-testid="forecast-from" /></Field>
                <Field label={t('Hasta', 'To')}><input type="date" name="to" className="input !h-11" defaultValue={qTo} required data-testid="forecast-to" /></Field>
                <Field label={t('Nota (opcional)', 'Note (optional)')}><input name="note" className="input !h-11 !w-56" maxLength={500} /></Field>
                <Submit testId="forecast-submit-btn">{t('Enviar pronóstico', 'Submit forecast')}</Submit>
              </ActionForm>
            )}
            {subs.length === 0 ? (
              <Empty title={t('Todavía no hay envíos', 'No submissions yet')} hint={t('El primer envío del periodo queda como versión 1.', 'The period’s first submission is version 1.')} />
            ) : (
              <ul className="space-y-2" data-testid="forecast-submissions">
                {subs.map((s) => (
                  <li key={s.id} className="rounded-[12px] border border-line px-4 py-3 text-[14px]" data-testid="forecast-submission">
                    <span className="font-semibold text-strong">{t(`Versión ${s.version}`, `Version ${s.version}`)}</span>{' · '}
                    {s.submitter_name} · {day(s.period_from, locale)} {t('al', 'to')} {day(s.period_to, locale)} · {t(`${s.n} negocios`, `${s.n} deals`)}
                    <span className="block text-[13px] text-muted">{Object.entries(s.totals).map(([k, v]) => {
                      const [c, cur] = k.split(':')
                      return `${catLabel(t, c ?? null)}: ${num(v.n, locale)}${v.amount_minor ? ` (${money(v.amount_minor, cur ?? 'USD', locale)})` : ''}`
                    }).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  )
}
