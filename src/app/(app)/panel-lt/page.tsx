import { notFound } from 'next/navigation'
import { requireCtx, systemCtx } from '@/server/context'
import { getLtPanel } from '@/dal/boards'
import { ensureRulesFresh } from '@/domain/rules'
import { Bar, Card, CardTitle, Empty, PageHeader, Stat } from '@/ui/kit'
import { day, money, num, pct } from '@/lib/format'

export default async function PanelLtPage() {
  const ctx = await requireCtx()
  if (!ctx.can('board.lt')) notFound()
  const { t, locale } = ctx
  await ensureRulesFresh(await systemCtx())
  const data = await getLtPanel(ctx)
  const usd = (m: (typeof data.markets)[number]) => (m.usd_rate ? Number(m.volume_30d) * Number(m.usd_rate) : null)
  const totalUsd = data.markets.reduce((s, m) => s + (usd(m) ?? 0), 0)
  const sum = (k: 'accounts_active' | 'won_30d' | 'awaiting_txn' | 'leads_30d' | 'revisits' | 'activation_risk') => data.markets.reduce((s, m) => s + m[k], 0)
  const asOf = data.markets.map((m) => m.as_of).filter(Boolean).sort()[0]
  const maxReason = Math.max(1, ...data.reasons.map((r) => r.n))
  const maxNoSale = Math.max(1, ...data.noSale.map((r) => r.n))

  if (data.markets.length === 0) return (<><PageHeader title={t('Panel del LT', 'Leadership panel')} /><Empty title={t('Sin mercados en tu alcance', 'No markets in your scope')} /></>)

  return (
    <>
      <PageHeader
        eyebrow={asOf ? t(`Ventas con corte al ${day(asOf, locale)} · fuente S5`, `Sales as of ${day(asOf, locale)} · source S5`) : undefined}
        title={t('Panel del LT', 'Leadership panel')}
        desc={t('Del lead a la primera venta, por mercado. Un comercio cuenta como ganado cuando transacciona, no cuando firma.', 'From lead to first sale, by market. A merchant counts as won when it transacts, not when it signs.')}
      />
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4" data-testid="lt-kpis">
        <Stat testId="lt-active" label={t('Comercios activos', 'Active merchants')} value={num(sum('accounts_active'), locale)} hint={t('Transaccionan según S5', 'Transacting per S5')} />
        <Stat testId="lt-won" label={t('Ganados en 30 días', 'Won in 30 days')} value={num(sum('won_30d'), locale)} hint={t('Por primera transacción', 'By first transaction')} tone="good" />
        <Stat testId="lt-awaiting" label={t('Esperando primera venta', 'Awaiting first sale')} value={num(sum('awaiting_txn'), locale)} hint={t(`${sum('activation_risk')} llevan más de 7 días`, `${sum('activation_risk')} past 7 days`)} tone={sum('activation_risk') ? 'warn' : undefined} />
        <Stat testId="lt-volume" label={t('Volumen 30 días (USD)', 'Volume, 30 days (USD)')} value={money(Math.round(totalUsd), 'USD', locale, true)} hint={t('Consolidado con tasa fechada', 'Consolidated at a dated rate')} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
        {data.markets.map((m) => {
          const steps = [
            { k: t('Leads (30 días)', 'Leads (30 days)'), v: m.leads_30d },
            { k: t('Calificados', 'Qualified'), v: m.leads_qualified_30d },
            { k: t('Deals abiertos', 'Open deals'), v: m.deals_open },
            { k: t('Esperando primera venta', 'Awaiting first sale'), v: m.awaiting_txn },
            { k: t('Ganados (30 días)', 'Won (30 days)'), v: m.won_30d },
          ]
          const max = Math.max(1, ...steps.map((s) => s.v))
          return (
            <Card key={m.code} data-testid={`lt-market-${m.code}`}>
              <CardTitle title={m.name} hint={t(`Volumen 30 días: ${money(Number(m.volume_30d), m.currency, locale, true)}`, `Volume, 30 days: ${money(Number(m.volume_30d), m.currency, locale, true)}`)} />
              <ul className="space-y-3.5">
                {steps.map((s) => (
                  <li key={s.k} className="grid grid-cols-[190px_1fr_56px] items-center gap-4">
                    <span className="text-[13.5px] text-muted-2">{s.k}</span>
                    <Bar value={s.v} max={max} />
                    <span className="num text-right text-[14px] font-semibold text-strong">{num(s.v, locale)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-6 sm:grid-cols-4">
                <div><dt className="text-[12.5px] text-muted">{t('Respuesta a tiempo', 'On-time response')}</dt><dd className="display num mt-1 text-[22px] font-bold text-strong">{pct(m.sla_met, m.sla_judged)}</dd></div>
                <div><dt className="text-[12.5px] text-muted">{t('Días a la primera venta', 'Days to first sale')}</dt><dd className="display num mt-1 text-[22px] font-bold text-strong">{m.days_to_first_txn ?? '—'}</dd></div>
                <div><dt className="text-[12.5px] text-muted">{t('Revisitas pendientes', 'Pending revisits')}</dt><dd className="display num mt-1 text-[22px] font-bold text-strong">{m.revisits}</dd></div>
                <div><dt className="text-[12.5px] text-muted">{t('En riesgo / inactivos', 'At risk / inactive')}</dt><dd className="display num mt-1 text-[22px] font-bold text-strong">{m.accounts_at_risk} / {m.accounts_inactive}</dd></div>
              </dl>
            </Card>
          )
        })}

        <Card data-testid="lt-loss">
          <CardTitle title={t('Por qué se pierden los deals', 'Why deals are lost')} hint={t('Motivo obligatorio al cerrar como perdido.', 'A reason is required to close as lost.')} />
          {data.reasons.length === 0 ? <p className="text-[14px] text-muted">—</p> : (
            <ul className="space-y-3">
              {data.reasons.map((r) => (
                <li key={`${r.market_code}${r.code}`} className="grid grid-cols-[210px_1fr_40px] items-center gap-4">
                  <span className="truncate text-[13.5px] text-muted-2">{t(r.label_es, r.label_en)} · {r.market_code}</span><Bar value={r.n} max={maxReason} tone="bad" /><span className="num text-right text-[14px] font-semibold">{r.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card data-testid="lt-nosale">
          <CardTitle title={t('Por qué una visita no termina en venta', 'Why a visit ends with no sale')} hint={t('Motivos que captura la Sales App, últimos 14 días.', 'Reasons captured by the Sales App, last 14 days.')} />
          {data.noSale.length === 0 ? <p className="text-[14px] text-muted">—</p> : (
            <ul className="space-y-3">
              {data.noSale.map((r) => (
                <li key={r.code} className="grid grid-cols-[210px_1fr_40px] items-center gap-4">
                  <span className="truncate text-[13.5px] text-muted-2">{t(r.label_es, r.label_en)}</span><Bar value={r.n} max={maxNoSale} /><span className="num text-right text-[14px] font-semibold">{r.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
